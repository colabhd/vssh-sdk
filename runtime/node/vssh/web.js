'use strict';

// O frontend de um app: uma SPA servida de um diretório, com o SDK web e o Tuff no `<head>`. O
// par de `vssh/web.py`.
//
// Todo app com janela publica um diretório de arquivos estáticos e um `index.html`, e todo mundo
// tropeça nas mesmas quatro coisas ao fazer isso à mão. Este módulo as resolve de uma vez:
//
//   1. O SDK web. O sistema serve `_sdk/vssh.js` dentro do espaço de URL de todo app, e um app o
//      alcança por esse caminho relativo à própria raiz. Por padrão a tag entra no `<head>` de
//      todo index servido daqui; `tuff: true` acrescenta o ambiente visual (`_sdk/tuff/…`). Nada
//      em `_sdk/` leva carimbo, porque os bytes são do portal, e nada em `_sdk/` é servido daqui,
//      porque o portal responde antes de o pedido chegar ao backend.
//   2. O carimbo de versão dos arquivos do próprio app. Um script injetado sai como
//      `boot.js?v=<hash do conteúdo>` e é servido como imutável; conteúdo novo mora noutra URL, e
//      nenhum cache no caminho (navegador, portal, CDN) consegue servir o velho no lugar do novo.
//      O `index.html` sai `no-store`, e é ele que traz a URL nova. `Cache-Control` sozinho não
//      bastava: basta um elo do caminho guardar a resposta e o navegador executa um script antigo
//      com o arquivo em disco já certo.
//   3. O `<base>` das rotas profundas. Uma SPA com roteamento HTML5 recebe o index em
//      `/biblioteca/library`, e ali todo caminho relativo do HTML resolve contra essa rota:
//      `<script src="app.js">` vira `/biblioteca/app.js`. O servidor injeta `<base href="../">`
//      com a profundidade da rota, logo depois de `<head>`, e o preload scanner do navegador o vê
//      antes de qualquer tag. Um `<base>` calculado por script inline chega tarde para o scanner,
//      que já disparou os pedidos. Um `<base>` escrito pelo app manda.
//   4. O confinamento. Um caminho só é servido se cair dentro da raiz depois de resolvido, e o
//      caminho real é revalidado depois do `stat`, porque um symlink dentro do bundle apontando
//      para fora passaria pela checagem lexical.
//
//   const { servidor, web } = require('vssh');
//   const spa = web.spa('frontend', { tuff: true, rotasProfundas: true, scripts: ['boot.js'] });
//
//   http.createServer(servidor.portao(async (req, res) => {
//     if (await spa(req, res)) return;
//     servidor.responderJson(res, 404, { error: 'Rota desconhecida.' });
//   }));
//
// `spa(...)` devolve `async (req, res, url?) => boolean`, e `false` quer dizer que o pedido não é
// desta SPA: 404 é decisão de quem compõe as rotas, e um handler que respondesse sozinho
// impediria o app de tentar as próprias rotas depois dele.
//
// O que fica de fora de propósito: reescrever caminho absoluto (`/static/…`) para relativo. Isso
// é fato do bundle, resolvido no build; reescrever HTML a cada resposta esconderia o problema.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const app = require('./app.js');

/** O SDK web, servido pelo sistema. Entra no `<head>` por padrão. */
const SDK = '_sdk/vssh.js';

/**
 * O Tuff que `tuff: true` injeta: os valores, os componentes e o comportamento, na ordem em que
 * têm de carregar (os tokens declaram as variáveis que o resto lê).
 */
const TUFF = ['tuff-tokens.css', 'tuff.css', 'tuff.js'];

/**
 * O reset da página inteira (caixa, tipografia, foco). Fora de `TUFF` porque um bundle grande e
 * antigo traz o CSS dele inteiro, e um `box-sizing` global entrando por adoção parcial muda a
 * medida de todo elemento que não declara a própria caixa.
 */
const TUFF_BASE = 'tuff-base.css';

/**
 * O sprite de ícones. Script, porque um `<use href="#ico-…">` só resolve dentro do próprio
 * documento, e o sprite do shell não atravessa o iframe.
 */
const TUFF_ICONES = 'tuff-icones.js';

/** As peças de mídia: trilha, volume, grade virtualizada, visor com zoom. */
const TUFF_MIDIA = ['tuff-midia.css', 'tuff-midia.js'];

