'use strict';

// O template Node num Chrome de verdade, fora do ambiente, com o SDK web de verdade.
//
// O que se mede: o backend do template sobe (o mesmo `backend/server.js`, numa porta de bancada
// pelo `--tcp` do `servidor.escutar`), a página que ele serve inclui `_sdk/vssh.js` e o Tuff pelos
// caminhos do contrato, e um Chrome aberto nela, sem shell por cima (`window.parent === window`),
// não lança exceção nenhuma e vê cada verbo degradar como o SDK promete: `capacidades()` responde
// sem shell, um seletor responde `null`, um diálogo cai no do navegador, um aviso vai ao console.
// O socket unix, que é como o servidor o sobe, fica com o smoke do `ci.yml`.
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
// O runtime `vssh` que o backend importa vem do `NODE_PATH` quando há um (a fonte, ou o que
// `scripts/ambiente-de-dev.sh` exporta), e da cópia gerada em `runtime/node` deste checkout
// quando não há. `VSSH_TEMPLATE_URL` aponta para um backend já de pé em qualquer lugar, e aí
// nenhum sobe daqui.
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
const RUNTIME_NODE = path.join(ROOT, 'runtime', 'node');

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.json': 'application/json' };

function motivoParaPular() {
  if (!caminhoDoNavegador()) return motivoDoSkip();
  if (!fs.existsSync(SDK_WEB)) return `sem o SDK web em ${SDK_WEB}: o canal do sistema o escreve em api/, ou aponte VSSH_SDK_WEB`;
  if (!URL_DO_APP && !process.env.NODE_PATH && !fs.existsSync(path.join(RUNTIME_NODE, 'vssh'))) {
    return 'sem o runtime `vssh` neste checkout: o canal do sistema o escreve em runtime/node, ou exporte NODE_PATH';
  }
  return false;
}
const pular = motivoParaPular();

/** @type {any} */ let navegador, frente, backend, pagina, dirTemp;

