// Os typings do SDK web de um vssh-app (`_sdk/vssh.js`), gerados da tabela da ponte
// (`api/abi.json`) pelo canal de publicação do sistema. Uma mudança se faz na fonte,
// `vssh-client/js/app/abi.js` do `vssh-sso`.
//
// Este arquivo declara globais, sem `import` nem `export`: o SDK entra por `<script>` e escreve
// `window.vssh`. Basta ele estar no `include` do `tsconfig.json` do app, ou numa diretiva
// `/// <reference path="caminho/para/vssh.d.ts" />`, para `vssh.` completar no editor.
//
// Um verbo que responde é uma promessa; a tabela não declara o tipo da resposta, e ela chega
// como `unknown`. Um verbo que não responde é um disparo, `void`. `ao` aceita só os eventos
// que o espaço declara, e entrega ao `cb` o objeto com os campos de cada um.

declare namespace vssh {
  /**
   * Quem o app é e em que ambiente ele está: as capacidades do shell, os verbos disponíveis, o
   * título que a janela mostra e a rota que a sessão restaura.
   */
  namespace app {
    /**
     * O ambiente em que o app está: o nome do host, o que ele sabe fazer, a versão do shell e a
     * lista de verbos e eventos desta tabela. Com a lista, o app decide sozinho se o shell em que
     * caiu tem o que ele precisa.
     */
    function capacidades(): Promise<unknown>;
    /**
     * O título que a janela mostra na barra de título, na barra de tarefas e no Alt+Tab. O app o
     * reporta sempre que o dele muda; o shell corta em 200 caracteres.
     */
    function titulo(titulo: string): void;
    /**
     * Onde o app está, para a sessão o reabrir no mesmo lugar: um caminho dentro do app, que o
     * ambiente cola na URL quando restaura a janela. Uma rota que sai do app (um esquema, um
     * caminho absoluto, um `..`) é recusada no console, sem resposta.
     */
    function lembrarRota(rota: string): void;

    /** Os eventos deste espaço, e o que cada um entrega ao `cb` de `ao`. */
    interface Eventos {
      /**
       * O contexto com que o app foi aberto ("abrir aqui", "abrir com", um item da jump list).
       * Chega depois do load, e de novo quando uma ação alcança uma janela que já está aberta.
       */
      abertura: { caminho?: string; url?: string; tipo?: 'arquivo' | 'pasta' | 'url'; rota?: string };
    }
    /** Assina um evento deste espaço e devolve a função que cancela a assinatura. */
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /**
   * A janela do app: controlada em runtime pelo app que a ocupa, e declarada no manifesto para quem
   * a abre.
   */
  namespace janela {
    /**
     * Outra janela deste app, e a rota decide o que vai dentro dela: sem rota, uma cópia da mesma
     * página; com rota (`?painel=notas`), um painel ou um segundo documento. O backend continua
     * sendo um só, e a janela nova leva o título e o ícone do app. O shell recusa uma rota que sai
     * do app (um esquema, um caminho absoluto, um `..`) e responde `false`.
     */
    function abrir(rota?: string, titulo?: string, largura?: number, altura?: number): Promise<unknown>;
    /** Recolhe a janela para a barra de tarefas. Uma janela já minimizada fica como está. */
    function minimizar(): void;
    /** Ocupa a área de trabalho inteira. Uma janela já maximizada fica como está. */
    function maximizar(): void;
    /**
     * Devolve a janela ao tamanho normal: tira da barra de tarefas a que está minimizada, e
     * desmaximiza a que está maximizada.
     */
    function restaurar(): void;
    /** Traz a janela para a frente das outras e lhe dá o foco. */
    function focar(): void;
    /**
     * Fecha a janela pelo mesmo caminho do botão de fechar. Quando ela é a última do app, o backend
     * segue o que `backend.aoFechar` declara no manifesto.
     */
    function fechar(): void;
    /**
     * Começa a arrastar a janela a partir de um ponto do documento do app, para quem declarou
     * `cabecalho: "app"` e desenha a própria barra de título. `x` e `y` dizem onde no quadro do app
     * a pessoa o agarrou (`clientX`, `clientY`); `telaX` e `telaY` fixam a referência de tela para
     * o resto do gesto (`screenX`, `screenY`). O app captura o ponteiro e conta o gesto inteiro:
     * este começo, cada ponto por `arrastarPara`, e o fim por `terminarArraste`. Uma janela
     * maximizada ignora o pedido, como ignora o cabeçalho padrão.
     */
    function arrastar(x: number, y: number, telaX: number, telaY: number): void;
    /**
     * Um ponto do arraste em curso, em coordenada de tela (`screenX`, `screenY`). A coordenada é de
     * tela porque o quadro do app se move junto com a janela, e um ponto relativo a ele dependeria
     * do que o gesto acabou de mudar. Sem arraste começado, o shell ignora.
     */
    function arrastarPara(telaX: number, telaY: number): void;
    /**
     * O fim do arraste, no `pointerup` ou `pointercancel` do app. Sem ele a janela continua
     * seguindo o ponteiro depois que a pessoa solta o botão.
     */
    function terminarArraste(): void;
    /**
     * O duplo-clique da barra de título de quem tem `cabecalho: "app"`: maximiza a janela normal e
     * restaura a maximizada.
     */
    function alternarMaximizado(): void;
    /**
     * O menu de contexto do cabeçalho (mover, maximizar, fechar, o log do backend), aberto no ponto
     * `x`, `y` do quadro do app. O shell traduz o ponto para a tela dele.
     */
    function menuDoCabecalho(x: number, y: number): void;
    /**
     * A lista de abas de um app com `richChrome`, que o shell desenha na barra de título. O app a
     * manda inteira a cada mudança; o shell responde aos cliques pelos eventos `ativarAba`,
     * `fecharAba` e `novaAba`. Só texto atravessa: o shell monta cada aba com o `title` que
     * recebeu. Uma aba com `sessionName` volta na sessão seguinte pelo evento `restaurarAbas`. Sem
     * `richChrome` no manifesto, o shell ignora a lista.
     */
    function abas(abas: { id: string; title?: string; sessionName?: string }[], abaAtiva?: string | null): void;

