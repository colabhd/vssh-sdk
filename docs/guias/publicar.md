# Publicar

Ao terminar este guia o seu app está no repositório de artefatos, com versão, e a administração o
instala num sítio pela Loja de apps, ou numa estação por uma linha de comando. O caminho tem três
passos: validar e empacotar, enviar ao repositório, instalar.

## O repositório

Os pacotes vivem num repositório estilo distro, servido por um Cloudflare Worker, fora do portal.
A leitura é pública (manifesto JSON e download, com `sha256` verificável); a escrita é autenticada
por token. Ele retém as três últimas versões de cada app.

O token de publicação é do Worker, escopado ao seu app (`app:<id>`), e nunca uma credencial do
GitHub. Um admin o gera no painel admin do portal, em Apps, na página do app (ou em "Novo app",
para um app que ainda não foi publicado), e ele é mostrado uma vez. Guarde
como secret `VSSH_REPO_PUBLISH_TOKEN` no repositório do app.

## Empacotar e enviar

O `vssh-app-publish`, em [`scripts/`](../../scripts/vssh-app-publish) deste repositório, faz os
três primeiros movimentos:

1. valida o `vssh-app.json` inteiro contra o schema. Todo objeto fecha com
   `additionalProperties: false`, então um campo digitado errado é recusado aqui, nomeando o
   vizinho quando há um;
2. empacota o que está versionado. Quando a fonte é um repositório git, o pacote sai de
   `git archive`: `node_modules/` e `vendor/` commitados entram no tarball, e o que o `.gitignore`
   ignora fica de fora, sem lista de padrões para manter. Fora de um repositório git, um `tar` que
   exclui só `.git`, `data`, `__pycache__` e `*.pyc`;
