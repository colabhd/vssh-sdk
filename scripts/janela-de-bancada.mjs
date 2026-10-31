// A janela de um vssh-app fora do ambiente, de pé para uma máquina olhar: o backend numa porta de
// bancada, a frente que serve `_sdk/` de `api/` como o sistema faz, e o quadro de bancada no papel
// do shell, com a janela do app num iframe da mesma origem. O palco do app
// (`scripts/palco-do-app.mjs`) e a bancada do app (`scripts/vssh-bancada.mjs`) sobem a janela por
// aqui, e por isso o que um mede é a mesma janela que o outro fotografa.
//
// O quadro responde aos pedidos que a cena declara (`respostasDaPonte`) e recusa os outros, como
// um verbo que o shell não atende. Ele também pede as cenas da bancada do app ao SDK web
// (`bancada-rodar`) e guarda o progresso e o resultado que voltam, em `palco.bancada`.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import http from 'node:http';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RAIZ_DO_SDK = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const API = process.env.VSSH_SDK_API || join(RAIZ_DO_SDK, 'api');
export const SDK_WEB = process.env.VSSH_SDK_WEB || join(API, 'vssh.js');
export const SDK_TUFF = process.env.VSSH_SDK_TUFF || join(API, 'tuff');
const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json',
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── O backend e a frente ────────────────────────────────────────────────────

/** Sobe o backend numa porta livre e lê a porta da linha que o `servidor.escutar` anuncia. */
export async function subirBackend(dir, manifesto, dados, home) {
  const b = manifesto.backend || {};
  const python = (b.runtime || '').startsWith('python');
  const exe = python ? 'python3' : process.execPath;
  const runtime = join(RAIZ_DO_SDK, 'runtime', python ? 'python' : 'node');
  const caminho = python ? 'PYTHONPATH' : 'NODE_PATH';
  const env = {
    ...process.env,
    // O runtime deste checkout vai no fim: um `vssh` que quem desenvolve já pôs no caminho vence.
    [caminho]: [process.env[caminho], existsSync(runtime) ? runtime : ''].filter(Boolean).join(delimiter),
    VSSH_APP_ID: manifesto.id, VSSH_APP_DATA_DIR: dados,
  };
  if (home) {
    // As pastas XDG de quem roda o palco apontariam para fora da HOME da cena.
    for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) delete env[k];
    Object.assign(env, { HOME: home, USERPROFILE: home });
  }
  const proc = spawn(exe, [b.entrypoint, '--tcp', '127.0.0.1:0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  proc.stdout.on('data', (d) => { saida += d; });
  proc.stderr.on('data', (d) => { saida += d; });
  const fim = Date.now() + 30000;
  for (;;) {
    const m = /escutando em 127\.0\.0\.1:(\d+)/.exec(saida);
    if (m) return { proc, url: `http://127.0.0.1:${m[1]}` };
    if (proc.exitCode !== null || Date.now() > fim) {
      proc.kill();
      throw Object.assign(new Error(`o backend não subiu: ${saida.trim().split('\n').slice(-3).join(' | ')}`), { semPalco: true });
    }
    await dormir(100);
  }
}

/**
 * O quadro de bancada: a janela do app num iframe, e um ouvinte no lugar do shell. `respostas` é a
 * lista de `{ fio, valor }` da cena: um pedido cujos campos batem com o `fio` de uma delas recebe o
 * valor.
 */
const QUADRO = (largura, altura, respostas) => `<!doctype html><meta charset="utf-8"><title>palco</title>
<style>html,body{margin:0;background:#fff}iframe{position:absolute;left:0;top:0;border:0;width:${largura}px;height:${altura}px}</style>
<iframe id="app"></iframe>
<script>
  window.palco = { achados: {}, pedidos: [], bancada: {} };
  const RESPOSTAS = ${JSON.stringify(respostas).replace(/</g, '\\u003c')};
  const quadro = document.getElementById('app');
  addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.vsshApp !== true || e.source !== quadro.contentWindow) return;
    if (m.type === 'ajuda' && m.op === 'achou') { palco.achados[m.pedido] = m.retangulo || null; return; }
    if (m.type === 'bancada') {
      const b = palco.bancada[m.pedido] || (palco.bancada[m.pedido] = { progresso: null, resultado: null, erro: null });
      if (m.op === 'progresso') b.progresso = { feitas: m.feitas, total: m.total, cena: m.cena };
      if (m.op === 'resultado') { b.resultado = m.resultado || null; b.erro = m.erro || null; }
      return;
    }
    if (m.requestId !== undefined) {
      palco.pedidos.push(m.type + (m.op ? '.' + m.op : ''));
      const r = RESPOSTAS.find((x) => Object.entries(x.fio).every(([k, v]) => m[k] === v));
      quadro.contentWindow.postMessage(r
        ? { vsshApp: true, type: 'result', requestId: m.requestId, ok: true, value: r.valor }
        : { vsshApp: true, type: 'result', requestId: m.requestId, ok: false, value: 'o palco não atende este verbo' }, location.origin);
    }
  });
  window.carregar = () => new Promise((ok) => { quadro.onload = () => ok(true); quadro.src = '/app/?palco=' + Date.now(); });
  window.mostrar = (pedido, alvo) => quadro.contentWindow.postMessage({ vsshApp: true, type: 'ajuda-mostrar', pedido, alvo }, location.origin);
  window.pedirCenas = (pedido, ids) => quadro.contentWindow.postMessage({ vsshApp: true, type: 'bancada-rodar', pedido, ids: ids || null }, location.origin);
</script>`;

function servirSdk(rel, res) {
  let arquivo = null;
  if (rel === 'vssh.js') arquivo = SDK_WEB;
  else if (rel.startsWith('tuff/') && !rel.includes('..')) arquivo = join(SDK_TUFF, rel.slice('tuff/'.length));
  if (!arquivo || !existsSync(arquivo) || !statSync(arquivo).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(arquivo)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(arquivo).pipe(res);
}

export async function subirFrente(backend, largura, altura, respostas) {
  const alvo = new URL(backend);
  const frente = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://palco');
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(QUADRO(largura, altura, respostas)); return; }
    if (!u.pathname.startsWith('/app/')) { res.writeHead(404); res.end(); return; }
    const resto = u.pathname.slice('/app'.length);
    if (resto.startsWith('/_sdk/')) { servirSdk(resto.slice('/_sdk/'.length), res); return; }
    const pedido = http.request({
      host: alvo.hostname, port: alvo.port, path: resto + u.search, method: req.method,
      headers: { ...req.headers, host: 'app' },
    }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    pedido.on('error', (err) => { res.writeHead(502); res.end(err.message); });
    req.pipe(pedido);
  });
  await new Promise((ok) => frente.listen(0, '127.0.0.1', ok));
  return frente;
}

