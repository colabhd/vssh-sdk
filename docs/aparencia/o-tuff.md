# O Tuff

O Tuff é o ambiente visual do VSSH: a paleta, a tipografia, a geometria e os componentes com que
o shell desenha as janelas dele. Um vssh-app recebe os mesmos arquivos, e é por eles que a janela
do app passa por janela do ambiente em vez de denunciar que é uma página web dentro de outra. Esta
seção documenta o que um app pode usar; a galeria com todos os componentes, numa página só, é o
[catálogo](../../api/tuff/docs/componentes.html).

## O que chega a um app

O sistema serve o Tuff dentro do espaço de URL de cada app, sob `_sdk/tuff/`, ao lado do SDK web.
Nenhum byte viaja no pacote do app, e uma cópia vendorizada de qualquer um desses arquivos é um
defeito: ela para no tempo enquanto o ambiente segue.

| arquivo | o que é | quem carrega |
|---|---|---|
| `tuff-tokens.css` | os valores (`--tuff-*` e `--ds-*`) e o `@font-face` da Instrument Sans | todo app que use o Tuff; um app com identidade própria que só quer a cor do ambiente carrega só este |
| `tuff-base.css` | o reset da página inteira: caixa, tipografia, scrollbar, foco, seleção, `color-scheme: dark` | um app novo; um bundle grande com CSS próprio fica sem ele, porque um `box-sizing` global entrando por baixo muda a medida de tudo |
| `tuff.css` | os componentes | todo app que use o Tuff |
| `tuff.js` | o comportamento do núcleo: a gaveta de navegação (`TuffGaveta`) | quem tem gaveta |
| `tuff-icones.js` | o sprite de ícones, instalado no documento ao carregar (`TuffIcones`) | quem usa ícone |
| `tuff-midia.css`, `tuff-midia.js` | as peças de mídia: palco, chrome, transporte, trilha, grade, visor (`TuffMidia`) | opt-in: um app de formulário não paga por isto |
| `tuff-imagem.js`, `vendor/geotiff.min.js` | o decodificador de TIFF e HEIC (`TuffImagem`) e o geotiff que ele usa | ninguém põe a tag: `TuffMidia.imagem` busca o primeiro na primeira chamada, e ele busca o segundo no primeiro TIFF |

O `web.spa` do runtime injeta as tags no `index.html` do app, antes das do próprio app:

```js
const vssh = require('vssh');
const { web } = vssh;

// `tuff: true` injeta tokens, componentes e comportamento: tuff-tokens.css, tuff.css e tuff.js.
const spa = web.spa('frontend', { tuff: true });

// Uma lista nomeia o que entra, para quem quer também o reset, os ícones ou a mídia.
const completo = web.spa('frontend', {
  tuff: [...web.TUFF, web.TUFF_BASE, web.TUFF_ICONES, ...web.TUFF_MIDIA],
});
```

Em Python, `web.spa('frontend', tuff=True)` e `web.TUFF`, `web.TUFF_BASE`, `web.TUFF_ICONES`,
`web.TUFF_MIDIA`, com o mesmo efeito. Um app que escreve o próprio `<head>` põe as tags à mão,
relativas à raiz dele, na ordem da tabela:

```html
<link rel="stylesheet" href="_sdk/tuff/tuff-tokens.css">
<link rel="stylesheet" href="_sdk/tuff/tuff-base.css">
<link rel="stylesheet" href="_sdk/tuff/tuff.css">
<script src="_sdk/tuff/tuff-icones.js" defer></script>
<script src="_sdk/tuff/tuff.js" defer></script>
```

Fora do ambiente ninguém serve `_sdk/`. Para desenvolver, o guia do
[ambiente de desenvolvimento](../guias/ambiente-de-desenvolvimento.md) mostra como servir
`api/tuff/` deste repositório na frente do app; é o mesmo arquivo que o sistema serve.

## A camada, e quem vence

Tudo do Tuff mora em `@layer vssh`. Regra dentro de camada perde para regra fora de camada, seja
qual for a ordem em que as folhas chegam, e é isso que dá a hierarquia certa sem `!important`:

