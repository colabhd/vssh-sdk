# vssh-sdk

O SDK do VSSH: o que o autor de um vssh-app usa para escrever, buildar e publicar um app.

O VSSH é um ambiente Linux servido no navegador. Um vssh-app é um pacote com frontend HTML e um
backend próprio, em qualquer linguagem, que roda como processo no servidor Linux da pessoa e
aparece como uma janela dentro do ambiente. O autor desenvolve fora do repositório do sistema,
publica um tarball no repositório de artefatos e um administrador instala com `vssh-app-install`.

Este repositório é público de propósito: o workflow de publicação é chamável do CI de qualquer
repositório de app, de uma organização ou de uma conta pessoal, e o script é baixado com o
`GITHUB_TOKEN` padrão, sem PAT.

## O que mora aqui, e quem escreve cada parte

| Caminho | O que é | Quem escreve |
|---|---|---|
| [`api/`](api/) | O contrato: o schema do manifesto (`vssh-app.schema.json`) e o `build-info.json` com a versão do shell e o hash de cada artefato. A ABI da ponte, os typings e a biblioteca de UI pousam aqui nas próximas etapas. | O sistema. Um job de CI do repositório privado do VSSH gera estes arquivos depois de cada deploy e os commita aqui. Uma edição à mão é sobrescrita na rodada seguinte, e o gerador recusa rodar sobre um arquivo que ele não escreveu. |
| [`runtime/`](runtime/) | As libs de backend (Node e Python), para o emulador e para o editor; em produção elas vêm do servidor. | O sistema, numa etapa seguinte. Hoje o diretório tem só o README, e as libs vêm do `vssh-app-toolkit` (ver abaixo). |
| [`docs/`](docs/) | Os conceitos e os guias de quem escreve um app. | Pessoas. |
| [`templates/hello-vssh-app/`](templates/hello-vssh-app/) | Template Python e galeria de capacidades do ambiente. Copie e adapte. | Pessoas. |
| [`templates/hello-vssh-app-node/`](templates/hello-vssh-app-node/) | O mesmo app, em Node. A escolha entre os dois é de linguagem, e de mais nada: `tests/galeria-paridade.test.js` reprova qualquer deriva entre eles. | Pessoas. |
| [`examples/`](examples/) | Apps de referência completos (`palco`, `print-engine`), feitos para serem instalados. | Pessoas. |
| [`scripts/vssh-app-publish`](scripts/vssh-app-publish) | Valida o manifesto contra `api/vssh-app.schema.json`, empacota e publica no repositório de artefatos. Roda no CI e na sua máquina. | Pessoas. |
| [`.github/workflows/_publish-app-reusable.yml`](.github/workflows/_publish-app-reusable.yml) | O workflow reutilizável que o CI do seu repositório de app chama com um `uses:`. | Pessoas. |
| [`emulador/`](emulador/) | O ambiente de mentira para desenvolver sem servidor. Chega na etapa seguinte. | Pessoas. |
| [`MIGRATION.md`](MIGRATION.md) | O que muda para quem vem do `vssh-app-toolkit`, e o que muda a cada geração das libs. | Pessoas. |

`api/` e `runtime/` são gerados, e a regra vale nos dois sentidos: ninguém os edita, e nada que
esteja neles precisa de revisão humana para entrar. O que uma pessoa quer mudar ali se muda na
fonte, no repositório do sistema; o canal traz.

## Quickstart

1. Crie o repositório do seu app a partir do template:
   ```bash
   cp -r templates/hello-vssh-app ~/meu-app && cd ~/meu-app
   # edite vssh-app.json (id, name, version), backend/, frontend/, icon
   git init && git add -A && git commit -m "init" && gh repo create <owner>/meu-app --public --source . --push
   ```
   O repositório do app pode ser privado ou público; a publicação funciona nos dois casos.

