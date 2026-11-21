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
| `tuff-base.css` | a página inteira: caixa, tipografia, scrollbar, foco, seleção, `color-scheme: dark`, e o desenho das peças para o HTML sem classe (`<button>`, `<input>`, `<select>`, `<table>`) | todo app com `tuff: true`; um bundle grande com CSS próprio passa a lista sem ele, porque um `box-sizing` global entrando por baixo muda a medida de tudo |
| `tuff.css` | os componentes | todo app que use o Tuff |
| `tuff.js` | o comportamento do núcleo: a gaveta de navegação (`TuffGaveta`) | quem tem gaveta |
| `tuff-icones.js` | o sprite de ícones, instalado no documento ao carregar (`TuffIcones`) | quem usa ícone |
| `tuff-midia.css`, `tuff-midia.js` | as peças de mídia: palco, chrome, transporte, trilha, grade, visor (`TuffMidia`) | opt-in: um app de formulário não paga por isto |
| `tuff-imagem.js`, `vendor/geotiff.min.js` | o decodificador de TIFF e HEIC (`TuffImagem`) e o geotiff que ele usa | ninguém põe a tag: `TuffMidia.imagem` busca o primeiro na primeira chamada, e ele busca o segundo no primeiro TIFF |

O `web.spa` do runtime injeta as tags no `index.html` do app, antes das do próprio app:

```js
const vssh = require('vssh');
const { web } = vssh;

// `tuff: true` injeta tokens, base, componentes e comportamento: tuff-tokens.css, tuff-base.css,
// tuff.css e tuff.js.
const spa = web.spa('frontend', { tuff: true });

// Uma lista nomeia o que entra, para quem quer também os ícones ou a mídia.
const completo = web.spa('frontend', {
  tuff: [...web.TUFF, web.TUFF_ICONES, ...web.TUFF_MIDIA],
});

// E para o bundle com CSS próprio, que fica sem a base.
const semBase = web.spa('frontend', { tuff: ['tuff-tokens.css', 'tuff.css', 'tuff.js'] });
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
.tuff-btn { min-height: max(30px, var(--ds-alvo)); }
```

A ordem é: padrão da biblioteca, depois a escolha do app, depois a escolha do ambiente. A folha do
app não precisa de especificidade a mais para valer sobre o Tuff; um `.tuff-painel { padding: 0 }`
escrito no CSS do app já ganha.

## Tokens semânticos, e só eles

Um componente escreve `var(--ds-bg2)`, `var(--ds-text-dim)`, `var(--ds-gap-md)`. Os `--tuff-*`
existem para a base poder mudar num lugar só, e o app segue a mesma regra do shell: lê `--ds-*` e
nunca `--tuff-*`. A lista inteira está em [Tokens](tokens.md).

## A cor de destaque

A pessoa escolhe uma cor em Configurações, e o shell reescreve cinco tokens no `<html>` dele:
`--ds-accent`, `--ds-accent-h`, `--ds-accent-bg`, `--ds-sel` e `--ds-on-accent`. Nada disso
atravessa para o documento do app: são dois documentos. O app que quer acompanhar a cor lê os cinco
pela ponte e os escreve no próprio `<html>`:

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

O que o Tuff não tem: menu de contexto, aviso, bandeja e seletor de arquivo. Essas superfícies são
do desktop, e o app as pede pela ponte (`vssh.dialogos.menuDeContexto`, `vssh.avisos`,
`vssh.arquivos.escolherArquivo`). É o que permite ao desktop montar o menu ele mesmo, e é por isso
que o menu de um app se parece com o resto do ambiente. Elas saem da janela do app, e o que é
desenhado dentro dele fica preso no documento dele.