// ─── A cena ──────────────────────────────────────────────────────────────────

/**
 * As respostas da cena no fio. `{ 'arquivos.escolherPasta': v }` vira
 * `{ fio: { type: 'pick', variant: 'directory' }, valor: v }`; na forma de lista, cada regra
 * `{ verbo, quando, valor }` acrescenta ao fio os campos de `quando`, pelo nome público deles, e a
 * primeira regra que bate com o pedido responde.
 */
export function respostasDaPonte(ponte, roteiro) {
  if (ponte === undefined || ponte === null) return [];
  if (typeof ponte !== 'object') throw new Error(`${roteiro}: \`ponte\` é um objeto, do nome do verbo ao valor, ou uma lista de regras`);
  const regras = Array.isArray(ponte) ? ponte : Object.entries(ponte).map(([verbo, valor]) => ({ verbo, valor }));
  const { espacos } = JSON.parse(readFileSync(join(API, 'abi.json'), 'utf8'));
  return regras.map((regra) => {
    const nome = String(regra?.verbo || '');
    const ponto = nome.indexOf('.');
    const verbo = ponto > 0 ? espacos[nome.slice(0, ponto)]?.verbos?.[nome.slice(ponto + 1)] : null;
    if (!verbo) throw new Error(`${roteiro} responde ${nome || '(sem verbo)'}, e a ponte não tem esse verbo`);
    if (!verbo.responde) throw new Error(`${roteiro} responde ${nome}, e esse verbo não espera resposta`);
    const fio = { ...verbo.fio };
    for (const [campo, v] of Object.entries(regra.quando || {})) {
      const c = (verbo.campos || []).find((x) => x.nome === campo);
      if (!c) throw new Error(`${roteiro} pergunta pelo campo ${campo} de ${nome}, e o verbo não tem esse campo`);
      fio[c.fio] = v;
    }
    return { fio, valor: regra.valor === undefined ? null : regra.valor };
  });
}

/** Chama o `preparar` do `palco.mjs` do app, quando ele existe, e devolve as respostas da ponte. */
export async function prepararCena(roteiro, nome, contexto) {
  const modulo = await import(pathToFileURL(roteiro).href);
  if (typeof modulo.preparar !== 'function') throw new Error(`${nome} não exporta a função preparar`);
  const cena = (await modulo.preparar(contexto)) || {};
  return respostasDaPonte(cena.ponte, nome);
}
