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
peça. Os degraus são cinza puro, sem matiz, porque a cor do ambiente é a de destaque, que a pessoa
escolhe. Sem sombra difusa e sem vidro: `--ds-blur` vale `none` em todo o sistema, e isso é decisão
de produto.

| token | valor | uso |
|---|---|---|
| `--ds-bg` | `#1b1b1b` | a página, o fundo do palco |
| `--ds-bg2` | `#222222` | uma peça sobre a página: painel, barra, lateral |
| `--ds-bg3` | `#2b2b2b` | algo sobre a peça: botão, tag, tooltip |
| `--ds-bg-input` | `#353535` | o fundo de campo, select, busca e trilhos |
| `--ds-bg-hover` | `rgba(255,255,255,0.06)` | o realce sob o ponteiro |
| `--ds-border` | `#454545` | toda divisa e toda moldura |
| `--ds-border-input` | `#707070` | o contorno de campo, select e busca |
| `--ds-border-focus` | `#0e639c` | a borda de um campo com foco; é o azul padrão do destaque, e não acompanha a cor escolhida |

O campo se acha pelo contorno: o degrau de fundo entre ele e a peça fica em 1,30:1, e o contorno
passa de 3:1 sobre a peça, o mínimo de um componente de interface.

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
| `--ds-text` | `#d8d8d8` | o corpo |
| `--ds-text-mid` | `#ededed` | títulos e o que sobe um degrau |
| `--ds-text-dim` | `#a0a0a0` | descrição, rótulo, o que fica um degrau abaixo |
| `--ds-text-inv` | `#ffffff` | texto branco fixo |
| `--ds-on-accent` | `#ffffff` | texto sobre `--ds-accent` |

O texto apagado passa de 4,5:1 sobre as três superfícies e sobre o campo (4,69:1, o pior caso).

O `--ds-on-accent` muda com a cor. Branco sobre o azul padrão dá 6,40:1; quando a pessoa escolhe
uma cor, o shell o reescreve: branco quando o branco passa de 4,5:1 sobre ela, e `#1b1b1b` quando
não passa. As sete cores de Configurações levam branco.

## O destaque, e os cinco que mudam em runtime

| token | valor padrão | uso |
|---|---|---|
| `--ds-accent` | `#0e639c` | o botão primário, o switch ligado, o playhead |
| `--ds-accent-h` | `#0c5485` | o mesmo, sob o ponteiro |
| `--ds-accent-bg` | `rgba(14,99,156,0.15)` | o fundo do item ativo da gaveta e do alternador ligado |
| `--ds-sel` | `#094771` | a seleção de lista, a mesma do gerenciador de arquivos |
| `--ds-sel-text` | `#ffffff` | o texto do item selecionado |
| `--ds-on-accent` | `#ffffff` | o texto sobre `--ds-accent` |
| `--ds-accent-texto` | 55% do destaque com branco | o destaque como texto ou ícone: o item ativo, o link |

Estes cinco (`--ds-accent`, `--ds-accent-h`, `--ds-accent-bg`, `--ds-sel`, `--ds-on-accent`) são os
únicos que mudam em runtime: a pessoa escolhe a cor em Configurações e o shell os reescreve inline
no `<html>` dele. Sob o ponteiro, o destaque escurece quando o texto sobre ele é branco e clareia
quando o texto é escuro, para o hover não tirar contraste do botão. O `--ds-accent-texto` não muda
sozinho: ele é calculado de `--ds-accent` na folha, e acompanha a cor quando ela chega. Ele existe
porque o destaque cru como texto fica em cerca de 2,4:1 sobre a página.
O resto da paleta é estático, e é isso que mantém pequena a ponte com os apps. Os nomes são um
contrato: um app os lê por `vssh.aparencia.tokens()` e os escreve no próprio documento, como mostra
[O Tuff](o-tuff.md#a-cor-de-destaque).

## Status

As cores semânticas de estado, as mesmas em toda peça: um verde de app aqui e outro ali é como um
ambiente deixa de parecer um ambiente.

| token | valor | uso |
|---|---|---|
| `--ds-green` | `#4caf7d` | ok, no ar |
| `--ds-warn` | `#d6a531` | aviso, degradado |
| `--ds-danger` | `#f05a50` | erro, ação destrutiva |
| `--ds-danger-bg` | `rgba(240,90,80,0.12)` | o fundo do botão de perigo sob o ponteiro |

As três passam de 4,5:1 sobre a página. Com o âmbar ou o vermelho como destaque, o aviso e o erro se
separam dele pelo ícone e pelo texto, e nunca só pela cor.

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
