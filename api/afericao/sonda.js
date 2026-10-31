'use strict';

// ─── A sonda do aparelho (Aferição, VSSH-541) ───────────────────────────────────────────────
//
// Uma medida curta do que este aparelho faz rápido e devagar, no molde do trabalho que o shell e os
// apps pedem a ele: JavaScript na thread principal, o layout de uma lista comprida, três camadas
// compostas em Canvas 2D e em WebGL2, a frequência da tela e 4 MB no armazenamento da origem.
// Quem decide quando ela roda é o `PerfilDoAparelho`; aqui mora só a medida.
//
// ─── O que ela promete a quem a chama ───────────────────────────────────────────────────────
//
// Cada passo conta o trabalho síncrono que gastou, e um passo só começa enquanto a soma está abaixo
// de `TETO_MS`: o que fica de fora sai como "não medido", com o motivo `teto`. O passo que começou
// termina, então a soma pode passar do teto pelo tamanho de um passo. Entre um pedaço e outro a sonda cede a
// vez (`setTimeout(0)`), e é isso que deixa um clique ser atendido em dezenas de milissegundos e
// interromper a medida pelo `AbortSignal`: uma medida interrompida não vale nada, e quem chamou a
// descarta inteira.
//
// Cada medida tem três estados, como a placa no `vssh-gpu-info`: `medido`, `nao-medido` (com o
// motivo) e, no perfil, `estimado`. "Não medido" nunca vira "lento": um navegador sem OPFS não tem
// disco devagar, só não respondeu.
//
// ─── A versão ───────────────────────────────────────────────────────────────────────────────
//
// O valor de cada passo só se compara com outro da mesma `VERSAO`. Mudar a carga de um passo, o
// número de rodadas ou a conta do resultado é uma versão nova, e o 100 da Aferição (o Celeron de
// 4 GB) se mede de novo nela.

