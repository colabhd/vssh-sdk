# Trabalho longo

Ao terminar este guia você sabe rodar um trabalho que leva minutos ou horas a partir do backend do
seu app, na própria estação ou na fila de processamento do cluster, e acompanhá-lo dos dois jeitos
com o mesmo código: o progresso na janela e na bandeja, o fim no sino, o cancelamento e a retomada
depois de um reinício do backend.

As peças são dois módulos do runtime `vssh`, em Python e em Node: `progresso`, o protocolo de uma
linha pelo qual o trabalho diz quanto falta, e `trabalhos`, quem sobe o trabalho e o acompanha. Os
dois chegam aos servidores com o portal que os traz; num servidor anterior, o import falha.

## O trabalho diz quanto falta

Quem faz o trabalho imprime uma linha no stdout com um prefixo fixo e um objeto JSON:

```
::vssh-progresso {"feito":2472,"total":3862,"etapa":"transcrevendo"}
```

```python
from vssh import progresso
progresso.informar(2472, 3862, 'transcrevendo')
```

```js
const { progresso } = require('vssh');
progresso.informar(2472, 3862, 'transcrevendo');
```

`feito` é obrigatório. Sem `total` não há porcentagem, e a bandeja desenha a faixa indeterminada.
`etapa` é um nome curto do que está acontecendo, até 64 caracteres. O resto do stdout continua
sendo texto para gente, e é seu: um app pode ter o próprio protocolo de linha ao lado deste.

Um trabalho que roda num container sem o runtime `vssh` imprime a linha à mão. O formato é esse e
só esse, e `progresso.ler(linha)` devolve o objeto, ou `None` (`null` no Node) quando a linha não é
de progresso ou está torta.

## Na estação

```python
from vssh import trabalhos

t = trabalhos.rodar('converter:3f2a', ['ffmpeg', '-i', entrada, saida],
                    titulo='aula-12.mkv', ao_evento=publicar)
```

```js
const { trabalhos } = require('vssh');
const t = trabalhos.rodar('converter:3f2a', ['ffmpeg', '-i', entrada, saida],
  { titulo: 'aula-12.mkv', aoEvento: publicar });
```

O processo sobe num grupo próprio. As linhas de progresso viram eventos e a atividade do trabalho
na bandeja, e as outras linhas chegam ao app. No fim, a notificação vai ao sino com o título e o
resultado, e a falha leva como motivo a última linha que o processo escreveu no stderr. Depois disso
a atividade sai. Cancelar (`t.cancelar()`) manda SIGTERM ao grupo inteiro e SIGKILL cinco segundos
depois, então um processo que abriu filhos não os deixa rodando. Um cancelamento não notifica,
porque quem cancelou já sabe.

`registrar` decide a notificação do fim: `True` (o padrão) escreve uma genérica, `False` não
escreve, e uma função recebe o registro final e devolve `{titulo, texto, level}`. `abrir` é o
caminho dentro do app aonde o clique na notificação leva (`abrir='?trabalho=3f2a'`). `acoes` e
`rota` são os botões de `avisos.notificar`, que chegam ao seu backend por POST.

## Na fila

```python
t = trabalhos.na_fila('transcrever:3f2a', pedido, titulo='Entrevista 03', ao_evento=publicar, linhas=True)
```

```js
const t = trabalhos.naFila('transcrever:3f2a', pedido, { titulo: 'Entrevista 03', aoEvento: publicar, linhas: true });
```

O `pedido` é o de `fila.submeter`. O trabalho segue o job pelos eventos do portal, e o progresso é
o que o container imprimiu pelo mesmo protocolo: quem lê a linha no log é o portal. Com `linhas`,
o log do container também chega ao app, sem as linhas de progresso.

Aqui a biblioteca não escreve atividade nem notificação. O portal já põe o job em curso na bandeja
de quem está com o ambiente aberto e avisa o fim, e escrever de novo daria duas linhas para o mesmo
trabalho. Para o aviso do portal levar a pessoa de volta ao trabalho, o pedido diz onde:
`'abrir': '?trabalho=3f2a'`.

## Os eventos

`ao_evento(evento, registro)` (`aoEvento` no Node) recebe:

| evento | quando |
|---|---|
| `estado` | o trabalho mudou de estado: `enviando`, `enviado`, `na_fila` (com o `motivo` que o cluster deu), `rodando` |
| `progresso` | o trabalho informou um progresso novo, em `registro['progresso']` |
| `linha` | uma linha do stdout que não é de progresso, em `registro['linha']` |
| `fim` | `concluido`, `falhou` ou `cancelado`, com `motivo` e `codigo` |

O `registro` é o mesmo que fica em disco. Um `ao_evento` que levanta exceção não derruba o
trabalho. `t.esperar()` devolve o registro final (em Python aceita um prazo; no Node é uma promessa),
e quando ele volta a notificação do fim já foi escrita.

## Depois de um reinício

O registro de cada trabalho mora em `$VSSH_APP_DATA_DIR/trabalhos/<chave>.json`, reescrito a cada
mudança, e `trabalhos.listar()` os devolve do mais novo ao mais velho. Chame `trabalhos.retomar()`
no boot do backend, antes de servir:

- um job da fila que estava em curso volta a ser seguido, porque ele continua no cluster;
- um processo da estação não tem volta: ele deixou de ser filho de alguém, e o stdout dele se
  perdeu. Ele é encerrado, para não segurar a GPU, e o registro vira `falhou`, com o motivo "o app
  reiniciou no meio".

Um trabalho longo na estação pede `backend.aoFechar: "manter"` no manifesto: com o padrão
`encerrar`, fechar a última janela para o backend, e o processo vai junto.

## A chave

A chave identifica o trabalho no disco e na bandeja, e segue a regra das atividades do shell:
letras, números, `:`, `.` e `-`, até 64 caracteres. Uma chave tem um trabalho em curso de cada vez;
pedir outro com a mesma chave levanta erro. Uma boa chave diz o que é e de quê
(`transcrever:<hash do arquivo>`), para o app reencontrar o trabalho de um arquivo depois de um
reinício.
