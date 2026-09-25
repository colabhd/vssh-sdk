# Mídia

As peças para um player, um visualizador de fotos ou uma biblioteca: o palco, o chrome que some,
o transporte que fica, a trilha, o timecode, o volume, a grade de miniaturas, a tira e o visor com
zoom. Elas moram em `tuff-midia.css` e `tuff-midia.js`, e são opt-in: um app de formulário não
paga o download nem o parse disto. No `web.spa`, `tuff: [...web.TUFF, ...web.TUFF_MIDIA]`; à mão,
as duas tags depois das do núcleo.

Todo player de vídeo na web tem a mesma cara: uma barra de vidro sobre um degradê escuro,
flutuando por cima da imagem. Este não. O sistema declara `--ds-blur: none`, então o chrome aqui é
o material do ambiente: `--ds-bg2` opaco, com uma divisa de 1px em `--ds-border`, a mesma da barra
de tarefas. O vídeo faz letterbox contra `--ds-bg`, e a janela lê como aplicativo do ambiente.

A assinatura é o playhead: `--ds-accent` é a única coisa que a pessoa escolhe neste ambiente, e ele
vira a porção reproduzida da trilha e o anel de seleção da grade. Trocar a cor nas Configurações
repinta o pixel que os olhos mais seguem.

## O palco e o chrome

`.tuff-palco` centra um `video` ou uma `img` contra `--ds-bg`. Preto puro ao lado de `#1e1e1e`
vira uma moldura que ninguém pediu; o mesmo fundo desaparece, e o que sobra é a imagem. O
`.tuff-chrome` é a barra de controles logo abaixo; com `--sobreposto` ele fica sobre o palco, para
quando a imagem manda e a barra não pode comer espaço, como em tela cheia. Continua opaco; o que
muda é onde ele mora.

```html vivo
<div class="tuff-palco" style="height:150px">
  <span class="tuff-sec-desc">aqui vai o vídeo, em letterbox contra o fundo da janela</span>
</div>
<div class="tuff-chrome">
  <button class="tuff-btn tuff-btn--icone" aria-label="Reproduzir"><svg class="tuff-ico"><use href="#ico-play"></use></svg></button>
  <div class="tuff-trilha" aria-label="Posição">
    <div class="tuff-trilha-trilho">
      <div class="tuff-trilha-buffer" style="width:72%"></div>
      <div class="tuff-trilha-tocado" style="width:38%"></div>
      <div class="tuff-trilha-marca" style="left:22%"></div>
      <div class="tuff-trilha-marca" style="left:55%"></div>
    </div>
    <div class="tuff-trilha-polegar" style="left:38%"></div>
    <div class="tuff-trilha-previa" style="left:38%">15:47</div>
  </div>
  <span class="tuff-tempo"><b>15:47</b> / 41:37</span>
  <div class="tuff-volume">
    <button class="tuff-btn tuff-btn--icone" aria-label="Silenciar"><svg class="tuff-ico"><use href="#ico-volume-on"></use></svg></button>
    <div class="tuff-volume-trilha">
      <div class="tuff-volume-trilho"><div class="tuff-volume-nivel" style="width:70%"></div></div>
    </div>
  </div>
</div>
```

Com `TuffMidia.player`, o chrome some sozinho depois de 2,5 s sem ponteiro (`--oculto`), e nunca
com o foco do teclado dentro dele, nem com o vídeo pausado: sumir ali deixaria quem navega por
teclado sem controle e sem caminho de volta. Enquanto o chrome está oculto, o ponteiro some junto
(`.tuff-palco--limpo`).

## A trilha

A trilha tem 3px em repouso e 6px sob o ponteiro; o 6 é a medida de trilho fino do ambiente, a
mesma da scrollbar. As camadas, de baixo para cima: o buffer (`.tuff-trilha-buffer`), o tocado
(`.tuff-trilha-tocado`, em `--ds-accent`) e as marcas de capítulo (`.tuff-trilha-marca`); o
polegar e a prévia de tempo ficam fora do trilho. As larguras e posições são percentuais escritos
pelo app, ou pelo `player` do `tuff-midia.js`.

O timecode (`.tuff-tempo`) é monoespaçado com `tabular-nums`: em fonte proporcional o número treme
a cada segundo, no único elemento que o olho segue continuamente. `TuffMidia.tempo(segundos)`
formata como `12:04` ou `1:02:04`; a hora só aparece quando existe, porque um `0:12:04` num clipe
de dois minutos rouba largura e ensina a ler um campo que nunca muda.

## O transporte

O chrome fica sobre o vídeo e some sozinho. O transporte é a outra peça: a barra que não some,
embaixo da janela inteira, enquanto a pessoa navega a biblioteca, porque o vídeo não parou de tocar
só porque ela foi olhar outra coisa. É o que separa um player de desktop de uma página com vídeo
dentro.

