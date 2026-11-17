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

O comando sobe destacado do backend, por um executor do runtime, que é o pai dele: grava o stdout
e o stderr em arquivos, num diretório do trabalho em `~/.cache/vssh/trabalhos/<id>/`, e escreve o
fim por último. O backend segue o trabalho lendo esses arquivos. As linhas de progresso viram
eventos e a atividade do trabalho na bandeja, e as outras linhas chegam ao app. No fim, a
notificação vai ao sino com o título e o resultado, e a falha leva como motivo a última linha que o
comando escreveu no stderr. Depois disso a atividade sai, e o diretório do trabalho também.

Cancelar (`t.cancelar()`) manda SIGTERM ao grupo do comando e SIGKILL cinco segundos depois, então
um comando que abriu filhos não os deixa rodando. O comando que quer limpar o que fez pela metade
trata o SIGTERM e sai dentro desses cinco segundos. Um cancelamento não notifica, porque quem
cancelou já sabe.

Com a estação cheia, o trabalho cede a vez: o agente do sistema leva o grupo do comando a `nice`
19 e ao disco ocioso, como faz com uma cópia de arquivos, e devolve o disco quando ela folga.

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
o que o container imprimiu pelo mesmo protocolo: quem lê a linha é o portal, que segue o log do
container enquanto o job roda e repassa o progresso novo no máximo a cada 2 s, sempre com o último
que leu. Com `linhas`, o log do container também chega ao app, sem as linhas de progresso e sem as
marcas do invólucro do portal.

O job roda num Job do Kubernetes, com a imagem do pedido, num contêiner só. Por isso o pedido e a
imagem seguem estas regras:

- o `comando` vai inteiro, porque o Job ignora o `ENTRYPOINT` da imagem. O `PATH` e o resto do
  `ENV` dela continuam valendo;
- o comando roda num diretório com `entradas/` e `saidas/`, que `VSSH_ENTRADAS` e `VSSH_SAIDAS`
  apontam. As entradas do pedido já estão em `entradas/`, e só volta como saída o que o comando
  escreve em `saidas/` com um nome que o pedido lista;
- o comando aguenta recomeçar do zero. O cluster tira um job do nó quando uma carga de prioridade
  maior precisa da placa ou o disco do nó aperta, e o Job sobe outro pod: as entradas descem de
  novo, o comando roda desde o começo e o progresso volta para trás. Enquanto isso o job continua
  `rodando`, com o motivo "o pod saiu do nó; retomando".

Entre o envio e o comando rodando, o job espera a fila do Kueue do sítio e o download da imagem, e
fica em `na_fila` enquanto isso, com o motivo de cada espera ("esperando uma placa livre",
"esperando um nó com memória livre"). Uma espera que o portal não reconhece chega com a mensagem do
cluster, em inglês. O download acontece uma vez em cada nó, e numa imagem de dezenas de GB essa vez
leva minutos ("baixando a imagem"). Já `rodando`, o job tem o motivo "baixando as entradas" antes do
comando e "subindo as saídas" depois dele, enquanto o invólucro do portal faz um dos dois.

Um pedido de GPU sem `tipo` aceita os tipos padrão da fila. O portal lê a fila de cada sítio e
manda o job primeiro aonde a placa está livre agora. Um job que espera num sítio sem ser admitido
(10 min em SP, 30 min em Franca) vai ao sítio seguinte que tenha lugar, com o motivo "indo para
Franca" enquanto o Job de antes sai. O Kueue devolve à fila o job cujo pod não fica pronto no prazo
dele, e no primeiro job de um nó o download da imagem pode durar mais que esse prazo. Esse job conta
a espera de novo no mesmo sítio, onde a imagem continua descendo.

Aqui a biblioteca não escreve atividade nem notificação. O portal já põe o job em curso na bandeja
de quem está com o ambiente aberto e avisa o fim, e escrever de novo daria duas linhas para o mesmo
trabalho. Para o aviso do portal levar a pessoa de volta ao trabalho, o pedido diz onde:
`'abrir': '?trabalho=3f2a'`.

