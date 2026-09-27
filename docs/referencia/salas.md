# `vssh.salas`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

As salas de edição: várias pessoas no mesmo documento Yjs, com o portal de relé. Toda sala é de um
app, e daqui o app só alcança as dele. Quem conecta o documento é
`vssh.salas.entrar(id, { Y, awarenessProtocol })`, o provedor do SDK, que pede um `bilhete` a cada
conexão; os verbos abaixo são a lista, a criação e o bilhete.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.salas.listar()`](#listar) | sim, em até 5 s |
| [`vssh.salas.criar(titulo)`](#criar) | sim, em até 5 s |
| [`vssh.salas.ler(id)`](#ler) | sim, em até 5 s |
| [`vssh.salas.renomear(id, titulo)`](#renomear) | sim, em até 5 s |
| [`vssh.salas.apagar(id)`](#apagar) | sim, em até 5 s |
| [`vssh.salas.bilhete(id)`](#bilhete) | sim, em até 5 s |

### `listar`

`vssh.salas.listar()`

As salas deste app em que a pessoa está, as dela e as que dividiram com ela, em `salas`, das mais
recentes às mais antigas. Cada uma traz `id`, `titulo`, `papel` (`dona`, `editar`, `comentar` ou
`ver`), `criadaEm` e `atualizadaEm`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "salas", op: "list"`.

Sem argumentos.

### `criar`

`vssh.salas.criar(titulo)`

Cria uma sala deste app, com a pessoa como dona, e responde a sala. Sem `titulo`, ela se chama "Sem
título".

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "salas", op: "create"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `titulo` | `string` | sim | `titulo` |

### `ler`

`vssh.salas.ler(id)`

A sala e quem está nela, em `{ sala, pessoas }`, a dona primeiro. A sala de outro app, ou uma em que
a pessoa não está, responde o erro de sala não encontrada.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "salas", op: "get"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |

### `renomear`

`vssh.salas.renomear(id, titulo)`

Troca o título da sala e responde a sala. Só a dona renomeia.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "salas", op: "rename"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |
| `titulo` | `string` | não | `titulo` |

### `apagar`

`vssh.salas.apagar(id)`

Apaga a sala, o documento e os anexos. Só a dona apaga, e quem estava conectado recebe o fechamento
4410.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "salas", op: "delete"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |

### `bilhete`

`vssh.salas.bilhete(id)`

O bilhete que abre o WebSocket da sala por 60 s:
`{ bilhete, validoAte, usuario, papel, caminho, canais, anexos }`. O endereço é
`caminho + "/" + canal + "?bilhete=" + bilhete`, na origem do app. Sem acesso à sala (ela foi
apagada, a pessoa saiu dela, ou é de outro app), a resposta é `{ bilhete: null }`.
`vssh.salas.entrar` pede um bilhete novo a cada conexão; um app com provedor próprio do y-websocket
o usa direto.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "salas", op: "ticket"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |

## Eventos

Este espaço não declara eventos; `vssh.salas.ao()` recusa qualquer nome.
