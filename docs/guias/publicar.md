# Publicar

Ao terminar este guia o seu app está no repositório de artefatos, com versão, e um admin o instala
ou atualiza em qualquer servidor por `id`, pela aba Repositório do portal ou por uma linha de
comando. O caminho tem três passos: validar e empacotar, enviar ao repositório, instalar no
servidor.

## O repositório

Os pacotes vivem num repositório estilo distro, servido por um Cloudflare Worker, fora do portal.
A leitura é pública (manifesto JSON e download, com `sha256` verificável); a escrita é autenticada
por token. Ele retém as três últimas versões de cada app.

O token de publicação é do Worker, escopado ao seu app (`app:<id>`), e nunca uma credencial do
GitHub. Um admin o gera na aba Repositório, em Tokens, do portal, e ele é mostrado uma vez. Guarde
como secret `VSSH_REPO_PUBLISH_TOKEN` no repositório do app.

## Empacotar e enviar

O `vssh-app-publish`, no toolkit, faz os três primeiros movimentos:

1. valida o `vssh-app.json` inteiro contra o schema. Todo objeto fecha com
   `additionalProperties: false`, então um campo digitado errado é recusado aqui, nomeando o
   vizinho quando há um;
2. empacota o que está versionado. Quando a fonte é um repositório git, o pacote sai de
   `git archive`: `node_modules/` e `vendor/` commitados entram no tarball, e o que o `.gitignore`
   ignora fica de fora, sem lista de padrões para manter. Fora de um repositório git, um `tar` que
   exclui só `.git`, `data`, `__pycache__` e `*.pyc`;
3. calcula o `sha256`, faz `POST /v1/publish/app` e manda o ícone junto, se houver.

Por CI, o repositório do app chama o reusable workflow do toolkit, sem PAT, porque o toolkit é
público:

```yaml
name: Publish
on:
  push: { branches: [main] }
  workflow_dispatch:
jobs:
  publish:
    uses: colabhd/vssh-app-toolkit/.github/workflows/_publish-app-reusable.yml@v4
    with:
      app_dir: "."
      repo_api: "https://vssh-repo.colabh.org"
      version: "1.0.${{ github.run_number }}"
    secrets:
      publish_token: ${{ secrets.VSSH_REPO_PUBLISH_TOKEN }}
```

Push em `main` publica. O `version` do workflow reescreve o do manifesto dentro do pacote, e a
instalação é idempotente por versão, então auto-versionar pelo número do run é seguro.

À mão, sem CI:

```bash
export VSSH_REPO_API="https://vssh-repo.colabh.org"
export VSSH_REPO_PUBLISH_TOKEN="vsshp_..."
bash scripts/vssh-app-publish ~/meu-app --version 1.2.3
```

## A tag, e nunca `main`

Referencie o toolkit por tag, `@v4`, nos dois lugares: o `uses:` do reusable e o `#v4` da
dependência npm. Puxar de `main` faria a validação do seu CI e as suas libs mudarem debaixo de
você a cada commit do toolkit, inclusive num push que você não viu. Bumps compatíveis movem a `v4`;
uma mudança incompatível cria a `v5`.

Não use `@v1`. Ela é do toolkit original, anterior a `lib/`, `schema/` e `docs/`; um repositório
pinado ali publica com validação mínima, avisando numa linha de log que ninguém lê.

## O que o publish recusa

| condição | veredito |
|---|---|
| campo que o schema não conhece, em qualquer objeto | recusa, nomeando o vizinho |
| `secrets[].value` (ou `valor`, `default`) | recusa: o valor seria commitado e distribuído a todo servidor |
| libs do toolkit de outra major que a do script | recusa: outra major carrega mudança incompatível |
| libs de menor ou patch diferentes | avisa, e publica |
| `vendor/vssh/` ainda no pacote | recusa: cópia da era anterior à v4, código morto competindo com as libs instaladas |
| declara a dependência do toolkit, não leva `node_modules` e não tem `installCommand` com npm | recusa: o backend morreria no primeiro `require`, no servidor |
| `requiredPackages` com nome fora de `^[a-z0-9][a-z0-9+.-]*$` | recusa: o valor chega a um gerenciador de pacotes, e um metacaractere ali seria injeção |
| `cpuQuota: "2"` | recusa: `"2"` é 2%, e `"100%"` é um núcleo |

No GitHub Actions os avisos sobem como anotações (`::warning::`), para o resumo do run e a aba de
anotações do PR, porque um aviso numa linha entre mil de log passou meses despercebido em
repositórios que publicavam com validação mínima achando que validavam.

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

O `minShellVersion` do manifesto é conferido pelo portal, que sabe a versão do shell que serve, e
não pelo `vssh-app-install`, que roda offline. Quando a instalação parte da aba Repositório, o
portal lê o campo do catálogo do repositório e recusa antes de mandar o comando ao servidor, com o
motivo; um Worker anterior ao campo não responde, e aí não há recusa ("não conferido" é diferente
de "está tudo bem"). Uma instalação feita à mão no servidor não passa por essa conferência.
O campo só aceita números (`5.0.0`, e nunca `5.0.0-rc0`): o rótulo de pré-lançamento é do shell,
e um shell `5.0.0-rc0` conta como `5.0.0` na conferência, então um app escrito para o SDK 5
declara `5.0.0` e instala no candidato. Os templates deste repositório já declaram isso, porque
o `_sdk/vssh.js` que eles carregam só existe a partir do shell 5.

Pela aba Repositório do portal, o admin vê, por servidor, o que está disponível no repositório e o
que está instalado, sem rodar os scripts, e instala ou atualiza com um botão; o botão de atualizar
só reinstala quando a versão do repositório difere da instalada. Se o servidor não tem o
`vssh-app-install`, a mesma aba o instala sob demanda.

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
