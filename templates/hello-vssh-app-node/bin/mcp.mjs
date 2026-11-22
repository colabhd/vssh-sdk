// O servidor MCP deste app: as ferramentas que um agente chama como a pessoa.
//
// O manifesto o declara em `contributes.mcp`, com `backend: true`. Quem o sobe é o
// `vssh-app-comando <app> --mcp`, que o agente registrado chama (`vssh mcp adicionar <app>`), com
// a entrada e a saída presas ao agente e o socket e o token do backend no ambiente. O protocolo por
// stdio é uma linha JSON-RPC por mensagem: o `initialize`, o `tools/list` e o `tools/call`, e as
// notificações, que não pedem resposta (docs/guias/comandos.md).
//
// A única ferramenta, `hora`, pergunta a hora ao backend pelo `servidor.pedir`, como o comando.

import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

const { servidor } = createRequire(import.meta.url)('vssh');

const VERSAO_DO_PROTOCOLO = '2025-06-18';
const HORA = {
  name: 'hora',
  description: 'A hora do backend deste app.',
  inputSchema: { type: 'object', properties: {} },
};

/** O resultado de `tools/call` da `hora`: o texto, ou o erro como resultado, para o agente ler. */
async function hora() {
  let r;
  try {
    r = await servidor.pedir('/api/ping');
  } catch (e) {
    return { content: [{ type: 'text', text: `O backend não respondeu: ${e.message}` }], isError: true };
  }
  if (r.status !== 200) return { content: [{ type: 'text', text: `O backend respondeu ${r.status}.` }], isError: true };
  const resposta = JSON.parse(r.corpo.toString('utf8'));
  return { content: [{ type: 'text', text: `${resposta.appId} respondeu às ${resposta.time}` }] };
}

/** A resposta a um pedido JSON-RPC, ou `null` para uma notificação. */
async function responder(pedido) {
  if (!('id' in pedido)) return null;
  let resultado;
  if (pedido.method === 'initialize') {
    resultado = { protocolVersion: VERSAO_DO_PROTOCOLO, capabilities: { tools: {} }, serverInfo: { name: 'hello-world-node', version: '1.0.0' } };
  } else if (pedido.method === 'tools/list') {
    resultado = { tools: [HORA] };
  } else if (pedido.method === 'tools/call' && pedido.params?.name === 'hora') {
    resultado = await hora();
  } else if (pedido.method === 'ping') {
    resultado = {};
  } else {
    return { jsonrpc: '2.0', id: pedido.id, error: { code: -32601, message: `método desconhecido: ${pedido.method}` } };
  }
  return { jsonrpc: '2.0', id: pedido.id, result: resultado };
}

for await (const linha of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!linha.trim()) continue;
  let pedido;
  try { pedido = JSON.parse(linha); } catch { continue; }
  const resposta = await responder(pedido);
  if (resposta) process.stdout.write(`${JSON.stringify(resposta)}\n`);
}
