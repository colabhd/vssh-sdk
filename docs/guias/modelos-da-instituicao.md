# Os modelos da instituição

Ao terminar este guia, o seu app conversa com os modelos que a instituição hospeda: uma resposta
em fluxo, com as ferramentas do app, com uma imagem na pergunta, a transcrição de um áudio e o
vetor de um texto para a busca por sentido. O contrato é `llm/v1`, que o portal serve a partir do
gateway do sítio da estação. A chave do gateway fica no portal, e o seu app nunca a vê.

## Declarar

```json
{ "recursos": { "llm": true } }
```

O campo dá ao app o escopo `llm`. Sem ele, a janela e o backend recebem `sem_escopo`. O app instala
mesmo num portal sem gateway, e ali cada pedido responde `sem_gateway`, que é o sinal para esconder
o recurso.

## Onde chamar

A janela chama o caminho relativo à raiz dela, como chama o `_sdk/vssh.js`:

```js
const r = await fetch('_sdk/llm/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'conversa', messages: [{ role: 'user', content: 'Resuma este parágrafo.' }] }),
});
```

O backend usa o `vssh.llm` do runtime, que fala com o portal pela credencial que o app recebe na
subida:

```js
const { llm } = require('vssh');
for await (const p of llm.fluxo({ model: 'conversa', messages })) process.stdout.write(p.choices?.[0]?.delta?.content ?? '');
```

```python
from vssh import llm
for p in llm.fluxo({'model': 'conversa', 'messages': mensagens}):
    if p['choices']:
        print(p['choices'][0]['delta'].get('content') or '', end='')
```

## Os nomes dos modelos

Peça a função, e não o modelo: o portal traduz `conversa`, `rapido`, `embeddings` e `transcricao`
para o modelo do momento, e o seu app continua igual quando ele troca. O `GET models` lista as
funções e os modelos do gateway, cada um com `nome` e `descricao` para um seletor, a `janela`, e o
que ele aceita em `ferramentas`, `imagem` e `audio`:

```js
const { data } = await (await fetch('_sdk/llm/v1/models')).json();
const comVisao = data.filter((m) => m.imagem);
```

## Os verbos

| verbo | para quê | no `vssh.llm` |
|---|---|---|
| `POST chat/completions` | a conversa da OpenAI, com fluxo, ferramentas, imagem e áudio | `conversar`, `fluxo` |
| `POST messages` | a mesma conversa na Messages da Anthropic | `mensagens`, `eventos('messages', …)` |
| `POST responses` | a mesma conversa na Responses da OpenAI | `respostas`, `eventos('responses', …)` |
| `POST audio/transcriptions` | o texto de um arquivo de áudio | `transcrever` |
| `POST embeddings` | o vetor de um ou mais textos | `embeddings` |
| `GET models`, `GET models/<id>` | a lista, ou um item dela | `modelos`, `modelo` |

Um app escrito para o SDK da OpenAI ou da Anthropic aponta o endereço base para `_sdk/llm/v1` (ou,
no backend, `$VSSH_PORTAL_URL/api/llm/v1` com o `VSSH_PORTAL_TOKEN` como chave), e o resto do código
fica como está.

## Imagem e áudio na pergunta

As partes vão no formato da OpenAI, e o portal as repassa como vieram, até 25 MB por pedido:

```js
const pergunta = [
  { type: 'text', text: 'O que diz este gráfico?' },
  { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
];
const r = await llm.conversar({ model: 'glm53-flash', messages: [{ role: 'user', content: pergunta }] });
```

Escolha um modelo com `imagem: true` na lista. Um que não enxerga responde `imagem_nao_aceita`.

## Transcrever

```js
const { text } = await llm.transcrever(fs.readFileSync('entrevista.mp3'), { nome: 'entrevista.mp3', language: 'pt' });
```

Na janela, o corpo é um `FormData` com `model`, `file` e os campos da OpenAI, mandado a
`_sdk/llm/v1/audio/transcriptions`. Com `response_format: 'srt'` a resposta é a legenda em texto.

## Ferramentas

`tools` vai no pedido, e o laço é do seu app: o modelo pede, o app roda a ferramenta e devolve o
resultado numa mensagem `role: 'tool'`. Confira os argumentos antes de rodar: um modelo que chegou
ao `max_tokens` no meio deles termina com `finish_reason: 'length'` e deixa um JSON pela metade.
Devolva o erro ao modelo, como resultado da chamada, e ele pede de novo. Para conversar com as
ferramentas do app num agente que já faz esse laço, o caminho é o `agentes/v1`.

## Os erros

O corpo de um erro é o da OpenAI, com um `code` estável que o app traduz para a pessoa:
`teto_atingido` e `muitos_pedidos` (429, com `Retry-After`), `modelo_desconhecido` (404),
`modelo_fora_do_ar` e `sem_gateway` (503), `ferramentas_nao_aceitas` e `imagem_nao_aceita` (400),
`pedido_grande_demais` (413), `pedido_invalido` (400) e `sem_escopo` (403). Pela Messages, o erro
sai na forma da Anthropic. No `vssh.llm`, ele chega como `ErroDoLlm`, com `codigo`, `status` e o
`depoisDe` do `Retry-After`.

O uso de cada pessoa soma por app e por mês, e a administração do portal põe o teto dela. Uma
resposta sem fluxo que leve mais de 100 s é cortada no caminho; a conversa longa usa `stream`.
