'use strict';

// vssh.trabalhos: um trabalho longo que o app acompanha, na estação ou na fila, com a mesma cara.
// O par de `vssh/trabalhos.py`, com o mesmo registro em disco, os mesmos eventos e as mesmas regras.
//
//   const { trabalhos } = require('vssh');
//   const t = trabalhos.rodar('transcrever:3f2a', ['escriba-motor', '--entrada', a, '--saida', r],
//     { titulo: 'Entrevista 03.m4a', aoEvento: publicar });
//   const t2 = trabalhos.naFila('transcrever:3f2a', pedido, { titulo, aoEvento, linhas: true });
//   await t.esperar();   // o registro final
//   t.cancelar();
//
// `aoEvento(evento, registro)` recebe `estado`, `progresso`, `linha` (o stdout que não é progresso,
// com o texto em `registro.linha`), `saida` (na fila, com `saidasAoVivo` no pedido: uma saída que
// subiu com o job rodando, em `registro.saida`, com `nome` e `tamanho`) e `fim` (concluido, falhou
// ou cancelado, com `motivo` e `codigo`). Cada saída chega uma vez por acompanhamento; depois de um
// `retomar`, as que já tinham subido chegam de novo.
//
// Na estação, o comando sobe destacado do backend, por um executor (`vssh/executor.js`) que grava
// o stdout e o stderr dele em arquivos, num diretório do trabalho em
// `~/.cache/vssh/trabalhos/<id>/`. O backend segue o trabalho lendo esses arquivos. Cancelar manda
// SIGTERM ao grupo do comando e SIGKILL cinco segundos depois; as linhas de progresso viram a
// atividade na bandeja, e o fim vira notificação antes de a atividade sair. Na fila, a biblioteca
// não escreve atividade nem notificação, porque o portal já faz as duas coisas para o job.
//
// O registro de cada trabalho mora em `$VSSH_APP_DATA_DIR/trabalhos/<chave>.json`, e `retomar()`
// volta a seguir os que estavam em curso. Um da estação continua rodando sem o backend, porque o
// comando não é filho dele, e quem decide o que o backend que volta faz com ele é o `rodar`: com
// `retomavel: true`, o backend volta a segui-lo (lê os arquivos de onde tinha parado, e o fim que
// aconteceu com ele fora chega na volta, com a notificação); sem isso, que é o padrão, o trabalho é
// encerrado, para não segurar a GPU, e marcado como `falhou`. O app que retoma um trabalho precisa
// ter em `retomar` quem ouça os eventos dele. A posição lida é gravada depois da entrega, então uma
// linha pode chegar de novo depois de um reinício; com `retomar({ desdeOComeco: true })`, a saída
// inteira chega de novo, da primeira linha, para o app que refaz o que guardava na memória. Um trabalho cujo executor morreu sem escrever o
// fim termina em `falhou`. No registro, `pid` é o do comando, e `executor` é o do processo que o
// acompanha.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const app = require('./app.js');
const avisos = require('./avisos.js');
const fila = require('./fila.js');
const progresso = require('./progresso.js');

const FINAIS = ['concluido', 'falhou', 'cancelado'];
const CHAVE = /^[\w:.-]{1,64}$/;
// De quanto em quanto tempo o backend lê os arquivos de um trabalho da estação.
const VOLTA_MS = 250;
const EXECUTOR = path.join(__dirname, 'executor.js');

const emCurso = new Map();

const diretorio = (env) => path.join(app.dados(env), 'trabalhos');
const arquivo = (chave, env) => path.join(diretorio(env), `${chave}.json`);

function gravar(registro, env) {
  const alvo = arquivo(registro.chave, env);
  try {
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(`${alvo}.tmp`, JSON.stringify(registro));
    fs.renameSync(`${alvo}.tmp`, alvo);
  } catch (e) {
    console.warn(`[vssh.trabalhos] não foi possível gravar ${alvo}: ${e.message}`);
  }
}

