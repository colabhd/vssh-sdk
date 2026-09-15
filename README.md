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
| [`api/`](api/) | O contrato: o schema do manifesto (`vssh-app.schema.json`), o SDK web (`vssh.js`, o mesmo arquivo que o sistema serve a cada app em `_sdk/vssh.js`), a tabela da ponte (`abi.json`), os typings (`vssh.d.ts`), a biblioteca de UI (`tuff/`) e o `build-info.json` com a versão do shell e o hash de cada artefato. | O sistema. Um job de CI do repositório privado do VSSH gera estes arquivos depois de cada deploy e os commita aqui. Uma edição à mão é sobrescrita na rodada seguinte, e o gerador recusa rodar sobre um arquivo que ele não escreveu. |
| [`runtime/`](runtime/) | As libs de backend, o pacote `vssh` em Node e em Python, para a máquina de quem escreve e para o CI; em produção elas vêm do servidor, em `/opt/vssh/sdk`. | O sistema, copiando de `infra/sdk/` a cada rodada. |
| [`scripts/ambiente-de-dev.sh`](scripts/ambiente-de-dev.sh), [`.ps1`](scripts/ambiente-de-dev.ps1) | Para `source`: `VSSH_SDK`, `NODE_PATH` e `PYTHONPATH` apontando para o `runtime/` deste checkout. | Pessoas. |
| [`.github/actions/preparar-sdk/`](.github/actions/preparar-sdk/action.yml) | A ação composta que o CI de um app chama antes de `npm test`, para importar `vssh` como no servidor. | Pessoas. |
| [`docs/`](docs/) | Os conceitos, os guias e a aparência (o Tuff, com amostras vivas) de quem escreve um app, e a referência da API, gerada em `docs/referencia/`. Publicado em [colabhd.github.io/vssh-sdk](https://colabhd.github.io/vssh-sdk/). | Pessoas, e o sistema na referência. |
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

## Como incluir o SDK

```html
<script src="_sdk/vssh.js"></script>
```

No `<head>`, antes dos scripts do app, relativo à raiz dele; o sistema responde esse caminho para
cada app, no portal e no cliente de desktop, e nada viaja no pacote. Com o `web.spa` do runtime a
tag entra sozinha (`web.spa(raiz)` no Node, `web.spa(raiz)` no Python), e `tuff: true` acrescenta a
biblioteca de UI, de `_sdk/tuff/`, pelo mesmo caminho. Os nomes (`vssh.app.capacidades()`,
`vssh.avisos.notificar(...)`, `vssh.app.ao('abertura', cb)`) estão na referência gerada em
`docs/referencia/`, e os typings em `api/vssh.d.ts`.

## As libs de backend

O backend de um app importa `vssh`: `const { servidor, web, eventos, dados, avisos, app, gpu } =
require('vssh')` no Node, `from vssh import servidor, web, ...` no Python. É o runtime que todo
servidor VSSH tem em `/opt/vssh/sdk/{node,python}` e que o lançador põe no `NODE_PATH` e no
`PYTHONPATH` do app antes de subi-lo; o app não o instala, não o vendoriza e não o declara. Os
sete módulos: o endereço, o portão de token, o `/saude` e o log (`servidor`); a SPA com o SDK web
e o Tuff injetados (`web`); SSE e difusão (`eventos`); o filesystem privado do app (`dados`);
notificação, atividade e bandeja para um app sem janela (`avisos`); quem sou e onde guardo as
coisas (`app`); e a GPU que o lançador concedeu (`gpu`).

A cópia gerada em [`runtime/`](runtime/) é a mesma coisa, para a máquina de quem escreve e para o
CI: `source scripts/ambiente-de-dev.sh` a põe no caminho dos dois interpretadores, e o
[guia do ambiente de desenvolvimento](docs/guias/ambiente-de-desenvolvimento.md) mostra o resto.
Um app escrito contra o `vssh-app-toolkit` troca as libs pela tabela do
[`MIGRATION.md`](MIGRATION.md).

## Verificar

```bash
npm test          # a suíte Node: o validador do publish, o portão de libs, os templates
npm run test:py   # o template Python e os exemplos Python
```

Sem `python3` os testes do validador se pulam. Os testes que sobem um template leem o runtime
`vssh` do `NODE_PATH` e do `PYTHONPATH` quando há um, e da cópia em `runtime/` quando não há. O CI
faz `source scripts/ambiente-de-dev.sh` e sobe os dois templates num socket, como o servidor faz.
`tests/browser/` abre o template Node num Chrome de verdade com o SDK de `api/vssh.js` na frente
do backend, numa porta de bancada, e se pula sem Chrome ou sem o artefato.

## Vindo do `vssh-app-toolkit`

Este repositório absorve o toolkit. Os templates, os exemplos, o script de publicação e o workflow
reutilizável estão aqui com o mesmo comportamento; o schema deixou de ser autorado e passou a ser
gerado em `api/`. O que muda para um app existente está no [`MIGRATION.md`](MIGRATION.md).
