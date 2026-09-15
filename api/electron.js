// A superfície padrão do Electron sobre o shell VSSH, para um app portado: `dialog`, `shell`, o
// clipboard de texto, `Notification` e os controles de janela. Servido em `_sdk/electron.js`, e
// incluído depois de `_sdk/vssh.js`.
//
// O caro de portar um app Electron nunca foi o transporte do IPC; são os handlers do outro lado,
// escritos sob medida por aquele app. Uma camada de `ipcRenderer` genérica entregaria o cano e
// nenhum dos handlers, então este arquivo cobre o que é padrão e recusa, com mensagem que nomeia
// o canal, o que é do app. Essa parte vira o backend do vssh-app.
//
// Fora de escopo, cada um por um motivo: `setSize` e `setPosition`, porque a janela é do usuário
// depois de aberta; `clipboard.readImage` e `writeImage`, que têm equivalente em
// `vssh.arquivos.imagemCopiada` e `copiarImagem`, com outra assinatura.
(function () {
  'use strict';

  if (!window.vssh) {
    console.warn('[vssh] electron.js precisa do runtime (_sdk/vssh.js) antes.');
    return;
  }
  const vssh = window.vssh;

  function bespoke(what, hint) {
    return () => {
      throw new Error(`[vssh] ${what} não tem equivalente genérico no VSSH. `
        + (hint || 'Essa lógica é específica do seu app: mova-a para o backend do vssh-app.'));
    };
  }

  // O Electron devolve `{ canceled, filePaths }`, e a forma é mantida para o app não precisar de if.
  const dialog = {
    async showOpenDialog(opts = {}) {
      const o = opts.properties ? opts : (arguments[1] || opts);
      const querPasta = Array.isArray(o.properties) && o.properties.includes('openDirectory');
      const p = querPasta
        ? await vssh.arquivos.escolherPasta(o.title, o.defaultPath)
        : await vssh.arquivos.escolherArquivo(o.title, undefined, o.defaultPath);
      return { canceled: !p, filePaths: p ? [p] : [] };
    },
    async showSaveDialog(opts = {}) {
      const p = await vssh.arquivos.escolherDestino(opts.title, undefined, undefined, opts.defaultPath);
      return { canceled: !p, filePath: p || undefined };
    },
    // `response` é o índice do botão clicado, e a ordem dos botões é do app. Presumir que o
    // afirmativo é o índice 0 acerta em `['Sim', 'Não']` e erra em `['Cancelar', 'OK']`, onde o
    // app descartaria o trabalho do usuário achando que foi ele quem pediu. `defaultId` e
    // `cancelId` são como o Electron declara qual índice significa o quê; sem eles vale 0/1.
    async showMessageBox(opts = {}) {
      const o = opts.message ? opts : (arguments[1] || opts);
      const temCancelar = Array.isArray(o.buttons) && o.buttons.length > 1;
      if (!temCancelar) {
        await vssh.dialogos.mostrar(o.message || '', o.title);
        return { response: 0, checkboxChecked: false };
      }
      const sim = await vssh.dialogos.confirmar(o.message || '', o.title);
      const iSim = Number.isInteger(o.defaultId) ? o.defaultId : 0;
      const iNao = Number.isInteger(o.cancelId) ? o.cancelId : 1;
      return { response: sim ? iSim : iNao, checkboxChecked: false };
    },
    showErrorBox(title, content) { vssh.dialogos.erro(content || '', title); },
  };

  const shell = {
    // `openExternal` abre fora do app, e aqui "fora do app" é o navegador do ambiente, que resolve
    // a rede a partir do servidor Linux. A promessa rejeita quando o ambiente recusa, como no
    // Electron.
    openExternal(url) { return vssh.arquivos.abrirLink(url).then(() => undefined); },
    openPath(p) { vssh.arquivos.abrir(p); return Promise.resolve(''); },
    showItemInFolder(p) {
      // Sem "revelar o item": abre a pasta que o contém, que é o que a pessoa quer ver.
      const dir = String(p).replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
      vssh.arquivos.abrirPasta(dir);
    },
    beep() {},
    trashItem: bespoke('shell.trashItem'),
  };

  // Síncrono no Electron, assíncrono no navegador: `readText()` devolve uma promessa aqui, e é
  // a única diferença de assinatura que este arquivo não esconde.
  const clipboard = {
    readText: () => navigator.clipboard.readText(),
    writeText: (t) => navigator.clipboard.writeText(String(t)),
    readImage: bespoke('clipboard.readImage', 'Use vssh.arquivos.imagemCopiada().'),
    writeImage: bespoke('clipboard.writeImage', 'Use vssh.arquivos.copiarImagem(blob).'),
  };

  // Existe para dar um erro útil: o app que chega aqui está pedindo um handler que só existia no
  // processo main dele, e a mensagem nomeia o canal.
  const ipcRenderer = {
    invoke(channel) {
      return Promise.reject(new Error(`[vssh] ipcRenderer.invoke('${channel}') não tem destino: esse handler `
        + 'vivia no processo main do Electron. Implemente-o no backend do seu vssh-app e troque a '
        + "chamada por fetch('api/...')."));
    },
    send(channel) {
      console.warn(`[vssh] ipcRenderer.send('${channel}') ignorado (sem processo main).`);
    },
    on() {}, once() {}, removeListener() {}, removeAllListeners() {},
    sendSync: bespoke('ipcRenderer.sendSync'),
  };

  // Um app Electron notifica pela API do navegador, no renderer. Dentro do ambiente a notificação
  // do sistema apareceria numa área do navegador que não existe em tela cheia, então ela vai para
  // o centro de notificações do shell. Fora do ambiente a nativa fica como está. O clique não
  // volta ao app, porque o shell não devolve um handle da notificação; o aviso no console é
  // melhor que um listener que nunca dispara.
  if (vssh.noAmbiente) {
    class VsshNotification extends EventTarget {
      constructor(title, options = {}) {
        super();
        this.title = String(title ?? '');
        this.body = options.body ?? '';
        vssh.avisos.notificar(this.body || this.title, this.body ? this.title : undefined, options.vsshLevel || 'info');
      }
      close() {}
      addEventListener(type, ...rest) {
        if (type === 'click') {
          console.warn('[vssh] clique em Notification não volta ao app: o shell não devolve handle. '
            + 'Use um botão na própria janela para a ação.');
        }
        return super.addEventListener(type, ...rest);
      }
      set onclick(_fn) {
        console.warn('[vssh] Notification.onclick não dispara; ver addEventListener.');
      }
      get onclick() { return null; }
      static requestPermission() { return Promise.resolve('granted'); }
      static get permission() { return 'granted'; }
    }
    window.Notification = VsshNotification;
  }

  const app = {
    getName: () => document.title || 'vssh-app',
    // O `version` do manifesto não chega ao frontend. O app declara em
    // `<meta name="vssh-app-version" content="1.2.3">` ou em `window.__VSSH_APP_VERSION__`; sem
    // nenhum dos dois, `0.0.0` é a resposta de quem não declarou.
    getVersion: () => window.__VSSH_APP_VERSION__
      || (document.querySelector('meta[name="vssh-app-version"]') || {}).content
      || '0.0.0',
    getPath: bespoke('app.getPath()',
      'Peça a pasta ao usuário (showDirectoryPicker) ou use $VSSH_APP_DATA_DIR pelo seu backend.'),
    quit() { vssh.janela.fechar(); },
    exit() { vssh.janela.fechar(); },
  };

  // A janela é do shell, e o app pede pela ponte. `isMaximized` responde falso porque o shell
  // não expõe geometria de volta ao app.
  const currentWindow = {
    setTitle(t) { document.title = String(t); },   // o runtime espelha o título sozinho
    getTitle() { return document.title; },
    close() { vssh.janela.fechar(); },
    minimize() { vssh.janela.minimizar(); },
    maximize() { vssh.janela.maximizar(); },
    unmaximize() { vssh.janela.restaurar(); },
    focus() { vssh.janela.focar(); },
    show() { vssh.janela.focar(); },
    hide() { vssh.janela.minimizar(); },
    isMaximized: () => false,
    on() {}, once() {}, removeListener() {},
  };

  const electron = {
    dialog, shell, clipboard, ipcRenderer, app,
    remote: { app, dialog, getCurrentWindow: () => currentWindow },
    BrowserWindow: { getCurrentWindow: () => currentWindow, getFocusedWindow: () => currentWindow },
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({ popup() {} }) },
    nativeTheme: {
      get shouldUseDarkColors() {
        return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
      },
    },
  };

  window.electron = Object.assign(window.electron || {}, electron);
  // `require('electron')` devolve `window.electron`, o mesmo objeto: um app que substitui
  // `window.electron.dialog` num teste precisa ver a troca pelos dois caminhos.
  window.require = window.require || ((mod) => {
    if (mod === 'electron') return window.electron;
    throw new Error(`[vssh] require('${mod}') não disponível no navegador.`);
  });
})();
