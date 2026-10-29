'use strict';

// O palco de um app num Chrome de verdade, sobre o template Node: o backend sobe, a janela abre no
// quadro de bancada com o SDK web de `api/vssh.js`, e os passos da ajuda do template são executados
// com a figura de cada um.
//
// Os casos medem as três coisas que o palco decide. A figura com os rótulos conferidos (o nível 3)
// fica de fora quando um passo cita um nome que a janela não mostra. A ponte (o nível 4) fica de
// fora quando o SDK da página não responde ao `ajuda-mostrar`, que é o caso de um app que não
// carrega `_sdk/vssh.js`: as figuras continuam, porque o palco acha o controle pelo DOM. E o
// publish inteiro sobe as figuras depois do `ajuda.json`, contra um Worker de mentira.
//
// Sem Chrome, sem `api/` ou sem o runtime `vssh` neste checkout, os casos se pulam dizendo o que
// falta.

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const { caminhoDoNavegador, motivoDoSkip } = require('../../scripts/navegador.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(ROOT, 'templates', 'hello-vssh-app-node');
const PALCO = path.join(ROOT, 'scripts', 'palco-do-app.mjs');
const COMPILAR = path.join(ROOT, 'scripts', 'compilar-ajuda.mjs');
const PUBLISH = path.join(ROOT, 'scripts', 'vssh-app-publish');
const posix = (p) => p.replace(/\\/g, '/');

function motivoParaPular() {
  if (!caminhoDoNavegador()) return motivoDoSkip();
  if (!fs.existsSync(path.join(ROOT, 'api', 'ajuda', 'ambiente.json'))) return 'sem api/ajuda/: o canal do sistema ainda não a gerou';
  if (!fs.existsSync(path.join(ROOT, 'api', 'vssh.js'))) return 'sem api/vssh.js neste checkout';
  if (!fs.existsSync(path.join(ROOT, 'runtime', 'node', 'vssh'))) return 'sem o runtime `vssh` em runtime/node';
  if (!process.features.typescript) return `o Node ${process.version} não importa TypeScript`;
  return false;
}
const pular = motivoParaPular();

const temporarios = [];
after(() => { for (const d of temporarios) fs.rmSync(d, { recursive: true, force: true }); });
function pasta(prefixo) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  temporarios.push(d);
  return d;
}

/** Uma cópia do template, com o tópico de entrada trocado por `trocar`. */
function copiaDoTemplate(trocar = (t) => t) {
  const dir = path.join(pasta('vssh-palco-app-'), 'app');
  fs.cpSync(TEMPLATE, dir, { recursive: true, filter: (p) => !p.includes(`${path.sep}node_modules`) });
  const topico = path.join(dir, 'ajuda', 'comecar.md');
  fs.writeFileSync(topico, trocar(fs.readFileSync(topico, 'utf8')));
  return dir;
}

function rodar(script, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let saida = '';
    p.stdout.on('data', (c) => { saida += c; });
    p.stderr.on('data', (c) => { saida += c; });
    p.on('close', (code) => {
      const valores = (chave) => saida.split('\n').filter((l) => l.startsWith(`${chave}=`)).map((l) => l.slice(chave.length + 1));
      resolve({ code, saida, valores });
    });
  });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('o palco executa os passos do template, com uma figura por passo, e a ponte responde', { skip: pular }, async () => {
  const saida = pasta('vssh-palco-');
  const r = await rodar(PALCO, [TEMPLATE, '--saida', saida]);
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.valores('FALTA'), []);
  assert.deepEqual(r.valores('EVIDENCIA_FIGURAS'), ['1']);
  assert.deepEqual(r.valores('PONTE'), ['1']);

  const { cenas } = JSON.parse(fs.readFileSync(path.join(saida, 'indice.json'), 'utf8'));
  assert.deepEqual(Object.keys(cenas).sort(), ['comecar-0-0', 'comecar-0-1']);
  assert.equal(cenas['comecar-0-0'].alvos[0].nome, 'guardar HELLO_SEGREDO');
  for (const id of Object.keys(cenas)) {
    assert.deepEqual(fs.readFileSync(path.join(saida, `${id}.png`)).subarray(0, 4), PNG, `${id}.png não é PNG`);
  }

  const c = await rodar(COMPILAR, [TEMPLATE, '--palco', saida]);
  assert.deepEqual(c.valores('NIVEL'), ['4'], c.saida);
});

test('um rótulo que a janela não mostra tira a figura do nível, com o arquivo e a linha', { skip: pular }, async () => {
  const app = copiaDoTemplate((t) => t.replace('[[guardar HELLO_SEGREDO]]', '[[guardar a senha]]'));
  const saida = pasta('vssh-palco-');
  const r = await rodar(PALCO, [app, '--saida', saida]);
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.valores('EVIDENCIA_FIGURAS'), ['0']);
  assert.ok(r.valores('FALTA').some((f) => /^ajuda\/comecar\.md:\d+: .*\[\[guardar a senha\]\]/.test(f)), r.saida);

  const c = await rodar(COMPILAR, [app, '--palco', saida]);
  assert.deepEqual(c.valores('NIVEL'), ['2'], c.saida);
});

