# O manifesto: `vssh-app.json`

> Página gerada do schema do manifesto
> ([`api/vssh-app.schema.json`](../../api/vssh-app.schema.json)) pelo canal de publicação do
> sistema. Uma mudança se faz na fonte, `schema/vssh-app.schema.json` do `vssh-sso`.

Manifesto de um vssh-app. A fonte deste schema é o repositório do sistema, `vssh-sso`, em `schema/`;
o canal de publicação o copia para `api/` do `vssh-sdk`, onde o `vssh-app-publish` o lê e valida o
manifesto por inteiro antes de o app entrar no repositório. O `vssh-app-install` valida só o mínimo,
porque roda offline no servidor e não tem como buscar o schema. `additionalProperties: false` em
todo objeto, a raiz inclusive: um campo desconhecido é recusado na publicação, porque
`requiredPackage` (sem o s), `gpuu` ou `opns` publicariam limpos e seriam descartados em silêncio
por quem lê. Um manifesto escrito para um SDK mais novo é recusado por um mais velho, e essa é a
informação que interessa. Todo campo que o portal lê está declarado aqui, e
`tests/unit/contrato-do-manifesto.test.js` do `vssh-sso` confere isso a cada campo novo.

Um objeto com os campos abaixo, e nenhum outro: o schema fecha a raiz com
`additionalProperties: false`, e um campo que ele não conhece recusa o manifesto inteiro, com o nome
do campo na mensagem. Obrigatórios: `id`, `version`, `backend`.

