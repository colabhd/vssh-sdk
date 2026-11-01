'use strict';

// Tuff: os ícones.
//
// Expõe `window.TuffIcones` e instala o sprite no documento sozinho:
//
//     <svg class="tuff-ico"><use href="#ico-folder"></use></svg>
//     TuffIcones.svg('folder')            a mesma marcação, como string
//     TuffIcones.tem('folder')            existe?
//     TuffIcones.nomes()                  todos, para uma galeria
//
// ─── De onde vem, e quem lê ─────────────────────────────────────────────────
//
// Os glifos são os do sprite do shell, e este arquivo é a fonte dele: o `index.html` do shell o
// carrega como primeiro script do `<body>`, e o sprite entra no documento ali, antes de qualquer
// `<use>`. Um app o recebe como `_sdk/tuff/tuff-icones.js` e ganha o mesmo sprite no documento
// dele, com os mesmos ids. A biblioteca de componentes do toolkit de apps
// (`vssh-app-toolkit/lib/web/tuff/`) é de onde a forma veio: um sprite que viaja em JavaScript,
// porque um `<use>` não atravessa documentos e um app roda noutro documento.
//
// As alternativas caem: `<use href="arquivo.svg#ico-x">` (referência externa) depende de CORS, tem
// histórico irregular entre navegadores e não herda `currentColor` de forma confiável, e um ícone
// que não acompanha a cor do texto é meio ícone; uma fonte de ícones renderiza texto onde deveria
// haver desenho.
//
// ─── O modo de falha que decide tudo ────────────────────────────────────────
//
// Um `<use href>` que não resolve não lança. Ele só não desenha, e um botão com um quadrado vazio
// de 14×14 fica meses na tela sem uma linha no console. Por isso `TuffIcones.svg()` avisa no
// console quando o nome não existe, e por isso `tests/unit/sprite-icons.test.js` recusa qualquer
// `#ico-…` pedido pelo shell que não esteja aqui.

