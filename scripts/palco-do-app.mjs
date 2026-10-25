#!/usr/bin/env node
// palco-do-app: executa os passos da ajuda de um vssh-app na janela de verdade dele, num Chrome, e
// tira uma figura de cada passo. É o que leva a ajuda ao nível 3 (as figuras, com os rótulos
// conferidos) e ao 4 (o app responde ao `ajuda.mostrar` pela ponte).
//
//   node scripts/palco-do-app.mjs <diretório do app> --saida <pasta> [--url <backend de pé>]
//
// ─── O arranjo ───────────────────────────────────────────────────────────────
//
// O palco sobe o backend do app numa porta de bancada (o `--tcp` do `servidor.escutar`, como o
// `tests/browser/template-fora-do-ambiente.test.js`), e põe na frente dele um HTTP que serve
// `_sdk/vssh.js` e `_sdk/tuff/` de `api/`, como o sistema faz. A raiz desse HTTP é um quadro de
// bancada no papel do shell: a janela do app num iframe do tamanho que o manifesto declara, na
// mesma origem, de modo que o SDK web dentro dele se sabe no ambiente e conversa com o pai.
// Todo pedido que o app faz ao shell recebe uma recusa, como um verbo que o shell não atende.
//
// ─── O que ele mede ──────────────────────────────────────────────────────────
//
// Cada cerca `passos` com ações sobre os alvos do app (o `alvos.json` da pasta) é executada do
// começo, numa carga nova da janela. Num passo, o palco:
//
//   - acha cada alvo pelo `seletor` ou pelo nome que a pessoa vê, com a regra do SDK web;
//   - pede o mesmo alvo ao SDK pelo `ajuda-mostrar` e espera o retângulo de volta (a ponte);
//   - tira a figura do último controle que o passo aponta (`clicar`, `mostrar`, `digitar`);
//   - faz o gesto (o clique, o texto, a tecla), e confere que cada `[[rótulo]]` do passo apareceu
//     na janela em algum momento dele, e que o controle apontado se chama por um deles.
//
// Uma ação `abrir <Janela>` é do shell, e o palco a pula. O que falta (um alvo que não aparece,
// um rótulo que não está na tela) vira uma linha FALTA, e a figura daquele passo não conta.
//
// ─── A saída ─────────────────────────────────────────────────────────────────
//
// Em `--saida`: um `<topico>-<receita>-<passo>.png` por passo, o `indice.json` com as cenas na
// forma que o `juntarFiguras` do compilador lê, e o `palco.json` com as duas evidências. No
// stdout, linhas chave=valor para o bash do publish: FIGURAS=<n>, PONTE=0|1, EVIDENCIA_FIGURAS=0|1
// e uma FALTA=<onde: o quê> por problema. O código é 0 com o palco executado, 3 sem Chrome, sem
// `api/` ou sem backend que suba, e 1 num erro do próprio palco.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { abrirNavegador, caminhoDoNavegador } = require('./navegador.cjs');

const RAIZ_DO_SDK = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.VSSH_SDK_API || join(RAIZ_DO_SDK, 'api');
const SDK_WEB = process.env.VSSH_SDK_WEB || join(API, 'vssh.js');
const SDK_TUFF = process.env.VSSH_SDK_TUFF || join(API, 'tuff');
const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json',
};
const ESPERA_DO_ALVO_MS = 5000;

