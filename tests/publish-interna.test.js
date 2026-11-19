'use strict';
// A versão interna e as duas metades do `vssh-app-publish`, contra dois repositórios de mentira no
// papel dos sítios: empacotar carimba a interna uma vez, e enviar manda os mesmos bytes a cada
// repositório, depois de conferir a interna nele. Um repositório fora do ar reprova o envio com o
// nome dele e não desfaz o outro, e o mesmo lote completa a publicação quando ele volta.
//
// O repositório de mentira guarda as publicações de cada app e segue a regra da interna do
// `vssh-repo`: diz `internalVersion` no manifesto por app e na resposta do pacote, e recusa com 409
// a interna que não cresce. Com `conheceInterna: false` ele é um repositório anterior à regra.
//
// Sem bash, curl, python3 ou tar, os testes se pulam dizendo o que falta.

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const posix = (p) => p.replace(/\\/g, '/');

function tem(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const falta = ['bash', 'curl', 'python3', 'tar'].filter((c) => !tem(c));
if (!fs.existsSync(path.join(ROOT, 'api', 'vssh-app.schema.json'))) falta.push('api/vssh-app.schema.json (o canal do sistema ainda não o gerou)');
const seNaoTem = { skip: falta.length ? `sem ${falta.join(', ')}` : false };

const temporarios = [];
const pasta = (prefixo) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo)); temporarios.push(d); return d; };
const abertos = [];
after(async () => {
  for (const s of abertos) await new Promise((r) => { s.closeAllConnections(); s.close(r); });
  for (const d of temporarios) fs.rmSync(d, { recursive: true, force: true });
});

/** Um repositório de mentira. `recebidos` são os pedidos, e `publicacoes` o que ele guarda. */
async function repositorio({ conheceInterna = true } = {}) {
  const recebidos = [];
  const publicacoes = [];
  const servidor = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      const corpo = Buffer.concat(pedacos);
      recebidos.push({ method: req.method, url: req.url, headers: req.headers, corpo });
      const responder = (status, objeto) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(objeto)); };
      const manifesto = /^\/v1\/apps\/([a-z0-9-]+)\/manifest\.json$/.exec(req.url);
      if (req.method === 'GET' && manifesto) {
        const doApp = publicacoes.filter((p) => p.id === manifesto[1]).sort((a, b) => b.interna - a.interna);
        if (!doApp.length) return responder(404, { error: 'App não encontrado.' });
        const entrada = (p) => ({ version: p.version, ...(conheceInterna ? { internalVersion: p.interna } : {}) });
        return responder(200, { kind: 'app', id: manifesto[1], latest: entrada(doApp[0]), history: doApp.slice(1).map(entrada) });
      }
      if (req.method === 'POST' && req.url === '/v1/publish/app') {
        const id = req.headers['x-vssh-app-id'];
        const interna = Number(req.headers['x-vssh-internal-version']);
        const maisAlta = Math.max(0, ...publicacoes.filter((p) => p.id === id).map((p) => p.interna));
        if (conheceInterna && interna <= maisAlta) return responder(409, { error: 'A versão interna não cresce.', highestInternalVersion: maisAlta });
        publicacoes.push({ id, version: req.headers['x-vssh-version'], interna, sha256: crypto.createHash('sha256').update(corpo).digest('hex') });
        return responder(201, { ok: true, schemaConferido: true, ...(conheceInterna ? { internalVersion: interna } : {}) });
      }
      return responder(201, { ok: true });
    });
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  abertos.push(servidor);
  const porta = servidor.address().port;
  return {
    api: `http://127.0.0.1:${porta}`, recebidos, publicacoes,
    posts: () => recebidos.filter((r) => r.method === 'POST').map((r) => r.url),
    pacote: () => recebidos.filter((r) => r.url === '/v1/publish/app').at(-1),
    /** Tira o repositório do ar; `voltar()` o põe de pé na mesma porta, com o que ele guardava. */
    async cair() { await new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }); },
    async voltar() { await new Promise((r) => servidor.listen(porta, '127.0.0.1', r)); },
  };
}