/** O registro gravado de um trabalho, ou `null`. */
function estado(chave, env = process.env) {
  try {
    const r = JSON.parse(fs.readFileSync(arquivo(chave, env), 'utf8'));
    return r && typeof r === 'object' ? r : null;
  } catch { return null; }
}

/** Os registros gravados, do mais novo ao mais velho. */
function listar(env = process.env) {
  let nomes = [];
  try { nomes = fs.readdirSync(diretorio(env)).filter((n) => n.endsWith('.json')); } catch { return []; }
  return nomes.map((n) => estado(n.slice(0, -5), env)).filter(Boolean)
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
}

function sinalizarGrupo(pid, sinal) {
  try { process.kill(-pid, sinal); } catch { /* o grupo já acabou */ }
}

class Trabalho {
  constructor(registro, aoEvento, env) {
    this.chave = registro.chave;
    this._reg = registro;
    this._aoEvento = aoEvento;
    this._env = env;
    this._cancelado = false;
    this._fim = new Promise((resolve) => { this._resolver = resolve; });
    this._terminado = FINAIS.includes(registro.estado);
    if (this._terminado) this._resolver({ ...registro });
  }

  estado() { return { ...this._reg }; }

  /** O registro final. */
  esperar() { return this._fim; }

  /**
   * Pede o fim. Na estação, o executor manda SIGTERM ao grupo do comando e SIGKILL depois; na
   * fila, é o cancelar do portal.
   */
  cancelar() {
    if (this._terminado) return false;
    this._cancelado = true;
    if (this._reg.onde === 'estacao' && this._reg.dir) {
      try { fs.writeFileSync(path.join(this._reg.dir, 'cancel'), ''); } catch { return false; }
    } else if (this._reg.onde === 'fila' && this._reg.job) {
      fila.cancelar(this._reg.job, this._env).catch(() => {});
    }
    return true;
  }

  _mudar(evento, campos) {
    Object.assign(this._reg, campos);
    const registro = { ...this._reg };
    gravar(registro, this._env);
    if (evento && this._aoEvento) {
      try { this._aoEvento(evento, registro); } catch (e) { console.warn(`[vssh.trabalhos] aoEvento(${evento}) de ${this.chave} falhou: ${e.message}`); }
    }
    return registro;
  }

  _linha(texto) {
    if (!this._aoEvento) return;
    try { this._aoEvento('linha', { ...this._reg, linha: texto }); } catch (e) { console.warn(`[vssh.trabalhos] aoEvento(linha) de ${this.chave} falhou: ${e.message}`); }
  }

  _saida(saida) {
    if (!this._aoEvento) return;
    try { this._aoEvento('saida', { ...this._reg, saida: { ...saida } }); } catch (e) { console.warn(`[vssh.trabalhos] aoEvento(saida) de ${this.chave} falhou: ${e.message}`); }
  }

  // Grava o fim, faz o que precisa estar feito antes de alguém saber dele (a notificação e a
  // atividade), e só então avisa o app e solta quem espera. Na ordem inversa, um backend que
  // encerra logo depois de `esperar()` perderia a notificação.
  _terminar(estadoFinal, motivo = null, codigo = null, antesDeAnunciar = null) {
    if (emCurso.get(this.chave) === this) emCurso.delete(this.chave);
    this._terminado = true;
    const registro = this._mudar(null, { estado: estadoFinal, motivo, codigo, terminadoEm: Date.now() });
    if (antesDeAnunciar) {
      try { antesDeAnunciar(registro); } catch (e) { console.warn(`[vssh.trabalhos] o fim de ${this.chave} não foi registrado: ${e.message}`); }
    }
    if (this._aoEvento) {
      try { this._aoEvento('fim', { ...registro }); } catch (e) { console.warn(`[vssh.trabalhos] aoEvento(fim) de ${this.chave} falhou: ${e.message}`); }
    }
    this._resolver(registro);
    return registro;
  }
}

