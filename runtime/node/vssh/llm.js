'use strict';

// Os modelos da instituição para o backend de um app, pelo `llm/v1` do portal. O par de
// `vssh/llm.py`. O contrato está em docs/llm.md do vssh-sso.
//
// O app declara `recursos.llm: true` no manifesto e recebe do portal, a cada subida,
// `VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN`. Este módulo só monta o pedido a `/api/llm/v1/` e lê a
// resposta; quem põe a chave do gateway e escolhe o modelo do momento é o portal.
//
//   const { llm } = require('vssh');
//   const r = await llm.conversar({ model: 'conversa', messages: [{ role: 'user', content: 'Olá' }] });
//   console.log(r.choices[0].message.content);
//
//   for await (const pedaco of llm.fluxo({ model: 'conversa', messages })) {
//     process.stdout.write(pedaco.choices?.[0]?.delta?.content ?? '');
//   }
//
//   const { data } = await llm.embeddings({ model: 'embeddings', input: ['teoria crítica'] });
//   const { data: modelos } = await llm.modelos();
//
// Um erro do contrato chega como `ErroDoLlm`, com o `codigo` estável (`teto_atingido`,
// `muitos_pedidos`, `sem_escopo`…), o `status` e o `depoisDe` do `Retry-After`, em segundos.

const http = require('node:http');
const https = require('node:https');

const AGENTE = 'vssh-sdk-llm/node';

class ErroDoLlm extends Error {
  constructor(codigo, mensagem, status = 0, depoisDe = null) {
    super(mensagem);
    this.name = 'ErroDoLlm';
    this.codigo = codigo;
    this.status = status;
    this.depoisDe = depoisDe;
  }
}

function credencial(env = process.env) {
  const url = (env.VSSH_PORTAL_URL || '').replace(/\/+$/, '');
  const token = env.VSSH_PORTAL_TOKEN || '';
  return url && token ? { url, token } : null;
}

/** `{ disponivel, motivo }`. Nunca lança e não fala com o portal. */
function disponivel(env = process.env) {
  return credencial(env)
    ? { disponivel: true, motivo: null }
    : { disponivel: false, motivo: 'o app não declarou recursos.llm no manifesto (ou ainda não foi reiniciado)' };
}

function _erroDaResposta(status, texto, cabecalhos) {
  let corpo = null;
  try { corpo = JSON.parse(texto); } catch { /* o corpo de erro do contrato é JSON; outro texto vira a mensagem */ }
  const e = corpo?.error || {};
  const depois = Number(cabecalhos?.['retry-after']);
  return new ErroDoLlm(e.code || 'pedido_invalido', e.message || texto || `o portal respondeu ${status}`, status,
    Number.isFinite(depois) ? depois : null);
}

/** Abre o pedido e resolve com a resposta HTTP, sem ler o corpo. */
function _pedir(metodo, verbo, corpo, { env = process.env, signal } = {}) {
  const cred = credencial(env);
  if (!cred) return Promise.reject(new ErroDoLlm('sem_escopo', disponivel(env).motivo, 0));
  const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo), 'utf8');
  const u = new URL(`${cred.url}/api/llm/v1/${verbo}`);
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: metodo,
      signal,
      headers: {
        authorization: `Bearer ${cred.token}`, 'user-agent': AGENTE,
        ...(dados ? { 'content-type': 'application/json', 'content-length': String(dados.length) } : {}),
      },
    }, resolve);
    req.on('error', reject);
    req.end(dados ?? undefined);
  });
}

function _texto(res) {
  return new Promise((resolve, reject) => {
    const partes = [];
    res.on('data', (p) => partes.push(p));
    res.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    res.on('error', reject);
  });
}

async function _json(metodo, verbo, corpo, opcoes) {
  const res = await _pedir(metodo, verbo, corpo, opcoes);
  const texto = await _texto(res);
  if (res.statusCode < 200 || res.statusCode >= 300) throw _erroDaResposta(res.statusCode, texto, res.headers);
  return JSON.parse(texto);
}

/** `POST chat/completions` sem fluxo. Resolve com a resposta inteira, no formato da OpenAI. */
function conversar(pedido, opcoes) {
  return _json('POST', 'chat/completions', { ...pedido, stream: false }, opcoes);
}

/**
 * `POST chat/completions` com fluxo: um iterador assíncrono de pedaços (`choices[0].delta`), até o
 * `[DONE]`. O último pedaço antes do fim traz o `usage`. Um erro no meio do fluxo lança `ErroDoLlm`.
 */
async function* fluxo(pedido, opcoes) {
  const res = await _pedir('POST', 'chat/completions', { ...pedido, stream: true }, opcoes);
  if (res.statusCode < 200 || res.statusCode >= 300) throw _erroDaResposta(res.statusCode, await _texto(res), res.headers);
  res.setEncoding('utf8');
  let sobra = '';
  for await (const parte of res) {
    sobra += parte;
    let corte;
    while ((corte = sobra.indexOf('\n')) >= 0) {
      const linha = sobra.slice(0, corte).trim();
      sobra = sobra.slice(corte + 1);
      if (!linha.startsWith('data:')) continue;
      const dado = linha.slice(5).trim();
      if (dado === '[DONE]') return;
      const pedaco = JSON.parse(dado);
      if (pedaco.error) throw new ErroDoLlm(pedaco.error.code || 'modelo_fora_do_ar', pedaco.error.message || 'erro no fluxo', res.statusCode);
      yield pedaco;
    }
  }
}

/** `POST embeddings`. */
function embeddings(pedido, opcoes) {
  return _json('POST', 'embeddings', pedido, opcoes);
}

/** `GET models`: os nomes por função e os do gateway, com `funcao`, `modelo`, `janela` e `ferramentas`. */
function modelos(opcoes) {
  return _json('GET', 'models', undefined, opcoes);
}

module.exports = { disponivel, conversar, fluxo, embeddings, modelos, ErroDoLlm };