(function () {

  /** Do id sem o prefixo `ico-` ao `<symbol>` inteiro. */
  const SIMBOLOS = {

  // ── Os que o shell pede ───────────────────────────────────────────────────
  //
  // Os 66 primeiros são o sprite do ambiente: barra de tarefas, menus, gerenciador de arquivos,
  // Configurações e a central de mídia os pedem por `<use href="#ico-…">`. O traço é um só, 1,5, e
  // o centro da caixa de cada glifo fica a meio pixel do centro do quadro (o play e o pular, que
  // apontam para um lado, ficam no centro óptico). Os sólidos são os que nascem cheios: `more`,
  // `audio`, os de transporte e as aspas, que vazadas viram um 6.
  'folder':
    '<symbol id="ico-folder" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.25v4.25a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6.25a1 1 0 0 0-1-1H7.5L6 3.75H3a1 1 0 0 0-1 1v2.5z"/></symbol>',
  'folder-plus':
    '<symbol id="ico-folder-plus" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6.75v-.5a1 1 0 0 0-1-1H7.5L6 3.75H3a1 1 0 0 0-1 1v6.75a1 1 0 0 0 1 1h5.5"/><path d="M12 8.75v4M10 10.75h4"/></symbol>',
  'drive':
    '<symbol id="ico-drive" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5"/><path d="M1.75 9h12.5"/><path d="M4.5 11h.01M6.75 11h.01"/></symbol>',
  'server':
    '<symbol id="ico-server" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="4.5" rx="1"/><rect x="2" y="9" width="12" height="4.5" rx="1"/><path d="M4.5 4.75h.01M4.5 11.25h.01"/></symbol>',
  'folder-open':
    '<symbol id="ico-folder-open" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5L3.5 12.5h9L14 7.5H7.5L6 6H3a1 1 0 0 0-1 1v.5z"/><path d="M2 7.5v-2a1 1 0 0 1 1-1h3L7.5 6h6"/></symbol>',

  // No gerenciador de arquivos, a nuvem é uma pasta de rede: o símbolo que diz "isto não está
  // neste servidor" sem legenda. O cadeado logo abaixo é o estado `precisaSenha` da pasta de rede,
  // "falta a senha para abrir", que sai da sonda.
  'cloud':
    '<symbol id="ico-cloud" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 12.5h6.65a2.75 2.75 0 0 0 .45-5.46A3.75 3.75 0 0 0 4.5 6.55 3 3 0 0 0 4.6 12.5z"/></symbol>',
  'lock':
    '<symbol id="ico-lock" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7"/></symbol>',
  'file':
    '<symbol id="ico-file" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.75h5.75L13 5v8.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z"/><path d="M9.75 1.75V5H13"/></symbol>',
  'file-code':
    '<symbol id="ico-file-code" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.75h5.75L13 5v8.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z"/><path d="M9.75 1.75V5H13"/><path d="M6.5 8.25L5 9.75l1.5 1.5M9.5 8.25l1.5 1.5-1.5 1.5"/></symbol>',
  'terminal':
    '<symbol id="ico-terminal" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5L7 8 2.5 11.5"/><path d="M9.5 12h4"/></symbol>',
  'settings':
    '<symbol id="ico-settings" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 3.37 6.74 1.52h2.52l.34 1.85 1.61.93 1.77-.63 1.26 2.18-1.43 1.22v1.86l1.43 1.22-1.26 2.18-1.77-.63-1.61.93-.34 1.85H6.74l-.34-1.85-1.61-.93-1.77.63-1.26-2.18 1.43-1.22V7.07L1.76 5.85l1.26-2.18 1.77.63z"/><circle cx="8" cy="8" r="2.25"/></symbol>',
  'search':
    '<symbol id="ico-search" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M11 11L14.5 14.5"/></symbol>',
  'refresh':
    '<symbol id="ico-refresh" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"/><path d="M12.4 1.4v3.2H9.2"/></symbol>',
  'cut':
    '<symbol id="ico-cut" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/><path d="M6 10 12.5 2.5M10 10 3.5 2.5"/></symbol>',
  'copy':
    '<symbol id="ico-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="8" height="9" rx="1"/><path d="M6 5V3.5A1.5 1.5 0 0 1 7.5 2H12.5A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H10"/></symbol>',
  'paste':
    '<symbol id="ico-paste" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H10.5"/><path d="M5.5 1.5H10.5V4H5.5V1.5z"/><path d="M5.5 8.5h5M5.5 11h3.5"/></symbol>',
  'trash':
    '<symbol id="ico-trash" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11"/><path d="M5.5 4.5V3a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v1.5"/><path d="M3.5 4.5L4.5 13.5h7l1-9"/></symbol>',
  'edit':
    '<symbol id="ico-edit" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3-9 9H2v-3L11 2z"/><path d="M9 4l3 3"/></symbol>',
  'minimize':
    '<symbol id="ico-minimize" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8h10"/></symbol>',
  'maximize':
    '<symbol id="ico-maximize" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10" rx="1"/></symbol>',
  'close':
    '<symbol id="ico-close" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3L13 13M13 3L3 13"/></symbol>',
  'pin':
    '<symbol id="ico-pin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.25 1.75h5.5"/><path d="M6.25 1.75v3.5L4.25 8.5h7.5l-2-3.25v-3.5"/><path d="M8 8.5v5.75"/></symbol>',
  'plus':
    '<symbol id="ico-plus" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2.5V13.5M2.5 8H13.5"/></symbol>',

  // `minus` é o par de `plus`, e é o que "Diminuir Fonte" desenha nos menus do terminal e do editor.
  'minus':
    '<symbol id="ico-minus" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 8H13.5"/></symbol>',
  'check':
    '<symbol id="ico-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path pathLength="1" d="M2 8.5L5.5 12 14 4.5"/></symbol>',
  'print':
    '<symbol id="ico-print" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6V2.25h8V6"/><path d="M4 11.5H3a1.25 1.25 0 0 1-1.25-1.25v-3A1.25 1.25 0 0 1 3 6h10a1.25 1.25 0 0 1 1.25 1.25v3A1.25 1.25 0 0 1 13 11.5h-1"/><rect x="4" y="9" width="8" height="4.75" rx=".5"/></symbol>',

  // O sino do centro de notificações, e o par com o sino cortado logo abaixo.
  'bell':
    '<symbol id="ico-bell" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8a4.2 4.2 0 0 0-4.2 4.2c0 3.3-1.3 4.4-1.3 4.4h11c0 0-1.3-1.1-1.3-4.4A4.2 4.2 0 0 0 8 1.8z"/><path d="M6.6 12.8a1.6 1.6 0 0 0 2.8 0"/></symbol>',
  'info':
    '<symbol id="ico-info" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.5V11.5M8 5V5.5"/></symbol>',
  'warning':
    '<symbol id="ico-warning" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5L14.5 13.5H1.5L8 1.5z"/><path d="M8 6.5V9.5M8 11V12"/></symbol>',
  'download':
    '<symbol id="ico-download" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><g class="tuff-ico-seta"><path d="M8 2V11M5 8l3 3 3-3"/></g><path d="M2.5 13.5h11"/></symbol>',
  'home':
    '<symbol id="ico-home" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7L8 2l5.5 5V14H10v-4H6v4H2.5V7z"/></symbol>',
  'arrow-left':
    '<symbol id="ico-arrow-left" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3L5 8l5.5 5"/></symbol>',
  'arrow-right':
    '<symbol id="ico-arrow-right" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3L11 8 5.5 13"/></symbol>',
  'upload':
    '<symbol id="ico-upload" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V4M5 7l3-3 3 3M2.5 13.5h11"/></symbol>',
  'external':
    '<symbol id="ico-external" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v4M14 2l-6 6"/><path d="M7 4H3.5A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h7A1.5 1.5 0 0 0 12 12.5V9"/></symbol>',
  'more':
    '<symbol id="ico-more" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12" cy="8" r="1.3"/></symbol>',
  'grid':
    '<symbol id="ico-grid" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1"/><rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1"/><rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1"/><rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1"/></symbol>',
  'image':
    '<symbol id="ico-image" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><circle cx="5.5" cy="6.25" r="1.25" fill="currentColor" stroke="none"/><path d="M1.75 11.25l3.5-3.5 3 3 2-2 4 4"/></symbol>',
  'video':
    '<symbol id="ico-video" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="4" width="9" height="8" rx="1.5"/><path d="M10.75 7.25l3.5-2v5.5l-3.5-2z" fill="currentColor"/></symbol>',
  'audio':
    '<symbol id="ico-audio" viewBox="0 0 16 16" fill="currentColor"><circle cx="4.5" cy="11.5" r="2" opacity=".9"/><circle cx="11.5" cy="9.5" r="2" opacity=".9"/><path d="M6.5 11.5V4.5l7-1.5v5.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></symbol>',
  'archive':
    '<symbol id="ico-archive" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="2.25" width="12.5" height="3.5" rx="1"/><path d="M2.75 5.75v6.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-6.5"/><path d="M6.5 8.75h3"/></symbol>',
  'pdf':
    '<symbol id="ico-pdf" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.75h5.75L13 5v8.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z"/><path d="M9.75 1.75V5H13"/><path d="M5.25 12.25c1.1-1.4 2.3-3.6 2.45-5.3.05-.75-.75-.85-.85-.15-.25 1.75 1.85 3.9 3.65 4.4.75.2.85-.55.15-.75-1.4-.4-3.6.1-5.4 1.8z" stroke-width="1.1"/></symbol>',
  'palette':
    '<symbol id="ico-palette" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.75a6.25 6.25 0 0 0 0 12.5c.9 0 1.5-.6 1.5-1.4 0-.45-.2-.75-.4-1.05-.2-.3-.35-.55-.35-.95 0-.85.65-1.5 1.5-1.5h1.4a2.6 2.6 0 0 0 2.6-2.6c0-2.75-2.8-5-6.25-5z"/><circle cx="4.9" cy="7.6" r=".95" fill="currentColor" stroke="none"/><circle cx="6.6" cy="4.7" r=".95" fill="currentColor" stroke="none"/><circle cx="9.9" cy="4.8" r=".95" fill="currentColor" stroke="none"/></symbol>',
  'globe':
    '<symbol id="ico-globe" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M8 1.75c-1.9 1.75-2.75 3.85-2.75 6.25s.85 4.5 2.75 6.25c1.9-1.75 2.75-3.85 2.75-6.25S9.9 3.5 8 1.75z"/><path d="M1.75 8h12.5"/></symbol>',
  'volume-off':
    '<symbol id="ico-volume-off" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5L5 6H2.5v4H5l3 3V3.5z"/><path d="M11 6.5l2.5 3M13.5 6.5L11 9.5"/></symbol>',
  'volume-on':
    '<symbol id="ico-volume-on" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5L5 6H2.5v4H5l3 3V3.5z"/><path d="M11 5.5c.9.8 1.5 1.8 1.5 2.5s-.6 1.7-1.5 2.5"/></symbol>',

  // O nível intermediário: só com dois ícones, o botão da barra dizia "tem som" ou "não tem", e a
  // diferença entre 15% e 100% ficava invisível até abrir o painel.
  'volume-low':
    '<symbol id="ico-volume-low" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5L5 6H2.5v4H5l3 3V3.5z"/><path d="M10.75 6.5c.5.45.75.95.75 1.5s-.25 1.05-.75 1.5"/></symbol>',

  // A bateria do aparelho, na bandeja: três níveis de carga e o raio de quando está na tomada.
  'bateria-cheia':
    '<symbol id="ico-bateria-cheia" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4.5" width="11.5" height="7" rx="1.5"/><path d="M14.5 6.75v2.5"/><rect x="3.25" y="6.25" width="8" height="3.5" rx=".5" fill="currentColor" stroke="none"/></symbol>',
  'bateria-media':
    '<symbol id="ico-bateria-media" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4.5" width="11.5" height="7" rx="1.5"/><path d="M14.5 6.75v2.5"/><rect x="3.25" y="6.25" width="4.5" height="3.5" rx=".5" fill="currentColor" stroke="none"/></symbol>',
  'bateria-baixa':
    '<symbol id="ico-bateria-baixa" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4.5" width="11.5" height="7" rx="1.5"/><path d="M14.5 6.75v2.5"/><rect x="3.25" y="6.25" width="1.75" height="3.5" rx=".5" fill="currentColor" stroke="none"/></symbol>',
  'bateria-carregando':
    '<symbol id="ico-bateria-carregando" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4.5" width="11.5" height="7" rx="1.5"/><path d="M14.5 6.75v2.5"/><path d="M8 6 6.25 8.25h2.5L7 10.25" stroke-width="1.25"/></symbol>',

  // "Sessão remota" no mixer de volume: a linha do stream do motor X11, que não é app nem aba.
  'monitor':
    '<symbol id="ico-monitor" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M6 14h4M8 11.5V14"/></symbol>',
  // O celular ou o tablet de quem usa, no diagrama da conexão da Ajuda, ao lado do monitor.
  'smartphone':
    '<symbol id="ico-smartphone" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="1.5" width="8" height="13" rx="1.5"/><path d="M7.25 12h1.5"/></symbol>',
  // Janela sobre janela: a sessão de aplicativos nativos (o motor X11), que traz as janelas do
  // servidor para dentro do ambiente. O monitor ao lado é a tela inteira; este é o que se abre nela.
  'janelas':
    '<symbol id="ico-janelas" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.25 5.5V3.25a1 1 0 0 1 1-1h7.25a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1h-2.25M5.25 4.75h9.25"/><rect x="1.5" y="6" width="9.5" height="7.75" rx="1"/><path d="M1.5 8.5h9.5"/></symbol>',
  'keyboard':
    '<symbol id="ico-keyboard" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4.5" width="13" height="7" rx="1.5"/><path d="M4 7.5h.01M7 7.5h.01M10 7.5h.01M13 7.5h.01M5.5 9.5h5"/></symbol>',
  'layout':
    '<symbol id="ico-layout" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6.5H3a1.5 1.5 0 0 0-1.5 1.5v4.5A1.5 1.5 0 0 0 3 14h10a1.5 1.5 0 0 0 1.5-1.5V10"/><path d="M4.25 9.25h.01M7 9.25h.01M5 11.75h5"/><circle cx="12.5" cy="4.25" r="2.75"/><path d="M9.75 4.25h5.5M12.5 1.5c-.75.8-1.1 1.7-1.1 2.75s.35 1.95 1.1 2.75c.75-.8 1.1-1.7 1.1-2.75S13.25 2.3 12.5 1.5z" stroke-width="1"/></symbol>',
  'tiling':
    '<symbol id="ico-tiling" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6.5 2.5v11"/><rect x="1.5" y="2.5" width="5" height="11" rx="1.5" fill="currentColor" stroke="none" opacity=".35"/></symbol>',
  'fullscreen':
    '<symbol id="ico-fullscreen" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></symbol>',
  'fullscreen-exit':
    '<symbol id="ico-fullscreen-exit" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></symbol>',
  'menu':
    '<symbol id="ico-menu" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></symbol>',

  // O chevron para baixo, e os quatro `bar-*`: a posição da barra de tarefas, desenhada como uma
  // barra em vez de uma seta, que é o que faz o controle segmentado se explicar sem rótulo.
  'chevron-down':
    '<symbol id="ico-chevron-down" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6L8 10.5 12.5 6"/></symbol>',
  'clock':
    '<symbol id="ico-clock" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/></symbol>',
  'bell-off':
    '<symbol id="ico-bell-off" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3.3A4 4 0 0 1 12 6c0 3 1 4 1 4H6.5"/><path d="M4 4.6C3.7 5 3.5 5.5 3.5 6c0 3-1 4-1 4h7"/><path d="M6.6 13a1.8 1.8 0 0 0 2.8 0"/><path d="M2.2 2.2l11.6 11.6"/></symbol>',
  // O Não perturbe, na central: a lua de quem não quer ser chamado agora.
  'moon':
    '<symbol id="ico-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 9.8A5.6 5.6 0 0 1 6.2 2.8a5.6 5.6 0 1 0 7 7z"/></symbol>',
  'power':
    '<symbol id="ico-power" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v6"/><path d="M12 4.2a5.5 5.5 0 1 1-8 0"/></symbol>',
  'cpu':
    '<symbol id="ico-cpu" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="7" height="7" rx="1"/><path d="M6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14"/></symbol>',

  // O Chaveiro: uma credencial de app é uma chave; a seção de atalho em Configurações usa o escudo.
  'key':
    '<symbol id="ico-key" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.25" cy="10.75" r="3"/><path d="M7.4 8.6 13.5 2.5M11 5l2 2M9.25 6.75l2 2"/></symbol>',
  'shield':
    '<symbol id="ico-shield" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.75 13 3.5v4.25c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V3.5L8 1.75z"/></symbol>',
  'bar-bottom':
    '<symbol id="ico-bar-bottom" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="1.5" y="10.5" width="13" height="3" rx="1" fill="currentColor" stroke="none"/></symbol>',
  'bar-top':
    '<symbol id="ico-bar-top" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="1.5" y="2.5" width="13" height="3" rx="1" fill="currentColor" stroke="none"/></symbol>',
  'bar-left':
    '<symbol id="ico-bar-left" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="1.5" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" stroke="none"/></symbol>',
  'bar-right':
    '<symbol id="ico-bar-right" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="11" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" stroke="none"/></symbol>',

  // ── Transporte de mídia ───────────────────────────────────────────────────
  //
  // A central de mídia do shell e o player de um app mostram o mesmo controle com o mesmo glifo.
  // `skip-*` é "outra faixa"; `voltar-10` e `avancar-10` são "dez segundos", outro gesto e o mais
  // repetido ao rever um trecho, e o número embaixo da seta é o que os distingue do vizinho. Ele
  // tem seis pixels de altura, o mínimo para ler o 10 a 16 px.
  'play':
    '<symbol id="ico-play" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2.75v10.5l8.5-5.25z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></symbol>',
  'pause':
    '<symbol id="ico-pause" viewBox="0 0 16 16" fill="currentColor"><rect x="4.25" y="3" width="2.75" height="10" rx=".75"/><rect x="9" y="3" width="2.75" height="10" rx=".75"/></symbol>',
  'stop':
    '<symbol id="ico-stop" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.25"/></symbol>',
  'skip-back':
    '<symbol id="ico-skip-back" viewBox="0 0 16 16" fill="currentColor"><path d="M12.75 3.25v9.5L5.75 8z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><rect x="3.25" y="3" width="1.75" height="10" rx=".6"/></symbol>',
  'skip-forward':
    '<symbol id="ico-skip-forward" viewBox="0 0 16 16" fill="currentColor"><path d="M3.25 3.25v9.5L10.25 8z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><rect x="11" y="3" width="1.75" height="10" rx=".6"/></symbol>',
  'voltar-10':
    '<symbol id="ico-voltar-10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5.5A5.5 5.5 0 0 0 3.6 3.6"/><path d="M3.25 1.25v2.6h2.6"/><path d="M4.25 8.75l1.25-.75v6"/><rect x="8.5" y="8" width="3.5" height="6" rx="1.75"/></symbol>',
  'avancar-10':
    '<symbol id="ico-avancar-10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5a5.5 5.5 0 0 1 9.4-1.9"/><path d="M12.75 1.25v2.6h-2.6"/><path d="M4.25 8.75l1.25-.75v6"/><rect x="8.5" y="8" width="3.5" height="6" rx="1.75"/></symbol>',

  // ── O que um player completo e um visualizador de imagens pedem ───────────
  //
  // `repeat-one` existe porque repetir é tri-estado (desligado, tudo, uma), e três estados não
  // cabem num glifo só com uma cor. `chevron-up` é o par de `chevron-down`; as setas horizontais se
  // chamam `arrow-left`/`arrow-right`, e o desenho é o mesmo chevron. Não há `cast`: um ícone sem
  // consumidor é a mesma dívida de uma classe CSS que não estiliza nada.
  'pip':
    '<symbol id="ico-pip" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1"/><rect x="8" y="7.9" width="4.4" height="3.4" rx=".6"/></symbol>',
  'subtitles':
    '<symbol id="ico-subtitles" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M4.25 8.25h3.5M9.25 8.25h2.5M4.25 10.75h7.5"/></symbol>',
  'speed':
    '<symbol id="ico-speed" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.25 11.25a5.75 5.75 0 1 1 11.5 0"/><path d="M8 11.25l3-3.5"/><path d="M4.1 7.2l.9.6M8 5.5v1M11.9 7.2l-.9.6"/><circle cx="8" cy="11.25" r="1" fill="currentColor" stroke="none"/></symbol>',
  'repeat':
    '<symbol id="ico-repeat" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5L14 4l-2.5 2.5"/><path d="M2 7.25v-.5A2.75 2.75 0 0 1 4.75 4H14"/><path d="M4.5 14.5L2 12l2.5-2.5"/><path d="M14 8.75v.5A2.75 2.75 0 0 1 11.25 12H2"/></symbol>',
  'repeat-one':
    '<symbol id="ico-repeat-one" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5L14 4l-2.5 2.5"/><path d="M2 7.25v-.5A2.75 2.75 0 0 1 4.75 4H14"/><path d="M4.5 14.5L2 12l2.5-2.5"/><path d="M14 8.75v.5A2.75 2.75 0 0 1 11.25 12H2"/><path d="M7.25 7.1l1-.6v3.25"/></symbol>',
  'shuffle':
    '<symbol id="ico-shuffle" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12h.9c.9 0 1.7-.4 2.2-1.1l4-5.8c.5-.7 1.3-1.1 2.2-1.1h3.7"/><path d="M12 1.5l2.5 2.5L12 6.5"/><path d="M1.5 4h1.3c1 0 1.9.6 2.4 1.5"/><path d="M14.5 12h-3.9c-.9 0-1.7-.5-2.2-1.2l-.35-.5"/><path d="M12 9.5l2.5 2.5-2.5 2.5"/></symbol>',
  'zoom-in':
    '<symbol id="ico-zoom-in" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3.5 3.5"/><path d="M7 5.2v3.6M5.2 7h3.6"/></symbol>',
  'zoom-out':
    '<symbol id="ico-zoom-out" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3.5 3.5"/><path d="M5.2 7h3.6"/></symbol>',
  // O tamanho do texto é a letra com menos e mais, e não a lupa: a lupa é a busca, e as duas ficam
  // lado a lado na barra da Ajuda.
  'texto-menor':
    '<symbol id="ico-texto-menor" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.75 13 5.5 3.5 9.25 13M3.1 9.6h4.8"/><path d="M11 6h3.5"/></symbol>',
  'texto-maior':
    '<symbol id="ico-texto-maior" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.75 13 5.5 3.5 9.25 13M3.1 9.6h4.8"/><path d="M11 6h3.5M12.75 4.25v3.5"/></symbol>',
  'fit':
    '<symbol id="ico-fit" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.75 5V3.25a1.5 1.5 0 0 1 1.5-1.5H5M11 1.75h1.75a1.5 1.5 0 0 1 1.5 1.5V5M14.25 11v1.75a1.5 1.5 0 0 1-1.5 1.5H11M5 14.25H3.25a1.5 1.5 0 0 1-1.5-1.5V11"/><rect x="5" y="5.5" width="6" height="5" rx="1"/></symbol>',
  'rotate-left':
    '<symbol id="ico-rotate-left" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9"/><path d="M2.2 3.2v3.3h3.3"/></symbol>',
  'rotate-right':
    '<symbol id="ico-rotate-right" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 8a5.4 5.4 0 1 1-1.7-3.9"/><path d="M13.8 3.2v3.3h-3.3"/></symbol>',
  'crop':
    '<symbol id="ico-crop" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 1.6v9.8h9.8"/><path d="M1.6 4.6h9.8v9.8"/></symbol>',
  'eye':
    '<symbol id="ico-eye" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S3.9 4 8 4s6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z"/><circle cx="8" cy="8" r="1.8"/></symbol>',
  'eye-off':
    '<symbol id="ico-eye-off" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 4.2A6.7 6.7 0 0 1 8 4c4.1 0 6.5 4 6.5 4a12.4 12.4 0 0 1-2.1 2.5M4.2 5.4A12.3 12.3 0 0 0 1.5 8s2.4 4 6.5 4c.8 0 1.6-.15 2.3-.4"/><path d="M2 2l12 12"/></symbol>',
  'chevron-up':
    '<symbol id="ico-chevron-up" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10L8 5.5l4.5 4.5"/></symbol>',
  'star':
    '<symbol id="ico-star" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2l1.8 3.75 4.05.58-2.93 2.9.7 4.15L8 11.62l-3.62 1.98.7-4.15L2.15 6.53l4.05-.58z"/></symbol>',
  'check-circle':
    '<symbol id="ico-check-circle" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5.4 8.2l1.9 1.9 3.4-3.7"/></symbol>',
  'x-circle':
    '<symbol id="ico-x-circle" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M6.1 6.1l3.8 3.8M9.9 6.1l-3.8 3.8"/></symbol>',
  'help':
    '<symbol id="ico-help" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M6.35 6.3a1.7 1.7 0 1 1 2.3 1.7c-.5.2-.65.6-.65 1v.25"/><path d="M8 11.7h.01"/></symbol>',
  'filter':
    '<symbol id="ico-filter" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 3.2h11.6l-4.55 5.35v4.05l-2.5 1.2V8.55z"/></symbol>',
  'list':
    '<symbol id="ico-list" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><path d="M2.6 4h.01M2.6 8h.01M2.6 12h.01"/></symbol>',
  'columns':
    '<symbol id="ico-columns" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.2" width="12" height="9.6" rx="1"/><path d="M8 3.2v9.6"/></symbol>',
  'tag':
    '<symbol id="ico-tag" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.9H13a1 1 0 0 1 1 1v4.5a1 1 0 0 1-.3.7l-5.6 5.6a1 1 0 0 1-1.4 0L2.3 9.3a1 1 0 0 1 0-1.4l5.5-5.6a1 1 0 0 1 .7-.4z"/><path d="M11 5h.01"/></symbol>',
  'calendar':
    '<symbol id="ico-calendar" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.4" width="12" height="10.6" rx="1"/><path d="M2 6.6h12M5.4 1.9v3M10.6 1.9v3"/></symbol>',
  'link':
    '<symbol id="ico-link" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.7 9.3a2.9 2.9 0 0 0 4.1 0l1.9-1.9a2.9 2.9 0 1 0-4.1-4.1l-1 1"/><path d="M9.3 6.7a2.9 2.9 0 0 0-4.1 0L3.3 8.6a2.9 2.9 0 1 0 4.1 4.1l1-1"/></symbol>',
  'share':
    '<symbol id="ico-share" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11.8" cy="3.6" r="1.9"/><circle cx="4.2" cy="8" r="1.9"/><circle cx="11.8" cy="12.4" r="1.9"/><path d="M5.9 7.05l4.2-2.5M5.9 8.95l4.2 2.5"/></symbol>',
  'save':
    '<symbol id="ico-save" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.6a1 1 0 0 1 1-1h7.1L13.5 5.5v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M5.2 2.6v3.6h5.4V2.6"/><path d="M5.2 13.5V9.6h5.6v3.9"/></symbol>',
  'drag':
    '<symbol id="ico-drag" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 4h.01M9.8 4h.01M6.2 8h.01M9.8 8h.01M6.2 12h.01M9.8 12h.01"/></symbol>',

  // ── Edição de texto, comentários e pessoas ────────────────────────────────
  //
  // O que um app que edita um documento junto com outras pessoas pede: o desfazer e o refazer, os
  // blocos de um texto acadêmico (lista, citação, tabela, equação, nota de rodapé, título,
  // parágrafo, remissão), a estrutura e os dados do documento, o comentário e a resposta, as
  // pessoas, as páginas da prévia e a edição sem conexão. O traço é o mesmo dos outros, 1,5 com
  // pontas redondas.
  'undo':
    '<symbol id="ico-undo" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H6.5"/></symbol>',
  'redo':
    '<symbol id="ico-redo" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3.5"/></symbol>',
  'list-bullet':
    '<symbol id="ico-list-bullet" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4h7M6.5 8h7M6.5 12h7"/><circle cx="3" cy="4" r=".6" fill="currentColor"/><circle cx="3" cy="8" r=".6" fill="currentColor"/><circle cx="3" cy="12" r=".6" fill="currentColor"/></symbol>',
  'list-num':
    '<symbol id="ico-list-num" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h6.5M7 8h6.5M7 12h6.5"/><path d="M2.5 3l1-.5v3" stroke-width="1.2"/><path d="M2.3 10.3a.9.9 0 0 1 1.7.3c0 .7-1.7 1.4-1.7 2h1.8" stroke-width="1.2"/></symbol>',
  'quote':
    '<symbol id="ico-quote" viewBox="0 0 16 16" fill="currentColor"><path d="M2.35 10.25C2.35 7.5 3.65 5.35 6.2 4.1L6.75 4.95C5.15 5.95 4.4 6.95 4.25 8.02A2.25 2.25 0 1 1 2.35 10.25Z"/><path d="M8.65 10.25C8.65 7.5 9.95 5.35 12.5 4.1L13.05 4.95C11.45 5.95 10.7 6.95 10.55 8.02A2.25 2.25 0 1 1 8.65 10.25Z"/></symbol>',
  'table':
    '<symbol id="ico-table" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.5h12M2 9.75h12M6.5 6.5v6.5"/></symbol>',
  'sigma':
    '<symbol id="ico-sigma" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5H4l4.25 4.5L4 12.5h8"/></symbol>',
  'footnote':
    '<symbol id="ico-footnote" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5h6M2.5 9h9M2.5 13h11"/><path d="M11.5 3l1.2-.8v3.8" stroke-width="1.2"/></symbol>',
  'book':
    '<symbol id="ico-book" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5V3.5A1.5 1.5 0 0 1 4.5 2H13v9.5H4.5A1.5 1.5 0 0 0 3 13a1.5 1.5 0 0 0 1.5 1.5H13"/><path d="M6 5h4"/></symbol>',
  'comment':
    '<symbol id="ico-comment" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v7.5H7.5l-3 2.5V11h-2z"/></symbol>',
  'users':
    '<symbol id="ico-users" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5.5" r="2.25"/><path d="M1.75 13c0-2.2 1.9-3.6 4.25-3.6s4.25 1.4 4.25 3.6"/><path d="M10.75 3.4a2.2 2.2 0 0 1 0 4.2"/><path d="M12.2 9.6c1.3.4 2.05 1.6 2.05 3.4"/></symbol>',
  'outline':
    '<symbol id="ico-outline" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11M5 8h8.5M7.5 12.5h6"/></symbol>',
  'form':
    '<symbol id="ico-form" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2.5h5"/><rect x="2" y="4.25" width="12" height="3.25" rx="1"/><path d="M2.5 9.75h5"/><rect x="2" y="11.5" width="12" height="3.25" rx="1"/></symbol>',
  'heading':
    '<symbol id="ico-heading" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3v10M3.5 8h6M9.5 3v10"/><path d="M12 9.5l1.25-.8V13" stroke-width="1.2"/></symbol>',
  'paragraph':
    '<symbol id="ico-paragraph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M2.5 7h11M2.5 10h11M2.5 13h7"/></symbol>',
  'crossref':
    '<symbol id="ico-crossref" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="1.75" width="6" height="5" rx="1"/><rect x="8.25" y="9.25" width="6" height="5" rx="1"/><path d="M4.75 6.75v3.75A1.25 1.25 0 0 0 6 11.75h1.75"/><path d="M6.5 10.25l1.5 1.5-1.5 1.5"/></symbol>',
  'reply':
    '<symbol id="ico-reply" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4L2.5 7.5 6 11"/><path d="M2.5 7.5H9a4 4 0 0 1 4 4v1"/></symbol>',
  'cloud-off':
    '<symbol id="ico-cloud-off" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 12.5h6.65a2.75 2.75 0 0 0 .45-5.46A3.75 3.75 0 0 0 4.5 6.55 3 3 0 0 0 4.6 12.5z"/><path d="M2.5 2.5l11 11"/></symbol>',
  'pages':
    '<symbol id="ico-pages" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.25 1.75h4L13 4.5v7.25a1 1 0 0 1-1 1H6.25a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M10.25 1.75V4.5H13"/><path d="M3 4.75v8.5a1 1 0 0 0 1 1h6.25"/></symbol>',

  // ── Notas ligadas ─────────────────────────────────────────────────────────
  //
  // O grafo das notas de um cofre, que o Lapis abre: três notas e as ligações, sem fio cruzando fio.
  'grafo':
    '<symbol id="ico-grafo" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.75" cy="4.5" r="1.75"/><circle cx="12.25" cy="3.75" r="1.75"/><circle cx="9" cy="12.25" r="1.75"/><path d="M5.5 4.35l5-.45M4.75 6l3.25 4.8M11.75 5.45l-2.2 5.1"/></symbol>',
  };

  const ID_DO_SPRITE = 'tuff-sprite';

  /**
   * Põe o sprite no documento, uma vez.
   *
   * `aria-hidden` e `display:none` no contêiner: ele é uma biblioteca de formas.
   * Sem o `aria-hidden`, um leitor de tela percorre cada símbolo vazio do sprite antes de chegar à
   * página.
   */
  function instalar(doc) {
    const d = doc || document;
    if (!d || !d.body || d.getElementById(ID_DO_SPRITE)) return;
    const svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = ID_DO_SPRITE;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'display:none');
    svg.innerHTML = Object.values(SIMBOLOS).join('');
    // No começo do `<body>`, e não no fim: um `<use>` que aponte para um símbolo ainda não
    // presente resolve sozinho quando ele chega, mas só depois de um reflow, e a primeira pintura
    // sairia com os ícones vazios.
    d.body.insertBefore(svg, d.body.firstChild);
  }

  /**
   * A marcação de um ícone, como string.
   *
   * `focusable="false"` é para o IE/Edge antigo não pôr o `<svg>` na ordem de tabulação; custa
   * nada e evita paradas de Tab invisíveis. `aria-hidden` porque um ícone é sempre acompanhado de
   * um rótulo: se ele for a única informação, quem chama dá um `aria-label` ao botão, e não ao
   * desenho.
   */
  function svg(nome, classe) {
    if (!SIMBOLOS[nome]) {
      // Avisa, e devolve nada. Um `<use>` quebrado não lança e não desenha, e o desenho que falta
      // só é achável se alguém falar.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[tuff] ícone '${nome}' não existe; TuffIcones.nomes() lista os que existem`);
      }
      return '';
    }
    const c = classe ? `tuff-ico ${classe}` : 'tuff-ico';
    return `<svg class="${c}" aria-hidden="true" focusable="false"><use href="#ico-${nome}"></use></svg>`;
  }

  const tem = (nome) => Object.prototype.hasOwnProperty.call(SIMBOLOS, nome);
  const nomes = () => Object.keys(SIMBOLOS);

  // ─── As animações ─────────────────────────────────────────────────────────
  //
  // As formas ficam no `tuff.css`, como classes da peça `.tuff-ico`: `--volta`, `--gira`,
  // `--abre`, `--desenha`, `--cai` e `--balanca`. Uma animação de uma vez precisa sair da classe
  // quando acaba, senão o clique seguinte põe a mesma classe e nada roda; `animar` faz as duas
  // coisas. O visto e a seta do download têm a marca no próprio símbolo (o `pathLength` e o grupo
  // `tuff-ico-seta`), porque o CSS da página não alcança uma peça dentro de um `<use>`, e a
  // animação entra lá por uma variável herdada.

  /** O ícone de `el`: ele mesmo, quando é o `<svg>`, ou o primeiro `.tuff-ico`/`.ico` de dentro. */
  function _icone(el) {
    if (!el) return null;
    if (el.matches?.('svg')) return el;
    return el.querySelector?.('svg.tuff-ico, svg.ico') || null;
  }

  /**
   * Roda uma animação de uma vez no ícone de `el` (`volta`, `desenha`, `cai`, `balanca`). Com o
   * movimento reduzido as durações valem zero, e o `animationend` chega na hora; o relógio de
   * reserva tira a classe de um navegador que não o mande.
   */
  function animar(el, nome) {
    const ico = _icone(el);
    if (!ico) return;
    const classe = `tuff-ico--${nome}`;
    ico.classList.remove(classe);
    void ico.getBoundingClientRect();
    ico.classList.add(classe);
    let feito = false;
    const fim = () => {
      if (feito) return;
      feito = true;
      ico.classList.remove(classe);
      ico.removeEventListener('animationend', fim);
    };
    ico.addEventListener('animationend', fim);
    setTimeout(fim, 1000);
  }

  /**
   * Marca `botao` como ocupado enquanto `promessa` não se resolve: o ícone com `tuff-ico--gira`
   * gira sob o `aria-busy`. A marca só entra depois de um instante, e um carregamento curto fica só
   * com a volta do clique. Devolve a própria promessa.
   */
  function ocupado(botao, promessa) {
    if (!botao || !promessa || typeof promessa.then !== 'function') return promessa;
    const relogio = setTimeout(() => botao.setAttribute('aria-busy', 'true'), 250);
    const soltar = () => { clearTimeout(relogio); botao.removeAttribute('aria-busy'); };
    promessa.then(soltar, soltar);
    return promessa;
  }

  window.TuffIcones = { instalar, svg, tem, nomes, animar, ocupado };

  // Um botão declara a animação do clique dele: `data-tuff-anima="volta"` no Atualizar,
  // `data-tuff-anima="cai"` no Baixar. Um ouvinte só, no documento, em vez de um por botão.
  if (typeof document !== 'undefined' && document && document.addEventListener) {
    document.addEventListener('click', (e) => {
      const alvo = e.target?.closest?.('[data-tuff-anima]');
      if (alvo && !alvo.disabled) animar(alvo, alvo.dataset.tuffAnima);
    }, true);
  }

  // Instala sozinho: quem carrega este arquivo quer os ícones, e obrigar a chamar `instalar()`
  // só cria uma chance de esquecer, cujo sintoma é a página inteira sem ícone nenhum. Dentro do
  // `<body>` o documento já tem corpo e a instalação é síncrona; no `<head>` ela espera o
  // `DOMContentLoaded`.
  // `&& document`, e não só o `typeof`: num sandbox de teste o global existe e vale `null`, e ali
  // `document.body` estoura no carregamento do arquivo, derrubando tudo que viesse depois.
  if (typeof document !== 'undefined' && document && document.addEventListener) {
    if (document.body) instalar(document);
    else document.addEventListener('DOMContentLoaded', () => instalar(document));
  }
})();