### Várias saídas, cada uma quando fica pronta

Um job que produz várias saídas independentes (um lote de áudios, um arquivo por página) pode
entregar cada uma assim que ela existe, com `'saidasAoVivo': True` no pedido. O invólucro do portal
sobe a saída listada que aparece em `saidas/`, com o comando ainda rodando, e o app recebe o evento
`saida` com o nome dela; `fila.baixar` a alcança na hora, sem esperar o fim do job.

A saída que aparece está pronta, e é esse o contrato: o comando a escreve com outro nome, ou fora de
`saidas/`, e a renomeia para o nome listado. Um arquivo escrito no lugar subiria pela metade. No fim,
o invólucro sobe de novo só a saída que mudou depois de subir.

```python
def publicar(evento, r):
    if evento == 'saida':
        fila.baixar(r['job'], pasta, [r['saida']['nome']])
```

Cada saída chega uma vez em cada acompanhamento. Depois de um `retomar()`, as que já tinham subido
chegam de novo, e o app confere se já as tem. Um portal anterior às saídas ao vivo ignora o campo, e
todas chegam no fim, pelo caminho de sempre.

### A imagem do job

A imagem precisa de bash e de curl ou python3. Quem roda o comando é um invólucro do portal, em
bash, que baixa as entradas antes e sobe as saídas depois, pelo curl ou, sem ele, pelo python3. Sem
bash o contêiner não sobe, e o job termina em `falhou` com o motivo `imagem`. Sem curl nem python3
nada viaja: um job com entradas falha na primeira delas, antes do comando, e um sem entradas roda
o comando, mas as saídas não voltam. A `alpine` pura não tem bash, e a `nvidia/cuda:*-base` não tem
nem curl nem python3.

Uma imagem de GPU não precisa trazer o driver nem o `nvidia-smi`: os dois vêm do nó junto com a
placa, pelo runtime da NVIDIA. A `python:3.12-slim` serve de partida: com o torch do pip, ela já
roda na placa.

```text
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY motor/ /opt/meu-motor/
```

Cada nó baixa a imagem uma vez e a guarda. Uma etiqueta fixa (`:0.3.1`, ou um digest) é baixada
só quando falta no nó; `latest`, ou nenhuma etiqueta, é conferida no registro a cada job.

## Os eventos

`ao_evento(evento, registro)` (`aoEvento` no Node) recebe:

| evento | quando |
|---|---|
| `estado` | o trabalho mudou de estado, ou o motivo dele mudou: `enviando`, `enviado`, `na_fila` (com o `motivo` da espera), `rodando` (com o `motivo` das entradas e das saídas) |
| `progresso` | o trabalho informou um progresso novo, em `registro['progresso']` |
| `linha` | uma linha do stdout que não é de progresso, em `registro['linha']` |
| `saida` | na fila, num pedido com `saidasAoVivo`: uma saída que subiu com o job rodando, em `registro['saida']` (`nome` e `tamanho`) |
| `fim` | `concluido`, `falhou` ou `cancelado`, com `motivo` e `codigo` |

O `registro` é o mesmo que fica em disco. Um `ao_evento` que levanta exceção não derruba o
trabalho. `t.esperar()` devolve o registro final (em Python aceita um prazo; no Node é uma promessa),
e quando ele volta a notificação do fim já foi escrita.

## Depois de um reinício

O registro de cada trabalho mora em `$VSSH_APP_DATA_DIR/trabalhos/<chave>.json`, reescrito a cada
mudança, e `trabalhos.listar()` os devolve do mais novo ao mais velho. Chame `trabalhos.retomar()`
no boot do backend, antes de servir:

- um job da fila que estava em curso volta a ser seguido, porque ele continua no cluster;
- um trabalho da estação continuou rodando sem o backend, porque o comando não é filho dele. O
  que o `retomar()` faz com esse trabalho, quem decide é o `rodar`.

```python
t = trabalhos.rodar('converter:3f2a', comando, titulo='aula-12.mkv', ao_evento=publicar, retomavel=True)
```

