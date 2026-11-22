'use strict';

// O comando de cada template no terminal, e o servidor MCP dele, executados: o backend de verdade num socket unix, com o
// token, e o comando (`bin/hello.py`, `bin/hello.mjs`) com o mesmo `VSSH_APP_SOCKET` e o mesmo
// `VSSH_APP_TOKEN`, que é o ambiente que o `vssh-app-comando` da estação monta. O que se mede é o
// que a pessoa lê no terminal: a hora que o backend respondeu, o JSON compacto do `--json`, o
// `--help` e a saída 3 quando ninguém atende no socket.
//
// O runtime `vssh` vem do `NODE_PATH` e do `PYTHONPATH` quando há um, e da cópia de `runtime/`
// quando não há. Sem `servidor.pedir` nele os casos se pulam dizendo isso.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const RUNTIME = path.join(RAIZ, 'runtime');
const TOKEN = 'tok-de-bancada';

const caminhos = (variavel, copia) => [process.env[variavel], copia].filter(Boolean).join(path.delimiter);
const NODE_PATH = caminhos('NODE_PATH', path.join(RUNTIME, 'node'));
const PYTHONPATH = caminhos('PYTHONPATH', path.join(RUNTIME, 'python'));
const temPython = spawnSync('python3', ['-c', 'print("ok")'], { encoding: 'utf8' }).stdout?.includes('ok');
const temPedir = spawnSync(process.execPath, ['-e', "process.exit(typeof require('vssh').servidor.pedir === 'function' ? 0 : 3)"],
  { env: { ...process.env, NODE_PATH, NODE_NO_WARNINGS: '1' } }).status === 0;
const pular = process.platform === 'win32' ? 'o socket do app pede AF_UNIX'
  : !temPython ? 'python3 não está disponível'
    : !temPedir ? 'o runtime `vssh` deste checkout ainda não tem `servidor.pedir`' : false;

const TEMPLATES = {
  python: { backend: ['python3', 'templates/hello-vssh-app/backend/main.py'], comando: ['python3', 'templates/hello-vssh-app/bin/hello.py'],
    mcp: ['python3', 'templates/hello-vssh-app/bin/mcp.py'], id: 'hello-world' },
  node: { backend: [process.execPath, 'templates/hello-vssh-app-node/backend/server.js'], comando: [process.execPath, 'templates/hello-vssh-app-node/bin/hello.mjs'],
    mcp: [process.execPath, 'templates/hello-vssh-app-node/bin/mcp.mjs'], id: 'hello-world-node' },
};

function ambiente(t, socket, dados) {
  return {
    PATH: process.env.PATH, HOME: path.dirname(dados), VSSH_APP_ID: t.id, VSSH_APP_DATA_DIR: dados,
    VSSH_APP_SOCKET: socket, VSSH_APP_TOKEN: TOKEN, NODE_PATH, PYTHONPATH,
    PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', NODE_NO_WARNINGS: '1',
  };
}

/** Sobe o backend do template no socket e espera ele escutar. */
async function subir(t, socket, dados) {
  const filho = spawn(t.backend[0], [path.join(RAIZ, t.backend[1])], { env: ambiente(t, socket, dados), stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  await new Promise((resolve, reject) => {
    const olhar = (d) => { saida += d; if (/escutando em/.test(saida)) resolve(); };
    filho.stdout.on('data', olhar);
    filho.stderr.on('data', olhar);
    filho.on('exit', (c) => reject(new Error(`o backend saiu com ${c}: ${saida}`)));
    setTimeout(() => reject(new Error(`o backend não escutou: ${saida}`)), 15_000).unref();
  });
  return filho;
}

const rodar = (t, socket, dados, args = []) => spawnSync(t.comando[0], [path.join(RAIZ, t.comando[1]), ...args],
  { encoding: 'utf8', env: ambiente(t, socket, dados), timeout: 30_000 });

for (const [runtime, t] of Object.entries(TEMPLATES)) {
  test(`o comando do template ${runtime} pergunta a hora ao backend pelo socket, com o token`, { skip: pular }, async (ctx) => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-comando-'));
    const dados = path.join(raiz, 'dados');
    fs.mkdirSync(dados);
    const socket = path.join(raiz, 'app.sock');
    const backend = await subir(t, socket, dados);
    ctx.after(() => { backend.kill(); fs.rmSync(raiz, { recursive: true, force: true }); });

    const texto = rodar(t, socket, dados);
    assert.equal(texto.status, 0, texto.stderr);
    assert.match(texto.stdout, new RegExp(`^${t.id} respondeu às \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\n$`));

    const json = rodar(t, socket, dados, ['--json']);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(json.stdout.trim(), JSON.stringify(JSON.parse(json.stdout)), 'o JSON não saiu com os separadores compactos');
    assert.equal(JSON.parse(json.stdout).appId, t.id);

    // Com outro token, o portão do backend recusa, e o comando diz o status.
    const recusado = spawnSync(t.comando[0], [path.join(RAIZ, t.comando[1])],
      { encoding: 'utf8', env: { ...ambiente(t, socket, dados), VSSH_APP_TOKEN: 'outro' }, timeout: 30_000 });
    assert.equal(recusado.status, 1);
    assert.match(recusado.stderr, /O backend respondeu 403\./);
  });

  test(`o comando do template ${runtime} mostra o uso, e sem backend sai com 3`, { skip: pular }, () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-comando-'));
    try {
      const ajuda = rodar(t, path.join(raiz, 'app.sock'), raiz, ['--help']);
      assert.equal(ajuda.status, 0);
      assert.match(ajuda.stdout, new RegExp(`^uso: ${t.id} \\[--json\\]\\n\\nPergunta a hora ao backend do app e a escreve\\.`));
      const sem = rodar(t, path.join(raiz, 'app.sock'), raiz);
      assert.equal(sem.status, 3);
      assert.match(sem.stderr, /^O backend não respondeu: /);
    } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
  });
}

for (const [runtime, t] of Object.entries(TEMPLATES)) {
  test(`o servidor MCP do template ${runtime} responde o initialize, lista a hora e a pergunta ao backend, e cala nas notificações`, { skip: pular }, async (ctx) => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-mcp-'));
    const dados = path.join(raiz, 'dados');
    fs.mkdirSync(dados);
    const socket = path.join(raiz, 'app.sock');
    const backend = await subir(t, socket, dados);
    ctx.after(() => { backend.kill(); fs.rmSync(raiz, { recursive: true, force: true }); });

    const entrada = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bancada', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hora', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'resources/list' },
    ].map((m) => JSON.stringify(m)).join('\n') + '\n';
    const r = spawnSync(t.mcp[0], [path.join(RAIZ, t.mcp[1])], { encoding: 'utf8', env: ambiente(t, socket, dados), input: entrada, timeout: 30_000 });
    assert.equal(r.status, 0, r.stderr);
    const respostas = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(respostas.map((m) => m.id), [1, 2, 3, 4], 'a notificação recebeu resposta, ou um pedido ficou sem');
    assert.equal(respostas[0].result.serverInfo.name, t.id);
    assert.deepEqual(respostas[1].result.tools.map((f) => f.name), ['hora']);
    assert.match(respostas[2].result.content[0].text, new RegExp(`^${t.id} respondeu às \\d{4}-`));
    assert.equal(respostas[3].error.code, -32601);
  });
}
