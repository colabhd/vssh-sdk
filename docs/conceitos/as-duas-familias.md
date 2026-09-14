# As duas famílias: embutido e instalado

Ao terminar esta página você sabe em que família o seu app cai (instalado, sempre), quem carimba a
família, e por que o menu iniciar, a barra de tarefas e o gerenciador de tarefas leem uma lista só.

## Uma lista, um campo

`GET /api/apps` devolve tudo o que o ambiente sabe abrir na mesma forma, com um campo `origem`. É
esse campo que faz "tudo é um app" valer para quem usa: o menu iniciar, a barra de tarefas e o
gerenciador de tarefas leem uma lista só, e não distinguem o Terminal de um app que um parceiro
publicou na semana passada.

| família | o que é | removível | aparece em "instalar app" |
|---|---|---|---|
| embutido | o ambiente em si: Terminal, Arquivos, Navegador, Editor, Agente do sistema, Supervisor de Apps, e os motores (Xpra, Scramjet, Impressão) | não | não |
| instalado | o que estende o ambiente: todo app que chega por `vssh-app-install` | sim | sim |

O app que você escreve é da família instalada. As páginas deste portal falam dela.

## Quem carimba

`origem` é palavra do portal, e o manifesto não a tem. O manifesto é escrito por quem publica o
app; um campo `origem` ali deixaria qualquer app se declarar parte do ambiente, e "embutido" é a
família que não se desinstala. Quem carimba é quem lê a lista (`src/services/embutidos.ts`, no
portal), e um manifesto que tente declarar a família é recusado no gate de publicação, porque o
schema fecha todo objeto com `additionalProperties: false`.

## Família e entrega são eixos diferentes

`origem` diz o que a coisa é. Como os bytes chegam ao servidor é outra pergunta:

- os motores (o X11, o de reescrita web, o de impressão) são embutidos e chegam pelo catálogo,
  como qualquer app instalado;
- o agente do sistema e o app de terminal viajam dentro da imagem do portal e são instalados por
  ele, na primeira sessão depois de um deploy, porque pedir que alguém os instale seria pedir que
  instalasse o próprio ambiente.

Um embutido sem daemon (Arquivos, Navegador, Editor, Supervisor) não usa o schema do toolkit: o
schema exige `backend`, e não há o que pôr ali. Esses declaram menos, num arquivo do portal
(`infra/apps/<id>/vssh-embutido.json`). O Terminal tem os dois lados: um `vssh-app.json` completo,
com o daemon de PTY, e um `vssh-embutido.json` com nome, ícone e o que o abre, que o portal funde
numa entrada só.

## O que muda para quem escreve um app instalado

Três coisas que a família decide:

- o app é instalado por um admin, como root, em `/opt/vssh-apps/<id>/`, e o diretório é somente
  leitura para o app. O único diretório gravável garantido é `$VSSH_APP_DATA_DIR`
  (`~/.vssh-apps/<id>/data`), por usuário;
- o app entra no menu na `category` que o manifesto declarou, ao lado do que faz a mesma coisa.
  Não há seção de "apps integrados" que recolha vssh-apps por serem vssh-apps: isso separaria por
  procedência o que a pessoa procura por função. Quem não declara categoria cai em `Other`;
- o app pode se oferecer como substituto de um embutido (`handles`: terminal, editor,
  fileBrowser, ide, browser). Declarar não troca nada sozinho: a pessoa escolhe em Configurações,
  em Abrir com, e até lá o embutido continua sendo o padrão.

Um app instalado não tem menos direitos que um embutido na tela: mesma moldura, mesmos botões,
mesmo botão na barra de tarefas, mesma entrada no Alt+Tab. O que o separa é só quem o pôs lá e
quem pode tirá-lo.
