# A bancada do seu app

O VSSH roda em aparelhos fracos, e o alvo é um Celeron dual-core com 4 GB, que a Aferição do
ambiente chama de 100. Este guia põe a janela do seu app na bancada: as cenas que medem o que a
janela faz, o "Medir este aparelho" que roda as mesmas cenas no aparelho de quem usa, e a
comparação de cada PR com a base no CI.

## As cenas

Uma cena monta o que mede, faz o gesto pelo código da janela e devolve os números. O lugar de
costume é `bancada/cenas.mjs`, e a janela registra a lista no SDK web quando sobe:

```js
import { cenas } from '../bancada/cenas.mjs';
vssh.desempenho.cenas(cenas);
```

```js
export const cenas = [{
  id: 'nota-grande',
  nome: 'Digitar numa nota de 1 MB',
  medidas: {
    tecla: { rotulo: 'tecla (p95)', unidade: 'ms', folga: 4 },
    perdidos: { rotulo: 'quadros perdidos ao rolar', unidade: 'contagem', folga: 6 },
    memoria: { rotulo: 'memória do editor', unidade: 'ms', informa: true },
  },
  async rodar({ quadro, sinal }) {
    const amostras = [];
    for (const letra of 'uma frase comum') {
      const t0 = performance.now();
      editor.inserir(letra);   // o gesto, pelo código da janela
      await quadro();           // o quadro que ele pediu
      amostras.push(performance.now() - t0);
    }
    return { tecla: amostras, perdidos: await rolar(quadro), memoria: 0 };
  },
}];
```

A cena roda dentro da janela, e por isso o laboratório, o "Medir este aparelho" e o aparelho de
referência medem a mesma coisa. O gesto é o do código do app (uma transação do editor, um ponto
entregue ao motor de desenho), e a medida é o trabalho da janela, sem a fila de eventos do
navegador na frente.

Cada medida declara a `unidade` (`ms`, `razao` ou `contagem`, e em todas maior é pior), e quando
cabe a `folga`, a diferença que ainda não conta como piora, e `informa`, que deixa a medida na
tabela sem reprovar. A função devolve, para cada medida:

- um número por rodada, que o laboratório compara pela mediana das rodadas;
- ou uma lista de amostras, que ele compara pelo p95 das amostras de todas as rodadas juntas. O p95
  de uma rodada só é praticamente a amostra mais lenta dela.

A cena que não cabe no aparelho (uma folha maior que a memória dele) devolve
`{ pulada: '<motivo>' }`. O `sinal` interrompe entre uma cena e outra, e `quadro()` resolve no
`requestAnimationFrame` seguinte.

`sossegar()` espera a janela ficar um segundo inteiro sem tarefa longa, com teto de 20 s
(`sossegar({ ms, teto })` muda os dois). Chame-o entre o preparo e a medida, e entre uma medida e a
seguinte: o que o preparo deixou para depois (uma rolagem até o cursor, as imagens que chegam, uma
compilação) cairia na primeira amostra, e uma espera fixa não sabe quanto isso leva num aparelho
lento.

```js
async rodar({ quadro, sossegar }) {
  abrirDocumentoGrande();
  await sossegar();        // a janela termina o que a abertura agendou
  const amostras = [];
  for (const letra of 'uma frase comum') {
    const t0 = performance.now();
    editor.inserir(letra);
    await quadro();
    amostras.push(performance.now() - t0);
  }
  return { tecla: amostras };
}
```

## O "Medir este aparelho" do app

O app roda as cenas no aparelho de quem usa com `vssh.desempenho.rodarCenas`, e manda o resultado
à equipe do VSSH com `vssh.desempenho.mandarMedida`, que pergunta à pessoa antes:

```js
const resultado = await vssh.desempenho.rodarCenas({
  aoProgredir: ({ feitas, total }) => botao.textContent = `Medindo: ${feitas + 1} de ${total}`,
});
await vssh.desempenho.mandarMedida(resultado);
```

## O laboratório

`scripts/vssh-bancada.mjs` sobe a janela como o palco da ajuda: o backend do app numa porta de
bancada, o `_sdk/` de `api/`, e um quadro no papel do shell, que pede as cenas à janela. Na sua
máquina, com um Chrome instalado:

```bash
node ../vssh-sdk/scripts/vssh-bancada.mjs comparar . --base origin/main
node ../vssh-sdk/scripts/vssh-bancada.mjs aa .
node ../vssh-sdk/scripts/vssh-bancada.mjs calibrar
```

`comparar` sobe a base (um worktree do ref, com o que estiver commitado nele) e a pasta atual lado
a lado, cada uma com a própria HOME e os próprios dados, e alterna as rodadas na ordem base,
cabeça, cabeça, base: numa máquina compartilhada a mesma build varia mais de uma rodada para outra
do que a maior parte das mudanças, e o que a máquina fizer durante a medida cai nos dois lados.
Uma medida piora quando a cabeça passa a base em mais de 15% e da folga. Na comparação pela
mediana, ela também precisa ficar acima da pior rodada da base. Na das amostras, a mediana dos p95
de cada rodada também precisa passar a da base: uma rodada em que a página perdeu a vez para a
máquina sobe o p95 juntado sozinha, e uma piora de verdade move as duas. O código de saída é 1 com
piora.

