'use strict';
// A ponte de um app pelo `vssh-app-publish` inteiro, contra um Worker de mentira: o publish lê os
// nomes do SDK web que a janela chama, soma o que o manifesto declara, e o manifesto que chega ao
// repositório leva as duas listas. Um nome declarado que o SDK não tem recusa a publicação antes de
// qualquer POST; um nome só lido que o SDK não tem vira um aviso, e o pacote sai.
//
// A lista dos nomes que existem é `api/superficie.json`, que o canal do sistema gera. Sem ela, ou
// sem bash, curl ou python3, os testes se pulam dizendo o que falta.

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'vssh-app-publish');
const SUPERFICIE = path.join(ROOT, 'api', 'superficie.json');
const posix = (p) => p.replace(/\\/g, '/');

function tem(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const falta = ['bash', 'curl', 'python3'].filter((c) => !tem(c));
if (!fs.existsSync(SUPERFICIE)) falta.push('api/superficie.json (o canal do sistema ainda não a gerou)');
const seNaoTem = { skip: falta.length ? `sem ${falta.join(', ')}` : false };

/** @type {http.Server} */ let worker;
let repoApi;
const recebidos = [];

before(async () => {
  if (seNaoTem.skip) return;
  worker = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      recebidos.push({ method: req.method, url: req.url, headers: req.headers, corpo: Buffer.concat(pedacos) });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, schemaConferido: true }));
    });
  });
  await new Promise((r) => worker.listen(0, '127.0.0.1', r));
  repoApi = `http://127.0.0.1:${worker.address().port}`;
});
after(async () => { if (worker) await new Promise((r) => worker.close(r)); });

const MANIFESTO = {
  id: 'exemplo', name: 'Exemplo', version: '1.0.0',
  backend: { runtime: 'node', entrypoint: 'backend/servidor.js' },
};

/**
 * Publica um app com o manifesto e os arquivos dados (`{ caminho: conteúdo }`). Devolve o código, a
 * saída, e o manifesto que chegou ao repositório: o do cabeçalho e o de dentro do pacote.
 */
function publicar({ manifesto = MANIFESTO, arquivos = {}, git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-app-'));
  fs.writeFileSync(path.join(dir, 'vssh-app.json'), JSON.stringify(manifesto, null, 2));
  for (const [caminho, conteudo] of Object.entries({ 'backend/servidor.js': '', ...arquivos })) {
    fs.mkdirSync(path.dirname(path.join(dir, caminho)), { recursive: true });
    fs.writeFileSync(path.join(dir, caminho), conteudo);
  }
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir });
  recebidos.length = 0;
  return new Promise((resolve) => {
    const p = spawn('bash', [posix(SCRIPT), posix(dir)], {
      // Fora do Actions o `anotar` escreve `título: mensagem`, e é essa forma que os casos leem.
      env: { ...process.env, VSSH_REPO_API: repoApi, VSSH_REPO_PUBLISH_TOKEN: 'tok', GITHUB_ACTIONS: '' },
    });
    let saida = '';
    p.stdout.on('data', (c) => { saida += c; });
    p.stderr.on('data', (c) => { saida += c; });
    const relogio = setTimeout(() => p.kill(), 60_000);
    p.on('close', (code) => {
      clearTimeout(relogio);
      fs.rmSync(dir, { recursive: true, force: true });
      const post = recebidos.find((r) => r.method === 'POST' && r.url === '/v1/publish/app');
      const doCabecalho = post ? JSON.parse(Buffer.from(post.headers['x-vssh-manifest'], 'base64').toString('utf8')) : null;
      // O `git archive` grava os caminhos sem o `./` que o `tar` de uma pasta comum põe.
      const doPacote = post ? JSON.parse(execFileSync('tar', ['-xzO', git ? 'vssh-app.json' : './vssh-app.json'], { input: post.corpo }).toString('utf8')) : null;
      resolve({ code, saida, doCabecalho, doPacote });
    });
  });
}

test('os nomes que a janela chama chegam ao repositório em ponte.exige, e o backend e os testes ficam de fora', seNaoTem, async () => {
  const r = await publicar({
    arquivos: {
      'frontend/index.html': '<script>vssh.app.titulo("Exemplo"); window.vssh.arquivos?.urlFor?.(caminho);</script>',
      'frontend/janela.js': 'const sala = await vssh.salas.entrar(id, { Y });\nvssh . avisos\n  .notificar("fora da linha");',
      // O runtime do backend também se chama `vssh` e tem um espaço `gpu`.
      'backend/servidor.js': "const vssh = require('vssh'); vssh.gpu.estado();",
      'tests/janela.test.js': 'vssh.dialogos.confirmar("só no teste");',
    },
  });
  assert.equal(r.code, 0, r.saida);
  // `avisos.notificar` está quebrado em duas linhas, e conta como os outros.
  assert.deepEqual(r.doPacote.ponte, { exige: ['app.titulo', 'arquivos.urlFor', 'avisos.notificar', 'salas.entrar'], opcional: [] });
  assert.deepEqual(r.doCabecalho.ponte, r.doPacote.ponte, 'o manifesto do cabeçalho e o do pacote divergem');
  assert.match(r.saida, /ponte de exemplo: 4 nomes lidos do frontend e 0 declarados no manifesto\. O pacote exige 4 e dispensa 0\./);
});

