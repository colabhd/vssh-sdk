# `vssh.configuracoes`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

A seção que o app traz a Configurações do ambiente (`contributes.settings`). Um app que a declara
opcional (`contributes.settingsOptIn`) a liga e desliga daqui, de dentro dele; a escolha é por
usuário e acompanha a pessoa.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.configuracoes.ligada()`](#ligada) | sim, em até 5 s |
| [`vssh.configuracoes.ligar(ligado)`](#ligar) | sim, em até 5 s |
| [`vssh.configuracoes.abrir()`](#abrir) | sim, em até 5 s |

### `ligada`

`vssh.configuracoes.ligada()`

Se a seção deste app aparece em Configurações, em `ligada`, e se ela é opcional, em `opcional`. Um
app sem `settingsOptIn` lê `ligada: true` sempre.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "settings-section", op: "get"`.

Sem argumentos.

### `ligar`

`vssh.configuracoes.ligar(ligado)`

Liga (`true`) ou desliga (`false`) a seção deste app em Configurações, e responde o mesmo que
`ligada`. Só faz efeito num app com `settingsOptIn`; nos outros a seção existe sempre, e a resposta
diz isso.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "settings-section", op: "set"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `ligado` | `boolean` | não | `ligado` |

### `abrir`

`vssh.configuracoes.abrir()`

Abre Configurações na seção deste app. Com a seção desligada, ou antes de ela ter sido carregada,
abre Configurações no índice; a resposta traz em `secao` o id da seção aberta, ou `null`.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "settings-section", op: "open"`.

Sem argumentos.

## Eventos

Este espaço não declara eventos; `vssh.configuracoes.ao()` recusa qualquer nome.
