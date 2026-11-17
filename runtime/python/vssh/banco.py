"""
O banco do app: um SQLite por pessoa e por app, no diretório de dados, com as migrações.

`app.dados()` diz onde o app guarda o que não pode perder; este módulo abre ali um banco SQLite
com as decisões que todo app tomaria de novo (o diário em WAL, a espera por uma trava, as chaves
estrangeiras ligadas, o arquivo fechado às outras contas) e aplica as migrações que o app declara,
sempre para a frente.

    from vssh import banco

    MIGRACOES = [
        'CREATE TABLE notas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, corpo TEXT NOT NULL)',
        'ALTER TABLE notas ADD COLUMN fixada INTEGER NOT NULL DEFAULT 0',
    ]
    db = banco.abrir(migracoes=MIGRACOES)

    nova = db.executar('INSERT INTO notas (titulo, corpo) VALUES (?, ?)', ['Compras', 'pão'])
    db.todas('SELECT id, titulo FROM notas WHERE fixada = :fixada', {'fixada': 0})
    db.uma('SELECT * FROM notas WHERE id = ?', [nova['ultimo_id']])
    db.valor('SELECT count(*) FROM notas')

    with db.transacao():
        db.executar('UPDATE notas SET fixada = 1 WHERE id = ?', [1])
        db.executar('DELETE FROM notas WHERE fixada = 0')

O par em Node (`banco.js`) tem os mesmos nomes e responde igual. O arquivo é o mesmo nos dois: um
banco que um backend em Python criou abre num backend em Node.

── As migrações ──────────────────────────────────────────────────────────────────────────────

`migracoes` é uma lista, e a posição de cada item é a versão que ele deixa o banco. Um item é um
texto de SQL, com um ou mais comandos, ou uma função que recebe o banco. O banco guarda a versão
em que está (`PRAGMA user_version`), e `abrir` aplica o que falta, em ordem. Cada migração roda
numa transação com a mudança de versão: a que falha não deixa nada pela metade, o banco fica na
versão anterior, e `abrir` lança.

Uma migração que já foi publicada não se edita: o banco de quem a aplicou já passou dela, e a
correção é a migração seguinte. Um banco mais novo que a lista (o app voltou a uma versão
anterior) não abre: `abrir` lança `BancoMaisNovo`, em vez de escrever num esquema que não conhece.

── O que fica com o app ──────────────────────────────────────────────────────────────────────

O frontend não fala com o banco: ele fala com o backend do app, que decide o que cada rota lê e
escreve. Não há ORM nem construtor de consulta, e o SQL é o do app.

O banco mora na HOME da pessoa, e entra na cópia de segurança que a HOME tiver. `copiar(destino)`
escreve uma cópia inteira e consistente num arquivo novo (`VACUUM INTO`), para o app que oferece
exportar os dados: copiar o arquivo com o banco aberto pode levar uma página pela metade.

Um banco estragado não é apagado nem refeito: são os dados da pessoa, e `abrir` lança o erro do
SQLite.
"""

import contextlib
import os
import re
import sqlite3
import threading

from . import app

_NOME = re.compile(r'^[a-z0-9][a-z0-9_-]{0,31}$')
ESPERA_MS = 5000


class BancoMaisNovo(Exception):
    """O banco está numa versão que a lista de migrações deste app não alcança."""


def caminho(nome='banco', env=None):
    """Onde o banco `nome` do app mora: `<diretório de dados>/<nome>.db`."""
    if not isinstance(nome, str) or not _NOME.match(nome):
        raise ValueError('o nome do banco tem de 1 a 32 letras minúsculas, dígitos, "-" ou "_"')
    return os.path.join(app.dados(env), nome + '.db')