const MANIFESTO = { id: 'storytold', name: 'Storytold', version: '2.0.0', icon: 'icon.svg', backend: { runtime: 'node', entrypoint: 'b.js' } };

/** A pasta de um app de bancada, com o manifesto dado. */
function app(manifesto = MANIFESTO) {
  const dir = pasta('vssh-app-');
  fs.writeFileSync(path.join(dir, 'vssh-app.json'), JSON.stringify(manifesto, null, 2));
  fs.writeFileSync(path.join(dir, 'b.js'), '');
  fs.writeFileSync(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>');
  return dir;
}

/** Roda o `vssh-app-publish` (o de `raiz`) com os argumentos dados; devolve o código e a saída. */
function publish(args, { env = {}, raiz = ROOT } = {}) {
  return new Promise((resolve) => {
    const p = spawn('bash', [posix(path.join(raiz, 'scripts', 'vssh-app-publish')), ...args.map(posix)], {
      env: { ...process.env, VSSH_REPO_PUBLISH_TOKEN: 'tok', GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '', VSSH_INTERNAL_VERSION: '', VSSH_SITIO: '', VSSH_REPO_API: '', ...env },
    });
    let saida = '';
    p.stdout.on('data', (c) => { saida += c; });
    p.stderr.on('data', (c) => { saida += c; });
    const relogio = setTimeout(() => p.kill(), 90_000);
    p.on('close', (code) => { clearTimeout(relogio); resolve({ code, saida }); });
  });
}

const doLote = (lote) => Object.fromEntries(fs.readFileSync(path.join(lote, 'lote.txt'), 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const internaDeAgora = () => Number(new Date().toISOString().replace(/\D/g, '').slice(0, 14));

/** O `vssh-app.json` de dentro de um pacote. */
function manifestoDoPacote(corpo) {
  const dir = pasta('pacote-');
  fs.writeFileSync(path.join(dir, 'app.tar.gz'), corpo);
  execFileSync('tar', ['-xzf', 'app.tar.gz'], { cwd: dir });
  return JSON.parse(fs.readFileSync(path.join(dir, 'vssh-app.json'), 'utf8'));
}

/** Uma cópia de `scripts/` e `api/` em que o schema declara, ou não, o campo `internalVersion`. */
function sdkComSchema(declara) {
  const raiz = pasta('vssh-sdk-');
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(raiz, 'scripts'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'api'), path.join(raiz, 'api'), { recursive: true });
  const arquivo = path.join(raiz, 'api', 'vssh-app.schema.json');
  const schema = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (declara) schema.properties.internalVersion = { type: 'integer', minimum: 20000101000000, maximum: 99991231235959 };
  else delete schema.properties.internalVersion;
  fs.writeFileSync(arquivo, JSON.stringify(schema));
  return raiz;
}

test('empacotar carimba a interna uma vez, e os dois sítios recebem os mesmos bytes e a mesma interna', seNaoTem, async () => {
  const franca = await repositorio();
  const sp = await repositorio();
  const lote = path.join(pasta('lote-'), 'lote');

  const antes = internaDeAgora();
  const empacotado = await publish([app(), '--empacotar', lote, '--repo-api', franca.api], { env: { VSSH_REPO_PUBLISH_TOKEN: '' } });
  assert.equal(empacotado.code, 0, empacotado.saida);
  assert.deepEqual(franca.posts(), [], 'empacotar não escreve no repositório');
  const dito = doLote(lote);
  assert.match(dito.INTERNA, /^\d{14}$/);
  assert.ok(Number(dito.INTERNA) >= antes && Number(dito.INTERNA) <= internaDeAgora(), `a interna ${dito.INTERNA} é a hora de empacotar`);
  assert.deepEqual([dito.APP_ID, dito.VERSION, dito.ICONE], ['storytold', '2.0.0', 'icone.svg']);

  for (const [nome, sitio] of [['franca', franca], ['sp', sp]]) {
    const enviado = await publish(['--enviar', lote, '--repo-api', sitio.api, '--sitio', nome]);
    assert.equal(enviado.code, 0, enviado.saida);
    assert.match(enviado.saida, new RegExp(`storytold@2\\.0\\.0 publicado em ${nome}\\.`));
  }

  const [pf, ps] = [franca.pacote(), sp.pacote()];
  assert.equal(pf.headers['x-vssh-internal-version'], dito.INTERNA);
  assert.equal(ps.headers['x-vssh-internal-version'], dito.INTERNA);
  assert.ok(pf.corpo.equals(ps.corpo), 'os dois sítios receberam pacotes diferentes');
  assert.equal(pf.headers['x-vssh-sha256'], dito.SHA256);
  assert.deepEqual(franca.publicacoes.map((p) => p.sha256), sp.publicacoes.map((p) => p.sha256));
  // O ícone vai para a publicação nomeada pela interna.
  assert.deepEqual(franca.posts(), ['/v1/publish/app', `/v1/publish/app/storytold/2.0.0/icon?i=${dito.INTERNA}`]);
  assert.deepEqual(sp.posts(), franca.posts());
});

test('um sítio fora do ar reprova o envio com o nome dele, não desfaz o outro, e o mesmo lote o completa quando ele volta', seNaoTem, async () => {
  const franca = await repositorio();
  const sp = await repositorio();
  const lote = path.join(pasta('lote-'), 'lote');
  assert.equal((await publish([app(), '--empacotar', lote, '--repo-api', franca.api])).code, 0);
  const { INTERNA } = doLote(lote);

  await sp.cair();
  assert.equal((await publish(['--enviar', lote, '--repo-api', franca.api, '--sitio', 'franca'])).code, 0);
  const falhou = await publish(['--enviar', lote, '--repo-api', sp.api, '--sitio', 'sp']);
  assert.equal(falhou.code, 1, falhou.saida);
  assert.match(falhou.saida, /o repositório sp não respondeu à conferência de storytold/);
  assert.match(falhou.saida, new RegExp(`com a interna ${INTERNA}`));
  assert.deepEqual(franca.publicacoes.map((p) => p.interna), [Number(INTERNA)], 'Franca ficou com a publicação');

  await sp.voltar();
  const completou = await publish(['--enviar', lote, '--repo-api', sp.api, '--sitio', 'sp']);
  assert.equal(completou.code, 0, completou.saida);
  assert.deepEqual(sp.publicacoes.map((p) => [p.interna, p.sha256]), franca.publicacoes.map((p) => [p.interna, p.sha256]));
});

test('o repositório que já tem a interna do lote não recebe o pacote de novo, e o ícone vai de novo', seNaoTem, async () => {
  const franca = await repositorio();
  const lote = path.join(pasta('lote-'), 'lote');
  assert.equal((await publish([app(), '--empacotar', lote, '--repo-api', franca.api])).code, 0);
  assert.equal((await publish(['--enviar', lote, '--repo-api', franca.api])).code, 0);
  const { INTERNA } = doLote(lote);

  franca.recebidos.length = 0;
  const deNovo = await publish(['--enviar', lote, '--repo-api', franca.api, '--sitio', 'franca']);
  assert.equal(deNovo.code, 0, deNovo.saida);
  assert.match(deNovo.saida, new RegExp(`franca já tem storytold na interna ${INTERNA}`));
  assert.deepEqual(franca.posts(), [`/v1/publish/app/storytold/2.0.0/icon?i=${INTERNA}`]);
  assert.equal(franca.publicacoes.length, 1);
});

test('o repositório com uma interna mais alta recusa o lote antes de qualquer envio', seNaoTem, async () => {
  const franca = await repositorio();
  franca.publicacoes.push({ id: 'storytold', version: '2.1.0', interna: 20991231235959 });
  const r = await publish([app(), '--repo-api', franca.api, '--sitio', 'franca']);
  assert.equal(r.code, 1, r.saida);
  assert.match(r.saida, /franca tem storytold numa versão interna mais alta \(20991231235959\)/);
  assert.deepEqual(franca.posts(), []);
});

test('--internal-version é a interna da publicação, e uma que não é AAAAMMDDhhmmss é recusada', seNaoTem, async () => {
  const franca = await repositorio();
  const r = await publish([app(), '--repo-api', franca.api, '--internal-version', '20261120101500']);
  assert.equal(r.code, 0, r.saida);
  assert.equal(franca.pacote().headers['x-vssh-internal-version'], '20261120101500');

  const peloAmbiente = await publish([app({ ...MANIFESTO, id: 'outro' }), '--repo-api', franca.api], { env: { VSSH_INTERNAL_VERSION: '20261120101600' } });
  assert.equal(peloAmbiente.code, 0, peloAmbiente.saida);
  assert.equal(franca.pacote().headers['x-vssh-internal-version'], '20261120101600');

  franca.recebidos.length = 0;
  const torta = await publish([app(), '--repo-api', franca.api, '--internal-version', '2026-11-20']);
  assert.equal(torta.code, 1, torta.saida);
  assert.match(torta.saida, /14 algarismos/);
  assert.deepEqual(franca.recebidos, []);
});

test('o manifesto do pacote leva a interna quando o schema a declara, e o do autor não pode trazê-la', seNaoTem, async () => {
  const franca = await repositorio();

  const comCampo = sdkComSchema(true);
  const carimbado = await publish([app(), '--repo-api', franca.api, '--internal-version', '20261120101500'], { raiz: comCampo });
  assert.equal(carimbado.code, 0, carimbado.saida);
  assert.equal(manifestoDoPacote(franca.pacote().corpo).internalVersion, 20261120101500);
  assert.equal(JSON.parse(Buffer.from(franca.pacote().headers['x-vssh-manifest'], 'base64').toString('utf8')).internalVersion, 20261120101500);

  const doAutor = await publish([app({ ...MANIFESTO, internalVersion: 20200101000000 }), '--repo-api', franca.api], { raiz: comCampo });
  assert.equal(doAutor.code, 1, doAutor.saida);
  assert.match(doAutor.saida, /internalVersion_no_manifesto_de_origem/);

  // Com um schema que ainda não declara o campo, o manifesto sai sem ele, a interna vai no header,
  // e o publish diz isso.
  const semCampo = sdkComSchema(false);
  const sp = await repositorio();
  const semCarimbo = await publish([app(), '--repo-api', sp.api, '--internal-version', '20261120101500'], { raiz: semCampo });
  assert.equal(semCarimbo.code, 0, semCarimbo.saida);
  assert.ok(!('internalVersion' in manifestoDoPacote(sp.pacote().corpo)));
  assert.equal(sp.pacote().headers['x-vssh-internal-version'], '20261120101500');
  assert.match(semCarimbo.saida, /interna fora do manifesto/);
});

test('um repositório anterior à interna recebe o pacote como sempre, sem o ?i= nas rotas seguintes', seNaoTem, async () => {
  const antigo = await repositorio({ conheceInterna: false });
  antigo.publicacoes.push({ id: 'storytold', version: '1.9.0', interna: 0 });
  const r = await publish([app(), '--repo-api', antigo.api]);
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(antigo.posts(), ['/v1/publish/app', '/v1/publish/app/storytold/2.0.0/icon']);
});

test('um lote com o pacote trocado é recusado antes de qualquer pedido', seNaoTem, async () => {
  const franca = await repositorio();
  const lote = path.join(pasta('lote-'), 'lote');
  assert.equal((await publish([app(), '--empacotar', lote, '--repo-api', franca.api])).code, 0);
  fs.appendFileSync(path.join(lote, 'app.tar.gz'), 'x');
  franca.recebidos.length = 0;
  const r = await publish(['--enviar', lote, '--repo-api', franca.api]);
  assert.equal(r.code, 1, r.saida);
  assert.match(r.saida, /não tem o sha256 que o lote\.txt diz/);
  assert.deepEqual(franca.recebidos, []);
});
