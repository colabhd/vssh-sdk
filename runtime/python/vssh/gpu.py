"""
A GPU que o sistema concedeu a este app.

O `vssh-app-run` decide ao subir o app, com o que o servidor tem e com o que o manifesto pede em
`recursos.gpu.modo`, e registra a decisão em `~/.vssh-apps/<id>/limits.json`. O app pergunta
aqui, em vez de ler esse arquivo ou de olhar `CUDA_VISIBLE_DEVICES`, e a resposta é a mesma que
a janela dele recebe por `vssh.gpu.estado()` e que o gerenciador de tarefas mostra.

A arbitragem é por convenção. `concedida` quer dizer que o runtime CUDA enxerga a placa e que
este processo abre o render node. A placa continua compartilhada com os outros processos do
usuário.
"""

import json
import os

from . import app

__all__ = ['concedida']

_REGISTRO = 'limits.json'


def _registro(env=None):
    """O `limits.json` deste app, ao lado do diretório de dados, ou `None` quando não há."""
    caminho = os.path.join(os.path.dirname(app.dados(env)), _REGISTRO)
    try:
        with open(caminho, encoding='utf-8') as f:
            r = json.load(f)
        return r if isinstance(r, dict) else None
    except (OSError, ValueError):
        return None


def concedida(env=None):
    """O que o sistema concedeu: `{'concedida': bool, 'dispositivos': [...], 'motivo': str | None}`.

    `dispositivos` são os que este processo abre, cada um com `fabricante`, `driver`, `virtual`,
    `video` (o caminho de codificação: `nvenc`, `vaapi` ou `None`) e `renderNode`; a lista é vazia
    quando nada foi concedido. `motivo` é a frase do lançador quando a resposta é não (`não
    declarada no manifesto`, `sem GPU utilizável: ...`, `não consegui consultar este servidor`),
    e `None` quando é sim. Sem registro do lançador, o que acontece a um app que subiu por fora
    dele, a resposta é não, e o motivo diz isso.
    """
    r = _registro(env)
    if not r or not isinstance(r.get('gpu'), str):
        return {'concedida': False, 'dispositivos': [], 'motivo': 'sem registro do lançador'}
    if r['gpu'] == 'concedida':
        info = r.get('gpuInfo')
        todos = info.get('dispositivos') if isinstance(info, dict) else None
        usaveis = [d for d in (todos or []) if isinstance(d, dict) and d.get('acesso') == 'ok']
        return {'concedida': True, 'dispositivos': usaveis, 'motivo': None}
    motivo = r.get('gpuMotivo')
    return {'concedida': False, 'dispositivos': [],
            'motivo': motivo if isinstance(motivo, str) and motivo else None}
