# Uma janela

Ao terminar este guia o seu app tem título que acompanha o documento aberto, abre no tamanho
certo, responde aos controles da janela, sabe abrir uma segunda janela sobre o mesmo backend,
volta no lugar certo quando a sessão é restaurada e, se precisar, desenha a própria barra de
título. O que a janela é para o shell está em [a janela](../conceitos/a-janela.md).

Os nomes de verbo deste guia seguem a [nota sobre os nomes](../README.md#sobre-os-nomes-dos-verbos):
o SDK que os expõe chega com a sub-etapa 5.2, e o shim de hoje fala os nomes antigos
(`vssh.window.minimize`, `vssh.setTitle`, `vssh.lembrarRota`, `vssh.onOpenContext`).

## Título

Você não precisa de API para o caso comum. O shim observa `document.title` e o repassa ao shell:

```js
document.title = `${nome} - Editor`;   // a janela do ambiente acompanha
```

É o que faz um app portado ganhar título sem uma linha nova: o mesmo código que dá título à aba do
navegador dá título à janela. Para quem prefere ser explícito, `vssh.app.titulo(t)` faz o mesmo. O
shell corta em 200 caracteres e projeta o título na barra de título, na barra de tarefas e no
Alt+Tab.

## Tamanho e posição

O tamanho de abertura é do manifesto:

```json
{ "window": { "title": "Meu App", "width": 1100, "height": 720 } }
```

Depois disso o tamanho e a posição são da pessoa, e o ambiente os guarda entre sessões. Não há
`setSize` nem `setPosition` de propósito.

## Controles

```js
vssh.janela.minimizar();
vssh.janela.maximizar();
vssh.janela.restaurar();    // desfaz minimizado ou maximizado
vssh.janela.focar();
vssh.janela.fechar();
```

São disparos: não devolvem promessa e não têm resposta a esperar. Fora do ambiente cada um não
faz nada.

## Uma janela ou várias

Por padrão, pedir para abrir um app já aberto foca a janela existente e entrega o pedido a ela
pelo evento `abertura`. Se cada coisa aberta no seu app é uma sessão inteira e independente (um
player, um visualizador de imagem, um terminal), declare:

```json
{ "window": { "multiplasJanelas": true } }
```

O backend continua sendo um. Duas janelas são duas visões do mesmo processo, como duas abas do
navegador no mesmo servidor: mesmo socket, mesmo token, mesmo `VSSH_APP_DATA_DIR`. O estado por
janela vive no frontend; um app que guarda estado de UI no backend como se houvesse um cliente só
vê as janelas disputando esse estado.

O app também pede a própria janela extra, numa rota dentro dele:

```js
await vssh.janela.abrir('?painel=notas', { titulo: 'Notas', largura: 380, altura: 520 });
```

Sem rota, a janela nova abre a mesma página. Com rota, o app escolhe o que vai dentro. A rota é um
caminho relativo, como todo `fetch` que você escreve; URL absoluta, `javascript:` e `..` são
recusados. A chamada devolve `false` num shell anterior a esta capacidade; trate como "aqui não
dá" e siga.

Notificação com ação e o veredito do healthcheck vão para uma janela só, a última que teve foco:
entregar às duas faria a ação acontecer duas vezes.

## O contexto de abertura

"Abrir com", "Abrir Terminal Aqui", um item da jump list, um link de um host que o app declarou
em `opens.urls`: todos chegam pelo mesmo evento, depois do `load`, e de novo quando uma ação
alcança uma janela já aberta.

```js
vssh.app.ao('abertura', ({ caminho, url, tipo, rota }) => {
  if (caminho) abrir(caminho);          // tipo: 'arquivo' ou 'pasta'
  if (url) tocar(url);                  // tipo: 'url'
  if (rota) navegar(rota);              // a jump list ou uma notificação, com a janela já aberta
});
```

`caminho` e `url` nunca chegam juntos: são as duas formas de dizer o que abrir, e o ambiente sabe
qual tem na mão. `rota` chega quando alguém usa a jump list do ícone, ou clica numa notificação que
leva `abrir`, com a janela já aberta; com o app fechado, a rota entra na URL e o app boota nela.
Quem sabe se ir a `novo` é trocar de tela, abrir um painel ou criar um documento é o app. Sem
tratar o evento, o item da jump list e a notificação só levam ao lugar na primeira abertura.

## Voltar no lugar certo

O ambiente restaura as janelas abertas quando a pessoa volta. Sem você dizer nada, o app volta na
raiz, o que para um editor significa voltar sem a pasta que estava aberta. Uma linha resolve:

```js
addEventListener('popstate', () => vssh.app.lembrarRota(location.search + location.hash));
```

Não há código de restauração do seu lado: a janela volta em `…/proxy/app/<id>/<rota>`, o app
boota naquele endereço, e para ele é indistinguível de alguém ter aberto o link.
`lembrarRota('')` limpa, e é o que dizer quando a pessoa fecha o documento. O ambiente guarda com
atraso e não repete o que não mudou, então reportar a cada navegação não custa rede.

A rota é um caminho dentro do app, sem esquema, sem `/` inicial, sem `..`, com teto de 512
caracteres; o ambiente recusa o resto no console, sem resposta. A rota é um ponteiro:
o que não couber num endereço (conteúdo não salvo, índice, cache) vai para o backend do app ou
para o filesystem da pessoa.

## Abas no cabeçalho

Com `"richChrome": true` no manifesto, a barra de abas é do shell e o dono do estado é o app. O app
reporta a lista de abas e a ativa sempre que o conjunto muda, e recebe de volta os pedidos de nova
aba, fechar e ativar, além de `restore-tabs` depois de um F5. No fio de hoje:

```js
// app -> shell, sempre que o conjunto de abas ou a aba ativa mudar
window.parent.postMessage({ vsshApp: true, type: 'tabs',
  tabs: [{ id: 't1', title: 'nota.md', sessionName: 's1' }], activeTabId: 't1' }, location.origin);

// shell -> app
// { vsshApp: true, type: 'new-tab' | 'close-tab' | 'activate-tab', tabId? }
// { vsshApp: true, type: 'restore-tabs', tabs: [{ sessionName }] | null, activeSessionName }
```

`sessionName` é o identificador estável por aba que sobrevive a um reload; é o que persiste na
janela e volta em `restore-tabs`. Recrie uma aba por `sessionName` recebido, sem reaproveitar o
`id` antigo, que é bookkeeping local. Apps sem `sessionName` não têm abas restauradas, sem erro.
A forma desses verbos no SDK está na referência gerada, sob `vssh.janela`.

## A própria barra de título

`"cabecalho": "app"` no manifesto faz o ambiente parar de desenhar o cabeçalho da janela. É para
quem já tem uma barra própria e boa e não quer duas. Moldura, sombra e alças continuam do
ambiente; três gestos passam a ser seus:

```js
barra.addEventListener('pointerdown', (e) => vssh.janela.arrastar(e.clientX, e.clientY, e.screenX, e.screenY));
barra.addEventListener('pointermove', (e) => vssh.janela.arrastarPara(e.screenX, e.screenY));
barra.addEventListener('pointerup',   () => vssh.janela.arrastarFim());
barra.addEventListener('dblclick',    () => vssh.janela.alternarMaximizado());
barra.addEventListener('contextmenu', (e) => vssh.janela.menuDoCabecalho(e.clientX, e.clientY));
```

Os pontos do meio vão em coordenada de tela (`screenX`, `screenY`). Enquanto a janela se move, o
sistema de coordenadas do documento se move junto com ela; um `clientX` mediria o ponteiro contra
um referencial que está fugindo, e a janela derraparia. O limiar entre clique e arraste é seu,
porque o ambiente não sabe o que na sua barra é botão. Containment, encaixe nas bordas e onde a
janela para continuam sendo do ambiente.

Um app que declara `cabecalho: "app"` e não liga esses gestos entrega uma janela que não se move,
sem erro e sem aviso. Os três botões de janela também passam a ser seus, com os controles da seção
acima.

## O menu de contexto dentro do app

O botão direito dentro de uma janela do ambiente não mostra o menu do navegador hospedeiro, porque
ele fala de uma página e de um iframe, e nada ali pertence à janela em que a pessoa clicou. O que
aparece é o que o app montou, com o menu do ambiente:

```js
el.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  const id = await vssh.dialogos.menuDeContexto(e.clientX, e.clientY, [
    { id: 'abrir',    rotulo: 'Abrir',    icone: 'folder_open' },
    { id: 'renomear', rotulo: 'Renomear', icone: 'edit' },
    { separador: true },
    { id: 'excluir',  rotulo: 'Excluir',  icone: 'delete', perigo: true },
  ]);
  if (id) executar(id);
});
```

Devolve o `id` escolhido, ou `null` se a pessoa fechou sem escolher; trate o `null`, que é o caso
comum. Só dado atravessa: rótulo, ícone e `id`, nunca função e nunca HTML. As coordenadas são as
do seu viewport, e o shell soma a posição da janela. A exceção ao menu suprimido é o que for
editável (`<input>`, `<textarea>`, `contenteditable`), onde o menu do navegador é a única forma de
recortar e colar com o mouse; e um `stopPropagation()` no `contextmenu` de um elemento devolve a
caixa nativa ali.
