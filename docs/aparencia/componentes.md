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

## Alça de largura

A borda entre duas regiões lado a lado, que a pessoa arrasta para mudar a largura de uma delas: o
painel de detalhes ao lado de uma lista, a lateral de um navegador de pastas. A alça desenha a
linha de 1px que a borda da região desenharia, e o ponteiro a pega a 4px de cada lado dela. A
linha clareia sob o ponteiro, e só leva `--ds-accent` no arraste e no foco do teclado.

```html vivo
<div style="display:flex; height:140px; border:1px solid var(--ds-border); border-radius:var(--ds-radius-lg); overflow:hidden">
  <div style="flex:1; min-width:0; padding:var(--ds-gap-md)">a lista</div>
  <div class="tuff-alca" aria-label="Largura do painel de detalhes"></div>
  <aside id="detalhes" style="width:240px; padding:var(--ds-gap-md); background:var(--ds-bg2)">o painel</aside>
</div>
```

A alça é filha de um flex em linha, entre as duas regiões, e a região que ela redimensiona não
leva borda própria do lado dela. O comportamento vem de `tuff.js`:

```js
const detalhes = document.getElementById('detalhes');
const alca = TuffAlca.ligar(document.querySelector('.tuff-alca'), {
  alvo: detalhes,
  lado: 'fim',      // a região vem depois da alça; 'inicio' para uma lateral antes dela
  min: 200,
  max: () => detalhes.parentElement.clientWidth - 320,   // o que fica para a lista
  padrao: 280,      // a largura do duplo clique
  inicial: Number(localStorage.getItem('largura-detalhes')) || null,
  aoMudar: (largura) => localStorage.setItem('largura-detalhes', String(largura)),
});
// alca.largura(320), alca.destruir()
```

`ligar` dá à alça o papel de separador, a põe na ordem de tabulação e escreve a largura em
`aria-valuenow`, entre `aria-valuemin` e `aria-valuemax`, para o leitor de tela dizer quanto o
painel tem. As setas andam 16px (64 com Shift) e levam a borda para o lado delas, Home e End vão
aos limites, e o duplo clique volta ao `padrao`. A largura conta o padding e a borda da região,
que é o que ela ocupa na tela. O `max` pode ser uma função, perguntada a cada gesto, para o
limite acompanhar o contêiner, e a largura `inicial` só passa pelo `min`, porque o contêiner pode
ainda não ter tamanho quando o app liga a alça. Guardar a escolha é do app, no `aoMudar`. Durante
o arraste o cursor é o mesmo na página inteira, e um `iframe` ou `embed` no caminho não toma o
ponteiro.

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

Um botão que espera uma resposta leva `aria-busy="true"` e `disabled`. Ele ganha um giro antes do
rótulo, na cor do texto, e o rótulo diz o que anda ("Gerando"), que é o que um leitor de tela lê.
Para quem pediu menos movimento ao sistema, o giro fica parado. Um botão que já tem um ícone
`.tuff-ico--gira` gira o ícone e não ganha um segundo sinal.

```html vivo
<button class="tuff-btn tuff-btn--primario" aria-busy="true" disabled>Gerando</button>
<button class="tuff-btn" aria-busy="true" disabled>Atualizando</button>
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
JavaScript. Os `input` de um mesmo controle levam o mesmo `name`. O segmento escolhido é neutro,
um degrau mais claro com contorno e o texto em peso forte: um segmentado escolhe entre modos de
ver, e o destaque cheio fica para o botão primário da tela.

```html vivo
<div class="tuff-seg">
  <label class="tuff-seg-btn"><input type="radio" name="ex-vista" checked>lista</label>
  <label class="tuff-seg-btn"><input type="radio" name="ex-vista">grade</label>
  <label class="tuff-seg-btn"><input type="radio" name="ex-vista">mapa</label>
</div>
```

## Estado

A pílula responde "como está isto?" numa palavra, com as cores semânticas do ambiente e a borda
na mesma cor a 45%. A `--ocupado` é neutra e parada: a palavra ("subindo", "reiniciando") já diz
que algo anda. A tag é uma etiqueta neutra, e a tecla (`.tuff-tecla`) desenha um atalho.

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

A etiqueta que leva a algum lugar é um `<a class="tuff-tag">`, e a que filtra a lista é um
`<button class="tuff-tag">`. As duas respondem ao ponteiro com o fundo de hover e o texto forte,
têm o anel de foco e, sob o dedo, crescem até o alvo de toque.

```html vivo
<a class="tuff-tag" href="#estado">lab-cpps</a>
<button class="tuff-tag" type="button">só os meus</button>
```

O ponto (`.tuff-ponto`) diz o estado numa linha de lista, onde uma pílula por linha pesaria mais
que o nome. As cores são as da pílula, e sem variante ele é o estado que ainda não se conhece. A
cor sozinha não chega a quem não a distingue, nem a um leitor de tela: o ponto leva `role="img"`
com `aria-label`, ou o estado vai escrito ao lado.

```html vivo
<span class="tuff-ponto tuff-ponto--ok" role="img" aria-label="No ar"></span> ipprivm01
<span class="tuff-ponto tuff-ponto--aviso" role="img" aria-label="Cheia"></span> gpu-lantri
<span class="tuff-ponto tuff-ponto--erro" role="img" aria-label="Fora do ar"></span> lab-03
<span class="tuff-ponto" role="img" aria-label="Verificando"></span> lab-04
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

## Diálogo

