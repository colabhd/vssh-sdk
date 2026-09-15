# O primeiro app em Node

Ao terminar este guia você tem um app Node de pé na sua máquina, instalado num servidor VSSH e
aberto pelo menu do ambiente, com log estruturado, healthcheck e a ponte com o shell carregada. É
o mesmo app do [guia em Python](o-primeiro-app-python.md), com as mesmas peças e as mesmas rotas;
a escolha entre os dois templates é de linguagem, e mais nada. O ponto de partida é
[`templates/hello-vssh-app-node/`](../../templates/hello-vssh-app-node/) deste repositório.

Os nomes de verbo deste guia são os da [referência gerada](../referencia/README.md), a mesma que
o SDK servido pelo sistema expõe.

## 1. O pacote

```
meu-app/
  vssh-app.json
  icon.svg
  package.json            sem dependência: as libs de backend são o runtime do servidor
  frontend/
    index.html
  backend/
    server.js             o entrypoint; escuta no socket unix de $VSSH_APP_SOCKET
```

```bash
git clone https://github.com/colabhd/vssh-sdk
cp -r vssh-sdk/templates/hello-vssh-app-node ~/meu-app && cd ~/meu-app
```

O backend importa `vssh`, o runtime que todo servidor VSSH tem em `/opt/vssh/sdk/node` e que o
lançador põe no `NODE_PATH` do app. Nada disso viaja no pacote, e o `package.json` do template
não declara dependência nenhuma. Uma dependência sua entra ali como em qualquer pacote, e aí o
manifesto ganha um `installCommand` com `npm ci`.

## 2. O manifesto

```json
{
  "id": "meu-app",
  "name": "Meu App",
  "version": "1.0.0",
  "icon": "icon.svg",
  "category": "Utility",
  "backend": {
    "runtime": "node",
    "entrypoint": "backend/server.js",
    "healthcheckPath": "/saude"
  },
  "window": { "title": "Meu App", "width": 900, "height": 640 }
}
```

`healthcheckPath` aponta para o `/saude` que o portão do runtime responde antes de chamar o app.
A sondagem segura o clique de quem abriu o app, e vai com o token.

Um app com dependências próprias tem duas formas de levá-las ao servidor, e a diferença é só
quem faz a cópia: vendorizar (rodar `npm ci` uma vez e commitar `node_modules/`; o publish
empacota o que está versionado, por `git archive`, então a pasta entra no tarball) ou deixar
`node_modules/` no `.gitignore` e reconstruir no alvo por um `installCommand` como
`( [ "${VSSH_APP_REBUILD:-}" != 1 ] && test -d node_modules ) || npm ci --omit=dev`, que roda
uma vez como root no install e uma por usuário no primeiro run.

## 3. O backend

```js
'use strict';
const http = require('node:http');
const path = require('node:path');
const { servidor, web } = require('vssh');

const log = servidor.criarLog();
const spa = web.spa(path.join(__dirname, '..', 'frontend'), { tuff: true, aoAvisar: log });

// Base só para o parsing de URL relativa; este host nunca vai à rede. Num socket unix não existe
// porta, e uma base montada com `${PORT}` estouraria em toda requisição.
const BASE_URL = 'http://vssh-app.invalid';

const server = http.createServer(servidor.portao(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  try {
    if (await spa(req, res, url)) return;
    servidor.responderJson(res, 404, { error: 'Rota desconhecida.' });
  } catch (err) {
    log('request-failed', { path: url.pathname, message: err.message, stack: err.stack });
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('erro interno\n');
  }
}));

servidor.escutar(server)
  .then(({ transporte, endereco }) => log('listening', { transporte, endereco }))
  .catch((err) => {
    if (err.code === servidor.JA_ESCUTANDO) process.exit(0);
    log('listen-failed', { message: err.message, code: err.code });
    servidor.registrar(`não consegui escutar: ${err.message}`);
    process.exit(1);
  });

process.on('uncaughtException', (err) => log('uncaught', { message: err.message, stack: err.stack }));
process.on('unhandledRejection', (err) => log('unhandled-rejection', { message: String(err) }));
```

O que cada peça faz:

- `servidor.escutar(server)` lê `$VSSH_APP_SOCKET`, limpa um socket órfão por tentativa de
  conexão, põe o modo `0600`, anuncia `[<id>] versão <v> escutando em <onde>` no stdout e falha
  alto quando não veio endereço. `servidor.JA_ESCUTANDO` quer dizer que outra instância já atende,
  e sair com `0` é o contrato do ciclo de vida. Um app que binde uma porta em `127.0.0.1` não é
  proxiado por ninguém: healthcheck `000`, janela em branco, e nada no log dizendo por quê;
