# Um comando no terminal

Ao terminar este guia, quem instala o seu app tem um comando dele no Terminal do ambiente:
`hello-world` escreve a hora que o backend do app respondeu, e um comando com `menu` abre pelo menu
iniciar numa aba do Terminal. Os dois templates trazem o comando pronto, em `bin/hello.py` e
`bin/hello.mjs`, e a galeria mostra o que ele escreve na peça "Comando".

## No manifesto

```json
"contributes": {
  "comandos": [
    { "nome": "hello-world", "roda": "bin/hello.py", "backend": true,
      "descricao": "Pergunta a hora ao backend deste app e a escreve." }
  ]
}
```

| campo | o que ele diz |
|---|---|
| `nome` | o que a pessoa digita: letras minúsculas, dígitos e hífen, de 2 a 32, começando por letra |
| `roda` | o arquivo do pacote que o comando executa, relativo à raiz do app |
| `descricao` | a linha que `vssh comandos` mostra ao lado do nome |
| `backend` | `true` quando o comando conversa com o backend do app |
| `menu` | `{ "titulo": "…" }` quando o comando é um programa de terminal, com uma entrada no menu iniciar |

Um app declara até 16 comandos. O `vssh-app-publish` recusa um nome que começa com `vssh`, que é o
prefixo dos comandos do sistema, um nome repetido no mesmo app, e um `roda` que não está no pacote.

## O que acontece na estação

O ambiente põe os comandos dos apps que a pessoa tem instalados numa pasta dela, no fim do PATH do
Terminal, e os tira quando ela desinstala o app. Um comando do seu app nunca encobre um da estação
nem um que a pessoa pôs no próprio PATH: um nome que a estação já usa fica de fora, e entre dois
apps com o mesmo nome fica o de id menor. Por isso os dois templates usam o id do app como nome do
comando, e é o que convém a um app com um comando só.

O arquivo de `roda` roda com o interpretador do VSSH-Runtime, o mesmo do backend: um `.py` no Python
dele, um `.js`, `.mjs` ou `.cjs` no Node dele, e qualquer outro arquivo como executável. O processo
recebe `VSSH_APP_ID`, `VSSH_APP_DATA_DIR` e o runtime `vssh` no caminho de import, como o backend.

Com `"backend": true`, o comando recebe também `VSSH_APP_SOCKET` e `VSSH_APP_TOKEN`, e um backend
parado é ligado antes, com a espera pelo healthcheck até 20 s. Passado o teto, o comando sai com o
código 3 e diz onde está o log do app.

## Conversar com o backend

O `servidor.pedir` do runtime faz o pedido ao backend do próprio app, pelo socket e com o token:

```python
from vssh import servidor

status, cabecalhos, corpo = servidor.pedir('/api/ping')
```

```js
const { servidor } = require('vssh');

const { status, cabecalhos, corpo } = await servidor.pedir('/api/ping');
```

Um objeto ou uma lista no corpo vai como JSON, com os separadores compactos dos dois runtimes. A
resposta traz o status, os cabeçalhos com o nome em minúsculas e os bytes do corpo.

## O `--help` e os códigos de saída

O `--help` é do seu comando: o ambiente só o põe no PATH. O dos templates escreve a linha de uso e
uma frase, e os códigos de saída seguem os do `vssh`: 0 feito, 1 o backend respondeu com erro, 2 uso
errado, 3 sem backend. Um script da pessoa encadeia o seu comando com `&&` contando com eles.

## Um programa de terminal no menu

Um comando com `menu` ganha uma entrada no menu iniciar, com o `titulo` dele e o ícone e a categoria
do app. O clique abre uma aba do Terminal que roda o programa no lugar do shell, e a aba termina
quando ele sai. É o lugar de um programa de tela cheia, feito com `curses`, `textual` ou `ink`.

## O servidor MCP

Um app pode dar ferramentas aos agentes da pessoa: o Claude Code, o Codex e o Gemini CLI no
Terminal, e o agente que outro app abre. O servidor é um programa que fala o MCP pela entrada e pela
saída, e o manifesto o declara em `contributes.mcp`, um por app:

```json
"contributes": {
  "mcp": { "roda": "bin/mcp.py", "backend": true, "descricao": "Pergunta a hora ao backend deste app." }
}
```

A estação o sobe por `vssh-app-comando <app> --mcp`, com as regras de um comando: o interpretador do
runtime, as mesmas variáveis e, com `"backend": true`, o socket e o token, com o backend ligado antes.
A pessoa o põe no agente dela com `vssh mcp adicionar <app>`, que roda o `mcp add` do agente; o nome
do servidor é o id do app. A `descricao` aparece no `vssh mcp` e no pedido de permissão, e diz o que
as ferramentas alcançam. O publish recusa um `roda` que não está no pacote.

O protocolo por stdio é uma linha JSON-RPC por mensagem, e o runtime não traz uma biblioteca para
ele. Os dois templates o escrevem inteiro em `bin/mcp.py` e `bin/mcp.mjs`, com o `initialize`, o
`tools/list` e o `tools/call` de uma ferramenta só, `hora`, que pergunta ao backend pelo
`servidor.pedir`. Uma notificação (a mensagem sem `id`) não leva resposta. O agente usa as
ferramentas como a pessoa e manda ao fornecedor dele o que elas leram.

## Testar fora do ambiente

Fora da estação ninguém liga o backend nem monta o ambiente do comando, e a bancada faz as duas
coisas: sobe o backend num socket, com um token, e roda o comando com as mesmas duas variáveis.

```bash
export VSSH_APP_SOCKET=/tmp/hello.sock VSSH_APP_TOKEN=bancada VSSH_APP_ID=hello-world
source scripts/ambiente-de-dev.sh
python3 templates/hello-vssh-app/backend/main.py &
python3 templates/hello-vssh-app/bin/hello.py
```

`tests/template-comando.test.js` é essa bancada, para os dois templates: a hora que o backend
respondeu, o `--json`, o token recusado e a saída 3 sem backend.