3. calcula o `sha256`, faz `POST /v1/publish/app` e manda em seguida o ícone, se houver, e o
   [ladrilho da Loja](icone.md#o-ladrilho-da-loja), montado das camadas de `icone`.

O Worker confere o manifesto contra o mesmo schema uma segunda vez, e guarda de cada versão quem
a publicou (o nome que o admin deu ao token) e quando. Os dois aparecem na ficha do app na loja.

### Notas de versão

O que mudou nesta versão, em markdown, para a ficha do app na loja: `--notes "texto"`,
`--notes-file CHANGELOG-1.2.3.md`, ou a variável `VSSH_RELEASE_NOTES`. É o texto de uma versão,
e não o changelog inteiro; o Worker recusa acima de 16 KiB. Sem notas a versão entra sem elas.

Por CI, o repositório do app chama o reusable workflow deste repositório, sem PAT, porque ele é
público:

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
      repo_api: "https://vssh-repo.colabh.org"
      version: "1.0.${{ github.run_number }}"
      notes: ${{ github.event.head_commit.message }}
    secrets:
      publish_token: ${{ secrets.VSSH_REPO_PUBLISH_TOKEN }}
```

Push em `main` publica. O `notes` é opcional; num workflow disparado por release,
`${{ github.event.release.body }}` é o texto que a pessoa escreveu na página do release. O `version` do workflow reescreve o do manifesto dentro do pacote, e a
instalação é idempotente por versão, então auto-versionar pelo número do run é seguro.

À mão, sem CI:

```bash
export VSSH_REPO_API="https://vssh-repo.colabh.org"
export VSSH_REPO_PUBLISH_TOKEN="vsshp_..."
bash scripts/vssh-app-publish ~/meu-app --version 1.2.3 --notes-file notas-1.2.3.md
```

### A coleção de uma suíte

Um repositório que publica vários apps declara a coleção deles num `colecao.json`, e a coleção
aparece em Descobrir, na Loja, sem ninguém cadastrá-la no portal:

```json
{
  "id": "crafting-apps",
  "nome": "Crafting Apps",
  "quem": "ArtCraft",
  "resumo": "Escrever, calcular e editar PDFs.",
  "apps": ["wordcraft", "sheetcraft", "pdfcraft"]
}
```

O `vssh-app-publish` procura o arquivo na pasta do app e, numa suíte com um app por pasta, na raiz
do repositório. Ele vai junto de cada versão, e o repositório de artefatos guarda a coleção com
ela. Um app entra na coleção que a versão atual dele declara. Com `apps`, o arquivo vale só para
os apps que lista, e os outros publicam sem coleção. O nome, o `quem` e o resumo que a Loja mostra
são os da publicação mais nova entre os apps da coleção. Um app despublicado sai dela sozinho.

O `id` é minúsculo, com algarismos e hífen. O `nome` e o `quem` vão até 80 caracteres, e o
`resumo` até 400. Um arquivo fora dessa forma para a publicação antes do pacote. Uma coleção que a
administração cadastrou no portal com o mesmo `id` vale no lugar desta, e o destaque de Descobrir
é escolha da administração.

## As duas versões: a exibida e a interna

Um app tem duas versões. A exibida é o `version` do manifesto: o texto que a pessoa lê na Loja, que
você escolhe, e que pode se repetir entre duas publicações. A interna é o instante da publicação em
UTC, como o inteiro `AAAAMMDDhhmmss`. O publish a tira do relógio, uma vez por publicação, e o
repositório ordena as publicações por ela. Ela só cresce: um repositório recusa a publicação cuja
interna não é maior que a mais alta que ele guarda do app.

O manifesto que você escreve não declara a interna, e o publish recusa o que declara. Ela vai ao
repositório no header `X-Vssh-Internal-Version` e, quando o schema já tem o campo, no
`internalVersion` do manifesto que viaja no pacote.

Publicar de novo o mesmo `version` deixa de sobrescrever: cada publicação é uma linha no
repositório, com o pacote dela. O repositório guarda as três últimas publicações de um app, e três
publicações seguidas do mesmo `version` ocupam as três vagas.

## Mais de um repositório

Publicar tem duas metades, e o script faz as duas quando o repositório é um só. Com mais de um (o
da Cloudflare e o de cada sítio), elas rodam separadas, para todo repositório receber os mesmos
bytes e a mesma interna:

```bash
bash scripts/vssh-app-publish ~/meu-app --empacotar ./lote --repo-api https://repo.franca.exemplo
bash scripts/vssh-app-publish --enviar ./lote --repo-api https://repo.franca.exemplo --sitio franca
bash scripts/vssh-app-publish --enviar ./lote --repo-api https://repo.sp.exemplo --sitio sp
```

`--empacotar` valida o app, monta o pacote com o ícone, a ajuda e o ladrilho, carimba a interna e
deixa o lote na pasta. Ele lê o repositório, para a regra dos apps oficiais, e dispensa o token.
`--enviar` manda o lote a um repositório, e antes do pacote confere a interna nele:

| O que o repositório tem do app | O que o envio faz |
|---|---|
| nada, ou só internas menores | manda o pacote, e depois a ajuda, o ícone e o ladrilho |
| a interna do lote | não manda o pacote de novo, e manda de novo a ajuda, o ícone e o ladrilho |
| uma interna mais alta | recusa, com a mais alta na mensagem |
| não respondeu | recusa, com o nome do repositório |

Um repositório que falha não desfaz os outros. O envio dele sai com erro e diz o nome que
`--sitio` deu, e rodar `--enviar` de novo com a mesma pasta completa a publicação nele, com a mesma
interna. Quem precisa repetir a interna sem a pasta a passa por `--internal-version`.

No CI, o reusable faz isso sozinho quando a organização do app tem a variável `VSSH_SITIOS`, uma
lista em JSON com o nome, o endereço e o runner de cada repositório:

```json
[{"nome":"franca","api":"http://vssh-repo.franca.exemplo","runner":"colabhd-franca"},
 {"nome":"sp","api":"http://vssh-repo.sp.exemplo","runner":"colabhd-sp"}]
```

O job `publish` empacota uma vez e guarda o lote como artefato do run, e um job `enviar` por
repositório o manda, no runner daquele repositório. Um repositório fora do ar deixa o job dele
vermelho, e reexecutar só os jobs que falharam manda o mesmo lote. O workflow do app não muda, e o
token é o mesmo em todo repositório: quem administra o registra em cada um pelo hash. Com a lista,
o `repo_api` do workflow do app deixa de receber; o repositório que deve continuar recebendo entra
na lista.

## Por que `main`

O `uses:` aponta para `main` porque o schema que o publish valida é gerado a partir do portal
que está no ar: a ponta de `main` responde "o portal de hoje aceita este manifesto?", e uma tag
congelaria um contrato que o portal já deixou para trás. Quem precisar fixar uma revisão passa
`tools_ref`. As libs de backend não entram nessa conta: elas são o runtime que o servidor tem, e
o app não as declara.

## O que o publish recusa

| condição | veredito |
|---|---|
| campo que o schema não conhece, em qualquer objeto | recusa, nomeando o vizinho |
| `secrets[].value` (ou `valor`, `default`) | recusa: o valor seria commitado e distribuído a todo servidor |
| `vssh-app-toolkit` no `package.json`, no `installCommand` ou num `requirements` | avisa, nomeando a versão, e publica: as libs de backend são o runtime `vssh` do servidor, e a troca está no [`MIGRATION.md`](../../MIGRATION.md) |
| `requiredPackages` com nome fora de `^[a-z0-9][a-z0-9+.-]*$` | recusa: o valor chega a um gerenciador de pacotes, e um metacaractere ali seria injeção |
| `cpuQuota: "2"` | recusa: `"2"` é 2%, e `"100%"` é um núcleo |
| um nome em `ponte.exige` ou `ponte.opcional` que o SDK web não tem | recusa, nomeando-o |
| um nome `vssh.<espaço>.<nome>` lido no frontend que o SDK web não tem | avisa, com o arquivo e a linha, e publica |
| `minShellVersion` | avisa que o campo está de saída, e publica |

No GitHub Actions os avisos sobem como anotações (`::warning::`), para o resumo do run e a aba de
anotações do PR, porque um aviso numa linha entre mil de log passou meses despercebido em
repositórios que publicavam com validação mínima achando que validavam.

## A ponte: o que a janela chama

A compatibilidade de um app com o ambiente é a lista dos nomes do SDK web que a janela dele chama:
`vssh.salas.entrar`, `vssh.arquivos.urlFor`. O publish monta essa lista e a carimba no manifesto do
pacote, em `ponte`:

```json
"ponte": {
  "exige": ["app.titulo", "arquivos.urlFor", "salas.entrar"],
  "opcional": ["desempenho.mandarMedida"]
}
```

Ele lê os arquivos de página do pacote (js, ts, html e parentes), fora a pasta do backend,
`node_modules` e os testes, e junta os nomes da forma `vssh.<espaço>.<nome>` que existem em
[`api/superficie.json`](../../api/superficie.json), a lista de tudo que o SDK web oferece. O que
ele acha entra em `exige`.

No manifesto de origem o campo é opcional, e serve a dois casos:

- `ponte.exige` soma à leitura o que ela não acha. Uma janela que chega ao SDK por um acessor
  próprio (`espaco('janela')?.minimizar?.()`) ou que monta o nome em tempo de execução declara ali
  os nomes que usa.
- `ponte.opcional` tira um nome da exigência. A janela confere se ele existe antes de chamar, e
  funciona sem ele.

O publish anota no run quantos nomes leu e quantos o manifesto declarou. Uma janela que termina
com a lista vazia ganha um aviso: ou ela não chama a ponte, ou a chama por um caminho que a leitura
não vê.

O portal confere `exige` antes de instalar, contra o SDK que ele serve, e a recusa nomeia o que
falta. Um pacote publicado sem o carimbo não é conferido.

## Instalar no servidor

Como root:

```bash
sudo vssh-app-install meu-app            # a última versão do repositório
sudo vssh-app-install meu-app@1.2.3      # uma versão específica
sudo vssh-app-install meu-app --force    # reinstala mesmo na mesma versão
```

O script baixa o `app.tar.gz` do Worker, verifica o `sha256`, valida o mínimo do manifesto (o `id`
e a forma do pacote; ele roda offline e não tem como buscar o schema), confere `requiredPackages`
e recusa antes de copiar nada se faltar pacote, nomeando o que falta e a linha de `apt-get` que
resolve. Copia para `/opt/vssh-apps/<id>/`, root-owned e legível por todos, e roda o
`installCommand` uma vez como root, com `VSSH_APP_REBUILD=1` exportado só nessa invocação.

É idempotente por versão: mesma versão instalada, sai sem fazer nada; versão diferente é
atualização. O `--force` reinstala de qualquer forma, e encerra com `SIGTERM` toda instância do
app em execução, de qualquer usuário, conferindo pelo `environ` que o processo é mesmo deste app.
Cada pessoa sobe a versão nova na próxima abertura.

O `minShellVersion` do manifesto está de saída, e [a ponte](#a-ponte-o-que-a-janela-chama) entra
no lugar dele. Enquanto o campo existir, o portal o compara com a versão do shell que serve antes
de instalar, e recusa com o motivo. Os templates deste repositório não o declaram.

No ambiente, a administração instala pela Loja de apps. Numa estação de um sítio, o app entra em
todas as estações dele, e numa estação que entrar no sítio depois. Daí em diante cada estação leva
o app sozinha à publicação mais nova do repositório do sítio: o seguidor da estação
(`vssh-seguir-apps`) confere o índice a cada cinco minutos e instala o que mudou, sem botão de
atualizar. "Voltar à anterior", na Loja da administração, faz o sítio descer à publicação de antes,
e as estações dele descem junto. Cada pessoa põe o app no menu dela com "Instalar", sem baixar
nada.

Não há `.desktop` nem menu XDG: o app aparece por `GET /api/apps` (cache de até 60 s no portal, 30
s no cliente), na `category` que o manifesto declarou, sem reiniciar a sessão de ninguém.

## Uma armadilha do `--force`

`--force` troca os arquivos ao redor; ele não força uma etapa cara e idempotente dentro do
`installCommand` (compilar um binário guardado por `test -x bin/algo ||`) a rodar de novo, porque o
guard olha só se o artefato existe. Se o seu `installCommand` tem uma etapa
assim, cheque `VSSH_APP_REBUILD`, que vale `1` só na invocação como root do `vssh-app-install` e
nunca na invocação por usuário do `vssh-app-run`:

```bash
( [ "${VSSH_APP_REBUILD:-}" != 1 ] && test -x bin/algo ) || build-pesada
```

## Durante o desenvolvimento

Nada obriga a passar pelo repositório para testar. `vssh-app-install /tmp/meu-app --force` instala
um diretório ou um tarball copiado por `scp`, com a mesma cópia para `/opt/vssh-apps/<id>/` e o
mesmo `installCommand`. O que esse caminho pula é o portão de validação inteira do schema, que só
o `vssh-app-publish` roda; o `vssh-app-run` reconfere na subida só o que vira linha de comando.
