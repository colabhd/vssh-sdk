'use strict';

// O executor de um trabalho da estação: o processo destacado que `vssh.trabalhos.rodar` sobe, e
// que sobe o comando do app como filho. O par de `vssh/executor.py`, com o mesmo diretório de
// trabalho.
//
//   node <este arquivo> <diretório do trabalho>
//
// Ele existe porque só o pai de um processo recebe o código de saída dele. Com o comando como
// filho do backend, um reinício do app deixava o comando órfão, com a saída num pipe fechado e o
// código perdido. Com o executor no meio, o comando segue, e o que ele diz fica em arquivos que o
// backend lê de onde parou.
//
// ── O diretório do trabalho ─────────────────────────────────────────────────────────────────
//
//   pedido.json   de quem dispara: `comando`, `cwd`, e a `chave` e o `titulo` da atividade
//   pid           de quem dispara: o pid do executor e o instante em que ele nasceu
//   grupo         o grupo de processos do comando e o instante em que ele nasceu: é o que o
//                 governador da estação leva a `nice` 19 e o que um cancelamento encerra
//   saida         o stdout do comando, como ele o escreveu
//   erros         o stderr do comando
//   cancel        de quem cancela: se existir, o executor encerra o comando
//   fim.json      `estado` (concluido, falhou, cancelado), `codigo`, `motivo`, `terminadoEm`
//   exit          o código de saída, escrito por último: é o sinal de que acabou
//
// O ambiente do comando chega pelo stdin, em JSON, e não pelo `pedido.json`: ele pode levar uma
// credencial, e o arquivo fica no disco até a faxina.
//
// ── O que o executor faz enquanto o comando roda ────────────────────────────────────────────
//
// O comando recebe o diretório em `VSSH_TRABALHO_DIR`. As linhas de progresso (`vssh.progresso`)
// viram a atividade do trabalho na bandeja, que ele renova, com o backend do app de pé ou não; um
// pedido sem `chave`, ou com `atividade: false`, não tem atividade. Cancelar manda SIGTERM ao grupo do comando, e SIGKILL
// cinco segundos depois a quem ainda estiver de pé: um comando que quer limpar o que fez pela
// metade trata o SIGTERM. O executor não escreve a notificação do fim nem tira a atividade: isso é
// do backend, que conhece o texto, e sem ele a atividade expira sozinha.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const avisos = require('./avisos.js');
const progresso = require('./progresso.js');
const { _nascimento: nascimento } = require('./trabalhos.js');

const ESPERA_DO_SIGKILL_MS = 5000;
// A bandeja não precisa de mais que duas atualizações por segundo, e um comando que informa cada
// milésimo escreveria o arquivo da atividade mil vezes.
const INTERVALO_DA_ATIVIDADE_MS = 500;
const VOLTA_MS = 200;

function itemDaAtividade(titulo, p) {
  return {
    titulo,
    texto: (p && p.etapa) || 'Rodando',
    formato: 'progresso',
    progresso: p && p.total ? { feito: p.feito, total: p.total } : { indeterminado: true },
  };
}

function escrever(caminho, texto) {
  fs.writeFileSync(`${caminho}.tmp`, texto);
  fs.renameSync(`${caminho}.tmp`, caminho);   // quem lê nunca vê o arquivo pela metade
}

function sinalizar(grupo, sinal) {
  try { process.kill(process.platform === 'win32' ? grupo : -grupo, sinal); } catch { /* o grupo já acabou */ }
}

/** As linhas inteiras de um fluxo de bytes: guarda o pedaço sem `\n` para a próxima entrega. */
function porLinha(aoChegar) {
  let resto = '';
  return (pedaco) => {
    const partes = (resto + pedaco.toString('utf8')).split('\n');
    resto = partes.pop();
    for (const linha of partes) aoChegar(linha.replace(/\r$/, ''));
  };
}

