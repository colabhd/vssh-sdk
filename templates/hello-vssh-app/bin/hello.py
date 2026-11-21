"""O comando deste app no terminal: pergunta a hora ao backend e a escreve.

O manifesto o declara em `contributes.comandos`, com `backend: true`, e o nome do comando é o id do
app. Quem o roda na estação é o `vssh-app-comando`, que sobe o backend parado e põe no ambiente o
socket e o token dele; o `servidor.pedir` do runtime conversa com o backend por ali, como a janela.
Fora do ambiente, a bancada sobe o backend num socket e exporta `VSSH_APP_SOCKET` e `VSSH_APP_TOKEN`
antes de rodar este arquivo (docs/guias/comandos.md).

Os códigos de saída são os do `vssh`: 0 feito, 1 o backend respondeu com erro, 3 sem backend.
"""

import json
import os
import sys

from vssh import servidor

USO = '''uso: %s [--json]

Pergunta a hora ao backend do app e a escreve.

  --json   escreve a resposta do backend como JSON'''


def principal(args):
    if '-h' in args or '--help' in args:
        print(USO % os.environ.get('VSSH_APP_ID', 'hello-world'))
        return 0
    try:
        status, _cabecalhos, corpo = servidor.pedir('/api/ping')
    except (servidor.ErroDeEndereco, OSError) as e:
        sys.stderr.write('O backend não respondeu: %s\n' % e)
        return 3
    if status != 200:
        sys.stderr.write('O backend respondeu %d.\n' % status)
        return 1
    resposta = json.loads(corpo)
    if '--json' in args:
        print(json.dumps(resposta, ensure_ascii=False, separators=(',', ':')))
    else:
        print('%s respondeu às %s' % (resposta['appId'], resposta['time']))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv[1:]))