function registrar(chave, onde, titulo, extra) {
  if (typeof chave !== 'string' || !CHAVE.test(chave)) {
    throw new Error(`chave de trabalho inválida (use letras, números, ":", "." e "-", até 64): ${chave}`);
  }
  const vivo = emCurso.get(chave);
  if (vivo && !vivo._terminado) throw new Error(`já há um trabalho em curso com a chave ${chave}`);
  return {
    chave, titulo: titulo || chave, onde, estado: onde === 'fila' ? 'enviando' : 'rodando',
    progresso: null, motivo: null, codigo: null, criadoEm: Date.now(), terminadoEm: null, ...extra,
  };
}

function notificarFim(reg, opcaoRegistrar, acoes, rota, abrir, env) {
  if (opcaoRegistrar === false || reg.estado === 'cancelado') return;   // quem cancelou já sabe
  let corpo;
  if (typeof opcaoRegistrar === 'function') corpo = opcaoRegistrar(reg);
  else if (reg.estado === 'concluido') corpo = { titulo: reg.titulo, texto: 'Terminou.', level: 'success' };
  else corpo = { titulo: reg.titulo, texto: reg.motivo || 'Falhou.', level: 'error' };
  if (!corpo) return;
  avisos.notificar(corpo.texto || '', {
    titulo: corpo.titulo, nivel: corpo.level, chave: `trabalho:${reg.chave}:${reg.criadoEm}`, acoes, rota, abrir, env,
  });
}

// ── Na estação ──────────────────────────────────────────────────────────────────────────────

/** Onde moram os diretórios dos trabalhos da estação: `~/.cache/vssh/trabalhos`. */
function base(env) {
  let home = env.HOME;
  if (!home && env.VSSH_APP_DATA_DIR) home = path.resolve(env.VSSH_APP_DATA_DIR, '..', '..', '..');
  return path.join(home || os.homedir(), '.cache', 'vssh', 'trabalhos');
}

const novoId = () => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

// O instante em que o processo nasceu, em tiques desde o boot (campo 22 de `/proc/<pid>/stat`), ou
// `null` fora do Linux. O nome do processo vem entre parênteses e pode ter espaço, então a
// contagem começa depois do último `)`.
function nascimento(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19] || null;
  } catch { return null; }
}

// O executor do trabalho em `d` ainda roda? O pid está de pé e é o do processo que nasceu quando o
// trabalho foi disparado: o kernel reaproveita o número de um processo que morreu.
function executorVivo(d) {
  try {
    const [pid, nasceu] = fs.readFileSync(path.join(d, 'pid'), 'utf8').trim().split(/\s+/);
    process.kill(Number(pid), 0);
    return !nasceu || nascimento(Number(pid)) === nasceu;
  } catch { return false; }
}

// O grupo de processos do comando do trabalho em `d`, se ele ainda é o que nasceu ali: o
// nascimento gravado garante que não é o de outro processo que herdou o número. `null` quando o
// comando não subiu ou já saiu.
function grupoDoComando(d) {
  try {
    const [grupo, nasceu] = fs.readFileSync(path.join(d, 'grupo'), 'utf8').trim().split(/\s+/);
    if (nasceu && nascimento(Number(grupo)) === nasceu) return Number(grupo);
  } catch { /* sem o arquivo, o comando nem chegou a subir */ }
  return null;
}

// O executor morreu sem escrever o fim (um SIGKILL, a memória acabou), e o comando ficou sem
// ninguém: ele é encerrado, para não segurar a GPU.
function encerrarOrfao(d) {
  const grupo = grupoDoComando(d);
  if (grupo !== null) sinalizarGrupo(grupo, 'SIGKILL');
}

// Encerra de vez o trabalho em `d`: o executor primeiro, para ele não escrever um fim, e o comando
// depois.
function encerrar(d) {
  if (executorVivo(d)) {
    try { process.kill(Number(fs.readFileSync(path.join(d, 'pid'), 'utf8').trim().split(/\s+/)[0]), 'SIGKILL'); } catch { /* já saiu */ }
  }
  encerrarOrfao(d);
}

