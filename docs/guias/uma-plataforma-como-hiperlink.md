# Uma plataforma como hiperlink

Ao terminar este guia, uma plataforma web que já roda no domínio dela, com servidor e login
próprios, aparece no menu do ambiente, abre numa janela e fala com o ambiente pela mesma ponte de
um vssh-app: avisos, diálogos, os arquivos que a pessoa escolhe, a cor de destaque. Ela continua
publicada como sempre foi, sem pacote e sem instalação numa estação.

O ambiente chama isso de hiperlink. É a família certa quando a plataforma já existe e serve muita
gente de um lugar só, como uma biblioteca de referências ou um hub de notebooks. Um app que roda
na estação da pessoa, como ela, continua sendo um [vssh-app](../conceitos/as-duas-familias.md).

## O manifesto

O ambiente lê o manifesto PWA do site: a página aponta para ele com `<link rel="manifest">`, ou ele
mora em `/manifest.webmanifest` ou `/manifest.json` na raiz da origem. Do manifesto saem o nome, a
descrição, a URL de início, o ícone, os atalhos e a cor. O que é do ambiente vai num membro `vssh`,
com os nomes e as formas do [`vssh-app.json`](../referencia/manifesto.md):

```json
{
  "name": "Cadernos",
  "description": "Os cadernos do laboratório.",
  "start_url": "/",
  "icons": [{ "src": "/icone.svg", "type": "image/svg+xml", "sizes": "any" }],
  "shortcuts": [{ "name": "Projetos", "url": "/projetos" }],
  "theme_color": "#0f766e",
  "vssh": {
    "category": "Office",
    "window": { "width": 1100, "height": 720 },
    "provides": [],
    "requires": [],
    "opens": { "urls": ["cadernos.exemplo.org"] }
  }
}
```

Os atalhos entram no botão direito do ícone, e só os da origem do manifesto. `opens.urls` faz um
link para aquele host, clicado em qualquer janela do ambiente, abrir na janela da plataforma. Um
campo do membro `vssh` fora da forma do `vssh-app.json` some sem erro, como num app.

Cada campo, com as faixas aceitas, a escolha do ícone, os tetos da busca e a tabela que leva as
`categories` do W3C a uma seção do menu, está na referência
[O manifesto de um hiperlink](../referencia/hiperlink.md).

## O quadro

A janela é um quadro do portal do ambiente, e a plataforma precisa aceitá-lo:

```
Content-Security-Policy: frame-ancestors https://<portal>
```

Com `frame-ancestors`, o navegador ignora o `X-Frame-Options`; sem ele, um `X-Frame-Options:
DENY` ou `SAMEORIGIN` recusa o quadro. O painel do admin mede isso e mostra numa pílula ao lado da
plataforma (abre no VSSH, recusa o quadro, pede login, sem resposta).

O cookie de sessão da plataforma acompanha o quadro quando a plataforma e o portal estão no mesmo
site, como `cadernos.exemplo.org` e `vssh.exemplo.org`. Em sites diferentes, o cookie precisa de
`SameSite=None; Secure`, e um navegador que bloqueia cookie de terceiros o recusa assim mesmo.

