# SDK do VSSH: conceitos e guias

Este portal é para quem vai escrever um vssh-app: um pacote com frontend HTML e backend próprio,
instalado num servidor Linux do VSSH e aberto como uma janela do ambiente. O público são as pessoas
da casa e os parceiros que escrevem apps para pesquisa. O tom é de manual.

O portal tem quatro seções. A referência é gerada pelo sistema a partir da tabela de exportação
da ponte, verbo a verbo, e ninguém a edita. As três seções autoradas estão aqui: os conceitos, que
dizem como o sistema é, os guias, que levam do zero a um app funcionando, e a aparência, que
documenta o Tuff, o ambiente visual que um app recebe pronto.

## Referência

A referência mora em [`referencia/`](referencia/README.md): um capítulo por espaço da API
(`vssh.app`, `vssh.janela`, `vssh.arquivos`, `vssh.avisos`, `vssh.dialogos`, `vssh.segredos`,
`vssh.midia`, `vssh.impressao`, `vssh.gpu`), com a assinatura de cada verbo, o que ele responde e
os eventos que o shell manda de volta. O canal de publicação do sistema a escreve depois de cada
deploy, junto de [`api/`](../api/) e [`runtime/`](../runtime/); uma correção nela se faz na
descrição do verbo, na tabela do sistema, e chega aqui na rodada seguinte.

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
| [O primeiro app em Python](guias/o-primeiro-app-python.md) | Um app Python de pé no servidor e aberto no menu do ambiente, com log e healthcheck, a partir do template deste repositório. |
| [O primeiro app em Node](guias/o-primeiro-app-node.md) | O mesmo app, em Node. |
| [O ambiente de desenvolvimento](guias/ambiente-de-desenvolvimento.md) | Rodar e testar o backend de um app fora do servidor: o runtime no caminho, a porta de bancada, o token e o `/saude`, o SDK web sem o shell, e o mesmo arranjo no CI. |
| [Uma janela](guias/uma-janela.md) | Título, tamanho, controles, várias janelas sobre um backend, restauração de sessão e a barra de título desenhada pelo app. |
| [Arquivos com consentimento](guias/arquivos-com-consentimento.md) | Ler e gravar na home do usuário pela File System Access API, reabrir o que já foi concedido, vigiar mudanças e arrastar arquivos nas duas direções. |
| [Avisos e atividades](guias/avisos-e-atividades.md) | Escolher entre notificação, aviso efêmero e atividade, e emitir cada um com janela aberta ou de um backend sem janela. |
| [GPU](guias/gpu.md) | O que `recursos.gpu.modo` declara, o que o lançador faz com isso, e como o backend e a janela perguntam o que receberam por `vssh.gpu`. |
| [Trabalho longo](guias/trabalho-longo.md) | Rodar um trabalho de minutos ou horas na estação ou na fila com o mesmo código, com progresso, fim no sino, cancelamento e retomada depois de um reinício. |
| [Publicar](guias/publicar.md) | Empacotar, publicar no repositório de artefatos e instalar num servidor, por CI ou à mão. |

## Aparência

| página | o que ela promete |
|---|---|
| [O Tuff](aparencia/o-tuff.md) | O que o ambiente visual é, o que chega a um app em `_sdk/tuff/`, a camada que deixa o app vencer, a cor de destaque, e a régua do que é do Tuff e do que é do desktop. |
| [Tokens](aparencia/tokens.md) | A paleta, o texto, o destaque que muda em runtime, os status, a tipografia e as medidas, token a token. |
| [Componentes](aparencia/componentes.md) | Painel, botões, campos, switch, linha de configuração, controle segmentado, estado, dica, vazio, espera e ícones, cada um com a amostra viva e o markup. |
| [Listas e navegação](aparencia/listas-e-navegacao.md) | Lista, chave e valor, barra de ferramentas, a gaveta de navegação e o `TuffGaveta`, busca, detalhe e tooltip. |
| [Mídia](aparencia/midia.md) | Palco, chrome, trilha, transporte, grade virtualizada, tira e visor, e o `TuffMidia` que os liga. |
| [Ícones](aparencia/icones.md) | Como se usa um ícone do sprite, e a grade com todos os que existem, lida do sprite no build. |

A galeria com todos os componentes numa página só, para julgar olhando, continua em
[`api/tuff/docs/componentes.html`](../api/tuff/docs/componentes.html).

## Sobre os nomes dos verbos

Os nomes públicos da API são em português, um espaço por assunto: `vssh.app`, `vssh.janela`,
`vssh.arquivos`, `vssh.avisos`, `vssh.dialogos`, `vssh.segredos`, `vssh.midia`, `vssh.impressao`
e `vssh.gpu`. O código dos guias usa esses nomes, e é o SDK servido pelo sistema em
`_sdk/vssh.js` que os expõe; a forma de assinar um evento é `vssh.<espaco>.ao('<evento>', cb)`.

A referência gerada é a fonte dos nomes de verbo. Onde um nome de verbo neste portal divergir da
referência, vale a referência. O shim que o toolkit distribuía (`lib/web/vssh-app-shim.js`) fala
os nomes antigos, em inglês (`vssh.notify`, `vssh.pickFile`, `vssh.window.minimize`), e a
correspondência entre os dois, verbo a verbo, está no [`MIGRATION.md`](../MIGRATION.md).

Quatro espaços aparecem só como desenho, com a etapa em que entram escrita ao lado: `vssh.rede`,
`vssh.filas`, `vssh.terminal` e `vssh.processos` (etapa 7). Nenhum deles existe no sistema de
hoje, e nenhum guia depende deles.

## Onde estão as fontes

O sistema é o repositório privado `vssh-sso`; o autor de app enxerga o que o sistema gera aqui
(`api/`, `runtime/`, `referencia/`) e o que as pessoas escrevem aqui: os dois templates, os
exemplos, o script de publicação e estas páginas. As libs de backend são o runtime `vssh` de
`runtime/`, que todo servidor tem em `/opt/vssh/sdk`; o que muda para um app escrito contra o
toolkit antigo está no [`MIGRATION.md`](../MIGRATION.md).
