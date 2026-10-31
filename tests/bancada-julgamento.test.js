// O julgamento da bancada de um app (`julgar`, em `scripts/vssh-bancada.mjs`) sobre rodadas
// sintéticas, na forma que `vssh.desempenho.rodarCenas` devolve. O caminho inteiro, com a janela e o
// Chrome, está em `tests/browser/vssh-bancada.serial.js`; aqui fica a régua que o runner não deixa
// medir com números de verdade, porque ele não escolhe quando uma rodada perde a vez.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { julgar } from '../scripts/vssh-bancada.mjs';

/** Noventa quadros em torno de `ms`, como os de uma rodada do traço. */
const quadros = (ms) => Array.from({ length: 90 }, (_, i) => ms + (i % 10) * 0.1);
const rodada = (amostras) => ({ cenas: [{ id: 'traco', nome: 'Traço', medidas: { t: { unidade: 'ms', folga: 1, amostras } } }] });
const lado = (...porRodada) => ({ rodadas: porRodada.map((ms) => rodada(quadros(ms))) });

test('uma rodada em que a página perdeu a vez não reprova as amostras', () => {
  const [l] = julgar(lado(5, 5, 5, 5), lado(5, 5, 11, 5), 0.15);
  // A rodada ruim sobe o p95 juntado sozinha, e a mediana das rodadas não se mexe.
  assert.ok(l.medianaCabeca > l.medianaBase * 1.15 + 1, JSON.stringify(l));
  assert.equal(l.piorou, false);
});

test('uma piora em todas as rodadas reprova', () => {
  const [l] = julgar(lado(5, 5, 5, 5), lado(8, 8, 8, 8), 0.15);
  assert.equal(l.piorou, true);
});

test('uma piora abaixo da folga não reprova, mesmo em todas as rodadas', () => {
  const [l] = julgar(lado(5, 5, 5, 5), lado(5.9, 5.9, 5.9, 5.9), 0.15);
  assert.ok(l.medianaCabeca > l.medianaBase * 1.15, JSON.stringify(l));
  assert.equal(l.piorou, false);
});

test('a janela parada reprova com um layout em qualquer rodada da cabeça, mesmo com a base igual', () => {
  const parada = (...layouts) => ({ rodadas: layouts.map((valor) => ({ cenas: [{ id: '_parada', nome: 'A janela parada', medidas: { layouts: { unidade: 'contagem', zero: true, valor } } }] })) });
  assert.equal(julgar(parada(0, 0, 0, 0), parada(0, 0, 0, 0), 0.15)[0].piorou, false);
  assert.equal(julgar(parada(0, 0, 0, 0), parada(0, 0, 3, 0), 0.15)[0].piorou, true);
  assert.equal(julgar(parada(2, 2, 2, 2), parada(2, 2, 2, 2), 0.15)[0].piorou, true);
});
