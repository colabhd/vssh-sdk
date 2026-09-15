# Migração

Nada aqui atinge um app publicado por conta própria: um app só muda quando alguém sobe uma
dependência ou troca uma linha do CI dele, e as duas coisas são deliberadas. Esta página diz o
que muda em cada caso, e o que vai mudar nas etapas seguintes, para que ninguém seja pego por um
diff que não escreveu.

## Vindo do `vssh-app-toolkit`

Este repositório absorve o toolkit. O que um app usa dele continua existindo, e na maior parte no
mesmo lugar; a diferença é de onde cada parte vem.

### O CI do seu app: uma linha

O workflow reutilizável mora aqui agora. No `.github/workflows/publish.yml` do seu app:

```diff
-      uses: colabhd/vssh-app-toolkit/.github/workflows/_publish-app-reusable.yml@v4
+      uses: colabhd/vssh-sdk/.github/workflows/_publish-app-reusable.yml@main
```

Os `with:` e o `secrets.publish_token` são os mesmos. O `@main` é deliberado: o schema que o
publish valida é gerado a partir do portal que está no ar, então a ponta de `main` é a única
revisão que responde "o portal de hoje aceita este manifesto?". Uma tag congelaria um contrato
que o portal já deixou para trás. Quem precisar fixar uma revisão passa `tools_ref`.

O reusable do toolkit continua funcionando enquanto o repositório dele existir, mas valida
contra o schema autorado de lá, que deixa de acompanhar o portal. Troque a linha na próxima vez
que abrir o arquivo.

### As libs de backend: o runtime do servidor

As libs de backend deixaram de ser uma dependência do app. Todo servidor VSSH tem o runtime
`vssh` instalado em `/opt/vssh/sdk/{node,python}`, e o lançador o põe em `NODE_PATH` e
`PYTHONPATH` antes de subir o app: o backend faz `require('vssh')` ou `from vssh import ...` e
nada viaja no pacote. A cópia gerada em [`runtime/`](runtime/) é a mesma coisa, para a máquina de
quem escreve e para o CI ([o ambiente de desenvolvimento](docs/guias/ambiente-de-desenvolvimento.md)).

O que sai do seu app: a dependência `vssh-app-toolkit` do `package.json` (e o lock que a fixava),
o `vendor/py` com o `pip install` do tarball, e o `installCommand` que os instalava, se não
sobrar dependência sua. O que entra: `version: "5.0.0"` e `minShellVersion: "5.0.0"` no
manifesto, e `healthcheckPath: "/saude"` se o backend adotar o portão do runtime. Num backend
Node escrito em ESM, `import 'vssh'` não consulta `NODE_PATH`; o caminho é
`createRequire(import.meta.url)('vssh')`.

O pacote é um barril preguiçoso, `const { servidor, web, eventos, dados, avisos, app, gpu } =
require('vssh')`, e a correspondência com o toolkit é esta (os nomes em Python seguem a mesma
tabela, em `snake_case`):