    /** Os eventos deste espaço, e o que cada um entrega ao `cb` de `ao`. */
    interface Eventos {
      /**
       * As abas que a sessão anterior deixou salvas, mandadas uma vez, no load do iframe de um app
       * com `richChrome`. Chega mesmo sem nada salvo (`abas: null`), para o app nunca decidir
       * sozinho se cria uma aba inicial.
       */
      restaurarAbas: { abas: { sessionName: string }[] | null; sessaoAtiva: string | null };
      /** A pessoa clicou numa aba da barra de título. */
      ativarAba: { abaId: string };
      /** A pessoa clicou no fechar de uma aba, ou em "Fechar aba" no menu do cabeçalho. */
      fecharAba: { abaId: string };
      /** A pessoa clicou no `+` da barra de abas, ou em "Nova aba" no menu do cabeçalho. */
      novaAba: Record<string, never>;
    }
    /** Assina um evento deste espaço e devolve a função que cancela a assinatura. */
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /**
   * Ler e escrever com o consentimento do usuário, escolher, vigiar, abrir, abrir com, arrastar, e
   * a área de transferência de arquivos.
   */
  namespace arquivos {
    /** As entradas de uma pasta concedida: `{ path, items }`, com nome, tipo e tamanho de cada item. */
    function listar(caminho: string): Promise<unknown>;
    /**
     * O que um caminho é: tamanho, data de modificação, `isFile`, `isDirectory` e o tipo MIME. Um
     * caminho que não existe responde 404, e o app que sonda antes de criar lê isso como resposta.
     */
    function consultar(caminho: string): Promise<unknown>;
    /** O conteúdo de um arquivo, como texto. */
    function ler(caminho: string): Promise<unknown>;
    /**
     * O conteúdo de um arquivo, em bytes. No fio ele viaja em base64, porque um `ArrayBuffer` não
     * atravessa o `postMessage` entre os dois documentos sem cópia; o SDK o devolve como
     * `Uint8Array`.
     */
    function lerBytes(caminho: string): Promise<Uint8Array>;
    /** Grava texto num arquivo, criando ou substituindo. */
    function escrever(caminho: string, conteudo: string): Promise<unknown>;
    /**
     * Grava bytes num arquivo, criando ou substituindo. É a rota de um binário: um PNG passado por
     * `escrever` sairia corrompido sem aviso, porque aquela rota é de texto. O SDK codifica os
     * bytes em base64 para o fio; uma string já é base64 e passa como veio.
     */
    function escreverBytes(caminho: string, bytes: Uint8Array | ArrayBuffer | string): Promise<unknown>;
    /** Cria uma pasta. */
    function criarPasta(caminho: string): Promise<unknown>;
    /**
     * Apaga de vez um arquivo ou uma pasta com o conteúdo dela. A lixeira fica de fora; quem quer o
     * caminho com desfazer usa o gerenciador de arquivos.
     */
    function apagar(caminho: string): Promise<unknown>;
    /**
     * Se um caminho existe: `{ exists }`. Só o 404 do servidor vira `false`; permissão negada e
     * servidor fora lançam, porque "não pude perguntar" e "não existe" pedem do app ações opostas.
     */
    function existe(caminho: string): Promise<unknown>;
    /**
     * Renomeia, e é também o mover, como o `mv`. Origem e destino precisam estar concedidos. Um
     * destino que já existe falha; `overwrite` substitui, e precisa ser dito, porque perder um
     * arquivo em silêncio não tem desfazer.
     */
    function renomear(origem: string, destino: string, politica?: 'fail' | 'overwrite'): Promise<unknown>;
    /**
     * Copia. Origem e destino precisam estar concedidos, e um destino que já existe segue a
     * política de `renomear`.
     */
    function copiar(origem: string, destino: string, politica?: 'fail' | 'overwrite'): Promise<unknown>;
    /**
     * Assina as mudanças sob um caminho, venham de onde vierem: outro editor, um upload pelo
     * gerenciador de arquivos. A resposta confirma a assinatura; cada mudança chega depois pelo
     * evento `arquivoMudou`, com o `vigia` que o app escolheu. Quem segura a conexão com o servidor
     * é o shell, e ela morre com a janela.
     */
    function vigiar(caminho: string, vigia: string): Promise<unknown>;
    /**
     * Encerra uma assinatura de `vigiar`. Cada assinatura segura um vigia vivo no servidor do
     * usuário, com teto por usuário, e encerrar a que deixou de servir é o que mantém as outras
     * cabendo.
     */
    function pararDeVigiar(vigia: string): Promise<unknown>;
    /**
     * Abre o seletor de arquivo do sistema e responde com o caminho escolhido, ou `null` se o
     * usuário cancelou. O `filtro` é uma lista de grupos no estilo do Qt:
     * `Imagens (*.png *.jpg);;Tudo (*)`. Escolher é consentir: o caminho passa a estar concedido a
     * este app, e a concessão sobrevive à janela e à sessão.
     */
    function escolherArquivo(titulo?: string, filtro?: string, pasta?: string, nome?: string): Promise<unknown>;
    /**
     * Abre o seletor de "salvar como", com `nome` sugerido, e responde com o caminho onde gravar,
     * ou `null` se o usuário cancelou. O caminho escolhido fica concedido a este app.
     */
    function escolherDestino(titulo?: string, filtro?: string, pasta?: string, nome?: string): Promise<unknown>;
    /**
     * Abre o seletor de pasta e responde com o caminho escolhido, ou `null` se o usuário cancelou.
     * A pasta inteira fica concedida a este app, e é assim que um app trabalha numa árvore sem
     * pedir arquivo a arquivo.
     */
    function escolherPasta(titulo?: string, pasta?: string): Promise<unknown>;
    /**
     * Com `caminho`, se este app pode tocá-lo: `true` ou `false`. Sem, a lista dos caminhos
     * concedidos a ele, com que o app refaz um handle sem abrir seletor. Quem decide é o shell; o
     * espelho que o SDK mantém serve só ao que precisa responder sem esperar.
     */
    function permissoes(caminho?: string): Promise<unknown>;
    /**
     * O que está na área de transferência de arquivos do ambiente: `{ action, paths }`, ou `null`.
     * É a área do gerenciador de arquivos, que nenhuma API do navegador alcança; texto e imagem vão
     * por `navigator.clipboard`, direto no app.
     */
    function areaDeTransferencia(): Promise<unknown>;
    /**
     * Põe caminhos na área de transferência de arquivos, como se o usuário os tivesse copiado no
     * gerenciador, e responde com quantos entraram. Sempre copiar: recortar moveria um arquivo do
     * usuário na próxima colagem a partir de uma mensagem de iframe, e fica com o gerenciador, onde
     * a pessoa vê o que faz.
     */
    function copiarParaAreaDeTransferencia(caminhos: string[]): Promise<unknown>;
    /**
     * Abre um arquivo no visualizador do ambiente que a extensão pede: PDF, vídeo, editor de texto,
     * planilha. O app manda o caminho e não precisa saber em que servidor está.
     */
    function abrir(caminho: string): void;
    /** Abre uma pasta no gerenciador de arquivos. */
    function abrirPasta(caminho: string): void;
    /**
     * Mostra ao usuário os aplicativos que abrem o arquivo, a mesma lista do menu de contexto do
     * gerenciador, e abre no escolhido. Responde com o nome do aplicativo, ou `null` se o usuário
     * cancelou. Sem X11 a lista tem só vssh-apps.
     */
    function abrirCom(caminho: string): Promise<unknown>;
    /**
     * Abre um link no navegador do ambiente, que resolve a rede a partir do servidor Linux: um
     * `http://localhost:3000` chega ao loopback do servidor, e numa aba de fora chegaria à máquina
     * de quem lê. Só `http` e `https`. Um link cujo host outro app declarou em `opens.urls` vai
     * para esse app; `destino: 'navegador'` pede o navegador mesmo assim.
     */
    function abrirLink(url: string, destino?: 'navegador'): Promise<unknown>;
    /**
     * Avisa que um arraste de arquivos começou dentro do app, com os caminhos absolutos que ele
     * carrega. É o que acende os alvos de soltura do ambiente (a área de trabalho, o gerenciador, a
     * lixeira), que leem um estado do documento do shell que um gesto nascido no iframe não
     * escreve. O SDK o manda de dentro do `dragstart`.
     */
    function arrastar(caminhos: string[]): void;
    /**
     * Avisa que o arraste acabou, e apaga o estado. O `dragend` não atravessa documentos, então sem
     * este aviso os alvos do ambiente ficariam acesos para um gesto que já terminou. O SDK o manda
     * sozinho, no `dragend` do app.
     */
    function terminarArraste(): void;

