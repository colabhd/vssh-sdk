// A bancada de um app (`scripts/vssh-bancada.mjs`) de ponta a ponta, como o CI de um app a roda:
// um processo, um repositório git de verdade com o app de `tests/fixtures/app-de-bancada`, o
// backend dele, a janela no quadro de bancada num Chrome e as cenas pelo SDK web de `api/`.
//
// A cena do app devolve uma conta de custo conhecido a cada quadro, com números que não dependem da
// máquina, e o teste muda o custo na cabeça:
// a piora aparece na medida de amostras (o p95 de todas as rodadas juntas) e na de um número por
// rodada (a mediana), e a medida que só informa não reprova. O A/A, a pasta contra ela mesma, não
// reprova e diz o ruído; a base sem cenas não tem o que comparar. A calibração leva a CPU da
// página a perto de 100, o Celeron de referência.
//
// O arquivo é `*.serial.js`, e o `npm test` o roda sozinho, depois do resto: a bancada mede tempo,
// e com outros arquivos em paralelo a página perde a vez no meio de uma rodada.
//
// Pula sem Chrome e sem um SDK web com as cenas (`vssh.desempenho.rodarCenas`); `VSSH_SDK_API`
// aponta outro `api/`, como o que o `scripts/gerar-sdk.js` do vssh-sso gera.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { caminhoDoNavegador } = require('../../scripts/navegador.cjs');

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const API = process.env.VSSH_SDK_API || join(RAIZ, 'api');
const SDK_WEB = process.env.VSSH_SDK_WEB || join(API, 'vssh.js');
const BANCADA = join(RAIZ, 'scripts', 'vssh-bancada.mjs');
const FIXTURE = join(RAIZ, 'tests', 'fixtures', 'app-de-bancada');

const falta = !caminhoDoNavegador() ? 'sem Chrome (VSSH_TEST_CHROME aponta um)'
  : !existsSync(SDK_WEB) || !readFileSync(SDK_WEB, 'utf8').includes('rodarCenas') ? `sem as cenas no SDK web de ${SDK_WEB}`
    : false;
const semSonda = falta || (!existsSync(join(API, 'afericao', 'sonda.js')) ? `sem a sonda em ${join(API, 'afericao')}` : false);

let pasta;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=bancada', '-c', 'user.email=bancada@exemplo.invalid', ...args], { encoding: 'utf8' });

/** O app num repositório próprio, com um commit; devolve a pasta do app. */
function repositorio(nome) {
  const dir = join(pasta, nome);
  cpSync(FIXTURE, dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

function bancada(...args) {
  const saida = join(pasta, `saida-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [BANCADA, ...args, '--cpu', '1', '--ciclos', '1', '--saida', saida], {
    encoding: 'utf8', env: { ...process.env, VSSH_SDK_API: API, GITHUB_STEP_SUMMARY: '' }, timeout: 180000,
  });
  return { codigo: r.status, stdout: r.stdout, stderr: r.stderr, json: existsSync(saida) ? JSON.parse(readFileSync(saida, 'utf8')) : null };
}

const custo = (dir, ms) => {
  const arq = join(dir, 'frontend', 'cenas.js');
  writeFileSync(arq, readFileSync(arq, 'utf8').replace(/const CUSTO_MS = \d+;/, `const CUSTO_MS = ${ms};`));
};

before(() => { pasta = mkdtempSync(join(tmpdir(), 'vssh-bancada-teste-')); });
after(() => { if (pasta) rmSync(pasta, { recursive: true, force: true }); });

test('o A/A, a pasta contra ela mesma, não reprova e diz o ruído de cada medida', { skip: falta }, () => {
  const app = repositorio('aa');
  const r = bancada('aa', app);
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ruído entre os lados/);
  assert.deepEqual(r.json.linhas.map((l) => [l.medida, l.piorou]), [['conta', false], ['soma', false], ['maior', false]]);
  // Os dois lados rodam as mesmas rodadas, e a diferença entre eles é zero; as rodadas de um lado
  // diferem pelo acréscimo da rodada.
  for (const l of r.json.linhas) {
    assert.equal(l.ruido.entreLados, 0, `${l.medida}: ${JSON.stringify(l.ruido)}`);
    assert.ok(l.ruido.rodadas > 0 && l.ruido.rodadas < 0.05, `${l.medida}: ${JSON.stringify(l.ruido)}`);
  }
});

test('a cabeça mais lenta reprova pelas amostras e pela mediana, e a medida que informa não', { skip: falta }, () => {
  const app = repositorio('comparar');
  custo(app, 12);
  const r = bancada('comparar', app, '--base', 'HEAD');
  assert.equal(r.codigo, 1, r.stdout + r.stderr);
  const porMedida = Object.fromEntries(r.json.linhas.map((l) => [l.medida, l]));
  assert.equal(porMedida.conta.juntas, true);
  assert.equal(porMedida.conta.piorou, true);
  // O p95 é o das amostras das rodadas todas juntas, e não o de uma rodada.
  const juntas = r.json.rodadas.cabeca.flatMap((rd) => rd.cenas[0].medidas.conta.amostras).sort((a, b) => a - b);
  assert.equal(porMedida.conta.medianaCabeca, juntas[Math.floor(juntas.length * 0.95)]);
  assert.ok(porMedida.conta.medianaBase < 6 && porMedida.conta.medianaCabeca > 10, JSON.stringify(porMedida.conta));
  assert.equal(porMedida.soma.juntas, false);
  assert.equal(porMedida.soma.piorou, true);
  assert.ok(porMedida.maior.medianaCabeca > porMedida.maior.medianaBase * 2, JSON.stringify(porMedida.maior));
  assert.equal(porMedida.maior.piorou, false);
  assert.match(r.stdout, /::error::Uma conta de custo conhecido: conta a cada quadro \(p95\)/);
  // A base saiu de um worktree, e ele não fica para trás.
  assert.equal(git(app, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a cabeça igual à base não reprova', { skip: falta }, () => {
  const app = repositorio('igual');
  const r = bancada('comparar', app, '--base', 'HEAD');
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
  assert.ok(r.json.linhas.every((l) => !l.piorou));
});

test('a base que não registra cenas não tem o que comparar', { skip: falta }, () => {
  const app = repositorio('sem-cenas');
  git(app, 'rm', '-q', 'frontend/cenas.js');
  git(app, 'commit', '-qm', 'sem as cenas');
  git(app, 'revert', '--no-edit', 'HEAD');
  const r = bancada('comparar', app, '--base', 'HEAD~1');
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /não registra cenas; não há o que comparar/);
});

test('a calibração leva a CPU da página a perto de 100', { skip: semSonda }, () => {
  const r = spawnSync(process.execPath, [BANCADA, 'calibrar'], { encoding: 'utf8', env: { ...process.env, VSSH_SDK_API: API }, timeout: 180000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [, livre, multiplicador, indice] = /CPU da página: (\d+) sem estrangular; com o multiplicador ([\d.]+), (\d+)/.exec(r.stdout) || [];
  assert.ok(livre, r.stdout);
  // Numa máquina mais lenta que a âncora não há o que estrangular.
  if (Number(multiplicador) === 1) assert.ok(Number(livre) <= 110, r.stdout);
  else assert.ok(Math.abs(Number(indice) - 100) <= 15, r.stdout);
});
