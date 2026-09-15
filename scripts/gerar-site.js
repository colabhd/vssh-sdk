#!/usr/bin/env node
// O site da documentação: `docs/`, `MIGRATION.md` e `README.md` em HTML, com o Tuff, para o
// GitHub Pages.
//
//     node scripts/gerar-site.js [--saida _site] [--raiz <checkout>]
//
// O gerador é próprio, sem parser vendorizado, e implementa só o subconjunto de Markdown que a
// documentação usa: cabeçalho, parágrafo, lista, tabela GFM, cerca, citação, código inline,
// negrito e link. O que ele não conhece (imagem, tag HTML, régua horizontal, código por
// indentação) derruba o build nomeando o arquivo e a linha. Um parser completo aceitaria em
// silêncio o que ninguém revisou, e a página sairia com um `<div>` cru no meio do texto.
//
// A âncora de um cabeçalho é a do GitHub (minúsculas, só letra, número, espaço e hífen, espaço
// vira hífen), para que os `#…` que os `.md` já usam continuem valendo. A mesma regra vive no
// `gerar-sdk.js` do `vssh-sso` e em `tests/docs-links.test.js`.
//
// `renderizar()` e `gerar()` são exportados para `tests/site.test.js` os executar.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORIO = 'https://github.com/colabhd/vssh-sdk';
const SAIDA_PADRAO = '_site';

// ─── Erros ───────────────────────────────────────────────────────────────────

/** Um erro que aponta arquivo e linha: é o que a pessoa lê no log do build. */
export class ErroDeMarkdown extends Error {
  constructor(arquivo, linha, mensagem) {
    super(`${arquivo}:${linha}: ${mensagem}`);
    this.arquivo = arquivo;
    this.linha = linha;
  }
}

const erro = (ctx, linha, mensagem) => new ErroDeMarkdown(ctx.arquivo, linha, mensagem);

// ─── Texto ───────────────────────────────────────────────────────────────────

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A âncora que o GitHub dá a um cabeçalho. */
export const ancora = (titulo) => titulo.trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

const PONTUACAO_ASCII = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

// ─── Inline ──────────────────────────────────────────────────────────────────

/** Um span de código que começa em `i`: o fecho tem o mesmo número de crases. */
function lerCodigo(s, i) {
  let n = 0;
  while (s[i + n] === '`') n++;
  const abre = '`'.repeat(n);
  let j = i + n;
  for (;;) {
    const k = s.indexOf(abre, j);
    if (k < 0) return null;
    let m = 0;
    while (s[k + m] === '`') m++;
    if (m === n) {
      let conteudo = s.slice(i + n, k).replace(/\n/g, ' ');
      if (conteudo.length > 2 && conteudo.startsWith(' ') && conteudo.endsWith(' ') && conteudo.trim()) {
        conteudo = conteudo.slice(1, -1);
      }
      return { conteudo, fim: k + m };
    }
    j = k + m;
  }
}

/** Um link `[texto](alvo)` que começa em `i`, com crase dentro do texto respeitada. */
function lerLink(s, i) {
  let j = i + 1;
  let nivel = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') {
      const cod = lerCodigo(s, j);
      j = cod ? cod.fim : j + 1;
      continue;
    }
    if (c === '[') nivel++;
    else if (c === ']') {
      if (nivel === 0) break;
      nivel--;
    }
    j++;
  }
  if (s[j] !== ']' || s[j + 1] !== '(') return null;
  const fecho = s.indexOf(')', j + 2);
  if (fecho < 0) return null;
  return { texto: s.slice(i + 1, j), alvo: s.slice(j + 2, fecho), fim: fecho + 1 };
}

/**
 * Renderiza o inline de um bloco: código, negrito, link e escape de HTML. Devolve o HTML e o
 * texto plano (o que a busca indexa e o que vira âncora).
 */