    /** Os eventos deste espaço, e o que cada um entrega ao `cb` de `ao`. */
    interface Eventos {
      /**
       * A lista completa do que este app pode tocar. Chega no load da janela e a cada mudança (uma
       * escolha num seletor, uma revogação no menu da janela), e substitui a anterior: o shell é a
       * fonte, e uma revogação lá apaga aqui.
       */
      permissoesMudaram: { caminhos: string[] };
      /**
       * Algo mudou sob um caminho vigiado. `encerrado` é o shell dizendo que a assinatura acabou de
       * vez, porque a conexão com o servidor desistiu de reconectar; avisar é melhor que seguir
       * calado fingindo que vigia.
       */
      arquivoMudou: { vigia: string; caminho: string | null; encerrado?: boolean };
      /**
       * A área de transferência de arquivos mudou, por qualquer janela: o usuário copiou no
       * gerenciador e voltou para o app. Sem o evento, o app só descobriria perguntando em laço.
       */
      areaDeTransferenciaMudou: { conteudo: { action: unknown; paths: unknown } | null };
    }
    /** Assina um evento deste espaço e devolve a função que cancela a assinatura. */
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /** Notificação, aviso efêmero, atividade em curso e bandeja, para um app com janela aberta. */
  namespace avisos {
    /**
     * Um fato que aconteceu, gravado no histórico do sino e anunciado num aviso: um caminho, um
     * erro que a pessoa vai querer reencontrar. `nivel` é o tom (cor e ícone); `prioridade` é
     * quanto interromper: `baixa` só marca o sino, `normal` mostra o aviso por alguns segundos,
     * `alta` o deixa na tela até a pessoa responder. Um app não abre modal, e `critica` vira
     * `alta`. A mesma `chave` substitui a notificação anterior no lugar de empilhar. O clique numa
     * das `acoes` volta pelo evento `acaoDeNotificacao`. A resposta é o id da notificação.
     */
    function notificar(mensagem: string, titulo?: string, nivel?: 'info' | 'success' | 'warning' | 'error', prioridade?: 'baixa' | 'normal' | 'alta', chave?: string, acoes?: { id: string; label: string }[]): Promise<unknown>;
    /**
     * A frase que se lê e se esquece ("copiado", "salvo"): some sozinha depois de `duracao`
     * milissegundos (4000 por padrão) e não entra no histórico. A mesma `chave` reescreve o aviso
     * que está na tela e recomeça o relógio dele.
     */
    function avisar(mensagem: string, titulo?: string, nivel?: 'info' | 'success' | 'warning' | 'error', duracao?: number, chave?: string): Promise<unknown>;
    /**
     * Uma condição que é verdade agora, na bandeja e no painel de atividades: um progresso, algo
     * tocando. `item` leva `titulo`, `texto`, `formato` (`simples`, `progresso` ou `midia`),
     * `progresso` (`{ feito, total }` ou `{ indeterminado: true }`) e `acoes`; a mesma `chave`
     * atualiza no lugar, então relatar progresso não empilha linhas. O clique numa ação volta pelo
     * evento `acaoDeAtividade`. A resposta é a chave completa, `app:<id>:<chave>`, que é a que o
     * ambiente usa. Sem `item`, o mesmo fio encerra a atividade, como `encerrarAtividade`.
     */
    function atividade(chave: string, item: object): Promise<unknown>;
    /**
     * Encerra uma atividade. Sem `registrar` ela some sem deixar rastro, que é o certo para uma
     * indisponibilidade resolvida; com `registrar` (`titulo`, `texto`, `level`) o fim vira uma
     * notificação no histórico, como "550 arquivos copiados". A resposta é a chave completa.
     */
    function encerrarAtividade(chave: string, registrar?: object): Promise<unknown>;
    /**
     * O ícone do app ao lado do relógio. `item` leva `icon` (nome de ícone do ambiente ou caminho
     * dentro do pacote), `tooltip`, `badge` (`{ count }`, `{ dot: true }` ou `{ text }`) e `menu`
     * (itens com `id` e `label`). É um item por app, e chamar de novo troca o conteúdo sem o ícone
     * mudar de lugar. O clique e a escolha no menu voltam pelo evento `acaoNaBandeja`. A resposta é
     * `true`.
     */
    function bandeja(item: object): Promise<unknown>;
    /** Tira o ícone do app da bandeja. A resposta diz se havia um. */
    function tirarDaBandeja(): Promise<unknown>;