| toolkit (`vssh-app-toolkit/<sub>`) | runtime (`vssh.<espaco>.<fn>`) | o que muda |
|---|---|---|
| `listen.escutar(server, {env?, modo?})`, que resolve `{transporte, endereco}` | `servidor.escutar(server, {argv?, env?, modo?, nome?})` | lê `--tcp host:porta` do `argv` para bancadas; imprime `[<nome>] versão <v> escutando em <onde>`; os erros têm `code` `JA_ESCUTANDO`, `SEM_ENDERECO`, `SERVIDOR_ANTIGO` (constantes exportadas; antes `VSSH_APP_JA_ESCUTANDO` etc.). Em Python, `servidor.escutar(Pedido, argv)` atende até o fim e devolve o código de saída |
| `listen.enderecoDoAmbiente(env)`, que devolve `{transporte, caminho}` | `servidor.enderecoDoAmbiente(env)`, que devolve o caminho do socket | |
| `listen.limparSocketOrfao(caminho)` | `servidor.limparSocketOrfao(caminho)` | igual: `'vivo'`, `'removido'` ou `'inexistente'` |
| o portão de token escrito à mão, mais `/healthz` | `servidor.portao(atender, {saude?, cabecalhos?, recusa?, env?})`; em Python, herdar de `servidor.Pedido` e implementar `atender(metodo)` | lê `VSSH_APP_TOKEN`; 403 com `X-Vssh-Token: recusado`; responde `GET /saude` com `{ok, versao, pid, ...saude()}`; o manifesto declara `healthcheckPath: "/saude"` |
| `log.createAppLog({appId, dataDir, file, stdout})`, com `log.path` | `servidor.criarLog({arquivo?, stdout?, env?})`, com `log.caminho` | a pasta é `VSSH_APP_DATA_DIR` (ou `~/.vssh-apps/<id>/data`); o mesmo NDJSON |
| `spa.createStaticSpa({root, indexFile, injectScripts, injectStyles, aliasPrefixes, mounts, spaFallback, missingBundleHint, onWarn})` | `web.spa(raiz, {indice, scripts, folhas, apelidos, montagens, rotasProfundas, dica, aoAvisar, sdk, tuff})` | renomes 1:1; injeta `_sdk/vssh.js` por padrão (`sdk: false` desliga); `tuff: true` injeta `web.TUFF`, e uma lista como `[...web.TUFF, web.TUFF_BASE, web.TUFF_ICONES]` escolhe os arquivos; `raiz` relativa resolve contra a pasta do `vssh-app.json`; `aoAvisar(evento, detalhe)` recebe `index-ausente` e `carimbo-falhou`; um pedido a `/_sdk/` devolve `false` |
| `spa.contentTypeFor` | `web.tipoDeConteudo` | |
| `web.WEB_DIR`, `SHIMS`, `mounts: {'/_vssh/': WEB_DIR}` | nada | o sistema serve o SDK; o `fsa-polyfill.js` está dentro de `_sdk/vssh.js` |
| `sse.openSseStream(res, {retryMs, keepAliveMs})`, com `{send, comment, close, closed}` | `eventos.abrir(res, {reconexaoMs, keepaliveMs})`, com `{enviar, comentar, fechar, aoFechar, fechado}`; `new eventos.Difusor()` com `assinar`, `atender`, `publicar`, `fechar` | o mesmo fio |
| `notify(body, {title, level, key, actions, persistent, path})` | `avisos.notificar(corpo, {titulo, nivel, chave, acoes, persistente, rota})` | o mesmo journal |
| `live.setLive`, `clearLive`, `keepLiveAlive`, `clearLiveOnExit` | `avisos.atividade`, `limparAtividade`, `manterAtividadesVivas`, `limparAtividadesAoSair` | |
| `tray.setTray`, `clearTray`, `clearTrayOnExit` | `avisos.bandeja`, `limparBandeja`, `limparBandejaAoSair` | |
| `fs.createAppFs({root, ...})`, `createFsHandler({fs, mountPath, requireToken})` | `dados.abrir(raiz?, {...})`, `dados.rotas(dados, {prefixo, arquivos})` | o mesmo contrato de wire; o token fica no portão do `servidor`, e não nas rotas |
| ler `VSSH_APP_ID` e `VSSH_APP_DATA_DIR` do ambiente | `app.ident()`, `app.dados()`, `app.raiz()`, `app.manifesto()`, `app.versao()` | |
| varrer `/sys/class/drm` por conta própria | `gpu.concedida()` | o que o lançador decidiu, com os dispositivos que este processo abre e o motivo de uma negativa |

A referência de cada função é o próprio fonte, curto e comentado: um arquivo por módulo em
`runtime/node/vssh/` e `runtime/python/vssh/`.

O portão do `vssh-app-publish` passa a avisar, numa anotação do run, quando o `package.json` ou o
`installCommand` de um app ainda cita o `vssh-app-toolkit`, nomeando a versão e dizendo que o
runtime do servidor a substitui. Sem a citação não há o que conferir, e ele não diz nada.

### O schema: gerado, e em outro caminho

