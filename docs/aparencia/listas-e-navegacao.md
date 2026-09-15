# Listas e navegação

As peças com que um app organiza o que mostra: a lista e o par chave e valor, a barra de
ferramentas, a gaveta de navegação, a busca, o detalhe e o tooltip. Todas em `tuff.css`; a gaveta
é a única que precisa de `tuff.js`.

## Lista

`.tuff-lista` é uma coluna que rola; cada `.tuff-item` é uma linha, com `role="option"` e
`aria-selected` quando a lista é uma escolha. A seleção usa `--ds-sel`, o mesmo realce do
gerenciador de arquivos do ambiente: um destaque próprio aqui faria a lista de um app se comportar
diferente da lista ao lado, no mesmo desktop. Um nome comprido trunca com reticências em vez de
quebrar a linha.

```html vivo
<div class="tuff-lista" role="listbox" aria-label="Arquivos">
  <div class="tuff-item" role="option" aria-selected="false"><svg class="tuff-ico tuff-ico--sm"><use href="#ico-file"></use></svg>relatorio-2026.pdf</div>
  <div class="tuff-item" role="option" aria-selected="true"><svg class="tuff-ico tuff-ico--sm"><use href="#ico-file"></use></svg>medicoes.parquet</div>
  <div class="tuff-item" role="option" aria-selected="false"><svg class="tuff-ico tuff-ico--sm"><use href="#ico-file"></use></svg>notas.md</div>
  <div class="tuff-item" role="option" aria-selected="false"><svg class="tuff-ico tuff-ico--sm"><use href="#ico-file"></use></svg>um-nome-bem-comprido-que-nao-cabe-na-coluna-e-por-isso-trunca.tar.gz</div>
</div>
```

`.tuff-item` é linha de lista. Um rótulo solto ao lado de um ícone, fora de uma lista, é um
`span` comum; usar a linha para isso ensinaria o contrário.

## Chave e valor

O par de leitura, com a hierarquia obrigatória: a chave em `--ds-text-dim`, o valor em
`--ds-text`. A coluna do valor é monoespaçada com `--mono` quando o conteúdo é dado (caminho, id,
hash): texto proporcional embaralha a leitura de coisa que se compara olhando.

```html vivo
<dl class="tuff-kv tuff-kv--mono">
  <dt>caminho</dt><dd>/home/pesquisador/dados</dd>
  <dt>socket</dt><dd>/run/user/1000/vssh-app.sock</dd>
  <dt>versão</dt><dd>5.0.12</dd>
</dl>
```

## Barra de ferramentas

Uma fileira com divisa embaixo: blocos que mudam juntos, separados por linha. Dentro dela o botão
de ícone perde a moldura, e `.tuff-barra-espaco` empurra o que vem depois para a direita.

```html vivo
<div class="tuff-barra">
  <button class="tuff-btn tuff-btn--icone" aria-label="Voltar"><svg class="tuff-ico"><use href="#ico-arrow-left"></use></svg></button>
  <button class="tuff-btn tuff-btn--icone" aria-label="Recarregar"><svg class="tuff-ico"><use href="#ico-refresh"></use></svg></button>
  <span class="tuff-sec-desc">4 itens</span>
  <span class="tuff-barra-espaco"></span>
  <button class="tuff-btn">novo</button>
</div>
```

A variante `--fixa` prende a barra no topo enquanto o conteúdo rola por baixo, com fundo opaco: sob
uma barra translúcida passa texto rolando. Ela só encosta nas bordas se o contêiner de rolagem não
tiver padding, e é por isso que o corpo da gaveta, abaixo, não tem.

## A gaveta de navegação

Lateral com as seções, mais o corpo. Ela é a lateral da janela de Configurações do ambiente, com a
mesma medida (208px) e o mesmo realce do item ativo, e é o que faz a lateral de um app parecer a
lateral do ambiente. A lateral é persistente: é ela que responde "onde eu estou". Um menu que fecha
depois de escolher devolve a pessoa para uma tela sem pista de onde ela está.

