# A moldura

Um app de lista e detalhe tem as mesmas cinco regiões em qualquer largura: a barra em cima, a
lateral com os lugares, o miolo com o conteúdo, o painel com o detalhe do que está selecionado e o
rodapé com o estado. A moldura do Tuff (`.tuff-app`) recebe essas regiões e escolhe a disposição
pela largura da janela. Numa janela larga as três colunas ficam lado a lado; num celular em pé a
lateral vira gaveta e o painel vira a tela seguinte, com "Voltar". O app que descreve as regiões
ganha a forma de celular sem escrever CSS para ela.

O CSS está em `tuff.css`, e o comportamento (abrir, fechar, o foco, o Esc, o "Mais") está em
`tuff.js`. Os dois templates nascem na moldura, e a Lupa e o Palco são os exemplos com conteúdo de
verdade.

## As regiões

Cada região é um filho direto da raiz, e nenhuma é obrigatória além do miolo. A ordem no HTML é a
de leitura: barra, lateral, miolo, painel, rodapé.

| classe | região |
|---|---|
| `.tuff-app` | a raiz, que ocupa a altura do pai e é o contêiner das consultas de largura |
| `.tuff-app-barra` | a barra de cima, com o título (`.tuff-app-titulo`) e as ações; costuma levar `.tuff-barra` junto |
| `.tuff-app-lateral` | os lugares, com itens `.tuff-gaveta-item` e o atual marcado com `aria-current` |
| `.tuff-app-miolo` | o conteúdo, que rola sozinho |
| `.tuff-app-painel` | o detalhe, com `.tuff-app-painel-cab` e o título em `.tuff-app-painel-titulo` |
| `.tuff-app-rodape` | o estado, que costuma levar `.tuff-status` |

A caixa abaixo é a moldura só com o CSS. Estique-a pelo canto de baixo e ela muda de forma.

```html vivo
<div style="resize: horizontal; overflow: hidden; width: 100%; min-width: 300px; height: 300px; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md)">
  <div class="tuff-app">
    <div class="tuff-app-barra tuff-barra">
      <button class="tuff-btn tuff-btn--icone tuff-app-so-compacta" type="button" data-tuff-app-gaveta aria-label="Pastas"><svg class="tuff-ico" aria-hidden="true"><use href="#ico-menu"></use></svg></button>
      <span class="tuff-app-titulo">Campo 2026</span>
      <span class="tuff-barra-espaco"></span>
      <button class="tuff-btn tuff-btn--icone" type="button" data-prioridade="baixa" aria-label="Girar"><svg class="tuff-ico" aria-hidden="true"><use href="#ico-rotate-right"></use></svg></button>
      <button class="tuff-btn tuff-btn--icone tuff-app-so-media" type="button" data-tuff-app-painel aria-label="Informações"><svg class="tuff-ico" aria-hidden="true"><use href="#ico-info"></use></svg></button>
      <button class="tuff-btn tuff-btn--icone tuff-app-so-compacta" type="button" data-tuff-app-mais aria-label="Mais ações"><svg class="tuff-ico" aria-hidden="true"><use href="#ico-more"></use></svg></button>
    </div>
    <nav class="tuff-app-lateral" aria-label="Pastas">
      <button class="tuff-gaveta-item" type="button" aria-current="true"><svg class="tuff-ico" aria-hidden="true"><use href="#ico-folder"></use></svg><span>Campo 2026</span></button>
      <button class="tuff-gaveta-item" type="button"><svg class="tuff-ico" aria-hidden="true"><use href="#ico-folder"></use></svg><span>Microscopia</span></button>
    </nav>
    <main class="tuff-app-miolo"><div class="tuff-lista" role="listbox" aria-label="Imagens">
      <div class="tuff-item" role="option" aria-selected="true">talhao-03_norte.jpg</div>
      <div class="tuff-item" role="option" aria-selected="false">armadilha-luminosa-1.jpg</div>
    </div></main>
    <aside class="tuff-app-painel" aria-label="Informações">
      <div class="tuff-app-painel-cab"><span class="tuff-app-painel-titulo">talhao-03_norte.jpg</span></div>
      <dl class="tuff-kv"><dt>Tipo</dt><dd>JPEG</dd><dt>Dimensões</dt><dd>4032 × 3024</dd></dl>
    </aside>
    <div class="tuff-app-rodape tuff-status">2 imagens em Campo 2026</div>
  </div>
</div>
```

## As três formas

A forma sai da largura da moldura, e não da tela: um app pode estar numa janela pequena de um
monitor grande. As faixas são as classes de janela do Android.

| forma | largura | lateral | painel | botões de `data-prioridade="baixa"` |
|---|---|---|---|---|
| ampla | 840 px em diante | coluna | coluna | na barra |
| média | de 600 a 839 px | coluna | entra pela borda direita quando pedido | na barra |
| compacta | abaixo de 600 px | gaveta, por cima de tudo | tela seguinte, com "Voltar" | no "Mais" |