function inline(s, ctx, linha) {
  let html = '';
  let texto = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && PONTUACAO_ASCII.test(s[i + 1])) {
      html += esc(s[i + 1]);
      texto += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const cod = lerCodigo(s, i);
      if (cod) {
        html += `<code>${esc(cod.conteudo)}</code>`;
        texto += cod.conteudo;
        i = cod.fim;
        continue;
      }
    }
    if (c === '!' && s[i + 1] === '[') {
      throw erro(ctx, linha, `imagem (\`${s.slice(i, i + 24)}\`): o gerador não conhece \`![…]\``);
    }
    if (c === '[') {
      const l = lerLink(s, i);
      if (l) {
        if (/\s/.test(l.alvo)) throw erro(ctx, linha, `link com espaço ou título no alvo: \`${l.alvo}\``);
        const dentro = inline(l.texto, ctx, linha);
        const destino = ctx.link(l.alvo, linha);
        const rel = destino.externo ? ' rel="noopener"' : '';
        html += `<a href="${esc(destino.href)}"${rel}>${dentro.html}</a>`;
        texto += dentro.texto;
        i = l.fim;
        continue;
      }
    }
    if (c === '*' && s[i + 1] === '*') {
      const fim = s.indexOf('**', i + 2);
      if (fim > i + 2) {
        const dentro = inline(s.slice(i + 2, fim), ctx, linha);
        html += `<strong>${dentro.html}</strong>`;
        texto += dentro.texto;
        i = fim + 2;
        continue;
      }
    }
    if (c === '<' && /[A-Za-z!/?]/.test(s[i + 1] || '')) {
      throw erro(ctx, linha, `HTML no texto (\`${s.slice(i, i + 24)}\`): o gerador não interpreta tag; escreva \\< ou ponha em código`);
    }
    html += esc(c);
    texto += c;
    i++;
  }
  return { html, texto };
}

// ─── Blocos ──────────────────────────────────────────────────────────────────

const CERCA = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const CABECALHO = /^(#{1,6})\s+(.*?)\s*$/;
const CITACAO = /^\s*>/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const DELIMITADOR_DE_TABELA = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const REGUA = /^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$/;
const HTML_DE_BLOCO = /^\s*<[A-Za-z!/?]/;
const IMAGEM = /^\s*!\[/;
const INDENTADO = /^ {4,}\S/;

const ehTabela = (ls, i) => /^\s*\|/.test(ls[i].texto) && i + 1 < ls.length && DELIMITADOR_DE_TABELA.test(ls[i + 1].texto);

/**
 * Uma linha que abre um bloco que interrompe um parágrafo. Tag HTML e imagem ficam de fora de
 * propósito: um `<id>"` no começo de uma linha pode ser a continuação de um span de código aberto
 * na linha anterior, e quem sabe distinguir é o renderizador de inline, com o parágrafo inteiro.
 */
function abreBloco(ls, i) {
  const t = ls[i].texto;
  return CERCA.test(t) || CABECALHO.test(t) || CITACAO.test(t) || ITEM.test(t) || ehTabela(ls, i)
    || REGUA.test(t);
}

/** Células de uma linha de tabela, com `\|` preservado como `|` dentro da célula. */
function celulas(linha) {
  const partes = [];
  let atual = '';
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '\\' && linha[i + 1] === '|') { atual += '|'; i++; continue; }
    if (c === '|') { partes.push(atual); atual = ''; continue; }
    atual += c;
  }
  partes.push(atual);
  if (partes.length && partes[0].trim() === '') partes.shift();
  if (partes.length && partes[partes.length - 1].trim() === '') partes.pop();
  return partes.map((p) => p.trim());
}

function alinhamentos(linha) {
  return celulas(linha).map((c) => {
    const esq = c.startsWith(':');
    const dir = c.endsWith(':');
    if (esq && dir) return 'center';
    if (dir) return 'right';
    return null;
  });
}

