# Avisos e atividades

Ao terminar este guia você sabe escolher entre uma notificação, um aviso efêmero e uma atividade,
emitir cada um com a janela aberta pelo espaço `vssh.avisos`, e emitir os mesmos três de um
backend sem janela, por arquivo. A escolha decide se o sino do ambiente continua querendo dizer
alguma coisa.

Os nomes de verbo deste guia seguem a [nota sobre os nomes](../README.md#sobre-os-nomes-dos-verbos);
o shim de hoje os expõe como `vssh.notify`, `vssh.toast` e `vssh.live`.

## Três superfícies, três tempos de vida

| | o que é | vive | deixa rastro |
|---|---|---|---|
| notificação | um fato que aconteceu | até ser lida; retenção por dias | sim, no histórico do sino |
| aviso efêmero | uma frase que se lê e se esquece | segundos | não |
| atividade | uma condição que é verdade agora | enquanto vale | não |

A regra que decide, e que vale para todo ponto de chamada novo: um aviso é para o que não deixa
rastro na tela. Se a pessoa vê o resultado acontecer (o item aparecendo na lista, o nome mudando),
não mande nada. Se ela vai precisar reencontrar o que aconteceu (um caminho, um id, um erro), é
notificação. Se ainda não terminou, é atividade.

O custo de escolher errado não cai no seu app; cai na atenção de quem usa o ambiente inteiro. Um
sino cheio de "arquivo salvo" ensina a ser ignorado, e o badge deixa de informar.

## Notificação

```js
vssh.avisos.notificar('Índice reconstruído', { titulo: 'Busca', nivel: 'success' });
```

`nivel` é o tom, a cor da barrinha: `info`, `success`, `warning`, `error`. `prioridade` é outra
coisa: quanto isso interrompe.

| `prioridade` | badge | aviso na tela | notificação do sistema operacional |
|---|---|---|---|
| `baixa` | sim | não | não |
| `normal` (padrão) | sim | 4 s | só com a aba oculta |
| `alta` | sim | não some sozinho | só com a aba oculta |

Não há nível acima de `alta` para um app: bloquear a tela de quem está trabalhando é poder do
ambiente, e o shell rebaixa para `alta` o que vem de fora. Para uma pergunta que precisa de
resposta, `vssh.dialogos` abre uma pergunta que a pessoa escolheu abrir.

`chave` é a identidade: uma notificação com a mesma chave substitui a anterior no lugar. É o que
faz "3 de 5 baixados" ser uma linha, e não cinco:

```js
vssh.avisos.notificar(`${feitos} de ${total} baixados`, { chave: 'downloads', prioridade: 'baixa' });
```

Ver é ler: o ponteiro parado por 600 ms sobre o aviso na tela marca a notificação como lida, e o
clique também. O que não marca é o aviso que some sozinho no tempo, porque esse é o caso inteiro
que o histórico existe para atender: passou na tela enquanto ninguém olhava.

Se a pessoa estiver em "não perturbe", ou tiver silenciado o seu app pelo botão direito numa
notificação dele, a tela não é interrompida; a entrada fica no histórico do mesmo jeito.

### Uma notificação que pede resposta

```js
vssh.avisos.notificar('Backup falhou: disco cheio', {
  titulo: 'Backup',
  nivel: 'error',
  prioridade: 'alta',
  acoes: [
    { id: 'retry',  rotulo: 'Tentar de novo' },
    { id: 'ignore', rotulo: 'Ignorar' },
  ],
});

vssh.avisos.ao('acao', ({ notificacao, acao }) => { if (acao === 'retry') tentarDeNovo(); });
```

No máximo três ações, cada uma `{ id, rotulo }`, e são dados: nunca uma função, nunca um caminho
por botão. Os botões aparecem no aviso na tela e na linha do painel, porque o aviso some, e uma
notificação que só pudesse ser respondida enquanto ele estivesse na tela expiraria sem avisar.

## Aviso efêmero

```js
vssh.avisos.avisar('Copiado');
vssh.avisos.avisar('Enviando 3 de 5…', { chave: 'envio' });   // a mesma chave reescreve no lugar
```

Nunca entra no histórico. Teto de 4 na tela, com "+N avisos" para o que a rajada engoliu; quem
está sendo lido (ponteiro em cima) não é derrubado. Se a pessoa vai querer reencontrar o que você
disse, não é isto.

## Atividade

```js
vssh.avisos.atividade('sync', {
  titulo: 'Sincronizando',
  texto: arquivoAtual,
  formato: 'progresso',                     // 'simples' | 'progresso' | 'midia'
  progresso: { feito, total },              // ou { indeterminado: true }
  acoes: [{ id: 'pausar', rotulo: 'Pausar' }],
});

// terminou, e o fim não interessa a ninguém:
vssh.avisos.encerrar('sync');

// terminou, e o desfecho vale um registro:
vssh.avisos.encerrar('sync', { registrar: { titulo: 'Pronto', texto: `${total} arquivos` } });
```

A atividade aparece como ícone com porcentagem na bandeja e como linha com barra na seção "Agora"
do painel do sino, e some quando você a encerra, sem rastro, a menos que peça `registrar`. Nada
disso toca o `localStorage`: uma atividade que sobrevivesse ao processo que a declarou estaria
mentindo sobre o estado do ambiente. Encerre sempre.

## A bandeja

Um ícone ao lado do relógio, com tooltip, badge e menu, para o app que continua fazendo algo com
a janela minimizada ou fechada. Um item por app, atualizável: chamar de novo troca ícone, tooltip,
badge e menu sem o ícone mudar de lugar. O tooltip diz como o app está, porque é isso que quem
olha a bandeja quer saber. Devolve `false` em vez de lançar quando não há bandeja do outro
lado. O verbo vive em `vssh.avisos`; a forma dele está na referência.

## Sem janela: o backend fala por arquivo

`vssh.avisos` é do frontend e precisa de uma janela viva para atravessar a ponte. Um daemon que
termina um backup às 3h não tem janela, e é ele que mais precisa avisar. Para ele, o modelo se
inverte: estado por arquivo, ação por HTTP. O portal lê os três arquivos no mesmo tick da bandeja,
um comando por servidor cobrindo todos os usuários, e só enquanto alguém tiver o desktop aberto.

```
~/.vssh-apps/<id>/tray.json               estado: vale o conteúdo atual; sumiu o arquivo, sumiu o ícone
~/.vssh-notifications/journal.ndjson      histórico: append-only, uma linha por notificação
~/.vssh-notifications/live/<chave>.json   a atividade acontecendo agora
```

As bibliotecas do toolkit escrevem os três, nos dois runtimes:

```python
from vssh_app_toolkit.notify import notificar
from vssh_app_toolkit.live import definir_live, limpar_live, manter_live_vivo, limpar_live_ao_sair
from vssh_app_toolkit.tray import definir_bandeja, limpar_bandeja_ao_sair

manter_live_vivo(); limpar_live_ao_sair(); limpar_bandeja_ao_sair()

notificar('Backup concluído: 4,2 GB em 12 min', title='Backup', level='success')
notificar('Disco quase cheio', chave=f'disco-{hoje}')    # avisar uma vez só, mesmo rodando de hora em hora

definir_live('sync', {'titulo': 'Sincronizando', 'formato': 'progresso',
                      'progresso': {'feito': 3, 'total': 12}})
limpar_live('sync', registrar={'titulo': 'Sincronização concluída', 'texto': '12 arquivos'})
```

```js
const { notify } = require('vssh-app-toolkit/notify');
const { setLive, clearLive, keepLiveAlive, clearLiveOnExit } = require('vssh-app-toolkit/live');
const { setTray, clearTrayOnExit } = require('vssh-app-toolkit/tray');
```

Três coisas que a lib faz por você, e que valem saber para quem escreve o formato cru:

- o `id` da linha do journal é a chave de deduplicação de ponta a ponta, e errar é silencioso nos
  dois sentidos: id que se repete entre eventos diferentes faz o segundo nunca aparecer; id que
  muda para o mesmo evento faz a mesma coisa avisar várias vezes. Nunca use um contador do
  processo, que reinicia junto. `at` (epoch ms) é a hora do evento; sem ele, a hora exibida é a da
  entrega, que para algo que aconteceu com o desktop fechado é a hora errada;
- o `at` do `live/<chave>.json` precisa ser renovado. Um arquivo chamado `live` sobrevive a um
  `kill -9`, e o portal descarta o que passa de 60 s sem renovar; `manter_live_vivo` e
  `keepLiveAlive` renovam sozinhos enquanto a atividade fica parada esperando rede. O portal lê no
  máximo 32 arquivos de `live/` por usuário; quem precisa de mais quer uma atividade com contador;
- o clique na bandeja e a ação de uma notificação chegam ao backend como `POST` no caminho que o
  arquivo declarou (`onClick: { path: '/tray' }`, `onAction: { path: 'api/notificacao' }`), pela
  mesma rota autenticada que o app já usa, com o `X-Vssh-App-Token` injetado. `path` é relativo ao
  app, sem esquema, sem `..`, sem `//`. Se o app tiver uma janela aberta, ela ganha: a resposta vai
  por `postMessage` e o `POST` não acontece, porque entregar pelos dois lados faria "tentar de
  novo" clicado uma vez virar dois backups.

Em shell, uma notificação é uma linha:

```bash
printf '%s\n' "{\"id\":\"backup-$(date +%F)\",\"appId\":\"meu-backup\",\"body\":\"Backup concluído\",\"level\":\"success\",\"at\":$(date +%s000)}" \
  >> ~/.vssh-notifications/journal.ndjson
```

Escreva com `>>`, nunca com `>`, e rotacione você mesmo se o app for tagarela: o portal lê só a
janela do fim do arquivo (as últimas ~50 linhas), então um arquivo grande não o atrapalha, mas
ocupa o disco da pessoa para sempre. A latência é de segundos.

Janela ganha do arquivo: uma cópia pode ter atividade declarada no cliente e um `live/` do lado de
lá com a mesma chave, e o coletor não sobrescreve enquanto a do cliente durar. Sem isso o ícone
piscaria de 5 em 5 segundos sem explicação.

## Notificação do sistema operacional

Com a aba oculta e a permissão concedida, uma notificação `normal` ou `alta` também sai como
notificação do sistema operacional. É alcance a mais, e o app nunca conta com ela. A
pessoa concede no botão "Avisar fora da aba", dentro do painel de notificações.
