'use strict';

// vssh.progresso: o protocolo de progresso de um trabalho longo, uma linha no stdout.
//
//   ::vssh-progresso {"feito":2472,"total":3862,"etapa":"transcrevendo"}
//
// O trabalho imprime a linha, e quem o acompanha a lê. Numa fila de processamento, quem lê é o
// portal, no log do container; na estação, é o backend do app, no stdout do processo que ele
// subiu. O resto do stdout continua sendo texto para gente, e só a linha com o prefixo é dado.
//
//   const { progresso } = require('vssh');
//   progresso.informar(2472, 3862, 'transcrevendo');    // dentro do trabalho
//   const p = progresso.ler(linha);                      // em quem acompanha: objeto ou null
//
// `feito` é obrigatório. `total` é opcional; sem ele não há porcentagem, e a bandeja desenha a
// faixa indeterminada. `etapa` é um nome curto do que está acontecendo, até 64 caracteres. O
// leitor do portal é `src/services/fila/progresso.ts`, com as mesmas regras.

const PREFIXO = '::vssh-progresso ';
const TETO_DA_ETAPA = 64;

/** Escreve a linha de progresso no stdout (ou em `saida`, qualquer coisa com `write`). */
function informar(feito, total, etapa, saida = process.stdout) {
  const obj = { feito };
  if (total !== undefined && total !== null) obj.total = total;
  if (etapa) obj.etapa = String(etapa).slice(0, TETO_DA_ETAPA);
  saida.write(PREFIXO + JSON.stringify(obj) + '\n');
}

/** `{ feito, total, etapa }` de uma linha de progresso válida, ou `null`. */
function ler(linha) {
  const l = String(linha).replace(/\r?\n$/, '').replace(/\r$/, '');
  if (!l.startsWith(PREFIXO)) return null;
  let obj;
  try { obj = JSON.parse(l.slice(PREFIXO.length)); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const feito = numero(obj.feito);
  if (feito === null || feito < 0) return null;
  let total = null;
  if (obj.total !== undefined && obj.total !== null) {
    total = numero(obj.total);
    if (total === null || total <= 0) return null;
  }
  const etapa = typeof obj.etapa === 'string' && obj.etapa.trim() ? obj.etapa.trim().slice(0, TETO_DA_ETAPA) : null;
  return { feito, total, etapa };
}

module.exports = { PREFIXO, informar, ler };
