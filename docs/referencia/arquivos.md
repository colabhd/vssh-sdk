# `vssh.arquivos`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

Ler e escrever com o consentimento do usuário, escolher, vigiar, abrir, abrir com, arrastar, e a
área de transferência de arquivos.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.arquivos.listar(caminho)`](#listar) | sim, em até 5 s |
| [`vssh.arquivos.consultar(caminho)`](#consultar) | sim, em até 5 s |
| [`vssh.arquivos.ler(caminho)`](#ler) | sim, em até 5 s |
| [`vssh.arquivos.lerBytes(caminho)`](#lerbytes) | sim, em até 5 s |
| [`vssh.arquivos.escrever(caminho, conteudo)`](#escrever) | sim, em até 5 s |
| [`vssh.arquivos.escreverBytes(caminho, bytes)`](#escreverbytes) | sim, em até 5 s |
| [`vssh.arquivos.criarPasta(caminho)`](#criarpasta) | sim, em até 5 s |
| [`vssh.arquivos.apagar(caminho)`](#apagar) | sim, em até 5 s |
| [`vssh.arquivos.existe(caminho)`](#existe) | sim, em até 5 s |
| [`vssh.arquivos.renomear(origem, destino, politica)`](#renomear) | sim, em até 5 s |
| [`vssh.arquivos.copiar(origem, destino, politica)`](#copiar) | sim, em até 5 s |
| [`vssh.arquivos.vigiar(caminho, vigia)`](#vigiar) | sim, em até 5 s |
| [`vssh.arquivos.pararDeVigiar(vigia)`](#parardevigiar) | sim, em até 5 s |
| [`vssh.arquivos.escolherArquivo(titulo, filtro, pasta, nome)`](#escolherarquivo) | sim, em até 10 min |
| [`vssh.arquivos.escolherDestino(titulo, filtro, pasta, nome)`](#escolherdestino) | sim, em até 10 min |
| [`vssh.arquivos.escolherPasta(titulo, pasta)`](#escolherpasta) | sim, em até 10 min |
| [`vssh.arquivos.permissoes(caminho)`](#permissoes) | sim, em até 5 s |
| [`vssh.arquivos.areaDeTransferencia()`](#areadetransferencia) | sim, em até 5 s |
| [`vssh.arquivos.copiarParaAreaDeTransferencia(caminhos)`](#copiarparaareadetransferencia) | sim, em até 5 s |
| [`vssh.arquivos.abrir(caminho)`](#abrir) | não |
| [`vssh.arquivos.abrirPasta(caminho)`](#abrirpasta) | não |
| [`vssh.arquivos.abrirCom(caminho)`](#abrircom) | sim, em até 10 min |
| [`vssh.arquivos.abrirLink(url, destino)`](#abrirlink) | sim, em até 5 s |
| [`vssh.arquivos.arrastar(caminhos)`](#arrastar) | não |
| [`vssh.arquivos.terminarArraste()`](#terminararraste) | não |

### `listar`

`vssh.arquivos.listar(caminho)`

As entradas de uma pasta concedida: `{ path, items }`, com nome, tipo e tamanho de cada item.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Um 404 do servidor é resposta, e não falha: é o verbo com que um app sonda antes de criar.
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "list"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `consultar`

`vssh.arquivos.consultar(caminho)`

O que um caminho é: tamanho, data de modificação, `isFile`, `isDirectory` e o tipo MIME. Um caminho
que não existe responde 404, e o app que sonda antes de criar lê isso como resposta.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Um 404 do servidor é resposta, e não falha: é o verbo com que um app sonda antes de criar.
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "stat"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `ler`

`vssh.arquivos.ler(caminho)`

O conteúdo de um arquivo, como texto.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Um 404 do servidor é resposta, e não falha: é o verbo com que um app sonda antes de criar.
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "read"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `lerBytes`

`vssh.arquivos.lerBytes(caminho)`

O conteúdo de um arquivo, em bytes. No fio ele viaja em base64, porque um `ArrayBuffer` não
atravessa o `postMessage` entre os dois documentos sem cópia; o SDK o devolve como `Uint8Array`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Um 404 do servidor é resposta, e não falha: é o verbo com que um app sonda antes de criar.
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "readBytes"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `escrever`

`vssh.arquivos.escrever(caminho, conteudo)`

Grava texto num arquivo, criando ou substituindo.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "write"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |
| `conteudo` | `string` | não | `content` |

### `escreverBytes`

`vssh.arquivos.escreverBytes(caminho, bytes)`

Grava bytes num arquivo, criando ou substituindo. É a rota de um binário: um PNG passado por
`escrever` sairia corrompido sem aviso, porque aquela rota é de texto. O SDK codifica os bytes em
base64 para o fio; uma string já é base64 e passa como veio.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "writeBytes"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |
| `bytes` | `Uint8Array \| ArrayBuffer \| string` | não | `base64` |

### `criarPasta`

`vssh.arquivos.criarPasta(caminho)`

Cria uma pasta.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "mkdir"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `apagar`

`vssh.arquivos.apagar(caminho)`

Apaga de vez um arquivo ou uma pasta com o conteúdo dela. A lixeira fica de fora; quem quer o
caminho com desfazer usa o gerenciador de arquivos.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "delete"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `existe`

`vssh.arquivos.existe(caminho)`

Se um caminho existe: `{ exists }`. Só o 404 do servidor vira `false`; permissão negada e servidor
fora lançam, porque "não pude perguntar" e "não existe" pedem do app ações opostas.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "exists"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `renomear`

`vssh.arquivos.renomear(origem, destino, politica)`

Renomeia, e é também o mover, como o `mv`. Origem e destino precisam estar concedidos. Um destino
que já existe falha; `overwrite` substitui, e precisa ser dito, porque perder um arquivo em silêncio
não tem desfazer.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `origem` e `destino` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "rename"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `origem` | `string` | não | `from` |
| `destino` | `string` | não | `to` |
| `politica` | `'fail' \| 'overwrite'` | sim | `policy` |

### `copiar`

`vssh.arquivos.copiar(origem, destino, politica)`

Copia. Origem e destino precisam estar concedidos, e um destino que já existe segue a política de
`renomear`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `origem` e `destino` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "copy"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `origem` | `string` | não | `from` |
| `destino` | `string` | não | `to` |
| `politica` | `'fail' \| 'overwrite'` | sim | `policy` |

### `vigiar`

`vssh.arquivos.vigiar(caminho, vigia)`

Assina as mudanças sob um caminho, venham de onde vierem: outro editor, um upload pelo gerenciador
de arquivos. A resposta confirma a assinatura; cada mudança chega depois pelo evento `arquivoMudou`,
com o `vigia` que o app escolheu. Quem segura a conexão com o servidor é o shell, e ela morre com a
janela.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Consentimento: o shell confere `caminho` contra o que o usuário concedeu a este app.
No fio: `type: "fs", op: "watch"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |
| `vigia` | `string` | não | `watchId` |

