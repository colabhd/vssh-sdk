# `vssh.apps`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

Um app usando outro. Quem oferece declara a capacidade em `provides` e o prefixo das rotas dela em
`capacidades`; quem usa a declara em `requires`. O shell faz o pedido como a mesma pessoa, depois de
ela permitir, e o backend que responde recebe `X-Vssh-Chamador` com o id de quem chamou.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.apps.pedir(capacidade, caminho, opcoes)`](#pedir) | sim, em até 10 min |

### `pedir`

`vssh.apps.pedir(capacidade, caminho, opcoes)`

Faz um pedido HTTP ao app que oferece `capacidade` (`nome/vN`), em `caminho`, relativo ao prefixo
que ele declarou, com a consulta junto (`buscar?q=silva`). Na primeira vez, a pessoa responde se
este app pode usar a capacidade, e a resposta vale até ela a revogar em Configurações. Um app parado
sobe antes do pedido. `opcoes` leva `metodo` (GET por padrão; POST, PUT, PATCH, DELETE), `corpo` (um
objeto vai como JSON) e `tipo`, o Content-Type de um corpo em texto. Responde
`{ status, tipo, corpo }`: `corpo` é o JSON lido quando a resposta é JSON, e o texto nos outros
casos. Um caminho que sai do prefixo, uma capacidade que o app não declara em `requires` e a recusa
da pessoa respondem erro, sem pedido nenhum.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
No fio: `type: "apps", op: "request"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `capacidade` | `string` | não | `capacidade` |
| `caminho` | `string` | não | `caminho` |
| `opcoes` | `{ metodo?: string, corpo?: unknown, tipo?: string }` | sim | `opcoes` |

## Eventos

Este espaço não declara eventos; `vssh.apps.ao()` recusa qualquer nome.
