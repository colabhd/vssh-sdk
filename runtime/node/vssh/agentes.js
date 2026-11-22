'use strict';

// Os agentes da pessoa para o backend de um app, pelo provedor `agentes/v1` da estação. O par de
// `vssh/agentes.py`. O contrato está em docs/agentes.md do vssh-sso.
//
// O provedor é o app embutido `agentes`, que roda como a mesma pessoa. Este módulo fala com o socket
// dele, com o token que o processo dele tem, e diz quem chama (`X-Vssh-Chamador`, o `VSSH_APP_ID`).
//
//   const { agentes } = require('vssh');
//   const { agentes: lista } = await agentes.listar();
//   const c = await agentes.abrir({ agente: 'claude', instrucoes, mcp: { meuapp: { comando: ['node', 'mcp.js'] } } });
//   for await (const { tipo, dados } of agentes.mensagem(c.id, 'Quantas citações tem o capítulo 2?')) {
//     if (tipo === 'texto') process.stdout.write(dados.delta);
//   }
//   await agentes.encerrar(c.id);
//
// Um erro do contrato chega como `ErroDoAgente`, com o `codigo` estável (`sem_conta`,
// `pede_confirmacao`, `conversa_desconhecida`...) e o `status`. Sem o provedor de pé, o código é
// `sem_provedor`: quem o sobe é o ambiente, na primeira vez que uma janela pede `agentes/v1` pela
// ponte (`vssh.apps.pedir('agentes/v1', 'agentes')`).

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

class ErroDoAgente extends Error {
  constructor(codigo, mensagem, status = 0) {
    super(mensagem);
    this.name = 'ErroDoAgente';
    this.codigo = codigo;
    this.status = status;
  }
}

const SEM_PROVEDOR = 'o provedor de agentes não está de pé nesta conta';

/** O token do provedor: o do processo vivo, e o do arquivo de ambiente quando o processo não se lê. */
function _token(dir) {
  try {
    const pid = fs.readFileSync(path.join(dir, 'run.pid'), 'utf8').trim();
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const linha = env.find((l) => l.startsWith('VSSH_APP_TOKEN='));
    if (linha) return linha.slice(15);
  } catch { /* sem o processo */ }
  try {
    const linha = fs.readFileSync(path.join(dir, 'env'), 'utf8').split('\n').find((l) => /^(export\s+)?VSSH_APP_TOKEN=/.test(l));
    if (linha) return linha.replace(/^(export\s+)?VSSH_APP_TOKEN=/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  } catch { /* sem o arquivo */ }
  return '';
}

/** Onde o provedor escuta: `{ socketPath }` ou `{ host, port }`, e o token. */
function _alvo(env) {
  if (env.VSSH_AGENTES_URL) {
    const u = new URL(env.VSSH_AGENTES_URL);
    return { endereco: { host: u.hostname, port: Number(u.port) }, token: env.VSSH_AGENTES_TOKEN || '' };
  }
  const dir = path.join(env.HOME || os.homedir(), '.vssh-apps', 'agentes');
  return { endereco: { socketPath: env.VSSH_AGENTES_SOCKET || path.join(dir, 'app.sock') }, token: env.VSSH_AGENTES_TOKEN || _token(dir) };
}

function _pedir(metodo, rota, corpo, { env = process.env, signal } = {}) {
  const { endereco, token } = _alvo(env);
  const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request({
      ...endereco,
      path: `/agentes/v1/${rota}`,
      method: metodo,
      signal,
      headers: {
        'x-vssh-chamador': env.VSSH_APP_ID || 'desconhecido',
        ...(token ? { 'x-vssh-app-token': token } : {}),
        ...(dados ? { 'content-type': 'application/json', 'content-length': String(dados.length) } : {}),
      },
    }, resolve);
    req.on('error', (e) => reject(['ENOENT', 'ECONNREFUSED'].includes(e.code) ? new ErroDoAgente('sem_provedor', SEM_PROVEDOR) : e));
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

function _erro(status, texto) {
  let e = {};
  try { e = JSON.parse(texto).erro || {}; } catch { /* não é JSON */ }
  if (status === 403 && !e.codigo) return new ErroDoAgente('sem_provedor', 'o provedor de agentes recusou o token: ele reiniciou, tente de novo', status);
  return new ErroDoAgente(e.codigo || 'agente_saiu', e.mensagem || texto || `o provedor respondeu ${status}`, status);
}

async function _json(metodo, rota, corpo, opcoes) {
  const res = await _pedir(metodo, rota, corpo, opcoes);
  const texto = await _texto(res);
  if (res.statusCode < 200 || res.statusCode >= 300) throw _erro(res.statusCode, texto);
  return JSON.parse(texto);
}

/** `GET agentes`: `{ agentes: [...] }`. `pedidos` nomeia quem aparece mesmo fora da conta. */
function listar({ pedidos = [], renovar = false, ...opcoes } = {}) {
  const q = new URLSearchParams();
  if (pedidos.length) q.set('pedidos', pedidos.join(','));
  if (renovar) q.set('renovar', '1');
  return _json('GET', `agentes${q.size ? `?${q}` : ''}`, undefined, opcoes);
}

/** `POST conversas`: `{ id, agente, aviso_de_privacidade, primeira_vez, ... }`. */
function abrir(pedido, opcoes) {
  return _json('POST', 'conversas', pedido, opcoes);
}

/**
 * `POST conversas/<id>/mensagens`: um iterador assíncrono de `{ tipo, dados }` (`texto`,
 * `raciocinio`, `ferramenta`, `fim`, `erro`), até o fim do fluxo. Abortar o `signal` cancela a
 * resposta.
 */
async function* mensagem(id, texto, opcoes = {}) {
  const res = await _pedir('POST', `conversas/${encodeURIComponent(id)}/mensagens`, { texto }, opcoes);
  if (res.statusCode < 200 || res.statusCode >= 300) throw _erro(res.statusCode, await _texto(res));
  res.setEncoding('utf8');
  let sobra = '';
  for await (const parte of res) {
    sobra += parte.replace(/\r\n/g, '\n');
    let corte;
    while ((corte = sobra.indexOf('\n\n')) >= 0) {
      const bloco = sobra.slice(0, corte);
      sobra = sobra.slice(corte + 2);
      let tipo = 'message';
      const dados = [];
      for (const l of bloco.split('\n')) {
        if (l.startsWith('event:')) tipo = l.slice(6).trim();
        else if (l.startsWith('data:')) dados.push(l.slice(5).trimStart());
      }
      if (dados.length) yield { tipo, dados: JSON.parse(dados.join('\n')) };
    }
  }
}

const cancelar = (id, opcoes) => _json('POST', `conversas/${encodeURIComponent(id)}/cancelar`, {}, opcoes);
const encerrar = (id, opcoes) => _json('DELETE', `conversas/${encodeURIComponent(id)}`, undefined, opcoes);

/** Guarda (ou tira) a confirmação da pessoa para um agente que a pede, como o Antigravity. */
const confirmar = (agente, aceito, opcoes) => _json('POST', `agentes/${encodeURIComponent(agente)}/confirmacao`, { aceito: !!aceito }, opcoes);

module.exports = { listar, abrir, mensagem, cancelar, encerrar, confirmar, ErroDoAgente };
