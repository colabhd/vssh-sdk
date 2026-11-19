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
no lugar dele. Enquanto o campo existir, o portal o compara com a versão do shell que serve quando
a instalação parte da aba Repositório, e recusa com o motivo. Os templates deste repositório não o
declaram.

Pela aba Repositório do portal, o admin vê, por servidor, o que está disponível no repositório e o
que está instalado, sem rodar os scripts, e instala ou atualiza com um botão; o botão de atualizar
só reinstala quando a versão do repositório difere da instalada. Se o servidor não tem o
`vssh-app-install`, a mesma aba o instala sob demanda.

Não há `.desktop` nem menu XDG: o app aparece por `GET /api/apps` (cache de até 60 s no portal, 30
s no cliente), na `category` que o manifesto declarou, sem reiniciar a sessão de ninguém.

## Instalar só para quem pede

Quem não é admin instala pela Loja, na própria HOME, o app que declara `pessoa` em `instalacao`:

```json
{ "instalacao": ["sistema", "pessoa"] }
```

O app vai para `~/.local/share/vssh-apps/<id>/`, e só essa pessoa o vê. Quem instala é o agente do
sistema, como ela, na sequência do `vssh-app-install` sem os passos de root: baixa o pacote,
confere o `sha256` e os `requiredPackages`, roda o `installCommand` com `VSSH_APP_REBUILD=1` dentro
do pacote e troca a pasta. Um `installCommand` que precisa de root falha ali, e a versão anterior
fica no lugar; por isso o campo é declarado por quem escreve o app, e a Loja só oferece o botão
quando ele está lá. Um app com `motores` nunca se instala assim, porque o motor mora numa pasta de
root. Um app que declara só `["pessoa"]` o `vssh-app-install` recusa em `/opt`.

O app instalado assim sobe pelo mesmo `vssh-app-run`, com o mesmo setup por usuário, e os dados
dele ficam em `VSSH_APP_DATA_DIR`, como os de um app do servidor. Remover pela Loja apaga a pasta
do app e deixa os dados.

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
