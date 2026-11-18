#!/usr/bin/env node
// tuff-antes-e-depois: tira as figuras da ajuda de um vssh-app com duas cópias do Tuff e mostra
// quais mudaram. Um app carrega o Tuff do ambiente, sem cópia, e uma mudança numa folha chega a
// todo app publicado: esta comparação diz o que ela faz na janela de cada um antes do deploy.
//
//   node scripts/tuff-antes-e-depois.mjs <diretório do app> --depois <pasta do Tuff> --saida <pasta>
//                                        [--antes <pasta do Tuff>]
//
// `--depois` é a pasta do Tuff com a mudança (`vssh-client/tuff` de um checkout do sistema).
// `--antes` é a cópia de referência, e sem ele vale `api/tuff/` deste checkout, que é o Tuff que o
// canal publicou.
//
// ─── O que ele faz ───────────────────────────────────────────────────────────
//
// O palco do app (`scripts/palco-do-app.mjs`) roda com cada cópia no lugar de `_sdk/tuff/`
// (`VSSH_SDK_TUFF`): a mesma cena, os mesmos passos, a mesma janela. Cada figura de antes é
// comparada com a de depois, pixel a pixel, num Chrome.
//
// A cópia de antes roda duas vezes. Uma janela com o cursor de texto piscando ou com um desenho
// que se acomoda sozinho dá figuras diferentes com o mesmo Tuff, e a segunda rodada mostra quais:
// a figura que muda entre as duas rodadas de antes é instável, e sai da conta do que mudou.
//
// ─── A saída ─────────────────────────────────────────────────────────────────
//
// Em `--saida`, que o comando refaz: `antes/`, `antes-de-novo/` e `depois/` com a saída do palco
// de cada rodada, `diferenca/<figura>.png` com os pixels que mudaram marcados sobre a figura de
// depois, `comparacao.json` com a conta, e `comparacao.html` com as três imagens de cada figura
// que mudou, lado a lado. No stdout, linhas chave=valor: FIGURAS, IGUAIS, MUDARAM, uma
// MUDOU=<figura: quanto> por figura diferente, uma INSTAVEL=<figura: quanto> por figura que muda
// com o mesmo Tuff, SO_ANTES e SO_DEPOIS para a figura que uma das rodadas não tirou, e FALTA_NOVA
// para o passo que andava com o Tuff de antes e para com o de depois.
//
// O código é 0 com a comparação feita, mude o que mudar: quem decide se a mudança é de propósito é
// a pessoa que olha as figuras. É 3 quando o palco não roda (sem Chrome, sem `api/`, sem backend),
// e 1 num erro do próprio comando.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { abrirNavegador } = require('./navegador.cjs');

const AQUI = dirname(fileURLToPath(import.meta.url));
const PALCO = join(AQUI, 'palco-do-app.mjs');
const linha = (chave, valor) => process.stdout.write(`${chave}=${String(valor).replace(/[\r\n]+/g, ' ')}\n`);

function argumentos(argv) {
  const r = { dir: null, antes: join(AQUI, '..', 'api', 'tuff'), depois: null, saida: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--antes') r.antes = argv[++i];
    else if (argv[i] === '--depois') r.depois = argv[++i];
    else if (argv[i] === '--saida') r.saida = argv[++i];
    else if (!r.dir) r.dir = argv[i];
    else throw new Error(`argumento inesperado: ${argv[i]}`);
  }
  if (!r.dir || !r.depois || !r.saida) throw new Error('uso: tuff-antes-e-depois.mjs <diretório do app> --depois <pasta do Tuff> --saida <pasta> [--antes <pasta do Tuff>]');
  for (const lado of ['antes', 'depois']) {
    r[lado] = resolve(r[lado]);
    if (!existsSync(join(r[lado], 'tuff.css'))) throw new Error(`--${lado}: ${r[lado]} não tem o tuff.css`);
  }
  return { ...r, dir: resolve(r.dir), saida: resolve(r.saida) };
}

