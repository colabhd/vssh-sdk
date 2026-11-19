'use strict';
// O ícone em camadas pelo `vssh-app-publish` inteiro, contra um Worker de mentira: o `icon.svg` que
// o pacote não traz sai montado pelo compositor do portal, viaja no pacote e vai ao repositório
// como o ícone da versão; uma camada que falta recusa a publicação antes de qualquer POST; um
// `icon` que o app traz fica como ele é; e um glifo fora da grade vira aviso, com a caixa medida.
// O ladrilho da Loja sai das mesmas camadas e vai ao repositório depois do ícone, fora do pacote; um
// repositório que não o guarda e um app sem camadas viram aviso, e a publicação segue.
//
// O compositor é o de `api/icone/`, e o schema com o campo `icone` é o de `api/`, os dois gerados
// pelo canal do sistema. Sem eles, ou sem bash, curl, python3, tar ou um Node que importe
// TypeScript, os testes se pulam dizendo o que falta. O caso da grade pede um Chrome.

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { caminhoDoNavegador } = require('../scripts/navegador.cjs');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'vssh-app-publish');
const posix = (p) => p.replace(/\\/g, '/');

function tem(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function schemaTemIcone() {
  try { return !!JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'vssh-app.schema.json'), 'utf8')).properties.icone; } catch { return false; }
}
const falta = ['bash', 'curl', 'python3', 'tar'].filter((c) => !tem(c));
if (!fs.existsSync(path.join(ROOT, 'api', 'icone', 'composicao-de-icone.ts'))) falta.push('api/icone/ (o canal do sistema ainda não a gerou)');
if (!schemaTemIcone()) falta.push('o campo icone em api/vssh-app.schema.json (o canal do sistema ainda não o publicou)');
if (!process.features.typescript) falta.push(`um Node que importe TypeScript (este é o ${process.version})`);
const seNaoTem = { skip: falta.length ? `sem ${falta.join(', ')}` : false };
const seNaoTemChrome = { skip: seNaoTem.skip || (caminhoDoNavegador() ? false : 'sem Chrome para medir o glifo') };

/** @type {http.Server} */ let worker;
let repoApi;
const recebidos = [];
/** Os endereços que o Worker de mentira recusa com 404, como um Worker anterior à rota. */
let semRota = null;

before(async () => {
  if (seNaoTem.skip) return;
  worker = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      recebidos.push({ method: req.method, url: req.url, headers: req.headers, corpo: Buffer.concat(pedacos) });
      if (semRota && semRota.test(req.url)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rota não encontrada' }));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, schemaConferido: true }));
    });
  });
  await new Promise((r) => worker.listen(0, '127.0.0.1', r));
  repoApi = `http://127.0.0.1:${worker.address().port}`;
});
after(async () => { if (worker) await new Promise((r) => worker.close(r)); });

const MANIFESTO = {
  id: 'exemplo', name: 'Exemplo', version: '1.0.0', icon: 'icon.svg',
  icone: { glifo: 'icone/glifo.svg' },
  backend: { runtime: 'node', entrypoint: 'b.js' },
};
const GLIFO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="20" y="20" width="24" height="24" fill="#ff8000"/></svg>';

/** Publica um app com o manifesto e os arquivos dados; devolve o código, a saída e o pacote enviado. */
function publicar({ manifesto = MANIFESTO, arquivos = { 'icone/glifo.svg': GLIFO } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-app-'));
  fs.writeFileSync(path.join(dir, 'vssh-app.json'), JSON.stringify(manifesto, null, 2));
  fs.writeFileSync(path.join(dir, 'b.js'), '');
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, nome)), { recursive: true });
    fs.writeFileSync(path.join(dir, nome), conteudo);
  }
  recebidos.length = 0;
  return new Promise((resolve) => {
    const p = spawn('bash', [posix(SCRIPT), posix(dir)], {
      env: { ...process.env, VSSH_REPO_API: repoApi, VSSH_REPO_PUBLISH_TOKEN: 'tok', GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '' },
    });
    let saida = '';
    p.stdout.on('data', (c) => { saida += c; });
    p.stderr.on('data', (c) => { saida += c; });
    const relogio = setTimeout(() => p.kill(), 90_000);
    p.on('close', (code) => {
      clearTimeout(relogio);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, saida });
    });
  });
}

const posts = () => recebidos.filter((r) => r.method === 'POST').map((r) => r.url);

