'use strict';

// O filesystem privado do app, confinado ao diretório de dados, e as rotas que o frontend chama.
// O par de `vssh/dados.py`.
//
// `app.dados()` diz onde o app guarda o que não pode perder; este módulo faz desse diretório um
// filesystem que o frontend alcança por HTTP: ler, escrever, listar, renomear, copiar, remover
// (para uma lixeira, por padrão), e servir binário com `Range`. Toda entrada vinda do frontend
// passa por um portão de caminho que resolve o ancestral existente mais próximo com `realpath` e
// recusa o que sair da raiz: `..`, caminho absoluto de fora, e symlink dentro da raiz apontando
// para fora, inclusive quando o arquivo final ainda não existe (o caso da escrita). A listagem
// descarta symlinks, então um link para fora não vaza nem por leitura.
//
// O backend roda como o próprio usuário Linux, e não há privilégio a proteger dele mesmo. O que
// o portão evita é um defeito de caminho do frontend virar escrita fora da raiz, e um symlink na
// raiz virar caminho de escrita arbitrário para outro processo que fale com este socket. Quem
// chega ao socket já passou pelo portão de token do `servidor`, e por isso as rotas daqui não têm
// um segundo.
//
//   const { dados, servidor } = require('vssh');
//   const arquivos = dados.rotas(dados.abrir());
//
//   http.createServer(servidor.portao(async (req, res) => {
//     if (await arquivos(req, res)) return;
//     ...
//   }));
//
// `abrir()` devolve as operações, para o backend usar direto; `rotas(...)` devolve
// `async (req, res, url?) => boolean`, com `false` querendo dizer que o pedido não é destas rotas.
//
// ── O contrato de wire ───────────────────────────────────────────────────────────────────────
//
// É o do toolkit de apps (`vssh-app-fs`), sem mudança: um frontend escrito contra ele fala com
// este backend em Node ou em Python sem tocar numa linha.
//
//   POST <prefixo>                        {"op": …, …}  ->  {"ok": true, "result": …}
//   POST <prefixo>/write-binary?path=…    corpo cru     ->  o mesmo de `write-file`
//   GET  <arquivos><caminho>              o arquivo, com `Content-Type`, `Last-Modified`,
//                                         `Accept-Ranges` e um intervalo de `Range`
//
//   op            parâmetros        result
//   exists        path              {exists}            200 nos dois casos
//   stat          path              {type, size, mtime}
//   read-file     path              {content}
//   write-file    path, content     {path, size, mtime}
//   mkdir         path              {}                  já existir não é erro
//   mkdir-recur   path              {}
//   readdir       path              [path]              recursivo, sem ocultos, sem filtro
//   unlink        path              {recycled}          move para a lixeira; `recycle: false` apaga
//   rename        from, to          {}
//   copy          from, to          {}                  sobrescreve
//   open-dir      path              {path, files: [{path, content, size, mtime, type}]}
//   get-files     path              idem
//
// `path` pode ser relativo à raiz ou absoluto dentro dela; `mtime` é epoch em milissegundos.
// Erro é `{"ok": false, "error": {code, message, op}}`, com o status pelo código: `ENOENT` 404,
// `EACCES` e `EPERM` 403, `EINVAL` e os errnos de caminho impossível (`EISDIR`, `ENOTDIR`,
// `ENAMETOOLONG`, `ELOOP`) 400, `EEXIST` 409, método errado 405. 500 fica para o que é defeito do
// servidor (`ENOSPC`, `EIO`, `EMFILE`, erro de programação), e essa fronteira é deliberada: um
// caminho apagado respondido como 500 faria o monitoramento acordar alguém por um clique.
//
// `exists` e `stat` respondem sobre um caminho ausente de propósito de jeitos diferentes: `stat`
// pede metadados, e sem o arquivo não há resposta (404); `exists` pergunta, e a ausência é a
// resposta (200). Sem a segunda, quem só quer saber se o arquivo está lá usa o erro da primeira
// como fluxo de controle, e toda sondagem de rotina vira linha vermelha nos dois lados. Fora da
// raiz, `exists` continua sendo `EACCES`: responder `false` já contaria que o portão foi olhar.
//
// Arquivo acima de `maxBytes` é omitido de `open-dir`/`get-files`, e continua legível por
// `read-file`. Listá-lo com conteúdo vazio seria pior: para o app ele pareceria vazio, e o
// primeiro save por cima apagaria o conteúdo real.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const app = require('./app.js');