    /** Os eventos deste espaço, e o que cada um entrega ao `cb` de `ao`. */
    interface Eventos {
      /**
       * A pessoa clicou numa ação de uma notificação deste app. Chega à janela do app que teve foco
       * por último, e a ela só.
       */
      acaoDeNotificacao: { notificacaoId: string; acaoId: string };
      /**
       * A pessoa clicou numa ação de uma atividade declarada por esta janela. `chave` é a que o app
       * escolheu, sem o prefixo do ambiente.
       */
      acaoDeAtividade: { chave: string; acaoId: string };
      /**
       * A pessoa clicou no ícone da bandeja (`click`) ou escolheu um item do menu dele (`menu`, com
       * o `menuId` do item). O shell não interpreta o id; quem sabe o que ele significa é o app.
       */
      acaoNaBandeja: { evento: 'click' | 'menu'; menuId?: string };
    }
    /** Assina um evento deste espaço e devolve a função que cancela a assinatura. */
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /**
   * Os diálogos do sistema e o menu de contexto, desenhados pelo shell com os dados que o app
   * manda.
   */
  namespace dialogos {
    /** Uma caixa de informação com um botão OK. A resposta chega quando a pessoa fecha a caixa. */
    function mostrar(mensagem: string, titulo?: string): Promise<unknown>;
    /** A mesma caixa de `mostrar`, com o tom de erro. */
    function erro(mensagem: string, titulo?: string): Promise<unknown>;
    /**
     * Uma pergunta com "Sim" e "Não". A resposta é `true` só quando a pessoa disse sim; fechar a
     * caixa vale como não.
     */
    function confirmar(mensagem: string, titulo?: string): Promise<unknown>;
    /**
     * Um campo de texto de uma linha. A resposta é o que a pessoa escreveu, ou `null` quando ela
     * cancelou.
     */
    function perguntar(mensagem: string, valor?: string, titulo?: string): Promise<unknown>;
    /**
     * Um campo de senha, com o texto escondido. A resposta é o valor digitado, ou `null` quando a
     * pessoa cancelou. O valor chega ao app; para uma credencial que o app não deve ver, o caminho
     * é `segredos.pedir`.
     */
    function senha(mensagem: string, titulo?: string): Promise<unknown>;
    /**
     * O menu de contexto do ambiente, montado com os itens que o app descreve: `label`, `icon`,
     * `id`, `danger`, `checked`, `disabled`, `separator`, `header` e um nível de `submenu`. `x` e
     * `y` são do viewport do app, e o shell soma a posição da janela. A resposta é o `id` do item
     * escolhido (o `label`, quando o item não tem id), e `null` quando a pessoa fechou sem
     * escolher.
     */
    function menuDeContexto(x: number, y: number, itens: object[]): Promise<unknown>;

