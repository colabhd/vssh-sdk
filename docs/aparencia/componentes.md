# Componentes

As peças de `tuff.css`, cada uma com a marcação que a produz. Toda amostra desta página é
renderizada com o mesmo Tuff que um app recebe; o markup embaixo de cada uma é o que se copia. Um
elemento com classe `tuff-*` mede pela borda (`box-sizing: border-box`) mesmo num documento sem o
reset de `tuff-base.css`.

## Painel e seção

O painel é a superfície de trabalho: `--ds-bg2` sobre a página, com moldura e o respiro de
`--ds-gap-lg`. Ele é um flex em coluna, e é isso que deixa a barra de ações grudar no fim. A seção
(`.tuff-sec`) é o par título e descrição, com a hierarquia obrigatória: o título em `--ds-text-mid`
e a descrição em `--ds-text-dim`, um corpo menor.

```html vivo
<div class="tuff-painel">
  <div class="tuff-sec">
    <div class="tuff-sec-titulo">Servidor</div>
    <div class="tuff-sec-desc">Onde o backend deste app roda, e como você chega nele.</div>
  </div>
  <hr class="tuff-divisor">
  <dl class="tuff-kv tuff-kv--mono">
    <dt>socket</dt><dd>/home/ana/.vssh-apps/notas/app.sock</dd>
    <dt>pid</dt><dd>48213</dd>
  </dl>
  <div class="tuff-acoes tuff-acoes--direita">
    <button class="tuff-btn">reiniciar</button>
    <button class="tuff-btn tuff-btn--primario">salvar</button>
  </div>
</div>
```

`.tuff-divisor` é a linha de 1px em `--ds-border`. `.tuff-acoes` fica no rodapé do painel por
`margin-top: auto`, que só morde dentro de um flex em coluna; `--direita` alinha os botões à
direita.

## Botões

Três variantes, e nenhuma a mais: o shell tem exatamente estas, e o motivo de não inventar outras
é ter um vocabulário em vez de uma variante por tela. O primário tira a cor de `--ds-accent` e o
texto de `--ds-on-accent`; o de perigo é vazado, em `--ds-danger`.

```html vivo
<button class="tuff-btn">comum</button>
<button class="tuff-btn tuff-btn--primario">primário</button>
<button class="tuff-btn tuff-btn--perigo">apagar</button>
<button class="tuff-btn" disabled>indisponível</button>
```

O botão de ícone é quadrado, sem o respiro lateral que existe para acomodar palavra. Ele precisa de
`aria-label`: o nome não está na tela, e sem o rótulo um leitor de tela anuncia "botão" e nada
mais. Dentro de uma `.tuff-barra`, de um `.tuff-chrome` ou de um `.tuff-transporte` ele perde a
moldura, e a borda volta no hover, que é quando ela informa algo.

```html vivo
<button class="tuff-btn tuff-btn--icone" aria-label="Recarregar"><svg class="tuff-ico"><use href="#ico-refresh"></use></svg></button>
<button class="tuff-btn tuff-btn--icone" aria-label="Ampliar"><svg class="tuff-ico"><use href="#ico-zoom-in"></use></svg></button>
<button class="tuff-btn"><svg class="tuff-ico"><use href="#ico-save"></use></svg> com rótulo</button>
```

Um botão que liga e desliga alguma coisa mostra o próprio estado por `aria-pressed`, e é esse
atributo que o seletor lê: o leitor de tela e o olho não têm como divergir. O realce é o mesmo do
item ativo da gaveta, que é como o ambiente já diz "este aqui está valendo".

```html vivo
<div class="tuff-barra">
  <button class="tuff-btn tuff-btn--icone" aria-pressed="true" aria-label="Repetir"><svg class="tuff-ico"><use href="#ico-repeat"></use></svg></button>
  <button class="tuff-btn tuff-btn--icone" aria-pressed="false" aria-label="Aleatório"><svg class="tuff-ico"><use href="#ico-shuffle"></use></svg></button>
</div>
```

## Campos

Nunca controle nativo. O custo de ignorar isso é um `input type="date"` abrindo um calendário
branco no meio de uma janela escura. O rótulo (`.tuff-rotulo`) vem acima do campo, pequeno e em
`--ds-text-dim`; o campo tem fundo `--ds-bg-input` e a borda muda para o destaque com foco.

