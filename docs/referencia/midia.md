# `vssh.midia`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

O que o app está tocando, o transporte que ele sabe fazer e o volume que o usuário deixou para ele.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.midia.audio(temAudio, tocando)`](#audio) | não |
| [`vssh.midia.transporte(anterior, proximo)`](#transporte) | não |
| [`vssh.midia.agora(titulo, subtitulo, capa)`](#agora) | não |

### `audio`

`vssh.midia.audio(temAudio, tocando)`

O app dizendo que tem áudio, e se está tocando. É o que o põe na lista do mixer de volume: um app
que toca por Web Audio não tem elemento que o shell encontre na varredura. O SDK relata sozinho a
mídia e o Web Audio que ele vê; um app só chama isto por conta própria quando produz som por um
caminho que o SDK não alcança.

Não responde: um disparo, sem retorno.
No fio: `type: "audio-state"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `temAudio` | `boolean` | não | `hasAudio` |
| `tocando` | `boolean` | não | `playing` |

### `transporte`

`vssh.midia.transporte(anterior, proximo)`

O que este app sabe fazer de transporte além de tocar, pausar e buscar, que o shell já faz sozinho:
anterior e próximo dependem de uma fila, e a fila é do app. A central de mídia desenha só os botões
declarados, e o clique volta pelo evento `acao`.

Não responde: um disparo, sem retorno.
No fio: `type: "media-transporte"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `anterior` | `boolean` | não | `anterior` |
| `proximo` | `boolean` | não | `proximo` |

### `agora`

`vssh.midia.agora(titulo, subtitulo, capa)`

O que está tocando, para a central de mídia. Sem isto o shell tira o nome da URL da fonte, e uma
mídia montada por MSE tem um `blob:` sem nome. `capa` é uma URL de imagem relativa ao app, e só vale
dentro dele. Sem título e sem capa, a decisão volta ao ambiente.

Não responde: um disparo, sem retorno.
No fio: `type: "media-agora"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `titulo` | `string` | não | `titulo` |
| `subtitulo` | `string` | sim | `subtitulo` |
| `capa` | `string` | sim | `capa` |

## Eventos

### `volume`

`vssh.midia.ao('volume', cb)`

O volume que o mixer do ambiente aplica a este app, de 0 a 1, com o mudo à parte. Chega no load da
janela e a cada mexida no mixer. O SDK já o aplica à mídia e ao GainNode do app; um app só lê isto
para desenhar o próprio controle.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `ganho` | `number` | não | `gain` |
| `mudo` | `boolean` | não | `muted` |

No fio: `type: "volume"`.

### `acao`

`vssh.midia.ao('acao', cb)`

A central de mídia pedindo a faixa anterior ou a próxima ao app que declarou o transporte.

| campo | tipo | opcional | no fio |
|---|---|---|---|
| `acao` | `'anterior' \| 'proximo'` | não | `acao` |

No fio: `type: "media-acao"`.
