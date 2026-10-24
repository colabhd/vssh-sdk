'use strict';
// A ajuda de um app pelo `vssh-app-publish` inteiro, contra um Worker de mentira: o `ajuda.json`
// chega ao repositório depois do pacote e com o sha256 conferível, a ajuda que não compila recusa a
// publicação antes de qualquer POST, a regra dos oficiais lê o que o repositório guardou, e o nível
// vai para o resumo do run.
//
// O compilador é o de `api/ajuda/`, que o canal do sistema gera. Sem ele, ou sem bash, curl,
// python3 ou um Node que importe TypeScript, os testes se pulam dizendo o que falta.

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'vssh-app-publish');
const AMBIENTE = path.join(ROOT, 'api', 'ajuda', 'ambiente.json');
const posix = (p) => p.replace(/\\/g, '/');

function tem(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const falta = ['bash', 'curl', 'python3'].filter((c) => !tem(c));
if (!fs.existsSync(AMBIENTE)) falta.push('api/ajuda/ (o canal do sistema ainda não a gerou)');
if (!process.features.typescript) falta.push(`um Node que importe TypeScript (este é o ${process.version})`);
const seNaoTem = { skip: falta.length ? `sem ${falta.join(', ')}` : false };

/** @type {http.Server} */ let worker;
let repoApi;
const recebidos = [];
/** O que o Worker responde, por caso: a rota da ajuda e o manifesto publicado do app. */
let resposta = {};

before(async () => {
  if (seNaoTem.skip) return;
  worker = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      const corpo = Buffer.concat(pedacos);
      recebidos.push({ method: req.method, url: req.url, headers: req.headers, corpo });
      const responder = (status, dados) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(dados));
      };
      if (req.method === 'GET' && req.url.endsWith('/manifest.json')) {
        return resposta.publicado ? responder(200, resposta.publicado) : responder(404, { error: 'App não encontrado.' });
      }
      if (req.url.endsWith('/ajuda')) return responder(resposta.ajuda || 201, { ok: (resposta.ajuda || 201) === 201 });
      return responder(201, { ok: true, schemaConferido: true });
    });
  });
  await new Promise((r) => worker.listen(0, '127.0.0.1', r));
  repoApi = `http://127.0.0.1:${worker.address().port}`;
});
after(async () => { if (worker) await new Promise((r) => worker.close(r)); });

const MANIFESTO = {
  id: 'exemplo', name: 'Exemplo', version: '1.0.0',
  backend: { runtime: 'node', entrypoint: 'b.js' },
  secrets: [{ name: 'CHAVE_DA_API', description: 'A chave do serviço.' }],
  contributes: { ajuda: { pasta: 'ajuda', inicio: 'comecar' } },
};
const TOPICO = '---\nid: comecar\ntitulo: Começar\ncobre: [janela]\n---\n\nO que a janela mostra.\n';

/**
 * Publica um app com o manifesto e o tópico dados; devolve o código, a saída e o resumo do run.
 * Assíncrono pelo mesmo motivo do `publish-notas`: o Worker de mentira vive neste processo.
 */
function publicar({ manifesto = MANIFESTO, topico = TOPICO } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-app-'));
  fs.writeFileSync(path.join(dir, 'vssh-app.json'), JSON.stringify(manifesto, null, 2));
  fs.writeFileSync(path.join(dir, 'b.js'), '');
  fs.mkdirSync(path.join(dir, 'ajuda'));
  fs.writeFileSync(path.join(dir, 'ajuda', 'comecar.md'), topico);
  const resumo = path.join(dir, '..', `${path.basename(dir)}-resumo.md`);
  recebidos.length = 0;
  return new Promise((resolve) => {
    const p = spawn('bash', [posix(SCRIPT), posix(dir)], {
      env: { ...process.env, VSSH_REPO_API: repoApi, VSSH_REPO_PUBLISH_TOKEN: 'tok', GITHUB_STEP_SUMMARY: resumo },
    });
    let saida = '';
    p.stdout.on('data', (c) => { saida += c; });
    p.stderr.on('data', (c) => { saida += c; });
    const relogio = setTimeout(() => p.kill(), 60_000);
    p.on('close', (code) => {
      clearTimeout(relogio);
      const doResumo = fs.existsSync(resumo) ? fs.readFileSync(resumo, 'utf8') : '';
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(resumo, { force: true });
      resolve({ code, saida, resumo: doResumo });
    });
  });
}

const posts = () => recebidos.filter((r) => r.method === 'POST').map((r) => r.url);

test('o ajuda.json vai ao repositório depois do pacote, com o sha256, e o nível vai ao resumo', seNaoTem, async () => {
  const r = await publicar();
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(posts(), ['/v1/publish/app', '/v1/publish/app/exemplo/1.0.0/ajuda']);
  const ajuda = recebidos.find((p) => p.url.endsWith('/ajuda'));
  assert.equal(ajuda.headers['x-vssh-sha256'], crypto.createHash('sha256').update(ajuda.corpo).digest('hex'));
  const json = JSON.parse(ajuda.corpo.toString('utf8'));
  assert.equal(json.app, 'exemplo');
  assert.equal(json.nivel, 1);
  assert.match(r.resumo, /Nível 1 de 4/);
  assert.match(r.resumo, /^- a senha CHAVE_DA_API$/m);
});

test('a ajuda que não compila recusa a publicação antes de qualquer POST', seNaoTem, async () => {
  const r = await publicar({ topico: TOPICO.replace('O que a janela mostra.', 'Veja {{t:ambiente/nao-existe|isto}}.') });
  assert.equal(r.code, 1, r.saida);
  assert.deepEqual(posts(), []);
  assert.match(r.saida, /ajuda\/comecar\.md:\d+: .*nao-existe/);
});

test('um app oficial que já publicou com cobertura total não publica abaixo dela', seNaoTem, async () => {
  const oficial = { ...MANIFESTO, developer: { name: 'colabhd' } };
  resposta = { publicado: { latest: { version: '0.9.0', ajudaNivel: 2 }, history: [{ version: '0.8.0', ajudaNivel: 3 }] } };
  try {
    const r = await publicar({ manifesto: oficial });
    assert.equal(r.code, 1, r.saida);
    assert.deepEqual(posts(), []);
    assert.match(r.saida, /cobertura total \(nível 3\)/);
  } finally {
    resposta = {};
  }
  // Antes de alguma versão chegar lá, o oficial publica, e o resumo diz o que falta.
  const r = await publicar({ manifesto: oficial });
  assert.equal(r.code, 0, r.saida);
  assert.match(r.resumo, /App oficial: a cobertura total é o nível 3/);
});

test('o repositório recusando a ajuda é aviso: o pacote já foi publicado', seNaoTem, async () => {
  resposta = { ajuda: 404 };
  try {
    const r = await publicar();
    assert.equal(r.code, 0, r.saida);
    assert.match(r.saida, /ajuda não guardada: O repositório respondeu 404/);
  } finally {
    resposta = {};
  }
});

test('o travessão num texto do manifesto é aviso com o caminho do campo', seNaoTem, async () => {
  const comTravessao = { ...MANIFESTO, secrets: [{ name: 'CHAVE_DA_API', description: 'A chave — do serviço.' }] };
  const r = await publicar({ manifesto: comTravessao });
  assert.equal(r.code, 0, r.saida);
  assert.match(r.saida, /travessão no manifesto: secrets\[0\]\.description tem travessão/);
});