`schema/vssh-app.schema.json` do toolkit virou [`api/vssh-app.schema.json`](api/vssh-app.schema.json),
escrito pelo sistema depois de cada deploy. Se o seu app validava o manifesto por conta própria
apontando para o caminho antigo, troque para o novo; se só usava o `vssh-app-publish`, não há o
que fazer. Um campo novo no manifesto aparece aqui quando o portal passa a lê-lo, e o
[`build-info.json`](api/build-info.json) ao lado diz de qual versão do shell o contrato veio.

### A referência

A referência de API (`docs/api.md` do toolkit) deixou de ser autorada. O sistema a gera a partir
da tabela de exportação da ponte, verbo a verbo, em `docs/referencia/`, e os conceitos e guias
escritos à mão moram em [`docs/`](docs/). A referência de autoria (`SKILL.md`) segue o mesmo
caminho. Onde uma página do toolkit e a referência gerada divergirem, vale a gerada.

## O SDK web servido pelo sistema

O `vssh` que um app usa no navegador deixou de viajar no pacote do app. O sistema o serve de
dentro do espaço de URL de cada app, em `_sdk/vssh.js`, montado da tabela de exportação da ponte
no boot do portal. A versão que roda é a do shell que a serviu, e `vssh.app.capacidades()` traz
essa versão junto com a lista de verbos e eventos que aquele shell atende. O que este capítulo
descreve é a troca: o que sai do pacote, o que entra, o que fica como está.

### A regra de compatibilidade desta etapa

O SDK novo quebra o antigo, de propósito. Os nomes públicos mudaram (os espaços e os verbos em
português da tabela abaixo), e o shim do toolkit continua funcionando só enquanto o app o carregar
por conta própria, contra um shell que ainda fala o mesmo fio. Um app migra republicando contra o
SDK novo, e a migração é uma passada de busca e troca guiada pela tabela. O sistema não carrega
uma camada de compatibilidade entre os dois: uma segunda grafia de cada verbo seria uma segunda
coisa para o sistema manter e para o autor de app aprender.

### O que sai do pacote do app

A cópia de `lib/web` que o backend servia pelo `mounts` do SPA. O `vssh-app-shim.js`, o
`fsa-polyfill.js`, os shims de Electron e Tauri e o Tuff não são mais lidos do pacote instalado;
o `montagens` do `web.spa` continua existindo para o que o app quiser servir, e o que sai é a
obrigação de levar essas libs junto. A dependência do toolkit no `package.json` ou no
`installCommand` sai também, pelas libs de backend (ver acima).

O marcador `.vssh-lib-version` da era da cópia à mão. O `vssh-app-publish` deixou de procurá-lo e
de recusar um pacote por ele; quem ainda tem um `vendor/vssh/` no repositório do app o apaga por
higiene, e por mais nada.

A tag com carimbo (`_vssh/vssh-app-shim.js?v=<hash>`). O `?v=` só sai para um arquivo que está no
disco do app, e `_sdk/vssh.js` não está: o sistema o serve com `no-cache` e ETag, e o navegador
revalida a cada abertura da janela.

### O que entra

Uma tag no `<head>`, antes dos scripts do app, relativa à raiz dele. É a mesma tag nas duas
hospedagens, no portal e no cliente de desktop:

```html
<script src="_sdk/vssh.js"></script>
<!-- opcionais, depois do primeiro -->
<script src="_sdk/electron.js"></script>
<script src="_sdk/tauri.js"></script>
```

Com o `web.spa` do runtime a tag entra sozinha, e é o caminho dos templates: `web.spa(raiz)`
injeta `_sdk/vssh.js` por padrão, e `sdk: false` deixa isso para quem escreve a tag à mão. Numa
rota profunda servida por `rotasProfundas` o relativo precisa de um `<base href>` na raiz do app,
e o `web.spa` já o injeta. O Tuff entra pela mesma opção: `tuff: true` injeta `web.TUFF`
(`tuff-tokens.css`, `tuff.css`, `tuff.js`), e uma lista escolhe os arquivos, com `web.TUFF_BASE`
(o reset da página), `web.TUFF_ICONES` (o sprite) e `web.TUFF_MIDIA` (trilha, volume, grade,
visor) à disposição. `VSSH_APP_BASE_PATH` não entra na conta.

