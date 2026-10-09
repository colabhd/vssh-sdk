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

A página de login do provedor de identidade costuma recusar o quadro. A pessoa entra uma vez pelo
"Abrir no navegador" do menu da janela, e a sessão que ela abriu ali vale para o quadro no mesmo
site. A ponte ainda não entrega a identidade da pessoa à plataforma.

## O cadastro

O admin do ambiente cola a URL da plataforma na página Hiperlinks do painel e dá acesso aos
vínculos (os grupos do provedor de identidade) que devem vê-la. "Reler o manifesto" refaz a
leitura depois de uma mudança no site; o ambiente não relê sozinho.

## O SDK

A plataforma carrega o SDK web do portal, e não de uma cópia:

```html
<script src="https://<portal>/sdk/vssh.js"></script>
```

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

## Testar

Abra a plataforma numa aba comum: `await vssh.pronto` dá `false`, e cada verbo cai no equivalente
do navegador ou numa recusa, sem lançar na carga. Dentro do ambiente, o console do quadro mostra a
ponte: um verbo recusado pelo recorte responde com o motivo, e um que o shell não conhece também.