### `pararDeVigiar`

`vssh.arquivos.pararDeVigiar(vigia)`

Encerra uma assinatura de `vigiar`. Cada assinatura segura um vigia vivo no servidor do usuário, com
teto por usuário, e encerrar a que deixou de servir é o que mantém as outras cabendo.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "fs", op: "unwatch"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `vigia` | `string` | não | `watchId` |

### `escolherArquivo`

`vssh.arquivos.escolherArquivo(titulo, filtro, pasta, nome)`

Abre o seletor de arquivo do sistema e responde com o caminho escolhido, ou `null` se o usuário
cancelou. O `filtro` é uma lista de grupos no estilo do Qt: `Imagens (*.png *.jpg);;Tudo (*)`.
Escolher é consentir: o caminho passa a estar concedido a este app, e a concessão sobrevive à janela
e à sessão.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "pick", variant: "open"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `titulo` | `string` | sim | `title` |
| `filtro` | `string` | sim | `filter` |
| `pasta` | `string` | sim | `dir` |
| `nome` | `string` | sim | `name` |

### `escolherDestino`

`vssh.arquivos.escolherDestino(titulo, filtro, pasta, nome)`

Abre o seletor de "salvar como", com `nome` sugerido, e responde com o caminho onde gravar, ou
`null` se o usuário cancelou. O caminho escolhido fica concedido a este app.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "pick", variant: "save"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `titulo` | `string` | sim | `title` |
| `filtro` | `string` | sim | `filter` |
| `pasta` | `string` | sim | `dir` |
| `nome` | `string` | sim | `name` |

### `escolherPasta`

`vssh.arquivos.escolherPasta(titulo, pasta)`

Abre o seletor de pasta e responde com o caminho escolhido, ou `null` se o usuário cancelou. A pasta
inteira fica concedida a este app, e é assim que um app trabalha numa árvore sem pedir arquivo a
arquivo.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "pick", variant: "directory"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `titulo` | `string` | sim | `title` |
| `pasta` | `string` | sim | `dir` |

### `permissoes`

`vssh.arquivos.permissoes(caminho)`

Com `caminho`, se este app pode tocá-lo: `true` ou `false`. Sem, a lista dos caminhos concedidos a
ele, com que o app refaz um handle sem abrir seletor. Quem decide é o shell; o espelho que o SDK
mantém serve só ao que precisa responder sem esperar.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "grants"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | sim | `path` |

