# O banco do app

Ao terminar este guia você sabe guardar dados estruturados no backend do seu app, num banco SQLite
que o runtime abre e migra: declarar as migrações, ler e escrever, usar uma transação e oferecer
uma cópia para a pessoa exportar.

A peça é o módulo `banco` do runtime `vssh`, com a mesma API em Python e em Node. Ele chega aos
servidores com o portal que o traz (o runtime `1.1.0`); num servidor anterior, o import falha. No
Node o driver é o `node:sqlite`, do Node 22.5 em diante: o VSSH-Runtime do servidor traz um Node
que o tem, e na sua máquina vale o Node que você usa.

## Quando usar

O banco é para o que é registro: uma biblioteca, um catálogo, um histórico, o que você quer
buscar, ordenar e mudar junto. O que é arquivo (um índice gerado, um cache, uma miniatura)
continua no armazém privado do `vssh.dados`, e os arquivos da pessoa continuam com a
[File System Access](arquivos-com-consentimento.md).

O banco é um por pessoa e por app. Ele mora no diretório de dados do app
(`VSSH_APP_DATA_DIR`), que sobrevive a reinício e a reinstalação, e nasce fechado às outras
contas da estação.

## Abrir, e as migrações

```python
from vssh import banco

MIGRACOES = [
    'CREATE TABLE notas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, corpo TEXT NOT NULL)',
    'ALTER TABLE notas ADD COLUMN fixada INTEGER NOT NULL DEFAULT 0',
]
db = banco.abrir(migracoes=MIGRACOES)
```

```js
const { banco } = require('vssh');

const MIGRACOES = [
  'CREATE TABLE notas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, corpo TEXT NOT NULL)',
  'ALTER TABLE notas ADD COLUMN fixada INTEGER NOT NULL DEFAULT 0',
];
const db = banco.abrir({ migracoes: MIGRACOES });
```

A posição de cada migração na lista é a versão que ela deixa o banco. O banco guarda a versão em
que está, e `abrir` aplica o que falta, em ordem: um banco novo recebe as duas, e o de quem já
tinha a primeira recebe só a segunda. `db.versao` diz em qual ele está.

Uma migração é um texto de SQL, com um ou mais comandos, ou uma função que recebe o banco, para o
que o SQL sozinho não faz:

```python
def preencher_resumo(db):
    for nota in db.todas('SELECT id, corpo FROM notas'):
        db.executar('UPDATE notas SET resumo = ? WHERE id = ?', [nota['corpo'][:80], nota['id']])

MIGRACOES = [..., 'ALTER TABLE notas ADD COLUMN resumo TEXT', preencher_resumo]
```

Três regras, e o runtime cuida das duas primeiras:

- Cada migração vale inteira ou não vale. Ela roda numa transação com a mudança de versão, e a
  que falha deixa o banco na versão anterior. `abrir` lança o erro, e o backend não sobe com um
  esquema pela metade.
- Um banco mais novo que a lista não abre. Se a pessoa voltar a uma versão anterior do app,
  `abrir` lança `banco.BancoMaisNovo` em vez de escrever num esquema que aquela versão não
  conhece.
- Uma migração publicada não se edita. O banco de quem já a aplicou passou dela, e a edição só
  alcançaria quem instala depois: dois grupos de pessoas com esquemas diferentes na mesma
  versão. A correção é a migração seguinte.

## Ler e escrever

| | o que devolve |
|---|---|
| `db.executar(sql, parametros)` | `{mudancas, ultimo_id}`: quantas linhas mudaram, e o id da que entrou |
| `db.todas(sql, parametros)` | as linhas, cada uma como dicionário (objeto, no Node) |
| `db.uma(sql, parametros)` | a primeira linha, ou `None` (`null` no Node) |
| `db.valor(sql, parametros)` | a primeira coluna da primeira linha: uma contagem, um total |

Os parâmetros vão numa lista, para os `?`, ou num dicionário, para os `:nome`:

```python
nova = db.executar('INSERT INTO notas (titulo, corpo) VALUES (?, ?)', ['Compras', 'pão'])
db.todas('SELECT id, titulo FROM notas WHERE fixada = :fixada ORDER BY id', {'fixada': 0})
db.uma('SELECT * FROM notas WHERE id = ?', [nova['ultimo_id']])
db.valor('SELECT count(*) FROM notas')
```

```js
const nova = db.executar('INSERT INTO notas (titulo, corpo) VALUES (?, ?)', ['Compras', 'pão']);
db.todas('SELECT id, titulo FROM notas WHERE fixada = :fixada ORDER BY id', { fixada: 0 });
db.uma('SELECT * FROM notas WHERE id = ?', [nova.ultimo_id]);
db.valor('SELECT count(*) FROM notas');
```

O valor de quem digita vai sempre num parâmetro, e nunca colado no texto do SQL. Não há ORM nem
construtor de consulta: o SQL é o do seu app.

## Uma transação

O que precisa valer junto roda numa transação. Uma exceção desfaz tudo o que ela fez.

```python
with db.transacao():
    db.executar('UPDATE notas SET fixada = 1 WHERE id = ?', [nota])
    db.executar('DELETE FROM notas WHERE fixada = 0')
```

```js
db.transacao(() => {
  db.executar('UPDATE notas SET fixada = 1 WHERE id = ?', [nota]);
  db.executar('DELETE FROM notas WHERE fixada = 0');
});
```

Uma transação aberta dentro de outra é a mesma, e quem confirma ou desfaz é a de fora. No Node a
função é síncrona: uma promessa deixaria a transação aberta entre um pedido e outro, e o runtime
recusa.

No Python, o banco vale de qualquer thread do backend, uma operação por vez.

## A página não fala com o banco

A janela do app fala com o backend, e o backend fala com o banco. Uma rota para cada coisa que a
página precisa, com o SQL do lado de lá:

```python
if caminho == '/api/notas' and metodo == 'GET':
    self._json(200, {'notas': db.todas('SELECT id, titulo FROM notas ORDER BY id DESC LIMIT 50')})
```

Uma rota que aceitasse SQL da página entregaria o banco inteiro a qualquer defeito do frontend.

## A cópia para exportar

O banco mora na HOME da pessoa e entra na cópia de segurança que a HOME tiver. Para o app que
oferece exportar os dados, `copiar` escreve um banco inteiro e consistente num arquivo novo:

```python
db.copiar(os.path.join(pasta_escolhida, 'notas-exportadas.db'))
```

Copiar o arquivo `banco.db` à mão com o banco aberto pode levar uma página pela metade, porque
parte do que foi escrito ainda está no arquivo ao lado (`banco.db-wal`). `copiar` nunca passa por
cima de um arquivo que existe.

## Mais de um banco

`banco.abrir(nome='cache')` abre `cache.db` no mesmo diretório, com a lista de migrações dele. O
nome tem letras minúsculas, dígitos, `-` e `_`, e não sai do diretório de dados. O padrão é
`banco`.

## Na sua máquina e nos testes

Fora do servidor, o diretório de dados é `~/.vssh-apps/<id>/data`, ou o que `VSSH_APP_DATA_DIR`
disser. Um teste aponta a variável para uma pasta descartável e abre um banco novo a cada caso,
como o [`tests/template-banco.test.js`](../../tests/template-banco.test.js) faz com os templates.
`abrir` aceita `env`, para medir sem mexer no ambiente do processo.

Os dois templates trazem a peça "O banco do app" na galeria, com duas migrações e três rotas:
[`main.py`](../../templates/hello-vssh-app/backend/main.py) e
[`server.js`](../../templates/hello-vssh-app-node/backend/server.js).

## O que o runtime decide por você

- O diário em WAL: quem lê não espera quem escreve.
- Cinco segundos de espera por uma trava, antes de um erro de banco ocupado.
- As chaves estrangeiras ligadas.
- O arquivo com permissão só para a pessoa.
- Um banco estragado não é apagado nem refeito. São os dados da pessoa, e `abrir` lança o erro do
  SQLite para o app decidir o que dizer a ela.
