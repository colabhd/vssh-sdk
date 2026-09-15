# Tokens

`tuff-tokens.css` é a fonte única da paleta, da tipografia, da geometria e da fonte do ambiente.
O shell a carrega antes de toda folha dele; um app a recebe como `_sdk/tuff/tuff-tokens.css`, e os
dois leem os mesmos bytes.

O arquivo tem dois andares. Os tokens brutos (`--tuff-*`) são a base: um hexadecimal, um tamanho,
uma duração. Os tokens semânticos (`--ds-*`) são o que os componentes leem, e cada um aponta para
um bruto. Um componente, do shell ou de um app, escreve `--ds-*` e nunca `--tuff-*`: é o que deixa
a base mudar sem uma caça a cor em vinte arquivos.

## Superfícies

Três fundos, e a diferença entre eles é profundidade: a página, uma peça sobre ela, algo sobre a
peça. Sem sombra difusa e sem vidro: `--ds-blur` vale `none` em todo o sistema, e isso é decisão de
produto.

| token | valor | uso |
|---|---|---|
| `--ds-bg` | `#1e1e1e` | a página, o fundo do palco |
| `--ds-bg2` | `#252526` | uma peça sobre a página: painel, barra, lateral |
| `--ds-bg3` | `#2d2d30` | algo sobre a peça: botão, tag, tooltip |
| `--ds-bg-input` | `#3c3c3c` | o fundo de campo, select, busca e trilhos |
| `--ds-bg-hover` | `rgba(255,255,255,0.06)` | o realce sob o ponteiro |
| `--ds-border` | `#3e3e42` | toda divisa e toda moldura |
| `--ds-border-focus` | `#0e639c` | a borda de um campo com foco; é o azul padrão do destaque, e não acompanha a cor escolhida |

```html vivo
<div class="tuff-painel">
  <div class="tuff-sec">
    <div class="tuff-sec-titulo">Um painel sobre a página</div>
    <div class="tuff-sec-desc">O painel é --ds-bg2; o botão dentro dele, --ds-bg3.</div>
  </div>
  <div class="tuff-acoes">
    <button class="tuff-btn">sobre o painel</button>
  </div>
</div>
```

## Texto

| token | valor | uso |
|---|---|---|
| `--ds-text` | `#cccccc` | o corpo |
| `--ds-text-mid` | `#d4d4d4` | títulos e o que sobe um degrau |
| `--ds-text-dim` | `#858585` | descrição, rótulo, o que fica um degrau abaixo |
| `--ds-text-inv` | `#ffffff` | texto sobre um fundo de destaque |
| `--ds-on-accent` | `#ffffff` | texto sobre `--ds-accent` |

O `--ds-on-accent` existe por um motivo medido: `#0e639c` é azul médio, preto sobre ele dá 3,3:1
e reprova o AA; branco dá 5,2:1. O token faz a escolha uma vez, e um app que troque o destaque por
uma cor clara troca este junto.

## O destaque, e os quatro que mudam em runtime

| token | valor padrão | uso |
|---|---|---|
| `--ds-accent` | `#0e639c` | o botão primário, o switch ligado, o playhead |
| `--ds-accent-h` | `#1177bb` | o mesmo, sob o ponteiro; o texto do item ativo |
| `--ds-accent-bg` | `rgba(14,99,156,0.15)` | o fundo do item ativo da gaveta e do alternador ligado |
| `--ds-sel` | `#094771` | a seleção de lista, a mesma do gerenciador de arquivos |
| `--ds-sel-text` | `#ffffff` | o texto do item selecionado |

Estes quatro (`--ds-accent`, `--ds-accent-h`, `--ds-accent-bg`, `--ds-sel`) são os únicos que mudam
em runtime: a pessoa escolhe a cor em Configurações e o shell os reescreve inline no `<html>` dele.
O resto da paleta é estático, e é isso que mantém pequena a ponte com os apps. Os nomes são um
contrato: um app os lê por `vssh.aparencia.tokens()` e os escreve no próprio documento, como mostra
[O Tuff](o-tuff.md#a-cor-de-destaque).

## Status

As cores semânticas de estado, as mesmas em toda peça: um verde de app aqui e outro ali é como um
ambiente deixa de parecer um ambiente.

| token | valor | uso |
|---|---|---|
| `--ds-green` | `#00e676` | ok, no ar |
| `--ds-warn` | `#c89b00` | aviso, degradado |
| `--ds-danger` | `#f44747` | erro, ação destrutiva |
| `--ds-danger-bg` | `rgba(244,71,71,0.12)` | o fundo do botão de perigo sob o ponteiro |

```html vivo
<span class="tuff-pill tuff-pill--ok">no ar</span>
<span class="tuff-pill tuff-pill--aviso">degradado</span>
<span class="tuff-pill tuff-pill--erro">fora</span>
<button class="tuff-btn tuff-btn--perigo">apagar</button>
```

## A paleta de categorias

Cinco cores brutas sem par semântico, para quem precisa de uma paleta de categorias que seja daqui:
um visualizador de dados, um editor com sintaxe colorida. Seis cores inventadas por app é como o
ambiente deixa de parecer um ambiente. Elas são a exceção à regra de ler só `--ds-*`, porque não
têm equivalente semântico.

| token | valor |
|---|---|
| `--tuff-green2` | `#6a9955` |
| `--tuff-yellow` | `#dcdcaa` |
| `--tuff-orange` | `#ce9178` |
| `--tuff-blue` | `#569cd6` |
| `--tuff-cyan` | `#4ec9b0` |
| `--tuff-purple` | `#c678dd` |

O realce de código deste site usa exatamente essas seis.

## Tipografia

| token | valor |
|---|---|
| `--ds-font` | `'Instrument Sans'`, com a pilha do sistema atrás |
| `--ds-font-mono` | `'JetBrains Mono'`, `'Cascadia Code'`, `Consolas`, monospace |
| `--tuff-size-2xs` … `--tuff-size-2xl` | 10, 11, 12, 13, 14, 16 e 20px |
| `--tuff-weight-n`, `-m`, `-b` | 400, 500, 600 |

13px é a medida do ambiente (`--tuff-size-md`): o conteúdo de um app respira um pouco mais que a
barra de tarefas, e as peças densas descem para `sm`. Os títulos sobem por peso e cor antes de subir
por tamanho; uma página de app não é um artigo, e escalas grandes só empurram o conteúdo para baixo.
Os tamanhos e pesos ficam em `--tuff-*` de propósito: são medidas, e não escolhas semânticas.

## Geometria e espaçamento

| token | valor |
|---|---|
| `--ds-radius-sm`, `-md`, `-lg`, `-xl` | 3, 4, 6 e 8px |
| `--ds-gap-xs`, `-sm`, `-md`, `-lg`, `-xl`, `-2xl` | 2, 4, 8, 12, 20 e 32px |
| `--ds-shadow-sm`, `-md`, `-lg` | sombras discretas, sem blur de fundo |
| `--ds-dur`, `--ds-dur-fast` | 0,15s e 0,08s |
| `--ds-ease`, `--ds-ease-out` | `ease`, `ease-out` |

A escala de espaçamento é semântica: um componente escreve `padding: var(--ds-gap-md)` e acerta a
densidade do ambiente sem saber que ela é 8px.

## O que só o shell lê

Dois tokens chegam a um app sem custo e sem uso: `--ds-statusbar-bg` e `--ds-fundo-padrao`, as
superfícies do próprio ambiente. Um app não desenha a barra de status nem a área de trabalho.
