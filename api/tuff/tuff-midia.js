'use strict';

// Tuff: o comportamento das peças de mídia. Opt-in, como o CSS delas.
//
// Expõe `window.TuffMidia` com estas peças:
//
//     TuffMidia.player(raiz, video)   liga trilha, timecode, volume e o chrome que some
//     TuffMidia.onda(el, picos, op)   a forma de onda, com regiões de cor, que busca no clique
//     TuffMidia.grade(el, opcoes)     grade de miniaturas virtualizada
//     TuffMidia.visor(el, opcoes)     zoom, arraste e rotação de uma imagem
//     TuffMidia.tempo(segundos)       o timecode, como string
//     TuffMidia.imagem(url, opcoes)   a imagem pronta para o visor, com TIFF e HEIC decodificados
//     TuffMidia.decodificador()       o `TuffImagem`, para páginas e miniaturas sem desenhar nada
//
// Nasceu na biblioteca de componentes do toolkit de apps (`vssh-app-toolkit/lib/web/tuff/`); a
// fonte é esta, e um app o recebe como `_sdk/tuff/tuff-midia.js`. Sem build, e a única dependência
// é o decodificador ao lado (`tuff-imagem.js`), buscado só por `imagem()`. Nada aqui fala com o
// shell: são peças de navegador, e funcionam igual num app Node, num app Python e numa aba solta.
//
// ─── Por que estas peças ─────────────────────────────────────────────────────
//
// O que ninguém acerta sozinho é a grade que não trava com trinta mil arquivos, o scrub que não
// briga com o `timeupdate`, o chrome que não some com o foco do teclado dentro, o zoom que
// acompanha o ponteiro e o TIFF que o navegador não abre. Que botão fica onde, e o que o app faz
// ao abrir um arquivo, é do app, e um player pronto tomaria essa decisão por ele.