```css
/* A biblioteca, dentro da camada: o padrão. */
@layer vssh {
  .tuff-btn { min-height: 26px; }
}

/* O app, fora da camada: vence em todo empate, mesmo carregado antes. */
.tuff-btn { min-height: 30px; }
```

A ordem é: padrão da biblioteca, depois a escolha do app, depois a escolha do ambiente. A folha do
app não precisa de especificidade a mais para valer sobre o Tuff; um `.tuff-painel { padding: 0 }`
escrito no CSS do app já ganha.

## Tokens semânticos, e só eles

Um componente escreve `var(--ds-bg2)`, `var(--ds-text-dim)`, `var(--ds-gap-md)`. Os `--tuff-*`
existem para a base poder mudar num lugar só, e o app segue a mesma regra do shell: lê `--ds-*` e
nunca `--tuff-*`. A lista inteira está em [Tokens](tokens.md).

## A cor de destaque

A pessoa escolhe uma cor em Configurações, e o shell reescreve quatro tokens no `<html>` dele:
`--ds-accent`, `--ds-accent-h`, `--ds-accent-bg` e `--ds-sel`. Nada disso atravessa para o
documento do app: são dois documentos. O app que quer acompanhar a cor lê os quatro pela ponte e os
escreve no próprio `<html>`:

```js
function aplicar(tokens) {
  // `null` quer dizer "não sobrescreva nada": o padrão da folha já está pintando a página.
  if (!tokens) return;
  for (const [nome, valor] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(nome, valor);
  }
}
aplicar(vssh.aparencia.tokens());
vssh.aparencia.aoMudar(aplicar);
```

O inline no `<html>` vence a camada e a folha, e todo componente que lê `--ds-accent` (o botão
primário, o item ativo da gaveta, a seleção da lista, o playhead do player) muda junto. `aoMudar`
só dispara quando o valor muda: o shell reescreve o `style` dele por outros motivos, e cada um
acordaria o app para repintar a mesma cor.

## O que é do Tuff, e o que é do desktop

A régua para uma peça nova é uma: se um app poderia precisar do mesmo componente, ele é do Tuff. O
que é do shell e de mais ninguém (a barra de tarefas, o menu iniciar, a área de trabalho) fica nas
folhas do shell.

O que o Tuff não tem, e nunca vai ter: diálogo, menu de contexto, aviso, bandeja e seletor de
arquivo. Essas superfícies são do desktop, e o app as pede pela ponte (`vssh.dialogos`,
`vssh.avisos`, `vssh.arquivos.escolherArquivo`). É o que permite ao desktop montar o menu ele mesmo,
e é por isso que o menu de um app se parece com o resto do ambiente. Há um motivo mecânico além do
estético: um modal desenhado dentro do app fica preso no iframe. Ele não cobre a janela, não
sobrevive a um app em tela cheia e não aparece por cima do resto do ambiente. Um `div` com
`position: fixed` dá a impressão de diálogo até o dia em que alguém maximiza a janela.

## A régua de aceitação

Cinco coisas que um app feito com o Tuff respeita, e que a galeria existe para julgar olhando:

- controle nativo, nunca: `select` e `input` têm caixa própria (`.tuff-select`, `.tuff-campo`), e
  a lista aberta do `select` também sai estilizada, senão ela vem branca sob um controle escuro;
- rótulo e valor nunca têm o mesmo peso: sem hierarquia, uma coluna de opções vira uma pilha de
  pares iguais;
- a barra de ações gruda no fim do painel (`.tuff-acoes`); botão flutuando no meio do espaço é o
  sintoma mais comum de tela feita às pressas;
- a scrollbar é a do tema, 6px, em `tuff-base.css`;
- o ambiente é escuro. O Tuff não tem modo claro, e prometer um que não existe seria pior que não
  prometer nada.

## A fonte

A Instrument Sans é a fonte do ambiente e não atravessa o iframe: o `@font-face` de um documento
não vale no outro. Por isso ela vem dentro de `tuff-tokens.css`, com URL relativa (`fonts/…`), e é
servida por quem serve a folha. Um app que só nomeasse a família cairia em `system-ui` e ficaria
estrangeiro ao lado das outras janelas; a tipografia denuncia uma janela antes de qualquer cor. A
licença é a SIL OFL 1.1, distribuída junto em `fonts/OFL.txt`.