/** Uma rodada do palco com uma cópia do Tuff. Devolve as linhas do stdout dele por chave. */
function rodarPalco(dir, tuff, saida) {
  const r = spawnSync(process.execPath, [PALCO, dir, '--saida', saida], {
    env: { ...process.env, VSSH_SDK_TUFF: tuff }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  const valores = {};
  for (const l of (r.stdout || '').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l);
    if (m) (valores[m[1]] ||= []).push(m[2]);
  }
  return { codigo: r.status, valores };
}

const figurasDe = (pasta) => (existsSync(pasta) ? readdirSync(pasta).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort() : []);

// Roda na página: desenha as duas figuras, conta os pixels que diferem, e devolve a caixa que os
// contém e a figura de depois esmaecida, com eles marcados.
function compararNaPagina(antes, depois) {
  const carregar = (url) => new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error('a figura não abriu'));
    img.src = url;
  });
  return Promise.all([carregar(antes), carregar(depois)]).then(([a, d]) => {
    const l = Math.max(a.width, d.width), h = Math.max(a.height, d.height);
    const pixels = (img) => {
      const c = new OffscreenCanvas(l, h).getContext('2d', { willReadFrequently: true });
      c.drawImage(img, 0, 0);
      return c.getImageData(0, 0, l, h);
    };
    const pa = pixels(a).data, pd = pixels(d);
    const tela = document.createElement('canvas');
    tela.width = l; tela.height = h;
    const ctx = tela.getContext('2d');
    ctx.drawImage(d, 0, 0);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.fillRect(0, 0, l, h);
    const marca = ctx.getImageData(0, 0, l, h);
    let n = 0, x0 = l, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < pa.length; i += 4) {
      if (pa[i] === pd.data[i] && pa[i + 1] === pd.data[i + 1] && pa[i + 2] === pd.data[i + 2] && pa[i + 3] === pd.data[i + 3]) continue;
      n++;
      const x = (i / 4) % l, y = Math.floor(i / 4 / l);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      marca.data[i] = 214; marca.data[i + 1] = 0; marca.data[i + 2] = 110; marca.data[i + 3] = 255;
    }
    ctx.putImageData(marca, 0, 0);
    return JSON.stringify({
      pixels: n, total: l * h,
      caixa: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
      antes: { w: a.width, h: a.height }, depois: { w: d.width, h: d.height },
      marca: tela.toDataURL('image/png'),
    });
  });
}

const dataUrl = (arquivo) => `data:image/png;base64,${readFileSync(arquivo).toString('base64')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** De onde uma figura vem, pelas cenas do `indice.json` do palco: o tópico, o passo e o controle. */
function legenda(cenas, id) {
  const c = cenas[id];
  if (!c) return id;
  const alvo = c.alvos?.at(-1)?.nome;
  return `${c.topico}, passo ${c.passo + 1}${alvo ? `: ${alvo}` : ''}`;
}

function pagina({ app, antes, depois, mudaram, iguais, instaveis, soAntes, soDepois, faltasNovas, cenas }) {
  const porcento = (m) => (m.pixels / m.total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const quanto = (m) => `${m.pixels.toLocaleString('pt-BR')} pixels diferentes (${porcento(m)}%)${m.caixa ? `, numa caixa de ${m.caixa.w} × ${m.caixa.h} px a partir de (${m.caixa.x}, ${m.caixa.y})` : ''}`;
  const figura = (m) => `
<section>
  <h2>${esc(legenda(cenas, m.id))}</h2>
  <p class="conta"><code>${esc(m.id)}</code> · ${quanto(m)}${m.antes.w !== m.depois.w || m.antes.h !== m.depois.h ? `. O tamanho foi de ${m.antes.w} × ${m.antes.h} para ${m.depois.w} × ${m.depois.h} px` : ''}</p>
  <div class="tres">
    <figure><img src="antes/${esc(m.id)}.png" alt="A figura com o Tuff de antes"><figcaption>Antes</figcaption></figure>
    <figure><img src="depois/${esc(m.id)}.png" alt="A figura com o Tuff de depois"><figcaption>Depois</figcaption></figure>
    <figure><img src="diferenca/${esc(m.id)}.png" alt="Os pixels que mudaram, marcados sobre a figura de depois"><figcaption>Onde mudou</figcaption></figure>
  </div>
