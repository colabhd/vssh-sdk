'use strict';

// Eventos do backend para o frontend, por Server-Sent Events, e a difusão para quem assinou. O
// par de `vssh/eventos.py`.
//
// A receita do SSE tem um jeito cruel de falhar: sem os cabeçalhos certos, os eventos ficam presos
// num buffer em algum ponto do caminho (o proxy do portal, o CDN na frente dele) e chegam em lote,
// ou nunca. O app parece "não receber nada", e não há erro em lugar nenhum. `X-Accel-Buffering:
// no` é o que impede a bufferização na borda, e é o cabeçalho que o portal usa nas rotas SSE dele.
// O `flushHeaders` é o que faz o `EventSource` do navegador disparar o `onopen`.
//
// Duas peças:
//
//   const fluxo = eventos.abrir(res);          // um stream sobre uma resposta, para quem manda a um só
//   const difusor = new eventos.Difusor();     // um conjunto de assinantes, para quem publica a todos
//
//   http.createServer(servidor.portao((req, res) => {
//     if (req.url.split('?')[0] === '/eventos') return difusor.atender(res);
//     ...
//   }));
//
//   difusor.publicar('progresso', { feito: 3, total: 12 });
//
// O cliente que fecha a aba não avisa: o socket some. O `close` da resposta marca o stream como
// fechado e o tira do difusor; uma escrita depois disso é ignorada.
//
// O fio é o do `EventSource`: `event: <nome>`, `data: <JSON>`, linha em branco. O `JSON.stringify`
// produz o mesmo que os separadores compactos do lado Python; um app emite os mesmos bytes nos
// dois runtimes.

const KEEPALIVE_MS = 15000;

/**
 * Abre um stream SSE sobre uma resposta. `reconexaoMs` é a dica de reconexão que o `EventSource`
 * respeita; `keepaliveMs: 0` desliga o comentário periódico.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{reconexaoMs?: number, keepaliveMs?: number}} [opcoes]
 * @returns {{enviar: (evento: string, dados: any) => boolean, comentar: (texto?: string) => boolean,
 *   fechar: () => void, aoFechar: (cb: (fluxo: object) => void) => void, fechado: boolean}}
 */
function abrir(res, opcoes = {}) {
  const keepaliveMs = opcoes.keepaliveMs === undefined ? KEEPALIVE_MS : opcoes.keepaliveMs;
  const aoFechar = [];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const fluxo = {
    fechado: false,

    /** Um evento nomeado. `dados` vira JSON, a menos que já seja texto. `false` depois do fim. */
    enviar(evento, dados) {
      if (fluxo.fechado) return false;
      const carga = typeof dados === 'string' ? dados : JSON.stringify(dados);
      res.write(`event: ${evento}\ndata: ${carga}\n\n`);
      return true;
    },

    /** Um comentário SSE: não vira evento no cliente, e mantém a conexão viva. */
    comentar(texto) {
      if (fluxo.fechado) return false;
      res.write(`: ${texto || 'keep-alive'}\n\n`);
      return true;
    },

    /** Encerra do lado do servidor. */
    fechar() {
      if (fluxo.fechado) return;
      encerrar();
      res.end();
    },

    /** Registra `cb(fluxo)` para o fim do stream, de qualquer origem. */
    aoFechar(cb) {
      aoFechar.push(cb);
    },
  };

  function encerrar() {
    if (fluxo.fechado) return;
    fluxo.fechado = true;
    clearInterval(timer);
    for (const cb of aoFechar) {
      try { cb(fluxo); } catch { /* o fim do stream não depende de quem o observa */ }
    }
  }

  if (opcoes.reconexaoMs) res.write(`retry: ${opcoes.reconexaoMs}\n\n`);

  // Proxy e balanceador derrubam conexão ociosa. O comentário periódico é tráfego suficiente
  // para isso não acontecer, e o cliente o ignora. `unref` porque um keepalive não pode ser o
  // motivo de o processo não encerrar.
  const timer = keepaliveMs > 0 ? setInterval(() => fluxo.comentar(), keepaliveMs) : null;
  if (timer && typeof timer.unref === 'function') timer.unref();

  res.on('close', encerrar);
  return fluxo;
}

/**
 * Os assinantes de um mesmo canal, e a publicação para todos eles de uma vez.
 *
 * `assinar(res)` abre o stream e o registra; `publicar(evento, dados)` escreve em todos os vivos
 * e devolve quantos alcançou. Um assinante que sumiu sai do conjunto no `close` da resposta dele.
 */
class Difusor {
  /** @param {{reconexaoMs?: number, keepaliveMs?: number}} [opcoes] */
  constructor(opcoes = {}) {
    this._opcoes = opcoes;
    this._fluxos = new Set();
  }

  /** Quantos streams estão registrados agora. */
  get assinantes() {
    return this._fluxos.size;
  }

  /** Abre um stream sobre a resposta e o registra. */
  assinar(res) {
    const fluxo = abrir(res, this._opcoes);
    fluxo.aoFechar((f) => this._fluxos.delete(f));
    this._fluxos.add(fluxo);
    return fluxo;
  }

  /**
   * Assina e chama `aoAbrir(fluxo)`, o lugar do estado inicial. O par do `atender` de Python,
   * onde é também o que segura a thread; aqui nada bloqueia, e o nome existe para o `atender` de
   * um app ler igual nas duas línguas.
   */
  atender(res, aoAbrir) {
    const fluxo = this.assinar(res);
    if (aoAbrir) aoAbrir(fluxo);
    return fluxo;
  }

  /** Manda o evento a todos os assinantes vivos. Devolve quantos o receberam. */
  publicar(evento, dados) {
    let n = 0;
    for (const f of [...this._fluxos]) if (f.enviar(evento, dados)) n += 1;
    return n;
  }

  /** Encerra todos os streams. */
  fechar() {
    for (const f of [...this._fluxos]) f.fechar();
  }
}

module.exports = { abrir, Difusor };
