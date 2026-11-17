'use strict';

// O banco do app: um SQLite por pessoa e por app, no diretório de dados, com as migrações.
//
// `app.dados()` diz onde o app guarda o que não pode perder; este módulo abre ali um banco SQLite
// com as decisões que todo app tomaria de novo (o diário em WAL, a espera por uma trava, as chaves
// estrangeiras ligadas, o arquivo fechado às outras contas) e aplica as migrações que o app
// declara, sempre para a frente.
//
//   const { banco } = require('vssh');
//
//   const MIGRACOES = [
//     'CREATE TABLE notas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, corpo TEXT NOT NULL)',
//     'ALTER TABLE notas ADD COLUMN fixada INTEGER NOT NULL DEFAULT 0',
//   ];
//   const db = banco.abrir({ migracoes: MIGRACOES });
//
//   const nova = db.executar('INSERT INTO notas (titulo, corpo) VALUES (?, ?)', ['Compras', 'pão']);
//   db.todas('SELECT id, titulo FROM notas WHERE fixada = :fixada', { fixada: 0 });
//   db.uma('SELECT * FROM notas WHERE id = ?', [nova.ultimo_id]);
//   db.valor('SELECT count(*) FROM notas');
//
//   db.transacao(() => {
//     db.executar('UPDATE notas SET fixada = 1 WHERE id = ?', [1]);
//     db.executar('DELETE FROM notas WHERE fixada = 0');
//   });
//
// O par em Python (`banco.py`) tem os mesmos nomes e responde igual. O arquivo é o mesmo nos dois:
// um banco que um backend em Node criou abre num backend em Python.
//
// ── O Node que isto pede ────────────────────────────────────────────────────────────────────
//
// O driver é o `node:sqlite`, que existe a partir do Node 22.5. O VSSH-Runtime traz um Node que o
// tem, e o `vssh-app-run` sobe o backend com ele. Num Node mais velho, `abrir` lança dizendo isso,
// e o resto do pacote `vssh` continua carregando: o driver só é pedido aqui.
//
// ── As migrações ────────────────────────────────────────────────────────────────────────────
//
// `migracoes` é uma lista, e a posição de cada item é a versão que ele deixa o banco. Um item é um
// texto de SQL, com um ou mais comandos, ou uma função que recebe o banco. O banco guarda a versão
// em que está (`PRAGMA user_version`), e `abrir` aplica o que falta, em ordem. Cada migração roda
// numa transação com a mudança de versão: a que falha não deixa nada pela metade, o banco fica na
// versão anterior, e `abrir` lança.
//
// Uma migração que já foi publicada não se edita: o banco de quem a aplicou já passou dela, e a
// correção é a migração seguinte. Um banco mais novo que a lista (o app voltou a uma versão
// anterior) não abre: `abrir` lança `BancoMaisNovo`, em vez de escrever num esquema que não
// conhece.
//
// ── O que fica com o app ────────────────────────────────────────────────────────────────────
//
// O frontend não fala com o banco: ele fala com o backend do app, que decide o que cada rota lê e
// escreve. Não há ORM nem construtor de consulta, e o SQL é o do app.
//
// O banco mora na HOME da pessoa, e entra na cópia de segurança que a HOME tiver.
// `copiar(destino)` escreve uma cópia inteira e consistente num arquivo novo (`VACUUM INTO`), para
// o app que oferece exportar os dados: copiar o arquivo com o banco aberto pode levar uma página
// pela metade.
//
// Um banco estragado não é apagado nem refeito: são os dados da pessoa, e `abrir` lança o erro do
// SQLite.

const fs = require('node:fs');
const path = require('node:path');
const app = require('./app.js');

const NOME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ESPERA_MS = 5000;

/** O banco está numa versão que a lista de migrações deste app não alcança. */
class BancoMaisNovo extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'BancoMaisNovo';
  }
}

function driver() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch {
    const erro = new Error(`vssh.banco pede o Node 22.5 ou mais novo, e este é o ${process.version}. O VSSH-Runtime traz o Node certo.`);
    erro.code = 'SEM_SQLITE';
    throw erro;
  }
}

/** Onde o banco `nome` do app mora: `<diretório de dados>/<nome>.db`. */
function caminho(nome = 'banco', env) {
  if (typeof nome !== 'string' || !NOME.test(nome)) {
    throw new Error('o nome do banco tem de 1 a 32 letras minúsculas, dígitos, "-" ou "_"');
  }
  return path.join(app.dados(env), `${nome}.db`);
}

/** Os parâmetros como o `node:sqlite` os recebe: os posicionais espalhados, os nomeados num objeto. */
const args = (parametros) => (parametros === undefined || parametros === null ? []
  : Array.isArray(parametros) ? parametros : [parametros]);

