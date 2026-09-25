'use strict';

// A voz de um app sem janela: notificar, dizer o que está fazendo agora, e ter um ícone na
// bandeja. O par de `vssh/avisos.py`.
//
// Um app com janela fala com o shell pela ponte de `postMessage`, e não precisa disto. Um
// `type: "engine"` ou `kind: "service"` não tem iframe, e é justamente ele que mais precisa ser
// ouvido. O modelo é estado por arquivo, e quem lê é o coletor do portal
// (`src/services/server-collector.ts`), um exec por servidor a cada poucos segundos, só enquanto
// alguém tem o desktop aberto. Escrever é barato e não custa nada quando ninguém está olhando;
// escrever em laço apertado não aparece mais rápido.
//
// Três coisas diferentes, e escolher errado custa a atenção de quem usa:
//
//   notificar   um fato que aconteceu. Vai para o histórico do sino, e fica.
//   atividade   uma condição verdadeira agora, com título, texto e barra. Some quando acaba.
//   bandeja     um ícone com badge. Cabe num símbolo e um número.
//
// Os três arquivos, e o que cada um significa para o coletor:
//
//   ~/.vssh-notifications/journal.ndjson     histórico, só acrescenta; o `id` decide o que é novo
//   ~/.vssh-notifications/live/<chave>.json  atividade viva enquanto o arquivo existir e o `at`
//                                            (epoch ms) tiver menos de ~60 s
//   ~/.vssh-apps/<id>/tray.json              o ícone; sumiu o arquivo, sumiu o ícone
//
// Nenhuma função daqui lança. Um app tem trabalho de verdade a fazer, e ele não para porque um
// aviso não coube no disco; fora do VSSH tudo devolve `null` ou `false` sem barulho.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const app = require('./app.js');

const DIR = '.vssh-notifications';
const JOURNAL = 'journal.ndjson';

// Rotação do journal: acima do teto de bytes, o arquivo é reescrito com as últimas linhas. O
// número de linhas mantidas é bem maior que a janela que o coletor lê (~50): cortar perto da
// janela arriscaria apagar algo que ainda não foi entregue.
const MAX_BYTES = 256 * 1024;
const MANTER_LINHAS = 200;

const NIVEIS = ['info', 'success', 'warning', 'error'];

// Renovação um pouco abaixo da metade do TTL do coletor (60 s): dois tiques perdidos ainda cabem
// no prazo, e uma pausa do event loop não apaga a atividade sozinha.
const RENOVA_MS = 20000;

const vivas = new Map();

function home(env) {
  if (env.HOME) return env.HOME;
  // Sem HOME (systemd sem `User=`, container magro) a home sai do diretório de dados, que é
  // `<home>/.vssh-apps/<id>/data`.
  if (env.VSSH_APP_DATA_DIR) return path.resolve(env.VSSH_APP_DATA_DIR, '..', '..', '..');
  return null;
}

/**
 * Temporário e `rename`: o coletor nunca lê um arquivo pela metade. Sem isso, o corte
 * aconteceria justamente no instante do poll, e o sintoma seria um ícone ou uma barra piscando
 * sob atualização frequente, que é quando eles importam.
 */
function escreverAtomico(arquivo, corpo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(corpo), 'utf8');
  fs.renameSync(tmp, arquivo);
}

// ── Notificar ───────────────────────────────────────────────────────────────

/** O journal é do usuário, e não do app: um arquivo só, que o coletor lê num `tail` por usuário. */
function caminhoDoJournal(env = process.env) {
  const h = home(env);
  return h ? path.join(h, DIR, JOURNAL) : null;
}

/** A `chave` vira id legível quando dá, e hash quando não dá: um journal é lido por gente. */
function idDe(appId, chave) {
  const limpa = String(chave).replace(/[^\w.:-]+/g, '-').slice(0, 80);
  if (limpa && limpa !== '-') return `${appId}:${limpa}`;
  return `${appId}:${crypto.createHash('sha1').update(String(chave)).digest('hex').slice(0, 16)}`;
}

/**
 * Acrescenta uma notificação ao journal do usuário. Devolve o `id` gravado, ou `null` quando
 * não havia onde escrever.
 *
 * O coletor manda uma janela do fim do arquivo, e quem impede a mesma notificação de chegar a
 * cada tick é o `id`. Sem `chave`, cada chamada é um evento novo com id próprio. Com `chave`, o
 * id é derivado dela: chamar duas vezes com a mesma chave avisa uma vez só.
 *
 * Opções: `titulo`, `nivel` (`info|success|warning|error`), `chave`, `acoes` (até três
 * `{id, label}`), `rota` (o caminho do seu backend que recebe o POST de uma ação), `abrir` (onde o
 * clique na própria notificação leva: um caminho dentro do app, como `?documento=entrevista-3`,
 * colado na URL da janela nova ou entregue à janela aberta no evento `abertura`), `persistente`,
 * `appId`, `quando` (o instante do evento em ms, do emissor).
 */