O polyfill de File System Access vem dentro de `_sdk/vssh.js`, depois do runtime: não há uma
segunda tag para ele, e a ordem que o toolkit pedia (shim antes do polyfill) deixou de ser uma
coisa a lembrar.

Os nomes públicos novos. A tabela de exportação tem nove espaços (`app`, `janela`, `arquivos`,
`avisos`, `dialogos`, `segredos`, `midia`, `impressao`, `gpu`), e cada verbo é uma função com os
argumentos na ordem dos campos da tabela (o objeto de opções do shim deixou de existir); um verbo
que responde devolve promessa. Um evento do shell se assina por
`vssh.<espaco>.ao('<evento>', cb)`, que devolve a função que cancela. A referência gerada em
`docs/referencia/` tem a assinatura e a descrição de cada um; o que segue é a correspondência,
nome antigo para nome novo, tirada do `vssh-app-shim.js` do toolkit e da tabela:

| antes (`vssh-app-shim.js`) | agora (`_sdk/vssh.js`) |
|---|---|
| `vssh.inDesktop` | `vssh.noAmbiente` |
| `vssh.libVersion` | sai; `vssh.app.capacidades().shellVersion` é a versão dos dois lados |
| `vssh.capabilities()` | `vssh.app.capacidades()`, com `verbos` e `eventos` na resposta |
| `vssh.setTitle(t)` | `vssh.app.titulo(titulo)` |
| `vssh.lembrarRota(r)` | `vssh.app.lembrarRota(rota)` |
| `vssh.onOpenContext(cb)` | `vssh.app.ao('abertura', cb)`; no contexto, `path` virou `caminho` |
| `vssh.window.abrir(rota, { title, width, height })` | `vssh.janela.abrir(rota, titulo, largura, altura)` |
| `vssh.window.minimize()`, `maximize()`, `restore()`, `focus()`, `close()` | `vssh.janela.minimizar()`, `maximizar()`, `restaurar()`, `focar()`, `fechar()` |
| `vssh.window.arrastar(x, y, telaX, telaY)` | `vssh.janela.arrastar(x, y, telaX, telaY)` |
| `vssh.window.arrastarPara(telaX, telaY)` | `vssh.janela.arrastarPara(telaX, telaY)` |
| `vssh.window.arrastarFim()` | `vssh.janela.terminarArraste()` |
| `vssh.window.alternarMaximizado()` | `vssh.janela.alternarMaximizado()` |
| `vssh.window.menuDoCabecalho(x, y)` | `vssh.janela.menuDoCabecalho(x, y)` |
| `vssh.tabs.update(tabs, activeTabId)` | `vssh.janela.abas(abas, abaAtiva)` |
| `vssh.tabs.on(handler)` | `vssh.janela.ao('ativarAba' \| 'fecharAba' \| 'novaAba' \| 'restaurarAbas', cb)`; `tabId` virou `abaId`, `tabs` virou `abas`, `activeSessionName` virou `sessaoAtiva` |
| `vssh.fs.list(p)` | `vssh.arquivos.listar(caminho)` |
| `vssh.fs.stat(p)` | `vssh.arquivos.consultar(caminho)` |
| `vssh.fs.read(p)` | `vssh.arquivos.ler(caminho)` |
| `vssh.fs.readBytes(p)` | `vssh.arquivos.lerBytes(caminho)`, e a resposta continua `Uint8Array` |
| `vssh.fs.write(p, conteudo)` | `vssh.arquivos.escrever(caminho, conteudo)` |
| `vssh.fs.writeBytes(p, bytes)` | `vssh.arquivos.escreverBytes(caminho, base64)`: os bytes vão em base64, e quem codifica é o app |
| `vssh.fs.mkdir(p)` | `vssh.arquivos.criarPasta(caminho)` |
| `vssh.fs.delete(p)` | `vssh.arquivos.apagar(caminho)` |
| `vssh.fs.exists(p)` (booleano) | `vssh.arquivos.existe(caminho)`, que responde `{ exists }` |
| `vssh.fs.rename(de, para, { overwrite })` | `vssh.arquivos.renomear(origem, destino, politica)`, com `politica` `'fail'` ou `'overwrite'` |
| `vssh.fs.copy(de, para, { overwrite })` | `vssh.arquivos.copiar(origem, destino, politica)` |
| `vssh.fs.watch(p, cb)` | `vssh.arquivos.acompanhar(caminho, aoMudar)`; o callback recebe `{ caminho, encerrado }` no lugar de `{ path, closed }`. Por baixo, `vigiar`, `pararDeVigiar` e o evento `arquivoMudou` |
| `vssh.fs.isGranted(p, { mode })` | `vssh.arquivos.permissoes(caminho)`: `true` ou `false` do shell, sem `mode`; `null` só fora do ambiente |
| `vssh.fs.grantedPaths()` | `vssh.arquivos.concedidos()` |
| `vssh.fs.urlFor(p)` | `vssh.arquivos.urlFor(caminho)` |
| `vssh.pickFile({ title, filter, dir, name })` | `vssh.arquivos.escolherArquivo(titulo, filtro, pasta, nome)` |
| `vssh.pickSave({ title, filter, dir, name })` | `vssh.arquivos.escolherDestino(titulo, filtro, pasta, nome)` |
| `vssh.pickDirectory({ title, dir })` | `vssh.arquivos.escolherPasta(titulo, pasta)` |
| `vssh.openFile(p)` | `vssh.arquivos.abrir(caminho)` |
| `vssh.openFolder(p)` | `vssh.arquivos.abrirPasta(caminho)` |
| `vssh.openWith(p)` | `vssh.arquivos.abrirCom(caminho)` |
| `vssh.openUrl(url, { destino })` | `vssh.arquivos.abrirLink(url, destino)` |
| `vssh.ARQUIVOS_MIME` | `vssh.arquivos.MIME` |
| `vssh.onArquivosSoltos(cb, { alvo })` | `vssh.arquivos.aoSoltarArquivos(cb, { alvo })` |
| `vssh.arrastarArquivos(dt, caminhos, { efeito })` | `vssh.arquivos.arrastarArquivos(dt, caminhos, { efeito })` |
| `vssh.clipboard.files()` | `vssh.arquivos.areaDeTransferencia()` |
| `vssh.clipboard.setFiles(paths)` | `vssh.arquivos.copiarParaAreaDeTransferencia(caminhos)`, sempre uma lista; responde quantos entraram |
| `vssh.clipboard.onChange(fn)` | `vssh.arquivos.ao('areaDeTransferenciaMudou', ({ conteudo }) => …)` |
| `vssh.clipboard.readImage()` | `vssh.arquivos.imagemCopiada()` |
| `vssh.clipboard.writeImage(blob)` | `vssh.arquivos.copiarImagem(blob)` |
| `vssh.notify(msg, { title, level, prioridade, chave, actions })` | `vssh.avisos.notificar(mensagem, titulo, nivel, prioridade, chave, acoes)` |
| `vssh.toast(msg, { title, level, timeout, chave })` | `vssh.avisos.avisar(mensagem, titulo, nivel, duracao, chave)` |
| `vssh.live.set(chave, item)` | `vssh.avisos.atividade(chave, item)` |
| `vssh.live.clear(chave, { registrar })` | `vssh.avisos.encerrarAtividade(chave, registrar)` |
| `vssh.tray.set({ …, onClick, onMenu })` | `vssh.avisos.bandeja(item)` com os dados, e `vssh.avisos.ao('acaoNaBandeja', ({ evento, menuId }) => …)` para o clique |
| `vssh.tray.remove()` | `vssh.avisos.tirarDaBandeja()` |
| (não existia) | `vssh.avisos.ao('acaoDeNotificacao', cb)` e `vssh.avisos.ao('acaoDeAtividade', cb)` |
| `vssh.dialog.alert(msg, title)` | `vssh.dialogos.mostrar(mensagem, titulo)` |
| `vssh.dialog.error(msg, title)` | `vssh.dialogos.erro(mensagem, titulo)` |
| `vssh.dialog.confirm(msg, title)` | `vssh.dialogos.confirmar(mensagem, titulo)` |
| `vssh.dialog.prompt(msg, value, title)` | `vssh.dialogos.perguntar(mensagem, valor, titulo)` |
| `vssh.dialog.password(msg, title)` | `vssh.dialogos.senha(mensagem, titulo)` |
| `vssh.contextMenu(x, y, items)` | `vssh.dialogos.menuDeContexto(x, y, itens)` |
| `vssh.secrets.list()` (a lista) | `vssh.segredos.listar()`, que responde `{ names }` |
| `vssh.secrets.set(nome, { title, description })` | `vssh.segredos.pedir(nome, titulo, descricao)` |
| `vssh.secrets.remove(nome)` | `vssh.segredos.apagar(nome)` |
| `vssh.audio.gain()`, `vssh.audio.muted()` | `vssh.midia.ganho()`, `vssh.midia.mudo()` |
| `vssh.audio.onChange(fn)` | `vssh.midia.ao('volume', ({ ganho, mudo }) => …)` |
| `vssh.media.transporte({ anterior, proximo })` | `vssh.midia.transporte(anterior, proximo)` |
| `vssh.media.aoAgir(handler)` | `vssh.midia.ao('acao', ({ acao }) => …)` |
| `vssh.media.agora({ titulo, subtitulo, capa })` | `vssh.midia.agora(titulo, subtitulo, capa)` |
| `vssh.print(p, { name })` | `vssh.impressao.imprimir(caminho, nome)` |
| `vssh.aparencia.tokens()` | `vssh.aparencia.tokens()` |
| `vssh.aparencia.onChange(fn)` | `vssh.aparencia.aoMudar(fn)` |
| (não existia) | `vssh.gpu.estado()`, e `vssh.midia.audio(temAudio, tocando)` para quem produz som por um caminho que o SDK não vê |

