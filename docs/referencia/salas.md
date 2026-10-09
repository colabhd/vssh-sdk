# `vssh.salas`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

As salas de edição: várias pessoas no mesmo documento Yjs, com o portal de relé. Toda sala é de um
app, e daqui o app só alcança as dele. Quem conecta o documento é
`vssh.salas.entrar(id, { Y, awarenessProtocol })`, o provedor do SDK, que pede um `bilhete` a cada
conexão; os verbos abaixo são a lista, a criação, quem entra, os avisos e o bilhete.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.salas.listar()`](#listar) | sim, em até 5 s |
| [`vssh.salas.criar(titulo)`](#criar) | sim, em até 5 s |
| [`vssh.salas.ler(id)`](#ler) | sim, em até 5 s |
| [`vssh.salas.renomear(id, titulo)`](#renomear) | sim, em até 5 s |
| [`vssh.salas.apagar(id)`](#apagar) | sim, em até 5 s |
| [`vssh.salas.darAcesso(id, usuario, papel)`](#daracesso) | sim, em até 5 s |
| [`vssh.salas.tirarAcesso(id, usuario)`](#tiraracesso) | sim, em até 5 s |
| [`vssh.salas.darAcessoAoGrupo(id, grupo, papel)`](#daracessoaogrupo) | sim, em até 5 s |
| [`vssh.salas.tirarAcessoDoGrupo(id, grupo)`](#tiraracessodogrupo) | sim, em até 5 s |
| [`vssh.salas.avisar(id, tipo, para, ancora)`](#avisar) | sim, em até 5 s |
| [`vssh.salas.bilhete(id)`](#bilhete) | sim, em até 5 s |

### `listar`

`vssh.salas.listar()`

As salas deste app em que a pessoa está, as dela e as que dividiram com ela, em `salas`, das mais
recentes às mais antigas. Cada uma traz `id`, `titulo`, `papel` (`dona`, `editar`, `comentar` ou
`ver`), `criadaEm` e `atualizadaEm`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "list"`.

Sem argumentos.

### `criar`

`vssh.salas.criar(titulo)`

Cria uma sala deste app, com a pessoa como dona, e responde a sala. Sem `titulo`, ela se chama "Sem
título".

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "create"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `titulo` | `string` | sim | `titulo` |

### `ler`

`vssh.salas.ler(id)`

A sala e quem está nela, em `{ sala, pessoas, grupos }`: as pessoas com `usuario`, `nome`, `login`,
`iniciais` e `papel`, a dona primeiro, e os grupos com `grupo` e `papel`. A sala de outro app, ou
uma em que a pessoa não está, responde o erro de sala não encontrada.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "get"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |

### `renomear`

`vssh.salas.renomear(id, titulo)`

Troca o título da sala e responde a sala. Só a dona renomeia.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
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
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "delete"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |

### `darAcesso`

`vssh.salas.darAcesso(id, usuario, papel)`

Dá a uma pessoa (o `usuario` de `vssh.pessoas.buscar`) um papel na sala, ou muda o papel dela, e
responde a pessoa. Quem não estava na sala recebe o convite no sino. Só a dona dá acesso.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "share"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |
| `usuario` | `string` | não | `usuario` |
| `papel` | `'editar' \| 'comentar' \| 'ver'` | não | `papel` |

### `tirarAcesso`

`vssh.salas.tirarAcesso(id, usuario)`

Tira uma pessoa da sala, e as conexões dela fecham com 4403, a não ser que ela continue num grupo da
sala. A dona tira qualquer pessoa, e cada pessoa tira a si mesma (o `usuario` de `vssh.pessoas.eu`).
Responde `{ tirado: true }`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "unshare"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |
| `usuario` | `string` | não | `usuario` |

### `darAcessoAoGrupo`

`vssh.salas.darAcessoAoGrupo(id, grupo, papel)`

Dá a um grupo do OIDC um papel na sala: quem está no grupo entra com ele, e quem tem outro caminho
até a sala fica com o papel mais forte. Só a dona, e só com um grupo de que ela faz parte. Quem está
no grupo recebe o convite. Responde `{ grupo, papel, pessoas }`, com quantas pessoas o grupo tem.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "share-group"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |
| `grupo` | `string` | não | `grupo` |
| `papel` | `'editar' \| 'comentar' \| 'ver'` | não | `papel` |

### `tirarAcessoDoGrupo`

`vssh.salas.tirarAcessoDoGrupo(id, grupo)`

Tira o grupo da sala; quem ficou sem caminho até ela sai com 4403. Só a dona. Responde
`{ tirado: true }`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "unshare-group"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |
| `grupo` | `string` | não | `grupo` |

### `avisar`

`vssh.salas.avisar(id, tipo, para, ancora)`

Avisa de 1 a 20 pessoas da sala de uma menção ou de uma resposta num comentário. `ancora` é o id do
comentário (letras, dígitos, `_` e `-`, até 64), e o aviso abre o app em
`?sala=<id>&comentario=<ancora>`. O texto é do portal, e a mesma âncora não avisa a mesma pessoa
duas vezes. Só quem escreve comentários na sala avisa, e só quem está nela recebe. Responde
`{ avisados }`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "notify"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |
| `tipo` | `'mencao' \| 'resposta'` | não | `tipo` |
| `para` | `string[]` | não | `para` |
| `ancora` | `string` | não | `ancora` |

### `bilhete`

`vssh.salas.bilhete(id)`

O bilhete que abre o WebSocket da sala por 60 s:
`{ bilhete, validoAte, usuario, papel, caminho, canais, anexos }`. O endereço é
`caminho + "/" + canal + "?bilhete=" + bilhete`, na origem do app. Sem acesso à sala (ela foi
apagada, a pessoa saiu dela, ou é de outro app), a resposta é `{ bilhete: null }`.
`vssh.salas.entrar` pede um bilhete novo a cada conexão; um app com provedor próprio do y-websocket
o usa direto.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
Num hiperlink: recusado. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas", op: "ticket"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `id` | `string` | não | `sala` |

## Eventos

### `mudaram`

`vssh.salas.ao('mudaram', cb)`

A lista de salas deste app mudou para a pessoa: um convite chegou, ela saiu ou foi tirada de uma
sala, uma sala trocou de nome ou foi apagada. O evento não traz a lista; quem a mostra chama
`listar` de novo. Chega a todas as janelas do app.

O `cb` recebe um objeto vazio.

Num hiperlink: não chega. O provedor das salas abre o WebSocket na origem do portal, e um hiperlink tem backend próprio.
No fio: `type: "salas-changed"`.