function notificar(corpo, opcoes = {}) {
  const env = opcoes.env || process.env;
  const arquivo = caminhoDoJournal(env);
  if (!arquivo) return null;

  const appId = String(opcoes.appId || app.ident(env)).slice(0, 64);
  const id = opcoes.chave != null && opcoes.chave !== ''
    ? idDe(appId, opcoes.chave)
    // Tempo e aleatório, e não um contador: contador reinicia com o processo, e aí o id de ontem
    // volta a existir e o coletor o dá como já entregue.
    : `${appId}:${Date.now().toString(16)}-${crypto.randomBytes(4).toString('hex')}`;

  const entrada = {
    id,
    appId,
    body: String(corpo ?? '').slice(0, 500),
    at: Number.isFinite(opcoes.quando) ? Math.trunc(opcoes.quando) : Date.now(),
  };
  if (opcoes.titulo) entrada.title = String(opcoes.titulo).slice(0, 120);
  if (NIVEIS.includes(opcoes.nivel)) entrada.level = opcoes.nivel;
  if (opcoes.persistente) entrada.persistent = true;
  if (Array.isArray(opcoes.acoes) && opcoes.acoes.length) {
    entrada.actions = opcoes.acoes
      .filter((a) => a && typeof a.id === 'string' && typeof a.label === 'string')
      .slice(0, 3)
      .map((a) => ({ id: a.id, label: a.label }));
  }
  if (opcoes.rota) entrada.onAction = { path: String(opcoes.rota) };
  if (opcoes.abrir) entrada.rota = String(opcoes.abrir).slice(0, 512);

  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    // Uma linha, uma escrita, em append. O `JSON.stringify` escapa a quebra de linha do corpo, e
    // é isso que impede uma notificação de várias linhas de virar várias entradas quebradas.
    fs.appendFileSync(arquivo, JSON.stringify(entrada) + '\n', 'utf8');
    rotacionar(arquivo);
    return id;
  } catch (err) {
    console.warn(`[vssh.avisos] não foi possível escrever ${arquivo}: ${err.message}`);
    return null;
  }
}

function rotacionar(arquivo) {
  let st;
  try { st = fs.statSync(arquivo); } catch { return; }
  if (st.size <= MAX_BYTES) return;
  try {
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter((l) => l.trim());
    const tmp = `${arquivo}.tmp`;
    fs.writeFileSync(tmp, linhas.slice(-MANTER_LINHAS).join('\n') + '\n', 'utf8');
    fs.renameSync(tmp, arquivo);
  } catch (err) {
    // A notificação já está no arquivo; falhar em rotacionar não a desfaz.
    console.warn(`[vssh.avisos] rotação do journal falhou: ${err.message}`);
  }
}

// ── Atividade em curso ──────────────────────────────────────────────────────

/** `[a-z0-9:_-]`, até 64: o mesmo alfabeto que o coletor aceita, conferido dos dois lados. */
function chaveValida(chave) {
  return typeof chave === 'string' && /^[a-z0-9:_-]{1,64}$/i.test(chave);
}

function caminhoDaAtividade(chave, env = process.env) {
  const h = env.HOME || '';
  return h && chaveValida(chave) ? path.join(h, DIR, 'live', `${chave}.json`) : null;
}

/**
 * Declara, ou atualiza, uma atividade. A mesma chave substitui no lugar: relatar progresso não
 * empilha vinte linhas no painel de quem está trabalhando.
 *
 * Campos do `item`: `titulo`, `texto`, `level`, `formato` (`simples|progresso`), `progresso`
 * (`{feito, total}` ou `{indeterminado: true}`), `acoes` (`[{id, label}]`). Só dados. O `at` é
 * escrito aqui a cada chamada; uma atividade que fica minutos sem novidade precisa de
 * `manterAtividadesVivas()`, porque o coletor descarta o que passa ~60 s sem renovar. É de
 * propósito: um arquivo sobrevive a um `kill -9`, e sem prazo o primeiro processo que morresse no
 * meio pregaria "Sincronizando 3 de 12" no painel para sempre.
 *
 * Devolve `false`, sem lançar, quando não há onde escrever.
 */
function atividade(chave, item, env = process.env) {
  const arquivo = caminhoDaAtividade(chave, env);
  if (!arquivo) return false;
  try {
    escreverAtomico(arquivo, { ...item, at: Date.now() });
    vivas.set(chave, item);
    return true;
  } catch (err) {
    console.warn(`[vssh.avisos] não foi possível escrever ${arquivo}: ${err.message}`);
    return false;
  }
}