function pidDoComando(d) {
  try { return Number(fs.readFileSync(path.join(d, 'grupo'), 'utf8').trim().split(/\s+/)[0]) || null; } catch { return null; }
}

function lerJson(caminho) {
  try {
    const r = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    return r && typeof r === 'object' ? r : null;
  } catch { return null; }
}

function posicaoLida(d) {
  try { return Number(fs.readFileSync(path.join(d, 'lido'), 'utf8').trim()) || 0; } catch { return 0; }
}

// Entrega ao app o que o comando escreveu desde `posicao`, e devolve a posição nova. Sem `tudo`,
// uma linha que ainda não terminou espera a volta seguinte.
function entregar(t, d, posicao, tudo) {
  let novo;
  try {
    const fd = fs.openSync(path.join(d, 'saida'), 'r');
    try {
      const tamanho = fs.fstatSync(fd).size - posicao;
      if (tamanho <= 0) return posicao;
      novo = Buffer.alloc(tamanho);
      fs.readSync(fd, novo, 0, tamanho, posicao);
    } finally { fs.closeSync(fd); }
  } catch { return posicao; }
  if (!tudo) novo = novo.subarray(0, novo.lastIndexOf(0x0a) + 1);
  if (!novo.length) return posicao;
  const linhas = novo.toString('utf8').split('\n');
  if (linhas.at(-1) === '') linhas.pop();
  for (const bruta of linhas) {
    const linha = bruta.replace(/\r$/, '');
    const p = progresso.ler(linha);
    if (p) t._mudar('progresso', { progresso: p });
    else t._linha(linha);
  }
  const lida = posicao + novo.length;
  try {
    fs.writeFileSync(path.join(d, 'lido.tmp'), String(lida));
    fs.renameSync(path.join(d, 'lido.tmp'), path.join(d, 'lido'));
  } catch { /* a posição fica na memória; depois de um reinício as linhas chegam de novo */ }
  return lida;
}

// Lê os arquivos do trabalho até o fim dele, e então grava o fim, notifica, tira a atividade e
// apaga o diretório. `processo` é o executor quando foi este backend que o subiu.
function seguirNaEstacao(t, processo, fimDe, env, desdeOComeco = false) {
  const d = t._reg.dir;
  let posicao = desdeOComeco ? 0 : posicaoLida(d);
  let saiu = false;
  if (processo) {
    processo.on('exit', () => { saiu = true; });
    processo.on('error', () => { saiu = true; });
  }
  const volta = () => {
    if (t._reg.pid === null || t._reg.pid === undefined) {
      const pid = pidDoComando(d);
      if (pid !== null) t._mudar(null, { pid });
    }
    // O fim é conferido antes da leitura: o que o comando escreveu até sair entra nela.
    let acabou = fs.existsSync(path.join(d, 'exit'));
    let vivo = false;
    if (!acabou) {
      vivo = processo ? !saiu : executorVivo(d);
      if (!vivo) acabou = fs.existsSync(path.join(d, 'exit'));   // escrito entre as duas leituras
    }
    posicao = entregar(t, d, posicao, acabou || !vivo);
    if (!acabou && vivo) { setTimeout(volta, VOLTA_MS); return; }
    if (!acabou) encerrarOrfao(d);
    const fim = (acabou && lerJson(path.join(d, 'fim.json')))
      || { estado: 'falhou', codigo: null, motivo: 'o trabalho parou antes de terminar' };
    t._terminar(FINAIS.includes(fim.estado) ? fim.estado : 'falhou', fim.motivo ?? null, fim.codigo ?? null, (registro) => {
      notificarFim(registro, fimDe.registrar ?? true, fimDe.acoes, fimDe.rota, fimDe.abrir, env);
      avisos.limparAtividade(t.chave, { env });
      fs.rmSync(d, { recursive: true, force: true });
    });
  };
  setTimeout(volta, 0);
}

