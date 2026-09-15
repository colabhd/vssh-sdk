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

### As libs: nada muda, por enquanto

As libs de backend continuam vindo do toolkit, pelo gerenciador de pacotes do runtime:

```bash
npm i github:colabhd/vssh-app-toolkit#v4                                                # Node
pip install "https://github.com/colabhd/vssh-app-toolkit/archive/refs/tags/v4.tar.gz"  # Python
```

O `installCommand` dos templates e dos exemplos deste repositório declara exatamente isso, e um
app copiado deles não precisa mexer em nada. A história das gerações das libs (v1 a v4: o socket
unix no lugar da porta, o portão de major, o `mounts` para as libs de navegador) está no
[`MIGRATION.md` do toolkit](https://github.com/colabhd/vssh-app-toolkit/blob/main/MIGRATION.md),
que continua sendo a referência delas até o sistema publicá-las aqui.

O portão de versão do `vssh-app-publish` lê a versão de referência das libs de
`runtime/package.json`. Enquanto esse diretório não existe, o script avisa numa anotação do run
("libs não conferidas") que a versão das libs do seu app não foi comparada com nada. O aviso é
verdadeiro, e some quando `runtime/` chegar.

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
o `mounts` continua existindo para o que o app quiser servir, e o que sai é a obrigação de levar
essas libs junto. A dependência do toolkit no `package.json` ou no `installCommand` continua, pelas
libs de backend (ver abaixo).

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

Com o SPA das libs de backend a tag entra pela injeção, e é o caminho dos templates:
`injectScripts: ['_sdk/vssh.js']` no Node, `inject_scripts=["_sdk/vssh.js"]` no Python, sem
`mounts`. Numa rota profunda servida pelo fallback de SPA o relativo precisa de um `<base href>`
na raiz do app, e `createStaticSpa` e `criar_spa_estatica` já o injetam. O Tuff entra na mesma
forma: `injectStyles: ['_sdk/tuff/tuff-tokens.css', '_sdk/tuff/tuff-base.css',
'_sdk/tuff/tuff.css']` e `_sdk/tuff/tuff-icones.js`, `_sdk/tuff/tuff.js` nos scripts; as peças de
mídia são `_sdk/tuff/tuff-midia.css` e `_sdk/tuff/tuff-midia.js`. `VSSH_APP_BASE_PATH` não entra
na conta.

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

### O que ainda não muda

O backend continua nas libs v4 do toolkit, pelo `installCommand` de sempre: o `npm i
github:colabhd/vssh-app-toolkit#v4` ou o `pip install` do tarball. O SPA, o SSE, o log, o
filesystem privado, a bandeja e a notificação por arquivo funcionam como funcionam, e o
`vssh-app-publish` continua conferindo a versão delas enquanto forem vendorizadas. A troca pelo
runtime instalado no servidor (`import vssh`, em `/opt/vssh/sdk/{python,node}`) vem quando
[`runtime/`](runtime/) estiver publicado, e ganha a própria seção aqui.

## O que vai mudar, e quando

Duas coisas mudam nas próximas etapas, e cada uma chega com uma seção nova nesta página.

As libs de backend passam a ser publicadas em [`runtime/`](runtime/), e a dependência do seu app
passa a apontar para cá em vez de para o toolkit. É uma troca de linha no `package.json` e no
`installCommand`, e o portão do `vssh-app-publish` passa a comparar a versão do seu app com a
daqui.

O [`emulador/`](emulador/) chega para desenvolver e testar um app sem servidor VSSH por perto, e
é ele que serve `_sdk/` na máquina de quem escreve.
