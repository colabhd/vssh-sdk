# Chamar outro app

Ao terminar este guia, o seu app usa o que outro app instalado sabe fazer, sem conhecer o id dele
nem montar URL de proxy: a busca numa biblioteca de referências, ou um modelo de linguagem. Do
outro lado, o seu app oferece uma capacidade para os outros usarem. O verbo é
`vssh.apps.pedir`, e o contrato entre os dois lados é uma capacidade com versão, declarada no
manifesto de cada um.

O par de referência é o Prelo, que cita da biblioteca, e o Zotero, que a oferece como
`bibliography/v1`.

## A capacidade

Uma capacidade é um contrato com nome e versão, `nome/vN`: `bibliography/v1`, `llm/v1`. Quem oferece
a declara em `provides` e quem usa a declara em `requires`, sem que um cite o outro. O Prelo
pede `bibliography/v1` e recebe o Zotero porque o Zotero está instalado. Outro app que oferecesse
`bibliography/v1` atenderia o Prelo sem uma linha mudar nele.

A versão é obrigatória, porque o contrato atravessa repositórios que não se conhecem. Mudar o que
uma rota responde é publicar `nome/v2` e manter o `v1` enquanto alguém o usar. Quem oferece escreve
o contrato no próprio repositório, com as rotas e o que cada uma recebe e responde. O
`bibliography/v1` tem três rotas, `buscar?q=`, `itens?chaves=` e `versao`.

## Oferecer

Quem oferece declara a capacidade e o prefixo das rotas que a atendem:

```json
"provides": ["bibliography/v1"],
"capacidades": { "bibliography/v1": { "rota": "/bibliografia/v1" } }
```

O prefixo é um caminho do seu backend, a partir da raiz dele, sem barra no fim. Um pedido pela
ponte só alcança o que fica debaixo do prefixo, e o resto do backend (as rotas da janela, a
configuração) fica fora do alcance de outro app. Uma capacidade de `provides` sem entrada em
`capacidades` vale para o ambiente e não se chama pela ponte.

O backend responde às rotas do prefixo como responde à própria janela: o pedido chega pelo proxy,
com a sessão da pessoa, e passa pelo `servidor.portao`. O cabeçalho `X-Vssh-Chamador` traz o id do
app que pediu.

```js
const http = require('node:http');
const { servidor } = require('vssh');

const server = http.createServer(servidor.portao(async (req, res) => {
  const url = new URL(req.url, 'http://app');
  if (url.pathname === '/bibliografia/v1/buscar') {
    servidor.registrar(`busca pedida por ${req.headers['x-vssh-chamador'] || 'esta janela'}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ versao: biblioteca.versao(), itens: biblioteca.buscar(url.searchParams.get('q') || '') }));
    return;
  }
  // as outras rotas do app
}));
```

Use `X-Vssh-Chamador` no log, ou para responder diferente a cada app, e nunca como prova de
identidade. Na web toda página de app divide a origem do portal, e poderia mandar o cabeçalho com o
valor que quisesse.

## Usar

Quem usa declara a capacidade em `requires`:

```json
"requires": ["bibliography/v1"]
```

O portal confere a declaração na instalação, contra o `provides` dos apps instalados no servidor, e
recusa instalar um app cuja capacidade ninguém oferece, dizendo qual falta. A página chama:

```js
const r = await vssh.apps.pedir('bibliography/v1', `buscar?q=${encodeURIComponent(texto)}&limite=20`);
if (r.status !== 200) throw new Error(`a biblioteca respondeu ${r.status}`);
mostrar(r.corpo.itens);
```

O caminho é relativo ao prefixo que o outro app declarou, sem barra na frente, com a consulta
junto. A resposta chega como `{ status, tipo, corpo }`, com `corpo` já lido quando ela é JSON e em
texto nos outros casos. Para mandar dados, `opcoes` leva o método, o corpo e o tipo. Numa
capacidade `llm/v1` com uma rota `completar`, seria:

```js
const r = await vssh.apps.pedir('llm/v1', 'completar', { metodo: 'POST', corpo: { prompt, max: 200 } });
```

Um objeto em `corpo` vai como JSON. `tipo` dá o `Content-Type` de um corpo em texto.

## O que acontece no caminho

O pedido sai do shell, e não da página. No cliente de desktop cada app mora numa origem própria, e
um `fetch` de dentro da página para a URL de proxy de outro app cairia no backend do próprio app.
Pela ponte, o shell faz, nesta ordem:

1. confere que o seu app declara a capacidade em `requires`;
2. acha o app que a oferece com um prefixo em `capacidades`;
3. resolve o caminho contra o prefixo e recusa o que sai dele, com `..` e `%2e%2e` já resolvidos;
4. pergunta à pessoa, na primeira vez, se o seu app pode usar a capacidade;
5. sobe o outro app, se ele estiver parado, e faz o pedido como a mesma pessoa.

A resposta da pessoa vale até ela a revogar, em Configurações, em Apps que usam outros.
Por isso a promessa de `pedir` tem prazo de 10 minutos: o primeiro pedido espera alguém responder.
Um app parado sobe antes do pedido, e o shell repete por até 20 s enquanto ele fica de pé.

O caminho fora do prefixo, a capacidade ausente de `requires` e a recusa da pessoa rejeitam a
promessa sem pedido nenhum. Trate a rejeição como "a biblioteca não está disponível agora" e deixe
o resto do app funcionando: no Prelo, sem a biblioteca, o texto e as citações que o documento já
guardou continuam lá.

## Guardar o que veio do outro app

Um documento que depende do outro app para abrir deixa de abrir quando a pessoa desinstala o outro
app, ou quando outra pessoa o abre sem ele. O Prelo guarda no documento o CSL-JSON de cada item
citado, com a chave do Zotero e a versão da biblioteca, e compila sem a biblioteca. A orientadora
abre a dissertação da orientanda sem a biblioteca dela. A biblioteca só é consultada para citar um
item novo e para atualizar as cópias quando a versão dela muda.

## Onde cada coisa está

| para | leia |
|---|---|
| o verbo, com os argumentos e o que responde | [`vssh.apps`](../referencia/apps.md) |
| `provides`, `requires` e `capacidades` | [O manifesto](../conceitos/o-manifesto.md) e o [schema](../referencia/manifesto.md) |
| o que o sistema garante quando o outro app cai | [O que o sistema garante](../conceitos/o-que-o-sistema-garante.md) |