// ── A peça de baixo: disparar um comando destacado, e perguntar por ele ────────────────────────
//
// `rodar` é isto mais o registro, os eventos e a notificação. Quem já tem o próprio jeito de contar
// o que acontece usa só esta parte: o disparo, a marca de quem está vivo e o fim.

/**
 * Sobe `comando` (um array) destacado, por um executor, num diretório de trabalho novo. Devolve
 * `{ dir, processo }`, com o processo do executor.
 *
 * Opções: `base` (onde o diretório nasce; `~/.cache/vssh/trabalhos` por padrão), `cwd`,
 * `ambiente` (o do comando; pode levar uma credencial, vai ao executor pelo stdin e não toca o
 * disco), `pedido` (os campos a mais do `pedido.json`: com `chave` e `titulo` o executor mantém a
 * atividade do trabalho na bandeja, e `atividade: false` a desliga), `arquivos` (`{ nome: texto }`,
 * gravados no diretório antes de o comando subir) e `env`. O comando recebe o diretório em
 * `VSSH_TRABALHO_DIR`.
 */
function disparar(comando, opcoes = {}) {
  const env = opcoes.env || process.env;
  const d = path.join(opcoes.base || base(env), novoId());
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  let processo;
  try {
    for (const [nome, texto] of Object.entries(opcoes.arquivos || {})) fs.writeFileSync(path.join(d, path.basename(nome)), texto);
    fs.writeFileSync(path.join(d, 'pedido.json'), JSON.stringify({
      ...(opcoes.pedido || {}), app: env.VSSH_APP_ID ?? null, comando: [...comando], cwd: opcoes.cwd ?? null,
    }));
    // O executor roda com o ambiente de quem dispara (é dele a atividade na bandeja), e recebe o do
    // comando pelo stdin. Sessão própria: ele não morre com quem o disparou.
    processo = spawn(process.execPath, [EXECUTOR, d], { env, stdio: ['pipe', 'ignore', 'ignore'], detached: true });
  } catch (e) {
    fs.rmSync(d, { recursive: true, force: true });
    throw e;
  }
  const nasceu = processo.pid ? nascimento(processo.pid) : null;
  fs.writeFileSync(path.join(d, 'pid'), nasceu ? `${processo.pid} ${nasceu}` : String(processo.pid ?? ''));
  processo.stdin.on('error', () => { /* o executor morreu antes de ler: quem acompanha vê o trabalho parado, sem fim */ });
  processo.stdin.end(JSON.stringify({ ambiente: opcoes.ambiente ?? null }));
  processo.unref();
  return { dir: d, processo };
}

/** O trabalho do diretório `d` ainda roda: não escreveu o fim, e o executor dele está de pé. */
const estaVivo = (d) => !fs.existsSync(path.join(d, 'exit')) && executorVivo(d);

/**
 * O fim do trabalho em `d` (`estado`, `codigo`, `motivo`, `terminadoEm`), ou `null` enquanto ele
 * não terminou de escrevê-lo.
 */
const fimDoTrabalho = (d) => (fs.existsSync(path.join(d, 'exit')) ? lerJson(path.join(d, 'fim.json')) : null);

/**
 * Sobe `comando` (um array) destacado do backend e o acompanha. Devolve o `Trabalho`.
 *
 * Opções: `titulo`, `aoEvento`, `cwd`, `ambiente` (o do processo; o do app por padrão),
 * `registrar` (`true`, `false` ou `(registro) => ({ titulo, texto, level })`), `acoes`, `rota` e
 * `abrir` (os de `avisos.notificar`: botões na notificação, e o caminho dentro do app aonde o
 * clique nela leva), `retomavel` (com `true`, o `retomar()` de um backend que reiniciou volta a
 * seguir o trabalho; sem ele, o `retomar()` o encerra), `env`. O que não é função fica gravado com
 * o trabalho, e vale também depois de um `retomar`.
 */
