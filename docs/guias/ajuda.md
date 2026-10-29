# A ajuda do seu app

Ao terminar este guia o seu app tem um livro na Ajuda do ambiente, com o nome dele: o F1 na janela
do app abre o tópico de entrada, a Loja mostra a ajuda antes da instalação, e um passo pode apontar
um botão de dentro da sua janela. O formato é o da Ajuda do ambiente, e o compilador também: o
mesmo arquivo que o portal executa chega a este repositório em
[`api/ajuda/`](../../api/ajuda/compilador-da-ajuda.ts).

Um app sem ajuda declarada continua com uma ficha na Ajuda, escrita do manifesto: o ícone, o
nome, a descrição e a versão, com o botão que abre o app. É o nível 0, e ele não pede nada de você.

## A pasta e o manifesto

O manifesto aponta a pasta e o tópico que o F1 abre:

```json
"contributes": {
  "ajuda": { "pasta": "ajuda", "inicio": "comecar" }
}
```

A pasta fica dentro do pacote e tem um arquivo por tópico, `<id>.md`. Ao lado deles podem morar
um `glossario.md`, com os termos do seu app, e um `alvos.json`, com os controles da sua janela que
um passo aponta. A pasta não tem subpastas, e o compilador recusa uma pelo nome.

Os dois templates deste repositório trazem uma pasta assim, com um tópico só:
[`templates/hello-vssh-app/ajuda/comecar.md`](../../templates/hello-vssh-app/ajuda/comecar.md).

## Um tópico

Um tópico é Markdown com um frontmatter entre duas linhas `---`:

```text
---
id: comecar
titulo: Transcrever uma gravação
cobre: [janela, menu:transcrever, segredo:CHAVE_DA_API]
palavras: [áudio, legenda, texto]
---

O Escriba transforma uma gravação em texto, com o tempo de cada frase.

## Abrir uma gravação

{{Direito}} num arquivo de áudio, no gerenciador de arquivos, e escolha [[Transcrever]].
```

O `id` é o nome do arquivo, e o `titulo` é o que aparece no sumário e na busca. As `palavras` são
o que a pessoa digitaria procurando o tópico sem saber o nome dele. O `cobre` diz que partes do
manifesto o tópico explica, e é dele que sai o nível (abaixo).

O texto aceita parágrafo, `##` e `###`, lista, código entre crases, link `https` e as marcações da
Ajuda. `[[Transcrever]]` é o nome de um controle como ele aparece na tela. `{{clique}}` e
`{{Direito}}` viram "clique" ou "toque", e "clique com o botão direito" ou "toque e segure",
conforme o ponteiro de quem lê. `{{t:outro-topico|texto}}` liga a outro tópico do app, e
`{{t:ambiente/arquivos|texto}}` a um tópico do ambiente. `{{g:termo}}` sublinha um termo do
glossário do app ou do ambiente, e um clique nele mostra a definição.

O compilador recusa o que o formato não conhece: HTML, imagem, tabela e negrito. Recusa também o
travessão e a seta unicode, que são os dois padrões de texto que dá para recusar sem julgar a
frase. A lista completa das chaves, das ações de um passo e dos tópicos do ambiente que um link
alcança está na [referência do formato](../referencia/formato-da-ajuda.md).

## O que o `cobre` nomeia, e o nível

