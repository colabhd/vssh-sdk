'use strict';
// As notas de versão chegam ao Worker, e o aviso de schema não conferido chega a quem publica.
//
// Medido rodando o `vssh-app-publish` INTEIRO contra um Worker de mentira: um servidor HTTP que
// guarda os headers do `POST /v1/publish/app` e responde o que o caso pede. É a única bancada
// deste repositório que executa o script de ponta a ponta, e por isso ela também prova que o
// resto do caminho (materializar, validar, empacotar, sha256) continua fechando.
//
// Sem bash, python3 ou curl os testes se PULAM, como os vizinhos: o CI tem os três.

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'vssh-app-publish');
const posix = (p) => p.replace(/\\/g, '/');

function tem(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** O primeiro `python3`/`python` que responde `--version`, ou `null` (o mesmo de publish-validacao). */
function acharPython() {
  for (const exe of [process.env.VSSH_TEST_PYTHON, 'python3', 'python'].filter(Boolean)) {
    try {
      const v = execFileSync(exe, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (/^Python 3\./.test(v.trim())) return exe;
    } catch { /* próximo */ }
  }
  return null;
}
const PY = acharPython();
const falta = ['bash', 'curl'].filter((c) => !tem(c)).concat(PY ? [] : ['python3']);
const seNaoTem = { skip: falta.length ? `sem ${falta.join(', ')} no PATH` : false };

/**
 * Um diretório com um `python3` que é o Python achado acima, para ir na frente do PATH do script.
 *
 * No Windows, o `python3` que o PATH resolve pode ser o atalho da loja da Microsoft, que não
 * responde e segura o script para sempre; o shim garante que o script roda o mesmo interpretador
 * que o teste conferiu.
 */
function dirDoPython() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-py-'));
  const alvo = /[\\/]/.test(PY) ? PY : execFileSync(PY, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 'python3'), `#!/usr/bin/env bash\nexec "${posix(alvo)}" "$@"\n`, { mode: 0o755 });
  return dir;
}

/** @type {http.Server} */ let worker;
let repoApi;
const recebidos = [];
let respostaDoWorker = { ok: true, schemaConferido: true };

before(async () => {
  if (seNaoTem.skip) return;
  worker = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      recebidos.push({ method: req.method, url: req.url, headers: req.headers, bytes: Buffer.concat(pedacos).length });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify(respostaDoWorker, null, 2));
    });
  });
  await new Promise((r) => worker.listen(0, '127.0.0.1', r));
  repoApi = `http://127.0.0.1:${worker.address().port}`;
});
after(async () => { if (worker) await new Promise((r) => worker.close(r)); });

/** Um app mínimo num diretório temporário. */
function app() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-app-'));
  fs.writeFileSync(path.join(dir, 'vssh-app.json'), JSON.stringify({
    id: 'x', version: '1.0.0', backend: { runtime: 'node', entrypoint: 'b.js' },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'b.js'), '');
  return dir;
}

/**
 * Roda o script inteiro contra o Worker de mentira; devolve código e saída.
 *
 * Assíncrono de propósito: o Worker de mentira vive neste mesmo processo, e um `spawnSync`
 * seguraria o event loop enquanto o `curl` do script espera a resposta que só o event loop daria.
 */
function publicar(args, env = {}) {
  const dir = app();
  const py = dirDoPython();
  recebidos.length = 0;
  return new Promise((resolve) => {
    const p = spawn('bash', [posix(SCRIPT), posix(dir), ...args], {
      env: { ...process.env, PATH: `${py}${path.delimiter}${process.env.PATH}`, VSSH_REPO_API: repoApi, VSSH_REPO_PUBLISH_TOKEN: 'tok', ...env },
    });
    let saida = '';
    p.stdout.on('data', (c) => { saida += c; });
    p.stderr.on('data', (c) => { saida += c; });
    const relogio = setTimeout(() => p.kill(), 60_000);
    p.on('close', (code) => {
      clearTimeout(relogio);
      fs.rmSync(py, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, saida });
    });
  });
}

const decodificar = (b64) => Buffer.from(b64, 'base64').toString('utf8');

test('--notes viaja em base64 no X-Vssh-Notes, com as quebras de linha intactas', seNaoTem, async () => {
  const r = await publicar(['--notes', '## 1.0.0\n\n- primeira versão\n- com acento: versão']);
  assert.equal(r.code, 0, r.saida);
  const post = recebidos.find((p) => p.url === '/v1/publish/app');
  assert.ok(post, `o POST não chegou: ${r.saida}`);
  assert.equal(decodificar(post.headers['x-vssh-notes']), '## 1.0.0\n\n- primeira versão\n- com acento: versão');
  assert.equal(JSON.parse(decodificar(post.headers['x-vssh-manifest'])).id, 'x');
  assert.ok(post.bytes > 0, 'o tarball foi vazio');
});

test('--notes-file lê o arquivo; VSSH_RELEASE_NOTES é o caminho do CI', seNaoTem, async () => {
  const arquivo = path.join(os.tmpdir(), `notas-${process.pid}.md`);
  fs.writeFileSync(arquivo, 'do arquivo\n\n- item\n');
  try {
    let r = await publicar(['--notes-file', posix(arquivo)]);
    assert.equal(r.code, 0, r.saida);
    // O `$(cat …)` do bash tira as quebras de linha do FIM, e só elas; as do meio ficam.
    assert.equal(decodificar(recebidos[0].headers['x-vssh-notes']), 'do arquivo\n\n- item');

    r = await publicar([], { VSSH_RELEASE_NOTES: 'do ambiente' });
    assert.equal(r.code, 0, r.saida);
    assert.equal(decodificar(recebidos[0].headers['x-vssh-notes']), 'do ambiente');
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
});

test('sem notas o header não vai, e o Worker não recebe um base64 de nada', seNaoTem, async () => {
  const r = await publicar([]);
  assert.equal(r.code, 0, r.saida);
  assert.ok(!('x-vssh-notes' in recebidos[0].headers), 'X-Vssh-Notes foi sem notas');
});

test('o Worker dizendo que não conferiu o schema vira aviso de quem publica', seNaoTem, async () => {
  respostaDoWorker = { ok: true, schemaConferido: false };
  try {
    const r = await publicar([]);
    assert.equal(r.code, 0, r.saida);
    assert.match(r.saida, /Worker não conferiu o schema/);
  } finally {
    respostaDoWorker = { ok: true, schemaConferido: true };
  }
  const r = await publicar([]);
  assert.doesNotMatch(r.saida, /Worker não conferiu o schema/);
});