class Banco:
    """Um banco aberto. As operações valem de qualquer thread do backend, uma por vez."""

    def __init__(self, arquivo):
        self.caminho = arquivo
        self._tranca = threading.RLock()
        self._fundo = 0     # quantas `transacao()` estão abertas, uma dentro da outra
        self._con = sqlite3.connect(arquivo, isolation_level=None, check_same_thread=False,
                                    timeout=ESPERA_MS / 1000)
        self._con.row_factory = sqlite3.Row
        self._con.execute('PRAGMA journal_mode = WAL')
        self._con.execute('PRAGMA synchronous = NORMAL')
        self._con.execute('PRAGMA foreign_keys = ON')
        self._con.execute('PRAGMA busy_timeout = %d' % ESPERA_MS)

    @property
    def versao(self):
        """A versão em que o banco está: quantas migrações ele já recebeu."""
        with self._tranca:
            return self._con.execute('PRAGMA user_version').fetchone()[0]

    def executar(self, sql, parametros=()):
        """Roda um comando que escreve. Devolve `{mudancas, ultimo_id}`."""
        with self._tranca:
            cursor = self._con.execute(sql, parametros)
            return {'mudancas': cursor.rowcount, 'ultimo_id': cursor.lastrowid}

    def todas(self, sql, parametros=()):
        """As linhas de uma consulta, cada uma como dicionário."""
        with self._tranca:
            return [dict(linha) for linha in self._con.execute(sql, parametros).fetchall()]

    def uma(self, sql, parametros=()):
        """A primeira linha de uma consulta, como dicionário, ou `None`."""
        with self._tranca:
            linha = self._con.execute(sql, parametros).fetchone()
            return dict(linha) if linha is not None else None

    def valor(self, sql, parametros=()):
        """A primeira coluna da primeira linha, ou `None`: uma contagem, um total."""
        with self._tranca:
            linha = self._con.execute(sql, parametros).fetchone()
            return linha[0] if linha is not None else None

    @contextlib.contextmanager
    def transacao(self):
        """Tudo o que roda dentro do `with` vale junto ou não vale: uma exceção desfaz. Uma
        transação aberta dentro de outra é a mesma, e quem confirma ou desfaz é a de fora."""
        with self._tranca:
            if self._fundo == 0:
                self._con.execute('BEGIN IMMEDIATE')
            self._fundo += 1
            try:
                yield self
            except BaseException:
                self._fundo -= 1
                if self._fundo == 0 and self._con.in_transaction:
                    self._con.execute('ROLLBACK')
                raise
            else:
                self._fundo -= 1
                if self._fundo == 0:
                    self._con.execute('COMMIT')

    def copiar(self, destino):
        """Escreve em `destino` uma cópia inteira e consistente do banco. O arquivo não pode
        existir: a cópia nunca passa por cima de outra."""
        destino = os.fspath(destino)
        if os.path.lexists(destino):
            raise FileExistsError('já existe um arquivo em %s' % destino)
        with self._tranca:
            self._con.execute('VACUUM INTO ?', (destino,))
        return destino

    def fechar(self):
        with self._tranca:
            self._con.close()

    def _migrar(self, migracoes):
        atual = self.versao
        if atual > len(migracoes):
            raise BancoMaisNovo('o banco está na versão %d, e este app conhece até a %d' % (atual, len(migracoes)))
        for numero in range(atual + 1, len(migracoes) + 1):
            passo = migracoes[numero - 1]
            with self._tranca:
                self._con.execute('BEGIN IMMEDIATE')
                self._fundo += 1    # a função de migração pode abrir `transacao()`: é esta
                try:
                    if callable(passo):
                        passo(self)
                    else:
                        for comando in _comandos(passo):
                            self._con.execute(comando)
                    self._con.execute('PRAGMA user_version = %d' % numero)
                    self._con.execute('COMMIT')
                except BaseException:
                    if self._con.in_transaction:
                        self._con.execute('ROLLBACK')
                    raise
                finally:
                    self._fundo -= 1


def _comandos(sql):
    """Os comandos de um texto de SQL, um por vez. O `executescript` do `sqlite3` confirmaria a
    transação em curso antes de rodar, e a migração deixaria de valer inteira ou nada."""
    comando = ''
    for linha in str(sql).splitlines(keepends=True):
        comando += linha
        if sqlite3.complete_statement(comando):
            if comando.strip().strip(';').strip():
                yield comando
            comando = ''
    if comando.strip().strip(';').strip():
        yield comando


def abrir(migracoes=(), nome='banco', env=None):
    """Abre o banco `nome` do app, criando-o se for o caso, e aplica as migrações que faltam."""
    arquivo = caminho(nome, env)
    os.makedirs(os.path.dirname(arquivo), exist_ok=True)
    # O arquivo nasce fechado às outras contas da estação, antes de o SQLite o abrir.
    os.close(os.open(arquivo, os.O_RDWR | os.O_CREAT, 0o600))
    db = Banco(arquivo)
    try:
        db._migrar(list(migracoes))
    except BaseException:
        db.fechar()
        raise
    return db