Fora do ambiente (`window.parent === window`, o app aberto numa aba solta) o SDK não lança na
carga. Um verbo que responde degrada para o equivalente do navegador (os diálogos), para um valor
vazio (os seletores respondem `null`, `capacidades()` responde `host: 'none'`) ou para uma promessa
rejeitada com `fora do ambiente VSSH: <verbo>` (os de disco); um verbo sem resposta vira um `false`
sem efeito. Fora do ambiente ninguém serve `_sdk/`, então esse modo aparece quando o app é
servido por algo que o sirva: o `api/vssh.js` deste repositório é o mesmo arquivo, e é o que o
emulador vai servir.

Para o editor, os typings ficam em `api/vssh.d.ts`, gerados da mesma tabela; a tabela em si está
em `api/abi.json`, para quem quiser ler a lista de verbos sem abrir o navegador.

### O CI do seu app, de novo

Um app que roda a própria suíte no CI precisa do runtime no caminho ali também. A ação composta
deste repositório faz isso num passo, antes do `npm test` ou do `python -m unittest`:

```yaml
- uses: colabhd/vssh-sdk/.github/actions/preparar-sdk@main
```

Ela faz o checkout esparso de `runtime`, `api` e `scripts` em `_sdk/` no workspace e grava
`VSSH_SDK`, `NODE_PATH` e `PYTHONPATH` em `GITHUB_ENV`. A publicação continua no reusable, num
job à parte; quem precisa fixar uma revisão deste repositório passa `ref` à ação.

## O que vai mudar, e quando

O [`emulador/`](emulador/) chega para desenvolver e testar um app sem servidor VSSH por perto, e
é ele que serve `_sdk/` na máquina de quem escreve. Até lá, o
[guia do ambiente de desenvolvimento](docs/guias/ambiente-de-desenvolvimento.md) diz como servir
`api/vssh.js` na frente do backend à mão.
