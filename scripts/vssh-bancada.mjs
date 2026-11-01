#!/usr/bin/env node
// vssh-bancada: a bancada de um vssh-app no laboratório. Compara duas versões do app na mesma
// máquina e no mesmo intervalo de tempo, pelas cenas que a janela do app registra no SDK web
// (`vssh.desempenho.cenas`), e diz que medida piorou.
//
//   node scripts/vssh-bancada.mjs comparar <app> --base <ref> [--cabeca <dir>] [opções]
//   node scripts/vssh-bancada.mjs aa <app> [opções]
//   node scripts/vssh-bancada.mjs calibrar [--placa software|padrao]
//
//   --ciclos <n>        ciclos de quatro rodadas (base, cabeça, cabeça, base); o padrão é 2
//   --cpu calibrar|<n>  o multiplicador do estrangulamento da CPU pelo CDP; o padrão é calibrar
//   --placa <perfil>    `software` (SwiftShader, o padrão, a placa de um runner) ou `padrao`
//   --tolerancia <x>    a fração que a cabeça pode passar da base; o padrão é 0,15
//   --prazo <min>       o teto de uma rodada, em minutos; o padrão é 20
//   --parada <s>        a janela parada depois das cenas, medida pelo CDP; o padrão é 10, e 0 a desliga
//   --saida <arquivo>   o JSON com as rodadas cruas e o julgamento
//
// ─── As cenas ────────────────────────────────────────────────────────────────
//
// As cenas são do app (`bancada/cenas.mjs` é o lugar de costume) e rodam dentro da janela, pelo
// código dela, e por isso o laboratório, o "Medir este aparelho" do app e o aparelho de referência
// medem a mesma coisa. Aqui a janela sobe como no palco (`scripts/janela-de-bancada.mjs`): o
// backend numa porta de bancada, o `_sdk/` de `api/`, e o quadro de bancada no papel do shell, que
// pede as cenas com `bancada-rodar`. Um app que precisa de dados para medir (um cofre de dez mil
// notas, uma conta ligada) traz `bancada/preparar.mjs`, com a mesma função `preparar` do
// `ajuda/palco.mjs`, chamada uma vez em cada lado, com a HOME e os dados daquele lado.
//
// ─── A comparação ────────────────────────────────────────────────────────────
//
// Numa máquina compartilhada a mesma build varia mais de uma rodada para outra do que a maior parte
// das mudanças, e um número guardado de outro dia não decide nada. Os dois lados sobem juntos, cada
// um com o próprio backend, a própria HOME e os próprios dados, e as rodadas alternam na ordem
// base, cabeça, cabeça, base: o que a máquina fizer durante a medida cai nos dois lados. A base é
// um ref do git num worktree temporário, com o que estiver commitado nele.
//
// Uma medida que a cena devolve como número se compara pela mediana das rodadas: ela piora quando
// a mediana da cabeça passa a da base em mais de `--tolerancia` e em mais da folga, e fica acima da
// pior rodada da base. Uma medida que a cena devolve como lista de amostras se compara pelo p95 das
// amostras de todas as rodadas juntas, porque o p95 de uma rodada só é praticamente a amostra mais
// lenta dela; e a piora pede também a mediana dos p95 de cada rodada passando a da base, pela mesma
// régua. Uma rodada em que a página perdeu a vez para a máquina põe muitas amostras na cauda e sobe
// o p95 juntado sozinha, e a mediana das rodadas não se mexe por uma em quatro; uma piora de verdade
// move as duas. A folga é a que a medida declara, ou meio milissegundo num tempo. Uma medida
// `informa` só aparece na tabela. Toda unidade é "maior é pior": um tempo, uma fração de quadros
// perdidos, uma contagem de quadros perdidos.
//
// Depois das cenas, a janela fica parada: metade de `--parada` para o que a última cena agendou
// terminar, e então `--parada` segundos em que o CDP conta os layouts e o tempo de CPU da página.
// A janela parada não faz layout (sem tecla, rolagem ou evento, nada se anima sozinho), e por isso
// essa medida reprova quando qualquer rodada da cabeça tem um layout, mesmo que a base também
// tenha. O tempo de CPU só informa: o protocolo do CDP e o coletor de lixo também caem nele.
//
// `aa` compara a pasta com ela mesma, em dois lados, e mede o ruído de cada medida: a diferença
// entre os dois lados, e o espalhamento das rodadas. Um A/A que reprova é uma medida que a régua
// acima não sabe julgar nesta máquina.
//
// ─── A CPU e a placa ─────────────────────────────────────────────────────────
//
// O alvo é o Celeron dual-core de 4 GB que a Aferição chama de 100. `calibrar` roda a sonda do
// aparelho (`api/afericao/sonda.js`, o mesmo código que mediu o Celeron) na página sem
// estrangular, e o multiplicador do CDP é a razão entre a CPU daqui e a âncora: com ele, a CPU da
// página fica perto de 100. O CDP estrangula só a thread principal; a rasterização e o WebGL rodam
// no processo da placa, na velocidade dela, e por isso o perfil `software` usa o SwiftShader, a
// placa de um runner sem GPU, mais perto de um aparelho fraco que qualquer placa de verdade.
//
// Um Web Worker também fica de fora: o CDP recusa o estrangulamento na sessão dele ("only
// supported for pages, not workers"). O que a janela manda a um Worker roda na velocidade desta
// máquina, várias vezes a do Celeron, e a tabela diz isso. Uma cena mede o que a thread da página
// gasta, e deixa só informando a latência que espera por um Worker; a medida dela num aparelho de
// verdade é a do campo, por `vssh.desempenho.registrar`.
//
// ─── A saída ─────────────────────────────────────────────────────────────────
//
// A tabela em Markdown no stdout e no resumo do run (`GITHUB_STEP_SUMMARY`). O código é 0 sem
// piora (e quando a base não tem cenas: não há o que comparar), 1 com piora, e 2 num erro.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, subirBackend, subirFrente, prepararCena } from './janela-de-bancada.mjs';