/**
 * Lê os itens de uma lista que começa em `ls[i]`. Devolve os itens (cada um com as linhas dele,
 * já sem a indentação do conteúdo) e se a lista é frouxa (itens separados por linha em branco,
 * que é o que decide se o parágrafo de cada item ganha `<p>`).
 */
function lerLista(ls, i) {
  const primeiro = ITEM.exec(ls[i].texto);
  const indentDaLista = primeiro[1].length;
  const ordenada = /\d/.test(primeiro[2]);
  const itens = [];
  let frouxa = false;
  let brancoEntreItens = false;
  while (i < ls.length) {
    const m = ITEM.exec(ls[i].texto);
    if (!m || m[1].length !== indentDaLista || /\d/.test(m[2]) !== ordenada) break;
    const indentDoConteudo = m[1].length + m[2].length + m[3].length;
    const linhas = [{ texto: m[4], linha: ls[i].linha }];
    let brancoPendente = 0;
    i++;
    while (i < ls.length) {
      const t = ls[i].texto;
      if (t.trim() === '') { brancoPendente++; i++; continue; }
      const indent = /^\s*/.exec(t)[0].length;
      if (indent >= indentDoConteudo) {
        if (brancoPendente) frouxa = true;
        for (let k = 0; k < brancoPendente; k++) linhas.push({ texto: '', linha: ls[i].linha - brancoPendente + k });
        brancoPendente = 0;
        linhas.push({ texto: t.slice(indentDoConteudo), linha: ls[i].linha });
        i++;
        continue;
      }
      // Linha menos indentada: um item novo, o fim da lista, ou a continuação preguiçosa de um
      // parágrafo do item (sem branco antes e sem abrir bloco nenhum).
      if (brancoPendente || abreBloco(ls, i)) break;
      linhas.push({ texto: t.trim(), linha: ls[i].linha });
      i++;
    }
    itens.push({ linhas, numero: ordenada ? parseInt(m[2], 10) : null });
    const proximo = i < ls.length ? ITEM.exec(ls[i].texto) : null;
    const mesmaLista = proximo && proximo[1].length === indentDaLista && /\d/.test(proximo[2]) === ordenada;
    if (brancoPendente && mesmaLista) brancoEntreItens = true;
  }
  return { itens, ordenada, frouxa: frouxa || brancoEntreItens, fim: i };
}

