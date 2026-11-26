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

A Messages da Anthropic e a Responses da OpenAI são verbos do mesmo contrato, para quem já tem
código escrito para uma delas. `eventos` lê o fluxo de qualquer um dos três, evento a evento:

    m = llm.mensagens({'model': 'conversa', 'max_tokens': 512, 'messages': mensagens})
    for evento, dado in llm.eventos('responses', {'model': 'conversa', 'input': 'Olá'}):
        ...

A transcrição manda o arquivo em multipart, como a OpenAI:

    with open('entrevista.mp3', 'rb') as f:
        texto = llm.transcrever(f.read(), nome='entrevista.mp3', language='pt')['text']

Um erro do contrato chega como `ErroDoLlm`, com o `codigo` estável (`teto_atingido`,
`muitos_pedidos`, `sem_escopo`...), o `status` e o `depois_de` do `Retry-After`, em segundos.
"""

import json
import os
import uuid
import urllib.error
import urllib.parse
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


def _abrir(metodo, verbo, corpo=None, env=None, timeout=TEMPO_HTTP_S, tipo='application/json'):
    cred = _credencial(env)
    if not cred:
        raise ErroDoLlm('sem_escopo', disponivel(env)['motivo'])
    url, token = cred
    if corpo is None or isinstance(corpo, bytes):
        dados = corpo
    else:
        dados = json.dumps(corpo).encode('utf-8')
    req = urllib.request.Request(f'{url}/api/llm/v1/{verbo}', data=dados, method=metodo, headers={
        'Authorization': f'Bearer {token}', 'User-Agent': AGENTE,
        **({'Content-Type': tipo} if dados is not None else {}),
    })
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise _erro(e.code, e.read().decode('utf-8', 'replace'), e.headers.get('Retry-After')) from None


def _json(metodo, verbo, corpo=None, env=None, tipo='application/json'):
    with _abrir(metodo, verbo, corpo, env, tipo=tipo) as r:
        texto = r.read().decode('utf-8')
        return json.loads(texto) if 'json' in (r.headers.get('Content-Type') or '') else texto


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


def eventos(verbo, pedido, env=None):
    """
    O fluxo de qualquer verbo de conversa (`chat/completions`, `messages`, `responses`): um gerador
    de `(evento, dado)`, com o `event:` do SSE (`None` na Chat Completions) e o `data:` já lido. O
    `[DONE]` encerra. Um erro no meio do fluxo, na forma da OpenAI ou da Anthropic, lança `ErroDoLlm`.
    """
    with _abrir('POST', verbo, {**pedido, 'stream': True}, env) as r:
        evento = None
        for bruta in r:
            linha = bruta.decode('utf-8').strip()
            if not linha:
                evento = None
                continue
            if linha.startswith('event:'):
                evento = linha[6:].strip()
                continue
            if not linha.startswith('data:'):
                continue
            bruto = linha[5:].strip()
            if bruto == '[DONE]':
                return
            dado = json.loads(bruto)
            if isinstance(dado, dict) and dado.get('error'):
                e = dado['error']
                raise ErroDoLlm(e.get('code') or e.get('type') or 'modelo_fora_do_ar', e.get('message') or 'erro no fluxo', r.status)
            yield evento, dado


def mensagens(pedido, env=None):
    """`POST messages`, a Messages da Anthropic, sem fluxo."""
    return _json('POST', 'messages', {**pedido, 'stream': False}, env)


def respostas(pedido, env=None):
    """`POST responses`, a Responses da OpenAI, sem fluxo."""
    return _json('POST', 'responses', {**pedido, 'stream': False}, env)


def transcrever(audio, nome='audio.wav', model='transcricao', env=None, **campos):
    """
    `POST audio/transcriptions`: o texto de um arquivo de áudio. `audio` são os bytes; `nome` é o do
    arquivo (a extensão diz o formato), `model` é `transcricao` sem ele, e `campos` leva os da OpenAI
    (`language`, `prompt`, `response_format`...). Devolve o JSON, ou o texto quando o
    `response_format` é `text`, `srt` ou `vtt`.
    """
    fronteira = f'vssh-{uuid.uuid4().hex}'
    partes = []

    def campo(n, v):
        partes.append(f'--{fronteira}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode('utf-8'))

    campo('model', model)
    for n, v in campos.items():
        if v is not None:
            campo(n, json.dumps(v) if isinstance(v, (dict, list)) else str(v).lower() if isinstance(v, bool) else str(v))
    arquivo = str(nome).replace('"', '')
    partes.append(f'--{fronteira}\r\nContent-Disposition: form-data; name="file"; filename="{arquivo}"\r\n'
                  f'Content-Type: application/octet-stream\r\n\r\n'.encode('utf-8'))
    partes.append(bytes(audio))
    partes.append(f'\r\n--{fronteira}--\r\n'.encode('utf-8'))
    return _json('POST', 'audio/transcriptions', b''.join(partes), env, tipo=f'multipart/form-data; boundary={fronteira}')


def embeddings(pedido, env=None):
    """`POST embeddings`."""
    return _json('POST', 'embeddings', pedido, env)


def modelos(env=None):
    """
    `GET models`: os nomes por função e os do gateway, com `funcao`, `modelo`, `nome`, `descricao`,
    `janela`, `ferramentas`, `imagem` e `audio`.
    """
    return _json('GET', 'models', None, env)


def modelo(id, env=None):
    """`GET models/<id>`: um item da lista. Um nome que não existe lança `modelo_desconhecido`."""
    return _json('GET', f'models/{urllib.parse.quote(id, safe="")}', None, env)
