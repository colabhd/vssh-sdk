// A bancada de um app (`scripts/vssh-bancada.mjs`) de ponta a ponta, como o CI de um app a roda:
// um processo, um repositório git de verdade com o app de `tests/fixtures/app-de-bancada`, o
// backend dele, a janela no quadro de bancada num Chrome e as cenas pelo SDK web de `api/`.
//
// A cena do app devolve uma conta de custo conhecido a cada quadro, com números que não dependem da
// máquina, e o teste muda o custo na cabeça:
// a piora aparece na medida de amostras (o p95 de todas as rodadas juntas) e na de um número por
// rodada (a mediana), e a medida que só informa não reprova. O A/A, a pasta contra ela mesma, não
// reprova e diz o ruído; a base sem cenas não tem o que comparar. Uma cabeça que mexe na tela
// parada reprova pela janela parada. Com o portal, a mesma piora passa quando o ruído guardado
// pede uma folga maior, e o run chega ao portal com o token. A calibração leva a CPU da página a
// perto de 100, o Celeron de referência.
//
// O arquivo é `*.serial.js`, e o `npm test` o roda sozinho, depois do resto: a bancada mede tempo,
// e com outros arquivos em paralelo a página perde a vez no meio de uma rodada.
//
// Pula sem Chrome e sem um SDK web com as cenas (`vssh.desempenho.rodarCenas`); `VSSH_SDK_API`
// aponta outro `api/`, como o que o `scripts/gerar-sdk.js` do vssh-sso gera.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { caminhoDoNavegador } = require('../../scripts/navegador.cjs');

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const API = process.env.VSSH_SDK_API || join(RAIZ, 'api');
const SDK_WEB = process.env.VSSH_SDK_WEB || join(API, 'vssh.js');
const BANCADA = join(RAIZ, 'scripts', 'vssh-bancada.mjs');
const FIXTURE = join(RAIZ, 'tests', 'fixtures', 'app-de-bancada');

const falta = !caminhoDoNavegador() ? 'sem Chrome (VSSH_TEST_CHROME aponta um)'
  : !existsSync(SDK_WEB) || !readFileSync(SDK_WEB, 'utf8').includes('rodarCenas') ? `sem as cenas no SDK web de ${SDK_WEB}`
    : false;
const semSonda = falta || (!existsSync(join(API, 'afericao', 'sonda.js')) ? `sem a sonda em ${join(API, 'afericao')}` : false);

let pasta;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=bancada', '-c', 'user.email=bancada@exemplo.invalid', ...args], { encoding: 'utf8' });

