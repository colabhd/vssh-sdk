# O primeiro app em Python

Ao terminar este guia você tem um app Python de pé na sua máquina, instalado num servidor VSSH e
aberto pelo menu do ambiente, com log estruturado, healthcheck e a ponte com o shell carregada. O
ponto de partida é o template `templates/hello-vssh-app/` do toolkit, que já nasce com tudo isso
ligado; o guia mostra o que cada peça faz para você poder tirar o que não for seu.

Os nomes de verbo deste guia seguem a [nota sobre os nomes](../README.md#sobre-os-nomes-dos-verbos):
o SDK que os expõe chega com a sub-etapa 5.2, e o shim de hoje fala os nomes antigos.

## 1. O pacote

```
meu-app/
  vssh-app.json
  icon.svg
  frontend/
    index.html          o backend serve isto em GET /
  backend/
    main.py             o entrypoint; escuta no socket unix de $VSSH_APP_SOCKET
```

Copie o template e troque a identidade:

```bash
git clone https://github.com/colabhd/vssh-app-toolkit
cp -r vssh-app-toolkit/templates/hello-vssh-app ~/meu-app && cd ~/meu-app
```

O `id` é imutável: vira caminho, endereço e sentinel do menu, e trocá-lo é publicar outro app.
Escolha-o antes do primeiro `vssh-app-install`.

## 2. O manifesto

O mínimo que um app Python declara:

```json
{
  "id": "meu-app",
  "name": "Meu App",
  "version": "1.0.0",
  "icon": "icon.svg",
  "category": "Utility",
  "requiredPackages": ["python3-pip"],
  "backend": {
    "runtime": "python3",
    "entrypoint": "backend/main.py",
    "installCommand": "( [ \"${VSSH_APP_REBUILD:-}\" != 1 ] && test -d vendor/py ) || python3 -m pip install --no-cache-dir --target vendor/py \"https://github.com/colabhd/vssh-app-toolkit/archive/refs/tags/v4.tar.gz\"",
    "healthcheckPath": "/healthz"
  },
  "window": { "title": "Meu App", "width": 900, "height": 640 }
}
```

Três decisões estão nesse bloco:

- `python3-pip` em `requiredPackages`. Sem ele, um servidor sem pip só se descobre quando a
  primeira pessoa abre o app: a segunda execução do `installCommand` falha, e o app não sobe para
  aquela pessoa;
- o `installCommand` instala o toolkit em `vendor/py`, dentro do próprio pacote, o equivalente do
  `node_modules`. O guard `test -d vendor/py` o torna idempotente, e `VSSH_APP_REBUILD` é a
  variável que o `vssh-app-install` exporta só na invocação como root, para uma reinstalação com
  `--force` refazer a etapa;
- `healthcheckPath` aponta para uma rota que responde sem depender de nada estar pronto. A
  sondagem segura o clique de quem abriu o app.

## 3. O backend

O toolkit resolve as quatro coisas que todo app erra na primeira vez: onde escutar, onde logar,
como servir o frontend sob o prefixo do proxy, e como carregar a ponte. O esqueleto:

```python
import os, sys
from http.server import BaseHTTPRequestHandler

_AQUI = os.path.dirname(os.path.abspath(__file__))
_VENDOR = os.path.join(_AQUI, "..", "vendor", "py")
if os.path.isdir(_VENDOR):
    sys.path.insert(0, os.path.abspath(_VENDOR))

from vssh_app_toolkit.listen import ErroDeEndereco, VSSH_APP_JA_ESCUTANDO, criar_servidor
from vssh_app_toolkit.log import criar_log_do_app
from vssh_app_toolkit.spa import criar_spa_estatica
from vssh_app_toolkit.web import DIRETORIO_WEB, SHIMS

APP_ID = os.environ.get("VSSH_APP_ID") or "meu-app"
log = criar_log_do_app(app_id=APP_ID)

spa = criar_spa_estatica(
    root=os.path.join(_AQUI, "..", "frontend"),
    mounts={"/_vssh/": DIRETORIO_WEB},
    inject_scripts=[f"_vssh/{s}" for s in SHIMS],
)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            corpo = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        if spa(self):
            return
        self.send_response(404)
        self.end_headers()

def main():
    try:
        servidor = criar_servidor(Handler)
    except ErroDeEndereco as err:
        if err.codigo == VSSH_APP_JA_ESCUTANDO:
            raise SystemExit(0)
        log("listen-failed", {"message": str(err)})
        raise SystemExit(1)
    log("listening", {**servidor.endereco_vssh, "appId": APP_ID})
    servidor.serve_forever()

if __name__ == "__main__":
    main()
```

O que cada peça faz:

- `criar_servidor` lê `$VSSH_APP_SOCKET`, limpa um socket órfão por tentativa de conexão (um
  arquivo que existe pode ser de um processo morto), põe o modo `0600` e falha alto quando não
  veio endereço nenhum. `VSSH_APP_JA_ESCUTANDO` quer dizer que outra instância já atende, e sair
  em silêncio é o contrato do ciclo de vida;
- `criar_log_do_app` escreve em `$VSSH_APP_DATA_DIR/app.log`, uma linha por evento. Comece por
  ele: numa depuração remota, é a linha com operação e caminho que responde, e o frame minificado
  do console só sustenta hipótese;
- `criar_spa_estatica` serve o `frontend/` sob o prefixo do proxy, e a ponte com o shell em dois
  passos. O `mounts` põe o diretório das libs de navegador numa URL (`/_vssh/`), e o
  `inject_scripts` acrescenta a tag `<script>` antes do `</head>`. Esquecer o primeiro é o erro
  clássico: a página carrega normalmente, a tag aponta para 404, e o objeto `vssh` não existe,
  sem erro nenhum ligando uma coisa à outra. Cada script injetado sai com o hash do conteúdo na
  URL, para uma reinstalação nunca servir a versão velha de nenhum cache do caminho.

O frontend usa `fetch()` com URL relativa (`fetch('api/ping')`, sem a barra inicial), para
funcionar sob `/proxy/app/<id>/` sem alteração. Só recorra a `VSSH_APP_BASE_PATH` se o backend
emitir URLs absolutas, e lembre que ela não inclui o `serverId`.

## 4. Rodar na sua máquina

O backend precisa de três variáveis, e nada no mecanismo exige um servidor VSSH:

```bash
SOCK=/tmp/meu-app.sock
VSSH_APP_SOCKET=$SOCK VSSH_APP_ID=meu-app VSSH_APP_DATA_DIR=/tmp/meu-app-data \
  python3 backend/main.py

curl -fsS --unix-socket $SOCK http://app/healthz
```

Um socket não tem URL. Para ver a página num navegador, `socat TCP-LISTEN:8080,fork
UNIX-CONNECT:$SOCK` dá uma porta local, na sua máquina, que é onde uma porta não é problema. No
Windows isso não roda, porque o Python não abre socket unix lá; use o WSL ou um container.

Fora do ambiente o shim degrada em vez de lançar: um diálogo vira `window.confirm`, um seletor
devolve `null`. Você desenvolve o resto sem `if`. O que precisa do shell do outro lado
(consentimento de arquivos, bandeja, cofre) só se exercita instalado.

## 5. Instalar no servidor

Como root, no servidor de teste:

```bash
scp -r ~/meu-app servidor:/tmp/meu-app
ssh servidor sudo vssh-app-install /tmp/meu-app --force
```

O script valida o `id`, copia o pacote para `/opt/vssh-apps/meu-app/` (somente leitura para o
app), roda o `installCommand` uma vez como root e recusa sobrescrever um `id` já instalado sem
`--force`. Não gera `.desktop` nenhum: o app aparece por `GET /api/apps`, na `category` que o
manifesto declarou, sem reiniciar a sessão de ninguém (o cache do cliente tem TTL de 30 s).

Abra o ambiente, procure o app no menu iniciar e clique. O clique vira `POST /api/apps/:id/start`,
o `vssh-app-run` sobe o backend como você (a segunda execução do `installCommand`, agora por
usuário, acontece aqui) e a janela abre quando o healthcheck responde.

## 6. A primeira chamada ao ambiente

No `frontend/index.html`, com o shim carregado, a primeira pergunta de um app é onde ele está:

```html
<script>
  vssh.app.capacidades().then((caps) => {
    console.log(caps.host, caps.shellVersion, caps.verbos);
  });
</script>
```

A resposta traz o nome do host, o que ele sabe fazer, a versão do shell (ou `null`, num shell que
não se declara) e a lista de verbos e eventos da ponte. Carimbe o par `shellVersion` e a versão
das libs no log: versão dessincronizada entre app e shell é a regra, e sem o par um relato de
"não funciona" não diz qual combinação estava em jogo.

## 7. Quando algo falha

Você tem dois logs, e eles se complementam:

- `~/.vssh-apps/meu-app/run.log`, o stdout e o stderr do backend, legível sem SSH: clique direito
  no cabeçalho da janela, "Ver log do backend". A execução anterior fica em `run.log.1`;
- `$VSSH_APP_DATA_DIR/app.log`, o seu log estruturado.

Se a janela abriu em branco, o shell diz que o backend não respondeu ao healthcheck. Os códigos e
o que cada um quer dizer estão no [ciclo de vida](../conceitos/ciclo-de-vida.md#a-sondagem). O
caso mais comum num app novo é `000`: o processo morreu antes do `listen()`, e a causa está no
`run.log`.

## O que fazer em seguida

O template traz mais do que este guia usa: gate do `X-Vssh-App-Token` com comparação resistente a
timing, SSE com os headers que sobrevivem ao proxy, filesystem privado do app, bandeja e
notificação pelo backend, e a galeria, uma peça por capacidade do ambiente. Ao copiá-lo para um
app seu, apague `frontend/galeria.js`, as peças do `index.html` e as rotas `api/*` que não forem
suas; o que sobra é o mínimo deste guia.
