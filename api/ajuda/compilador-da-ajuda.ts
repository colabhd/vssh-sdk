// O compilador da Ajuda: os tópicos de `ajuda/` viram o pacote que a janela da Ajuda desenha.
//
// Módulo folha, sem import e sem disco: quem lê a pasta é `src/services/ajuda.ts`, e o teste
// entrega a mesma lista de arquivos. A entrada é `[{ caminho, texto }]`, com o caminho relativo a
// `ajuda/`, e a saída é o pacote mais a lista de erros, cada um com o arquivo e a linha.
//
// ─── O formato é pequeno de propósito ─────────────────────────────────────────
//
// Um tópico é Markdown com um frontmatter, e o compilador aceita só o subconjunto que a Ajuda
// usa: parágrafo, `##` e `###`, lista, as cercas `passos`, `figura`, `nota`, `se` e `referencia`,
// código inline, link https, e as marcações entre `[[ ]]` e `{{ }}`. Ao lado dos tópicos, o
// `alvos.json` nomeia os controles que um passo aponta na tela (`> clicar <alvo>`). O que ele não
// conhece (HTML, imagem, tabela, negrito, citação, outra cerca) é recusado com o motivo. Um parser
// completo aceitaria em silêncio o que ninguém revisou, e quem lê a Ajuda é quem menos consegue
// contornar um tópico torto.
//
// ─── As receitas ─────────────────────────────────────────────────────────────
//
// As ações de um passo (`  > verbo …`) são a receita do tópico, e quem a executa são dois: o palco
// (`scripts/palco.js`), que tira dela as figuras no CI, e o "Mostrar onde fica" na tela da pessoa.
// Uma cerca `passos` com alguma ação é uma receita, e a cerca `figura` também, sem texto: ela
// prepara a tela e marca os controles que o parágrafo em volta descreve. Uma das duas pode pedir
// só uma tela (```figura larga```), quando os controles dela só existem ali. O compilador devolve a
// lista das receitas com a linha de cada passo, para o palco apontar o arquivo e a linha quando um
// rótulo não estiver na tela.
//
// O travessão e a seta unicode também são recusados (decisão do VSSH-465): a régua da prosa é a
// revisão pelo deslop, e estes dois são os padrões que dá para recusar sem julgar o texto.
//
// ─── O pacote é árvore, e não HTML ───────────────────────────────────────────
//
// Cada bloco e cada pedaço de texto sai como objeto (`{ t: 'p', inl: [...] }`), e o shell monta o
// DOM com `textContent`. Um tópico de app, que chega de um pacote de terceiro, nunca vira
// `innerHTML` no documento do shell.

export interface ArquivoDaAjuda { caminho: string; texto: string }

export type Inline =
  | { t: 'txt'; v: string }
  | { t: 'rot'; v: string }
  | { t: 'termo'; termo: string; v: string }
  | { t: 'topico'; id: string; v: string }
  | { t: 'clique'; forma: 'clique' | 'Clique' | 'clicar' | 'Clicar' | 'direito' | 'Direito' }
  | { t: 'barra' }
  | { t: 'tecla'; v: string }
  | { t: 'cod'; v: string }
  | { t: 'link'; href: string; v: string }
  | { t: 'ref'; secao: string; linha: string };

/**
 * Uma ação de passo, já lida: `resto` é o texto depois do verbo, e os outros campos são o que ele
 * diz conforme o verbo (o alvo, a classe da janela, o texto a digitar, a tecla).
 */
export interface Acao { verbo: string; resto: string; alvo?: string; janela?: string; texto?: string; tecla?: string; botao?: 'direito' | 'duplo' }

/**
 * As medidas de uma figura tirada pelo palco, em px CSS, e os alvos marcados nela. `raiz` é onde o
 * recorte do DOM fica dentro da figura (e se ele é a barra de tarefas), e `origem` é onde a figura
 * fica na tela do palco: os dois servem à figura viva.
 */
export interface Figura {
  id: string;
  largura: number;
  altura: number;
  alvos: { x: number; y: number; w: number; h: number; nome: string }[];
  raiz?: { x: number; y: number; w: number; h: number; barra: boolean };
  origem?: { x: number; y: number; w: number; h: number };
}
/** As figuras de um passo ou de uma cerca `figura`, uma por tela: a larga e a estreita. */
export type Figuras = Partial<Record<'larga' | 'estreita', Figura>>;

/**
 * A condição de uma cerca `se`: as plataformas, os apps, e a tela. A tela é o arranjo do shell (a
 * estreita, abaixo de 600 px, tem a barra embaixo e cada janela na tela toda), e é ela que decide
 * onde um botão mora; a plataforma diz o aparelho, e um celular no navegador é as duas coisas.
 */
export interface Condicao { plataformas?: string[]; requer?: string[]; telas?: string[] }

export type Bloco =
  | { t: 'p'; inl: Inline[] }
  | { t: 'h'; nivel: 3 | 4; inl: Inline[] }
  | { t: 'lista'; ordenada: boolean; itens: Inline[][] }
  | { t: 'passos'; itens: { inl: Inline[]; acoes: Acao[]; figuras?: Figuras }[]; receita?: number }
  | { t: 'figura'; acoes: Acao[]; receita: number; figuras?: Figuras }
  | { t: 'nota'; inl: Inline[] }
  | { t: 'referencia'; qual: string }
  | { t: 'se'; cond: Condicao; blocos: Bloco[] };

export interface Topico {
  id: string;
  livro: string;
  titulo: string;
  ordem: number;
  palavras: string[];
  janelas: string[];
  /**
   * Os títulos dos avisos da bandeja e das telas de falha que este tópico explica. O aviso acha o
   * tópico pelo título que mostra, e ganha o botão Ajuda.
   */
  avisos: string[];
  plataformas: string[];
  requer: string[];
  publico: boolean;
  /** A impressão digital das figuras do tópico quando alguém as conferiu com o texto. */
  revisado: string;
  /** Num tópico de app, as superfícies do manifesto que ele explica (`menu:transcrever`, `janela`). */
  cobre?: string[];
  blocos: Bloco[];
}

export interface Livro { id: string; nome: string; desc: string; icone: string; ordem: number }

/**
 * Um controle que o passo de um tópico aponta na tela (`> clicar <alvo>`). O elemento se acha pelo
 * `seletor` ou pelo `nome` que a pessoa vê (aria-label, title, placeholder ou o texto), dentro do
 * elemento `dentro`, quando há. Com `janela`, ele é procurado na janela dessa classe, e a janela
 * abre se não estiver aberta. Com `abre`, clicar no alvo só abre ou mostra alguma coisa (um menu,
 * um painel, uma janela, uma pasta) e não muda dado nenhum: o "Mostrar onde fica" de um passo
 * adiante pode clicar nele para chegar ao controle. Um alvo `exemplo` é um item do mundo do palco (um arquivo da Ana):
 * a figura o mostra, e a tela da pessoa não o tem, então ele não ganha "Mostrar onde fica". O
 * `rotulo` é como a legenda da figura chama o alvo quando o nome dele na tela muda com o estado
 * (o relógio, a fileira das janelas abertas) ou não existe (um campo sem rótulo).
 */
