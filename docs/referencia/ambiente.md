# O ambiente do backend

> Página escrita no gerador do canal de publicação, a partir do que o lançador de apps do sistema
> (`infra/server/vssh-app-run` do `vssh-sso`) exporta e escreve. Uma mudança se faz lá, e aqui.

O backend de um vssh-app sobe pelo lançador do sistema, `vssh-app-run <id>`, como o usuário dono da
sessão, com o diretório corrente na raiz do pacote instalado (`/opt/vssh-apps/<id>/`). Três
caminhos chegam a ele, e os três passam pelo mesmo script: o portal, ao abrir a primeira janela do
app; o supervisor por usuário, ao relançar um app que caiu; e a mão de alguém, num terminal do
servidor. O que o processo encontra é o mesmo nos três.

## As variáveis de ambiente

| variável | valor | quem lê |
|---|---|---|
| `VSSH_APP_ID` | o `id` do manifesto | `vssh.app.ident()`; é também a marca com que o ambiente sabe de quem é cada processo, lida do `/proc/<pid>/environ` |
| `VSSH_APP_DATA_DIR` | `~/.vssh-apps/<id>/data` | `vssh.app.dados()`: o que sobrevive a reinstalação e a reinício |
| `VSSH_APP_SOCKET` | `~/.vssh-apps/<id>/app.sock` | onde o backend escuta; `vssh.servidor` o toma sozinho |
| `VSSH_APP_TRANSPORT` | `socket` | o único transporte; um valor diferente recusa a subida com o nome do campo |
| `VSSH_APP_TOKEN` | um segredo por usuário e app, que o portal sorteia e reaproveita enquanto o app está de pé | o portão do backend: cada pedido que o portal encaminha traz `X-Vssh-App-Token` com este valor, e `vssh.servidor` responde 403 com `X-Vssh-Token: recusado` ao que chega sem ele |
| `VSSH_APP_BASE_PATH` | `/proxy/app/<id>/` | o prefixo sob o qual o app é servido, sem o servidor na frente; a URL pública é `/<serverId>/proxy/app/<id>/`, e o cabeçalho `X-Forwarded-Prefix` de cada pedido traz o prefixo inteiro |
| `VSSH_APP_INSTALLED_HASH` | o hash do pacote instalado | o portal o compara com o do disco a cada abertura, e reinicia um processo que subiu com código que já mudou |
| `PYTHONPATH`, `NODE_PATH` | `/opt/vssh/sdk/python` e `/opt/vssh/sdk/node`, na frente do que já havia | de onde `from vssh import servidor` e `require('vssh')` resolvem: o runtime que o sistema instala em cada servidor |
| `PATH` | `<pacote>/.venv/bin` e `~/.vssh-apps/<id>/.venv/bin`, na frente do que já havia | um venv que o `installCommand` cria entra sem o app fazer nada |
| `CUDA_VISIBLE_DEVICES` | vazia, e só quando o manifesto não pede GPU | o runtime CUDA de um app que não pediu placa não enumera dispositivo nenhum; quem pediu pergunta `vssh.gpu.concedida()` |
| `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS` | `/run/user/<uid>` e o barramento dele | o lançador os exporta para falar com o systemd do usuário, que é quem aplica os limites de recurso; o app não precisa deles |
| as credenciais do cofre | cada `secrets[].name` do manifesto, com o valor que a pessoa digitou | o app lê como variável comum; o valor mora em `secrets.json`, e nunca passa pelo portal |

O portal escreve `VSSH_APP_TOKEN` e `VSSH_APP_BASE_PATH` no arquivo `env` antes de chamar o
lançador, e o lançador dá `source` nesse arquivo em qualquer caminho de subida; é o que faz um
relançamento pelo supervisor subir com o mesmo token que o portal espera. As preferências que o
portal tem para um app específico (o layout de teclado do motor X11) entram no mesmo arquivo.

Cada pedido HTTP que o portal encaminha ao backend traz três cabeçalhos: `X-Vssh-App-Token`, o
`X-Forwarded-Prefix` com o prefixo público do app, e `X-Vssh-Portas`, um modelo com `{{porta}}`
com que um app monta a URL de um serviço que a pessoa subiu no servidor.

## Os arquivos de `~/.vssh-apps/<id>/`

O diretório é `0700`, do usuário. O que há nele, e quem escreve cada coisa:

| arquivo | quem escreve | o que é |
|---|---|---|
| `env` | o portal, a cada start | `VSSH_APP_TOKEN`, `VSSH_APP_BASE_PATH` e as preferências do portal. Existir é o estado desejado "rodando": o supervisor relança um app que tem `env` e caiu, e o `stop` apaga o arquivo |
| `secrets.json` | o portal, quando a pessoa grava uma credencial | o cofre: um objeto nome/valor, `0600`, carregado depois do `env`, e um nome que colida vence a preferência do portal. O app pede uma credencial por `vssh.segredos.pedir`, e o valor nunca passa por ele |
| `app.sock` | o backend | o socket unix em que ele escuta, `0600`. O arquivo sobrevive ao processo; quem limpa o órfão é o lançador, depois de tentar conectar |
| `data/` | o backend | `VSSH_APP_DATA_DIR`: o que não pode se perder. O `app.log` de `vssh.servidor.criar_log` mora aqui |
| `run.pid` | o lançador, logo antes do `exec` | o PID do processo; a liveness que o portal e o supervisor conferem, junto do `VSSH_APP_ID` no `environ` dele |
| `run.log`, `run.log.1` | o portal abre, o processo escreve | stdout e stderr do backend; rotacionado a cada start, e o anterior fica em `.1`. É o que "Ver log" mostra no gerenciador de tarefas |
| `status.json` | o supervisor, a cada ciclo de 10 s | `{ id, state, restarts, pid, port, lastError, updatedAt }`; `state` é `running`, `stopped`, `restarting` ou `failed` |
| `limits.json` | o lançador, a cada subida | o que foi aplicado: `contido`, e o `motivo` quando não; `gpu` (`negada`, `concedida`, `sem-gpu`, `nao-sei`), `gpuMotivo`, `gpuInfo`, e os `limites` (`MemoryHigh`, `MemoryMax`, `CPUQuota`, `TasksMax`). É o que `vssh.gpu.concedida()` lê |
| `subindo` | o lançador | um marcador datado enquanto o prólogo (o setup por usuário) roda; some antes do `exec`, e um marcador velho não conta |
| `recusado` | o lançador | o motivo de uma subida recusada (uma GPU `necessaria` que o servidor não tem); o supervisor responde `failed` sem relançar enquanto ele existir, e a próxima tentativa o apaga |
| `.installed` | o lançador | o hash do pacote para o qual o `installCommand` já rodou por usuário; muda o hash, roda de novo |
| `.venv/` | o `installCommand` do app, se ele criar um | o venv por usuário; já está no `PATH` |
| `tray.json` | `vssh.avisos.bandeja` do runtime de backend | o ícone da bandeja de um app sem janela; sumiu o arquivo, sumiu o ícone |

Fora desse diretório, o runtime de backend escreve em `~/.vssh-notifications/`: `journal.ndjson`
(as notificações, só acrescenta) e `live/<chave>.json` (uma atividade viva enquanto o arquivo
existir e tiver menos de 60 s). Quem lê os dois é o coletor do portal, enquanto alguém tem o
ambiente aberto.
