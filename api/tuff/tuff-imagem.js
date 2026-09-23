'use strict';

// Tuff: o decodificador das imagens que o navegador não abre sozinho, TIFF e HEIC.
//
//     TuffImagem.elemento(url, { nome })  uma `img` ou um `canvas` pronto para o visor
//     TuffImagem.abrir(url, { nome })     o documento: páginas, tamanho, desenhar, miniatura
//     TuffImagem.precisa(nome)            o nome é de um formato que só abre por aqui
//
// O Chromium não decodifica TIFF nem HEIC, e um `<img src>` de um deles fica quebrado. Este
// arquivo lê os dois e devolve um `<canvas>`, que o `TuffMidia.visor` aceita como aceita uma
// `img`. Ninguém o carrega à toa: `TuffMidia.imagem` o busca na primeira vez que um desses nomes
// aparece, e ele busca o geotiff (`vendor/geotiff.min.js`, 550 KB) só no primeiro TIFF.
//
// ─── TIFF ───────────────────────────────────────────────────────────────────
//
// O geotiff lê por `Range` só os ladrilhos ou faixas que a imagem pede, e cobre as compressões
// comuns (LZW, Deflate, PackBits, JPEG), BigTIFF e várias páginas. Uma página é uma IFD com
// `NewSubfileType` sem o bit de redução; as IFDs com o bit logo depois dela são os níveis de
// redução daquela página, que é como um TIFF piramidal os grava.
//
// Oito bits vão pelo `readRGB` do geotiff, que converte paleta, YCbCr, CMYK e Lab. O resto
// (16 bits, 32 bits, ponto flutuante) chega à tela esticado entre o mínimo e o máximo da imagem:
// uma foto científica de 12 bits úteis dentro de 16 ficaria quase preta dividida por 65 536. Um
// NaN vira pixel transparente, que é o "sem dado" de uma imagem de satélite.
//
// ─── HEIC ───────────────────────────────────────────────────────────────────
//
// O contêiner HEIF é lido aqui, em JS: as caixas `meta`, `iinf`, `iloc`, `iref`, `iprp`. Os
// ladrilhos HEVC vão ao `VideoDecoder` do WebCodecs, que decodifica pelo hardware da máquina, e
// assim nenhum decodificador HEVC viaja com o ambiente. O preço: onde o navegador não tem HEVC
// (Chrome no Linux sem VA-API, um Chrome com a GPU desligada), `desenhar` rejeita com
// `codigo: 'sem-hevc'`, e quem chamou diz isso na tela.
//
// A rotação e o espelho do HEIF (`irot`, `imir`) entram no desenho. A orientação EXIF de um HEIC
// fica de fora de propósito: a especificação manda seguir as caixas, e um iPhone grava as duas com
// o mesmo valor, então aplicar as duas giraria a foto duas vezes.
//
// ─── O teto ─────────────────────────────────────────────────────────────────
//
// Uma imagem decodificada ocupa 4 bytes por pixel. Acima de `TETO_DE_PIXELS` (ou do `teto` que o
// app passar) a página sai do maior nível de redução que couber, e sem nível que caiba o geotiff
// reamostra para caber; `desenhar` diz `reduzida: true` e o tamanho original, para o app contar
// isso à pessoa. O teto vale para o TIFF: um HEIC de celular tem 12 a 48 megapixels.