    /** Este espaço não declara eventos: `ao` não aceita nome nenhum. */
    interface Eventos {}
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /**
   * O cofre: o app pede uma credencial pelo nome, o shell mostra o campo e grava, e o valor nunca
   * passa pelo app. A pessoa confere, troca e apaga o que guardou no Chaveiro, a janela do ambiente
   * que lista as credenciais de todo app.
   */
  namespace segredos {
    /** Os nomes guardados para este app, em `names`. Só os nomes: o cofre não devolve valor. */
    function listar(): Promise<unknown>;
    /**
     * Pede à pessoa uma credencial pelo nome (maiúsculas, dígitos e sublinhado, até 64 caracteres).
     * O shell mostra um campo de senha com a `descricao`, grava no servidor e responde
     * `{ names, requerReinicio: true }`; o valor não passa pelo app. O ambiente de um processo é
     * fixado no start, e `requerReinicio` é o app saber que precisa reiniciar para enxergar o
     * segredo. Cancelar responde `{ names: null, cancelado: true }`.
     */
    function pedir(nome: string, titulo?: string, descricao?: string): Promise<unknown>;
    /**
     * Apaga uma credencial pelo nome. A resposta é `{ names, requerReinicio: true }`, com a lista
     * que sobrou.
     */
    function apagar(nome: string): Promise<unknown>;