/** Renderiza uma sequência de linhas como blocos. Cada bloco sai com HTML e texto plano. */
function blocos(ls, ctx) {
  const saida = [];
  let i = 0;
  while (i < ls.length) {
    const { texto: t, linha } = ls[i];
    if (t.trim() === '') { i++; continue; }

    let m;
    if ((m = CERCA.exec(t))) {
      const indent = m[1].length;
      const marca = m[2];
      const linguagem = m[3];
      const fecho = new RegExp(`^\\s*${marca[0]}{${marca.length},}\\s*$`);
      const corpo = [];
      let j = i + 1;
      while (j < ls.length && !fecho.test(ls[j].texto)) {
        corpo.push(ls[j].texto.replace(new RegExp(`^ {0,${indent}}`), ''));
        j++;
      }
      if (j >= ls.length) throw erro(ctx, linha, 'cerca de código sem fechamento');
      const classe = linguagem ? ` class="linguagem-${esc(linguagem)}"` : '';
      const codigo = corpo.join('\n');
      saida.push({ tipo: 'cerca', html: `<pre><code${classe}>${esc(codigo)}${codigo ? '\n' : ''}</code></pre>`, texto: codigo });
      i = j + 1;
      continue;
    }

    if ((m = CABECALHO.exec(t))) {
      const nivel = m[1].length;
      const { html, texto } = inline(m[2], ctx, linha);
      const base = ancora(texto);
      const n = ctx.ancoras.get(base) || 0;
      ctx.ancoras.set(base, n + 1);
      const id = n === 0 ? base : `${base}-${n}`;
      ctx.cabecalhos.push({ nivel, texto, id, linha });
      saida.push({ tipo: 'cabecalho', nivel, html: `<h${nivel} id="${esc(id)}">${html}</h${nivel}>`, texto });
      i++;
      continue;
    }

    if (CITACAO.test(t)) {
      const dentro = [];
      while (i < ls.length && CITACAO.test(ls[i].texto)) {
        dentro.push({ texto: ls[i].texto.replace(/^\s*>\s?/, ''), linha: ls[i].linha });
        i++;
      }
      const filhos = blocos(dentro, ctx);
      saida.push({ tipo: 'citacao', html: `<blockquote>\n${filhos.map((b) => b.html).join('\n')}\n</blockquote>`, texto: filhos.map((b) => b.texto).join('\n') });
      continue;
    }

    if (ehTabela(ls, i)) {
      const cabecas = celulas(t);
      const alinhar = alinhamentos(ls[i + 1].texto);
      const linhas = [];
      let j = i + 2;
      while (j < ls.length && /^\s*\|/.test(ls[j].texto)) {
        linhas.push({ celulas: celulas(ls[j].texto), linha: ls[j].linha });
        j++;
      }
      const textos = [];
      const celula = (tag, conteudo, k, l) => {
        const { html, texto } = inline(conteudo, ctx, l);
        textos.push(texto);
        const estilo = alinhar[k] ? ` style="text-align:${alinhar[k]}"` : '';
        return `<${tag}${estilo}>${html}</${tag}>`;
      };
      let html = '<div class="site-tabela"><table>\n<thead><tr>';
      html += cabecas.map((c, k) => celula('th', c, k, linha)).join('');
      html += '</tr></thead>\n<tbody>\n';
      for (const l of linhas) {
        const cs = cabecas.map((_, k) => l.celulas[k] ?? '');
        html += `<tr>${cs.map((c, k) => celula('td', c, k, l.linha)).join('')}</tr>\n`;
      }
      html += '</tbody>\n</table></div>';
      saida.push({ tipo: 'tabela', html, texto: textos.join(' ') });
      i = j;
      continue;
    }

    if (ITEM.test(t)) {
      const lista = lerLista(ls, i);
      const tag = lista.ordenada ? 'ol' : 'ul';
      const inicio = lista.ordenada && lista.itens[0].numero !== 1 ? ` start="${lista.itens[0].numero}"` : '';
      const partes = [];
      const textos = [];
      for (const item of lista.itens) {
        const filhos = blocos(item.linhas, ctx);
        const html = filhos.map((b) => (!lista.frouxa && b.tipo === 'paragrafo' ? b.html.slice(3, -4) : b.html)).join('\n');
        partes.push(`<li>${html}</li>`);
        textos.push(filhos.map((b) => b.texto).join('\n'));
      }
      saida.push({ tipo: 'lista', html: `<${tag}${inicio}>\n${partes.join('\n')}\n</${tag}>`, texto: textos.join('\n') });
      i = lista.fim;
      continue;
    }

    if (REGUA.test(t)) throw erro(ctx, linha, 'régua horizontal (ou sublinhado de cabeçalho setext): o gerador não a conhece; separe com um cabeçalho');
    if (HTML_DE_BLOCO.test(t)) throw erro(ctx, linha, `HTML no texto (\`${t.trim().slice(0, 24)}\`): o gerador não interpreta tag; escreva \\< ou ponha em código`);
    if (IMAGEM.test(t)) throw erro(ctx, linha, 'imagem: o gerador não conhece `![…]`');
    if (INDENTADO.test(t)) throw erro(ctx, linha, 'bloco indentado com quatro espaços (código por indentação?): use uma cerca');

    const paragrafo = [];
    let j = i;
    while (j < ls.length && ls[j].texto.trim() !== '' && (j === i || !abreBloco(ls, j))) {
      paragrafo.push(ls[j].texto.trim());
      j++;
    }
    const { html, texto } = inline(paragrafo.join('\n'), ctx, linha);
    saida.push({ tipo: 'paragrafo', html: `<p>${html}</p>`, texto });
    i = j;
  }
  return saida;
}