test('sem o SDK respondendo pela ponte, as figuras continuam e o nível para no 3', { skip: pular }, async () => {
  const vazio = path.join(pasta('vssh-sdk-vazio-'), 'vssh.js');
  fs.writeFileSync(vazio, 'window.vssh = { noAmbiente: false };\n');
  const saida = pasta('vssh-palco-');
  const r = await rodar(PALCO, [TEMPLATE, '--saida', saida], { VSSH_SDK_WEB: vazio });
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.valores('PONTE'), ['0']);
  assert.deepEqual(r.valores('EVIDENCIA_FIGURAS'), ['1'], r.saida);

  const c = await rodar(COMPILAR, [TEMPLATE, '--palco', saida]);
  assert.deepEqual(c.valores('NIVEL'), ['3'], c.saida);
});

// ─── A cena ───────────────────────────────────────────────────────────────────
//
// Um app cuja janela depende de uma pasta escolhida pela ponte e de um arquivo na HOME. O
// `palco.mjs` dele escreve a pasta na HOME descartável, o título no diretório de dados, e responde
// o `arquivos.escolherPasta` com a pasta. O backend só lê um caminho de dentro da HOME que ele
// recebeu, então o nome da pasta só aparece na janela quando a HOME da cena chegou até ele.

const CENA = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function preparar({ home, dados }) {
  const pasta = join(home, 'Projetos');
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, 'nome.txt'), 'Projetos de exemplo');
  writeFileSync(join(dados, 'titulo.txt'), 'Bancada da cena');
  return { ponte: { 'arquivos.escolherPasta': pasta } };
}
`;

/** O app de bancada da cena, com `palco` no lugar do `palco.mjs` (nenhum quando `null`). */
function appDaCena(palco = CENA) {
  const dir = path.join(pasta('vssh-palco-cena-'), 'app');
  const escrever = (rel, texto) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), texto);
  };
  escrever('vssh-app.json', JSON.stringify({
    id: 'palco-cena', name: 'Cena', version: '1.0.0', description: 'O app de bancada da cena do palco.',
    contributes: { ajuda: { pasta: 'ajuda', inicio: 'comecar' } },
    minShellVersion: '5.0.0',
    backend: { runtime: 'node', transport: 'socket', entrypoint: 'backend/server.js', healthcheckPath: '/saude' },
    window: { title: 'Cena', width: 640, height: 480 },
  }));
  escrever('backend/server.js', `'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { servidor, web, app } = require('vssh');

const spa = web.spa(path.join(__dirname, '..', 'frontend'));
const ler = (p) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } };
const json = (res, obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

servidor.escutar(http.createServer(servidor.portao(async (req, res) => {
  const url = new URL(req.url, 'http://app');
  if (url.pathname === '/api/titulo') return json(res, { titulo: ler(path.join(app.dados(), 'titulo.txt')) || 'Sem título' });
  if (url.pathname === '/api/pasta') {
    const pasta = path.resolve(url.searchParams.get('caminho') || '');
    const nome = pasta.startsWith(os.homedir() + path.sep) ? ler(path.join(pasta, 'nome.txt')) : '';
    return json(res, { nome: nome || 'fora da HOME' });
  }
  if (await spa(req, res, url)) return;
  res.writeHead(404); res.end();
})));
`);
  escrever('frontend/index.html', `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Cena</title></head>
<body>
<h1 id="titulo"></h1>
<button id="escolher">Escolher a pasta</button>
<p id="nome"></p>
<script>
  fetch('api/titulo').then((r) => r.json()).then((j) => { document.getElementById('titulo').textContent = j.titulo; });
  document.getElementById('escolher').addEventListener('click', async () => {
    let texto;
    try {
      const pasta = await vssh.arquivos.escolherPasta('A pasta do projeto');
      texto = (await (await fetch('api/pasta?caminho=' + encodeURIComponent(pasta))).json()).nome;
    } catch (err) {
      texto = 'recusado: ' + err.message;
    }
    document.getElementById('nome').textContent = texto;
  });
</script>
</body></html>
`);
  escrever('ajuda/alvos.json', JSON.stringify({ escolher: { nome: 'Escolher a pasta' } }));
  escrever('ajuda/comecar.md', `---
id: comecar
titulo: A pasta do projeto
cobre: [janela]
---

A janela mostra o nome da pasta de projeto que você escolher.

\`\`\`passos
- A janela abre em [[Bancada da cena]]. {{Clique}} em [[Escolher a pasta]], e o nome dela aparece: [[Projetos de exemplo]].
  > clicar escolher
\`\`\`
`);
  if (palco) escrever('ajuda/palco.mjs', palco);
  return dir;
}

