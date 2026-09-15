// O site da documentação, gerado de verdade: `gerar()` sobre a `docs/` deste checkout, num
// diretório temporário, e o que sai é medido pelo que ele contém. Cada `.md` da árvore vira um
// `.html`; todo `href` interno chega a um arquivo da saída e, com `#`, a um `id` daquele
// arquivo; `busca.json` lista cada página com título. `renderizar()` recusa o que o gerador
// não conhece, nomeando a linha, e a tabela com `\|` sai com o `|` dentro da célula.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerar, renderizar } from '../scripts/gerar-site.js';
import { LINGUAGENS, realcar, semRealce } from '../scripts/realce.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = mkdtempSync(join(tmpdir(), 'vssh-sdk-site-'));
process.on('exit', () => rmSync(SAIDA, { recursive: true, force: true }));

gerar(RAIZ, SAIDA);

function arquivosEm(dir, base = '') {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const abs = join(dir, nome);
    const rel = base ? `${base}/${nome}` : nome;
    if (statSync(abs).isDirectory()) out.push(...arquivosEm(abs, rel));
    else out.push(rel);
  }
  return out;
}

/** As páginas que o gerador escreveu: todo `.html` da saída fora do `api/` copiado. */
const PAGINAS = arquivosEm(SAIDA).filter((a) => a.endsWith('.html') && !a.startsWith('api/'));

test('cada .md da árvore virou um .html', () => {
  const fontes = [...arquivosEm(join(RAIZ, 'docs'), 'docs').filter((a) => a.endsWith('.md')), 'MIGRATION.md', 'README.md'];
  const esperado = (md) => {
    if (md === 'docs/README.md') return 'index.html';
    if (md === 'MIGRATION.md') return 'migracao.html';
    if (md === 'README.md') return 'repositorio.html';
    return `${md.slice('docs/'.length, -'.md'.length)}.html`;
  };
  assert.ok(fontes.length >= 20, `esperava a documentação inteira, achei ${fontes.length} .md`);
  const faltam = fontes.map(esperado).filter((h) => !PAGINAS.includes(h));
  assert.deepEqual(faltam, []);
  assert.equal(PAGINAS.length, fontes.length, 'a saída tem exatamente uma página por .md');
});

test('todo href interno chega a um arquivo da saída, e toda âncora a um id', () => {
  const quebrados = [];
  const ids = new Map();
  const idsDe = (arquivo) => {
    if (!ids.has(arquivo)) {
      const html = readFileSync(join(SAIDA, arquivo), 'utf8');
      ids.set(arquivo, new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1])));
    }
    return ids.get(arquivo);
  };
  let contados = 0;
  for (const pagina of PAGINAS) {
    const html = readFileSync(join(SAIDA, pagina), 'utf8');
    // `<a>`, `<link>` e `<script>`; o `<use href="#ico-…">` aponta para o sprite que o
    // `tuff-icones.js` instala em runtime, e não para um id do documento.
    for (const m of html.matchAll(/<(?:a|link|script)\s[^>]*?(?:href|src)="([^"]*)"/g)) {
      const alvo = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(alvo)) continue;
      contados++;
      const cerquilha = alvo.indexOf('#');
      const caminho = cerquilha < 0 ? alvo : alvo.slice(0, cerquilha);
      const frag = cerquilha < 0 ? null : decodeURIComponent(alvo.slice(cerquilha + 1));
      const arquivo = caminho ? posix.normalize(posix.join(posix.dirname(pagina), caminho)) : pagina;
      if (!existsSync(join(SAIDA, arquivo)) || statSync(join(SAIDA, arquivo)).isDirectory()) {
        quebrados.push(`${pagina} -> ${alvo} (não existe)`);
        continue;
      }
      if (frag !== null && arquivo.endsWith('.html') && !idsDe(arquivo).has(frag)) {
        quebrados.push(`${pagina} -> ${alvo} (sem id "${frag}")`);
      }
    }
  }
  assert.ok(contados > 200, `esperava centenas de links internos, contei ${contados}`);
  assert.deepEqual(quebrados, []);
});