// Erros com nome estável, para o transporte mapear em status sem casar frase.
const ENOENT = 'ENOENT';
const EACCES = 'EACCES';
const EINVAL = 'EINVAL';
const EEXIST = 'EEXIST';

const STATUS = {
  [ENOENT]: 404,
  [EACCES]: 403,
  EPERM: 403,
  [EINVAL]: 400,
  EISDIR: 400,
  ENOTDIR: 400,
  ENAMETOOLONG: 400,
  ELOOP: 400,
  [EEXIST]: 409,
  EMETHOD: 405,
};

/** Extensões cujo conteúdo entra em `open-dir`/`get-files`: texto que um app quer ler inteiro. */
const EXTENSOES = ['txt', 'md', 'markdown', 'json', 'csv', 'yml', 'yaml', 'html', 'css', 'js', 'xml'];

/** O que fica fora das listagens filtradas. `ocultos` é qualquer componente que começa com `.`. */
const IGNORADOS = {
  prefixos: [],
  exatos: [],
  pastas: ['node_modules', '.git'],
  sufixos: ['.DS_Store'],
  ocultos: true,
};

/** Para onde `remover` leva o que remove, relativo à raiz. Oculta, então fora das listagens. */
const LIXEIRA = '.lixeira';

/** Acima disto o arquivo fica fora de `open-dir`. */
const MAX_BYTES = 16 * 1024 * 1024;

/** O teto do corpo de um pedido às rotas. */
const MAX_CORPO = 64 * 1024 * 1024;

// O mapa é do conteúdo que o usuário guarda (imagem, PDF, áudio); o de `web` cobre bundle.
const TIPOS = {
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8', csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', xml: 'application/xml; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  bmp: 'image/bmp', pdf: 'application/pdf',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  zip: 'application/zip',
};

/** O `Content-Type` pela extensão; `application/octet-stream` para o que o mapa não tem. */
function tipoDeConteudo(p) {
  const ponto = p.lastIndexOf('.');
  const ext = ponto === -1 ? '' : p.slice(ponto + 1).toLowerCase();
  return TIPOS[ext] || 'application/octet-stream';
}

/**
 * Uma recusa com código estável (`ENOENT`, `EACCES`, `EINVAL`, `EEXIST`). A mensagem é para
 * gente; o código é o que vira status.
 */
class ErroDeDados extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroDeDados';
    this.code = codigo;
  }
}

const naoEncontrado = (p) => new ErroDeDados(ENOENT, `não encontrado: ${p}`);
const foraDaRaiz = (p) => new ErroDeDados(EACCES, `caminho fora da raiz: ${p}`);

// ── O portão de caminho ─────────────────────────────────────────────────────

const dentroDe = (raiz, candidato) => candidato === raiz || candidato.startsWith(raiz + path.sep);

/**
 * O `realpath` do ancestral existente mais próximo, e os componentes que faltam abaixo dele. É o
 * que valida o destino de uma escrita cujo arquivo (às vezes o diretório pai) ainda não existe,
 * resolvendo os symlinks dos diretórios que existem.
 */
function realDoAncestralExistente(alvo) {
  let atual = path.resolve(alvo);
  const faltando = [];
  for (;;) {
    try {
      return { real: fs.realpathSync(atual), faltando: faltando.reverse() };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const pai = path.dirname(atual);
      if (pai === atual) return { real: atual, faltando: faltando.reverse() };
      faltando.push(path.basename(atual));
      atual = pai;
    }
  }
}

/**
 * Resolve um caminho recebido do cliente contra a raiz: relativo a ela ou absoluto dentro dela.
 * Devolve `{ abs, rel }` com o absoluto já resolvido e dentro da raiz.
 */