    /** Este espaço não declara eventos: `ao` não aceita nome nenhum. */
    interface Eventos {}
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /**
   * A seção que o app traz a Configurações do ambiente (`contributes.settings`). Um app que a
   * declara opcional (`contributes.settingsOptIn`) a liga e desliga daqui, de dentro dele; a
   * escolha é por usuário e acompanha a pessoa.
   */
  namespace configuracoes {
    /**
     * Se a seção deste app aparece em Configurações, em `ligada`, e se ela é opcional, em
     * `opcional`. Um app sem `settingsOptIn` lê `ligada: true` sempre.
     */
    function ligada(): Promise<unknown>;
    /**
     * Liga (`true`) ou desliga (`false`) a seção deste app em Configurações, e responde o mesmo que
     * `ligada`. Só faz efeito num app com `settingsOptIn`; nos outros a seção existe sempre, e a
     * resposta diz isso.
     */
    function ligar(ligado: boolean): Promise<unknown>;
    /**
     * Abre Configurações na seção deste app. Com a seção desligada, ou antes de ela ter sido
     * carregada, abre Configurações no índice; a resposta traz em `secao` o id da seção aberta, ou
     * `null`.
     */
    function abrir(): Promise<unknown>;

    /** Este espaço não declara eventos: `ao` não aceita nome nenhum. */
    interface Eventos {}
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /**
   * O que o app está tocando, o transporte que ele sabe fazer e o volume que o usuário deixou para
   * ele.
   */
  namespace midia {
    /**
     * O app dizendo que tem áudio, e se está tocando. É o que o põe na lista do mixer de volume: um
     * app que toca por Web Audio não tem elemento que o shell encontre na varredura. O SDK relata
     * sozinho a mídia e o Web Audio que ele vê; um app só chama isto por conta própria quando
     * produz som por um caminho que o SDK não alcança.
     */
    function audio(temAudio: boolean, tocando: boolean): void;
    /**
     * O que este app sabe fazer de transporte além de tocar, pausar e buscar, que o shell já faz
     * sozinho: anterior e próximo dependem de uma fila, e a fila é do app. A central de mídia
     * desenha só os botões declarados, e o clique volta pelo evento `acao`.
     */
    function transporte(anterior: boolean, proximo: boolean): void;
    /**
     * O que está tocando, para a central de mídia. Sem isto o shell tira o nome da URL da fonte, e
     * uma mídia montada por MSE tem um `blob:` sem nome. `capa` é uma URL de imagem relativa ao
     * app, e só vale dentro dele. Sem título e sem capa, a decisão volta ao ambiente.
     */
    function agora(titulo: string, subtitulo?: string, capa?: string): void;

