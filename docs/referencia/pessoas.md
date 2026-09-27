# `vssh.pessoas`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

As pessoas do ambiente, para compartilhar uma sala. Cada pessoa é
`{ usuario, nome, login, iniciais }`, e o `usuario` é o que os verbos de `vssh.salas` recebem. O
e-mail de ninguém sai daqui.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.pessoas.eu()`](#eu) | sim, em até 5 s |
| [`vssh.pessoas.buscar(texto)`](#buscar) | sim, em até 5 s |

### `eu`

`vssh.pessoas.eu()`

A pessoa que usa o app: `{ usuario, nome, login, iniciais, grupos }`, com os grupos do OIDC que o
último login dela trouxe.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "pessoas", op: "me"`.

Sem argumentos.

### `buscar`

`vssh.pessoas.buscar(texto)`

Até 20 pessoas cujo nome ou login contém cada palavra de `texto`, sem olhar acento, em `pessoas`, e
os grupos da própria pessoa que casam com `texto`, em `grupos`, cada um `{ grupo, pessoas }`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "pessoas", op: "search"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `texto` | `string` | não | `texto` |

## Eventos

Este espaço não declara eventos; `vssh.pessoas.ao()` recusa qualquer nome.
