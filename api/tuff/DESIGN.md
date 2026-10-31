# Tuff: a direção visual

Este arquivo diz o que o ambiente quer parecer e por quê. Os valores moram em `tuff-tokens.css` e
as peças em `tuff.css`; aqui fica o motivo de cada escolha grande, numa linha, para quem desenha
uma tela nova, para quem revisa uma, e para o anti-slop, que lê este arquivo como a direção do dono
(R-37) antes de filtrar. Um vssh-app recebe o mesmo arquivo pelo vssh-sdk, em `api/tuff/DESIGN.md`.

O desenho de cada tela está nas pranchetas do protótipo do VSSH-359, que são a referência do
rework. Uma regra daqui que o código ainda não segue tem card próprio no VSSH-356.

## A leitura

Lendo como: ambiente de trabalho remoto para pesquisa, com documentos, dados, código e mídia, usado
por pesquisadores e estudantes em sessões longas, numa linguagem de ferramenta de ofício, calma e
material.

Dial: ENERGY 1 / RHYTHM 1 / MOTION 1

O conteúdo da pessoa é o foco de toda janela. A moldura do ambiente fica quieta para o documento, a
planilha, o terminal e o vídeo falarem. Energia 1 porque ninguém abre o ambiente para olhar o
ambiente; ritmo 1 porque uma janela de ferramenta se reconhece pela repetição (a mesma barra, a
mesma lista, o mesmo rodapé); movimento 1 porque animação numa ferramenta de sessão longa cansa.

## Identidade

O nome vem do tufo, a pedra vulcânica porosa que se corta em blocos para construir. Dele saem as
três escolhas que dão identidade ao ambiente:

- O estrato. As superfícies são camadas de pedra (`--ds-bg`, `--ds-bg2`, `--ds-bg3`), cada uma um
  degrau acima da outra, separadas por um fio de 1 px. O fio é o gesto que se repete na barra, no
  rodapé, no divisor e na lateral. Profundidade vem do degrau de cor, e não de sombra difusa nem de
  vidro.
- O traço de gravura. Os ícones da interface têm 16 × 16, traço 1,5 e pontas redondas, numa família
  só para o shell e para os apps. O traço tem a espessura do fio, e o ícone herda a cor do texto ao
  lado. É o visual de biblioteca de traço fino que o anti-slop lista entre os padrões; aqui ele
  fica, porque é o par do fio e porque um ícone de outra família denuncia a janela que não é do
  ambiente. Os ícones de arquivo ficam fora dessa regra e têm a família deles (abaixo), porque
  representam o conteúdo da pessoa, e não um controle.
- A cor é da pessoa. A moldura não tem matiz próprio: os degraus são cinza, a cor de destaque sai
  de Configurações, e a paleta é medida contra todas as opções de lá. A cor forte do ambiente fica
  com o que é da pessoa: os arquivos dela e a cor que ela escolheu.

## Paleta

A paleta é a neutra: os degraus da pedra em cinza puro, sem destaque próprio, para segurar qualquer
cor que a pessoa escolher. Nenhum degrau vem do tema de um editor conhecido, o que o anti-slop
chamaria de cópia de produto (R-30).

| papel | token | valor |
|---|---|---|
| página | `--ds-bg` | `#1b1b1b` |
| peça | `--ds-bg2` | `#222222` |
| sobre a peça | `--ds-bg3` | `#2b2b2b` |
| campo | `--ds-bg-input` | `#353535` |
| fio | `--ds-border` | `#454545` |
| contorno de campo | `--ds-border-input` | `#707070` |
| texto | `--ds-text` | `#d8d8d8` |
| texto forte | `--ds-text-mid` | `#ededed` |
| texto apagado | `--ds-text-dim` | `#a0a0a0` |

Contraste medido (WCAG):

- texto: 12,08 sobre a página e 8,61 sobre o campo;
- texto apagado: 6,59 sobre a página, 6,08 sobre a peça, 5,41 sobre o terceiro degrau e 4,69
  sobre o campo;
- o contorno de campo: 3,21 sobre a peça. O campo se acha pelo contorno, e não só pelo degrau de
  fundo, que fica em 1,30.

