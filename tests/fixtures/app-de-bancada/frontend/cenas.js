// A cena do app de bancada: vinte vezes uma conta de CUSTO_MS a cada quadro, devolvidas como
// amostras, a soma delas como um número por rodada, e a mais lenta, que só informa. O teste muda
// CUSTO_MS na cabeça para criar uma piora de verdade. As cenas se registram depois da carga, como
// num app que monta a janela antes, e o primeiro pedido da bancada chega antes delas.
const CUSTO_MS = 4;

addEventListener('load', () => setTimeout(() => vssh.desempenho.cenas([{
  id: 'conta',
  nome: 'Uma conta de custo conhecido',
  medidas: {
    conta: { rotulo: 'conta a cada quadro (p95)', unidade: 'ms' },
    soma: { rotulo: 'soma das contas', unidade: 'ms', folga: 5 },
    maior: { rotulo: 'a conta mais lenta', unidade: 'ms', informa: true },
  },
  async rodar({ quadro }) {
    const amostras = [];
    for (let i = 0; i < 20; i++) {
      await quadro();
      const t0 = performance.now();
      while (performance.now() - t0 < CUSTO_MS) { /* o custo */ }
      amostras.push(performance.now() - t0);
    }
    return { conta: amostras, soma: amostras.reduce((a, b) => a + b, 0), maior: Math.max(...amostras) };
  },
}]), 300));