(function () {

  const TETO_DE_PIXELS = 64e6;
  const BASE = (document.currentScript && document.currentScript.src) || location.href;
  const TIFF = new Set(['tif', 'tiff']);
  const HEIF = new Set(['heic', 'heif', 'hif']);

  const extensao = (nome) => {
    const n = String(nome || '').split(/[?#]/)[0].split('/').pop();
    const i = n.lastIndexOf('.');
    return i > 0 ? n.slice(i + 1).toLowerCase() : '';
  };
  const erro = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo });

  function precisa(nome) {
    const e = extensao(nome);
    return TIFF.has(e) || HEIF.has(e);
  }

  // ── Os bytes, por Range ────────────────────────────────────────────────────

  /**
   * Lê pedaços de `url` por `Range`. Um servidor que ignore o `Range` e responda 200 entrega o
   * arquivo inteiro, que fica guardado e responde os pedidos seguintes.
   */
  class Leitor {
    constructor(url) { this.url = url; this.inteiro = null; this.cache = []; }

    async ler(inicio, tamanho) {
      if (this.inteiro) return this.inteiro.subarray(inicio, inicio + tamanho);
      for (const c of this.cache) {
        if (inicio >= c.inicio && inicio + tamanho <= c.inicio + c.bytes.length) {
          return c.bytes.subarray(inicio - c.inicio, inicio - c.inicio + tamanho);
        }
      }
      const r = await fetch(this.url, { headers: { Range: `bytes=${inicio}-${inicio + tamanho - 1}` } });
      if (!r.ok) throw erro('rede', `a leitura de ${this.url} respondeu ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (r.status === 200) {
        this.inteiro = bytes;
        return bytes.subarray(inicio, inicio + tamanho);
      }
      this.cache.push({ inicio, bytes });
      return bytes;
    }
  }

  // ── HEIF: as caixas ────────────────────────────────────────────────────────

  const quatro = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

  /** As caixas entre `ini` e `fim` de `b`: `{ tipo, ini, fim, corpo }`, com `corpo` o início do conteúdo. */
  function caixas(b, ini, fim) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const lista = [];
    let p = ini;
    while (p + 8 <= fim) {
      let tamanho = dv.getUint32(p);
      const tipo = quatro(b, p + 4);
      let corpo = p + 8;
      if (tamanho === 1) { tamanho = Number(dv.getBigUint64(p + 8)); corpo = p + 16; }
      else if (tamanho === 0) tamanho = fim - p;
      if (tamanho < 8 || p + tamanho > fim) break;
      lista.push({ tipo, ini: p, fim: p + tamanho, corpo });
      p += tamanho;
    }
    return lista;
  }

  /** Um leitor sequencial de inteiros big-endian sobre `b`, a partir de `p`. */
  function cursor(b, p) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return {
      get p() { return p; },
      u8() { return dv.getUint8(p++); },
      u16() { const v = dv.getUint16(p); p += 2; return v; },
      u32() { const v = dv.getUint32(p); p += 4; return v; },
      n(bytes) {
        if (bytes === 0) return 0;
        if (bytes === 4) return this.u32();
        if (bytes === 8) { const v = Number(dv.getBigUint64(p)); p += 8; return v; }
        if (bytes === 2) return this.u16();
        let v = 0; for (let i = 0; i < bytes; i++) v = v * 256 + this.u8(); return v;
      },
      tipo() { const t = quatro(b, p); p += 4; return t; },
      pular(n) { p += n; },
    };
  }

  /**
   * A caixa `meta` de um arquivo HEIF, lida por `Range`. Num arquivo de celular ela vem logo depois
   * da `ftyp`, nos primeiros quilobytes; num arquivo que ponha a `mdat` antes, os cabeçalhos são
   * lidos um a um até ela, sem baixar os dados da imagem.
   */
  async function lerMeta(leitor) {
    let p = 0;
    for (let i = 0; i < 64; i++) {
      const cab = await leitor.ler(p, 16);
      if (cab.length < 8) break;
      const dv = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
      let tamanho = dv.getUint32(0);
      const tipo = quatro(cab, 4);
      if (tamanho === 1) tamanho = Number(dv.getBigUint64(8));
      if (i === 0 && tipo !== 'ftyp') throw erro('formato', 'o arquivo não é HEIF');
      if (tipo === 'meta') return leitor.ler(p, tamanho);
      if (tamanho < 8) break;
      p += tamanho;
    }
    throw erro('formato', 'o arquivo HEIF não tem a caixa meta');
  }

  /** O índice do arquivo: itens, onde estão os bytes de cada um, referências e propriedades. */
  function lerIndice(meta) {
    const itens = new Map();     // id → { id, tipo, props: [{tipo, ...}], extents, metodo }
    const refs = [];             // { tipo, de, para: [] }
    const props = [];            // as caixas de `ipco`, na ordem (o índice de `ipma` começa em 1)
    let primario = 0, idat = null;
    const item = (id) => { if (!itens.has(id)) itens.set(id, { id, tipo: '', props: [], extents: [], metodo: 0 }); return itens.get(id); };

    for (const cx of caixas(meta, 12, meta.length)) {   // `meta` é FullBox: 8 de cabeçalho e 4 de versão
      const c = cursor(meta, cx.corpo);
      if (cx.tipo === 'pitm') {
        const v = c.u8(); c.pular(3);
        primario = v === 0 ? c.u16() : c.u32();
      } else if (cx.tipo === 'iinf') {
        const v = c.u8(); c.pular(3);
        c.pular(v === 0 ? 2 : 4);
        for (const infe of caixas(meta, c.p, cx.fim)) {
          if (infe.tipo !== 'infe') continue;
          const ci = cursor(meta, infe.corpo);
          const vi = ci.u8(); ci.pular(3);
          if (vi < 2) continue;
          const id = vi === 2 ? ci.u16() : ci.u32();
          ci.pular(2);
          item(id).tipo = ci.tipo();
        }
      } else if (cx.tipo === 'iloc') {
        const v = c.u8(); c.pular(3);
        const a = c.u8(), bb = c.u8();
        const [tOff, tLen, tBase, tIdx] = [a >> 4, a & 15, bb >> 4, v >= 1 ? bb & 15 : 0];
        const n = v < 2 ? c.u16() : c.u32();
        for (let i = 0; i < n; i++) {
          const it = item(v < 2 ? c.u16() : c.u32());
          if (v >= 1) it.metodo = c.u16() & 15;
          c.pular(2);   // data_reference_index
          const base = c.n(tBase);
          const extents = c.u16();
          for (let e = 0; e < extents; e++) {
            if (tIdx) c.n(tIdx);
            const off = c.n(tOff), len = c.n(tLen);
            it.extents.push({ ini: base + off, tamanho: len });
          }
        }
      } else if (cx.tipo === 'iref') {
        const v = c.u8(); c.pular(3);
        for (const r of caixas(meta, c.p, cx.fim)) {
          const cr = cursor(meta, r.corpo);
          const de = v === 0 ? cr.u16() : cr.u32();
          const n = cr.u16();
          const para = [];
          for (let i = 0; i < n; i++) para.push(v === 0 ? cr.u16() : cr.u32());
          refs.push({ tipo: r.tipo, de, para });
        }
      } else if (cx.tipo === 'iprp') {
        for (const sub of caixas(meta, cx.corpo, cx.fim)) {
          if (sub.tipo === 'ipco') {
            for (const pr of caixas(meta, sub.corpo, sub.fim)) props.push(lerPropriedade(meta, pr));
          } else if (sub.tipo === 'ipma') {
            const cm = cursor(meta, sub.corpo);
            const v = cm.u8(); const flags = (cm.u8() << 16) | cm.u16();
            const n = cm.u32();
            for (let i = 0; i < n; i++) {
              const it = item(v < 1 ? cm.u16() : cm.u32());
              const k = cm.u8();
              for (let j = 0; j < k; j++) {
                const indice = flags & 1 ? cm.u16() & 0x7fff : cm.u8() & 0x7f;
                if (indice) it.props.push(indice);
              }
            }
          }
        }
      } else if (cx.tipo === 'idat') {
        idat = meta.subarray(cx.corpo, cx.fim);
      }
    }
    for (const it of itens.values()) it.props = it.props.map((i) => props[i - 1]).filter(Boolean);
    return { itens, refs, primario, idat };
  }

  function lerPropriedade(b, cx) {
    const c = cursor(b, cx.corpo);
    switch (cx.tipo) {
      case 'hvcC': return { tipo: 'hvcC', dados: b.slice(cx.corpo, cx.fim) };
      case 'ispe': c.pular(4); return { tipo: 'ispe', largura: c.u32(), altura: c.u32() };
      case 'irot': return { tipo: 'irot', anti: c.u8() & 3 };        // quartos de volta, anti-horário
      case 'imir': return { tipo: 'imir', eixo: c.u8() & 1 };        // 0: espelho esquerda-direita
      default: return { tipo: cx.tipo };
    }
  }

  const prop = (it, tipo) => it.props.find((p) => p.tipo === tipo);

  /** A string de codec do WebCodecs (`hvc1.1.6.L93.B0`) a partir do `hvcC`, pela ISO/IEC 14496-15, anexo E. */
  function codecDe(h) {
    const espaco = ['', 'A', 'B', 'C'][h[1] >> 6];
    const camada = (h[1] >> 5) & 1 ? 'H' : 'L';
    let compat = ((h[2] << 24) | (h[3] << 16) | (h[4] << 8) | h[5]) >>> 0;
    let invertido = 0;
    for (let i = 0; i < 32; i++) { invertido = ((invertido << 1) | (compat & 1)) >>> 0; compat >>>= 1; }
    const restricoes = [...h.subarray(6, 12)];
    while (restricoes.length && restricoes[restricoes.length - 1] === 0) restricoes.pop();
    return ['hvc1', espaco + (h[1] & 0x1f), invertido.toString(16).toUpperCase(),
      camada + h[12], ...restricoes.map((x) => x.toString(16).toUpperCase())].join('.');
  }

  async function bytesDoItem(leitor, indice, it) {
    const partes = [];
    for (const e of it.extents) {
      partes.push(it.metodo === 1 ? indice.idat.subarray(e.ini, e.ini + e.tamanho) : await leitor.ler(e.ini, e.tamanho));
    }
    if (partes.length === 1) return partes[0];
    const tudo = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of partes) { tudo.set(p, o); o += p.length; }
    return tudo;
  }

  /**
   * Decodifica ladrilhos HEVC que compartilham um `hvcC` e os desenha num canvas de
   * `largura × altura`, cada um na posição que `posicoes[i]` diz.
   */
  async function decodificarHevc(hvcC, ladrilhos, posicoes, largura, altura) {
    if (typeof VideoDecoder === 'undefined') throw erro('sem-hevc', 'este navegador não tem WebCodecs');
    const config = { codec: codecDe(hvcC), description: hvcC };
    const apoio = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (!apoio.supported) throw erro('sem-hevc', `este navegador não decodifica ${config.codec}`);

    const canvas = document.createElement('canvas');
    canvas.width = largura; canvas.height = altura;
    const ctx = canvas.getContext('2d');
    let falha = null;
    const decodificador = new VideoDecoder({
      output: (quadro) => {
        const pos = posicoes[quadro.timestamp];
        if (pos) ctx.drawImage(quadro, pos.x, pos.y);
        quadro.close();
      },
      error: (e) => { falha = e; },
    });
    decodificador.configure(config);
    ladrilhos.forEach((dados, i) => {
      decodificador.decode(new EncodedVideoChunk({ type: 'key', timestamp: i, data: dados }));
    });
    try { await decodificador.flush(); } catch (e) { falha = falha || e; }
    decodificador.close();
    if (falha) throw erro('sem-hevc', `o decodificador HEVC falhou: ${falha.message || falha}`);
    return canvas;
  }

  /** Aplica `irot` e `imir` na ordem em que o item as lista. */
  function transformar(canvas, it) {
    let atual = canvas;
    for (const p of it.props) {
      if (p.tipo === 'irot' && p.anti) {
        const novo = document.createElement('canvas');
        const deLado = p.anti % 2 === 1;
        novo.width = deLado ? atual.height : atual.width;
        novo.height = deLado ? atual.width : atual.height;
        const g = novo.getContext('2d');
        g.translate(novo.width / 2, novo.height / 2);
        g.rotate((-p.anti * Math.PI) / 2);
        g.drawImage(atual, -atual.width / 2, -atual.height / 2);
        atual = novo;
      } else if (p.tipo === 'imir') {
        const novo = document.createElement('canvas');
        novo.width = atual.width; novo.height = atual.height;
        const g = novo.getContext('2d');
        if (p.eixo === 0) { g.translate(novo.width, 0); g.scale(-1, 1); }
        else { g.translate(0, novo.height); g.scale(1, -1); }
        g.drawImage(atual, 0, 0);
        atual = novo;
      }
    }
    return atual;
  }

  const girado = (it, largura, altura) => {
    const r = prop(it, 'irot');
    return r && r.anti % 2 ? { largura: altura, altura: largura } : { largura, altura };
  };

  /** O tamanho de um item de imagem, e os ladrilhos que o compõem. */
  function montagem(indice, it) {
    if (it.tipo === 'grid') {
      const ids = (indice.refs.find((r) => r.tipo === 'dimg' && r.de === it.id) || { para: [] }).para;
      return { grade: true, ladrilhos: ids.map((id) => indice.itens.get(id)) };
    }
    return { grade: false, ladrilhos: [it] };
  }

  async function desenharItemHeif(leitor, indice, it) {
    const { grade, ladrilhos } = montagem(indice, it);
    if (!ladrilhos.length || ladrilhos.some((l) => !l || l.tipo !== 'hvc1')) {
      throw erro('formato', 'o HEIF usa uma codificação que o ambiente não lê (só HEVC)');
    }
    const hvcC = prop(ladrilhos[0], 'hvcC');
    const ispe = prop(ladrilhos[0], 'ispe');
    if (!hvcC || !ispe) throw erro('formato', 'o ladrilho HEVC não traz hvcC e ispe');

    let largura = ispe.largura, altura = ispe.altura, colunas = 1;
    if (grade) {
      const d = cursor(await bytesDoItem(leitor, indice, it), 0);
      d.pular(1);
      const flags = d.u8();
      d.u8();   // linhas - 1: sai da conta de ladrilhos
      colunas = d.u8() + 1;
      largura = flags & 1 ? d.u32() : d.u16();
      altura = flags & 1 ? d.u32() : d.u16();
    }
    const dados = await Promise.all(ladrilhos.map((l) => bytesDoItem(leitor, indice, l)));
    const posicoes = ladrilhos.map((_l, i) => ({
      x: (i % colunas) * ispe.largura, y: Math.floor(i / colunas) * ispe.altura,
    }));
    const canvas = await decodificarHevc(hvcC.dados, dados, posicoes, largura, altura);
    return transformar(canvas, it);
  }

  async function abrirHeif(url) {
    const leitor = new Leitor(url);
    const indice = lerIndice(await lerMeta(leitor));
    const primario = indice.itens.get(indice.primario);
    if (!primario) throw erro('formato', 'o HEIF não aponta a imagem principal');

    const { grade, ladrilhos } = montagem(indice, primario);
    let largura = 0, altura = 0;
    const ispe = prop(primario, 'ispe') || (ladrilhos[0] && prop(ladrilhos[0], 'ispe'));
    if (ispe) ({ largura, altura } = ispe);
    if (grade && !prop(primario, 'ispe')) {
      const d = cursor(await bytesDoItem(leitor, indice, primario), 0);
      d.pular(1); const flags = d.u8(); d.pular(2);
      largura = flags & 1 ? d.u32() : d.u16();
      altura = flags & 1 ? d.u32() : d.u16();
    }
    const tela = girado(primario, largura, altura);
    const mini = indice.refs.find((r) => r.tipo === 'thmb' && r.para.includes(indice.primario));
    const itemMini = mini && indice.itens.get(mini.de);

    return {
      formato: 'heif',
      paginas: 1,
      largura: tela.largura,
      altura: tela.altura,
      async desenhar() {
        const canvas = await desenharItemHeif(leitor, indice, primario);
        return { canvas, largura: canvas.width, altura: canvas.height, reduzida: false };
      },
      async miniatura() {
        if (!itemMini) return null;
        return desenharItemHeif(leitor, indice, itemMini);
      },
    };
  }

  // ── TIFF ───────────────────────────────────────────────────────────────────

  let geotiff = null;
  function carregarGeotiff() {
    if (!geotiff) {
      geotiff = new Promise((ok, falhou) => {
        if (window.GeoTIFF) { ok(window.GeoTIFF); return; }
        const s = document.createElement('script');
        s.src = new URL('vendor/geotiff.min.js', BASE).href;
        s.onload = () => (window.GeoTIFF ? ok(window.GeoTIFF) : falhou(erro('rede', 'o geotiff não carregou')));
        s.onerror = () => { geotiff = null; falhou(erro('rede', 'o geotiff não carregou')); };
        document.head.appendChild(s);
      });
    }
    return geotiff;
  }

  const tag = async (img, nome) => {
    const fd = img.fileDirectory;
    return fd.hasTag(nome) ? fd.loadValue(nome) : undefined;
  };

  /** Os valores lidos, esticados entre o mínimo e o máximo, em RGBA de 8 bits. */
  function esticar(valores, amostras, pixels, invertido) {
    const cores = amostras >= 3 ? 3 : 1;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < pixels; i++) {
      for (let c = 0; c < cores; c++) {
        const v = valores[i * amostras + c];
        if (v === v) { if (v < min) min = v; if (v > max) max = v; }   // `v === v` descarta NaN
      }
    }
    const escala = max > min ? 255 / (max - min) : 0;
    const rgba = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < pixels; i++) {
      let nan = false;
      for (let c = 0; c < 3; c++) {
        const v = valores[i * amostras + (cores === 3 ? c : 0)];
        if (v !== v) { nan = true; break; }
        const n = (v - min) * escala;
        rgba[i * 4 + c] = invertido ? 255 - n : n;
      }
      rgba[i * 4 + 3] = nan ? 0 : 255;
    }
    return rgba;
  }

  async function rgbaDaImagem(img, largura, altura) {
    const bits = img.getBitsPerSample(0);
    const formato = ((await tag(img, 'SampleFormat')) || [1])[0];
    const foto = await tag(img, 'PhotometricInterpretation');
    const pixels = largura * altura;
    const opcoes = { interleave: true, width: largura, height: altura, resampleMethod: 'nearest' };

    if ((bits === 8 && formato === 1) || foto === 3) {
      const rgb = await img.readRGB({ ...opcoes, enableAlpha: true });
      const passo = rgb.length / pixels;
      const rgba = new Uint8ClampedArray(pixels * 4);
      for (let i = 0; i < pixels; i++) {
        rgba[i * 4] = rgb[i * passo]; rgba[i * 4 + 1] = rgb[i * passo + 1]; rgba[i * 4 + 2] = rgb[i * passo + 2];
        rgba[i * 4 + 3] = passo === 4 ? rgb[i * 4 + 3] : 255;
      }
      return rgba;
    }
    const valores = await img.readRasters(opcoes);
    return esticar(valores, img.getSamplesPerPixel(), pixels, foto === 0);
  }

  async function abrirTiff(url, teto) {
    const GeoTIFF = await carregarGeotiff();
    let tiff;
    try { tiff = await GeoTIFF.fromUrl(url, { allowFullFile: true }); }
    catch (e) { throw erro('formato', `o TIFF não abriu: ${e.message || e}`); }
    const n = await tiff.getImageCount();

    // As páginas, cada uma com os níveis de redução que vêm logo depois dela.
    const paginas = [];
    for (let i = 0; i < n; i++) {
      const img = await tiff.getImage(i);
      const reduzida = ((await tag(img, 'NewSubfileType')) || 0) & 1;
      if (!reduzida || !paginas.length) paginas.push({ imagem: img, niveis: [] });
      else paginas[paginas.length - 1].niveis.push(img);
    }
    const tamanho = (img) => ({ largura: img.getWidth(), altura: img.getHeight() });

    async function desenharImagem(img, largura, altura) {
      const rgba = await rgbaDaImagem(img, largura, altura);
      const canvas = document.createElement('canvas');
      canvas.width = largura; canvas.height = altura;
      canvas.getContext('2d').putImageData(new ImageData(rgba, largura, altura), 0, 0);
      return canvas;
    }

    return {
      formato: 'tiff',
      paginas: paginas.length,
      ...tamanho(paginas[0].imagem),
      /** Uma página, na maior resolução que cabe no teto. */
      async desenhar(numero) {
        const pagina = paginas[numero || 0];
        if (!pagina) throw erro('formato', `o TIFF não tem a página ${numero}`);
        const original = tamanho(pagina.imagem);
        let img = pagina.imagem, { largura, altura } = original;
        if (largura * altura > teto) {
          const nivel = pagina.niveis.find((l) => l.getWidth() * l.getHeight() <= teto);
          if (nivel) {
            img = nivel; ({ largura, altura } = tamanho(nivel));
          } else {
            const k = Math.sqrt(teto / (largura * altura));
            largura = Math.max(1, Math.floor(largura * k)); altura = Math.max(1, Math.floor(altura * k));
          }
        }
        const canvas = await desenharImagem(img, largura, altura);
        return { canvas, largura, altura, reduzida: largura !== original.largura,
                 larguraOriginal: original.largura, alturaOriginal: original.altura };
      },
      /** O menor nível de redução da primeira página, ou `null` num TIFF sem níveis. */
      async miniatura() {
        const niveis = paginas[0].niveis;
        if (!niveis.length) return null;
        const menor = niveis.reduce((a, b) => (b.getWidth() < a.getWidth() ? b : a));
        return desenharImagem(menor, menor.getWidth(), menor.getHeight());
      },
    };
  }

  /**
   * O documento de um TIFF ou HEIC. `opcoes.nome` diz o formato pela extensão, porque a URL de um
   * arquivo do ambiente (`…/fs/read?path=…`) não tem extensão no caminho. `opcoes.teto` troca o
   * teto de pixels de um TIFF, para um app que prefira gastar menos memória.
   */
  async function abrir(url, opcoes) {
    const o = opcoes || {};
    const e = extensao(o.nome || url);
    if (TIFF.has(e)) return abrirTiff(url, o.teto || TETO_DE_PIXELS);
    if (HEIF.has(e)) return abrirHeif(url);
    throw erro('formato', `o Tuff não decodifica .${e}; o navegador abre este formato sozinho`);
  }

  /**
   * O elemento pronto para mostrar: uma `img` já decodificada, para o que o navegador abre
   * sozinho, ou o `canvas` da página pedida, para TIFF e HEIC. `documento` vem junto no segundo
   * caso, com as páginas e a miniatura.
   */
  async function elemento(url, opcoes) {
    const o = opcoes || {};
    if (precisa(o.nome || url)) {
      const documento = await abrir(url, o);
      const r = await documento.desenhar(o.pagina || 0);
      return { elemento: r.canvas, documento, reduzida: r.reduzida };
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try { await img.decode(); }
    catch { throw erro('formato', 'o navegador não conseguiu decodificar a imagem'); }
    return { elemento: img, documento: null, reduzida: false };
  }

  window.TuffImagem = { precisa, abrir, elemento, codecDe, TETO_DE_PIXELS };
})();
