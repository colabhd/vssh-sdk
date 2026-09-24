'use strict';

// A fila de processamento: delegar um container ao cluster Kubernetes. O par de `vssh/fila.py`.
//
// O app declara `recursos.fila: true` no manifesto e recebe do portal, a cada subida,
// `VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN`. É com esse par que tudo aqui fala com `/api/fila/*`.
// Sem ele, `disponivel()` diz o motivo e `submeter()` rejeita com `ErroDaFila`.
//
//   const { fila } = require('vssh');
//   const id = await fila.submeter({ imagem: 'ghcr.io/colabhd/ffmpeg:7', comando: ['ffmpeg', ...],
//     entradas: { 'v.mp4': '/home/ana/v.mp4' }, saidas: ['v.webm'], gpu: { quantidade: 1 } });
//   const final = await fila.acompanhar(id, (evento, job) => console.log(evento, job.estado));
//   if (final.estado === 'concluido') await fila.baixar(id, '/home/ana/saida');
//
// Estados: `declarado`, `enviado`, `na_fila`, `rodando`, e os finais `concluido`, `falhou`
// (`motivo`: `prazo`, `imagem`, `entrada:<nome>`, `codigo:<n>`, `sumiu`) e `cancelado`.
//
// Um trabalho que imprime linhas de `vssh/progresso` no stdout tem o progresso lido pelo portal:
// o `aoEvento` de `acompanhar` recebe `progresso` com o job, e `job.progresso` traz `feito`,
// `total` e `etapa`. Quem já baixou as saídas chama `remover` para o dado sair do S3 na hora.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

class ErroDaFila extends Error {
  constructor(status, mensagem, extra = {}) { super(mensagem); this.status = status; this.mensagem = mensagem; this.extra = extra; }
}

function credencial(env = process.env) {
  const url = (env.VSSH_PORTAL_URL || '').replace(/\/+$/, '');
  const token = env.VSSH_PORTAL_TOKEN || '';
  return url && token ? { url, token } : null;
}

function modulo(url) { return url.startsWith('https:') ? https : http; }

/** Um pedido ao portal. Com `stream`, resolve com a resposta crua (para SSE). */
// O SDK se apresenta pelo nome, como o de Python: o portal fica atrás do Cloudflare, e a regra de
// bots dele julga pelo User-Agent. O Node não manda nenhum, e passa; o nome diz no log quem chamou.
const AGENTE = 'vssh-sdk-fila/node';

function pedir(metodo, rota, { corpo, env, stream = false } = {}) {
  const cred = credencial(env);
  if (!cred) return Promise.reject(new ErroDaFila(0, 'o app não tem credencial da fila: declare recursos.fila no manifesto e reinicie o app'));
  const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo), 'utf8');
  const u = new URL(cred.url + '/api/fila' + rota);
  return new Promise((resolve, reject) => {
    const req = modulo(u.href).request(u, {
      method: metodo,
      headers: {
        authorization: `Bearer ${cred.token}`, accept: 'application/json', 'user-agent': AGENTE,
        ...(dados ? { 'content-type': 'application/json', 'content-length': String(dados.length) } : {}),
      },
      timeout: stream ? 0 : 60_000,
    }, (res) => {
      if (stream && res.statusCode === 200) { resolve(res); return; }
      const pedacos = [];
      res.on('data', (d) => pedacos.push(d));
      res.on('end', () => {
        const texto = Buffer.concat(pedacos).toString('utf8');
        let j = null; try { j = texto ? JSON.parse(texto) : null; } catch { /* texto cru */ }
        if (res.statusCode >= 200 && res.statusCode < 300) { resolve(j); return; }
        const { error, ...extra } = j || {};
        reject(new ErroDaFila(res.statusCode, error || texto || `HTTP ${res.statusCode}`, extra));
      });
    });
    req.on('timeout', () => req.destroy(new Error('o portal não respondeu a tempo')));
    req.on('error', (e) => reject(new ErroDaFila(0, `o portal não respondeu: ${e.message}`)));
    if (dados) req.write(dados);
    req.end();
  });
}

/** Nunca rejeita: sem credencial, ou com o portal fora, responde `disponivel: false` com o motivo. */
async function disponivel(env = process.env) {
  const vazio = { cluster: null, gpus: [], quotas: {}, uso: {} };
  if (!credencial(env)) return { disponivel: false, motivo: 'o app não declarou recursos.fila no manifesto (ou ainda não foi reiniciado)', ...vazio };
  try {
    const r = await pedir('GET', '', { env });
    return { disponivel: !!r.disponivel, motivo: r.motivo ?? null, cluster: r.cluster ?? null, gpus: r.gpus || [], quotas: r.quotas || {}, uso: r.uso || {} };
  } catch (e) {
    return { disponivel: false, motivo: e.mensagem || e.message, ...vazio };
  }
}

function entradasDe(trabalho) {
  const bruto = trabalho.entradas || {};
  const pares = Array.isArray(bruto) ? bruto.map((c) => [path.basename(c), c]) : Object.entries(bruto);
  const vistos = new Set();
  for (const [nome, caminho] of pares) {
    if (vistos.has(nome)) throw new ErroDaFila(400, `duas entradas com o mesmo nome: ${nome}`);
    vistos.add(nome);
    if (!fs.existsSync(caminho) || !fs.statSync(caminho).isFile()) throw new ErroDaFila(400, `entrada não encontrada: ${caminho}`);
  }
  return pares;
}

