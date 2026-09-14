# SDK do VSSH: conceitos e guias

Este portal é para quem vai escrever um vssh-app: um pacote com frontend HTML e backend próprio,
instalado num servidor Linux do VSSH e aberto como uma janela do ambiente. O público são as pessoas
da casa e os parceiros que escrevem apps para pesquisa. O tom é de manual.

O portal tem cinco seções. A referência é gerada a partir da tabela de exportação da ponte, verbo a
verbo, e chega com a sub-etapa 5.2. As duas seções autoradas estão aqui: os conceitos, que dizem
como o sistema é, e os guias, que levam do zero a um app funcionando.

## Conceitos

| página | o que ela promete |
|---|---|
| [O que é um vssh-app](conceitos/o-que-e-um-vssh-app.md) | Onde cada peça de um app roda (navegador, portal, servidor), o que o ambiente oferece a ela e o que o SDK expõe. |
| [As duas famílias](conceitos/as-duas-familias.md) | A diferença entre um app embutido e um instalado, quem carimba a família e por que o menu lista as duas do mesmo jeito. |
| [O manifesto](conceitos/o-manifesto.md) | O que cada campo do `vssh-app.json` declara, o que o ambiente faz com a declaração e por que campo desconhecido é recusado. |
| [Ciclo de vida](conceitos/ciclo-de-vida.md) | O que acontece entre o clique no ícone e o backend de pé, quem o mantém vivo, como ele é sondado e o que muda ao fechar a última janela. |
| [Atribuição](conceitos/atribuicao.md) | Como o ambiente sabe de quem é cada processo do servidor, pela marca `VSSH_APP_ID`, e o que isso decide no gerenciador de tarefas. |
| [A janela](conceitos/a-janela.md) | O que a janela de um app é para o shell, o que o manifesto declara dela, o que o app controla em runtime e o que o ambiente nunca entrega. |
| [Consentimento](conceitos/consentimento.md) | O modelo de grants: o que o app alcança no filesystem do usuário, quem concede, onde o grant mora e o que ele protege. |
| [O que o sistema garante](conceitos/o-que-o-sistema-garante.md) | As garantias com que um app pode contar, e a fronteira exata de cada uma. |

## Guias

| página | o que ela promete |
|---|---|
| [O primeiro app em Python](guias/o-primeiro-app-python.md) | Um app Python de pé no servidor e aberto no menu do ambiente, com log e healthcheck, a partir do template do toolkit. |
| [O primeiro app em Node](guias/o-primeiro-app-node.md) | O mesmo app, em Node. |
| [Uma janela](guias/uma-janela.md) | Título, tamanho, controles, várias janelas sobre um backend, restauração de sessão e a barra de título desenhada pelo app. |
| [Arquivos com consentimento](guias/arquivos-com-consentimento.md) | Ler e gravar na home do usuário pela File System Access API, reabrir o que já foi concedido, vigiar mudanças e arrastar arquivos nas duas direções. |
| [Avisos e atividades](guias/avisos-e-atividades.md) | Escolher entre notificação, aviso efêmero e atividade, e emitir cada um com janela aberta ou de um backend sem janela. |
| [GPU](guias/gpu.md) | O que declarar `gpu: true` faz hoje, como ler o veredito do servidor de dentro do app, e o desenho de `vssh.gpu`, que ainda não pousou. |
| [Publicar](guias/publicar.md) | Empacotar, publicar no repositório de artefatos e instalar num servidor, por CI ou à mão. |

## Sobre os nomes dos verbos

Os nomes públicos da API são em português, um espaço por assunto: `vssh.app`, `vssh.janela`,
`vssh.arquivos`, `vssh.avisos`, `vssh.dialogos`, `vssh.segredos`, `vssh.midia` e
`vssh.impressao`. O código dos guias usa esses nomes.

Duas ressalvas valem para todo guia deste portal:

- o SDK que expõe esses nomes chega com a sub-etapa 5.2. O shim que o toolkit distribui hoje
  (`lib/web/vssh-app-shim.js`) fala os nomes antigos, em inglês: `vssh.notify`, `vssh.pickFile`,
  `vssh.window.minimize`, `vssh.dialog.confirm`. O que os guias descrevem do comportamento vale
  para os dois; o que muda é a grafia;
- a referência gerada é a fonte dos nomes de verbo. Onde um nome de verbo neste portal divergir da
  referência, vale a referência. Os espaços e os três verbos de `vssh.app` (`capacidades`, `titulo`,
  `lembrarRota`) já estão na tabela de exportação; os demais espaços estão sendo preenchidos, e os
  guias os descrevem pelo que cada um abstrai. A forma de assinar um evento adotada aqui é
  `vssh.<espaco>.ao('<evento>', cb)`.

Cinco espaços aparecem só como desenho, com a etapa em que entram escrita ao lado: `vssh.gpu` (a
sub-etapa da etapa 5 que o implementa ainda não pousou), e `vssh.rede`, `vssh.filas`,
`vssh.terminal` e `vssh.processos` (etapa 7). Nenhum deles existe no sistema de hoje, e nenhum
guia depende deles.

## Onde estão as fontes

O sistema é o repositório privado `vssh-sso`; o autor de app enxerga o SDK gerado a partir dele e o
toolkit público [`colabhd/vssh-app-toolkit`](https://github.com/colabhd/vssh-app-toolkit), que traz
o schema do manifesto, os dois templates, as bibliotecas de backend e o script de publicação.
