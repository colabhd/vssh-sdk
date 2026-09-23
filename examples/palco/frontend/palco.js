/* Palco: o comportamento.
 *
 * ─── A decisão que organiza o arquivo ───────────────────────────────────────
 *
 * ⚠ **Quem sabe o que esta máquina toca é esta máquina.** A primeira coisa que o app faz é se
 * perguntar, e o perfil vai junto com o caminho em `api/abrir`: o servidor decide o modo com as
 * duas metades na mão. Daí saem dois caminhos muito diferentes:
 *
 *   direto   `vssh.arquivos.urlFor(caminho)`: o portal serve com Range, busca nativa, zero CPU.
 *   cano     `api/fluxo`: ffmpeg, sem Content-Length e sem Range. A régua verdadeira vem do
 *            `ffprobe` e entra na `TuffMidia` por `opcoes.tempo`; buscar é reiniciar o cano com
 *            `?t=`.
 *
 * ⚠ Nada roda até o `DOMContentLoaded`: o `web.spa` injeta os scripts antes de `</head>` e sem
 * `defer`, para o SDK existir antes de qualquer outro script, e este arquivo executa com o
 * `<body>` ainda vazio.
 */
function montarPalco() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const janela = $('janela');
  const video = $('video');
  const palco = $('palco');

  // ── O perfil desta máquina ──────────────────────────────────────────────
  //
  // ⚠ `canPlayType`, e não `MediaSource.isTypeSupported`. O caminho direto é `<video src>`, que
  // não passa por MSE, e as duas perguntas discordam em metade dos containers que importam:
  // medido em Chrome 151, `matroska`, `flac` e `ogg/opus` são "sim" na primeira e "não" na
  // segunda. Perguntar a errada faria o servidor remuxar todo `.mkv` por nada.

  const CONTAINERS = {
    mp4: 'video/mp4; codecs="avc1.640028"',
    webm: 'video/webm; codecs="vp9"',
    matroska: 'video/x-matroska; codecs="avc1.640028"',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mpegts: 'video/mp2t; codecs="avc1.640028"',
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    wav: 'audio/wav',
    ogg: 'audio/ogg; codecs="opus"',
  };
  const VIDEO = {
    h264: 'video/mp4; codecs="avc1.640028"',
    hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
    vp9: 'video/webm; codecs="vp9"',
    vp8: 'video/webm; codecs="vp8"',
    av1: 'video/mp4; codecs="av01.0.05M.08"',
    mpeg4: 'video/mp4; codecs="mp4v.20.8"',
  };
  const AUDIO = {
    aac: 'audio/mp4; codecs="mp4a.40.2"',
    mp3: 'audio/mpeg',
    opus: 'audio/webm; codecs="opus"',
    vorbis: 'audio/webm; codecs="vorbis"',
    flac: 'audio/flac',
    ac3: 'audio/mp4; codecs="ac-3"',
    eac3: 'audio/mp4; codecs="ec-3"',
  };

  function sondarPerfil() {
    const v = document.createElement('video');
    // `canPlayType` responde `''`, `'maybe'` ou `'probably'`. `'maybe'` só conta sem `codecs`
    // (`audio/wav` é o caso): com codecs declarados ele é dúvida, e um "sim" errado custa tela
    // preta, enquanto um "não" errado custa 2% de CPU no servidor.
    const serve = (t) => {
      const r = v.canPlayType(t);
      return r === 'probably' || (r === 'maybe' && !t.includes('codecs'));
    };
    const lista = (mapa) => Object.keys(mapa).filter((k) => serve(mapa[k]));
    return { containers: lista(CONTAINERS), video: lista(VIDEO), audio: lista(AUDIO) };
  }

  const PERFIL = sondarPerfil();

  const EXT_DE_AUDIO = new Set(['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac', 'wma', 'mka']);
  const extensao = (nome) => {
    const i = String(nome || '').lastIndexOf('.');
    return i > 0 ? nome.slice(i + 1).toLowerCase() : '';
  };
  const semExtensao = (nome) => {
    const i = String(nome || '').lastIndexOf('.');
    return i > 0 ? nome.slice(0, i) : nome;
  };
  const nomeDaPasta = (caminho) => {
    const partes = String(caminho || '').split('/').filter(Boolean);
    return partes.length ? partes[partes.length - 1] : '/';
  };

  // ── Estado ──────────────────────────────────────────────────────────────
  let atual = null;      // a resposta de `api/abrir`
  let base = 0;          // onde o cano foi cortado: o tempo do filme é base + video.currentTime
  let fila = [];         // os irmãos de pasta, `{nome, caminho}`
  let indice = -1;
  // Toda abertura ganha um número, e as respostas assíncronas dela conferem o seu antes de mexer
  // no estado: abrir B enquanto A carrega não pode deixar a resposta de A, que chega depois,
  // trocar a fila de B.
  let geracao = 0;
  let repetir = 'nao';   // nao | pasta | um
  let aleatorio = false;
  let filtro = '';
  let selecionado = -1;  // a linha da fila com o foco do teclado

  // As preferências que valem só para esta pessoa neste navegador. `localStorage` pode lançar
  // (janela privada, dados bloqueados), e aí o app segue com os padrões.
  const PREF = 'palco:';
  const lerPref = (k, padrao) => {
    try { const v = localStorage.getItem(PREF + k); return v === null ? padrao : JSON.parse(v); }
    catch { return padrao; }
  };
  const gravarPref = (k, v) => { try { localStorage.setItem(PREF + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

  /**
   * Uma chamada à API do app. O corpo do erro viaja junto: o servidor diz o que falhou
   * (`{error}`), e um 502 do portal chega em HTML, então o `.json()` é opcional.
   */
  const api = (rota, opts) => fetch(rota, opts).then(async (r) => {
    let corpo = null;
    try { corpo = await r.json(); } catch { /* nem toda resposta é JSON */ }
    if (!r.ok) {
      throw Object.assign(new Error((corpo && corpo.error) || `${rota}: ${r.status}`),
                          { corpo: corpo || {}, status: r.status });
    }
    return corpo;
  });

  const tempo = (s) => TuffMidia.tempo(s);
  // Sem barra inicial em nenhuma rota: o app é servido sob `/<servidor>/proxy/app/palco/`, e um
  // `/api/…` sairia do prefixo e cairia num 404 do portal.
  const urlDaCapa = (caminho) => `api/capa?caminho=${encodeURIComponent(caminho)}`;

  // ── Onde buscar os bytes ────────────────────────────────────────────────

  const noCano = () => !!atual && atual.modo !== 'direto' && atual.modo !== 'desconhecido';
  let faixaEscolhida = null;

  function urlDoCano(t) {
    const p = new URLSearchParams({ caminho: atual.caminho, t: String(t || 0),
                                    perfil: JSON.stringify(PERFIL) });
    if (faixaEscolhida !== null) p.set('audio', String(faixaEscolhida));
    return `api/fluxo?${p}`;
  }

  const duracaoReal = () => (atual && atual.duracao) || video.duration;
  const agoraReal = () => (noCano() ? base + video.currentTime : video.currentTime);

  function buscar(t) {
    if (!atual) return;
    const alvo = Math.max(0, Math.min(t, (duracaoReal() || 0)));
    if (!noCano()) { video.currentTime = alvo; return; }
    carregarCano(alvo, undefined, !video.paused, alvo > agoraReal());
  }

  /**
   * O cano, a partir de `t`. O cano não tem Range: mudar de posição é reiniciar o ffmpeg com
   * `-ss`, e o `base` faz a linha do tempo continuar mostrando o tempo do filme, e não o do pedaço
   * que está chegando.
   *
   * ⚠ Com a imagem copiada (remux e só áudio) o ffmpeg começa num quadro-chave antes do pedido,
   * e o `base` tem de ser esse quadro, que o servidor diz em `api/corte` perguntando ao próprio
   * ffmpeg com o mesmo `-ss`. Somando o `t` pedido, o relógio e as legendas ficariam adiantados em
   * relação à imagem, às vezes em mais de 8 s. Convertendo a imagem, o ffmpeg decodifica até o
   * ponto exato, e o pedido é o ponto.
   *
   * `adiante` marca uma busca para frente: ela não pode cair atrás de onde a mídia já está, e o
   * servidor a leva ao quadro-chave seguinte quando o de antes do pedido fica muito para trás.
   */
  let cortes = 0;
  async function carregarCano(t, texto, tocar, adiante) {
    const minha = ++cortes;
    const deste = geracao;
    // Em milésimos, para o corte e o cano pedirem a mesma busca.
    let pedido = Math.round(Math.max(0, t) * 1000) / 1000;
    preparando(true, texto);
    let inicio = pedido;
    if (pedido > 0 && atual.temVideo && atual.modo !== 'transcode') {
      try {
        const r = await api(`api/corte?caminho=${encodeURIComponent(atual.caminho)}&t=${pedido}`
                            + (adiante ? '&adiante=1' : ''));
        if (typeof r.inicio === 'number' && typeof r.pedido === 'number') {
          inicio = r.inicio;
          pedido = r.pedido;
        }
      } catch { /* sem o ponto, o cano começa assim mesmo, com o desvio do quadro-chave */ }
      if (minha !== cortes || deste !== geracao) return;
    }
    base = inicio;
    deslocarLegendas();
    video.src = urlDoCano(pedido);
    video.load();
    if (tocar) video.play().catch(() => {});
  }

  // ── O que aparece sobre o palco ─────────────────────────────────────────

  function preparando(sim, texto) {
    $('preparando').hidden = !sim;
    if (texto) $('preparando-t').textContent = texto;
  }

  // O aviso não some sozinho: quem saiu da janela por dez segundos voltaria para uma mídia parada
  // sem explicação. Ele sai quando outro arquivo abre.
  function avisar(texto) {
    $('aviso-t').textContent = texto || '';
    $('aviso').hidden = !texto;
  }

  function mostrarRetomar(seg) {
    const faixa = $('retomar');
    clearTimeout(mostrarRetomar.t);
    if (!seg) { faixa.hidden = true; return; }
    $('retomar-t').textContent = tempo(seg);
    faixa.hidden = false;
    faixa.classList.remove('retomar--saindo');
    mostrarRetomar.t = setTimeout(() => {
      faixa.classList.add('retomar--saindo');
      mostrarRetomar.t = setTimeout(() => { faixa.hidden = true; }, 300);
    }, 6000);
  }

  $('btn-do-inicio').addEventListener('click', () => {
    $('retomar').hidden = true;
    buscar(0);
    video.play().catch(() => {});
  });

  /** A capa de um item: a imagem embutida quando há, e o ícone do tipo por baixo dela. */
  function pintarCapa(el, { audio, capa }) {
    el.querySelector('use').setAttribute('href', audio ? '#ico-audio' : '#ico-video');
    const img = el.querySelector('img');
    img.hidden = true;
    img.onload = () => { img.hidden = false; };
    img.onerror = () => { img.hidden = true; };
    if (capa) img.src = capa; else img.removeAttribute('src');
  }

  // ── As três telas do palco ──────────────────────────────────────────────

  function telaDoInicio() {
    $('inicio').hidden = false;
    $('musica').hidden = true;
    video.hidden = true;
    carregarRecentes();
  }

  function telaDe(r) {
    $('inicio').hidden = true;
    const musica = !r.temVideo;
    $('musica').hidden = !musica;
    video.hidden = musica;
    const et = r.etiquetas || {};
    const titulo = et.titulo || semExtensao(r.nome);
    const sub = musica ? (et.artista || nomeDaPasta(r.pasta)) : nomeDaPasta(r.pasta);
    const capa = r.capa ? urlDaCapa(r.caminho) : null;

    $('agora-titulo').textContent = titulo;
    $('agora-sub').textContent = sub;
    pintarCapa($('agora-capa'), { audio: musica, capa });
    if (musica) {
      $('musica-titulo').textContent = titulo;
      $('musica-artista').textContent = et.artista || '';
      $('musica-album').textContent = et.album || '';
      pintarCapa($('musica-capa'), { audio: true, capa });
    }
    document.title = `${titulo} — Palco`;
    // O ambiente mostra na central de mídia o que o app declara; sem a declaração, ele leria o
    // nome da URL, que no cano é `fluxo`.
    vssh.midia.agora(titulo, sub, capa || undefined);
    porMediaSession(titulo, sub, capa);
    pintarFaixas();
    pintarNavegacao();
  }

  // ── Abrir ───────────────────────────────────────────────────────────────

  async function abrir(caminho, opcoes) {
    const o = opcoes || {};
    const minha = ++geracao;
    avisar('');
    // A fila some antes do `await`: até `api/vizinhos` responder ela é a do arquivo anterior, e
    // um `ended` nesse intervalo avançaria pela pasta errada.
    fila = [];
    indice = -1;
    faixaEscolhida = null;
    porCentralDeMidia();
    preparando(true, 'Abrindo…');
    let r;
    try {
      r = await api('api/abrir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caminho, perfil: PERFIL }),
      });
    } catch (e) {
      if (minha !== geracao) return;
      preparando(false);
      const nome = String(caminho || '').split('/').pop();
      avisar(e.status === 404 ? `${nome} não existe mais.` : `O Palco não conseguiu abrir ${nome}.`);
      return;
    }
    if (minha !== geracao) return;

    atual = r;
    base = 0;
    telaDe(r);
    // A sessão do ambiente reabre a janela nesta rota, e o Palco volta com o mesmo arquivo.
    vssh.app.lembrarRota(`?caminho=${encodeURIComponent(r.caminho)}`);

    if (r.modo === 'desconhecido') {
      preparando(false);
      avisar('Este arquivo não tem vídeo nem áudio que o Palco reconheça.');
      return;
    }

    const de = o.doInicio ? 0 : (r.retomarEm || 0);
    const tocar = o.tocar !== false;
    aplicarLegendas(r);
    if (noCano()) {
      // `auto`, e não `metadata`: um cano não tem Range, e suspender a rede depois do cabeçalho
      // obrigaria a reatar com um ffmpeg novo, do zero.
      video.preload = 'auto';
      // O aviso de retomada diz de onde a mídia de fato continua, que no cano é o ponto de corte.
      carregarCano(de, r.temVideo ? 'Preparando o vídeo…' : 'Preparando o áudio…', tocar)
        .then(() => { if (minha === geracao) mostrarRetomar(de ? base : 0); });
    } else {
      cortes++;   // um cano que ainda esperava o ponto de corte do arquivo anterior não assume
      video.preload = 'metadata';
      preparando(false);
      video.src = vssh.arquivos.urlFor(r.caminho);
      if (de) video.addEventListener('loadedmetadata', () => { video.currentTime = de; }, { once: true });
      video.load();
      if (tocar) video.play().catch(() => { /* autoplay recusado: o botão está ali */ });
      mostrarRetomar(de);
    }

    carregarFila(r.caminho, minha);
  }

  function abrirDaFila(i) {
    const item = fila[i];
    if (item) abrir(item.caminho);
  }

  // ── Legendas e faixas de áudio ──────────────────────────────────────────
  //
  // Só as legendas de TEXTO chegam aqui: o backend filtra PGS e VobSub, que são imagens.

  const IDIOMAS = { por: 'Português', pob: 'Português (BR)', eng: 'Inglês', spa: 'Espanhol',
                    fra: 'Francês', fre: 'Francês', deu: 'Alemão', ger: 'Alemão', ita: 'Italiano',
                    jpn: 'Japonês', kor: 'Coreano', rus: 'Russo', zho: 'Chinês', chi: 'Chinês' };
  const nomeDeIdioma = (c) => (c ? (IDIOMAS[c.toLowerCase()] || c.toUpperCase()) : null);

  function aplicarLegendas(r) {
    for (const t of [...video.querySelectorAll('track')]) t.remove();
    for (const l of r.legendas || []) {
      const t = document.createElement('track');
      t.kind = 'subtitles';
      t.label = l.titulo || nomeDeIdioma(l.idioma) || `Legenda ${l.indice}`;
      if (l.idioma) t.srclang = l.idioma;
      t.src = `api/legenda?caminho=${encodeURIComponent(r.caminho)}&faixa=${l.indice}`;
      t.addEventListener('load', deslocarLegendas);
      video.appendChild(t);
    }
    // Nenhuma ligada por padrão: ligar sozinho tampa a imagem de quem não pediu.
    for (const t of video.textTracks) t.mode = 'disabled';
  }

  // ⚠ No cano o `<video>` conta a partir do ponto em que o servidor cortou, e as falas estão no
  // tempo do arquivo. Cada fala guarda o tempo original e é deslocada pelo `base` sempre que ele
  // muda. Um `-ss` no ffmpeg da legenda não resolve: o demuxer de legenda não busca, e o ffmpeg só
  // alinha a primeira fala ao zero.
  function deslocarLegendas() {
    const d = noCano() ? base : 0;
    for (const t of video.textTracks) {
      for (const c of t.cues || []) {
        if (c.palcoInicio === undefined) { c.palcoInicio = c.startTime; c.palcoFim = c.endTime; }
        c.startTime = c.palcoInicio - d;
        c.endTime = c.palcoFim - d;
      }
    }
  }

  function rotuloDeFaixa(f) {
    // Idioma e título, e os canais só quando passam de dois: é o que distingue "original 5.1" de
    // "estéreo compatível".
    const partes = [nomeDeIdioma(f.idioma), f.titulo].filter(Boolean);
    if (!partes.length) partes.push(`Faixa ${f.indice}`);
    if (f.canais > 2) partes.push(`${f.canais} canais`);
    return partes.join(', ');
  }

  const faixaDeAudioAtual = () => (faixaEscolhida !== null ? faixaEscolhida : atual && atual.faixaDeAudio);

  function itensDeFaixas() {
    const itens = [];
    if (atual && atual.audios.length > 1) {
      itens.push({ header: 'Áudio' }, ...atual.audios.map((f) => ({
        id: `aud:${f.indice}`, label: rotuloDeFaixa(f), checked: faixaDeAudioAtual() === f.indice })));
    }
    const faixas = [...video.textTracks];
    if (faixas.length) {
      if (itens.length) itens.push({ separator: true });
      itens.push({ header: 'Legenda' },
                 { id: 'leg:-1', label: 'Desligada', checked: !faixas.some((t) => t.mode === 'showing') },
                 ...faixas.map((t, i) => ({ id: `leg:${i}`, label: t.label, checked: t.mode === 'showing' })));
    }
    return itens;
  }

  // O botão só aparece quando há o que escolher: um menu com uma faixa só não serve a ninguém.
  function pintarFaixas() {
    $('btn-faixas').hidden = !(atual && (atual.audios.length > 1 || (atual.legendas || []).length));
  }

  function trocarAudio(i) {
    if (!atual) return;
    // Um `<video>` não expõe troca de faixa de áudio de forma utilizável; a troca é um cano novo
    // com `-map` da faixa pedida, a partir do mesmo segundo.
    const onde = agoraReal();
    faixaEscolhida = i;
    if (!noCano()) atual.modo = 'remux';
    carregarCano(onde, 'Trocando a faixa de áudio…', true);
  }

  function trocarLegenda(i) {
    [...video.textTracks].forEach((t, k) => { t.mode = k === i ? 'showing' : 'disabled'; });
    // Uma faixa desligada não expõe as falas, e o `base` pode ter mudado enquanto ela estava
    // desligada; a que já tinha carregado não dispara `load` de novo.
    deslocarLegendas();
  }

  // ── O player do Tuff: trilha, tempo, volume ─────────────────────────────

  TuffMidia.player(janela, video, { tempo: { duracao: duracaoReal, atual: agoraReal, buscar } });

  video.addEventListener('loadeddata', () => preparando(false));
  video.addEventListener('playing', () => preparando(false));
  video.addEventListener('error', () => {
    preparando(false);
    if (!atual) return;
    avisar(noCano()
      ? 'A conversão no servidor falhou. O log do app diz o motivo.'
      : 'A reprodução falhou. Abra o arquivo de novo.');
  });

  const trocarIcone = (botao, nome) => botao.querySelector('use').setAttribute('href', `#ico-${nome}`);
  const pintarPlay = () => trocarIcone($('btn-play'), video.paused ? 'play' : 'pause');
  video.addEventListener('play', pintarPlay);
  video.addEventListener('pause', pintarPlay);
  const pintarMudo = () => {
    const nivel = video.muted || !video.volume ? 'volume-off' : video.volume < 0.5 ? 'volume-low' : 'volume-on';
    trocarIcone($('btn-mudo'), nivel);
    $('btn-mudo').setAttribute('aria-label', video.muted ? 'Ativar o som' : 'Silenciar');
    $('btn-mudo').dataset.tuffDica = video.muted ? 'Ativar o som (M)' : 'Silenciar (M)';
    gravarPref('volume', video.volume);
    gravarPref('mudo', video.muted);
  };
  video.volume = Math.min(1, Math.max(0, Number(lerPref('volume', 1)) || 0));
  video.muted = lerPref('mudo', false) === true;
  video.addEventListener('volumechange', pintarMudo);
  pintarMudo();

  // ── Fim de arquivo: repetir, aleatório, próximo ─────────────────────────
  //
  // ⚠ `ended` quer dizer que os bytes acabaram, e no cano isso se separa do fim do arquivo: um
  // ffmpeg que morre cedo fecha o corpo, e o avanço automático poria outra coisa para tocar. Quem
  // desempata é a régua do `ffprobe`.

  function chegouAoFim() {
    const dur = duracaoReal();
    if (!dur || !isFinite(dur)) return true;
    return agoraReal() >= dur - Math.max(3, dur * 0.02);
  }

  function proximoIndice() {
    if (!fila.length) return -1;
    if (aleatorio && fila.length > 1) {
      let i = indice;
      while (i === indice) i = Math.floor(Math.random() * fila.length);
      return i;
    }
    if (indice + 1 < fila.length) return indice + 1;
    return repetir === 'pasta' ? 0 : -1;
  }

  video.addEventListener('ended', () => {
    if (!chegouAoFim()) {
      avisar(`A transmissão parou em ${tempo(agoraReal())}, antes do fim. O log do app diz o motivo.`);
      return;
    }
    if (repetir === 'um') { buscar(0); video.play().catch(() => {}); return; }
    const i = proximoIndice();
    if (i >= 0) abrirDaFila(i);
  });

  const temAnterior = () => indice > 0 || (!!atual && agoraReal() > 3);
  const temProximo = () => proximoIndice() >= 0;

  function anterior() {
    // Como em todo player: depois dos primeiros segundos, "anterior" volta ao começo desta faixa.
    if (atual && agoraReal() > 3) { buscar(0); return; }
    if (indice > 0) abrirDaFila(indice - 1);
  }
  function proximo() {
    const i = proximoIndice();
    if (i >= 0) abrirDaFila(i);
  }

  function pintarNavegacao() {
    for (const id of ['btn-play', 'btn-voltar', 'btn-avancar', 'btn-veloc']) $(id).disabled = !atual;
    $('btn-anterior').disabled = !temAnterior();
    $('btn-proximo').disabled = !temProximo();
    porCentralDeMidia();
  }
  video.addEventListener('timeupdate', () => {
    // Só o limiar de três segundos muda o estado de "anterior"; repintar a cada quadro seria à toa.
    const agora = temAnterior();
    if (agora !== !$('btn-anterior').disabled) pintarNavegacao();
  });

  // ── Onde a pessoa parou ─────────────────────────────────────────────────
  //
  // A cada 15 s, ao pausar e quando a janela some. `visibilitychange`, porque uma janela do
  // ambiente fecha sem passar por `unload` de forma confiável.

  function marcar() {
    if (!atual || !atual.caminho || !video.duration) return;
    navigator.sendBeacon('api/marca', new Blob([JSON.stringify({
      caminho: atual.caminho, seg: Math.floor(agoraReal()), dur: duracaoReal(),
    })], { type: 'application/json' }));
  }
  setInterval(() => { if (!video.paused) marcar(); }, 15000);
  video.addEventListener('pause', marcar);
  document.addEventListener('visibilitychange', () => { if (document.hidden) marcar(); });

  function esquecer(caminho) {
    fetch(`api/marca?caminho=${encodeURIComponent(caminho)}`, { method: 'DELETE' })
      .then(() => carregarRecentes()).catch(() => {});
  }

  // ── O início: o que ficou pela metade ───────────────────────────────────

  async function carregarRecentes() {
    let r;
    try { r = await api('api/recentes'); } catch { return; /* a lista que já está na tela fica */ }
    const lista = $('continuar-lista');
    lista.textContent = '';
    for (const item of (r.itens || []).slice(0, 6)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'continuar-item';
      b.dataset.caminho = item.caminho;
      const capa = document.createElement('div');
      capa.className = 'capa capa--pequena';
      capa.innerHTML = '<svg class="tuff-ico" aria-hidden="true"><use href="#ico-video"></use></svg><img alt="" hidden>';
      // Numa música, a capa embutida quando ela existe; a rota responde 404 sem capa, e o ícone
      // que está por baixo fica.
      const audio = EXT_DE_AUDIO.has(extensao(item.nome));
      pintarCapa(capa, { audio, capa: audio ? urlDaCapa(item.caminho) : null });
      const nome = document.createElement('span');
      nome.className = 'continuar-nome';
      nome.textContent = semExtensao(item.nome);
      nome.title = item.caminho;
      const onde = document.createElement('span');
      onde.className = 'continuar-onde';
      onde.textContent = item.dur ? `${tempo(item.seg)} de ${tempo(item.dur)}` : tempo(item.seg);
      const barra = document.createElement('span');
      barra.className = 'continuar-barra';
      const feito = document.createElement('span');
      feito.style.width = `${item.dur ? Math.min(100, (item.seg / item.dur) * 100) : 0}%`;
      barra.appendChild(feito);
      b.append(capa, nome, onde, barra);
      b.addEventListener('click', () => abrir(item.caminho));
      li.appendChild(b);
      lista.appendChild(li);
    }
    $('continuar').hidden = !lista.children.length;
  }

  // ── A fila ──────────────────────────────────────────────────────────────

  async function carregarFila(caminho, minha) {
    let r;
    try { r = await api(`api/vizinhos?caminho=${encodeURIComponent(caminho)}`); }
    catch { return; /* a pasta pode ter sumido; a mídia continua tocando */ }
    if (minha !== geracao) return;
    fila = r.itens || [];
    indice = r.atual;
    selecionado = indice;
    $('fila-pasta').textContent = nomeDaPasta(r.pasta);
    $('fila-pasta').title = r.pasta;
    $('fila-busca').hidden = fila.length <= 12;
    desenharFila();
    pintarNavegacao();
    // A fila abre sozinha só para quem nunca escolheu, e só para música: num álbum a lista é o
    // que se olha; num filme, a imagem.
    if (lerPref('fila', null) === null) mostrarFila(!atual.temVideo && fila.length > 1, false);
  }

  function desenharFila() {
    const lista = $('fila-lista');
    lista.textContent = '';
    const busca = filtro.trim().toLowerCase();
    fila.forEach((it, i) => {
      if (busca && !it.nome.toLowerCase().includes(busca)) return;
      const li = document.createElement('li');
      li.className = 'fila-item' + (i === indice ? ' fila-item--tocando' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === selecionado));
      li.tabIndex = i === selecionado ? 0 : -1;
      li.dataset.i = String(i);
      const n = document.createElement('span');
      n.className = 'fila-n';
      if (i === indice) n.innerHTML = '<svg class="tuff-ico" aria-hidden="true"><use href="#ico-play"></use></svg>';
      else n.textContent = String(i + 1);
      const nome = document.createElement('span');
      nome.className = 'fila-nome';
      nome.textContent = semExtensao(it.nome);
      nome.title = it.nome;
      const ext = document.createElement('span');
      ext.className = 'fila-ext';
      ext.textContent = extensao(it.nome);
      li.append(n, nome, ext);
      lista.appendChild(li);
    });
    const tocando = lista.querySelector('.fila-item--tocando');
    if (tocando && !$('fila').hidden) tocando.scrollIntoView({ block: 'nearest' });
  }

  function selecionar(i, focar) {
    selecionado = i;
    for (const li of $('fila-lista').children) {
      const sim = Number(li.dataset.i) === i;
      li.setAttribute('aria-selected', String(sim));
      li.tabIndex = sim ? 0 : -1;
      if (sim && focar) { li.focus(); li.scrollIntoView({ block: 'nearest' }); }
    }
  }

  $('fila-lista').addEventListener('click', (e) => {
    const li = e.target.closest('.fila-item');
    if (li) selecionar(Number(li.dataset.i));
  });
  $('fila-lista').addEventListener('dblclick', (e) => {
    const li = e.target.closest('.fila-item');
    if (li) abrirDaFila(Number(li.dataset.i));
  });
  $('fila-lista').addEventListener('keydown', (e) => {
    const visiveis = [...$('fila-lista').children].map((li) => Number(li.dataset.i));
    const pos = visiveis.indexOf(selecionado);
    const ir = (p) => { e.preventDefault(); if (visiveis.length) selecionar(visiveis[Math.max(0, Math.min(visiveis.length - 1, p))], true); };
    if (e.key === 'ArrowDown') ir(pos + 1);
    else if (e.key === 'ArrowUp') ir(pos - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(visiveis.length - 1);
    else if (e.key === 'Enter' && selecionado >= 0) { e.preventDefault(); abrirDaFila(selecionado); }
  });
  $('fila-busca').addEventListener('input', (e) => { filtro = e.target.value; desenharFila(); });

  function mostrarFila(sim, lembrar) {
    $('fila').hidden = !sim;
    $('btn-fila').setAttribute('aria-pressed', String(sim));
    if (lembrar) gravarPref('fila', sim);
    if (sim) {
      const tocando = $('fila-lista').querySelector('.fila-item--tocando');
      if (tocando) tocando.scrollIntoView({ block: 'nearest' });
    }
  }
  $('btn-fila').addEventListener('click', () => mostrarFila($('fila').hidden, true));
  mostrarFila(lerPref('fila', false) === true, false);

  const mostrarNaPasta = (caminho) => vssh.arquivos.abrirPasta(caminho.replace(/[^/]+$/, ''));
  $('btn-pasta').addEventListener('click', () => { if (atual) mostrarNaPasta(atual.caminho); });

  // ── Repetir, aleatório, velocidade ──────────────────────────────────────

  // Três estados, e o ícone muda no terceiro: cor sozinha distingue dois.
  function porRepetir(modo) {
    repetir = modo;
    const b = $('btn-repetir');
    b.setAttribute('aria-pressed', String(modo !== 'nao'));
    trocarIcone(b, modo === 'um' ? 'repeat-one' : 'repeat');
    const rotulo = { nao: 'Repetir', pasta: 'Repetindo a pasta', um: 'Repetindo este' }[modo];
    b.setAttribute('aria-label', rotulo);
    b.dataset.tuffDica = rotulo;
    pintarNavegacao();
  }
  $('btn-repetir').addEventListener('click', () => porRepetir({ nao: 'pasta', pasta: 'um', um: 'nao' }[repetir]));

  function porAleatorio(sim) {
    aleatorio = sim;
    $('btn-aleatorio').setAttribute('aria-pressed', String(sim));
    pintarNavegacao();
  }
  $('btn-aleatorio').addEventListener('click', () => porAleatorio(!aleatorio));

  const VELOCIDADES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const numero = (v) => String(v).replace('.', ',');
  const rotuloVelocidade = (v) => (v === 1 ? 'Normal' : `${numero(v)}×`);
  const itensDeVelocidade = () => VELOCIDADES.map((v) => ({
    id: `vel:${v}`, label: rotuloVelocidade(v), checked: video.playbackRate === v }));

  // `defaultPlaybackRate` junto: uma troca de fonte (o cano reiniciado por uma busca) volta o
  // `playbackRate` ao padrão, e o padrão passa a ser o escolhido.
  function velocidade(v) {
    video.defaultPlaybackRate = v;
    video.playbackRate = v;
    const b = $('btn-veloc');
    b.textContent = `${numero(v)}×`;
    b.dataset.alterada = v === 1 ? '0' : '1';
  }

  // ── Tela cheia e janela flutuante ───────────────────────────────────────

  function telaCheia() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else janela.requestFullscreen().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => {
    const sim = !!document.fullscreenElement;
    trocarIcone($('btn-tela'), sim ? 'fullscreen-exit' : 'fullscreen');
    $('btn-tela').setAttribute('aria-label', sim ? 'Sair da tela cheia' : 'Tela cheia');
    $('btn-tela').dataset.tuffDica = sim ? 'Sair da tela cheia (F)' : 'Tela cheia (F)';
    acordar();
  });

  // Em tela cheia o transporte some com o ponteiro parado enquanto a mídia toca, e nunca com o
  // foco dentro dele: sumir ali deixaria quem usa o teclado sem controle nenhum na tela.
  let ocio = null;
  function acordar() {
    janela.classList.remove('ocioso');
    clearTimeout(ocio);
    if (!document.fullscreenElement) return;
    ocio = setTimeout(() => {
      if (!video.paused && !$('transporte').contains(document.activeElement)) janela.classList.add('ocioso');
      else acordar();
    }, 2500);
  }
  janela.addEventListener('pointermove', acordar);
  video.addEventListener('pause', acordar);
  $('transporte').addEventListener('focusin', acordar);

  async function janelaFlutuante() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { avisar('A janela flutuante não está disponível aqui.'); }
  }

  // ── Os menus, desenhados pelo ambiente ──────────────────────────────────

  function menu(x, y, itens) {
    vssh.dialogos.menuDeContexto(x, y, itens).then((id) => { if (id) executar(id); });
  }
  function menuNoBotao(botao, itens) {
    const r = botao.getBoundingClientRect();
    menu(r.left, r.top, itens);
  }

  function itensDoPalco() {
    const faixas = itensDeFaixas();
    return [
      { id: 'tocar', label: video.paused ? 'Reproduzir' : 'Pausar', disabled: !atual },
      { id: 'voltar', label: 'Voltar 10 segundos', disabled: !atual },
      { id: 'avancar', label: 'Avançar 10 segundos', disabled: !atual },
      { separator: true },
      { id: 'anterior', label: 'Anterior', disabled: !temAnterior() },
      { id: 'proximo', label: 'Próximo', disabled: !temProximo() },
      { separator: true },
      { id: 'veloc', label: 'Velocidade', submenu: itensDeVelocidade() },
      ...(faixas.length ? [{ id: 'faixas', label: 'Áudio e legendas', submenu: faixas }] : []),
      { separator: true },
      { id: 'tela', label: 'Tela cheia', checked: !!document.fullscreenElement },
      { id: 'pip', label: 'Janela flutuante', checked: !!document.pictureInPictureElement,
        disabled: !document.pictureInPictureEnabled || !atual || !atual.temVideo },
      { separator: true },
      { id: 'info', label: 'Informações do arquivo', disabled: !atual },
    ];
  }

  function itensDeMais() {
    return [
      { id: 'abrir', label: 'Abrir arquivo…', icon: 'folder' },
      { id: 'mostrar', label: 'Mostrar no gerenciador de arquivos', disabled: !atual },
      { separator: true },
      { id: 'pip', label: 'Janela flutuante', checked: !!document.pictureInPictureElement,
        disabled: !document.pictureInPictureEnabled || !atual || !atual.temVideo },
      { id: 'info', label: 'Informações do arquivo', disabled: !atual },
      { id: 'esquecer', label: 'Esquecer onde parei', disabled: !atual },
      { separator: true },
      { id: 'inicio', label: 'Voltar ao início', disabled: !atual },
      { id: 'sobre', label: 'Sobre o Palco' },
    ];
  }

  function executar(id) {
    if (id.startsWith('vel:')) return velocidade(parseFloat(id.slice(4)));
    if (id.startsWith('aud:')) return trocarAudio(parseInt(id.slice(4), 10));
    if (id.startsWith('leg:')) return trocarLegenda(parseInt(id.slice(4), 10));
    if (id.startsWith('fila:')) return abrirDaFila(parseInt(id.slice(5), 10));
    if (id.startsWith('pasta:')) { const it = fila[parseInt(id.slice(6), 10)]; if (it) mostrarNaPasta(it.caminho); return undefined; }
    if (id.startsWith('continuar:')) return abrir(id.slice(10));
    if (id.startsWith('esquecer:')) return esquecer(id.slice(9));
    const acoes = {
      abrir: escolherArquivo,
      mostrar: () => atual && mostrarNaPasta(atual.caminho),
      tocar: () => { if (!atual) return; if (video.paused) video.play().catch(() => {}); else video.pause(); },
      voltar: () => buscar(agoraReal() - 10),
      avancar: () => buscar(agoraReal() + 10),
      anterior,
      proximo,
      tela: telaCheia,
      pip: janelaFlutuante,
      info: informacoes,
      esquecer: () => { if (atual) { esquecer(atual.caminho); $('retomar').hidden = true; } },
      inicio: voltarAoInicio,
      sobre,
    };
    return (acoes[id] || (() => {}))();
  }

  $('btn-mais').addEventListener('click', (e) => menuNoBotao(e.currentTarget, itensDeMais()));
  $('btn-veloc').addEventListener('click', (e) => menuNoBotao(e.currentTarget, itensDeVelocidade()));
  $('btn-faixas').addEventListener('click', (e) => menuNoBotao(e.currentTarget, itensDeFaixas()));
  $('btn-anterior').addEventListener('click', anterior);
  $('btn-proximo').addEventListener('click', proximo);
  $('btn-voltar').addEventListener('click', () => buscar(agoraReal() - 10));
  $('btn-avancar').addEventListener('click', () => buscar(agoraReal() + 10));
  $('btn-tela').addEventListener('click', telaCheia);

  // O clique direito depende de onde caiu: numa linha da fila ou de "Continuar", ações sobre
  // aquele item; no palco ou no transporte, sobre o que toca. Sobre um campo de texto, o menu do
  // navegador (colar, selecionar tudo) serve melhor.
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    const linha = e.target.closest('.fila-item');
    if (linha) {
      e.preventDefault();
      const i = Number(linha.dataset.i);
      selecionar(i);
      menu(e.clientX, e.clientY, [
        { id: `fila:${i}`, label: 'Reproduzir' },
        { id: `pasta:${i}`, label: 'Mostrar no gerenciador de arquivos' },
      ]);
      return;
    }
    const recente = e.target.closest('.continuar-item');
    if (recente) {
      e.preventDefault();
      const c = recente.dataset.caminho;
      menu(e.clientX, e.clientY, [
        { id: `continuar:${c}`, label: 'Continuar' },
        { id: `esquecer:${c}`, label: 'Esquecer' },
      ]);
      return;
    }
    if (atual && e.target.closest('#palco, #transporte')) {
      e.preventDefault();
      menu(e.clientX, e.clientY, itensDoPalco());
    }
  });

  // Um clique no vídeo alterna tocar e pausar; um duplo-clique alterna a tela cheia. O clique
  // simples espera o intervalo de um duplo para não pausar e retomar a cada tela cheia.
  let cliqueNoVideo = null;
  video.addEventListener('click', () => {
    clearTimeout(cliqueNoVideo);
    cliqueNoVideo = setTimeout(() => executar('tocar'), 220);
  });
  video.addEventListener('dblclick', () => { clearTimeout(cliqueNoVideo); telaCheia(); });

  // ── Informações e sobre ─────────────────────────────────────────────────

  function informacoes() {
    if (!atual) return;
    const q = video.getVideoPlaybackQuality && video.getVideoPlaybackQuality();
    const modo = {
      direto: 'direto do servidor, sem conversão',
      remux: 'reembalado no servidor, sem recomprimir a imagem',
      audio: 'só o áudio é convertido no servidor',
      transcode: 'convertido no servidor',
    }[atual.modo] || atual.modo;
    const et = atual.etiquetas || {};
    const linhas = [
      atual.caminho,
      '',
      et.artista ? `Artista: ${et.artista}` : null,
      et.album ? `Álbum: ${et.album}` : null,
      atual.duracao ? `Duração: ${tempo(atual.duracao)}` : null,
      atual.largura ? `Imagem: ${atual.largura} × ${atual.altura}` : null,
      atual.audios.length ? `Faixas de áudio: ${atual.audios.length}` : null,
      atual.legendas.length ? `Legendas: ${atual.legendas.length}` : null,
      `Reprodução: ${modo}`,
      atual.modo !== 'direto' ? atual.motivo : null,
      // Os quadros perdidos respondem a "está travando?": o que o decodificador entregou e a tela
      // não conseguiu mostrar a tempo. Acima de 5% é o que se vê como travamento.
      q && q.totalVideoFrames
        ? `Quadros: ${q.totalVideoFrames} desenhados, ${q.droppedVideoFrames} perdidos`
          + ` (${numero(((q.droppedVideoFrames / q.totalVideoFrames) * 100).toFixed(1))}%)`
        : null,
    ].filter((x) => x !== null);
    vssh.dialogos.mostrar(linhas.join('\n'), semExtensao(atual.nome));
  }

  async function sobre() {
    let texto = 'Palco';
    try {
      const s = await api('saude');
      texto = [`Palco ${String(s.versao || '').replace(/\+.*$/, '')}`,
               s.gpu ? `Conversão por GPU (${s.gpu})` : 'Conversão pela CPU'].join('\n');
    } catch { /* fica o nome */ }
    vssh.dialogos.mostrar(texto, 'Sobre o Palco');
  }

  // ── Abrir, soltar, voltar ao início ─────────────────────────────────────

  async function escolherArquivo() {
    const p = await vssh.arquivos.escolherArquivo('Abrir no Palco',
      'Vídeo e música (*.mp4 *.m4v *.mkv *.webm *.avi *.mov *.wmv *.flv *.ts *.mpg *.mpeg *.ogv '
      + '*.mp3 *.m4a *.flac *.wav *.ogg *.opus *.aac *.wma *.mka);;Tudo (*)',
      atual ? atual.pasta : undefined);
    if (p) abrir(p);
  }
  $('btn-abrir').addEventListener('click', escolherArquivo);

  vssh.arquivos.aoSoltarArquivos((info) => {
    const caminho = (info.caminhos || [])[0];
    if (caminho) abrir(caminho);
  }, { alvo: janela });

  function voltarAoInicio() {
    marcar();
    geracao++;
    video.pause();
    video.removeAttribute('src');
    video.load();
    atual = null;
    fila = [];
    indice = -1;
    desenharFila();
    avisar('');
    preparando(false);
    mostrarRetomar(0);
    $('agora-titulo').textContent = 'Nada tocando';
    $('agora-sub').textContent = '';
    pintarCapa($('agora-capa'), { audio: false, capa: null });
    $('fila-pasta').textContent = '';
    document.title = 'Palco';
    vssh.app.lembrarRota('');
    pintarFaixas();
    pintarNavegacao();
    telaDoInicio();
  }

  // ── Teclado ─────────────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    const alvo = e.target;
    // Num campo de texto, espaço é espaço e as setas movem o cursor; na fila, as setas andam
    // pela lista.
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    if (alvo && alvo.closest && alvo.closest('.fila-lista') && /^(Arrow|Home|End|Enter)/.test(e.key)) return;
    if (alvo && alvo.getAttribute && alvo.getAttribute('role') === 'slider' && /^(Arrow|Home|End)/.test(e.key)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const teclas = {
      ' ': () => executar('tocar'),
      k: () => executar('tocar'),
      ArrowLeft: () => buscar(agoraReal() - 10),
      ArrowRight: () => buscar(agoraReal() + 10),
      j: () => buscar(agoraReal() - 30),
      l: () => buscar(agoraReal() + 30),
      ArrowUp: () => { video.volume = Math.min(1, video.volume + 0.05); video.muted = false; },
      ArrowDown: () => { video.volume = Math.max(0, video.volume - 0.05); },
      m: () => { video.muted = !video.muted; },
      f: telaCheia,
      p: janelaFlutuante,
      n: proximo,
      b: anterior,
      Home: () => buscar(0),
      End: () => buscar((duracaoReal() || 0) - 1),
    };
    const fn = teclas[e.key] || teclas[e.key.toLowerCase()];
    if (!fn) return;
    // Espaço sobre um botão já o aciona; tratar também aqui seria clicar duas vezes.
    if (e.key === ' ' && alvo && alvo.tagName === 'BUTTON') return;
    e.preventDefault();
    fn();
  });

  // ── A central de mídia e as teclas de mídia ─────────────────────────────
  //
  // O shell alcança este `<video>` sozinho e sabe tocar, pausar e buscar; o que ele não sabe é a
  // fila, e sem a declaração ele não desenha anterior e próximo.

  function porCentralDeMidia() {
    vssh.midia.transporte(temAnterior(), temProximo());
  }
  vssh.midia.ao('acao', ({ acao }) => (acao === 'anterior' ? anterior() : proximo()));

  function porMediaSession(titulo, sub, capa) {
    if (!('mediaSession' in navigator)) return;
    const artwork = capa ? [{ src: new URL(capa, document.baseURI).href, type: 'image/jpeg' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: titulo, artist: sub || 'Palco', artwork });
  }
  if ('mediaSession' in navigator) {
    const liga = (acao, fn) => { try { navigator.mediaSession.setActionHandler(acao, fn); } catch { /* não suportada */ } };
    liga('play', () => video.play());
    liga('pause', () => video.pause());
    liga('seekbackward', () => buscar(agoraReal() - 10));
    liga('seekforward', () => buscar(agoraReal() + 10));
    liga('previoustrack', anterior);
    liga('nexttrack', proximo);
  }

  // ── A porta de entrada ──────────────────────────────────────────────────
  //
  // O arquivo chega pelo evento `abertura`: o duplo-clique no gerenciador de arquivos, o "Abrir
  // com", o arraste de outro app. Uma janela que a sessão reabre chega com `?caminho=` na URL, e
  // volta ao mesmo arquivo, pausada no ponto onde a pessoa parou.

  vssh.app.ao('abertura', (ctx) => {
    if (ctx && ctx.caminho && ctx.tipo !== 'pasta') abrir(ctx.caminho);
  });

  porRepetir('nao');
  velocidade(1);
  pintarFaixas();
  pintarNavegacao();
  const restaurado = new URLSearchParams(location.search).get('caminho');
  if (restaurado) abrir(restaurado, { tocar: false });
  else telaDoInicio();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', montarPalco, { once: true });
} else {
  montarPalco();
}