/** Um arquivo de dentro do tarball que o Worker recebeu, ou `null`. */
function doPacote(nome) {
  const pacote = recebidos.find((r) => r.url === '/v1/publish/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacote-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.tar.gz'), pacote.corpo);
    execFileSync('tar', ['-xzf', 'app.tar.gz'], { cwd: dir });
    const alvo = path.join(dir, nome);
    return fs.existsSync(alvo) ? fs.readFileSync(alvo, 'utf8') : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('o icon que o pacote não traz sai montado das camadas, no pacote e no repositório', seNaoTem, async () => {
  const r = await publicar();
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(posts(), ['/v1/publish/app', '/v1/publish/app/exemplo/1.0.0/icon', '/v1/publish/app/exemplo/1.0.0/ladrilho']);
  const icone = recebidos.find((p) => p.url.endsWith('/icon')).corpo.toString('utf8');
  assert.ok(icone.includes(`data:image/svg+xml;base64,${Buffer.from(GLIFO).toString('base64')}`), 'o glifo não está no ícone montado');
  assert.ok(icone.includes('fill="#15171c"'), 'o ícone montado não tem o fundo da família');
  assert.equal(doPacote('icon.svg'), icone, 'o pacote não leva o mesmo icon.svg que foi ao repositório');
});

test('uma camada que não está no pacote recusa a publicação antes de qualquer POST', seNaoTem, async () => {
  const r = await publicar({ arquivos: {} });
  assert.equal(r.code, 1, r.saida);
  assert.deepEqual(posts(), []);
  assert.match(r.saida, /icone\.glifo aponta icone\/glifo\.svg, que não está no pacote/);
});

test('um icon que o app traz fica como ele é', seNaoTem, async () => {
  const proprio = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#4f8cff"/></svg>';
  const r = await publicar({ arquivos: { 'icone/glifo.svg': GLIFO, 'icon.svg': proprio } });
  assert.equal(r.code, 0, r.saida);
  assert.equal(recebidos.find((p) => p.url.endsWith('/icon')).corpo.toString('utf8'), proprio);
  assert.equal(doPacote('icon.svg'), proprio);
});

test('um glifo fora da área viva vira aviso, com a caixa medida, e a publicação segue', seNaoTemChrome, async () => {
  const grande = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" fill="#ff8000"/></svg>';
  const r = await publicar({ arquivos: { 'icone/glifo.svg': grande } });
  assert.equal(r.code, 0, r.saida);
  assert.match(r.saida, /ícone fora da grade: o glifo vai de 2\.0,2\.0 a 62\.0,62\.0/);
});

test('o ladrilho sai das camadas do app e vai ao repositório, fora do pacote', seNaoTem, async () => {
  const r = await publicar({ manifesto: { ...MANIFESTO, icone: { glifo: 'icone/glifo.svg', fundo: '#123456' } } });
  assert.equal(r.code, 0, r.saida);
  const pedido = recebidos.find((p) => p.url === '/v1/publish/app/exemplo/1.0.0/ladrilho');
  assert.ok(pedido, `o ladrilho não foi ao repositório: ${posts().join(' ')}`);
  assert.equal(pedido.headers['x-vssh-content-type'], 'image/svg+xml');
  assert.equal(pedido.headers.authorization, 'Bearer tok');
  const ladrilho = pedido.corpo.toString('utf8');
  assert.ok(ladrilho.includes(`data:image/svg+xml;base64,${Buffer.from(GLIFO).toString('base64')}`), 'o glifo não está no ladrilho');
  assert.ok(ladrilho.includes('fill="#123456"'), 'o ladrilho não tem o fundo que o app declarou');
  const icone = recebidos.find((p) => p.url.endsWith('/icon')).corpo.toString('utf8');
  assert.notEqual(ladrilho, icone, 'o ladrilho que foi ao repositório é o ícone de 64');
  const pacote = recebidos.find((p) => p.url === '/v1/publish/app').corpo;
  const lista = execFileSync('tar', ['-tzf', '-'], { input: pacote, encoding: 'utf8' });
  assert.ok(!/ladrilho/.test(lista), `o pacote leva o ladrilho: ${lista}`);
});

test('um repositório que não guarda o ladrilho vira aviso, e o app fica publicado', seNaoTem, async (t) => {
  semRota = /\/ladrilho$/;
  t.after(() => { semRota = null; });
  const r = await publicar();
  assert.equal(r.code, 0, r.saida);
  assert.match(r.saida, /ladrilho não guardado: O repositório respondeu 404 ao ladrilho de exemplo@1\.0\.0/);
  assert.match(r.saida, /exemplo@1\.0\.0 publicado/);
});

test('um app com janela sem icone é publicado com aviso, e um motor não é avisado', seNaoTem, async () => {
  const pronto = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#4f8cff"/></svg>';
  const { icone: _camadas, ...semCamadas } = MANIFESTO;
  const app = await publicar({ manifesto: semCamadas, arquivos: { 'icon.svg': pronto } });
  assert.equal(app.code, 0, app.saida);
  assert.match(app.saida, /app sem ícone em camadas: O vssh-app\.json não declara icone/);
  assert.deepEqual(posts(), ['/v1/publish/app', '/v1/publish/app/exemplo/1.0.0/icon']);

  const motor = await publicar({ manifesto: { ...semCamadas, type: 'engine' }, arquivos: { 'icon.svg': pronto } });
  assert.equal(motor.code, 0, motor.saida);
  assert.doesNotMatch(motor.saida, /app sem ícone em camadas/);
});
