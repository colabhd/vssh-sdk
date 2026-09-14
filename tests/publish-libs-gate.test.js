'use strict';

// O portão de versão das libs, dentro do `vssh-app-publish`.
//
// Um app leva as libs de backend consigo, e um app publicado contra outra geração delas quebra no
// servidor, longe daqui. O portão lê o que o gerenciador de pacotes instalou dentro do pacote (o
// `package.json` do `node_modules`, o `.dist-info` do `vendor/py`) e compara com a versão de
// referência, lida de `runtime/package.json` deste repositório. Ele é a última linha antes do
// servidor, e por isso tem bancada própria.
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
 * Roda o portão contra um app de mentira.
 *
 * O SDK de mentira reproduz o layout real (`<raiz>/runtime/package.json` e `<raiz>/scripts/<x>`)
 * porque a própria seção calcula a raiz a partir de `$0`; um stub dessa linha testaria o stub.
 * `nossaVersao: null` é o checkout sem `runtime/`, que é o estado deste repositório enquanto as
 * libs vêm do `vssh-app-toolkit`.
 */
function rodar(app, { nossaVersao = '4.0.0' } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-gate-'));
  try {
    fs.mkdirSync(path.join(t, 'scripts'));
    if (nossaVersao) {
      fs.mkdirSync(path.join(t, 'runtime'));
      fs.writeFileSync(path.join(t, 'runtime', 'package.json'), JSON.stringify({ name: 'vssh-app-toolkit', version: nossaVersao }, null, 2));
    }
    const gate = path.join(t, 'scripts', 'gate.sh');
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
 * Um pacote de app: manifesto, package.json opcional e node_modules opcional.
 *
 * `instaladaPy` põe o `.dist-info` que o `pip install --target` escreve — é dali que o portão lê a
 * versão do lado Python, e o nome daquele diretório é normativo (PEP 376), não convenção nossa.
 */
function app({ manifesto = {}, declara = false, instalada = null, legado = false, script = null,
               instaladaPy = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vssh-app-'));
  fs.writeFileSync(path.join(dir, 'vssh-app.json'), JSON.stringify({
    id: 'x', version: '1.0.0', backend: { runtime: 'node', entrypoint: 'b.js', ...manifesto },
  }, null, 2));
  if (instaladaPy) {
    const di = path.join(dir, 'vendor', 'py', `vssh_app_toolkit-${instaladaPy}.dist-info`);
    fs.mkdirSync(di, { recursive: true });
    fs.writeFileSync(path.join(di, 'METADATA'), `Name: vssh-app-toolkit\nVersion: ${instaladaPy}\n`);
  }
  if (declara) {
    fs.writeFileSync(path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { 'vssh-app-toolkit': 'github:colabhd/vssh-app-toolkit#v4' } }, null, 2));
  }
  if (instalada) {
    const nm = path.join(dir, 'node_modules', 'vssh-app-toolkit');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'vssh-app-toolkit', version: instalada }, null, 2));
  }
  if (script) {
    fs.mkdirSync(path.join(dir, path.dirname(script.caminho)), { recursive: true });
    fs.writeFileSync(path.join(dir, script.caminho), script.corpo);
  }
  if (legado) {
    const v = path.join(dir, 'backend', 'vendor', 'vssh');
    fs.mkdirSync(v, { recursive: true });
    fs.writeFileSync(path.join(v, '.vssh-lib-version'), 'origin=colabhd/vssh-app-toolkit@v3\nlib_version=3.0.0\n');
  }
  return dir;
}

