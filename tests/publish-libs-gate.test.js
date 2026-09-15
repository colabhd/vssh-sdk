'use strict';

// O portão de libs de backend, dentro do `vssh-app-publish`.
//
// As libs de backend são o runtime `vssh` que todo servidor tem, e um app não as declara. O que
// o portão procura é o resto da geração anterior: um `package.json` que ainda dependa do
// `vssh-app-toolkit`, ou um `installCommand` e um `requirements` que ainda o instalem por pip. O
// que ele faz com isso é um aviso que nomeia a versão e diz que o runtime do servidor a
// substitui; sem a citação, nada a conferir e nenhum aviso. Medido executando a seção do script
// contra um pacote de app de mentira.
//
// O trecho é recortado do script pelos delimitadores (`── 2b.` até `── 3.`), e nunca por número
// de linha: o script cresce, as linhas andam, e um recorte por número passaria a medir outra
// coisa sem avisar. É o mesmo idioma do recorte do validador em publish-validacao.test.js.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'vssh-app-publish');
const posix = (p) => p.replace(/\\/g, '/');

function temBash() {
  try { execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const seNaoTemBash = { skip: temBash() ? false : 'sem bash no PATH' };

/** O bloco 2b do publish, recortado pelos delimitadores reais. */
function portao() {
  const linhas = fs.readFileSync(SCRIPT, 'utf8').replace(/\r/g, '').split('\n');
  const inicio = linhas.findIndex((l) => l.startsWith('# ── 2b.'));
  const fim = linhas.findIndex((l, i) => i > inicio && l.startsWith('# ── 3.'));
  assert.ok(inicio > 0 && fim > inicio, 'não achei a seção 2b no vssh-app-publish');
  return linhas.slice(inicio, fim).join('\n');
}

/**
 * Roda o portão contra um app de mentira, com o `anotar` do script trocado por um que imprime
 * `nivel|título|mensagem`, que é o que se lê de volta.
 */
function rodar(app) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-gate-'));
  try {
    const gate = path.join(t, 'gate.sh');
    fs.writeFileSync(gate, [
      'set -euo pipefail',
      'anotar() { local n="$1" ti="$2"; shift 2; printf "%s|%s|%s\\n" "$n" "$ti" "$*"; }',
      'PKG="$1"',
      portao(),
      'echo "FIM"',
    ].join('\n'));
    const r = spawnSync('bash', [posix(gate), posix(app)], { encoding: 'utf8' });
    return { code: r.status, saida: `${r.stdout}${r.stderr}` };
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
}

/**
 * Um pacote de app: manifesto, e o que a geração anterior deixava nele. `declara` é a
 * dependência no `package.json`; `instalada`, a cópia em `node_modules`; `instaladaPy`, o
 * `.dist-info` que o `pip install --target` escreve (o nome do diretório é normativo, PEP 376);
 * `requirements`, um `requirements.txt` com o toolkit.
 */
function app({ manifesto = {}, declara = null, instalada = null, instaladaPy = null, requirements = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-app-'));
  fs.writeFileSync(path.join(dir, 'vssh-app.json'), JSON.stringify({
    id: 'x', version: '5.0.0', backend: { runtime: 'node', entrypoint: 'b.js', ...manifesto },
  }, null, 2));
  if (declara) {
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { 'vssh-app-toolkit': declara } }, null, 2));
  }
  if (instalada) {
    const nm = path.join(dir, 'node_modules', 'vssh-app-toolkit');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'vssh-app-toolkit', version: instalada }, null, 2));
  }
  if (instaladaPy) {
    const di = path.join(dir, 'vendor', 'py', `vssh_app_toolkit-${instaladaPy}.dist-info`);
    fs.mkdirSync(di, { recursive: true });
    fs.writeFileSync(path.join(di, 'METADATA'), `Name: vssh-app-toolkit\nVersion: ${instaladaPy}\n`);
  }
  if (requirements) fs.writeFileSync(path.join(dir, 'requirements.txt'), requirements);
  return dir;
}

const TARBALL_V4 = 'https://github.com/colabhd/vssh-app-toolkit/archive/refs/tags/v4.tar.gz';

test('um app sem o toolkit passa calado: nada a conferir, nenhum aviso', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { installCommand: 'npm ci --omit=dev' } }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /FIM/);
  assert.doesNotMatch(r.saida, /warning\||notice\||error\|/, `o portão falou de um app que não cita o toolkit:\n${r.saida}`);
});

test('a dependência no package.json rende um aviso com a versão declarada, e a publicação segue', seNaoTemBash, () => {
  const r = rodar(app({ declara: 'github:colabhd/vssh-app-toolkit#v4' }));
  assert.equal(r.code, 0, 'o toolkit continua funcionando; o portão avisa, e não recusa');
  assert.match(r.saida, /warning\|libs do toolkit\|/);
  assert.match(r.saida, /package\.json declara vssh-app-toolkit \(github:colabhd\/vssh-app-toolkit#v4\)/);
  assert.match(r.saida, /runtime `vssh`/, 'o aviso não diz o que substitui a dependência');
  assert.match(r.saida, /MIGRATION\.md/, 'o aviso não aponta para onde está a troca');
});

test('com node_modules no pacote, o aviso nomeia também a versão instalada', seNaoTemBash, () => {
  const r = rodar(app({ declara: 'github:colabhd/vssh-app-toolkit#v4', instalada: '4.14.0' }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /#v4, instalada 4\.14\.0 em node_modules/);
});

test('o pip install do tarball no installCommand rende o mesmo aviso, com a tag', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { runtime: 'python3', entrypoint: 'backend/main.py',
                                     installCommand: `python3 -m pip install --target vendor/py "${TARBALL_V4}"` } }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /warning\|libs do toolkit\|vssh-app\.json \(installCommand\) instala vssh-app-toolkit \(v4\)/);
  assert.match(r.saida, /runtime `vssh`/);
});

test('com vendor/py no pacote, o aviso nomeia a versão do .dist-info', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { runtime: 'python3', installCommand: `pip install --target vendor/py "${TARBALL_V4}"` },
                        instaladaPy: '4.12.0' }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /\(v4, instalada 4\.12\.0 em vendor\/py\)/);
});

test('um requirements.txt que cita o toolkit também é avisado', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { runtime: 'python3', installCommand: 'pip install -r requirements.txt' },
                        requirements: `${TARBALL_V4}\n` }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /warning\|libs do toolkit\|requirements\.txt instala vssh-app-toolkit \(v4\)/);
});

test('o aviso é um por lado: um app que cita o toolkit nos dois recebe dois, e nada mais', seNaoTemBash, () => {
  const r = rodar(app({ declara: 'github:colabhd/vssh-app-toolkit#v4',
                        manifesto: { installCommand: `pip install "${TARBALL_V4}"` } }));
  assert.equal(r.code, 0);
  assert.equal((r.saida.match(/warning\|libs do toolkit\|/g) || []).length, 2);
});