### A cor de destaque

A pessoa escolhe entre sete cores em Configurações, e o azul é o padrão de quem não escolheu. Cada
uma passa de 5:1 com o texto que vai sobre ela:

| cor | valor | texto sobre ela |
|---|---|---|
| Azul | `#0e639c` | branco, 6,40 |
| Âmbar | `#996103` | branco, 5,17 |
| Verde | `#087c57` | branco, 5,21 |
| Roxo | `#7b5ea7` | branco, 5,25 |
| Rosa | `#ae4278` | branco, 5,45 |
| Vermelho | `#cd3131` | branco, 5,15 |
| Ciano | `#077884` | branco, 5,21 |

Âmbar, Verde e Ciano são escuros o bastante para o branco: o âmbar claro `#c6a700` daria 2,35, o
verde `#16825d` 4,79 e o ciano `#007d8a` 4,88. O texto sobre o destaque (`--ds-on-accent`) é branco
nas sete, e passa a escuro (`#1b1b1b`) só numa cor gravada fora da lista em que o branco não chega a
4,5:1. Sob o ponteiro, o destaque escurece quando o texto é branco e clareia quando o texto é
escuro, para o texto não perder contraste no hover. Quem aplica a regra é
`SettingsWindow._applyAccentColor`, e o SDK web passa os cinco tokens a um app.

O destaque como texto (`--ds-accent-texto`, 55% do destaque com branco) passa de 6,8:1 sobre a
página com qualquer uma das sete. O anel de foco usa o mesmo tom, e não o destaque cru: o cru
fica abaixo dos 3:1 de um indicador de estado (o azul dá 2,69 sobre a página e 1,92 sobre o
campo), e o clareado passa de 4,8:1 em todas as superfícies com as sete cores.

### Estado e categoria

As cores de estado continuam semânticas e distintas do destaque: o ok em `#4caf7d` (6,34 sobre a
página), o aviso em `#d6a531` (7,62) e o erro em `#f05a50` (5,15 sobre a página e 4,76 sobre o
segundo degrau). Um botão que destrói usa `#b93a32` (5,65 com branco). Com o âmbar ou o vermelho
como destaque, o aviso e o erro se separam dele pelo ícone e pelo texto que trazem, e nunca só
pela cor.

As cores de categoria para dados e para código são hoje as da sintaxe do Dark+, e continuam até o
Tuff ter uma família própria. Elas servem a gráfico e a código, e nunca à moldura.

## Onde o destaque aparece

Uma janela tem um foco, que é o conteúdo. O destaque marca o que a pessoa escolheu ou o que ela vai
fazer, e mais nada:

- o fundo do botão primário, um por tela;
- a seleção (o fundo de `--ds-sel`) e o anel de foco;
- o indicador do lugar onde a pessoa está: a aba ativa, o item ativo da lateral;
- a posição que anda: o playhead e a trilha tocada da mídia, a barra de progresso.

Ele não aparece na barra de status, nos títulos, nos fios, nos ícones da interface em repouso, no
fundo de seção nem num fio colorido à esquerda. Um botão de barra ligado se marca pelo fundo
`--ds-bg3` e pelo texto forte, e não pela cor de destaque; sob o ponteiro, um botão se marca pelo
fundo de hover ou pelo contorno, também com o texto forte. O fio colorido à esquerda fica só onde
ele diz a severidade de uma dica. A pasta é a única exceção: ela leva a cor de destaque, clareada
(seção seguinte).

## Ícones de arquivo

Um arquivo é conteúdo da pessoa, e o ícone dele tem cor. É uma família à parte dos glifos de traço:
cheia, desenhada num quadro de 48 × 48 para a grade e reduzida a 20 px na lista.

A forma é a folha com selo: a folha clara, o glifo do tipo na cor dele no meio, e a extensão num
selo colorido no canto. Ela foi escolhida porque o meio da folha e o selo são dois lugares que um
app pode preencher com o que é dele.

Cada tipo tem um matiz e um glifo, e o glifo carrega o tipo junto com a cor, para quem não distingue
os matizes. Os matizes têm a mesma luminosidade (OKLCH 0,62, croma 0,13), então nenhum grita mais
que o outro. A coluna "selo" é a cor do selo, com o branco da extensão acima de 5,6:1.

