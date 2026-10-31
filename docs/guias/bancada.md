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
Uma medida piora quando a cabeça passa a base em mais de 15% e da folga; na comparação pela
mediana, ela também precisa ficar acima da pior rodada da base. O código de saída é 1 com piora.

`aa` compara a pasta com ela mesma e publica o ruído de cada medida: a diferença entre os dois
lados e o espalhamento das rodadas. Um A/A que reprova é uma medida que a regra não sabe julgar
naquela máquina, e a saída é dar folga a ela ou fazer a cena medir mais vezes.

`calibrar` roda a sonda do aparelho (`api/afericao/sonda.js`, o mesmo código que mediu o Celeron) e
acha o multiplicador do estrangulamento da CPU que leva a página a 100. É o que `comparar` e `aa`
fazem antes das rodadas, a menos que `--cpu <n>` fixe um. O estrangulamento alcança só a thread
principal: a rasterização e o WebGL rodam no processo da placa, na velocidade dela. Por isso o
perfil padrão (`--placa software`) usa o SwiftShader, a placa de um runner sem GPU.

Um app que precisa de dados para medir (um caderno de dez mil notas, uma conta ligada) traz
`bancada/preparar.mjs`, com a função `preparar({ home, dados, app, manifesto, lado })` do palco
da ajuda. Ela roda uma vez em cada lado, escreve na HOME e nos dados daquele lado, e devolve o que
a ponte responde à janela, na mesma forma do `ajuda/palco.mjs` ([A ajuda do seu app](ajuda.md)).

A base roda sem build e sem `npm install`, como o pacote publicado roda no servidor: o `dist/` do
frontend e do backend vai commitado.

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