const require = createRequire(import.meta.url);
const { abrirNavegador, caminhoDoNavegador } = require('./navegador.cjs');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const avisar = (texto) => process.stderr.write(`${texto}\n`);

function argumentos(argv) {
  const [modo, ...resto] = argv;
  const r = { modo, app: null, base: null, cabeca: null, ciclos: 2, cpu: 'calibrar', placa: 'software', tolerancia: 0.15, prazo: 20, parada: 10, saida: null };
  const valor = (i) => { if (resto[i + 1] === undefined) throw new Error(`${resto[i]} pede um valor`); return resto[i + 1]; };
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a === '--base') r.base = valor(i++);
    else if (a === '--cabeca') r.cabeca = valor(i++);
    else if (a === '--ciclos') r.ciclos = Number(valor(i++));
    else if (a === '--cpu') r.cpu = valor(i++);
    else if (a === '--placa') r.placa = valor(i++);
    else if (a === '--tolerancia') r.tolerancia = Number(valor(i++));
    else if (a === '--prazo') r.prazo = Number(valor(i++));
    else if (a === '--parada') r.parada = Number(valor(i++));
    else if (a === '--saida') r.saida = valor(i++);
    else if (!a.startsWith('--') && !r.app) r.app = a;
    else throw new Error(`argumento inesperado: ${a}`);
  }
  if (!['comparar', 'aa', 'calibrar'].includes(modo)) throw new Error('uso: vssh-bancada.mjs comparar|aa|calibrar …');
  if (modo !== 'calibrar' && !r.app) throw new Error(`uso: vssh-bancada.mjs ${modo} <diretório do app> …`);
  if (modo === 'comparar' && !r.base) throw new Error('comparar pede --base <ref>');
  if (!(r.ciclos >= 1)) throw new Error('--ciclos é um inteiro de 1 para cima');
  if (r.cpu !== 'calibrar' && !(Number(r.cpu) >= 1)) throw new Error('--cpu é calibrar ou um multiplicador de 1 para cima');
  if (!(r.parada >= 0)) throw new Error('--parada é um número de segundos, de 0 para cima');
  return r;
}

// ─── A CPU ───────────────────────────────────────────────────────────────────

