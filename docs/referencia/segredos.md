# `vssh.segredos`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

O cofre: o app pede uma credencial pelo nome, o shell mostra o campo e grava, e o valor nunca passa
pelo app.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.segredos.listar()`](#listar) | sim, em até 5 s |
| [`vssh.segredos.pedir(nome, titulo, descricao)`](#pedir) | sim, em até 10 min |
| [`vssh.segredos.apagar(nome)`](#apagar) | sim, em até 5 s |

### `listar`

`vssh.segredos.listar()`

Os nomes guardados para este app, em `names`. Só os nomes: o cofre não devolve valor.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "secrets", op: "list"`.

Sem argumentos.

### `pedir`

`vssh.segredos.pedir(nome, titulo, descricao)`

Pede à pessoa uma credencial pelo nome (maiúsculas, dígitos e sublinhado, até 64 caracteres). O
shell mostra um campo de senha com a `descricao`, grava no servidor e responde
`{ names, requerReinicio: true }`; o valor não passa pelo app. O ambiente de um processo é fixado no
start, e `requerReinicio` é o app saber que precisa reiniciar para enxergar o segredo. Cancelar
responde `{ names: null, cancelado: true }`.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "secrets", op: "set"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `nome` | `string` | não | `nome` |
| `titulo` | `string` | sim | `title` |
| `descricao` | `string` | sim | `description` |

### `apagar`

`vssh.segredos.apagar(nome)`

Apaga uma credencial pelo nome. A resposta é `{ names, requerReinicio: true }`, com a lista que
sobrou.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "secrets", op: "del"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `nome` | `string` | não | `nome` |

## Eventos

Este espaço não declara eventos; `vssh.segredos.ao()` recusa qualquer nome.