Dois auxiliares escondem o botão que não faz nada na forma corrente: `.tuff-app-so-compacta` (o
botão da gaveta, o "Voltar" e o "Mais") e `.tuff-app-so-media` (o botão do painel e o "Fechar"
dele). Um controle que não faz nada numa forma ensina a não confiar em controle nenhum.

## O comportamento

```js
const moldura = TuffApp.ligar(document.querySelector('.tuff-app'), {
  aoMudarForma: (forma) => { /* 'compacta', 'media' ou 'ampla' */ },
  mais: () => [{ label: 'Sobre', action: () => {} }],   // itens a mais no fim do "Mais"
});
moldura.forma();             // a forma agora
moldura.abrirPainel(item);   // ao selecionar; o foco volta ao item quando o painel fecha
moldura.fecharPainel();
moldura.abrirGaveta();
moldura.fecharGaveta();
moldura.destruir();
```

Os gatilhos são atributos, e valem para o que nascer depois na moldura:

| atributo | o clique |
|---|---|
| `data-tuff-app-gaveta` | abre e fecha a lateral na compacta |
| `data-tuff-app-painel` | abre e fecha o painel na média e na compacta |
| `data-tuff-app-voltar`, `data-tuff-app-fechar` | fecham o painel |
| `data-tuff-app-mais` | abre o menu do ambiente com os botões de prioridade baixa que saíram da barra |

O "Mais" leva o rótulo (`aria-label`), o ícone e o estado (`aria-pressed`) de cada botão, e o item
chama o `click()` dele. Um botão escondido pelo app com `hidden`, nele ou num grupo em volta, fica
de fora: quem o tirou da tela foi o app, e não a forma.

A moldura cuida do foco. A gaveta abre com o foco no lugar atual e o devolve a quem a abriu; o
painel aberto por cima de outra região leva o foco na compacta, onde o miolo saiu da tela. O Esc
fecha a gaveta e o painel, e na compacta o que fica atrás deles ganha `inert`. Escolher um lugar na
gaveta a fecha. Uma mudança de forma fecha os dois.

A moldura chega ao app pelo `tuff.js`. `web.TUFF` (Python) e `web.TUFF` (Node) já o incluem; um
app que monta a lista do Tuff à mão, como a Lupa e o Palco fazem por causa do `tuff-midia.js`, põe
`tuff.js` nela.

## O toque

Sob ponteiro de toque, `--ds-alvo` sobe de 26 para 44 px, e os botões, os itens da lateral e o
cabeçalho do painel crescem com ele. Uma peça do app que desenha linhas próprias usa o mesmo valor:
o Palco dá às linhas da fila `height: max(30px, var(--ds-alvo))`.

`matchMedia('(pointer: coarse)')` responde dentro do quadro do app, sem a ponte. O Palco usa a
consulta para tocar a faixa com um toque só na fila, onde o mouse pede o clique duplo.

## O que o app ainda adapta

A moldura decide onde ficam as regiões. O que mora dentro delas é do app, e a forma está à mão nos
dois lados:

```css
@container tuff-app (width < 600px) {
  .pagina { display: none; }
}
```

```js
if (document.querySelector('.tuff-app').dataset.forma === 'compacta') { /* … */ }
```

Os casos que os exemplos resolvem por conta própria:

- Uma barra com muitas ferramentas não cabe na forma média. A Lupa manda os botões de prioridade
  baixa para o "Mais" já abaixo de 840 px, com o "Mais" visível ali também, e esconde na compacta
  o campo de página, que é um campo e não entra no menu.
- Uma coluna que a pessoa liga e desliga na forma ampla, como a ficha da Lupa e a fila do Palco,
  tem dois botões, e um só aparece por vez. Na ampla o botão é um interruptor (`aria-pressed`) que
  põe e tira `hidden` do painel, com a escolha guardada. Abaixo de 840 px o outro botão é o
  `data-tuff-app-painel`, que abre o painel por cima (`aria-expanded`), e o painel fica sem
  `hidden`. No `aoMudarForma` o app ressincroniza os dois.
- Um transporte de mídia com alvos de toque não cabe numa fileira em 320 px. O Palco dá aos
  comandos do meio uma fileira própria na compacta.

## A janela no ambiente

O manifesto continua dando o tamanho de abertura (`window.width`, `window.height`) e o piso do
redimensionamento (`window.minimos`). Os dois valem para a tela larga. Num celular em pé o
ambiente põe a janela na tela inteira e o piso cede, então o app que declara `minimos` precisa
caber na forma compacta da moldura. O shell não manda a forma pela ponte: o CSS responde pela
largura da moldura, e o toque pela consulta de mídia.