| tipo | matiz | selo | glifo |
|---|---|---|---|
| PDF | `#c8645a` | `#a43b35` | linhas |
| documento e texto | `#5286d3` | `#2a61b1` | linhas |
| planilha | `#429c5a` | `#057836` | grade |
| apresentação | `#c36c36` | `#9c4700` | quadro no tripé |
| imagem | `#099b8f` | `#00736a` | montanha e sol |
| vídeo | `#9372c8` | `#714ca6` | play |
| áudio | `#bc6398` | `#983c75` | nota |
| comprimido | `#9e8406` | `#766202` | zíper |
| código | `#5d7186` | `#44576b` | `</>` |
| outro | `#868686` | `#636363` | linhas |

A pasta tem fundo, aba e frente, na cor de destaque clareada (a frente com 62% do destaque e o
fundo com 85%, misturados com branco), e passa de 3,7:1 sobre a página com qualquer uma das sete
cores. As pastas da pessoa (Documentos, Downloads, Música, Imagens, Vídeos) levam o glifo gravado
na frente, um tom abaixo dela.

Um app declara no manifesto (`opens.proprios`) os tipos de arquivo que ele cria: a extensão, o nome,
a cor e, se quiser, um ícone e um selo de até cinco letras (VSSH-380). O ícone ocupa o meio da folha
e o selo leva a cor do app, como `capitulo-3.prelo` com o ícone do Prelo. Sem ícone do tipo entra o
do app, e sem selo o ícone identifica o arquivo sozinho. O branco do selo passa de 4,5:1 sobre a
cor, e a instalação recusa a cor que não passa. Um tipo que guarda miniatura dentro do arquivo
(`previa`) a mostra no lugar da folha, com o selo por cima, na grade de Arquivos e na área de
trabalho. A lista, que desenha o ícone a 16 px, fica com a folha, e o arquivo sem miniatura também.
A extensão que o ambiente já desenha (imagem, vídeo, áudio, PDF, documento de escritório,
comprimido, código e texto) fica com o ícone do ambiente. Com dois apps declarando a mesma extensão
vale o que abre o arquivo no duplo-clique, e sem um eleito o arquivo fica com a folha genérica.

A lixeira da área de trabalho é da mesma família: o quadro de 48 × 48 nos cinzas da folha, com a
tampa, a alça e três sulcos gravados no corpo, e a cheia com uma folha e uma bola de papel acima da
tampa. Ela não leva a cor de destaque. Na lateral de Arquivos ela é o glifo de traço, porque ali é
interface.

## Ícones de app

O ícone de um app é a terceira família, ao lado dos glifos de traço e dos ícones de arquivo. Ele diz
que app é aquele no menu iniciar, no Launchpad, na barra, na Loja e no Alt+Tab, e por isso tem cor e
volume. O ambiente o monta em camadas (`icone` no manifesto, `src/utils/composicao-de-icone.ts`): o
app entrega o glifo e, se quiser, um fundo, e o sistema põe a máscara e o acabamento. É a parte do
sistema que deixa todos com a mesma forma, em todo tamanho e em toda superfície.

| camada | de quem | o que é |
|---|---|---|
| fundo | do app, ou da família | sem declaração, o #15171c com a luz radial do alto à esquerda (#2a2e38 no centro dela); um app pode trazer um arquivo, que sangra até a borda, ou uma cor |
| glifo | do app | o desenho, com o fundo transparente |
| máscara | do sistema | o quadrado de raio 14 no quadro de 64, 22% do lado |
| acabamento | do sistema | um fio de 1 px por dentro da borda, branco a 16% em cima e preto a 30% embaixo |

O quadro é de 64 × 64. O glifo mora na área viva de 46 × 46, centrada, e cada forma tem a keyline
dela, porque um círculo e um quadrado da mesma largura não parecem do mesmo tamanho: o círculo pede
Ø 46, o quadrado 40 × 40, e a forma deitada ou em pé 46 × 36. Um disco cheio fica abaixo da keyline,
como o globo do Navegador, de Ø 42, porque pesa mais que um anel.

