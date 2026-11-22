"""
Os agentes da pessoa para o backend de um app, pelo provedor `agentes/v1` da estação. O par de
`vssh/agentes.js`. O contrato está em docs/agentes.md do vssh-sso.

O provedor é o app embutido `agentes`, que roda como a mesma pessoa. Este módulo fala com o socket
dele, com o token que o processo dele tem, e diz quem chama (`X-Vssh-Chamador`, o `VSSH_APP_ID`).

    from vssh import agentes

    c = agentes.abrir({'agente': 'claude', 'instrucoes': instrucoes,
                       'mcp': {'meuapp': {'comando': ['python3', 'mcp.py']}}})
    for tipo, dados in agentes.mensagem(c['id'], 'Quantas citações tem o capítulo 2?'):
        if tipo == 'texto':
            print(dados['delta'], end='')
    agentes.encerrar(c['id'])

Um erro do contrato chega como `ErroDoAgente`, com o `codigo` estável (`sem_conta`,
`pede_confirmacao`, `conversa_desconhecida`...) e o `status`. Sem o provedor de pé, o código é
`sem_provedor`.
"""

import http.client
import json
import os
import re
import socket
import urllib.parse

SEM_PROVEDOR = 'o provedor de agentes não está de pé nesta conta'


class ErroDoAgente(Exception):
    def __init__(self, codigo, mensagem, status=0):
        super().__init__(mensagem)
        self.codigo = codigo
        self.status = status


class _ConexaoUnix(http.client.HTTPConnection):
    def __init__(self, caminho, timeout):
        super().__init__('agentes', timeout=timeout)
        self._caminho = caminho

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self._caminho)


def _token(pasta):
    try:
        with open(os.path.join(pasta, 'run.pid')) as f:
            pid = f.read().strip()
        with open(f'/proc/{pid}/environ', 'rb') as f:
            for linha in f.read().split(b'\0'):
                if linha.startswith(b'VSSH_APP_TOKEN='):
                    return linha[15:].decode()
    except (OSError, ValueError):
        pass
    try:
        with open(os.path.join(pasta, 'env')) as f:
            for linha in f:
                m = re.match(r'^(?:export\s+)?VSSH_APP_TOKEN=(.*)$', linha.strip())
                if m:
                    return re.sub(r'^([\'"])(.*)\1$', r'\2', m.group(1))
    except OSError:
        pass
    return ''


def _conexao(env, timeout):
    if env.get('VSSH_AGENTES_URL'):
        u = urllib.parse.urlparse(env['VSSH_AGENTES_URL'])
        return http.client.HTTPConnection(u.hostname, u.port, timeout=timeout), env.get('VSSH_AGENTES_TOKEN', '')
    pasta = os.path.join(env.get('HOME') or os.path.expanduser('~'), '.vssh-apps', 'agentes')
    caminho = env.get('VSSH_AGENTES_SOCKET') or os.path.join(pasta, 'app.sock')
    return _ConexaoUnix(caminho, timeout), env.get('VSSH_AGENTES_TOKEN') or _token(pasta)


def _erro(status, texto):
    try:
        e = json.loads(texto).get('erro') or {}
    except ValueError:
        e = {}
    if status == 403 and not e.get('codigo'):
        return ErroDoAgente('sem_provedor', 'o provedor de agentes recusou o token: ele reiniciou, tente de novo', status)
    return ErroDoAgente(e.get('codigo') or 'agente_saiu', e.get('mensagem') or texto or f'o provedor respondeu {status}', status)


def _abrir(metodo, rota, corpo=None, env=None, timeout=None):
    env = os.environ if env is None else env
    conexao, token = _conexao(env, timeout)
    dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
    cabecalhos = {'X-Vssh-Chamador': env.get('VSSH_APP_ID') or 'desconhecido'}
    if token:
        cabecalhos['X-Vssh-App-Token'] = token
    if dados is not None:
        cabecalhos['Content-Type'] = 'application/json'
    try:
        conexao.request(metodo, f'/agentes/v1/{rota}', body=dados, headers=cabecalhos)
        return conexao, conexao.getresponse()
    except (FileNotFoundError, ConnectionRefusedError):
        conexao.close()
        raise ErroDoAgente('sem_provedor', SEM_PROVEDOR) from None


def _json(metodo, rota, corpo=None, env=None):
    conexao, r = _abrir(metodo, rota, corpo, env, timeout=60)
    try:
        texto = r.read().decode('utf-8')
    finally:
        conexao.close()
    if not 200 <= r.status < 300:
        raise _erro(r.status, texto)
    return json.loads(texto)


def listar(pedidos=(), renovar=False, env=None):
    """`GET agentes`: `{'agentes': [...]}`. `pedidos` nomeia quem aparece mesmo fora da conta."""
    q = {}
    if pedidos:
        q['pedidos'] = ','.join(pedidos)
    if renovar:
        q['renovar'] = '1'
    return _json('GET', 'agentes' + (f'?{urllib.parse.urlencode(q)}' if q else ''), env=env)


def abrir(pedido, env=None):
    """`POST conversas`: `{'id', 'agente', 'aviso_de_privacidade', 'primeira_vez', ...}`."""
    return _json('POST', 'conversas', pedido, env)


def mensagem(id_, texto, env=None):
    """`POST conversas/<id>/mensagens`: um gerador de `(tipo, dados)` até o fim do fluxo."""
    conexao, r = _abrir('POST', f'conversas/{urllib.parse.quote(id_)}/mensagens', {'texto': texto}, env)
    try:
        if not 200 <= r.status < 300:
            raise _erro(r.status, r.read().decode('utf-8'))
        tipo, dados = 'message', []
        for bruta in r:
            linha = bruta.decode('utf-8').rstrip('\r\n')
            if not linha:
                if dados:
                    yield tipo, json.loads('\n'.join(dados))
                tipo, dados = 'message', []
            elif linha.startswith('event:'):
                tipo = linha[6:].strip()
            elif linha.startswith('data:'):
                dados.append(linha[5:].lstrip())
    finally:
        conexao.close()


def cancelar(id_, env=None):
    return _json('POST', f'conversas/{urllib.parse.quote(id_)}/cancelar', {}, env)


def encerrar(id_, env=None):
    return _json('DELETE', f'conversas/{urllib.parse.quote(id_)}', env=env)


def confirmar(agente, aceito, env=None):
    """Guarda (ou tira) a confirmação da pessoa para um agente que a pede, como o Antigravity."""
    return _json('POST', f'agentes/{urllib.parse.quote(agente)}/confirmacao', {'aceito': bool(aceito)}, env)
