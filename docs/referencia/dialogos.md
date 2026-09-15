# `vssh.dialogos`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

Os diálogos do sistema e o menu de contexto, desenhados pelo shell com os dados que o app manda.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.dialogos.mostrar(mensagem, titulo)`](#mostrar) | sim, em até 10 min |
| [`vssh.dialogos.erro(mensagem, titulo)`](#erro) | sim, em até 10 min |
| [`vssh.dialogos.confirmar(mensagem, titulo)`](#confirmar) | sim, em até 10 min |
| [`vssh.dialogos.perguntar(mensagem, valor, titulo)`](#perguntar) | sim, em até 10 min |
| [`vssh.dialogos.senha(mensagem, titulo)`](#senha) | sim, em até 10 min |
| [`vssh.dialogos.menuDeContexto(x, y, itens)`](#menudecontexto) | sim, em até 10 min |

### `mostrar`

`vssh.dialogos.mostrar(mensagem, titulo)`

Uma caixa de informação com um botão OK. A resposta chega quando a pessoa fecha a caixa.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "dialog"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `titulo` | `string` | sim | `title` |

### `erro`

`vssh.dialogos.erro(mensagem, titulo)`

A mesma caixa de `mostrar`, com o tom de erro.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "dialog", variant: "error"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `titulo` | `string` | sim | `title` |

### `confirmar`

`vssh.dialogos.confirmar(mensagem, titulo)`

Uma pergunta com "Sim" e "Não". A resposta é `true` só quando a pessoa disse sim; fechar a caixa
vale como não.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "dialog", variant: "confirm"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `titulo` | `string` | sim | `title` |

### `perguntar`

`vssh.dialogos.perguntar(mensagem, valor, titulo)`

Um campo de texto de uma linha. A resposta é o que a pessoa escreveu, ou `null` quando ela cancelou.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "dialog", variant: "prompt"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `valor` | `string` | sim | `value` |
| `titulo` | `string` | sim | `title` |

### `senha`

`vssh.dialogos.senha(mensagem, titulo)`

Um campo de senha, com o texto escondido. A resposta é o valor digitado, ou `null` quando a pessoa
cancelou. O valor chega ao app; para uma credencial que o app não deve ver, o caminho é
`segredos.pedir`.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "dialog", variant: "password"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `titulo` | `string` | sim | `title` |

### `menuDeContexto`

`vssh.dialogos.menuDeContexto(x, y, itens)`

O menu de contexto do ambiente, montado com os itens que o app descreve: `label`, `icon`, `id`,
`danger`, `checked`, `disabled`, `separator`, `header` e um nível de `submenu`. `x` e `y` são do
viewport do app, e o shell soma a posição da janela. A resposta é o `id` do item escolhido (o
`label`, quando o item não tem id), e `null` quando a pessoa fechou sem escolher.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "context-menu"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `x` | `number` | não | `x` |
| `y` | `number` | não | `y` |
| `itens` | `object[]` | não | `items` |

## Eventos

Este espaço não declara eventos; `vssh.dialogos.ao()` recusa qualquer nome.
