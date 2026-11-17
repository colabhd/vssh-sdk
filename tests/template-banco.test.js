'use strict';

// A peça "O banco do app" dos dois templates, EXECUTADA: o backend de cada um de pé numa porta de
// bancada, com um diretório de dados descartável, e o mesmo percurso por HTTP nos dois.
//
// O que se mede:
//
// - as três rotas de `api/notas` respondem os mesmos bytes em Python e em Node (o instante de cada
//   nota à parte), que é a paridade que os templates prometem;
// - a nota guardada continua lá depois de o backend reiniciar: ela mora no arquivo, e não no
//   processo;
// - o banco que o template Python criou abre no template Node, com as notas dele.
//
// O runtime `vssh` vem do `NODE_PATH` e do `PYTHONPATH` quando eles o trazem, e da cópia gerada em
// `runtime/` quando não trazem. Um runtime sem o módulo `banco` (um checkout anterior ao canal que
// o trouxe) pula o arquivo dizendo isso, como pula sem `python3` e num Node sem `node:sqlite`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const RUNTIME = path.join(RAIZ, 'runtime');
const TOKEN = 'tok-de-bancada';

const temPython = spawnSync('python3', ['-c', 'print("ok")'], { encoding: 'utf8' }).stdout?.includes('ok');
let temSqlite = true;
try { require('node:sqlite'); } catch { temSqlite = false; }

// O runtime dos dois lados, com a cópia gerada no fim do caminho: um `NODE_PATH` da máquina que só
// tem outros pacotes não a esconde.
const caminhos = (variavel, copia) => [process.env[variavel], copia].filter(Boolean).join(path.delimiter);
const NODE_PATH = caminhos('NODE_PATH', path.join(RUNTIME, 'node'));
const PYTHONPATH = caminhos('PYTHONPATH', path.join(RUNTIME, 'python'));
const temBanco = spawnSync(process.execPath, ['-e', "process.exit('banco' in require('vssh') ? 0 : 3)"],
  { env: { ...process.env, NODE_PATH, NODE_NO_WARNINGS: '1' } }).status === 0;

const pular = !temPython ? 'python3 não está disponível'
  : !temSqlite ? 'este Node não tem node:sqlite'
    : !temBanco ? 'o runtime `vssh` deste checkout ainda não tem o módulo `banco`' : false;

const TEMPLATES = {
  python: ['python3', [path.join(RAIZ, 'templates', 'hello-vssh-app', 'backend', 'main.py')]],
  node: [process.execPath, [path.join(RAIZ, 'templates', 'hello-vssh-app-node', 'backend', 'server.js')]],
};

/** Sobe o backend de um template sobre `dados` e devolve como pedir a ele e como derrubá-lo. */
async function subir(runtime, dados) {
  const [comando, args] = TEMPLATES[runtime];
  const filho = spawn(comando, [...args, '--tcp', '127.0.0.1:0'], {
    env: {
      PATH: process.env.PATH, HOME: path.dirname(dados), VSSH_APP_ID: 'hello', VSSH_APP_DATA_DIR: dados,
      VSSH_APP_TOKEN: TOKEN, NODE_PATH, PYTHONPATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  const porta = await new Promise((resolve, reject) => {
    const olhar = (d) => {
      saida += d;
      const m = /127\.0\.0\.1:(\d+)/.exec(saida);
      if (m) resolve(Number(m[1]));
    };
    filho.stdout.on('data', olhar);
    filho.stderr.on('data', olhar);
    filho.on('exit', (c) => reject(new Error(`o backend ${runtime} saiu com ${c}: ${saida}`)));
    setTimeout(() => reject(new Error(`o backend ${runtime} não anunciou a porta: ${saida}`)), 15_000).unref();
  });
  const pedir = async (metodo, corpo) => {
    const r = await fetch(`http://127.0.0.1:${porta}/api/notas`, {
      method: metodo,
      headers: { 'X-Vssh-App-Token': TOKEN, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    // O instante de cada nota muda a cada rodada; o resto dos bytes é o que os dois têm de igualar.
    return [r.status, (await r.text()).replace(/"criada_em":\d+/g, '"criada_em":0')];
  };
  const derrubar = () => new Promise((resolve) => { filho.once('exit', resolve); filho.kill(); });
  return { pedir, derrubar };
}

/** O percurso da peça, e o que cada passo respondeu. */
async function percurso(runtime, dados) {
  const b = await subir(runtime, dados);
  try {
    return [
      await b.pedir('GET'),
      await b.pedir('POST', { texto: 'comprar pão' }),
      await b.pedir('POST'),
      await b.pedir('POST', { texto: 'x'.repeat(700) }),
      await b.pedir('GET'),
      await b.pedir('PUT'),
    ];
  } finally { await b.derrubar(); }
}

test('as rotas do banco respondem os mesmos bytes nos dois templates, e as notas ficam depois de reiniciar', { skip: pular }, async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-template-banco-'));
  try {
    const emPython = await percurso('python', path.join(raiz, 'dados-python'));
    const emNode = await percurso('node', path.join(raiz, 'dados-node'));
    assert.deepEqual(emPython, emNode);

    const [vazio, primeira, semTexto, longa, lista, metodo] = emPython;
    assert.deepEqual(vazio, [200, '{"versao":2,"total":0,"notas":[]}']);
    assert.deepEqual(primeira, [200, '{"versao":2,"nota":{"id":1,"texto":"comprar pão","criada_em":0}}']);
    assert.deepEqual(semTexto, [200, '{"versao":2,"nota":{"id":2,"texto":"sem texto","criada_em":0}}']);
    // O texto de uma nota tem teto: o que passa dele é cortado.
    assert.equal(JSON.parse(longa[1]).nota.texto.length, 500);
    assert.deepEqual(JSON.parse(lista[1]).notas.map((n) => n.id), [3, 2, 1]);
    assert.equal(JSON.parse(lista[1]).total, 3);
    assert.equal(metodo[0], 405);

    // O backend caiu e subiu de novo: as notas estão no arquivo. O banco que o Python criou abre
    // no template Node, e o contrário.
    for (const [runtime, pasta] of [['python', 'dados-python'], ['node', 'dados-python'], ['python', 'dados-node']]) {
      const b = await subir(runtime, path.join(raiz, pasta));
      try {
        const [status, corpo] = await b.pedir('GET');
        assert.equal(status, 200, `${runtime} sobre ${pasta}: ${corpo}`);
        assert.deepEqual(JSON.parse(corpo).notas.map((n) => n.texto.slice(0, 11)), ['xxxxxxxxxxx', 'sem texto', 'comprar pão'], `${runtime} sobre ${pasta}`);
      } finally { await b.derrubar(); }
    }

    // "apagar todas" diz quantas saíram, e a lista fica vazia.
    const b = await subir('node', path.join(raiz, 'dados-python'));
    try {
      assert.deepEqual(await b.pedir('DELETE'), [200, '{"versao":2,"apagadas":3}']);
      assert.deepEqual(await b.pedir('GET'), [200, '{"versao":2,"total":0,"notas":[]}']);
    } finally { await b.derrubar(); }
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
