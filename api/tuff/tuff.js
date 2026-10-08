'use strict';

// Tuff: o comportamento do núcleo. A gaveta de navegação, o nome e o ícone de arquivo, as abas, a
// trilha, a barra de menus, a tabela e a moldura de app.
//
//     TuffGaveta.ligar(raiz)              devolve { abrir, fechar, destruir }
//     TuffNome.desenhar(el, nome, op)     escreve o nome quebrando nos separadores
//     TuffArquivo.svg(tipo, opcoes)       desenha o ícone de um arquivo, de um tipo que um app cria,
//                                         de uma pasta ou da lixeira
//     TuffAbas.ligar(tira, opcoes)        a tira de abas: o clique, o teclado e a aba ativa
//     TuffTrilha.desenhar(nav, partes, op) o caminho, recolhendo o meio quando não cabe
//     TuffMenus.ligar(barra, opcoes)      a barra de menus: os rótulos abrem o menu do ambiente
//     TuffTabela.marcar(cab, chave, cresc) a coluna ordenada da tabela, em `aria-sort`
//     TuffTabela.ligar(cab, aoOrdenar)    o clique num cabeçalho ordenável
//     TuffApp.ligar(raiz, opcoes)         a moldura: a gaveta, o painel, o "Mais" e a forma
//
// E um comportamento sem chamada: o `.tuff-busca-limpar` esvazia a busca ao lado dele.
//
// Nasceu na biblioteca de componentes do toolkit de apps (`vssh-app-toolkit/lib/web/tuff/`); a
// fonte é esta. O shell carrega este arquivo junto de `tuff.css`, e um app o recebe como
// `_sdk/tuff/tuff.js`.
//
// A maior parte da biblioteca é CSS puro de propósito: switch e controle segmentado são `<input>`
// de verdade, o disclosure é `<details>`, e o que se ganha com isso (teclado, foco, estado
// anunciado a leitor de tela) vem pronto e não se quebra.
//
// A gaveta não cabe nisso. Ela precisa devolver o foco para quem a abriu, fechar no Esc e saber em
// que seção a pessoa está. As três são comportamento, e um `:has(input:checked)` faria a peça
// parecer pronta deixando as três de fora. O nome de arquivo também não cabe: o CSS só corta no
// fim, e o fim de um nome é a extensão.

(function () {

  const ABERTA = 'tuff-gaveta--aberta';
  const ATIVO = 'tuff-gaveta-item--ativo';

  /**
   * Liga uma `.tuff-gaveta`.
   *
   * A marcação esperada, e tudo é opcional menos a raiz:
   *
   *     <div class="tuff-gaveta">
   *       <div class="tuff-gaveta-veu"></div>
   *       <nav class="tuff-gaveta-lateral">
   *         <button class="tuff-gaveta-item" data-alvo="id-da-secao"><span>Rótulo</span></button>
   *       </nav>
   *       <div class="tuff-gaveta-corpo"> … <section id="id-da-secao"> … </div>
   *     </div>
   *
   * O botão que abre vive fora da lateral, com `data-tuff-gaveta-abrir`.
   */
  function ligar(raiz, opcoes) {
    if (!raiz) return { abrir() {}, fechar() {}, destruir() {} };
    const o = opcoes || {};
    const lateral = raiz.querySelector('.tuff-gaveta-lateral');
    const corpo = raiz.querySelector('.tuff-gaveta-corpo');
    const veu = raiz.querySelector('.tuff-gaveta-veu');
    const botao = (o.botao || raiz.querySelector('[data-tuff-gaveta-abrir]')
      || (raiz.parentNode && raiz.parentNode.querySelector('[data-tuff-gaveta-abrir]')));
    const itens = [...raiz.querySelectorAll('.tuff-gaveta-item')];
    const desfazer = [];
    const ouvir = (alvo, tipo, fn, op) => {
      if (!alvo) return;
      alvo.addEventListener(tipo, fn, op);
      desfazer.push(() => alvo.removeEventListener(tipo, fn, op));
    };

    if (botao) {
      botao.setAttribute('aria-expanded', 'false');
      if (lateral && lateral.id) botao.setAttribute('aria-controls', lateral.id);
    }

    function abrir() {
      raiz.classList.add(ABERTA);
      if (botao) botao.setAttribute('aria-expanded', 'true');
      // O foco entra na gaveta. Sem isto, abrir por teclado não leva a lugar nenhum: o menu aparece
      // e o foco continua no botão, atrás do véu.
      const primeiro = itens.find((i) => i.offsetParent !== null) || itens[0];
      if (primeiro) primeiro.focus();
    }

    function fechar(devolverFoco) {
      if (!raiz.classList.contains(ABERTA)) return;
      raiz.classList.remove(ABERTA);
      if (botao) botao.setAttribute('aria-expanded', 'false');
      // E o foco volta para quem abriu. Fechar sem devolver joga o foco para o começo do documento,
      // e quem navega por teclado tem de refazer o caminho inteiro.
      if (devolverFoco && botao) botao.focus();
    }

    ouvir(botao, 'click', () => {
      if (raiz.classList.contains(ABERTA)) fechar(true); else abrir();
    });
    ouvir(veu, 'click', () => fechar(true));

    // Esc no documento, e não na gaveta: o foco pode ter ido para um item, para o véu, ou para
    // lugar nenhum. Escutar só na lateral perderia os dois últimos casos.
    ouvir(document, 'keydown', (e) => {
      if (e.key === 'Escape' && raiz.classList.contains(ABERTA)) { e.preventDefault(); fechar(true); }
    });

    function marcar(alvo) {
      for (const i of itens) i.classList.toggle(ATIVO, i.dataset.alvo === alvo);
      for (const i of itens) {
        if (i.dataset.alvo === alvo) i.setAttribute('aria-current', 'true');
        else i.removeAttribute('aria-current');
      }
    }

    for (const item of itens) {
      ouvir(item, 'click', () => {
        const alvo = item.dataset.alvo && raiz.querySelector(`#${CSS.escape(item.dataset.alvo)}`);
        if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
        marcar(item.dataset.alvo);
        // Fecha só quando ela está em modo gaveta. Persistente, ela responde "onde eu estou", e
        // fechá-la apagaria a resposta no momento em que a pessoa acabou de perguntar.
        if (raiz.classList.contains(ABERTA)) fechar(false);
      });
    }

    // ── Onde a pessoa está ────────────────────────────────────────────────────
    //
    // A lateral acompanha a rolagem, e não só o clique. Sem isto ela mente depois do primeiro
    // gesto de rolar: marca a última seção clicada enquanto a tela mostra outra.
    let observador = null;
    const alvos = itens
      .map((i) => i.dataset.alvo && raiz.querySelector(`#${CSS.escape(i.dataset.alvo)}`))
      .filter(Boolean);
    if (alvos.length && typeof IntersectionObserver === 'function') {
      const visiveis = new Set();
      observador = new IntersectionObserver((entradas) => {
        for (const e of entradas) {
          if (e.isIntersecting) visiveis.add(e.target); else visiveis.delete(e.target);
        }
        // A de cima entre as visíveis, e não a primeira que o observador relatou: rolando para
        // trás, a ordem dos eventos é a inversa da ordem na tela.
        let topo = null;
        for (const alvo of alvos) if (visiveis.has(alvo)) { topo = alvo; break; }
        if (topo) marcar(topo.id);
      }, {
        root: corpo && corpo.scrollHeight > corpo.clientHeight ? corpo : null,
        // A faixa de cima: uma seção conta como "onde estou" quando chega ao terço superior, que é
        // onde os olhos estão. Com `0px` a marcação troca cedo demais e fica trocando sozinha.
        rootMargin: '0px 0px -66% 0px',
      });
      for (const alvo of alvos) observador.observe(alvo);
    }

    return {
      abrir,
      fechar: () => fechar(false),
      destruir() {
        if (observador) observador.disconnect();
        for (const f of desfazer) f();
      },
    };
  }

  window.TuffGaveta = { ligar };
})();

