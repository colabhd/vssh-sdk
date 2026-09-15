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
  assert.ok(r.html.includes('<pre><code class="linguagem-js">if (a &lt; b) { }\n</code></pre>'));
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
