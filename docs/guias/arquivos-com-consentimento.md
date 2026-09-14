# Arquivos com consentimento

Ao terminar este guia o seu app lê e grava na home da pessoa pela File System Access API do W3C,
reabre sem seletor o que ela já concedeu, sabe que um arquivo mudou por fora, abre um arquivo no
visualizador certo do ambiente, e recebe e produz arquivos arrastados. O modelo por trás disso está
em [consentimento](../conceitos/consentimento.md).

Os nomes de verbo deste guia seguem a [nota sobre os nomes](../README.md#sobre-os-nomes-dos-verbos).
A maior parte do código aqui é a API padrão do navegador, que não muda de nome; o que é do
ambiente vive em `vssh.arquivos`, e o shim de hoje o expõe como `vssh.fs.*`, `vssh.pickFile` e
afins.

## O que carregar

Dois scripts, servidos pelo seu backend e injetados pelo `static-spa` (os templates já vêm com os
dois): o shim, que publica o objeto `vssh`, e o polyfill de File System Access, que depende dele.
A ordem em `SHIMS` já é a certa. Sem o polyfill, `showDirectoryPicker` não existe no iframe.

## Escolher, ler, gravar

Para trabalhar com arquivos da pessoa, use a API padrão. Não monte um backend de filesystem: o app
não precisa de nenhum, e um web app que já usa File System Access (Logseq, Excalidraw, tldraw,
editores em geral) roda sem fork.

```js
const dir = await showDirectoryPicker();            // o seletor é o gerenciador de arquivos do ambiente
for await (const [nome, handle] of dir.entries()) {
  if (handle.kind !== 'file') continue;
  const file = await handle.getFile();               // preguiçoso: não baixa nada ainda
  if (!nome.endsWith('.md')) continue;               // filtre antes de ler
  const texto = await file.text();                   // só agora busca o conteúdo
}

const w = await (await dir.getFileHandle('nota.md', { create: true })).createWritable();
await w.write('# título\n');
await w.close();
```

Escolher é consentir. A pasta escolhida, e o que há dentro dela, passa a ser alcançável pelo app;
o resto da home, não. Não há segunda confirmação.

Os seletores também existem fora da API padrão, quando você quer só o caminho:

```js
const pasta   = await vssh.arquivos.escolherPasta({ titulo: 'Escolher grafo' });
const arquivo = await vssh.arquivos.escolherArquivo({ filtro: '*.md' });
const destino = await vssh.arquivos.escolherDestino({ nome: 'export.pdf' });
```

Devolvem o caminho absoluto no servidor, ou `null` se a pessoa cancelou, e concedem do mesmo jeito.
Com o caminho na mão, `vssh.arquivos.ler(caminho)` e `vssh.arquivos.escrever(caminho, texto)`
passam pelo mesmo portão.

## O `File` é preguiçoso

`getFile()` devolve um `File` que só busca o conteúdo quando alguém pede. É o que torna viável
abrir um diretório grande, porque o padrão dos apps é pedir o `File` de todo arquivo antes de
filtrar. `file.slice(a, b)` lê só a faixa pedida, por `Range` HTTP, e é o que faz um leitor por
blocos (Parquet, HDF5, Zarr, DICOM) rodar sem baixar o arquivo.

Dois caminhos leem os bytes de forma síncrona e não têm onde encaixar a busca: `new Blob([file])` e
`FormData.append(nome, file)`. Eles produzem 0 bytes, com aviso no console, até o arquivo ter sido
lido uma vez. Materialize antes:

```js
await file.arrayBuffer();     // ou .text(), ou qualquer leitura
new Blob([file]);              // agora carrega o conteúdo
```

## Reabrir o que já foi concedido

O grant viaja com a pessoa; o handle fica no IndexedDB do navegador, que não viaja. Num computador
novo o app acorda com a permissão concedida e sem handle nenhum. Trate essa terceira resposta no
boot, antes de mostrar "abrir pasta":

```js
const [grafo] = await vssh.arquivos.concedidos();   // handles, sem abrir seletor
if (grafo) await carregar(grafo);
else       await carregar(await showDirectoryPicker());
```

Um `stat` por caminho decide `file` ou `directory`, e o que não existe mais some da lista em vez de
virar handle morto. Isso não contorna o consentimento: a escolha já aconteceu uma vez, e o que
faltava era um objeto para representá-la nesta máquina.

Quando você guarda um handle no IndexedDB, o polyfill o reidrata na leitura; sem isso o app leria
de volta um objeto sem métodos e concluiria que a pasta está vazia. E confira a permissão de
verdade em vez de presumi-la:

```js
if (await dir.queryPermission() !== 'granted') {
  // Chame a partir de um clique: sem gesto da pessoa, devolve 'prompt' sem abrir seletor.
  if (await dir.requestPermission() !== 'granted') return;
}
```

Se a pessoa escolher outra pasta no seletor reaberto, a resposta é `'denied'` e o handle antigo
continua fora. `'denied'` é um estado normal; a pessoa revoga em Permissões de arquivo, no menu de
contexto da janela.

## Existe? Renomear, mover, copiar

```js
if (await vssh.arquivos.existe(destino)) { /* … */ }

await vssh.arquivos.renomear('/casa/proj/rascunho.md', '/casa/proj/final.md');   // renomear é o mover
await vssh.arquivos.copiar('/casa/proj/final.md', '/casa/backup/final.md');
await vssh.arquivos.renomear(a, b, { sobrescrever: true });                     // opt-in explícito
```

Três precisões, cada uma por um modo de falha concreto:

- `existe()` devolve `false` só quando o arquivo não existe. Falta de permissão, servidor fora e
  rede piscando lançam. O idioma `stat(p).then(() => true).catch(() => false)` colapsa três
  respostas em duas, e o app cria por cima de um arquivo que estava lá, ou conclui que a pasta da
  pessoa está vazia porque um `fetch` falhou. Não escreva `existe(p).catch(() => false)`;
- origem e destino precisam ambos estar concedidos, e a recusa é `403` nomeando o caminho
  reprovado;
- destino existente falha; `{ sobrescrever: true }` é a forma de dizer que você quer mesmo.
  Sobrescrever sem pedir não tem desfazer.

`removeEntry('pasta')` recusa apagar uma pasta com conteúdo, como manda a especificação
(`InvalidModificationError`). A API de arquivos do portal por baixo é um `rm -rf`, e sem essa guarda
a chamada apagaria tudo em silêncio. `{ recursive: true }` é explícito.

## Saber que um arquivo mudou por fora

```js
const parar = await vssh.arquivos.vigiar(dir, ({ caminho, encerrado }) => {
  if (encerrado) return;     // a assinatura acabou; peça de novo se ainda precisar
  recarregar(caminho);
});
// …quando não precisar mais:
parar();
```

Pega edição por SSH, `git pull`, upload pelo gerenciador de arquivos: qualquer mudança que não
passou pelo app. Cancele quando parar de precisar, porque cada vigia segura um processo vivo no
servidor e há teto por usuário. Fechar a janela cancela tudo. Isso não está no polyfill de
propósito: a File System Access API não tem watch, e pendurar uma extensão nossa num handle daria
a ela cara de padrão.

## Abrir no visualizador do ambiente

```js
vssh.arquivos.abrir('/home/ana/relatorio.pdf');          // PDF, vídeo, imagem, texto, office, zip, pasta
const escolhido = await vssh.arquivos.abrirCom('/home/ana/nota.md');   // a pessoa escolhe com quê
```

Você manda o caminho absoluto e mais nada. O app nunca precisa saber o `serverId` nem montar URL
de API; quem monta é o shell, que sabe onde está.

## Arrastar, nas duas direções

O contrato é um só: o tipo MIME `application/x-vssh-files`, com os caminhos absolutos separados
por linha. É como o gerenciador de arquivos e a área de trabalho já conversam, e o app entra dos
dois lados sem declarar nada no manifesto.

```js
// receber: o arquivo que a pessoa arrastou do gerenciador para dentro do app
const desligar = vssh.arquivos.ao('soltos', ({ caminhos, x, y, alvo }) => {
  for (const p of caminhos) abrirNoEditor(p);
});

// produzir: arrastar de dentro do app para a área de trabalho, o gerenciador ou a lixeira
aba.draggable = true;
aba.addEventListener('dragstart', (e) => vssh.arquivos.arrastar(e.dataTransfer, [caminhoDaAba]));
```

Três coisas que economizam uma tarde:

- o ouvinte de soltura chama `preventDefault` no `dragover`. Sem isso o navegador entende que o
  elemento recusa a soltura: o `drop` nunca acontece, o cursor fica proibido, e não há erro nem
  log. Se você escrever o ouvinte à mão, é essa a linha que falta;
- `arrastar` avisa o shell sozinho, inclusive o fim do gesto. Todo alvo de soltura do ambiente
  decide se acende olhando um estado que vive no documento do shell, e um `dragend` não atravessa
  documentos;
- o caminho tem de ser absoluto. Um relativo é descartado, e a função devolve `false`.

## Área de transferência

Texto e imagem vão pela API padrão, `navigator.clipboard`, direto: o iframe é da mesma origem e
recebe a permissão. O que o ambiente acrescenta é o motivo da falha (`no-user-activation`,
`denied`, `unsupported`), porque as três causas chegam com o mesmo `NotAllowedError`. Arquivos vão
pela ponte, porque o clipboard de arquivos é do gerenciador: `vssh.arquivos` lê o que foi copiado
lá, escreve para colar lá, e avisa quando muda. Escrever sempre copia; recortar continua sendo do
gerenciador, onde a pessoa vê o que está fazendo.

## OPFS é cache

`navigator.storage.getDirectory()` funciona e é nativo; o polyfill o isola por app, porque todos
os apps são servidos pela mesma origem e sem isso um leria o `cache.db` do outro. O que ele não
muda: OPFS é por perfil de navegador e a pessoa troca de máquina. Um app que guarda a verdade ali
perde tudo na troca, sem erro nenhum. A verdade vai para o filesystem da pessoa ou para o backend
do app; OPFS é aceleração reconstruível.