    /** Os eventos deste espaço, e o que cada um entrega ao `cb` de `ao`. */
    interface Eventos {
      /**
       * O volume que o mixer do ambiente aplica a este app, de 0 a 1, com o mudo à parte. Chega no
       * load da janela e a cada mexida no mixer. O SDK já o aplica à mídia e ao GainNode do app; um
       * app só lê isto para desenhar o próprio controle.
       */
      volume: { ganho: number; mudo: boolean };
      /** A central de mídia pedindo a faixa anterior ou a próxima ao app que declarou o transporte. */
      acao: { acao: 'anterior' | 'proximo' };
    }
    /** Assina um evento deste espaço e devolve a função que cancela a assinatura. */
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /** Imprimir pela tela do sistema: o app pede, e quem escolhe a impressora e confirma é o usuário. */
  namespace impressao {
    /**
     * Abre a tela de impressão do ambiente para um arquivo do servidor, por caminho absoluto. Quem
     * escolhe a impressora e confirma é a pessoa, com o `nome` do arquivo na tela (o do caminho,
     * por padrão). A resposta é `true` assim que a tela abre, sem esperar a impressão.
     */
    function imprimir(caminho: string, nome?: string): Promise<unknown>;

    /** Este espaço não declara eventos: `ao` não aceita nome nenhum. */
    interface Eventos {}
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

  /**
   * O recurso que o sistema arbitra ao subir o app. O manifesto declara o que o app precisa em
   * `recursos.gpu.modo`; quem decide, com o que o servidor tem, é o `vssh-app-run`, e o app
   * pergunta o que recebeu sem conhecer `CUDA_VISIBLE_DEVICES` nem o inventário do servidor.
   */
  namespace gpu {
    /**
     * O que o sistema concedeu de GPU a este app, na forma que o backend lê em
     * `vssh.gpu.concedida()`: `{ concedida, dispositivos, motivo }`. `dispositivos` são os que o
     * processo do app abre, cada um com `fabricante`, `driver`, `virtual`, `video` (o caminho de
     * codificação: `nvenc`, `vaapi` ou `null`) e `renderNode`; a lista fica vazia quando nada foi
     * concedido. `motivo` é a frase do lançador quando a resposta é não
     * (`não declarada no manifesto`, `sem GPU utilizável: ...`,
     * `não consegui consultar este servidor`), e `null` quando é sim. A janela e o backend leem o
     * mesmo registro, e o gerenciador de tarefas mostra a mesma frase.
     */
    function estado(): Promise<unknown>;

