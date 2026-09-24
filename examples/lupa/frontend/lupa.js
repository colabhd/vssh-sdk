/* Lupa: o comportamento.
 *
 * ─── Como um arquivo chega ──────────────────────────────────────────────────
 *
 * Por quatro portas: o evento `abertura` (o duplo-clique no gerenciador de arquivos, o "Abrir
 * com"), o botão de abrir, um arquivo solto na janela, e o `?caminho=` com que a sessão do
 * ambiente reabre a janela. As quatro terminam em `abrir(caminho)`, que mostra o arquivo na hora e
 * pede a pasta ao backend em paralelo. Andar pela pasta depois disso troca o item dentro da lista
 * que já veio, sem pedido nenhum.
 *
 * Uma pasta chega pelo mesmo evento, com `tipo: 'pasta'` (o "Abrir na Lupa" do menu de uma pasta),
 * ou pelo `?pasta=` da sessão, e começa pela grade das miniaturas. De uma imagem, o Esc leva à
 * grade da pasta dela.
 *
 * ─── A imagem ───────────────────────────────────────────────────────────────
 *
 * `TuffMidia.imagem` devolve o elemento pronto: uma `img` já decodificada, ou o `canvas` de um
 * TIFF ou HEIC. O `TuffMidia.visor` o mostra com zoom, arraste e rotação. O elemento só entra no
 * visor quando está decodificado, então a imagem anterior fica na tela até a seguinte existir, e a
 * troca não pisca. As vizinhas são carregadas depois da atual e ficam guardadas.
 *
 * ─── A tira ─────────────────────────────────────────────────────────────────
 *
 * As miniaturas vêm do backend (`api/miniatura`), com a data do arquivo na URL para o navegador
 * guardá-las. O que o backend recusa, a página desenha: SVG e AVIF pelo próprio arquivo, TIFF e
 * HEIC pela miniatura que já vem dentro deles. Um TIFF sem níveis não traz miniatura; ele é
 * decodificado uma vez, reduzido, e a miniatura fica no Cache Storage do navegador, pela mesma
 * chave do backend (caminho, data, tamanho).
 *
 * Nada roda até o `DOMContentLoaded`: o `web.spa` injeta os scripts antes de `</head>`, sem
 * `defer`, e este arquivo executa com o `<body>` ainda vazio.
 */