| campo | tipo | obrigatório |
|---|---|---|
| [`id`](#id) | `string` | sim |
| [`name`](#name) | `string` | não |
| [`version`](#version) | `string` | sim |
| [`type`](#type) | um dos valores listados | não |
| [`kind`](#kind) | um dos valores listados | não |
| [`alwaysRunning`](#alwaysrunning) | `boolean` | não |
| [`engine`](#engine) | `object` | não |
| [`provides`](#provides) | `array` de `string` | não |
| [`requires`](#requires) | `array` de `string` | não |
| [`minShellVersion`](#minshellversion) | `string` | não |
| [`contributes`](#contributes) | `object` | não |
| [`requiredPackages`](#requiredpackages) | `array` de `string` | não |
| [`resources`](#resources) | `object` | não |
| [`recursos`](#recursos) | `object` | não |
| [`gpu`](#gpu) | `boolean` | não |
| [`secrets`](#secrets) | `array` de `object` | não |
| [`icon`](#icon) | `string` | não |
| [`category`](#category) | `string` | não |
| [`description`](#description) | `string` | não |
| [`handles`](#handles) | `string` ou `null` | não |
| [`opens`](#opens) | `object` | não |
| [`backend`](#backend) | `object` | sim |
| [`window`](#window) | `object` | não |

## `id`

`string`, obrigatório.

Imutável — vira path, ENDEREÇO (~/.vssh-apps/\<id\>/app.sock) e sentinel. O endereço não é alocado:
ele é DERIVADO de (HOME, id), e é por isso que trocar o id é publicar outro app.

## `name`

`string`, opcional.

Nome exibido. Default: o próprio id.

## `version`

`string`, obrigatório.

Semver. O install é idempotente por versão, então bump a cada release.

## `type`

um dos valores listados, opcional, padrão `"app"`, valores `"app"`, `"engine"`.

'engine' = backend-only, sem janela nem ícone no Launchpad.

## `kind`

um dos valores listados, opcional, padrão `"app"`, valores `"app"`, `"service"`.

Eixo de LIFECYCLE, ortogonal a `type`: 'service' é daemon supervisionado (start automático,
auto-restart, status).

## `alwaysRunning`

`boolean`, opcional.

LEGADO — equivale a kind:'service'. Mantido só por compat com manifestos já instalados.

## `engine`

`object`, opcional, sem campo além dos listados.

Só para type:'engine'. Um motor pode trazer o PRÓPRIO lado-cliente, em vez de o ambiente carregar um
arquivo que conhece o motor pelo nome.

### `engine.loader`

`string`, opcional.

Caminho, relativo à raiz servida pelo backend, de um script que o ambiente carrega depois de o
backend responder. É ele que registra o motor (ex.: em RemoteDesktopEngines). Sem este campo o
ambiente não carrega script nenhum do app — que é o caso de um motor cujo lado-cliente já mora no
ambiente.

## `provides`

`array` de `string`, opcional.

Capacidades que este app oferece a OUTROS apps e ao ambiente, no formato 'nome/vN'. Declarar é o que
permite trocar o produtor sem tocar em nenhum consumidor: um app de chat pede 'llm/v1' e recebe o
motor que estiver instalado, seja ollama, vLLM ou outro. Sem isto o consumidor precisa FIXAR o appId
no código — que é o que o shell fazia com o 'scramjet-wisp'. Declarar não é provar: o ambiente não
verifica se o app cumpre a capacidade, pelo mesmo motivo que o registro de motores não verifica
(exigir transforma 'este app não faz isso' em 'este app não carrega'). Quem não puder atender falha
por dentro, que é onde sabe dizer por quê.

## `requires`

`array` de `string`, opcional.

Capacidades que este app exige de outros, no formato 'nome/vN': a metade que completa o `provides`.
Um app de chat que precisa de um modelo declara `requires: ["llm/v1"]` e recebe o motor que estiver
instalado, seja qual for. Quem confere é o portal, na instalação, contra o `provides` dos apps
instalados naquele servidor: uma capacidade que ninguém oferece recusa a instalação nomeando-a,
porque instalar um app que vai falhar por dentro no primeiro uso é pior que dizer o que falta. A
conferência lê o catálogo do repositório, que é o único que responde antes de instalar; um catálogo
sem este campo não confere. Só o nome com a versão, sem faixa nem comparação: uma capacidade é um
contrato, e `nome/v2` é outro contrato.

## `minShellVersion`

`string`, opcional.

Versão MÍNIMA do shell de que este app precisa. O padrão é NÃO declarar: um campo obrigatório
transformaria toda API nova em quebra de compatibilidade declarada, que é burocracia sem benefício.
Quem declara está dizendo 'eu uso uma coisa que não existia antes' — a mesma regra do `engines` do
npm, pelo mesmo motivo. NÃO substitui o `vssh.capabilities()`: um é gate de instalação, o outro é
decisão de runtime. Quem confere é o portal, que sabe a versão do shell que serve; o
`vssh-app-install` roda offline no servidor e não tem como saber.

## `contributes`

`object`, opcional, sem campo além dos listados.

O que este app acrescenta às superfícies do AMBIENTE — coisas que não são a janela dele. Vale para
qualquer app, e não só para `type:'engine'`. NÃO substitui `engine.loader`, e a diferença é de
tamanho: o loader de um motor traz o lado-cliente INTEIRO (megabytes, assets, servidos pelo backend
do app, que é um serviço e está de pé); uma contribuição é servida do DISCO pelo portal, então
funciona com o backend desligado, que é o caso normal de um app comum. As duas formas que existem
aqui são de naturezas diferentes de propósito — `settings` é CÓDIGO, `contextMenu` é DADO —, e o
porquê está escrito em cada uma.

### `contributes.settings`

`string`, opcional.

Caminho, relativo à raiz do PACOTE, de um script que registra uma seção em Configurações
(`SettingsRegistry.register`). Carregado quando a janela de Configurações abre — não no boot: um app
que ninguém configura não custa nada, e o ambiente não passa a depender de N apps para subir.
ATENÇÃO ao que isto concede: o script roda na origem do shell, com a confiança do shell. O portão é
o mesmo do resto do modelo — quem pode rodar `vssh-app-install`.

### `contributes.contextMenu`

`array` de `object`, opcional, itens no máximo 8.

Itens que este app põe no menu de contexto do AMBIENTE — clique direito num arquivo, numa pasta, na
área de trabalho. É DADO, e não um caminho de script como `settings`, e a razão é o momento:
Configurações abre porque alguém pediu e pode demorar; o menu de contexto abre no clique direito e
não pode esperar fetch nenhum. O app DECLARA; quem monta o item, decide a ordem e executa é o shell
— um app não roda uma linha na origem do shell para pôr um item de menu. Item inválido é OMITIDO em
silêncio, e os irmãos válidos continuam: um item torto não pode impedir o menu de abrir. Teto de 8
por app (o teto da SOMA, entre todos os apps, é do shell).

#### `contributes.contextMenu[].id`

`string`, obrigatório.

Estável e único DENTRO deste app. Serve de desempate quando dois itens pedem a mesma `ordem`.

#### `contributes.contextMenu[].superficie`

`string`, obrigatório, valores `"arquivo"`, `"pasta"`, `"area-de-trabalho"`, `"icone-do-app"`.

Onde o item aparece. `icone-do-app` é a JUMP LIST: o clique direito no ícone do app, no Launchpad e
no Menu Iniciar — uma superfície só para os dois lugares, senão todo app teria de declarar o mesmo
item duas vezes. Ela exige `rota` e recusa `quando`; as três de caminho exigem o contrário.

#### `contributes.contextMenu[].rotulo`

`string`, obrigatório, comprimento mínimo 1, comprimento máximo 48.

O texto do item. Nome de PRODUTO, na voz do ambiente ('Abrir no VSSHCode'), não jargão de manifesto.
O teto de 48 não é segurança: é a largura do painel — um rótulo maior faz um menu que não cabe na
tela.

#### `contributes.contextMenu[].ordem`

`integer`, opcional, padrão `100`, mínimo 0, máximo 999.

A POSIÇÃO no bloco de abertura, medida contra os itens do próprio shell — que é o que faz um item
contribuído poder ficar ANTES de um embutido, em vez de sempre no fim atrás de um separador. A régua
publicada: Abrir/Nova Pasta 10, Novo Arquivo 15, Abrir Terminal Aqui 20, Editor de Texto / Abrir em
Arquivos 25, VS Code 30, Extrair aqui 35, Fixar na barra lateral 40, Abrir com 60, Baixar 70,
Imprimir 80. O default 100 põe o item depois de todo embutido de abertura, que é onde um app novo
pertence enquanto ninguém disser o contrário. Valor fora da faixa RECUSA o item, e não é aparado
para o teto: quem pediu 10^9 estava pedindo para ficar sempre em último por um mecanismo que não foi
escolhido.

#### `contributes.contextMenu[].quando`

`object`, opcional, sem campo além dos listados.

Restringe onde o item aparece. Só vale para `superficie: "arquivo"` — numa pasta ou na área de
trabalho não há extensão, e um filtro que nunca casa é um item declarado, aceito e invisível (por
isso ele é RECUSADO ali, em vez de ignorado).

##### `contributes.contextMenu[].quando.extensoes`

`array` de `string`, opcional, itens no mínimo 1.

Com ou sem ponto; normalizado pelo portal. Ausente = todo arquivo. É independente de
`opens.extensions`: aquele campo diz o que o app sabe abrir (e o põe no submenu 'Abrir com'); este
diz onde ele quer um item PRÓPRIO, de primeiro nível.

#### `contributes.contextMenu[].acao`

`string`, opcional, valores `"abrir"`, `"abrirRota"`.

O verbo, e ele é o da SUPERFÍCIE — não uma escolha livre. `abrir` (nas três superfícies de caminho)
abre este app com o caminho clicado, pelo `open-context` que já é contrato publicado. `abrirRota`
(só no `icone-do-app`) abre o app num lugar DELE, declarado em `rota`. Omitir o campo é aceitar o
verbo da superfície; declarar o OUTRO recusa o item, porque um app que pediu outra coisa não quis
esta — um `abrir` no ícone seria o item "Abrir" que aquele menu já tem, fixo, e um `abrirRota` num
arquivo teria de decidir o que fazer com o caminho clicado.

#### `contributes.contextMenu[].rota`

`string`, opcional, comprimento mínimo 1, comprimento máximo 512.

O lugar DENTRO do app, colado depois da URL que o portal já resolveu para ele — `novo`,
`docs/recentes?x=1`. Obrigatório com `superficie: "icone-do-app"`, e proibido nas outras. NÃO é URL:
esquema (`https:`, `javascript:`), caminho absoluto e `..` são recusados pelo ambiente, com a mesma
regra do `vssh.window.abrir` — sem ela uma rota viraria uma janela do shell servindo outra coisa,
com o título e o ícone deste app. Com o app já aberto a rota chega pelo `open-context` (campo
`rota`), porque quem sabe navegar é o app.

### `contributes.browserExtension`

`object`, opcional, sem campo além dos listados.

A extensão do navegador embutido que é o PAR deste app — a que ele precisa do outro lado para
funcionar inteiro (capturar de uma página, integrar com um site). Sem isto, um par app+extensão não
tem como se declarar: o app é instalado por um admin com vssh-app-install, a extensão é instalada
pelo usuário em vsshb://extensions, são catálogos diferentes e nada casa as versões — quem instala o
app não descobre que falta metade. É DADO, como o `contextMenu` ao lado, e não um caminho de script:
o app declara, e quem oferece é o ambiente. Declarar OFERECE; instalar continua sendo escolha do
usuário, porque instalar uma extensão remota executa o bundle dela no contexto do portal, e isso não
é decisão do app nem do admin.

#### `contributes.browserExtension.id`

`string`, obrigatório.

O `id` da extensão no catálogo de extensões (o mesmo `id` do vssh-ext.json dela). Só o id: a URL do
bundle e a versão saem do catálogo no momento de oferecer, e repeti-las aqui seria uma segunda
verdade sobre o mesmo fato — que envelhece sozinha a cada release da extensão.

#### `contributes.browserExtension.razao`

`string`, opcional, comprimento mínimo 1, comprimento máximo 120.

Uma frase dizendo para que o app precisa dela, mostrada a quem for decidir. Sem isto o convite diz
só o nome da extensão, e quem nunca ouviu falar dela não tem como responder.

## `requiredPackages`

`array` de `string`, opcional.

Pacotes Linux de que o app precisa para funcionar (ffmpeg, pandoc, rclone…). Declarar é o ponto:
hoje uma dependência de sistema se esconde num installCommand opaco, e não há como responder 'este
app roda neste servidor?' sem executá-lo. Cada item é uma EXIGÊNCIA, e uma exigência pode ter
alternativas separadas por '|' — 'chromium | google-chrome-stable' quer dizer que qualquer um dos
dois serve. Quem VERIFICA é o portal (vssh-app-install recusa antes de instalar, e o painel admin
mostra o que falta por servidor).

## `resources`

`object`, opcional, sem campo além dos listados.

Limites de recurso do processo do app. O ambiente já aplica um teto PADRÃO a todo vssh-app (memória
e número de tarefas) — este bloco existe para o app que precisa de outro, para mais ou para menos.
Aplicado por `systemd-run --user --scope` no vssh-app-run, sobre o GRUPO de processos do app, então
alcança os filhos que ele gerar. O que ele contém é UM app desgovernado, e não a soma deles: dois
apps no teto ainda somam mais que a máquina.

### `resources.memoryHigh`

`string`, opcional.

Onde o kernel começa a PRESSIONAR o app a devolver memória (systemd MemoryHigh). Não mata: reclama.
É o limite que se quer ajustar primeiro, porque errar para baixo deixa o app lento, não morto.
Aceita '2G', '70%' (do total físico) ou 'none' para não ter.

### `resources.memoryMax`

`string`, opcional.

Teto duro (systemd MemoryMax): passar daqui é OOM kill do app — e é justamente o que impede que o
OOM killer escolha a sessão inteira do usuário no lugar. Aceita '4G', '85%' ou 'none'.

### `resources.cpuQuota`

`string`, opcional.

Teto de CPU (systemd CPUQuota), '100%' = um núcleo inteiro. Sem padrão do ambiente de propósito: CPU
disputada deixa a sessão LENTA, e o escalonador já reparte; memória esgotada a derruba. Declare
quando o app tiver de conviver, não para 'ser bem-comportado'.

### `resources.tasksMax`

`string`, opcional.

Teto de processos E THREADS do app (systemd TasksMax). Conta thread, então um app com pool de
workers precisa de folga — e é por isso que o padrão do ambiente é generoso. Aceita '512', '25%' (de
kernel.pid_max) ou 'none'.

## `recursos`

`object`, opcional, sem campo além dos listados.

O que o app pede ao sistema além dos tetos de `resources`, e que o sistema arbitra ao subir o app. O
app declara o que precisa e pergunta o que recebeu por `vssh.gpu` (`concedida()` no backend,
`estado()` na janela); quem decide, com o que o servidor tem, é o vssh-app-run. O app não escolhe
como o recurso chega, e é isso que o poupa de conhecer `CUDA_VISIBLE_DEVICES` e o `limits.json`.

### `recursos.gpu`

`object`, opcional, sem campo além dos listados.

A GPU do servidor. Declarar faz duas coisas. O ambiente consulta o kernel (/sys/class/drm e
/dev/dri) e registra o que há: fabricante (NVIDIA, AMD, Intel, virtio ou uma placa virtual), driver,
se é virtual, e se o processo do usuário abre o render node; um usuário fora do grupo `render` é o
modo de falha mais comum, mais que a ausência de placa. E o app deixa de receber
`CUDA_VISIBLE_DEVICES=""`, que todo app sem esta declaração recebe para o runtime CUDA não enumerar
dispositivo nenhum; é o que deixa um app de inferência conviver com os vizinhos. A arbitragem é por
convenção: a variável não fecha /dev/dri, e a fronteira de verdade pediria controle de dispositivo
no cgroup (eBPF, root). O que o sistema decidiu chega ao app por `vssh.gpu.concedida()` como
`{ concedida, dispositivos, motivo }`, e o motivo de uma negativa fica no run.log e no gerenciador
de tarefas.

#### `recursos.gpu.modo`

um dos valores listados, obrigatório, valores `"opcional"`, `"necessaria"`.

`opcional`: o app sobe com ou sem GPU e pergunta o que recebeu; sem placa ele costuma ficar mais
lento, e quem sabe se dá para seguir em CPU é o app. `necessaria`: sem GPU utilizável o app não
sobe; o run.log nomeia o motivo, e o supervisor o mostra como falha de start, sem laço de reinício,
até alguém pedir a subida de novo. Declare `necessaria` só para um app que não tem caminho em CPU:
um servidor sem placa, ou um usuário fora do grupo `render`, deixa esse app parado em vez de lento.

### `recursos.fila`

`boolean`, opcional, padrão `false`.

A fila de processamento: o app delega trabalho pesado (um container com imagem, comando e arquivos)
ao cluster Kubernetes que o servidor do usuário aponta, em vez de rodá-lo na GPU da estação.
Declarar faz o portal escrever `VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN` no ambiente do app a cada
subida; com eles o backend chama `vssh.fila` (`submeter`, `acompanhar`, `baixar`, `cancelar`). O
token é a identidade do app diante do portal, só alcança `/api/fila/*`, e morre com o app (`stop` o
revoga). Sem esta declaração o app não recebe o par, e `vssh.fila.disponivel()` diz por quê. Um
servidor sem cluster configurado responde o mesmo: o app pergunta antes de prometer.

## `gpu`

`boolean`, opcional, padrão `false`.

A grafia anterior de `recursos.gpu.modo: "opcional"`, lida pelos mesmos consumidores (o vssh-app-run
e a projeção de GET /api/apps) e com o mesmo efeito. Escreva a nova. Esta fica aceita enquanto
houver app publicado que a declare, e `recursos.gpu.modo` manda quando os dois aparecem no mesmo
manifesto.

## `secrets`

`array` de `object`, opcional.

Credenciais que o app precisa receber pelo ambiente (chave de API, senha de banco, token de S3).
Declarar é o ponto: sem isto, cada app inventa o próprio jeito — normalmente um arquivo em texto
plano no VSSH_APP_DATA_DIR — e o usuário não tem onde colocar a credencial. O valor NUNCA vem do
manifesto: quem o guarda é o usuário, pelo shell, e ele mora em ~/.vssh-apps/\<id\>/secrets.json
(modo 0600) no servidor do próprio usuário. O portal escreve e esquece — não há coluna de segredo no
portal. O app lê como variável de ambiente comum.

### `secrets[].name`

`string`, obrigatório.

Nome da variável de ambiente. Maiúsculas por convenção e por segurança: este nome vira um
`export <nome>=` avaliado pelo shell no servidor.

### `secrets[].description`

`string`, opcional.

O que é, e onde consegui-la. Aparece na tela onde o usuário digita — e é a diferença entre um campo
que ele preenche e um campo que ele ignora.

### `secrets[].required`

`boolean`, opcional, padrão `false`.

Sem este segredo o app não funciona. Informativo: o ambiente não recusa subir por falta dele, porque
quem sabe degradar é o app.

## `icon`

`string`, opcional.

Caminho relativo à raiz do pacote (.svg/.png/.jpg).

## `category`

`string`, opcional.

A seção do Start Menu/Launchpad onde este app aparece — use o nome de categoria do menu freedesktop
('Development', 'Office', 'Graphics', 'Utility', 'System'…) para cair junto do que faz a mesma
coisa. Quem não declara cai em 'Other'. O agrupamento é por este campo e nada mais: não há seção de
'apps integrados' que recolha vssh-app por ser vssh-app, porque isso separa por PROCEDÊNCIA o que o
usuário procura por FUNÇÃO.

## `description`

`string`, opcional.

## `handles`

`string` ou `null`, opcional, valores `"terminal"`, `"editor"`, `"fileBrowser"`, `"ide"`, `"vscode"`, `"browser"`, `null`.

Registra o app como substituto de um dos 5 launchers embutidos, pelo PAPEL que ele ocupa. O usuário
ainda precisa escolher em Configurações → Ambiente → Abrir com. `vscode` é o nome antigo de `ide` e
continua aceito (um manifesto já publicado não deixa de instalar por causa de uma palavra que
trocamos), mas era o único valor do enum que nomeava um produto em vez de um papel — declare `ide`.

## `opens`

`object`, opcional, sem campo além dos listados.

Tipos de arquivo que o app sabe abrir — coloca o app no menu 'Abrir com' e o torna elegível a padrão
por tipo. Generaliza `handles`, que só cobre os 5 launchers.

### `opens.extensions`

`array` de `string`, opcional.

Com ou sem ponto; normalizado pelo portal.

### `opens.mimeTypes`

`array` de `string`, opcional.

### `opens.urls`

`array` de `string`, opcional.

HOSTS cujos links este app sabe abrir — é o que faz um link do YouTube cair no seu player em vez de
virar aba do navegador. Só o host, sem esquema, sem porta e sem caminho: discriminar por porta ou
por rota seria regra de roteamento, e quem roteia dentro do app é o app. `youtube.com` casa o host
EXATO; `*.youtube.com` casa também os subdomínios (`m.`, `www.`, `music.`) — a mesma semântica dos
padrões de userscript, e ⚠ NÃO um sufixo: `evilyoutube.com` não casa com `youtube.com`, embora
termine com ele. O padrão recusa, de propósito: `*` e `*.com` (curinga sobre sufixo público — um app
tomaria a internet inteira), IP literal (endereço não é identidade de site) e nome de rótulo único,
do qual `localhost` é o caso que importa — aqui ele é o loopback DO SERVIDOR, e reivindicá-lo
sequestraria todo servidor de desenvolvimento do ambiente. ⚠ O que o padrão NÃO consegue recusar é
curinga sobre sufixo público de mais de um rótulo (`*.co.uk`), que exige a Public Suffix List; essa
recusa é do portal. Declarar um host não elege ninguém: com dois apps declarando o mesmo host, o
usuário decide em Configurações → Sites e, até lá, o link segue para o navegador.

## `backend`

`object`, obrigatório, sem campo além dos listados.

### `backend.runtime`

um dos valores listados, obrigatório, valores `"python3"`, `"node"`, `"binary"`.

Prefira um runtime que o próprio mecanismo já exija (python3): um nvm/pyenv pessoal não aparece no
PATH de um exec não-interativo por SSH.

### `backend.entrypoint`

`string`, obrigatório.

Relativo à raiz do pacote. Deve bindar no socket unix de $VSSH_APP_SOCKET — o único endereço que
existe, e é o que o `transport` logo abaixo diz, com um enum de um valor só. Com as libs do toolkit
isso é uma linha: escutar(server) no Node, criar_servidor() no Python. Um app que binde uma porta em
127.0.0.1 não é proxiado por ninguém: healthcheck 000, janela em branco, e nada no log dizendo por
quê.

### `backend.transport`

um dos valores listados, opcional, padrão `"socket"`, valores `"socket"`.

Onde o backend escuta. Hoje há um valor só: 'socket' — um socket unix em $VSSH_APP_SOCKET, dentro de
~/.vssh-apps/\<id\>/, que já é 0700. A permissão de arquivo faz o que a conferência de
X-Vssh-App-Token só promete, e o app deixa de ter porta alcançável por qualquer outra conta Linux da
máquina (medido: 14 de 23 portas de app responderam a um GET sem token, 12 delas de contas alheias).
⚠ 'tcp' não existe mais, e o campo continua aqui só para que um manifesto que ainda o declare receba
um erro de validação que NOMEIA o problema, em vez de instalar e nunca responder. Nenhum app fala
TCP, e a própria lib do toolkit não sabe bindá-lo: escutar() só abre socket, e trata um
VSSH_APP_PORT sozinho como servidor desatualizado.

### `backend.aoFechar`

um dos valores listados, opcional, padrão `"encerrar"`, valores `"encerrar"`, `"manter"`.

O que acontece com o backend quando a ULTIMA janela deste app fecha. 'encerrar' (padrao): o ambiente
chama o stop. 'manter': o backend fica, porque quem o mantem vivo e o trabalho e nao a janela — e o
caso de quem e dono de sessao de terceiro. O padrão é 'encerrar' porque é o que a pessoa espera de
um desktop, e porque um padrão que vaza memória tem de ser o que se ESCOLHE e não o que se herda:
sem contrato, a conta escala por (usuário × app já aberto uma vez) — um app aberto uma vez segue
ocupando RAM em toda sessão daquela conta, sem janela na tela. kind:'service' ignora este campo: um
daemon nao morre com uma janela, por definicao. O terceiro valor previsto, 'ocioso:\<N\>m', NAO
existe ainda de proposito — ele depende de duas medidas que nao temos (o RSS do app ocioso, e como
distinguir um filho que e trabalho de alguem de um filho qualquer), e um valor aceito que nao faz
nada e pior que um valor ausente.

### `backend.installCommand`

`string`, opcional.

Roda DUAS vezes: uma como root no install, outra por usuário no primeiro run. Escreva de forma
idempotente.

### `backend.healthcheckPath`

`string`, opcional, padrão `"/"`.

Pollado direto no endereço do app pelo lifecycle (socket unix, via `curl --unix-socket`), até
15x/1s. A sondagem vai COM o header X-Vssh-App-Token, então gatear esta rota é permitido — e
isentá-la do seu gate seria abrir uma rota sem motivo. NÃO contam como pronto: 000, 5xx e 401/403.
Um 404 CONTA — o servidor respondeu —, então confira o caminho.

## `window`

`object`, opcional, sem campo além dos listados.

A janela em que o app abre, no vocabulário das janelas do próprio ambiente. Ignorado por
type:'engine'. O portal repassa este objeto inteiro ao cliente (`window: m.window || {}` em
routes/apps.ts), e o shell lê só os campos abaixo, então uma chave a mais viaja o caminho todo sem
que ninguém a leia. O objeto é fechado por isso: `widht: 900` deixaria a janela no tamanho padrão
sem erro em lugar nenhum, e o schema recusa a chave antes de o app publicar.

### `window.title`

`string`, opcional.

### `window.width`

`integer`, opcional, mínimo 200, máximo 10000.

### `window.height`

`integer`, opcional, mínimo 150, máximo 10000.

### `window.richChrome`

`boolean`, opcional.

Tabbar de verdade no cabeçalho + itens de aba no menu de contexto.

### `window.multiplasJanelas`

`boolean`, opcional, padrão `false`.

Cada pedido de abrir cria uma janela NOVA, em vez de focar a que já existe. O padrão (`false`) é o
certo para quem tem abas ou lista própria — abrir um segundo `.md` no editor não deve abrir um
segundo editor. Declare `true` quando cada coisa aberta é uma sessão inteira e independente: um
player, um visualizador de imagem, um terminal. ⚠ **O backend continua sendo UM.** Duas janelas do
mesmo app são duas visões do mesmo processo, como duas abas do navegador no mesmo servidor — não há
porta, token nem `VSSH_APP_DATA_DIR` separados, e um app que declara isto precisa aguentar dois
`open-context` sem que o segundo apague o estado do primeiro. Vale para o "Abrir com" do gerenciador
de arquivos e para o ícone no menu iniciar e no launchpad; NÃO vale para clique em notificação, que
sempre foca a janela que a produziu.

### `window.cabecalho`

um dos valores listados, opcional, padrão `"ambiente"`, valores `"ambiente"`, `"app"`.

Quem desenha a barra de título. `ambiente` (padrão) é o cabeçalho do desktop. `app` é para quem JÁ
TEM uma barra de título própria e boa — o editor, cuja barra é a do VS Code: o shell não monta a
dele, e o app põe os botões de janela na sua, chamando `vssh.window.minimize/maximize/close`.
Moldura, sombra e alças de resize continuam sendo do ambiente. Quem escolhe `app` fica responsável
por três gestos que o cabeçalho padrão dava de graça: arrastar (`vssh.window.arrastar`),
duplo-clique (`alternarMaximizado`) e menu de contexto (`menuDoCabecalho`) — um app que declara isto
e não os liga entrega uma janela que não se move.

### `window.minimos`

`object`, opcional, sem campo além dos listados.

O piso do redimensionamento pelas alças, para o app que precisa de mais que os 400×300 que o
ambiente impõe a toda janela. Um lado só também vale: `{ "largura": 640 }` deixa a altura no piso do
ambiente. Maximizar e encaixar continuam alcançando qualquer tamanho, e o piso vale para toda janela
do app, inclusive a que ele abre pelo verbo `janela.abrir`.

#### `window.minimos.largura`

`integer`, opcional, mínimo 400, máximo 10000.

#### `window.minimos.altura`

`integer`, opcional, mínimo 300, máximo 10000.

### `window.posicao`

um dos valores listados, opcional, padrão `"cascata"`, valores `"cascata"`, `"centrada"`.

Onde a janela nasce. `cascata` (padrão) é a janela de trabalho: cada uma abre um pouco abaixo e à
direita da anterior, a partir do canto do display em que está o ponteiro. `centrada` é o diálogo e o
painel: no meio desse display. Uma janela restaurada de uma sessão anterior volta onde estava, e
este campo não a alcança.

### `window.cancelarArraste`

`array` de `string`, opcional.

Seletores CSS que não iniciam o arraste da janela, somados à lista do ambiente (botões, campos de
formulário). Só alcançam o que o shell desenha em volta do iframe, como a barra de abas de quem tem
`richChrome`: o ponteiro dentro do documento do app nunca chega ao shell. O shell descarta um
seletor que o navegador não aceita.

### `window.icone`

`object`, opcional, sem campo além dos listados.

O ícone da janela (barra de título, barra de tarefas, Alt+Tab), quando ele não é o `icon` do app.
`glifo` é um desenho do próprio ambiente, pintado na cor de destaque que a pessoa escolheu, para o
app parecer nativo; `url` é um caminho dentro do app, relativo à raiz dele, que o backend do app
serve. Declare um dos dois; `glifo` vence quando há os dois, e o shell descarta um caminho que sai
do app.

#### `window.icone.glifo`

`string`, opcional, valores `"pasta"`, `"globo"`.

#### `window.icone.url`

`string`, opcional, comprimento mínimo 1.