Dois andares: em cima, onde estou no tempo; embaixo, o que eu faço. O aglomerado de transporte
fica no centro óptico por `grid-template-columns: 1fr auto 1fr`; com `flex` ele andaria conforme o
nome da faixa fosse curto ou comprido, e o botão que se procura sem olhar mudaria de lugar a cada
vídeo.

```html vivo
<div class="tuff-transporte">
  <div class="tuff-transporte-tempo">
    <span class="tuff-tempo">12:04</span>
    <div class="tuff-trilha" aria-label="Posição">
      <div class="tuff-trilha-trilho">
        <div class="tuff-trilha-buffer" style="width:43%"></div>
        <div class="tuff-trilha-tocado" style="width:29%"></div>
      </div>
      <div class="tuff-trilha-polegar" style="left:29%"></div>
    </div>
    <span class="tuff-tempo">41:37</span>
  </div>
  <div class="tuff-transporte-controles">
    <div class="tuff-transporte-inicio">
      <svg class="tuff-ico tuff-ico--sm"><use href="#ico-video"></use></svg>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">entrevista-final.mkv</span>
    </div>
    <div class="tuff-transporte-meio">
      <button class="tuff-btn tuff-btn--icone" aria-label="Anterior"><svg class="tuff-ico"><use href="#ico-skip-back"></use></svg></button>
      <button class="tuff-btn tuff-btn--icone" aria-label="Pausar"><svg class="tuff-ico"><use href="#ico-pause"></use></svg></button>
      <button class="tuff-btn tuff-btn--icone" aria-label="Parar"><svg class="tuff-ico"><use href="#ico-stop"></use></svg></button>
      <button class="tuff-btn tuff-btn--icone" aria-label="Próximo"><svg class="tuff-ico"><use href="#ico-skip-forward"></use></svg></button>
    </div>
    <div class="tuff-transporte-fim">
      <button class="tuff-btn tuff-btn--icone" aria-pressed="true" aria-label="Repetir: só esta"><svg class="tuff-ico"><use href="#ico-repeat-one"></use></svg></button>
      <button class="tuff-btn tuff-btn--icone" aria-pressed="false" aria-label="Aleatório"><svg class="tuff-ico"><use href="#ico-shuffle"></use></svg></button>
      <button class="tuff-btn tuff-btn--icone" aria-label="Tela cheia"><svg class="tuff-ico"><use href="#ico-fullscreen"></use></svg></button>
    </div>
  </div>
</div>
```

O botão de repetir está ligado, e o de aleatório não. A diferença vem de `aria-pressed="true"`,
que é o seletor do estado ligado; um alternador idêntico nos dois estados faz a fila fazer algo que
ninguém pediu.

## A forma de onda

Para áudio, a trilha diz onde se está e não diz onde está a fala. `TuffMidia.onda` desenha os
picos que o app mediu, uma barra por trecho, e pinta as regiões que o app declarar: os falantes de
uma transcrição, os capítulos de um podcast, as faixas de um disco. O que já tocou fica aceso, o
resto apagado, e a posição é uma linha de 1px em `--ds-text`. Ela cabe no lugar da trilha, no
andar de cima do transporte, e o Escriba a usa assim.

```js
const onda = TuffMidia.onda(document.getElementById('onda'), picos, {
  midia: audio,                      // o <audio> ou <video> que ela lê e move
  duracao: 2512.4,                   // a posição antes de os metadados chegarem
  regioes: [
    { inicio: 0, fim: 41.2, cor: 'var(--app-falante-1)' },
    { inicio: 41.9, fim: 88, cor: 'var(--app-falante-2)' },
  ],
});
```

`picos` é uma lista de números de 0 a 1, de qualquer tamanho: a peça agrupa os valores de cada
barra pelo maior deles, e uma janela mais larga mostra mais barras, e não barras mais grossas.
Quem mede é o backend do app. O Escriba decodifica o áudio com o ffmpeg em mono a 4 kHz e guarda o
maior valor absoluto de cada um de 1600 trechos iguais: a lista tem o mesmo tamanho para um minuto
ou para três horas, e nenhuma janela desenha mais barras que isso.

As regiões chegam em ordem de início e sem sobreposição, e o vão entre duas fica na cor neutra. A
cor é qualquer cor CSS, variável inclusive: a peça a resolve para o canvas uma vez por troca, e
não a cada barra de cada quadro. `onda.definir({ regioes })` troca as regiões na hora, o que é o
caso de alguém renomear ou fundir dois falantes; `definir` aceita também `picos` e `duracao`.

