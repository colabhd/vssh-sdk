"""
Os modelos da instituição para o backend de um app, pelo `llm/v1` do portal. O par de
`vssh/llm.js`. O contrato está em docs/llm.md do vssh-sso.

O app declara `recursos.llm: true` no manifesto e recebe do portal, a cada subida,
`VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN`. Este módulo só monta o pedido a `/api/llm/v1/` e lê a
resposta; quem põe a chave do gateway e escolhe o modelo do momento é o portal.

    from vssh import llm

    r = llm.conversar({'model': 'conversa', 'messages': [{'role': 'user', 'content': 'Olá'}]})
    print(r['choices'][0]['message']['content'])

    for pedaco in llm.fluxo({'model': 'conversa', 'messages': mensagens}):
        print(pedaco['choices'][0]['delta'].get('content') or '', end='')

    vetores = llm.embeddings({'model': 'embeddings', 'input': ['teoria crítica']})['data']
    modelos = llm.modelos()['data']

Um erro do contrato chega como `ErroDoLlm`, com o `codigo` estável (`teto_atingido`,
`muitos_pedidos`, `sem_escopo`...), o `status` e o `depois_de` do `Retry-After`, em segundos.
"""

import json
import os
import urllib.error
import urllib.request

AGENTE = 'vssh-sdk-llm/python'
TEMPO_HTTP_S = 300


class ErroDoLlm(Exception):
    def __init__(self, codigo, mensagem, status=0, depois_de=None):
        super().__init__(mensagem)
        self.codigo = codigo
        self.status = status
        self.depois_de = depois_de


def _credencial(env=None):
    env = os.environ if env is None else env
    url = (env.get('VSSH_PORTAL_URL') or '').rstrip('/')
    token = env.get('VSSH_PORTAL_TOKEN') or ''
    return (url, token) if url and token else None


def disponivel(env=None):
    """`{'disponivel': bool, 'motivo': str | None}`. Nunca lança e não fala com o portal."""
    if _credencial(env):
        return {'disponivel': True, 'motivo': None}
    return {'disponivel': False,
            'motivo': 'o app não declarou recursos.llm no manifesto (ou ainda não foi reiniciado)'}


def _erro(status, texto, depois):
    try:
        corpo = json.loads(texto)
    except ValueError:
        corpo = None
    e = (corpo or {}).get('error') or {}
    try:
        depois_de = int(depois) if depois is not None else None
    except ValueError:
        depois_de = None
    return ErroDoLlm(e.get('code') or 'pedido_invalido', e.get('message') or texto or f'o portal respondeu {status}',
                     status, depois_de)


def _abrir(metodo, verbo, corpo=None, env=None, timeout=TEMPO_HTTP_S):
    cred = _credencial(env)
    if not cred:
        raise ErroDoLlm('sem_escopo', disponivel(env)['motivo'])
    url, token = cred
    dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
    req = urllib.request.Request(f'{url}/api/llm/v1/{verbo}', data=dados, method=metodo, headers={
        'Authorization': f'Bearer {token}', 'User-Agent': AGENTE,
        **({'Content-Type': 'application/json'} if dados is not None else {}),
    })
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise _erro(e.code, e.read().decode('utf-8', 'replace'), e.headers.get('Retry-After')) from None


def _json(metodo, verbo, corpo=None, env=None):
    with _abrir(metodo, verbo, corpo, env) as r:
        return json.loads(r.read().decode('utf-8'))


def conversar(pedido, env=None):
    """`POST chat/completions` sem fluxo. Devolve a resposta inteira, no formato da OpenAI."""
    return _json('POST', 'chat/completions', {**pedido, 'stream': False}, env)


def fluxo(pedido, env=None):
    """
    `POST chat/completions` com fluxo: um gerador de pedaços (`choices[0].delta`), até o `[DONE]`.
    O último pedaço antes do fim traz o `usage`. Um erro no meio do fluxo lança `ErroDoLlm`.
    """
    with _abrir('POST', 'chat/completions', {**pedido, 'stream': True}, env) as r:
        for bruta in r:
            linha = bruta.decode('utf-8').strip()
            if not linha.startswith('data:'):
                continue
            dado = linha[5:].strip()
            if dado == '[DONE]':
                return
            pedaco = json.loads(dado)
            if pedaco.get('error'):
                e = pedaco['error']
                raise ErroDoLlm(e.get('code') or 'modelo_fora_do_ar', e.get('message') or 'erro no fluxo', r.status)
            yield pedaco


def embeddings(pedido, env=None):
    """`POST embeddings`."""
    return _json('POST', 'embeddings', pedido, env)


def modelos(env=None):
    """`GET models`: os nomes por função e os do gateway, com `funcao`, `modelo`, `janela` e `ferramentas`."""
    return _json('GET', 'models', None, env)
