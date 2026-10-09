# `vssh.apps`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

Um app usando outro. Quem oferece declara a capacidade em `provides` e o prefixo das rotas dela em
`capacidades`; quem usa a declara em `requires`, quando não funciona sem ela, ou em `usa`, quando
funciona. O shell faz o pedido como a mesma pessoa, depois de ela permitir, e o backend que responde
recebe `X-Vssh-Chamador` com o id de quem chamou.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.apps.listar(capacidade)`](#listar) | sim, em até 5 s |
| [`vssh.apps.pedir(capacidade, caminho, opcoes)`](#pedir) | sim, em até 10 min |

### `listar`

`vssh.apps.listar(capacidade)`

Os apps deste ambiente que oferecem `capacidade` (`nome/vN`), em `apps`, cada um
`{ id, nome, icone, rotulo }`, na ordem dos ids: `icone` é o endereço do ícone no portal, e `rotulo`
o que o manifesto dele declara para a capacidade, ou `null`. Nenhum app sobe e a pessoa não responde
nada. Sem quem ofereça, `apps` vem vazia. Uma capacidade que este app não declara em `requires` nem
em `usa` responde erro.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: vale.
No fio: `type: "apps", op: "list"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `capacidade` | `string` | não | `capacidade` |

### `pedir`

`vssh.apps.pedir(capacidade, caminho, opcoes)`

Faz um pedido HTTP ao app que oferece `capacidade` (`nome/vN`), em `caminho`, relativo ao prefixo
que ele declarou, com a consulta junto (`buscar?q=silva`). Na primeira vez que este app usa aquele,
a pessoa responde se pode, e a resposta vale até ela a revogar em Configurações. Um app parado sobe
antes do pedido. `opcoes` leva `metodo` (GET por padrão; POST, PUT, PATCH, DELETE), `corpo` (um
objeto vai como JSON), `tipo`, o Content-Type de um corpo em texto, e `app`, o id de um dos apps que
`listar` devolveu; sem `app`, o pedido vai ao primeiro. Responde `{ status, tipo, corpo }`: `corpo`
é o JSON lido quando a resposta é JSON, e o texto nos outros casos. Um caminho que sai do prefixo,
uma capacidade que o app não declara em `requires` nem em `usa`, um `app` que não a oferece e a
recusa da pessoa respondem erro, sem pedido nenhum.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
Num hiperlink: vale.
No fio: `type: "apps", op: "request"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `capacidade` | `string` | não | `capacidade` |
| `caminho` | `string` | não | `caminho` |
| `opcoes` | `{ metodo?: string, corpo?: unknown, tipo?: string, app?: string }` | sim | `opcoes` |

## Eventos

Este espaço não declara eventos; `vssh.apps.ao()` recusa qualquer nome.
