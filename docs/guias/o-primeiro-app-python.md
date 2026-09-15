# O primeiro app em Python

Ao terminar este guia você tem um app Python de pé na sua máquina, instalado num servidor VSSH e
aberto pelo menu do ambiente, com log estruturado, healthcheck e a ponte com o shell carregada. O
ponto de partida é o template [`templates/hello-vssh-app/`](../../templates/hello-vssh-app/)
deste repositório, que já nasce com tudo isso ligado; o guia mostra o que cada peça faz para você
poder tirar o que não for seu.

Os nomes de verbo deste guia são os da [referência gerada](../referencia/README.md), a mesma que
o SDK servido pelo sistema expõe.

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
git clone https://github.com/colabhd/vssh-sdk
cp -r vssh-sdk/templates/hello-vssh-app ~/meu-app && cd ~/meu-app
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
  "backend": {
    "runtime": "python3",
    "entrypoint": "backend/main.py",
    "healthcheckPath": "/saude"
  },
  "window": { "title": "Meu App", "width": 900, "height": 640 }
}
```

Duas decisões estão nesse bloco:

- não há `installCommand`. O backend importa `vssh`, o runtime que todo servidor VSSH tem em
  `/opt/vssh/sdk/python` e que o lançador põe no `PYTHONPATH` do app; o resto é biblioteca
  padrão. Um app com dependências próprias declara `python3-pip` em `requiredPackages` e um
  `installCommand` como `( [ "${VSSH_APP_REBUILD:-}" != 1 ] && test -d vendor/py ) || python3 -m
  pip install --target vendor/py -r requirements.txt`, idempotente porque roda uma vez como root
  no install e uma por usuário no primeiro run;
- `healthcheckPath` aponta para o `/saude` que o portão do runtime responde antes de chamar o
  app. A sondagem segura o clique de quem abriu o app, e vai com o token.

## 3. O backend

O runtime resolve as quatro coisas que todo app erra na primeira vez: onde escutar, quem atender,
onde logar, e como servir o frontend sob o prefixo do proxy com a ponte carregada. O esqueleto:

```python
import os
import sys

from vssh import servidor, web

_AQUI = os.path.dirname(os.path.abspath(__file__))

log = servidor.criar_log()
spa = web.spa(os.path.join(_AQUI, "..", "frontend"), tuff=True, ao_avisar=log)


class Pedido(servidor.Pedido):
    def atender(self, metodo):
        # O portão de token e o `GET /saude` já passaram quando isto é chamado.
        if spa(self):
            return
        self.responder_json(404, {"error": "Rota desconhecida."})


if __name__ == "__main__":
    sys.exit(servidor.escutar(Pedido, sys.argv[1:]))
```

O que cada peça faz:

- `servidor.escutar(Pedido, argv)` lê `$VSSH_APP_SOCKET`, limpa um socket órfão por tentativa de
  conexão (um arquivo que existe pode ser de um processo morto), põe o modo `0600`, anuncia
  `[<id>] versão <v> escutando em <onde>` no stdout e atende até o processo acabar. O código de
  saída é dele: `0` no fim normal e também quando outra instância já atende, que o ciclo de vida
  lê como "está de pé"; `2` quando não há onde escutar;
- `servidor.Pedido` é o handler base: HTTP/1.1 com keep-alive, log calado por pedido, o portão
  que recusa o pedido sem o `X-Vssh-App-Token` do ambiente (403 com `X-Vssh-Token: recusado`, em
  tempo constante) e o `GET /saude` com `{ok, versao, pid}`. O app herda e implementa
  `atender(metodo)`;
- `servidor.criar_log()` escreve em `$VSSH_APP_DATA_DIR/app.log`, uma linha por evento. Comece
  por ele: numa depuração remota, é a linha com operação e caminho que responde, e o frame
  minificado do console só sustenta hipótese;
- `web.spa(raiz, tuff=True)` serve o `frontend/` sob o prefixo do proxy e injeta no `<head>` do
  index a tag do SDK web (`_sdk/vssh.js`) e as do Tuff (`_sdk/tuff/…`). Quem responde esses
  caminhos é o sistema, de dentro do espaço de URL do app; o backend não os serve, e um pedido a
  `_sdk/` recebe `False` como qualquer rota que não é da SPA. Cada script do próprio app injetado
  por `scripts=[...]` sai com o hash do conteúdo na URL, para uma reinstalação nunca servir a
  versão velha de nenhum cache do caminho.

O frontend usa `fetch()` com URL relativa (`fetch('api/ping')`, sem a barra inicial), para
funcionar sob `/proxy/app/<id>/` sem alteração. Só recorra a `VSSH_APP_BASE_PATH` se o backend
emitir URLs absolutas, e lembre que ela não inclui o `serverId`.

## 4. Rodar na sua máquina

O backend precisa do runtime no `PYTHONPATH` e de uma porta de bancada, e nada no mecanismo
exige um servidor VSSH:

```bash
source vssh-sdk/scripts/ambiente-de-dev.sh          # NODE_PATH e PYTHONPATH apontando para runtime/
VSSH_APP_ID=meu-app VSSH_APP_DATA_DIR=/tmp/meu-app-data python3 backend/main.py --tcp 127.0.0.1:0
# [meu-app] versão dev escutando em 127.0.0.1:53017

curl -fsS http://127.0.0.1:53017/saude
```

O `--tcp` é da bancada: o servidor usa o socket unix de `VSSH_APP_SOCKET`, e é o que
`servidor.escutar` abre sem a opção. Roda no Windows também, onde o Python não tem `AF_UNIX`.
Acrescente `VSSH_APP_TOKEN=segredo` para exercitar o portão.

Fora do ambiente o SDK web degrada em vez de lançar: um diálogo vira `window.confirm`, um
seletor devolve `None`. Você desenvolve o resto sem `if`. O que precisa do shell do outro lado
(consentimento de arquivos, bandeja, cofre) só se exercita instalado. O
[guia do ambiente de desenvolvimento](ambiente-de-desenvolvimento.md) tem o resto: como servir o
SDK web na frente do backend, e o mesmo arranjo no CI.

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

No `frontend/index.html`, com o SDK carregado, a primeira pergunta de um app é onde ele está:

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

O template traz mais do que este guia usa: SSE por `eventos.Difusor`, o filesystem privado por
`dados`, bandeja, notificação e atividade por `avisos`, a GPU concedida por `gpu`, e a galeria,
uma peça por capacidade do ambiente. Ao copiá-lo para um app seu, apague `frontend/galeria.js`,
as peças do `index.html` e as rotas `api/*` que não forem suas; o que sobra é o mínimo deste
guia.