const SondaDoAparelho = (() => {
  const VERSAO = 1;
  const TETO_MS = 1500;

  class Interrompida extends Error {}

  const ceder = () => new Promise((ok) => setTimeout(ok, 0));
  const mediana = (xs) => {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const arred = (x, casas = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** casas) / 10 ** casas : null);

  // O mesmo gerador em toda carga: a lista, o texto e os números saem iguais em todo aparelho, e
  // a medida de um compara com a do outro.
  function sorteio(semente) {
    let s = semente >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** O orçamento de uma rodada: quanto já se gastou, e se o sinal pediu para parar. */
  function novaConta(sinal) {
    return {
      gasto: 0,
      conferir() { if (sinal?.aborted) throw new Interrompida('interrompida'); },
      cabe() { return this.gasto < TETO_MS; },
      // Um pedaço síncrono, cronometrado e somado ao gasto.
      medir(fn) {
        this.conferir();
        const t0 = performance.now();
        const r = fn();
        const ms = performance.now() - t0;
        this.gasto += ms;
        return { r, ms };
      },
    };
  }

  // ─── CPU da página ──────────────────────────────────────────────────────────────────────────
  //
  // Uma unidade de trabalho no molde do que o shell faz o tempo todo: JSON de ida e volta, uma
  // regex sobre texto, uma ordenação e aritmética num `Float32Array`. A medida conta quantas
  // unidades cabem em janelas de 25 ms e fica com a mediana das oito, que deixa de fora a janela
  // em que o coletor de lixo passou. O resultado é unidades por segundo: maior é mais rápido.

  let _ralo = 0;
  function dadosDaCpu() {
    const r = sorteio(541);
    const palavras = ['arquivo', 'pasta', 'janela', 'estação', 'portal', 'caderno', 'desenho', 'nota', 'tecla', 'quadro'];
    const objeto = Array.from({ length: 60 }, (_, i) => ({
      id: i, nome: `${palavras[i % palavras.length]}-${Math.floor(r() * 1e6)}.txt`,
      tamanho: Math.floor(r() * 1e7), alterado: 1.7e12 + Math.floor(r() * 1e10), pasta: r() < 0.2,
    }));
    const texto = Array.from({ length: 900 }, () => palavras[Math.floor(r() * palavras.length)]).join(' ');
    const numeros = Array.from({ length: 600 }, () => r());
    const f32 = new Float32Array(4096);
    for (let i = 0; i < f32.length; i++) f32[i] = r();
    return { objeto, texto, numeros, f32 };
  }

  function unidade(d) {
    const o = JSON.parse(JSON.stringify(d.objeto));
    let n = 0;
    for (const m of d.texto.matchAll(/\b\p{L}{5,}\b/gu)) n += m[0].length;
    const a = d.numeros.slice().sort((x, y) => x - y);
    const f = d.f32;
    for (let i = 0; i < f.length; i++) f[i] = f[i] * 0.999 + 0.001;
    return n + a[0] + o.length + f[7];
  }

  async function passoCpu(conta) {
    const d = dadosDaCpu();
    const taxas = [];
    for (let j = 0; j < 8; j++) {
      const { r } = conta.medir(() => {
        const t0 = performance.now();
        let k = 0;
        let t = t0;
        while (t - t0 < 25) { _ralo += unidade(d); k++; t = performance.now(); }
        return (k * 1000) / (t - t0);
      });
      taxas.push(r);
      await ceder();
    }
    return { estado: 'medido', valor: arred(mediana(taxas), 0), unidade: 'unidades/s' };
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────────────────────
  //
  // Uma lista de seiscentas linhas, do tamanho de uma pasta cheia em Arquivos, montada numa caixa
  // fora da tela com `contain: strict`, que isola o layout dela do resto da página: o tempo vai do
  // HTML à posição da última linha, e depois a caixa muda de largura e o layout corre de novo. Três
  // vezes, e a mediana. Menor é mais rápido.

  function htmlDaLista() {
    const r = sorteio(542);
    const linhas = [];
    for (let i = 0; i < 600; i++) {
      linhas.push(`<div class="sonda-linha"><span>documento-${i}-${Math.floor(r() * 1e5)}.pdf</span>`
        + `<span>${Math.floor(r() * 900) + 1} KB</span><span>${1 + (i % 28)}/10/2026</span></div>`);
    }
    return linhas.join('');
  }

  async function passoLayout(conta) {
    const html = htmlDaLista();
    const tempos = [];
    for (let j = 0; j < 3; j++) {
      const caixa = document.createElement('div');
      caixa.setAttribute('aria-hidden', 'true');
      caixa.style.cssText = 'position:fixed;left:-20000px;top:0;width:900px;height:600px;overflow:hidden;'
        + 'contain:strict;pointer-events:none;font:13px/20px sans-serif';
      try {
        const { ms } = conta.medir(() => {
          caixa.innerHTML = html;
          document.body.appendChild(caixa);
          void caixa.lastElementChild.offsetTop;
          caixa.style.width = '640px';
          return caixa.lastElementChild.offsetTop;
        });
        tempos.push(ms);
      } finally {
        caixa.remove();
      }
      await ceder();
    }
    return { estado: 'medido', valor: arred(mediana(tempos)), unidade: 'ms' };
  }

  // ─── Canvas 2D e WebGL2 ─────────────────────────────────────────────────────────────────────
  //
  // Três camadas de 1600 × 1200 compostas numa folha, a conta que um app de desenho faz a cada
  // quadro inteiro (o `frontend/src/medida.js` do Cavalete). A leitura de um pixel no fim espera a
  // placa terminar, e sai do canvas da sonda, que é jogado fora: ler de volta um canvas que fica na
  // tela poderia tirar a aceleração dele. Uma composição de aquecimento sobe as camadas para a
  // placa antes das três cronometradas. Menor é mais rápido.

  const LARGURA = 1600;
  const ALTURA = 1200;

  function camadas() {
    const r = sorteio(543);
    return [0, 1, 2].map((n) => {
      const c = document.createElement('canvas');
      c.width = LARGURA;
      c.height = ALTURA;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, LARGURA, ALTURA);
      g.addColorStop(0, `hsla(${n * 120}, 70%, 50%, 0.6)`);
      g.addColorStop(1, `hsla(${n * 120 + 60}, 70%, 50%, 0.3)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `hsla(${Math.floor(r() * 360)}, 60%, 50%, 0.5)`;
        ctx.beginPath();
        ctx.arc(r() * LARGURA, r() * ALTURA, 20 + r() * 120, 0, Math.PI * 2);
        ctx.fill();
      }
      return c;
    });
  }

  function soltar(canvases) {
    for (const c of canvases) { c.width = 0; c.height = 0; }
  }

  async function passoCanvas2d(conta, fontes) {
    const alvo = document.createElement('canvas');
    alvo.width = LARGURA;
    alvo.height = ALTURA;
    const ctx = alvo.getContext('2d');
    if (!ctx) return { estado: 'nao-medido', motivo: 'sem-canvas' };
    const compor = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, LARGURA, ALTURA);
      ctx.drawImage(fontes[0], 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(fontes[1], 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(fontes[2], 0, 0);
      return ctx.getImageData(0, 0, 1, 1).data[0];
    };
    try {
      conta.medir(compor);
      const tempos = [];
      for (let j = 0; j < 3; j++) {
        await ceder();
        tempos.push(conta.medir(compor).ms);
      }
      return { estado: 'medido', valor: arred(mediana(tempos)), unidade: 'ms' };
    } finally {
      soltar([alvo]);
    }
  }

  const VERTICES = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FRAGMENTOS = `#version 300 es
precision mediump float;
in vec2 uv; uniform sampler2D t; out vec4 cor;
void main() { cor = texture(t, uv); }`;

  function programa(gl) {
    const shader = (tipo, fonte) => {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, fonte);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTICES));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAGMENTOS));
    gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  }

  async function passoWebgl2(conta, fontes) {
    const alvo = document.createElement('canvas');
    alvo.width = LARGURA;
    alvo.height = ALTURA;
    let gl = null;
    try { gl = alvo.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false }); } catch { gl = null; }
    if (!gl) { soltar([alvo]); return { estado: 'nao-medido', motivo: 'sem-webgl2' }; }
    try {
      const p = conta.medir(() => programa(gl)).r;
      if (!p) return { estado: 'nao-medido', motivo: 'shader' };
      gl.useProgram(p);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const texturas = conta.medir(() => fontes.map((c) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        return t;
      })).r;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.viewport(0, 0, LARGURA, ALTURA);
      const pixel = new Uint8Array(4);
      const compor = () => {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const t of texturas) {
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[0];
      };
      conta.medir(compor);
      const tempos = [];
      for (let j = 0; j < 3; j++) {
        await ceder();
        tempos.push(conta.medir(compor).ms);
      }
      return { estado: 'medido', valor: arred(mediana(tempos)), unidade: 'ms' };
    } finally {
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* o contexto já foi */ }
      soltar([alvo]);
    }
  }

  // ─── Tela ───────────────────────────────────────────────────────────────────────────────────
  //
  // A frequência real, pela mediana do intervalo entre 30 quadros de `requestAnimationFrame`. A
  // mediana aguenta um quadro perdido no meio; uma tela de 60 Hz dá 16,7 ms e sai como 60. Quase
  // não gasta CPU, e por isso não entra no teto. Sem quadro em 2 s (uma aba que ficou escondida no
  // meio), a medida fica de fora.

  function passoTela(sinal) {
    return new Promise((ok) => {
      const intervalos = [];
      let anterior = null;
      const fim = setTimeout(() => ok({ estado: 'nao-medido', motivo: 'sem-quadros' }), 2000);
      const quadro = (t) => {
        if (sinal?.aborted) { clearTimeout(fim); ok(null); return; }
        if (anterior !== null) intervalos.push(t - anterior);
        anterior = t;
        if (intervalos.length < 30) { requestAnimationFrame(quadro); return; }
        clearTimeout(fim);
        const ms = mediana(intervalos);
        ok({ estado: 'medido', valor: Math.round(1000 / ms), unidade: 'Hz' });
      };
      requestAnimationFrame(quadro);
    });
  }

  // ─── Armazenamento da origem ────────────────────────────────────────────────────────────────
  //
  // 4 MB gravados e lidos no OPFS, o disco que um app usa para guardar o que baixou. O arquivo
  // nasce com um nome da sonda e sai no fim, dê certo ou não. Menor é mais rápido.

  async function passoArmazenamento(conta) {
    const nao = (motivo) => ({ gravar: { estado: 'nao-medido', motivo }, ler: { estado: 'nao-medido', motivo } });
    if (!navigator.storage?.getDirectory) return nao('sem-opfs');
    const NOME = 'vssh-sonda-do-aparelho.bin';
    let raiz;
    try { raiz = await navigator.storage.getDirectory(); } catch { return nao('sem-opfs'); }
    const dados = new Uint8Array(4 * 1024 * 1024);
    const r = sorteio(544);
    for (let i = 0; i < dados.length; i += 4096) dados[i] = Math.floor(r() * 256);
    try {
      conta.conferir();
      const arquivo = await raiz.getFileHandle(NOME, { create: true });
      if (typeof arquivo.createWritable !== 'function') return nao('sem-escrita');
      const t0 = performance.now();
      const escrita = await arquivo.createWritable();
      await escrita.write(dados);
      await escrita.close();
      const t1 = performance.now();
      conta.conferir();
      const lido = await (await arquivo.getFile()).arrayBuffer();
      const t2 = performance.now();
      if (lido.byteLength !== dados.length) return nao('leitura-incompleta');
      return {
        gravar: { estado: 'medido', valor: arred(t1 - t0), unidade: 'ms' },
        ler:    { estado: 'medido', valor: arred(t2 - t1), unidade: 'ms' },
      };
    } catch (e) {
      if (e instanceof Interrompida) throw e;
      return nao('falhou');
    } finally {
      try { await raiz.removeEntry(NOME); } catch { /* não chegou a nascer */ }
    }
  }

  // ─── A rodada ───────────────────────────────────────────────────────────────────────────────

  /**
   * Roda a sonda inteira. Devolve `{ versao, medidas, custos, gastoMs, duracaoMs }`, ou `null`
   * quando o `sinal` pediu para parar no meio: uma medida pela metade não se guarda. `custos` é o
   * trabalho síncrono de cada passo, em ms, e diz à equipe onde a sonda pesa num aparelho.
   *
   * A ordem vai do mais barato ao mais caro, para o teto cortar as camadas antes de cortar o
   * resto: o armazenamento é quase todo espera de disco, e vem antes delas.
   */
  async function rodar({ sinal } = {}) {
    const conta = novaConta(sinal);
    const inicio = performance.now();
    const medidas = {};
    const custos = {};
    const foraDoTeto = { estado: 'nao-medido', motivo: 'teto' };
    let fontes = null;
    // Um passo só começa abaixo do teto; o que ele gastou entra em `custos`.
    const passo = async (nome, fn, fora = foraDoTeto) => {
      if (!conta.cabe()) return fora;
      const antes = conta.gasto;
      const r = await fn();
      custos[nome] = Math.round(conta.gasto - antes);
      await ceder();
      return r;
    };
    try {
      medidas.cpu = await passo('cpu', () => passoCpu(conta));
      medidas.layout = await passo('layout', () => passoLayout(conta));
      const tela = await passoTela(sinal);
      if (!tela) return null;
      medidas.tela = tela;
      conta.conferir();
      const disco = await passo('armazenamento', () => passoArmazenamento(conta), { gravar: foraDoTeto, ler: foraDoTeto });
      medidas.gravar4mb = disco.gravar;
      medidas.ler4mb = disco.ler;
      fontes = await passo('camadas', () => conta.medir(camadas).r, null);
      if (fontes) {
        medidas.canvas2d = await passo('canvas2d', () => passoCanvas2d(conta, fontes));
        medidas.webgl2 = await passo('webgl2', () => passoWebgl2(conta, fontes));
      } else {
        medidas.canvas2d = foraDoTeto;
        medidas.webgl2 = foraDoTeto;
      }
      conta.conferir();
    } catch (e) {
      if (e instanceof Interrompida) return null;
      throw e;
    } finally {
      if (fontes) soltar(fontes);
    }
    return {
      versao: VERSAO,
      medidas,
      custos,
      gastoMs: Math.round(conta.gasto),
      duracaoMs: Math.round(performance.now() - inicio),
    };
  }

  return { VERSAO, TETO_MS, rodar };
})();