    /** Este espaço não declara eventos: `ao` não aceita nome nenhum. */
    interface Eventos {}
    function ao<E extends keyof Eventos>(evento: E, cb: (dados: Eventos[E]) => void): () => void;
  }

}

// ─── O que o runtime acrescenta, e a tabela não descreve ─────────────────────
//
// Escrito à mão no gerador, a partir de `vssh-client/sdk/runtime.js` e `sdk/fsa.js`.

declare namespace vssh {
  /**
   * `true` dentro do ambiente (o app num iframe do shell). Numa aba solta, durante o
   * desenvolvimento, cada verbo degrada para o equivalente do navegador, para um valor vazio ou
   * para uma recusa, sem lançar na carga.
   */
  const noAmbiente: boolean;

  namespace arquivos {
    /** O tipo MIME do arraste de arquivos do ambiente: caminhos absolutos, um por linha. */
    const MIME: string;
    /** Os caminhos que este app já pode tocar, do espelho local, sem ida ao shell. */
    function concedidos(): string[];
    /**
     * A URL HTTP do conteúdo de um arquivo, para `<img src>`, `<video>`, `<embed>` ou `fetch`.
     * Síncrona, porque substitui `URL.createObjectURL(file)`. Fora do que foi concedido a URL sai
     * do mesmo jeito, com um aviso no console; quem recusa é o servidor.
     */
    function urlFor(caminho: string): string;
    /**
     * Acompanha as mudanças sob um caminho e devolve a função que para. Parar importa: cada
     * assinatura segura um vigia no servidor do usuário, com teto por usuário.
     */
    function acompanhar(
      caminho: string,
      aoMudar: (mudanca: { caminho: string | null; encerrado: boolean }) => void,
    ): Promise<() => void>;
    /**
     * A imagem da área de transferência do sistema como `Blob`, ou `null`. Lança com `reason`
     * (`no-user-activation`, `denied`, `empty`, `unsupported`, `failed`).
     */
    function imagemCopiada(): Promise<Blob | null>;
    /** Põe uma imagem na área de transferência do sistema. Lança com os mesmos `reason`. */
    function copiarImagem(blob: Blob): Promise<boolean>;
    /**
     * Chama `cb` quando arquivos do ambiente são soltos no app, e devolve a função que desliga.
     * O `dragover` já sai cancelado; sem isso o `drop` nunca acontece.
     */
    function aoSoltarArquivos(
      cb: (soltura: { caminhos: string[]; x: number; y: number; alvo: EventTarget | null }) => void,
      opcoes?: { alvo?: EventTarget },
    ): () => void;
    /**
     * Põe caminhos do usuário num arraste que o app inicia, de dentro do `dragstart` dele. O fim
     * do gesto é avisado ao shell daqui, no `dragend`.
     */
    function arrastarArquivos(
      dataTransfer: DataTransfer | null,
      caminhos: string | string[],
      opcoes?: { efeito?: DataTransfer['effectAllowed'] },
    ): boolean;
    /** Os handles de File System Access do que já foi concedido, sem abrir seletor. */
    function handlesConcedidos(): Promise<Array<FileSystemFileHandle | FileSystemDirectoryHandle>>;
  }

  namespace midia {
    /** O ganho que o ambiente aplica a este app, de 0 a 1, já com o mudo (mudo é 0). */
    function ganho(): number;
    /** Se o mixer do ambiente deixou este app mudo. */
    function mudo(): boolean;
  }

  /** A aparência do ambiente: a cor de destaque que o usuário escolheu. Reporta, e não escreve. */
  namespace aparencia {
    /**
     * Os tokens de destaque do ambiente (`--ds-accent`, `--ds-accent-h`, `--ds-accent-bg`,
     * `--ds-sel`), ou `null` quando não há a quem perguntar; `null` quer dizer "não sobrescreva
     * nada".
     */
    function tokens(): Record<string, string> | null;
    /** Avisa quando o usuário troca a cor, e só quando o valor muda. Devolve a função que cancela. */
    function aoMudar(fn: (tokens: Record<string, string> | null) => void): () => void;
  }
}

interface Window {
  vssh: typeof vssh;
}