test('a cena do app prepara a HOME e os dados, e a ponte responde o que ela diz', { skip: pular }, async () => {
  const app = appDaCena();
  const saida = pasta('vssh-palco-');
  const r = await rodar(PALCO, [app, '--saida', saida]);
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.valores('FALTA'), [], r.saida);
  assert.deepEqual(r.valores('EVIDENCIA_FIGURAS'), ['1']);
  assert.deepEqual(r.valores('PONTE'), ['1']);

  const c = await rodar(COMPILAR, [app, '--palco', saida]);
  assert.deepEqual(c.valores('NIVEL'), ['4'], c.saida);
});

test('sem a cena, a ponte recusa a pasta e o passo diz o nome que faltou', { skip: pular }, async () => {
  const r = await rodar(PALCO, [appDaCena(null), '--saida', pasta('vssh-palco-')]);
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.valores('EVIDENCIA_FIGURAS'), ['0']);
  assert.ok(r.valores('FALTA').some((f) => f.includes('[[Projetos de exemplo]]')), r.saida);
  assert.ok(r.valores('FALTA').some((f) => f.includes('[[Bancada da cena]]')), r.saida);
});

test('uma regra da cena responde só o pedido cujos campos batem com o quando dela', { skip: pular }, async () => {
  const regras = `[
    { verbo: 'arquivos.escolherPasta', quando: { titulo: 'Outro título' }, valor: join(home, 'Outra') },
    { verbo: 'arquivos.escolherPasta', quando: { titulo: 'A pasta do projeto' }, valor: pasta },
  ]`;
  const app = appDaCena(CENA.replace("{ 'arquivos.escolherPasta': pasta }", regras));
  const r = await rodar(PALCO, [app, '--saida', pasta('vssh-palco-')]);
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.valores('FALTA'), [], r.saida);

  const fora = appDaCena(CENA.replace("{ 'arquivos.escolherPasta': pasta }", regras.replace("'A pasta do projeto'", "'Mais um título'")));
  const f = await rodar(PALCO, [fora, '--saida', pasta('vssh-palco-')]);
  assert.ok(f.valores('FALTA').some((x) => x.includes('[[Projetos de exemplo]]')), f.saida);
});

test('uma cena que responde um verbo que a ponte não tem interrompe o palco com o nome dele', { skip: pular }, async () => {
  const app = appDaCena(CENA.replace("'arquivos.escolherPasta'", "'arquivos.escolherPastinha'"));
  const r = await rodar(PALCO, [app, '--saida', pasta('vssh-palco-')]);
  assert.equal(r.code, 1, r.saida);
  assert.match(r.saida, /ajuda\/palco\.mjs responde arquivos\.escolherPastinha/);
});

// ─── O publish inteiro ───────────────────────────────────────────────────────

function tem(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const pularPublish = pular || (['bash', 'curl', 'python3'].find((c) => !tem(c)) ? 'sem bash, curl ou python3' : false);

/** @type {http.Server} */ let worker;
const recebidos = [];
before(async () => {
  if (pularPublish) return;
  worker = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      recebidos.push({ method: req.method, url: req.url, corpo: Buffer.concat(pedacos) });
      if (req.method === 'GET') { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, schemaConferido: true }));
    });
  });
  await new Promise((r) => worker.listen(0, '127.0.0.1', r));
});
after(async () => { if (worker) await new Promise((r) => worker.close(r)); });

test('o publish roda o palco, manda a ajuda no nível 4 e sobe as figuras depois dela', { skip: pularPublish }, async () => {
  const app = copiaDoTemplate();
  recebidos.length = 0;
  const r = await new Promise((resolve) => {
    const p = spawn('bash', [posix(PUBLISH), posix(app)], {
      env: { ...process.env, VSSH_REPO_API: `http://127.0.0.1:${worker.address().port}`, VSSH_REPO_PUBLISH_TOKEN: 'tok', GITHUB_ACTIONS: '' },
    });
    let saida = '';
    p.stdout.on('data', (c) => { saida += c; });
    p.stderr.on('data', (c) => { saida += c; });
    p.on('close', (code) => resolve({ code, saida }));
  });
  assert.equal(r.code, 0, r.saida);
  const posts = recebidos.filter((x) => x.method === 'POST').map((x) => x.url);
  const base = '/v1/publish/app/hello-world-node/5.0.0';
  assert.deepEqual(posts.slice(0, 2), ['/v1/publish/app', `${base}/ajuda`]);
  assert.deepEqual(posts.filter((u) => u.endsWith('.png')).sort(), [`${base}/ajuda/comecar-0-0.png`, `${base}/ajuda/comecar-0-1.png`]);
  const ajuda = JSON.parse(recebidos.find((x) => x.url === `${base}/ajuda`).corpo.toString('utf8'));
  assert.equal(ajuda.nivel, 4);
  const passos = ajuda.topicos[0].blocos.find((b) => b.t === 'passos');
  assert.equal(passos.itens[0].figuras.larga.id, 'comecar-0-0');
});