function resolverNaRaiz(raizReal, entrada) {
  if (typeof entrada !== 'string' || entrada.length === 0) throw new ErroDeDados(EINVAL, 'caminho ausente');
  if (entrada.includes('\0')) throw new ErroDeDados(EINVAL, 'caminho com byte nulo');
  const junto = path.isAbsolute(entrada) ? path.normalize(entrada) : path.join(raizReal, entrada);
  // A recusa lexical vem antes de tocar o disco.
  if (!dentroDe(raizReal, path.normalize(junto))) throw foraDaRaiz(entrada);
  const { real, faltando } = realDoAncestralExistente(junto);
  // `real` é a parte que existe, com symlinks resolvidos. Fora da raiz, um symlink de dentro
  // aponta para fora.
  if (!dentroDe(raizReal, real)) throw foraDaRaiz(entrada);
  const abs = faltando.length ? path.join(real, ...faltando) : real;
  if (!dentroDe(raizReal, abs)) throw foraDaRaiz(entrada);
  return { abs, rel: abs === raizReal ? '' : path.relative(raizReal, abs) };
}

function extDe(p) {
  const ext = path.extname(p);
  return ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase();
}

function temComponenteOculto(rel) {
  return rel.split('/').some((seg) => seg.length > 1 && seg.startsWith('.') && seg !== '..');
}

function ignorador(ignorar) {
  const cfg = { ...IGNORADOS, ...ignorar };
  function ignorado(rel) {
    if (!rel) return false;
    const p = rel.split(path.sep).join('/');
    if (cfg.prefixos.some((x) => p === x || p.startsWith(x + '/'))) return true;
    if (cfg.exatos.includes(p)) return true;
    if (cfg.pastas.some((nome) => p.split('/').slice(0, -1).includes(nome))) return true;
    if (cfg.sufixos.some((x) => p.endsWith(x))) return true;
    return false;
  }
  ignorado.cfg = cfg;
  return ignorado;
}

function infoDe(st) {
  return {
    type: st.isDirectory() ? 'directory' : 'file',
    size: st.size,
    // Epoch em milissegundos, como o resto do contrato. Segundos fariam toda comparação de mtime
    // com o frontend errar por três ordens de grandeza.
    mtime: Math.round(st.mtimeMs),
  };
}

// ── As operações ────────────────────────────────────────────────────────────

/**
 * As operações sobre `raiz`: o diretório de dados do app por padrão, ou um caminho relativo a
 * ele (`abrir('privado')`), ou um absoluto. O diretório é criado se faltar, e resolvido uma vez,
 * no setup: toda comparação depois é contra o caminho real, senão um symlink no meio da raiz
 * derrubaria todas as checagens de prefixo.
 *
 * `extensoes` são as que entram com conteúdo em `open-dir` (`EXTENSOES`); `ignorar` sobrescreve
 * chaves de `IGNORADOS`; `lixeira` é o destino de `remover`, relativo à raiz; `maxBytes` é o teto
 * de `open-dir`. `aoAvisar(evento, detalhe)` recebe `arquivo-omitido`; o `log` de
 * `servidor.criarLog()` serve direto.
 *
 * @param {string} [raiz]
 * @param {{extensoes?: string[], ignorar?: object, lixeira?: string, maxBytes?: number,
 *   aoAvisar?: (evento: string, detalhe: object) => void, env?: NodeJS.ProcessEnv}} [opcoes]
 */
