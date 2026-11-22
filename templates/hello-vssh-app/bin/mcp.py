"""O servidor MCP deste app: as ferramentas que um agente chama como a pessoa.

O manifesto o declara em `contributes.mcp`, com `backend: true`. Quem o sobe é o
`vssh-app-comando <app> --mcp`, que o agente registrado chama (`vssh mcp adicionar <app>`), com a
entrada e a saída presas ao agente e o socket e o token do backend no ambiente. O protocolo por
stdio é uma linha JSON-RPC por mensagem: o `initialize`, o `tools/list` e o `tools/call`, e as
notificações, que não pedem resposta (docs/guias/comandos.md).

A única ferramenta, `hora`, pergunta a hora ao backend pelo `servidor.pedir`, como o comando.
"""

import json
import sys

from vssh import servidor

VERSAO_DO_PROTOCOLO = '2025-06-18'
HORA = {
    'name': 'hora',
    'description': 'A hora do backend deste app.',
    'inputSchema': {'type': 'object', 'properties': {}},
}


def hora():
    """O resultado de `tools/call` da `hora`: o texto, ou o erro como resultado, para o agente ler."""
    try:
        status, _cabecalhos, corpo = servidor.pedir('/api/ping')
    except (servidor.ErroDeEndereco, OSError) as e:
        return {'content': [{'type': 'text', 'text': 'O backend não respondeu: %s' % e}], 'isError': True}
    if status != 200:
        return {'content': [{'type': 'text', 'text': 'O backend respondeu %d.' % status}], 'isError': True}
    resposta = json.loads(corpo)
    return {'content': [{'type': 'text', 'text': '%s respondeu às %s' % (resposta['appId'], resposta['time'])}]}


def responder(pedido):
    """A resposta a um pedido JSON-RPC, ou `None` para uma notificação."""
    if 'id' not in pedido:
        return None
    metodo = pedido.get('method')
    if metodo == 'initialize':
        resultado = {'protocolVersion': VERSAO_DO_PROTOCOLO, 'capabilities': {'tools': {}},
                     'serverInfo': {'name': 'hello-world', 'version': '1.0.0'}}
    elif metodo == 'tools/list':
        resultado = {'tools': [HORA]}
    elif metodo == 'tools/call' and (pedido.get('params') or {}).get('name') == 'hora':
        resultado = hora()
    elif metodo == 'ping':
        resultado = {}
    else:
        return {'jsonrpc': '2.0', 'id': pedido['id'], 'error': {'code': -32601, 'message': 'método desconhecido: %s' % metodo}}
    return {'jsonrpc': '2.0', 'id': pedido['id'], 'result': resultado}


def principal():
    for linha in sys.stdin:
        if not linha.strip():
            continue
        try:
            pedido = json.loads(linha)
        except ValueError:
            continue
        resposta = responder(pedido)
        if resposta is not None:
            sys.stdout.write(json.dumps(resposta, ensure_ascii=False, separators=(',', ':')) + '\n')
            sys.stdout.flush()


if __name__ == '__main__':
    principal()