(function () {

  // ── O nome de arquivo ───────────────────────────────────────────────────────
  //
  //     TuffNome.desenhar(el, nome, { linhas: 2 })
  //
  // Escreve o nome com um `<wbr>` em cada ponto onde ele pode quebrar: depois de `-`, `_` e espaço,
  // e antes do `.`, para a extensão descer inteira ("bliss-at-night" / ".jpg"). O elemento leva
  // `overflow-wrap: anywhere`, que só corta dentro de um trecho quando o trecho sozinho é maior
  // que a linha.
  //
  // Quando o nome passa das linhas pedidas, o corte vai para o meio e a extensão fica:
  // "georeferenciamento-ma…final.zip". É ela que separa `versao-1.wav` de `versao-1.transcricao`
  // quando os dois começam iguais. O nome inteiro continua sendo de quem chama (o `title`, o
  // renomear).
  //
  // A medida é de `measureText` sobre a fonte calculada do elemento, num lote por quadro: uma
  // grade de duzentos nomes custa uma leitura de layout, e não uma por nome. O lote espera a fonte
  // do ambiente carregar, porque medir com a fonte de reserva cortaria no lugar errado.

  const QUEBRA_DEPOIS = new Set(['-', '_', ' ', '…']);
  const pendentes = new Set();
  let quadro = 0;
  let pena = null;
  const larguras = new Map();

  /** Os trechos do nome, cada um terminando num ponto onde a linha pode quebrar. */
  function trechos(texto) {
    const out = [];
    let atual = '';
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (c === '.' && atual) { out.push(atual); atual = ''; }
      atual += c;
      if (QUEBRA_DEPOIS.has(c)) { out.push(atual); atual = ''; }
    }
    if (atual) out.push(atual);
    return out;
  }

  function fragmento(texto) {
    const f = document.createDocumentFragment();
    const ts = trechos(texto);
    ts.forEach((t, i) => {
      f.appendChild(document.createTextNode(t));
      if (i < ts.length - 1) f.appendChild(document.createElement('wbr'));
    });
    return f;
  }

  function largura(fonte, texto) {
    const chave = fonte + '\u0000' + texto;
    let w = larguras.get(chave);
    if (w === undefined) {
      if (larguras.size > 5000) larguras.clear();
      w = pena.measureText(texto).width;
      larguras.set(chave, w);
    }
    return w;
  }

  /** Quantas linhas o texto ocupa numa caixa de largura `w`, quebrando como o navegador quebra. */
  function linhasDe(texto, fonte, w) {
    let linhas = 1;
    let atual = 0;
    for (const t of trechos(texto)) {
      const lt = largura(fonte, t);
      if (atual + lt <= w) { atual += lt; continue; }
      if (lt <= w) { linhas++; atual = lt; continue; }
      // O trecho é maior que a linha, e só então o `anywhere` corta dentro dele: começa numa linha
      // nova se a atual já tem alguma coisa, e enche caractere a caractere.
      if (atual > 0) { linhas++; atual = 0; }
      for (const c of t) {
        const lc = largura(fonte, c);
        if (atual + lc > w && atual > 0) { linhas++; atual = lc; } else atual += lc;
      }
    }
    return linhas;
  }

  /** O nome cortado no meio, guardando a extensão, no maior tamanho que cabe. */
  function cortado(nome, cabe) {
    const ponto = nome.lastIndexOf('.');
    const ext = ponto > 0 && nome.length - ponto <= 8 ? nome.slice(ponto) : '';
    const base = nome.slice(0, nome.length - ext.length);
    const montar = (k) => base.slice(0, Math.ceil(k / 2)) + '…' + base.slice(base.length - Math.floor(k / 2)) + ext;
    let lo = 0;
    let hi = base.length - 1;
    while (lo < hi) {
      const meio = Math.ceil((lo + hi) / 2);
      if (cabe(montar(meio))) lo = meio; else hi = meio - 1;
    }
    return montar(lo);
  }

  function processar() {
    quadro = 0;
    const lote = [...pendentes].filter((el) => el.isConnected);
    pendentes.clear();
    if (!lote.length) return;
    if (document.fonts && document.fonts.status !== 'loaded') {
      for (const el of lote) pendentes.add(el);
      document.fonts.ready.then(agendar);
      return;
    }
    if (!pena) pena = document.createElement('canvas').getContext('2d');

    // Primeiro todas as leituras, depois todas as escritas: misturar as duas força um layout por
    // elemento.
    const medidas = lote.map((el) => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { el, w, fonte: cs.font };
    });
    for (const { el, w, fonte } of medidas) {
      const nome = el._tuffNome;
      if (!nome || w <= 0) continue;
      pena.font = fonte;
      const cabe = (texto) => linhasDe(texto, fonte, w) <= el._tuffNomeLinhas;
      if (!cabe(nome)) el.replaceChildren(fragmento(cortado(nome, cabe)));
    }
  }

  function agendar() {
    if (!quadro) quadro = requestAnimationFrame(processar);
  }

  /**
   * Escreve `nome` em `el`, quebrando nos separadores, e corta no meio no quadro seguinte se ele
   * passar de `op.linhas` (2 por padrão). Chamar de novo com o mesmo nome não refaz nada.
   */
  function desenhar(el, nome, op) {
    if (!el) return;
    // Como o `textContent`, que escreve vazio quando recebe `undefined`: um item sem nome desenha o
    // resto da linha em vez de interromper quem o chamou.
    nome = nome == null ? '' : String(nome);
    const linhas = (op && op.linhas) || 2;
    if (el._tuffNome === nome && el._tuffNomeLinhas === linhas && el.firstChild) return;
    el._tuffNome = nome;
    el._tuffNomeLinhas = linhas;
    el.replaceChildren(fragmento(nome));
    pendentes.add(el);
    agendar();
  }

  window.TuffNome = { desenhar };
})();

// ─── O ícone de arquivo ──────────────────────────────────────────────────────────────────────────
//
//     TuffArquivo.svg(tipo, { ext, glifo, cheia })   devolve o <svg> como texto
//     TuffArquivo.svg('app', { cor, icone, selo })   o tipo que um app cria, com o ícone dele
//
// Um arquivo é conteúdo da pessoa, e o ícone dele tem cor: a folha clara, o glifo do tipo na cor
// dele no meio, e a extensão num selo colorido no canto (o `DESIGN.md`, "Ícones de arquivo"). Os
// matizes têm a mesma luminosidade, e o glifo carrega o tipo junto com a cor, para quem não
// distingue os matizes.
//
// É texto, e não um elemento, porque quem desenha guarda o nó pronto e o clona, e porque a janela
// do Comprimido usa o mesmo desenho como `data:` na barra de tarefas. A pasta lê os tokens
// `--ds-pasta-*` por `style`, e por isso acompanha a cor de destaque quando o `<svg>` está no
// documento; num `data:` ela cai no azul padrão.
//
// O selo some num contêiner `.tuff-arquivo-p`: em 20 px a extensão não se lê, e o glifo basta. Uma
// extensão de mais de quatro letras fica sem selo.

