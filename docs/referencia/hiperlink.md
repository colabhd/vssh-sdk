# O manifesto de um hiperlink

> Página escrita no gerador do canal de publicação, a partir do que o portal lê do site de uma
> plataforma (`src/services/hiperlinks.ts` do `vssh-sso`). Uma mudança se faz lá, e aqui.

Um hiperlink é uma plataforma web que roda no domínio dela e entra no menu do ambiente pela URL. O
portal a conhece pelo manifesto PWA do site, lido quando o admin a cadastra no painel e quando
pede "Reler o manifesto"; o portal não relê sozinho. O passo a passo, do quadro à identidade, está
no guia [Uma plataforma como hiperlink](../guias/uma-plataforma-como-hiperlink.md).

Diferente do [`vssh-app.json`](manifesto.md), este manifesto não passa por schema nem por gate de
publicação. Um campo torto some sem erro e os vizinhos continuam valendo; só a falta de um
manifesto legível recusa o cadastro.

## Onde o portal procura

O admin cola um endereço `http` ou `https`, sem usuário nem senha, com até 2000 caracteres. O
portal o busca do servidor dele e tenta, nesta ordem:

| tentativa | quando vale |
|---|---|
| o próprio endereço | a resposta é JSON e é um manifesto |
| o `href` do `<link rel="manifest">` da página | a resposta é `text/html` com essa tag |
| `/manifest.webmanifest` na raiz da origem | as duas acima falharam, inclusive quando a página manda para o login |
| `/manifest.json` na raiz da origem | idem |

Um manifesto é um objeto JSON com `name` ou `short_name` em texto. O portal aceita o BOM na frente.

| limite | valor |
|---|---|
| prazo de cada pedido | 8 s |
| redirecionamentos na mesma origem | até 5; um salto para outra origem encerra a busca ali |
| a página | 512 KB |
| o manifesto | 128 KB |
| o ícone | 256 KB |

Sem manifesto legível, o cadastro responde `422` com o motivo, e `502` quando o site não respondeu.

## Os campos do manifesto PWA

