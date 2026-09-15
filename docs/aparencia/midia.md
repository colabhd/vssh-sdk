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

```html vivo
<div class="tuff-tira">
  <div class="tuff-tira-item" aria-selected="false"><span class="tuff-sec-desc">1</span></div>
  <div class="tuff-tira-item" aria-selected="true"><span class="tuff-sec-desc">2</span></div>
  <div class="tuff-tira-item" aria-selected="false"><span class="tuff-sec-desc">3</span></div>
  <div class="tuff-tira-item" aria-selected="false"><span class="tuff-sec-desc">4</span></div>
</div>
```

## O visor

Roda para ampliar no ponteiro, arraste para mover, duplo-clique alterna entre caber na janela e
1:1. Sem inércia, de propósito: ferramenta de trabalho não desliza depois que a mão parou.
`.tuff-visor` é o contêiner, `.tuff-visor-conteudo` o que se move, e `--arrastando` troca o cursor
durante o arraste.

```js
const visor = TuffMidia.visor(document.getElementById('visor'));
img.onload = () => visor.ajustar();   // caber na janela
botaoUmParaUm.onclick = () => visor.cem();   // 1:1
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
