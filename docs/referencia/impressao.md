# `vssh.impressao`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

Imprimir pela tela do sistema: o app pede, e quem escolhe a impressora e confirma é o usuário.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.impressao.imprimir(caminho, nome)`](#imprimir) | sim, em até 5 s |

### `imprimir`

`vssh.impressao.imprimir(caminho, nome)`

Abre a tela de impressão do ambiente para um arquivo do servidor, por caminho absoluto. Quem escolhe
a impressora e confirma é a pessoa, com o `nome` do arquivo na tela (o do caminho, por padrão). A
resposta é `true` assim que a tela abre, sem esperar a impressão.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "print"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `caminho` | `string` | não | `path` |
| `nome` | `string` | sim | `name` |

## Eventos

Este espaço não declara eventos; `vssh.impressao.ao()` recusa qualquer nome.
