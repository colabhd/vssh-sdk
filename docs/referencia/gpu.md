# `vssh.gpu`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

O recurso que o sistema arbitra ao subir o app. O manifesto declara o que o app precisa em
`recursos.gpu.modo`; quem decide, com o que o servidor tem, é o `vssh-app-run`, e o app pergunta o
que recebeu sem conhecer `CUDA_VISIBLE_DEVICES` nem o inventário do servidor.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.gpu.estado()`](#estado) | sim, em até 5 s |

### `estado`

`vssh.gpu.estado()`

O que o sistema concedeu de GPU a este app, na forma que o backend lê em `vssh.gpu.concedida()`:
`{ concedida, dispositivos, motivo }`. `dispositivos` são os que o processo do app abre, cada um com
`fabricante`, `driver`, `virtual`, `video` (o caminho de codificação: `nvenc`, `vaapi` ou `null`) e
`renderNode`; a lista fica vazia quando nada foi concedido. `motivo` é a frase do lançador quando a
resposta é não (`não declarada no manifesto`, `sem GPU utilizável: ...`,
`não consegui consultar este servidor`), e `null` quando é sim. A janela e o backend leem o mesmo
registro, e o gerenciador de tarefas mostra a mesma frase.

Responde: uma promessa, com prazo de 5 s (ritmo `rapido`, a resposta não depende de uma pessoa).
No fio: `type: "gpu", op: "estado"`.

Sem argumentos.

## Eventos

Este espaço não declara eventos; `vssh.gpu.ao()` recusa qualquer nome.