const linha = (chave, valor) => process.stdout.write(`${chave}=${String(valor).replace(/[\r\n]+/g, ' ')}\n`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function argumentos(argv) {
  const r = { dir: null, saida: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--saida') r.saida = argv[++i];
    else if (argv[i] === '--url') r.url = argv[++i];
    else if (!r.dir) r.dir = argv[i];
    else throw new Error(`argumento inesperado: ${argv[i]}`);
  }
  if (!r.dir || !r.saida) throw new Error('uso: palco-do-app.mjs <diretório do app> --saida <pasta> [--url <backend>]');
  return r;
}

// ─── A ajuda e as receitas ───────────────────────────────────────────────────

async function compilar(dir, manifesto) {
  const { compilarAjudaDoApp } = await import(pathToFileURL(join(API, 'ajuda', 'compilador-da-ajuda.ts')).href);
  const ambiente = JSON.parse(readFileSync(join(API, 'ajuda', 'ambiente.json'), 'utf8'));
  const pasta = join(dir, manifesto.contributes.ajuda.pasta || 'ajuda');
  const arquivos = readdirSync(pasta).sort().filter((n) => /\.(md|json)$/.test(n) && statSync(join(pasta, n)).isFile())
    .map((n) => ({ caminho: n, texto: readFileSync(join(pasta, n), 'utf8') }));
  return compilarAjudaDoApp(arquivos, {
    manifesto, ambiente: { topicos: ambiente.topicos.map((t) => t.id), termos: ambiente.termos },
  });
}

// ─── O backend e a frente ────────────────────────────────────────────────────

/** Sobe o backend numa porta livre e lê a porta da linha que o `servidor.escutar` anuncia. */
async function subirBackend(dir, manifesto, dados) {
  const b = manifesto.backend || {};
  const python = (b.runtime || '').startsWith('python');
  const exe = python ? 'python3' : process.execPath;
  const runtime = join(RAIZ_DO_SDK, 'runtime', python ? 'python' : 'node');
  const caminho = python ? 'PYTHONPATH' : 'NODE_PATH';
  const proc = spawn(exe, [b.entrypoint, '--tcp', '127.0.0.1:0'], {
    cwd: dir,
    env: {
      ...process.env,
      // O runtime deste checkout vai no fim: um `vssh` que quem desenvolve já pôs no caminho vence.
      [caminho]: [process.env[caminho], existsSync(runtime) ? runtime : ''].filter(Boolean).join(delimiter),
      VSSH_APP_ID: manifesto.id, VSSH_APP_DATA_DIR: dados,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

/** O quadro de bancada: a janela do app num iframe, e um ouvinte no lugar do shell. */
const QUADRO = (largura, altura) => `<!doctype html><meta charset="utf-8"><title>palco</title>
<style>html,body{margin:0;background:#fff}iframe{position:absolute;left:0;top:0;border:0;width:${largura}px;height:${altura}px}</style>
<iframe id="app"></iframe>
<script>
  window.palco = { achados: {}, pedidos: [] };
  const quadro = document.getElementById('app');
  addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.vsshApp !== true || e.source !== quadro.contentWindow) return;
    if (m.type === 'ajuda' && m.op === 'achou') { palco.achados[m.pedido] = m.retangulo || null; return; }
    if (m.requestId !== undefined) {
      palco.pedidos.push(m.type + (m.op ? '.' + m.op : ''));
      quadro.contentWindow.postMessage({ vsshApp: true, type: 'result', requestId: m.requestId, ok: false, value: 'o palco não atende este verbo' }, location.origin);
    }
  });
  window.carregar = () => new Promise((ok) => { quadro.onload = () => ok(true); quadro.src = '/app/?palco=' + Date.now(); });
  window.mostrar = (pedido, alvo) => quadro.contentWindow.postMessage({ vsshApp: true, type: 'ajuda-mostrar', pedido, alvo }, location.origin);
</script>`;

function servirSdk(rel, res) {
  let arquivo = null;
  if (rel === 'vssh.js') arquivo = SDK_WEB;
  else if (rel.startsWith('tuff/') && !rel.includes('..')) arquivo = join(SDK_TUFF, rel.slice('tuff/'.length));
  if (!arquivo || !existsSync(arquivo) || !statSync(arquivo).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(arquivo)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(arquivo).pipe(res);
}

async function subirFrente(backend, largura, altura) {
  const alvo = new URL(backend);
  const frente = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://palco');
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(QUADRO(largura, altura)); return; }
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

// ─── Dentro da janela ────────────────────────────────────────────────────────
//
// A regra do nome é a do SDK web (`acharNoQuadro` em `_sdk/vssh.js`): os elementos que a pessoa
// pode apontar, e o nome de cada um pelo `aria-label`, o `title`, o `placeholder` ou o texto.

const NA_JANELA = `(() => {
  const doc = document.getElementById('app').contentDocument;
  const COM_NOME = 'button, a[href], input, select, textarea, summary, label, [role], [aria-label], [title], [data-ajuda]';
  const visivel = (el) => !!el && el.isConnected && el.getClientRects().length > 0;
  const nomeDe = (el) => String(el.getAttribute('aria-label') || el.getAttribute('title')
    || el.getAttribute('placeholder') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const achar = (alvo) => {
    if (!doc) return null;
    if (alvo.seletor) { try { return [...doc.querySelectorAll(alvo.seletor)].find(visivel) || null; } catch { return null; } }
    return [...doc.querySelectorAll(COM_NOME)].find((el) => visivel(el) && nomeDe(el) === alvo.nome) || null;
  };
  const retangulo = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const nomes = () => {
    if (!doc || !doc.body) return [];
    const n = new Set(doc.body.innerText.split('\\n').map((t) => t.replace(/\\s+/g, ' ').trim()).filter(Boolean));
    for (const el of doc.querySelectorAll(COM_NOME)) if (visivel(el)) n.add(nomeDe(el));
    for (const el of doc.querySelectorAll('option')) n.add(el.textContent.trim());
    return [...n];
  };
  return { achar, retangulo, nomes, nomeDe };
})()`;

async function naJanela(pagina, corpo) {
  return pagina.avaliar(`(() => { const j = ${NA_JANELA}; ${corpo} })()`);
}

async function acharAlvo(pagina, alvo, prazo = ESPERA_DO_ALVO_MS) {
  const fim = Date.now() + prazo;
  for (;;) {
    const r = await naJanela(pagina, `const el = j.achar(${JSON.stringify(alvo)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return { ...j.retangulo(el), nome: j.nomeDe(el) };`);
    if (r && r.w > 0 && r.h > 0) return r;
    if (Date.now() > fim) return null;
    await dormir(100);
  }
}

/** Pede o alvo ao SDK pela ponte e espera o retângulo; `null` quando o app não respondeu. */
async function pelaPonte(pagina, pedido, alvo) {
  await pagina.avaliar(`mostrar(${pedido}, ${JSON.stringify({ ...(alvo.seletor ? { seletor: alvo.seletor } : {}), ...(alvo.nome ? { nome: alvo.nome } : {}) })})`);
  const fim = Date.now() + ESPERA_DO_ALVO_MS;
  let r = null;
  while (Date.now() < fim) {
    r = await pagina.avaliar(`palco.achados[${pedido}] || null`);
    if (r) break;
    await dormir(100);
  }
  await pagina.avaliar(`mostrar(${pedido}, null)`);
  return r;
}

async function clicar(pagina, r, botao) {
  const x = r.x + r.w / 2;
  const y = r.y + r.h / 2;
  const button = botao === 'direito' ? 'right' : 'left';
  const vezes = botao === 'duplo' ? 2 : 1;
  for (let c = 1; c <= vezes; c++) {
    await pagina.enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: c });
    await pagina.enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: c });
  }
}

const TECLAS = { Enter: 13, Escape: 27, Tab: 9, Space: 32, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };

async function tecla(pagina, combinacao) {
  const partes = combinacao.split('+');
  const key = partes.pop();
  const mods = { Alt: 1, Ctrl: 2, Super: 4, Shift: 8 };
  const modifiers = partes.reduce((n, p) => n | (mods[p] || 0), 0);
  const codigo = TECLAS[key] || key.toUpperCase().charCodeAt(0);
  const nome = key === 'Space' ? ' ' : key;
  await pagina.enviar('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: nome, windowsVirtualKeyCode: codigo, modifiers });
  await pagina.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: nome, windowsVirtualKeyCode: codigo, modifiers });
}

// A figura de um passo é o pedaço da janela em volta do alvo, do tamanho da coluna de texto da
// Ajuda (576 × 352 px), preso à beirada da janela mais perto dele, como no palco do ambiente: a
// janela inteira encolheria na coluna até a letra de dentro sumir. A altura cresce até 472 px
// quando o alvo fica um pouco mais para baixo. As bordas que cortam a janela no meio vão em
// `corte`, e a Ajuda as esmaece.
const LARGURA_DA_FIGURA = 576;
const ALTURA_DA_FIGURA = 352;

function recorteDe(alvo, largura, altura) {
  let x0 = 0, x1 = largura, y0 = 0, y1 = altura;
  if (largura > LARGURA_DA_FIGURA && alvo.w <= LARGURA_DA_FIGURA - 48) {
    if (alvo.x + alvo.w + 24 <= LARGURA_DA_FIGURA) x1 = LARGURA_DA_FIGURA;
    else if (alvo.x - 24 >= largura - LARGURA_DA_FIGURA) x0 = largura - LARGURA_DA_FIGURA;
    else { x0 = Math.round(alvo.x + alvo.w / 2 - LARGURA_DA_FIGURA / 2); x1 = x0 + LARGURA_DA_FIGURA; }
  }
  if (altura > ALTURA_DA_FIGURA + 120 && alvo.h <= ALTURA_DA_FIGURA + 72) {
    if (alvo.y + alvo.h + 48 <= ALTURA_DA_FIGURA + 120) y1 = Math.max(ALTURA_DA_FIGURA, Math.ceil(alvo.y + alvo.h + 48));
    else if (alvo.y - 48 >= altura - ALTURA_DA_FIGURA) y0 = altura - ALTURA_DA_FIGURA;
    else { y0 = Math.round(alvo.y + alvo.h / 2 - ALTURA_DA_FIGURA / 2); y1 = y0 + ALTURA_DA_FIGURA; }
  }
  const corte = [[x0 > 0, 'esquerda'], [x1 < largura, 'direita'], [y0 > 0, 'cima'], [y1 < altura, 'baixo']].filter(([s]) => s).map(([, lado]) => lado);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, corte };
}

