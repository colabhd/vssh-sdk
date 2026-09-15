// `@tauri-apps/api` sobre o shell VSSH, para um app portado. Servido em `_sdk/tauri.js`, e
// incluído depois de `_sdk/vssh.js`.
//
// A superfície do Tauri é fixa, estreita e documentada (fs, dialog, shell, notification, path,
// event), então um arquivo genérico cobre a maior parte dos apps. O limite é o `invoke()` de um
// comando Rust do próprio app, que não tem tradução: essa lógica vira backend do vssh-app.
//
// Um app que faz `import { readTextFile } from '@tauri-apps/api/fs'` precisa de um alias no
// build (o `resolve.alias` do Vite) apontando para os globais `window.__TAURI__.*`.
(function () {
  'use strict';

  if (!window.vssh) {
    console.warn('[vssh] tauri.js precisa do runtime (_sdk/vssh.js) antes.');
    return;
  }
  const vssh = window.vssh;

  const notImplemented = (what) => () => {
    throw new Error(`[vssh] ${what} não tem equivalente no VSSH. `
      + 'Se o app depende disso, essa lógica precisa virar backend próprio do vssh-app.');
  };

  // Restrito ao que o usuário escolheu num seletor. Um app Tauri costuma abrir uma pasta antes
  // de ler qualquer coisa, e isso se encaixa.
  const fs = {
    readTextFile: (p) => vssh.arquivos.ler(p),
    readBinaryFile: (p) => vssh.arquivos.lerBytes(p),
    writeTextFile: (p, contents) => (typeof p === 'object'
      ? vssh.arquivos.escrever(p.path, p.contents)
      : vssh.arquivos.escrever(p, contents)),
    writeFile: (p, contents) => (typeof p === 'object'
      ? vssh.arquivos.escrever(p.path, p.contents)
      : vssh.arquivos.escrever(p, contents)),
    async readDir(p) {
      const { items = [] } = await vssh.arquivos.listar(p);
      return items.map((it) => ({
        path: `${String(p).replace(/\/+$/, '')}/${it.name}`,
        name: it.name,
        children: (it.type === 'directory' || it.isDirectory) ? [] : undefined,
      }));
    },
    createDir: (p) => vssh.arquivos.criarPasta(p),
    removeFile: (p) => vssh.arquivos.apagar(p),
    removeDir: (p) => vssh.arquivos.apagar(p),
    // `existe` só responde `false` no 404 do servidor; permissão negada e servidor fora lançam,
    // porque um app que lesse os três como "não existe" criaria por cima do que estava lá.
    exists: (p) => vssh.arquivos.existe(p).then((r) => !!(r && r.exists)),
    rename: (from, to) => vssh.arquivos.renomear(from, to),
    copyFile: (from, to) => vssh.arquivos.copiar(from, to),
  };

  const tituloDe = (opts) => (typeof opts === 'string' ? opts : (opts || {}).title);
  const dialog = {
    async open(opts = {}) {
      return opts.directory
        ? vssh.arquivos.escolherPasta(opts.title)
        : vssh.arquivos.escolherArquivo(opts.title);
    },
    save: (opts = {}) => vssh.arquivos.escolherDestino(opts.title, undefined, undefined, opts.defaultPath),
    message: (msg, opts = {}) => vssh.dialogos.mostrar(msg, tituloDe(opts)),
    ask: (msg, opts = {}) => vssh.dialogos.confirmar(msg, tituloDe(opts)),
    confirm: (msg, opts = {}) => vssh.dialogos.confirmar(msg, tituloDe(opts)),
  };

  const shell = {
    // Um caminho do servidor abre no visualizador do desktop; uma URL abre no navegador do
    // ambiente, que resolve a rede a partir do servidor Linux.
    open(target) {
      if (/^https?:\/\//i.test(target)) return vssh.arquivos.abrirLink(target).then(() => undefined);
      vssh.arquivos.abrir(target);
      return Promise.resolve();
    },
    Command: notImplemented('shell.Command (executar processo arbitrário)'),
  };

  const notification = {
    isPermissionGranted: async () => true,
    requestPermission: async () => 'granted',
    sendNotification(arg) {
      const o = typeof arg === 'string' ? { body: arg } : (arg || {});
      // `sendNotification({ title })` sem corpo é uso legítimo, e uma mensagem vazia produziria
      // um aviso em branco: quando só há título, ele vira a mensagem.
      vssh.avisos.notificar(o.body || o.title || '', o.body ? o.title : undefined);
    },
  };

  // Só string: nada disto precisa do servidor.
  const sep = '/';
  const path = {
    sep,
    delimiter: ':',
    join: async (...parts) => parts.filter(Boolean).join(sep).replace(/\/{2,}/g, sep),
    dirname: async (p) => String(p).replace(/\/+$/, '').split(sep).slice(0, -1).join(sep) || sep,
    basename: async (p, ext) => {
      const b = String(p).replace(/\/+$/, '').split(sep).pop() || '';
      return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
    },
    extname: async (p) => {
      const b = String(p).split(sep).pop() || '';
      const i = b.lastIndexOf('.');
      return i > 0 ? b.slice(i + 1) : '';
    },
    isAbsolute: async (p) => String(p).startsWith(sep),
    // Os diretórios conhecidos dependem do usuário no servidor. Um app que precise deles pede a
    // pasta ao usuário, que é o modelo do resto deste arquivo.
    appDir: notImplemented('path.appDir'),
    appDataDir: notImplemented('path.appDataDir'),
    homeDir: notImplemented('path.homeDir'),
  };

  const api = {
    fs, dialog, shell, notification, path,
    invoke: notImplemented('invoke() de comando Rust customizado'),
    event: {
      // Eventos entre janelas nativas não existem aqui: há uma janela só.
      listen: async () => () => {},
      emit: async () => {},
    },
  };

  window.__TAURI__ = Object.assign(window.__TAURI__ || {}, api);
  window.__TAURI_INVOKE__ = api.invoke;
})();
