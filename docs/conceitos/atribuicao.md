# Atribuição: de quem é um processo

Ao terminar esta página você sabe como o ambiente descobre a que app pertence cada processo do
servidor, por que essa descoberta não usa a linha de comando, e o que ela decide na tela: o
agrupamento do gerenciador de tarefas, o botão que aparece ao lado de cada entidade e o que um
`stop` alcança.

## A marca

Todo processo que o `vssh-app-run` sobe carrega `VSSH_APP_ID=<id>` no ambiente. O `exec` que
substitui o script pelo runtime mantém o PID e o `environ`, e cada filho que o app gerar herda a
variável. É essa marca, lida de `/proc/<pid>/environ`, que diz de quem é um processo.

A linha de comando não serve para isso. Depois do `exec`, o `cmdline` do processo é o do runtime
(`python3 backend/main.py`, `node backend/server.js`, o binário), e um `pgrep -f "vssh-app-run
<id>"` para de casar segundos depois da subida. Um PID reciclado também engana: o `run.pid` diz
onde procurar, e o `environ` confirma que quem está lá é mesmo este app.

Para conferir à mão, no servidor:

```bash
pid=$(sudo -u <usuario> cat ~<usuario>/.vssh-apps/<id>/run.pid)
tr '\0' '\n' < /proc/$pid/environ | grep '^VSSH_APP_ID='
```

É a verificação que o portal e o `vssh-app-install --force` fazem antes de agir sobre um processo.
Um `--force` sinaliza `SIGTERM` só ao que responde por este app.

## O que o gerenciador de tarefas faz com ela

O gerenciador de tarefas do ambiente lista entidades, e o agrupamento é a marca. Um app é a árvore
de processos que carrega o seu `VSSH_APP_ID`, com o consumo somado. O que não tem marca fica fora
da lista agrupada; a busca continua alcançando tudo.

A segunda fonte da lista é o registro de apps: quem é `kind: service` e tem pacote aparece parado
quando não está de pé, porque um serviço que caiu não tem processo para ser listado.

Quatro regras decidem o botão que aparece no rodapé para a entidade selecionada, e as quatro são
lidas de declarações:

- um app vai pelo ciclo de vida: parar é `POST /api/apps/:id/stop`, e o sinal fica para os outros
  casos;
- a árvore de quem declara `provides: terminal/v1` é o trabalho da pessoa, e vai por sinal. Um
  `python3 treina.py` nascido num terminal é da pessoa, e o gerenciador não o trata como parte do
  app de terminal;
- quem não tem pacote no servidor (o Supervisor de Apps) não tem ciclo de vida do ambiente e não
  ganha botão nenhum;
- o que o ciclo de vida não alcança vai por sinal. Um processo marcado fora da árvore do `run.pid`
  sobrevive ao `stop`, que ainda assim responde 200. O caso se reconhece pela contradição entre as
  duas fontes (o supervisor diz `stopped` ou `failed`, e há processos com a marca), e a janela
  confere numa segunda leitura antes de virar veredito, porque o supervisor varre a cada 10 s e o
  par também é verdadeiro em todo start.

## Por que o terminal é um app próprio

O agente do sistema serve arquivos, portas e a lista de processos, e um PTY caberia nele. Ele não
o serve, e o motivo é a atribuição: um shell nascido do agente carregaria `VSSH_APP_ID=sistema`, e
o `python3 treina.py` de alguém apareceria no gerenciador como "Agente do sistema". O PTY é do app
de terminal, um vssh-app com daemon próprio, e a árvore dele é lida como o trabalho da pessoa.

A mesma regra vale para o seu app. Se ele lança um processo que é da pessoa (um kernel de notebook,
um build que ela pediu), esse processo aparece como parte do seu app no gerenciador, e o `stop` do
app o leva junto, porque ele está na árvore do `run.pid`. Um app que quer ser dono de sessão de
terceiro declara `aoFechar: manter`, para o backend não morrer com a janela; e um app que quer
que o trabalho da pessoa apareça como dela declara `provides: ["terminal/v1"]`.

## O que a marca não é

A marca é atribuição, e o escopo do systemd é contenção. Os dois costumam coincidir: o `exec`
acontece dentro de um `systemd-run --user --scope`, então a árvore inteira do app fica no mesmo
escopo, e é sobre o escopo que os tetos de memória e de tarefas valem. Mas um servidor sem
gerenciador systemd do usuário sobe o app fora de escopo, e a marca continua lá: o gerenciador de
tarefas ainda sabe de quem é o processo, só não pode dizer que ele está contido. Os dois fatos
saem separados em `~/.vssh-apps/<id>/limits.json`.

A marca também não é fronteira de segurança. Ela é lida por quem tem acesso ao `/proc` do dono, e
o próprio dono pode exportar `VSSH_APP_ID` no que quiser. O que ela dá é uma resposta uniforme à
pergunta "de quem é isto", que o ambiente inteiro lê do mesmo lugar.