/**
 * Renderiza uma página Markdown. `opcoes.arquivo` nomeia o arquivo nas mensagens de erro;
 * `opcoes.link(alvo, linha)` resolve cada alvo de link e devolve `{ href, externo }` (por padrão,
 * o alvo como está). Devolve `{ html, titulo, cabecalhos, texto }`: o título é o único h1, ou
 * `null` quando a página não tem um.
 */
export function renderizar(markdown, opcoes = {}) {
  const ctx = {
    arquivo: opcoes.arquivo || '<texto>',
    link: opcoes.link || ((alvo) => ({ href: alvo, externo: /^[a-z][a-z0-9+.-]*:/i.test(alvo) })),
    ancoras: new Map(),
    cabecalhos: [],
  };
  const ls = markdown.replace(/\r\n?/g, '\n').split('\n').map((texto, k) => ({ texto, linha: k + 1 }));
  const saida = blocos(ls, ctx);
  const h1 = ctx.cabecalhos.filter((c) => c.nivel === 1);
  if (h1.length > 1) throw erro(ctx, h1[1].linha, `segundo h1 na página ("${h1[1].texto}"): cada página tem um título`);
  return {
    html: saida.map((b) => b.html).join('\n'),
    titulo: h1[0]?.texto ?? null,
    cabecalhos: ctx.cabecalhos,
    texto: saida.map((b) => b.texto).join('\n').replace(/\s+/g, ' ').trim(),
  };
}

// ─── O site ──────────────────────────────────────────────────────────────────

/** Onde uma página do repositório sai no site. */
function caminhoDeSaida(arquivo) {
  if (arquivo === 'docs/README.md') return 'index.html';
  if (arquivo === 'MIGRATION.md') return 'migracao.html';
  if (arquivo === 'README.md') return 'repositorio.html';
  if (arquivo.startsWith('docs/') && arquivo.endsWith('.md')) return `${arquivo.slice('docs/'.length, -'.md'.length)}.html`;
  throw new Error(`${arquivo}: fora do que vira página (docs/**/*.md, MIGRATION.md, README.md)`);
}