// O mapa é de bundle web (js, css, fonte, wasm). O de `dados` cobre o conteúdo que o usuário
// guarda; duplicar um mapa pequeno é o preço de as duas peças não dependerem uma da outra.
const TIPOS = {
  html: 'text/html; charset=utf-8',
  // XHTML é o único jeito de pedir ao navegador o parser de XML, e há coisa que só funciona nele
  // (tag auto-fechada, namespace, entidade declarada). Servido como `octet-stream`, o navegador
  // baixa o arquivo em vez de renderizar, sem nada dizendo por quê.
  xhtml: 'application/xhtml+xml; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  pdf: 'application/pdf',
  bin: 'application/octet-stream',
};

// Acima disto o carimbo sai de mtime e tamanho, e não do conteúdo: ler um wasm de 40 MB para
// carimbar custaria mais do que o problema resolve. É um carimbo pior (muda entre instalações da
// mesma versão, o que custa um download a mais), e nunca deixa de mudar quando o conteúdo muda,
// que é a propriedade da qual a correção depende.
const HASH_MAX_BYTES = 4 * 1024 * 1024;

const IMUTAVEL = 'public, max-age=31536000, immutable';

/** O `Content-Type` pela extensão; `application/octet-stream` para o que o mapa não tem. */
function tipoDeConteudo(p) {
  const ponto = p.lastIndexOf('.');
  const ext = ponto === -1 ? '' : p.slice(ponto + 1).toLowerCase();
  return TIPOS[ext] || 'application/octet-stream';
}

/**
 * Canonicaliza. A raiz e o alvo passam pela mesma função, porque duas grafias do mesmo diretório
 * nunca casam, e o sintoma é todo caminho aninhado virar 404 enquanto o index continua servindo.
 * `realpathSync.native`, porque no Windows só a nativa expande o nome curto 8.3 (`ARTHUR~1`), e
 * é ela que `fsp.realpath` usa do outro lado da comparação. Um diretório que ainda não existe
 * segue lexical: é o caso de subir o backend antes do build, e a resposta certa ali é o 500 com
 * a dica, e não o processo morrer no boot.
 */