function rodar(chave, comando, opcoes = {}) {
  const env = opcoes.env || process.env;
  const reg = registrar(chave, 'estacao', opcoes.titulo, { pid: null, executor: null, dir: null, retomavel: !!opcoes.retomavel });
  const opcaoRegistrar = opcoes.registrar ?? true;
  const notificacao = {
    registrar: typeof opcaoRegistrar === 'function' ? 'funcao' : !!opcaoRegistrar,
    acoes: opcoes.acoes ?? null, rota: opcoes.rota ?? null, abrir: opcoes.abrir ?? null,
  };
  const { dir: d, processo } = disparar(comando, {
    cwd: opcoes.cwd, ambiente: opcoes.ambiente, env,
    pedido: { chave, titulo: reg.titulo, notificacao, criadoEm: reg.criadoEm },
  });
  const t = new Trabalho({ ...reg, dir: d }, opcoes.aoEvento, env);
  emCurso.set(chave, t);
  t._mudar(null, { executor: processo.pid ?? null });
  seguirNaEstacao(t, processo, { registrar: opcaoRegistrar, acoes: opcoes.acoes, rota: opcoes.rota, abrir: opcoes.abrir }, env);
  return t;
}

/** Submete `pedido` à fila (o formato de `fila.submeter`) e o acompanha. Devolve o `Trabalho`. */
function naFila(chave, pedido, opcoes = {}) {
  const env = opcoes.env || process.env;
  const t = new Trabalho(registrar(chave, 'fila', opcoes.titulo, { job: null }), opcoes.aoEvento, env);
  emCurso.set(chave, t);
  t._mudar('estado', {});
  (async () => {
    let id;
    try { id = await fila.submeter(pedido, undefined, env); } catch (e) { t._terminar('falhou', e.mensagem || e.message); return; }
    t._mudar('estado', { job: id, estado: 'enviado' });
    if (t._cancelado) t.cancelar();
    await seguir(t, !!opcoes.linhas, env);
  })();
  return t;
}

async function seguir(t, linhas, env) {
  const id = t._reg.job;
  const vistas = new Set();
  const saidas = new Set();
  let seguindoLog = false;

  const seguirLog = async () => {
    // O log reabre se o stream cair com o job ainda rodando, e o portal manda de novo as últimas
    // linhas: as já entregues não saem duas vezes.
    while (!t._terminado) {
      try {
        for await (const linha of fila.log(id, env)) {
          if (vistas.has(linha) || progresso.ler(linha)) continue;
          vistas.add(linha);
          if (vistas.size > 2000) vistas.delete(vistas.values().next().value);
          t._linha(linha);
        }
      } catch { /* o stream caiu: tenta de novo enquanto o job roda */ }
      if (t._terminado) return;
      await new Promise((r) => setTimeout(r, 3000).unref());
    }
  };

  const aoEvento = (evento, job) => {
    if (evento === 'estado') {
      t._mudar('estado', { estado: job.estado || t._reg.estado, motivo: job.motivo ?? null });
      if (linhas && job.estado === 'rodando' && !seguindoLog) { seguindoLog = true; seguirLog(); }
    } else if (evento === 'progresso' && job.progresso) {
      const p = job.progresso;
      t._mudar('progresso', { progresso: { feito: p.feito, total: p.total ?? null, etapa: p.etapa ?? null } });
    } else if (evento === 'saida' && job.saida && !saidas.has(job.saida.nome)) {
      saidas.add(job.saida.nome);
      t._saida(job.saida);
    }
  };

  let final;
  try { final = await fila.acompanhar(id, aoEvento, env); } catch (e) { t._terminar('falhou', e.mensagem || e.message); return; }
  t._terminar(final.estado || 'falhou', final.motivo ?? null, final.exit ?? null);
}

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Um diretório de trabalho sem registro em curso é sobra: o app apagou o registro, ou caiu entre
// criar o diretório e gravá-lo. A hora de espera cobre um `rodar` que está nesse intervalo agora.
const SOBRA_MS = 60 * 60 * 1000;

