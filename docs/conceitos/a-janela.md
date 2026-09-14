# A janela

Ao terminar esta página você sabe o que a janela de um app é para o shell, o que o manifesto
declara dela, o que o app controla em runtime pelo espaço `vssh.janela`, e o que o ambiente decide
sozinho e não entrega. O passo a passo com código está em [uma janela](../guias/uma-janela.md).

## Uma janela do shell com um iframe dentro

A janela é do shell: um `<div>` com moldura, cabeçalho, botões, sombra e alças de redimensionar,
desenhado pelo navegador, ao lado das outras janelas do ambiente (o terminal, o gerenciador de
arquivos, o navegador embutido). O que o app ocupa é o corpo dela, um iframe apontando para
`/<serverId>/proxy/app/<id>/`.

O iframe não tem `sandbox`, e o backend é servido por caminho relativo na origem do portal, então
o app compartilha a origem com o shell e com os outros apps. É isso que faz `BroadcastChannel`,
`localStorage` e `postMessage` funcionarem entre eles sem nada no meio, e é o mesmo fato que torna
o isolamento entre apps fraco. O modelo é "um admin instalou, portanto é confiável". Ver
[o que o sistema garante](o-que-o-sistema-garante.md).

Como toda janela do ambiente, a do app tem botão na barra de tarefas, entrada no Alt+Tab, encaixe
nas bordas, fixar no topo, minimizar e maximizar. Nada disso pede código do app.

## O que o manifesto declara

`window.title`, `window.width` e `window.height` são a abertura. Depois de aberta, o tamanho e a
posição são da pessoa, e o ambiente os persiste entre sessões: a janela volta onde estava. Não há
`setSize` de propósito: uma janela que se redimensiona sozinha briga com quem acabou de arrastá-la.

`window.multiplasJanelas` decide o que um segundo pedido de abrir faz. Por padrão ele foca a
janela existente e entrega o pedido a ela pelo evento `abertura`, o que é o certo para quem tem
abas ou lista própria: abrir um segundo `.md` no editor não deve abrir um segundo editor. Com
`true`, cada pedido abre uma janela nova, para quem tem sessões independentes (um player, um
visualizador de imagem). O backend continua sendo um: duas janelas são duas visões do mesmo
processo, com o mesmo token e o mesmo `VSSH_APP_DATA_DIR`, e o app precisa aguentar dois eventos
de abertura sem que o segundo apague o estado do primeiro. Clique em notificação nunca abre janela
nova, com ou sem o campo: quem clica num aviso quer ver o que o produziu.

`window.richChrome` pede abas de verdade no cabeçalho. A barra de abas é do shell; o dono do
estado é o app, que reporta a lista de abas e a ativa, e recebe de volta os pedidos de nova aba,
fechar e ativar. Um identificador estável por aba (`sessionName`) é o que faz as abas voltarem
depois de um F5.

`window.cabecalho: "app"` entrega a barra de título ao app. É para quem já tem uma barra própria e
boa (o editor, cuja barra é a do VS Code) e não quer duas, uma dentro da outra. Moldura, sombra e
alças continuam do ambiente; arrastar, o duplo-clique e o menu de contexto passam a ser gestos que
o app liga pelo `vssh.janela`. Um app que declara isso e não os liga entrega uma janela que não se
move, sem erro nenhum.

## O que o app controla em runtime

O espaço `vssh.janela` abstrai a janela vista de dentro: minimizar, maximizar, restaurar, focar e
fechar; abrir outra janela do próprio app numa rota; e, com `cabecalho: "app"`, os gestos da barra
de título. São disparos, sem resposta a esperar.

Duas coisas ficam em `vssh.app` porque são do app e não da janela: o título, que o shell corta em
200 caracteres e projeta na barra de título, na barra de tarefas e no Alt+Tab; e a rota que a
sessão restaura. O `document.title` do frontend é espelhado sozinho, e é o que faz um app portado
ganhar título sem uma linha nova.

`vssh.janela.abrir(rota)` abre outra janela do mesmo app, num caminho dentro dele. Sem rota, a
janela nova abre a mesma página; com rota, o app escolhe o que vai dentro: um painel, uma prévia,
um segundo documento. URL absoluta, esquema e `..` são recusados, porque a janela leva o título e o
ícone do app, e servir outra coisa ali seria o material de uma tela de login falsa.

## Identidade

O título e o ícone de uma janela são declarados, e ninguém os lê do DOM. Para o app isso significa
que o título vem do que ele reporta e o ícone vem do manifesto, e que as cinco superfícies que
mostram uma janela (Alt+Tab, gerenciador de tarefas, mixer de volume, painel de encaixe, fixar na
barra) mostram o mesmo nome.

## Quando o backend não responde

Se a janela abre e o backend não está de pé, o proxy o levanta e segura a resposta até o veredito
do healthcheck, com teto de 20 s ([ciclo de vida](ciclo-de-vida.md)). O que a espera não alcança
vira um painel de erro dentro da janela, que tenta de novo sozinho e recarrega quando o backend
responde. O painel é um documento que se anuncia ao pai por `postMessage`, e o shell o troca pelo
painel dele; o app não precisa tratar esse caso.

## O que a janela não tem

- menubar de aplicação com dropdowns. O que existe é o menu de contexto do cabeçalho, com os itens
  de aba quando há `richChrome`, e o menu de contexto dentro do app, montado com os dados que o app
  manda;
- badge ou progresso no botão da barra de tarefas. Uma atividade na bandeja cobre o caso;
- redimensionar ou mover por API;
- o menu de contexto do navegador hospedeiro. Dentro de uma janela do ambiente, o clique direito
  mostra só o que o app montou; a exceção é o que for editável (`<input>`, `<textarea>`,
  `contenteditable`), onde o menu do navegador é a única forma de recortar e colar com o mouse.