/** Um banco aberto. */
class Banco {
  constructor(arquivo) {
    const DatabaseSync = driver();
    this.caminho = arquivo;
    this._fundo = 0;      // quantas `transacao()` estão abertas, uma dentro da outra
    this._con = new DatabaseSync(arquivo);
    this._con.exec('PRAGMA journal_mode = WAL');
    this._con.exec('PRAGMA synchronous = NORMAL');
    this._con.exec('PRAGMA foreign_keys = ON');
    this._con.exec(`PRAGMA busy_timeout = ${ESPERA_MS}`);
  }

  /** A versão em que o banco está: quantas migrações ele já recebeu. */
  get versao() {
    return Number(this._con.prepare('PRAGMA user_version').get().user_version);
  }

  /** Roda um comando que escreve. Devolve `{mudancas, ultimo_id}`. */
  executar(sql, parametros) {
    const r = this._con.prepare(sql).run(...args(parametros));
    return { mudancas: Number(r.changes), ultimo_id: Number(r.lastInsertRowid) };
  }

  /** As linhas de uma consulta, cada uma como objeto. */
  todas(sql, parametros) {
    return this._con.prepare(sql).all(...args(parametros)).map((linha) => ({ ...linha }));
  }

  /** A primeira linha de uma consulta, como objeto, ou `null`. */
  uma(sql, parametros) {
    const linha = this._con.prepare(sql).get(...args(parametros));
    return linha === undefined ? null : { ...linha };
  }

  /** A primeira coluna da primeira linha, ou `null`: uma contagem, um total. */
  valor(sql, parametros) {
    const linha = this._con.prepare(sql).get(...args(parametros));
    if (linha === undefined) return null;
    const colunas = Object.values(linha);
    return colunas.length ? colunas[0] : null;
  }

  /**
   * Tudo o que `fn` faz vale junto ou não vale: uma exceção desfaz. Uma transação aberta dentro
   * de outra é a mesma, e quem confirma ou desfaz é a de fora. Devolve o que `fn` devolveu. `fn`
   * é síncrona: uma promessa deixaria a transação aberta entre um pedido e outro.
   */
  transacao(fn) {
    if (this._fundo === 0) this._con.exec('BEGIN IMMEDIATE');
    this._fundo += 1;
    let saida;
    try {
      saida = fn(this);
      if (saida && typeof saida.then === 'function') throw new Error('a função de uma transação é síncrona');
    } catch (erro) {
      this._fundo -= 1;
      if (this._fundo === 0 && this._con.isTransaction) this._con.exec('ROLLBACK');
      throw erro;
    }
    this._fundo -= 1;
    if (this._fundo === 0) this._con.exec('COMMIT');
    return saida;
  }

  /**
   * Escreve em `destino` uma cópia inteira e consistente do banco. O arquivo não pode existir:
   * a cópia nunca passa por cima de outra.
   */
  copiar(destino) {
    const alvo = String(destino);
    if (fs.existsSync(alvo) || fs.lstatSync(alvo, { throwIfNoEntry: false })) {
      const erro = new Error(`já existe um arquivo em ${alvo}`);
      erro.code = 'EEXIST';
      throw erro;
    }
    this._con.prepare('VACUUM INTO ?').run(alvo);
    return alvo;
  }

  fechar() {
    this._con.close();
  }

  _migrar(migracoes) {
    const atual = this.versao;
    if (atual > migracoes.length) {
      throw new BancoMaisNovo(`o banco está na versão ${atual}, e este app conhece até a ${migracoes.length}`);
    }
    for (let numero = atual + 1; numero <= migracoes.length; numero++) {
      const passo = migracoes[numero - 1];
      this._con.exec('BEGIN IMMEDIATE');
      this._fundo += 1;     // a função de migração pode abrir `transacao()`: é esta
      try {
        if (typeof passo === 'function') passo(this);
        else this._con.exec(String(passo));
        this._con.exec(`PRAGMA user_version = ${numero}`);
        this._con.exec('COMMIT');
      } catch (erro) {
        if (this._con.isTransaction) this._con.exec('ROLLBACK');
        throw erro;
      } finally {
        this._fundo -= 1;
      }
    }
  }
}

/** Abre o banco `nome` do app, criando-o se for o caso, e aplica as migrações que faltam. */
function abrir({ migracoes = [], nome = 'banco', env } = {}) {
  const arquivo = caminho(nome, env);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  // O arquivo nasce fechado às outras contas da estação, antes de o SQLite o abrir.
  fs.closeSync(fs.openSync(arquivo, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600));
  const db = new Banco(arquivo);
  try {
    db._migrar([...migracoes]);
  } catch (erro) {
    db.fechar();
    throw erro;
  }
  return db;
}

module.exports = { abrir, caminho, Banco, BancoMaisNovo, ESPERA_MS };