test('busca.json lista cada página com título e seção', () => {
  const busca = JSON.parse(readFileSync(join(SAIDA, 'busca.json'), 'utf8'));
  const urls = busca.map((p) => p.url).sort();
  assert.deepEqual(urls, [...PAGINAS].sort());
  for (const p of busca) {
    assert.ok(typeof p.titulo === 'string' && p.titulo.trim(), `${p.url}: título vazio`);
    assert.ok(typeof p.secao === 'string' && p.secao.trim(), `${p.url}: seção vazia`);
    assert.ok(Array.isArray(p.cabecalhos), `${p.url}: cabeçalhos`);
    assert.ok(typeof p.texto === 'string' && p.texto.length > 50, `${p.url}: texto curto demais`);
    // Texto plano, sem entidade escapada: um `<a target>` citado em código é texto de verdade.
    assert.doesNotMatch(p.texto, /&(?:lt|gt|amp|quot|#39);/, `${p.url}: entidade HTML no texto da busca`);
  }
  // O que a página diz no `<title>` é o que a busca mostra.
  const arquivos = busca.find((p) => p.url === 'referencia/arquivos.html');
  assert.equal(arquivos.titulo, 'vssh.arquivos');
  assert.ok(arquivos.texto.includes('escolherArquivo'));
});

test('a página gerada tem o markup da gaveta e marca a página atual', () => {
  const html = readFileSync(join(SAIDA, 'conceitos', 'a-janela.html'), 'utf8');
  assert.match(html, /^<!doctype html>\n<html lang="pt-BR">/);
  assert.match(html, /<title>A janela · VSSH SDK<\/title>/);
  assert.ok(html.includes('<a class="tuff-gaveta-item tuff-gaveta-item--ativo" href="a-janela.html" aria-current="page"'));
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.ok(html.includes('<strong class="site-secao">Conceitos</strong>'));
  assert.ok(html.includes('rel="prev"') && html.includes('rel="next"'));
  assert.doesNotMatch(html, /<script src="https?:/, 'sem script externo');
});

test('renderizar recusa imagem e HTML, nomeando arquivo e linha', () => {
  assert.throws(
    () => renderizar('# Título\n\nUm parágrafo.\n\n![figura](x.png)\n', { arquivo: 'docs/x.md' }),
    (e) => e.message.startsWith('docs/x.md:5:') && /imagem/.test(e.message),
  );
  assert.throws(
    () => renderizar('# Título\n\n<div class="caixa">oi</div>\n', { arquivo: 'docs/y.md' }),
    (e) => e.message.startsWith('docs/y.md:3:') && /HTML/.test(e.message),
  );
  assert.throws(
    () => renderizar('# Título\n\ntexto com <span>tag</span> no meio\n', { arquivo: 'z.md' }),
    (e) => e.message.startsWith('z.md:3:'),
  );
  assert.throws(() => renderizar('# T\n\n---\n', { arquivo: 'w.md' }), (e) => e.message.startsWith('w.md:3:'));
});

test('renderizar: o subconjunto que a documentação usa', () => {
  const r = renderizar([
    '# O `titulo`',
    '',
    '> Uma citação',
    '> de duas linhas.',
    '',
    '| campo | tipo |',
    '|---|---|',
    '| `a \\| b` | `string \\| null` |',
    '',
    '- item com `código` e [link](x.md#âncora)',
    '- item com \\<id\\> escapado',
    '',
    '1. primeiro',
    '2. segundo',
    '',
    '```js',
    'if (a < b) { }',
    '```',
    '',
    'Parágrafo com **negrito** e `pgrep -f "x',
    '<id>"` continuando.',
    '',
    '## Seção',
  ].join('\n'), { arquivo: 'docs/t.md' });

  assert.equal(r.titulo, 'O titulo');
  assert.ok(r.html.includes('<h1 id="o-titulo">O <code>titulo</code></h1>'));
  assert.ok(r.html.includes('<td><code>a | b</code></td><td><code>string | null</code></td>'));
  assert.ok(r.html.includes('<blockquote>\n<p>Uma citação\nde duas linhas.</p>\n</blockquote>'));
  assert.ok(r.html.includes('<li>item com <code>código</code> e <a href="x.md#âncora">link</a></li>'));
  assert.ok(r.html.includes('<li>item com &lt;id&gt; escapado</li>'));
  assert.ok(r.html.includes('<ol>\n<li>primeiro</li>\n<li>segundo</li>\n</ol>'));
  assert.ok(r.html.includes('<pre><code class="linguagem-js"><span class="rc-kw">if</span> (a &lt; b) { }\n</code></pre>'));
  assert.ok(r.html.includes('<strong>negrito</strong>'));
  assert.ok(r.html.includes('<code>pgrep -f &quot;x &lt;id&gt;&quot;</code>'));
  assert.deepEqual(r.cabecalhos.map((c) => c.id), ['o-titulo', 'seção']);
  // O texto plano traz o `<id>` desescapado e o `|` da célula, e nenhuma entidade.
  assert.ok(r.texto.includes('item com <id> escapado') && r.texto.includes('a | b') && !r.texto.includes('&lt;'));
});

test('renderizar: lista frouxa ganha <p>, e cerca indentada dentro de item sai sem a indentação', () => {
  const r = renderizar([
    '# T',
    '',
    '1. Crie o repositório:',
    '   ```bash',
    '   cp -r a b',
    '   ```',
    '   E depois isto.',
    '',
    '2. Segundo passo.',
  ].join('\n'), { arquivo: 'docs/l.md' });
  assert.ok(r.html.includes('<li><p>Crie o repositório:</p>\n<pre><code class="linguagem-bash">cp -r a b\n</code></pre>\n<p>E depois isto.</p></li>'));
  assert.ok(r.html.includes('<li><p>Segundo passo.</p></li>'));
});

test('gerar recusa página fora do índice e link para arquivo inexistente', (t) => {
  const bancada = mkdtempSync(join(tmpdir(), 'vssh-sdk-site-bancada-'));
  t.after(() => rmSync(bancada, { recursive: true, force: true }));
  // O checkout inteiro, menos o que não é fonte: os links do README apontam para pastas do
  // repositório, e o gerador confere que elas existem.
  cpSync(RAIZ, bancada, { recursive: true, filter: (src) => !/[\/](?:\.git|node_modules|_site)(?:[\/]|$)/.test(src) });

  mkdirSync(join(bancada, 'docs', 'conceitos'), { recursive: true });
  writeFileSync(join(bancada, 'docs', 'conceitos', 'orfa.md'), '# Órfã\n\nNinguém me lista.\n');
  assert.throws(() => gerar(bancada, join(bancada, '_site')), /docs\/conceitos\/orfa\.md: página fora de site\/indice\.json/);
  rmSync(join(bancada, 'docs', 'conceitos', 'orfa.md'));

  writeFileSync(join(bancada, 'docs', 'guias', 'gpu.md'), '# GPU\n\nVer [isto](nao-existe.md) e [aquilo](../conceitos/a-janela.md#secao-que-nao-ha).\n');
  assert.throws(() => gerar(bancada, join(bancada, '_site')), (e) => /docs\/guias\/gpu\.md:3: link para nao-existe\.md/.test(e.message));
  writeFileSync(join(bancada, 'docs', 'guias', 'gpu.md'), '# GPU\n\nVer [aquilo](../conceitos/a-janela.md#secao-que-nao-ha).\n');
  assert.throws(() => gerar(bancada, join(bancada, '_site')), (e) => /docs\/guias\/gpu\.md:3: âncora #secao-que-nao-ha não existe em conceitos\/a-janela\.html/.test(e.message));
});

// ─── O realce ─────────────────────────────────────────────────────────────────

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => t.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Toda cerca de um `.md`: `{ arquivo, linha, linguagem, codigo }`. */
function cercasDe(arquivo) {
  const ls = readFileSync(join(RAIZ, arquivo), 'utf8').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const m = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/.exec(ls[i]);
    if (!m) continue;
    const fecho = new RegExp(`^\\s*${m[2][0]}{${m[2].length},}\\s*$`);
    const corpo = [];
    let j = i + 1;
    while (j < ls.length && !fecho.test(ls[j])) {
      corpo.push(ls[j].replace(new RegExp(`^ {0,${m[1].length}}`), ''));
      j++;
    }
    out.push({ arquivo, linha: i + 1, linguagem: m[3], codigo: corpo.join('\n') });
    i = j;
  }
  return out;
}

test('toda cerca da documentação passa pelo realce, e sem as tags volta o fonte escapado', () => {
  const fontes = [...arquivosEm(join(RAIZ, 'docs'), 'docs').filter((a) => a.endsWith('.md')), 'MIGRATION.md', 'README.md'];
  const cercas = fontes.flatMap(cercasDe).filter((c) => c.linguagem && c.linguagem !== 'tuff-icones');
  assert.ok(cercas.length >= 50, `esperava o corpus inteiro, achei ${cercas.length} cercas com linguagem`);
  for (const l of new Set(cercas.map((c) => c.linguagem))) assert.ok(LINGUAGENS.has(l), `linguagem fora da tabela: ${l}`);
  // As formas que o realce distingue aparecem no corpus: um teste que passasse com tudo em texto
  // cru não mediria o realce.
  let comSpan = 0;
  for (const c of cercas) {
    const html = realcar(c.codigo, c.linguagem);
    assert.equal(semRealce(html), esc(c.codigo), `${c.arquivo}:${c.linha}: o realce mudou o fonte`);
    if (/<span class="rc-/.test(html)) comSpan++;
  }
  assert.ok(comSpan > cercas.length / 2, `só ${comSpan} de ${cercas.length} cercas ganharam realce`);
});

test('o realce distingue comentário, string e palavra-chave, e uma palavra-chave dentro de string é texto', () => {
  const js = realcar("const s = 'if'; // const\nreturn s;", 'js');
  assert.ok(js.includes('<span class="rc-kw">const</span> s = <span class="rc-str">&#39;if&#39;</span>; <span class="rc-com">// const</span>'));
  assert.ok(js.includes('<span class="rc-kw">return</span> s;'));
  const py = realcar('x = None  # if', 'python');
  assert.ok(py.includes('<span class="rc-lit">None</span>  <span class="rc-com"># if</span>'));
  const html = realcar('<button class="tuff-btn" disabled>if</button>', 'html');
  assert.ok(html.includes('<span class="rc-tag">&lt;button</span> <span class="rc-atr">class</span>=<span class="rc-str">&quot;tuff-btn&quot;</span> <span class="rc-atr">disabled</span><span class="rc-tag">&gt;</span>if<span class="rc-tag">&lt;/button</span>'));
  assert.throws(() => realcar('x', 'jss'), /linguagem desconhecida: 'jss'/);
});

test('renderizar recusa cerca de linguagem desconhecida e opção de cerca desconhecida, nomeando a linha', () => {
  assert.throws(
    () => renderizar('# T\n\n```jss\nx\n```\n', { arquivo: 'docs/x.md' }),
    (e) => e.message.startsWith('docs/x.md:3:') && /jss/.test(e.message),
  );
  assert.throws(
    () => renderizar('# T\n\n```js vivo\nx\n```\n', { arquivo: 'docs/x.md' }),
    (e) => e.message.startsWith('docs/x.md:3:') && /`vivo` só vale numa cerca `html`/.test(e.message),
  );
  assert.throws(
    () => renderizar('# T\n\n```html aovivo\nx\n```\n', { arquivo: 'docs/x.md' }),
    (e) => e.message.startsWith('docs/x.md:3:') && /aovivo/.test(e.message),
  );
});

test('a cerca `html vivo` renderiza a amostra e o markup realçado, e recusa script e handler', () => {
  const r = renderizar('# T\n\n```html vivo\n<button class="tuff-btn">oi</button>\n```\n', { arquivo: 'docs/x.md' });
  assert.ok(r.html.includes('<div class="site-vivo">\n<div class="site-vivo-amostra">\n<button class="tuff-btn">oi</button>\n</div>'));
  assert.ok(r.html.includes('<pre><code class="linguagem-html"><span class="rc-tag">&lt;button</span>'));
  assert.ok(r.texto.includes('<button class="tuff-btn">oi</button>'));
  for (const corpo of ['<script>alert(1)</script>', '<SCRIPT src=x>', '<div onclick="x()">a</div>']) {
    assert.throws(
      () => renderizar(`# T\n\n\`\`\`html vivo\n${corpo}\n\`\`\`\n`, { arquivo: 'docs/x.md' }),
      (e) => e.message.startsWith('docs/x.md:3:') && /amostra viva/.test(e.message),
      corpo,
    );
  }
});

test('a cerca `html vivo` avisa as classes tuff-* da amostra, e o código inline as suas', () => {
  const classes = new Set();
  renderizar('# T\n\nUse `.tuff-painel` e `tuff-btn--primario`, e não `tuff-tokens.css` nem `_sdk/tuff/tuff.js`.\n\n```html vivo\n<div class="tuff-lista x"><span data-tuff-dica="a" class="tuff-tag">b</span></div>\n```\n', { arquivo: 'docs/x.md', classes });
  assert.deepEqual([...classes].map((c) => c.classe).sort(), ['tuff-btn--primario', 'tuff-lista', 'tuff-painel', 'tuff-tag']);
});

test('a cerca `tuff-icones` vira a grade do sprite, e sem o sprite é recusada', () => {
  const r = renderizar('# T\n\n```tuff-icones\n```\n', { arquivo: 'docs/x.md', icones: ['folder', 'x-circle'] });
  assert.ok(r.html.includes('<div class="site-icones">'));
  assert.ok(r.html.includes('<use href="#ico-folder"></use></svg><code>folder</code>'));
  assert.ok(r.html.includes('<code>x-circle</code>'));
  assert.ok(r.texto.includes('folder x-circle'));
  assert.throws(() => renderizar('# T\n\n```tuff-icones\n```\n', { arquivo: 'docs/x.md' }), /docs\/x\.md:3: .*sem o sprite/);
  assert.throws(() => renderizar('# T\n\n```tuff-icones\nfolder\n```\n', { arquivo: 'docs/x.md', icones: ['folder'] }), /docs\/x\.md:3: .*não leva corpo/);
});

test('a página de ícones lista cada símbolo do sprite, e só eles', () => {
  const sprite = readFileSync(join(RAIZ, 'api', 'tuff', 'tuff-icones.js'), 'utf8');
  const noSprite = new Set([...sprite.matchAll(/id="ico-([a-z0-9-]+)"/g)].map((m) => m[1]));
  assert.ok(noSprite.size >= 60, `o sprite tem ${noSprite.size} ícones`);
  const html = readFileSync(join(SAIDA, 'aparencia', 'icones.html'), 'utf8');
  const naPagina = new Set([...html.matchAll(/<div class="site-icone">.*?href="#ico-([a-z0-9-]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...naPagina].sort(), [...noSprite].sort());
});

test('gerar recusa amostra com classe que folha nenhuma define, e com ícone fora do sprite', (t) => {
  const bancada = mkdtempSync(join(tmpdir(), 'vssh-sdk-site-tuff-'));
  t.after(() => rmSync(bancada, { recursive: true, force: true }));
  cpSync(RAIZ, bancada, { recursive: true, filter: (src) => !/[\/](?:\.git|node_modules|_site)(?:[\/]|$)/.test(src) });
  const alvo = join(bancada, 'docs', 'aparencia', 'icones.md');
  writeFileSync(alvo, '# Ícones\n\n```html vivo\n<button class="tuff-btn tuff-btn--brilhante">x</button>\n```\n');
  assert.throws(() => gerar(bancada, join(bancada, '_site')), /docs\/aparencia\/icones\.md:3: a classe `tuff-btn--brilhante` não existe/);
  writeFileSync(alvo, '# Ícones\n\n```html vivo\n<svg class="tuff-ico"><use href="#ico-unicornio"></use></svg>\n```\n');
  assert.throws(() => gerar(bancada, join(bancada, '_site')), /docs\/aparencia\/icones\.md:3: amostra viva com o ícone `unicornio`/);
  writeFileSync(alvo, '# Ícones\n\nA classe `.tuff-inventada` em código inline também conta.\n');
  assert.throws(() => gerar(bancada, join(bancada, '_site')), /docs\/aparencia\/icones\.md:3: a classe `tuff-inventada` não existe/);
});
