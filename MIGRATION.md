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

### O que ainda não está aqui

A referência de API (`docs/api.md` do toolkit) e a referência de autoria (`SKILL.md`) passam a
ser geradas a partir do sistema numa etapa seguinte, junto de conceitos escritos à mão em
[`docs/`](docs/). Até lá, as páginas do toolkit continuam valendo para o que a ponte `vssh.*`
faz hoje.

## O que vai mudar, e quando

Três coisas mudam nas próximas etapas, e cada uma chega com uma seção nova nesta página.

O shim (`vssh-app-shim.js`) e as outras libs de navegador viajam hoje dentro do pacote das libs
de backend, e o backend do seu app as serve pelo `mounts` do SPA. Na sub-etapa que publica a ABI
da ponte, o sistema passa a servir a cópia dele: o app deixa de carregar um shim próprio, e a
versão que roda passa a ser sempre a do shell que está no ar. O `mounts` continua servindo o que
o app quiser servir; o que sai é a obrigação de levar o shim junto.

As libs de backend passam a ser publicadas em [`runtime/`](runtime/), e a dependência do seu app
passa a apontar para cá em vez de para o toolkit. É uma troca de linha no `package.json` e no
`installCommand`, e o portão do `vssh-app-publish` passa a comparar a versão do seu app com a
daqui.

O [`emulador/`](emulador/) chega para desenvolver e testar um app sem servidor VSSH por perto.
