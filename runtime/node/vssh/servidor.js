'use strict';

// O servidor HTTP de um app de backend: onde ele escuta, quem ele atende, como ele se anuncia.
// O par de `vssh/servidor.py`, com as mesmas quatro coisas que todo app faz antes de fazer a dele:
//
//   1. Escuta no socket unix de `$VSSH_APP_SOCKET` (`~/.vssh-apps/<id>/app.sock`). Uma porta TCP
//      em loopback é alcançável por qualquer conta Linux da máquina; um socket num diretório 0700
//      faz por permissão de arquivo o que a conferência de token só promete. O arquivo de socket
//      sobrevive ao processo, então o `listen()` seguinte tropeça no inode de uma encarnação
//      anterior, e o modo do arquivo vem do umask, então um umask frouxo cria o socket 0755.
//   2. Atende só quem traz o `X-Vssh-App-Token` do portal. O 403 do portão leva
//      `X-Vssh-Token: recusado`, e é esse marcador que o separa dos 403 da aplicação: um 403
//      marcado diz que o pedido nem foi despachado, então quem chama reconcilia o token e repete
//      sem repetir um efeito.
//   3. Responde `GET /saude` com `{ok, versao, pid}`, mais o que o app acrescentar.
//   4. Escreve no log com o nome do app na frente.
//
// O `--tcp host:porta` na linha de comando troca o socket por uma porta, e existe para a bancada.
//
//   const http = require('node:http');
//   const { servidor } = require('vssh');
//
//   const server = http.createServer(servidor.portao((req, res) => { ... }));
//   servidor.escutar(server, { argv: process.argv.slice(2) }).catch((e) => {
//     servidor.registrar(e.message);
//     process.exit(e.code === 'JA_ESCUTANDO' ? 0 : 1);
//   });

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const app = require('./app.js');

const SEM_ENDERECO = 'SEM_ENDERECO';
const SERVIDOR_ANTIGO = 'SERVIDOR_ANTIGO';
const JA_ESCUTANDO = 'JA_ESCUTANDO';

// ── O log ───────────────────────────────────────────────────────────────────

/** Uma linha no stderr com o nome do app na frente: o `run.log` é de todos os processos do app. */
function registrar(mensagem, nome = app.ident()) {
  process.stderr.write(`[${nome}] ${mensagem}\n`);
}

/**
 * Devolve `log(evento, detalhe)`, que escreve NDJSON em `<dados>/<arquivo>` e no stdout.
 *
 * O `run.log` do lifecycle é rotacionado a cada start; este sobrevive a reinício, mora no
 * diretório de dados e é lido por máquina: uma linha por evento, com a operação e o caminho que
 * falharam. O retorno carrega `.caminho`, porque a primeira pergunta de quem depura é onde ele está.
 */
function criarLog({ arquivo = 'app.log', stdout = true, env = process.env } = {}) {
  const diretorio = app.dados(env);
  const caminho = path.join(diretorio, arquivo);
  let fluxo = null;

  function log(evento, detalhe) {
    const linha = JSON.stringify({ ts: new Date().toISOString(), event: evento, ...detalhe }) + '\n';
    if (stdout) process.stdout.write(linha);
    try {
      if (!fluxo) {
        fs.mkdirSync(diretorio, { recursive: true });
        fluxo = fs.createWriteStream(caminho, { flags: 'a' });
      }
      fluxo.write(linha);
    } catch {
      // Se nem o log grava, seguir servindo vale mais que morrer pelo diagnóstico.
    }
  }

  log.caminho = caminho;
  return log;
}

// ── O endereço ──────────────────────────────────────────────────────────────

/**
 * O caminho do socket que o lifecycle mandou (`VSSH_APP_SOCKET`).
 *
 * Um `VSSH_APP_PORT` presente e sozinho é um servidor cujo `vssh-app-run` é antigo demais, e a
 * mensagem diz isso pelo nome: o conserto é no provisionamento, e procurá-lo dentro do app é o
 * que custa a tarde de quem depura.
 */
function enderecoDoAmbiente(env = process.env) {
  const caminho = (env.VSSH_APP_SOCKET || '').trim();
  if (caminho) return caminho;
  const err = new Error((env.VSSH_APP_PORT || '').trim()
    ? 'Veio VSSH_APP_PORT, mas não VSSH_APP_SOCKET: o vssh-app-run deste servidor é antigo. ' +
      'O endereço de um app é um socket unix; atualize os binários de infra do servidor.'
    : 'VSSH_APP_SOCKET não definido (ou use --tcp host:porta na bancada).');
  err.code = (env.VSSH_APP_PORT || '').trim() ? SERVIDOR_ANTIGO : SEM_ENDERECO;
  throw err;
}

/**
 * Remove um socket que existe e que ninguém atende. Resolve `inexistente`, `vivo` ou `removido`.
 *
 * A checagem é uma tentativa de conexão, e nunca um `existsSync`: apagar pelo simples fato de o
 * arquivo existir mataria a instância que está atendendo agora.
 */