function abrir(raiz, opcoes = {}) {
  const base = app.dados(opcoes.env);
  const pedida = raiz === undefined || raiz === null ? base : path.isAbsolute(raiz) ? raiz : path.join(base, raiz);
  fs.mkdirSync(pedida, { recursive: true });
  const raizReal = fs.realpathSync(pedida);
  const extensoes = new Set((opcoes.extensoes || EXTENSOES).map((e) => e.toLowerCase()));
  const ignorado = ignorador(opcoes.ignorar);
  const ocultos = ignorado.cfg.ocultos;
  const lixeira = opcoes.lixeira || LIXEIRA;
  const maxBytes = opcoes.maxBytes === undefined ? MAX_BYTES : opcoes.maxBytes;
  const avisar = opcoes.aoAvisar || (() => {});

  const resolver = (entrada) => resolverNaRaiz(raizReal, entrada);

  // Recursivo: descarta symlinks, devolve só arquivos, caminhos absolutos. Os ocultos saem pela
  // configuração, e nunca incondicionalmente, senão `ocultos: false` mentiria.
  async function caminhar(inicio, aplicarIgnorados) {
    const saida = [];
    const fila = [inicio];
    while (fila.length) {
      const dir = fila.pop();
      let entradas;
      try {
        entradas = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      for (const e of entradas) {
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        const rel = path.relative(raizReal, abs).split(path.sep).join('/');
        if (ocultos && temComponenteOculto(rel)) continue;
        if (aplicarIgnorados && ignorado(rel)) continue;
        if (e.isDirectory()) fila.push(abs);
        else saida.push(abs);
      }
    }
    saida.sort();
    return saida;
  }

  async function coletar(dirAbs) {
    const arquivos = [];
    for (const abs of await caminhar(dirAbs, true)) {
      if (!extensoes.has(extDe(abs))) continue;
      let st;
      try {
        st = await fsp.stat(abs);
      } catch (err) {
        if (err.code === 'ENOENT') continue;   // corrida com escrita externa
        throw err;
      }
      if (st.size > maxBytes) {
        avisar('arquivo-omitido', { caminho: abs, tamanho: st.size, teto: maxBytes });
        continue;
      }
      const info = infoDe(st);
      arquivos.push({ path: abs, content: await fsp.readFile(abs, 'utf8'), size: info.size, mtime: info.mtime, type: info.type });
    }
    return arquivos;
  }

  async function abrirPasta(entrada) {
    const { abs } = resolver(entrada || raizReal);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) throw naoEncontrado(entrada || raizReal);
    if (!st.isDirectory()) throw new ErroDeDados(EINVAL, `não é diretório: ${abs}`);
    return { path: abs, files: await coletar(abs) };
  }

  return {
    raiz: raizReal,

    /** `{ exists }`. Fora da raiz continua sendo recusa. */
    async existe(entrada) {
      const { abs } = resolver(entrada);
      return { exists: (await fsp.stat(abs).catch(() => null)) !== null };
    },

    /** `{ type, size, mtime }`; `ENOENT` quando não existe. */
    async info(entrada) {
      const { abs } = resolver(entrada);
      try {
        return infoDe(await fsp.stat(abs));
      } catch (err) {
        if (err.code === 'ENOENT') throw naoEncontrado(entrada);
        throw err;
      }
    },

    /** `{ content }`, em UTF-8. */
    async ler(entrada) {
      const { abs } = resolver(entrada);
      try {
        return { content: await fsp.readFile(abs, 'utf8') };
      } catch (err) {
        if (err.code === 'ENOENT') throw naoEncontrado(entrada);
        throw err;
      }
    },

    /** Grava texto ou bytes, criando o diretório pai. `{ path, size, mtime }`. */
    async escrever(entrada, conteudo) {
      const { abs } = resolver(entrada);
      // Gravar por cima de um diretório nunca é o que o chamador quis: o caminho chegou errado.
      // Sem a checagem, o `writeFile` lança `EISDIR`, e um pedido inválido do cliente vira 500.
      const existente = await fsp.stat(abs).catch(() => null);
      if (existente && existente.isDirectory()) throw new ErroDeDados(EINVAL, `destino de escrita é um diretório: ${abs}`);
      const ehBytes = conteudo instanceof Uint8Array || ArrayBuffer.isView(conteudo);
      if (typeof conteudo !== 'string' && !ehBytes) {
        throw new ErroDeDados(EINVAL, `conteúdo deve ser texto ou bytes, veio ${typeof conteudo}`);
      }
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, typeof conteudo === 'string' ? conteudo : Buffer.from(conteudo));
      const info = infoDe(await fsp.stat(abs));
      return { path: abs, size: info.size, mtime: info.mtime };
    },

    /** Cria a pasta; já existir é o estado pedido, e não erro. */
    async criarPasta(entrada, { recursiva = false } = {}) {
      const { abs } = resolver(entrada);
      try {
        await fsp.mkdir(abs, { recursive: recursiva });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
      return {};
    },

    /**
     * Todos os arquivos abaixo de `entrada` (a raiz por padrão), recursivo, absolutos. Sem
     * `aplicarIgnorados` a visão é a crua: quem lista costuma estar atrás justamente do que a
     * regra esconde. Os ocultos seguem a configuração nos dois modos.
     */
    async listar(entrada, { aplicarIgnorados = false } = {}) {
      const { abs } = resolver(entrada || raizReal);
      return caminhar(abs, aplicarIgnorados);
    },

    /**
     * Move para a lixeira, com o caminho relativo achatado (`pasta_nota.md`), para um "desfazer"
     * continuar possível. `lixeira: false` apaga de verdade, para o que é descartável por
     * natureza (cache) e não deve inchar a lixeira.
     */
    async remover(entrada, { lixeira: paraLixeira = true } = {}) {
      const { abs, rel } = resolver(entrada);
      if (!paraLixeira) {
        try {
          await fsp.unlink(abs);
        } catch (err) {
          if (err.code === 'ENOENT') throw naoEncontrado(entrada);
          throw err;
        }
        return { recycled: null };
      }
      const { abs: destinoDir } = resolver(lixeira);
      await fsp.mkdir(destinoDir, { recursive: true });
      const destino = path.join(destinoDir, rel.split(path.sep).join('/').replace(/\//g, '_'));
      try {
        await fsp.rename(abs, destino);
      } catch (err) {
        if (err.code === 'ENOENT') throw naoEncontrado(entrada);
        if (err.code !== 'EXDEV') throw err;
        // A lixeira noutro device (bind mount): copia e remove.
        await fsp.copyFile(abs, destino);
        await fsp.unlink(abs);
      }
      return { recycled: destino };
    },

    async renomear(de, para) {
      const { abs: deAbs } = resolver(de);
      const { abs: paraAbs } = resolver(para);
      await fsp.mkdir(path.dirname(paraAbs), { recursive: true });
      try {
        await fsp.rename(deAbs, paraAbs);
      } catch (err) {
        if (err.code === 'ENOENT') throw naoEncontrado(de);
        throw err;
      }
      return {};
    },

    /** Sobrescreve sem confirmação; o contrato pede isso. */
    async copiar(de, para) {
      const { abs: deAbs } = resolver(de);
      const { abs: paraAbs } = resolver(para);
      await fsp.mkdir(path.dirname(paraAbs), { recursive: true });
      try {
        await fsp.copyFile(deAbs, paraAbs);
      } catch (err) {
        if (err.code === 'ENOENT') throw naoEncontrado(de);
        throw err;
      }
      return {};
    },

    /**
     * `{ path, files }`: os arquivos das extensões configuradas, com conteúdo, fora os ignorados
     * e os maiores que o teto.
     */
    abrirPasta,

    /** Metadados e `stream(opts)`, para o transporte servir bytes sem passar por JSON. */
    async abrirLeitura(entrada) {
      const { abs } = resolver(entrada);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st || st.isDirectory()) throw naoEncontrado(entrada);
      const info = infoDe(st);
      return { path: abs, size: info.size, mtime: info.mtime, stream: (opts) => fs.createReadStream(abs, opts) };
    },
  };
}

// ── As rotas ────────────────────────────────────────────────────────────────

const statusDe = (err) => STATUS[err && err.code] || 500;

function mandarJson(res, status, corpo) {
  const bytes = Buffer.from(JSON.stringify(corpo), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
  });
  res.end(bytes);
}