Depois das cenas, a bancada deixa a janela parada e conta pelo CDP os layouts e o tempo de CPU da
página em 10 s (`--parada <s>` muda a janela, e `--parada 0` a desliga). Antes de contar, ela
espera metade desse tempo, para o que a última cena agendou terminar. Uma janela parada não faz
layout: sem tecla, rolagem ou evento, nada se anima sozinho e nada redesenha a tela. Por isso
qualquer layout numa rodada da cabeça reprova, mesmo que a base também o tenha. O tempo de CPU só
informa, porque o protocolo do CDP e o coletor de lixo também caem nele.

No fim da parada a bancada roda a coleta de lixo e conta os nós do DOM e o heap: o que as cenas
deixaram preso. Uma closure que nasce dentro de um documento e fica num lugar que dura a janela
inteira (um tratador num elemento fixo, uma função guardada num módulo, até uma função vazia criada
dentro da closure) segura o documento fechado, e a janela cresce a cada um, sem layout e sem CPU
nenhuma. Os nós reprovam quando a cabeça passa a base além da folga de 300; o heap só informa. Para
achar quem segura, um heap snapshot pelo CDP (`HeapProfiler.takeHeapSnapshot`) e o caminho mais
curto da raiz até um nó com `detachedness` 2.

`aa` compara a pasta com ela mesma e publica o ruído de cada medida: a diferença entre os dois
lados e o espalhamento das rodadas. Um A/A que reprova é uma medida que a regra não sabe julgar
naquela máquina, e a saída é dar folga a ela ou fazer a cena medir mais vezes.

`calibrar` roda a sonda do aparelho (`api/afericao/sonda.js`, o mesmo código que mediu o Celeron) e
acha o multiplicador do estrangulamento da CPU que leva a página a 100. É o que `comparar` e `aa`
fazem antes das rodadas, a menos que `--cpu <n>` fixe um. O estrangulamento alcança só a thread
principal: a rasterização e o WebGL rodam no processo da placa, na velocidade dela. Por isso o
perfil padrão (`--placa software`) usa o SwiftShader, a placa de um runner sem GPU.

Um Web Worker também fica de fora: o CDP recusa o estrangulamento na sessão de um Worker, e o que a
janela manda a ele roda na velocidade da máquina do laboratório, várias vezes a do Celeron. A tabela
diz quanto. Uma cena que espera um Worker (uma compilação, uma decodificação) mede bem o que a
thread da página gasta enquanto isso, e mede otimista a espera em si: deixe essa latência como
`informa`, e registre a mesma medida no campo por `vssh.desempenho.registrar`, que roda no aparelho
de quem usa. Levar trabalho da página a um Worker sempre parece de graça no laboratório; num
Celeron de dois núcleos ele alivia a thread da janela, e a espera continua do mesmo tamanho.

Um app que precisa de dados para medir (um caderno de dez mil notas, uma conta ligada) traz
`bancada/preparar.mjs`, com a função `preparar({ home, dados, app, manifesto, lado })` do palco
da ajuda. Ela roda uma vez em cada lado, escreve na HOME e nos dados daquele lado, e devolve o que
a ponte responde à janela, na mesma forma do `ajuda/palco.mjs` ([A ajuda do seu app](ajuda.md)).

A base roda sem build e sem `npm install`, como o pacote publicado roda no servidor: o `dist/` do
frontend e do backend vai commitado.

## No aparelho de quem usa

O laboratório compara versões; o campo diz como o app se comporta nos aparelhos de verdade, por
classe da Aferição e sem quem usa, na página Desempenho do VSSH. O SDK web mede três coisas dentro
da janela de todo app, sem o app fazer nada:

| medida | o que conta |
|---|---|
| `_tecla` | do instante em que o navegador criou o keydown ao quadro seguinte pintado, com a espera atrás de uma tarefa longa |
| `_clique` | o mesmo, do pointerdown |
| `_tarefa` | cada tarefa de 50 ms ou mais na thread da janela |

O que só o app sabe medir (o traço, a abertura de um documento, a espera por um Worker) ele declara
no manifesto, em `desempenho.medidas`, com a experiência e a unidade, e registra pela ponte:

```json
"desempenho": {
  "medidas": {
    "previa": { "experiencia": "ambiente", "unidade": "ms" }
  }
}
```

```js
const fim = vssh.desempenho.medir('previa');
await compilarEMostrar();
fim();
```

Um nome que o manifesto instalado não declara o portal recusa, e a medida some sem erro nenhum. Os
nomes que começam por `_` são da plataforma, e um manifesto não pode usá-los.

## No CI

```yaml
on:
  pull_request:
  push:
    branches: [main]
jobs:
  bancada:
    uses: colabhd/vssh-sdk/.github/workflows/_bancada-app-reusable.yml@main
    with:
      runner: colabhd-franca
```

A base é o ramo de destino num PR e o commit anterior num push. A tabela sai no resumo do run, e as
rodadas cruas num artefato. `modo: aa` mede o ruído, e vale rodar uma vez quando as cenas mudam.
