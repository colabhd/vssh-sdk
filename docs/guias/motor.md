# Um motor fora do pacote

Ao terminar este guia você sabe entregar ao servidor o que o seu app usa e não cabe no pacote: o
servidor web de um editor, um ambiente Python com PyTorch, os pesos de um modelo. O servidor baixa
cada motor uma vez, na instalação do app, e o backend o encontra numa variável de ambiente.

O campo e as garantias do servidor chegam com o portal que os traz. Num servidor anterior, o
instalador não conhece `motores` e o app sobe sem a variável.

## O motor no manifesto

```json
"motores": [
  {
    "nome": "runtime",
    "versao": "2026.09.24-1",
    "url": "https://vssh-repo.colabh.org/v1/motor/escriba-runtime/2026.09.24-1",
    "sha256": "9f1c…",
    "tamanho": 4812334421,
    "confere": "bin/python"
  }
]
```

`nome` é minúsculo e dá nome à variável: `runtime` vira `VSSH_MOTOR_RUNTIME`, e um `-` vira `_`.
`confere` é opcional, e é um caminho que o tarball extraído precisa trazer; sem ele, o servidor
recusa o motor, porque a URL passou a servir outra coisa. O tarball tem um diretório na raiz, que
a extração descarta.

Ninguém escreve essas linhas à mão. Quem as escreve é a publicação, abaixo, com a versão, a URL, o
sha256 e o tamanho do que acabou de subir.

## O que o servidor faz

Na instalação do app, como root, o motor vai para `/var/lib/vssh-motores/<app>/<nome>/<versão>`,
fora do diretório do app:

- a versão que já está lá não é baixada de novo, então reinstalar o app é barato;
- o espaço livre, o tamanho e o sha256 são conferidos antes de extrair;
- um download interrompido nunca parece instalado;
- as versões e os motores que o manifesto deixou de declarar saem depois que o app novo entrou.

O `installCommand` de root já recebe `VSSH_MOTOR_<NOME>`. A cada subida, o lançador exporta a
mesma variável para o backend. Um motor que não está no disco recusa a subida, e o run.log diz o
que pedir ao administrador.

```python
import os
python_do_motor = os.path.join(os.environ['VSSH_MOTOR_RUNTIME'], 'bin', 'python')
```

## Publicar um motor

A ação `publicar-motor` deste repositório roda no job do CI que constrói o tarball. Ela sobe o
arquivo direto ao R2, pela API S3, registra o motor no vssh-repo e commita o manifesto com o pino
novo:

```yaml
permissions:
  contents: write
steps:
  - uses: actions/checkout@v5
  - run: bash scripts/construir-motor.sh
  - uses: colabhd/vssh-sdk/.github/actions/publicar-motor@main
    with:
      nome: runtime
      versao: 2026.09.24-1
      arquivo: runtime.tar.gz
      confere: bin/python
      repo_api: https://vssh-repo.colabh.org
      r2_account_id: ${{ vars.R2_ACCOUNT_ID }}
      r2_access_key_id: ${{ secrets.R2_ACCESS_KEY_ID }}
      r2_secret_access_key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      motor_token: ${{ secrets.VSSH_REPO_MOTOR_TOKEN }}
```

No vssh-repo, o motor se chama `<id do app>-<nome>` (`escriba-runtime`), porque os motores de
todos os apps dividem um espaço de nomes lá. O token de publicação tem o escopo
`motor:<esse nome>`. `nome_no_repo` troca o nome, para um motor que já existia com outro.

Na máquina de quem desenvolve, o mesmo passo é o script:

```bash
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… VSSH_REPO_MOTOR_TOKEN=… \
  scripts/vssh-motor-publish . --nome runtime --versao 2026.09.24-1 --arquivo runtime.tar.gz \
    --confere bin/python --repo-api https://vssh-repo.colabh.org
```

Depois de publicar o motor, publique o app: é o pacote novo, com o manifesto novo, que faz o
servidor baixar a versão nova.

## Um motor construído em cada sítio

Um motor de gigabytes que cada sítio constrói na rede dele não atravessa o enlace de internet do
sítio. O runner do sítio constrói o tarball, sobe o blob ao S3 do sítio e registra o motor no
repositório do sítio, pelo endereço de dentro, sem tocar no manifesto:

```yaml
  - uses: colabhd/vssh-sdk/.github/actions/publicar-motor@main
    with:
      nome: runtime
      versao: 2026.09.24-1
      arquivo: runtime.tar.gz
      repo_api: http://vssh-repo.vssh-repo.svc.cluster.local
      s3_endpoint: http://seaweedfs-sp-s3.seaweedfs.svc.cluster.local:8333
      motor_token: ${{ secrets.VSSH_REPO_MOTOR_TOKEN }}
      pino: 'false'
```

A chave do S3 do sítio vem do runner de motor, que a traz no ambiente
(`VSSH_SITIO_S3_ACCESS_KEY_ID` e `VSSH_SITIO_S3_SECRET_ACCESS_KEY`), e o repositório do app não
guarda chave de sítio nenhuma. `s3_access_key_id` e `s3_secret_access_key` passam outra.

Duas construções saem com bytes diferentes, e cada repositório guarda o sha256 da sua. A estação
de um sítio baixa o motor do repositório do sítio e o confere pelo registro de lá; a estação sem
repositório de sítio baixa da URL do manifesto e o confere pelo pino. O pino é o do motor
publicado na Cloudflare, e por isso o job que publica lá vem depois dos sítios: um repositório de
sítio que ainda não tem a versão a copia da Cloudflare no acompanhamento, e a cópia gasta o enlace
que a construção no sítio existe para poupar. A versão que o sítio já tem fica, mesmo com outros
bytes na Cloudflare.

O runner de um sítio não tem `sudo` nem docker, e sem o `aws` no PATH o script o roda do PyPI
pelo `uvx`.
