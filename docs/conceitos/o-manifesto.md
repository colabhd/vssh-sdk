# O manifesto como declaração

Ao terminar esta página você sabe o que cada campo do `vssh-app.json` declara, o que o ambiente
faz com a declaração antes de rodar uma linha do app, e por que um campo que o schema não conhece
é recusado em vez de ignorado. A referência campo a campo é o schema
(`schema/vssh-app.schema.json`, no toolkit); esta página é sobre o que declarar significa.

## Por que declarar

O ambiente responde, sem executar o app, se ele roda neste servidor, se precisa de GPU, que
arquivos sabe abrir e quanta memória pode tomar. Cada resposta vem de um campo do manifesto, lido
pelo portal, pelo `vssh-app-install` e pelo `vssh-app-run`. O que não está
declarado o ambiente não sabe, e o que ele não sabe ele não mostra: um app sem `opens` não entra no
"Abrir com", um app sem `secrets` não tem onde a pessoa colocar a credencial, um app sem
`requiredPackages` esconde a dependência de sistema num `installCommand` que só falha ao rodar.

Declarar também é o que permite trocar uma peça sem tocar em outra. Um app que declara
`provides: ["llm/v1"]` pode ser trocado por outro que declare o mesmo, e o consumidor não fixa
nenhum `id` no código.

## Os campos, pelo que decidem

### Identidade

| campo | o que decide |
|---|---|
| `id` | imutável. Vira caminho (`/opt/vssh-apps/<id>/`), endereço (`~/.vssh-apps/<id>/app.sock`) e sentinel do menu. O endereço é derivado do `id`, e por isso trocar o `id` é publicar outro app |
| `version` | semver, obrigatório. A instalação pelo repositório é idempotente por versão: mesma versão instalada, nada acontece; versão diferente é atualização |
| `name`, `description`, `icon` | o que a pessoa vê no menu e na loja. `icon` é caminho relativo à raiz do pacote |
| `category` | a seção do menu iniciar e do launchpad, no vocabulário do menu freedesktop (`Development`, `Office`, `Utility`, `System`). Sem ela o app cai em `Other` |

### Dois eixos: `type` e `kind`

`type` diz se o app tem janela. `app` (o padrão) abre numa janela; `engine` é backend puro, sem
ícone no launchpad, consumido por outra peça do ambiente (o motor de reescrita web é um `engine`
que o navegador embutido usa por baixo).

`kind` diz como o app vive. `app` (o padrão) sobe quando alguém abre a janela; `service` é um
daemon supervisionado, que sobe junto com a sessão, reinicia sozinho quando cai e reporta estado em
Configurações. Os dois eixos são independentes: um `type: engine` pode ser `kind: app`
(sobe sob demanda) ou `kind: service` (sempre de pé). `alwaysRunning: true` é a grafia antiga de
`kind: service` e continua aceita.

### O backend

| campo | o que decide |
|---|---|
| `backend.runtime` | `python3`, `node` ou `binary`. Prefira um runtime que o próprio sistema já exija: um `nvm` ou `pyenv` pessoal não aparece no `PATH` de um exec não-interativo por SSH |
| `backend.entrypoint` | o arquivo que o `vssh-app-run` executa, relativo à raiz do pacote. Ele precisa escutar no socket unix de `$VSSH_APP_SOCKET`; um backend que binde uma porta em `127.0.0.1` não é proxiado por ninguém, e o sintoma é healthcheck `000` e janela em branco |
| `backend.transport` | tem um valor só, `socket`. O campo existe para que um manifesto que ainda declare `tcp` receba um erro que nomeia o problema, em vez de instalar e nunca responder |
| `backend.installCommand` | roda duas vezes: como root na instalação, e como cada usuário na primeira subida (e de novo quando o hash do código muda). Escreva-o idempotente |
| `backend.healthcheckPath` | o caminho que o ciclo de vida sonda até 15 vezes, 1 s entre elas, com o header `X-Vssh-App-Token`. `000`, `5xx`, `401` e `403` não contam como pronto; `404` conta, porque o servidor respondeu, e o que está errado é o caminho |
| `backend.aoFechar` | o que acontece ao backend quando a última janela fecha. `encerrar` (padrão) para o processo; `manter` o deixa de pé, para quem é dono de sessão de terceiro (um servidor de notebooks, um build em curso). `kind: service` ignora o campo |

### A janela

`window.title`, `window.width` e `window.height` são o tamanho e o título de abertura; depois disso
o tamanho é da pessoa. `richChrome` pede abas de verdade no cabeçalho. `multiplasJanelas` faz cada
pedido de abrir criar uma janela nova em vez de focar a existente, para quem tem sessões
independentes (um player, um visualizador de imagem). `cabecalho: "app"` entrega a barra de título
ao app, que passa a responder pelos gestos dela. `type: engine` ignora o bloco inteiro. Ver
[a janela](a-janela.md).

