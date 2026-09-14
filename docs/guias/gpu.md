# GPU

Ao terminar este guia você sabe o que declarar `gpu: true` faz hoje, como o seu backend lê o
veredito do servidor de dentro do processo, o que o ambiente contém e o que ele não contém. A
última seção é desenho: o espaço `vssh.gpu`, que a sub-etapa da etapa 5 responsável por ele ainda
não implementou. Nada do que está lá existe no sistema de hoje, e nenhum app depende disso.

## O que existe: declarar no manifesto

```json
{ "gpu": true }
```

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

O veredito fica em quatro estados, gravados em `~/.vssh-apps/<id>/limits.json` e mostrados em
Configurações, na seção Serviços:

| `gpu` | quer dizer |
|---|---|
| `negada` | o app não pediu |
| `concedida` | pediu, e o servidor tem uma placa utilizável |
| `sem-gpu` | pediu, e o servidor não entrega, com o motivo no `run.log` |
| `nao-sei` | pediu, e não deu para consultar (um servidor sem o `vssh-gpu-info`) |

A quarta não é a terceira: um servidor que não sabe responder não é um servidor sem placa. E
declarar num servidor sem GPU não impede o app de subir. GPU ausente costuma significar "mais
lento", e quem sabe se dá para seguir em CPU é o app; o motivo fica dito no log.

## O que existe: ler o veredito de dentro do app

O backend lê o mesmo que o ambiente lê, e a leitura é a única resposta que não é suposição. Do
manifesto sai o que se pediu; do processo sai o que se recebeu:

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

## Desenho: `vssh.gpu`

O que segue é desenho. A sub-etapa da etapa 5 que o implementa ainda não pousou, e os nomes abaixo
podem mudar até lá.

O espaço `vssh.gpu` abstrairia a pergunta "o que este app pode usar de GPU neste servidor", feita
do frontend, com a mesma resposta que o `limits.json` já carrega: o estado (`negada`, `concedida`,
`sem-gpu`, `nao-sei`), o inventário (fabricante, driver, virtual, acesso ao render node) e as APIs
que o servidor tem (CUDA, ROCm, Vulkan, OpenCL, VA-API, NVENC). O app usaria isso para esconder o
que não faz sentido (um botão "acelerar por GPU" num servidor sem placa) e para dizer o motivo
certo quando algo falta, porque "sem GPU" e "a placa existe e você não tem permissão" pedem ações
opostas.

Dois limites já decididos no desenho:

- o espaço não pediria a placa. Pedir continua sendo o `gpu: true` do manifesto, decidido na
  instalação e aplicado na subida, porque o ambiente de um processo é fixado no `spawn` e um
  pedido em runtime não teria a quem chegar;
- o espaço não mediria uso. Quanto de memória da placa o app está ocupando é pergunta do
  gerenciador de tarefas, e a resposta lá vem do servidor.

O que o desenho deixa em aberto é a arbitragem entre dois apps que pediram a mesma placa. Hoje os
dois a recebem inteira, e quem reparte é o driver.