(function () {

  // ── Utilidades ─────────────────────────────────────────────────────────────

  const limitar = (v, min, max) => (v < min ? min : v > max ? max : v);

  /**
   * De segundos a `12:04` ou `1:02:04`.
   *
   * A hora só aparece quando existe: um `0:12:04` num clipe de dois minutos rouba largura e ensina
   * a ler um campo que nunca muda.
   */
  function tempo(segundos) {
    if (!isFinite(segundos) || segundos < 0) return '--:--';
    const s = Math.floor(segundos % 60);
    const m = Math.floor(segundos / 60) % 60;
    const h = Math.floor(segundos / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /** A fração 0–1 correspondente a um ponteiro sobre um elemento horizontal. */
  function fracaoDoPonteiro(el, clientX) {
    const r = el.getBoundingClientRect();
    return r.width ? limitar((clientX - r.left) / r.width, 0, 1) : 0;
  }

  // ── A trilha ───────────────────────────────────────────────────────────────

  /**
   * Monta as camadas da trilha dentro de um contêiner vazio e devolve os controles dela.
   *
   * As camadas são criadas aqui, e não pedidas ao HTML do app, porque a ordem delas é o desenho:
   * buffer embaixo, tocado em cima, marcas por último. Um app que montasse na ordem errada teria
   * uma trilha que parece funcionar e esconde o progresso atrás do buffer.
   */
  function montarTrilha(el) {
    el.innerHTML = '';
    const trilho = document.createElement('div');
    trilho.className = 'tuff-trilha-trilho';
    const buffer = document.createElement('div');
    buffer.className = 'tuff-trilha-buffer';
    const tocado = document.createElement('div');
    tocado.className = 'tuff-trilha-tocado';
    trilho.append(buffer, tocado);
    const polegar = document.createElement('div');
    polegar.className = 'tuff-trilha-polegar';
    const previa = document.createElement('div');
    previa.className = 'tuff-trilha-previa';
    el.append(trilho, polegar, previa);

    // `role="slider"` com os três `aria-value*`: sem eles um leitor de tela anuncia "botão" e não
    // diz onde o filme está. O `tabindex` é o que põe a trilha na ordem de tabulação; sem ele, um
    // teclado não alcança o controle mais usado do player.
    el.setAttribute('role', 'slider');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Posição');
    return { trilho, buffer, tocado, polegar, previa };
  }

  // ── O player ───────────────────────────────────────────────────────────────

  /**
   * Liga um `<video>` (ou `<audio>`) às peças que estiverem dentro de `raiz`.
   *
   * As peças são encontradas por atributo (`data-tuff-trilha`, `data-tuff-tempo`,
   * `data-tuff-tempo-atual`, `data-tuff-tempo-total`, `data-tuff-play`, `data-tuff-volume`,
   * `data-tuff-mudo`, `data-tuff-chrome`), e todas são opcionais. Um app que só quer a trilha põe
   * a trilha.
   *
   * O relógio tem duas formas, e a escolha é do desenho: `data-tuff-tempo` escreve `12:04 / 41:37`
   * num elemento só (o chrome sobre o vídeo); `-atual` e `-total` escrevem cada metade no seu
   * lugar, que é o que um transporte de dois andares quer: decorrido à esquerda da trilha, total
   * à direita, como em todo player de desktop.
   *
   * ─── `opcoes.tempo`: quando o `<video>` não sabe que horas são ─────────────
   *
   * Um vídeo que o servidor está remuxando ou mesclando chega por um cano: sem `Content-Length`
   * não há `Accept-Ranges`, e sem `Accept-Ranges` o `<video>` relata `duration: Infinity` e recusa
   * `currentTime =`. Com a régua do próprio elemento, a trilha fica sem tamanho e o arraste não
   * faz nada, e o app não tem como consertar por fora, porque quem lê `video.duration` é esta
   * função.
   *
   * As três funções são o mínimo: onde termina, onde está, e para onde ir.
   *
   * ```js
   * TuffMidia.player(raiz, video, {
   *   tempo: {
   *     duracao: () => 3617,                      // o ffprobe sabe, o <video> não
   *     atual:   () => base + video.currentTime,  // o cano começa onde o servidor cortou
   *     buscar:  (t) => trocarFonte(t),           // reinicia o ffmpeg com `-ss`
   *   },
   * });
   * ```
   *
   * Sem a opção, os valores vêm crus do elemento, inclusive o `NaN` que vira `--:--` antes dos
   * metadados. Cada função é opcional por si: dar só `duracao` já resolve o caso comum de o
   * servidor conhecer o tamanho e o cano não.
   *
   * O buffer é o único que precisa de tradução, e ela sai de graça: `video.buffered` fala nas
   * coordenadas do cano, e a diferença entre `atual()` e `video.currentTime` é o deslocamento
   * entre as duas réguas. Sem isso, a barra de carregado de um vídeo buscado aos 30 min apareceria
   * no começo da linha.
   *
   * Devolve `{ destruir() }`.
   */
  function player(raiz, video, opcoes) {
    const opts = opcoes || {};
    const achar = (attr) => raiz.querySelector(`[data-tuff-${attr}]`);
    const desfazer = [];
    const ouvir = (alvo, tipo, fn, op) => {
      alvo.addEventListener(tipo, fn, op);
      desfazer.push(() => alvo.removeEventListener(tipo, fn, op));
    };

    const elTrilha = achar('trilha');
    const elTempo = achar('tempo');
    // Duas pontas, e não uma. `data-tuff-tempo` escreve `12:04 / 41:37` num elemento só, que é o
    // que um chrome sobre o vídeo quer. Um transporte de dois andares quer o decorrido à esquerda
    // da trilha e o total à direita, onde todo player de desktop os põe; juntá-los no meio
    // desperdiça a largura que a trilha usaria.
    const elAtual = achar('tempo-atual');
    const elTotal = achar('tempo-total');
    const btPlay = achar('play');
    const elVolume = achar('volume');
    const btMudo = achar('mudo');
    const elChrome = achar('chrome');
    const capitulos = opts.capitulos || [];

    const t = elTrilha ? montarTrilha(elTrilha) : null;

    // ── A régua ───────────────────────────────────────────────────────────────
    //
    // Tudo daqui para baixo pergunta a hora a estas três, e nunca ao elemento. Elas devolvem o valor
    // cru, inclusive `NaN` antes dos metadados, porque quem chama já trata: `dur ? … : 0` e
    // `tempo()` viram `0` e `--:--` sozinhos. Clampear aqui trocaria o `--:--` de "ainda não sei"
    // por um `0:00` que afirma saber.
    const fonte = opts.tempo || null;
    const duracao = () => (fonte && fonte.duracao ? fonte.duracao() : video.duration);
    const agora = () => (fonte && fonte.atual ? fonte.atual() : video.currentTime);
    const buscar = (segundos) => {
      if (fonte && fonte.buscar) fonte.buscar(segundos);
      else video.currentTime = segundos;
    };

    // Enquanto o dedo está na trilha, o `timeupdate` do vídeo é ignorado. Sem isto os dois
    // escrevem a mesma posição em disputa: o vídeo relata onde está, o arraste diz para onde vai, e
    // o polegar pula para trás a cada quadro.
    let arrastando = false;

    function pintar() {
      if (!t) return;
      const dur = duracao();
      const frac = dur ? agora() / dur : 0;
      t.tocado.style.width = `${frac * 100}%`;
      t.polegar.style.left = `${frac * 100}%`;
      if (elTrilha) {
        elTrilha.setAttribute('aria-valuemin', '0');
        elTrilha.setAttribute('aria-valuemax', String(Math.floor(dur || 0)));
        elTrilha.setAttribute('aria-valuenow', String(Math.floor(agora() || 0)));
        elTrilha.setAttribute('aria-valuetext', tempo(agora()));
      }
      // O buffer mostrado é a faixa que contém o ponto atual, e não a última nem a maior. Um vídeo
      // em que a pessoa pulou para o meio tem várias faixas; pintar a errada afirma que já baixou
      // o que não baixou, e a barra some quando ela volta.
      //
      // A busca é nas coordenadas do elemento, que é o que `video.buffered` fala. O resultado é
      // levado para as da linha do tempo pelo deslocamento entre as duas réguas.
      let ate = null;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
          ate = video.buffered.end(i);
          break;
        }
      }
      // `ate` é `null`, e não `0`, quando faixa nenhuma contém o ponto: somar o deslocamento a um
      // zero pintaria a barra do começo até o corte do servidor, afirmando ter baixado o que sequer
      // foi pedido. Sem fonte de tempo o deslocamento é zero.
      const desloc = fonte ? ((agora() - video.currentTime) || 0) : 0;
      t.buffer.style.width = (dur && ate !== null)
        ? `${limitar(((ate + desloc) / dur) * 100, 0, 100)}%`
        : '0';
    }

    function pintarTempo() {
      if (elTempo) {
        elTempo.innerHTML = `<b>${tempo(agora())}</b> / ${tempo(duracao())}`;
      }
      if (elAtual) elAtual.textContent = tempo(agora());
      if (elTotal) elTotal.textContent = tempo(duracao());
    }

    function pintarCapitulos() {
      const dur = duracao();
      if (!t || !dur || !capitulos.length) return;
      for (const seg of capitulos) {
        if (seg <= 0 || seg >= dur) continue;
        const marca = document.createElement('div');
        marca.className = 'tuff-trilha-marca';
        marca.style.left = `${(seg / dur) * 100}%`;
        t.trilho.appendChild(marca);
      }
    }

    if (elTrilha) {
      const buscarPara = (clientX) => {
        const dur = duracao();
        if (!dur) return;
        buscar(fracaoDoPonteiro(elTrilha, clientX) * dur);
        pintar(); pintarTempo();
      };

      ouvir(elTrilha, 'pointerdown', (e) => {
        arrastando = true;
        elTrilha.classList.add('tuff-trilha--arrastando');
        // A captura é o que faz o arraste sobreviver ao ponteiro saindo da trilha. Sem ela, mover
        // 3px para cima no meio do gesto solta o controle no lugar errado.
        elTrilha.setPointerCapture(e.pointerId);
        buscarPara(e.clientX);
      });
      ouvir(elTrilha, 'pointermove', (e) => {
        const dur = duracao();
        if (dur) {
          const f = fracaoDoPonteiro(elTrilha, e.clientX);
          t.previa.style.left = `${f * 100}%`;
          t.previa.textContent = tempo(f * dur);
        }
        if (arrastando) buscarPara(e.clientX);
      });
      const soltar = (e) => {
        if (!arrastando) return;
        arrastando = false;
        elTrilha.classList.remove('tuff-trilha--arrastando');
        try { elTrilha.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
      };
      ouvir(elTrilha, 'pointerup', soltar);
      ouvir(elTrilha, 'pointercancel', soltar);

      // Teclado. 5 s é o passo que a maioria dos players usa e a memória muscular espera; Shift dá
      // o passo fino de 1 s, para achar um quadro sem sair do teclado.
      ouvir(elTrilha, 'keydown', (e) => {
        const passo = e.shiftKey ? 1 : 5;
        const dur = duracao();
        let alvo = null;
        if (e.key === 'ArrowRight') alvo = agora() + passo;
        else if (e.key === 'ArrowLeft') alvo = agora() - passo;
        else if (e.key === 'Home') alvo = 0;
        else if (e.key === 'End') alvo = dur;
        if (alvo === null) return;
        e.preventDefault();
        buscar(limitar(alvo, 0, dur || 0));
        pintar(); pintarTempo();
      });
    }

    if (btPlay) {
      ouvir(btPlay, 'click', () => { if (video.paused) video.play(); else video.pause(); });
      // O glifo só é escrito num botão vazio de elementos, e a checagem é feita uma vez, antes de
      // qualquer pintura. `textContent` apaga os filhos: um
      // `<button><svg><use href="#ico-play"></svg></button>`, que é o que `TuffIcones` manda
      // escrever, perderia o ícone no primeiro quadro e viraria um caractere solto no meio do
      // transporte.
      //
      // O `aria-label` é escrito sempre: ele é o nome do botão para quem não vê o glifo nem o
      // ícone, e é a metade que nenhum app deve ter de repetir.
      const temIcone = btPlay.firstElementChild !== null;
      const rotular = () => {
        btPlay.setAttribute('aria-label', video.paused ? 'Reproduzir' : 'Pausar');
        if (!temIcone) btPlay.textContent = video.paused ? '▶' : '❚❚';
      };
      ouvir(video, 'play', rotular);
      ouvir(video, 'pause', rotular);
      rotular();
    }

    if (elVolume) {
      const trilho = elVolume.querySelector('.tuff-volume-trilha') || elVolume;
      const nivel = elVolume.querySelector('.tuff-volume-nivel');
      const pintarVolume = () => {
        if (nivel) nivel.style.width = `${(video.muted ? 0 : video.volume) * 100}%`;
        elVolume.classList.toggle('tuff-volume--mudo', !!video.muted);
      };
      const ajustar = (clientX) => {
        video.volume = fracaoDoPonteiro(trilho, clientX);
        // Mexer no volume desliga o mudo. Ficar mudo enquanto a barra sobe é a interação que faz
        // todo mundo achar que o som quebrou.
        if (video.volume > 0) video.muted = false;
      };
      let ajustandoVol = false;
      ouvir(trilho, 'pointerdown', (e) => {
        ajustandoVol = true; trilho.setPointerCapture(e.pointerId); ajustar(e.clientX);
      });
      ouvir(trilho, 'pointermove', (e) => { if (ajustandoVol) ajustar(e.clientX); });
      ouvir(trilho, 'pointerup', () => { ajustandoVol = false; });
      ouvir(video, 'volumechange', pintarVolume);
      if (btMudo) ouvir(btMudo, 'click', () => { video.muted = !video.muted; });
      pintarVolume();
    }

    // ── O chrome que some ────────────────────────────────────────────────────
    //
    // Ele nunca some com o foco do teclado dentro dele. Sumir ali deixaria quem navega por teclado
    // sem controle nenhum e sem caminho de volta: a pessoa está com o foco num botão que deixou de
    // existir na tela. É a regra que separa esta peça de uma armadilha, e ela não tem como ser
    // descoberta testando com o mouse.
    //
    // Também não some com o vídeo pausado: pausado, a tela é uma imagem parada, e esconder os
    // controles de uma imagem parada não protege nada.
    let cronometro = null;
    if (elChrome) {
      const OCIO = opts.ocioMs || 2500;
      const palco = achar('palco') || raiz;

      const mostrar = () => {
        elChrome.classList.remove('tuff-chrome--oculto');
        palco.classList.remove('tuff-palco--limpo');
      };
      const podeSumir = () =>
        !video.paused && !arrastando && !elChrome.contains(document.activeElement);
      const agendar = () => {
        clearTimeout(cronometro);
        mostrar();
        cronometro = setTimeout(() => {
          if (!podeSumir()) return agendar();
          elChrome.classList.add('tuff-chrome--oculto');
          palco.classList.add('tuff-palco--limpo');
        }, OCIO);
      };

      ouvir(raiz, 'pointermove', agendar);
      ouvir(raiz, 'pointerleave', () => { if (podeSumir()) agendar(); });
      ouvir(video, 'pause', mostrar);
      ouvir(video, 'play', agendar);
      // `focusin` borbulha (o `focus` não), e é o que traz o chrome de volta quando alguém chega
      // nele com Tab estando ele oculto.
      ouvir(elChrome, 'focusin', mostrar);
      agendar();
    }

    ouvir(video, 'timeupdate', () => { if (!arrastando) { pintar(); pintarTempo(); } });
    ouvir(video, 'progress', pintar);
    ouvir(video, 'loadedmetadata', () => { pintar(); pintarTempo(); pintarCapitulos(); });
    pintar(); pintarTempo(); pintarCapitulos();

    return {
      destruir() {
        clearTimeout(cronometro);
        for (const f of desfazer) f();
      },
    };
  }

  // ── A forma de onda ────────────────────────────────────────────────────────

  /**
   * A forma de onda de um áudio: os picos que o app mediu, desenhados como barras num `canvas`, com
   * o trecho tocado aceso, o resto apagado e a posição atual numa linha. Clique e arraste buscam, e
   * a peça é um `slider` para o teclado, com os passos da trilha (5 s, e 1 s com Shift).
   *
   * `picos` são valores de 0 a 1, igualmente espaçados do começo ao fim do áudio; quem os mede é o
   * app (no Escriba, o backend, pelo ffmpeg). Opções:
   *
   *   midia      o `<audio>` ou `<video>`: a onda acompanha o tempo dele, e busca nele.
   *   tempo      `{ duracao, atual, buscar }`, a mesma régua de `player(…, { tempo })`. Com ela, a
   *              onda e a trilha leem e escrevem o mesmo tempo, e nunca discordam.
   *   duracao    os segundos do áudio, até a mídia dizer os dela: sem isto, a onda de um arquivo
   *              longo fica sem posição até os metadados chegarem.
   *   regioes    `[{ inicio, fim, cor }]`, trechos pintados com uma cor CSS (uma variável serve),
   *              como os falantes de uma transcrição. O que fica fora de toda região é neutro.
   *
   * Devolve `{ pintar, definir, destruir }`. `definir({ picos, regioes, duracao })` troca o que
   * mudou e redesenha.
   *
   * As barras têm largura fixa: uma janela mais larga mostra mais barras, em vez de barras mais
   * gordas, e cada barra é o maior pico do trecho dela. A altura é a raiz do pico, que levanta a
   * fala baixa; em escala linear, metade das falas de um áudio de campo vira um risco.
   */
  function onda(el, picos, opcoes) {
    const o = opcoes || {};
    const BARRA = 2;
    const VAO = 1;
    const ACESO = 1;
    const APAGADO = 0.38;
    let valores = Array.isArray(picos) ? picos : [];
    let regioes = o.regioes || [];
    let duracaoDada = o.duracao || 0;
    const video = o.midia || null;
    const fonte = o.tempo || null;

    const duracao = () => {
      const d = fonte && fonte.duracao ? fonte.duracao() : video && video.duration;
      return Number.isFinite(d) && d > 0 ? d : duracaoDada;
    };
    const agora = () => (fonte && fonte.atual ? fonte.atual() : video ? video.currentTime : 0) || 0;
    const buscar = (segundos) => {
      if (fonte && fonte.buscar) fonte.buscar(segundos);
      else if (video) video.currentTime = segundos;
    };

    el.classList.add('tuff-onda');
    el.innerHTML = '';
    const canvas = document.createElement('canvas');
    const previa = document.createElement('div');
    previa.className = 'tuff-onda-previa';
    el.append(canvas, previa);
    el.setAttribute('role', 'slider');
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Posição');
    const ctx = canvas.getContext('2d');

    let largura = 0;
    let altura = 0;
    let neutra = '';
    let cabeca = '';
    let cores = [];
    let quadro = 0;
    let arrastando = false;

    // As cores das regiões chegam como CSS (`var(--x)`, um nome, um hex) e o canvas só entende a
    // cor resolvida. Um elemento de prova resolve cada uma pelo `getComputedStyle`, uma vez por
    // `definir`, e não a cada barra de cada quadro.
    function resolverCores() {
      const prova = document.createElement('span');
      prova.style.display = 'none';
      el.appendChild(prova);
      const resolver = (cor) => {
        prova.style.color = '';
        prova.style.color = cor;
        return getComputedStyle(prova).color;
      };
      const estilo = getComputedStyle(el);
      neutra = resolver(estilo.getPropertyValue('--ds-text-dim').trim() || 'gray');
      cabeca = resolver(estilo.getPropertyValue('--ds-text').trim() || 'white');
      cores = regioes.map((r) => (r && r.cor ? resolver(r.cor) : neutra));
      prova.remove();
    }

    function medir() {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      largura = Math.max(1, Math.round(r.width));
      altura = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(largura * dpr);
      canvas.height = Math.round(altura * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pintar();
    }

    /** O índice da região que contém `t`, ou -1. As regiões chegam em ordem de início. */
    function regiaoEm(t) {
      let a = 0;
      let b = regioes.length - 1;
      let achada = -1;
      while (a <= b) {
        const m = (a + b) >> 1;
        if (regioes[m].inicio <= t) { achada = m; a = m + 1; } else b = m - 1;
      }
      return achada >= 0 && t <= regioes[achada].fim ? achada : -1;
    }

    function pintar() {
      ctx.clearRect(0, 0, largura, altura);
      const dur = duracao();
      const n = Math.max(1, Math.floor(largura / (BARRA + VAO)));
      const pos = dur ? limitar(agora() / dur, 0, 1) : 0;
      const meio = altura / 2;
      for (let i = 0; i < n; i++) {
        let v = 0;
        if (valores.length) {
          const a = Math.floor((i * valores.length) / n);
          const b = Math.max(a + 1, Math.floor(((i + 1) * valores.length) / n));
          for (let k = a; k < b && k < valores.length; k++) if (valores[k] > v) v = valores[k];
        }
        const h = Math.max(2, Math.sqrt(limitar(v, 0, 1)) * (altura - 2));
        const centro = (i + 0.5) / n;
        const r = dur ? regiaoEm(centro * dur) : -1;
        ctx.globalAlpha = centro <= pos ? ACESO : APAGADO;
        ctx.fillStyle = r >= 0 ? cores[r] : neutra;
        ctx.fillRect(i * (BARRA + VAO), meio - h / 2, BARRA, h);
      }
      ctx.globalAlpha = 1;
      if (dur) {
        ctx.fillStyle = cabeca;
        ctx.fillRect(Math.round(pos * (largura - 1)), 0, 1, altura);
      }
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(Math.floor(dur)));
      el.setAttribute('aria-valuenow', String(Math.floor(agora())));
      el.setAttribute('aria-valuetext', tempo(agora()));
    }

    // Tocando, um quadro por pintura de tela: o `timeupdate` chega umas quatro vezes por segundo, e
    // a linha andaria aos saltos.
    function laco() {
      pintar();
      if (video && !video.paused) quadro = requestAnimationFrame(laco);
    }

    const desfazer = [];
    const ouvir = (alvo, tipo, fn, op) => {
      alvo.addEventListener(tipo, fn, op);
      desfazer.push(() => alvo.removeEventListener(tipo, fn, op));
    };

    const irPara = (clientX) => {
      const dur = duracao();
      if (!dur) return;
      buscar(fracaoDoPonteiro(el, clientX) * dur);
      pintar();
    };
    ouvir(el, 'pointerdown', (e) => {
      arrastando = true;
      el.classList.add('tuff-onda--arrastando');
      el.setPointerCapture(e.pointerId);
      irPara(e.clientX);
    });
    ouvir(el, 'pointermove', (e) => {
      const dur = duracao();
      if (dur) {
        const f = fracaoDoPonteiro(el, e.clientX);
        previa.style.left = `${f * 100}%`;
        previa.textContent = tempo(f * dur);
      }
      if (arrastando) irPara(e.clientX);
    });
    const soltar = (e) => {
      if (!arrastando) return;
      arrastando = false;
      el.classList.remove('tuff-onda--arrastando');
      try { el.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
    };
    ouvir(el, 'pointerup', soltar);
    ouvir(el, 'pointercancel', soltar);
    ouvir(el, 'keydown', (e) => {
      const dur = duracao();
      const passo = e.shiftKey ? 1 : 5;
      let alvo = null;
      if (e.key === 'ArrowRight') alvo = agora() + passo;
      else if (e.key === 'ArrowLeft') alvo = agora() - passo;
      else if (e.key === 'Home') alvo = 0;
      else if (e.key === 'End') alvo = dur;
      if (alvo === null) return;
      e.preventDefault();
      buscar(limitar(alvo, 0, dur || 0));
      pintar();
    });
    if (video) {
      ouvir(video, 'play', () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(laco); });
      ouvir(video, 'pause', pintar);
      ouvir(video, 'seeked', pintar);
      ouvir(video, 'timeupdate', () => { if (video.paused) pintar(); });
      ouvir(video, 'loadedmetadata', pintar);
    }

    const observador = new ResizeObserver(medir);
    observador.observe(el);
    resolverCores();
    medir();

    return {
      pintar,
      definir(novo) {
        const n = novo || {};
        if (n.picos) valores = n.picos;
        if (n.regioes) regioes = n.regioes;
        if (n.duracao) duracaoDada = n.duracao;
        if (n.regioes) resolverCores();
        pintar();
      },
      destruir() {
        cancelAnimationFrame(quadro);
        observador.disconnect();
        for (const f of desfazer) f();
        el.classList.remove('tuff-onda', 'tuff-onda--arrastando');
        el.innerHTML = '';
      },
    };
  }

  // ── A grade virtualizada ───────────────────────────────────────────────────

  /**
   * Grade de miniaturas que aguenta uma pasta de verdade.
   *
   * É a peça mais importante deste arquivo, e a que parece a mais dispensável. Uma pasta de fotos
   * tem dezenas de milhares de arquivos; montar um `<img>` para cada um trava a aba na abertura e
   * não se recupera, e o autor do app só descobre isso no diretório de alguém, nunca no dele. Aqui
   * o DOM guarda só o que está visível (mais uma fileira de folga em cada ponta), e o
   * `.tuff-grade-fuso` dá ao contêiner a altura que a barra de rolagem precisa ter.
   *
   * `montar(indice, no)` é chamada toda vez que um nó é reusado para outro índice. Ela recebe o nó
   * já posicionado e só precisa preencher o conteúdo.
   *
   * Devolve `{ atualizar(total), selecionar(i), redimensionar(largura, altura), destruir() }`.
   */
  function grade(el, opcoes) {
    const o = opcoes || {};
    let larguraItem = o.largura || 160;
    let alturaItem = o.altura || 120;
    const espaco = o.gap != null ? o.gap : 8;
    const montar = o.montar || (() => {});
    let total = o.total || 0;
    let selecionado = -1;

    el.classList.add('tuff-grade');
    const fuso = document.createElement('div');
    fuso.className = 'tuff-grade-fuso';
    el.innerHTML = '';
    el.appendChild(fuso);

    const pool = [];        // nós vivos, reaproveitados entre rolagens
    let colunas = 1;

    function medir() {
      const largura = el.clientWidth || larguraItem;
      colunas = Math.max(1, Math.floor((largura + espaco) / (larguraItem + espaco)));
      const linhas = Math.ceil(total / colunas);
      fuso.style.height = `${Math.max(0, linhas * (alturaItem + espaco) - espaco)}px`;
    }

    function desenhar() {
      const alturaLinha = alturaItem + espaco;
      const topo = el.scrollTop;
      const visivel = el.clientHeight || alturaLinha;
      // Uma fileira de folga em cada ponta: sem ela, rolar depressa mostra o fundo por um quadro
      // antes de o nó aparecer, e o efeito é de imagem piscando.
      const primeira = Math.max(0, Math.floor(topo / alturaLinha) - 1);
      const ultima = Math.min(
        Math.ceil(total / colunas) - 1,
        Math.floor((topo + visivel) / alturaLinha) + 1);

      const precisa = Math.max(0, (ultima - primeira + 1) * colunas);
      while (pool.length < precisa) {
        const no = document.createElement('div');
        no.className = 'tuff-miniatura';
        no.setAttribute('role', 'option');
        no.tabIndex = -1;
        fuso.appendChild(no);
        pool.push(no);
      }

      let k = 0;
      for (let linha = primeira; linha <= ultima; linha++) {
        for (let col = 0; col < colunas; col++) {
          const i = linha * colunas + col;
          const no = pool[k++];
          if (!no) continue;
          if (i >= total) { no.style.display = 'none'; continue; }
          no.style.display = '';
          no.style.width = `${larguraItem}px`;
          no.style.height = `${alturaItem}px`;
          no.style.transform =
            `translate(${col * (larguraItem + espaco)}px, ${linha * alturaLinha}px)`;
          no.setAttribute('aria-selected', String(i === selecionado));
          if (no.__indice !== i) { no.__indice = i; montar(i, no); }
        }
      }
      for (; k < pool.length; k++) pool[k].style.display = 'none';
    }

    function selecionar(i, comFoco) {
      selecionado = limitar(i, 0, Math.max(0, total - 1));
      // Rolar até o item antes de desenhar: o nó do índice novo pode nem existir ainda.
      const linha = Math.floor(selecionado / colunas);
      const y = linha * (alturaItem + espaco);
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + alturaItem > el.scrollTop + el.clientHeight) {
        el.scrollTop = y + alturaItem - el.clientHeight;
      }
      desenhar();
      if (comFoco) {
        const no = pool.find((n) => n.__indice === selecionado && n.style.display !== 'none');
        if (no) no.focus();
      }
      if (o.aoSelecionar) o.aoSelecionar(selecionado);
    }

    const aoRolar = () => desenhar();
    el.addEventListener('scroll', aoRolar, { passive: true });

    // `ResizeObserver` e não `window.onresize`: a grade pode estar num painel que muda de largura
    // sem a janela mudar de tamanho, como um divisor arrastado ou uma barra lateral que abre.
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => { medir(); desenhar(); });
      ro.observe(el);
    }

    const aoClicar = (e) => {
      const no = e.target.closest('.tuff-miniatura');
      if (no && no.__indice != null) selecionar(no.__indice, true);
    };
    el.addEventListener('click', aoClicar);

    /**
     * Abrir com duplo-clique, e não só com Enter. Não há gerenciador de arquivos, visualizador de
     * fotos ou grade de mídia em que duplo-clique não abra: é o gesto mais estabelecido que existe
     * para "quero este". Com `aoAbrir` ligado só ao Enter, o mouse seleciona e para ali, e quem usa
     * conclui que o app é que não implementou.
     */
    const aoDuplo = (e) => {
      const no = e.target.closest('.tuff-miniatura');
      if (no && no.__indice != null && o.aoAbrir) o.aoAbrir(no.__indice);
    };
    el.addEventListener('dblclick', aoDuplo);

    // Tabulação itinerante: a grade inteira é um ponto de parada do Tab, e as setas andam dentro
    // dela. Trinta mil paradas de Tab são uma armadilha.
    const aoTeclar = (e) => {
      const mapa = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: colunas, ArrowUp: -colunas };
      if (e.key === 'Home') { e.preventDefault(); return selecionar(0, true); }
      if (e.key === 'End') { e.preventDefault(); return selecionar(total - 1, true); }
      if (e.key === 'Enter' && o.aoAbrir && selecionado >= 0) { e.preventDefault(); return o.aoAbrir(selecionado); }
      const d = mapa[e.key];
      if (!d) return;
      e.preventDefault();
      selecionar((selecionado < 0 ? 0 : selecionado) + d, true);
    };
    el.addEventListener('keydown', aoTeclar);
    el.setAttribute('role', 'listbox');
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;

    medir(); desenhar();

    /**
     * Outro tamanho de item, com o primeiro item visível continuando no topo: sem isso, ampliar as
     * miniaturas no meio de uma pasta de mil fotos jogaria a pessoa para outro trecho dela. Todo nó
     * é montado de novo, porque o app pode querer uma miniatura maior para o item maior.
     */
    function redimensionar(largura, altura) {
      const primeiro = Math.floor(el.scrollTop / (alturaItem + espaco)) * colunas;
      larguraItem = largura;
      alturaItem = altura;
      medir();
      el.scrollTop = Math.floor(primeiro / colunas) * (alturaItem + espaco);
      for (const no of pool) no.__indice = null;
      desenhar();
    }

    return {
      atualizar(n) { total = n; medir(); desenhar(); },
      selecionar(i) { selecionar(i, false); },
      redimensionar,
      destruir() {
        el.removeEventListener('scroll', aoRolar);
        el.removeEventListener('click', aoClicar);
        el.removeEventListener('dblclick', aoDuplo);
        el.removeEventListener('keydown', aoTeclar);
        if (ro) ro.disconnect();
      },
    };
  }

  // ── O visor ────────────────────────────────────────────────────────────────

  /**
   * Zoom, arraste e rotação sobre o primeiro filho de `el` (uma `img`, um `canvas`, um `video`).
   *
   * Sem inércia, por escolha. Um visualizador aqui é ferramenta de trabalho (comparar duas regiões
   * de uma imagem científica, ler uma etiqueta), e uma imagem que continua deslizando depois que a
   * mão parou se lê como perda de controle. O momento que existe no trackpad já vem do sistema,
   * pela roda; o que se somaria é só no arraste com botão, onde ninguém pede.
   *
   * A escala que entra e sai é em pixels do MONITOR: `1` põe um pixel da imagem num pixel da tela,
   * que é o que "100%" quer dizer num visualizador de fotos. Em pixel CSS, uma tela a 150% mostraria
   * a foto "a 100%" com cada pixel dela esticado em um e meio, borrada no único zoom em que a pessoa
   * foi conferir nitidez.
   *
   * `opcoes`:
   *   min, max    os limites da escala. `min` padrão é a escala de caber na janela, porque afastar
   *               além dela só encolhe a imagem num canto; `max` padrão 40.
   *   passo       o fator de `ampliar()` e `reduzir()`, e das teclas + e −. Padrão 1.25.
   *   aoMudar     chamada com `{ escala, rotacao, ajustada }` quando a escala ou a rotação mudam.
   *
   * Devolve `{ ajustar, cem, ampliar, reduzir, definir, girar, trocar, escala, rotacao, ajustada,
   * destruir }`.
   */
  function visor(el, opcoes) {
    const o = opcoes || {};
    const maxEscala = o.max || 40;
    const passo = o.passo || 1.25;
    el.classList.add('tuff-visor');
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;

    let conteudo = el.querySelector('.tuff-visor-conteudo');
    if (!conteudo) {
      conteudo = document.createElement('div');
      conteudo.className = 'tuff-visor-conteudo';
      while (el.firstChild) conteudo.appendChild(el.firstChild);
      el.appendChild(conteudo);
    }

    // O estado é em pixel CSS (`s`), que é o que o `transform` entende; a conversão para pixel do
    // monitor acontece só na borda, em `escala()` e `definir()`.
    //
    // `giro` acumula os graus sem voltar a zero, para a transição de 270 para 360 andar noventa
    // graus no sentido do clique em vez de voltar trezentos e sessenta no outro.
    let s = 1, x = 0, y = 0, giro = 0;
    // Enquanto a pessoa não mexe no zoom, a imagem acompanha a janela: redimensionar, girar ou
    // trocar de imagem volta a caber. O primeiro gesto de zoom solta a imagem da janela.
    let seguirAjuste = true;
    let avisado = null;

    const dpr = () => window.devicePixelRatio || 1;
    const rot = () => ((giro % 360) + 360) % 360;

    const tamanho = () => {
      const alvo = conteudo.firstElementChild;
      // O `canvas` pelo tamanho intrínseco, que é o da imagem decodificada; o `offsetWidth` dele
      // muda com qualquer CSS que o app puser.
      const tela = alvo && alvo.tagName === 'CANVAS';
      return {
        w: (alvo && (alvo.naturalWidth || alvo.videoWidth || (tela && alvo.width) || alvo.offsetWidth)) || conteudo.offsetWidth || 1,
        h: (alvo && (alvo.naturalHeight || alvo.videoHeight || (tela && alvo.height) || alvo.offsetHeight)) || conteudo.offsetHeight || 1,
      };
    };
    // A caixa da imagem já girada: de lado, a largura é a altura.
    const caixa = () => {
      const { w, h } = tamanho();
      return rot() % 180 ? { w: h, h: w } : { w, h };
    };

    /**
     * Onde fica, na caixa girada, o ponto `(u, v)` da imagem sem giro, e o caminho de volta.
     * É o `rotate` do CSS em torno da origem seguido do deslocamento que devolve a caixa ao
     * quadrante positivo; `aplicar` monta o mesmo par.
     */
    const naCaixa = (u, v) => {
      const { w, h } = tamanho();
      switch (rot()) {
        case 90: return { bx: h - v, by: u };
        case 180: return { bx: w - u, by: h - v };
        case 270: return { bx: v, by: w - u };
        default: return { bx: u, by: v };
      }
    };
    const daCaixa = (bx, by) => {
      const { w, h } = tamanho();
      switch (rot()) {
        case 90: return { u: by, v: h - bx };
        case 180: return { u: w - bx, v: h - by };
        case 270: return { u: w - by, v: bx };
        default: return { u: bx, v: by };
      }
    };
    const deslocamento = () => {
      const { w, h } = tamanho();
      return { 90: [h, 0], 180: [w, h], 270: [0, w] }[rot()] || [0, 0];
    };

    const escalaDeAjuste = () => {
      const { w, h } = caixa();
      // Caber na janela sem passar de 1:1: um ícone de 32 pixels esticado até a janela vira um
      // borrão, e o que a pessoa quer ver dele é o desenho.
      return Math.min(el.clientWidth / w, el.clientHeight / h, 1 / dpr());
    };
    const piso = () => (o.min ? o.min / dpr() : escalaDeAjuste());
    const teto = () => maxEscala / dpr();

    // A imagem não sai da janela. Menor que a janela num eixo, ela fica no centro desse eixo;
    // maior, a borda dela não descola da borda da janela. Tudo passa por aqui, então nenhum
    // caminho (roda, arraste, teclado, rotação, janela redimensionada) solta a imagem no vazio.
    const prender = () => {
      const { w, h } = caixa();
      const W = w * s, H = h * s, cx = el.clientWidth, cy = el.clientHeight;
      x = W <= cx ? (cx - W) / 2 : limitar(x, cx - W, 0);
      y = H <= cy ? (cy - H) / 2 : limitar(y, cy - H, 0);
    };

    const ajustada = () => Math.abs(s - escalaDeAjuste()) < 1e-6;
    const avisar = () => {
      if (!o.aoMudar) return;
      const agora = { escala: s * dpr(), rotacao: rot(), ajustada: ajustada() };
      if (avisado && avisado.escala === agora.escala && avisado.rotacao === agora.rotacao
          && avisado.ajustada === agora.ajustada) return;
      avisado = agora;
      o.aoMudar({ ...agora });
    };

    const aplicar = () => {
      prender();
      const [tx, ty] = deslocamento();
      conteudo.style.transform =
        `translate(${x}px, ${y}px) scale(${s}) translate(${tx}px, ${ty}px) rotate(${giro}deg)`;
      avisar();
    };

    // `will-change` só durante o gesto. Com ele fixo, o Chrome rasteriza a camada uma vez e depois
    // só estica o bitmap, e a foto ampliada a 400% fica borrada; tirado ao fim do gesto, ele
    // rasteriza de novo na escala final, e o pixel aparece nítido.
    let fimDoGesto = null;
    const emGesto = () => {
      el.classList.add('tuff-visor--movendo');
      clearTimeout(fimDoGesto);
      fimDoGesto = setTimeout(() => el.classList.remove('tuff-visor--movendo'), 200);
    };
    const suave = (fn) => {
      el.classList.add('tuff-visor--suave');
      fn();
      aplicar();
      setTimeout(() => el.classList.remove('tuff-visor--suave'), 200);
    };

    /**
     * Nova escala CSS com o ponto `(px, py)` de `el` parado sob o ponteiro. Chegar à escala de
     * caber na janela, afastando até o fim, devolve a imagem ao modo que acompanha a janela.
     */
    const escalarEm = (nova, px, py) => {
      nova = limitar(nova, Math.min(piso(), s), teto());
      const k = nova / s;
      x = px - (px - x) * k;
      y = py - (py - y) * k;
      s = nova;
      seguirAjuste = Math.abs(s - escalaDeAjuste()) < 1e-6;
    };
    const centro = () => ({ px: el.clientWidth / 2, py: el.clientHeight / 2 });

    function ajustarJa() {
      seguirAjuste = true;
      s = escalaDeAjuste();
      aplicar();
    }
    function ajustar() { suave(() => { seguirAjuste = true; s = escalaDeAjuste(); }); }
    /** 1:1 em pixel do monitor, com o ponto `ponto` de `el` parado (o centro, sem ponto). */
    function cem(ponto) {
      const { px, py } = ponto ? { px: ponto.x, py: ponto.y } : centro();
      suave(() => escalarEm(1 / dpr(), px, py));
    }
    function definir(escala, ponto) {
      const { px, py } = ponto ? { px: ponto.x, py: ponto.y } : centro();
      escalarEm(escala / dpr(), px, py);
      aplicar();
    }
    const ampliar = () => suave(() => { const c = centro(); escalarEm(s * passo, c.px, c.py); });
    const reduzir = () => suave(() => { const c = centro(); escalarEm(s / passo, c.px, c.py); });

    /**
     * Noventa graus no sentido horário (`sentido` 1) ou anti-horário (-1). Ajustada, a imagem
     * continua cabendo na janela; ampliada, o ponto que estava no centro da janela continua lá.
     */
    function girar(sentido) {
      const c = centro();
      const { u, v } = daCaixa((c.px - x) / s, (c.py - y) / s);
      suave(() => {
        giro += sentido < 0 ? -90 : 90;
        if (seguirAjuste) { s = escalaDeAjuste(); return; }
        const { bx, by } = naCaixa(u, v);
        x = c.px - bx * s;
        y = c.py - by * s;
      });
    }

    /**
     * Troca o conteúdo sem recriar o visor, e a imagem nova volta a caber na janela, sem giro.
     * Uma `img` que ainda não carregou fica escondida até ter tamanho: ajustar antes disso
     * mediria 0×0.
     */
    function trocar(novo) {
      conteudo.replaceChildren(novo);
      giro = 0;
      quandoTiverTamanho(novo, ajustarJa);
    }
    function quandoTiverTamanho(alvo, fn) {
      if (alvo && alvo.tagName === 'IMG' && !(alvo.complete && alvo.naturalWidth)) {
        conteudo.style.visibility = 'hidden';
        const pronto = () => { conteudo.style.visibility = ''; fn(); };
        alvo.addEventListener('load', pronto, { once: true });
        alvo.addEventListener('error', () => { conteudo.style.visibility = ''; }, { once: true });
        return;
      }
      fn();
    }

    // ── A roda e a pinça ──
    //
    // O fator é proporcional ao `deltaY`, e é o que separa a pinça do trackpad da roda do mouse.
    // O Chrome entrega a pinça como `wheel` com `ctrlKey` e um `deltaY` de poucos pixels por
    // evento, dezenas de eventos por gesto; um passo fixo por evento transformava um movimento
    // curto dos dedos num salto de 300%. A fórmula é a do d3-zoom: um dente de roda (100 pixels)
    // dá cerca de 15%, e a pinça, dez vezes mais sensível por pixel, acompanha os dedos.
    // O zoom é no ponteiro: o ponto sob o cursor fica sob o cursor.
    const aoRodar = (e) => {
      e.preventDefault();
      const porModo = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      const expoente = limitar(-e.deltaY * porModo * (e.ctrlKey ? 10 : 1), -1, 1);
      const r = el.getBoundingClientRect();
      escalarEm(s * Math.pow(2, expoente), e.clientX - r.left, e.clientY - r.top);
      emGesto();
      aplicar();
    };
    el.addEventListener('wheel', aoRodar, { passive: false });

    // ── O arraste, e a pinça numa tela de toque ──
    //
    // Um dedo ou o botão do mouse arrasta. Dois dedos ampliam pela razão entre as distâncias e
    // arrastam pelo ponto médio, os dois ao mesmo tempo, como numa foto de celular.
    //
    // O gesto só começa sobre a imagem ou sobre o fundo do visor. Um botão posto por cima dele
    // (anterior, próximo) recebe o próprio clique: com a captura do ponteiro no visor, o `click`
    // cairia no visor, e o botão nunca responderia.
    const ponteiros = new Map();
    let gestoAnterior = null;
    const doVisor = (e) => e.target === el || conteudo.contains(e.target);
    const medirGesto = () => {
      const [a, b] = [...ponteiros.values()];
      const r = el.getBoundingClientRect();
      if (!b) return { mx: a.x - r.left, my: a.y - r.top, d: 0 };
      return { mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top,
               d: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const aoDescer = (e) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || !doVisor(e)) return;
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gestoAnterior = medirGesto();
      el.classList.add('tuff-visor--arrastando');
      try { el.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    };
    const aoMover = (e) => {
      if (!ponteiros.has(e.pointerId)) return;
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const agora = medirGesto();
      if (agora.d && gestoAnterior.d) {
        escalarEm(s * (agora.d / gestoAnterior.d), gestoAnterior.mx, gestoAnterior.my);
      }
      x += agora.mx - gestoAnterior.mx;
      y += agora.my - gestoAnterior.my;
      gestoAnterior = agora;
      emGesto();
      aplicar();
    };
    const aoSubir = (e) => {
      if (!ponteiros.delete(e.pointerId)) return;
      try { el.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
      if (ponteiros.size) gestoAnterior = medirGesto();
      else el.classList.remove('tuff-visor--arrastando');
    };
    el.addEventListener('pointerdown', aoDescer);
    el.addEventListener('pointermove', aoMover);
    el.addEventListener('pointerup', aoSubir);
    el.addEventListener('pointercancel', aoSubir);
    // Uma `img` é arrastável por padrão: poucos pixels depois do `pointerdown` o navegador começa a
    // arrastar a imagem para fora, cancela os ponteiros, e a foto para no meio do gesto com um
    // fantasma dela preso no cursor.
    const aoArrastarNativo = (e) => { if (doVisor(e)) e.preventDefault(); };
    el.addEventListener('dragstart', aoArrastarNativo);

    // Duplo-clique alterna entre "cabe na janela" e "1:1", e o 1:1 abre no ponto clicado. São as
    // duas escalas que se quer de volta depois de explorar, e ter as duas num gesto só dispensa
    // dois botões.
    const aoDuplo = (e) => {
      if (!doVisor(e)) return;
      if (ajustada()) {
        const r = el.getBoundingClientRect();
        cem({ x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        ajustar();
      }
    };
    el.addEventListener('dblclick', aoDuplo);

    // ── O teclado, com o foco no visor ──
    //
    // + e − ampliam e reduzem, 0 volta a caber e 1 vai a 1:1, com ou sem Ctrl: com Ctrl, o
    // navegador ampliaria a página inteira em volta do visor. As setas movem a imagem só no eixo
    // em que ela é maior que a janela; no outro eixo não há para onde mover, e a seta segue para
    // quem estiver em volta (um app usa ← e → para a foto anterior e a seguinte), com o
    // `defaultPrevented` dizendo quando o visor ficou com ela.
    const aoTeclar = (e) => {
      if (e.altKey) return;
      const k = e.key;
      const acao = {
        '+': ampliar, '=': ampliar, Add: ampliar,
        '-': reduzir, _: reduzir, Subtract: reduzir,
        0: ajustar, 1: () => cem(),
      }[k];
      if (acao) { e.preventDefault(); acao(); return; }
      if (e.ctrlKey || e.metaKey) return;
      const { w, h } = caixa();
      const dx = { ArrowLeft: 1, ArrowRight: -1 }[k];
      const dy = { ArrowUp: 1, ArrowDown: -1 }[k];
      if (dx && w * s > el.clientWidth + 0.5) {
        e.preventDefault();
        suave(() => { x += dx * el.clientWidth * 0.2; });
      } else if (dy && h * s > el.clientHeight + 0.5) {
        e.preventDefault();
        suave(() => { y += dy * el.clientHeight * 0.2; });
      }
    };
    el.addEventListener('keydown', aoTeclar);

    // A janela muda de tamanho: ajustada, a imagem acompanha; ampliada, só não sai da janela.
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { if (seguirAjuste) s = escalaDeAjuste(); aplicar(); })
      : null;
    if (ro) ro.observe(el);

    quandoTiverTamanho(conteudo.firstElementChild, ajustarJa);

    return {
      ajustar, cem, ampliar, reduzir, definir, girar, trocar,
      escala: () => s * dpr(),
      rotacao: rot,
      ajustada,
      destruir() {
        el.removeEventListener('wheel', aoRodar);
        el.removeEventListener('pointerdown', aoDescer);
        el.removeEventListener('pointermove', aoMover);
        el.removeEventListener('pointerup', aoSubir);
        el.removeEventListener('pointercancel', aoSubir);
        el.removeEventListener('dragstart', aoArrastarNativo);
        el.removeEventListener('dblclick', aoDuplo);
        el.removeEventListener('keydown', aoTeclar);
        if (ro) ro.disconnect();
        clearTimeout(fimDoGesto);
      },
    };
  }

  // ── A imagem, decodificada quando o navegador não sabe ─────────────────────

  // O endereço deste arquivo, lido na carga: o decodificador mora ao lado dele, em `_sdk/tuff/`
  // num app e em `tuff/` no shell.
  const ENDERECO = (document.currentScript && document.currentScript.src) || location.href;
  let carregando = null;

  /**
   * O `TuffImagem` de `tuff-imagem.js`, buscado na primeira chamada. É o caminho para quem quer o
   * documento sem desenhar a página: a miniatura embutida de um HEIC, as páginas de um TIFF.
   */
  function decodificador() {
    if (!carregando) {
      carregando = new Promise((ok, falhou) => {
        if (window.TuffImagem) { ok(window.TuffImagem); return; }
        const s = document.createElement('script');
        s.src = new URL('tuff-imagem.js', ENDERECO).href;
        s.onload = () => ok(window.TuffImagem);
        s.onerror = () => { carregando = null; falhou(new Error('o decodificador de imagem não carregou')); };
        document.head.appendChild(s);
      });
    }
    return carregando;
  }

  /**
   * `{ elemento, documento, reduzida }` para `url`: uma `img` para o que o navegador abre, ou o
   * `canvas` de um TIFF ou HEIC, com o `documento` das páginas e da miniatura. O decodificador
   * (`tuff-imagem.js`) é buscado na primeira chamada, e o geotiff dele só no primeiro TIFF, então
   * um app que só mostra JPEG não paga por nenhum dos dois. `opcoes.nome` é o nome do arquivo, de
   * onde sai o formato.
   */
  function imagem(url, opcoes) {
    return decodificador().then((T) => T.elemento(url, opcoes));
  }

  window.TuffMidia = { player, onda, grade, visor, tempo, imagem, decodificador };
})();
