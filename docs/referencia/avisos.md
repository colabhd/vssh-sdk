# `vssh.avisos`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

Notificação, aviso efêmero, atividade em curso e bandeja, para um app com janela aberta.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.avisos.notificar(mensagem, titulo, nivel, prioridade, chave, acoes, abrir)`](#notificar) | sim, em até 5 s |
| [`vssh.avisos.avisar(mensagem, titulo, nivel, duracao, chave)`](#avisar) | sim, em até 5 s |
| [`vssh.avisos.atividade(chave, item)`](#atividade) | sim, em até 5 s |
| [`vssh.avisos.encerrarAtividade(chave, registrar)`](#encerraratividade) | sim, em até 5 s |
| [`vssh.avisos.bandeja(item)`](#bandeja) | sim, em até 5 s |
| [`vssh.avisos.tirarDaBandeja()`](#tirardabandeja) | sim, em até 5 s |

### `notificar`

`vssh.avisos.notificar(mensagem, titulo, nivel, prioridade, chave, acoes, abrir)`

Um fato que aconteceu, gravado no histórico do sino e anunciado num aviso: um caminho, um erro que a
pessoa vai querer reencontrar. `nivel` é o tom (cor e ícone); `prioridade` é quanto interromper:
`baixa` só marca o sino, `normal` mostra o aviso por alguns segundos, `alta` o deixa na tela até a
pessoa responder. Um app não abre modal, e `critica` vira `alta`. A mesma `chave` substitui a
notificação anterior no lugar de empilhar. O clique numa das `acoes` volta pelo evento
`acaoDeNotificacao`. `abrir` é onde o clique na notificação leva, um caminho dentro do app
(`?documento=x`), que chega pelo evento `abertura` quando a janela já está aberta. A resposta é o id
da notificação.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "notify"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `titulo` | `string` | sim | `title` |
| `nivel` | `'info' \| 'success' \| 'warning' \| 'error'` | sim | `level` |
| `prioridade` | `'baixa' \| 'normal' \| 'alta'` | sim | `prioridade` |
| `chave` | `string` | sim | `chave` |
| `acoes` | `{ id: string, label: string }[]` | sim | `actions` |
| `abrir` | `string` | sim | `rota` |

### `avisar`

`vssh.avisos.avisar(mensagem, titulo, nivel, duracao, chave)`

A frase que se lê e se esquece ("copiado", "salvo"): some sozinha depois de `duracao` milissegundos
(4000 por padrão) e não entra no histórico. A mesma `chave` reescreve o aviso que está na tela e
recomeça o relógio dele.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "toast"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `mensagem` | `string` | não | `message` |
| `titulo` | `string` | sim | `title` |
| `nivel` | `'info' \| 'success' \| 'warning' \| 'error'` | sim | `level` |
| `duracao` | `number` | sim | `timeout` |
| `chave` | `string` | sim | `chave` |

### `atividade`

`vssh.avisos.atividade(chave, item)`

Uma condição que é verdade agora, na bandeja e no painel de atividades: um progresso, algo tocando.
`item` leva `titulo`, `texto`, `formato` (`simples`, `progresso` ou `midia`), `progresso`
(`{ feito, total }` ou `{ indeterminado: true }`) e `acoes`; a mesma `chave` atualiza no lugar,
então relatar progresso não empilha linhas. O clique numa ação volta pelo evento `acaoDeAtividade`.
A resposta é a chave completa, `app:<id>:<chave>`, que é a que o ambiente usa. Sem `item`, o mesmo
fio encerra a atividade, como `encerrarAtividade`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "live"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `chave` | `string` | não | `chave` |
| `item` | `object` | não | `item` |

### `encerrarAtividade`

`vssh.avisos.encerrarAtividade(chave, registrar)`

Encerra uma atividade. Sem `registrar` ela some sem deixar rastro, que é o certo para uma
indisponibilidade resolvida; com `registrar` (`titulo`, `texto`, `level`) o fim vira uma notificação
no histórico, como "550 arquivos copiados". A resposta é a chave completa.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "live", item: null`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `chave` | `string` | não | `chave` |
| `registrar` | `object` | sim | `registrar` |

### `bandeja`

`vssh.avisos.bandeja(item)`

O ícone do app ao lado do relógio. `item` leva `icon` (nome de ícone do ambiente ou caminho dentro
do pacote), `tooltip`, `badge` (`{ count }`, `{ dot: true }` ou `{ text }`) e `menu` (itens com `id`
e `label`). É um item por app, e chamar de novo troca o conteúdo sem o ícone mudar de lugar. O
clique e a escolha no menu voltam pelo evento `acaoNaBandeja`. A resposta é `true`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "tray", op: "set"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `item` | `object` | não | `item` |

### `tirarDaBandeja`

`vssh.avisos.tirarDaBandeja()`

Tira o ícone do app da bandeja. A resposta diz se havia um.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "tray", op: "remove"`.

Sem argumentos.

## Eventos

### `acaoDeNotificacao`

`vssh.avisos.ao('acaoDeNotificacao', cb)`

A pessoa clicou numa ação de uma notificação deste app. Chega à janela do app que teve foco por
último, e a ela só.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `notificacaoId` | `string` | não | `notificationId` |
| `acaoId` | `string` | não | `actionId` |

No fio: `type: "notify-action"`.

### `acaoDeAtividade`

`vssh.avisos.ao('acaoDeAtividade', cb)`

A pessoa clicou numa ação de uma atividade declarada por esta janela. `chave` é a que o app
escolheu, sem o prefixo do ambiente.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `chave` | `string` | não | `chave` |
| `acaoId` | `string` | não | `actionId` |

No fio: `type: "live-action"`.

### `acaoNaBandeja`

`vssh.avisos.ao('acaoNaBandeja', cb)`

A pessoa clicou no ícone da bandeja (`click`) ou escolheu um item do menu dele (`menu`, com o
`menuId` do item). O shell não interpreta o id; quem sabe o que ele significa é o app.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `evento` | `'click' \| 'menu'` | não | `event` |
| `menuId` | `string` | sim | `menuId` |

No fio: `type: "tray-event"`.
