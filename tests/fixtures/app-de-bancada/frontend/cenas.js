// A cena do app de bancada: vinte vezes uma conta de CUSTO_MS a cada quadro, devolvidas como
// amostras, a soma delas como um número por rodada, e a mais lenta, que só informa. O teste muda
// CUSTO_MS na cabeça para criar uma piora.
//
// Os números não dependem da máquina: o teste mede a bancada, e não o runner, onde a página perde
// a vez para as threads do SwiftShader e uma conta de 4 ms sai com 100. Cada amostra é o custo mais
// um acréscimo que cresce com a rodada (o contador mora no `localStorage` da origem de cada lado),
// para as rodadas de um lado não serem iguais entre si. As cenas se registram depois da carga, como
// num app que monta a janela antes, e o primeiro pedido da bancada chega antes delas.
const CUSTO_MS = 4;
const rodada = Number(localStorage.getItem('rodada') || 0);
localStorage.setItem('rodada', String(rodada + 1));

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
      amostras.push(CUSTO_MS + rodada * 0.01 + i * 0.001);
    }
    return { conta: amostras, soma: amostras.reduce((a, b) => a + b, 0), maior: Math.max(...amostras) };
  },
}]), 300));