async function figura(pagina, saida, id, recorte) {
  const r = await pagina.enviar('Page.captureScreenshot', { format: 'png', clip: { x: recorte.x, y: recorte.y, width: recorte.w, height: recorte.h, scale: 1 } });
  writeFileSync(join(saida, `${id}.png`), Buffer.from(r.data, 'base64'));
}

// ─── A execução ──────────────────────────────────────────────────────────────

/** As cercas `passos` com alguma ação sobre um alvo do app: as que o palco executa. */
const receitasDoApp = (ajuda, receitas) => receitas.filter((rc) => rc.tipo === 'passos'
  && rc.passos.some((p) => p.acoes.some((a) => a.alvo && ajuda.alvos[a.alvo])));

async function executar(pagina, ajuda, receitas, saida, largura, altura, pasta) {
  const faltas = [];
  const cenas = {};
  let pedido = 0;
  let pontePedida = 0;
  let ponteRespondida = 0;
  const executaveis = receitasDoApp(ajuda, receitas);

  for (const rc of executaveis) {
    await pagina.avaliar('carregar()');
    await dormir(300);
    for (const [i, passo] of rc.passos.entries()) {
      // O compilador lê a pasta como o livro `<id>/` do app; quem lê a falta conhece a pasta.
      const onde = `${pasta}/${rc.arquivo.slice(rc.arquivo.indexOf('/') + 1)}:${passo.linha}`;
      const vistos = new Set(await naJanela(pagina, 'return j.nomes();'));
      const apontado = passo.acoes.findLast((a) => ['clicar', 'mostrar', 'digitar'].includes(a.verbo) && a.alvo);
      let falhou = false;
      for (const ac of passo.acoes) {
        if (ac.verbo === 'abrir') continue;
        if (ac.verbo === 'tecla') { await tecla(pagina, ac.tecla); await dormir(200); continue; }
        const alvo = ajuda.alvos[ac.alvo];
        if (!alvo) continue;
        const prazo = ['esperar', 'pronto'].includes(ac.verbo) ? 3 * ESPERA_DO_ALVO_MS : ESPERA_DO_ALVO_MS;
        const r = await acharAlvo(pagina, alvo, prazo);
        if (!r) { faltas.push(`${onde}: o alvo ${ac.alvo} não apareceu na janela`); falhou = true; break; }
        pontePedida++;
        if (await pelaPonte(pagina, ++pedido, alvo)) ponteRespondida++;
        if (ac === apontado) {
          const id = `${rc.topico}-${rc.receita}-${i}`;
          const rec = recorteDe(r, largura, altura);
          await figura(pagina, saida, id, rec);
          cenas[id] = {
            topico: rc.topico, receita: rc.receita, passo: i, tela: 'larga', largura: rec.w, altura: rec.h,
            alvos: [{ x: Math.round(r.x - rec.x), y: Math.round(r.y - rec.y), w: Math.round(r.w), h: Math.round(r.h), nome: r.nome }],
            ...(rec.corte.length ? { corte: rec.corte } : {}),
          };
          if (passo.rotulos.length && !alvo.rotulo && !passo.rotulos.includes(r.nome)) {
            faltas.push(`${onde}: o passo cita ${passo.rotulos.map((x) => `[[${x}]]`).join(', ')}, e o controle ${ac.alvo} se chama "${r.nome}" na janela`);
          }
        }
        if (ac.verbo === 'clicar') await clicar(pagina, r, ac.botao);
        if (ac.verbo === 'digitar') { await clicar(pagina, r); await pagina.enviar('Input.insertText', { text: ac.texto || '' }); }
        await dormir(250);
        for (const n of await naJanela(pagina, 'return j.nomes();')) vistos.add(n);
      }
      if (falhou) break;
      for (const rotulo of passo.rotulos) {
        if (!vistos.has(rotulo)) faltas.push(`${onde}: o passo ${i + 1} cita [[${rotulo}]], e a janela não mostra esse nome`);
      }
    }
  }
  return { faltas, cenas, executaveis: executaveis.length, ponte: pontePedida > 0 && ponteRespondida === pontePedida };
}

