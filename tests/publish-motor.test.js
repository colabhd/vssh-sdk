'use strict';

// O `vssh-motor-publish`, rodado de verdade contra um vssh-repo e um R2 de mentira.
//
// O R2 é um `aws` falso no PATH: ele guarda os argumentos e copia o arquivo para um "bucket" numa
// pasta, que é o que se confere de volta (a chave, o endpoint da conta, os bytes). O vssh-repo é
// um servidor HTTP deste processo, que guarda os cabeçalhos do registro e responde o que o caso
// pedir. O manifesto é o arquivo de um app de mentira, lido depois da publicação.
//
// Assíncrono de propósito: o vssh-repo é um servidor deste processo, e um exec síncrono calaria o
// event loop com o `curl` do script esperando por ele.

const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'vssh-motor-publish');

function temFerramentas() {
  try { execFileSync('bash', ['-c', 'command -v python3 && command -v curl && command -v sha256sum'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const pular = { skip: temFerramentas() ? false : 'sem bash, python3, curl ou sha256sum' };

async function repo(status = 201) {
  const registros = [];
  const servidor = http.createServer((req, res) => {
    registros.push({ metodo: req.method, url: req.url, cabecalhos: req.headers });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(status === 201 ? { ok: true } : { error: 'O blob não está no R2.' }));
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${servidor.address().port}`, registros, fechar: () => new Promise((r) => servidor.close(r)) };
}

function bancada(manifesto) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-motor-pub-'));
  const b = { raiz, app: path.join(raiz, 'app'), bin: path.join(raiz, 'bin'), bucket: path.join(raiz, 'bucket') };
  for (const d of [b.app, b.bin, b.bucket]) fs.mkdirSync(d, { recursive: true });
  // Quatro espaços de recuo: o script devolve o arquivo com o recuo que ele tinha.
  fs.writeFileSync(path.join(b.app, 'vssh-app.json'), JSON.stringify(manifesto, null, 4) + '\n');
  b.tarball = path.join(raiz, 'runtime.tar.gz');
  fs.writeFileSync(b.tarball, crypto.randomBytes(4096));
  fs.writeFileSync(path.join(b.bin, 'aws'), `#!/bin/bash
printf '%s\\n' "$@" > "${b.bucket}/argumentos"
printf '%s' "$AWS_ACCESS_KEY_ID" > "${b.bucket}/chave"
# aws s3 cp <arquivo> s3://<bucket>/<chave> --endpoint-url … --content-type …
destino="\${4#s3://}"
mkdir -p "${b.bucket}/$(dirname "$destino")"
cp "$3" "${b.bucket}/$destino"
`, { mode: 0o755 });
  return b;
}

function publicar(b, base, args, ambiente = {}) {
  return new Promise((resolve) => {
    execFile('bash', [SCRIPT, b.app, ...args], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: `${b.bin}:${process.env.PATH}`, VSSH_REPO_API: base, R2_ACCOUNT_ID: 'conta123',
        R2_ACCESS_KEY_ID: 'chave-do-bucket', R2_SECRET_ACCESS_KEY: 'segredo', VSSH_REPO_MOTOR_TOKEN: 'tok', GITHUB_SHA: 'abc',
        ...ambiente },
    }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, saida: String(stdout) + String(stderr) }));
  });
}

const APP = {
  id: 'escriba', name: 'Escriba', version: '5.0.0',
  motores: [
    { nome: 'modelos', versao: '3', url: 'https://x/v1/motor/escriba-modelos/3', sha256: 'a'.repeat(64), tamanho: 10 },
    { nome: 'runtime', versao: '1.0', url: 'https://x/v1/motor/escriba-runtime/1.0', sha256: 'b'.repeat(64), tamanho: 20,
      confere: 'bin/python' },
  ],
  backend: { runtime: 'python3', entrypoint: 'backend/main.py' },
};

test('sobe ao R2, registra no vssh-repo e troca o pino do motor no lugar', pular, async () => {
  const r = await repo();
  try {
    const b = bancada(APP);
    const s = await publicar(b, r.base, ['--nome', 'runtime', '--versao', '1.1', '--arquivo', b.tarball]);
    assert.equal(s.code, 0, s.saida);
    const bytes = fs.readFileSync(b.tarball);
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');

    const chave = 'motor/escriba-runtime/1.1/motor.tar.gz';
    assert.deepEqual(fs.readFileSync(path.join(b.bucket, 'vssh-repo-blobs', chave)), bytes);
    const args = fs.readFileSync(path.join(b.bucket, 'argumentos'), 'utf8').split('\n');
    assert.equal(args[args.indexOf('--endpoint-url') + 1], 'https://conta123.r2.cloudflarestorage.com');
    assert.equal(fs.readFileSync(path.join(b.bucket, 'chave'), 'utf8'), 'chave-do-bucket');

    assert.equal(r.registros.length, 1);
    const h = r.registros[0].cabecalhos;
    assert.equal(r.registros[0].url, '/v1/publish/motor');
    assert.deepEqual([h['x-vssh-name'], h['x-vssh-version'], h['x-vssh-sha256'], h['x-vssh-size'], h['x-vssh-r2-key']],
      ['escriba-runtime', '1.1', sha, String(bytes.length), chave]);
    assert.equal(h.authorization, 'Bearer tok');

    const texto = fs.readFileSync(path.join(b.app, 'vssh-app.json'), 'utf8');
    const m = JSON.parse(texto);
    assert.deepEqual(m.motores.map((x) => x.nome), ['modelos', 'runtime'], 'a ordem dos motores fica');
    assert.deepEqual(m.motores[1], { nome: 'runtime', versao: '1.1', url: `${r.base}/v1/motor/escriba-runtime/1.1`, sha256: sha,
      tamanho: bytes.length, confere: 'bin/python' });
    assert.deepEqual(m.motores[0], APP.motores[0], 'o outro motor não muda');
    assert.match(texto, /\n {4}"id"/, 'o recuo do arquivo fica');
  } finally { await r.fechar(); }
});

test('um motor novo entra no fim, e o nome no repositório pode ser outro', pular, async () => {
  const r = await repo();
  try {
    const b = bancada({ ...APP, motores: undefined });
    const s = await publicar(b, r.base, ['--nome', 'editor', '--versao', '1.132.0-25', '--arquivo', b.tarball,
      '--nome-no-repo', 'vscode', '--confere', 'bin/vssh-code-server']);
    assert.equal(s.code, 0, s.saida);
    const m = JSON.parse(fs.readFileSync(path.join(b.app, 'vssh-app.json'), 'utf8'));
    assert.deepEqual(m.motores.map((x) => [x.nome, x.url.split('/v1/')[1], x.confere]),
      [['editor', 'motor/vscode/1.132.0-25', 'bin/vssh-code-server']]);
    assert.equal(r.registros[0].cabecalhos['x-vssh-name'], 'vscode');
  } finally { await r.fechar(); }
});

test('um registro recusado não toca no manifesto', pular, async () => {
  const r = await repo(409);
  try {
    const b = bancada(APP);
    const antes = fs.readFileSync(path.join(b.app, 'vssh-app.json'), 'utf8');
    const s = await publicar(b, r.base, ['--nome', 'runtime', '--versao', '1.1', '--arquivo', b.tarball]);
    assert.notEqual(s.code, 0);
    assert.match(s.saida, /o registro respondeu 409/);
    assert.equal(fs.readFileSync(path.join(b.app, 'vssh-app.json'), 'utf8'), antes);
  } finally { await r.fechar(); }
});

test('sem credencial, ou com um nome fora do padrão, nada sobe', pular, async () => {
  const r = await repo();
  try {
    const casos = [
      [['--nome', 'runtime', '--versao', '1.1'], { R2_SECRET_ACCESS_KEY: '' }, /R2_SECRET_ACCESS_KEY não está definida/],
      [['--nome', 'Runtime', '--versao', '1.1'], {}, /--nome 'Runtime' fora do padrão/],
      [['--nome', 'runtime', '--versao', '1.1', '--confere', '../etc'], {}, /caminho relativo, sem '\.\.'/],
    ];
    for (const [args, ambiente, esperado] of casos) {
      const b = bancada(APP);
      const s = await publicar(b, r.base, [...args, '--arquivo', b.tarball], ambiente);
      assert.notEqual(s.code, 0);
      assert.match(s.saida, esperado);
      assert.ok(!fs.existsSync(path.join(b.bucket, 'argumentos')), 'o aws não foi chamado');
    }
    assert.equal(r.registros.length, 0);
  } finally { await r.fechar(); }
});