function mandarErro(res, err, op) {
  mandarJson(res, statusDe(err), {
    ok: false,
    error: {
      code: err.code || 'EINTERNAL',
      message: err.message || String(err),
      // Sem isto o cliente só sabe que "uma op falhou", e o console do navegador mostra a URL do
      // prefixo, que é a mesma para todas.
      ...(op ? { op } : {}),
    },
  });
}

const metodoErrado = (res, use) => mandarJson(res, 405, { ok: false, error: { code: 'EMETHOD', message: `use ${use}` } });

/**
 * O que vai ao `aoAvisar` de uma falha. Só o que cai em 500 leva `stack`: nos erros
 * classificados a pilha é sempre a mesma, e nos 500 é a única coisa que diz onde o backend
 * tropeçou. `esperado` marca `ENOENT`: "não existe" é resposta de rotina para quem sonda antes
 * de criar, e sem a marca a linha parece defeito.
 */
function detalheDaFalha(err, extra) {
  const classificado = Boolean(STATUS[err && err.code]);
  return {
    ...extra,
    code: err.code || 'EINTERNAL',
    message: err.message,
    ...(err && err.code === ENOENT ? { esperado: true } : {}),
    ...(classificado ? {} : { stack: err.stack }),
  };
}

function lerCorpo(req, teto) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let total = 0;
    req.on('data', (pedaco) => {
      total += pedaco.length;
      if (total > teto) {
        reject(new ErroDeDados(EINVAL, `corpo maior que o teto (${teto})`));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on('end', () => resolve(Buffer.concat(pedacos)));
    req.on('error', reject);
  });
}

