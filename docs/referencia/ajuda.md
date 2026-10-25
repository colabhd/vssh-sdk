# `vssh.ajuda`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

A ajuda do app na Ajuda do ambiente. O app abre um tópico dele; o resto o SDK faz sozinho dentro do
quadro: acha o controle que um passo aponta, avisa quando a pessoa faz o gesto do Passo a passo, e
diz o que é o controle clicado no modo "O que é isto?". Quem desenha o holofote é o shell, sobre o
retângulo que o quadro devolve.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.ajuda.abrir(topico)`](#abrir) | sim, em até 5 s |
| [`vssh.ajuda.achou(pedido, retangulo)`](#achou) | não |
| [`vssh.ajuda.feito(pedido, ok)`](#feito) | não |
| [`vssh.ajuda.ouvindo()`](#ouvindo) | não |
| [`vssh.ajuda.isto(nome, ajuda, retangulo)`](#isto) | não |

### `abrir`

`vssh.ajuda.abrir(topico)`

Abre a Ajuda num tópico do app, pelo id dele na pasta `contributes.ajuda` (sem o argumento, o tópico
de entrada), ou num tópico do ambiente com `ambiente/<id>`. A resposta é `true` quando a Ajuda abre
no tópico, e `false` quando o tópico não existe.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: vale.
No fio: `type: "ajuda", op: "abrir"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `topico` | `string` | sim | `topico` |

### `achou`

`vssh.ajuda.achou(pedido, retangulo)`

O SDK chama este verbo sozinho: o retângulo, no quadro, do controle que o evento `mostrar` pediu, de
novo a cada rolagem, e `null` quando ele some.

Não responde: um disparo, sem retorno.
Num hiperlink: vale.
No fio: `type: "ajuda", op: "achou"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `pedido` | `number` | não | `pedido` |
| `retangulo` | `{ x: number, y: number, w: number, h: number } \| null` | sim | `retangulo` |

### `feito`

`vssh.ajuda.feito(pedido, ok)`

O SDK chama este verbo sozinho quando a pessoa faz no controle o gesto que o evento `gesto` pediu, e
o Passo a passo segue para o passo seguinte. Ele também responde assim ao evento `fazer`, com `ok`
falso quando o controle não está no quadro.

Não responde: um disparo, sem retorno.
Num hiperlink: vale.
No fio: `type: "ajuda", op: "feito"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `pedido` | `number` | não | `pedido` |
| `ok` | `boolean` | sim | `ok` |

### `ouvindo`

`vssh.ajuda.ouvindo()`

O SDK chama este verbo sozinho quando o modo "O que é isto?" liga: o quadro passa a receber o
clique, que ele mesmo explica.

Não responde: um disparo, sem retorno.
Num hiperlink: vale.
No fio: `type: "ajuda", op: "ouvindo"`.

Sem argumentos.

### `isto`

`vssh.ajuda.isto(nome, ajuda, retangulo)`

O SDK chama este verbo sozinho com o controle que a pessoa clicou no modo "O que é isto?": o nome
que ela lê, o `data-ajuda` do primeiro ancestral que o tem, e o retângulo. O clique não chega ao
app.

Não responde: um disparo, sem retorno.
Num hiperlink: vale.
No fio: `type: "ajuda", op: "isto"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `nome` | `string` | não | `nome` |
| `ajuda` | `string \| null` | sim | `ajuda` |
| `retangulo` | `{ x: number, y: number, w: number, h: number }` | sim | `retangulo` |

## Eventos

### `mostrar`

`vssh.ajuda.ao('mostrar', cb)`

O shell pede o retângulo de um controle do app, pelo seletor (como `[data-ajuda="transcrever"]`) ou
pelo nome que a pessoa lê. Com `alvo` nulo, o pedido acaba. O SDK atende sozinho.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `pedido` | `number` | não | `pedido` |
| `alvo` | `{ seletor?: string, nome?: string } \| null` | não | `alvo` |

Num hiperlink: chega.
No fio: `type: "ajuda-mostrar"`.

### `gesto`

`vssh.ajuda.ao('gesto', cb)`

O shell pede o aviso do gesto de um passo no controle. Com `tipo` nulo, o pedido acaba. O SDK atende
sozinho.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `pedido` | `number` | não | `pedido` |
| `alvo` | `{ seletor?: string, nome?: string } \| null` | não | `alvo` |
| `tipo` | `'click' \| 'dblclick' \| 'contextmenu' \| 'keydown' \| null` | não | `tipo` |
| `tecla` | `string` | sim | `tecla` |

Num hiperlink: chega.
No fio: `type: "ajuda-gesto"`.

### `fazer`

`vssh.ajuda.ao('fazer', cb)`

O "Fazer por mim" de um passo pede ao quadro o gesto no controle: o clique (o direito, o duplo) ou o
texto num campo. O SDK atende sozinho e responde com `feito`.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `pedido` | `number` | não | `pedido` |
| `alvo` | `{ seletor?: string, nome?: string }` | não | `alvo` |
| `verbo` | `'clicar' \| 'digitar'` | não | `verbo` |
| `botao` | `'direito' \| 'duplo'` | sim | `botao` |
| `texto` | `string` | sim | `texto` |

Num hiperlink: chega.
No fio: `type: "ajuda-fazer"`.

### `modo`

`vssh.ajuda.ao('modo', cb)`

O modo "O que é isto?" ligou ou desligou. O SDK atende sozinho.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `ligado` | `boolean` | não | `ligado` |

Num hiperlink: chega.
No fio: `type: "ajuda-modo"`.
