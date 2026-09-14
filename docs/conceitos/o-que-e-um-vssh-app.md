# O que é um vssh-app

Ao terminar esta página você sabe dizer onde cada peça de um vssh-app roda, o que o ambiente faz
por ela sem que o app peça, e o que o SDK expõe ao seu código. É o mapa que as outras páginas
detalham.

## Três lugares

Um vssh-app é um pacote: um `vssh-app.json` na raiz, um frontend em HTML e um backend em Python,
Node ou binário. O pacote é desenvolvido fora do sistema, num repositório próprio, e instalado num
servidor Linux que o VSSH já provisionou. Depois de instalado, o app aparece no menu iniciar e no
launchpad de cada pessoa que usa aquele servidor, e abre como uma janela.

As peças rodam em três lugares:

| lugar | o que roda ali |
|---|---|
| o navegador da pessoa | o shell do ambiente (janelas, menus, diálogos, gerenciador de arquivos) e, dentro de uma janela, o frontend do app, num iframe |
| o portal | o proxy que encaminha `/<serverId>/proxy/app/<id>/*` ao backend do app, o ciclo de vida (start, healthcheck, stop) e a instalação |
| o servidor Linux do usuário | o backend do app, um processo por pessoa, rodando como a conta Linux dela |

O backend escuta num socket unix em `$VSSH_APP_SOCKET`, que é `~/.vssh-apps/<id>/app.sock`. O
endereço é derivado de `(HOME, id)`, e os dois lados o calculam sozinhos: o portal não aloca porta,
não guarda cache de endereço e não tem o que reconciliar. O diretório é `0700` do dono, então o
socket de um app não é alcançável por outra conta Linux da máquina.

A janela é HTML desenhado pelo navegador. Um vssh-app não depende do motor X11 e se comporta igual
num servidor sem ele.

## O que o ambiente faz sem o app pedir

Antes de escrever uma linha de API, vale saber o que já acontece por conta do sistema:

- o proxy encaminha HTTP e WebSocket ao backend, e injeta em cada requisição o header
  `X-Vssh-App-Token`, gerado por instância. O socket já é do dono; o header é a segunda barreira,
  para o app que serve algo sensível recusar o que não veio pelo proxy;
- o ciclo de vida sobe o backend quando alguém abre a janela, sonda o `healthcheckPath` até 15
  vezes com 1 s de intervalo, e mantém o processo de pé enquanto o estado desejado for "rodando"
  ([ciclo de vida](ciclo-de-vida.md));
- o processo sobe contido por um escopo do systemd, com teto de memória e de tarefas, e sem
  enxergar a GPU a menos que o manifesto a peça ([o manifesto](o-manifesto.md));
- o `document.title` do frontend vira o título da janela; um `<a target="_blank">` ou um
  `window.open` de uma biblioteca abre no navegador do ambiente, e o clique direito mostra só o
  que o app montou ([a janela](a-janela.md));
- o volume do app obedece ao mixer da barra, e o app aparece nele por carregar o shim;
- a janela sobrevive a uma queda do portal ([o que o sistema garante](o-que-o-sistema-garante.md)).

## O que o SDK expõe

O sistema é o fonte privado; o autor de app programa contra um SDK público gerado a partir dele. A
tabela de exportação da ponte entre app e shell é dado: cada verbo tem um nome público, em
português, e um nome que viaja no fio por `postMessage`. O fio é interno ao sistema e fica parado
quando o nome público muda, e é isso que mantém um app instalado funcionando enquanto o SDK evolui.

Os espaços, e o que cada um abstrai:

| espaço | o que ele abstrai |
|---|---|
| `vssh.app` | quem o app é e em que ambiente está: as capacidades do shell, os verbos disponíveis, o título que a janela mostra e a rota que a sessão restaura |
| `vssh.janela` | a janela do app, controlada em runtime pelo app que a ocupa e declarada no manifesto para quem a abre |
| `vssh.arquivos` | ler e escrever com o consentimento do usuário, escolher, vigiar, abrir, abrir com, arrastar, e a área de transferência de arquivos |
| `vssh.avisos` | notificação, aviso efêmero, atividade em curso e bandeja, para um app com janela aberta |
| `vssh.dialogos` | os diálogos do sistema e o menu de contexto, desenhados pelo shell com os dados que o app manda |
| `vssh.segredos` | o cofre: o app pede uma credencial pelo nome, o shell mostra o campo e grava, e o valor nunca passa pelo app |
| `vssh.midia` | o que o app está tocando, o transporte que ele sabe fazer e o volume que o usuário deixou para ele |
| `vssh.impressao` | imprimir pela tela do sistema: o app pede, e quem escolhe a impressora e confirma é o usuário |

O padrão que atravessa todos os espaços: só dado cruza a ponte. O app manda rótulos, ids e
caminhos, nunca uma função nem HTML, e o shell desenha o diálogo, o menu, o seletor e a
notificação com a aparência do ambiente.

A primeira pergunta de um app é `vssh.app.capacidades()`. A resposta traz o nome do host, o que ele
sabe fazer (`nativeApps`, `x11Interop`, `clipboardServer` e os demais), a versão do shell e a lista
de verbos e eventos da tabela. Com a lista o app decide sozinho se o shell em que caiu tem o que
ele precisa, e degrada onde não tem. `shellVersion: null` é resposta válida: um shell que não se
declara.

## Fora do ambiente

O frontend roda fora do desktop sem `if` nenhum: cada verbo degrada para o equivalente do navegador
(um diálogo vira `window.confirm`, um seletor devolve `null`, um controle de janela não faz nada).
O backend precisa só de três variáveis (`VSSH_APP_SOCKET`, `VSSH_APP_ID`, `VSSH_APP_DATA_DIR`) e
sobe na sua máquina, sem servidor VSSH. O que não funciona fora do ambiente é o que precisa do
shell do outro lado: o consentimento de arquivos, a bandeja, o cofre.

## O que o ambiente não entrega

Uma lista curta que decide se um port é viável antes de começar:

| não existe | o que fazer |
|---|---|
| menubar de aplicação (o `Menu` do Electron) | menu de contexto e UI dentro da janela |
| atalho global de teclado | sem equivalente |
| redimensionar ou mover a própria janela | o tamanho inicial é do manifesto; depois, do usuário |
| badge ou progresso no botão da barra de tarefas | a atividade na bandeja cobre o caso ([avisos e atividades](../guias/avisos-e-atividades.md)) |
| abrir uma janela com conteúdo de outra origem | `vssh.janela.abrir(rota)` abre outra janela do próprio app |
| guardar um objeto de estado no ambiente | `vssh.app.lembrarRota` guarda uma rota; o resto vai para o backend do app ou para o filesystem do usuário |

Tudo que o app precisa de sistema (um processo filho, um binário nativo, um índice) mora no
backend dele, que existe para isso.
