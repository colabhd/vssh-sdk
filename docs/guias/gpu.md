# GPU

Ao terminar este guia você sabe como declarar o que o seu app quer de GPU, o que o lançador faz
com a declaração, como o backend e a janela perguntam o que receberam, e o que o ambiente contém
e o que ele não contém.

## Declarar no manifesto

```json
{ "recursos": { "gpu": { "modo": "opcional" } } }
```

`modo` tem dois valores. `opcional` sobe com ou sem placa, e o app pergunta o que recebeu.
`necessaria` recusa subir num servidor sem GPU utilizável (e também quando o servidor não sabe
responder): a recusa vira uma falha de start com o motivo no `run.log` e no estado do serviço,
sem laço de reinício. A grafia anterior, `gpu: true`, continua aceita e vale como `opcional`.

Declarar faz duas coisas, e elas são independentes.

A primeira é descoberta, e ela é genérica. Na subida, o `vssh-app-run` pergunta ao servidor o que
há de GPU, pelo `vssh-gpu-info`, que consulta o kernel (`/sys/class/drm` e `/dev/dri`) em vez de um
SDK. A resposta cobre NVIDIA, AMD, Intel, virtio e placa virtual, com o fabricante (pelo id PCI), o
driver, se é virtual, e se o processo consegue abrir o render node. Esta última é a que mais trava
gente: o dispositivo existe e o usuário não está no grupo `render` (`usermod -aG render <usuario>`).
Nada disso depende de driver proprietário.

A segunda é o portão, e ele é só de CUDA. Quem não declara recebe `CUDA_VISIBLE_DEVICES=""`, e o
runtime CUDA não enumera dispositivo nenhum; é o que deixa um app de inferência conviver com os
vizinhos que não pediram a placa. Quem declara não recebe a variável.

O veredito fica em quatro estados, gravados em `~/.vssh-apps/<id>/limits.json` (com o motivo em
`gpuMotivo` quando a placa não veio) e mostrados no gerenciador de tarefas:

| `gpu` | quer dizer |
|---|---|
| `negada` | o app não pediu |
| `concedida` | pediu, e o servidor tem uma placa utilizável |
| `sem-gpu` | pediu, e o servidor não entrega, com o motivo no `run.log` |
| `nao-sei` | pediu, e não deu para consultar (um servidor sem o `vssh-gpu-info`) |

A quarta é diferente da terceira: um servidor que não sabe responder é outra coisa que um servidor
sem placa, e é por isso que `necessaria` recusa nos dois casos. Com `opcional`, GPU ausente costuma
significar "mais lento", e quem sabe se dá para seguir em CPU é o app; o motivo fica dito no log.

## Perguntar o que o app recebeu

No backend, `vssh.gpu.concedida()` lê o veredito que o lançador gravou e devolve a mesma resposta
nas duas línguas: `{ concedida, dispositivos, motivo }`, com os dispositivos do inventário a que
o processo tem acesso e o motivo quando a placa não veio.

```python
from vssh import gpu
veredito = gpu.concedida()
if not veredito["concedida"]:
    registrar(f"seguindo em CPU: {veredito['motivo']}")
```

```js
const { gpu } = require('vssh');
const { concedida, dispositivos, motivo } = gpu.concedida();
```

Na janela, `vssh.gpu.estado()` responde com a mesma forma, e é o que permite esconder o botão
"acelerar por GPU" num servidor sem placa e dizer o motivo certo quando algo falta, porque "sem
GPU" e "a placa existe e você não tem permissão" pedem ações opostas.

```js
const { concedida, motivo } = await vssh.gpu.estado();
```

Quem quiser ver por dentro lê o mesmo que o ambiente lê. Do manifesto sai o que se pediu; do
processo sai o que se recebeu:

```js
const fs = require('node:fs');
const cuda = process.env.CUDA_VISIBLE_DEVICES;      // undefined se declarou gpu; '' se não declarou
const cartoes = fs.readdirSync('/sys/class/drm').filter((c) => c.startsWith('card') && !c.includes('-'));
```

Para o render node, `/sys/class/drm/card0/device/drm/renderD*` diz o caminho em `/dev/dri`, e
tentar abri-lo diz se este processo tem acesso. Para a contenção de memória, `/proc/self/cgroup`
aponta o cgroup, e `memory.max` dentro dele diz o teto que está valendo (`max` é o valor do kernel
para "sem teto"). Os dois templates do toolkit trazem uma peça de galeria que faz exatamente essas
leituras e as mostra ao lado do que o manifesto pediu.

A entrada de vídeo por hardware é por driver, e o par vale saber antes de escolher um codec:
NVIDIA codifica por NVENC, sem render node, e o driver proprietário não fala VA-API; Intel (`i915`,
`xe`) e AMD (`amdgpu`, `radeon`) codificam por VA-API. `nouveau` decodifica por VA-API e não
codifica.

## O que o ambiente contém, e o que não contém

O portão é arbitragem por convenção. A variável é respeitada pelo runtime CUDA; ela não fecha
`/dev/dri` nem `/dev/nvidia*`, e um processo determinado a ignorá-la (OpenGL, Vulkan, um
`nvidia-smi` direto) alcança a placa. A fronteira de verdade seria controle de dispositivo no
cgroup, que no cgroup v2 é eBPF, só root, e o `vssh-app-run` roda como o usuário. Chamar o que
existe de isolamento seria prometer o que não se entrega.

A memória, sim, é contida: o app sobe num escopo do systemd com `MemoryHigh` e `MemoryMax`, e um
treino que cresce sem controle é pressionado antes de ser morto, em vez de levar a sessão inteira
junto. A memória da placa fica fora disso.

## Os limites do espaço `vssh.gpu`

Dois limites são decisão:

- o espaço não pede a placa. Pedir é o `recursos.gpu` do manifesto, aplicado na subida, porque o
  ambiente de um processo é fixado no `spawn` e um pedido em runtime não teria a quem chegar;
- o espaço não mede uso. Quanto de memória da placa o app está ocupando é pergunta do gerenciador
  de tarefas, e a resposta lá vem do servidor.

O que fica em aberto é a arbitragem entre dois apps que pediram a mesma placa. Hoje os dois a
recebem inteira, e quem reparte é o driver.
