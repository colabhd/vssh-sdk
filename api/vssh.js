// O runtime web de um vssh-app: o lado do app na ponte com o shell, servido pelo sistema.
//
// Um app o inclui por um caminho relativo à própria raiz, antes dos scripts dele:
//
//     <script src="_sdk/vssh.js"></script>
//
// O portal responde esse caminho em `/<serverId>/proxy/app/<id>/_sdk/vssh.js`, e o relay do
// cliente de desktop o responde na origem do app. Nenhum app carrega uma cópia, e é isso que
// mantém o SDK na versão do shell que o serve: `vssh.app.capacidades().shellVersion` é a versão
// dos dois lados.
//
// O arquivo servido é a junção de três partes, montada no boot do portal (`src/utils/sdk-web.ts`):
// este runtime, escrito à mão; a superfície gerada de `js/app/abi.js`, que entra no lugar do
// comentário-marcador `@superficie` abaixo, com um `vssh.<espaco>.<verbo>()` por entrada da
// tabela e um `vssh.<espaco>.ao('<evento>', cb)` por espaço; e o polyfill de File System Access
// (`fsa.js`).
//
// Este runtime é o que a tabela não descreve: a origem do shell, o transporte das mensagens, o
// comportamento fora do ambiente, o espelho das permissões de arquivo, o volume, a aparência, os
// auxiliares de arraste e a rede que segura o que iria virar aba do navegador. Um auxiliar daqui
// que envolve verbos tem um nome que não é o de verbo nenhum do mesmo espaço, porque a tabela é a
// fonte dos nomes públicos.
//
// Fora do ambiente (`window.parent === window`, o app aberto numa aba solta durante o
// desenvolvimento) nada lança na carga: cada verbo degrada para o equivalente do navegador, para
// um valor vazio ou para uma recusa, conforme a tabela `FORA` abaixo.
(function () {
  'use strict';

  const noAmbiente = window.parent !== window;

  // ── A origem do shell ─────────────────────────────────────────────────────────────────────
  //
  // O shell e o app conferem a origem um do outro em toda mensagem. No portal os dois são servidos
  // na mesma origem; no cliente de desktop cada app tem uma porta própria, e porta é origem. Um
  // `postMessage` com o alvo errado é descartado pelo navegador sem erro, então a origem tem de
  // ser a do pai imediato, que `location.ancestorOrigins` dá sem chance de forja. O `referrer`
  // cobre quem não tem `ancestorOrigins` (reduzido à origem pela política padrão), e
  // `location.origin` é a resposta certa na web, onde os três caminhos coincidem.
  //
  // Aceitar qualquer origem com o `e.source` certo seria um erro: um app pode navegar para fora
  // sozinho, e aí `window.parent` continua sendo o mesmo objeto. A origem é o que separa o shell
  // do que aquela página virou.
  const ORIGEM_DO_SHELL = (() => {
    try {
      const a = location.ancestorOrigins;
      if (a && a.length) return a[0];
      if (document.referrer) return new URL(document.referrer).origin;
    } catch { /* referrer ilegível: vale a origem própria */ }
    return location.origin;
  })();

  const doShell = (e) => e.origin === ORIGEM_DO_SHELL && e.source === window.parent
    && e.data && e.data.vsshApp === true;

  // ── O transporte ──────────────────────────────────────────────────────────────────────────
  //
  // Toda chamada com resposta tem prazo, e o prazo vem do ritmo declarado na tabela: cinco
  // segundos para o que não depende de uma pessoa, dez minutos para um diálogo ou um seletor. Um
  // shell que não conhece o verbo responde `ok: false` na hora; o prazo é para o shell mudo, que
  // sem ele deixaria a promessa pendurada para sempre, sem rastro no console.
  const pendentes = new Map();
  let seq = 0;
  const ouvintes = new Map();

  window.addEventListener('message', (e) => {
    if (!doShell(e)) return;
    const m = e.data;
    if (m.type === 'result') {
      const p = pendentes.get(m.requestId);
      if (!p) return;
      pendentes.delete(m.requestId);
      clearTimeout(p.timer);
      if (m.ok) {
        const traduzir = RESPOSTAS[p.nome];
        p.resolve(traduzir ? traduzir(m.value) : m.value);
      } else {
        p.reject(new Error(m.value || `${p.nome} falhou`));
      }
      return;
    }
    if (m.type === 'grants') adotar(m.paths);
    if (m.type === 'volume') { ganho = limitar(m.gain); mudo = !!m.muted; aplicarVolume(); }
    const cbs = ouvintes.get(m.type);
    if (!cbs) return;
    for (const cb of [...cbs]) {
      try { cb(m); } catch (err) { console.warn(`[vssh] ouvinte de ${m.type}:`, err); }
    }
  });

  function chamar(nome, mensagem, prazo) {
    if (!noAmbiente) return foraDoAmbiente(nome, mensagem);
    const requestId = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendentes.delete(requestId);
        reject(new Error(`sem resposta do shell para ${nome}`));
      }, prazo);
      pendentes.set(requestId, { nome, resolve, reject, timer });
      const m = PEDIDOS[nome] ? PEDIDOS[nome](mensagem) : mensagem;
      window.parent.postMessage({ vsshApp: true, requestId, ...m }, ORIGEM_DO_SHELL);
    });
  }

  function disparar(nome, mensagem) {
    if (!noAmbiente) return false;
    window.parent.postMessage({ vsshApp: true, ...mensagem }, ORIGEM_DO_SHELL);
    return true;
  }

  /**
   * Assina um evento do shell pelo nome público e devolve a função que cancela. O que chega ao
   * `cb` já tem os nomes públicos dos campos; o nome do fio fica do lado de cá. Um evento que a
   * tabela não declara lança, porque um `ao('aberura', …)` que ficasse mudo custaria uma tarde.
   */
  function escutar(espaco, evento, cb) {
    const decl = EVENTOS[espaco] && EVENTOS[espaco][evento];
    if (!decl) throw new Error(`evento desconhecido: ${espaco}.${evento}`);
    const [fio, campos] = decl;
    const ouvinte = (m) => {
      const publico = {};
      for (const [nome, noFio] of Object.entries(campos)) publico[nome] = m[noFio];
      cb(publico);
    };
    let cbs = ouvintes.get(fio);
    if (!cbs) { cbs = new Set(); ouvintes.set(fio, cbs); }
    cbs.add(ouvinte);
    return () => { cbs.delete(ouvinte); };
  }

  // ── Fora do ambiente ──────────────────────────────────────────────────────────────────────
  //
  // O que cada verbo com resposta faz numa aba solta, por nome público. Quem não está aqui é
  // recusado com uma promessa rejeitada, e um verbo sem resposta vira um `false` sem efeito. Os
  // seletores respondem `null` em vez de abrir um `<input type=file>`: um File do navegador não
  // tem caminho no servidor, e um valor com cara de caminho que não resolve do outro lado é pior
  // que nada.
  const registrar = (m) => { console.info(`[vssh] ${m.title ? `${m.title}: ` : ''}${m.message}`); return null; };
  const FORA = {
    'app.capacidades': () => ({ host: 'none', shellVersion: null, verbos: [], eventos: [] }),
    'avisos.notificar': registrar,
    'avisos.avisar': registrar,
    'avisos.atividade': (m) => { console.info(`[vssh:atividade] ${m.chave}`, m.item); return null; },
    'avisos.encerrarAtividade': (m) => { console.info(`[vssh:atividade] ${m.chave} encerrada`); return null; },
    'avisos.bandeja': () => false,
    'avisos.tirarDaBandeja': () => false,
    'dialogos.mostrar': (m) => { window.alert(m.message); },
    'dialogos.erro': (m) => { window.alert(m.message); },
    'dialogos.confirmar': (m) => window.confirm(m.message),
    'dialogos.perguntar': (m) => window.prompt(m.message, m.value ?? ''),
    'dialogos.senha': (m) => window.prompt(m.message),
    'dialogos.menuDeContexto': () => null,
    'arquivos.escolherArquivo': () => null,
    'arquivos.escolherDestino': () => null,
    'arquivos.escolherPasta': () => null,
    'arquivos.permissoes': (m) => (m.path ? null : []),
    'arquivos.areaDeTransferencia': () => null,
    'arquivos.copiarParaAreaDeTransferencia': () => false,
    'arquivos.abrirLink': (m) => { window.open(m.url, '_blank', 'noopener'); return null; },
    'janela.abrir': (m) => !!window.open(m.rota || '', '_blank', 'noopener'),
    'segredos.listar': () => null,
    'segredos.pedir': () => null,
    'segredos.apagar': () => null,
    'impressao.imprimir': () => false,
  };

  function foraDoAmbiente(nome, mensagem) {
    const f = FORA[nome];
    if (!f) return Promise.reject(new Error(`fora do ambiente VSSH: ${nome}`));
    return new Promise((resolve) => resolve(f(mensagem)));
  }

  // O que muda de forma entre o fio e o app, nos dois sentidos. Bytes viajam em base64 porque um
  // `ArrayBuffer` não atravessa o `postMessage` entre os dois documentos sem cópia; o app entrega
  // e recebe `Uint8Array`. A codificação vai em blocos porque `String.fromCharCode(...u8)` estoura
  // a pilha num arquivo grande. Uma string em `escreverBytes` já é base64 e passa como veio.
  const bytesDe = (base64) => {
    const bin = atob(String(base64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const paraBase64 = (bytes) => {
    if (typeof bytes === 'string') return bytes;
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const PEDIDOS = {
    'arquivos.escreverBytes': (m) => ({ ...m, base64: paraBase64(m.base64) }),
  };
  const RESPOSTAS = {
    'arquivos.lerBytes': (r) => bytesDe(r && r.base64),
  };

  /** O que a superfície gerada usa: o transporte, por nome de verbo, e a tabela de eventos. */
  const ponte = { chamar, disparar, escutar };
  const EVENTOS = {};
  const vssh = { noAmbiente };

  // ── A superfície gerada de js/app/abi.js ────────────────────────────────────────────────
  //
  // Um verbo por entrada da tabela, com o nome público na chamada e o nome do fio na mensagem.
  // Quem responde vira `chamar`, uma promessa com prazo pelo ritmo; quem não responde vira
  // `disparar`. Este trecho é reescrito no boot do portal: quem quer mudar um verbo edita a
  // tabela. `ponte` e `EVENTOS` são do runtime, declarados logo acima.

  EVENTOS.app = {
    // O contexto com que o app foi aberto ("abrir aqui", "abrir com", um item da jump list). Chega depois do load, e de novo quando uma ação alcança uma janela que já está aberta.
    abertura: ['open-context', { caminho: 'path', url: 'url', tipo: 'tipo', rota: 'rota' }],
  };
  EVENTOS.janela = {
    // As abas que a sessão anterior deixou salvas, mandadas uma vez, no load do iframe de um app com `richChrome`. Chega mesmo sem nada salvo (`abas: null`), para o app nunca decidir sozinho se cria uma aba inicial.
    restaurarAbas: ['restore-tabs', { abas: 'tabs', sessaoAtiva: 'activeSessionName' }],
    // A pessoa clicou numa aba da barra de título.
    ativarAba: ['activate-tab', { abaId: 'tabId' }],
    // A pessoa clicou no fechar de uma aba, ou em "Fechar aba" no menu do cabeçalho.
    fecharAba: ['close-tab', { abaId: 'tabId' }],
    // A pessoa clicou no `+` da barra de abas, ou em "Nova aba" no menu do cabeçalho.
    novaAba: ['new-tab', {}],
  };
  EVENTOS.arquivos = {
    // A lista completa do que este app pode tocar. Chega no load da janela e a cada mudança (uma escolha num seletor, uma revogação no menu da janela), e substitui a anterior: o shell é a fonte, e uma revogação lá apaga aqui.
    permissoesMudaram: ['grants', { caminhos: 'paths' }],
    // Algo mudou sob um caminho vigiado. `encerrado` é o shell dizendo que a assinatura acabou de vez, porque a conexão com o servidor desistiu de reconectar; avisar é melhor que seguir calado fingindo que vigia.
    arquivoMudou: ['fs-change', { vigia: 'watchId', caminho: 'path', encerrado: 'closed' }],
    // A área de transferência de arquivos mudou, por qualquer janela: o usuário copiou no gerenciador e voltou para o app. Sem o evento, o app só descobriria perguntando em laço.
    areaDeTransferenciaMudou: ['clipboard-change', { conteudo: 'clipboard' }],
  };
  EVENTOS.avisos = {
    // A pessoa clicou numa ação de uma notificação deste app. Chega à janela do app que teve foco por último, e a ela só.
    acaoDeNotificacao: ['notify-action', { notificacaoId: 'notificationId', acaoId: 'actionId' }],
    // A pessoa clicou numa ação de uma atividade declarada por esta janela. `chave` é a que o app escolheu, sem o prefixo do ambiente.
    acaoDeAtividade: ['live-action', { chave: 'chave', acaoId: 'actionId' }],
    // A pessoa clicou no ícone da bandeja (`click`) ou escolheu um item do menu dele (`menu`, com o `menuId` do item). O shell não interpreta o id; quem sabe o que ele significa é o app.
    acaoNaBandeja: ['tray-event', { evento: 'event', menuId: 'menuId' }],
  };
  EVENTOS.dialogos = {
  };
  EVENTOS.segredos = {
  };
  EVENTOS.configuracoes = {
  };
  EVENTOS.midia = {
    // O volume que o mixer do ambiente aplica a este app, de 0 a 1, com o mudo à parte. Chega no load da janela e a cada mexida no mixer. O SDK já o aplica à mídia e ao GainNode do app; um app só lê isto para desenhar o próprio controle.
    volume: ['volume', { ganho: 'gain', mudo: 'muted' }],
    // A central de mídia pedindo a faixa anterior ou a próxima ao app que declarou o transporte.
    acao: ['media-acao', { acao: 'acao' }],
  };
  EVENTOS.impressao = {
  };
  EVENTOS.gpu = {
  };

  // ── app: Quem o app é e em que ambiente ele está: as capacidades do shell, os verbos disponíveis, o título que a janela mostra e a rota que a sessão restaura.
  vssh.app = {
    // O ambiente em que o app está: o nome do host, o que ele sabe fazer, a versão do shell e a lista de verbos e eventos desta tabela. Com a lista, o app decide sozinho se o shell em que caiu tem o que ele precisa.
    capacidades: () => ponte.chamar('app.capacidades', { type: 'capabilities' }, 5000),
    // O título que a janela mostra na barra de título, na barra de tarefas e no Alt+Tab. O app o reporta sempre que o dele muda; o shell corta em 200 caracteres.
    titulo: (titulo) => ponte.disparar('app.titulo', { type: 'title', title: titulo }),
    // Onde o app está, para a sessão o reabrir no mesmo lugar: um caminho dentro do app, que o ambiente cola na URL quando restaura a janela. Uma rota que sai do app (um esquema, um caminho absoluto, um `..`) é recusada no console, sem resposta.
    lembrarRota: (rota) => ponte.disparar('app.lembrarRota', { type: 'rota', rota: rota }),
    // Assina um evento deste espaço (abertura) e devolve a função que cancela.
    ao: (evento, cb) => ponte.escutar('app', evento, cb),
  };

  // ── janela: A janela do app: controlada em runtime pelo app que a ocupa, e declarada no manifesto para quem a abre.
  vssh.janela = {
    // Outra janela deste app, e a rota decide o que vai dentro dela: sem rota, uma cópia da mesma página; com rota (`?painel=notas`), um painel ou um segundo documento. O backend continua sendo um só, e a janela nova leva o título e o ícone do app. O shell recusa uma rota que sai do app (um esquema, um caminho absoluto, um `..`) e responde `false`.
    abrir: (rota, titulo, largura, altura) => ponte.chamar('janela.abrir', { type: 'window', op: 'open', rota: rota, title: titulo, width: largura, height: altura }, 5000),
    // Recolhe a janela para a barra de tarefas. Uma janela já minimizada fica como está.
    minimizar: () => ponte.disparar('janela.minimizar', { type: 'window', op: 'minimize' }),
    // Ocupa a área de trabalho inteira. Uma janela já maximizada fica como está.
    maximizar: () => ponte.disparar('janela.maximizar', { type: 'window', op: 'maximize' }),
    // Devolve a janela ao tamanho normal: tira da barra de tarefas a que está minimizada, e desmaximiza a que está maximizada.
    restaurar: () => ponte.disparar('janela.restaurar', { type: 'window', op: 'restore' }),
    // Traz a janela para a frente das outras e lhe dá o foco.
    focar: () => ponte.disparar('janela.focar', { type: 'window', op: 'focus' }),
    // Fecha a janela pelo mesmo caminho do botão de fechar. Quando ela é a última do app, o backend segue o que `backend.aoFechar` declara no manifesto.
    fechar: () => ponte.disparar('janela.fechar', { type: 'window', op: 'close' }),
    // Começa a arrastar a janela a partir de um ponto do documento do app, para quem declarou `cabecalho: "app"` e desenha a própria barra de título. `x` e `y` dizem onde no quadro do app a pessoa o agarrou (`clientX`, `clientY`); `telaX` e `telaY` fixam a referência de tela para o resto do gesto (`screenX`, `screenY`). O app captura o ponteiro e conta o gesto inteiro: este começo, cada ponto por `arrastarPara`, e o fim por `terminarArraste`. Uma janela maximizada ignora o pedido, como ignora o cabeçalho padrão.
    arrastar: (x, y, telaX, telaY) => ponte.disparar('janela.arrastar', { type: 'window', op: 'drag-start', x: x, y: y, telaX: telaX, telaY: telaY }),
    // Um ponto do arraste em curso, em coordenada de tela (`screenX`, `screenY`). A coordenada é de tela porque o quadro do app se move junto com a janela, e um ponto relativo a ele dependeria do que o gesto acabou de mudar. Sem arraste começado, o shell ignora.
    arrastarPara: (telaX, telaY) => ponte.disparar('janela.arrastarPara', { type: 'window', op: 'drag-move', telaX: telaX, telaY: telaY }),
    // O fim do arraste, no `pointerup` ou `pointercancel` do app. Sem ele a janela continua seguindo o ponteiro depois que a pessoa solta o botão.
    terminarArraste: () => ponte.disparar('janela.terminarArraste', { type: 'window', op: 'drag-end' }),
    // O duplo-clique da barra de título de quem tem `cabecalho: "app"`: maximiza a janela normal e restaura a maximizada.
    alternarMaximizado: () => ponte.disparar('janela.alternarMaximizado', { type: 'window', op: 'toggle-maximize' }),
    // O menu de contexto do cabeçalho (mover, maximizar, fechar, o log do backend), aberto no ponto `x`, `y` do quadro do app. O shell traduz o ponto para a tela dele.
    menuDoCabecalho: (x, y) => ponte.disparar('janela.menuDoCabecalho', { type: 'window', op: 'head-menu', x: x, y: y }),
    // A lista de abas de um app com `richChrome`, que o shell desenha na barra de título. O app a manda inteira a cada mudança; o shell responde aos cliques pelos eventos `ativarAba`, `fecharAba` e `novaAba`. Só texto atravessa: o shell monta cada aba com o `title` que recebeu. Uma aba com `sessionName` volta na sessão seguinte pelo evento `restaurarAbas`. Sem `richChrome` no manifesto, o shell ignora a lista.
    abas: (abas, abaAtiva) => ponte.disparar('janela.abas', { type: 'tabs', tabs: abas, activeTabId: abaAtiva }),
    // Assina um evento deste espaço (restaurarAbas, ativarAba, fecharAba, novaAba) e devolve a função que cancela.
    ao: (evento, cb) => ponte.escutar('janela', evento, cb),
  };

  // ── arquivos: Ler e escrever com o consentimento do usuário, escolher, vigiar, abrir, abrir com, arrastar, e a área de transferência de arquivos.
  vssh.arquivos = {
    // As entradas de uma pasta concedida: `{ path, items }`, com nome, tipo e tamanho de cada item.
    listar: (caminho) => ponte.chamar('arquivos.listar', { type: 'fs', op: 'list', path: caminho }, 5000),
    // O que um caminho é: tamanho, data de modificação, `isFile`, `isDirectory` e o tipo MIME. Um caminho que não existe responde 404, e o app que sonda antes de criar lê isso como resposta.
    consultar: (caminho) => ponte.chamar('arquivos.consultar', { type: 'fs', op: 'stat', path: caminho }, 5000),
    // O conteúdo de um arquivo, como texto.
    ler: (caminho) => ponte.chamar('arquivos.ler', { type: 'fs', op: 'read', path: caminho }, 5000),
    // O conteúdo de um arquivo, em bytes. No fio ele viaja em base64, porque um `ArrayBuffer` não atravessa o `postMessage` entre os dois documentos sem cópia; o SDK o devolve como `Uint8Array`.
    lerBytes: (caminho) => ponte.chamar('arquivos.lerBytes', { type: 'fs', op: 'readBytes', path: caminho }, 5000),
    // Grava texto num arquivo, criando ou substituindo.
    escrever: (caminho, conteudo) => ponte.chamar('arquivos.escrever', { type: 'fs', op: 'write', path: caminho, content: conteudo }, 5000),
    // Grava bytes num arquivo, criando ou substituindo. É a rota de um binário: um PNG passado por `escrever` sairia corrompido sem aviso, porque aquela rota é de texto. O SDK codifica os bytes em base64 para o fio; uma string já é base64 e passa como veio.
    escreverBytes: (caminho, bytes) => ponte.chamar('arquivos.escreverBytes', { type: 'fs', op: 'writeBytes', path: caminho, base64: bytes }, 5000),
    // Cria uma pasta.
    criarPasta: (caminho) => ponte.chamar('arquivos.criarPasta', { type: 'fs', op: 'mkdir', path: caminho }, 5000),
    // Apaga de vez um arquivo ou uma pasta com o conteúdo dela. A lixeira fica de fora; quem quer o caminho com desfazer usa o gerenciador de arquivos.
    apagar: (caminho) => ponte.chamar('arquivos.apagar', { type: 'fs', op: 'delete', path: caminho }, 5000),
    // Se um caminho existe: `{ exists }`. Só o 404 do servidor vira `false`; permissão negada e servidor fora lançam, porque "não pude perguntar" e "não existe" pedem do app ações opostas.
    existe: (caminho) => ponte.chamar('arquivos.existe', { type: 'fs', op: 'exists', path: caminho }, 5000),
    // Renomeia, e é também o mover, como o `mv`. Origem e destino precisam estar concedidos. Um destino que já existe falha; `overwrite` substitui, e precisa ser dito, porque perder um arquivo em silêncio não tem desfazer.
    renomear: (origem, destino, politica) => ponte.chamar('arquivos.renomear', { type: 'fs', op: 'rename', from: origem, to: destino, policy: politica }, 5000),
    // Copia. Origem e destino precisam estar concedidos, e um destino que já existe segue a política de `renomear`.
    copiar: (origem, destino, politica) => ponte.chamar('arquivos.copiar', { type: 'fs', op: 'copy', from: origem, to: destino, policy: politica }, 5000),
    // Assina as mudanças sob um caminho, venham de onde vierem: outro editor, um upload pelo gerenciador de arquivos. A resposta confirma a assinatura; cada mudança chega depois pelo evento `arquivoMudou`, com o `vigia` que o app escolheu. Quem segura a conexão com o servidor é o shell, e ela morre com a janela.
    vigiar: (caminho, vigia) => ponte.chamar('arquivos.vigiar', { type: 'fs', op: 'watch', path: caminho, watchId: vigia }, 5000),
    // Encerra uma assinatura de `vigiar`. Cada assinatura segura um vigia vivo no servidor do usuário, com teto por usuário, e encerrar a que deixou de servir é o que mantém as outras cabendo.
    pararDeVigiar: (vigia) => ponte.chamar('arquivos.pararDeVigiar', { type: 'fs', op: 'unwatch', watchId: vigia }, 5000),
    // Abre o seletor de arquivo do sistema e responde com o caminho escolhido, ou `null` se o usuário cancelou. O `filtro` é uma lista de grupos no estilo do Qt: `Imagens (*.png *.jpg);;Tudo (*)`. Escolher é consentir: o caminho passa a estar concedido a este app, e a concessão sobrevive à janela e à sessão.
    escolherArquivo: (titulo, filtro, pasta, nome) => ponte.chamar('arquivos.escolherArquivo', { type: 'pick', variant: 'open', title: titulo, filter: filtro, dir: pasta, name: nome }, 600000),
    // Abre o seletor de "salvar como", com `nome` sugerido, e responde com o caminho onde gravar, ou `null` se o usuário cancelou. O caminho escolhido fica concedido a este app.
    escolherDestino: (titulo, filtro, pasta, nome) => ponte.chamar('arquivos.escolherDestino', { type: 'pick', variant: 'save', title: titulo, filter: filtro, dir: pasta, name: nome }, 600000),
    // Abre o seletor de pasta e responde com o caminho escolhido, ou `null` se o usuário cancelou. A pasta inteira fica concedida a este app, e é assim que um app trabalha numa árvore sem pedir arquivo a arquivo.
    escolherPasta: (titulo, pasta) => ponte.chamar('arquivos.escolherPasta', { type: 'pick', variant: 'directory', title: titulo, dir: pasta }, 600000),
    // Com `caminho`, se este app pode tocá-lo: `true` ou `false`. Sem, a lista dos caminhos concedidos a ele, com que o app refaz um handle sem abrir seletor. Quem decide é o shell; o espelho que o SDK mantém serve só ao que precisa responder sem esperar.
    permissoes: (caminho) => ponte.chamar('arquivos.permissoes', { type: 'grants', path: caminho }, 5000),
    // O que está na área de transferência de arquivos do ambiente: `{ action, paths }`, ou `null`. É a área do gerenciador de arquivos, que nenhuma API do navegador alcança; texto e imagem vão por `navigator.clipboard`, direto no app.
    areaDeTransferencia: () => ponte.chamar('arquivos.areaDeTransferencia', { type: 'clipboard', op: 'files' }, 5000),
    // Põe caminhos na área de transferência de arquivos, como se o usuário os tivesse copiado no gerenciador, e responde com quantos entraram. Sempre copiar: recortar moveria um arquivo do usuário na próxima colagem a partir de uma mensagem de iframe, e fica com o gerenciador, onde a pessoa vê o que faz.
    copiarParaAreaDeTransferencia: (caminhos) => ponte.chamar('arquivos.copiarParaAreaDeTransferencia', { type: 'clipboard', op: 'setFiles', paths: caminhos }, 5000),
    // Abre um arquivo no visualizador do ambiente que a extensão pede: PDF, vídeo, editor de texto, planilha. O app manda o caminho e não precisa saber em que servidor está.
    abrir: (caminho) => ponte.disparar('arquivos.abrir', { type: 'open-file', path: caminho }),
    // Abre uma pasta no gerenciador de arquivos.
    abrirPasta: (caminho) => ponte.disparar('arquivos.abrirPasta', { type: 'open-folder', path: caminho }),
    // Mostra ao usuário os aplicativos que abrem o arquivo, a mesma lista do menu de contexto do gerenciador, e abre no escolhido. Responde com o nome do aplicativo, ou `null` se o usuário cancelou. Sem X11 a lista tem só vssh-apps.
    abrirCom: (caminho) => ponte.chamar('arquivos.abrirCom', { type: 'open-with', path: caminho }, 600000),
    // Abre um link no navegador do ambiente, que resolve a rede a partir do servidor Linux: um `http://localhost:3000` chega ao loopback do servidor, e numa aba de fora chegaria à máquina de quem lê. Só `http` e `https`. Um link cujo host outro app declarou em `opens.urls` vai para esse app; `destino: 'navegador'` pede o navegador mesmo assim.
    abrirLink: (url, destino) => ponte.chamar('arquivos.abrirLink', { type: 'open-url', url: url, destino: destino }, 5000),
    // Avisa que um arraste de arquivos começou dentro do app, com os caminhos absolutos que ele carrega. É o que acende os alvos de soltura do ambiente (a área de trabalho, o gerenciador, a lixeira), que leem um estado do documento do shell que um gesto nascido no iframe não escreve. O SDK o manda de dentro do `dragstart`.
    arrastar: (caminhos) => ponte.disparar('arquivos.arrastar', { type: 'arraste', fase: 'inicio', caminhos: caminhos }),
    // Avisa que o arraste acabou, e apaga o estado. O `dragend` não atravessa documentos, então sem este aviso os alvos do ambiente ficariam acesos para um gesto que já terminou. O SDK o manda sozinho, no `dragend` do app.
    terminarArraste: () => ponte.disparar('arquivos.terminarArraste', { type: 'arraste', fase: 'fim' }),
    // Assina um evento deste espaço (permissoesMudaram, arquivoMudou, areaDeTransferenciaMudou) e devolve a função que cancela.
    ao: (evento, cb) => ponte.escutar('arquivos', evento, cb),
  };

  // ── avisos: Notificação, aviso efêmero, atividade em curso e bandeja, para um app com janela aberta.
  vssh.avisos = {
    // Um fato que aconteceu, gravado no histórico do sino e anunciado num aviso: um caminho, um erro que a pessoa vai querer reencontrar. `nivel` é o tom (cor e ícone); `prioridade` é quanto interromper: `baixa` só marca o sino, `normal` mostra o aviso por alguns segundos, `alta` o deixa na tela até a pessoa responder. Um app não abre modal, e `critica` vira `alta`. A mesma `chave` substitui a notificação anterior no lugar de empilhar. O clique numa das `acoes` volta pelo evento `acaoDeNotificacao`. `abrir` é onde o clique na notificação leva, um caminho dentro do app (`?documento=x`), que chega pelo evento `abertura` quando a janela já está aberta. A resposta é o id da notificação.
    notificar: (mensagem, titulo, nivel, prioridade, chave, acoes, abrir) => ponte.chamar('avisos.notificar', { type: 'notify', message: mensagem, title: titulo, level: nivel, prioridade: prioridade, chave: chave, actions: acoes, rota: abrir }, 5000),
    // A frase que se lê e se esquece ("copiado", "salvo"): some sozinha depois de `duracao` milissegundos (4000 por padrão) e não entra no histórico. A mesma `chave` reescreve o aviso que está na tela e recomeça o relógio dele.
    avisar: (mensagem, titulo, nivel, duracao, chave) => ponte.chamar('avisos.avisar', { type: 'toast', message: mensagem, title: titulo, level: nivel, timeout: duracao, chave: chave }, 5000),
    // Uma condição que é verdade agora, na bandeja e no painel de atividades: um progresso, algo tocando. `item` leva `titulo`, `texto`, `formato` (`simples`, `progresso` ou `midia`), `progresso` (`{ feito, total }` ou `{ indeterminado: true }`) e `acoes`; a mesma `chave` atualiza no lugar, então relatar progresso não empilha linhas. O clique numa ação volta pelo evento `acaoDeAtividade`. A resposta é a chave completa, `app:<id>:<chave>`, que é a que o ambiente usa. Sem `item`, o mesmo fio encerra a atividade, como `encerrarAtividade`.
    atividade: (chave, item) => ponte.chamar('avisos.atividade', { type: 'live', chave: chave, item: item }, 5000),
    // Encerra uma atividade. Sem `registrar` ela some sem deixar rastro, que é o certo para uma indisponibilidade resolvida; com `registrar` (`titulo`, `texto`, `level`) o fim vira uma notificação no histórico, como "550 arquivos copiados". A resposta é a chave completa.
    encerrarAtividade: (chave, registrar) => ponte.chamar('avisos.encerrarAtividade', { type: 'live', item: null, chave: chave, registrar: registrar }, 5000),
    // O ícone do app ao lado do relógio. `item` leva `icon` (nome de ícone do ambiente ou caminho dentro do pacote), `tooltip`, `badge` (`{ count }`, `{ dot: true }` ou `{ text }`) e `menu` (itens com `id` e `label`). É um item por app, e chamar de novo troca o conteúdo sem o ícone mudar de lugar. O clique e a escolha no menu voltam pelo evento `acaoNaBandeja`. A resposta é `true`.
    bandeja: (item) => ponte.chamar('avisos.bandeja', { type: 'tray', op: 'set', item: item }, 5000),
    // Tira o ícone do app da bandeja. A resposta diz se havia um.
    tirarDaBandeja: () => ponte.chamar('avisos.tirarDaBandeja', { type: 'tray', op: 'remove' }, 5000),
    // Assina um evento deste espaço (acaoDeNotificacao, acaoDeAtividade, acaoNaBandeja) e devolve a função que cancela.
    ao: (evento, cb) => ponte.escutar('avisos', evento, cb),
  };

  // ── dialogos: Os diálogos do sistema e o menu de contexto, desenhados pelo shell com os dados que o app manda.
  vssh.dialogos = {
    // Uma caixa de informação com um botão OK. A resposta chega quando a pessoa fecha a caixa.
    mostrar: (mensagem, titulo) => ponte.chamar('dialogos.mostrar', { type: 'dialog', message: mensagem, title: titulo }, 600000),
    // A mesma caixa de `mostrar`, com o tom de erro.
    erro: (mensagem, titulo) => ponte.chamar('dialogos.erro', { type: 'dialog', variant: 'error', message: mensagem, title: titulo }, 600000),
    // Uma pergunta com "Sim" e "Não". A resposta é `true` só quando a pessoa disse sim; fechar a caixa vale como não.
    confirmar: (mensagem, titulo) => ponte.chamar('dialogos.confirmar', { type: 'dialog', variant: 'confirm', message: mensagem, title: titulo }, 600000),
    // Um campo de texto de uma linha. A resposta é o que a pessoa escreveu, ou `null` quando ela cancelou.
    perguntar: (mensagem, valor, titulo) => ponte.chamar('dialogos.perguntar', { type: 'dialog', variant: 'prompt', message: mensagem, value: valor, title: titulo }, 600000),
    // Um campo de senha, com o texto escondido. A resposta é o valor digitado, ou `null` quando a pessoa cancelou. O valor chega ao app; para uma credencial que o app não deve ver, o caminho é `segredos.pedir`.
    senha: (mensagem, titulo) => ponte.chamar('dialogos.senha', { type: 'dialog', variant: 'password', message: mensagem, title: titulo }, 600000),
    // O menu de contexto do ambiente, montado com os itens que o app descreve: `label`, `icon`, `id`, `danger`, `checked`, `disabled`, `separator`, `header` e um nível de `submenu`. `x` e `y` são do viewport do app, e o shell soma a posição da janela. A resposta é o `id` do item escolhido (o `label`, quando o item não tem id), e `null` quando a pessoa fechou sem escolher.
    menuDeContexto: (x, y, itens) => ponte.chamar('dialogos.menuDeContexto', { type: 'context-menu', x: x, y: y, items: itens }, 600000),
    // Este espaço não declara eventos: qualquer nome aqui é recusado.
    ao: (evento, cb) => ponte.escutar('dialogos', evento, cb),
  };

  // ── segredos: O cofre: o app pede uma credencial pelo nome, o shell mostra o campo e grava, e o valor nunca passa pelo app. A pessoa confere, troca e apaga o que guardou no Chaveiro, a janela do ambiente que lista as credenciais de todo app.
  vssh.segredos = {
    // Os nomes guardados para este app, em `names`. Só os nomes: o cofre não devolve valor.
    listar: () => ponte.chamar('segredos.listar', { type: 'secrets', op: 'list' }, 5000),
    // Pede à pessoa uma credencial pelo nome (maiúsculas, dígitos e sublinhado, até 64 caracteres). O shell mostra um campo de senha com a `descricao`, grava no servidor e responde `{ names, requerReinicio: true }`; o valor não passa pelo app. O ambiente de um processo é fixado no start, e `requerReinicio` é o app saber que precisa reiniciar para enxergar o segredo. Cancelar responde `{ names: null, cancelado: true }`.
    pedir: (nome, titulo, descricao) => ponte.chamar('segredos.pedir', { type: 'secrets', op: 'set', nome: nome, title: titulo, description: descricao }, 600000),
    // Apaga uma credencial pelo nome. A resposta é `{ names, requerReinicio: true }`, com a lista que sobrou.
    apagar: (nome) => ponte.chamar('segredos.apagar', { type: 'secrets', op: 'del', nome: nome }, 5000),
    // Este espaço não declara eventos: qualquer nome aqui é recusado.
    ao: (evento, cb) => ponte.escutar('segredos', evento, cb),
  };

  // ── configuracoes: A seção que o app traz a Configurações do ambiente (`contributes.settings`). Um app que a declara opcional (`contributes.settingsOptIn`) a liga e desliga daqui, de dentro dele; a escolha é por usuário e acompanha a pessoa.
  vssh.configuracoes = {
    // Se a seção deste app aparece em Configurações, em `ligada`, e se ela é opcional, em `opcional`. Um app sem `settingsOptIn` lê `ligada: true` sempre.
    ligada: () => ponte.chamar('configuracoes.ligada', { type: 'settings-section', op: 'get' }, 5000),
    // Liga (`true`) ou desliga (`false`) a seção deste app em Configurações, e responde o mesmo que `ligada`. Só faz efeito num app com `settingsOptIn`; nos outros a seção existe sempre, e a resposta diz isso.
    ligar: (ligado) => ponte.chamar('configuracoes.ligar', { type: 'settings-section', op: 'set', ligado: ligado }, 5000),
    // Abre Configurações na seção deste app. Com a seção desligada, ou antes de ela ter sido carregada, abre Configurações no índice; a resposta traz em `secao` o id da seção aberta, ou `null`.
    abrir: () => ponte.chamar('configuracoes.abrir', { type: 'settings-section', op: 'open' }, 5000),
    // Este espaço não declara eventos: qualquer nome aqui é recusado.
    ao: (evento, cb) => ponte.escutar('configuracoes', evento, cb),
  };

  // ── midia: O que o app está tocando, o transporte que ele sabe fazer e o volume que o usuário deixou para ele.
  vssh.midia = {
    // O app dizendo que tem áudio, e se está tocando. É o que o põe na lista do mixer de volume: um app que toca por Web Audio não tem elemento que o shell encontre na varredura. O SDK relata sozinho a mídia e o Web Audio que ele vê; um app só chama isto por conta própria quando produz som por um caminho que o SDK não alcança.
    audio: (temAudio, tocando) => ponte.disparar('midia.audio', { type: 'audio-state', hasAudio: temAudio, playing: tocando }),
    // O que este app sabe fazer de transporte além de tocar, pausar e buscar, que o shell já faz sozinho: anterior e próximo dependem de uma fila, e a fila é do app. A central de mídia desenha só os botões declarados, e o clique volta pelo evento `acao`.
    transporte: (anterior, proximo) => ponte.disparar('midia.transporte', { type: 'media-transporte', anterior: anterior, proximo: proximo }),
    // O que está tocando, para a central de mídia. Sem isto o shell tira o nome da URL da fonte, e uma mídia montada por MSE tem um `blob:` sem nome. `capa` é uma URL de imagem relativa ao app, e só vale dentro dele. Sem título e sem capa, a decisão volta ao ambiente.
    agora: (titulo, subtitulo, capa) => ponte.disparar('midia.agora', { type: 'media-agora', titulo: titulo, subtitulo: subtitulo, capa: capa }),
    // Assina um evento deste espaço (volume, acao) e devolve a função que cancela.
    ao: (evento, cb) => ponte.escutar('midia', evento, cb),
  };

  // ── impressao: Imprimir pela tela do sistema: o app pede, e quem escolhe a impressora e confirma é o usuário.
  vssh.impressao = {
    // Abre a tela de impressão do ambiente para um arquivo do servidor, por caminho absoluto. Quem escolhe a impressora e confirma é a pessoa, com o `nome` do arquivo na tela (o do caminho, por padrão). A resposta é `true` assim que a tela abre, sem esperar a impressão.
    imprimir: (caminho, nome) => ponte.chamar('impressao.imprimir', { type: 'print', path: caminho, name: nome }, 5000),
    // Este espaço não declara eventos: qualquer nome aqui é recusado.
    ao: (evento, cb) => ponte.escutar('impressao', evento, cb),
  };

  // ── gpu: O recurso que o sistema arbitra ao subir o app. O manifesto declara o que o app precisa em `recursos.gpu.modo`; quem decide, com o que o servidor tem, é o `vssh-app-run`, e o app pergunta o que recebeu sem conhecer `CUDA_VISIBLE_DEVICES` nem o inventário do servidor.
  vssh.gpu = {
    // O que o sistema concedeu de GPU a este app, na forma que o backend lê em `vssh.gpu.concedida()`: `{ concedida, dispositivos, motivo }`. `dispositivos` são os que o processo do app abre, cada um com `fabricante`, `driver`, `virtual`, `video` (o caminho de codificação: `nvenc`, `vaapi` ou `null`) e `renderNode`; a lista fica vazia quando nada foi concedido. `motivo` é a frase do lançador quando a resposta é não (`não declarada no manifesto`, `sem GPU utilizável: ...`, `não consegui consultar este servidor`), e `null` quando é sim. A janela e o backend leem o mesmo registro, e o gerenciador de tarefas mostra a mesma frase.
    estado: () => ponte.chamar('gpu.estado', { type: 'gpu', op: 'estado' }, 5000),
    // Este espaço não declara eventos: qualquer nome aqui é recusado.
    ao: (evento, cb) => ponte.escutar('gpu', evento, cb),
  };


  // ── O espelho das permissões de arquivo ───────────────────────────────────────────────────
  //
  // Quem decide é o shell, que confere todo verbo de disco. O espelho existe para `urlFor`, que
  // é síncrona e não tem como perguntar ao pai, e para `concedidos()`, com que um app refaz um
  // handle sem abrir seletor. O shell o alimenta no load e a cada mudança, inclusive com o que
  // foi concedido em sessões anteriores; a lista substitui a anterior, para uma revogação lá
  // apagar aqui.
  const concedidos = new Set();
  const lembrar = (p) => { if (typeof p === 'string' && p.startsWith('/')) concedidos.add(p.replace(/\/+$/, '')); };
  function adotar(caminhos) {
    if (!Array.isArray(caminhos)) return;
    concedidos.clear();
    for (const p of caminhos) lembrar(p);
  }
  const concedido = (p) => {
    const abs = String(p || '');
    if (!abs.startsWith('/') || abs.includes('..')) return false;
    for (const g of concedidos) if (abs === g || abs.startsWith(`${g}/`)) return true;
    return false;
  };

  // O serverId sai do caminho do app no portal (`/<serverId>/proxy/app/<id>/`). No cliente de
  // desktop o app mora na raiz de uma origem própria, onde esse caminho não existe e tudo vai ao
  // backend do app; ali o arquivo é pedido ao espaço `/_sdk/` da origem, que o relay leva ao
  // `/api/fs/read` do servidor da janela.
  const slugDoServidor = (location.pathname.match(/^\/([^/]+)\/proxy\/app\//) || [])[1] || '';

  /** O tipo MIME do arraste de arquivos do ambiente: caminhos absolutos, um por linha. */
  vssh.arquivos.MIME = 'application/x-vssh-files';

  /** Os caminhos que este app já pode tocar, do espelho, sem ida ao shell. */
  vssh.arquivos.concedidos = () => [...concedidos];

  /**
   * A URL HTTP do conteúdo de um arquivo, para `<img src>`, `<video>`, `<embed>` ou `fetch`.
   * Síncrona porque substitui `URL.createObjectURL(file)`, cujo retorno os apps põem direto no
   * `src`. O cookie de sessão acompanha a requisição, e a rota aceita `Range`. Fora do que foi
   * concedido a URL sai do mesmo jeito, com um aviso; quem recusa é o servidor.
   *
   * O aviso sai uma vez por página. Um visualizador que anda por uma pasta pede a URL de cada
   * vizinho, e um aviso por arquivo enterraria o resto do console.
   */
  let avisouUrlFor = false;
  vssh.arquivos.urlFor = (caminho) => {
    const abs = String(caminho || '');
    if (!avisouUrlFor && !concedido(abs)) {
      avisouUrlFor = true;
      console.warn(`[vssh] urlFor('${abs}'): caminho fora do que o usuário escolheu num seletor. `
        + 'A URL é devolvida assim mesmo, e o servidor pode recusar. Os próximos caminhos fora '
        + 'dele não avisam de novo.');
    }
    const consulta = `?path=${encodeURIComponent(abs)}`;
    return slugDoServidor ? `/${slugDoServidor}/api/fs/read${consulta}` : `/_sdk/fs/read${consulta}`;
  };

  /**
   * Acompanha as mudanças sob um caminho: `aoMudar({ caminho, encerrado })` a cada uma. Devolve
   * a função que para, e parar importa: cada assinatura segura um vigia no servidor do usuário,
   * com teto por usuário. É `vigiar` mais `ao('arquivoMudou')` mais `pararDeVigiar`, com o id do
   * vigia escolhido aqui.
   */
  vssh.arquivos.acompanhar = async (caminho, aoMudar) => {
    if (!noAmbiente) return () => {};
    const vigia = `v${++seq}`;
    const parar = ponte.escutar('arquivos', 'arquivoMudou', (m) => {
      if (m.vigia !== vigia) return;
      try { aoMudar({ caminho: m.caminho, encerrado: !!m.encerrado }); }
      catch (err) { console.warn('[vssh] acompanhar:', err); }
    });
    try { await vssh.arquivos.vigiar(caminho, vigia); }
    catch (err) { parar(); throw err; }
    let parado = false;
    return () => {
      if (parado) return;
      parado = true;
      parar();
      vssh.arquivos.pararDeVigiar(vigia).catch(() => {});
    };
  };

  // ── Imagem na área de transferência do sistema ────────────────────────────────────────────
  //
  // Texto e imagem vão por `navigator.clipboard`, direto no app: `write()` exige ativação do
  // usuário, e ativação não atravessa `postMessage`. O que o runtime acrescenta é o motivo da
  // recusa, porque as causas chegam todas como o mesmo `NotAllowedError`, e a diferença entre
  // elas é a diferença entre "chame de dentro do clique" e "não dá para fazer isso".
  function motivoDoClipboard(err) {
    if (err && err.name === 'NotAllowedError') {
      if (!document.hasFocus() || !(navigator.userActivation && navigator.userActivation.isActive)) return 'no-user-activation';
      return 'denied';
    }
    if (err && err.name === 'NotFoundError') return 'empty';
    return 'failed';
  }
  const semSuporte = (o) => Object.assign(new Error(`${o} indisponível`), { reason: 'unsupported' });

  /** A imagem da área de transferência do sistema como `Blob`, ou `null`. Lança com `reason`. */
  vssh.arquivos.imagemCopiada = async () => {
    if (!(navigator.clipboard && navigator.clipboard.read)) throw semSuporte('clipboard.read');
    let itens;
    try { itens = await navigator.clipboard.read(); }
    catch (err) { throw Object.assign(new Error(err.message), { reason: motivoDoClipboard(err), cause: err }); }
    for (const it of itens) {
      const tipo = it.types.find((t) => t.startsWith('image/'));
      if (tipo) return it.getType(tipo);
    }
    return null;
  };

  /** Põe uma imagem (`Blob`) na área de transferência do sistema. Lança com os mesmos `reason`. */
  vssh.arquivos.copiarImagem = async (blob) => {
    if (!(navigator.clipboard && navigator.clipboard.write)) throw semSuporte('clipboard.write');
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    } catch (err) {
      throw Object.assign(new Error(err.message), { reason: motivoDoClipboard(err), cause: err });
    }
  };

  // ── Arraste de arquivos, nas duas direções ────────────────────────────────────────────────
  //
  // O contrato é um tipo MIME com os caminhos absolutos, um por linha, o mesmo que o gerenciador
  // de arquivos e a área de trabalho escrevem. Do ambiente para o app o iframe recebe o próprio
  // `drop` e lê o `dataTransfer`; do app para o ambiente os alvos de soltura do shell leem um
  // estado do documento dele, que um gesto nascido aqui não escreve, e é para isso que os verbos
  // `arrastar` e `terminarArraste` existem. Fora do ambiente as duas funções valem entre janelas
  // do próprio app; só o aviso ao shell não tem a quem ir.
  const caminhosDoArraste = (dt) => {
    if (!dt) return [];
    const bruto = dt.getData(vssh.arquivos.MIME) || '';
    return bruto.split('\n').map((s) => s.trim()).filter(Boolean);
  };

  /**
   * Chama `cb({ caminhos, x, y, alvo })` quando arquivos do ambiente são soltos no app. Devolve
   * a função que desliga. O `preventDefault` no `dragover` é o que faz o `drop` acontecer; sem
   * ele o gesto morre com o cursor de proibido e nada chega ao console.
   */
  vssh.arquivos.aoSoltarArquivos = (cb, { alvo = document } = {}) => {
    const nosso = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes(vssh.arquivos.MIME);
    const sobre = (e) => {
      if (!nosso(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const soltou = (e) => {
      if (!nosso(e)) return;
      e.preventDefault();
      const caminhos = caminhosDoArraste(e.dataTransfer);
      if (!caminhos.length) return;
      try { cb({ caminhos, x: e.clientX, y: e.clientY, alvo: e.target }); }
      catch (err) { console.warn('[vssh] aoSoltarArquivos:', err); }
    };
    alvo.addEventListener('dragover', sobre);
    alvo.addEventListener('drop', soltou);
    return () => {
      alvo.removeEventListener('dragover', sobre);
      alvo.removeEventListener('drop', soltou);
    };
  };

  /**
   * Põe caminhos do usuário num arraste que o app inicia, de dentro do `dragstart` dele:
   *
   *     el.addEventListener('dragstart', (e) => vssh.arquivos.arrastarArquivos(e.dataTransfer, ['/home/u/a.md']));
   *
   * O fim é avisado daqui, num `dragend` de uma vez só, porque um app que esquecesse deixaria os
   * alvos do ambiente acesos para um gesto que já acabou.
   */
  vssh.arquivos.arrastarArquivos = (dataTransfer, caminhos, { efeito = 'copyMove' } = {}) => {
    const lista = (Array.isArray(caminhos) ? caminhos : [caminhos])
      .filter((p) => typeof p === 'string' && p.startsWith('/'));
    if (!lista.length) return false;
    if (dataTransfer) {
      dataTransfer.setData(vssh.arquivos.MIME, lista.join('\n'));
      dataTransfer.effectAllowed = efeito;
    }
    const fim = () => {
      document.removeEventListener('dragend', fim, true);
      vssh.arquivos.terminarArraste();
    };
    document.addEventListener('dragend', fim, true);
    vssh.arquivos.arrastar(lista);
    return true;
  };

  // ── Volume: o ambiente é o mixer ──────────────────────────────────────────────────────────
  //
  // Um vssh-app é um iframe no documento do shell, e quem faz papel de sistema operacional para
  // o áudio dele é o desktop. O app não configura nada e o slider dele funciona, por duas vias:
  // a mídia (`<audio>`, `<video>`) é multiplicada aqui dentro, para o app continuar dono do
  // volume que pediu e o ambiente virar um fator; e o Web Audio ganha um GainNode entre o app e
  // a saída, porque ali não há elemento que o shell encontre. O hook de `AudioNode.connect` tem
  // de existir antes de o app criar o contexto, e é por isso que este script vai no `<head>`.
  let ganho = 1;
  let mudo = false;
  let temWebAudio = false;
  const contextos = [];
  const limitar = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const efetivo = () => (mudo ? 0 : ganho);

  const descVolume = typeof HTMLMediaElement !== 'undefined'
    && Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
  const descMudo = typeof HTMLMediaElement !== 'undefined'
    && Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');

  function adotarMidia(el) {
    if (!descVolume || !descMudo || el.__vsshAudio) return;
    let base = descVolume.get.call(el);
    let baseMudo = descMudo.get.call(el);
    const aplicar = () => {
      descVolume.set.call(el, base * efetivo());
      descMudo.set.call(el, baseMudo || mudo);
    };
    // O getter devolve o que o app pediu: um player que desenha a própria barra lendo `el.volume`
    // continua mostrando o valor dele.
    Object.defineProperty(el, 'volume', { configurable: true, get: () => base, set: (v) => { base = limitar(v); aplicar(); } });
    Object.defineProperty(el, 'muted', { configurable: true, get: () => baseMudo, set: (v) => { baseMudo = !!v; aplicar(); } });
    el.__vsshAudio = aplicar;
    aplicar();
  }

  const midiaDoDocumento = () => (typeof document !== 'undefined' && document.querySelectorAll
    ? document.querySelectorAll('audio, video') : []);

  let aplicarGanhoWebAudio = () => {};
  let webAudioInstalado = false;

  function instalarWebAudio() {
    // Idempotente: envolver `connect` duas vezes encadearia dois gains, e o volume viraria o
    // quadrado dele.
    if (webAudioInstalado || typeof AudioNode === 'undefined') return;
    webAudioInstalado = true;
    const conectar = AudioNode.prototype.connect;
    const desconectar = AudioNode.prototype.disconnect;
    const gains = new WeakMap();
    const nosso = (ctx) => {
      let g = gains.get(ctx);
      if (!g) {
        g = ctx.createGain();
        g.gain.value = efetivo();
        conectar.call(g, ctx.destination);
        gains.set(ctx, g);
        contextos.push(ctx);
      }
      return g;
    };
    const ehSaida = (d) => d && d.context && d === d.context.destination;
    AudioNode.prototype.connect = function (destino, ...resto) {
      if (ehSaida(destino)) {
        const g = nosso(destino.context);
        if (this !== g) {
          if (!temWebAudio) { temWebAudio = true; relatarAudio(); }
          return conectar.call(this, g, ...resto);
        }
      }
      return conectar.apply(this, arguments);
    };
    AudioNode.prototype.disconnect = function (destino, ...resto) {
      if (ehSaida(destino)) {
        const g = gains.get(destino.context);
        if (g && this !== g) return desconectar.call(this, g, ...resto);
      }
      return desconectar.apply(this, arguments);
    };
    aplicarGanhoWebAudio = () => {
      for (const ctx of contextos) {
        const g = gains.get(ctx);
        if (g) { try { g.gain.value = efetivo(); } catch { /* contexto fechado */ } }
      }
    };
  }

  function aplicarVolume() {
    for (const el of midiaDoDocumento()) adotarMidia(el);
    for (const el of midiaDoDocumento()) if (el.__vsshAudio) el.__vsshAudio();
    aplicarGanhoWebAudio();
  }

  // O relato é o que põe o app na lista do mixer. Um app silencioso a vida inteira não manda
  // nada, e o último envio quando o som acaba é o que apaga a linha do painel.
  let tinhaAudio = false;
  function relatarAudio() {
    if (!noAmbiente) return;
    const els = midiaDoDocumento();
    const temWA = temWebAudio && contextos.some((c) => c.state === 'running');
    const tem = els.length > 0 || temWA;
    if (!tem && !tinhaAudio) return;
    tinhaAudio = tem;
    let tocando = temWA;
    for (const el of els) if (!el.paused && !el.ended) { tocando = true; break; }
    vssh.midia.audio(tem, tocando);
  }

  function iniciarAudio() {
    instalarWebAudio();
    for (const el of midiaDoDocumento()) adotarMidia(el);
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      const mo = new MutationObserver((muts) => {
        for (const m of muts || []) {
          for (const n of m.addedNodes || []) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'AUDIO' || n.tagName === 'VIDEO') { adotarMidia(n); relatarAudio(); }
            else if (n.querySelectorAll) {
              for (const el of n.querySelectorAll('audio, video')) { adotarMidia(el); relatarAudio(); }
            }
          }
        }
      });
      const alvo = document.documentElement || document.body;
      if (alvo) mo.observe(alvo, { childList: true, subtree: true });
    }
    // Eventos de mídia não borbulham; na fase de captura o documento os vê assim mesmo.
    if (typeof document !== 'undefined' && document.addEventListener) {
      for (const ev of ['play', 'pause', 'ended', 'loadedmetadata']) document.addEventListener(ev, relatarAudio, true);
    }
    // Três segundos contra o TTL de cinco do relato no shell: um app que morre sem se despedir
    // some sozinho.
    setInterval(relatarAudio, 3000);
    relatarAudio();
  }

  /** O ganho que o ambiente aplica a este app, de 0 a 1, já com o mudo (mudo é 0). */
  vssh.midia.ganho = () => (noAmbiente ? efetivo() : 1);
  /** Se o mixer do ambiente deixou este app mudo. */
  vssh.midia.mudo = () => (noAmbiente ? mudo : false);

  // ── A aparência do ambiente ───────────────────────────────────────────────────────────────
  //
  // O usuário escolhe uma cor de destaque em Configurações, e o shell a escreve no `<html>` dele.
  // Nada disso atravessa para o documento do app. Isto reporta e não escreve: quem grava as
  // variáveis no documento do app é a biblioteca de UI, e um app com identidade própria puxa só
  // a cor. São quatro tokens, e não um derivado de outro: a fórmula dos derivados mora no shell,
  // e copiá-la seria uma segunda cópia livre para divergir.
  const TOKENS_DE_DESTAQUE = ['--ds-accent', '--ds-accent-h', '--ds-accent-bg', '--ds-sel'];

  function raizDoAmbiente() {
    try {
      if (!noAmbiente) return null;
      const doc = window.parent.document;
      return (doc && doc.documentElement) || null;
    } catch {
      // Outra origem: ler `.document` já lança, e a resposta é a mesma de não haver ambiente.
      return null;
    }
  }

  // Por `getComputedStyle`, e não por `.style`: o shell só escreve o inline quando há cor gravada
  // nas preferências, e quem nunca escolheu tem o valor certo vindo da folha.
  function tokensDoAmbiente() {
    const raiz = raizDoAmbiente();
    if (!raiz) return null;
    try {
      const estilo = window.getComputedStyle(raiz);
      const fora = {};
      for (const nome of TOKENS_DE_DESTAQUE) {
        const valor = String(estilo.getPropertyValue(nome) || '').trim();
        if (valor) fora[nome] = valor;
      }
      return Object.keys(fora).length ? fora : null;
    } catch {
      return null;
    }
  }

  vssh.aparencia = {
    /**
     * Os tokens de destaque do ambiente, ou `null` quando não há a quem perguntar. `null` quer
     * dizer "não sobrescreva nada": os padrões já estão no CSS, onde precisam estar para a
     * página pintar certo antes de qualquer script.
     */
    tokens: () => tokensDoAmbiente(),

    /**
     * Avisa quando o usuário troca a cor, e só quando o valor muda: o shell reescreve o `style`
     * do `<html>` dele por outros motivos, e cada um acordaria o app para repintar a mesma cor.
     * Devolve a função que cancela.
     */
    aoMudar(fn) {
      const raiz = raizDoAmbiente();
      if (!raiz || typeof MutationObserver !== 'function') return () => {};
      let ultimo = JSON.stringify(tokensDoAmbiente());
      const mo = new MutationObserver(() => {
        const agora = tokensDoAmbiente();
        const serial = JSON.stringify(agora);
        if (serial === ultimo) return;
        ultimo = serial;
        fn(agora);
      });
      try { mo.observe(raiz, { attributes: true, attributeFilter: ['style', 'data-theme'] }); }
      catch { return () => {}; }
      return () => mo.disconnect();
    },
  };

  window.vssh = vssh;

  // ── A rede de link: o que iria virar aba vira janela do ambiente ─────────────────────────
  //
  // `vssh.arquivos.abrirLink` é a porta, e pressupõe um app que pede. A maior parte do código que
  // abre link não pede: um `<a target="_blank">` de dentro de uma biblioteca, um `window.open` no
  // fundo de um framework, um ctrl+clique. Tudo isso tiraria a pessoa do ambiente, para um
  // navegador onde `http://localhost:3000` é a máquina de quem lê, e não o servidor. Fora do
  // ambiente o navegador hospedeiro é o ambiente, e nada disto é instalado.

  /**
   * A URL absoluta `http(s)` que este valor representa, ou `null`. O `null` protege a janela
   * auxiliar do editor: o VS Code abre a flutuante com `open('' | 'about:blank')` e escreve no
   * documento que voltou. Vazio, `about:`, `blob:`, `data:` e caminho relativo seguem para o
   * `open` de verdade, e a ausência de base no `new URL` é o que faz o relativo não parsear.
   */
  function urlDeAba(bruta) {
    const s = String(bruta ?? '').trim();
    if (!s) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  }

  // Em `debug`, para a pilha dizer qual linha pediu a aba sem virar uma linha por clique.
  function desvio(origem, url) {
    if (console.debug) console.debug(`[vssh] ${origem} para o navegador do ambiente: ${url}`, new Error('rastro').stack);
  }

  // O que `window.open` devolve quando a rede pega a chamada. Um objeto, e não `null`: o
  // code-server confere o retorno e avisa "popup bloqueado" quando ele é nulo, por uma janela
  // que abriu no lugar certo.
  function tocoDeJanela() {
    return { closed: false, close() { this.closed = true; }, focus() {}, blur() {}, postMessage() {} };
  }

  const ALVOS_DE_ABA = new Set(['_blank', 'blank', '_new']);

  if (noAmbiente && typeof window.open === 'function') {
    const abrirDeVerdade = window.open.bind(window);
    window.open = function (url, alvo, feicoes) {
      const destino = urlDeAba(url);
      if (!destino) return abrirDeVerdade(url, alvo, feicoes);
      desvio('window.open', destino);
      vssh.arquivos.abrirLink(destino).catch(() => {});
      return tocoDeJanela();
    };
  }

  // Em fase de bolha, e só o que iria para a ação padrão: o handler do app roda primeiro, e se
  // ele reivindicou o evento (`preventDefault`) a rede sai de cena. Um handler que chama só
  // `stopPropagation()` deixa a aba escapar, e é o lado certo do erro: errar para mais quebraria
  // o app.
  if (noAmbiente && typeof document !== 'undefined' && document.addEventListener) {
    const aoClicar = (e) => {
      if (e.defaultPrevented) return;
      const meio = e.button === 1;
      if (!meio && e.button !== 0) return;
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      // `download` diz que este link vira arquivo, e não navegação.
      if (a.hasAttribute && a.hasAttribute('download')) return;
      const novaAba = ALVOS_DE_ABA.has(String(a.target || '').toLowerCase());
      if (!meio && !novaAba && !(e.ctrlKey || e.metaKey)) return;
      // Num `<a>` de SVG o `href` é um objeto, e `urlDeAba` devolve `null`: o clique segue normal.
      const destino = urlDeAba(a.href);
      if (!destino) return;
      e.preventDefault();
      desvio(meio ? 'clique do meio' : (novaAba ? 'target=_blank' : 'ctrl+clique'), destino);
      vssh.arquivos.abrirLink(destino).catch(() => {});
    };
    document.addEventListener('click', aoClicar);
    document.addEventListener('auxclick', aoClicar);
  }

  // ── O menu de contexto nativo não é do app ────────────────────────────────────────────────
  //
  // O botão direito dentro de um vssh-app abriria a caixa do navegador ("Voltar", "Recarregar",
  // "Inspecionar"): um menu de outro programa, sobre uma página e um iframe. O menu que um app
  // oferece é `vssh.dialogos.menuDeContexto`, e enquanto ele não o chama, silêncio é melhor. A
  // exceção é o que for editável, onde a caixa nativa é a única forma de recortar, copiar e colar
  // com o mouse. Um app que quer a caixa nativa num elemento chama `stopPropagation()` nele.
  if (noAmbiente && typeof document !== 'undefined' && document.addEventListener) {
    const EDITAVEL = 'input, textarea, [contenteditable=""], [contenteditable="true"]';
    document.addEventListener('contextmenu', (e) => {
      if (e.defaultPrevented) return;
      let editavel = false;
      try { editavel = !!(e.target && e.target.closest && e.target.closest(EDITAVEL)); } catch { /* alvo sem closest */ }
      if (editavel) return;
      e.preventDefault();
    });
  }

  // ── O título, espelhado sem o app pedir ───────────────────────────────────────────────────
  //
  // O shell lê o título uma vez, no `load` do iframe, e todo web app que abre um documento troca
  // `document.title` depois disso. Observar é o que faz um app portado funcionar sem editar o
  // app: o mesmo código que dá o título à aba dá o título à janela.
  if (noAmbiente && typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    let ultimo = document.title;
    const sincronizar = () => {
      if (document.title === ultimo) return;
      ultimo = document.title;
      vssh.app.titulo(ultimo);
    };
    const observar = () => {
      const el = document.querySelector('title');
      if (el) new MutationObserver(sincronizar).observe(el, { childList: true, characterData: true, subtree: true });
      // `document.title = x` sem `<title>` no HTML cria o elemento; observar o head cobre isso.
      if (document.head) new MutationObserver(sincronizar).observe(document.head, { childList: true });
      sincronizar();
    };
    if (document.head) observar();
    else document.addEventListener('DOMContentLoaded', observar, { once: true });
  }

  if (noAmbiente) {
    instalarWebAudio();
    if (typeof document === 'undefined') { /* sem DOM não há mídia a adotar */ }
    else if (document.documentElement || !document.addEventListener) iniciarAudio();
    else document.addEventListener('DOMContentLoaded', iniciarAudio, { once: true });

    // As permissões já na carga, sem esperar o push do shell no `load` do iframe: `urlFor` é
    // síncrona e um app pode montar um `<img src>` antes daquele evento.
    vssh.arquivos.permissoes().then(adotar).catch(() => {});
  }
})();

// A File System Access API sobre o shell VSSH: a parte do SDK web que faz um web app "que abre uma
// pasta local" rodar como vssh-app sem fork. Logseq web, Excalidraw, tldraw e a maioria dos
// editores chamam `showDirectoryPicker()` e trabalham a partir do handle devolvido; se o handle
// funciona, o app funciona.
//
// Sobre o shell, e não sobre um filesystem do próprio app: o portal já tem a API de arquivos e o
// desktop já tem o seletor, então o app portado ganha FSA sem backend de filesystem nenhum. Só o
// que o usuário escolheu num seletor fica alcançável, e quem impõe isso é o shell; um app que
// reimplementasse o protocolo não ganharia nada além do que o usuário concedeu.
//
// Entra no `_sdk/vssh.js` depois do runtime, e lê `window.vssh.arquivos`.
(function () {
  'use strict';

  if (!window.vssh) {
    console.warn('[vssh] o polyfill de File System Access precisa do runtime antes.');
    return;
  }
  // Um navegador que já tem a API de verdade, fora do ambiente: nada a sequestrar.
  if (window.showDirectoryPicker && !window.vssh.noAmbiente) return;

  const arquivos = window.vssh.arquivos;
  const basename = (p) => p.replace(/\/+$/, '').split('/').pop() || p;
  const join = (dir, name) => `${dir.replace(/\/+$/, '')}/${name}`;

  // As classes nativas, guardadas antes da troca dos globais. O OPFS continua nativo (ver o fim
  // do arquivo), então `navigator.storage.getDirectory()` devolve handles nativos, e o
  // `instanceof` deles precisa continuar respondendo sim.
  const NATIVO = {
    handle: window.FileSystemHandle,
    arquivo: window.FileSystemFileHandle,
    diretorio: window.FileSystemDirectoryHandle,
  };
  const marcaDe = (x) => (x && typeof x === 'object' ? x.__vsshHandle : null);
  const ehNativo = (x, Classe) =>
    typeof Classe === 'function' && x != null && Object.prototype.isPrototypeOf.call(Classe.prototype, x);


  // ── Handles ───────────────────────────────────────────────────────────────────────────────
  //
  // Apps persistem handles no IndexedDB, e o structured clone não transporta objeto com métodos:
  // o handle chegaria do outro lado vazio, e o app abriria o grafo do usuário como se estivesse
  // em branco. Todo handle carrega uma forma serializável (`__vsshHandle`), e o envelope de
  // IndexedDB no fim do arquivo reidrata na leitura.

  // Um File preguiçoso: só busca o conteúdo quando alguém pede. Apps que abrem uma pasta chamam
  // `getFile()` para todo arquivo dela, recursivamente, e só depois filtram; com busca ansiosa um
  // grafo de 300 arquivos viraria 600 requisições. `size` e `lastModified` vêm da listagem.
  //
  // O limite estrutural, medido num Chrome de verdade: um objeto que finge ser `Blob` só é um
  // `Blob` para quem chama os métodos que ele sobrescreve. `Response`, `FileReader` e o construtor
  // de `Blob` leem a sequência de bytes interna, que `super([])` deixa vazia, e `new Blob([f])`
  // sai com `size` certo e conteúdo vazio. O que cada caminho faz hoje:
  //
  //     await f.text() / f.arrayBuffer() / f.bytes()  métodos sobrescritos
  //     f.slice(a, b)                                 faixa nova, lida por Range HTTP
  //     URL.createObjectURL(f)                        URL do portal (interceptado)
  //     new Response(f) / new Request(…, {body: f})    corpo vira f.stream() (interceptado)
  //     fetch(url, { body: f })                       Blob real, carregado (interceptado)
  //     FileReader.readAs*                            carrega e despacha (interceptado)
  //     new Blob([f]) · FormData.append               0 bytes, com aviso (sem conserto)
  //
  // Os dois últimos são síncronos e leem na hora; não há onde encaixar um `await`. Eles avisam no
  // console, e passam a funcionar sozinhos quando o conteúdo já foi lido antes.
  class LazyFile extends Blob {
    /** `faixa` só vem de `slice()`: `{ inicio, tipo }`, com `meta.size` sendo o tamanho da faixa. */
    constructor(path, name, meta, faixa) {
      super([]);
      this._path = path;
      this._name = name;
      this._size = Number(meta && meta.size) || 0;
      this._mtime = meta && meta.mtime ? Number(meta.mtime) : Date.now();
      this._bytes = null;
      this._inicio = faixa ? Number(faixa.inicio) || 0 : 0;
      this._ehFaixa = !!faixa;
      this._tipo = (faixa && faixa.tipo) || '';
    }
    get name() { return this._name; }
    get size() { return this._size; }
    get lastModified() { return this._mtime; }
    get type() { return this._tipo; }

    async _load() {
      if (!this._bytes) {
        this._bytes = this._ehFaixa
          ? await lerFaixa(this._path, this._inicio, this._size)
          : await arquivos.lerBytes(this._path);
      }
      return this._bytes;
    }
    async arrayBuffer() {
      const b = await this._load();
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
    async text() { return new TextDecoder().decode(await this._load()); }
    async bytes() { return this._load(); }
    stream() {
      const self = this;
      return new ReadableStream({
        async pull(controller) {
          controller.enqueue(await self._load());
          controller.close();
        },
      });
    }

    // Fatiar é a operação primária de todo leitor de Parquet, HDF5, Zarr e DICOM: eles leem por
    // faixa em vez de carregar o arquivo. Com o conteúdo já em mãos, um `Blob` real é melhor que
    // um preguiçoso, porque funciona em todos os caminhos da plataforma.
    slice(inicio, fim, tipo) {
      const [a, b] = faixaNormalizada(inicio, fim, this._size);
      if (this._bytes) return new Blob([this._bytes.subarray(a, b)], { type: tipo });
      return new LazyFile(this._path, this._name, { size: b - a, mtime: this._mtime },
        { inicio: this._inicio + a, tipo });
    }
  }

  // Como a especificação do Blob manda: índice negativo conta do fim, e faixa invertida é vazia.
  function faixaNormalizada(inicio, fim, tamanho) {
    const corta = (v, padrao) => {
      if (v === undefined || v === null) return padrao;
      v = Math.trunc(Number(v)) || 0;
      return v < 0 ? Math.max(tamanho + v, 0) : Math.min(v, tamanho);
    };
    const a = corta(inicio, 0);
    const b = corta(fim, tamanho);
    return [a, Math.max(a, b)];
  }

  /**
   * Lê uma faixa de bytes, por um `Range` HTTP sobre a URL que o shell já serve: é o que torna
   * útil abrir um arquivo de 2 GB para ler 64 KB dele. Só o `206` autoriza usar o corpo como a
   * faixa; um `200` é o servidor ignorando o `Range`, e aí fatiamos aqui, desde que o corpo seja
   * grande o bastante para conter a faixa (um corpo curto é uma página de erro, e fatiá-la
   * devolveria lixo com cara de conteúdo). Sem rede, o caminho de baixo lê tudo pela ponte.
   */
  async function lerFaixa(caminho, inicio, tamanho) {
    const url = typeof arquivos.urlFor === 'function' ? arquivos.urlFor(caminho) : null;
    if (url && typeof fetch === 'function') {
      try {
        const r = await fetch(url, { headers: { Range: `bytes=${inicio}-${inicio + tamanho - 1}` } });
        if (r.ok) {
          const buf = new Uint8Array(await r.arrayBuffer());
          if (r.status === 206 && buf.length === tamanho) return buf;
          if (r.status === 200 && buf.length >= inicio + tamanho) return buf.subarray(inicio, inicio + tamanho);
        }
      } catch { /* rede fora: o caminho de baixo responde */ }
    }
    const tudo = await arquivos.lerBytes(caminho);
    return tudo.subarray(inicio, inicio + tamanho);
  }

  /**
   * A base dos dois handles. O Chrome já tem `FileSystemHandle`, e preservar a nativa fazia
   * `h instanceof FileSystemHandle` responder não para todo handle nosso, enquanto a classe
   * concreta respondia sim. A base é a nossa, e o `instanceof` aceita as duas procedências: os
   * nossos handles e os nativos do OPFS.
   */
  class VsshHandle {
    static [Symbol.hasInstance](x) { return !!marcaDe(x) || ehNativo(x, NATIVO.handle); }

    get _path() { return this.__vsshHandle.path; }

    async queryPermission(d = {}) { return queryPermission(this, d); }
    async requestPermission(d = {}) { return requestPermission(this, d); }
    async isSameEntry(other) { return !!(other && other.__vsshHandle) && other.__vsshHandle.path === this._path; }

    /**
     * `move(novoNome)`, `move(pastaDestino)` e `move(pastaDestino, novoNome)`, as três formas
     * da especificação. O handle se atualiza no lugar: um que continuasse apontando para o
     * caminho velho seria um handle morto que parece vivo.
     */
    async move(destino, novoNome) {
      const pasta = destino && destino.__vsshHandle && destino.__vsshHandle.kind === 'directory' ? destino : null;
      const nome = pasta ? String(novoNome ?? this.name) : String(destino ?? this.name);
      const paiAtual = this._path.slice(0, this._path.lastIndexOf('/')) || '';
      const novo = join(pasta ? pasta._path : paiAtual, nome);
      await arquivos.renomear(this._path, novo);
      this.__vsshHandle.path = novo;
      this.name = nome;
    }

    /** Apaga o que este handle aponta. Diretório com conteúdo exige `{ recursive: true }`. */
    async remove(opts = {}) {
      await apagar(this._path, !!opts.recursive);
    }
  }

  /**
   * O `apagar` do shell é incondicional, e a especificação da FSA não é: apagar um diretório com
   * conteúdo sem `{ recursive: true }` lança `InvalidModificationError`. A conferência é um
   * `listar`, e não um `consultar` seguido de `listar`: uma guarda que dependesse do formato da
   * resposta do stat falharia aberta se o campo faltasse. Arquivo não lista, e diretório vazio
   * lista vazio.
   */
  async function apagar(caminho, recursive) {
    if (!recursive) {
      const { items = [] } = await arquivos.listar(caminho).catch(() => ({ items: [] }));
      if (items.length) {
        const err = new Error(`'${basename(caminho)}' não está vazio: passe { recursive: true } para apagar o conteúdo.`);
        err.name = 'InvalidModificationError';
        throw err;
      }
    }
    await arquivos.apagar(caminho);
  }

  class VsshFileHandle extends VsshHandle {
    static [Symbol.hasInstance](x) {
      return (marcaDe(x) || {}).kind === 'file' || ehNativo(x, NATIVO.arquivo);
    }
    constructor(path, meta) {
      super();
      this.kind = 'file';
      this.name = basename(path);
      this._meta = meta || null;
      this.__vsshHandle = { v: 1, kind: 'file', path };
    }

    async getFile() {
      const meta = this._meta || await arquivos.consultar(this._path).catch(() => ({}));
      return new LazyFile(this._path, this.name, meta);
    }

    // Um `WritableStream` de verdade, porque apps fazem `contents.pipeTo(writable)`, e isso exige
    // a classe real. `write`, `seek` e `truncate` entram como propriedades próprias, que é o que
    // a especificação de `FileSystemWritableFileStream` faz por cima de `WritableStream`.
    async createWritable(opts = {}) {
      const path = this._path;
      const chunks = [];
      const keep = opts.keepExistingData ? await arquivos.ler(path).catch(() => '') : null;
      if (keep) chunks.push(keep);

      // Texto puro segue pela rota de texto; qualquer byte real vai pela rota binária, porque
      // texto-codificar um PNG o corrompe sem aviso.
      const commit = async () => {
        if (chunks.every((c) => typeof c === 'string')) return arquivos.escrever(path, chunks.join(''));
        const buf = await new Blob(chunks).arrayBuffer();
        return arquivos.escreverBytes(path, new Uint8Array(buf));
      };

      let writer = null;
      const stream = new WritableStream({
        write(chunk) { chunks.push(chunk); },
        close: commit,
      });

      stream.write = async (data) => {
        // A especificação aceita o dado cru ou `{ type: 'write', data }`.
        if (data && typeof data === 'object' && !ArrayBuffer.isView(data)
            && !(data instanceof Blob) && !(data instanceof ArrayBuffer) && 'data' in data) {
          data = data.data;
        }
        writer = writer || stream.getWriter();
        return writer.write(data);
      };
      stream.truncate = async () => { chunks.length = 0; };
      stream.seek = async () => { throw new Error('[vssh] seek() não é suportado: a escrita é sequencial.'); };
      const origClose = stream.close ? stream.close.bind(stream) : null;
      stream.close = async () => {
        if (writer) return writer.close();
        if (origClose) return origClose();
        return commit();
      };
      return stream;
    }
  }

  class VsshDirectoryHandle extends VsshHandle {
    static [Symbol.hasInstance](x) {
      return (marcaDe(x) || {}).kind === 'directory' || ehNativo(x, NATIVO.diretorio);
    }
    constructor(path) {
      super();
      this.kind = 'directory';
      this.name = basename(path);
      this.__vsshHandle = { v: 1, kind: 'directory', path };
    }

    async *entries() {
      const { items = [] } = await arquivos.listar(this._path);
      for (const it of items) {
        const p = join(this._path, it.name);
        // `size` e `mtime` seguem junto, para `getFile()` não custar um stat por arquivo.
        yield [it.name, it.type === 'directory' || it.isDirectory
          ? new VsshDirectoryHandle(p)
          : new VsshFileHandle(p, { size: it.size, mtime: it.mtime })];
      }
    }
    async *keys() { for await (const [n] of this.entries()) yield n; }
    async *values() { for await (const [, h] of this.entries()) yield h; }
    [Symbol.asyncIterator]() { return this.entries(); }

    async getFileHandle(name, opts = {}) {
      const p = join(this._path, name);
      const meta = await arquivos.consultar(p).catch(() => null);
      if (!meta) {
        if (!opts.create) throw notFound(name);
        await arquivos.escrever(p, '');
      }
      return new VsshFileHandle(p);
    }

    async getDirectoryHandle(name, opts = {}) {
      const p = join(this._path, name);
      const meta = await arquivos.consultar(p).catch(() => null);
      if (!meta) {
        if (!opts.create) throw notFound(name);
        await arquivos.criarPasta(p);
      }
      return new VsshDirectoryHandle(p);
    }

    async removeEntry(name, opts = {}) {
      await apagar(join(this._path, name), !!opts.recursive);
    }

    async resolve(possible) {
      const p = possible && possible.__vsshHandle && possible.__vsshHandle.path;
      if (!p || !p.startsWith(`${this._path}/`)) return null;
      return p.slice(this._path.length + 1).split('/');
    }
  }

  // Os apps distinguem `NotFoundError` de erro genérico para decidir entre criar e falhar, e
  // tratam `AbortError` como "o usuário desistiu"; sem os nomes certos eles mostram um erro que
  // não aconteceu.
  function notFound(name) {
    const err = new Error(`não encontrado: ${name}`);
    err.name = 'NotFoundError';
    return err;
  }
  function abortError() {
    const err = new Error('o usuário cancelou a seleção');
    err.name = 'AbortError';
    return err;
  }

  // ── Permissão: perguntar a quem decide ────────────────────────────────────────────────────
  //
  // Um handle restaurado do IndexedDB pode já não ter permissão nenhuma; responder `granted`
  // sem perguntar deixava o app ser negado na primeira operação, com um stack trace no lugar de
  // uma explicação. `ask()` tem três respostas: `true`, `false` e `null` (não obtive resposta:
  // um shell sem o verbo, um erro, o prazo). "Não" e "não sei" pedem ações opostas, e tratar
  // `null` como `false` mandava o app reconceder uma permissão que ele já tinha. Sem a quem
  // perguntar, os dois respondem `granted`, que é o único comportamento que não incomoda o
  // usuário à toa.
  async function ask(handle) {
    if (typeof arquivos.permissoes !== 'function') return null;
    const v = await arquivos.permissoes(handle._path).catch(() => null);
    return typeof v === 'boolean' ? v : null;
  }

  // `mode` (`'read'` | `'readwrite'`) é aceito e ignorado: todo grant do shell é readwrite, e
  // readwrite satisfaz read. O parâmetro existe para o dia em que o shell tiver grants por modo.
  async function queryPermission(handle) {
    const v = await ask(handle);
    if (v === null) return 'granted';
    return v ? 'granted' : 'prompt';
  }

  async function requestPermission(handle) {
    const v = await ask(handle);
    if (v === null) return 'granted';
    if (v) return 'granted';

    // Abrir seletor exige gesto do usuário, e a regra é do navegador. Sem isto, um
    // `requestPermission` no meio do boot (o Logseq faz, ao restaurar o grafo) abriria um seletor
    // que ninguém pediu.
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.isActive) {
      return 'prompt';
    }

    const titulo = `Escolha novamente: ${handle.name}`;
    if (handle.kind === 'directory') await arquivos.escolherPasta(titulo);
    else await arquivos.escolherArquivo(titulo);

    // Escolher outro caminho não concede este: o handle continua apontando para onde apontava.
    const depois = await ask(handle);
    if (depois === null) return 'granted';
    return depois ? 'granted' : 'denied';
  }

  // Reidrata um valor lido do IndexedDB. Desce em objeto simples e array porque o handle nem
  // sempre é o valor guardado: apps guardam `{ handle, lastOpened }` e afins. A profundidade tem
  // teto, que é custo e proteção contra ciclo ao mesmo tempo; Map, Set, typed array e Blob ficam
  // de fora, porque não é onde apps guardam handle.
  const REHYDRATE_MAX_DEPTH = 4;

  function rehydrate(v, depth = 0) {
    if (!v || typeof v !== 'object') return v;
    const h = v.__vsshHandle;
    if (h && h.path) return h.kind === 'directory' ? new VsshDirectoryHandle(h.path) : new VsshFileHandle(h.path);
    if (depth >= REHYDRATE_MAX_DEPTH) return v;
    if (Array.isArray(v)) return v.map((it) => rehydrate(it, depth + 1));
    // A marca de tipo, e não `Object.prototype`, que é sensível a realm: um objeto vindo de outro
    // documento tem outro protótipo. O que este teste exclui é objeto de plataforma.
    if (Object.prototype.toString.call(v) !== '[object Object]') return v;
    let changed = false;
    const out = {};
    for (const k of Object.keys(v)) {
      out[k] = rehydrate(v[k], depth + 1);
      if (out[k] !== v[k]) changed = true;
    }
    return changed ? out : v;
  }

  // ── A API pública ─────────────────────────────────────────────────────────────────────────
  //
  // Os descritores dos seletores com tradução são traduzidos; os que não têm avisam, em vez de
  // serem ignorados em silêncio.

  /**
   * `types` da FSA para a string de filtro do seletor do desktop, no formato do Qt/KDE: grupos
   * separados por `;;`, cada um `Nome (padrões)`.
   *
   *     [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }]
   *       vira "Markdown (*.md *.markdown)"
   */
  function filtroDeTypes(types) {
    if (!Array.isArray(types) || !types.length) return undefined;
    const grupos = [];
    for (const t of types) {
      const exts = [];
      for (const lista of Object.values((t && t.accept) || {})) {
        for (const e of (Array.isArray(lista) ? lista : [lista])) {
          const s = String(e || '').trim();
          if (s) exts.push(s.startsWith('.') ? `*${s}` : `*.${s}`);
        }
      }
      if (!exts.length) continue;
      const padroes = exts.join(' ');
      grupos.push(t.description ? `${t.description} (${padroes})` : padroes);
    }
    return grupos.length ? grupos.join(';;') : undefined;
  }

  /**
   * `startIn` aceita um handle ou um nome bem-conhecido (`'documents'`, `'downloads'`). O handle
   * é só o caminho dele; o nome dependeria de o shell saber os diretórios XDG do usuário, e ele
   * não sabe.
   */
  function dirDeStartIn(startIn) {
    if (!startIn) return undefined;
    const h = startIn.__vsshHandle;
    if (h && h.path) return h.kind === 'directory' ? h.path : h.path.slice(0, h.path.lastIndexOf('/')) || '/';
    if (typeof startIn === 'string') {
      console.warn(`[vssh] startIn: '${startIn}' é um diretório bem-conhecido, e o shell não os resolve; `
        + 'o seletor abre no lugar de sempre. Passe um handle para escolher onde abrir.');
    }
    return undefined;
  }

  window.showDirectoryPicker = async function (opts = {}) {
    const path = await arquivos.escolherPasta(opts.title || 'Escolher pasta', dirDeStartIn(opts.startIn));
    if (!path) throw abortError();
    return new VsshDirectoryHandle(path);
  };

  window.showOpenFilePicker = async function (opts = {}) {
    if (opts.multiple) {
      // Um array de um só, calado, seria o app recebendo a forma certa com o conteúdo errado.
      console.warn('[vssh] showOpenFilePicker({multiple:true}): o seletor do desktop é de escolha única, '
        + 'e você vai receber um array de um item. Chame de novo para cada arquivo, ou peça uma pasta '
        + 'com showDirectoryPicker().');
    }
    const path = await arquivos.escolherArquivo(opts.title || 'Abrir arquivo', filtroDeTypes(opts.types), dirDeStartIn(opts.startIn));
    if (!path) throw abortError();
    return [new VsshFileHandle(path)];
  };

  window.showSaveFilePicker = async function (opts = {}) {
    const path = await arquivos.escolherDestino(opts.title || 'Salvar arquivo', filtroDeTypes(opts.types),
      dirDeStartIn(opts.startIn), opts.suggestedName);
    if (!path) throw abortError();
    return new VsshFileHandle(path);
  };

  /**
   * Os handles do que já foi concedido, sem seletor. Um app pode ter a permissão e não ter o
   * handle: os caminhos concedidos moram no servidor e atravessam o computador, o IndexedDB do
   * app não. Escolher é consentir, e a pessoa escolheu; o que falta aqui é um objeto. O `kind`
   * sai de um stat, porque adivinhar pelo formato do caminho erraria em `/home/ana/dados.2024`;
   * o que não existe mais some da lista em vez de virar um handle morto.
   */
  arquivos.handlesConcedidos = async function () {
    const caminhos = typeof arquivos.concedidos === 'function' ? arquivos.concedidos() : [];
    const out = [];
    for (const p of caminhos) {
      let meta;
      try { meta = await arquivos.consultar(p); } catch { continue; }
      if (!meta) continue;
      const ehDir = meta.type === 'directory' || meta.isDirectory === true || meta.kind === 'directory';
      out.push(ehDir ? new VsshDirectoryHandle(p) : new VsshFileHandle(p, meta));
    }
    return out;
  };

  window.FileSystemHandle = VsshHandle;
  window.FileSystemFileHandle = VsshFileHandle;
  window.FileSystemDirectoryHandle = VsshDirectoryHandle;

  // ── URL.createObjectURL sobre um File preguiçoso ──────────────────────────────────────────
  //
  // `img.src = URL.createObjectURL(await handle.getFile())` é como quase todo app transforma um
  // handle em imagem, e com um `Blob` preguiçoso o `blob:` sai vazio. A URL HTTP do portal serve
  // os mesmos bytes, com `Range`, autorizada pelo cookie de sessão, que é a única forma que um
  // `<img>` tem de se autenticar.
  if (typeof URL.createObjectURL === 'function') {
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    const origRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
      if (obj instanceof LazyFile) return arquivos.urlFor(obj._path);
      return origCreateObjectURL(obj);
    };
    URL.revokeObjectURL = function (url) {
      if (typeof url === 'string' && !url.startsWith('blob:')) return undefined;
      return origRevokeObjectURL(url);
    };
  }

  // ── Os caminhos que leem o File por dentro ────────────────────────────────────────────────
  //
  // Onde cabe um `await`, dá para consertar: `Response`, `Request` e `fetch` aceitam corpo
  // assíncrono, e o `FileReader` é assíncrono por natureza. `new Blob([f])` e `FormData.append`
  // leem na hora, e só podem ficar barulhentos. Todo envelope é passa-adiante para o que não for
  // nosso.
  function avisar(onde) {
    console.warn(`[vssh] ${onde} lê os bytes de forma síncrona e este File ainda não foi carregado; `
      + 'o resultado sai vazio. Faça `await file.arrayBuffer()` (ou `.text()`) antes, ou use '
      + '`new Blob([await file.arrayBuffer()])`.');
  }

  // Trocar o corpo por `f.stream()` mantém a preguiça. `duplex: 'half'` é exigência do Chrome
  // para corpo em stream num `Request`.
  function enveloparCorpo(Classe, ehRequest) {
    if (typeof Classe !== 'function') return Classe;
    return new Proxy(Classe, {
      construct(alvo, args, novoAlvo) {
        const corpo = ehRequest ? args[1] && args[1].body : args[0];
        if (corpo instanceof LazyFile) {
          if (ehRequest) args[1] = Object.assign({}, args[1], { body: corpo.stream(), duplex: 'half' });
          else args[0] = corpo.stream();
        }
        return Reflect.construct(alvo, args, novoAlvo);
      },
    });
  }
  if (typeof Response === 'function') window.Response = enveloparCorpo(Response, false);
  if (typeof Request === 'function') window.Request = enveloparCorpo(Request, true);

  // O `fetch` interno do navegador não usa o `window.Request` envelopado, então sem isto um
  // `fetch(url, { body: f })` subiria vazio mesmo com o `Request` acima.
  if (typeof fetch === 'function') {
    const origFetch = fetch.bind(window);
    window.fetch = async function (entrada, init) {
      if (init && init.body instanceof LazyFile) {
        const f = init.body;
        init = Object.assign({}, init, { body: new Blob([await f.bytes()], { type: f.type }) });
      }
      return origFetch(entrada, init);
    };
  }

  // O `FileReader` carrega e despacha os mesmos eventos que o nativo, na mesma ordem.
  if (typeof FileReader === 'function') {
    const LEITURAS = {
      readAsText: (b, ab, enc) => new TextDecoder(enc || 'utf-8').decode(ab),
      readAsArrayBuffer: (b, ab) => ab,
      readAsBinaryString: (b, ab) => Array.from(new Uint8Array(ab), (c) => String.fromCharCode(c)).join(''),
      readAsDataURL: (b, ab) => {
        let s = '';
        for (const c of new Uint8Array(ab)) s += String.fromCharCode(c);
        return `data:${b.type || 'application/octet-stream'};base64,${btoa(s)}`;
      },
    };
    for (const [metodo, converter] of Object.entries(LEITURAS)) {
      const orig = FileReader.prototype[metodo];
      if (typeof orig !== 'function') continue;
      FileReader.prototype[metodo] = function (blob, extra) {
        if (!(blob instanceof LazyFile)) return orig.call(this, blob, extra);
        const leitor = this;
        // `readyState` e `result` são getters do protótipo nativo; definir na instância é o que
        // deixa o app ler `fr.result` de dentro do `onload`.
        const definir = (chave, valor) => Object.defineProperty(leitor, chave, { value: valor, configurable: true });
        definir('readyState', 1);
        leitor.dispatchEvent(new ProgressEvent('loadstart'));
        blob.arrayBuffer().then(
          (ab) => {
            definir('result', converter(blob, ab, extra));
            definir('readyState', 2);
            leitor.dispatchEvent(new ProgressEvent('load'));
            leitor.dispatchEvent(new ProgressEvent('loadend'));
          },
          (e) => {
            definir('error', e);
            definir('readyState', 2);
            leitor.dispatchEvent(new ProgressEvent('error'));
            leitor.dispatchEvent(new ProgressEvent('loadend'));
          });
      };
    }
  }

  // Os dois sem conserto: quando o conteúdo já foi lido, um `Blob` real toma o lugar do
  // preguiçoso e tudo funciona; quando não foi, resta dizer em voz alta.
  const BlobOriginal = Blob;
  window.Blob = new Proxy(BlobOriginal, {
    construct(alvo, args, novoAlvo) {
      const partes = args[0];
      if (Array.isArray(partes) && partes.some((p) => p instanceof LazyFile)) {
        args = args.slice();
        args[0] = partes.map((p) => {
          if (!(p instanceof LazyFile)) return p;
          if (p._bytes) return p._bytes;
          avisar('new Blob([file])');
          return p;
        });
      }
      return Reflect.construct(alvo, args, novoAlvo);
    },
  });

  if (typeof FormData === 'function') {
    for (const metodo of ['append', 'set']) {
      const orig = FormData.prototype[metodo];
      if (typeof orig !== 'function') continue;
      FormData.prototype[metodo] = function (nome, valor, nomeDoArquivo) {
        if (valor instanceof LazyFile) {
          if (valor._bytes) {
            valor = new File([valor._bytes], nomeDoArquivo || valor.name, { type: valor.type, lastModified: valor.lastModified });
          } else {
            avisar(`FormData.${metodo}()`);
          }
        }
        return nomeDoArquivo === undefined ? orig.call(this, nome, valor) : orig.call(this, nome, valor, nomeDoArquivo);
      };
    }
  }

  // ── OPFS: privado por origem, e não por app ───────────────────────────────────────────────
  //
  // `navigator.storage.getDirectory()` é nativo e funciona: é o que DuckDB-WASM, sqlite-wasm e
  // Pyodide usam para cache local. O problema é que todos os vssh-apps do portal são servidos
  // pela mesma origem, e o "private" do nome é de outros sites, e não de outros apps: o banco de
  // um app e o cache de pacotes de outro dividiriam a mesma raiz. Cada app ganha um subdiretório
  // com o id dele, e o handle devolvido continua nativo. Fora do proxy (uma página solta, um
  // teste) não há outro app com quem colidir, e a raiz fica como está.
  //
  // O que sai junto: OPFS é cache, e nunca a verdade. O padrão do `sqlite-wasm` de usá-lo como
  // armazenamento primário perde tudo ao trocar de máquina, sem erro nenhum.
  function idDoApp() {
    const seg = location.pathname.split('/').filter(Boolean);
    const i = seg.indexOf('app');
    return (i > 0 && seg[i - 1] === 'proxy' && seg[i + 1]) ? seg[i + 1] : null;
  }

  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
    const appId = idDoApp();
    if (appId) {
      const raizReal = navigator.storage.getDirectory.bind(navigator.storage);
      navigator.storage.getDirectory = async function () {
        const raiz = await raizReal();
        return raiz.getDirectoryHandle(`vssh-app-${appId}`, { create: true });
      };
    }
  }

  // ── Persistência em IndexedDB ─────────────────────────────────────────────────────────────
  //
  // `__vsshHandle` é dado simples e sobrevive ao clone; aqui só se reconstrói a classe na
  // leitura, para o app receber de volta algo que responde às mesmas chamadas. `get` e `getAll`
  // sobre `IDBObjectStore` e `IDBIndex`: um app que guardasse handle num índice leria de volta um
  // objeto morto. `getAllKeys` fica de fora: chave é chave.
  if (typeof IDBRequest === 'function') {
    const rawResult = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result').get;

    function hookRequest(proto, method) {
      const orig = proto && proto[method];
      if (typeof orig !== 'function') return;
      proto[method] = function (...args) {
        const req = orig.apply(this, args);
        let cached;
        Object.defineProperty(req, 'result', {
          configurable: true,
          get() {
            if (cached === undefined) cached = rehydrate(rawResult.call(this));
            return cached;
          },
        });
        return req;
      };
    }

    // Num cursor o `result` da requisição é o cursor, e o `value` dele muda a cada `continue()`:
    // o getter vai na instância do cursor e não pode cachear.
    const cursorValue = typeof IDBCursorWithValue !== 'undefined'
      ? (Object.getOwnPropertyDescriptor(IDBCursorWithValue.prototype, 'value') || {}).get
      : null;

    function hookCursor(proto, method) {
      const orig = proto && proto[method];
      if (typeof orig !== 'function' || !cursorValue) return;
      proto[method] = function (...args) {
        const req = orig.apply(this, args);
        Object.defineProperty(req, 'result', {
          configurable: true,
          get() {
            const cursor = rawResult.call(this);
            if (!cursor || cursor.__vsshValueHooked) return cursor;
            cursor.__vsshValueHooked = true;
            Object.defineProperty(cursor, 'value', {
              configurable: true,
              get() { return rehydrate(cursorValue.call(this)); },
            });
            return cursor;
          },
        });
        return req;
      };
    }

    for (const proto of [
      typeof IDBObjectStore !== 'undefined' ? IDBObjectStore.prototype : null,
      typeof IDBIndex !== 'undefined' ? IDBIndex.prototype : null,
    ]) {
      if (!proto) continue;
      hookRequest(proto, 'get');
      hookRequest(proto, 'getAll');
      hookCursor(proto, 'openCursor');
    }
  }
})();
