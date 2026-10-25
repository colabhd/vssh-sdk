# A ajuda de um app

> Página gerada do compilador da Ajuda
> ([`api/ajuda/compilador-da-ajuda.ts`](../../api/ajuda/compilador-da-ajuda.ts)) e da Ajuda do
> ambiente ([`api/ajuda/ambiente.json`](../../api/ajuda/ambiente.json)) pelo canal de publicação do
> sistema. Uma mudança se faz na fonte, no `vssh-sso`. Como escrever a ajuda está no guia [A ajuda
> do seu app](../guias/ajuda.md).

## O frontmatter de um tópico

As chaves que um tópico de app aceita, e nenhuma outra: `id`, `titulo`, `ordem`, `palavras`,
`cobre`, `plataformas`, `sistemas`, `requer`, `publico`, `revisado`. `plataformas` lista onde o
tópico vale (`navegador`, `cliente-de-desktop`, `chromeos`, `celular`).

## As ações de um passo

Uma linha que começa por `>`, recuada dentro de um item da cerca `passos`, é uma ação, que o palco
executa para tirar a figura e o Mostrar onde fica executa na tela da pessoa. Uma cerca `passos` ou
`figura` pode pedir só uma tela (`larga`, `estreita`).

| ação | o que faz |
|---|---|
| `abrir <Janela>` | abre a janela dessa classe pelo lançador que a declara |
| `clicar <alvo> [direito \| duplo]` | o gesto do passo é o clique no alvo |
| `mostrar <alvo>` | aponta o alvo, sem gesto |
| `revelar <alvo>` | rola até o alvo |
| `digitar <alvo> <texto>` | escreve o texto no campo |
| `tecla <Tecla>` | aperta a tecla, com Ctrl, Alt, Shift ou Super na frente |
| `esperar <alvo>` | espera o alvo aparecer |
| `pronto <alvo>` | o passo terminou quando o alvo aparece |

A cerca `referencia` pede ao shell uma tabela gerada: `configuracoes`, `atalhos`, `aplicativos`,
`tipos`, `conexao`, `placa`.

## As superfícies que o `cobre` nomeia

O nível da ajuda sai das superfícies que o manifesto declara e dos tópicos que as cobrem. Cada linha
existe quando o manifesto declara o campo dela.

| no `cobre` | a superfície |
|---|---|
| `janela` | a janela do app |
| `menu:<id>` | o item \<rótulo\> do menu |
| `segredo:<NOME>` | a senha \<NOME\> |
| `recurso:fila` | a fila de processamento |
| `recurso:salas` | a edição em grupo |
| `recurso:gpu` | a placa de vídeo |
| `oferece:<capacidade>` | a capacidade \<capacidade\> que o app oferece |
| `usa:<capacidade>` | a capacidade \<capacidade\> que o app usa |
| `configuracoes` | a seção de Configurações |
| `navegador` | a extensão do Navegador |

## Os tópicos do ambiente

Um tópico de app liga a um do ambiente por `{{t:ambiente/<id>|texto}}`. Os 55 que existem:

| id | título |
|---|---|
| `abrir-com` | Que aplicativo abre cada arquivo |
| `abrir-um-aplicativo` | Abrir um aplicativo |
| `abrir-um-servidor-seu` | Abrir o seu Dash, Vite ou notebook |
| `algo-travou` | A tela travou ou um aplicativo parou de responder |
| `alternar-janelas` | Passar de uma janela para outra |
| `aplicativos-do-servidor` | Os aplicativos deste servidor |
| `app-nao-abre` | Um aplicativo não abre |
| `area-de-trabalho` | A área de trabalho e os ícones |
| `arquivo-sumiu` | Um arquivo sumiu |
| `arquivos` | Os seus arquivos e pastas |
| `atalhos-de-teclado` | Atalhos de teclado |
| `avisos-e-notificacoes` | Avisos, notificações e Não perturbe |
| `baixar-arquivos` | Levar um arquivo do servidor para o seu computador |
| `barra-de-tarefas` | A barra de tarefas |
| `chaveiro` | Senhas guardadas no Chaveiro |
| `como-usar-a-ajuda` | Como usar a Ajuda |
| `compactar-e-extrair` | Arquivos compactados (.zip) |
| `configuracoes` | Configurações |
| `copiar-e-mover` | Copiar e mover arquivos |
| `desfazer` | Desfazer o que acabou de fazer |
| `editor-de-texto` | O Editor de texto |
| `entrar-e-sair` | Entrar, trocar de servidor e sair |
| `enviar-arquivos` | Levar arquivos do seu computador para o servidor |
| `excluir-e-lixeira` | Excluir e a Lixeira |
| `fundo-e-cor` | Trocar o fundo da tela e a cor de destaque |
| `gerenciador-de-tarefas` | Ver o que está rodando e encerrar um programa travado |
| `imprimir` | Imprimir um arquivo |
| `instalar-uma-extensao` | Instalar uma extensão no Navegador |
| `janela-nao-abriu` | Uma janela diz que não abriu |
| `janelas` | Mover, aumentar e fechar uma janela |
| `log-de-um-aplicativo` | As mensagens de um aplicativo (o log) |
| `loja-de-apps` | Instalar um aplicativo pela Loja de apps |
| `mandar-para-a-fila` | Mandar um trabalho pesado para a fila |
| `mouse-e-teclado` | Clicar, arrastar e o clique direito |
| `navegador` | O Navegador do ambiente |
| `no-celular` | No celular |
| `no-chromebook` | No Chromebook |
| `no-cliente-de-desktop` | No cliente de desktop |
| `no-navegador` | No navegador |
| `nova-pasta` | Criar uma pasta |
| `o-ambiente` | O que é o VSSH |
| `onde-as-coisas-estao` | O seu computador, o portal e a estação |
| `pastas-de-rede` | Pastas de rede (Nextcloud, ownCloud, SharePoint) |
| `placa-de-video` | A placa de vídeo da estação |
| `portal-nao-responde` | O portal não está respondendo |
| `praticar` | Praticar os gestos |
| `renomear` | Mudar o nome de um arquivo |
| `rodar-um-script` | Rodar um script e ver o resultado |
| `sessao-expirou` | Sua sessão expirou |
| `tela-cheia` | Usar a tela inteira |
| `terminal` | O Terminal |
| `um-app-pede-um-arquivo` | Quando um aplicativo pede um arquivo ou uma pasta |
| `um-app-pede-uma-senha` | Quando um aplicativo pede uma senha |
| `um-app-quer-usar-outro` | Quando um aplicativo quer usar outro |
| `versao-nova` | Versão nova publicada |

## Os termos do glossário do ambiente

`{{g:<termo>}}` cita um termo do glossário do app ou um destes: aba, ambiente, aplicativo, área de
trabalho, área de transferência, arquivo, arrastar, barra de tarefas, clique direito, clique duplo,
encaixar, endereço, estação, janela, Lixeira, Não perturbe, notificação, pasta, portal, servidor,
seu computador, tela cheia, toque duplo, toque longo.