(function () {

  const NS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"';
  const FOLHA = '#dedede';
  const DOBRA = '#a4a4a4';

  // O traço escreve a cor em `style`, e não no atributo, porque o atributo não lê `var()`, e a
  // gravura da pasta é um token.
  const traco = (cor, d, w) =>
    `<path d="${d}" fill="none" style="stroke:${cor}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  // O glifo de cada tipo, desenhado no quadro de 48 na cor que vem por parâmetro.
  const GLIFOS = {
    linhas:   (c) => traco(c, 'M16.5 22h15M16.5 27.5h15M16.5 33h10', 2.6),
    imagem:   (c) => `<circle cx="19.5" cy="22" r="2.8" fill="${c}"/><path d="M14.5 37l6.5-8 4.5 5 3.2-3.6 5.3 6.6Z" fill="${c}"/>`,
    video:    (c) => `<path d="M20 21v14l11.5-7Z" fill="${c}"/>`,
    audio:    (c) => traco(c, 'M22.5 34V21.5l9-2.2V31', 2.4) +
                     `<circle cx="19.8" cy="34" r="3" fill="${c}"/><circle cx="28.8" cy="31" r="3" fill="${c}"/>`,
    zip:      (c) => `<path d="M22 4h4v3h-4zM24 7h4v3h-4zM22 10h4v3h-4zM24 13h4v3h-4zM22 16h4v3h-4z" fill="${c}"/>` +
                     `<rect x="21.5" y="21" width="7" height="9.5" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/>`,
    codigo:   (c) => traco(c, 'M19.5 23l-5 5 5 5M28.5 23l5 5-5 5M25.5 21l-3 14', 2.4),
    planilha: (c) => `<rect x="15.5" y="20.5" width="17" height="15" rx="1.5" fill="none" stroke="${c}" stroke-width="2"/>` +
                     traco(c, 'M15.5 25.5h17M15.5 30.5h17M21.5 20.5v15', 2),
    quadro:   (c) => `<rect x="15" y="20" width="18" height="12" rx="1.5" fill="none" stroke="${c}" stroke-width="2.2"/>` +
                     traco(c, 'M24 32v4.5M20 37h8', 2.2),
  };

  // O tipo: a tinta do glifo, a cor do selo (o branco da extensão passa de 5,6:1 sobre ela) e o glifo.
  const TIPOS = {
    pdf:          { tinta: '#ab413a', selo: '#a43b35', glifo: 'linhas' },
    documento:    { tinta: '#3067b8', selo: '#2a61b1', glifo: 'linhas' },
    planilha:     { tinta: '#0a7e3a', selo: '#057836', glifo: 'planilha' },
    apresentacao: { tinta: '#a44c03', selo: '#9c4700', glifo: 'quadro' },
    imagem:       { tinta: '#087970', selo: '#00736a', glifo: 'imagem' },
    video:        { tinta: '#7652ac', selo: '#714ca6', glifo: 'video' },
    audio:        { tinta: '#9e427b', selo: '#983c75', glifo: 'audio' },
    comprimido:   { tinta: '#7c6702', selo: '#766202', glifo: 'zip' },
    codigo:       { tinta: '#44576b', selo: '#44576b', glifo: 'codigo' },
    outro:        { tinta: '#636363', selo: '#636363', glifo: 'linhas' },
  };

  // O glifo gravado na frente das pastas da pessoa, um tom abaixo dela.
  const GRAVURAS = {
    documentos: (c) => traco(c, 'M18.5 25h11M18.5 29.5h11M18.5 34h7', 2.4),
    downloads:  (c) => traco(c, 'M24 23v9.5M19.8 28.5l4.2 4.2 4.2-4.2M18.5 36h11', 2.4),
    musica:     (c) => traco(c, 'M22.5 34.5V24.5l7.5-1.8v9.6', 2.2) +
                       `<circle cx="20.3" cy="34.5" r="2.4" style="fill:${c}"/><circle cx="27.8" cy="32.3" r="2.4" style="fill:${c}"/>`,
    imagens:    (c) => `<circle cx="20" cy="25.5" r="2.2" style="fill:${c}"/><path d="M16.5 35.5l5-6 3.5 3.8 2.5-2.8 4 5Z" style="fill:${c}"/>`,
    videos:     (c) => `<path d="M21 23.5v11l9-5.5Z" style="fill:${c}"/>`,
    casa:       (c) => traco(c, 'M18.5 29.5l5.5-5 5.5 5V36h-11Z', 2.2),
  };

  // As cores da pasta saem dos tokens, com o azul padrão de reserva para quando o `<svg>` vira `data:`.
  const PASTA_FUNDO   = 'var(--ds-pasta-fundo, #327aab)';
  const PASTA_FRENTE  = 'var(--ds-pasta-frente, #6a9ec2)';
  const PASTA_GRAVURA = 'var(--ds-pasta-gravura, #0a456d)';

  function pasta(glifo) {
    const g = GRAVURAS[glifo] ? GRAVURAS[glifo](PASTA_GRAVURA) : '';
    return `<svg class="tuff-arquivo" ${NS}>` +
      `<path d="M5 13a3 3 0 0 1 3-3h10.5l4 4.5H40a3 3 0 0 1 3 3V37a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z" style="fill:${PASTA_FUNDO}"/>` +
      `<path d="M5 20a2.5 2.5 0 0 1 2.5-2.5h33A2.5 2.5 0 0 1 43 20v17a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z" style="fill:${PASTA_FRENTE}"/>` +
      g + '</svg>';
  }

  // A lixeira é da família da folha: os cinzas dela, a tampa, a alça e três sulcos gravados. A
  // cheia mostra uma folha e uma bola de papel acima da tampa, e o estado se lê pela silhueta.
  const LIXEIRA =
    '<path d="M12 15h24l-2.1 25.6A2.6 2.6 0 0 1 31.3 43H16.7a2.6 2.6 0 0 1-2.6-2.4Z" fill="#dedede"/>' +
    '<path d="M12 15h24l-.45 5H12.45Z" fill="#bdbdbd"/>' +
    '<rect x="8.5" y="10" width="31" height="5" rx="2" fill="#a4a4a4"/>' +
    '<path d="M20 5.5h8a2 2 0 0 1 2 2V10H18V7.5a2 2 0 0 1 2-2Z" fill="#8a8a8a"/>' +
    traco('#a4a4a4', 'M19.4 25l.4 11.5M24 25v11.5M28.6 25l-.4 11.5', 2.2);
  const LIXO =
    '<path d="M10.6 10.5 13.4 1.2l9.4 2.9-2.2 6.4Z" fill="#f2f2f2"/>' +
    '<path d="M13.4 1.2l3.2 1-1.4 2.9Z" fill="#c4c4c4"/>' +
    traco('#c4c4c4', 'M15.6 6.4l4.6 1.4M14.8 8.6l3.6 1.1', 1) +
    '<path d="M28.6 10.5a5.2 5.2 0 1 1 10.1-2.1l-.4 2.1Z" fill="#e2e2e2"/>' +
    traco('#a9a9a9', 'M31.2 6.8l2.3 1.6 2.1-2.4M32.6 3.9l.9 1.6', 1.1);

  function lixeira(cheia) {
    return `<svg class="tuff-arquivo" ${NS}>${cheia ? LIXO : ''}${LIXEIRA}</svg>`;
  }

  const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  // O selo: a extensão em branco, no canto de baixo, saindo da folha pela esquerda. A largura
  // segue o número de letras, para o selo de "JS" não ter o tamanho do de "XLSX".
  function selo(ext, cor) {
    const w = 7 + ext.length * 5.7;
    const texto = ext.replace(/[&<>"]/g, (c) => ESCAPE[c]);
    return `<g class="tuff-arquivo-selo"><rect x="2" y="28.4" width="${w.toFixed(1)}" height="13.8" rx="1.5" fill="${cor}"/>` +
      `<text x="${(2 + w / 2).toFixed(1)}" y="38.3" fill="#ffffff" font-family="'Instrument Sans', system-ui, sans-serif" ` +
      `font-size="8.6" font-weight="700" text-anchor="middle">${texto}</text></g>`;
  }

  // O tipo que um app cria (`opens.proprios` no manifesto): a mesma folha, o ícone do app no lugar
  // do glifo, num quadrado de 38% do quadro, e o selo na cor do app com o texto curto dele. Sem
  // texto não há selo, e o ícone identifica o arquivo sozinho. O ícone é uma URL da mesma origem;
  // num `data:` o navegador não a carrega, e fica a folha com o selo.
  function doApp({ cor, icone, selo: texto } = {}) {
    const c = /^#[0-9a-f]{6}$/i.test(String(cor || '')) ? cor : TIPOS.outro.selo;
    const href = /^\/[^\s"<>]*$/.test(String(icone || '')) ? icone.replace(/&/g, '&amp;') : '';
    const t = /^[A-Z0-9]{1,5}$/.test(String(texto || '')) ? texto : '';
    return `<svg class="tuff-arquivo" ${NS}>` +
      `<path d="M12.5 4H29l9 9v28.5a2.5 2.5 0 0 1-2.5 2.5h-23a2.5 2.5 0 0 1-2.5-2.5v-35A2.5 2.5 0 0 1 12.5 4Z" fill="${FOLHA}"/>` +
      `<path d="M29 4v6.5a2.5 2.5 0 0 0 2.5 2.5H38Z" fill="${DOBRA}"/>` +
      (href ? `<image href="${href}" x="14.9" y="17.3" width="18.2" height="18.2" preserveAspectRatio="xMidYMid meet"/>` : '') +
      (t ? selo(t, c) : '') +
      '</svg>';
  }

  function svg(tipo, opcoes = {}) {
    if (tipo === 'pasta') return pasta(opcoes.glifo);
    if (tipo === 'lixeira') return lixeira(!!opcoes.cheia);
    if (tipo === 'app') return doApp(opcoes);
    const t = TIPOS[tipo] || TIPOS.outro;
    const ext = String(opcoes.ext || '').toUpperCase();
    return `<svg class="tuff-arquivo" ${NS}>` +
      `<path d="M12.5 4H29l9 9v28.5a2.5 2.5 0 0 1-2.5 2.5h-23a2.5 2.5 0 0 1-2.5-2.5v-35A2.5 2.5 0 0 1 12.5 4Z" fill="${FOLHA}"/>` +
      `<path d="M29 4v6.5a2.5 2.5 0 0 0 2.5 2.5H38Z" fill="${DOBRA}"/>` +
      GLIFOS[t.glifo](t.tinta) +
      (ext && ext.length <= 4 ? selo(ext, t.selo) : '') +
      '</svg>';
  }

  window.TuffArquivo = { svg, TIPOS: Object.keys(TIPOS), GRAVURAS: Object.keys(GRAVURAS) };
})();

// ─── As abas ─────────────────────────────────────────────────────────────────────────────────────
//
//     TuffAbas.aba({ titulo, icone, fechavel })   devolve o <button class="tuff-aba">
//     TuffAbas.escolher(aba)                      marca a aba como a ativa da tira dela
//     TuffAbas.titular(aba, titulo, icone)        troca o título e, se vier, o ícone
//     TuffAbas.sujo(aba, sim)                     o ponto de alteração não salva
//     TuffAbas.ligar(tira, { escolher, fechar, reordenar })  o clique, o teclado e o arraste
//
// A tira é um `tablist` com a aba ativa no `tabindex` 0 e as outras fora da ordem do Tab, como pede
// o padrão de abas: o Tab entra na tira pela ativa, e as setas andam entre elas. A seta já escolhe
// a aba (ativação automática), porque trocar de aba aqui é barato e não abre nada. Home e End vão
// às pontas, e Delete fecha. Quem guarda o estado é a janela: a tira só avisa qual aba a pessoa
// pediu, e a janela chama `escolher` quando a troca acontece.
//
// O ícone é texto de SVG confiável (o sprite, ou um desenho do próprio ambiente) ou um elemento,
// como o favicon de uma página. Enquanto a aba carrega, a classe `tuff-aba--carregando` troca o
// ícone pelo giro.
//
// Com `reordenar`, arrastar uma aba com o mouse ou a caneta a leva a outro lugar da tira, e
// Ctrl+Shift com as setas faz o mesmo pelo teclado. A ordem da tira é a do DOM, e a aba anda nele
// junto com o ponteiro. Quando o gesto termina com a ordem mudada, `reordenar(abas)` avisa a janela
// com a ordem nova, e a aba arrastada fica escolhida. O arraste começa depois de 5 px, para um
// clique com a mão tremendo continuar sendo um clique. No toque, a tira rola de lado, e o arraste
// fica de fora.

(function () {

  const FECHAR = '<svg class="tuff-ico" aria-hidden="true"><use href="#ico-close"></use></svg>';

  function icone(alvo, ic) {
    alvo.replaceChildren();
    if (typeof ic === 'string') alvo.innerHTML = ic;
    else if (ic) alvo.append(ic);
    alvo.hidden = !ic;
  }

  function aba({ titulo = '', icone: ic = null, fechavel = true } = {}) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tuff-aba';
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', 'false');
    el.tabIndex = -1;
    const ico = document.createElement('span');
    ico.className = 'tuff-aba-icone';
    icone(ico, ic);
    const giro = document.createElement('span');
    giro.className = 'tuff-aba-giro';
    const tit = document.createElement('span');
    tit.className = 'tuff-aba-titulo';
    el.append(ico, giro, tit);
    if (fechavel) {
      const f = document.createElement('span');
      f.className = 'tuff-aba-fechar';
      f.title = 'Fechar aba';
      f.innerHTML = FECHAR;
      el.append(f);
    }
    titular(el, titulo);
    return el;
  }

  function titular(el, titulo, ic) {
    el.querySelector('.tuff-aba-titulo').textContent = titulo;
    el.title = titulo;
    if (ic !== undefined) icone(el.querySelector('.tuff-aba-icone'), ic);
  }

  function sujo(el, sim) {
    let ponto = el.querySelector('.tuff-aba-sujo');
    if (sim && !ponto) {
      ponto = document.createElement('span');
      ponto.className = 'tuff-aba-sujo';
      ponto.title = 'Alterações não salvas';
      const fechar = el.querySelector('.tuff-aba-fechar');
      if (fechar) fechar.before(ponto); else el.append(ponto);
    } else if (!sim && ponto) {
      ponto.remove();
    }
  }

  const abasDe = (tira) => [...tira.children].filter((c) => c.classList.contains('tuff-aba'));

  function escolher(el) {
    const tira = el?.parentElement;
    if (!tira) return;
    for (const a of abasDe(tira)) {
      const ativa = a === el;
      a.setAttribute('aria-selected', String(ativa));
      a.tabIndex = ativa ? 0 : -1;
    }
    // Rola só a tira, e não com `scrollIntoView`, que rolaria também quem está em volta: a área de
    // trabalho inteira, com a janela encostada na borda da tela.
    const rt = tira.getBoundingClientRect();
    const ra = el.getBoundingClientRect();
    const nova = tira.querySelector(':scope > .tuff-aba-nova')?.offsetWidth || 0;
    if (ra.left < rt.left) tira.scrollLeft -= rt.left - ra.left;
    else if (ra.right > rt.right - nova) tira.scrollLeft += ra.right - (rt.right - nova);
  }

  function ligar(tira, { escolher: aoEscolher, fechar: aoFechar, reordenar } = {}) {
    if (!tira) return;
    tira.setAttribute('role', 'tablist');
    let arraste = null;
    tira.addEventListener('click', (e) => {
      const a = e.target.closest('.tuff-aba');
      if (!a || a.parentElement !== tira) return;
      if (e.target.closest('.tuff-aba-fechar')) { e.stopPropagation(); aoFechar?.(a); return; }
      aoEscolher?.(a);
    });
    // O botão do meio fecha, como numa aba de navegador.
    tira.addEventListener('auxclick', (e) => {
      const a = e.target.closest('.tuff-aba');
      if (e.button !== 1 || !a || a.parentElement !== tira) return;
      e.preventDefault();
      aoFechar?.(a);
    });
    tira.addEventListener('keydown', (e) => {
      const atual = e.target.closest('.tuff-aba');
      if (!atual || atual.parentElement !== tira) return;
      const abas = abasDe(tira);
      const i = abas.indexOf(atual);
      let alvo = null;
      if (e.key === 'ArrowRight') alvo = abas[(i + 1) % abas.length];
      else if (e.key === 'ArrowLeft') alvo = abas[(i - 1 + abas.length) % abas.length];
      else if (e.key === 'Home') alvo = abas[0];
      else if (e.key === 'End') alvo = abas[abas.length - 1];
      else if (e.key === 'Delete' && aoFechar) {
        e.preventDefault();
        const vizinha = abas[i + 1] || abas[i - 1];
        aoFechar(atual);
        if (!atual.isConnected) vizinha?.focus();
        return;
      }
      if (!alvo) return;
      e.preventDefault();
      aoEscolher?.(alvo);
      alvo.focus();
    });

    if (!reordenar) return;
    tira.addEventListener('keydown', (e) => {
      const atual = e.target.closest('.tuff-aba');
      if (!atual || atual.parentElement !== tira || !e.ctrlKey || !e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const abas = abasDe(tira);
      const vizinha = abas[abas.indexOf(atual) + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (!vizinha) return;
      if (e.key === 'ArrowLeft') vizinha.before(atual); else vizinha.after(atual);
      atual.focus();
      reordenar(abasDe(tira));
    }, true);
    tira.addEventListener('pointerdown', (e) => {
      const a = e.target.closest('.tuff-aba');
      if (e.button !== 0 || e.pointerType === 'touch' || !a || a.parentElement !== tira || e.target.closest('.tuff-aba-fechar')) return;
      arraste = { aba: a, x: e.clientX, id: e.pointerId, andou: false, antes: abasDe(tira) };
    });
    tira.addEventListener('pointermove', (e) => {
      if (!arraste || e.pointerId !== arraste.id) return;
      if (!arraste.andou) {
        if (Math.abs(e.clientX - arraste.x) < 5) return;
        arraste.andou = true;
        arraste.aba.classList.add('tuff-aba--arrastando');
        // Com a captura na tira, o clique que fecha o gesto cai nela, e não numa aba: quem escolhe
        // a aba arrastada é o fim do gesto.
        tira.setPointerCapture?.(e.pointerId);
      }
      // A aba vai para antes da primeira outra cujo meio fica à direita do ponteiro, e para o fim
      // da fila de abas (antes do "+") quando não há nenhuma.
      const outras = abasDe(tira).filter((x) => x !== arraste.aba);
      const ref = outras.find((x) => { const r = x.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; })
        || tira.querySelector(':scope > .tuff-aba-nova');
      if (ref && arraste.aba.nextElementSibling !== ref) tira.insertBefore(arraste.aba, ref);
      else if (!ref && tira.lastElementChild !== arraste.aba) tira.append(arraste.aba);
    });
    const soltar = (e) => {
      if (!arraste || e.pointerId !== arraste.id) return;
      const { aba, andou, antes } = arraste;
      arraste = null;
      if (!andou) return;
      aba.classList.remove('tuff-aba--arrastando');
      const depois = abasDe(tira);
      if (depois.some((x, i) => x !== antes[i])) reordenar(depois);
      aoEscolher?.(aba);
    };
    tira.addEventListener('pointerup', soltar);
    tira.addEventListener('pointercancel', soltar);
  }

  window.TuffAbas = { aba, escolher, titular, sujo, ligar };
})();

// ─── A trilha, a barra de menus e a moldura ──────────────────────────────────────────────────────
//
// As três abrem o menu do ambiente, e não um desenhado aqui: o cabeçalho de `tuff.css` diz por
// quê. No shell, o menu é o `ContextMenu`. Num app, o mesmo menu chega pela ponte, em
// `vssh.dialogos.menuDeContexto`, que leva dados e devolve o id do item escolhido. Os itens têm a
// forma do `ContextMenu` (`label`, `key`, `icon`, `checked`, `disabled`, `separator`, `submenu`,
// `action`); para a ponte, cada ação fica guardada aqui sob um id, e é chamada quando o id volta.

(function () {

  function menuDoAmbiente(itens, x, y, { aoFechar, teclado = false, aoLado } = {}) {
    if (typeof ContextMenu !== 'undefined') {
      ContextMenu.show(itens, x, y, () => aoFechar?.(), { teclado, aoLado });
      return;
    }
    const dialogos = window.vssh?.dialogos;
    if (typeof dialogos?.menuDeContexto !== 'function') { aoFechar?.(); return; }
    const acoes = new Map();
    const paraPonte = (lista) => lista.map((it) => {
      if (it.separator) return { separator: true };
      if (it.header) return { header: it.header };
      const id = 'tuff-' + acoes.size;
      acoes.set(id, it.action);
      const { label, icon, checked, disabled, danger } = it;
      return { id, label, icon, checked, disabled, danger, ...(it.submenu ? { submenu: paraPonte(it.submenu) } : {}) };
    });
    Promise.resolve(dialogos.menuDeContexto(x, y, paraPonte(itens))).catch(() => null).then((id) => {
      aoFechar?.();
      acoes.get(id)?.();
    });
  }

  // ─── A trilha ───────────────────────────────────────────────────────────────────────────────────
  //
  //     TuffTrilha.desenhar(nav, partes, { aoCriar })
  //
  // `partes` é o caminho, da raiz ao lugar atual: `{ rotulo, titulo, ir }`. A última é o lugar
  // atual e não tem clique; nas outras, `ir()` leva até ela. `aoCriar(el, parte)` recebe o
  // elemento de cada parte desenhada, para quem precisa ligar mais coisa nele (Arquivos liga a
  // zona de drop).
  //
  // Quando o caminho não cabe, as partes recolhem num "…" a partir da segunda, a mais perto da
  // raiz primeiro. A primeira fica enquanto der, porque é o ponto de partida, e recolhe por último;
  // a atual nunca recolhe. O "…" abre as recolhidas no menu do ambiente. A trilha se recompõe
  // quando a largura dela muda, e numa trilha escondida (largura zero) ela desenha tudo e espera.

  const SEP = '<svg class="tuff-trilha-sep" aria-hidden="true"><use href="#ico-arrow-right"></use></svg>';

  const vigia = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entradas) => {
      for (const { target } of entradas) {
        if (target._tuffTrilha && target.clientWidth !== target._tuffTrilha.largura) compor(target);
      }
    })
    : null;

  function desenhar(nav, partes, opcoes = {}) {
    if (!nav) return;
    if (!nav._tuffTrilha) vigia?.observe(nav);
    nav._tuffTrilha = { partes, opcoes, largura: -1 };
    compor(nav);
  }

  function compor(nav) {
    const estado = nav._tuffTrilha;
    const n = estado.partes.length;
    // `k` é quantas partes recolhem. Até `n - 2` são as do meio; com `n - 1`, a primeira também.
    for (let k = 0; ; k++) {
      const atual = montar(nav, estado, k);
      // A parte atual encolhe por CSS, e encolhida ela esconderia o aperto que esta conta mede.
      if (atual) atual.style.flexShrink = '0';
      const cabe = nav.scrollWidth <= nav.clientWidth;
      if (atual) atual.style.flexShrink = '';
      if (cabe || nav.clientWidth === 0 || k >= n - 1) break;
    }
    estado.largura = nav.clientWidth;
  }

  function montar(nav, { partes, opcoes }, k) {
    const n = partes.length;
    const recolhe = (i) => i < n - 1 && (k > n - 2 || (i >= 1 && i <= k));
    const recolhidas = partes.filter((_, i) => recolhe(i));
    const els = [];
    let atual = null;
    partes.forEach((p, i) => {
      if (!recolhe(i)) {
        const el = parte(p, i === n - 1, opcoes);
        if (i === n - 1) atual = el;
        els.push(el);
      } else if (p === recolhidas[0]) {
        els.push(mais(recolhidas));
      }
    });
    nav.replaceChildren();
    els.forEach((el, i) => {
      if (i) nav.insertAdjacentHTML('beforeend', SEP);
      nav.append(el);
    });
    return atual;
  }

  function parte(p, atual, opcoes) {
    const el = document.createElement(atual ? 'span' : 'button');
    el.className = atual ? 'tuff-trilha-parte tuff-trilha-atual' : 'tuff-trilha-parte';
    el.textContent = p.rotulo;
    if (p.titulo) el.title = p.titulo;
    if (atual) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.type = 'button';
      el.addEventListener('click', () => p.ir?.());
    }
    opcoes.aoCriar?.(el, p);
    return el;
  }

  function mais(recolhidas) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tuff-trilha-parte';
    b.textContent = '…';
    b.title = recolhidas.map((p) => p.rotulo).join(' / ');
    b.setAttribute('aria-label', 'Caminho recolhido');
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', (e) => {
      const r = b.getBoundingClientRect();
      b.setAttribute('aria-expanded', 'true');
      menuDoAmbiente(recolhidas.map((p) => ({ label: p.rotulo, action: () => p.ir?.() })), r.left, r.bottom + 2, {
        teclado: e.detail === 0,
        aoFechar: () => b.setAttribute('aria-expanded', 'false'),
      });
    });
    return b;
  }

  window.TuffTrilha = { desenhar };

  // ─── A barra de menus ───────────────────────────────────────────────────────────────────────────
  //
  //     TuffMenus.ligar(barra, { menus, raiz })
  //
  // A barra é um `<nav class="tuff-menus">` com um `<button>` por menu, cada um com
  // `data-menu="<nome>"` e, quando tem letra de atalho, `data-tecla="<letra>"`. `menus` dá os
  // itens de cada menu na hora de abrir, `{ arquivo: () => itens }`, e é na hora de abrir que
  // "Copiar" sabe se há seleção. `raiz` é onde o Alt é escutado, em geral a janela inteira; sem
  // ela, a própria barra.
  //
  // O teclado é o de uma barra de menus. As setas andam entre os rótulos, e Enter, Espaço e a seta
  // para baixo abrem o menu; com um menu aberto, as setas para os lados passam ao vizinho. Alt mais
  // a letra abre o menu dela, e o Alt sozinho, apertado e solto, leva o foco ao rótulo. Uma tecla
  // que alguém dentro da janela já tratou (`defaultPrevented`) fica com ele: o terminal manda o Alt
  // mais a letra ao programa, como manda qualquer outra tecla.
  //
  // O clique no rótulo não tira o foco de onde ele está, e o menu que fecha sem levar o foco a
  // lugar nenhum o devolve a quem o tinha antes: a ação "Salvar" age no texto que a pessoa estava
  // editando, e o cursor continua lá depois dela.

  function sublinhar(b, tecla) {
    const texto = b.textContent;
    const i = texto.toLowerCase().indexOf(tecla.toLowerCase());
    if (i < 0) return;
    const s = document.createElement('span');
    s.className = 'tuff-menus-tecla';
    s.textContent = texto[i];
    b.replaceChildren(texto.slice(0, i), s, texto.slice(i + 1));
  }

  const perdido = (el) => !el || el === document.body
    || !!el.closest?.('#vssh-context-menu, #vssh-context-submenu');

  function ligar(barra, { menus = {}, raiz = barra } = {}) {
    if (!barra) return;
    barra.setAttribute('role', 'menubar');
    const rotulos = () => [...barra.querySelectorAll(':scope > button[data-menu]')];
    rotulos().forEach((b, i) => {
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.tabIndex = i ? -1 : 0;
      if (b.dataset.tecla) {
        b.setAttribute('aria-keyshortcuts', 'Alt+' + b.dataset.tecla.toUpperCase());
        sublinhar(b, b.dataset.tecla);
      }
    });

    let aberto = null;     // o rótulo cujo menu está na tela
    let focoAntes = null;  // quem tinha o foco antes do primeiro menu abrir
    let voltarPara = null; // quem tinha o foco antes de o Alt sozinho trazê-lo à barra
    let soAlt = false;     // o Alt foi apertado sem outra tecla, até agora

    function voltar() {
      if (voltarPara?.isConnected) voltarPara.focus();
      voltarPara = null;
    }

    function marcar(b) {
      for (const r of rotulos()) r.tabIndex = r === b ? 0 : -1;
    }

    function abrir(b, teclado) {
      const itens = menus[b.dataset.menu]?.();
      if (!itens?.length) return;
      if (!aberto) focoAntes = document.activeElement;
      else if (aberto !== b) aberto.setAttribute('aria-expanded', 'false');
      aberto = b;
      marcar(b);
      b.setAttribute('aria-expanded', 'true');
      const r = b.getBoundingClientRect();
      menuDoAmbiente(itens, r.left, r.bottom, {
        teclado,
        aoLado: (d) => abrir(vizinho(b, d), true),
        aoFechar: () => {
          if (aberto !== b) return;
          aberto = null;
          b.setAttribute('aria-expanded', 'false');
          if (perdido(document.activeElement) && focoAntes?.isConnected) focoAntes.focus();
          focoAntes = null;
        },
      });
    }

    function vizinho(b, d) {
      const lista = rotulos();
      return lista[(lista.indexOf(b) + d + lista.length) % lista.length];
    }

    barra.addEventListener('mousedown', (e) => {
      const b = e.target.closest('button[data-menu]');
      if (!b || e.button !== 0) return;
      e.preventDefault();
      // O menu deste rótulo já fechou neste mesmo aperto, pelo clique fora dele, e o aperto que o
      // fecha não o reabre.
      if (aberto !== b) abrir(b, false);
    });
    barra.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button[data-menu]');
      if (b && aberto && aberto !== b) abrir(b, false);
    });
    // O clique sem ponteiro (Enter ou Espaço no rótulo, ou um leitor de tela) chega com `detail` 0.
    barra.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-menu]');
      if (b && e.detail === 0) abrir(b, true);
    });
    barra.addEventListener('keydown', (e) => {
      const b = e.target.closest('button[data-menu]');
      if (!b) return;
      const lista = rotulos();
      let alvo = null;
      if (e.key === 'ArrowRight') alvo = vizinho(b, 1);
      else if (e.key === 'ArrowLeft') alvo = vizinho(b, -1);
      else if (e.key === 'Home') alvo = lista[0];
      else if (e.key === 'End') alvo = lista[lista.length - 1];
      else if (e.key === 'ArrowDown') { e.preventDefault(); abrir(b, true); return; }
      else if (e.key === 'Escape' && voltarPara) { e.preventDefault(); voltar(); return; }
      if (!alvo) return;
      e.preventDefault();
      marcar(alvo);
      alvo.focus();
    });

    raiz.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') {
        soAlt = !e.ctrlKey && !e.metaKey && !e.shiftKey;
        barra.classList.add('tuff-menus--alt');
        return;
      }
      soAlt = false;
      if (!e.altKey) barra.classList.remove('tuff-menus--alt');
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      const b = rotulos().find((r) => r.dataset.tecla && e.code === 'Key' + r.dataset.tecla.toUpperCase());
      if (!b) return;
      e.preventDefault();
      barra.classList.remove('tuff-menus--alt');
      abrir(b, true);
    });
    raiz.addEventListener('keyup', (e) => {
      if (e.key !== 'Alt') return;
      barra.classList.remove('tuff-menus--alt');
      if (!soAlt) return;
      soAlt = false;
      if (barra.contains(document.activeElement)) { voltar(); return; }
      voltarPara = document.activeElement;
      (rotulos().find((r) => r.tabIndex === 0) || rotulos()[0])?.focus();
    });
    raiz.addEventListener('mousedown', () => { soAlt = false; }, true);
    // Um Alt+Tab do sistema leva o foco embora antes do `keyup` do Alt, e o sublinhado ficaria.
    raiz.addEventListener('focusout', (e) => {
      if (raiz.contains(e.relatedTarget)) return;
      soAlt = false;
      barra.classList.remove('tuff-menus--alt');
    });
  }

  window.TuffMenus = { ligar };

  // ─── A moldura de app ───────────────────────────────────────────────────────────────────────────
  //
  //     TuffApp.ligar(raiz, { aoMudarForma, mais })
  //       devolve { forma, abrirGaveta, fecharGaveta, abrirPainel, fecharPainel, destruir }
  //
  // A disposição das regiões é do CSS (`.tuff-app` em `tuff.css`). Daqui vem o comportamento:
  // abrir e fechar a gaveta e o painel, levar o foco para dentro deles e devolvê-lo a quem os
  // abriu, fechar no Esc, e montar o "Mais" com os botões da barra que a forma compacta escondeu.
  // A forma corrente fica em `data-forma` na raiz (`compacta`, `media` ou `ampla`), e
  // `aoMudarForma(forma)` avisa quando ela vira.
  //
  // Os gatilhos são atributos, e valem para o que nascer depois na moldura: `data-tuff-app-gaveta`
  // abre a lateral, `data-tuff-app-painel` alterna o painel, `data-tuff-app-voltar` e
  // `data-tuff-app-fechar` o fecham, e `data-tuff-app-mais` abre o menu. O menu leva os botões de
  // `data-prioridade="baixa"` da barra que não estão na tela, com o rótulo e o ícone deles, e o
  // item chama o `click()` do botão; `mais()` acrescenta itens no fim. Selecionar um item do miolo
  // é do app, que chama `abrirPainel(item)`, e o foco volta ao item quando o painel fecha.
  //
  // O painel aberto por cima de outra região leva o foco na compacta, onde o miolo saiu da tela, e
  // quando quem abriu foi o botão do painel. Na média, aberto pela seleção, ele deixa o foco no
  // item, e a pessoa continua andando pela lista com o detalhe ao lado. Na compacta, a gaveta e o
  // painel são a tela inteira, e o que fica atrás deles ganha `inert`: a tabulação não cai numa
  // região coberta. Uma mudança de forma fecha os dois, porque o que estava aberto por cima de
  // outra região não tem para onde ir na forma nova.

  // Uma moldura ligada ainda escondida não tem largura, e nasce ampla; a medida da primeira vez que
  // ela aparece dá a forma de verdade.
  const formaDe = (largura) => (largura < 600 ? 'compacta' : largura < 840 ? 'media' : 'ampla');
  const FOCAVEL = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const GATILHO = '[data-tuff-app-gaveta], [data-tuff-app-painel], [data-tuff-app-voltar], [data-tuff-app-fechar], [data-tuff-app-mais]';
  const GAVETA = 'tuff-app--gaveta-aberta';
  const PAINEL = 'tuff-app--painel-aberto';

  function ligarApp(raiz, opcoes = {}) {
    if (!raiz) return { forma: () => 'ampla', abrirGaveta() {}, fecharGaveta() {}, abrirPainel() {}, fecharPainel() {}, destruir() {} };
    const regiao = (classe) => [...raiz.children].find((el) => el.classList.contains(classe)) || null;
    const lateral = regiao('tuff-app-lateral');
    const painel = regiao('tuff-app-painel');
    const barra = regiao('tuff-app-barra');
    let veu = regiao('tuff-app-veu');
    if (!veu && lateral) {
      veu = document.createElement('div');
      veu.className = 'tuff-app-veu';
      raiz.insertBefore(veu, lateral);
    }
    if (painel && !painel.hasAttribute('tabindex')) painel.tabIndex = -1;

    const desfazer = [];
    const ouvir = (alvo, tipo, fn, captura = false) => {
      if (!alvo) return;
      alvo.addEventListener(tipo, fn, captura);
      desfazer.push(() => alvo.removeEventListener(tipo, fn, captura));
    };
    const visivel = (el) => el.getClientRects().length > 0;
    // Os gatilhos desta moldura, e não os de uma moldura aninhada no painel dela.
    const gatilhos = (atributo) => [...raiz.querySelectorAll(`[${atributo}]`)].filter((b) => b.closest('.tuff-app') === raiz);
    const marcar = (atributo, aberto) => {
      for (const b of gatilhos(atributo)) b.setAttribute('aria-expanded', String(aberto));
    };
    const focar = (el) => { if (el && el.isConnected) el.focus({ preventScroll: true }); };

    let forma = formaDe(raiz.clientWidth || Infinity);
    let origemDaGaveta = null;
    let origemDoPainel = null;
    const inertes = new Set();
    raiz.dataset.forma = forma;

    for (const b of gatilhos('data-tuff-app-gaveta')) {
      if (lateral?.id) b.setAttribute('aria-controls', lateral.id);
      const nome = lateral?.getAttribute('aria-label');
      if (nome && !b.hasAttribute('aria-label') && !b.textContent.trim()) b.setAttribute('aria-label', nome);
    }
    for (const b of gatilhos('data-tuff-app-painel')) if (painel?.id) b.setAttribute('aria-controls', painel.id);
    for (const b of gatilhos('data-tuff-app-mais')) b.setAttribute('aria-haspopup', 'menu');
    marcar('data-tuff-app-gaveta', false);
    marcar('data-tuff-app-painel', raiz.classList.contains(PAINEL));
    marcar('data-tuff-app-mais', false);

    // O que fica coberto na compacta: tudo menos a gaveta aberta (e o véu dela), ou tudo menos o
    // painel aberto. A moldura só desfaz o `inert` que ela mesma pôs.
    function cobrir() {
      let fica = null;
      if (forma === 'compacta' && raiz.classList.contains(GAVETA)) fica = [lateral, veu];
      else if (forma === 'compacta' && raiz.classList.contains(PAINEL)) fica = [painel];
      for (const el of [...raiz.children]) {
        const cobre = !!fica && !fica.includes(el);
        if (cobre && !el.inert) { el.inert = true; inertes.add(el); }
        if (!cobre && inertes.has(el)) { el.inert = false; inertes.delete(el); }
      }
    }

    function abrirGaveta(origem) {
      if (!lateral || forma !== 'compacta' || raiz.classList.contains(GAVETA)) return;
      origemDaGaveta = origem || gatilhos('data-tuff-app-gaveta').find(visivel) || null;
      raiz.classList.add(GAVETA);
      marcar('data-tuff-app-gaveta', true);
      cobrir();
      // O foco entra no lugar atual, que é a resposta a "onde estou"; sem ele, no primeiro item.
      const atual = lateral.querySelector('[aria-current="true"], [aria-current="page"]');
      focar(atual && visivel(atual) ? atual : [...lateral.querySelectorAll(FOCAVEL)].find(visivel));
    }

    function fecharGaveta(devolverFoco) {
      if (!raiz.classList.contains(GAVETA)) return;
      raiz.classList.remove(GAVETA);
      marcar('data-tuff-app-gaveta', false);
      cobrir();
      if (devolverFoco) focar(origemDaGaveta);
      origemDaGaveta = null;
    }

    function abrirPainel(origem, levarFoco = forma === 'compacta') {
      if (!painel) return;
      if (origem) origemDoPainel = origem;
      raiz.classList.add(PAINEL);
      marcar('data-tuff-app-painel', true);
      cobrir();
      if (levarFoco && forma !== 'ampla') focar(painel);
    }

    function fecharPainel(devolverFoco) {
      if (!raiz.classList.contains(PAINEL)) return;
      raiz.classList.remove(PAINEL);
      marcar('data-tuff-app-painel', false);
      cobrir();
      if (devolverFoco && forma !== 'ampla') {
        focar(origemDoPainel?.isConnected && visivel(origemDoPainel)
          ? origemDoPainel : gatilhos('data-tuff-app-painel').find(visivel));
      }
      origemDoPainel = null;
    }

    function abrirMais(botao, teclado) {
      // Os que a forma escondeu, e não os que o app escondeu com `hidden` por não caberem agora,
      // no próprio botão ou num grupo em volta dele.
      const escondidos = barra ? [...barra.querySelectorAll('[data-prioridade="baixa"]')].filter((b) => !b.closest('[hidden]') && !visivel(b)) : [];
      const itens = escondidos.map((b) => ({
        label: b.getAttribute('aria-label') || b.title || b.textContent.trim(),
        icon: (b.querySelector('use')?.getAttribute('href') || '').replace(/^#ico-/, '') || undefined,
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
        checked: b.hasAttribute('aria-pressed') ? b.getAttribute('aria-pressed') === 'true' : undefined,
        action: () => b.click(),
      }));
      const extra = opcoes.mais?.() || [];
      if (itens.length && extra.length) itens.push({ separator: true });
      itens.push(...extra);
      if (!itens.length) return;
      const r = botao.getBoundingClientRect();
      botao.setAttribute('aria-expanded', 'true');
      menuDoAmbiente(itens, r.right, r.bottom + 2, {
        teclado,
        aoFechar: () => botao.setAttribute('aria-expanded', 'false'),
      });
    }

    ouvir(raiz, 'click', (e) => {
      const gatilho = e.target.closest?.(GATILHO);
      if (gatilho && gatilho.closest('.tuff-app') === raiz) {
        if (gatilho.hasAttribute('data-tuff-app-gaveta')) {
          if (raiz.classList.contains(GAVETA)) fecharGaveta(true); else abrirGaveta(gatilho);
        } else if (gatilho.hasAttribute('data-tuff-app-painel')) {
          if (raiz.classList.contains(PAINEL) && forma !== 'ampla') fecharPainel(true);
          else abrirPainel(gatilho, true);
        } else if (gatilho.hasAttribute('data-tuff-app-mais')) {
          abrirMais(gatilho, e.detail === 0);
        } else {
          fecharPainel(true);
        }
        return;
      }
      if (e.target === veu) { fecharGaveta(true); return; }
      if (escolheuNaGaveta) { escolheuNaGaveta = false; fecharGaveta(true); }
    });

    // Escolher um lugar na gaveta fecha a gaveta. Um botão que abre alguma coisa dentro dela (um
    // ramo da árvore, um menu) não é escolha, e ela fica. A escolha é lida na captura, antes de o
    // app tratar o clique, e a gaveta fecha na borbulha, depois dele: um app que redesenha a
    // lateral no clique (o Chaveiro repinta os filtros com a contagem) tira o botão da árvore, e
    // na borbulha ele já não estaria dentro da lateral.
    let escolheuNaGaveta = false;
    ouvir(raiz, 'click', (e) => {
      const escolha = raiz.classList.contains(GAVETA) && lateral?.contains(e.target) && e.target.closest('button, a[href]');
      escolheuNaGaveta = !!escolha && !escolha.matches('[aria-expanded], [aria-haspopup]');
    }, true);

    // O Esc na moldura, e não no documento: no shell, o documento tem as outras janelas.
    ouvir(raiz, 'keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (raiz.classList.contains(GAVETA)) { e.preventDefault(); fecharGaveta(true); return; }
      if (raiz.classList.contains(PAINEL) && forma !== 'ampla') { e.preventDefault(); fecharPainel(true); }
    });

    function medir() {
      const largura = raiz.clientWidth;
      if (!largura) return;
      const nova = formaDe(largura);
      if (nova === forma) return;
      forma = nova;
      raiz.dataset.forma = nova;
      fecharGaveta(false);
      fecharPainel(nova !== 'ampla' && !!painel?.contains(document.activeElement));
      opcoes.aoMudarForma?.(nova);
    }
    const vigiaDaForma = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    vigiaDaForma?.observe(raiz);

    return {
      forma: () => forma,
      abrirGaveta: () => abrirGaveta(null),
      fecharGaveta: () => fecharGaveta(true),
      abrirPainel: (origem) => abrirPainel(origem || null),
      fecharPainel: () => fecharPainel(true),
      destruir() {
        vigiaDaForma?.disconnect();
        for (const f of desfazer) f();
        for (const el of inertes) el.inert = false;
        inertes.clear();
      },
    };
  }

  window.TuffApp = { ligar: ligarApp };
})();

// ─── A tabela ────────────────────────────────────────────────────────────────────────────────────
//
// A ordem é de quem desenha a tabela: ele sabe comparar as linhas. A peça diz qual coluna está
// ordenada e em que direção, no `aria-sort` de cada cabeçalho, e avisa do clique num deles. Uma
// coluna sem botão (`.tuff-tabela-ordem`) não se ordena, e fica sem `aria-sort`.

(function () {

  function marcar(cab, chave, crescente) {
    if (!cab) return;
    for (const th of cab.querySelectorAll('.tuff-tabela-th')) {
      const botao = th.querySelector('.tuff-tabela-ordem');
      if (!botao) { th.removeAttribute('aria-sort'); continue; }
      th.setAttribute('aria-sort', botao.dataset.chave !== chave ? 'none' : (crescente ? 'ascending' : 'descending'));
    }
  }

  function ligar(cab, aoOrdenar) {
    cab?.addEventListener('click', (e) => {
      const botao = e.target.closest('.tuff-tabela-ordem');
      if (botao && cab.contains(botao)) aoOrdenar(botao.dataset.chave);
    });
  }

  window.TuffTabela = { marcar, ligar };
})();

// ─── O limpar da busca ───────────────────────────────────────────────────────────────────────────
//
// O botão `.tuff-busca-limpar` esvazia o `.tuff-busca` da mesma caixa e manda um `input`, como se a
// pessoa tivesse apagado o texto: quem filtra no `input` do campo já refaz a lista, sem escutar o
// botão. O foco volta ao campo, para a pessoa digitar a busca seguinte. Um ouvinte só, no
// documento, serve a toda busca da página, inclusive às que nascem depois. Fora de um documento
// (o arquivo avaliado sem DOM, para usar `TuffArquivo`), não há o que escutar.

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', (e) => {
    const botao = e.target.closest?.('.tuff-busca-limpar');
    const campo = botao?.closest('.tuff-busca-caixa')?.querySelector('.tuff-busca');
    if (!campo) return;
    campo.value = '';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.focus();
  });
}
