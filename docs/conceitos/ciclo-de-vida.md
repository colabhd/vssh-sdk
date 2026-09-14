# Ciclo de vida

Ao terminar esta página você sabe o que acontece entre o clique no ícone e o backend de pé, como o
ambiente decide que o app está pronto, quem o mantém vivo quando ele cai, e o que muda quando a
pessoa fecha a última janela. Tudo aqui vale por usuário: cada pessoa tem o próprio backend de
cada app, rodando como a conta Linux dela.

## A subida

O clique no ícone vira `POST /api/apps/:id/start`. O portal escreve o arquivo de ambiente do app,
`~/.vssh-apps/<id>/env` (de onde saem `VSSH_APP_TOKEN` e `VSSH_APP_BASE_PATH`), e lança
`nohup setsid vssh-app-run <id>` por SSH, como o usuário, com stdout e stderr em
`~/.vssh-apps/<id>/run.log`.

O `vssh-app-run` é o único ponto por onde toda subida passa (o portal, o supervisor depois de uma
queda, e uma invocação à mão), e é por isso que as decisões de contenção moram nele. Em ordem:

1. lê o manifesto e recusa o que não vira linha de comando (um `transport` que não seja `socket`,
   um valor de `resources` fora do alfabeto, que é descartado e substituído pelo padrão);
2. carrega o `env` e, depois dele, o cofre de segredos (`secrets.json`), que exporta cada
   credencial como variável de ambiente. O cofre vem depois do `env` de propósito: num nome que
   colida, o segredo que o usuário guardou vence;
3. deriva o endereço, `$HOME/.vssh-apps/<id>/app.sock`, e pergunta se alguém já atende ali
   conectando no socket. Conectou, o app já está de pé e o script sai com sucesso. Recusou, o
   arquivo é um socket órfão de um processo morto, e o script o apaga antes de subir. Um
   `test -S` não serve para essa pergunta, porque o arquivo sobrevive ao processo;
4. escreve um marcador `subindo`, datado, para o portal não confundir um app em prólogo de
   instalação com um app morto. Sem ele, um `pip install` de dois minutos seria lido como "sem
   pid" e o app seria morto a caminho de ligar;
5. roda o `installCommand` como o usuário, se o hash do código instalado mudou desde a última vez.
   O marcador guarda o hash, e um app atualizado com dependências novas refaz o setup em vez de
   subir com o `venv` da versão anterior;
6. decide a GPU: quem não declarou `gpu: true` recebe `CUDA_VISIBLE_DEVICES=""`; quem declarou
   recebe o inventário do servidor e o veredito, gravados em `limits.json`;
7. escreve o `run.pid` e faz `exec` do runtime dentro de um `systemd-run --user --scope` com os
   tetos de memória e de tarefas. Sem gerenciador systemd do usuário o app sobe do mesmo jeito,
   sem limite, e o motivo fica em `limits.json` e em Configurações.

O `exec` troca a imagem do processo mantendo o PID. É por isso que `pgrep -f "vssh-app-run <id>"`
para de casar segundos depois da subida, e por isso que o ambiente reconhece o processo pelo
`run.pid` mais a marca `VSSH_APP_ID` no `environ` dele ([atribuição](atribuicao.md)).

## A sondagem

O portal sonda o `healthcheckPath` até 15 vezes, com 1 s de intervalo, com
`sudo -u <dono> curl --unix-socket` e com o header `X-Vssh-App-Token`. O `sudo` é necessário
porque o socket é do usuário e quem chega pelo SSH é o provisionador.

| código | veredito |
|---|---|
| `000` | ninguém atendeu. O processo morreu antes do `listen()`, ou o socket está lá e a sondagem não pôde abri-lo. Olhe o `run.log` e o log do app |
| `5xx` | o processo está de pé e se declara com problema. Não conta como pronto |
| `401`, `403` | o app recusou uma requisição que veio com o token. Não conta como pronto |
| `404` | conta como pronto: o servidor respondeu, e o que está errado é o `healthcheckPath` do manifesto |
| demais `2xx`, `3xx`, `4xx` | pronto |

Você pode gatear a rota de healthcheck como qualquer outra, porque a sondagem leva o token.
Responda rápido e sem depender de setup pesado: a sondagem segura o clique de quem abriu o app.

O `start` não falha quando as 15 tentativas estouram. O backend pode subir logo depois, e derrubar
a abertura seria pior que abrir com aviso; a resposta traz `ready: false` e `status: "starting"`, o
shell mostra um aviso, e o veredito chega depois pelo canal de eventos (`app-status` em
`/ws/events`).

## A navegação espera