O clique e o arraste buscam, e a captura de ponteiro segura o arraste mesmo quando a mão sai da
onda. Sob o ponteiro, `.tuff-onda-previa` mostra o tempo daquele ponto. O teclado anda 5 s pelas
setas, 1 s com Shift, e Home e End vão às pontas. A onda é um `slider` com `aria-valuetext` no
formato do `TuffMidia.tempo`.

Quando o app já tem a própria noção de tempo, como um editor que leva o texto junto com o áudio,
`tempo: { atual, buscar, duracao }` no lugar de `midia` é a mesma régua que o `player` aceita, e
aí quem chama `onda.pintar()` a cada quadro é o laço do app. `onda.destruir()` tira os ouvintes e
o observador de tamanho.

## A grade de miniaturas e a tira

`.tuff-grade` é uma grade virtualizada: com trinta mil arquivos, só as fileiras visíveis existem
no DOM. Setas e Home/End andam dentro; a grade inteira é uma parada de Tab só. Cada
`.tuff-miniatura` leva a imagem e o anel de seleção em `--ds-accent`. A `.tuff-tira` é a fileira
horizontal de miniaturas, para o que está por perto do item corrente.

A grade só existe com o script: é ele que decide quais fileiras montar.

```js
TuffMidia.grade(document.getElementById('grade'), {
  total: 30000,
  largura: 96,
  altura: 68,
  gap: 6,
  // Chamado para cada célula que entra na tela; `no` é a `.tuff-miniatura` vazia.
  montar(i, no) { no.innerHTML = `<img alt="item ${i}" src="miniaturas/${i}.jpg">`; },
});
```

A grade devolve `{ atualizar(total), selecionar(i), redimensionar(largura, altura), destruir() }`.
`redimensionar` troca o tamanho dos itens com o primeiro item visível parado no topo, que é o que
um "Ctrl e a roda" de um app de fotos precisa, e chama `montar` de novo em cada célula, para o app
pedir uma miniatura maior quando o item cresce.

```html vivo
<div class="tuff-tira">
  <div class="tuff-tira-item" aria-selected="false"><span class="tuff-sec-desc">1</span></div>
  <div class="tuff-tira-item" aria-selected="true"><span class="tuff-sec-desc">2</span></div>
  <div class="tuff-tira-item" aria-selected="false"><span class="tuff-sec-desc">3</span></div>
  <div class="tuff-tira-item" aria-selected="false"><span class="tuff-sec-desc">4</span></div>
</div>
```

## O visor

`TuffMidia.visor(el, opcoes)` amplia, move e gira o primeiro filho de `el`: uma `img`, um
`canvas` ou um `video`. A roda amplia no ponteiro, e a pinça do trackpad acompanha os dedos, porque
o fator é proporcional ao gesto. O arraste move a imagem ampliada sem deixá-la sair da janela, e
numa tela de toque dois dedos ampliam e movem juntos. O duplo-clique alterna entre caber na janela
e 1:1, com o 1:1 aberto no ponto clicado. Sem inércia, de propósito: ferramenta de trabalho não
desliza depois que a mão parou.

A imagem nasce cabendo na janela, sem passar de 1:1: um ícone de 32 pixels não vira um borrão do
tamanho da tela. Enquanto ninguém mexe no zoom, ela acompanha a janela quando a janela muda de
tamanho, e o primeiro gesto de zoom a solta.

A escala é em pixels do monitor. `1` põe um pixel da imagem num pixel da tela, e é o que um "100%"
na barra do app deve mostrar; numa tela a 150%, a escala em pixel CSS seria outra.

```js
const visor = TuffMidia.visor(document.getElementById('visor'), {
  aoMudar: ({ escala, rotacao, ajustada }) => {
    porcentagem.textContent = `${Math.round(escala * 100)}%`;
  },
});
mais.onclick = () => visor.ampliar();
menos.onclick = () => visor.reduzir();
caber.onclick = () => visor.ajustar();
umParaUm.onclick = () => visor.cem();
girar.onclick = () => visor.girar(1);   // -1 gira no sentido anti-horário
proxima.onclick = () => visor.trocar(outraImagem);   // volta a caber, sem giro
```

| método | o que faz |
|---|---|
| `ajustar()` | cabe na janela, sem passar de 1:1 |
| `cem(ponto?)` | 1:1, com o ponto `{x, y}` do visor parado (o centro, sem ponto) |
| `ampliar()`, `reduzir()` | um passo (`opcoes.passo`, padrão 1.25) em torno do centro |
| `definir(escala, ponto?)` | uma escala exata, em pixels do monitor |
| `girar(sentido)` | noventa graus; ajustada, a imagem continua cabendo, e ampliada, o centro da janela fica onde estava |
| `trocar(elemento)` | troca o conteúdo sem recriar o visor; uma `img` que ainda carrega fica escondida até ter tamanho |
| `escala()`, `rotacao()`, `ajustada()` | o estado atual |
| `destruir()` | solta os ouvintes |