/**
 * Encerra a atividade. Sem `registrar`, ela some e não deixa rastro, que é o certo para uma
 * condição que passou. Com `registrar: {titulo, texto, level}`, o fim vira uma notificação, uma só.
 *
 * A notificação vai antes de o arquivo sair: o coletor lê estado (presença de arquivo), então não
 * há como pedir "encerre e registre" pelo próprio `live/`. Nesta ordem, o pior caso de uma queda no
 * meio é a atividade ficar na tela até o TTL; na inversa, é ela sumir sem nunca ter contado como
 * terminou.
 */
function limparAtividade(chave, opcoes = {}) {
  const env = opcoes.env || process.env;
  const arquivo = caminhoDaAtividade(chave, env);
  if (!arquivo) return false;
  vivas.delete(chave);
  if (opcoes.registrar) {
    const r = opcoes.registrar;
    try {
      notificar(String(r.texto ?? r.body ?? ''), {
        titulo: r.titulo ?? r.title,
        nivel: r.level,
        // Chave estável na da atividade: um retry que termine de novo substitui em vez de
        // empilhar dois "concluído" para a mesma coisa.
        chave: `live:${chave}`,
        env,
      });
    } catch (err) {
      console.warn(`[vssh.avisos] não foi possível registrar o fim de ${chave}: ${err.message}`);
    }
  }
  try {
    fs.rmSync(arquivo, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Renova o `at` das atividades deste processo enquanto elas existirem. Devolve a função que para
 * a renovação. Opt-in, e o temporizador é `unref`: uma lib que segura o event loop impede o app
 * de encerrar, e isso é pior que uma barra que expira.
 */
function manterAtividadesVivas(env = process.env) {
  const t = setInterval(() => {
    for (const [chave, item] of vivas) atividade(chave, item, env);
  }, RENOVA_MS);
  t.unref?.();
  return () => clearInterval(t);
}

/**
 * Liga `adeus` ao fim do processo. Opt-in: instalar handler de sinal por conta própria numa lib
 * briga com o shutdown do app.
 */
function aoSair(adeus) {
  process.once('exit', adeus);
  for (const sinal of ['SIGINT', 'SIGTERM']) {
    process.once(sinal, () => { adeus(); process.exit(0); });
  }
}

/**
 * O TTL cobre o `kill -9`; 60 s de "sincronizando" depois de um encerramento limpo é um minuto
 * de mentira que dava para não contar.
 */
function limparAtividadesAoSair(env = process.env) {
  aoSair(() => { for (const chave of [...vivas.keys()]) limparAtividade(chave, { env }); });
}

// ── Bandeja ─────────────────────────────────────────────────────────────────

/**
 * O `tray.json` fica um nível acima do diretório de dados, ao lado do `status.json` que o
 * supervisor escreve: é o diretório que o coletor varre.
 */
function caminhoDaBandeja(env = process.env) {
  if (env.VSSH_APP_DATA_DIR) return path.join(path.dirname(env.VSSH_APP_DATA_DIR), 'tray.json');
  if (env.VSSH_APP_ID) return path.join(env.HOME || '', '.vssh-apps', env.VSSH_APP_ID, 'tray.json');
  return null;
}

/**
 * Publica, ou atualiza, o ícone deste app na bandeja. Um item por app; chamar de novo substitui,
 * e o ícone não muda de lugar quando o badge muda a cada segundo.
 *
 * Campos: `icon`, `tooltip`, `badge` (`{count}` | `{dot: true}` | `{text}`), `menu`
 * (`[{id, label, icon, danger, disabled}]` ou `{separator: true}`), `onClick` (`{path}`, a rota
 * do seu backend que recebe o POST do clique). Só dados: isto atravessa um arquivo.
 *
 * Devolve `false`, sem lançar, quando não há onde escrever.
 */
function bandeja(item, env = process.env) {
  const arquivo = caminhoDaBandeja(env);
  if (!arquivo) return false;
  try {
    escreverAtomico(arquivo, { ...item, updatedAt: new Date().toISOString() });
    return true;
  } catch (err) {
    console.warn(`[vssh.avisos] não foi possível escrever ${arquivo}: ${err.message}`);
    return false;
  }
}

/** Remove o ícone. Chame ao encerrar: ícone órfão mente sobre o estado do ambiente. */
function limparBandeja(env = process.env) {
  const arquivo = caminhoDaBandeja(env);
  if (!arquivo) return false;
  try {
    fs.rmSync(arquivo, { force: true });
    return true;
  } catch {
    return false;
  }
}

function limparBandejaAoSair(env = process.env) {
  aoSair(() => { limparBandeja(env); });
}

module.exports = {
  notificar, caminhoDoJournal,
  atividade, limparAtividade, manterAtividadesVivas, limparAtividadesAoSair, caminhoDaAtividade,
  bandeja, limparBandeja, limparBandejaAoSair, caminhoDaBandeja,
};