```js
const t = trabalhos.rodar('converter:3f2a', comando, { titulo: 'aula-12.mkv', aoEvento: publicar, retomavel: true });
```

Com `retomavel`, o backend que volta segue o trabalho de novo: lê os arquivos de onde o anterior
tinha parado, e o fim que aconteceu com ele fora chega na volta, com a notificação. Os eventos de
um trabalho retomado vão ao `ao_evento` que você passa ao `retomar`, e por isso o app que marca um
trabalho como retomável precisa ter ali quem saiba o que fazer com eles. Sem `retomavel`, que é o
padrão, o trabalho é encerrado, para não segurar a GPU, e o registro vira `falhou`, com o motivo
"o app reiniciou no meio".

A posição lida é gravada depois da entrega de cada leva de linhas, então uma linha pode chegar de
novo depois de um reinício. O app que não pode repetir uma linha confere se já a tem. O app que
guarda na memória o que ouviu pede a saída inteira de volta, da primeira linha, e refaz o que
tinha:

```python
trabalhos.retomar(ao_evento=publicar, desde_o_comeco=True)
```

```js
trabalhos.retomar({ aoEvento: publicar, desdeOComeco: true });
```

A função de `registrar` não fica gravada com o trabalho. Num trabalho retomado que tinha uma,
`retomar(registrar=...)` a recebe de novo; sem ela, o fim escreve a notificação genérica. As outras
opções da notificação (`acoes`, `rota`, `abrir`) ficam gravadas.

No registro, `pid` é o do comando, e `executor` é o do processo que o acompanha. Um trabalho cujo
executor morreu sem escrever o fim (a memória acabou, a estação reiniciou) termina em `falhou`, com
o motivo "o trabalho parou antes de terminar".

O trabalho destacado chegou ao runtime `1.2.0`, e `desde_o_comeco` ao `1.4.0`. Num servidor com um
runtime anterior, `rodar` não conhece `retomavel`; o app que precisa rodar nos dois confere antes:

```python
import inspect
RETOMA = 'desde_o_comeco' in inspect.signature(trabalhos.retomar).parameters
```

Um trabalho longo na estação pede `backend.aoFechar: "manter"` no manifesto. Com o padrão
`encerrar`, fechar a última janela para o backend: o comando segue rodando sem ele, sem ninguém
para ouvir o que ele diz, até o backend subir de novo e o `retomar()` retomá-lo ou encerrá-lo.

### A peça de baixo

`rodar` é o disparo de um comando destacado mais o registro, os eventos e a notificação. Quem já
tem o próprio jeito de contar o que acontece usa só o disparo:

| | |
|---|---|
| `trabalhos.disparar(comando, ...)` | sobe o comando pelo executor, num diretório de trabalho novo, e devolve o diretório e o processo do executor (`{ dir, processo }` no Node). `arquivos` (`{nome: texto}`) são gravados no diretório antes de o comando subir, e o comando recebe o diretório em `VSSH_TRABALHO_DIR` |
| `trabalhos.vivo(d)` | o trabalho não escreveu o fim, e o executor está de pé |
| `trabalhos.fim(d)` | `estado`, `codigo`, `motivo` e `terminadoEm`, ou nada enquanto o trabalho roda |
| `trabalhos.grupo(d)` | o grupo de processos do comando |
| `trabalhos.encerrar(d)` | encerra o executor e o comando, sem esperar o comando limpar nada |

Cancelar um trabalho disparado assim é criar o arquivo `cancel` no diretório dele. É o que o
agente do sistema usa para as cópias de arquivos, que o ambiente segue por outro caminho. Estas
cinco funções chegaram ao runtime `1.3.0`.

## A chave

A chave identifica o trabalho no disco e na bandeja, e segue a regra das atividades do shell:
letras, números, `:`, `.` e `-`, até 64 caracteres. Uma chave tem um trabalho em curso de cada vez;
pedir outro com a mesma chave levanta erro. Uma boa chave diz o que é e de quê
(`transcrever:<hash do arquivo>`), para o app reencontrar o trabalho de um arquivo depois de um
reinício.