| campo | o que o portal faz com ele |
|---|---|
| `name` | o nome no menu, até 80 caracteres |
| `short_name` | o nome quando `name` falta |
| `description` | a descrição, até 300 caracteres |
| `start_url` | a URL de início, resolvida contra o manifesto. Ela define a origem do hiperlink, e só vale na origem do manifesto; fora dela, ou sem ela, vale o endereço colado, e a raiz da origem do manifesto quando ele mora noutra origem que a do endereço |
| `scope` | o escopo, resolvido contra o manifesto e na origem dele; sem ele, o diretório da URL de início |
| `icons` | o ícone do menu, baixado pelo portal e servido da origem dele (ver [O ícone](#o-ícone)) |
| `shortcuts` | os atalhos do ícone, até dez (ver [Os atalhos](#os-atalhos)) |
| `theme_color` | a cor da plataforma, quando é `#` seguido de 3 a 8 dígitos hexadecimais |
| `categories` | a seção do menu, quando o membro `vssh` não traz `category` (ver [A seção do menu](#a-seção-do-menu)) |
| `vssh` | o que é do ambiente (ver [O membro `vssh`](#o-membro-vssh)) |

Os outros campos do padrão (`display`, `background_color`, `orientation`, `screenshots`) ficam de
fora: quem decide a moldura é a janela do ambiente.

### O ícone

O portal escolhe um item de `icons` com propósito `any` (um item sem `purpose` conta como `any`).
Um SVG, pelo `type` ou pela extensão, vence; sem SVG, vence o maior bitmap de até 512 px pelo
`sizes`, e um maior que 512 px perde para os menores. O `src` pode morar noutra origem, como um
CDN. A resposta precisa de um destes tipos: `image/png`, `image/svg+xml`, `image/webp`,
`image/jpeg`, `image/x-icon` ou `image/vnd.microsoft.icon`. Um ícone que não baixa deixa o
hiperlink sem ícone, e o cadastro segue.

O portal serve o ícone da origem dele porque uma plataforma com `Cross-Origin-Resource-Policy:
same-origin` não deixa um `<img>` de outra origem carregá-lo. O SVG sai com
`Content-Security-Policy: sandbox`, então ele desenha e não roda script.

### Os atalhos

Cada atalho precisa de `name` (até 80 caracteres) e de `url` na origem do manifesto; `description`
é opcional (até 200). Um atalho entra no botão direito do ícone da plataforma, ao lado de "Abrir", e abre a
janela no caminho dele, relativo à raiz da origem. Um atalho para a própria raiz
fica de fora, porque o menu já tem "Abrir".

### A seção do menu

Sem `vssh.category`, o portal usa a primeira categoria do W3C em `categories` que tem seção no menu:

| `categories` | seção |
|---|---|
| `books`, `education`, `kids` | `Education` |
| `business`, `finance`, `productivity` | `Office` |
| `entertainment`, `music` | `AudioVideo` |
| `photo` | `Graphics` |
| `games` | `Game` |
| `news`, `social` | `Network` |
| `navigation`, `utilities`, `weather` | `Utility` |
| `personalization` | `Settings` |
| `security` | `System` |
| `medical`, `health` | `Science` |

Uma plataforma sem seção cai em `Other`, como um app.

## O membro `vssh`

O que é do ambiente vai num membro `vssh` do mesmo manifesto, um objeto com os nomes e as formas
do `vssh-app.json`. O portal lê só os campos desta tabela, com as regras de um app:

| campo | forma | o mesmo que no `vssh-app.json` |
|---|---|---|
| `category` | texto, até 40 caracteres | [`category`](manifesto.md#category) |
| `window` | objeto (ver [A janela](#a-janela)) | [`window`](manifesto.md#window) |
| `provides` | lista de `nome/vN` | [`provides`](manifesto.md#provides) |
| `requires` | lista de `nome/vN` | [`requires`](manifesto.md#requires) |
| `usa` | lista de `nome/vN` | [`usa`](manifesto.md#usa) |
| `capacidades` | `{ "<nome/vN>": { "rota": "/prefixo", "rotulo": "..." } }`, só para o que está em `provides` | [`capacidades`](manifesto.md#capacidades) |
| `opens.urls` | lista de hosts | [`opens.urls`](manifesto.md#opensurls) |
| `contributes.contextMenu` | lista de itens | [`contributes.contextMenu`](manifesto.md#contributescontextmenu) |

Qualquer outro campo do `vssh-app.json` (`backend`, `secrets`, `recursos`, `motores`, `handles`, o
resto de `opens` e de `contributes`) não tem sentido num hiperlink, porque ele não tem processo na
estação, e o portal o ignora.

Uma capacidade com a forma errada sai da lista, e uma `rota` em `capacidades` fora do formato (um
`.` ou `..` como segmento, mais de 200 caracteres, uma capacidade que `provides` não declara) sai
também. O relé do `apps.pedir` só alcança as rotas que ficaram.

### A janela

| campo | valor aceito |
|---|---|
| `title` | texto, até 120 caracteres |
| `width` | inteiro de 200 a 10000 |
| `height` | inteiro de 150 a 10000 |
| `multiplasJanelas` | `true` ou `false` |
| `cabecalho` | `ambiente` ou `app` |
| `posicao` | `cascata` ou `centrada` |
| `minimos.largura` | inteiro de 400 a 10000 |
| `minimos.altura` | inteiro de 300 a 10000 |

Um valor fora da faixa some, e a janela usa o padrão do ambiente para aquela chave.

## Um exemplo

```json
{
  "name": "Cadernos",
  "short_name": "Cadernos",
  "description": "Os cadernos do laboratório.",
  "start_url": "/",
  "scope": "/",
  "icons": [{ "src": "/icone.svg", "type": "image/svg+xml", "sizes": "any" }],
  "shortcuts": [{ "name": "Projetos", "url": "/projetos" }],
  "theme_color": "#0f766e",
  "categories": ["education"],
  "vssh": {
    "category": "Science",
    "window": { "width": 1100, "height": 720, "minimos": { "largura": 640, "altura": 480 } },
    "provides": ["cadernos/v1"],
    "capacidades": { "cadernos/v1": { "rota": "/api/cadernos", "rotulo": "Importar no Cadernos" } },
    "opens": { "urls": ["cadernos.exemplo.org"] }
  }
}
```

Aqui a seção do menu é `Science`, porque `vssh.category` vence `categories`, e um link para
`cadernos.exemplo.org` clicado em qualquer janela do ambiente abre na janela da plataforma.