async function main() {
  const { dir, saida, url } = argumentos(process.argv.slice(2));
  const manifesto = JSON.parse(readFileSync(join(dir, 'vssh-app.json'), 'utf8'));
  if (!manifesto.contributes?.ajuda) { linha('SEM_PALCO', 'o manifesto não declara contributes.ajuda'); return 3; }
  if (!existsSync(join(API, 'ajuda', 'compilador-da-ajuda.ts')) || !existsSync(SDK_WEB)) { linha('SEM_PALCO', `sem api/ajuda ou api/vssh.js em ${API}`); return 3; }
  if (!process.features.typescript) { linha('SEM_PALCO', `o Node ${process.version} não importa o compilador`); return 3; }
  if (!caminhoDoNavegador()) { linha('SEM_PALCO', 'nenhum Chrome nesta máquina (VSSH_TEST_CHROME aponta um)'); return 3; }

  const { ajuda, erros, receitas } = await compilar(dir, manifesto);
  if (!ajuda) { for (const e of erros) linha('FALTA', e); return 1; }
  if (!receitasDoApp(ajuda, receitas).length) { linha('SEM_PALCO', 'nenhum passo da ajuda aponta um alvo do alvos.json'); return 3; }
  mkdirSync(saida, { recursive: true });
  const largura = Math.round(manifesto.window?.width || 900);
  const altura = Math.round(manifesto.window?.height || 640);

  const dados = mkdtempSync(join(tmpdir(), 'vssh-palco-'));
  let backend = null;
  let frente = null;
  let navegador = null;
  try {
    try {
      backend = url ? { proc: null, url } : await subirBackend(resolve(dir), manifesto, dados);
    } catch (err) {
      if (err.semPalco) { linha('SEM_PALCO', err.message); return 3; }
      throw err;
    }
    frente = await subirFrente(backend.url, largura, altura);
    navegador = await abrirNavegador();
    const pagina = await navegador.novaPagina(`http://127.0.0.1:${frente.address().port}/`);
    // Em 2x, como as figuras do ambiente: a figura sai na coluna em tamanho real, e numa tela de
    // alta densidade a letra de dentro fica nítida.
    await pagina.enviar('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 2, mobile: false });
    const r = await executar(pagina, ajuda, receitas, saida, largura, altura, manifesto.contributes.ajuda.pasta || 'ajuda');
    const figuras = Object.keys(r.cenas).length;
    const evidenciaFiguras = figuras > 0 && r.faltas.length === 0;
    writeFileSync(join(saida, 'indice.json'), `${JSON.stringify({ cenas: r.cenas }, null, 2)}\n`);
    writeFileSync(join(saida, 'palco.json'), `${JSON.stringify({ figuras: evidenciaFiguras, ponte: evidenciaFiguras && r.ponte, faltas: r.faltas }, null, 2)}\n`);
    linha('RECEITAS', r.executaveis);
    linha('FIGURAS', figuras);
    linha('EVIDENCIA_FIGURAS', evidenciaFiguras ? 1 : 0);
    linha('PONTE', r.ponte ? 1 : 0);
    for (const f of r.faltas) linha('FALTA', f);
    return 0;
  } finally {
    await navegador?.fechar();
    if (frente) await new Promise((ok) => frente.close(ok));
    if (backend?.proc) { backend.proc.kill(); await new Promise((ok) => { backend.proc.once('exit', ok); setTimeout(ok, 3000).unref?.(); }); }
    rmSync(dados, { recursive: true, force: true });
  }
}

main().then((codigo) => { process.exitCode = codigo; }, (err) => {
  linha('ERRO', err.stack || err.message);
  process.exitCode = 1;
});
