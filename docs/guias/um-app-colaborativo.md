# Um app colaborativo

Ao terminar este guia, duas pessoas escrevem no mesmo documento do seu app ao mesmo tempo, cada uma
na própria estação, e veem o cursor uma da outra. A dona convida pelo nome, o convite chega ao sino
de quem foi convidada, e o documento continua editável com o portal fora do ar. O guia usa os
espaços `vssh.salas` e `vssh.pessoas`, sobre o Yjs que o seu app já carrega.

O Prelo (`colabhd/vsshapp-prelo`), um editor de documentos acadêmicos com ProseMirror e Yjs, é o
app de referência. Os trechos abaixo têm o tamanho de um exemplo, e o Prelo mostra o mesmo desenho
num app inteiro.

## A sala

A sala é o ponto de encontro de quem edita o mesmo documento, e mora no portal. O backend do seu
app roda na conta de uma pessoa, no servidor dela, e o proxy leva cada pessoa só ao próprio
backend: duas pessoas em estações diferentes só se encontram no portal. O portal faz o papel de
relé do Yjs. Ele recebe o que cada pessoa escreve, entrega às outras, confere o papel de cada uma e
grava o estado.

Toda sala pertence a um app e a uma dona. O seu app só alcança as salas dele, e a sala de outro app
responde como se não existisse. Cada sala tem dois canais, dois Y.Doc separados, e o papel decide
quem escreve em cada um:

| papel | `documento` | `comentarios` |
|---|---|---|
| dona | escreve | escreve |
| editar | escreve | escreve |
| comentar | lê | escreve |
| ver | lê | lê |

Quem não escreve num canal recebe tudo dele, e o portal descarta o que essa pessoa mandar. Todo
papel publica a presença (cursor, seleção, nome).