### `areaDeTransferencia`

`vssh.arquivos.areaDeTransferencia()`

O que está na área de transferência de arquivos do ambiente: `{ action, paths }`, ou `null`. É a
área do gerenciador de arquivos, que nenhuma API do navegador alcança; texto e imagem vão por
`navigator.clipboard`, direto no app.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "clipboard", op: "files"`.

Sem argumentos.

### `copiarParaAreaDeTransferencia`

`vssh.arquivos.copiarParaAreaDeTransferencia(caminhos)`

Põe caminhos na área de transferência de arquivos, como se o usuário os tivesse copiado no
gerenciador, e responde com quantos entraram. Sempre copiar: recortar moveria um arquivo do usuário
na próxima colagem a partir de uma mensagem de iframe, e fica com o gerenciador, onde a pessoa vê o
que faz.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "clipboard", op: "setFiles"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminhos` | `string[]` | não | `paths` |

### `abrir`

`vssh.arquivos.abrir(caminho)`

Abre um arquivo no visualizador do ambiente que a extensão pede: PDF, vídeo, editor de texto,
planilha. O app manda o caminho e não precisa saber em que servidor está.

Não responde: um disparo, sem retorno.
No fio: `type: "open-file"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `abrirPasta`

`vssh.arquivos.abrirPasta(caminho)`

Abre uma pasta no gerenciador de arquivos.

Não responde: um disparo, sem retorno.
No fio: `type: "open-folder"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `abrirCom`

`vssh.arquivos.abrirCom(caminho)`

Mostra ao usuário os aplicativos que abrem o arquivo, a mesma lista do menu de contexto do
gerenciador, e abre no escolhido. Responde com o nome do aplicativo, ou `null` se o usuário
cancelou. Sem X11 a lista tem só vssh-apps.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "open-with"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |

### `abrirLink`

`vssh.arquivos.abrirLink(url, destino)`

Abre um link no navegador do ambiente, que resolve a rede a partir do servidor Linux: um
`http://localhost:3000` chega ao loopback do servidor, e numa aba de fora chegaria à máquina de quem
lê. Só `http` e `https`. Um link cujo host outro app declarou em `opens.urls` vai para esse app;
`destino: 'navegador'` pede o navegador mesmo assim.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "open-url"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `url` | `string` | não | `url` |
| `destino` | `'navegador'` | sim | `destino` |

### `arrastar`

`vssh.arquivos.arrastar(caminhos)`

Avisa que um arraste de arquivos começou dentro do app, com os caminhos absolutos que ele carrega. É
o que acende os alvos de soltura do ambiente (a área de trabalho, o gerenciador, a lixeira), que
leem um estado do documento do shell que um gesto nascido no iframe não escreve. O SDK o manda de
dentro do `dragstart`.

Não responde: um disparo, sem retorno.
No fio: `type: "arraste", fase: "inicio"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminhos` | `string[]` | não | `caminhos` |

### `terminarArraste`

`vssh.arquivos.terminarArraste()`

Avisa que o arraste acabou, e apaga o estado. O `dragend` não atravessa documentos, então sem este
aviso os alvos do ambiente ficariam acesos para um gesto que já terminou. O SDK o manda sozinho, no
`dragend` do app.

Não responde: um disparo, sem retorno.
No fio: `type: "arraste", fase: "fim"`.

Sem argumentos.

## Eventos

### `permissoesMudaram`

`vssh.arquivos.ao('permissoesMudaram', cb)`

A lista completa do que este app pode tocar. Chega no load da janela e a cada mudança (uma escolha
num seletor, uma revogação no menu da janela), e substitui a anterior: o shell é a fonte, e uma
revogação lá apaga aqui.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `caminhos` | `string[]` | não | `paths` |

No fio: `type: "grants"`.

### `arquivoMudou`

`vssh.arquivos.ao('arquivoMudou', cb)`

Algo mudou sob um caminho vigiado. `encerrado` é o shell dizendo que a assinatura acabou de vez,
porque a conexão com o servidor desistiu de reconectar; avisar é melhor que seguir calado fingindo
que vigia.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `vigia` | `string` | não | `watchId` |
| `caminho` | `string \| null` | não | `path` |
| `encerrado` | `boolean` | sim | `closed` |

No fio: `type: "fs-change"`.

### `areaDeTransferenciaMudou`

`vssh.arquivos.ao('areaDeTransferenciaMudou', cb)`

A área de transferência de arquivos mudou, por qualquer janela: o usuário copiou no gerenciador e
voltou para o app. Sem o evento, o app só descobriria perguntando em laço.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `conteudo` | `{ action, paths } \| null` | não | `clipboard` |

No fio: `type: "clipboard-change"`.