/** Uma página com a sonda do aparelho, numa origem de verdade: o armazenamento dela pede uma. */
async function servirSonda() {
  const sonda = join(API, 'afericao', 'sonda.js');
  if (!existsSync(sonda)) throw new Error(`sem a sonda do aparelho em ${sonda}: use --cpu <multiplicador>`);
  const corpo = readFileSync(sonda);
  const servidor = http.createServer((req, res) => {
    if (req.url === '/sonda.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(corpo); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>sonda</title><script src="/sonda.js"></script>');
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  return servidor;
}

async function cpuDaSonda(pagina) {
  const r = await pagina.avaliar('SondaDoAparelho.rodar()');
  const cpu = r && r.medidas && r.medidas.cpu;
  if (!cpu || cpu.estado !== 'medido') throw new Error('a sonda não mediu a CPU da página');
  return cpu.valor;
}

/**
 * O multiplicador que leva a CPU da página à âncora (100), e a conferência: a CPU medida de novo
 * com ele. `indice` é 100 vezes a CPU medida pela da âncora, maior é mais rápido. O estrangulamento
 * do CDP não é proporcional (a página estrangulada em 4,6 vezes rende menos que 1/4,6), e por isso
 * o multiplicador se acerta pela CPU medida com ele, até ela cair a 10% de 100, em até quatro
 * tentativas. Numa máquina mais lenta que a âncora, o multiplicador fica em 1.
 */
async function calibrar(navegador) {
  const { ancora } = JSON.parse(readFileSync(join(API, 'afericao', 'ancora.json'), 'utf8'));
  const indice = (v) => Math.round((100 * v) / ancora.cpu);
  const servidor = await servirSonda();
  try {
    const pagina = await navegador.novaPagina(`http://127.0.0.1:${servidor.address().port}/`);
    await pagina.enviar('Emulation.setCPUThrottlingRate', { rate: 1 });
    const livre = indice(await cpuDaSonda(pagina));
    let multiplicador = Math.max(1, Math.round(livre) / 100);
    let medido = livre;
    for (let i = 0; i < 4 && multiplicador > 1; i++) {
      await pagina.enviar('Emulation.setCPUThrottlingRate', { rate: multiplicador });
      medido = indice(await cpuDaSonda(pagina));
      if (Math.abs(medido - 100) <= 10) break;
      multiplicador = Math.max(1, Math.round(multiplicador * (medido / 100) * 10) / 10);
    }
    await pagina.enviar('Emulation.setCPUThrottlingRate', { rate: 1 });
    return { indiceSemEstrangular: livre, multiplicador, indice: medido };
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

// ─── Os lados ────────────────────────────────────────────────────────────────

let temporaria = null;
const aLimpar = [];
let limpo = false;
function limpar() {
  if (limpo) return;
  limpo = true;
  for (const fn of aLimpar.reverse()) { try { fn(); } catch { /* já saiu */ } }
  if (temporaria) rmSync(temporaria, { recursive: true, force: true });
}
/** A pasta das HOMEs, dos dados e dos worktrees desta execução, e quem a apaga na saída. */
function prepararTemporaria() {
  temporaria = mkdtempSync(join(tmpdir(), 'vssh-bancada-'));
  process.on('exit', limpar);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130));
}

/** A pasta do app num ref: um worktree do repositório dele, no caminho do app dentro do repositório. */
function versao(app, ref, nome) {
  const topo = execFileSync('git', ['-C', app, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const dentro = relative(topo, app);
  const dir = join(temporaria, `repo-${nome}`);
  execFileSync('git', ['-C', topo, 'worktree', 'add', '--detach', '-q', dir, ref], { stdio: ['ignore', 'ignore', 'inherit'] });
  aLimpar.push(() => execFileSync('git', ['-C', topo, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' }));
  return join(dir, dentro);
}

async function prepararLado(nome, raiz) {
  const manifesto = JSON.parse(readFileSync(join(raiz, 'vssh-app.json'), 'utf8'));
  const home = join(temporaria, `home-${nome}`);
  const dados = join(temporaria, `dados-${nome}`);
  mkdirSync(home);
  mkdirSync(dados);
  const roteiro = join(raiz, 'bancada', 'preparar.mjs');
  const respostas = existsSync(roteiro)
    ? await prepararCena(roteiro, 'bancada/preparar.mjs', { home, dados, app: raiz, manifesto, lado: nome })
    : [];
  const backend = await subirBackend(raiz, manifesto, dados, home);
  aLimpar.push(() => backend.proc.kill());
  const largura = Math.round(manifesto.window?.width || 900);
  const altura = Math.round(manifesto.window?.height || 640);
  const frente = await subirFrente(backend.url, largura, altura, respostas);
  aLimpar.push(() => frente.close());
  return { nome, raiz, largura, altura, url: `http://127.0.0.1:${frente.address().port}/`, rodadas: [] };
}

// ─── Uma rodada ──────────────────────────────────────────────────────────────

/**
 * Carrega a janela de um lado e pede as cenas a ela. A janela registra as cenas quando o código
 * dela roda, e um pedido que chega antes volta sem nenhuma: o pedido se repete por até 30 s. Com
 * as cenas feitas, a janela fica parada `paradaS` segundos, e a contagem entra no resultado como
 * mais uma cena.
 */
async function rodada(pagina, lado, cpu, prazoMin, paradaS) {
  await pagina.enviar('Page.navigate', { url: lado.url });
  const fimDaCarga = Date.now() + 30000;
  while (!(await pagina.avaliar("typeof carregar === 'function' && typeof pedirCenas === 'function'").catch(() => false))) {
    if (Date.now() > fimDaCarga) throw new Error(`o quadro de bancada de ${lado.nome} não carregou`);
    await dormir(100);
  }
  await pagina.enviar('Emulation.setDeviceMetricsOverride', { width: lado.largura, height: lado.altura, deviceScaleFactor: 1, mobile: false });
  await pagina.enviar('Emulation.setCPUThrottlingRate', { rate: cpu });
  try {
    await pagina.avaliar('carregar()');
    const fimDoRegistro = Date.now() + 30000;
    const fim = Date.now() + prazoMin * 60000;
    let pedido = 0;
    let visto = '';
    for (;;) {
      pedido++;
      await pagina.avaliar(`pedirCenas(${pedido})`);
      let b = null;
      while (!(b = await pagina.avaliar(`palco.bancada[${pedido}] || null`))?.resultado && !b?.erro) {
        if (Date.now() > fim) throw new Error(`a rodada de ${lado.nome} passou de ${prazoMin} min`);
        const p = b?.progresso;
        const agora = p && p.cena ? `${p.feitas + 1} de ${p.total}: ${p.cena}` : '';
        if (agora && agora !== visto) { visto = agora; avisar(`  ${lado.nome}, cena ${agora}`); }
        await dormir(250);
      }
      if (b.erro) throw new Error(`as cenas de ${lado.nome} falharam: ${b.erro}`);
      if (b.resultado.cenas.length && paradaS > 0) b.resultado.cenas.push(await parada(pagina, paradaS));
      if (b.resultado.cenas.length || Date.now() > fimDoRegistro) return b.resultado;
      await dormir(300);
    }
  } finally {
    await pagina.enviar('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}

/**
 * A janela parada, na forma de uma cena. O id começa por um sublinhado, que o SDK recusa num id de
 * cena: nenhuma cena do app tem o mesmo. `zero` diz ao julgamento que qualquer valor na cabeça
 * reprova.
 */
async function parada(pagina, segundos) {
  const metricas = async () => Object.fromEntries((await pagina.enviar('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await dormir(segundos * 500);
  const antes = await metricas();
  await dormir(segundos * 1000);
  const depois = await metricas();
  return {
    id: '_parada',
    nome: 'A janela parada',
    medidas: {
      layouts: { rotulo: `layouts em ${segundos} s`, unidade: 'contagem', zero: true, valor: depois.LayoutCount - antes.LayoutCount },
      cpu: { rotulo: `CPU em ${segundos} s`, unidade: 'ms', informa: true, valor: (depois.TaskDuration - antes.TaskDuration) * 1000 },
    },
  };
}

// ─── O julgamento ────────────────────────────────────────────────────────────

const ordenados = (xs) => [...xs].sort((a, b) => a - b);
const mediana = (xs) => { const s = ordenados(xs); return s[Math.floor((s.length - 1) / 2)]; };
const p95 = (xs) => { const s = ordenados(xs); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const FOLGA_PADRAO = { ms: 0.5, razao: 0, contagem: 0 };

/** Cada medida de cada cena, com o que cada rodada deu, na ordem em que a cabeça as devolveu. */
function series(lado) {
  const m = new Map();
  for (const r of lado.rodadas) {
    for (const c of r.cenas) {
      if (c.pulada) continue;
      for (const [chave, d] of Object.entries(c.medidas)) {
        if (d.faltou) continue;
        const k = `${c.id}/${chave}`;
        if (!m.has(k)) m.set(k, { cena: c.nome, chave, def: d, valores: [], amostras: [] });
        const s = m.get(k);
        if (Array.isArray(d.amostras)) s.amostras.push(d.amostras);
        else s.valores.push(d.valor);
      }
    }
  }
  return m;
}

/** O espalhamento de uma lista de números em torno da mediana dela, como fração. */
const espalhamento = (xs) => { const md = mediana(xs); return md > 0 ? (Math.max(...xs) - Math.min(...xs)) / md : 0; };

/**
 * Cada medida das duas pontas, com o veredito. `base` e `cabeca` são `{ rodadas }`, com o que
 * `rodarCenas` devolveu em cada rodada.
 */
export function julgar(base, cabeca, tolerancia) {
  const a = series(base);
  const b = series(cabeca);
  const linhas = [];
  for (const [k, sb] of b) {
    const sa = a.get(k);
    if (!sa) continue;
    const { def } = sb;
    const rotulo = `${sb.cena}: ${def.rotulo || sb.chave}`;
    const folga = Number.isFinite(def.folga) ? def.folga : FOLGA_PADRAO[def.unidade] ?? 0;
    const juntas = sa.amostras.length && sb.amostras.length && !sa.valores.length && !sb.valores.length;
    const porRodada = (s) => (juntas ? s.amostras.map(p95) : s.valores);
    const ra = porRodada(sa);
    const rb = porRodada(sb);
    if (!ra.length || !rb.length) continue;
    const ma = juntas ? p95(sa.amostras.flat()) : mediana(ra);
    const mb = juntas ? p95(sb.amostras.flat()) : mediana(rb);
    const passou = (a, b) => b > a * (1 + tolerancia) && b - a > folga;
    const piorou = def.zero ? rb.some((x) => x > 0)
      : !def.informa && passou(ma, mb) && (juntas ? passou(mediana(ra), mediana(rb)) : mb > Math.max(...ra));
    linhas.push({
      cena: k.split('/')[0], medida: sb.chave, rotulo, unidade: def.unidade, informa: !!def.informa, juntas: !!juntas,
      base: ra, cabeca: rb, medianaBase: ma, medianaCabeca: mb, piorou,
      ruido: { entreLados: ma > 0 ? Math.abs(mb - ma) / ma : 0, rodadas: espalhamento([...ra, ...rb]) },
    });
  }
  return linhas;
}

const FORMATOS = {
  ms: (x) => (x >= 1000 ? `${(x / 1000).toFixed(2).replace('.', ',')} s` : `${x.toFixed(1).replace('.', ',')} ms`),
  razao: (x) => `${(x * 100).toFixed(1).replace('.', ',')}%`,
  contagem: (x) => String(Math.round(x)),
};
const porcento = (x) => `${Math.round(x * 100)}%`;

function tabela(linhas, aa) {
  const t = aa
    ? ['| medida | lado A | lado B | ruído entre os lados | espalhamento das rodadas | |', '|---|---|---|---|---|---|']
    : ['| medida | base | cabeça | |', '|---|---|---|---|'];
  for (const l of linhas) {
    const f = FORMATOS[l.unidade] || String;
    const faixa = (xs, m) => `${f(m)} (${xs.map(f).join(', ')})`;
    const marca = l.piorou ? 'piorou' : l.informa ? 'informa' : '';
    t.push(aa
      ? `| ${l.rotulo} | ${faixa(l.base, l.medianaBase)} | ${faixa(l.cabeca, l.medianaCabeca)} | ${porcento(l.ruido.entreLados)} | ${porcento(l.ruido.rodadas)} | ${marca} |`
      : `| ${l.rotulo} | ${faixa(l.base, l.medianaBase)} | ${faixa(l.cabeca, l.medianaCabeca)} | ${marca} |`);
  }
  return t.join('\n');
}

function resumir(titulo, texto) {
  console.log(texto);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${titulo}\n\n${texto}\n`);
}

// ─── O comando ───────────────────────────────────────────────────────────────

async function placaDa(pagina) {
  return pagina.avaliar(`(() => {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return 'sem WebGL';
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })()`);
}

async function main() {
  const op = argumentos(process.argv.slice(2));
  prepararTemporaria();
  if (!caminhoDoNavegador()) throw new Error('nenhum Chrome nesta máquina (VSSH_TEST_CHROME aponta um)');
  const navegador = await abrirNavegador({ placa: op.placa });
  try {
    return await medir(op, navegador);
  } finally {
    await navegador.fechar();
  }
}

async function medir(op, navegador) {
  const cpu = op.cpu === 'calibrar' ? await calibrar(navegador) : { multiplicador: Number(op.cpu) };
  if (op.modo === 'calibrar') {
    console.log(`CPU da página: ${cpu.indiceSemEstrangular} sem estrangular; com o multiplicador ${cpu.multiplicador}, ${cpu.indice} (o Celeron de referência é 100).`);
    return 0;
  }

  const app = resolve(op.app);
  const aa = op.modo === 'aa';
  const raizDaCabeca = op.cabeca ? resolve(op.cabeca) : app;
  const raizDaBase = aa ? raizDaCabeca : versao(app, op.base, 'base');
  const base = await prepararLado(aa ? 'A' : 'base', raizDaBase);
  const cabeca = await prepararLado(aa ? 'B' : 'cabeça', raizDaCabeca);

  const pagina = await navegador.novaPagina('about:blank');
  await pagina.enviar('Page.enable');
  await pagina.enviar('Performance.enable');
  await pagina.enviar('Page.bringToFront');
  const placa = await placaDa(pagina);
  let n = 0;
  const total = op.ciclos * 4;
  for (let c = 0; c < op.ciclos; c++) {
    for (const lado of [base, cabeca, cabeca, base]) {
      n++;
      avisar(`rodada ${n} de ${total}: ${lado.nome}`);
      const r = await rodada(pagina, lado, cpu.multiplicador, op.prazo, op.parada);
      if (!r.cenas.length) {
        if (lado === cabeca) throw new Error('a janela da cabeça não registrou nenhuma cena (vssh.desempenho.cenas)');
        resumir('Bancada do aparelho fraco', `A base \`${op.base}\` não registra cenas; não há o que comparar.\n`);
        return 0;
      }
      lado.rodadas.push(r);
    }
  }

  const linhas = julgar(base, cabeca, op.tolerancia);
  const cpuTexto = op.cpu === 'calibrar'
    ? `a CPU da página estrangulada ${cpu.multiplicador} vezes, que a leva de ${cpu.indiceSemEstrangular} a ${cpu.indice} (o Celeron de referência é 100)`
    : `a CPU da página estrangulada ${cpu.multiplicador} vezes`;
  const cabecalho = aa
    ? `A pasta \`${relative(process.cwd(), app) || '.'}\` contra ela mesma, ${op.ciclos * 2} rodadas de cada lado, alternadas, com ${cpuTexto}, na placa ${placa}.`
    : `Base \`${op.base}\` e cabeça \`${relative(process.cwd(), raizDaCabeca) || '.'}\`, ${op.ciclos * 2} rodadas de cada, alternadas, com ${cpuTexto}, na placa ${placa}.`;
  // O CDP recusa o estrangulamento num Worker ("only supported for pages"), e o que a janela manda a
  // um Worker roda aqui na velocidade da máquina: uma medida que espera por ele sai otimista, e
  // levar trabalho da página para um Worker parece de graça. A tabela diz quanto.
  const worker = cpu.indiceSemEstrangular
    ? ` Um Web Worker não é estrangulado: ele roda na velocidade desta máquina, ${cpu.indiceSemEstrangular} contra os 100 do Celeron, e uma medida que espera por ele sai otimista.`
    : ' Um Web Worker não é estrangulado: ele roda na velocidade desta máquina, e uma medida que espera por ele sai otimista.';
  const nota = `Cada célula é a mediana das rodadas, ou o p95 das amostras de todas as rodadas juntas quando a cena devolve amostras; entre parênteses, cada rodada.${worker}`;
  resumir(aa ? 'Bancada do aparelho fraco, A/A' : 'Bancada do aparelho fraco', `${cabecalho} ${nota}\n\n${tabela(linhas, aa)}\n`);
  if (op.saida) {
    mkdirSync(dirname(resolve(op.saida)), { recursive: true });
    writeFileSync(op.saida, `${JSON.stringify({ modo: op.modo, base: aa ? null : op.base, cpu, placa, tolerancia: op.tolerancia, linhas,
      rodadas: { base: base.rodadas, cabeca: cabeca.rodadas } }, null, 1)}\n`);
  }
  const pioras = linhas.filter((l) => l.piorou);
  for (const l of pioras) {
    const f = FORMATOS[l.unidade] || String;
    console.log(`::error::${l.rotulo}: ${f(l.medianaBase)} ${aa ? 'no lado A' : 'na base'}, ${f(l.medianaCabeca)} ${aa ? 'no lado B' : 'na cabeça'}`);
  }
  return pioras.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((codigo) => { limpar(); process.exit(codigo); }, (err) => {
    console.error(err.message);
    limpar();
    process.exit(2);
  });
}
