# O primeiro app em Node

Ao terminar este guia você tem um app Node de pé na sua máquina, instalado num servidor VSSH e
aberto pelo menu do ambiente, com log estruturado, healthcheck e a ponte com o shell carregada. É
o mesmo app do [guia em Python](o-primeiro-app-python.md), com as mesmas peças e as mesmas rotas;
a escolha entre os dois templates é de linguagem, e mais nada. O ponto de partida é
`templates/hello-vssh-app-node/` do toolkit.

Os nomes de verbo deste guia seguem a [nota sobre os nomes](../README.md#sobre-os-nomes-dos-verbos):
o SDK que os expõe chega com a sub-etapa 5.2, e o shim de hoje fala os nomes antigos.

## 1. O pacote

```
meu-app/
  vssh-app.json
  icon.svg
  package.json            uma dependência: o toolkit
  package-lock.json       é o lock que fixa a versão
  frontend/
    index.html
  backend/
    server.js             o entrypoint; escuta no socket unix de $VSSH_APP_SOCKET
```

```bash
git clone https://github.com/colabhd/vssh-app-toolkit
cp -r vssh-app-toolkit/templates/hello-vssh-app-node ~/meu-app && cd ~/meu-app
npm i github:colabhd/vssh-app-toolkit#v4
```

A dependência vem por tag, e nunca de `main`: puxar de um branch faria a validação do seu CI e as
suas libs mudarem debaixo de você a cada commit do toolkit. É o mesmo `v4` do reusable workflow de
publicação.

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
    "installCommand": "( [ \"${VSSH_APP_REBUILD:-}\" != 1 ] && test -d node_modules ) || npm ci --omit=dev",
    "healthcheckPath": "/healthz"
  },
  "window": { "title": "Meu App", "width": 900, "height": 640 }
}
```

Duas formas de levar as dependências ao servidor, e a diferença é só quem faz a cópia:

- vendorizar: rodar `npm ci` uma vez e commitar `node_modules/`. O publish empacota o que está
  versionado (por `git archive`), então a pasta entra no tarball e o app instala igual em todo
  servidor, sem depender da rede no momento da instalação. O `installCommand` fica como rede de
  segurança;
- deixar `node_modules/` no `.gitignore` e reconstruir no alvo pelo `installCommand`. O `npm ci`
  resolve o toolkit pelo tarball do codeload, sem `git` nem chave SSH no servidor.

O gate de publicação recusa um app que declare a dependência, não leve `node_modules` e não tenha
`installCommand` com npm: o backend morreria no primeiro `require`, no servidor.

## 3. O backend

```js
'use strict';
const http = require('node:http');
const path = require('node:path');
const { createStaticSpa } = require('vssh-app-toolkit/spa');
const { createAppLog } = require('vssh-app-toolkit/log');
const { escutar } = require('vssh-app-toolkit/listen');
const { WEB_DIR, SHIMS } = require('vssh-app-toolkit/web');

const APP_ID = process.env.VSSH_APP_ID || 'meu-app';
const log = createAppLog({ appId: APP_ID });

const spa = createStaticSpa({
  root: path.join(__dirname, '..', 'frontend'),
  mounts: { '/_vssh/': WEB_DIR },
  injectScripts: SHIMS.map((s) => `_vssh/${s}`),
});

// Base só para o parsing de URL relativa; este host nunca vai à rede. Num socket unix não existe
// porta, e uma base montada com `${PORT}` estouraria em toda requisição.
const BASE_URL = 'http://vssh-app.invalid';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  try {
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok\n');
      return;
    }
    if (await spa(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('não encontrado\n');
  } catch (err) {
    log('request-failed', { path: url.pathname, message: err.message, stack: err.stack });
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('erro interno\n');
  }
});

escutar(server)
  .then(({ transporte, endereco }) => log('listening', { transporte, endereco, appId: APP_ID }))
  .catch((err) => {
    if (err.code === 'VSSH_APP_JA_ESCUTANDO') process.exit(0);
    log('listen-failed', { message: err.message, code: err.code });
    console.error(`[${APP_ID}] não consegui escutar:`, err.message);
    process.exit(1);
  });

process.on('uncaughtException', (err) => log('uncaught', { message: err.message, stack: err.stack }));
process.on('unhandledRejection', (err) => log('unhandled-rejection', { message: String(err) }));
```

O que cada peça faz:

- `escutar(server)` lê `$VSSH_APP_SOCKET`, limpa um socket órfão por tentativa de conexão, põe o
  modo `0600` e falha alto quando não veio endereço. `VSSH_APP_JA_ESCUTANDO` quer dizer que outra
  instância já atende, e sair com `0` é o contrato do ciclo de vida. Um app que binde uma porta em
  `127.0.0.1` não é proxiado por ninguém: healthcheck `000`, janela em branco, e nada no log dizendo
  por quê;
- `createAppLog` escreve em `$VSSH_APP_DATA_DIR/app.log`. Os dois `process.on` do fim existem
  porque sem eles uma falha assíncrona derruba o processo sem deixar rastro, e o ciclo de vida só
  mostra que o app "não subiu";
- `createStaticSpa` serve o `frontend/` sob o prefixo do proxy e carrega a ponte em dois passos: o
  `mounts` põe as libs de navegador numa URL, e o `injectScripts` acrescenta a tag. Sem o mount, a
  tag aponta para 404 e `vssh` não existe, sem erro nenhum. A ordem em `SHIMS` importa (o polyfill
  de File System Access depende do `vssh` que o shim publica), e é por isso que ela vem pronta.

No frontend, `fetch('api/ping')` com URL relativa, sem a barra inicial, para funcionar sob
`/proxy/app/<id>/`.

## 4. Rodar na sua máquina

```bash
SOCK=/tmp/meu-app.sock
VSSH_APP_SOCKET=$SOCK VSSH_APP_ID=meu-app VSSH_APP_DATA_DIR=/tmp/meu-app-data \
  node backend/server.js

curl -fsS --unix-socket $SOCK http://app/healthz
```

No Windows isto não roda: o Node não tem socket unix lá (`listen(caminho)` vira named pipe e
responde `EACCES`). Use o WSL ou um container. Para ver a página num navegador,
`socat TCP-LISTEN:8080,fork UNIX-CONNECT:$SOCK` dá uma porta local, na sua máquina.

Acrescente `VSSH_APP_TOKEN=segredo` para exercitar o gate de token, se o seu app o conferir. O
healthcheck do portal vai com o header `X-Vssh-App-Token`, então a rota de healthcheck pode ser
gateada como qualquer outra.

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

O template traz gate de token resistente a timing, SSE, filesystem privado, bandeja e notificação
pelo backend, e a galeria: uma peça por capacidade do ambiente, com a versão do shim ao lado da
versão do shell, que é o que explica quase toda ausência. Ao copiar para um app seu, apague
`frontend/galeria.js`, as peças do `index.html` e as rotas `api/*` que não forem suas.
