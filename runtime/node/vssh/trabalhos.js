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
// com o texto em `registro.linha`) e `fim` (concluido, falhou ou cancelado, com `motivo` e
// `codigo`).
//
// Na estação, o processo sobe num grupo próprio, e cancelar manda SIGTERM ao grupo e SIGKILL cinco
// segundos depois; as linhas de progresso viram a atividade na bandeja, e o fim vira notificação
// antes de a atividade sair. Na fila, a biblioteca não escreve atividade nem notificação, porque o
// portal já faz as duas coisas para o job. O registro de cada trabalho mora em
// `$VSSH_APP_DATA_DIR/trabalhos/<chave>.json`, e `retomar()` volta a seguir os da fila depois de um
// reinício e encerra os da estação, que perderam o stdout.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const app = require('./app.js');
const avisos = require('./avisos.js');
const fila = require('./fila.js');
const progresso = require('./progresso.js');

const FINAIS = ['concluido', 'falhou', 'cancelado'];
const CHAVE = /^[\w:.-]{1,64}$/;
const ESPERA_DO_SIGKILL_MS = 5000;
const INTERVALO_DA_ATIVIDADE_MS = 500;

const emCurso = new Map();
let pararRenovacao = null;

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
    this._processo = null;
    this._ultimaAtividade = 0;
    this._fim = new Promise((resolve) => { this._resolver = resolve; });
    this._terminado = FINAIS.includes(registro.estado);
    if (this._terminado) this._resolver({ ...registro });
  }

  estado() { return { ...this._reg }; }

  /** O registro final. */
  esperar() { return this._fim; }

  /** Pede o fim. Na estação, SIGTERM ao grupo e SIGKILL depois; na fila, o cancelar do portal. */
  cancelar() {
    if (this._terminado) return false;
    this._cancelado = true;
    if (this._reg.onde === 'estacao' && this._processo) {
      const p = this._processo;
      sinalizarGrupo(p.pid, 'SIGTERM');
      setTimeout(() => { if (p.exitCode === null && p.signalCode === null) sinalizarGrupo(p.pid, 'SIGKILL'); }, ESPERA_DO_SIGKILL_MS).unref();
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

function itemDaAtividade(reg) {
  const p = reg.progresso || {};
  return {
    titulo: reg.titulo,
    texto: p.etapa || 'Rodando',
    formato: 'progresso',
    progresso: p.total ? { feito: p.feito, total: p.total } : { indeterminado: true },
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

/**
 * Sobe `comando` (um array) e o acompanha. Devolve o `Trabalho`.
 *
 * Opções: `titulo`, `aoEvento`, `cwd`, `ambiente` (o do processo; o do app por padrão),
 * `registrar` (`true`, `false` ou `(registro) => ({ titulo, texto, level })`), `acoes`, `rota` e
 * `abrir` (os de `avisos.notificar`: botões na notificação, e o caminho dentro do app aonde o
 * clique nela leva), `env`.
 */
function rodar(chave, comando, opcoes = {}) {
  const env = opcoes.env || process.env;
  const t = new Trabalho(registrar(chave, 'estacao', opcoes.titulo, { pid: null }), opcoes.aoEvento, env);
  const [exe, ...args] = comando;
  const processo = spawn(exe, args, {
    cwd: opcoes.cwd, env: opcoes.ambiente || process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  t._processo = processo;
  emCurso.set(chave, t);
  t._mudar(null, { pid: processo.pid ?? null });
  if (!pararRenovacao) pararRenovacao = avisos.manterAtividadesVivas(env);
  avisos.atividade(chave, itemDaAtividade(t._reg), env);

  const erros = [];
  readline.createInterface({ input: processo.stderr }).on('line', (linha) => {
    if (linha.trim()) { erros.push(linha); if (erros.length > 20) erros.shift(); }
  });
  const saida = readline.createInterface({ input: processo.stdout });
  saida.on('line', (linha) => {
    const p = progresso.ler(linha);
    if (!p) { t._linha(linha); return; }
    const registro = t._mudar('progresso', { progresso: p });
    const agora = Date.now();
    if (agora - t._ultimaAtividade >= INTERVALO_DA_ATIVIDADE_MS) {
      t._ultimaAtividade = agora;
      avisos.atividade(chave, itemDaAtividade(registro), env);
    }
  });

  let saidaFechou = new Promise((r) => saida.on('close', r));
  let terminou = false;
  // Um `spawn` que falha emite `error` e depois `close`; o trabalho termina uma vez só.
  const terminar = (codigo, motivoDeSpawn) => {
    if (terminou) return;
    terminou = true;
    saidaFechou.then(() => {
      let estadoFinal = 'concluido';
      let motivo = null;
      if (t._cancelado) estadoFinal = 'cancelado';
      else if (motivoDeSpawn) { estadoFinal = 'falhou'; motivo = motivoDeSpawn; }
      else if (codigo !== 0) { estadoFinal = 'falhou'; motivo = erros.at(-1) || `saiu com o código ${codigo}`; }
      t._terminar(estadoFinal, motivo, codigo, (registro) => {
        notificarFim(registro, opcoes.registrar ?? true, opcoes.acoes, opcoes.rota, opcoes.abrir, env);
        avisos.limparAtividade(chave, { env });
      });
    });
  };
  processo.on('error', (e) => { saidaFechou = Promise.resolve(); terminar(null, `não consegui rodar ${exe}: ${e.message}`); });
  processo.on('close', (codigo) => terminar(codigo));
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
    }
  };

  let final;
  try { final = await fila.acompanhar(id, aoEvento, env); } catch (e) { t._terminar('falhou', e.mensagem || e.message); return; }
  t._terminar(final.estado || 'falhou', final.motivo ?? null, final.exit ?? null);
}

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Volta a seguir os trabalhos da fila que estavam em curso, e encerra os da estação. Devolve os
 * `Trabalho` retomados. Chame no boot do backend, antes de servir.
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
    } else {
      if (reg.pid && vivo(reg.pid)) sinalizarGrupo(reg.pid, 'SIGKILL');
      t._terminar('falhou', reg.onde === 'estacao' ? 'o app reiniciou no meio' : 'o envio à fila foi interrompido', null,
        () => avisos.limparAtividade(t.chave, { env }));
    }
  }
  return retomados;
}

module.exports = { rodar, naFila, estado, listar, retomar, Trabalho, FINAIS };