export interface Alvo { seletor?: string; nome?: string; janela?: string; dentro?: string; exemplo?: boolean; abre?: boolean; rotulo?: string }

/** Uma receita, como o palco a executa: o tópico, a linha de cada passo e os rótulos que ele cita. */
export interface Receita {
  topico: string;
  arquivo: string;
  receita: number;
  tipo: 'passos' | 'figura';
  /** As plataformas em que o texto da receita aparece. Vazio quer dizer todas. */
  plataformas: string[];
  /** As telas que a cerca escolheu (`larga`, `estreita`), ou vazio para as das plataformas. */
  telas: string[];
  requer: string[];
  passos: { linha: number; rotulos: string[]; acoes: Acao[] }[];
}

export interface PacoteDaAjuda {
  livros: Livro[];
  topicos: Topico[];
  glossario: Termo[];
  alvos: Record<string, Alvo>;
}

/**
 * Um termo do glossário. `toque` é o termo que diz o mesmo gesto numa tela de toque: quem lê com
 * o dedo vê "toque longo" onde o tópico escreveu `{{g:clique direito}}`, com a definição dele.
 * `outros` são os nomes que a mesma coisa tem em outros programas ("Clipboard", "URL"), e que
 * alguém digita na busca: eles acham o termo e os tópicos que o citam, e nenhum tópico os usa.
 */
export interface Termo {
  termo: string;
  def: Inline[];
  toque?: string;
  outros?: string[];
}

export const PLATAFORMAS = ['navegador', 'cliente-de-desktop', 'chromeos', 'celular'];
/**
 * Os verbos de uma ação de passo, que o palco e o Mostrar onde fica executam, com a forma de cada
 * um. A referência do `vssh-sdk` (`docs/referencia/ajuda.md`) sai desta tabela.
 */
export const FORMA_DOS_VERBOS: Record<string, { forma: string; faz: string }> = {
  abrir: { forma: 'abrir <Janela>', faz: 'abre a janela dessa classe pelo lançador que a declara' },
  clicar: { forma: 'clicar <alvo> [direito | duplo]', faz: 'o gesto do passo é o clique no alvo' },
  mostrar: { forma: 'mostrar <alvo>', faz: 'aponta o alvo, sem gesto' },
  revelar: { forma: 'revelar <alvo>', faz: 'rola até o alvo' },
  digitar: { forma: 'digitar <alvo> <texto>', faz: 'escreve o texto no campo' },
  tecla: { forma: 'tecla <Tecla>', faz: 'aperta a tecla, com Ctrl, Alt, Shift ou Super na frente' },
  esperar: { forma: 'esperar <alvo>', faz: 'espera o alvo aparecer' },
  pronto: { forma: 'pronto <alvo>', faz: 'o passo terminou quando o alvo aparece' },
};
export const VERBOS = Object.keys(FORMA_DOS_VERBOS);
const VERBOS_DE_ALVO = new Set(['mostrar', 'revelar', 'esperar', 'pronto']);
/** As telas do palco: a larga, de mouse, e a estreita, de toque. Uma cerca pode pedir só uma. */
export const TELAS = ['larga', 'estreita'];
const MODIFICADORES = new Set(['Ctrl', 'Alt', 'Shift', 'Super']);
const TECLAS = /^(Enter|Escape|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F([1-9]|1[0-2])|[A-Z0-9])$/;
/** As referências geradas que a cerca `referencia` pode pedir ao shell. */
export const REFERENCIAS = ['configuracoes', 'atalhos', 'aplicativos', 'tipos'];

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const APP = /^[a-z0-9][a-z0-9-]{0,47}$/;
const JANELA = /^[A-Z][A-Za-z0-9]{1,63}$/;
// O travessão, e as setas dos blocos Arrows, Supplemental Arrows-A e B, Dingbats e Misc Symbols.
const TRAVESSAO = /—/;
const SETA = /[←-⇿➡⟰-⟿⤀-⥿⬀-⬑]/;

const TOPICO_CHAVES = new Set(['id', 'titulo', 'ordem', 'palavras', 'janela', 'avisos', 'plataformas', 'requer', 'publico', 'revisado']);
// Um tópico de app não declara janela nem aviso, que são do shell, e declara o que cobre.
export const CHAVES_DO_TOPICO_DE_APP = ['id', 'titulo', 'ordem', 'palavras', 'cobre', 'plataformas', 'requer', 'publico', 'revisado'];
const TOPICO_DE_APP_CHAVES = new Set(CHAVES_DO_TOPICO_DE_APP);
const REVISADO = /^[0-9a-f]{12}$/;
const LIVRO_CHAVES = new Set(['nome', 'ordem', 'icone']);

interface Ctx { arquivo: string; erros: string[] }
const erro = (ctx: Ctx, linha: number, msg: string) => { ctx.erros.push(`${ctx.arquivo}:${linha}: ${msg}`); };

// ─── Frontmatter ─────────────────────────────────────────────────────────────

/** Separa o frontmatter do corpo. `linhaDoCorpo` é a linha (1-based) onde o corpo começa. */
function separar(ctx: Ctx, texto: string): { campos: Map<string, { valor: string; linha: number }>; corpo: string[]; linhaDoCorpo: number } | null {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  if (linhas[0] !== '---') { erro(ctx, 1, 'o arquivo começa pelo frontmatter, entre duas linhas ---'); return null; }
  const fim = linhas.indexOf('---', 1);
  if (fim < 0) { erro(ctx, 1, 'o frontmatter não fecha: falta a segunda linha ---'); return null; }
  const campos = new Map<string, { valor: string; linha: number }>();
  for (let i = 1; i < fim; i++) {
    const l = linhas[i];
    if (!l.trim()) continue;
    const m = /^([a-z]+):\s*(.*)$/.exec(l);
    if (!m) { erro(ctx, i + 1, `linha do frontmatter sem a forma "chave: valor": ${l}`); continue; }
    if (campos.has(m[1])) { erro(ctx, i + 1, `a chave ${m[1]} aparece duas vezes`); continue; }
    campos.set(m[1], { valor: m[2].trim(), linha: i + 1 });
  }
  return { campos, corpo: linhas.slice(fim + 1), linhaDoCorpo: fim + 2 };
}

function lista(valor: string): string[] {
  const v = valor.trim();
  const dentro = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1) : v;
  return dentro.split(',').map((x) => x.trim()).filter(Boolean);
}

