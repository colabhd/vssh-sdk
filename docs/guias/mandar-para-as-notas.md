# Mandar para as notas

Ao terminar este guia, o seu app manda um trecho para as notas da pessoa: uma nota nova com o
título que o app escolhe, uma linha na nota de hoje, ou um parágrafo ao fim de uma nota que a
pessoa escolhe. O contrato é `notes/v1`, que o Lapis oferece, e o verbo é `vssh.apps.pedir`, como
em [Chamar outro app](chamar-outro-app.md). O seu app não precisa saber onde fica o cofre nem
escrever arquivo nenhum.

## Declarar

Mandar para as notas é um gesto a mais, e o seu app funciona sem ele. Por isso a capacidade vai em
`usa`, e o app instala num servidor sem o Lapis:

```json
"usa": ["notes/v1"]
```

Mostre o gesto só quando alguém o atende. `vssh.apps.listar` responde sem subir app nenhum e sem
perguntar nada à pessoa:

```js
const { apps } = await vssh.apps.listar('notes/v1');
botaoDeNotas.hidden = apps.length === 0;
```

## As rotas

| rota | recebe | responde |
|---|---|---|
| `POST nota` | `{ titulo, texto, pasta? }` | `{ caminho }` da nota nova |
| `POST hoje` | `{ texto }` | `{ caminho }` da nota de hoje |
| `GET buscar?q=&limite=` | | `{ notas: [{ caminho, nome, apelido? }] }`, até 50 |
| `POST acrescentar` | `{ caminho, texto }` | `{ caminho }` |

O texto é Markdown, de até 1 MB. `nota` escreve no cofre que a pessoa tem aberto. O título vira o
nome do arquivo sem os caracteres que um nome de arquivo ou um link não aceitam
(`\ / : * ? " < > | # ^ [ ]`), e um nome que já existe ganha um número. Sem `pasta`, a nota nasce
onde a configuração do cofre põe uma nota nova; com ela, a pasta é relativa à raiz do cofre e nasce
se ainda não existe. `hoje` e `acrescentar` põem o texto ao fim da nota, depois de uma linha em
branco, e a nota de hoje nasce do modelo do dia na primeira vez. `buscar` acha as notas pelo nome e
pelos apelidos, como a troca rápida do Lapis, e o `caminho` que volta é o que `acrescentar` recebe.

As recusas trazem o motivo em `corpo.error`: 409 quando a pessoa não tem cofre aberto, 400 para o
texto que falta ou a pasta que sai do cofre, 404 para a nota que não existe, 413 para o texto acima
de 1 MB.

## Uma nota nova

O texto é seu, e o link de volta também. Um recorte de página leva o endereço dela; um trecho de um
conteúdo que mora no seu app leva o endereço que o seu app tiver para ele, quando tiver.

```js
async function mandarParaAsNotas({ titulo, texto, endereco }) {
  const deVolta = endereco ? '\n\n[' + titulo + '](' + endereco + ')\n' : '';
  const r = await vssh.apps.pedir('notes/v1', 'nota', { metodo: 'POST', corpo: { titulo, texto: texto + deVolta } });
  if (r.status !== 200) throw new Error(r.corpo?.error || `as notas responderam ${r.status}`);
  return r.corpo.caminho;
}
```

Na primeira vez, o shell pergunta à pessoa se o seu app pode usar as notas, e a promessa espera a
resposta. Uma recusa, ou as notas fora do ar, rejeitam a promessa: o conteúdo continua no seu app, e
a pessoa pode tentar de novo.

## Uma nota que a pessoa escolhe

A busca alimenta um seletor no seu app, e a escolha vai para `acrescentar`:

```js
async function notasPeloNome(consulta) {
  const r = await vssh.apps.pedir('notes/v1', `buscar?q=${encodeURIComponent(consulta)}&limite=10`);
  return r.status === 200 ? r.corpo.notas : [];
}

async function acrescentar(nota, texto) {
  const r = await vssh.apps.pedir('notes/v1', 'acrescentar', { metodo: 'POST', corpo: { caminho: nota.caminho, texto } });
  if (r.status !== 200) throw new Error(r.corpo?.error || `as notas responderam ${r.status}`);
}
```

Mostre `nome`, e o `apelido` quando a nota foi achada por ele. O `caminho` traz a pasta, e serve
para distinguir duas notas de mesmo nome.

## O que acontece do outro lado

O Lapis grava pelo mesmo cofre da janela dele: o arquivo é trocado de uma vez, a partir da versão
lida, e uma edição que a janela grava no meio faz ler e juntar de novo, sem perder nenhuma das
duas. A janela aberta mostra a nota mudando. Cada escrita deixa uma linha no log do Lapis com o id
do app que pediu, o `X-Vssh-Chamador`.

## Onde cada coisa está

| para | leia |
|---|---|
| o verbo, com os argumentos e o que responde | [`vssh.apps`](../referencia/apps.md) |
| a capacidade, o consentimento e o caminho do pedido | [Chamar outro app](chamar-outro-app.md) |
| `usa` e `capacidades` | [O manifesto](../conceitos/o-manifesto.md) |