2. Gere um token de publicação escopado ao seu app (`app:<id>`). Ele é um token do Worker do
   repositório de artefatos (o GitHub não emite nem conhece esse token): pela aba admin
   "Repositório, Tokens" no portal, ou com o token mestre do Worker:
   ```bash
   curl -fsS -X POST "$VSSH_REPO_API/v1/tokens" \
     -H "Authorization: Bearer $VSSH_MASTER_TOKEN" -H "Content-Type: application/json" \
     -d '{"scope":"app:meu-app","label":"CI meu-app"}'
   # { "token": "vsshp_..." }   mostrado uma vez; guarde
   ```
   Salve como secret `VSSH_REPO_PUBLISH_TOKEN` no seu repositório (Settings, Secrets and
   variables, Actions).

3. Adicione o workflow de publicação em `.github/workflows/publish.yml`:
   ```yaml
   name: Publish
   on:
     push: { branches: [main] }
     workflow_dispatch:
   jobs:
     publish:
       uses: colabhd/vssh-sdk/.github/workflows/_publish-app-reusable.yml@main
       with:
         app_dir: "."
         repo_api: "https://vssh-repo.colabh.org"       # = seu VSSH_REPO_API
         version: "1.0.${{ github.run_number }}"         # auto-versiona (install é idempotente por versão)
       secrets:
         publish_token: ${{ secrets.VSSH_REPO_PUBLISH_TOKEN }}
   ```
   Um push em `main` publica.

4. Instale no servidor (admin): `sudo vssh-app-install <id> --force`, ou pela aba admin
   "Repositório". O app aparece no menu iniciar da pessoa, na `category` que o manifesto declarou.

O `uses:` aponta para `main` porque o `api/` que o publish valida é gerado a partir do portal que
está no ar: a ponta de `main` responde "o portal de hoje aceita este manifesto?", e uma tag
congelaria um contrato que o portal já deixou para trás. Quem precisar fixar uma revisão passa
`tools_ref`.

## Publicar da sua máquina

```bash
export VSSH_REPO_API="https://vssh-repo.colabh.org"
export VSSH_REPO_PUBLISH_TOKEN="vsshp_..."
bash scripts/vssh-app-publish ~/meu-app --version 1.2.3
```

O script valida o `vssh-app.json`, empacota o que está versionado (`git archive` quando é um
repositório git, então `node_modules/` ou `vendor/` commitados entram e o que o `.gitignore`
exclui fica de fora), confere o sha256 e faz `POST /v1/publish/app`. Ver `--help`.

## As libs de backend, e de onde elas vêm hoje

O backend de um app usa nove peças (endereço, log, SPA, SSE, filesystem privado, bandeja,
notificação, atividade, libs de navegador), iguais em Node e em Python. Elas são instaladas pelo
gerenciador de pacotes do runtime do app, e por enquanto vêm do repositório
[`colabhd/vssh-app-toolkit`](https://github.com/colabhd/vssh-app-toolkit):

```bash
npm i github:colabhd/vssh-app-toolkit#v4                                                # Node
pip install "https://github.com/colabhd/vssh-app-toolkit/archive/refs/tags/v4.tar.gz"  # Python
```

Os templates já vêm com isso ligado, no `installCommand` do manifesto. As libs de navegador (o
shim `vssh.*`, o polyfill da File System Access, a biblioteca de UI) viajam dentro desse pacote e
são servidas pelo backend do app com o `mounts` do SPA. O sistema passa a publicá-las aqui, em
`runtime/` e em `api/`, nas próximas etapas; o [`MIGRATION.md`](MIGRATION.md) diz o que muda
quando isso acontece.

## Verificar

```bash
npm test          # a suíte Node: o validador do publish, o portão de versão, os templates
npm run test:py   # o template Python e os exemplos Python (pede as libs em vendor/py; ver ci.yml)
```

Sem `python3` os testes do validador se pulam; sem as libs instaladas no template, os do backend
Python também. O CI instala as libs pelo `installCommand` de cada manifesto e sobe os dois
templates num socket, como o servidor faz.

## Vindo do `vssh-app-toolkit`

Este repositório absorve o toolkit. Os templates, os exemplos, o script de publicação e o workflow
reutilizável estão aqui com o mesmo comportamento; o schema deixou de ser autorado e passou a ser
gerado em `api/`. O que muda para um app existente está no [`MIGRATION.md`](MIGRATION.md).