// ─── Texto ───────────────────────────────────────────────────────────────────

/** Recusa o que a régua da prosa não aceita, e o que o formato não conhece. */
function conferirTexto(ctx: Ctx, linha: number, s: string) {
  if (TRAVESSAO.test(s)) erro(ctx, linha, 'travessão no texto: use vírgula, ponto, dois-pontos ou parênteses');
  if (SETA.test(s)) erro(ctx, linha, 'seta unicode no texto: diga o caminho em palavras');
  if (/\*\*|__/.test(s)) erro(ctx, linha, 'negrito não é do formato: o nome da tela vai entre [[ ]]');
  if (/!\[/.test(s)) erro(ctx, linha, 'imagem não é do formato: a figura sai do palco');
  if (/<\/?[a-zA-Z]/.test(s)) erro(ctx, linha, 'HTML não é do formato');
}

/** Os pedaços de uma linha de texto. `refs` recolhe os links para outros tópicos, para conferir no fim. */
function inline(ctx: Ctx, linha: number, s: string, refs: { id: string; linha: number; arquivo: string }[], termos: { termo: string; linha: number; arquivo: string }[]): Inline[] {
  conferirTexto(ctx, linha, s);
  const out: Inline[] = [];
  const RE = /\[\[([^\]]+)\]\]|\{\{([^}]*)\}\}|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let ultimo = 0;
  for (const m of s.matchAll(RE)) {
    if (m.index > ultimo) out.push({ t: 'txt', v: s.slice(ultimo, m.index) });
    ultimo = m.index + m[0].length;
    if (m[1] !== undefined) { out.push({ t: 'rot', v: m[1].trim() }); continue; }
    if (m[3] !== undefined) { out.push({ t: 'cod', v: m[3] }); continue; }
    if (m[4] !== undefined) {
      if (!/^https:\/\/[^\s]+$/.test(m[5])) erro(ctx, linha, `link fora do formato: só https, e "${m[5]}" não é`);
      out.push({ t: 'link', href: m[5], v: m[4] });
      continue;
    }
    const corpo = m[2].trim();
    // O gesto, que o shell diz conforme o ponteiro da pessoa: "clique" ou "toque", e "clique com
    // o botão direito" ou "toque e segure".
    if (['clique', 'Clique', 'clicar', 'Clicar', 'direito', 'Direito'].includes(corpo)) { out.push({ t: 'clique', forma: corpo as 'clique' }); continue; }
    // A borda da tela onde a barra de tarefas da pessoa está: "de baixo", "de cima", "da esquerda".
    if (corpo === 'barra') { out.push({ t: 'barra' }); continue; }
    const mm = /^([a-z]+):([^|]+)(?:\|(.+))?$/.exec(corpo);
    if (!mm) { erro(ctx, linha, `marcação desconhecida: {{${corpo}}}`); continue; }
    const [, tipo, alvo, txt] = mm;
    if (tipo === 'g') { termos.push({ termo: alvo.trim(), linha, arquivo: ctx.arquivo }); out.push({ t: 'termo', termo: alvo.trim(), v: (txt || alvo).trim() }); continue; }
    if (tipo === 't') { refs.push({ id: alvo.trim(), linha, arquivo: ctx.arquivo }); out.push({ t: 'topico', id: alvo.trim(), v: (txt || '').trim() }); continue; }
    if (tipo === 'tecla') { out.push({ t: 'tecla', v: alvo.trim() }); continue; }
    if (tipo === 'ref') {
      const [secao, ...resto] = alvo.split('/');
      if (!secao || !resto.length) { erro(ctx, linha, `{{ref:}} pede seção/Linha: ${corpo}`); continue; }
      out.push({ t: 'ref', secao: secao.trim(), linha: resto.join('/').trim() });
      continue;
    }
    erro(ctx, linha, `marcação desconhecida: {{${corpo}}}`);
  }
  if (ultimo < s.length) out.push({ t: 'txt', v: s.slice(ultimo) });
  return out;
}

// ─── Blocos ──────────────────────────────────────────────────────────────────

interface Coletas {
  refs: { id: string; linha: number; arquivo: string }[];
  termos: { termo: string; linha: number; arquivo: string }[];
  alvos: { alvo: string; linha: number; arquivo: string }[];
  /** As receitas do tópico que está sendo lido, e a condição de plataforma de quem as contém. */
  receitas: Receita[];
  topico: { id: string; plataformas: string[]; requer: string[] } | null;
}

function condicao(ctx: Ctx, linha: number, s: string): Condicao | null {
  const cond: Condicao = {};
  for (const parte of s.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(plataforma|requer|tela)=([a-z0-9,-]+)$/.exec(parte);
    if (!m) { erro(ctx, linha, `condição desconhecida: ${parte} (vale plataforma=..., requer=... e tela=...)`); return null; }
    const valores = m[2].split(',').filter(Boolean);
    if (m[1] === 'plataforma') {
      for (const v of valores) if (!PLATAFORMAS.includes(v)) erro(ctx, linha, `plataforma desconhecida: ${v}`);
      cond.plataformas = valores;
    } else if (m[1] === 'tela') {
      for (const v of valores) if (!TELAS.includes(v)) erro(ctx, linha, `tela desconhecida: ${v} (vale ${TELAS.join(' e ')})`);
      cond.telas = valores;
    } else {
      for (const v of valores) if (!APP.test(v)) erro(ctx, linha, `id de app fora da forma: ${v}`);
      cond.requer = valores;
    }
  }
  if (!cond.plataformas && !cond.requer && !cond.telas) { erro(ctx, linha, 'a cerca se pede uma condição'); return null; }
  return cond;
}