/** Um pedido ao backend do template: o que subiu aqui, ou o de `VSSH_TEMPLATE_URL`. */
function aoBackend(req, res) {
  const alvo = URL_DO_APP
    ? { host: new URL(URL_DO_APP).hostname, port: new URL(URL_DO_APP).port }
    : { host: '127.0.0.1', port: backend.porta };
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

/**
 * Sobe o backend numa porta livre e lê a porta da linha que o `servidor.escutar` anuncia no
 * stdout (`[<id>] versão <v> escutando em 127.0.0.1:<porta>`), que é o que ela existe para dizer.
 */
async function subirBackend() {
  dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-tpl-'));
  const proc = spawn(process.execPath, ['backend/server.js', '--tcp', '127.0.0.1:0'], {
    cwd: APP,
    env: {
      ...process.env,
      NODE_PATH: process.env.NODE_PATH || RUNTIME_NODE,
      VSSH_APP_ID: 'hello-world-node', VSSH_APP_DATA_DIR: path.join(dirTemp, 'data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  proc.stdout.on('data', (d) => { saida += d; });
  proc.stderr.on('data', (d) => { saida += d; });
  const fim = Date.now() + 20000;
  for (;;) {
    const m = /escutando em 127\.0\.0\.1:(\d+)/.exec(saida);
    if (m) return { proc, porta: Number(m[1]) };
    if (proc.exitCode !== null || Date.now() > fim) throw new Error(`o backend do template não subiu:\n${saida.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
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

/** Espera um `<pre>` da galeria receber o primeiro texto, e o devolve. */
async function texto(id, limiteMs = 15000) {
  const fim = Date.now() + limiteMs;
  for (;;) {
    const t = await pagina.avaliar(`document.getElementById(${JSON.stringify(id)}).textContent`);
    if (t && !/^(lendo|chamando)/.test(t)) return t;
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
  assert.equal(await pagina.avaliar('typeof TuffApp'), 'object', 'o Tuff não carregou');
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

// ─── A moldura num celular em pé ─────────────────────────────────────────────
//
// Uma página nova, com 320 px (a largura que o WCAG usa para medir o reflow) e toque emulado, para o `(pointer: coarse)` responder dentro dela.
// O que se mede é o que a pessoa vê e toca: a galeria cabe na largura, o toque no menu abre a
// gaveta, o toque numa peça fecha a gaveta e leva o miolo até a peça, e o painel da moldura é a
// tela seguinte, com "Voltar".

async function ate(pg, expressao, oQue, limiteMs = 10000) {
  const fim = Date.now() + limiteMs;
  for (;;) {
    if (await pg.avaliar(expressao)) return;
    if (Date.now() > fim) assert.fail(`esperei ${limiteMs}ms e ${oQue} não aconteceu`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Um toque de dedo no meio do elemento, com o `touchstart` e o `touchend` que o Chrome traduz em clique. */
async function tocar(pg, seletor) {
  const ponto = await pg.avaliar(`(() => {
    const r = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await pg.enviar('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [ponto] });
  await pg.enviar('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('em 320 px com toque, a galeria cabe na largura, e a gaveta e o painel abrem e fecham pelo toque', { skip: pular }, async () => {
  const celular = await navegador.novaPagina('about:blank');
  await celular.enviar('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
  await celular.enviar('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await celular.enviar('Page.enable');
  const carregou = celular.esperarEvento('Page.loadEventFired');
  await celular.enviar('Page.navigate', { url: `http://127.0.0.1:${frente.address().port}/` });
  await carregou;
  const moldura = `document.querySelector('.tuff-app')`;
  await ate(celular, `${moldura}?.dataset.forma === 'compacta' && !!document.querySelector('#gaveta-nav .tuff-gaveta-item')`,
    'a moldura subir na forma compacta');

  const larguras = await celular.avaliar(`(() => {
    const m = document.getElementById('miolo');
    return { pagina: document.documentElement.scrollWidth, janela: innerWidth, conteudo: m.scrollWidth, miolo: m.clientWidth };
  })()`);
  assert.ok(larguras.pagina <= larguras.janela && larguras.conteudo <= larguras.miolo,
    `a galeria rola de lado em 320 px: ${JSON.stringify(larguras)}`);
  assert.equal(await celular.avaliar(`document.getElementById('moldura-ponteiro').textContent`), 'Toque');

  await tocar(celular, '[data-tuff-app-gaveta]');
  // A gaveta entra deslizando, e o toque espera ela parar: no meio do caminho o item ainda está
  // fora da tela.
  await ate(celular, `${moldura}.classList.contains('tuff-app--gaveta-aberta')
    && document.getElementById('gaveta-nav').getBoundingClientRect().left === 0`, 'a gaveta abrir');
  await celular.avaliar(`(() => {
    const item = [...document.querySelectorAll('#gaveta-nav .tuff-gaveta-item')].find((b) => b.textContent === 'Bandeja do sistema');
    item.dataset.teste = 'escolha';
    return true;
  })()`);
  await tocar(celular, '[data-teste="escolha"]');
  await ate(celular, `!${moldura}.classList.contains('tuff-app--gaveta-aberta')`, 'a gaveta fechar depois da escolha');
  await ate(celular, `(() => {
    const secao = [...document.querySelectorAll('.galeria > section')].find((s) => s.querySelector('h2').textContent === 'Bandeja do sistema');
    return Math.abs(secao.getBoundingClientRect().top - document.getElementById('miolo').getBoundingClientRect().top) < 4;
  })()`, 'o miolo chegar à peça escolhida');
  assert.equal(await celular.avaliar(`document.querySelector('[data-teste="escolha"]').getAttribute('aria-current')`), 'true');

  await tocar(celular, '.barra-moldura');
  await ate(celular, `(() => {
    const r = document.getElementById('painel-moldura').getBoundingClientRect();
    return ${moldura}.classList.contains('tuff-app--painel-aberto') && r.left === 0 && r.width === innerWidth;
  })()`, 'o painel cobrir a tela');
  await tocar(celular, '[data-tuff-app-voltar]');
  await ate(celular, `!${moldura}.classList.contains('tuff-app--painel-aberto')`, 'o "Voltar" fechar o painel');
  assert.deepEqual(celular.excecoes, [], 'a página lançou');
});