```html vivo
<div>
  <label class="tuff-rotulo" for="ex-nome">Nome do projeto</label>
  <input class="tuff-campo" id="ex-nome" placeholder="sem espaços">
</div>
<div>
  <label class="tuff-rotulo" for="ex-notas">Notas</label>
  <textarea class="tuff-campo" id="ex-notas" rows="3">O textarea cresce só na vertical.</textarea>
</div>
```

`.tuff-select` basta sozinho: uma classe, um controle. A seta é um SVG embutido, porque
`appearance: none` apaga a nativa e não há pseudo-elemento em `select` para desenhar outra. A
lista aberta também é estilizada, que é o item mais fácil de esquecer: no Windows ela herda o fundo
do sistema e sai branca sob um controle escuro.

```html vivo
<div>
  <label class="tuff-rotulo" for="ex-motor">Motor</label>
  <select class="tuff-select" id="ex-motor">
    <option>nenhum</option>
    <option>Xpra</option>
    <option>Scramjet</option>
  </select>
</div>
```

A busca (`.tuff-busca`) é um `input type="search"` com a lupa embutida e a cruz nativa do WebKit
retirada; ela está em [Listas e navegação](listas-e-navegacao.md#busca).

## Switch

Um `input type="checkbox"` de verdade por baixo: ele traz teclado, foco, `:checked` e o rótulo
clicável de graça. Desenhar um switch com `div` custa os quatro. O `input` fica invisível sobre o
trilho, e o trilho (`.tuff-switch-trilho`) desenha o estado a partir de `:checked`.

```html vivo
<label class="tuff-switch">
  <input type="checkbox" checked aria-label="Manter o backend vivo">
  <span class="tuff-switch-trilho"></span>
</label>
<label class="tuff-switch">
  <input type="checkbox" aria-label="Aceleração por GPU">
  <span class="tuff-switch-trilho"></span>
</label>
<label class="tuff-switch">
  <input type="checkbox" disabled aria-label="Indisponível">
  <span class="tuff-switch-trilho"></span>
</label>
```

## Linha de configuração

O par rótulo e controle, em grupo. O título em `--ds-text`, a descrição em `--ds-text-dim` e o
controle à direita; as linhas de um `.tuff-grupo` se separam por uma divisa. É a forma de uma tela
de opções, e é a mesma da janela de Configurações do ambiente.

```html vivo
<div class="tuff-grupo">
  <div class="tuff-linha">
    <div class="tuff-linha-corpo">
      <div class="tuff-linha-titulo">Manter o backend vivo</div>
      <div class="tuff-linha-desc">Fechar a janela não encerra o processo.</div>
    </div>
    <div class="tuff-linha-ctrl">
      <label class="tuff-switch">
        <input type="checkbox" checked aria-label="Manter o backend vivo">
        <span class="tuff-switch-trilho"></span>
      </label>
    </div>
  </div>
  <div class="tuff-linha">
    <div class="tuff-linha-corpo">
      <div class="tuff-linha-titulo">Qualidade</div>
      <div class="tuff-linha-desc">Vale para novas sessões.</div>
    </div>
    <div class="tuff-linha-ctrl">
      <div class="tuff-seg">
        <label class="tuff-seg-btn"><input type="radio" name="ex-q">baixa</label>
        <label class="tuff-seg-btn"><input type="radio" name="ex-q" checked>média</label>
        <label class="tuff-seg-btn"><input type="radio" name="ex-q">alta</label>
      </div>
    </div>
  </div>
</div>
```

## Controle segmentado

Radios de verdade por baixo, pelo mesmo motivo do switch: setas do teclado, agrupamento e foco vêm
prontos. `:has()` é o que pinta o rótulo a partir do estado do `input` sem uma linha de
JavaScript. Os `input` de um mesmo controle levam o mesmo `name`.

```html vivo
<div class="tuff-seg">
  <label class="tuff-seg-btn"><input type="radio" name="ex-vista" checked>lista</label>
  <label class="tuff-seg-btn"><input type="radio" name="ex-vista">grade</label>
  <label class="tuff-seg-btn"><input type="radio" name="ex-vista">mapa</label>
</div>
```

## Estado

A pílula responde "como está isto?" numa palavra, com as cores semânticas do ambiente. A
`--ocupado` pulsa, para "está acontecendo agora". A tag é uma etiqueta neutra, e a tecla
(`.tuff-tecla`) desenha um atalho.

```html vivo
<span class="tuff-pill tuff-pill--ok">no ar</span>
<span class="tuff-pill tuff-pill--aviso">degradado</span>
<span class="tuff-pill tuff-pill--erro">fora</span>
<span class="tuff-pill tuff-pill--ocupado">subindo</span>
<span class="tuff-pill">desconhecido</span>
<hr class="tuff-divisor">
<span class="tuff-tag">python3</span>
<span class="tuff-tag">ffmpeg</span>
<span class="tuff-tag">python3-pip</span>
<hr class="tuff-divisor">
<span class="tuff-tecla">Ctrl</span>
<span class="tuff-tecla">Shift</span>
<span class="tuff-tecla">P</span>
```

## Dica

A linha explicativa que acompanha um controle: barra à esquerda em vez de caixa inteira, porque ela
pertence ao que está acima, e uma caixa a transformaria numa peça independente. O texto corre com
`strong` e `code` no meio; um ícone, quando existe, é o primeiro filho e flutua à esquerda.

```html vivo
<div class="tuff-dica">O servidor resolve o caminho; a sua máquina não entra.</div>
<div class="tuff-dica tuff-dica--aviso">Sem systemd de usuário, nenhum limite é aplicado. É informação, sem erro.</div>
<div class="tuff-dica tuff-dica--erro">O socket já está em uso por outra instância deste app.</div>
<div class="tuff-dica"><svg class="tuff-ico tuff-ico--sm"><use href="#ico-info"></use></svg>Com ícone: ele flutua, e o parágrafo o contorna.</div>
```

## Vazio

Uma tela vazia é um convite para agir. O estado vazio tem título e uma frase, e a frase diz o que
fazer; que está vazio, a tela já mostra. Dentro dele as ações não grudam no fim: num vazio alto (o
palco de um player, uma lista de tela inteira), o botão a centenas de pixels da frase que o
explica seria lido como "abra um vídeo" sem botão nenhum por perto.

```html vivo
<div class="tuff-vazio">
  <div class="tuff-vazio-titulo">Nenhuma pasta escolhida</div>
  <div class="tuff-vazio-msg">Escolha uma pasta do servidor para começar. O app lê e grava nela como você.</div>
  <div class="tuff-acoes">
    <button class="tuff-btn tuff-btn--primario">escolher pasta</button>
  </div>
</div>
```

## Espera

Spinner para "não sei quanto falta"; barra para "sei". Trocar os dois custa confiança: uma barra
que anda até 90% e para ensina a não acreditar em barra nenhuma. A barra indeterminada é uma faixa
que atravessa, sem fingir saber a fração; a `--alerta` troca o preenchimento para `--ds-warn`.

```html vivo
<div><span class="tuff-spinner"></span> <span class="tuff-sec-desc">conectando ao servidor…</span></div>
<div class="tuff-progresso"><div class="tuff-progresso-preenchido" style="width:64%"></div></div>
<div class="tuff-progresso tuff-progresso--alerta"><div class="tuff-progresso-preenchido" style="width:92%"></div></div>
<div class="tuff-progresso tuff-progresso--indeterminado"><div class="tuff-progresso-preenchido"></div></div>
```

A largura do preenchimento é `style="width:…%"` escrito pelo app, e a transição de `--ds-dur`
faz a barra andar em vez de pular.

## Ícones

`.tuff-ico` dá o tamanho (16px; `--sm` 14, `--lg` 20) e `flex: none`, para o ícone não encolher
ao lado de um texto longo. A cor vem de `currentColor`, e é por isso que um ícone dentro de um
`.tuff-btn--perigo` fica vermelho sem ninguém pedir. As formas vêm de `tuff-icones.js`; a lista
inteira está em [Ícones](icones.md).

```html vivo
<svg class="tuff-ico tuff-ico--sm"><use href="#ico-folder"></use></svg>
<svg class="tuff-ico"><use href="#ico-folder"></use></svg>
<svg class="tuff-ico tuff-ico--lg"><use href="#ico-folder"></use></svg>
<span class="tuff-pill tuff-pill--erro"><svg class="tuff-ico tuff-ico--sm"><use href="#ico-x-circle"></use></svg> herda a cor</span>
```