function blocos(ctx: Ctx, linhas: string[], base: number, col: Coletas, se: Condicao | null = null): Bloco[] {
  const out: Bloco[] = [];
  let i = 0;
  const n = (k: number) => base + k;   // a linha do arquivo
  const texto = (k: number, s: string) => inline(ctx, n(k), s, col.refs, col.termos);

  while (i < linhas.length) {
    const l = linhas[i];
    if (!l.trim()) { i++; continue; }

    const cerca = /^```(.*)$/.exec(l);
    if (cerca) {
      const [tipo, ...args] = cerca[1].trim().split(/\s+/);
      // Uma cerca pode ter outra dentro (a `figura` dentro de um `se`): quem fecha é o ``` que
      // casa com esta, contando as que abrem no caminho.
      let fim = i + 1;
      for (let fundo = 0; fim < linhas.length; fim++) {
        if (linhas[fim] === '```') { if (fundo === 0) break; fundo--; } else if (/^```\S/.test(linhas[fim])) fundo++;
      }
      if (fim >= linhas.length) { erro(ctx, n(i), `a cerca ${tipo || ''} não fecha`); return out; }
      const dentro = linhas.slice(i + 1, fim);
      if (tipo === 'passos') out.push(passos(ctx, dentro, base + i + 1, col, se, telasDaCerca(ctx, n(i), args)));
      else if (tipo === 'figura') { const f = figura(ctx, dentro, base + i + 1, col, se, telasDaCerca(ctx, n(i), args)); if (f) out.push(f); }
      else if (tipo === 'nota') {
        const s = dentro.map((x) => x.trim()).filter(Boolean).join(' ');
        if (!s) erro(ctx, n(i), 'nota vazia');
        out.push({ t: 'nota', inl: texto(i + 1, s) });
      } else if (tipo === 'referencia') {
        if (!REFERENCIAS.includes(args[0])) erro(ctx, n(i), `referência desconhecida: ${args[0] || '(nenhuma)'}`);
        out.push({ t: 'referencia', qual: args[0] });
      } else if (tipo === 'se') {
        if (se) erro(ctx, n(i), 'uma cerca se dentro de outra não é do formato');
        const cond = condicao(ctx, n(i), args.join(' '));
        const filhos = blocos(ctx, dentro, base + i + 1, col, cond || {});
        if (cond) out.push({ t: 'se', cond, blocos: filhos });
      } else erro(ctx, n(i), `cerca desconhecida: ${tipo || '(sem nome)'}`);
      i = fim + 1;
      continue;
    }

    const titulo = /^(#{1,6})\s+(.+)$/.exec(l);
    if (titulo) {
      const nivel = titulo[1].length;
      if (nivel !== 2 && nivel !== 3) erro(ctx, n(i), 'só ## e ### são do formato: o título do tópico vem do frontmatter');
      out.push({ t: 'h', nivel: nivel === 3 ? 4 : 3, inl: texto(i, titulo[2].trim()) });
      i++;
      continue;
    }

    const item = /^(- |\d+\. )/.exec(l);
    if (item) {
      const ordenada = item[1] !== '- ';
      const itens: Inline[][] = [];
      while (i < linhas.length && (/^(- |\d+\. )/.test(linhas[i]) || (/^ {2,}\S/.test(linhas[i]) && itens.length))) {
        const m = /^(- |\d+\. )(.*)$/.exec(linhas[i]);
        if (m) {
          if ((m[1] !== '- ') !== ordenada) erro(ctx, n(i), 'lista que mistura - e número');
          itens.push(texto(i, m[2].trim()));
        } else {
          itens[itens.length - 1].push({ t: 'txt', v: ' ' }, ...texto(i, linhas[i].trim()));
        }
        i++;
      }
      out.push({ t: 'lista', ordenada, itens });
      continue;
    }

    if (/^\s*[>|]/.test(l)) { erro(ctx, n(i), 'citação e tabela não são do formato'); i++; continue; }

    // Parágrafo: as linhas seguidas até uma linha vazia ou outro bloco.
    const comeco = i;
    const partes: string[] = [];
    while (i < linhas.length && linhas[i].trim() && !/^(```|#|- |\d+\. )/.test(linhas[i])) { partes.push(linhas[i].trim()); i++; }
    out.push({ t: 'p', inl: texto(comeco, partes.join(' ')) });
  }
  return out;
}

/** Lê a ação `  > verbo resto` de um passo ou de uma figura. */
function acao(ctx: Ctx, linha: number, verbo: string, resto: string, col: Coletas): Acao {
  const a: Acao = { verbo, resto };
  if (!VERBOS.includes(verbo)) { erro(ctx, linha, `verbo de passo desconhecido: ${verbo} (vale ${VERBOS.join(', ')})`); return a; }
  const alvo = (id: string) => {
    if (!ID.test(id)) erro(ctx, linha, `${verbo} pede o nome de um alvo do alvos.json: ${id || '(nenhum)'}`);
    col.alvos.push({ alvo: id, linha, arquivo: ctx.arquivo });
    a.alvo = id;
  };
  if (VERBOS_DE_ALVO.has(verbo)) alvo(resto);
  else if (verbo === 'clicar') {
    const [id, botao, ...sobra] = resto.split(/\s+/);
    alvo(id || '');
    if (botao && !['direito', 'duplo'].includes(botao) || sobra.length) erro(ctx, linha, `clicar pede o alvo e, se for o caso, direito ou duplo: ${resto}`);
    if (botao === 'direito' || botao === 'duplo') a.botao = botao;
  } else if (verbo === 'abrir') {
    if (!JANELA.test(resto)) erro(ctx, linha, `abrir pede a classe da janela, como FileBrowserWindow: ${resto || '(nenhuma)'}`);
    a.janela = resto;
  } else if (verbo === 'digitar') {
    const m = /^(\S+)\s+(.+)$/.exec(resto);
    if (!m) { erro(ctx, linha, 'digitar pede o alvo e o texto: > digitar <alvo> <texto>'); return a; }
    alvo(m[1]);
    conferirTexto(ctx, linha, m[2]);
    a.texto = m[2].trim();
  } else if (verbo === 'tecla') {
    const partes = resto.split('+');
    const tecla = partes.pop() || '';
    if (!TECLAS.test(tecla) || partes.some((p) => !MODIFICADORES.has(p))) {
      erro(ctx, linha, `tecla fora da forma: ${resto || '(nenhuma)'} (como Enter, F2 ou Ctrl+Shift+Z)`);
    }
    a.tecla = resto;
  }
  return a;
}

/** As telas que os argumentos de uma cerca `passos` ou `figura` pedem. */
function telasDaCerca(ctx: Ctx, linha: number, args: string[]): string[] {
  for (const t of args) if (!TELAS.includes(t)) erro(ctx, linha, `tela desconhecida: ${t} (vale ${TELAS.join(' e ')})`);
  return args.filter((t) => TELAS.includes(t));
}

/** A receita nova de um tópico, com as plataformas e os apps da cerca `se` que a contém. */
function novaReceita(ctx: Ctx, col: Coletas, tipo: Receita['tipo'], se: Condicao | null, passos: Receita['passos'], telas: string[]): number {
  const t = col.topico!;
  const n = col.receitas.filter((r) => r.arquivo === ctx.arquivo).length;
  let plataformas = t.plataformas;
  if (se?.plataformas) plataformas = t.plataformas.length ? se.plataformas.filter((p) => t.plataformas.includes(p)) : se.plataformas;
  if (se?.telas) telas = telas.length ? telas.filter((x) => se.telas!.includes(x)) : se.telas;
  col.receitas.push({
    topico: t.id, arquivo: ctx.arquivo, receita: n, tipo, plataformas, telas,
    requer: [...new Set([...t.requer, ...(se?.requer || [])])], passos,
  });
  return n;
}

const rotulosDe = (inl: Inline[]) => inl.filter((x) => x.t === 'rot').map((x) => (x as { v: string }).v);

/**
 * A cerca `passos`: cada `- ` é um passo, as linhas recuadas continuam o texto, e as linhas
 * `  > verbo …` são as ações do passo. Uma cerca com alguma ação é uma receita.
 */
function passos(ctx: Ctx, linhas: string[], base: number, col: Coletas, se: Condicao | null, telas: string[]): Bloco {
  const itens: { inl: Inline[]; acoes: Acao[] }[] = [];
  const linhasDosItens: number[] = [];
  let atual: { partes: string[]; linha: number; acoes: Acao[] } | null = null;
  const fechar = () => {
    if (!atual) return;
    itens.push({ inl: inline(ctx, atual.linha, atual.partes.join(' '), col.refs, col.termos), acoes: atual.acoes });
    linhasDosItens.push(atual.linha);
    atual = null;
  };
  linhas.forEach((l, k) => {
    if (!l.trim()) return;
    const linha = base + k;
    const novo = /^- (.+)$/.exec(l);
    if (novo) { fechar(); atual = { partes: [novo[1].trim()], linha, acoes: [] }; return; }
    if (!atual) { erro(ctx, linha, 'um passo começa com "- "'); return; }
    const m = /^\s+>\s*(\S+)\s*(.*)$/.exec(l);
    if (m) { atual.acoes.push(acao(ctx, linha, m[1], m[2].trim(), col)); return; }
    if (/^\s{2,}\S/.test(l)) { atual.partes.push(l.trim()); return; }
    erro(ctx, linha, 'linha de passo fora da forma: "- texto", "  continuação" ou "  > ação"');
  });
  fechar();
  if (!itens.length) erro(ctx, base - 1, 'cerca passos sem passo');
  const bloco: Bloco = { t: 'passos', itens };
  if (col.topico && itens.some((it) => it.acoes.length)) {
    bloco.receita = novaReceita(ctx, col, 'passos', se,
      itens.map((it, k) => ({ linha: linhasDosItens[k], rotulos: rotulosDe(it.inl), acoes: it.acoes })), telas);
  }
  return bloco;
}

/**
 * A cerca `figura`: só ações, uma por linha (`> verbo …`). As que não são `mostrar` preparam a
 * tela, e a figura sai com os alvos de `mostrar` marcados, na ordem em que aparecem.
 */
function figura(ctx: Ctx, linhas: string[], base: number, col: Coletas, se: Condicao | null, telas: string[]): Bloco | null {
  const acoes: Acao[] = [];
  linhas.forEach((l, k) => {
    if (!l.trim()) return;
    const m = /^\s*>\s*(\S+)\s*(.*)$/.exec(l);
    if (!m) { erro(ctx, base + k, 'a cerca figura tem só ações: > verbo …'); return; }
    acoes.push(acao(ctx, base + k, m[1], m[2].trim(), col));
  });
  if (!acoes.some((a) => a.verbo === 'mostrar')) { erro(ctx, base - 1, 'a figura pede ao menos um > mostrar <alvo>'); return null; }
  if (!col.topico) { erro(ctx, base - 1, 'figura só cabe num tópico'); return null; }
  const receita = novaReceita(ctx, col, 'figura', se, [{ linha: base - 1, rotulos: [], acoes }], telas);
  return { t: 'figura', acoes, receita };
}

// ─── O compilador ────────────────────────────────────────────────────────────

/**
 * Compila os arquivos de `ajuda/`. Devolve o pacote, os erros e as receitas que o palco executa;
 * com erro, o pacote não vale.
 */
/**
 * O que muda quando a pasta é a ajuda de um app (`compilarAjudaDoApp`): o link `{{t:ambiente/<id>}}`
 * leva a um tópico do ambiente, um `{{g:termo}}` pode ser do glossário do ambiente, e o frontmatter
 * aceita `cobre`.
 */
interface OpcoesDeApp { topicosDoAmbiente: Set<string>; termosDoAmbiente: Set<string> }

export function compilarAjuda(arquivos: ArquivoDaAjuda[], opcoes: { app?: OpcoesDeApp } = {}): { pacote: PacoteDaAjuda; erros: string[]; receitas: Receita[] } {
  const chaves = opcoes.app ? TOPICO_DE_APP_CHAVES : TOPICO_CHAVES;
  const erros: string[] = [];
  const col: Coletas = { refs: [], termos: [], alvos: [], receitas: [], topico: null };
  let alvos: Record<string, Alvo> = {};
  const livros: Livro[] = [];
  const topicos: Topico[] = [];
  const glossario: Termo[] = [];
  const porId = new Map<string, string>();
  const porJanela = new Map<string, string>();
  const porAviso = new Map<string, string>();

  const ordenados = [...arquivos].sort((a, b) => a.caminho.localeCompare(b.caminho));
  const pastasComLivro = new Set(ordenados.filter((a) => /^[a-z0-9-]+\/_livro\.md$/.test(a.caminho)).map((a) => a.caminho.split('/')[0]));

  for (const a of ordenados) {
    const ctx: Ctx = { arquivo: a.caminho, erros };
    if (a.caminho === 'alvos.json') { alvos = lerAlvos(ctx, a.texto); continue; }
    if (!a.caminho.endsWith('.md')) { erro(ctx, 1, 'a pasta da Ajuda só tem .md, e o alvos.json'); continue; }

    if (a.caminho === 'glossario.md') { lerGlossario(ctx, a.texto, glossario, col); continue; }

    const m = /^([a-z0-9-]+)\/(_livro|[a-z0-9][a-z0-9-]*)\.md$/.exec(a.caminho);
    if (!m) { erro(ctx, 1, 'o lugar de um tópico é <livro>/<id>.md, com letras minúsculas, números e hífen'); continue; }
    const [, livro, nome] = m;
    const sep = separar(ctx, a.texto);
    if (!sep) continue;

    if (nome === '_livro') {
      for (const [k, v] of sep.campos) if (!LIVRO_CHAVES.has(k)) erro(ctx, v.linha, `chave desconhecida no livro: ${k}`);
      const nomeDoLivro = sep.campos.get('nome')?.valor;
      if (!nomeDoLivro) erro(ctx, 1, 'o livro pede nome');
      const ordem = Number(sep.campos.get('ordem')?.valor ?? 100);
      if (!Number.isInteger(ordem)) erro(ctx, sep.campos.get('ordem')!.linha, 'ordem é um número inteiro');
      const desc = sep.corpo.map((x) => x.trim()).filter(Boolean).join(' ');
      conferirTexto(ctx, sep.linhaDoCorpo, desc);
      livros.push({ id: livro, nome: nomeDoLivro || livro, desc, icone: sep.campos.get('icone')?.valor || 'book', ordem });
      continue;
    }

    if (!pastasComLivro.has(livro)) erro(ctx, 1, `a pasta ${livro} não tem _livro.md`);
    for (const [k, v] of sep.campos) if (!chaves.has(k)) erro(ctx, v.linha, `chave desconhecida: ${k}`);
    const id = sep.campos.get('id')?.valor;
    if (id !== nome) erro(ctx, sep.campos.get('id')?.linha || 1, `o id do tópico é o nome do arquivo (${nome})`);
    if (!ID.test(nome)) erro(ctx, 1, `id fora da forma: ${nome}`);
    if (porId.has(nome)) erro(ctx, 1, `o id ${nome} já é de ${porId.get(nome)}`);
    porId.set(nome, a.caminho);

    const titulo = sep.campos.get('titulo')?.valor || '';
    if (!titulo) erro(ctx, 1, 'o tópico pede titulo');
    conferirTexto(ctx, sep.campos.get('titulo')?.linha || 1, titulo);
    const ordemCampo = sep.campos.get('ordem');
    const ordem = Number(ordemCampo?.valor ?? 100);
    if (ordemCampo && !Number.isInteger(ordem)) erro(ctx, ordemCampo.linha, 'ordem é um número inteiro');

    const janelas = lista(sep.campos.get('janela')?.valor || '');
    for (const j of janelas) {
      const linha = sep.campos.get('janela')!.linha;
      if (!JANELA.test(j)) erro(ctx, linha, `janela fora da forma de nome de classe: ${j}`);
      if (porJanela.has(j)) erro(ctx, linha, `a janela ${j} já abre ${porJanela.get(j)} no F1`);
      porJanela.set(j, nome);
    }
    const avisos = lista(sep.campos.get('avisos')?.valor || '');
    for (const t of avisos) {
      const linha = sep.campos.get('avisos')!.linha;
      if (porAviso.has(t)) erro(ctx, linha, `o aviso "${t}" já leva a ${porAviso.get(t)}`);
      porAviso.set(t, nome);
    }
    const plataformas = lista(sep.campos.get('plataformas')?.valor || '');
    for (const p of plataformas) if (!PLATAFORMAS.includes(p)) erro(ctx, sep.campos.get('plataformas')!.linha, `plataforma desconhecida: ${p}`);
    const requer = lista(sep.campos.get('requer')?.valor || '');
    for (const r of requer) if (!APP.test(r)) erro(ctx, sep.campos.get('requer')!.linha, `id de app fora da forma: ${r}`);
    const publicoCampo = sep.campos.get('publico');
    if (publicoCampo && !['true', 'false'].includes(publicoCampo.valor)) erro(ctx, publicoCampo.linha, 'publico é true ou false');

    const palavras = lista(sep.campos.get('palavras')?.valor || '');
    for (const p of palavras) conferirTexto(ctx, sep.campos.get('palavras')!.linha, p);
    const revisadoCampo = sep.campos.get('revisado');
    if (revisadoCampo && !REVISADO.test(revisadoCampo.valor)) {
      erro(ctx, revisadoCampo.linha, 'revisado é a impressão digital que o palco escreve: 12 algarismos hexadecimais');
    }

    col.topico = { id: nome, plataformas, requer };
    const corpo = blocos(ctx, sep.corpo, sep.linhaDoCorpo, col);
    col.topico = null;
    if (!corpo.length) erro(ctx, sep.linhaDoCorpo, 'tópico sem texto');

    const cobre = opcoes.app ? lista(sep.campos.get('cobre')?.valor || '') : null;
    topicos.push({
      id: nome, livro, titulo, ordem, palavras, janelas, avisos, plataformas, requer,
      publico: publicoCampo?.valor === 'true', revisado: revisadoCampo?.valor || '',
      ...(cobre ? { cobre } : {}), blocos: corpo,
    });
  }

  // Os links e os termos se conferem no fim, quando todos os tópicos e o glossário foram lidos.
  for (const r of col.refs) {
    const doAmbiente = /^ambiente\//.test(r.id) ? r.id.slice('ambiente/'.length) : null;
    if (doAmbiente !== null && opcoes.app) {
      if (!opcoes.app.topicosDoAmbiente.has(doAmbiente)) erros.push(`${r.arquivo}:${r.linha}: o tópico ${doAmbiente} não existe na Ajuda do ambiente`);
    } else if (!porId.has(r.id)) erros.push(`${r.arquivo}:${r.linha}: o tópico ${r.id} não existe`);
  }
  const termos = new Set(glossario.map((g) => g.termo));
  for (const t of col.termos) {
    if (!termos.has(t.termo) && !opcoes.app?.termosDoAmbiente.has(t.termo)) erros.push(`${t.arquivo}:${t.linha}: o termo ${t.termo} não está no glossario.md`);
  }
  for (const a of col.alvos) if (!Object.hasOwn(alvos, a.alvo)) erros.push(`${a.arquivo}:${a.linha}: o alvo ${a.alvo || '(nenhum)'} não está no alvos.json`);
  // Um alvo que nenhum passo usa nunca passa pelo palco, e envelheceria sem ninguém notar.
  const usados = new Set(col.alvos.map((a) => a.alvo));
  for (const nome of Object.keys(alvos)) if (!usados.has(nome)) erros.push(`alvos.json: o alvo ${nome} não é usado por nenhum passo`);

  livros.sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  topicos.sort((a, b) => a.livro.localeCompare(b.livro) || a.ordem - b.ordem || a.titulo.localeCompare(b.titulo, 'pt-BR'));
  return { pacote: { livros, topicos, glossario, alvos }, erros, receitas: col.receitas };
}

/**
 * `alvos.json`: `{ "<alvo>": { "seletor"?, "nome"?, "janela"?, "dentro"?, "exemplo"?, "abre"?, "rotulo"? } }`,
 * com `seletor` ou `nome`.
 */
function lerAlvos(ctx: Ctx, texto: string): Record<string, Alvo> {
  let cru: unknown;
  try { cru = JSON.parse(texto); } catch (e: any) { erro(ctx, 1, `JSON inválido: ${e.message}`); return {}; }
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) { erro(ctx, 1, 'o alvos.json é um objeto, um alvo por chave'); return {}; }
  const saida: Record<string, Alvo> = {};
  const texto_ = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  for (const [nome, v] of Object.entries(cru as Record<string, any>)) {
    if (!ID.test(nome)) { erro(ctx, 1, `alvo fora da forma: ${nome}`); continue; }
    if (!v || typeof v !== 'object') { erro(ctx, 1, `o alvo ${nome} é um objeto`); continue; }
    for (const k of Object.keys(v)) if (!['seletor', 'nome', 'janela', 'dentro', 'exemplo', 'abre', 'rotulo'].includes(k)) erro(ctx, 1, `chave desconhecida no alvo ${nome}: ${k}`);
    if (v.rotulo !== undefined) { if (!texto_(v.rotulo)) { erro(ctx, 1, `rotulo é um texto, no alvo ${nome}`); continue; } conferirTexto(ctx, 1, v.rotulo); }
    const booleano = ['exemplo', 'abre'].find((k) => v[k] !== undefined && typeof v[k] !== 'boolean');
    if (booleano) { erro(ctx, 1, `${booleano} é true ou false, no alvo ${nome}`); continue; }
    if (!texto_(v.seletor) && !texto_(v.nome)) { erro(ctx, 1, `o alvo ${nome} pede seletor ou nome`); continue; }
    if (v.janela !== undefined && (typeof v.janela !== 'string' || !JANELA.test(v.janela))) { erro(ctx, 1, `janela fora da forma no alvo ${nome}`); continue; }
    if (v.dentro !== undefined && !texto_(v.dentro)) { erro(ctx, 1, `dentro é um seletor, no alvo ${nome}`); continue; }
    const a: Alvo = {};
    for (const k of ['seletor', 'nome', 'janela', 'dentro', 'rotulo'] as const) if (texto_(v[k])) a[k] = v[k].trim();
    if (v.exemplo) a.exemplo = true;
    if (v.abre) a.abre = true;
    saida[nome] = a;
  }
  return saida;
}

/**
 * O glossário: um `## termo` seguido do parágrafo que o define. Duas linhas podem vir logo depois
 * do título, antes da definição: `toque: <termo>` aponta o termo que diz o mesmo gesto numa tela
 * de toque, e ele também é um `## termo` do glossário; `outros nomes: <nome>, <nome>` lista os
 * nomes da mesma coisa em outros programas.
 */
function lerGlossario(ctx: Ctx, texto: string, glossario: Termo[], col: Coletas) {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  let termo: { nome: string; linha: number; partes: string[]; toque?: { nome: string; linha: number }; outros?: string[] } | null = null;
  const noToque: { de: string; para: string; linha: number }[] = [];
  const fechar = () => {
    if (!termo) return;
    if (!termo.partes.length) erro(ctx, termo.linha, `o termo ${termo.nome} não tem definição`);
    if (glossario.some((g) => g.termo === termo!.nome)) erro(ctx, termo.linha, `o termo ${termo.nome} aparece duas vezes`);
    const t: Termo = { termo: termo.nome, def: inline(ctx, termo.linha + 1, termo.partes.join(' '), col.refs, col.termos) };
    if (termo.toque) { t.toque = termo.toque.nome; noToque.push({ de: termo.nome, para: termo.toque.nome, linha: termo.toque.linha }); }
    if (termo.outros) t.outros = termo.outros;
    glossario.push(t);
    termo = null;
  };
  linhas.forEach((l, k) => {
    const m = /^## (.+)$/.exec(l);
    if (m) { fechar(); termo = { nome: m[1].trim(), linha: k + 1, partes: [] }; return; }
    if (!l.trim()) return;
    if (!termo) { if (!/^# /.test(l)) erro(ctx, k + 1, 'o glossário é uma lista de ## termo, cada um com a definição embaixo'); return; }
    const t = /^toque:\s*(.+)$/.exec(l.trim());
    if (t && !termo.partes.length && !termo.toque) { termo.toque = { nome: t[1].trim(), linha: k + 1 }; return; }
    const o = /^outros nomes:\s*(.+)$/.exec(l.trim());
    if (o && !termo.partes.length && !termo.outros) { termo.outros = o[1].split(',').map((n) => n.trim()).filter(Boolean); return; }
    termo.partes.push(l.trim());
  });
  fechar();
  for (const n of noToque) {
    const alvo = glossario.find((g) => g.termo === n.para);
    if (!alvo) erro(ctx, n.linha, `o termo ${n.de} aponta ${n.para} no toque, e ${n.para} não está no glossário`);
    else if (alvo.toque) erro(ctx, n.linha, `o termo ${n.para} já é a forma do toque de ${n.de}, e não aponta outro`);
  }
}

// ─── As figuras do palco ─────────────────────────────────────────────────────

/** Uma cena do índice que o palco escreve em `ajuda/.figuras/indice.json`. */
export interface CenaDoIndice {
  topico: string;
  receita: number;
  /** O passo da cerca `passos`, contado de 0; `null` numa cerca `figura`. */
  passo: number | null;
  tela: 'larga' | 'estreita';
  largura: number;
  altura: number;
  alvos: Figura['alvos'];
  raiz?: Figura['raiz'];
  origem?: Figura['origem'];
}

/**
 * Pendura no pacote as figuras que o palco tirou: cada passo e cada cerca `figura` ganha
 * `figuras.larga` e `figuras.estreita`, quando a cena existe. Uma cena de uma receita que não
 * existe mais (o índice veio de outra versão dos tópicos) fica de fora.
 */
export function juntarFiguras(pacote: PacoteDaAjuda, cenas: Record<string, CenaDoIndice>) {
  const porReceita = new Map<string, [string, CenaDoIndice][]>();
  for (const [id, c] of Object.entries(cenas)) {
    const k = `${c.topico}#${c.receita}`;
    if (!porReceita.has(k)) porReceita.set(k, []);
    porReceita.get(k)!.push([id, c]);
  }
  const figurasDe = (topico: string, receita: number, passo: number | null): Figuras | undefined => {
    const f: Figuras = {};
    for (const [id, c] of porReceita.get(`${topico}#${receita}`) || []) {
      if (c.passo !== passo) continue;
      f[c.tela] = { id, largura: c.largura, altura: c.altura, alvos: c.alvos, raiz: c.raiz, origem: c.origem };
    }
    return Object.keys(f).length ? f : undefined;
  };
  const andar = (topico: string, blocos: Bloco[]) => {
    for (const b of blocos) {
      if (b.t === 'se') andar(topico, b.blocos);
      else if (b.t === 'figura') { const f = figurasDe(topico, b.receita, null); if (f) b.figuras = f; }
      else if (b.t === 'passos' && b.receita !== undefined) {
        b.itens.forEach((it, i) => { const f = figurasDe(topico, b.receita!, i); if (f) it.figuras = f; });
      }
    }
  };
  for (const t of pacote.topicos) andar(t.id, t.blocos);
}

// ─── A ajuda de um app ───────────────────────────────────────────────────────
//
// Um app declara `contributes.ajuda` (`{ "pasta": "ajuda", "inicio": "comecar" }`) e põe na pasta os
// tópicos (`<id>.md`), e, se quiser, um `glossario.md` e um `alvos.json` com os controles da janela
// dele. O compilador é o do ambiente, e a pasta vira um livro só, com o nome do app. O pacote sai
// com os ids do app, e quem o junta à Ajuda do ambiente (o shell) é quem põe o prefixo.
//
// As superfícies são o que o manifesto põe na frente da pessoa: a janela, os itens de menu, as
// senhas que o app pede, a placa de vídeo e a fila, as capacidades que ele oferece e as que usa,
// a seção de Configurações e a extensão do Navegador. Um tópico diz no `cobre` quais explica, e o
// nível do app sai daí:
//
//   0  só o manifesto, e a Ajuda escreve a ficha (sem pasta, nada a compilar)
//   1  o tópico de entrada, que o F1 abre
//   2  toda superfície coberta
//   3  o 2, com as figuras do palco do app e os rótulos conferidos (`evidencias.figuras`)
//   4  o 3, com o app respondendo ao `ajuda.mostrar` pela ponte (`evidencias.ponte`)
//
// O 3 e o 4 dependem do que o CI do app mediu, e quem os informa é quem compila.

export interface Superficie { id: string; rotulo: string }

/** As superfícies que o manifesto de um app declara, cada uma com um rótulo para o resumo do CI. */
export function superficiesDoManifesto(man: Record<string, any>): Superficie[] {
  const s: Superficie[] = [];
  if ((man.kind || 'app') === 'app' && (man.type || 'app') === 'app') s.push({ id: 'janela', rotulo: 'a janela do app' });
  for (const m of Array.isArray(man.contributes?.contextMenu) ? man.contributes.contextMenu : []) {
    if (m && typeof m.id === 'string') s.push({ id: `menu:${m.id}`, rotulo: `o item ${m.rotulo || m.id} do menu` });
  }
  for (const x of Array.isArray(man.secrets) ? man.secrets : []) {
    if (x && typeof x.name === 'string') s.push({ id: `segredo:${x.name}`, rotulo: `a senha ${x.name}` });
  }
  const recursos = new Set(Object.keys(man.recursos || {}).filter((r) => r !== 'metricas'));
  if (man.gpu === true) recursos.add('gpu');
  const NOMES: Record<string, string> = { gpu: 'a placa de vídeo', fila: 'a fila de processamento', salas: 'a edição em grupo' };
  for (const r of recursos) s.push({ id: `recurso:${r}`, rotulo: NOMES[r] || `o recurso ${r}` });
  for (const c of Array.isArray(man.provides) ? man.provides : []) s.push({ id: `oferece:${c}`, rotulo: `a capacidade ${c} que o app oferece` });
  for (const c of new Set([...(Array.isArray(man.requires) ? man.requires : []), ...(Array.isArray(man.usa) ? man.usa : [])])) {
    s.push({ id: `usa:${c}`, rotulo: `a capacidade ${c} que o app usa` });
  }
  if (man.contributes?.settings) s.push({ id: 'configuracoes', rotulo: 'a seção de Configurações' });
  if (man.contributes?.browserExtension) s.push({ id: 'navegador', rotulo: 'a extensão do Navegador' });
  return s;
}

/** O pacote de ajuda de um app, o `ajuda.json` que viaja com a versão dele. */
export interface AjudaDoApp {
  formato: 1;
  app: string;
  versao: string;
  inicio: string;
  nivel: number;
  livros: Livro[];
  topicos: Topico[];
  glossario: Termo[];
  alvos: Record<string, Alvo>;
  /** Cada superfície do manifesto, com os tópicos que a cobrem (vazio quando nenhum cobre). */
  superficies: (Superficie & { topicos: string[] })[];
}

/**
 * Compila a pasta de ajuda de um app. `arquivos` têm o caminho relativo à pasta; `ambiente` são os
 * ids dos tópicos e os termos do glossário do ambiente, que os links do app podem citar.
 */
export function compilarAjudaDoApp(
  arquivos: ArquivoDaAjuda[],
  { manifesto, ambiente, evidencias = {} }: {
    manifesto: Record<string, any>;
    ambiente: { topicos: string[]; termos: string[] };
    evidencias?: { figuras?: boolean; ponte?: boolean };
  },
): { ajuda: AjudaDoApp | null; erros: string[]; receitas: Receita[] } {
  const declarada = manifesto.contributes?.ajuda;
  const pasta = declarada?.pasta || 'ajuda';
  const id = String(manifesto.id || 'app');
  // O livro é a pasta inteira, com o nome do app, e os caminhos voltam ao da pasta nos erros. A
  // descrição do manifesto fica na ficha, e não no livro: um travessão nela é aviso do publish, e
  // não recusa da ajuda.
  const livro: ArquivoDaAjuda = { caminho: `${id}/_livro.md`, texto: `---\nnome: ${manifesto.name || id}\nordem: 1\nicone: grid\n---\n` };
  const mapeados = arquivos.map((a) => (/^[^/]+\.md$/.test(a.caminho) && a.caminho !== 'glossario.md' ? { ...a, caminho: `${id}/${a.caminho}` } : a));
  const r = compilarAjuda([livro, ...mapeados], {
    app: { topicosDoAmbiente: new Set(ambiente.topicos), termosDoAmbiente: new Set(ambiente.termos) },
  });
  const erros = r.erros.map((e) => (e.startsWith(`${id}/`) ? `${pasta}/${e.slice(id.length + 1)}` : `${pasta}/${e}`));
  for (const a of arquivos) if (a.caminho.includes('/')) erros.push(`${pasta}/${a.caminho}:1: a ajuda de um app é uma pasta só, sem subpastas`);

  const superficies = superficiesDoManifesto(manifesto);
  const conhecidas = new Set(superficies.map((x) => x.id));
  for (const t of r.pacote.topicos) {
    for (const c of t.cobre || []) if (!conhecidas.has(c)) erros.push(`${pasta}/${t.id}.md:1: cobre ${c}, que o manifesto não declara`);
  }
  const inicio = declarada?.inicio;
  if (!inicio) erros.push('vssh-app.json: contributes.ajuda pede inicio, o tópico que o F1 abre');
  else if (!r.pacote.topicos.some((t) => t.id === inicio)) erros.push(`vssh-app.json: contributes.ajuda.inicio é ${inicio}, e a pasta ${pasta} não tem esse tópico`);
  if (erros.length) return { ajuda: null, erros, receitas: r.receitas };

  const comTopicos = superficies.map((x) => ({ ...x, topicos: r.pacote.topicos.filter((t) => (t.cobre || []).includes(x.id)).map((t) => t.id) }));
  let nivel = 1;
  if (comTopicos.every((x) => x.topicos.length)) nivel = 2;
  if (nivel === 2 && evidencias.figuras) nivel = 3;
  if (nivel === 3 && evidencias.ponte) nivel = 4;
  return {
    ajuda: {
      formato: 1, app: id, versao: String(manifesto.version || ''), inicio: inicio!, nivel,
      livros: r.pacote.livros, topicos: r.pacote.topicos, glossario: r.pacote.glossario, alvos: r.pacote.alvos,
      superficies: comTopicos,
    },
    erros: [],
    receitas: r.receitas,
  };
}
