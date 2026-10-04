'use strict';

// As métricas e os erros do backend de um app, publicados no ambiente. O par de `vssh/metricas.py`.
//
// O app declara `recursos.metricas: true` no manifesto e recebe do portal, a cada subida,
// `VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN`. Com eles, este módulo manda ao portal o que o app conta,
// quanto as coisas levaram e as exceções que ele quer ver no log do ambiente:
//
//   const { metricas } = require('vssh');
//   metricas.contar('transcricoes', 1, { motor: 'whisperx', onde: 'fila' });
//   metricas.contar('audio_segundos', 312.5, { lingua: 'pt' });
//   await metricas.cronometrar('transcricao', { motor: 'whisperx' }, () => transcrever(arquivo));
//   try { exportar(doc); } catch (e) { metricas.relatarErro(e); throw e; }
//
// No portal, `contar` vira `vssh_app_events_total{app, event, ...}` e `duracao` vira
// `vssh_app_event_duration_seconds{app, event, ...}`. O erro vira uma linha do log do portal com a
// origem `backend`, o app, o servidor e a pessoa da credencial.
//
// Um rótulo diz de que tipo é o evento (o motor, a língua, onde rodou), e nunca quem o causou nem
// qual arquivo: até cinco por evento, a chave em minúsculas, o valor com até 64 letras, dígitos e
// `_.:+-`. O portal recusa a série nova quando o app passa de 300.
//
// Publicar nunca lança e nunca espera a rede. Os eventos se juntam na memória (os contadores
// somados por série) e saem a cada 10 s, num timer que não segura o processo, e quando o laço de
// eventos esvazia (`beforeExit`); um envio que falhou não volta. Um valor que não é número finito,
// ou um rótulo que não vira JSON, fica de fora na hora da chamada, e não no envio, onde levaria
// junto o lote inteiro. Sem a credencial nada é guardado nem sai, e `disponivel()` diz por quê.

const http = require('node:http');
const https = require('node:https');

const INTERVALO_MS = 10_000;
const TEMPO_HTTP_MS = 10_000;
const AGENTE = 'vssh-sdk-metricas/node';
const DURACOES_MAX = 2000;

const contadores = new Map();
const duracoes = [];
const erros = [];
let timer = null;

function credencial(env = process.env) {
  const url = (env.VSSH_PORTAL_URL || '').replace(/\/+$/, '');
  const token = env.VSSH_PORTAL_TOKEN || '';
  return url && token ? { url, token } : null;
}

/** `{ disponivel, motivo }`. Nunca lança e não fala com o portal. */
function disponivel(env = process.env) {
  return credencial(env)
    ? { disponivel: true, motivo: null }
    : { disponivel: false, motivo: 'o app não declarou recursos.metricas no manifesto (ou ainda não foi reiniciado)' };
}

function garantirTimer() {
  if (timer) return;
  timer = setInterval(() => { enviar().catch(() => {}); }, INTERVALO_MS);
  timer.unref();
}

const chave = (nome, rotulos) => JSON.stringify([nome, Object.entries(rotulos || {}).sort()]);
const numero = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Soma `valor` ao contador `nome` com estes `rotulos`. */
function contar(nome, valor = 1, rotulos = {}) {
  try {
    if (!numero(valor) || !credencial()) return;
    const k = chave(nome, rotulos);
    const atual = contadores.get(k);
    if (atual) atual.valor += valor;
    else contadores.set(k, { nome, tipo: 'contador', valor, rotulos: { ...rotulos } });
    garantirTimer();
  } catch { /* publicar não lança */ }
}

/** Registra que `nome` levou `segundos`. */
function duracao(nome, segundos, rotulos = {}) {
  try {
    if (!numero(segundos) || !credencial()) return;
    // Um rótulo que não vira JSON (um BigInt, um ciclo) lança aqui, e o evento fica de fora; no
    // envio, ele levaria junto o lote inteiro.
    chave(nome, rotulos);
    if (duracoes.length < DURACOES_MAX) duracoes.push({ nome, tipo: 'duracao', valor: segundos, rotulos: { ...rotulos } });
    garantirTimer();
  } catch { /* publicar não lança */ }
}

/** Roda `fn` e registra quanto ela levou, termine como terminar; devolve o que ela devolve. */
function cronometrar(nome, rotulos, fn) {
  const t0 = process.hrtime.bigint();
  const fim = () => duracao(nome, Number(process.hrtime.bigint() - t0) / 1e9, rotulos);
  let r;
  try { r = fn(); } catch (e) { fim(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(fim);
  fim();
  return r;
}

/** Manda uma exceção (ou um texto) ao log do ambiente. `tipo`: `erro` (padrão) ou `relatado`. */
function relatarErro(erro, tipo = 'erro') {
  try {
    if (!credencial()) return;
    const mensagem = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
    if (erros.length < 50) erros.push({ mensagem, pilha: erro instanceof Error ? erro.stack : undefined, tipo });
    garantirTimer();
  } catch { /* publicar não lança */ }
}

function postar(rota, corpo, env) {
  const cred = credencial(env);
  if (!cred) return Promise.resolve(false);
  let dados, u;
  try {
    dados = Buffer.from(JSON.stringify(corpo), 'utf8');
    u = new URL(cred.url + '/api/metricas' + rota);
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cred.token}`, 'content-type': 'application/json',
        'content-length': String(dados.length), 'user-agent': AGENTE,
      },
      timeout: TEMPO_HTTP_MS,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
    });
    req.on('timeout', () => req.destroy(new Error('o portal não respondeu a tempo')));
    req.on('error', () => resolve(false));
    req.end(dados);
  });
}

/** Manda agora o que está guardado. Resolve `true` quando nada falhou. */
async function enviar(env = process.env) {
  const eventos = [...contadores.values(), ...duracoes.splice(0)];
  contadores.clear();
  const errosAgora = erros.splice(0);
  let ok = true;
  for (let i = 0; i < eventos.length; i += 200) ok = (await postar('', { eventos: eventos.slice(i, i + 200) }, env)) && ok;
  for (let i = 0; i < errosAgora.length; i += 10) ok = (await postar('/erros', { erros: errosAgora.slice(i, i + 10) }, env)) && ok;
  return ok;
}

process.once('beforeExit', () => {
  if (contadores.size || duracoes.length || erros.length) enviar().catch(() => {});
});

module.exports = { disponivel, contar, duracao, cronometrar, relatarErro, enviar };