function markdownsEm(dir, base, out = []) {
  for (const nome of readdirSync(dir).sort()) {
    const abs = join(dir, nome);
    const rel = base ? `${base}/${nome}` : nome;
    if (statSync(abs).isDirectory()) markdownsEm(abs, rel, out);
    else if (nome.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** Caminho relativo, em barras normais, de um arquivo de saída a outro. */
const relativo = (de, para) => posix.relative(posix.dirname(de), para) || '.';

/** O prefixo que leva de uma página à raiz do site: `''`, `'../'`, `'../../'`. */
const prefixoDaRaiz = (de) => (posix.dirname(de) === '.' ? '' : `${posix.relative(posix.dirname(de), '.')}/`);

/**
 * Lê `site/indice.json` e devolve as seções com as páginas resolvidas. Uma entrada é o caminho de
 * uma página (string), `{ arquivo, titulo? }` para dar outro nome à página na navegação,
 * `{ url, titulo }` para um endereço fora do conjunto de páginas, ou `{ espacos: 'api/abi.json' }`,
 * que se expande numa página `docs/referencia/<espaco>.md` por espaço, na ordem da tabela.
 */
function lerIndice(raiz) {
  const caminho = join(raiz, 'site', 'indice.json');
  const indice = JSON.parse(readFileSync(caminho, 'utf8'));
  const secoes = [];
  for (const secao of indice.secoes) {
    const paginas = [];
    for (const entrada of secao.paginas) {
      if (typeof entrada === 'string') paginas.push({ arquivo: entrada });
      else if (entrada.espacos) {
        const abi = JSON.parse(readFileSync(join(raiz, entrada.espacos), 'utf8'));
        for (const espaco of Object.keys(abi.espacos)) paginas.push({ arquivo: `docs/referencia/${espaco}.md` });
      } else if (entrada.arquivo || entrada.url) paginas.push({ ...entrada });
      else throw new Error(`site/indice.json: entrada sem arquivo, url nem espacos em "${secao.titulo}": ${JSON.stringify(entrada)}`);
    }
    secoes.push({ titulo: secao.titulo, paginas });
  }
  return secoes;
}

function svgIcone(nome) {
  return `<svg class="tuff-ico" aria-hidden="true"><use href="#ico-${nome}"></use></svg>`;
}

/** O documento inteiro de uma página: cabeça, gaveta, barra, artigo e rodapé. */
function documento(p, secoes, ordem) {
  const raiz = prefixoDaRaiz(p.saida);
  const nav = secoes.map((secao) => {
    const itens = secao.paginas.map((q) => {
      const href = q.url ? `${raiz}${q.url}` : relativo(p.saida, q.saida);
      const atual = q.saida === p.saida;
      const classe = `tuff-gaveta-item${atual ? ' tuff-gaveta-item--ativo' : ''}`;
      const corrente = atual ? ' aria-current="page"' : '';
      return `      <a class="${classe}" href="${esc(href)}"${corrente} title="${esc(q.rotulo)}"><span>${esc(q.rotulo)}</span></a>`;
    });
    return `      <div class="tuff-gaveta-cap">${esc(secao.titulo)}</div>\n${itens.join('\n')}`;
  }).join('\n');

  const h2 = p.cabecalhos.filter((c) => c.nivel === 2);
  const sumario = h2.length > 1
    ? `<nav class="site-sumario" aria-label="Nesta página">\n<div class="site-sumario-titulo">Nesta página</div>\n<ul>\n${
      h2.map((c) => `<li><a href="#${esc(c.id)}">${esc(c.texto)}</a></li>`).join('\n')}\n</ul>\n</nav>`
    : '';
  const artigo = sumario ? p.html.replace('</h1>', `</h1>\n${sumario}`) : p.html;

  const k = ordem.indexOf(p);
  const anterior = k > 0 ? ordem[k - 1] : null;
  const proxima = k < ordem.length - 1 ? ordem[k + 1] : null;
  const rodape = [
    anterior ? `<a class="site-vizinha site-vizinha--anterior" href="${esc(relativo(p.saida, anterior.saida))}" rel="prev">${svgIcone('arrow-left')}<span><small>Anterior</small>${esc(anterior.titulo)}</span></a>` : '<span></span>',
    proxima ? `<a class="site-vizinha site-vizinha--proxima" href="${esc(relativo(p.saida, proxima.saida))}" rel="next"><span><small>Próxima</small>${esc(proxima.titulo)}</span>${svgIcone('arrow-right')}</a>` : '<span></span>',
  ].join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.titulo)} · VSSH SDK</title>
<link rel="stylesheet" href="${raiz}api/tuff/tuff-tokens.css">
<link rel="stylesheet" href="${raiz}api/tuff/tuff-base.css">
<link rel="stylesheet" href="${raiz}api/tuff/tuff.css">
<link rel="stylesheet" href="${raiz}site.css">
<script src="${raiz}api/tuff/tuff-icones.js" defer></script>
<script src="${raiz}site.js" defer></script>
<script src="${raiz}busca.js" defer></script>
</head>
<body data-raiz="${raiz}">
<div class="tuff-gaveta site-gaveta" id="site-gaveta">
  <div class="tuff-gaveta-veu"></div>
  <nav class="tuff-gaveta-lateral" id="site-nav" aria-label="Páginas">
    <a class="site-marca" href="${raiz}index.html">VSSH SDK</a>
${nav}
  </nav>
  <div class="tuff-gaveta-corpo" id="site-corpo">
    <div class="tuff-barra tuff-barra--fixa">
      <button class="tuff-btn tuff-btn--icone tuff-gaveta-abrir" type="button" data-tuff-gaveta-abrir aria-label="Páginas" aria-controls="site-nav" aria-expanded="false">${svgIcone('menu')}</button>
      <strong class="site-secao">${esc(p.secao)}</strong>
      <span class="tuff-barra-espaco"></span>
      <div class="site-busca">
        <input class="tuff-busca" type="search" id="site-busca" placeholder="Buscar  /" aria-label="Buscar na documentação" autocomplete="off" spellcheck="false">
        <div class="tuff-lista site-busca-resultados" id="site-busca-resultados" role="listbox" aria-label="Resultados" hidden></div>
      </div>
    </div>
    <div class="tuff-gaveta-conteudo site-conteudo">
      <article class="site-artigo">
${artigo}
      </article>
      <footer class="site-rodape">
${rodape}
      </footer>
    </div>
  </div>
</div>
</body>
</html>
`;
}

/**
 * Gera o site de `raiz` (um checkout do vssh-sdk) em `saida`. Derruba o build com a lista inteira
 * do que está errado: página fora do índice, página do índice que não existe, link para arquivo
 * que não existe na saída, âncora sem cabeçalho.
 */
export function gerar(raiz, saida = join(raiz, SAIDA_PADRAO)) {
  const secoes = lerIndice(raiz);

  // O conjunto de páginas: tudo em `docs/`, mais as duas da raiz.
  const arquivos = [...markdownsEm(join(raiz, 'docs'), 'docs'), 'MIGRATION.md', 'README.md']
    .filter((a) => existsSync(join(raiz, a)));
  const paginas = new Map(arquivos.map((a) => [a, { arquivo: a, saida: caminhoDeSaida(a) }]));

  const problemas = [];
  const noIndice = new Set();
  for (const secao of secoes) {
    for (const q of secao.paginas) {
      if (!q.arquivo) continue;
      const p = paginas.get(q.arquivo);
      if (!p) { problemas.push(`site/indice.json: "${q.arquivo}" (em "${secao.titulo}") não existe`); continue; }
      if (noIndice.has(q.arquivo)) problemas.push(`site/indice.json: "${q.arquivo}" aparece duas vezes`);
      noIndice.add(q.arquivo);
      p.secao = secao.titulo;
      q.saida = p.saida;
      q.pagina = p;
    }
  }
  for (const a of arquivos) {
    if (!noIndice.has(a)) problemas.push(`${a}: página fora de site/indice.json; ninguém publica página órfã`);
  }
  if (problemas.length) throw new Error(problemas.join('\n'));

  // Renderiza cada página, resolvendo os links contra o conjunto de páginas, o `api/` copiado e
  // o repositório no GitHub. Os alvos internos ficam anotados para a conferência do fim.
  const ligacoes = [];
  for (const p of paginas.values()) {
    const link = (alvo, linha) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(alvo)) return { href: alvo, externo: true };
      const cerquilha = alvo.indexOf('#');
      const caminho = cerquilha < 0 ? alvo : alvo.slice(0, cerquilha);
      const frag = cerquilha < 0 ? '' : alvo.slice(cerquilha);
      if (!caminho) {
        ligacoes.push({ de: p, para: p.saida, frag, linha });
        return { href: frag, externo: false };
      }
      const repo = posix.normalize(posix.join(posix.dirname(p.arquivo), decodeURIComponent(caminho))).replace(/\/$/, '');
      if (repo.startsWith('..')) throw erro({ arquivo: p.arquivo }, linha, `link para fora do repositório: ${alvo}`);
      const alvoDePagina = paginas.get(repo);
      if (alvoDePagina) {
        ligacoes.push({ de: p, para: alvoDePagina.saida, frag, linha });
        return { href: relativo(p.saida, alvoDePagina.saida) + frag, externo: false };
      }
      if (repo === 'docs') {
        ligacoes.push({ de: p, para: 'index.html', frag, linha });
        return { href: relativo(p.saida, 'index.html') + frag, externo: false };
      }
      const abs = join(raiz, repo);
      if (!existsSync(abs)) throw erro({ arquivo: p.arquivo }, linha, `link para ${alvo}: ${repo} não existe no repositório`);
      const pasta = statSync(abs).isDirectory();
      if (repo.startsWith('api/') && !pasta) {
        ligacoes.push({ de: p, para: repo, frag, linha });
        return { href: relativo(p.saida, repo) + frag, externo: false };
      }
      return { href: `${REPOSITORIO}/${pasta ? 'tree' : 'blob'}/main/${repo}${frag}`, externo: true };
    };
    const r = renderizar(readFileSync(join(raiz, p.arquivo), 'utf8'), { arquivo: p.arquivo, link });
    if (!r.titulo) throw new Error(`${p.arquivo}: página sem h1; o título do documento sai dele`);
    Object.assign(p, r);
    p.ids = new Set(r.cabecalhos.map((c) => c.id));
  }
  for (const secao of secoes) {
    for (const q of secao.paginas) {
      if (q.pagina) q.rotulo = q.titulo || q.pagina.titulo;
      else q.rotulo = q.titulo;
    }
  }
  const ordem = secoes.flatMap((s) => s.paginas).filter((q) => q.pagina).map((q) => q.pagina);

  // Escreve a saída: o `api/` inteiro (a galeria do Tuff abre com as folhas ao lado, o `vssh.d.ts`
  // é baixável), as folhas e scripts do site, uma página por `.md`, e o índice da busca.
  rmSync(saida, { recursive: true, force: true });
  mkdirSync(saida, { recursive: true });
  cpSync(join(raiz, 'api'), join(saida, 'api'), { recursive: true });
  for (const nome of ['site.css', 'site.js', 'busca.js']) cpSync(join(raiz, 'site', nome), join(saida, nome));
  for (const p of ordem) {
    const destino = join(saida, ...p.saida.split('/'));
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, documento(p, secoes, ordem));
  }
  const busca = ordem.map((p) => ({
    url: p.saida,
    titulo: p.titulo,
    secao: p.secao,
    cabecalhos: p.cabecalhos.filter((c) => c.nivel > 1).map((c) => c.texto),
    texto: p.texto,
  }));
  writeFileSync(join(saida, 'busca.json'), JSON.stringify(busca));

  // A conferência: todo link interno chega a um arquivo da saída, e toda âncora a um id.
  const quebrados = [];
  for (const l of ligacoes) {
    if (!existsSync(join(saida, ...l.para.split('/')))) {
      quebrados.push(`${l.de.arquivo}:${l.linha}: link para ${l.para}, que não existe na saída`);
      continue;
    }
    if (!l.frag) continue;
    const alvo = ordem.find((p) => p.saida === l.para);
    if (!alvo) continue;
    const id = decodeURIComponent(l.frag.slice(1)).toLowerCase();
    if (!alvo.ids.has(id)) quebrados.push(`${l.de.arquivo}:${l.linha}: âncora ${l.frag} não existe em ${l.para}`);
  }
  if (quebrados.length) throw new Error(quebrados.join('\n'));

  return { paginas: ordem.length, saida };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function principal(argv) {
  let raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let saida = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--raiz' && argv[i + 1]) raiz = resolve(argv[++i]);
    else if (argv[i] === '--saida' && argv[i + 1]) saida = resolve(argv[++i]);
    else {
      process.stderr.write(`argumento desconhecido: ${argv[i]}\nuso: node scripts/gerar-site.js [--saida ${SAIDA_PADRAO}] [--raiz <checkout>]\n`);
      return 2;
    }
  }
  try {
    const r = gerar(raiz, saida || join(raiz, SAIDA_PADRAO));
    process.stdout.write(`${r.paginas} páginas em ${r.saida}${sep}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`gerar-site: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv.slice(2));
}