### O que o app sabe abrir

| campo | o que decide |
|---|---|
| `handles` | o app se oferece como substituto de um dos cinco embutidos: `terminal`, `editor`, `fileBrowser`, `ide`, `browser`. A pessoa escolhe em Configurações. `vscode` é a grafia antiga de `ide` |
| `opens.extensions`, `opens.mimeTypes` | os tipos de arquivo que o app abre. O app entra no submenu "Abrir com" e fica elegível a padrão do tipo. O arquivo chega pelo evento `abertura` |
| `opens.urls` | os hosts cujos links o app abre (`youtube.com`, `*.youtube.com`). Só o host, sem esquema, porta ou caminho. `*.youtube.com` casa subdomínios e não é sufixo: `evilyoutube.com` não casa. `*`, `*.com`, IP literal e rótulo único (`localhost` incluído) são recusados |

### O que o app acrescenta ao ambiente

`contributes` é o que o app põe fora da própria janela:

- `contributes.settings` é um caminho de script que registra uma seção em Configurações. O script
  roda na origem do shell, com a confiança do shell, e carrega quando a janela de Configurações
  abre, não no boot;
- `contributes.contextMenu` é dado: itens no clique direito de um arquivo, de uma pasta, da área
  de trabalho ou do ícone do app (a jump list). O app declara; quem monta, ordena e executa é o
  shell. Teto de 8 itens por app, rótulo de até 48 caracteres, `ordem` medida contra os itens do
  próprio shell (a régua publicada vai de 10, "Abrir", a 80, "Imprimir"; o padrão 100 põe o item
  depois de todos). Item inválido é omitido, e os irmãos válidos continuam;
- `contributes.browserExtension` declara a extensão do navegador embutido que é o par deste app,
  só pelo `id` dela e uma `razao`. Declarar oferece; instalar continua sendo escolha da pessoa.

As duas formas são de naturezas diferentes de propósito: Configurações abre porque alguém pediu e
pode esperar um `fetch`; o menu de contexto abre no clique direito e não pode.

### O que o app pede ao servidor

| campo | o que decide |
|---|---|
| `requiredPackages` | pacotes Linux, no nome Debian, com alternativas por `\|` (`chromium \| google-chrome-stable`). O `vssh-app-install` recusa antes de copiar nada, nomeando o que falta; o painel admin mostra o que falta por servidor |
| `resources` | os tetos do escopo do systemd em que o processo sobe: `memoryHigh`, `memoryMax`, `cpuQuota`, `tasksMax`. O ambiente já aplica um padrão de memória e de tarefas a todo app; o bloco existe para quem precisa de outro. `cpuQuota` não tem padrão: CPU disputada deixa lento, e o escalonador reparte |
| `gpu` | o app precisa da GPU. Declarar faz duas coisas: o ambiente inventaria a placa pelo kernel e reporta o veredito, e o processo deixa de receber `CUDA_VISIBLE_DEVICES=""`. Ver [GPU](../guias/gpu.md) |
| `secrets` | as credenciais que o app recebe como variáveis de ambiente. Só nome, descrição e `required`; o valor nunca vem do manifesto, e o gate de publicação recusa `value` ali |
| `provides` | as capacidades que o app oferece a outros, em `nome/vN`. Declarar não é provar: o ambiente não verifica, e quem não puder atender falha por dentro, onde sabe dizer por quê |
| `minShellVersion` | a versão mínima do shell. O padrão é não declarar; quem declara está dizendo "uso algo que não existia antes". Quem confere é o portal, na instalação. Não substitui `vssh.app.capacidades()`, que decide em runtime |

## Campo desconhecido é recusado

Todo objeto do schema fecha com `additionalProperties: false`, inclusive a raiz. O gate de
publicação recusa `requiredPackage` sem o `s`, `gpuu` e `widht`, e nomeia o vizinho quando há um.
Sem isso um campo digitado errado publicava limpo e era descartado em silêncio por quem lê: um
`widht: 900` abria a janela no tamanho padrão sem uma linha de log em lugar nenhum.

A consequência para quem escreve: um manifesto feito para um toolkit mais novo é recusado por um
mais velho, e é o comportamento desejado. "Este toolkit não conhece este campo" é a informação;
publicar um app cujo campo ninguém vai ler é a alternativa. Se você precisa de um campo que o
schema não tem, ele entra no schema antes de entrar no manifesto.

O que o `vssh-app-install` valida no servidor é o mínimo (o `id` e a forma do pacote), porque ele
roda offline e não tem como buscar o schema. A validação inteira acontece no `vssh-app-publish`, que
é o portão de entrada do repositório. Um pacote que chega ao servidor por outro caminho (um `scp`
durante o desenvolvimento) pula esse portão, e o `vssh-app-run` reconfere só o que vira linha de
comando: o alfabeto de `resources`, o `transport`, o booleano de `gpu`.