/** O app num repositório próprio, com um commit; devolve a pasta do app. */
function repositorio(nome) {
  const dir = join(pasta, nome);
  cpSync(FIXTURE, dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

function bancada(...args) {
  const env = typeof args[args.length - 1] === 'object' ? args.pop() : {};
  const saida = join(pasta, `saida-${Math.random().toString(36).slice(2)}.json`);
  // Um processo filho síncrono prenderia o portal de mentira, que mora neste processo.
  return new Promise((ok) => {
    const filho = spawn(process.execPath, [BANCADA, ...args, '--cpu', '1', '--ciclos', '1', '--parada', '2', '--saida', saida], {
      env: { ...process.env, VSSH_SDK_API: API, GITHUB_STEP_SUMMARY: '', VSSH_BANCADA_PORTAL: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => { stdout += d; });
    filho.stderr.on('data', (d) => { stderr += d; });
    const prazo = setTimeout(() => filho.kill(), 180000);
    filho.on('close', (codigo) => {
      clearTimeout(prazo);
      ok({ codigo, stdout, stderr, json: existsSync(saida) ? JSON.parse(readFileSync(saida, 'utf8')) : null });
    });
  });
}

const custo = (dir, ms) => {
  const arq = join(dir, 'frontend', 'cenas.js');
  writeFileSync(arq, readFileSync(arq, 'utf8').replace(/const CUSTO_MS = \d+;/, `const CUSTO_MS = ${ms};`));
};

before(() => { pasta = mkdtempSync(join(tmpdir(), 'vssh-bancada-teste-')); });
after(() => { if (pasta) rmSync(pasta, { recursive: true, force: true }); });

test('o A/A, a pasta contra ela mesma, não reprova e diz o ruído de cada medida', { skip: falta }, async () => {
  const app = repositorio('aa');
  const r = await bancada('aa', app);
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ruído entre os lados/);
  assert.deepEqual(r.json.linhas.map((l) => [l.cena, l.medida, l.piorou]),
    [['conta', 'conta', false], ['conta', 'soma', false], ['conta', 'maior', false], ['_parada', 'layouts', false], ['_parada', 'cpu', false], ['_parada', 'nos', false], ['_parada', 'heap', false]]);
  assert.deepEqual(r.json.linhas.find((l) => l.medida === 'layouts').cabeca, [0, 0]);
  // Os dois lados rodam as mesmas rodadas, e a diferença entre eles é zero; as rodadas de um lado
  // diferem pelo acréscimo da rodada.
  for (const l of r.json.linhas.filter((x) => x.cena === 'conta')) {
    assert.equal(l.ruido.entreLados, 0, `${l.medida}: ${JSON.stringify(l.ruido)}`);
    assert.ok(l.ruido.rodadas > 0 && l.ruido.rodadas < 0.05, `${l.medida}: ${JSON.stringify(l.ruido)}`);
  }
});

test('a cabeça mais lenta reprova pelas amostras e pela mediana, e a medida que informa não', { skip: falta }, async () => {
  const app = repositorio('comparar');
  custo(app, 12);
  const r = await bancada('comparar', app, '--base', 'HEAD');
  assert.equal(r.codigo, 1, r.stdout + r.stderr);
  const porMedida = Object.fromEntries(r.json.linhas.map((l) => [l.medida, l]));
  assert.equal(porMedida.conta.juntas, true);
  assert.equal(porMedida.conta.piorou, true);
  // O p95 é o das amostras das rodadas todas juntas, e não o de uma rodada.
  const juntas = r.json.rodadas.cabeca.flatMap((rd) => rd.cenas[0].medidas.conta.amostras).sort((a, b) => a - b);
  assert.equal(porMedida.conta.medianaCabeca, juntas[Math.floor(juntas.length * 0.95)]);
  assert.ok(porMedida.conta.medianaBase < 6 && porMedida.conta.medianaCabeca > 10, JSON.stringify(porMedida.conta));
  assert.equal(porMedida.soma.juntas, false);
  assert.equal(porMedida.soma.piorou, true);
  assert.ok(porMedida.maior.medianaCabeca > porMedida.maior.medianaBase * 2, JSON.stringify(porMedida.maior));
  assert.equal(porMedida.maior.piorou, false);
  assert.match(r.stdout, /::error::Uma conta de custo conhecido: conta a cada quadro \(p95\)/);
  // A base saiu de um worktree, e ele não fica para trás.
  assert.equal(git(app, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a cabeça que mexe na tela parada reprova pela janela parada', { skip: falta }, async () => {
  const app = repositorio('parada');
  // Um passo de meio segundo, como um relógio na barra: cada um muda a largura de um elemento, e o
  // navegador refaz o layout no quadro seguinte.
  const arq = join(app, 'frontend', 'cenas.js');
  writeFileSync(arq, `${readFileSync(arq, 'utf8')}\nsetInterval(() => { document.body.style.paddingLeft = document.body.style.paddingLeft === '1px' ? '0px' : '1px'; }, 500);\n`);
  const r = await bancada('comparar', app, '--base', 'HEAD');
  assert.equal(r.codigo, 1, r.stdout + r.stderr);
  const layouts = r.json.linhas.find((l) => l.medida === 'layouts');
  assert.deepEqual(layouts.base, [0, 0]);
  assert.ok(layouts.cabeca.every((x) => x > 0), JSON.stringify(layouts));
  assert.equal(layouts.piorou, true);
  assert.equal(r.json.linhas.find((l) => l.medida === 'conta').piorou, false);
  assert.match(r.stdout, /::error::A janela parada: layouts em 2 s/);
});

test('a cabeça que deixa o que as cenas montaram preso na memória reprova pelos nós', { skip: falta }, async () => {
  const app = repositorio('vaza');
  // Cada rodada guarda três mil elementos fora da página, como um documento fechado que uma closure
  // ainda segura.
  const arq = join(app, 'frontend', 'cenas.js');
  writeFileSync(arq, readFileSync(arq, 'utf8').replace('const amostras = [];', "const amostras = []; (window.__presos = window.__presos || []).push(...Array.from({ length: 3000 }, () => document.createElement('div')));"));
  const r = await bancada('comparar', app, '--base', 'HEAD');
  assert.equal(r.codigo, 1, r.stdout + r.stderr);
  const nos = r.json.linhas.find((l) => l.medida === 'nos');
  assert.equal(nos.piorou, true, JSON.stringify(nos));
  assert.ok(nos.medianaCabeca - nos.medianaBase >= 2500, JSON.stringify(nos));
  assert.equal(r.json.linhas.find((l) => l.medida === 'layouts').piorou, false);
});

test('com o portal, a folga sai do ruído guardado, e o run chega com o token', { skip: falta }, async () => {
  const pedidos = [];
  const portal = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      pedidos.push({ metodo: req.method, url: req.url, token: req.headers.authorization, corpo: corpo && JSON.parse(corpo) });
      if (req.method === 'GET') {
        res.setHeader('content-type', 'application/json');
        // O ruído desta máquina pede 10 ms na conta a cada quadro e 200 ms na soma: a piora de
        // 4 para 12 ms por conta fica dentro dele.
        return res.end(JSON.stringify({ runs: 5, medidas: {
          'conta/conta': { folgaSugerida: 10 }, 'conta/soma': { folgaSugerida: 200 }, 'conta/maior': { folgaSugerida: null },
        } }));
      }
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise((ok) => portal.listen(0, '127.0.0.1', ok));
  try {
    const app = repositorio('historico');
    custo(app, 12);
    const r = await bancada('comparar', app, '--base', 'HEAD', '--runner', 'runner-de-teste', {
      VSSH_BANCADA_PORTAL: `http://127.0.0.1:${portal.address().port}`, VSSH_BANCADA_TOKEN: 'vssh_cs_de-teste',
      GITHUB_REPOSITORY: 'colabhd/app-de-teste', GITHUB_SHA: 'abc1234', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
    });
    assert.equal(r.codigo, 0, r.stdout + r.stderr);
    const porMedida = Object.fromEntries(r.json.linhas.map((l) => [l.medida, l]));
    assert.equal(porMedida.conta.piorou, false);
    assert.deepEqual([porMedida.conta.folga, porMedida.conta.folgaDeclarada, porMedida.conta.folgaDoHistorico], [10, 0.5, true]);
    assert.deepEqual([porMedida.soma.folga, porMedida.soma.folgaDoHistorico], [200, true]);
    assert.match(r.stdout, /do ruído de 5 A\/A guardados deste runner \(runner-de-teste\)/);

    const [ruido, guardado] = pedidos;
    assert.equal(ruido.metodo, 'GET');
    assert.equal(ruido.url, '/api/afericao/bancada/ruido?app=bancada-de-teste&runner=runner-de-teste&perfil=software');
    assert.equal(guardado.metodo, 'POST');
    assert.equal(guardado.url, '/api/afericao/bancada');
    assert.equal(guardado.token, 'Bearer vssh_cs_de-teste');
    const run = guardado.corpo;
    assert.deepEqual([run.app, run.versao, run.modo, run.runner, run.perfil, run.repositorio, run.commit, run.evento, run.ref],
      ['bancada-de-teste', '1.0.0', 'comparar', 'runner-de-teste', 'software', 'colabhd/app-de-teste', 'abc1234', 'push', 'refs/heads/main']);
    assert.deepEqual(run.linhas.map((l) => `${l.cena}/${l.medida}`), r.json.linhas.map((l) => `${l.cena}/${l.medida}`));
    // A medida que a cena declara medir o mesmo gesto do campo leva o nome dele, e só ela.
    assert.deepEqual(run.linhas.filter((l) => l.campo).map((l) => [l.medida, l.campo]), [['conta', 'conta']]);
    assert.equal(run.cpu.multiplicador, 1);

    // Um A/A julga pela folga declarada e só manda o run: é ele que mede o ruído.
    pedidos.length = 0;
    const aa = await bancada('aa', app, '--runner', 'runner-de-teste', {
      VSSH_BANCADA_PORTAL: `http://127.0.0.1:${portal.address().port}`, VSSH_BANCADA_TOKEN: 'vssh_cs_de-teste',
    });
    assert.equal(aa.codigo, 0, aa.stdout + aa.stderr);
    assert.deepEqual(pedidos.map((p) => p.metodo), ['POST']);
    assert.equal(pedidos[0].corpo.modo, 'aa');
    assert.ok(aa.json.linhas.every((l) => !l.folgaDoHistorico));
  } finally {
    portal.close();
  }
});

test('a cabeça igual à base não reprova', { skip: falta }, async () => {
  const app = repositorio('igual');
  const r = await bancada('comparar', app, '--base', 'HEAD');
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
  assert.ok(r.json.linhas.every((l) => !l.piorou));
});

test('a base que não registra cenas não tem o que comparar', { skip: falta }, async () => {
  const app = repositorio('sem-cenas');
  git(app, 'rm', '-q', 'frontend/cenas.js');
  git(app, 'commit', '-qm', 'sem as cenas');
  git(app, 'revert', '--no-edit', 'HEAD');
  const r = await bancada('comparar', app, '--base', 'HEAD~1');
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /não registra cenas; não há o que comparar/);
});

test('a calibração leva a CPU da página a perto de 100', { skip: semSonda }, () => {
  const r = spawnSync(process.execPath, [BANCADA, 'calibrar'], { encoding: 'utf8', env: { ...process.env, VSSH_SDK_API: API }, timeout: 180000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [, livre, multiplicador, indice] = /CPU da página: (\d+) sem estrangular; com o multiplicador ([\d.]+), (\d+)/.exec(r.stdout) || [];
  assert.ok(livre, r.stdout);
  // Numa máquina mais lenta que a âncora não há o que estrangular.
  if (Number(multiplicador) === 1) assert.ok(Number(livre) <= 110, r.stdout);
  else assert.ok(Math.abs(Number(indice) - 100) <= 15, r.stdout);
});