</section>`;
  const lista = (titulo, itens, f = esc) => (itens.length ? `<section><h2>${titulo}</h2><ul>${itens.map((i) => `<li>${f(i)}</li>`).join('')}</ul></section>` : '');
  return `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(app)}: as figuras com dois Tuffs</title>
<style>
  :root { color-scheme: light dark; --linha: color-mix(in srgb, CanvasText 16%, Canvas); --fraco: color-mix(in srgb, CanvasText 62%, Canvas); }
  body { margin: 0; padding: 24px 16px 48px; font: 14px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  h2 { font-size: 15px; font-weight: 600; margin: 0 0 2px; }
  p { margin: 0 0 12px; }
  .origem, .conta { color: var(--fraco); }
  .origem code, .conta code { color: CanvasText; }
  section { border-top: 1px solid var(--linha); padding: 16px 0; }
  .tres { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  figure { margin: 0; min-width: 0; }
  img { display: block; max-width: 100%; height: auto; border: 1px solid var(--linha); background: #fff; }
  figcaption { color: var(--fraco); padding-top: 4px; }
  ul { margin: 4px 0 0; padding-left: 20px; }
</style>
<main>
  <h1>${esc(app)}: ${mudaram.length ? `${mudaram.length} de ${mudaram.length + iguais.length} figuras mudaram` : `as ${iguais.length} figuras ficaram iguais`}${instaveis.length ? `, e ${instaveis.length} ${instaveis.length === 1 ? 'muda' : 'mudam'} com o mesmo Tuff` : ''}</h1>
  <p class="origem">Antes: <code>${esc(antes)}</code><br>Depois: <code>${esc(depois)}</code></p>
  ${lista('Passos que andavam e pararam com o Tuff de depois', faltasNovas)}
  ${lista('Figuras que só a rodada de antes tirou', soAntes, (i) => `<code>${esc(i)}</code>`)}
  ${lista('Figuras que só a rodada de depois tirou', soDepois, (i) => `<code>${esc(i)}</code>`)}
  ${mudaram.map(figura).join('\n')}
  ${lista('Figuras que mudam com o mesmo Tuff, fora da conta', instaveis, (m) => `${esc(legenda(cenas, m.id))} <code>${esc(m.id)}</code>: entre as duas rodadas de antes, ${quanto(m)}`)}
  ${lista('Figuras iguais', iguais, (i) => `${esc(legenda(cenas, i))} <code>${esc(i)}</code>`)}
</main>
</html>
`;
}

async function main() {
  const { dir, antes, depois, saida } = argumentos(process.argv.slice(2));
  const app = JSON.parse(readFileSync(join(dir, 'vssh-app.json'), 'utf8')).id || basename(dir);
  const pastas = { antes: join(saida, 'antes'), deNovo: join(saida, 'antes-de-novo'), depois: join(saida, 'depois'), diferenca: join(saida, 'diferenca') };
  // A figura de uma rodada anterior entraria na conta desta.
  for (const p of Object.values(pastas)) rmSync(p, { recursive: true, force: true });
  mkdirSync(pastas.diferenca, { recursive: true });

  const rodadas = {};
  for (const [lado, tuff] of [['antes', antes], ['deNovo', antes], ['depois', depois]]) {
    rodadas[lado] = rodarPalco(dir, tuff, pastas[lado]);
    if (rodadas[lado].codigo === 3) { linha('SEM_PALCO', rodadas[lado].valores.SEM_PALCO?.[0] || 'o palco não rodou'); return 3; }
    if (rodadas[lado].codigo !== 0) throw new Error(`o palco saiu com ${rodadas[lado].codigo} na rodada de ${basename(pastas[lado])}`);
  }

  const de = { antes: new Set(figurasDe(pastas.antes)), depois: new Set(figurasDe(pastas.depois)) };
  const soAntes = [...de.antes].filter((f) => !de.depois.has(f));
  const soDepois = [...de.depois].filter((f) => !de.antes.has(f));
  const faltasAntes = new Set(rodadas.antes.valores.FALTA || []);
  const faltasNovas = (rodadas.depois.valores.FALTA || []).filter((f) => !faltasAntes.has(f));

  const iguais = [], mudaram = [], instaveis = [];
  let navegador = null;
  // Os pixels que diferem entre duas figuras, ou `null` quando são os mesmos. Dois arquivos
  // diferentes com os mesmos pixels contam como iguais: o PNG mudou, e a figura não.
  // O Chrome que compara pode cair no meio de uma figura. Outro assume, uma vez por figura.
  let aba = null;
  const comparar = async (a, d) => {
    if (readFileSync(a).equals(readFileSync(d))) return null;
    for (let tentativa = 1; ; tentativa++) {
      try {
        navegador ||= await abrirNavegador();
        aba ||= await navegador.novaPagina();
        const r = JSON.parse(await aba.avaliar(`(${compararNaPagina.toString()})(${JSON.stringify(dataUrl(a))}, ${JSON.stringify(dataUrl(d))})`));
        return r.pixels ? r : null;
      } catch (err) {
        await navegador?.fechar().catch(() => {});
        navegador = null;
        aba = null;
        if (tentativa === 2) throw new Error(`a comparação de ${basename(a)} parou duas vezes, com o Chrome sem responder (${err.message})`);
      }
    }
  };
  try {
    for (const id of [...de.antes].filter((f) => de.depois.has(f))) {
      const a = join(pastas.antes, `${id}.png`), denovo = join(pastas.deNovo, `${id}.png`);
      const ruido = existsSync(denovo) ? await comparar(a, denovo) : null;
      if (ruido) { delete ruido.marca; instaveis.push({ id, ...ruido }); continue; }
      const r = await comparar(a, join(pastas.depois, `${id}.png`));
      if (!r) { iguais.push(id); continue; }
      writeFileSync(join(pastas.diferenca, `${id}.png`), Buffer.from(r.marca.split(',')[1], 'base64'));
      delete r.marca;
      mudaram.push({ id, ...r });
    }
  } finally {
    await navegador?.fechar();
  }

  const cenas = JSON.parse(readFileSync(join(pastas.depois, 'indice.json'), 'utf8')).cenas || {};
  const conta = { app, antes, depois, figuras: iguais.length + mudaram.length + instaveis.length, iguais, mudaram, instaveis, soAntes, soDepois, faltasNovas };
  writeFileSync(join(saida, 'comparacao.json'), `${JSON.stringify(conta, null, 2)}\n`);
  writeFileSync(join(saida, 'comparacao.html'), pagina({ ...conta, cenas }));

  linha('FIGURAS', conta.figuras);
  linha('IGUAIS', iguais.length);
  linha('MUDARAM', mudaram.length);
  for (const m of mudaram) linha('MUDOU', `${m.id}: ${m.pixels} px${m.caixa ? ` numa caixa de ${m.caixa.w}x${m.caixa.h} em (${m.caixa.x}, ${m.caixa.y})` : ''}`);
  for (const m of instaveis) linha('INSTAVEL', `${m.id}: ${m.pixels} px entre duas rodadas com o Tuff de antes`);
  for (const f of soAntes) linha('SO_ANTES', f);
  for (const f of soDepois) linha('SO_DEPOIS', f);
  for (const f of faltasNovas) linha('FALTA_NOVA', f);
  linha('PAGINA', join(saida, 'comparacao.html'));
  return 0;
}

// O `fechar` do navegador espera o perfil do Chrome soltar os arquivos com temporizadores que não
// seguram o processo. Sem mais nada pendente, o Node sairia com 0 no meio dessa espera, antes de a
// conta ser escrita: o intervalo segura o processo até o `main` terminar.
const aceso = setInterval(() => {}, 1000);
main()
  .then((codigo) => { process.exitCode = codigo; }, (err) => { console.error(`tuff-antes-e-depois: ${err.message}`); process.exitCode = 1; })
  .finally(() => clearInterval(aceso));
