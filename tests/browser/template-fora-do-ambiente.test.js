'use strict';

// O template Node num Chrome de verdade, fora do ambiente, com o SDK web de verdade.
//
// O que se mede: o backend do template sobe como o servidor o sobe (socket unix, o mesmo
// `backend/server.js`), a página que ele serve inclui `_sdk/vssh.js` e o Tuff pelos caminhos do
// contrato, e um Chrome aberto nela, sem shell por cima (`window.parent === window`), não lança
// exceção nenhuma e vê cada verbo degradar como o SDK promete: `capacidades()` responde sem shell,
// um seletor responde `null`, um diálogo cai no do navegador, um aviso vai ao console.
//
// Quem serve `_sdk/` aqui é este teste, no lugar do sistema: um HTTP na frente do socket do app
// que responde `_sdk/vssh.js` com o artefato e `_sdk/tuff/*` com os arquivos do Tuff, e encaminha
// o resto ao backend. É o mesmo arranjo do portal, sem o portal.
//
// De onde vêm os bytes do SDK: de `api/vssh.js` e `api/tuff/`, que o canal de publicação do
// sistema escreve neste repositório. `VSSH_SDK_WEB` e `VSSH_SDK_TUFF` apontam para outras cópias
// (um artefato montado à mão de um checkout do sistema, por exemplo). Sem o artefato o teste se
// pula dizendo o caminho.
//
// O backend precisa de socket unix, então no Windows o teste se pula; `VSSH_TEMPLATE_URL` aponta
// para um backend já de pé num TCP (um relay de dentro do WSL), e aí o teste roda em qualquer
// lugar. As libs do template chegam pelo `installCommand` do manifesto; sem elas, pula também.
//
// Só o template Node: o `galeria.js` é o mesmo arquivo nos dois templates e a marcação difere
// só no nome do runtime (`tests/galeria-paridade.test.js`), então medir um é medir os dois.

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const { abrirNavegador, caminhoDoNavegador, motivoDoSkip } = require('./chrome.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'templates', 'hello-vssh-app-node');
const SDK_WEB = process.env.VSSH_SDK_WEB || path.join(ROOT, 'api', 'vssh.js');
const SDK_TUFF = process.env.VSSH_SDK_TUFF || path.join(ROOT, 'api', 'tuff');
const URL_DO_APP = process.env.VSSH_TEMPLATE_URL || '';

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.json': 'application/json' };

function motivoParaPular() {
  if (!caminhoDoNavegador()) return motivoDoSkip();
  if (!fs.existsSync(SDK_WEB)) return `sem o SDK web em ${SDK_WEB}: o canal do sistema o escreve em api/, ou aponte VSSH_SDK_WEB`;
  if (!URL_DO_APP && process.platform === 'win32') return 'o backend do template escuta num socket unix; no Windows aponte VSSH_TEMPLATE_URL para um backend de pé';
  if (!URL_DO_APP && !fs.existsSync(path.join(APP, 'node_modules', 'vssh-app-toolkit'))) {
    return 'sem as libs do template: rode o installCommand do vssh-app.json em templates/hello-vssh-app-node';
  }
  return false;
}
const pular = motivoParaPular();

/** @type {any} */ let navegador, frente, backend, pagina, dirTemp;

/** Um pedido ao backend do template, pelo socket unix ou pelo TCP de `VSSH_TEMPLATE_URL`. */
function aoBackend(req, res) {
  const alvo = URL_DO_APP
    ? { host: new URL(URL_DO_APP).hostname, port: new URL(URL_DO_APP).port }
    : { socketPath: backend.socket };
  const encaminhado = http.request({ ...alvo, path: req.url, method: req.method, headers: { ...req.headers, host: 'app' } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  encaminhado.on('error', (err) => { res.writeHead(502); res.end(err.message); });
  req.pipe(encaminhado);
}

/** O que o sistema responde em `_sdk/`: o artefato e o Tuff, e 404 para o resto. */
function doSdk(rel, res) {
  let arquivo = null;
  if (rel === 'vssh.js') arquivo = SDK_WEB;
  else if (rel.startsWith('tuff/') && !rel.includes('..')) arquivo = path.join(SDK_TUFF, rel.slice('tuff/'.length));
  if (!arquivo || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(arquivo)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(arquivo).pipe(res);
}

async function subirBackend() {
  dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-tpl-'));
  const socket = path.join(dirTemp, 'app.sock');
  const proc = spawn(process.execPath, ['backend/server.js'], {
    cwd: APP,
    env: { ...process.env, VSSH_APP_SOCKET: socket, VSSH_APP_ID: 'hello-world-node', VSSH_APP_DATA_DIR: path.join(dirTemp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  proc.stdout.on('data', (d) => { saida += d; });
  proc.stderr.on('data', (d) => { saida += d; });
  const fim = Date.now() + 20000;
  while (!fs.existsSync(socket)) {
    if (proc.exitCode !== null || Date.now() > fim) throw new Error(`o backend do template não subiu:\n${saida.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { proc, socket };
}

before(async () => {
  if (pular) return;
  if (!URL_DO_APP) backend = await subirBackend();
  frente = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://app');
    if (u.pathname.startsWith('/_sdk/')) return doSdk(u.pathname.slice('/_sdk/'.length), res);
    return aoBackend(req, res);
  });
  await new Promise((ok) => frente.listen(0, '127.0.0.1', ok));
  navegador = await abrirNavegador();
  pagina = await navegador.novaPagina(`http://127.0.0.1:${frente.address().port}/`);
});

after(async () => {
  await navegador?.fechar();
  if (frente) await new Promise((ok) => frente.close(ok));
  if (backend) {
    backend.proc.kill();
    await new Promise((ok) => { backend.proc.once('exit', ok); setTimeout(ok, 3000).unref?.(); });
  }
  if (dirTemp) fs.rmSync(dirTemp, { recursive: true, force: true });
});

/** Espera o texto de um `<pre>` da galeria sair do travessão inicial, e o devolve. */
async function texto(id, limiteMs = 15000) {
  const fim = Date.now() + limiteMs;
  for (;;) {
    const t = await pagina.avaliar(`document.getElementById(${JSON.stringify(id)}).textContent`);
    if (t && t !== '—' && !/^(lendo|chamando)/.test(t)) return t;
    if (Date.now() > fim) assert.fail(`esperei ${limiteMs}ms e '#${id}' continuou em ${JSON.stringify(t)}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

const clicar = (id) => pagina.avaliar(`document.getElementById(${JSON.stringify(id)}).click(); true`);

test('a página inclui o SDK e o Tuff pelos caminhos do contrato, e só o que é do app leva carimbo', { skip: pular }, async () => {
  const srcs = await pagina.avaliar(`[...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
    .map((el) => el.getAttribute('src') || el.getAttribute('href'))`);
  const scripts = srcs.filter((s) => s.endsWith('.js') || s.includes('.js?'));
  assert.equal(scripts[0], '_sdk/vssh.js', 'o SDK tem de ser o primeiro script: os outros o chamam');
  for (const s of srcs.filter((x) => x.startsWith('_sdk/'))) {
    assert.ok(!s.includes('?v='), `${s} saiu com carimbo, e o sistema serve esse caminho sem carimbo`);
  }
  const galeria = srcs.find((s) => s.startsWith('galeria.js'));
  assert.match(galeria, /\?v=[0-9a-f]+$/, 'o código do app perdeu o carimbo de conteúdo');
});

test('o SDK carrega fora do ambiente, sem exceção, e se declara fora', { skip: pular }, async () => {
  assert.equal(await pagina.avaliar('typeof vssh'), 'object', 'o `_sdk/vssh.js` não definiu `vssh`');
  assert.equal(await pagina.avaliar('vssh.noAmbiente'), false);
  assert.equal(await pagina.avaliar('typeof TuffGaveta'), 'object', 'o Tuff não carregou');
  const ambiente = await texto('ambiente');
  assert.match(ambiente, /dentro do ambiente: false/);
  assert.match(ambiente, /fora do ambiente/);
  assert.match(ambiente, /host: none/);
  assert.deepEqual(pagina.excecoes, [], 'a página lançou');
  assert.deepEqual(pagina.console.filter((c) => c.tipo === 'error'), [], 'houve erro no console');
});

test('um seletor responde null, e a galeria diz isso em vez de seguir', { skip: pular }, async () => {
  pagina.limparRegistros();
  await clicar('pick-file');
  assert.match(await texto('picks'), /escolherArquivo → null/);
  await clicar('pick-dir');
  assert.match(await texto('picks'), /escolherPasta → null/);
  assert.deepEqual(pagina.excecoes, []);
});

test('um diálogo cai no do navegador, com a resposta dele', { skip: pular }, async () => {
  pagina.limparRegistros();
  await pagina.avaliar("window.confirm = () => true; window.prompt = () => null; true");
  await clicar('confirm');
  assert.match(await texto('bridge'), /confirmar devolveu: true/);
  await clicar('dialog-prompt');
  assert.match(await texto('bridge'), /perguntar devolveu null/);
  assert.deepEqual(pagina.excecoes, []);
});

test('um aviso fora do ambiente vai ao console, e a permissão responde null', { skip: pular }, async () => {
  pagina.limparRegistros();
  await clicar('toast');
  assert.match(await texto('bridge'), /avisar: aparece e some/);
  assert.ok(pagina.console.some((c) => c.tipo === 'info' && /\[vssh\].*Copiado/.test(c.texto)),
    `o aviso não chegou ao console: ${JSON.stringify(pagina.console)}`);
  await clicar('fs-grants');
  assert.match(await texto('grants'), /permissoes\(.*\) → null/);
  assert.match(await texto('grants'), /concedidos\(\) → 0 caminho/);
  assert.deepEqual(pagina.excecoes, []);
});

test('o backend do template responde por trás da mesma origem', { skip: pular }, async () => {
  pagina.limparRegistros();
  await clicar('ping');
  assert.match(await texto('out'), /"pong": true/);
  assert.deepEqual(pagina.excecoes, []);
});
