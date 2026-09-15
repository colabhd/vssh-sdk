# `vssh.janela`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

A janela do app: controlada em runtime pelo app que a ocupa, e declarada no manifesto para quem a
abre.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.janela.abrir(rota, titulo, largura, altura)`](#abrir) | sim, em até 5 s |
| [`vssh.janela.minimizar()`](#minimizar) | não |
| [`vssh.janela.maximizar()`](#maximizar) | não |
| [`vssh.janela.restaurar()`](#restaurar) | não |
| [`vssh.janela.focar()`](#focar) | não |
| [`vssh.janela.fechar()`](#fechar) | não |
| [`vssh.janela.arrastar(x, y, telaX, telaY)`](#arrastar) | não |
| [`vssh.janela.arrastarPara(telaX, telaY)`](#arrastarpara) | não |
| [`vssh.janela.terminarArraste()`](#terminararraste) | não |
| [`vssh.janela.alternarMaximizado()`](#alternarmaximizado) | não |
| [`vssh.janela.menuDoCabecalho(x, y)`](#menudocabecalho) | não |
| [`vssh.janela.abas(abas, abaAtiva)`](#abas) | não |

### `abrir`

`vssh.janela.abrir(rota, titulo, largura, altura)`

Outra janela deste app, e a rota decide o que vai dentro dela: sem rota, uma cópia da mesma página;
com rota (`?painel=notas`), um painel ou um segundo documento. O backend continua sendo um só, e a
janela nova leva o título e o ícone do app. O shell recusa uma rota que sai do app (um esquema, um
caminho absoluto, um `..`) e responde `false`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "window", op: "open"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `rota` | `string` | sim | `rota` |
| `titulo` | `string` | sim | `title` |
| `largura` | `number` | sim | `width` |
| `altura` | `number` | sim | `height` |

### `minimizar`

`vssh.janela.minimizar()`

Recolhe a janela para a barra de tarefas. Uma janela já minimizada fica como está.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "minimize"`.

Sem argumentos.

### `maximizar`

`vssh.janela.maximizar()`

Ocupa a área de trabalho inteira. Uma janela já maximizada fica como está.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "maximize"`.

Sem argumentos.

### `restaurar`

`vssh.janela.restaurar()`

Devolve a janela ao tamanho normal: tira da barra de tarefas a que está minimizada, e desmaximiza a
que está maximizada.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "restore"`.

Sem argumentos.

### `focar`

`vssh.janela.focar()`

Traz a janela para a frente das outras e lhe dá o foco.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "focus"`.

Sem argumentos.

### `fechar`

`vssh.janela.fechar()`

Fecha a janela pelo mesmo caminho do botão de fechar. Quando ela é a última do app, o backend segue
o que `backend.aoFechar` declara no manifesto.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "close"`.

Sem argumentos.

### `arrastar`

`vssh.janela.arrastar(x, y, telaX, telaY)`

Começa a arrastar a janela a partir de um ponto do documento do app, para quem declarou
`cabecalho: "app"` e desenha a própria barra de título. `x` e `y` dizem onde no quadro do app a
pessoa o agarrou (`clientX`, `clientY`); `telaX` e `telaY` fixam a referência de tela para o resto
do gesto (`screenX`, `screenY`). O app captura o ponteiro e conta o gesto inteiro: este começo, cada
ponto por `arrastarPara`, e o fim por `terminarArraste`. Uma janela maximizada ignora o pedido, como
ignora o cabeçalho padrão.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "drag-start"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `x` | `number` | não | `x` |
| `y` | `number` | não | `y` |
| `telaX` | `number` | não | `telaX` |
| `telaY` | `number` | não | `telaY` |

### `arrastarPara`

`vssh.janela.arrastarPara(telaX, telaY)`

Um ponto do arraste em curso, em coordenada de tela (`screenX`, `screenY`). A coordenada é de tela
porque o quadro do app se move junto com a janela, e um ponto relativo a ele dependeria do que o
gesto acabou de mudar. Sem arraste começado, o shell ignora.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "drag-move"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `telaX` | `number` | não | `telaX` |
| `telaY` | `number` | não | `telaY` |

### `terminarArraste`

`vssh.janela.terminarArraste()`

O fim do arraste, no `pointerup` ou `pointercancel` do app. Sem ele a janela continua seguindo o
ponteiro depois que a pessoa solta o botão.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "drag-end"`.

Sem argumentos.

### `alternarMaximizado`

`vssh.janela.alternarMaximizado()`

O duplo-clique da barra de título de quem tem `cabecalho: "app"`: maximiza a janela normal e
restaura a maximizada.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "toggle-maximize"`.

Sem argumentos.

### `menuDoCabecalho`

`vssh.janela.menuDoCabecalho(x, y)`

O menu de contexto do cabeçalho (mover, maximizar, fechar, o log do backend), aberto no ponto `x`,
`y` do quadro do app. O shell traduz o ponto para a tela dele.

Não responde: um disparo, sem retorno.
No fio: `type: "window", op: "head-menu"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `x` | `number` | não | `x` |
| `y` | `number` | não | `y` |

### `abas`

`vssh.janela.abas(abas, abaAtiva)`

A lista de abas de um app com `richChrome`, que o shell desenha na barra de título. O app a manda
inteira a cada mudança; o shell responde aos cliques pelos eventos `ativarAba`, `fecharAba` e
`novaAba`. Só texto atravessa: o shell monta cada aba com o `title` que recebeu. Uma aba com
`sessionName` volta na sessão seguinte pelo evento `restaurarAbas`. Sem `richChrome` no manifesto, o
shell ignora a lista.

Não responde: um disparo, sem retorno.
No fio: `type: "tabs"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `abas` | `{ id: string, title?: string, sessionName?: string }[]` | não | `tabs` |
| `abaAtiva` | `string \| null` | sim | `activeTabId` |

## Eventos

### `restaurarAbas`

`vssh.janela.ao('restaurarAbas', cb)`

As abas que a sessão anterior deixou salvas, mandadas uma vez, no load do iframe de um app com
`richChrome`. Chega mesmo sem nada salvo (`abas: null`), para o app nunca decidir sozinho se cria
uma aba inicial.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `abas` | `{ sessionName: string }[] \| null` | não | `tabs` |
| `sessaoAtiva` | `string \| null` | não | `activeSessionName` |

No fio: `type: "restore-tabs"`.

### `ativarAba`

`vssh.janela.ao('ativarAba', cb)`

A pessoa clicou numa aba da barra de título.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `abaId` | `string` | não | `tabId` |

No fio: `type: "activate-tab"`.

### `fecharAba`

`vssh.janela.ao('fecharAba', cb)`

A pessoa clicou no fechar de uma aba, ou em "Fechar aba" no menu do cabeçalho.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `abaId` | `string` | não | `tabId` |

No fio: `type: "close-tab"`.

### `novaAba`

`vssh.janela.ao('novaAba', cb)`

A pessoa clicou no `+` da barra de abas, ou em "Nova aba" no menu do cabeçalho.

O `cb` recebe um objeto vazio.

No fio: `type: "new-tab"`.