O diálogo é dos dois lados, porque a pergunta de um app mora dentro da janela dele. Pedida ao shell
(`vssh.dialogos`), ela abre como folha da janela; desenhada pelo app (`TuffDialogo.abrir`), ela
abre como folha do documento, com a mesma marcação. [Componentes](componentes.md#diálogo) diz
quando usar cada um.

## O contrato com os apps

Um app não tem cópia do Tuff: uma mudança numa folha chega a todo app no deploy seguinte. O que o
Tuff promete a um app são os nomes, e a lista deles viaja com as folhas, em
[`api/tuff/contrato.json`](../../api/tuff/contrato.json):

| lista | o que tem |
|---|---|
| `classes` | toda classe `tuff-*` |
| `atributos` | todo `data-tuff-*` que um app escreve na marcação |
| `tokens` | toda variável `--tuff-*` e `--ds-*` |
| `funcoes` | todo membro dos objetos `Tuff*` (`TuffDialogo.abrir`, `TuffIcones.svg`) |
| `icones` | todo nome do sprite |

Um nome dessas listas continua valendo. O desenho de uma peça pode mudar de uma versão do ambiente
para outra, e o que mudou de propósito sai no [MIGRATION.md](../../MIGRATION.md#o-tuff-o-que-muda-e-o-que-fica).

Um nome que precisa sair entra em `de_saida`, com a lista dele, o que usar no lugar (`use`) e o dia
em que entrou (`desde`, no formato `AAAA-MM-DD`). O Tuff do ambiente continua atendendo o nome por
90 dias a partir do `desde`, e só depois disso o tira das folhas.

O `vssh-app-publish` procura cada nome de `de_saida` nos arquivos de página e de folha do pacote:

| quando | o que o publish faz |
|---|---|
| nos 90 dias | publica, com um aviso no run: o arquivo, a linha, o nome, o dia em que ele sai e o `use` |
| depois deles | recusa a publicação, com a mesma lista, porque o ambiente não atende mais o nome |

A procura é por texto e pega também um comentário que cita o nome. Um ícone conta pelo `#ico-<nome>`
e pelo nome entre aspas numa chamada a `TuffIcones`. Para ver o que um Tuff que ainda não saiu diz
do seu app, aponte `VSSH_SDK_TUFF` para a pasta dele.

O que o contrato deixa de fora: o desenho de cada peça, os seletores internos de uma folha, e
qualquer nome que não esteja na lista. Um app que escreve CSS contra a estrutura de dentro de uma
peça (`.tuff-abas > div:first-child`) depende do que o Tuff não promete.

Para ver o seu app com um Tuff que ainda não saiu, o guia é
[As figuras de um app com dois Tuffs](../guias/figuras-com-dois-tuffs.md).

## A régua de aceitação

Seis coisas que um app feito com o Tuff respeita, e que a galeria existe para julgar olhando:

- controle nativo, nunca: `select` e `input` têm caixa própria (`.tuff-select`, `.tuff-campo`), e
  a lista aberta do `select` também sai estilizada, senão ela vem branca sob um controle escuro;
- rótulo e valor nunca têm o mesmo peso: sem hierarquia, uma coluna de opções vira uma pilha de
  pares iguais;
- a barra de ações gruda no fim do painel (`.tuff-acoes`); botão flutuando no meio do espaço é o
  sintoma mais comum de tela feita às pressas;
- a scrollbar é a do tema, 6px, em `tuff-base.css`;
- a tela cabe em 360 px sem rolagem horizontal, porque o mesmo app abre numa janela estreita do
  ambiente e na tela de um celular;
- o ambiente é escuro. O Tuff não tem modo claro, e prometer um que não existe seria pior que não
  prometer nada.

## A fonte

A Instrument Sans é a fonte do ambiente e não atravessa o iframe: o `@font-face` de um documento
não vale no outro. Por isso ela vem dentro de `tuff-tokens.css`, com URL relativa (`fonts/…`), e é
servida por quem serve a folha. Um app que só nomeasse a família cairia em `system-ui` e ficaria
estrangeiro ao lado das outras janelas; a tipografia denuncia uma janela antes de qualquer cor. A
licença é a SIL OFL 1.1, distribuída junto em `fonts/OFL.txt`.
