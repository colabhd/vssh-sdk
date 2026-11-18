# As figuras de um app com dois Tuffs

Um app carrega o Tuff do ambiente (`_sdk/tuff/`), sem cópia. Uma mudança numa folha ou num script
do Tuff chega a todo app publicado no deploy seguinte, e o autor do app não a viu. Este guia
compara, antes do deploy, as figuras da ajuda de um app com o Tuff publicado e com o Tuff da
mudança. Ele serve a quem muda o Tuff no sistema e a quem quer ver o próprio app com um Tuff que
ainda não saiu.

O que o Tuff promete manter, pelo nome, está em
[O contrato com os apps](../aparencia/o-tuff.md#o-contrato-com-os-apps). O contrato segura os
nomes. O desenho de uma peça pode mudar, e é isso que as figuras mostram.

## A comparação

```bash
node scripts/tuff-antes-e-depois.mjs <diretório do app> \
  --depois <pasta do Tuff com a mudança> \
  --saida <pasta>
```

`--depois` é a pasta do Tuff da mudança: `vssh-client/tuff` de um checkout do sistema. A referência
é `api/tuff/` deste checkout, que é o Tuff que o canal publicou, e `--antes` aponta outra.

O comando roda o [palco do app](ajuda.md) com cada cópia no lugar de `_sdk/tuff/`: a mesma cena,
os mesmos passos, a mesma janela. A figura de cada passo com o Tuff de antes é comparada com a de
depois, pixel a pixel. O app precisa do que o palco precisa: a ajuda com passos que apontam os
alvos do `alvos.json`, um Chrome e o backend que sobe na máquina.

A cópia de antes roda duas vezes. Uma janela com o cursor de texto piscando, ou com um desenho que
se acomoda sozinho, dá figuras diferentes com o mesmo Tuff. A figura que muda entre as duas
rodadas de antes é instável, e sai da conta do que mudou.

## O que sai

Na pasta de saída, que o comando refaz a cada rodada:

| | |
|---|---|
| `comparacao.html` | a página para olhar: cada figura que mudou com a de antes, a de depois e os pixels diferentes marcados, lado a lado |
| `comparacao.json` | a conta: as figuras iguais, as que mudaram com a caixa da diferença, as instáveis, e os passos que pararam |
| `antes/`, `antes-de-novo/`, `depois/` | a saída do palco de cada rodada |
| `diferenca/` | uma imagem por figura que mudou, com os pixels diferentes marcados |

No terminal, uma linha por fato:

```text
FIGURAS=23
IGUAIS=20
MUDARAM=1
MUDOU=nova-nota-0-1: 4214 px numa caixa de 662x264 em (490, 486)
INSTAVEL=mapa-0-1: 146 px entre duas rodadas com o Tuff de antes
FALTA_NOVA=ajuda/exportar.md:12: o alvo exportar não apareceu na janela
```

O comando sai com 0 quando a comparação roda, mude o que mudar. Ele sai com 3 quando o palco não
tem como rodar, e diz o motivo em `SEM_PALCO`.

## Ler o resultado

`MUDOU` é uma figura diferente. As três imagens da página dizem se a mudança é a que você quis
fazer. A mudança de propósito entra no "O que mudou" da versão do ambiente e na seção do Tuff do
[MIGRATION.md](../../MIGRATION.md#o-tuff-o-que-muda-e-o-que-fica). A que apareceu sem querer volta
antes de integrar.

`FALTA_NOVA` é um passo que andava com o Tuff de antes e para com o de depois: o controle deixou de
aparecer, mudou de nome ou saiu do alcance do clique. `SO_ANTES` é a figura que só a rodada de
antes tirou, pelo mesmo motivo. As duas dizem que a mudança quebrou o app. Uma falta que o app já
tinha com o Tuff de antes fica fora dessa lista.

`INSTAVEL` é uma figura que muda com o mesmo Tuff. A comparação não a julga: abra a de `antes/` e
a de `depois/` e olhe.

A instabilidade é medida numa rodada só. Um cursor de texto pisca em qualquer figura com um campo
em foco, e pode cair apagado só na rodada de depois: a figura aparece então em `MUDOU`, com uma
diferença de poucas dezenas de pixels numa caixa estreita, da altura de uma linha. A página mostra
o cursor no lugar da diferença, e a figura não mudou.

A comparação vê o recorte de cada passo da ajuda, e nada além dele. Uma tela que nenhum tópico
mostra não entra, e um app sem ajuda com passos não tem figura para comparar.

## O roteiro de quem muda o Tuff

Antes de integrar uma mudança no Tuff do sistema, com o checkout do sistema e este lado a lado:

1. No sistema, `node scripts/contrato-do-tuff.js` confere que nenhum nome do contrato saiu.
2. Aqui, a comparação em cada app que tem ajuda com passos, com `--depois` na pasta do Tuff do
   sistema. Os dois templates moram neste repositório (`templates/hello-vssh-app` e
   `templates/hello-vssh-app-node`). O Prelo, o Lápis, o Cavalete e o Escriba pedem o checkout de
   cada um, no commit publicado.
3. Cada `comparacao.html` com figura mudada é olhada. O que mudou de propósito vai para o "O que
   mudou" e para o MIGRATION.md, com a figura de antes e a de depois. O que mudou sem querer volta.
4. Uma `FALTA_NOVA` ou um `SO_ANTES` segura a mudança até o passo voltar a andar.

O autor de um app faz o passo 2 sozinho, com o checkout do sistema na mudança que ele quer ver.