function real(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

/**
 * Um caminho relativo é relativo ao pacote do app (o diretório do `vssh-app.json`), e ao
 * diretório corrente fora de um pacote. É o que faz `web.spa('frontend')` achar o mesmo
 * diretório sob o `vssh-app-run` e numa bancada que sobe o app de outro lugar.
 */
function absoluto(p) {
  return path.isAbsolute(p) ? p : path.join(app.raiz() || process.cwd(), p);
}

function criarCarimbador(avisar) {
  const cache = new Map();   // caminho absoluto: { mtimeMs, size, hash }

  /** Hash do conteúdo, memoizado por (mtime, tamanho). `null` quando o arquivo não se lê. */
  return function carimboDe(arquivo) {
    let st;
    try { st = fs.statSync(arquivo); } catch { return null; }
    if (!st.isFile()) return null;
    const achou = cache.get(arquivo);
    if (achou && achou.mtimeMs === st.mtimeMs && achou.size === st.size) return achou.hash;
    let hash;
    if (st.size > HASH_MAX_BYTES) {
      hash = crypto.createHash('sha1').update(`${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 12);
    } else {
      try {
        hash = crypto.createHash('sha1').update(fs.readFileSync(arquivo)).digest('hex').slice(0, 12);
      } catch (err) {
        avisar('carimbo-falhou', { arquivo, erro: err.message });
        return null;
      }
    }
    cache.set(arquivo, { mtimeMs: st.mtimeMs, size: st.size, hash });
    return hash;
  };
}

function listaDoTuff(tuff) {
  if (tuff === true) return [...TUFF];
  if (!tuff) return [];
  if (typeof tuff === 'string') tuff = [tuff];
  for (const nome of tuff) {
    if (nome.includes('/') || !(nome.endsWith('.css') || nome.endsWith('.js'))) {
      throw new TypeError(`tuff: '${nome}' não é um arquivo de _sdk/tuff/ (um nome, .css ou .js).`);
    }
  }
  return [...tuff];
}

/**
 * Devolve `async (req, res, url?) => boolean` para a SPA em `raiz`.
 *
 * `scripts` e `folhas` são caminhos do próprio app, relativos à raiz, injetados no `<head>` com
 * o carimbo de conteúdo: as folhas como `<link rel="stylesheet">`, antes dos scripts, porque o
 * `<link>` bloqueia a primeira pintura e descobri-lo cedo é o que evita um quadro sem estilo.
 * `sdk: false` deixa o `_sdk/vssh.js` de fora, para o app que escreve a tag à mão. `tuff: true`
 * injeta `TUFF`; uma lista nomeia os arquivos de `_sdk/tuff/` que entram, para quem quer também
 * `TUFF_BASE`, `TUFF_ICONES` ou `TUFF_MIDIA`. Os do Tuff saem antes dos do app, e o SDK antes de
 * qualquer script.
 *
 * `montagens` serve um prefixo de URL (com `/` nas duas pontas) de outro diretório, com o mesmo
 * confinamento, o mesmo 304 e o mesmo carimbo do bundle. `apelidos` mapeia um prefixo em outro
 * quando o caminho pedido não existe (`{ '/static/': '/' }`, para um bundle que assume dois
 * prefixos para os mesmos arquivos). A precedência é caminho direto, montagem, apelido: o app é
 * dono da própria raiz, e o apelido é o palpite de último recurso.
 *
 * `rotasProfundas: true` serve o index em rota que não é arquivo nenhum, quando o pedido é de
 * navegação (`Accept: text/html`, sem ponto no último segmento), com o `<base>` da profundidade.
 * Um `fetch('/api/x')` que erra o caminho continua recebendo `false`, e não o index, senão o app
 * faria `JSON.parse` de HTML longe da causa.
 *
 * `dica` é uma linha a mais na resposta de bundle ausente, dizendo como reconstruí-lo.
 * `aoAvisar(evento, detalhe)` recebe o que a SPA não consegue resolver sozinha (`index-ausente`,
 * `carimbo-falhou`); o `log` de `servidor.criarLog()` serve direto.
 *
 * @param {string} raiz
 * @param {{indice?: string, scripts?: string[], folhas?: string[], montagens?: Record<string, string>,
 *   apelidos?: Record<string, string>, rotasProfundas?: boolean, sdk?: boolean, tuff?: boolean|string[],
 *   dica?: string, aoAvisar?: (evento: string, detalhe: object) => void}} [opcoes]
 */
function spa(raiz, opcoes = {}) {
  const indice = opcoes.indice || 'index.html';
  const doTuff = listaDoTuff(opcoes.tuff).map((n) => `_sdk/tuff/${n}`);
  const folhas = [...doTuff.filter((t) => t.endsWith('.css')), ...(opcoes.folhas || []).map(String)];
  const scripts = [
    ...(opcoes.sdk === false ? [] : [SDK]),
    ...doTuff.filter((t) => t.endsWith('.js')),
    ...(opcoes.scripts || []).map(String),
  ];
  const apelidos = Object.entries(opcoes.apelidos || {});
  const rotasProfundas = !!opcoes.rotasProfundas;
  const dica = opcoes.dica || '';
  const avisar = opcoes.aoAvisar || (() => {});

  const base = real(path.resolve(absoluto(raiz)));

  const montadas = Object.entries(opcoes.montagens || {}).map(([prefixo, diretorio]) => {
    if (!prefixo.startsWith('/') || !prefixo.endsWith('/')) {
      throw new TypeError(
        `montagens: o prefixo '${prefixo}' precisa começar e terminar com '/'; sem isso, '/docsX' casaria com '/docs'.`);
    }
    return { prefixo, base: real(path.resolve(absoluto(diretorio))) };
  });

  const carimboDe = criarCarimbador(avisar);
  let cache = null;   // { mtimeMs, carimbos, corpo, comBase: Map<niveis, Buffer> }

  /** O arquivo em disco de um `src` injetado, pela mesma precedência que serve o pedido. */
  function arquivoDoSrc(src) {
    const rel = src.split('?')[0];
    const caminho = rel.startsWith('/') ? rel : `/${rel}`;
    for (const m of montadas) {
      if (caminho.startsWith(m.prefixo)) return path.join(m.base, caminho.slice(m.prefixo.length));
    }
    return path.join(base, caminho.replace(/^\/+/, ''));
  }

  // O que é do sistema nunca leva carimbo: os bytes moram no portal, e um `?v=` aqui afirmaria
  // um conteúdo que este processo não tem como conhecer.
  const carimbo = (src) => (src.startsWith('_sdk/') ? null : carimboDe(arquivoDoSrc(src)));

  function url(src) {
    const v = carimbo(src);
    return (v ? `${src}${src.includes('?') ? '&' : '?'}v=${v}` : src).replace(/"/g, '&quot;');
  }

  function tags() {
    // Sem `defer`: precisa executar antes dos scripts diferidos do bundle, que já esperam o parse.
    // As aspas duplas são escapadas porque interpolar em HTML sem escapar envelhece mal, mesmo com
    // o `src` vindo do app.
    //
    // O `<link>` sai auto-fechado: a barra é ignorada em HTML (`link` é void) e obrigatória em
    // XML. Sem ela, um index XHTML morre com erro fatal de parse no lugar do app.
    return [
      ...folhas.map((f) => `<link rel="stylesheet" href="${url(f)}"/>`),
      ...scripts.map((s) => `<script src="${url(s)}"></script>`),
    ].join('\n');
  }

  async function corpoDoIndex() {
    const caminho = path.join(base, indice);
    const st = await fsp.stat(caminho);
    // Os carimbos entram na chave do cache, e não só no corpo: um script atualizado sem que o
    // index mude é o caso normal de uma reinstalação. Sem isto o processo continuaria servindo
    // a URL carimbada antiga até alguém tocar no index, e o carimbo teria virado enfeite
    // justamente no cenário que ele existe para cobrir. As folhas entram na chave pelo mesmo
    // motivo, e no caso delas uma cor velha parece decisão de design.
    const carimbos = [...folhas, ...scripts].map((s) => `${s}=${carimbo(s) || ''}`).join('|');
    if (cache && cache.mtimeMs === st.mtimeMs && cache.carimbos === carimbos) return cache.corpo;
    let html = await fsp.readFile(caminho, 'utf8');
    if (folhas.length || scripts.length) {
      const marcas = tags();
      html = html.includes('</head>') ? html.replace('</head>', `${marcas}\n</head>`) : marcas + html;
    }
    // As variantes com `<base>` são montadas sobre este corpo, e caem junto: um index recarregado
    // que continuasse servindo a variante antiga daria HTML novo na raiz e velho em toda rota
    // profunda.
    cache = { mtimeMs: st.mtimeMs, carimbos, corpo: Buffer.from(html, 'utf8'), comBase: new Map() };
    return cache.corpo;
  }

  /**
   * O index com um `<base>` que leva à raiz do app, para a rota profunda.
   *
   * O `href` é relativo e sobe a profundidade do diretório da rota, uma barra a menos que o
   * caminho tem, porque a última componente é o "arquivo" e não conta: `/a/b` resolve a partir
   * de `/a/`, um nível; `/a/b/c` a partir de `/a/b/`, dois. O cache é por profundidade, e não por
   * rota: são dois ou três valores numa SPA inteira, e chavear por rota faria um mapa que cresce
   * com o tráfego.
   */
  function indexComBase(corpo, caminhoUrl) {
    const niveis = Math.max(0, (caminhoUrl.match(/\//g) || []).length - 1);
    if (!niveis || !cache) return corpo;
    if (cache.comBase.has(niveis)) return cache.comBase.get(niveis);
    const html = corpo.toString('utf8');
    let saida = corpo;
    // Um `<base>` escrito pelo app manda. Dois `<base href>` no mesmo documento não é erro, o
    // navegador usa o primeiro, e o nosso venceria calado.
    if (!/<base\s[^>]*href/i.test(html)) {
      const marca = `<base href="${'../'.repeat(niveis)}"/>`;
      // Logo depois de `<head>`, e nunca antes de `</head>`: o `<base>` só vale para as URLs que
      // vêm depois dele, e o preload scanner lê na ordem do documento.
      saida = Buffer.from(/<head[^>]*>/i.test(html)
        ? html.replace(/(<head[^>]*>)/i, `$1${marca}`)
        : marca + html, 'utf8');   // sem `<head>` o navegador cria um implícito
    }
    cache.comBase.set(niveis, saida);
    return saida;
  }

  /**
   * Um caminho só é servido se cair dentro da base depois de resolvido, e o caminho real é
   * revalidado depois do `stat`: um symlink dentro do bundle apontando para fora passaria pela
   * checagem lexical. `dir` é parâmetro porque uma montagem é a mesma pergunta contra outro
   * diretório, e uma segunda noção de "está confinado?" ficaria para trás quando a primeira
   * ganhasse uma defesa.
   */
  async function statDentro(caminhoUrl, dir = base) {
    const alvo = path.join(dir, caminhoUrl);
    if (alvo !== dir && !alvo.startsWith(dir + path.sep)) return null;
    try {
      const st = await fsp.stat(alvo);
      if (st.isDirectory()) return null;
      const r = await fsp.realpath(alvo);
      if (r !== dir && !r.startsWith(dir + path.sep)) return null;
      return { alvo, st };
    } catch {
      return null;
    }
  }

  async function resolver(caminhoUrl) {
    const direto = await statDentro(caminhoUrl);
    if (direto) return direto;
    for (const m of montadas) {
      if (!caminhoUrl.startsWith(m.prefixo)) continue;
      const achado = await statDentro(caminhoUrl.slice(m.prefixo.length - 1), m.base);
      if (achado) return achado;
    }
    for (const [prefixo, substituto] of apelidos) {
      if (!caminhoUrl.startsWith(prefixo)) continue;
      const achado = await statDentro(substituto + caminhoUrl.slice(prefixo.length));
      if (achado) return achado;
    }
    return null;
  }

  // O tipo sai do nome do index: um `index.xhtml` servido como `text/html` carrega no parser
  // errado, e o sintoma aparece a três níveis de distância da causa.
  const TIPO_DO_INDEX = tipoDeConteudo(indice);

  function mandarTexto(req, res, status, texto) {
    const corpo = Buffer.from(texto, 'utf8');
    res.writeHead(status, { 'Content-Type': TIPOS.txt, 'Content-Length': corpo.length });
    res.end(req.method === 'HEAD' ? undefined : corpo);
  }

  /** Serve o index; com `caminhoUrl`, com o `<base>` da profundidade dele. */
  async function mandarIndex(req, res, caminhoUrl) {
    let corpo;
    try {
      corpo = await corpoDoIndex();
      if (caminhoUrl !== undefined) corpo = indexComBase(corpo, caminhoUrl);
    } catch (err) {
      avisar('index-ausente', { raiz: base, erro: err.message });
      mandarTexto(req, res, 500, `Bundle não encontrado em ${base}.\n${dica ? dica + '\n' : ''}`);
      return true;
    }
    res.writeHead(200, { 'Content-Type': TIPO_DO_INDEX, 'Content-Length': corpo.length, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : corpo);
    return true;
  }

  return async function servir(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    url = url || new URL(req.url || '/', 'http://app');
    // `%` malformado faz `decodeURIComponent` lançar; o que importa é um caminho inválido não
    // virar 500 genérico no `catch` de quem compõe as rotas.
    let caminhoUrl;
    try {
      caminhoUrl = decodeURIComponent(url.pathname);
    } catch {
      mandarTexto(req, res, 400, 'Caminho inválido.\n');
      return true;
    }
    // O espaço `_sdk/` é do sistema, que o responde antes de o pedido chegar aqui. Um pedido que
    // chega é de uma hospedagem sem o portal na frente, e a resposta certa é a de quem compõe as
    // rotas, e nunca um arquivo do app com esse nome.
    if (caminhoUrl.startsWith('/_sdk/')) return false;
    if (caminhoUrl === '/' || caminhoUrl === `/${indice}`) return mandarIndex(req, res);

    const achado = await resolver(caminhoUrl);
    if (!achado) {
      const aceitaHtml = (req.headers.accept || '').includes('text/html');
      const ultimo = caminhoUrl.slice(caminhoUrl.lastIndexOf('/') + 1);
      if (rotasProfundas && req.method !== 'HEAD' && aceitaHtml && !ultimo.includes('.')) {
        return mandarIndex(req, res, caminhoUrl);
      }
      return false;
    }

    const { alvo, st } = achado;
    // O `?v=` é conferido contra o hash de agora, e nunca aceito de boca: um carimbo velho, de
    // um index que sobreviveu em algum cache apesar do `no-store`, ganharia `immutable` e fixaria
    // os bytes errados por um ano.
    const pedido = url.searchParams.get('v');
    const imutavel = !!pedido && pedido === carimboDe(alvo);

    const ultima = st.mtime.toUTCString();
    const ims = req.headers['if-modified-since'];
    if (!imutavel && ims && ims === ultima) {
      res.writeHead(304, { 'Last-Modified': ultima, 'Cache-Control': 'no-cache' });
      res.end();
      return true;
    }

    res.writeHead(200, {
      'Content-Type': tipoDeConteudo(alvo),
      'Content-Length': st.size,
      'Last-Modified': ultima,
      // Com carimbo válido, conteúdo novo mora noutra URL, e esta pode ser cacheada para sempre.
      // Sem carimbo é bundle de nome fixo (`main.js`), e cache longo serviria a versão velha
      // depois de um upgrade: `no-cache` revalida, e o 304 resolve em zero bytes.
      'Cache-Control': imutavel ? IMUTAVEL : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(alvo).pipe(res);
    return true;
  };
}

module.exports = { spa, tipoDeConteudo, SDK, TUFF, TUFF_BASE, TUFF_ICONES, TUFF_MIDIA };
