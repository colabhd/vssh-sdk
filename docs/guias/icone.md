# O ícone do app

O ambiente monta o ícone de um app em camadas. O app entrega o glifo e, se quiser, um fundo; o
sistema põe a máscara e o acabamento, iguais em todo app. É por isso que um ícone do menu iniciar,
do Launchpad, da barra de tarefas e da Loja tem a mesma forma em todo tamanho, e é por isso que o
glifo de um app não desenha sombra, borda nem cantos arredondados.

## As quatro camadas

De baixo para cima:

| camada | de quem | o que é |
|---|---|---|
| fundo | do app, ou da família | sem declaração, o #15171c com a luz radial do alto à esquerda; um arquivo de 64 × 64, que pode sangrar até a borda, ou uma cor `#rrggbb` |
| glifo | do app | o desenho, com o fundo transparente |
| máscara | do ambiente | o quadrado de raio 14 no quadro de 64, 22% do lado |
| acabamento | do ambiente | um fio de 1 px por dentro da borda, claro em cima e escuro embaixo |

O portal monta as camadas num SVG só e o serve na rota de ícone de sempre, então nada muda para a
janela do app nem para o shell. O compositor é `api/icone/composicao-de-icone.ts`, o mesmo arquivo
que o portal executa.

## No manifesto

```json
{
  "id": "meu-app",
  "name": "Meu App",
  "icon": "icon.svg",
  "icone": { "glifo": "icone/glifo.svg" }
}
```

`icone.glifo` é obrigatório. `icone.fundo` é um arquivo do pacote ou uma cor:

```json
"icone": { "glifo": "icone/glifo.svg", "fundo": "icone/fundo.svg" }
"icone": { "glifo": "icone/glifo.svg", "fundo": "#1f4f8f" }
```

`icone.monocromatico` é reservado: o schema aceita o campo e o ambiente ainda não o lê.

O `icon` continua no manifesto para um portal anterior às camadas, e o arquivo dele não precisa
estar no repositório: quando o pacote não o traz, o `vssh-app-publish` o gera montado, com o mesmo
compositor, e o manda também ao repositório, de onde a Loja mostra o ícone de um app que ainda não
está instalado. Um app que declara só `icon` aparece como o arquivo é, sem montagem.

## A grade

O quadro é de 64 × 64. O glifo mora na área viva de 46 × 46, centrada (de 9 a 55 nos dois eixos),
e cada forma tem a keyline dela, porque um círculo e um quadrado da mesma largura não parecem do
mesmo tamanho:

| forma do glifo | keyline | exemplos |
|---|---|---|
| redonda | círculo de Ø 46 | a boia da Ajuda, a Lupa, a engrenagem do agente (Ø 44) |
| quadrada | 40 × 40 | as chaves do Editor, a Impressão, o l do Lápis |
| deitada | 46 × 36 | a pasta de Arquivos, o prompt do Terminal |
| em pé | 36 × 46 | a sacola da Loja, o bloco dos templates |

Um disco cheio fica abaixo da keyline, como o globo do Navegador, de Ø 42, porque pesa mais que um
anel do mesmo tamanho. O centro da caixa do glifo cai a até 2 px do centro do quadro.

O fundo é a única camada que pode sair da área viva: ele sangra até a borda, e a máscara corta os
cantos. Um fundo próprio serve quando a luz da cena é do app, como uma ribalta que ilumina de
baixo; a maior parte dos apps fica com o da família.

## A luz e o material

A luz vem do alto à esquerda, a mesma do fundo da família. Cada forma clareia para lá e leva o
reflexo curvo daquele lado, um traço branco entre 55% e 75% de opacidade. O branco quente
(#f5f2ea) é o material comum da família: o pingo do Cavalete, o aro da Lupa, a alça da Loja, o
cursor do Editor.

Um glifo tem duas formas, no máximo três. O ambiente desenha o ícone a 20 px na barra e a 22 px no
menu, e a esse tamanho uma quarta forma vira sujeira. Um texto também: o glifo é desenho, e uma
letra que precise de fonte sai diferente em cada máquina. Converta o texto em curvas.

Cada app tem um matiz. A tabela da família, com o matiz de cada app do ambiente, está na seção
"Ícones de app" do [`DESIGN.md` do Tuff](../../api/tuff/DESIGN.md#ícones-de-app). Escolha um
que nenhum outro app use, e com a mesma força dos outros sobre o fundo escuro.

## Exportar

O glifo é um SVG com `viewBox="0 0 64 64"` e o fundo transparente, ou um PNG quadrado com
transparência (256 × 256 dá margem para as telas densas).

- No Figma, desenhe num frame de 64 × 64 sem preenchimento e exporte o frame como SVG, com o texto
  convertido em contorno (Outline text).
- No Inkscape, ajuste o documento para 64 × 64 px, converta o texto em caminho (Objeto para
  caminho) e salve como SVG simples, que tira os metadados do editor.

Dê aos ids de degradê um prefixo com o nome do app (`meu-app-luz`, `meu-app-metal`). O portal põe
cada camada no SVG montado como uma imagem à parte, e os ids de uma não alcançam a outra; quem
puser dois glifos inline numa mesma página, como a galeria de um design, precisa do prefixo.

## Conferir antes de publicar

```bash
node scripts/montar-icone.mjs ~/meu-app --saida /tmp/meu-app.svg
```

O script monta o ícone com o compositor do portal, escreve o SVG em `--saida` e, quando há um
Chrome na máquina, mede o glifo. A saída é uma linha por fato:

| linha | o que diz |
|---|---|
| `MONTADO=<arquivo>` | onde o SVG montado foi escrito |
| `CAIXA=<x0 y0 x1 y1>` | a caixa do glifo no quadro de 64 |
| `FORA_DA_GRADE=<motivo>` | o glifo passa da área viva ou foge do centro |
| `NAO_MEDIDO=<motivo>` | não havia Chrome para medir |
| `ERRO=<motivo>` | uma camada não está no pacote, ou o manifesto não declara `icone` |

O `vssh-app-publish` roda o mesmo script antes de empacotar. Uma camada que falta recusa a
publicação; um glifo fora da grade vira aviso no resumo do run, com a caixa medida.