A luz vem do alto à esquerda, a mesma do fundo. Cada forma clareia para lá e leva o reflexo curvo
daquele lado, um traço branco entre 55% e 75%. O branco quente (#f5f2ea) é o material comum: o pingo
do Cavalete, o aro da Lupa, a alça da Loja. Um glifo tem duas formas, no máximo três, porque a 22 px
uma quarta vira sujeira. A sombra, a borda e o arredondamento ficam com o sistema, e um glifo que os
desenha sai com dois de cada.

Cada app tem um matiz, e os matizes se espalham pelo círculo das cores para que nenhum par se
confunda no menu:

| app | matiz | glifo |
|---|---|---|
| Cavalete | vermelhão, #f26c43 | o traço do pincel e o pingo |
| Ajuda | vermelho, #e2453f, com o branco quente | a boia |
| Arquivos | ocre, #f0a432 | a pasta com a folha |
| Palco | âmbar, #ffd166 a #e5801a | o triângulo num gesto só e o pingo |
| Terminal | verde do fósforo, #3ddc84, com o branco quente | o prompt e o cursor, com o ladrilho de tela |
| Loja de apps | verde-azulado, #2bb89c | a sacola |
| Lupa | ciano, #3fc1d0, com o branco quente | a lente |
| Agente do sistema | céu, #4fb8e8 | a engrenagem |
| Navegador | azul, #2f80ea | o globo |
| Lápis | ultramarino, #2a45c9 a #7d98ff, com a pirita | o l cursivo |
| Editor de texto | violeta, #8f63ec, com o branco quente | as chaves e o cursor |
| Chaveiro | rosa, #e0508a | a chave |
| Supervisor de Apps, Motor de Impressão | aço, #9aaeb8 a #5f7782 | o manômetro, a impressora |

A janela de um embutido mostra o ícone do app na barra e no cabeçalho, o mesmo do menu iniciar, e
um app fixado na barra também. Uma janela que pertence a um app sem ser a principal dele (o
Navegador sem motor escolhido, o seletor de arquivos no celular) declara `app` e mostra o mesmo
ícone. Um app que declara só `icon`, um arquivo pronto, aparece como ele é, com o arredondamento por
CSS de cada superfície. O guia "O ícone do app" do vssh-sdk mostra a grade, a luz e como exportar as
camadas.

As janelas do ambiente que não são app dividem a barra e o Alt+Tab com os apps, e têm ícone da
mesma família: o glifo em `vssh-client/icones/<nome>/glifo.svg`, montado pelo portal com o mesmo
compositor, e a janela o declara pelo nome (`icone: { ambiente: '<nome>' }`). Elas ficam fora do
menu, e por isso podem repetir o matiz de um app quando o sentido pede: o âmbar do aviso no Log, o
azul da marca nas Boas-vindas.

| janela | matiz | glifo |
|---|---|---|
| Configurações | aço, #8a9ba6 a #4f626d, com o branco quente | três controles deslizantes |
| Gerenciador de tarefas | lima, #d4f07a a #6fa82a | as três barras de uso |
| Log | âmbar, #ffcf6b a #d98c1c, com o branco quente | a hora e a mensagem de três registros |
| Comprimido | pardo, #d9a06a a #8f5a30, com o branco quente | a caixa com o zíper |
| Propriedades | areia, #f7ead0 a #c9ab76 | a etiqueta com o furo |
| Boas-vindas | azul, #2f80ea, com o branco quente | a marca do VSSH, o v com o cursor |

## Diálogos e notificações

As pranchetas Diálogos, Avisos, A central e Som do protótipo desenham estas regras (VSSH-377,
VSSH-378, VSSH-381):

- Um diálogo tem a pergunta como título ("Excluir 3 itens para sempre?"), a consequência no texto,
  e cada botão diz o verbo ("Excluir", "Manter os dois"), nunca "Sim" e "Não". O tom (o círculo
  com o ícone) aparece só no que destrói ou falhou. Um diálogo pedido por um app mostra o ícone e
  o nome dele em cima, para a pessoa saber quem pergunta.
- Na tela estreita, o diálogo é uma folha que sobe de baixo, com os botões empilhados em 44 px.
- Um aviso diz quem falou (o ícone e o nome do app, nunca o id), quando, o que houve, e as ações.
  Ele pode trazer uma figura: a pessoa que mencionou, o arquivo de que se trata. O tom é um ponto
  no canto do ícone do app, e o título diz o que houve; o aviso não ganha fio colorido à esquerda.
- As notificações e o calendário são uma central só, presa na borda direita, que abre pelo
  relógio da barra, com o sino junto dele. Em cima ficam o que está em curso e o histórico por app,
  com a mais recente de cada um e o resto atrás de "+N"; embaixo, a data, o mês e o Não perturbe
  com duração.
- O volume e o que está tocando são outro painel, aberto pelo botão de volume da barra: a mídia
  com o transporte em cima, e o volume geral embaixo, que abre o volume por app. O som da sessão
  remota entra como uma das fontes.
- Uma janela que não recebeu o que pediu mostra a falha no lugar do conteúdo, num desenho só
  (`.tuff-vazio--falha`, VSSH-373): o ícone de aviso, o título com o que não abriu ("O comprimido
  não abriu"), uma frase com o motivo e "Tentar de novo". O código da resposta é mecanismo, e fica
  num detalhe fechado. Uma recarga que falha deixa na tela o que já estava, e o motivo vai a um
  aviso, nunca à lista.

## Tipografia

- Instrument Sans, variável de 400 a 700, servida pelo próprio ambiente (41 KB nos dois
  subconjuntos). Ela fica: é uma grotesca de desenho contido que se lê em 11 a 13 px, o tamanho de
  uma interface densa, e a licença OFL a deixa viajar com cada app. A tipografia denuncia uma janela
  estrangeira antes de qualquer cor.
- A escala vai de 10 a 20 px (`--tuff-size-2xs` a `--tuff-size-2xl`), em três pesos: 400 para o
  texto, 500 para o rótulo de controle, 600 para título e valor que importa. Rótulo e valor nunca
  têm o mesmo peso.
- No celular (ponteiro grosso e menos de 600 px) a letra pequena sobe um ponto: 12, 13 e 14 px no
  lugar de 11, 12 e 13. Os títulos ficam como estão.
- Rótulos de seção e de lista ficam na caixa da frase, nunca em caixa alta espaçada (VSSH-270).
- A monoespaçada é a pilha do sistema, e aparece só para código, caminho de arquivo e número que
  muda enquanto a pessoa olha (com `tabular-nums`).

## Geometria e densidade

- O raio é de 4 px em controle e de 6 px em painel. Pílula só para o estado e para a legenda da
  imagem do dia na área de trabalho.
- A densidade é a de uma ferramenta: controle com 26 px de altura sob ponteiro fino, e 44 px de
  alvo sob ponteiro grosso (`--ds-alvo`). Quem decide é o ponteiro, e não a largura.
- O espaçamento segue a escala de 2, 4, 8, 12, 20 e 32 px (`--ds-gap-*`).
- A tela cabe em 360 px sem rolagem horizontal. Abaixo de 600 px a forma é compacta, de 600 a 839
  é média, e de 840 em diante é ampla, as classes de janela do Android (VSSH-368).
- Abaixo de 600 px de tela o próprio ambiente é o do celular (VSSH-370): a janela ocupa a área
  acima da barra, a barra fica embaixo com a janela da frente e "Janelas abertas", e o menu
  iniciar ocupa a tela. O modo liga pela largura, e um tablet largo continua com janelas.
- Um app de lista e detalhe usa a moldura (`.tuff-app`), com a barra, a lateral, o miolo, o painel
  e o rodapé. Na média o painel entra por cima do miolo pela borda direita; na compacta a lateral
  vira gaveta, o painel vira a tela seguinte, com "Voltar", e os botões de prioridade baixa da
  barra vão para o "Mais", que abre o menu do ambiente.

## Movimento

Transição só onde ela diz o que mudou: o hover e o pressionar (80 ms), abrir e fechar uma gaveta
ou um painel (150 ms). Nenhuma entrada animada, nenhum elemento que se mexe sozinho. Com
`prefers-reduced-motion`, as transições caem e a barra indeterminada fica parada.

Os ícones de traço têm cinco movimentos, cada um preso a um gesto ou a um estado que mudou, e todos
no `tuff.css` como classes da peça `.tuff-ico`:

| movimento | quando | duração |
|---|---|---|
| uma volta (`--volta`) | o clique no Atualizar, com `data-tuff-anima="volta"` no botão | 450 ms |
| o giro (`--gira`) | enquanto o botão está `aria-busy`, que `TuffIcones.ocupado` põe depois de 250 ms | o carregamento |
| a meia volta da seta (`--abre`) | a seção ou o menu abre e fecha | 150 ms |
| o visto que se desenha (`--desenha`) | uma ação acaba sem resultado à vista: o passo do Praticar, o "Copiado" | 300 ms |
| a seta que cai (`--cai`) | o download começa, com `data-tuff-anima="cai"`; a bandeja fica parada | 375 ms |
| o sino que balança (`--balanca`) | chega um aviso, fora do Não perturbe | 600 ms |

O sino é a exceção à regra de nada se mexer sozinho: ele balança uma vez, quando o aviso chega, e
o ponto na cor de destaque continua sendo o que fica. As durações saem do `--tuff-dur`, então o
movimento reduzido e o ajuste "Animações e sombras" desligado deixam o ícone no estado final, sem
movimento.

## Escuro

O ambiente é escuro por padrão e só escuro, por decisão (VSSH-358). Ele emoldura terminal, editor
de código e apps X11, que já são escuros, e é usado em sessões longas. Um documento branco (o
Escritório, a prévia do Prelo) aparece como página sobre a mesa escura, que é como um editor de
texto o mostra. A pergunta do modo claro volta com o cliente Android.

## Decisões de produto que este arquivo guarda

- Sem vidro: `--ds-blur` vale `none`.
- Sombra só no que flutua: janela, menu, diálogo.
- Diálogo, menu de contexto, aviso e seletor de arquivo são do desktop, e o app os pede pela ponte.
- A aba é encaixada: a ativa tem a cor da barra de baixo e se liga a ela, e as outras ficam soltas
  sobre o cabeçalho, separadas por um fio (VSSH-360).
- A área de trabalho tem quatro fundos, e a pessoa escolhe um nas boas-vindas do primeiro uso ou
  em Configurações (VSSH-383): estratos (as camadas da pedra, separadas por um fio, com um grão do
  destaque que engrossa para baixo), curvas de nível (linhas finas de mapa gravadas, com a mestra a
  cada cinco), brilho (o brilho radial no destaque, sem o segundo brilho roxo, que o anti-slop
  lista como orbes e esquema roxo e preto) e a imagem do dia do Bing, que o portal busca uma vez
  por dia e serve da própria origem, com o crédito ao lado da escolha e, na área de trabalho, numa
  pílula escura no canto de cima à direita, quando nenhum ícone está lá. Quem pula as boas-vindas
  fica com os estratos. Os três fundos do ambiente são escuros o bastante para o nome de um ícone
  passar de 7:1; sobre a foto, o nome ganha uma placa escura.

## Padrões que esta direção mantém de propósito

O anti-slop pergunta antes de seguir uma direção que pede um padrão da lista dele. Estes ficam, e
a resposta já está dada:

- ícones de traço fino de uma família só, na interface: ficam, pelo motivo da identidade acima. Os
  ícones de arquivo são cheios e coloridos, e a seção deles diz por quê;
- escuro por padrão: fica, pelo motivo da seção Escuro;
- fio colorido à esquerda: fica só na dica, onde ele carrega a severidade;
- degradê nos ícones de app: fica, porque é a luz do alto à esquerda que todo glifo e o fundo da
  família dividem, e é ela que faz a suíte parecer uma família.

## Para quem escreve um app

Um app que monta a tela com as peças do Tuff segue esta direção sem escrever nada. Um app com
identidade própria carrega só `tuff-tokens.css` e acompanha a cor de destaque do ambiente; a
direção dele é do autor, e este arquivo não vale para ele.