A página de login do provedor de identidade costuma recusar o quadro. Dentro da janela, a
plataforma recebe a pessoa pela ponte (ver [A identidade](#a-identidade)).

No cliente de desktop a janela não é um quadro: a plataforma abre num `<webview>`, como documento
de cima, numa partição só dos hiperlinks. Ali o `frame-ancestors` não se aplica, o cookie da
plataforma é de primeira parte, e a página de login do provedor abre dentro da janela. O SDK fala
com o shell pela ponte que o cliente põe na página (`window.vsshPonteDoCliente`), e a plataforma
não muda uma linha para isso. Cada mensagem leva a origem lida fora do alcance da página, e o shell
recusa o que não vem da origem da plataforma. Um `window.open` que o SDK não desviou vai ao
navegador do sistema, e o menu de reserva do cliente (recortar, copiar, colar) não abre num campo
da plataforma.

## O cadastro

O admin do ambiente cola a URL da plataforma na página Hiperlinks do painel: a página dela ou o
próprio manifesto. Quem busca é o servidor do portal, e um site sem manifesto legível é recusado
com o motivo. O id nasce ali, escolhido pelo admin ou tirado do primeiro rótulo do host (`cadernos`
de `cadernos.exemplo.org`), com a forma de um id de app e começando por letra. Numa estação com um
vssh-app instalado com o mesmo id, quem aparece é o app.

Depois o admin dá acesso aos vínculos (os grupos do provedor de identidade) que devem ver a
plataforma. Um hiperlink vale em toda estação, porque não depende de servidor Linux, e sem vínculo
nenhum só o admin o vê. Na ficha, ele preenche o slug da aplicação da plataforma no Authentik, que
a identidade confere. O ambiente relê o manifesto uma vez por dia, e "Reler o manifesto" refaz a
leitura na hora, depois de uma mudança no site. Um site fora do ar na releitura fica com a última
leitura boa, e a ficha diz quando a tentativa falhou e por quê.

A ficha mede, quando abre, se a página de início aceita o quadro. O portal a pede sem cookie e lê
os cabeçalhos pela regra do navegador:

| pílula | o que a plataforma respondeu |
|---|---|
| abre no VSSH | a página, com o portal no `frame-ancestors` ou sem recusa nenhuma |
| recusa o quadro | `X-Frame-Options: DENY` ou `SAMEORIGIN`, ou um `frame-ancestors` sem o portal |
| pede login | um redirecionamento para outra origem, que costuma ser o login da plataforma |
| sem resposta | nada, um 404 ou um 5xx |

## A janela

A pessoa abre a plataforma como abre um app: menu iniciar, Launchpad, barra, atalho na área de
trabalho, Alt+Tab. A janela carrega a URL da plataforma direto no navegador da pessoa, sem start,
sem stop e sem o proxy do portal no meio.

| pedido | para onde a janela vai |
|---|---|
| abrir | a URL de início |
| um atalho do manifesto | o caminho dele, na origem da plataforma |
| um link de um host de `opens.urls` | o link, quando ele é da origem da plataforma |
| qualquer um deles com a janela já aberta | a mesma janela navega até lá; sem destino próprio, ela fica onde está |

Um destino de outra origem nunca entra na janela. O menu do cabeçalho não tem "Ver log do backend"
nem "Permissões de arquivo", que são de um app com processo na estação, e tem "Abrir no navegador",
que leva o endereço da janela a uma aba fora do ambiente. Com a plataforma fora do ar, ou
recusando o quadro, a janela mostra a página de erro do próprio navegador e continua de pé.

## O SDK

A plataforma carrega o SDK web do portal, e não de uma cópia:

```html
<script src="https://<portal>/sdk/vssh.js"></script>
```

O portal serve `/sdk/<arquivo>` sem sessão, com `Cross-Origin-Resource-Policy: cross-origin` e
`Access-Control-Allow-Origin: *`, e com os mesmos bytes do `_sdk/` de um app. O cabeçalho é o que
deixa a página da plataforma carregar o script, e o CORS é o que deixa o `@font-face` do Tuff
buscar as fontes.

O SDK reconhece que veio de outra origem e, antes de falar a ponte, aperta a mão do shell: manda
uma mensagem ao quadro pai, com o alvo na origem do portal, e espera a resposta por até cinco
segundos. Até lá, `vssh.noAmbiente` é `false`, e as chamadas feitas esperam a resposta para seguir
pela ponte ou pelo equivalente do navegador. `vssh.pronto` resolve quando o SDK sabe:

```js
if (await vssh.pronto) {
  vssh.avisos.avisar('Projeto 7 sincronizado', 'Cadernos');
} else {
  // numa aba comum, ou num quadro de outro site
}
```

Com a resposta, o SDK passa a fazer o que faz num vssh-app: os links que iriam para uma aba nova
abrem no navegador do ambiente, o menu de contexto do navegador fica de fora (um campo editável o
mantém), o `document.title` vira o título da janela, e a mídia entra no mixer. Num quadro de outro
site, ou sem resposta, nada disso acontece, e a página segue como numa aba comum.

## O que a ponte alcança

Uma plataforma recebe a ponte de um vssh-app com um recorte. A [referência](../referencia/README.md)
diz, em cada verbo e em cada evento, se ele vale num hiperlink, e `vssh.app.capacidades()` devolve a
lista já recortada.

| fica de fora | por quê |
|---|---|
| `vssh.segredos` | o cofre vai para o processo do app na estação, e a plataforma não tem processo lá |
| `vssh.salas` | o provedor abre o WebSocket na origem do portal, e a plataforma tem backend próprio |
| `vssh.configuracoes` | a seção de um app em Configurações roda o script dele no shell |
| `vssh.gpu` | a GPU é da estação |
| a área de transferência de arquivos | ela tem os caminhos que a pessoa copiou, sem passar pelo seletor |

Um verbo fora do recorte responde com a promessa rejeitada, e a mensagem do erro é o motivo.

## A identidade

`vssh.app.identidade()` responde `{ bilhete, expira }`: um JWT que o portal assina para a origem da
plataforma, com a pessoa dentro. A página o entrega ao backend dela, que o confere e abre a sessão
própria, no lugar do redirecionamento ao login:

```js
if (await vssh.pronto) {
  const { bilhete } = await vssh.app.identidade();
  // A rota de entrada é da plataforma, com o nome que ela quiser.
  const r = await fetch('/api/auth/vssh', { method: 'POST', headers: { authorization: `Bearer ${bilhete}` } });
  if (r.ok) location.reload();
}
```

O backend confere o bilhete como confere o `id_token` do provedor, pela chave pública do portal em
`https://<portal>/.well-known/jwks.json`:

| o que conferir | valor |
|---|---|
| a assinatura | RS256, com a chave do `kid` do cabeçalho |
| `typ` no cabeçalho | `vssh-bilhete+jwt`, para um bilhete nunca passar por `id_token` |
| `iss` | a origem do portal |
| `aud` | a origem da plataforma |
| `exp` | 60 s depois do `iat` |
| `jti` | guardado até o `exp`, para recusar o mesmo bilhete duas vezes |

O `sub` é o `uid` do Authentik, o mesmo que o login da plataforma recebe quando o provedor dela usa
o modo `hashed_user_id`; com ele, a sessão aberta pelo bilhete é a da mesma pessoa. O bilhete traz
também `email`, `name`, `preferred_username` e `groups`.

O portal só emite para quem vê o hiperlink e passa na política da aplicação da plataforma no
Authentik, a mesma que o login confere. Fora do ambiente, `identidade()` recusa, e a plataforma
segue com o login dela. Dentro dele, a promessa rejeitada traz o motivo:

| recusa | quando |
|---|---|
| `404` | a pessoa não vê o hiperlink |
| `403` | a política da aplicação no Authentik não deixa a pessoa entrar |
| `409` | a ficha não tem o slug da aplicação |
| `503` | falta ao portal a chave do bilhete, o endereço ou o token do Authentik, ou o Authentik não respondeu em 4 s |

Uma conta de serviço não recebe bilhete.

## Oferecer uma capacidade

Uma plataforma oferece uma capacidade como um app oferece (ver [chamar outro
app](chamar-outro-app.md)), com `provides` e `capacidades` no membro `vssh`. O pedido de outro app
chega do servidor do portal, com o bilhete da pessoa no `Authorization` e o id de quem pediu em
`X-Vssh-Chamador`, só nas rotas debaixo do prefixo declarado. O backend confere o bilhete como na
entrada, e responde como responderia à própria página. A resposta volta a quem pediu como a de um
app: status, tipo e corpo. Como o pedido sai do servidor do portal, a plataforma não precisa de
CORS para ele.

| o relé | valor |
|---|---|
| métodos | `GET`, `POST`, `PUT`, `PATCH` e `DELETE`; outro responde `405` |
| caminho | só debaixo dos prefixos de `capacidades`, conferido depois de resolver `..` e `%2e%2e`; fora deles, `403` |
| prazo | 30 s, e `504` quando passa; `502` quando a plataforma não responde |
| resposta | até 10 MB |
| corpo JSON | até 100 kB, o teto dos parsers do portal |

## Arquivos

A plataforma alcança o que a pessoa escolhe no seletor, e só isso. Escolher concede o caminho, como
num app (ver [consentimento](../conceitos/consentimento.md)), e os verbos de abrir, abrir com,
abrir a pasta, arrastar, copiar e imprimir também pedem um caminho concedido:

```js
const caminho = await vssh.arquivos.escolherArquivo('Importar caderno', 'Notebooks (*.ipynb)');
if (caminho) {
  const texto = await vssh.arquivos.ler(caminho);
  importar(texto);
  vssh.arquivos.abrirPasta(caminho.replace(/\/[^/]+$/, ''));
}
```

O arquivo vem pela ponte, do servidor da pessoa, para a página. O backend da plataforma não alcança
a estação; quem leva os bytes até ele é a página, se for o caso.

Duas coisas de um vssh-app ficam de fora. `vssh.arquivos.urlFor` lança, porque o portal só serve o
arquivo à origem dele: leia com `lerBytes` e monte o `Blob` na página. E o SDK não troca a API de
arquivos do navegador: `showOpenFilePicker` e `showDirectoryPicker` continuam abrindo o computador
da pessoa, como em qualquer site.

## A aparência

O Tuff vem do mesmo lugar que o SDK, `https://<portal>/sdk/tuff/<arquivo>`, com as folhas, as
fontes e os ícones de [`_sdk/tuff/`](../aparencia/o-tuff.md). A cor de destaque que a pessoa
escolheu chega pela ponte, e `vssh.aparencia` a entrega como entrega a um app:

```js
const pintar = (tokens) => {
  for (const [nome, valor] of Object.entries(tokens || {})) document.documentElement.style.setProperty(nome, valor);
};
vssh.pronto.then(() => pintar(vssh.aparencia.tokens()));
vssh.aparencia.aoMudar(pintar);
```

`aoMudar` chama de volta também quando o aperto de mão traz a cor, depois da carga.

## A ajuda

A plataforma pode trazer a ajuda dela para a Ajuda do ambiente, como um livro com o nome dela, e o
F1 na janela abre o tópico de entrada. Os tópicos têm o formato da [ajuda de um
app](ajuda.md) e moram numa pasta do repositório da plataforma; o manifesto aponta o arquivo
compilado e o tópico de entrada:

```json
"vssh": {
  "provides": ["bibliography/v1"],
  "contributes": { "ajuda": { "url": "ajuda.json", "inicio": "comecar" } }
}
```

O build da plataforma escreve o `ajuda.json` com o compilador deste repositório, a partir da pasta
`ajuda/` ao lado do manifesto, e o publica junto do site:

```bash
node scripts/compilar-ajuda.mjs --hiperlink public/manifest.webmanifest --saida public/ajuda.json
```

O compilador recusa um tópico fora do formato com o arquivo e a linha, como no publish de um app, e
o arquivo leva as fontes junto. O portal lê o `ajuda.json` com o manifesto e compila a ajuda de novo
a partir das fontes, com os tópicos do ambiente; uma ajuda que não compila ali fica de fora, e a
ficha do painel diz o motivo. As superfícies que o `cobre` nomeia são a janela, os itens de
`contributes.contextMenu` e as capacidades de `provides` e `usa`.

Um passo que aponta um controle da plataforma (`> mostrar <alvo>`, com o `alvos.json` da pasta) é
achado pelo SDK web dentro da janela. Numa plataforma que não carrega o SDK, o passo cerca a janela
inteira.

## Testar

Abra a plataforma numa aba comum: `await vssh.pronto` dá `false`, e cada verbo cai no equivalente
do navegador ou numa recusa, sem lançar na carga. Dentro do ambiente, o console do quadro mostra a
ponte: um verbo recusado pelo recorte responde com o motivo, e um que o shell não conhece também.