/** Apaga os diretórios deste app que nenhum registro em curso segue e cujo executor já saiu. */
function faxina(env) {
  const raiz = base(env);
  const seguidos = new Set(listar(env).filter((r) => !FINAIS.includes(r.estado)).map((r) => r.dir));
  let nomes = [];
  try { nomes = fs.readdirSync(raiz); } catch { return; }
  for (const nome of nomes) {
    const d = path.join(raiz, nome);
    if (seguidos.has(d) || ((lerJson(path.join(d, 'pedido.json')) || {}).app ?? null) !== (env.VSSH_APP_ID ?? null)) continue;
    try {
      if (fs.statSync(d).mtimeMs >= Date.now() - SOBRA_MS) continue;
      if (!fs.existsSync(path.join(d, 'exit')) && executorVivo(d)) continue;
    } catch { continue; }
    fs.rmSync(d, { recursive: true, force: true });
  }
}

/**
 * Volta a seguir os trabalhos que estavam em curso: os da fila, e os da estação que o `rodar`
 * marcou com `retomavel: true`. Os outros da estação são encerrados. Devolve os `Trabalho`
 * retomados. Chame no boot do backend, antes de servir. `registrar` é a função da notificação do
 * fim para os trabalhos da estação que tinham uma (`rodar` não tem como gravá-la); sem ela, o
 * fim desses escreve a notificação padrão. Com `desdeOComeco`, a saída de cada trabalho da estação
 * chega de novo da primeira linha, e não de onde o backend anterior parou.
 */
function retomar(opcoes = {}) {
  const env = opcoes.env || process.env;
  const retomados = [];
  for (const reg of listar(env)) {
    if (FINAIS.includes(reg.estado) || emCurso.has(reg.chave)) continue;
    const t = new Trabalho(reg, opcoes.aoEvento, env);
    if (reg.onde === 'fila' && reg.job) {
      emCurso.set(t.chave, t);
      seguir(t, !!opcoes.linhas, env);
      retomados.push(t);
    } else if (reg.onde === 'estacao' && reg.retomavel && reg.dir && fs.existsSync(reg.dir)) {
      const fimDe = { ...((lerJson(path.join(reg.dir, 'pedido.json')) || {}).notificacao || {}) };
      if (fimDe.registrar === 'funcao') fimDe.registrar = typeof opcoes.registrar === 'function' ? opcoes.registrar : true;
      emCurso.set(t.chave, t);
      seguirNaEstacao(t, null, fimDe, env, !!opcoes.desdeOComeco);
      retomados.push(t);
    } else {
      // O trabalho da estação que o app não pediu para retomar é encerrado, para não segurar a
      // GPU. Um sem diretório é de um runtime anterior, em que o comando era filho do backend e o
      // `pid` gravado era o dele.
      const d = reg.onde === 'estacao' ? reg.dir : null;
      if (d && fs.existsSync(d)) encerrar(d);
      else if (reg.onde === 'estacao' && !d && reg.pid && vivo(reg.pid)) sinalizarGrupo(reg.pid, 'SIGKILL');
      t._terminar('falhou', reg.onde === 'estacao' ? 'o app reiniciou no meio' : 'o envio à fila foi interrompido', null, () => {
        avisos.limparAtividade(t.chave, { env });
        if (d) fs.rmSync(d, { recursive: true, force: true });
      });
    }
  }
  faxina(env);
  return retomados;
}

module.exports = {
  rodar, naFila, estado, listar, retomar, Trabalho, FINAIS,
  // A peça de baixo. `grupo(d)` é o grupo de processos do comando, ou `null` quando ele não subiu
  // ou já saiu: é o que se leva a `nice` 19 para o trabalho ceder a vez.
  disparar, vivo: estaVivo, grupo: grupoDoComando, fim: fimDoTrabalho,
  // Encerra de vez o trabalho em `d`, sem esperar o comando limpar nada: o executor, e o grupo do
  // comando. Quem quer que o comando saia por conta própria escreve o arquivo `cancel`.
  encerrar,
  _nascimento: nascimento,
};