Uma pergunta que a pessoa precisa responder antes de seguir. O título é a pergunta ("Descartar o
rascunho?"), o texto é a consequência, e cada botão diz o verbo, nunca "Sim" e "Não". O tom, o
círculo com o ícone, aparece só no que destrói ou falhou. A marcação é a que o diálogo do ambiente
usa, e por isso a pergunta que o app desenha e a que ele pede ao shell saem iguais.

```html vivo
<div class="tuff-dialogo" role="alertdialog" aria-labelledby="dlg-t" aria-describedby="dlg-x" style="position:static;animation:none">
  <div class="tuff-dialogo-corpo">
    <span class="tuff-dialogo-tom tuff-dialogo-tom--perigo"><svg class="tuff-ico" aria-hidden="true"><use href="#ico-trash"></use></svg></span>
    <div class="tuff-dialogo-texto">
      <h2 class="tuff-dialogo-titulo" id="dlg-t">Descartar o rascunho?</h2>
      <p class="tuff-dialogo-mensagem" id="dlg-x">O que você escreveu desde a última gravação se perde.</p>
    </div>
  </div>
  <div class="tuff-dialogo-acoes">
    <button class="tuff-btn">Continuar escrevendo</button>
    <button class="tuff-btn tuff-btn--perigo">Descartar</button>
  </div>
</div>
```

A amostra está parada no lugar, com `position: static`. De verdade, quem abre o diálogo é o
`TuffDialogo`, de `tuff.js`, e ele desce do topo do documento como uma folha, com um véu sobre o
resto, que fica fora do ponteiro e do teclado. Abaixo de 600 px a folha sobe de baixo, com os botões
empilhados em 44 px e o principal em cima.

```js
const resposta = await TuffDialogo.abrir({
  titulo: 'Descartar o rascunho?',
  texto: 'O que você escreveu desde a última gravação se perde.',
  acoes: [
    { id: 'manter', rotulo: 'Continuar escrevendo' },
    { id: 'descartar', rotulo: 'Descartar', perigo: true },
  ],
});
if (resposta === 'descartar') descartar();
```

`abrir` resolve o `id` do botão escolhido, ou `null` quando a pessoa sai pelo Esc. Sair é uma
resposta, e o app a trata como o botão que não muda nada.

| opção | o que faz |
|---|---|
| `titulo` | a pergunta |
| `texto` | a consequência, abaixo do título |
| `acoes` | os botões, na ordem em que aparecem: `{ id, rotulo, principal, perigo }`. A `principal` é a que o Enter escolhe. A `perigo` pinta o botão de destruir, põe o tom e abre o foco no botão que não destrói |
| `conteudo` | um nó do app, posto abaixo do texto: um campo, uma lista de formatos. O foco abre no primeiro campo dele, e quem lê o valor é o app, depois da resposta |
| `tom` | `'erro'` para o que falhou |

### O diálogo do app e o do ambiente

Um app pergunta de dois jeitos, e os dois abrem dentro da janela dele, com o mesmo desenho.

| a pergunta | quem abre |
|---|---|
| leva conteúdo do próprio app: escolher um formato, nomear uma coisa com as regras do app, descartar uma edição | o app, com `TuffDialogo.abrir` |
| o app roda fora do ambiente (em desenvolvimento, num teste), onde a ponte degrada para o `confirm` do navegador | o app, com `TuffDialogo.abrir` |
| o ambiente faz algo pelo app: guardar uma senha no cofre (`vssh.segredos`), escolher um arquivo (`vssh.arquivos`), dar um consentimento | o ambiente |
| uma pergunta simples, sem conteúdo próprio, que deve mostrar de qual app vem | o ambiente, com `vssh.dialogos.confirmar` e os outros: a folha abre na janela do app com o ícone e o nome dele em cima |

O menu de contexto, o aviso e o seletor de arquivo não têm peça no Tuff: eles saem da janela do
app, e por isso são do ambiente.

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

## Pessoas

O avatar são as iniciais sobre a cor da pessoa, em `--tuff-cor`. Quem escolhe a cor é o app, e ela
é a mesma em todo lugar em que a pessoa aparece. As iniciais são escuras porque as cores de pessoa
são claras sobre o fundo do ambiente. `.tuff-avatar--presente` acrescenta o ponto de quem está no
documento agora, e `.tuff-avatar--pequeno` e `.tuff-avatar--grande` trocam o tamanho: o grande é o
do topo de uma ficha. Na pilha (`.tuff-avatares`) os avatares se sobrepõem. Um avatar que leva a
algum lugar é um `<button class="tuff-avatar">`, com `aria-label`.

```html vivo
<span class="tuff-avatar" style="--tuff-cor:#4ec9b0" title="Ana Beatriz Moreira">AM</span>
<span class="tuff-avatar tuff-avatar--presente" style="--tuff-cor:#c678dd" title="Helena Duarte">HD</span>
<span class="tuff-avatar tuff-avatar--pequeno" style="--tuff-cor:#ce9178" title="Rafael Almeida">RA</span>
<span class="tuff-avatar tuff-avatar--grande" style="--tuff-cor:#569cd6" title="Júlia Prado">JP</span>
<span class="tuff-avatares">
  <span class="tuff-avatar" style="--tuff-cor:#4ec9b0">AM</span>
  <button class="tuff-avatar tuff-avatar--presente" style="--tuff-cor:#c678dd" aria-label="Helena Duarte, no capítulo 2">HD</button>
</span>
```

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
