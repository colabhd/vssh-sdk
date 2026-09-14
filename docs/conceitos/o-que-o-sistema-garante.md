# O que o sistema garante

Ao terminar esta página você sabe com o que um app pode contar, e onde cada garantia acaba. Todas
são estreitas de propósito: prometer mais do que o sistema entrega seria pior que não prometer.

## A janela sobrevive a uma queda do portal

O shell é JS rodando no navegador. Uma queda do portal é uma requisição que falha, e o ambiente
continua de pé, com as janelas abertas e o trabalho na tela, a sua janela entre elas. O canal de
eventos reconecta sozinho, com backoff, sem intervenção. O shell avisa por você: um aviso na
bandeja diz que o portal está fora, que o que está aberto continua ali, e avisa quando voltar.

Isso muda o que você escreve no app:

- não feche a janela porque um `fetch` falhou. Mostre o estado e ofereça tentar de novo; fechar é
  a única coisa que a pessoa não consegue desfazer;
- não apague num `catch` o que já está na tela. Uma lista que o servidor entregou é dado bom;
  substituí-la por vazio porque a atualização falhou faz o conteúdo piscar e sumir sem explicação;
- não recarregue a página. `location.reload()` de dentro de um app derruba o ambiente inteiro.

A garantia é estreita: uma escrita que falhou continua perdida, e nada disso vale para o seu
backend. Se o processo do app cair, o app cai; o que sobrevive é o ambiente em volta dele. O que
sobrevive é o que já está na tela, e nada além disso.

## O backend volta enquanto o estado desejado for "rodando"

Enquanto existir `~/.vssh-apps/<id>/env`, o supervisor do usuário relança o backend quando ele
cai, com backoff, e uma navegação que encontra o app parado o levanta e espera até 20 s pelo
veredito do healthcheck. O que esta garantia não cobre: cinco falhas seguidas levam ao estado
`failed` por 600 s; um servidor sem `loginctl enable-linger` perde o escopo do systemd quando a
sessão do usuário fecha; e `aoFechar: encerrar` apaga o `env` ao fechar a última janela, o que
transforma "rodando" em "parado" de propósito. Ver [ciclo de vida](ciclo-de-vida.md).

## O processo sobe contido

Todo app sobe num escopo do systemd com teto de memória (pressão a 70% e limite duro a 85% da
máquina, por padrão) e de tarefas (25% do `pid_max`). Quando o app declara só `memoryMax`, o teto
de pressão é derivado como 90% dele, para a fase de lentidão vir antes do OOM. Isso contém um app
desgovernado; dois apps no teto ainda somam mais que a máquina, e por isso é uma guarda, sem
promessa de cota. Num servidor sem gerenciador systemd do usuário o app sobe sem limite, e o
motivo fica escrito em `limits.json` e em Configurações.

## O endereço é derivado, e o socket é do dono

O backend escuta em `$HOME/.vssh-apps/<id>/app.sock`, num diretório `0700`. Nenhuma outra conta
Linux da máquina o alcança, o que uma porta em loopback não garante: o loopback não tem dono. O
header `X-Vssh-App-Token` que o proxy injeta é a segunda barreira, contra outro processo da mesma
conta. Um app que não se importa (um hello world) não confere o header; um que serve algo sensível
confere e recusa o que não veio pelo proxy.

## O fio fica parado

Cada verbo da ponte tem um nome público e um nome que viaja no fio por `postMessage`. O fio é
interno ao sistema, porque só o SDK gerado o fala, e fica parado quando o nome público muda. Um
app instalado continua funcionando enquanto o SDK evolui. Um shell que não conhece um verbo não
responde, e o SDK termina a chamada por prazo em vez de deixá-la pendurada; `vssh.app.capacidades()`
lista os verbos e eventos do shell em que o app caiu, e é com ela que o app decide o que oferecer.

## Shell e apps compartilham uma origem

Dois apps conversam por `BroadcastChannel`, e um app conversa com o shell do mesmo jeito. Isso
vem de duas decisões: o backend é servido por caminho relativo na origem do portal, e o iframe da
janela não tem `sandbox`. Dependem disso o `BroadcastChannel`, o `localStorage` compartilhado, o
`postMessage` da ponte e o polyfill de File System Access.

O limite é a metade que importa: a mesma origem é o que torna o isolamento entre apps fraco. Outro
app da mesma sessão escuta os seus canais. Não mande por `BroadcastChannel` o que você não mandaria
por um mural. O modelo é "um admin instalou, portanto é confiável", e a fronteira de segurança é a
instalação, como root, num servidor compartilhado. No dia em que houver origem separada por app, a
mensageria passará a atravessar o shell; o seu código muda nesse dia, e não antes.

## O que o sistema não garante

- que o app apareça no mixer de volume sem carregar o shim: o painel só lista o que consegue
  controlar, e um slider que não morde é pior que slider nenhum;
- que uma atividade declarada por arquivo (`live/<chave>.json`) sobreviva a 60 s sem o carimbo
  `at` renovado: o arquivo sobrevive a um `kill -9`, e sem prazo ele mentiria para sempre;
- que o OPFS do navegador seja a verdade: ele é cache, por perfil de navegador, e a pessoa troca de
  máquina. O que o app quer guardar vai para o backend dele ou para o filesystem da pessoa;
- que o estado de uma sessão restaurada seja mais que uma rota: `vssh.app.lembrarRota` guarda uma
  string, e o app boota naquele endereço como se alguém tivesse aberto o link.