function limparSocketOrfao(caminho) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(caminho)) return resolve('inexistente');
    const sonda = net.connect(caminho);
    const encerra = (r) => { sonda.destroy(); resolve(r); };
    sonda.setTimeout(2000);
    sonda.on('connect', () => encerra('vivo'));
    sonda.on('timeout', () => encerra('vivo'));   // alguém aceitou e travou: de pé, só ocupado
    sonda.on('error', () => {
      sonda.destroy();
      try {
        fs.unlinkSync(caminho);
        resolve('removido');
      } catch (err) {
        if (err.code === 'ENOENT') return resolve('inexistente');
        reject(err);
      }
    });
  });
}

function opcao(argv, nome) {
  const i = argv.indexOf(nome);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/**
 * Põe o servidor a escutar onde o ambiente mandou, e anuncia no stdout:
 * `[<nome>] versão <v> escutando em <onde>`. É a linha que a bancada lê para descobrir a porta e
 * a que o `run.log` mostra de um app que subiu.
 *
 * Rejeita com `code: 'JA_ESCUTANDO'` quando outra instância já atende no socket; o lifecycle lê
 * uma saída com `0` nesse caso como "está de pé".
 *
 * @param {import('node:http').Server|import('node:net').Server} server
 * @param {{argv?: string[], env?: NodeJS.ProcessEnv, modo?: number, nome?: string}} [opcoes]
 * @returns {Promise<{transporte: 'socket'|'tcp', endereco: string}>}
 */
async function escutar(server, opcoes = {}) {
  const env = opcoes.env || process.env;
  const argv = opcoes.argv || process.argv.slice(2);
  const nome = opcoes.nome || app.ident(env);
  const modo = opcoes.modo === undefined ? 0o600 : opcoes.modo;

  const tcp = opcao(argv, '--tcp');
  let onde, transporte;
  if (tcp) {
    const sep = tcp.lastIndexOf(':');
    const host = tcp.slice(0, sep);
    const porta = Number(tcp.slice(sep + 1));
    await new Promise((ok, erro) => { server.once('error', erro); server.listen(porta, host, ok); });
    onde = `${host}:${server.address().port}`;
    transporte = 'tcp';
  } else {
    const caminho = enderecoDoAmbiente(env);
    fs.mkdirSync(path.dirname(caminho), { recursive: true, mode: 0o700 });
    if ((await limparSocketOrfao(caminho)) === 'vivo') {
      const err = new Error(`já há um backend atendendo em ${caminho}.`);
      err.code = JA_ESCUTANDO;
      throw err;
    }
    await new Promise((ok, erro) => { server.once('error', erro); server.listen(caminho, ok); });
    // Depois do listen, porque antes dele o arquivo não existe. O diretório 0700 já protege; isto
    // é a segunda defesa, para o dia em que ele mudar de modo por outra razão.
    try { fs.chmodSync(caminho, modo); } catch { /* o diretório já protege */ }
    onde = caminho;
    transporte = 'socket';
  }
  process.stdout.write(`[${nome}] versão ${app.versao()} escutando em ${onde}\n`);
  return { transporte, endereco: onde };
}

// ── O portão e o /saude ─────────────────────────────────────────────────────

/** Uma resposta JSON inteira, com `Content-Length`, para a conexão poder ser reusada. */
function responderJson(res, status, obj, cabecalhos = {}) {
  const corpo = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(corpo.length),
    ...cabecalhos,
  });
  res.end(corpo);
}

/**
 * O token que veio no cabeçalho é o do ambiente? A comparação leva o mesmo tempo para qualquer
 * palpite: um `!==` sai no primeiro byte diferente, e o tempo de resposta contaria ao vizinho de
 * loopback quantos bytes do token ele já acertou. Tamanhos diferentes são recusados antes, porque
 * `timingSafeEqual` exige buffers do mesmo tamanho, e o tamanho do token não é segredo.
 */
function mesmoToken(recebido, esperado) {
  if (typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * O portão na frente do handler do app: recusa quem não traz o token, responde o `/saude`, e
 * entrega o resto a `atender(req, res)`.
 *
 * `saude()` devolve o que o app acrescenta ao healthcheck; `cabecalhos` vai em toda resposta
 * que o portão monta; `recusa` é a frase do 403.
 *
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} atender
 * @param {{saude?: () => object, cabecalhos?: Record<string, string>, recusa?: string, env?: NodeJS.ProcessEnv}} [opcoes]
 */
function portao(atender, opcoes = {}) {
  const env = opcoes.env || process.env;
  const token = env.VSSH_APP_TOKEN || '';
  const fixos = opcoes.cabecalhos || {};
  const recusa = opcoes.recusa || 'Sem autorização.';
  return (req, res) => {
    if (token && !mesmoToken(req.headers['x-vssh-app-token'], token)) {
      responderJson(res, 403, { error: recusa }, { ...fixos, 'X-Vssh-Token': 'recusado' });
      return;
    }
    if (req.method === 'GET' && (req.url || '').split('?')[0] === '/saude') {
      const extra = opcoes.saude ? opcoes.saude() : {};
      responderJson(res, 200, { ok: true, versao: app.versao(), pid: process.pid, ...extra }, fixos);
      return;
    }
    atender(req, res);
  };
}

module.exports = {
  escutar, portao, responderJson, registrar, criarLog,
  enderecoDoAmbiente, limparSocketOrfao,
  SEM_ENDERECO, SERVIDOR_ANTIGO, JA_ESCUTANDO,
};