O manifesto põe partes do app na frente da pessoa, e cada uma é uma superfície: a janela, cada item
de menu, cada senha que o app pede, a placa de vídeo, a fila, as capacidades que ele oferece e as
que usa, a seção de Configurações e a extensão do Navegador. Um tópico diz no `cobre` quais delas
explica, com os nomes da [tabela da referência](../referencia/formato-da-ajuda.md#as-superfícies-que-o-cobre-nomeia),
e o compilador recusa um nome que o manifesto não declara.

O nível da ajuda sai daí:

| nível | o que pede |
|---|---|
| 0 | nada: a Ajuda mostra a ficha escrita do manifesto |
| 1 | a pasta, com o tópico de entrada |
| 2 | um tópico para cada superfície do manifesto |
| 3 | o 2, com as figuras que o palco do app tira dos passos |
| 4 | o 3, com o app respondendo ao Mostrar onde fica pela ponte |

Quem mede o 3 e o 4 é o palco do app ([`scripts/palco-do-app.mjs`](../../scripts/palco-do-app.mjs)),
que o publish roda num Chrome. Ele sobe o backend do app, abre a janela num quadro do tamanho que o
manifesto declara, com o SDK web, e executa cada cerca `passos` que aponta um alvo do seu
`alvos.json`, numa carga nova da janela. De cada passo sai uma figura: o pedaço da janela em volta
do controle, do tamanho da coluna de texto da Ajuda (576 × 352 px, até 472 de altura), preso à
beirada da janela mais perto dele, em 2x, com as bordas que cortam a janela esmaecidas na Ajuda. O
palco confere que cada
`[[rótulo]]` do passo apareceu na janela e que o controle apontado se chama por um deles. Um alvo
que não aparece ou um rótulo que a janela não mostra vira uma linha no resumo do run, e o nível
fica no 2. A janela abre vazia, como na primeira vez que alguém usa o app: um passo que precisa de
um documento aberto começa pelos passos que chegam até ele, ou o app traz uma cena.

## A cena do palco

Uma janela que só mostra alguma coisa depois de uma pasta escolhida ou de um arquivo na HOME tira
figuras vazias, e um passo que cita o que estaria ali não confere. O app resolve isso com um
`palco.mjs` na pasta da ajuda:

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function preparar({ home, dados, app, manifesto }) {
  const projetos = join(home, 'Projetos');
  mkdirSync(projetos, { recursive: true });
  writeFileSync(join(projetos, 'leia-me.md'), '# Projetos de exemplo\n');
  return { ponte: { 'arquivos.escolherPasta': projetos } };
}
```

O palco chama `preparar` uma vez, antes de subir o backend. `home` é uma pasta descartável, que o
backend recebe como HOME, com as pastas XDG embaixo dela; `dados` é o diretório de dados do app
(`VSSH_APP_DATA_DIR`), e `app` a pasta do pacote. O que a função escreve nas duas é o que a janela
encontra, e o palco apaga as duas no fim.

O `ponte` diz o que o palco responde quando a janela pede um verbo ao ambiente. A chave é o nome
público do verbo, como na [referência da ponte](../referencia/README.md), e o valor é o que o shell
manda de volta no fio. Um verbo fora da lista recebe a recusa de um shell que não o atende, e um
nome que a ponte não tem interrompe o palco, com o nome na mensagem.

Quando a janela pede o mesmo verbo duas vezes e cada pedido quer outra resposta (a pasta de origem
e a de destino de uma importação), `ponte` vira uma lista de regras. `quando` compara os campos do
pedido pelo nome público deles, e a primeira regra que bate responde:

```js
return {
  ponte: [
    { verbo: 'arquivos.escolherPasta', quando: { titulo: 'A pasta de origem' }, valor: origem },
    { verbo: 'arquivos.escolherPasta', valor: destino },
  ],
};
``` Todas as receitas rodam sobre o mesmo
backend, na ordem dos tópicos, então o que uma receita grava a seguinte encontra.

O compilador da ajuda e o ambiente leem só os `.md` e o `alvos.json` da pasta, e o `palco.mjs`
fica de fora da ajuda publicada.

## Os passos que apontam a sua janela

Uma linha que começa por `>`, recuada dentro de um item da cerca `passos`, é uma ação. O Mostrar
onde fica a executa na tela de quem lê, e o Passo a passo espera a pessoa fazer o gesto:

````text
```passos
1. Clique em [[Nova transcrição]].
   > clicar nova-transcricao
2. Escolha a gravação.
```
````

O nome da ação é uma chave do `alvos.json` da pasta, que diz como achar o controle dentro da sua
janela, pelo texto que a pessoa vê ou por um seletor CSS:

```json
{
  "nova-transcricao": { "nome": "Nova transcrição" },
  "lista-de-gravacoes": { "seletor": "#gravacoes" }
}
```

Quem acha o controle é o SDK web (`_sdk/vssh.js`), dentro do quadro do app, e o shell desenha o
destaque por cima. Pelo `nome`, o SDK procura entre botões, links, campos e elementos com `role`,
`aria-label`, `title` ou `data-ajuda`, e compara com o `aria-label`, o `title`, o `placeholder` ou
o texto do elemento. Um controle só com ícone ganha um `aria-label`, e o mesmo nome serve ao leitor
de tela e à Ajuda. O app não escreve nada para isso: basta carregar o SDK web.

## Abrir um tópico de dentro do app

`vssh.ajuda.abrir('comecar')` abre a Ajuda no tópico do app com esse id, e sem argumento no tópico
de entrada. Um botão "Ajuda" na sua janela, ou um link num estado vazio, é uma linha:

```js
document.querySelector('#ajuda').addEventListener('click', () => vssh.ajuda.abrir('comecar'));
```

## Ver enquanto escreve

Para ver os erros e o nível sem publicar, rode o compilador deste repositório sobre a pasta do app,
e o palco, se quiser as figuras:

```bash
node scripts/compilar-ajuda.mjs ../meu-app
node scripts/palco-do-app.mjs ../meu-app --saida /tmp/palco
node scripts/compilar-ajuda.mjs ../meu-app --palco /tmp/palco
```

Os dois pedem o Node 22.18 ou mais novo, que importa o compilador em TypeScript sem build, e o
palco pede um Chrome instalado (`VSSH_TEST_CHROME` aponta um). A saída diz o nível, as superfícies
sem tópico, o que o palco não achou e cada erro com o arquivo e a linha; as figuras ficam na pasta
do `--saida`.

Para ver o tópico na Ajuda de verdade, abra a pasta do app pelo "Abrir como app" do gerenciador de
arquivos do ambiente. Num app ligado assim, o portal lê a ajuda do disco a cada abertura da Ajuda,
e o que você salva aparece na próxima.

## Publicar

O `vssh-app-publish` compila a pasta antes de empacotar. Uma ajuda que não compila recusa a
publicação, com o arquivo e a linha de cada erro, antes de qualquer envio. Uma que compila passa
pelo palco, quando o runner tem Chrome, e vai ao repositório depois do pacote, ao lado da versão,
com as figuras em seguida. O portal a lê de lá pela versão que cada estação tem. O resumo do run do
GitHub Actions diz o nível, lista as superfícies sem tópico e o que o palco não achou.

Um texto do manifesto com travessão vira aviso no run, com o caminho do campo: a ficha do app
mostra esses textos.

Os apps que a colabhd desenvolve têm uma regra a mais. A primeira versão de um deles que chega à
cobertura total (o nível 3) liga a recusa, e daí em diante o publish recusa uma versão abaixo
dela. Até lá o resumo do run mostra o que falta.
