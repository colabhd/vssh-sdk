# O ambiente de desenvolvimento

Ao terminar este guia você roda e testa o backend de um app na sua máquina, sem servidor VSSH por
perto: o runtime `vssh` no caminho do interpretador, o backend numa porta de bancada, o
healthcheck e o portão de token exercitados com `curl`, e a página aberta num navegador com o SDK
web degradando como ele promete. O mesmo arranjo vale no CI do app, por uma ação composta.

## 1. O runtime no caminho

Num servidor, o backend faz `require('vssh')` ou `import vssh` e encontra o runtime em
`/opt/vssh/sdk/{node,python}`, porque o lançador põe esses caminhos em `NODE_PATH` e `PYTHONPATH`
antes de subir o app ([o ambiente do backend](../referencia/ambiente.md)). Na sua máquina quem faz
isso é um script deste repositório, que aponta as duas variáveis para a cópia gerada em
[`runtime/`](../../runtime/):

```bash
source vssh-sdk/scripts/ambiente-de-dev.sh        # bash ou zsh
. .\vssh-sdk\scripts\ambiente-de-dev.ps1          # PowerShell
```

O script exporta três variáveis: `VSSH_SDK`, a raiz do checkout; `NODE_PATH`, com
`runtime/node` à frente do que já houver; e `PYTHONPATH`, com `runtime/python`. A raiz sai da
localização do próprio script, então dá para fazer o `source` de dentro do repositório do seu
app. Um backend Node escrito em ESM chama `createRequire(import.meta.url)('vssh')`, porque a
resolução de ES modules não consulta `NODE_PATH`.

A cópia de `runtime/` é a do último deploy do sistema, e é a que o servidor tem. Quem trabalha com
um checkout do sistema ao lado pode apontar as variáveis para `infra/sdk/{node,python}` de lá, que
é a fonte.

## 2. O backend numa porta

O endereço de um app é o socket unix de `VSSH_APP_SOCKET`, e é só o que `servidor.escutar` abre
por padrão. Para a bancada ele aceita `--tcp host:porta` na linha de comando, e `:0` pede uma
porta livre:

```bash
cd meu-app
VSSH_APP_ID=meu-app VSSH_APP_DATA_DIR=/tmp/meu-app-data VSSH_APP_TOKEN=segredo \
  node backend/server.js --tcp 127.0.0.1:0
# [meu-app] versão dev escutando em 127.0.0.1:53017
```

O mesmo para `python3 backend/main.py --tcp 127.0.0.1:0`. A linha que sai no stdout é a que uma
bancada lê para descobrir a porta, e é a que aparece no `run.log` de um app que subiu no servidor.
`VSSH_APP_DATA_DIR` é onde o `app.log` e o filesystem privado do app moram; sem a variável, o
runtime usa `~/.vssh-apps/<id>/data`. A versão é `dev` fora de um pacote instalado.

Isto roda no Windows também: o `--tcp` existe porque o Python de lá não tem `AF_UNIX`, e um
socket unix continua sendo o que o servidor usa.

## 3. O token e o `/saude`

`servidor.portao` (Node) e `servidor.Pedido` (Python) ficam na frente de toda rota do app. Eles
recusam o pedido que não traz o `X-Vssh-App-Token` igual ao `VSSH_APP_TOKEN` do processo, e
respondem `GET /saude` com `{ok, versao, pid}` antes de chamar o app. É o que o portal faz a cada
pedido e a cada sondagem, e é o que o `curl` faz aqui:

```bash
curl -s -i http://127.0.0.1:53017/saude
# HTTP/1.1 403 Forbidden
# X-Vssh-Token: recusado

curl -s -H 'X-Vssh-App-Token: segredo' http://127.0.0.1:53017/saude
# {"ok":true,"versao":"dev","pid":4242}
```

O 403 do portão leva `X-Vssh-Token: recusado`, e é esse marcador que o separa de um 403 da sua
aplicação. Sem `VSSH_APP_TOKEN` no ambiente o portão deixa tudo passar, que é o caso de uma
bancada que não quer digitar o cabeçalho; a sondagem do portal vai sempre com o token, então
`healthcheckPath: "/saude"` no manifesto é uma rota gateada como qualquer outra.

## 4. O SDK web sem o shell

A página do app inclui `_sdk/vssh.js`, e quem responde esse caminho no servidor é o sistema, de
dentro do espaço de URL do app. Na sua máquina ninguém o serve: o backend responde 404 e devolve a
vez a quem compõe as rotas, de propósito, porque um `_sdk/` servido pelo app seria uma cópia
vendorizada. Para ver a página com o SDK dentro, sirva `api/vssh.js` e `api/tuff/` deste
repositório na frente do backend, no caminho `_sdk/`. É o arranjo de
`tests/browser/template-fora-do-ambiente.test.js`, um HTTP de vinte linhas que responde `_sdk/`
do disco e encaminha o resto à porta do app.

Com o SDK carregado numa aba solta, `vssh.noAmbiente` é `false` (`window.parent === window`) e
nada lança na carga. Cada verbo degrada de um jeito que a página consegue ler: um diálogo cai no
do navegador (`window.confirm`), um seletor de arquivo responde `null`,
`vssh.app.capacidades()` responde `host: 'none'`, um aviso vai ao console, e um verbo de disco
rejeita com `fora do ambiente VSSH: <verbo>`. Um app que precisa do outro lado (consentimento de
arquivos, bandeja, cofre) mostra isso na tela em vez de seguir como se tivesse recebido resposta;
a peça "Ambiente" da galeria dos templates faz exatamente isso. O que precisa do shell de verdade
só se exercita instalado num servidor.

## 5. No CI do app

A ação composta deste repositório faz o passo 1 num job do GitHub Actions: checkout esparso de
`runtime`, `api` e `scripts` em `_sdk/` no workspace, e `VSSH_SDK`, `NODE_PATH` e `PYTHONPATH`
gravados em `GITHUB_ENV` para os passos seguintes.

```yaml
steps:
  - uses: actions/checkout@v5
  - uses: colabhd/vssh-sdk/.github/actions/preparar-sdk@main
  - run: npm test
```

`with: { ref: <ref> }` fixa outra revisão; o padrão é `main`, porque `runtime/` é gerado a partir
do sistema que está no ar, e a ponta de `main` é a que responde "o servidor de hoje tem este
runtime?". A publicação continua sendo o
[reusable de sempre](publicar.md), num job à parte.

## O que fazer em seguida

Os dois templates trazem tudo isto ligado, e são o ponto de partida de
[um app em Node](o-primeiro-app-node.md) ou [em Python](o-primeiro-app-python.md). O fonte do
runtime é curto e comentado, um arquivo por módulo em `runtime/node/vssh/` e
`runtime/python/vssh/`; para o que cada função aceita, é ele a referência.
