# `vssh.app`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

Quem o app é e em que ambiente ele está: as capacidades do shell, os verbos disponíveis, o título
que a janela mostra e a rota que a sessão restaura.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.app.capacidades()`](#capacidades) | sim, em até 5 s |
| [`vssh.app.titulo(titulo)`](#titulo) | não |
| [`vssh.app.lembrarRota(rota)`](#lembrarrota) | não |
| [`vssh.app.relatarErro(mensagem, pilha, fonte, linha, coluna, tipo)`](#relatarerro) | não |

### `capacidades`

`vssh.app.capacidades()`

O ambiente em que o app está: o nome do host, o que ele sabe fazer, a versão do shell e a lista de
verbos e eventos desta tabela. Com a lista, o app decide sozinho se o shell em que caiu tem o que
ele precisa.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "capabilities"`.

Sem argumentos.

### `titulo`

`vssh.app.titulo(titulo)`

O título que a janela mostra na barra de título, na barra de tarefas e no Alt+Tab. O app o reporta
sempre que o dele muda; o shell corta em 200 caracteres.

Não responde: um disparo, sem retorno.
No fio: `type: "title"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `titulo` | `string` | não | `title` |

### `lembrarRota`

`vssh.app.lembrarRota(rota)`

Onde o app está, para a sessão o reabrir no mesmo lugar: um caminho dentro do app, que o ambiente
cola na URL quando restaura a janela. Uma rota que sai do app (um esquema, um caminho absoluto, um
`..`) é recusada no console, sem resposta.

Não responde: um disparo, sem retorno.
No fio: `type: "rota"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `rota` | `string` | não | `rota` |

### `relatarErro`

`vssh.app.relatarErro(mensagem, pilha, fonte, linha, coluna, tipo)`

Um erro do app, para o log do ambiente, onde quem mantém o sistema o lê ao lado do que aconteceu no
portal. O SDK chama este verbo sozinho a cada exceção sem tratamento e a cada promessa rejeitada sem
`catch` dentro do app; o app o chama com `tipo: 'relatado'` para um erro que ele mesmo tratou e quer
registrar. O shell carimba o id do app, corta a mensagem em 1000 caracteres e a pilha em 8000, tira
a query da fonte, e manda o mesmo erro uma vez a cada dez minutos.

Não responde: um disparo, sem retorno.
No fio: `type: "error-report"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `pilha` | `string` | sim | `stack` |
| `fonte` | `string` | sim | `source` |
| `linha` | `number` | sim | `line` |
| `coluna` | `number` | sim | `column` |
| `tipo` | `'erro' \| 'rejeicao' \| 'relatado'` | sim | `kind` |

## Eventos

### `abertura`

`vssh.app.ao('abertura', cb)`

O contexto com que o app foi aberto ("abrir aqui", "abrir com", um item da jump list). Chega depois
do load, e de novo quando uma ação alcança uma janela que já está aberta. `item` é o `id` do item de
`contributes.contextMenu` que a pessoa clicou, e é por ele que um app com mais de um item no mesmo
arquivo sabe qual foi.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | sim | `path` |
| `url` | `string` | sim | `url` |
| `tipo` | `'arquivo' \| 'pasta' \| 'url'` | sim | `tipo` |
| `rota` | `string` | sim | `rota` |
| `item` | `string` | sim | `item` |

No fio: `type: "open-context"`.