function subir(url, caminho) {
  const tamanho = fs.statSync(caminho).size;
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = modulo(u.href).request(u, { method: 'PUT', headers: { 'content-length': String(tamanho), 'content-type': 'application/octet-stream' } }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300)
        ? resolve(tamanho)
        : reject(new ErroDaFila(res.statusCode, `o S3 recusou a entrada ${caminho} (${res.statusCode})`)));
    });
    req.on('error', (e) => reject(new ErroDaFila(0, `o S3 não respondeu ao subir ${caminho}: ${e.message}`)));
    fs.createReadStream(caminho).on('error', reject).pipe(req);
  });
}

/**
 * Declara, sobe as entradas e inicia. Resolve com o id do job. `trabalho` leva `imagem`,
 * `comando`, `args`, `env`, `entradas` (objeto nome → caminho, ou lista de caminhos), `saidas`,
 * `gpu`, `cpu`, `memoria`, `disco`, `prazo` e `nome`.
 */
async function submeter(trabalho, aoProgresso, env = process.env) {
  const pares = entradasDe(trabalho);
  const { entradas: _ignorado, ...pedido } = trabalho;
  pedido.entradas = pares.map(([nome]) => nome);
  const decl = await pedir('POST', '/jobs', { corpo: pedido, env });
  const urls = Object.fromEntries((decl.entradas || []).map((e) => [e.nome, e.url]));
  try {
    for (const [nome, caminho] of pares) {
      if (decl.maxEntradaBytes && fs.statSync(caminho).size > decl.maxEntradaBytes) {
        throw new ErroDaFila(413, `a entrada ${caminho} passa do teto de ${decl.maxEntradaBytes} bytes`);
      }
      const bytes = await subir(urls[nome], caminho);
      if (aoProgresso) { try { aoProgresso({ fase: 'entrada', arquivo: caminho, bytes }); } catch { /* do app */ } }
    }
    await pedir('POST', `/jobs/${decl.id}/iniciar`, { env });
  } catch (e) {
    await pedir('DELETE', `/jobs/${decl.id}`, { env }).catch(() => {});
    throw e;
  }
  return decl.id;
}

const estado = (id, env = process.env) => pedir('GET', `/jobs/${id}`, { env });

/** Itera `{ evento, dados }` de um SSE do portal até ele fechar. */
async function* eventos(rota, env) {
  const res = await pedir('GET', rota, { env, stream: true });
  let resto = '';
  for await (const pedaco of res) {
    resto += pedaco.toString('utf8');
    const blocos = resto.split('\n\n');
    resto = blocos.pop();
    for (const b of blocos) {
      const evento = /^event: (.+)$/m.exec(b)?.[1];
      const dados = /^data: (.+)$/m.exec(b)?.[1];
      if (!evento) continue;
      let j = null; try { j = dados ? JSON.parse(dados) : null; } catch { /* sem dados */ }
      yield { evento, dados: j };
    }
  }
}

const FINAIS = new Set(['concluido', 'falhou', 'cancelado']);

/** Segue o job até um estado final e resolve com ele. `aoEvento(evento, job)` a cada mudança. */
async function acompanhar(id, aoEvento, env = process.env) {
  for (;;) {
    let final = null;
    for await (const { evento, dados } of eventos(`/jobs/${id}/eventos`, env)) {
      if (aoEvento && dados) { try { aoEvento(evento, dados); } catch { /* do app */ } }
      if (FINAIS.has(evento)) final = dados;
    }
    if (final) return final;
    const atual = await estado(id, env);
    if (FINAIS.has(atual.estado)) return atual;
  }
}

/** As linhas do container principal, como iterador assíncrono. */
async function* log(id, env = process.env) {
  for await (const { evento, dados } of eventos(`/jobs/${id}/log`, env)) {
    if (evento === 'linha' && dados) yield dados.linha || '';
    else if (evento === 'error' && dados) throw new ErroDaFila(0, dados.error || 'erro no log');
  }
}

async function cancelar(id, env = process.env) {
  const r = await pedir('POST', `/jobs/${id}/cancelar`, { env });
  return !!(r && r.success);
}

/** Baixa as saídas para `destino` e resolve com os caminhos gravados. */
async function baixar(id, destino, nomes, env = process.env) {
  const r = await pedir('GET', `/jobs/${id}/saidas`, { env });
  fs.mkdirSync(destino, { recursive: true });
  const gravados = [];
  for (const s of r.saidas || []) {
    if (nomes && !nomes.includes(s.nome)) continue;
    const caminho = path.join(destino, s.nome);
    await new Promise((resolve, reject) => {
      const u = new URL(s.url);
      modulo(u.href).get(u, (res) => {
        if (res.statusCode !== 200) { res.resume(); reject(new ErroDaFila(res.statusCode, `o S3 recusou a saída ${s.nome} (${res.statusCode})`)); return; }
        const f = fs.createWriteStream(caminho);
        res.pipe(f);
        f.on('finish', resolve);
        f.on('error', reject);
      }).on('error', (e) => reject(new ErroDaFila(0, `o S3 não respondeu ao baixar ${s.nome}: ${e.message}`)));
    });
    gravados.push(caminho);
  }
  return gravados;
}

async function listar(env = process.env) {
  const r = await pedir('GET', '/jobs', { env });
  return (r && r.jobs) || [];
}

/**
 * Apaga do S3 as entradas e as saídas de um job terminado, sem esperar a faxina da retenção. Serve
 * a quem já baixou o que precisava e não quer o dado no cluster nem mais um minuto. Um job em
 * curso responde 409: cancele antes.
 */
async function remover(id, env = process.env) {
  const r = await pedir('DELETE', `/jobs/${id}`, { env });
  return !!(r && r.removido);
}

module.exports = { ErroDaFila, disponivel, submeter, estado, acompanhar, log, cancelar, remover, baixar, listar };