```html vivo
<div class="tuff-gaveta" style="height:260px">
  <div class="tuff-gaveta-veu"></div>
  <nav class="tuff-gaveta-lateral" aria-label="Seções">
    <div class="tuff-gaveta-cap">Biblioteca</div>
    <button class="tuff-gaveta-item tuff-gaveta-item--ativo" data-alvo="ex-fotos"><svg class="tuff-ico"><use href="#ico-image"></use></svg><span>Fotos</span></button>
    <button class="tuff-gaveta-item" data-alvo="ex-videos"><svg class="tuff-ico"><use href="#ico-video"></use></svg><span>Vídeos</span></button>
    <div class="tuff-gaveta-cap">App</div>
    <button class="tuff-gaveta-item" data-alvo="ex-config"><svg class="tuff-ico"><use href="#ico-settings"></use></svg><span>Configurações</span></button>
  </nav>
  <div class="tuff-gaveta-corpo">
    <div class="tuff-barra tuff-barra--fixa">
      <button class="tuff-btn tuff-btn--icone tuff-gaveta-abrir" data-tuff-gaveta-abrir aria-label="Seções"><svg class="tuff-ico"><use href="#ico-menu"></use></svg></button>
      <strong>Fotos</strong>
    </div>
    <div class="tuff-gaveta-conteudo">
      <section id="ex-fotos"><div class="tuff-sec-desc">O corpo rola; a lateral fica parada.</div></section>
    </div>
  </div>
</div>
```

O que cada parte faz:

| classe | papel |
|---|---|
| `.tuff-gaveta` | a raiz: um flex, e um contêiner (`container-type: inline-size`) |
| `.tuff-gaveta-lateral` | a coluna de 208px com as seções; `.tuff-gaveta-cap` é a legenda de família, `.tuff-gaveta-item` cada entrada, `--ativo` a corrente |
| `.tuff-gaveta-corpo` | o que rola, sem padding, para uma barra fixa poder encostar nas bordas |
| `.tuff-gaveta-conteudo` | o respiro do conteúdo, separado do contêiner de rolagem |
| `.tuff-gaveta-veu` | o véu que cobre o corpo quando a gaveta abre estreita |
| `.tuff-gaveta-abrir` | o botão que abre; some quando a lateral é persistente, porque um controle que não faz nada ensina a não confiar em controle nenhum |

Estreita (o contêiner com menos de 640px), a lateral vira gaveta: `position: absolute`, nunca
`fixed`, porque um app é um `iframe` dentro de uma janela do ambiente, e com `absolute` ela
pertence ao contêiner. O ponto de virada é `@container`, e não `@media`: o que decide é a largura
do contêiner, e um app pode ter a gaveta dentro de um painel de 400px numa tela de 4K. Fechada, a
lateral fica `visibility: hidden` e sai da ordem de tabulação, para quem navega por teclado não
cair dentro de um menu que não está na tela.

O comportamento vem de `tuff.js`:

```js
const gaveta = TuffGaveta.ligar(document.querySelector('.tuff-gaveta'));
// gaveta.abrir(), gaveta.fechar(), gaveta.destruir()
```

`ligar` faz o que CSS não faz: devolve o foco para quem abriu, fecha no Esc e no véu, marca o item
da seção visível enquanto a página rola (cada item aponta a seção pelo `data-alvo`), e fecha a
gaveta depois de um clique só quando ela está em modo gaveta; persistente, ela responde "onde eu
estou", e fechá-la apagaria a resposta no momento em que a pessoa acabou de perguntar.

## Busca

Um `input type="search"` com a lupa embutida. A cruz nativa do WebKit sai: ela é branca, quadrada
e não tem nada a ver com o resto.

```html vivo
<input class="tuff-busca" type="search" placeholder="filtrar…" aria-label="Filtrar">
```

## Detalhe

Um `details` nativo: abre sem JavaScript, é encontrável pelo Ctrl+F do navegador e já anuncia o
estado a um leitor de tela. A seta padrão sai e volta como pseudo-elemento, para girar.

```html vivo
<details class="tuff-detalhe">
  <summary>Por que o app não vê meus arquivos</summary>
  <div class="tuff-detalhe-corpo">
    O backend roda como você no servidor, com acesso POSIX. O seletor existe para você dizer qual
    pasta, e a permissão já havia.
  </div>
</details>
<details class="tuff-detalhe" open>
  <summary>Aberto de início</summary>
  <div class="tuff-detalhe-corpo">Com o atributo <code>open</code> no <code>details</code>.</div>
</details>
```

## Tooltip

O `title` nativo é desenhado pelo sistema: no Windows, uma caixinha clara com fonte do sistema, no
meio de uma janela escura. Este é desenhado pela folha, a partir de `data-tuff-dica`, e aparece
sob o ponteiro e com o foco do teclado.

```html vivo
<span class="tuff-tag" data-tuff-dica="declarado em requiredPackages" tabindex="0">python3-pip</span>
<button class="tuff-btn tuff-btn--icone" data-tuff-dica="Recarregar a lista" aria-label="Recarregar"><svg class="tuff-ico"><use href="#ico-refresh"></use></svg></button>
```

O elemento precisa de um rótulo acessível próprio (`aria-label`, ou texto visível): um tooltip em
CSS puro não é anunciado por leitor de tela, e usá-lo como única fonte da informação a esconderia
de quem mais precisa dela. Ele é reforço, nunca o único caminho.
