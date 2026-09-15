// O realce de código do site: o fonte de uma cerca vira HTML com `<span class="rc-…">` em volta
// de comentário, string, número, palavra-chave e do que mais cada linguagem distingue. Sem
// dependência, como o resto do gerador, e para o conjunto fechado de linguagens que a
// documentação usa: um nome fora dele é recusado por quem chama, para um `js` escrito `jss` não
// sair como texto cru sem ninguém notar.
//
// A forma é a mesma para toda linguagem: uma lista de regras `[regex, classe]`, tentadas na
// posição corrente, e a primeira que casa emite o trecho; o que nenhuma regra reconhece sai
// como texto. O HTML é a concatenação dos trechos escapados, então tirar as tags devolve o fonte
// escapado byte a byte, e é isso que `tests/realce.test.js` mede sobre cada cerca de `docs/`.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const palavras = (lista) => new RegExp(`\\b(?:${lista.split(' ').join('|')})\\b`, 'y');

// ─── As regras por linguagem ─────────────────────────────────────────────────
//
// Toda regex é `y` (sticky): ela casa na posição corrente ou não casa. A ordem importa, e a
// regra é a de sempre: comentário e string antes de tudo, porque uma palavra-chave dentro de
// uma string é texto.

const JS = [
  [/\/\/[^\n]*/y, 'com'],
  [/\/\*[\s\S]*?\*\//y, 'com'],
  [/`(?:\\[\s\S]|[^`\\])*`/y, 'str'],
  [/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/y, 'str'],
  [/\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/y, 'num'],
  [palavras('true false null undefined NaN Infinity'), 'lit'],
  [palavras('async await break case catch class const continue debugger default delete do else '
    + 'export extends finally for from function if import in instanceof let new of return static '
    + 'super switch this throw try typeof var void while with yield as type interface implements '
    + 'declare readonly enum namespace abstract private protected public'), 'kw'],
];

const PYTHON = [
  [/#[^\n]*/y, 'com'],
  [/(?:[rbuf]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?''')/y, 'str'],
  [/(?:[rbuf]{0,2})(?:'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")/y, 'str'],
  [/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?j?\b/y, 'num'],
  [palavras('True False None'), 'lit'],
  [palavras('and as assert async await break class continue def del elif else except finally for '
    + 'from global if import in is lambda nonlocal not or pass raise return try while with yield'), 'kw'],
];

const BASH = [
  [/#[^\n]*/y, 'com'],
  [/'[^']*'/y, 'str'],
  [/"(?:\\.|[^"\\])*"/y, 'str'],
  [/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$[@*#?$!0-9-]/y, 'var'],
  [palavras('if then else elif fi for while until do done case esac in function select time '
    + 'export source local return exit set unset'), 'kw'],
];

const JSON_ = [
  [/"(?:\\.|[^"\\])*"(?=\s*:)/y, 'chave'],
  [/"(?:\\.|[^"\\])*"/y, 'str'],
  [/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/y, 'num'],
  [palavras('true false null'), 'lit'],
  [/\/\/[^\n]*/y, 'com'],
];

const CSS = [
  [/\/\*[\s\S]*?\*\//y, 'com'],
  [/'[^'\n]*'|"[^"\n]*"/y, 'str'],
  // Uma declaração: a propriedade antes dos dois pontos, dentro de um bloco, com o valor
  // fechando em `;` ou `}` sem abrir bloco (é o que separa `color: red` de `a:hover {`). O valor
  // fica como texto; `var(--ds-bg)` e `12px` leem melhor sem cor a mais.
  [/(?<=[{;]\s*)[-a-zA-Z][-a-zA-Z0-9]*(?=\s*:[^{};\n]*[;}])/y, 'prop'],
  [/@[a-zA-Z-]+/y, 'kw'],
  // Um seletor: do início de uma linha (ou depois de `{`, `}` ou `,`) até o `{`, sem atravessar
  // linha; é o suficiente para `.tuff-btn--primario:hover` e `[data-tuff-dica]::after`.
  [/(?<=^|[{},]\s*)[^{};\s][^{};\n]*?(?=\s*\{)/my, 'sel'],
];

const YAML = [
  [/#[^\n]*/y, 'com'],
  [/'[^'\n]*'|"(?:\\.|[^"\\\n])*"/y, 'str'],
  [/(?<=^\s*(?:- )?)[A-Za-z_][\w.-]*(?=\s*:(?:\s|$))/my, 'chave'],
  [/(?<=^\s*)-(?=\s)/my, 'kw'],
  [palavras('true false null yes no on off'), 'lit'],
  [/\b\d+(?:\.\d+)?\b/y, 'num'],
];

const DIFF = [
  [/^(?:\+\+\+|---)[^\n]*/my, 'meta'],
  [/^@@[^\n]*/my, 'hunk'],
  [/^\+[^\n]*/my, 'add'],
  [/^-[^\n]*/my, 'del'],
  [/^(?:diff|index)[^\n]*/my, 'meta'],
];

const REGRAS = {
  js: JS, javascript: JS, mjs: JS, cjs: JS, ts: JS, typescript: JS,
  python: PYTHON, py: PYTHON,
  bash: BASH, sh: BASH, shell: BASH, console: BASH,
  json: JSON_, jsonc: JSON_,
  css: CSS,
  yaml: YAML, yml: YAML,
  diff: DIFF,
  html: null, xml: null,
  text: [], txt: [], plain: [],
};

/** Os nomes de linguagem que uma cerca pode declarar. */
export const LINGUAGENS = new Set(Object.keys(REGRAS));

/** Aplica uma lista de regras a um trecho e devolve o HTML. */
function porRegras(codigo, regras) {
  let html = '';
  let texto = '';
  let i = 0;
  const despejar = () => { if (texto) { html += esc(texto); texto = ''; } };
  fora: while (i < codigo.length) {
    for (const [re, classe] of regras) {
      re.lastIndex = i;
      const m = re.exec(codigo);
      if (!m || m.index !== i || !m[0]) continue;
      despejar();
      html += `<span class="rc-${classe}">${esc(m[0])}</span>`;
      i += m[0].length;
      continue fora;
    }
    texto += codigo[i++];
  }
  despejar();
  return html;
}

// ─── HTML ────────────────────────────────────────────────────────────────────
//
// Uma máquina de dois estados em vez de regras: dentro de uma tag, o que se colore é o nome
// dela, os atributos e os valores; fora, só o comentário. O conteúdo de `<script>` e `<style>`
// sai como texto, porque uma amostra do Tuff não os carrega.

const COMENTARIO_HTML = /<!--[\s\S]*?-->/y;
const ABRE_TAG = /<\/?[A-Za-z][\w:-]*/y;
const ATRIBUTO = /[^\s"'>\/=]+/y;
const VALOR = /"[^"]*"|'[^']*'|[^\s"'=<>`]+/y;

function html(codigo) {
  let saida = '';
  let i = 0;
  const texto = (ate) => { if (ate > i) { saida += esc(codigo.slice(i, ate)); i = ate; } };
  while (i < codigo.length) {
    COMENTARIO_HTML.lastIndex = i;
    let m = COMENTARIO_HTML.exec(codigo);
    if (m) { saida += `<span class="rc-com">${esc(m[0])}</span>`; i += m[0].length; continue; }
    ABRE_TAG.lastIndex = i;
    m = ABRE_TAG.exec(codigo);
    if (!m) {
      const k = codigo.indexOf('<', i + 1);
      texto(k < 0 ? codigo.length : k);
      continue;
    }
    saida += `<span class="rc-tag">${esc(m[0])}</span>`;
    i += m[0].length;
    // Os atributos, até o `>` que fecha a tag.
    while (i < codigo.length) {
      const ws = /\s+/y; ws.lastIndex = i;
      const w = ws.exec(codigo);
      if (w) { saida += w[0]; i += w[0].length; continue; }
      if (codigo[i] === '>' || codigo.startsWith('/>', i)) {
        const fim = codigo[i] === '>' ? 1 : 2;
        saida += `<span class="rc-tag">${esc(codigo.slice(i, i + fim))}</span>`;
        i += fim;
        break;
      }
      if (codigo[i] === '=') {
        saida += '=';
        i++;
        VALOR.lastIndex = i;
        const v = VALOR.exec(codigo);
        if (v) { saida += `<span class="rc-str">${esc(v[0])}</span>`; i += v[0].length; }
        continue;
      }
      ATRIBUTO.lastIndex = i;
      const a = ATRIBUTO.exec(codigo);
      if (a) { saida += `<span class="rc-atr">${esc(a[0])}</span>`; i += a[0].length; continue; }
      // Um caractere que não é atributo nem fecho (um `<` solto): sai como texto, e a tag
      // continua aberta para o que vier.
      saida += esc(codigo[i]);
      i++;
    }
  }
  return saida;
}

/**
 * O fonte de uma cerca como HTML realçado. Lança para uma linguagem que a tabela não conhece;
 * quem chama decide se isso derruba o build (o gerador do site derruba).
 */
export function realcar(codigo, linguagem) {
  if (!LINGUAGENS.has(linguagem)) throw new Error(`linguagem desconhecida: '${linguagem}' (conhecidas: ${[...LINGUAGENS].join(', ')})`);
  const regras = REGRAS[linguagem];
  if (regras === null) return html(codigo);
  return porRegras(codigo, regras);
}

/** O que sobra de um HTML realçado sem as tags: o fonte escapado. */
export const semRealce = (html) => html.replace(/<\/?span[^>]*>/g, '');