function montarLupa() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const janela = $('janela');
  const tira = $('tira');

  const extensao = (nome) => {
    const i = String(nome || '').lastIndexOf('.');
    return i > 0 ? nome.slice(i + 1).toLowerCase() : '';
  };
  const nomeDe = (caminho) => String(caminho || '').split('/').pop();
  const pastaDe = (caminho) => String(caminho || '').replace(/\/[^/]*$/, '') || '/';
  const ehPdf = (item) => extensao(item.nome) === 'pdf';

  // As preferências que valem só para esta pessoa neste navegador. `localStorage` pode lançar
  // (janela privada, dados bloqueados), e aí a Lupa segue com os padrões.
  const PREF = 'lupa:';
  const lerPref = (k, padrao) => {
    try { const v = localStorage.getItem(PREF + k); return v === null ? padrao : JSON.parse(v); }
    catch { return padrao; }
  };
  const gravarPref = (k, v) => { try { localStorage.setItem(PREF + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

  // ── Estado ──────────────────────────────────────────────────────────────
  let fila = [];      // os irmãos de pasta, `{nome, caminho, modificado, tamanho}`, na ordem do backend
  let indice = -1;
  let atual = null;   // o item na tela
  // Toda abertura ganha um número, e a resposta da pasta confere o dela antes de mexer na fila:
  // abrir B enquanto a pasta de A carrega não pode deixar a lista de A, que chega depois, no
  // lugar da de B. A imagem tem o contador dela, pelo mesmo motivo, porque andar pela pasta troca
  // a imagem sem abrir nada.
  let geracao = 0;
  let vista = 0;
  let modo = 'inicio';   // inicio | imagem | grade
  let pasta = null;      // a pasta da fila, quando o backend já a listou
  let versaoDaFila = 0;  // muda a cada fila nova; a grade se remonta quando fica para trás

  /**
   * Uma chamada à API do app. O corpo do erro viaja junto: o servidor diz o que falhou
   * (`{error}`), e um 502 do portal chega em HTML, então o `.json()` é opcional.
   */
  const api = (rota, corpo) => fetch(rota, corpo === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  }).then(async (r) => {
    let corpo = null;
    try { corpo = await r.json(); } catch { /* nem toda resposta é JSON */ }
    if (!r.ok) {
      throw Object.assign(new Error((corpo && corpo.error) || `${rota}: ${r.status}`),
                          { corpo: corpo || {}, status: r.status });
    }
    return corpo;
  });

  // ── O que aparece sobre o palco ─────────────────────────────────────────

  // O aviso fica até outro arquivo aparecer: quem saiu da janela por um minuto volta e ainda lê
  // por que a imagem não está ali.
  function avisar(texto) {
    $('aviso-t').textContent = texto || '';
    $('aviso').hidden = !texto;
  }

  // O spinner só aparece depois de 200 ms: uma foto que decodifica em 50 ms não pisca um spinner.
  let esperaDoSpinner = null;
  function carregando(sim) {
    clearTimeout(esperaDoSpinner);
    if (sim) esperaDoSpinner = setTimeout(() => { $('carregando').hidden = false; }, 200);
    else $('carregando').hidden = true;
  }

  function telaDoInicio() {
    modo = 'inicio';
    $('inicio').hidden = false;
    $('barra').hidden = true;
    $('grade-moldura').hidden = true;
    $('palco').hidden = false;
    tira.hidden = true;
  }

  function pintarNavegacao() {
    const n = fila.length;
    $('posicao').textContent = n > 1 ? `${indice + 1} de ${n}` : '';
    $('btn-anterior').hidden = !(indice > 0);
    $('btn-proximo').hidden = !(indice >= 0 && indice < n - 1);
  }

  // ── O visor ─────────────────────────────────────────────────────────────

  // A barra é uma só para os dois tipos: com um PDF aberto, os controles de zoom e de giro valem
  // para ele, e o resto do tempo para o visor. `noPdf` vem antes do visor porque o visor chama o
  // `aoMudar` já na construção.
  const noPdf = () => !!(atual && ehPdf(atual) && visorPdf && visorPdf.doc);
  const visor = TuffMidia.visor($('visor'), {
    aoMudar: ({ escala }) => { if (!noPdf()) $('btn-escala').textContent = `${Math.round(escala * 100)}%`; },
  });
  const ampliar = () => (noPdf() ? visorPdf.viewer.increaseScale() : visor.ampliar());
  const reduzir = () => (noPdf() ? visorPdf.viewer.decreaseScale() : visor.reduzir());
  const caber = () => { if (noPdf()) visorPdf.viewer.currentScaleValue = 'page-fit'; else visor.ajustar(); };
  const umPorUm = () => { if (noPdf()) visorPdf.viewer.currentScaleValue = '1'; else visor.cem(); };
  const girar = (sentido) => {
    if (noPdf()) {
      visorPdf.viewer.pagesRotation = (visorPdf.viewer.pagesRotation + (sentido < 0 ? 270 : 90)) % 360;
      return;
    }
    visor.girar(sentido);
    if (atual && modo === 'imagem' && !$('visor').hidden) girarNoArquivo(atual, sentido);
  };
  $('btn-mais').addEventListener('click', ampliar);
  $('btn-menos').addEventListener('click', reduzir);
  $('btn-escala').addEventListener('click', () => {
    if (noPdf()) visorPdf.viewer.currentScaleValue = 'page-width';
    else if (visor.ajustada()) visor.cem();
    else visor.ajustar();
  });
  $('btn-girar').addEventListener('click', () => girar(1));

  // ── Carregar, com as vizinhas guardadas ─────────────────────────────────

  const guardadas = new Map();   // de caminho para Promise<{ elemento, documento }>
  function carregar(item) {
    if (!guardadas.has(item.caminho)) {
      // Uma rotação em voo vem antes: lida no meio dela, a imagem seria a de antes.
      const antes = emVoo.get(item.caminho) || Promise.resolve();
      const p = antes.then(() => TuffMidia.imagem(urlDaImagem(item), { nome: item.nome }));
      // Uma falha não fica guardada: voltar ao arquivo tenta de novo.
      p.catch(() => { if (guardadas.get(item.caminho) === p) guardadas.delete(item.caminho); });
      guardadas.set(item.caminho, p);
    }
    return guardadas.get(item.caminho);
  }
  /** A atual e as duas seguintes e a anterior ficam guardadas; o resto é solto para a memória. */
  function preCarregar() {
    const perto = [indice + 1, indice - 1, indice + 2].map((i) => fila[i]).filter((it) => it && !ehPdf(it));
    const manter = new Set([atual && atual.caminho, ...perto.map((it) => it.caminho)]);
    for (const c of guardadas.keys()) if (!manter.has(c)) guardadas.delete(c);
    for (const it of perto) carregar(it).catch(() => {});
  }

  // ── Girar e gravar ──────────────────────────────────────────────────────
  //
  // Girar um JPEG ou um PNG grava no arquivo, e os outros formatos giram só na tela. Toda rotação
  // gravada é sem perda (a etiqueta de orientação num JPEG, os mesmos pixels num PNG), então girar
  // de volta desfaz, e o arquivo não passa pela lixeira.
  //
  // A gravação espera a pessoa parar de girar: quatro toques no R dão uma volta inteira e não
  // gravam nada. Sair da imagem grava na hora o que estava esperando, e as rotações do mesmo
  // arquivo vão uma de cada vez.

  const GRAVAVEIS = new Set(['jpg', 'jpeg', 'png']);
  const giroPendente = new Map();   // de caminho para { item, graus }, esperando a pausa
  const emVoo = new Map();          // de caminho para a Promise da gravação
  const versoes = new Map();        // de caminho para a data do arquivo depois de gravar
  let esperaDoGiro = null;

  // A data de um arquivo girado vai na URL da imagem. O portal responde pelo ETag, que é o tamanho
  // e a data em segundos, e a etiqueta de um JPEG gira sem mudar o tamanho: duas rotações no mesmo
  // segundo teriam o mesmo ETag, e o navegador mostraria a imagem da primeira.
  function urlDaImagem(item) {
    const url = vssh.arquivos.urlFor(item.caminho);
    const v = versoes.get(item.caminho);
    return v ? `${url}${url.includes('?') ? '&' : '?'}v=${v}` : url;
  }

  function girarNoArquivo(item, sentido) {
    if (!GRAVAVEIS.has(extensao(item.nome))) return;
    const p = giroPendente.get(item.caminho) || { item, graus: 0 };
    p.graus = (p.graus + (sentido < 0 ? 270 : 90)) % 360;
    giroPendente.set(item.caminho, p);
    clearTimeout(esperaDoGiro);
    esperaDoGiro = setTimeout(gravarGiros, 700);
  }

  /** Grava o que espera. Na saída da página, o pedido vai com `keepalive` e ninguém espera a resposta. */
  function gravarGiros(saindo = false) {
    clearTimeout(esperaDoGiro);
    const lote = [...giroPendente.values()].filter((p) => p.graus);
    giroPendente.clear();
    for (const { item, graus } of lote) {
      if (saindo === true) {
        fetch('api/girar', {
          method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caminho: item.caminho, graus }),
        }).catch(() => {});
        continue;
      }
      // A imagem guardada é a de antes, e a próxima leitura espera a gravação.
      guardadas.delete(item.caminho);
      const antes = emVoo.get(item.caminho) || Promise.resolve();
      const p = antes.then(() => gravarGiro(item, graus));
      emVoo.set(item.caminho, p);
      p.finally(() => { if (emVoo.get(item.caminho) === p) emVoo.delete(item.caminho); });
    }
  }
  addEventListener('pagehide', () => gravarGiros(true));

  async function gravarGiro(item, graus) {
    let r;
    try {
      r = await api('api/girar', { caminho: item.caminho, graus });
    } catch (e) {
      avisar(e.status === 403 ? `${item.nome} é só de leitura, e a rotação não foi gravada.`
        : e.status === 415 ? `A rotação de ${item.nome} não foi gravada: este arquivo não gira sem perda.`
        : `A rotação de ${item.nome} não foi gravada.`);
      return;
    }
    versoes.set(item.caminho, r.modificado);
    const i = fila.findIndex((it) => it.caminho === item.caminho);
    for (const it of [item, atual, fila[i]]) {
      if (it && it.caminho === item.caminho) Object.assign(it, { modificado: r.modificado, tamanho: r.tamanho });
    }
    // A tira e a grade pedem a miniatura com a data nova, e o backend a gera do arquivo girado.
    if (i >= 0) {
      const b = tira.children[i];
      if (b && b.querySelector('img, canvas')) pintarMiniatura(b, fila[i]);
      for (const no of $('grade').querySelectorAll('.tuff-miniatura')) {
        if (no.__indice === i) montarNaGrade(i, no);
      }
    }
    if (atual && atual.caminho === item.caminho && !$('info').hidden) pintarInfo(atual);
  }

  // ── O PDF ───────────────────────────────────────────────────────────────
  //
  // O pdf.js vai dentro do app, em `vendor/pdfjs/` (Apache 2.0), e é buscado só no primeiro PDF: o
  // core, o worker e o `pdf_viewer`, que desenha só as páginas na tela e as vizinhas, redesenha na
  // escala e na densidade da tela a cada zoom, e põe a camada de texto e os links. O arquivo é lido
  // pelo `urlFor` com Range e sem o download automático do resto: a primeira página aparece antes
  // de o arquivo inteiro chegar.
  //
  // É a versão `legacy` do pdf.js. A outra é escrita para o navegador mais novo do momento: a 6.3
  // chama `Map.prototype.getOrInsertComputed` no worker, que o Chromium 144 do cliente de desktop
  // não tem, e todo PDF falhava lá com "não conseguiu abrir".
  //
  // Dos pacotes opcionais do pdf.js, dois vão junto, e a escolha saiu de PDFs que precisam deles:
  // `cmaps`, sem o qual o texto de uma fonte CID não embutida (japonês, chinês) some da página, e
  // `wasm`, sem o qual uma imagem JPEG 2000 ou JBIG2, comum em documento escaneado, fica em branco.
  // As fontes padrão ficam de fora: sem elas a Helvetica de um PDF sai com a fonte do sistema,
  // desenhada igual.

  const VENDOR = new URL('vendor/pdfjs/', document.baseURI).href;
  let pdfjs = null;
  function carregarPdfjs() {
    if (!pdfjs) {
      pdfjs = (async () => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = VENDOR + 'pdf_viewer.css';
        document.head.appendChild(css);
        const lib = await import(VENDOR + 'pdf.min.mjs');
        lib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
        globalThis.pdfjsLib = lib;   // o `pdf_viewer` lê o core daqui
        const V = await import(VENDOR + 'pdf_viewer.mjs');
        return { lib, V };
      })();
      pdfjs.catch(() => { pdfjs = null; });
    }
    return pdfjs;
  }

  let visorPdf = null;
  async function prepararPdf() {
    const { lib, V } = await carregarPdfjs();
    if (visorPdf) return visorPdf;
    const eventBus = new V.EventBus();
    const link = new V.PDFLinkService({ eventBus });
    const find = new V.PDFFindController({ eventBus, linkService: link });
    const viewer = new V.PDFViewer({
      container: $('pdf-rolagem'), viewer: $('pdf-paginas'), eventBus, linkService: link,
      findController: find, annotationMode: lib.AnnotationMode.ENABLE,
    });
    link.setViewer(viewer);
    // `auto`: a largura da janela, sem passar de 125% numa página em pé, que é o padrão do Firefox.
    eventBus.on('pagesinit', () => { viewer.currentScaleValue = 'auto'; });
    eventBus.on('pagechanging', ({ pageNumber }) => pintarPaginaPdf(pageNumber));
    eventBus.on('scalechanging', ({ scale }) => {
      if (noPdf()) $('btn-escala').textContent = `${Math.round(scale * 100)}%`;
    });
    eventBus.on('updatefindmatchescount', ({ matchesCount }) => pintarContagem(matchesCount));
    eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => pintarContagem(matchesCount, state));
    eventBus.on('rotationchanging', () => {
      for (const b of $('pdf-miniaturas').children) {
        b.querySelector('.folha').replaceChildren();
        if (observadorPdf) observadorPdf.observe(b);
      }
    });
    visorPdf = { lib, V, eventBus, link, find, viewer, doc: null, tarefa: null, item: null };
    return visorPdf;
  }

  async function mostrarPdf(item, minha) {
    const P = await prepararPdf();
    if (minha !== vista) return;
    fecharPdf();
    const tarefa = P.lib.getDocument({
      url: vssh.arquivos.urlFor(item.caminho),
      cMapUrl: VENDOR + 'cmaps/', cMapPacked: true, wasmUrl: VENDOR + 'wasm/',
      disableAutoFetch: true, disableStream: true, rangeChunkSize: 256 * 1024,
      isEvalSupported: false,
    });
    P.tarefa = tarefa;
    tarefa.onPassword = async (atualizar, motivo) => {
      carregando(false);
      const errada = motivo === P.lib.PasswordResponses.INCORRECT_PASSWORD;
      const senha = await vssh.dialogos.senha(
        errada ? 'A senha não confere.' : `${item.nome} está protegido por senha.`, item.nome);
      if (senha == null) {
        tarefa.cancelada = true;
        tarefa.destroy();
        return;
      }
      carregando(true);
      atualizar(senha);
    };
    let doc;
    try {
      doc = await tarefa.promise;
    } catch (e) {
      throw Object.assign(e || new Error('o PDF não abriu'), { senha: !!tarefa.cancelada });
    }
    if (minha !== vista || P.tarefa !== tarefa) return;
    P.doc = doc;
    P.item = item;
    P.viewer.setDocument(doc);
    P.link.setDocument(doc, null);
    P.viewer.pagesRotation = 0;
    $('pdf-total').textContent = `de ${doc.numPages}`;
    $('pdf-pagina').max = String(doc.numPages);
    montarLateral(doc, minha);
    pintarPaginaPdf(1);
    if (!$('info').hidden) pintarInfo(item);
    $('pdf-rolagem').focus({ preventScroll: true });
  }

  function fecharPdf() {
    if (!visorPdf) return;
    if (visorPdf.tarefa) { visorPdf.tarefa.destroy(); visorPdf.tarefa = null; }
    if (visorPdf.doc) {
      visorPdf.viewer.setDocument(null);
      visorPdf.link.setDocument(null, null);
      visorPdf.doc = null;
      visorPdf.item = null;
    }
    if (observadorPdf) observadorPdf.disconnect();
    $('pdf-miniaturas').textContent = '';
    $('pdf-sumario').textContent = '';
    $('pdf-total').textContent = '';
    $('pdf-pagina').value = '1';
    // A busca é do documento: outro PDF começa sem ela.
    $('busca').hidden = true;
    $('busca-campo').value = '';
    $('busca-contagem').textContent = '';
    // A rolagem do documento anterior não passa ao seguinte: sem isto, o PDF novo abriria na
    // página em que o outro estava.
    $('pdf-rolagem').scrollTop = 0;
    $('pdf-rolagem').scrollLeft = 0;
  }

  const irPaginaPdf = (n) => {
    if (!noPdf()) return;
    visorPdf.viewer.currentPageNumber = Math.max(1, Math.min(visorPdf.doc.numPages, Math.round(n) || 1));
  };
  $('pdf-pagina').addEventListener('change', () => irPaginaPdf(Number($('pdf-pagina').value)));
  $('pdf-pagina').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    irPaginaPdf(Number($('pdf-pagina').value));
    $('pdf-rolagem').focus({ preventScroll: true });
  });
  $('btn-largura').addEventListener('click', () => { if (noPdf()) visorPdf.viewer.currentScaleValue = 'page-width'; });
  $('btn-pagina-inteira').addEventListener('click', () => { if (noPdf()) visorPdf.viewer.currentScaleValue = 'page-fit'; });

  function pintarPaginaPdf(n) {
    $('pdf-pagina').value = String(n);
    for (const b of $('pdf-miniaturas').children) {
      const sim = Number(b.dataset.pagina) === n;
      b.setAttribute('aria-selected', String(sim));
      if (sim && !$('pdf-lateral').hidden) b.scrollIntoView({ block: 'nearest' });
    }
  }

  // Ctrl e a roda ampliam no ponteiro, proporcionais ao gesto, como o visor faz com uma imagem.
  $('pdf-rolagem').addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !noPdf()) return;
    e.preventDefault();
    const expoente = Math.max(-1, Math.min(1, -e.deltaY * (e.deltaMode ? 0.1 : 0.005)));
    visorPdf.viewer.updateScale({ scaleFactor: Math.pow(2, expoente), origin: [e.clientX, e.clientY] });
  }, { passive: false });

  // Um link para fora do documento abre pelo ambiente, no navegador dele: seguido aqui dentro, ele
  // trocaria a página da Lupa pelo site. Os links internos o pdf.js resolve sozinho.
  $('pdf-paginas').addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || !/^https?:/i.test(a.href) || a.href.startsWith(location.origin)) return;
    e.preventDefault();
    e.stopPropagation();
    Promise.resolve(vssh.arquivos.abrirLink(a.href)).catch(() => {});
  }, true);

  // ── A busca no PDF ──────────────────────────────────────────────────────
  //
  // O `PDFFindController` do pdf.js percorre o documento inteiro, inclusive as páginas que ainda
  // não foram desenhadas, destaca as ocorrências na camada de texto e leva à página de cada uma.
  // Maiúsculas e acentos não contam: "acao" acha "Ação" (`matchDiacritics: false`). A camada de
  // texto é a mesma que deixa selecionar e copiar, com o Ctrl+C do navegador.

  let esperaDaBusca = null;
  function buscar(tipo, paraTras) {
    if (!noPdf()) return;
    visorPdf.eventBus.dispatch('find', {
      source: null, type: tipo, query: $('busca-campo').value,
      caseSensitive: false, entireWord: false, highlightAll: true,
      findPrevious: !!paraTras, matchDiacritics: false,
    });
  }
  function abrirBusca() {
    if (!noPdf()) return;
    $('busca').hidden = false;
    $('busca-campo').focus();
    $('busca-campo').select();
    // Reaberta com o texto de antes, a busca volta a destacar e a contar.
    if ($('busca-campo').value) buscar('', false);
  }
  function fecharBusca() {
    if ($('busca').hidden) return;
    $('busca').hidden = true;
    $('busca-contagem').textContent = '';
    if (visorPdf) visorPdf.eventBus.dispatch('findbarclose', { source: null });
    $('pdf-rolagem').focus({ preventScroll: true });
  }
  function pintarContagem(conta, estado) {
    const alvo = $('busca-contagem');
    if (!$('busca-campo').value) { alvo.textContent = ''; return; }
    const { FindState } = visorPdf.V;
    if (estado === FindState.PENDING) { alvo.textContent = 'Buscando…'; return; }
    if (!conta || !conta.total) {
      if (estado === FindState.NOT_FOUND) alvo.textContent = 'Nenhum resultado';
      return;
    }
    alvo.textContent = `${conta.current} de ${conta.total}`;
  }
  $('btn-buscar').addEventListener('click', abrirBusca);
  $('busca-fechar').addEventListener('click', fecharBusca);
  $('busca-proxima').addEventListener('click', () => buscar('again', false));
  $('busca-anterior').addEventListener('click', () => buscar('again', true));
  $('busca-campo').addEventListener('input', () => {
    clearTimeout(esperaDaBusca);
    esperaDaBusca = setTimeout(() => buscar('', false), 200);
  });
  $('busca-campo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(esperaDaBusca);
      buscar('again', e.shiftKey);
    } else if (e.key === 'Escape') {
      // O Esc da busca fecha a busca, e não leva à grade.
      e.preventDefault();
      fecharBusca();
    }
  });

  // ── A lateral do PDF: as miniaturas das páginas e o sumário ─────────────

  let observadorPdf = null;
  function montarLateral(doc, minha) {
    const lista = $('pdf-miniaturas');
    lista.textContent = '';
    if (observadorPdf) observadorPdf.disconnect();
    observadorPdf = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        observadorPdf.unobserve(e.target);
        desenharMiniaturaPdf(e.target, doc).catch(() => {});
      }
    }, { root: $('pdf-lateral'), rootMargin: '400px 0px' });
    for (let n = 1; n <= doc.numPages; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pdf-miniatura';
      b.dataset.pagina = String(n);
      b.setAttribute('aria-label', `Página ${n}`);
      b.innerHTML = `<span class="folha"></span><span class="numero">${n}</span>`;
      lista.appendChild(b);
      observadorPdf.observe(b);
    }
    $('pdf-sumario').textContent = '';
    $('pdf-abas').hidden = true;
    mostrarAba('paginas');
    doc.getOutline().then((sumario) => {
      if (minha !== vista || !sumario || !sumario.length) return;
      $('pdf-sumario').appendChild(montarSumario(sumario));
      $('pdf-abas').hidden = false;
    }).catch(() => {});
  }

  async function desenharMiniaturaPdf(botao, doc) {
    const page = await doc.getPage(Number(botao.dataset.pagina));
    if (!visorPdf || visorPdf.doc !== doc) return;
    const rotacao = (page.rotate + visorPdf.viewer.pagesRotation) % 360;
    const largura = page.getViewport({ scale: 1, rotation: rotacao }).width;
    const vp = page.getViewport({ scale: (120 * (window.devicePixelRatio || 1)) / largura, rotation: rotacao });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (visorPdf.doc === doc) botao.querySelector('.folha').replaceChildren(c);
  }
  $('pdf-miniaturas').addEventListener('click', (e) => {
    const b = e.target.closest('.pdf-miniatura');
    if (b) irPaginaPdf(Number(b.dataset.pagina));
  });

  function montarSumario(itens) {
    const ul = document.createElement('ul');
    for (const it of itens) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.title || 'Sem título';
      b.addEventListener('click', () => {
        if (it.dest && noPdf()) visorPdf.link.goToDestination(it.dest);
        else if (it.url) Promise.resolve(vssh.arquivos.abrirLink(it.url)).catch(() => {});
      });
      li.appendChild(b);
      if (it.items && it.items.length) li.appendChild(montarSumario(it.items));
      ul.appendChild(li);
    }
    return ul;
  }

  function mostrarAba(qual) {
    $('pdf-miniaturas').hidden = qual !== 'paginas';
    $('pdf-sumario').hidden = qual !== 'sumario';
    for (const r of $('pdf-abas').querySelectorAll('input')) r.checked = r.value === qual;
  }
  $('pdf-abas').addEventListener('change', (e) => mostrarAba(e.target.value));

  function alternarLateral() {
    const sim = $('pdf-lateral').hidden;
    $('pdf-lateral').hidden = !sim;
    $('btn-lateral').setAttribute('aria-pressed', String(sim));
    gravarPref('lateral', sim);
    // Aberta, a lateral vai até a página em que a pessoa está.
    if (sim && noPdf()) pintarPaginaPdf(visorPdf.viewer.currentPageNumber);
  }
  $('btn-lateral').addEventListener('click', alternarLateral);
  $('pdf-lateral').hidden = lerPref('lateral', false) !== true;
  $('btn-lateral').setAttribute('aria-pressed', String(!$('pdf-lateral').hidden));

  // ── Mostrar um item ─────────────────────────────────────────────────────

  let primeiroFoco = true;
  function entrarNaImagem() {
    if (modo === 'grade') guardarRolagem();
    modo = 'imagem';
    $('grade-moldura').hidden = true;
    $('palco').hidden = false;
    $('ferramentas').hidden = false;
    $('btn-grade').hidden = fila.length < 2;
    pintarTira();
  }

  async function mostrar(item) {
    gravarGiros();
    atual = item;
    const minha = ++vista;
    entrarNaImagem();
    avisar('');
    $('inicio').hidden = true;
    $('barra').hidden = false;
    $('nome').textContent = item.nome;
    $('nome').title = item.caminho;
    document.title = `${item.nome} — Lupa`;
    // A sessão do ambiente reabre a janela nesta rota, e a Lupa volta no mesmo arquivo.
    vssh.app.lembrarRota(`?caminho=${encodeURIComponent(item.caminho)}`);
    pintarNavegacao();
    marcarNaTira();
    if (!$('info').hidden) pintarInfo(item);

    const pdf = ehPdf(item);
    // O tipo aberto decide quais controles da barra aparecem (`.so-pdf`).
    janela.dataset.tipo = pdf ? 'pdf' : 'imagem';
    if (pdf) {
      $('visor').hidden = true;
      $('pdf').hidden = false;
      carregando(true);
      try {
        await mostrarPdf(item, minha);
      } catch (e) {
        if (minha !== vista) return;
        $('pdf').hidden = true;
        avisar(e && e.senha ? `${item.nome} está protegido por senha.`
          : item.sumiu ? `${item.nome} não existe mais.`
          : `A Lupa não conseguiu abrir ${item.nome}.`);
      } finally {
        if (minha === vista) carregando(false);
      }
      preCarregar();
      return;
    }
    $('pdf').hidden = true;
    fecharPdf();

    carregando(true);
    try {
      const { elemento } = await carregar(item);
      if (minha !== vista) return;
      $('visor').hidden = false;
      visor.trocar(elemento);
      // O foco no visor leva + e − ao zoom sem clique antes. Só na primeira imagem: depois disso o
      // foco é de quem a pessoa clicou por último.
      if (primeiroFoco) { primeiroFoco = false; $('visor').focus({ preventScroll: true }); }
    } catch (e) {
      if (minha !== vista) return;
      $('visor').hidden = true;
      avisar(e && e.codigo === 'sem-hevc' ? 'O navegador desta máquina não decodifica HEIC.'
        : item.sumiu ? `${item.nome} não existe mais.`
        : `A Lupa não conseguiu mostrar ${item.nome}.`);
    } finally {
      if (minha === vista) carregando(false);
    }
    preCarregar();
  }

  function irPara(i) {
    if (i < 0 || i >= fila.length || i === indice) return;
    indice = i;
    mostrar(fila[i]);
  }
  const anterior = () => irPara(indice - 1);
  const proximo = () => irPara(indice + 1);

  // ── Abrir ───────────────────────────────────────────────────────────────

  async function abrir(caminho) {
    const minha = ++geracao;
    const item = { nome: nomeDe(caminho), caminho };
    // Até a pasta chegar, a lista é o próprio arquivo: ele já aparece, e o "próximo" espera.
    fila = [item];
    indice = 0;
    pasta = null;
    versaoDaFila++;
    montarTira();
    mostrar(item);

    let r;
    try {
      r = await api(`api/vizinhos?caminho=${encodeURIComponent(caminho)}`);
    } catch (e) {
      if (minha !== geracao) return;
      if (e.status === 404) {
        item.sumiu = true;
        avisar(`${item.nome} não existe mais.`);
      }
      // Qualquer outra falha deixa a Lupa com o arquivo sozinho na lista, e ele continua na tela.
      return;
    }
    if (minha !== geracao || !(r.itens || [])[r.atual]) return;
    fila = r.itens;
    indice = r.atual;
    pasta = r.pasta;
    versaoDaFila++;
    $('btn-grade').hidden = fila.length < 2;
    // O item da lista traz a data e o tamanho; ele passa a ser o da tela, com a mesma imagem.
    atual = fila[indice];
    $('nome').title = atual.caminho;
    pintarNavegacao();
    montarTira();
    if (!$('info').hidden) pintarInfo(atual);
    preCarregar();
  }

  async function escolherArquivo() {
    const p = await vssh.arquivos.escolherArquivo('Abrir na Lupa',
      'Imagens e PDF (*.jpg *.jpeg *.png *.gif *.webp *.avif *.bmp *.ico *.svg '
      + '*.tif *.tiff *.heic *.heif *.pdf);;Tudo (*)',
      atual ? pastaDe(atual.caminho) : undefined);
    if (p) abrir(p);
  }
  $('btn-abrir').addEventListener('click', escolherArquivo);
  $('btn-abrir-inicio').addEventListener('click', escolherArquivo);
  $('btn-anterior').addEventListener('click', anterior);
  $('btn-proximo').addEventListener('click', proximo);

  vssh.arquivos.aoSoltarArquivos((info) => {
    const caminho = (info.caminhos || [])[0];
    if (caminho) abrir(caminho);
  }, { alvo: janela });

  $('btn-imprimir').addEventListener('click', () => {
    if (atual) Promise.resolve(vssh.impressao.imprimir(atual.caminho)).catch(() => {});
  });

  // ── A grade ─────────────────────────────────────────────────────────────
  //
  // A pasta inteira sobre o `TuffMidia.grade`, que desenha só o que está na tela: uma pasta de
  // milhares de fotos abre como uma de dez. O clique abre a imagem, e o Esc volta à grade na mesma
  // altura, com a imagem que estava aberta marcada.

  const TAMANHOS = [100, 140, 180, 240, 320];   // a largura da miniatura; a altura é três quartos dela
  const ESPACO = 8;
  let tamanho = TAMANHOS.includes(lerPref('grade', 180)) ? lerPref('grade', 180) : 180;
  let larguraReal = tamanho;
  let grade = null;
  let versaoDaGrade = -1;
  let rolagem = 0;
  let desdeAGrade = 0;

  // O lado da miniatura pedida ao backend, pelo tamanho do item na tela e pela densidade dela.
  const ladoDaGrade = () => {
    const px = larguraReal * (window.devicePixelRatio || 1);
    return px <= 128 ? 128 : px <= 256 ? 256 : 512;
  };

  // O `tamanho` escolhido diz quantas colunas cabem, e a largura real dos itens estica para as
  // colunas preencherem a grade. Com a largura fixa sobraria uma faixa vazia à direita, de um
  // tamanho diferente a cada largura de janela.
  function justificar() {
    const largura = $('grade').clientWidth;
    if (!grade || !largura) return;
    const colunas = Math.max(1, Math.floor((largura + ESPACO) / (tamanho + ESPACO)));
    const w = Math.floor((largura - ESPACO * (colunas - 1)) / colunas);
    if (w === larguraReal) return;
    larguraReal = w;
    grade.redimensionar(w, Math.round(w * 0.75));
  }
  new ResizeObserver(() => requestAnimationFrame(justificar)).observe($('grade'));

  function montarNaGrade(i, no) {
    const item = fila[i];
    if (!item) return;
    const lado = String(ladoDaGrade());
    const versao = String(item.modificado || '');
    // O mesmo arquivo, na mesma versão, no mesmo nó, com o mesmo lado de miniatura: nada a trocar.
    // É o que impede a grade de piscar inteira a cada largura de janela.
    if (no.dataset.caminho === item.caminho && no.dataset.lado === lado && no.dataset.v === versao) return;
    no.dataset.caminho = item.caminho;
    no.dataset.lado = lado;
    no.dataset.v = versao;
    no.title = item.nome;
    no.setAttribute('aria-label', item.nome);
    no.innerHTML = `<svg class="tuff-ico" aria-hidden="true"><use href="#ico-${ehPdf(item) ? 'pdf' : 'image'}"></use></svg>`;
    pintarMiniatura(no, item, Number(lado), () => no.__indice === i && fila[i] === item);
  }

  function guardarRolagem() { rolagem = $('grade').scrollTop; }

  function mostrarGrade() {
    if (!pasta && fila.length < 2) return;
    gravarGiros();
    modo = 'grade';
    avisar('');
    carregando(false);
    $('inicio').hidden = true;
    $('palco').hidden = true;
    tira.hidden = true;
    $('grade-moldura').hidden = false;
    $('barra').hidden = false;
    $('ferramentas').hidden = true;
    $('btn-grade').hidden = true;
    const dir = pasta || pastaDe(atual.caminho);
    $('nome').textContent = nomeDe(dir) || '/';
    $('nome').title = dir;
    $('posicao').textContent = fila.length === 1 ? '1 item' : `${fila.length} itens`;
    document.title = `${nomeDe(dir) || '/'} — Lupa`;
    vssh.app.lembrarRota(`?pasta=${encodeURIComponent(dir)}`);
    if (!grade || versaoDaGrade !== versaoDaFila) {
      if (grade) grade.destruir();
      larguraReal = tamanho;
      grade = TuffMidia.grade($('grade'), {
        total: fila.length, largura: tamanho, altura: Math.round(tamanho * 0.75), gap: ESPACO,
        montar: montarNaGrade, aoAbrir: abrirDaGrade,
      });
      versaoDaGrade = versaoDaFila;
      rolagem = 0;
    }
    // A grade mede as colunas com ela à vista, a rolagem volta, e só então a imagem aberta é
    // marcada: `selecionar` rola apenas quando o item está fora da tela.
    grade.atualizar(fila.length);
    justificar();
    $('grade').scrollTop = rolagem;
    if (indice >= 0) grade.selecionar(indice);
    $('grade').focus({ preventScroll: true });
  }
  $('btn-grade').addEventListener('click', mostrarGrade);

  function abrirDaGrade(i) {
    if (!fila[i]) return;
    desdeAGrade = performance.now();
    guardarRolagem();
    indice = i;
    mostrar(fila[i]);
  }
  $('grade').addEventListener('click', (e) => {
    const no = e.target.closest('.tuff-miniatura');
    if (no && no.__indice != null) abrirDaGrade(no.__indice);
  });
  // Quem vem do gerenciador de arquivos dá duplo-clique: o primeiro clique abre a imagem, e o
  // segundo cairia no visor, que alterna o zoom. Logo depois de abrir pela grade, ele é engolido.
  $('visor').addEventListener('dblclick', (e) => {
    if (performance.now() - desdeAGrade < 600) e.stopImmediatePropagation();
  }, true);

  // Ctrl e a roda mudam o tamanho das miniaturas, um passo por dente. A pinça do trackpad chega
  // como dezenas de eventos pequenos, e eles se somam até valer um passo.
  let rodaAcumulada = 0;
  $('grade').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    rodaAcumulada += e.deltaY;
    if (Math.abs(rodaAcumulada) < 40) return;
    const i = TAMANHOS.indexOf(tamanho) + (rodaAcumulada < 0 ? 1 : -1);
    rodaAcumulada = 0;
    if (i < 0 || i >= TAMANHOS.length) return;
    tamanho = TAMANHOS[i];
    gravarPref('grade', tamanho);
    justificar();
  }, { passive: false });

  async function abrirPasta(caminho) {
    const minha = ++geracao;
    let r;
    try {
      r = await api(`api/pasta?caminho=${encodeURIComponent(caminho)}`);
    } catch (e) {
      if (minha !== geracao) return;
      telaDoInicio();
      avisar(e.status === 404 ? `${nomeDe(caminho)} não existe mais.` : `A Lupa não conseguiu listar ${nomeDe(caminho)}.`);
      return;
    }
    if (minha !== geracao) return;
    fila = r.itens || [];
    indice = -1;
    atual = null;
    pasta = r.pasta;
    versaoDaFila++;
    montarTira();
    if (!fila.length) {
      telaDoInicio();
      avisar(`${nomeDe(pasta)} não tem imagens nem PDFs.`);
      return;
    }
    mostrarGrade();
  }

  // ── A tira ──────────────────────────────────────────────────────────────

  let observador = null;
  function montarTira() {
    if (observador) observador.disconnect();
    tira.textContent = '';
    // As miniaturas são pedidas quando o item chega perto da parte visível da tira: uma pasta de
    // quinhentas fotos pede as vinte que aparecem, e as outras conforme a pessoa rola.
    observador = new IntersectionObserver(aoVerNaTira, { root: tira, rootMargin: '0px 480px' });
    fila.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tuff-tira-item';
      b.dataset.i = String(i);
      b.title = it.nome;
      b.setAttribute('aria-label', it.nome);
      b.innerHTML = `<svg class="tuff-ico" aria-hidden="true"><use href="#ico-${ehPdf(it) ? 'pdf' : 'image'}"></use></svg>`;
      tira.appendChild(b);
      observador.observe(b);
    });
    pintarTira();
  }

  function pintarTira() {
    const quer = lerPref('tira', true);
    $('btn-tira').setAttribute('aria-pressed', String(quer));
    // Uma pasta de um arquivo só não tem tira: ela mostraria a imagem que já está na tela.
    tira.hidden = !quer || fila.length < 2 || modo !== 'imagem';
    marcarNaTira();
  }
  function alternarTira() {
    gravarPref('tira', !lerPref('tira', true));
    pintarTira();
  }
  $('btn-tira').addEventListener('click', alternarTira);

  function marcarNaTira() {
    for (const b of tira.children) {
      const sim = Number(b.dataset.i) === indice;
      b.setAttribute('aria-selected', String(sim));
      if (sim && !tira.hidden) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }
  tira.addEventListener('click', (e) => {
    const b = e.target.closest('.tuff-tira-item');
    if (b) irPara(Number(b.dataset.i));
  });

  function aoVerNaTira(entradas) {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      observador.unobserve(e.target);
      const item = fila[Number(e.target.dataset.i)];
      if (item) pintarMiniatura(e.target, item);
    }
  }

  /**
   * A miniatura de `item` dentro de `no`. `vale()` confere, na chegada, se o nó ainda é deste item:
   * a grade reaproveita os nós ao rolar, e uma miniatura que chega depois da rolagem pintaria o
   * item errado.
   */
  function pintarMiniatura(no, item, lado = 128, vale = () => true) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    // O ícone do tipo fica até a miniatura chegar.
    img.onload = () => { if (vale()) no.replaceChildren(img); };
    img.onerror = () => { if (vale()) miniaturaNoNavegador(no, item, vale); };
    img.src = `api/miniatura?caminho=${encodeURIComponent(item.caminho)}&lado=${lado}&v=${item.modificado || ''}`;
  }

  async function miniaturaNoNavegador(no, item, vale) {
    // Um PDF sem miniatura do servidor (um protegido por senha, um corrompido) fica com o ícone: o
    // navegador não desenha PDF num `<img>`, e tentar baixaria o arquivo inteiro à toa.
    if (ehPdf(item)) return;
    try {
      const T = await TuffMidia.decodificador();
      if (!T.precisa(item.nome)) {
        // SVG e AVIF: o navegador desenha o próprio arquivo. Um arquivo torto fica com o ícone.
        const img = new Image();
        img.alt = '';
        img.onload = () => { if (vale()) no.replaceChildren(img); };
        img.src = vssh.arquivos.urlFor(item.caminho);
        return;
      }
      const canvas = await umPorVez(() => (vale() ? miniaturaDecodificada(T, item) : null));
      if (canvas && vale()) no.replaceChildren(canvas);
    } catch { /* sem HEVC, ou o arquivo não abre: fica o ícone do tipo */ }
  }

  // Decodificar um TIFF ou HEIC pesa, e a tira pede vários de uma vez: eles entram numa fila e são
  // decodificados um de cada vez.
  let fila1 = Promise.resolve();
  const umPorVez = (fn) => {
    const p = fila1.then(fn, fn);
    fila1 = p.catch(() => {});
    return p;
  };

  async function miniaturaDecodificada(T, item) {
    const chave = new URL(`miniatura-local?${new URLSearchParams({
      caminho: item.caminho, v: String(item.modificado || ''), t: String(item.tamanho || ''),
    })}`, location.href).href;
    let cache = null;
    try {
      cache = await caches.open('lupa-miniaturas');
      const guardada = await cache.match(chave);
      if (guardada) return desenharBlob(await guardada.blob());
    } catch { cache = null; }

    // O teto baixo faz o geotiff reamostrar um TIFF sem níveis para 1 MP, em vez de montar a
    // página inteira num canvas só para reduzi-la.
    const doc = await T.abrir(vssh.arquivos.urlFor(item.caminho), { nome: item.nome, teto: 1 << 20 });
    const fonte = (await doc.miniatura()) || (await doc.desenhar(0)).canvas;
    const pequena = encolher(fonte, 256);
    if (cache) {
      try {
        const blob = await new Promise((ok) => pequena.toBlob(ok, 'image/webp', 0.8));
        if (blob) await cache.put(chave, new Response(blob, { headers: { 'content-type': 'image/webp' } }));
      } catch { /* sem Cache Storage: a miniatura vale para esta sessão */ }
    }
    return pequena;
  }

  function encolher(fonte, lado) {
    const k = Math.min(1, lado / Math.max(fonte.width, fonte.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(fonte.width * k));
    c.height = Math.max(1, Math.round(fonte.height * k));
    c.getContext('2d').drawImage(fonte, 0, 0, c.width, c.height);
    return c;
  }

  async function desenharBlob(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  }

  // ── A ficha ─────────────────────────────────────────────────────────────

  const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const tamanhoLegivel = (b) => (b < 1024 ? `${b} bytes`
    : b < 1024 ** 2 ? `${numero.format(b / 1024)} KB`
    : b < 1024 ** 3 ? `${numero.format(b / 1024 ** 2)} MB`
    : `${numero.format(b / 1024 ** 3)} GB`);
  const dataLegivel = (ms) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' })
    .format(new Date(ms));

  async function pintarInfo(item) {
    let f = {};
    try { f = await api(`api/info?caminho=${encodeURIComponent(item.caminho)}`); } catch { /* fica o que a lista sabe */ }
    // As dimensões de um formato que o Pillow do servidor não abre (HEIC, AVIF, SVG) saem da
    // imagem que a página decodificou.
    if (!f.largura && !ehPdf(item)) {
      try {
        const { elemento } = await carregar(item);
        f.largura = elemento.naturalWidth || elemento.width;
        f.altura = elemento.naturalHeight || elemento.height;
      } catch { /* sem dimensões */ }
    }
    // Um PDF aberto diz as páginas e os metadados dele. A comparação é pelo caminho: o item da tela
    // é trocado pelo da lista quando a pasta chega, com o mesmo arquivo.
    if (ehPdf(item) && visorPdf && visorPdf.doc && visorPdf.item && visorPdf.item.caminho === item.caminho) {
      f.paginas = visorPdf.doc.numPages;
      try {
        const { info } = await visorPdf.doc.getMetadata();
        f.titulo = info && info.Title;
        f.autor = info && info.Author;
      } catch { /* sem metadados */ }
    }
    if (item !== atual) return;
    const exposicao = [f.abertura, f.exposicao, f.iso && `ISO ${f.iso}`, f.focal].filter(Boolean).join(' · ');
    const linhas = [
      ['Nome', item.nome],
      ['Pasta', pastaDe(item.caminho)],
      f.titulo && ['Título', f.titulo],
      f.autor && ['Autor', f.autor],
      f.paginas && ['Páginas', String(f.paginas)],
      f.largura && ['Dimensões', `${f.largura} × ${f.altura} pixels`],
      f.tamanho != null && ['Tamanho', tamanhoLegivel(f.tamanho)],
      f.capturada && ['Capturada', dataLegivel(Date.parse(f.capturada))],
      f.modificado && ['Modificada', dataLegivel(f.modificado)],
      f.camera && ['Câmera', f.camera],
      f.lente && ['Lente', f.lente],
      exposicao && ['Exposição', exposicao],
      f.quadros && ['Quadros', String(f.quadros)],
      f.gps && ['Local', `${f.gps.lat.toLocaleString('pt-BR')}, ${f.gps.lon.toLocaleString('pt-BR')}`],
    ].filter(Boolean);
    $('info-lista').replaceChildren(...linhas.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }));
  }

  function mostrarInfo(sim) {
    $('info').hidden = !sim;
    $('btn-info').setAttribute('aria-pressed', String(sim));
    gravarPref('info', sim);
    if (sim && atual) pintarInfo(atual);
  }
  const alternarInfo = () => mostrarInfo($('info').hidden);
  $('btn-info').addEventListener('click', alternarInfo);

  // ── Tela cheia ──────────────────────────────────────────────────────────

  function telaCheia() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else janela.requestFullscreen().catch(() => {});
  }
  $('btn-tela').addEventListener('click', telaCheia);
  document.addEventListener('fullscreenchange', () => {
    const sim = !!document.fullscreenElement;
    $('btn-tela').querySelector('use').setAttribute('href', sim ? '#ico-fullscreen-exit' : '#ico-fullscreen');
    $('btn-tela').setAttribute('aria-label', sim ? 'Sair da tela cheia' : 'Tela cheia');
    $('btn-tela').dataset.tuffDica = sim ? 'Sair da tela cheia (F)' : 'Tela cheia (F)';
    acordar();
  });

  // Em tela cheia a barra e a tira somem com o ponteiro parado, e nunca com o foco dentro delas:
  // sumir ali deixaria quem usa o teclado sem controle nenhum na tela.
  let ocio = null;
  function acordar() {
    janela.classList.remove('ocioso');
    clearTimeout(ocio);
    if (!document.fullscreenElement) return;
    ocio = setTimeout(() => {
      const foco = document.activeElement;
      if ($('barra').contains(foco) || tira.contains(foco)) acordar();
      else janela.classList.add('ocioso');
    }, 2500);
  }
  janela.addEventListener('pointermove', acordar);

  // ── Teclado ─────────────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    // O visor fica com a tecla quando ela é dele: + e − com o foco nele, e as setas numa imagem
    // ampliada. O que ele deixa passar chega aqui.
    if (e.defaultPrevented) return;
    // Ctrl+F num PDF abre a busca da Lupa, que alcança as páginas ainda não desenhadas; a do
    // navegador só acharia o texto das que estão na tela. F3 anda pelas ocorrências.
    if (modo === 'imagem' && noPdf()) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        abrirBusca();
        return;
      }
      if (e.key === 'F3' && !$('busca').hidden) {
        e.preventDefault();
        buscar('again', e.shiftKey);
        return;
      }
    }
    const alvo = e.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Na grade, as setas, Home, End e Enter são dela; daqui só vem a tela cheia.
    if (modo === 'grade') {
      if (e.key === 'f') { e.preventDefault(); telaCheia(); }
      return;
    }
    if (modo !== 'imagem' || !atual) return;
    // Esc volta à grade. Em tela cheia o Esc é do navegador, que sai dela.
    if (e.key === 'Escape') {
      if (!document.fullscreenElement && (pasta || fila.length > 1)) { e.preventDefault(); mostrarGrade(); }
      return;
    }
    // Num PDF, Home e End vão à primeira e à última página, e ← → só trocam de arquivo quando a
    // página não rola na horizontal: ampliada, a seta anda por ela, como a rolagem nativa faz.
    const pdf = noPdf();
    const rolagem = $('pdf-rolagem');
    if (pdf && /^Arrow(Left|Right)$/.test(e.key) && rolagem.scrollWidth > rolagem.clientWidth + 1) return;
    const teclas = {
      ArrowLeft: anterior,
      ArrowRight: proximo,
      Home: pdf ? () => irPaginaPdf(1) : () => irPara(0),
      End: pdf ? () => irPaginaPdf(visorPdf.doc.numPages) : () => irPara(fila.length - 1),
      f: telaCheia,
      i: alternarInfo,
      t: alternarTira,
      r: () => girar(1),
      R: () => girar(-1),
      '+': ampliar,
      '=': ampliar,
      '-': reduzir,
      0: caber,
      1: umPorUm,
    };
    const fn = teclas[e.key];
    if (!fn) return;
    // Espaço e Enter num botão já o acionam; as outras teclas valem em qualquer lugar da janela.
    e.preventDefault();
    fn();
  });

  // ── A porta de entrada ──────────────────────────────────────────────────

  // Uma pasta aberta na Lupa (o "Abrir com" de uma pasta) começa pela grade.
  vssh.app.ao('abertura', (ctx) => {
    if (!ctx || !ctx.caminho) return;
    if (ctx.tipo === 'pasta') abrirPasta(ctx.caminho);
    else abrir(ctx.caminho);
  });

  mostrarInfo(lerPref('info', false) === true);
  const rota = new URLSearchParams(location.search);
  if (rota.get('pasta')) abrirPasta(rota.get('pasta'));
  else if (rota.get('caminho')) abrir(rota.get('caminho'));
  else telaDoInicio();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', montarLupa, { once: true });
} else {
  montarLupa();
}