async function executar(d) {
  const pedido = JSON.parse(fs.readFileSync(path.join(d, 'pedido.json'), 'utf8'));
  let ambiente;
  try {
    const pedacos = [];
    for await (const pedaco of process.stdin) pedacos.push(pedaco);
    ambiente = (JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}') || {}).ambiente || undefined;
  } catch { ambiente = undefined; }
  const chave = pedido.atividade === false ? null : (pedido.chave || null);
  const titulo = pedido.titulo || chave;
  ambiente = { ...(ambiente || process.env), VSSH_TRABALHO_DIR: d };

  const terminar = (estado, codigo, motivo) => {
    escrever(path.join(d, 'fim.json'), JSON.stringify({ estado, codigo, motivo, terminadoEm: Date.now() }));
    escrever(path.join(d, 'exit'), String(Number.isInteger(codigo) ? codigo : 1));
  };

  const [exe, ...args] = pedido.comando.map(String);
  const saida = fs.openSync(path.join(d, 'saida'), 'a');
  const erros = fs.openSync(path.join(d, 'erros'), 'a');
  const filho = spawn(exe, args, { cwd: pedido.cwd || undefined, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

  let falhaAoSubir = null;
  const fechou = new Promise((resolve) => {
    filho.on('error', (e) => { falhaAoSubir = `não consegui rodar ${exe}: ${e.message}`; resolve(null); });
    filho.on('close', (codigo, sinal) => resolve(codigo ?? (sinal ? -1 : null)));
  });
  if (filho.pid) {
    const nasceu = nascimento(filho.pid);
    escrever(path.join(d, 'grupo'), nasceu ? `${filho.pid} ${nasceu}` : String(filho.pid));
  }

  const pararRenovacao = chave ? avisos.manterAtividadesVivas() : () => {};
  if (chave) avisos.atividade(chave, itemDaAtividade(titulo, null));
  const ultimosErros = [];
  let ultimaAtividade = 0;
  const olharLinha = porLinha((linha) => {
    const p = chave ? progresso.ler(linha) : null;
    if (!p || Date.now() - ultimaAtividade < INTERVALO_DA_ATIVIDADE_MS) return;
    ultimaAtividade = Date.now();
    avisos.atividade(chave, itemDaAtividade(titulo, p));
  });
  const guardarErro = porLinha((linha) => {
    if (!linha.trim()) return;
    ultimosErros.push(linha);
    if (ultimosErros.length > 20) ultimosErros.shift();
  });
  filho.stdout.on('data', (pedaco) => { fs.writeSync(saida, pedaco); olharLinha(pedaco); });
  filho.stderr.on('data', (pedaco) => { fs.writeSync(erros, pedaco); guardarErro(pedaco); });

  // Um SIGTERM ao executor (a estação desligando, alguém encerrando a árvore) encerra o comando
  // do mesmo jeito que um cancelamento, e o fim diz que foi interrompido.
  let interrompido = false;
  for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    try { process.on(sinal, () => { interrompido = true; }); } catch { /* sinal que a plataforma não tem */ }
  }

  let cancelado = false;
  let pedidoDeFim = null;   // o instante do SIGTERM ao grupo
  let matou = false;
  const volta = setInterval(() => {
    if (!filho.pid) return;
    if (pedidoDeFim === null) {
      cancelado = fs.existsSync(path.join(d, 'cancel'));
      if (cancelado || interrompido) { pedidoDeFim = Date.now(); sinalizar(filho.pid, 'SIGTERM'); }
    } else if (!matou && Date.now() - pedidoDeFim >= ESPERA_DO_SIGKILL_MS) {
      matou = true;
      sinalizar(filho.pid, 'SIGKILL');
    }
  }, VOLTA_MS);

  // O `close` espera os pipes fecharem. Um neto que herdou o pipe o segura aberto depois de o
  // comando sair; num cancelamento ele é do grupo e recebe o sinal, e fora dele a espera tem teto.
  let codigo = await Promise.race([
    fechou,
    new Promise((resolve) => filho.on('exit', (c, sinal) => {
      if (pedidoDeFim !== null && filho.pid) sinalizar(filho.pid, 'SIGKILL');
      setTimeout(() => resolve(c ?? (sinal ? -1 : null)), 5000).unref();
    })),
  ]);
  clearInterval(volta);
  pararRenovacao();
  fs.closeSync(saida);
  fs.closeSync(erros);
  if (codigo === -1) codigo = null;   // morto por sinal: sem código

  if (falhaAoSubir) terminar('falhou', null, falhaAoSubir);
  else if (cancelado || fs.existsSync(path.join(d, 'cancel'))) terminar('cancelado', codigo, null);
  else if (interrompido) terminar('falhou', codigo, 'o trabalho foi interrompido');
  else if (codigo === 0) terminar('concluido', 0, null);
  else terminar('falhou', codigo, ultimosErros.at(-1) || `saiu com o código ${codigo}`);
}

if (require.main === module) {
  executar(process.argv[2]).then(() => process.exit(0), (e) => {
    try {
      escrever(path.join(process.argv[2], 'fim.json'), JSON.stringify({ estado: 'falhou', codigo: null, motivo: `o executor falhou: ${e.message}`, terminadoEm: Date.now() }));
      escrever(path.join(process.argv[2], 'exit'), '1');
    } catch { /* sem onde escrever, o acompanhamento vê o executor morto */ }
    process.exit(1);
  });
}

module.exports = { executar };