`opcoes.min` e `opcoes.max` limitam a escala. O `min` padrão é a escala de caber na janela, e o
`max` padrão é 40.

Com o foco no visor, + e − ampliam e reduzem, 0 cabe na janela e 1 vai a 1:1, com ou sem Ctrl:
com Ctrl, o navegador ampliaria a página inteira. As setas movem a imagem só no eixo em que ela é
maior que a janela. No outro eixo a seta segue para a página, com `defaultPrevented` falso, e é
assim que um app de fotos usa ← e → para a anterior e a seguinte sem brigar com o visor.

O gesto só começa sobre a imagem ou sobre o fundo do visor: um botão posto por cima dele recebe o
próprio clique. `.tuff-visor` é o contêiner, `.tuff-visor-conteudo` o que se move, e
`--arrastando` troca o cursor durante o arraste.

## A imagem que o navegador não abre

O Chrome não decodifica TIFF nem HEIC. `TuffMidia.imagem(url, { nome })` devolve o elemento
pronto para o visor: uma `img` para o que o navegador abre sozinho, e um `canvas` para TIFF e HEIC.
O `nome` é o nome do arquivo, de onde sai o formato, porque a URL de `vssh.arquivos.urlFor` não
tem extensão no caminho.

```js
const { elemento, documento, reduzida } = await TuffMidia.imagem(vssh.arquivos.urlFor(caminho), { nome });
visor.trocar(elemento);
if (documento && documento.paginas > 1) mostrarPaginas(documento.paginas);   // TIFF de várias páginas
const miniatura = documento && await documento.miniatura();   // a que o arquivo já traz, ou null
```

O decodificador (`tuff-imagem.js`) é buscado na primeira chamada, e o geotiff dele (550 KB) só no
primeiro TIFF: um app que só mostra JPEG não paga por nenhum dos dois. Os dois leem por `Range`,
então abrir um TIFF grande ou pedir a miniatura de um HEIC não baixa o arquivo inteiro.

O TIFF cobre várias páginas, as compressões comuns, BigTIFF, 16 bits e ponto flutuante; o que
passa de 8 bits chega à tela esticado entre o mínimo e o máximo da imagem, e um NaN sai
transparente. Acima de 64 megapixels a página sai do maior nível de redução que couber, e
`reduzida` diz isso; `opcoes.teto` troca o limite. A miniatura de um TIFF é o menor nível de
redução, e um TIFF sem níveis não tem uma.

O HEIC vai ao `VideoDecoder` do WebCodecs, que decodifica HEVC pelo hardware da máquina. Onde o
navegador não tem HEVC (Chrome no Linux sem VA-API, ou com a GPU desligada), a promessa rejeita
com `codigo: 'sem-hevc'`, e o app diz isso na tela. A rotação da foto (`irot`) já vem aplicada, e
a miniatura é a que o celular gravou dentro do arquivo.

`documento.desenhar(pagina)` desenha outra página. Quem só quer o tamanho ou a miniatura, sem
desenhar a página, pede o decodificador e abre o documento:

```js
const TuffImagem = await TuffMidia.decodificador();
const doc = await TuffImagem.abrir(url, { nome });   // o índice, lido por Range
const miniatura = await doc.miniatura();
```

## O player inteiro

`TuffMidia.player(raiz, video)` liga tudo de uma vez sobre a marcação do chrome: a trilha
(`data-tuff-trilha`), o timecode (`data-tuff-tempo`), o volume (`data-tuff-volume`, com
`data-tuff-mudo` no botão), o botão de reproduzir (`data-tuff-play`) e o chrome que some
(`data-tuff-chrome`). Num transporte de dois andares, `data-tuff-tempo-atual` e
`data-tuff-tempo-total` põem o decorrido à esquerda da trilha e o total à direita, onde todo
player de desktop os põe. Os atributos `data-tuff-*` são os pontos que o script procura dentro de
`raiz`; as classes desenham, os atributos ligam.

```js
const raiz = document.getElementById('player');
const video = raiz.querySelector('video');
TuffMidia.player(raiz, video);
```

O que ninguém acerta sozinho é a grade que não trava com trinta mil arquivos, o scrub que não briga
com o `timeupdate`, o chrome que não some com o foco do teclado dentro, e o zoom que acompanha o
ponteiro. Que botão fica onde, e o que o app faz ao abrir um arquivo, é do app, e um player pronto
tomaria essa decisão por ele.