Quando uma navegação (um iframe, um documento) encontra o app parado, o proxy o levanta e segura a
resposta até o veredito do healthcheck, com teto de 20 s, abaixo dos 60 s do ingress e dos 100 s
do Cloudflare. Numa abertura fria a janela chega ao app sem passar por um erro. Um XHR atrasado ou
um service worker de outra aba não levantam nada: só uma navegação conta.

O que a espera não alcança (um start que falhou, um app que leva mais que o teto) vira um painel de
erro dentro da janela, e o painel tenta sozinho, em backoff, obedecendo o `retryAfterMs` que o
servidor manda, e recarrega quando o veredito chega pelo canal de eventos.

## Quem mantém o app de pé

Três coisas, e elas não se sobrepõem:

| quem | quando age | como sabe que deve |
|---|---|---|
| o proxy | uma janela pede o app e o backend não está de pé | a requisição é uma navegação |
| o `vssh-app-supervisor` | o processo cai, a qualquer momento | existe `~/.vssh-apps/<id>/env`, o estado desejado "rodando" que o portal escreve no start e o stop apaga |
| a janela | o painel de erro está na tela | tenta em backoff e ouve o canal de eventos |

O supervisor é um processo por usuário, que o portal inicia ao provisionar a sessão e encerra no
fim dela. A cada 10 s ele varre os apps instalados: para cada um que tenha `env`, confere se o
processo do `run.pid` está vivo e, se não estiver, relança `vssh-app-run <id>`, esperando 2^n
segundos entre tentativas (teto de 60 s). Cinco falhas seguidas levam ao estado `failed`, e depois
de 600 s de silêncio o contador zera e o app ganha outra chance. O estado sai em
`~/.vssh-apps/<id>/status.json` e em Configurações.

Nada disso segura sem `loginctl enable-linger` para o usuário no servidor. O escopo do systemd em
que o app roda morre com o `user@<uid>.service`, e o systemd encerra esse serviço quando a última
sessão do usuário fecha; o próprio `sudo -u` com que o portal lança o app abre e fecha uma sessão
dessas. O portal confere e corrige o linger uma vez por sessão e registra no log quando não
consegue. O sintoma na tela é `contido: false` no gerenciador de tarefas, com o motivo.

## Ao fechar a última janela

O que para um app é o `aoFechar` do manifesto. `encerrar`, o padrão, faz o ambiente chamar o stop
quando a última janela do app fecha, e o stop apaga o `env`; a partir daí nenhum dos três acima o
ressuscita. `manter` deixa o backend de pé, para quem é dono de sessão de terceiro: um servidor de
notebooks, um build em curso, um terminal com processos. `kind: service` ignora o campo, porque um
daemon não morre com uma janela.

O padrão é `encerrar` porque um padrão que vaza memória tem de ser o que se escolhe: sem contrato,
um app aberto uma vez seguiria ocupando RAM em toda sessão daquela conta, sem janela na tela.

A janela também avisa o backend ao fechar: `POST <base>close-tabs`, com as sessões das abas, para
o app que precisa encerrar algo de verdade (um terminal que mata a sessão do motor). O pai faz esse
`fetch`, porque o iframe pode não sobreviver o bastante para reagir a um `postMessage`. Quem não
implementa a rota recebe um `404` ignorado.

## Atualização

Uma versão nova entra por `vssh-app-install <id> --force`, e o script encerra com `SIGTERM` toda
instância do app em execução, de qualquer usuário, confirmando pelo `environ` que o processo é
mesmo desse app antes de sinalizar. Cada pessoa sobe uma instância nova na próxima abertura.

Fora do `--force`, o portal detecta código que mudou no disco: o `vssh-app-run` exporta o hash do
pacote instalado (`VSSH_APP_INSTALLED_HASH`) no ambiente do processo, e o portal o compara a cada
start com o hash calculado do disco. Divergiu, o processo antigo é encerrado e o próximo start sobe
com o código atual. Sem isso um processo já rodando nunca perceberia que o código embaixo dele
mudou.

## Os dois logs

`~/.vssh-apps/<id>/run.log` é o stdout e o stderr do backend, gravado pelo ciclo de vida e
rotacionado para `run.log.1` a cada start, para que o registro da execução que morreu não se
perca. É esse arquivo que o botão "Ver log do backend" da janela mostra, e que
`GET /api/apps/:id/log?tail=N` serve. `$VSSH_APP_DATA_DIR/app.log` é o log do app, estruturado, se
o app usar a biblioteca de log do toolkit; é ele que nomeia operação, caminho e código quando o
`run.log` diz só que algo falhou.