test('o que a leitura não acha entra por ponte.exige, e o nome em ponte.opcional sai da exigência', seNaoTem, async () => {
  const r = await publicar({
    manifesto: { ...MANIFESTO, ponte: { exige: ['janela.minimizar', 'janela.fechar'], opcional: ['desempenho.mandarMedida'] } },
    arquivos: {
      // O acessor do próprio app esconde os nomes da leitura.
      'frontend/ponte.js': "const espaco = (n) => window.vssh?.[n];\nespaco('janela')?.minimizar?.();\nif (vssh.desempenho?.mandarMedida) vssh.desempenho.mandarMedida(m);\nvssh.app.titulo('x');",
    },
  });
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.doPacote.ponte, { exige: ['app.titulo', 'janela.fechar', 'janela.minimizar'], opcional: ['desempenho.mandarMedida'] });
  assert.match(r.saida, /2 nomes lidos do frontend e 3 declarados no manifesto\. O pacote exige 3 e dispensa 1\./);
});

test('um nome declarado que o SDK não tem recusa a publicação antes de qualquer POST, pelo nome', seNaoTem, async () => {
  const r = await publicar({
    manifesto: { ...MANIFESTO, ponte: { exige: ['salas.naoExiste'], opcional: ['app.titulo'] } },
    arquivos: { 'frontend/index.html': '<script>vssh.app.titulo("x")</script>' },
  });
  assert.equal(r.code, 1, r.saida);
  assert.equal(recebidos.length, 0, 'um pedido saiu para o repositório');
  assert.match(r.saida, /salas\.naoExiste/);
});

test('um nome só lido que o SDK não tem vira aviso com o arquivo e a linha, e o pacote sai sem ele', seNaoTem, async () => {
  const r = await publicar({
    arquivos: { 'frontend/modelo.js': "// A peça vai ao SDK web como `vssh.salas.comentarios` um dia.\nvssh.app.titulo('x');" },
  });
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.doPacote.ponte, { exige: ['app.titulo'], opcional: [] });
  assert.match(r.saida, /vssh\.salas\.comentarios \(frontend\/modelo\.js:1\)/);
});

// Num repositório git o pacote leva o rastreado e o que o `.gitignore` não exclui, e a leitura
// segue o pacote: um arquivo que não viaja não põe nome na ponte.
test('num repositório git, o arquivo que o .gitignore exclui fica fora da leitura', seNaoTem, async () => {
  const r = await publicar({
    git: true,
    arquivos: {
      '.gitignore': 'rascunho/\n',
      'frontend/janela.js': "vssh.app.titulo('x');",
      'rascunho/velho.js': "vssh.dialogos.confirmar('não viaja');",
    },
  });
  assert.equal(r.code, 0, r.saida);
  assert.deepEqual(r.doPacote.ponte, { exige: ['app.titulo'], opcional: [] });
});

test('uma janela sem nome nenhum ganha o aviso da ponte vazia, e um serviço não', seNaoTem, async () => {
  const semNome = { 'frontend/index.html': '<p>sem ponte</p>' };
  const janela = await publicar({ arquivos: semNome });
  assert.equal(janela.code, 0, janela.saida);
  assert.deepEqual(janela.doPacote.ponte, { exige: [], opcional: [] });
  assert.match(janela.saida, /ponte vazia/);

  const servico = await publicar({ manifesto: { ...MANIFESTO, type: 'engine', kind: 'service' }, arquivos: semNome });
  assert.equal(servico.code, 0, servico.saida);
  assert.doesNotMatch(servico.saida, /ponte vazia/);
});

test('o minShellVersion continua aceito, com um aviso que o diz de saída e manda tirá-lo', seNaoTem, async () => {
  const r = await publicar({
    manifesto: { ...MANIFESTO, minShellVersion: '5.0.0' },
    arquivos: { 'frontend/index.html': '<script>vssh.app.titulo("x")</script>' },
  });
  assert.equal(r.code, 0, r.saida);
  assert.match(r.saida, /minShellVersion: .*5\.0\.0, um campo de saída.*Tire o campo/);
  assert.equal(r.doPacote.minShellVersion, '5.0.0', 'o publish tirou o campo por conta própria');
});