test('libs da mesma versão passam calado', seNaoTemBash, () => {
  const r = rodar(app({ declara: true, instalada: '4.0.0' }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /FIM/);
  assert.doesNotMatch(r.saida, /major|desatualizadas/);
});

test('libs de outra MAJOR param a publicação', seNaoTemBash, () => {
  // O caso que aconteceu de verdade: app com 3.0.0 e toolkit 4.0.0.
  const r = rodar(app({ declara: true, instalada: '3.0.0' }));
  assert.equal(r.code, 1, 'publicou com libs de outra geração');
  assert.match(r.saida, /error\|libs de outra major/);
  assert.match(r.saida, /3\.0\.0.*4\.0\.0/s);
  assert.match(r.saida, /npm i github:colabhd\/vssh-app-toolkit#v4/, 'o erro tem de trazer o conserto junto');
});

test('minor à frente avisa e deixa passar', seNaoTemBash, () => {
  // A proporção é a regra: recusar o compatível só ensina a ignorar o portão.
  const r = rodar(app({ declara: true, instalada: '4.1.0' }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /warning\|libs desatualizadas/);
});

test('declarar sem levar e sem instalar no alvo é recusado', seNaoTemBash, () => {
  // O tarball iria sem node_modules e sem ninguém para criá-lo: o backend morre no primeiro
  // require, no servidor, longe daqui.
  const r = rodar(app({ declara: true }));
  assert.equal(r.code, 1);
  assert.match(r.saida, /error\|libs declaradas e ausentes/);
});

test('declarar sem levar, mas com installCommand que roda npm, é notice', seNaoTemBash, () => {
  // É o que o scramjet-wisp faz em produção. E o portão DIZ que não conferiu a versão, em vez de
  // deixar entender que conferiu.
  const r = rodar(app({ declara: true, manifesto: { installCommand: 'npm ci --omit=dev' } }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /notice\|libs instaladas no servidor/);
  assert.match(r.saida, /NÃO foi conferida/);
});


test('installCommand que CHAMA um script com npm dentro é notice — a guarda segue o comando', seNaoTemBash, () => {
  // O caso que fez esta guarda ser reescrita. O `vsshapp-vscode` declara
  // `"installCommand": "bash backend/install.sh"`, e o `npm ci` mora no script — o que é a forma
  // certa quando a instalação faz mais de uma coisa (lá ela também baixa e confere o motor).
  //
  // A versão anterior perguntava `grep -q 'npm ' vssh-app.json` e RECUSAVA a publicação: acusava o
  // app de não instalar as libs quando o defeito era da pergunta, que media o texto do manifesto em
  // vez do que o comando faz.
  const r = rodar(app({
    declara: true,
    manifesto: { installCommand: 'bash backend/install.sh' },
    script: { caminho: 'backend/install.sh', corpo: '#!/usr/bin/env bash\nnpm ci --omit=dev\n' },
  }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /notice\|libs instaladas no servidor/);
});

test('script chamado que NÃO roda npm continua sendo recusado', seNaoTemBash, () => {
  // Seguir o comando não pode virar "aceitar qualquer comando": o que se procura continua sendo o
  // npm, agora no lugar certo. Sem este caso, a guarda passaria a aprovar todo installCommand que
  // apontasse para um arquivo existente.
  const r = rodar(app({
    declara: true,
    manifesto: { installCommand: 'bash backend/install.sh' },
    script: { caminho: 'backend/install.sh', corpo: '#!/usr/bin/env bash\necho nada a fazer\n' },
  }));
  assert.equal(r.code, 1);
  assert.match(r.saida, /error\|libs declaradas e ausentes/);
});

test('app que não usa as libs passa, e o portão diz que não tinha o que conferir', seNaoTemBash, () => {
  const r = rodar(app({}));
  assert.equal(r.code, 0);
  assert.match(r.saida, /notice\|sem libs do toolkit/);
});

test('cópia vendorizada antiga é ERRO, não aviso', seNaoTemBash, () => {
  // Um `vendor/vssh/` no pacote depois da v4 é código morto que o app pode estar carregando NO
  // LUGAR das libs instaladas — duas noções da mesma coisa, que é o defeito, não o sintoma.
  const r = rodar(app({ declara: true, instalada: '4.0.0', legado: true }));
  assert.equal(r.code, 1);
  assert.match(r.saida, /error\|libs copiadas à mão/);
});

test('sem saber a própria versão, o portão diz que NÃO conferiu', seNaoTemBash, () => {
  // Checkout sem `runtime/package.json`: o estado deste repositório enquanto as libs vêm do
  // toolkit. Uma conferência que se acha feita sem ter sido é pior que nenhuma.
  const r = rodar(app({ declara: true, instalada: '3.0.0' }), { nossaVersao: null });
  assert.equal(r.code, 0, 'não dá para recusar por uma comparação que não foi feita');
  assert.match(r.saida, /warning\|libs não conferidas/);
});

// ─── O mesmo portão, do lado PYTHON ──────────────────────────────────────────
//
// Estas quatro entraram junto com as libs Python, e a primeira delas mede o defeito que existia
// enquanto o portão só sabia perguntar ao npm: um app Python que dependia das libs era anunciado
// como *"não depende das libs deste toolkit"*. Não era um furo silencioso — era o portão AFIRMANDO
// o contrário do que era verdade, que é a pior forma de uma conferência falhar.

const INSTALL_PY = 'python3 -m pip install --target vendor/py '
  + '"https://github.com/colabhd/vssh-app-toolkit/archive/refs/tags/v4.tar.gz"';

test('app Python que DECLARA as libs não é mais anunciado como se não usasse nenhuma', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { runtime: 'python3', entrypoint: 'backend/main.py',
                                     installCommand: INSTALL_PY } }));
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.saida, /sem libs do toolkit/,
    'o portão disse que o app não usa as libs, e o installCommand dele as instala');
  assert.match(r.saida, /notice\|libs Python instaladas no servidor/);
  // E ele diz que NÃO conferiu — uma conferência que se acha feita sem ter sido é pior que nenhuma.
  assert.match(r.saida, /NÃO foi conferida aqui/);
});

test('libs Python de outra MAJOR param a publicação', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { runtime: 'python3', installCommand: INSTALL_PY },
                        instaladaPy: '3.0.0' }));
  assert.equal(r.code, 1, 'publicou com libs de outra geração');
  assert.match(r.saida, /error\|libs de outra major/);
  assert.match(r.saida, /3\.0\.0.*4\.0\.0/s);
  // O conserto tem de vir junto, e no idioma do runtime certo: mandar rodar `npm i` num app Python
  // seria uma instrução que não funciona, dada com a autoridade de quem barrou a publicação.
  assert.match(r.saida, /pip install --target vendor\/py/);
});

test('libs Python de minor à frente avisam e deixam passar', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { runtime: 'python3', installCommand: INSTALL_PY },
                        instaladaPy: '4.1.0' }));
  assert.equal(r.code, 0);
  assert.match(r.saida, /warning\|libs desatualizadas/);
});

test('libs Python da mesma versão passam calado', seNaoTemBash, () => {
  const r = rodar(app({ manifesto: { runtime: 'python3', installCommand: INSTALL_PY },
                        instaladaPy: '4.0.0' }));
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.saida, /major|desatualizadas|sem libs do toolkit/);
});
