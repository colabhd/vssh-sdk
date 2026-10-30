# `vssh.aparelho`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

O aparelho em que a pessoa usa o ambiente, na língua das classes da Aferição: o que ele faz bem em
cada experiência, contra um computador de referência, e a memória que o app pode usar nele. O app
escolhe o que fazer por isso, sem medir o aparelho sozinho.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.aparelho.perfil()`](#perfil) | sim, em até 5 s |

### `perfil`

`vssh.aparelho.perfil()`

O perfil deste aparelho: `{ versao, classes, elos, memoriaParaOApp }`. `classes` traz `ambiente`,
`desenhar`, `ler` e `video`, cada uma `acima`, `referencia`, `abaixo`, `fora` ou `nao-medido`,
contra o Celeron dual-core de 4 GB de referência. `elos` traz o índice de `cpu`, `layout`,
`canvas2d` e `webgl2` (`{ valor, estado }`, 100 é o Celeron, maior é melhor) e a `placa`
(`{ familia, software, estado }`). `memoriaParaOApp` são os MB que o app pode ocupar neste aparelho.
Antes da primeira medida, as classes e os elos saem `nao-medido`, e o evento `mudou` avisa quando a
medida chega.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: vale.
No fio: `type: "aparelho", op: "perfil"`.

Sem argumentos.

## Eventos

### `mudou`

`vssh.aparelho.ao('mudou', cb)`

O perfil novo, na forma de `perfil()`, a cada medida completa do aparelho: a que o ambiente faz
sozinho depois de abrir e a de "Medir este aparelho".

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `perfil` | `Record<string, unknown>` | não | `perfil` |

Num hiperlink: chega.
No fio: `type: "aparelho-mudou"`.