- `servidor.portao(atender)` fica na frente de toda rota: recusa o pedido sem o
  `X-Vssh-App-Token` do ambiente (403 com `X-Vssh-Token: recusado`, em tempo constante) e
  responde `GET /saude` com `{ok, versao, pid}` antes de chamar o app;
- `servidor.criarLog()` escreve em `$VSSH_APP_DATA_DIR/app.log`. Os dois `process.on` do fim
  existem porque sem eles uma falha assíncrona derruba o processo sem deixar rastro, e o ciclo de
  vida só mostra que o app "não subiu";
- `web.spa(raiz, { tuff: true })` serve o `frontend/` sob o prefixo do proxy e injeta no `<head>`
  do index a tag do SDK web (`_sdk/vssh.js`) e as do Tuff (`_sdk/tuff/…`). Quem responde esses
  caminhos é o sistema, de dentro do espaço de URL do app; o backend não os serve, e um pedido a
  `_sdk/` recebe `false` como qualquer rota que não é da SPA. Cada script do próprio app injetado
  por `scripts: [...]` sai com o hash do conteúdo na URL, para uma reinstalação nunca servir a
  versão velha de nenhum cache do caminho.

No frontend, `fetch('api/ping')` com URL relativa, sem a barra inicial, para funcionar sob
`/proxy/app/<id>/`.

## 4. Rodar na sua máquina

```bash
source vssh-sdk/scripts/ambiente-de-dev.sh          # NODE_PATH e PYTHONPATH apontando para runtime/
VSSH_APP_ID=meu-app VSSH_APP_DATA_DIR=/tmp/meu-app-data node backend/server.js --tcp 127.0.0.1:0
# [meu-app] versão dev escutando em 127.0.0.1:53017

curl -fsS http://127.0.0.1:53017/saude
```

O `--tcp` é da bancada: o servidor usa o socket unix de `VSSH_APP_SOCKET`, e é o que
`servidor.escutar` abre sem a opção. Roda no Windows também. Acrescente `VSSH_APP_TOKEN=segredo`
para exercitar o portão: a sondagem do portal vai com o cabeçalho `X-Vssh-App-Token`, então o
`/saude` é gateado como qualquer outra rota. O
[guia do ambiente de desenvolvimento](ambiente-de-desenvolvimento.md) tem o resto: o SDK web
fora do shell, e o mesmo arranjo no CI.

## 5. Instalar no servidor

```bash
scp -r ~/meu-app servidor:/tmp/meu-app
ssh servidor sudo vssh-app-install /tmp/meu-app --force
```

O app aparece no menu iniciar na `category` declarada, sem reiniciar a sessão. O clique sobe o
backend como você, e a janela abre quando o healthcheck responde. Uma versão nova entra com
`vssh-app-install <pacote> --force` e uma `version` nova no manifesto; o script encerra as
instâncias que estiverem rodando, e cada pessoa sobe a nova na próxima abertura.

## 6. A primeira chamada ao ambiente

```html
<script>
  vssh.app.capacidades().then((caps) => {
    console.log(caps.host, caps.shellVersion, caps.verbos);
  });
</script>
```

`caps.verbos` é a tabela de exportação do shell em que o app caiu. Um app que precisa de um verbo
que não está na lista degrada ali, em vez de descobrir na primeira chamada que a promessa não
resolve. `caps.shellVersion` pode ser `null`, num shell antigo demais para se declarar; trate como
desconhecido.

## 7. Quando algo falha

`~/.vssh-apps/meu-app/run.log` (stdout e stderr, "Ver log do backend" no menu da janela) e
`$VSSH_APP_DATA_DIR/app.log` (o seu log). Os códigos do healthcheck estão no
[ciclo de vida](../conceitos/ciclo-de-vida.md#a-sondagem).

## O que fazer em seguida

O template traz mais do que este guia usa: SSE por `eventos.Difusor`, o filesystem privado por
`dados`, bandeja, notificação e atividade por `avisos`, a GPU concedida por `gpu`, e a galeria,
uma peça por capacidade do ambiente, com a versão do shell ao lado, que é o que explica quase toda
ausência. Ao copiar para um app seu, apague `frontend/galeria.js`, as peças do `index.html` e as
rotas `api/*` que não forem suas.