/**
 * Devolve `async (req, res, url?) => boolean` para o contrato de wire sobre `dados`.
 *
 * `prefixo` é a rota do RPC (e de `<prefixo>/write-binary`); `arquivos` é o prefixo dos
 * binários, `<prefixo>/arquivos/` por padrão, e um app portado do toolkit mantém o frontend dele
 * passando `{ prefixo: '/api/fs', arquivos: '/assets/' }`. `aoAvisar(evento, detalhe)` recebe
 * `op-falhou` e `escrita-binaria-falhou`.
 *
 * @param {ReturnType<typeof abrir>} dados
 * @param {{prefixo?: string, arquivos?: string, maxCorpo?: number,
 *   aoAvisar?: (evento: string, detalhe: object) => void}} [opcoes]
 */
function rotas(dados, opcoes = {}) {
  const prefixo = opcoes.prefixo || '/api/dados';
  const arquivos = opcoes.arquivos || `${prefixo.replace(/\/+$/, '')}/arquivos/`;
  const maxCorpo = opcoes.maxCorpo === undefined ? MAX_CORPO : opcoes.maxCorpo;
  const avisar = opcoes.aoAvisar || (() => {});

  const OPS = {
    'exists': (p) => dados.existe(p.path),
    'stat': (p) => dados.info(p.path),
    'read-file': (p) => dados.ler(p.path),
    'write-file': (p) => dados.escrever(p.path, p.content ?? ''),
    'mkdir': (p) => dados.criarPasta(p.path ?? p.dir),
    'mkdir-recur': (p) => dados.criarPasta(p.path ?? p.dir, { recursiva: true }),
    'readdir': (p) => dados.listar(p.path ?? p.dir, { aplicarIgnorados: !!p.applyIgnore }),
    'unlink': (p) => dados.remover(p.path, { lixeira: p.recycle !== false }),
    'rename': (p) => dados.renomear(p.from ?? p.old, p.to ?? p.new),
    'copy': (p) => dados.copiar(p.from ?? p.old, p.to ?? p.new),
    'open-dir': (p) => dados.abrirPasta(p.path ?? p.dir),
    'get-files': (p) => dados.abrirPasta(p.path ?? p.dir),
  };

  async function rpc(req, res) {
    if (req.method !== 'POST') return metodoErrado(res, 'POST');
    let carga;
    try {
      carga = JSON.parse((await lerCorpo(req, maxCorpo)).toString('utf8') || '{}');
    } catch (err) {
      mandarErro(res, err.code ? err : new ErroDeDados(EINVAL, `corpo não é JSON: ${err.message}`));
      return;
    }
    const nome = carga && typeof carga === 'object' ? carga.op : undefined;
    const op = OPS[nome];
    if (!op) return mandarJson(res, 400, { ok: false, error: { code: EINVAL, message: `op desconhecida: ${nome}` } });
    try {
      mandarJson(res, 200, { ok: true, result: await op(carga) });
    } catch (err) {
      avisar('op-falhou', detalheDaFalha(err, { op: nome, path: carga.path }));
      mandarErro(res, err, nome);
    }
  }

  async function escreverBinario(req, res, url) {
    if (req.method !== 'POST' && req.method !== 'PUT') return metodoErrado(res, 'POST');
    const alvo = url.searchParams.get('path');
    try {
      const corpo = await lerCorpo(req, maxCorpo);
      mandarJson(res, 200, { ok: true, result: await dados.escrever(alvo, corpo) });
    } catch (err) {
      avisar('escrita-binaria-falhou', detalheDaFalha(err, { path: alvo }));
      mandarErro(res, err, 'write-binary');
    }
  }

  async function arquivo(req, res, relativo) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return metodoErrado(res, 'GET');
    // `%` malformado faz `decodeURIComponent` lançar um `URIError` sem `code`, que cairia no 500
    // genérico; é URL inválida do cliente, então 400.
    let decodificado;
    try {
      decodificado = decodeURIComponent(relativo);
    } catch {
      return mandarErro(res, new ErroDeDados(EINVAL, `caminho de arquivo inválido: ${relativo}`));
    }
    let alvo;
    try {
      alvo = await dados.abrirLeitura(decodificado);
    } catch (err) {
      return mandarErro(res, err);
    }

    const ultima = new Date(alvo.mtime).toUTCString();
    const cabecalhos = {
      'Content-Type': tipoDeConteudo(alvo.path),
      'Last-Modified': ultima,
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
    };
    if (req.headers['if-modified-since'] === ultima && !req.headers.range) {
      res.writeHead(304, { 'Last-Modified': ultima, 'Cache-Control': 'no-cache' });
      return res.end();
    }

    // Um intervalo só: é o que um leitor de PDF ou um `<video>` usa para não baixar o arquivo
    // inteiro. Multipart não vale o custo, e nenhum cliente do ambiente o pede.
    const faixa = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (faixa && alvo.size > 0) {
      const [, cruInicio, cruFim] = faixa;
      let inicio = cruInicio === '' ? alvo.size - Number(cruFim) : Number(cruInicio);
      let fim = cruInicio === '' || cruFim === '' ? alvo.size - 1 : Number(cruFim);
      inicio = Math.max(0, inicio);
      fim = Math.min(alvo.size - 1, fim);
      if (Number.isNaN(inicio) || Number.isNaN(fim) || inicio > fim) {
        res.writeHead(416, { 'Content-Range': `bytes */${alvo.size}`, 'Content-Length': 0 });
        return res.end();
      }
      cabecalhos['Content-Range'] = `bytes ${inicio}-${fim}/${alvo.size}`;
      cabecalhos['Content-Length'] = fim - inicio + 1;
      res.writeHead(206, cabecalhos);
      if (req.method === 'HEAD') return res.end();
      return void alvo.stream({ start: inicio, end: fim }).pipe(res);
    }

    cabecalhos['Content-Length'] = alvo.size;
    res.writeHead(200, cabecalhos);
    if (req.method === 'HEAD') return res.end();
    alvo.stream().pipe(res);
  }

  return async function servir(req, res, url) {
    url = url || new URL(req.url || '/', 'http://app');
    const caminho = url.pathname;
    if (caminho === prefixo) await rpc(req, res);
    else if (caminho === `${prefixo}/write-binary`) await escreverBinario(req, res, url);
    else if (caminho.startsWith(arquivos)) await arquivo(req, res, caminho.slice(arquivos.length));
    else return false;
    return true;
  };
}

module.exports = {
  abrir, rotas, ErroDeDados, tipoDeConteudo,
  ENOENT, EACCES, EINVAL, EEXIST,
  EXTENSOES, IGNORADOS, LIXEIRA, MAX_BYTES, MAX_CORPO,
};
