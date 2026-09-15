# Ícones

O sprite de `tuff-icones.js`: os ícones que o shell pede, mais os que um visualizador de fotos e
um player de vídeo pedem. Um traço só, 16×16, `currentColor`. O arquivo instala o sprite no
documento ao carregar, e um app o recebe como `_sdk/tuff/tuff-icones.js`, com os mesmos ids do
shell.

Um ícone é um `use` apontando para o id do símbolo, com a classe que dá o tamanho:

```html vivo
<svg class="tuff-ico"><use href="#ico-folder"></use></svg>
<svg class="tuff-ico tuff-ico--lg"><use href="#ico-folder-open"></use></svg>
<button class="tuff-btn"><svg class="tuff-ico"><use href="#ico-download"></use></svg> baixar</button>
```

O mesmo markup, como string, sai de `TuffIcones.svg('folder')`; `TuffIcones.tem('folder')`
responde se o nome existe, e `TuffIcones.nomes()` lista todos, que é como esta página foi gerada.

Um `use` que aponta para um id que não existe não lança: ele só não desenha, e um botão com um
quadrado vazio fica meses na tela sem uma linha no console. `TuffIcones.svg()` avisa no console
quando o nome não existe, e o build deste site recusa uma amostra com ícone fora do sprite. O
sprite viaja em JavaScript por um motivo: um `use` não atravessa documentos, e um app roda noutro
documento; `use href="arquivo.svg#id"` depende de CORS e não herda `currentColor` com
confiança, e uma fonte de ícones renderiza texto onde deveria haver desenho.

## Todos os ícones

A grade abaixo é lida do sprite no build do site: o que está aqui é o que existe.

```tuff-icones
```