A página do app abre uma sala sem declarar nada no manifesto: o bilhete vem da sessão da pessoa,
pela ponte. A declaração `recursos.salas` serve ao backend, e está
[no fim do guia](#o-backend-na-sala).

## O Yjs vem do app

O SDK não carrega Yjs. Duas cópias do Yjs na mesma página brigam pelos tipos (um `Y.Text` de uma
não passa no `instanceof` da outra), e o seu editor já traz a dele, com o `y-prosemirror`, o
`y-codemirror` ou o binding que for. Você entrega ao SDK o `Y` e o `y-protocols/awareness` que o
editor usa, e o SDK fala com o portal por eles.

Um app não roda `npm install` no servidor. As bibliotecas da página viajam no pacote, montadas num
bundle; o Prelo as monta em `frontend/vendor/` com um script próprio. O `Y` do editor e o que o SDK
recebe precisam ser o mesmo objeto.

## Criar e entrar

```js
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

const sala = await vssh.salas.criar('Relatório de campo');   // a sala, com você de dona
const conexao = vssh.salas.entrar(sala.id, { Y, awarenessProtocol });

await conexao.sincronizado;   // o portal mandou o que já havia na sala
const texto = conexao.doc.getText('texto');
```

`entrar` liga um Y.Doc à sala e devolve a conexão na hora, sem esperar a rede. Sem a opção `doc`,
ele cria um documento novo; com ela, liga o que já existe, como o Y.Doc do seu editor. A conexão
tem:

| campo | o que é |
|---|---|
| `doc` | o Y.Doc ligado à sala |
| `presenca` | o `Awareness` da sala, quando você passou `awarenessProtocol` |
| `estado` | `conectando`, `sincronizado`, `fora`, `sem-acesso`, `apagada` ou `saiu` |
| `papel` | `dona`, `editar`, `comentar` ou `ver`, depois do primeiro bilhete |
| `podeEscrever` | se o papel escreve neste canal |
| `sincronizado` | uma promessa que resolve quando o portal manda o que já havia na sala |
| `aoMudar(cb)` | `cb({ estado, papel })` a cada mudança; devolve a função que cancela |
| `sair()` | fecha a conexão e grava a cópia local |

Os comentários moram no outro canal, e abrem outra conexão:
`vssh.salas.entrar(sala.id, { Y, canal: 'comentarios' })`. Um app sem comentários não abre esse
canal.

Guarde o id da sala junto do documento (num metadado do arquivo, no banco do app) para reabrir a
mesma sala depois. `vssh.salas.listar()` responde `{ salas }`: as salas deste app em que a pessoa
está, as dela e as que dividiram com ela, cada uma com o `papel`.

## O estado na tela

A pessoa precisa saber se o que escreve está chegando às outras. O `estado` cabe numa pílula ao
lado do título:

```js
const ROTULO = { conectando: 'Conectando', sincronizado: 'Sincronizado', fora: 'Sem conexão',
  'sem-acesso': 'Sem acesso', apagada: 'Documento apagado', saiu: 'Fechado' };

conexao.aoMudar(({ estado }) => {
  pilula.textContent = ROTULO[estado];
  editor.setEditable(conexao.podeEscrever);
});
```

O `fora` passa sozinho. A conexão tenta de novo com espera crescente até 30 s, e na hora em que a
rede volta, com um bilhete novo a cada tentativa. `sem-acesso` e `apagada` encerram a conexão: a
dona tirou a pessoa da sala (o portal fecha com 4403) ou apagou a sala (4410), e o SDK para de
tentar. O texto que já estava na tela continua lá, e o que a pessoa escrever depois fica só na
página dela.

Com o portal fora do ar, o documento continua editável. A conexão guarda uma cópia no IndexedDB,
com a pessoa na chave, e na volta o Yjs junta o que foi escrito dos dois lados sem conflito. Um
documento que já mora em outro lugar durável (o arquivo da dona, no Prelo) passa
`guardarLocal: false` e dispensa a cópia. A regra de fundo está em
[O que o sistema garante](../conceitos/o-que-o-sistema-garante.md): o que está na tela sobrevive a
uma queda do portal.

## Presença

Cada pessoa publica o próprio estado no `Awareness`, e o seu editor desenha o das outras. O SDK não
decide o formato. O `y-prosemirror` e o `y-codemirror` leem `user.name` e `user.color`:

```js
const eu = await vssh.pessoas.eu();   // { usuario, nome, login, iniciais, grupos }
conexao.presenca.setLocalState({ user: { name: eu.nome, color: corDe(eu.usuario), iniciais: eu.iniciais } });

conexao.presenca.on('change', () => {
  const outros = [...conexao.presenca.getStates()]
    .filter(([cliente]) => cliente !== conexao.doc.clientID)
    .map(([, s]) => s.user);
  desenharAvatares(outros);
});
```

Tire a cor do `usuario` por uma função fixa, e cada pessoa fica com a mesma cor em toda janela e em
toda estação. Quem cai sem fechar (a rede do laptop foi embora) sai da presença pelo batimento do
portal, em até um minuto.

## Convidar

A dona convida pelo nome. `vssh.pessoas.buscar(texto)` procura em nome e login, sem olhar acento, e
traz também os grupos do OIDC da própria dona que casam com o texto:

```js
const { pessoas, grupos } = await vssh.pessoas.buscar('ana sou');
// pessoas: [{ usuario, nome, login, iniciais }], grupos: [{ grupo, pessoas }]

await vssh.salas.darAcesso(sala.id, pessoas[0].usuario, 'editar');
await vssh.salas.darAcessoAoGrupo(sala.id, grupos[0].grupo, 'comentar');
```

`vssh.pessoas` nunca entrega o e-mail de ninguém. Dar acesso convida: a pessoa (ou cada pessoa do
grupo) recebe o convite no sino, com o texto do portal, e "Abrir" leva ao seu app com `?sala=<id>`
na URL. O portal não cria link nenhum, e quem não foi convidada não entra, mesmo com o id na mão.

`vssh.salas.ler(id)` responde `{ sala, pessoas, grupos }`, com a dona primeiro, para o diálogo de
compartilhar mostrar quem está. `darAcesso` com outro papel troca o papel, e a troca vale na hora
para quem está conectado. `tirarAcesso(id, usuario)` tira alguém. A dona tira qualquer pessoa, e
cada pessoa tira a si mesma, que é o "Sair do compartilhamento". Quem entrou também por um grupo
continua na sala depois de sair como pessoa, e o seu app diz isso a ela.

## Abrir pelo convite

O convite abre o app com `?sala=<id>`. A janela nova lê a rota na URL, e a janela que já estava
aberta recebe o evento `abertura` ([Uma janela](uma-janela.md#o-contexto-de-abertura)):

```js
function abrirPelaRota(busca) {
  const sala = new URLSearchParams(busca).get('sala');
  if (sala) abrirSala(sala);
}
abrirPelaRota(location.search);
vssh.app.ao('abertura', ({ rota }) => abrirPelaRota(rota || ''));
```

O aviso de um comentário acrescenta `&comentario=<ancora>`, e o app leva a pessoa até ele.

`vssh.salas.ao('mudaram', cb)` mantém a lista de documentos compartilhados em dia. O evento chega a
todas as janelas do app quando um convite chega, quando a pessoa sai ou é tirada de uma sala, e
quando uma sala muda de nome ou é apagada. Ele não traz a lista, e o app chama `listar` de novo:

```js
vssh.salas.ao('mudaram', async () => desenharCompartilhados((await vssh.salas.listar()).salas));
```

## Menção e resposta

Um comentário que menciona alguém, ou que responde a um comentário dela, avisa a pessoa pelo
portal:

```js
await vssh.salas.avisar(sala.id, 'mencao', [usuarioMencionado], comentario.id);
```

A `ancora` é o id do comentário (letras, dígitos, `_` e `-`, até 64), e o aviso abre o app em
`?sala=<id>&comentario=<ancora>`. O portal escreve o texto do aviso, e só quem está na sala o
recebe; um app não manda aviso livre a outra pessoa. A mesma âncora não avisa a mesma pessoa duas
vezes, e por isso repetir o pedido depois de uma falha não duplica nada.

## Figuras

Uma imagem não cabe no Y.Doc: cada byte dela iria para todas as pessoas a cada entrada e ficaria
para sempre no registro. O documento guarda o sha256, e os bytes vão para os anexos da sala, num S3
do portal, com cota por sala. O bilhete diz se o portal tem anexos ligados (`anexos: true`). Sem
eles, o documento compartilhado não oferece colar imagem.

A página não fala com o portal direto. No cliente de desktop cada app tem uma origem própria, e a
rota dos anexos pede a sessão da pessoa, que não viaja até lá. Quem envia e lê os anexos é o
backend do app, pela credencial dele, e a página pede ao próprio backend; o Prelo faz isso em
`backend/portal.js`.

## O backend na sala

O backend do app entra na sala como a pessoa dona dele: para gravar no arquivo dela o que as outras
escreveram, para exportar sem janela aberta, para mandar os anexos. Declare no manifesto:

```json
"recursos": { "salas": true }
```

A cada subida, o portal escreve `VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN` no ambiente do backend. Com
`Authorization: Bearer <VSSH_PORTAL_TOKEN>`, as rotas das salas agem como a pessoa, e só alcançam
as salas deste app. Do bilhete em diante o caminho é o da página:

```js
const base = process.env.VSSH_PORTAL_URL;
const r = await fetch(`${base}/api/salas/${id}/bilhete`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.VSSH_PORTAL_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ app: 'meu-app' }),   // o id do seu app, que precisa ser o da sala
});
const { bilhete, caminho } = await r.json();
const endereco = `${base.replace(/^http/, 'ws')}${caminho}/documento?bilhete=${encodeURIComponent(bilhete)}`;
```

No endereço, o backend fala o protocolo do y-websocket, com o mesmo Yjs da página. O bilhete vale
60 s e abre os dois canais nesse prazo; `{ bilhete: null }` diz que a pessoa não está mais na sala.
Os anexos vão por `PUT /api/salas/:id/anexos` com os bytes e o `Content-Type`, e voltam por
`GET /api/salas/:id/anexos/:sha`, com a mesma credencial.

Uma credencial sem o escopo das salas responde 403 nessas rotas, e isso acontece com um app que não
declarou `recursos.salas`.

## Onde cada coisa está

| para | leia |
|---|---|
| cada verbo das salas, com os argumentos e o que responde | [`vssh.salas`](../referencia/salas.md) |
| a busca de pessoas e grupos | [`vssh.pessoas`](../referencia/pessoas.md) |
| o campo `recursos.salas` | [O manifesto](../conceitos/o-manifesto.md) |
| a rota de abertura e o evento `abertura` | [Uma janela](uma-janela.md#o-contexto-de-abertura) |
