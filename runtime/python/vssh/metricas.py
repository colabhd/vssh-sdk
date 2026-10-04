"""
As métricas e os erros do backend de um app, publicados no ambiente.

O app declara `recursos.metricas: true` no manifesto e recebe do portal, a cada subida,
`VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN`. Com eles, este módulo manda ao portal o que o app conta,
quanto as coisas levaram e as exceções que ele quer ver no log do ambiente:

    from vssh import metricas

    metricas.contar('transcricoes', rotulos={'motor': 'whisperx', 'onde': 'fila'})
    metricas.contar('audio_segundos', 312.5, {'lingua': 'pt'})

    with metricas.cronometro('transcricao', {'motor': 'whisperx'}):
        transcrever(arquivo)

    try:
        exportar(documento)
    except Exception as e:
        metricas.relatar_erro(e)
        raise

No portal, `contar` vira `vssh_app_events_total{app, event, ...}` e `duracao` vira
`vssh_app_event_duration_seconds{app, event, ...}`, no mesmo banco que o resto da plataforma. O
erro vira uma linha do log do portal com a origem `backend`, o app, o servidor e a pessoa da
credencial.

Um rótulo diz de que tipo é o evento (o motor, a língua, onde rodou), e nunca quem o causou nem
qual arquivo: até cinco por evento, a chave em minúsculas (`[a-z][a-z0-9_]*`), o valor com até 64
letras, dígitos e `_.:+-`. O portal recusa a série nova quando o app passa de 300.

Publicar nunca levanta e nunca espera a rede. Os eventos se juntam na memória (os contadores
somados por série) e saem por uma thread a cada 10 s, e na saída do processo; um envio que falhou
não volta. Sem a credencial nada é guardado nem sai, e `disponivel()` diz por quê.

Só biblioteca padrão, como o resto do pacote.
"""

import atexit
import json
import os
import threading
import time
import traceback
import urllib.error
import urllib.request

__all__ = ['disponivel', 'contar', 'duracao', 'cronometro', 'relatar_erro', 'enviar']

_INTERVALO_S = 10
_TEMPO_HTTP = 10
_AGENTE = 'vssh-sdk-metricas/python'
# As durações guardadas entre dois envios. Passado o teto, a mais nova fica de fora.
_DURACOES_MAX = 2000

_trava = threading.Lock()
_contadores = {}
_duracoes = []
_erros = []
_thread = None


def _credencial(env=None):
    env = os.environ if env is None else env
    url = (env.get('VSSH_PORTAL_URL') or '').rstrip('/')
    token = env.get('VSSH_PORTAL_TOKEN') or ''
    if not url or not token:
        return None
    return url, token


def disponivel(env=None):
    """`{'disponivel': bool, 'motivo': str | None}`. Nunca levanta e não fala com o portal."""
    if _credencial(env):
        return {'disponivel': True, 'motivo': None}
    return {'disponivel': False,
            'motivo': 'o app não declarou recursos.metricas no manifesto (ou ainda não foi reiniciado)'}


def _chave(nome, rotulos):
    return json.dumps([nome, sorted((rotulos or {}).items())], separators=(',', ':'))


def _garantir_thread():
    global _thread
    if _thread is not None:
        return
    _thread = threading.Thread(target=_laco, name='vssh-metricas', daemon=True)
    _thread.start()


def _laco():
    while True:
        time.sleep(_INTERVALO_S)
        enviar()


def contar(nome, valor=1, rotulos=None):
    """Soma `valor` ao contador `nome` com estes `rotulos`."""
    try:
        if not (isinstance(valor, (int, float)) and valor >= 0):
            return
        if not _credencial():
            return
        with _trava:
            k = _chave(nome, rotulos)
            atual = _contadores.get(k)
            if atual:
                atual['valor'] += valor
            else:
                _contadores[k] = {'nome': nome, 'tipo': 'contador', 'valor': valor, 'rotulos': dict(rotulos or {})}
        _garantir_thread()
    except Exception:
        pass


def duracao(nome, segundos, rotulos=None):
    """Registra que `nome` levou `segundos`."""
    try:
        if not (isinstance(segundos, (int, float)) and segundos >= 0):
            return
        if not _credencial():
            return
        with _trava:
            if len(_duracoes) < _DURACOES_MAX:
                _duracoes.append({'nome': nome, 'tipo': 'duracao', 'valor': segundos, 'rotulos': dict(rotulos or {})})
        _garantir_thread()
    except Exception:
        pass


class cronometro:
    """`with cronometro('nome', rotulos):` registra a duração do bloco, termine ele como terminar."""

    def __init__(self, nome, rotulos=None):
        self.nome = nome
        self.rotulos = rotulos

    def __enter__(self):
        self._t0 = time.monotonic()
        return self

    def __exit__(self, *_):
        duracao(self.nome, time.monotonic() - self._t0, self.rotulos)
        return False


def relatar_erro(erro, tipo=None):
    """Manda uma exceção (ou um texto) ao log do ambiente. `tipo`: `erro` (padrão) ou `relatado`."""
    try:
        if not _credencial():
            return
        if isinstance(erro, BaseException):
            mensagem = '%s: %s' % (type(erro).__name__, erro)
            pilha = ''.join(traceback.format_exception(type(erro), erro, erro.__traceback__))
        else:
            mensagem, pilha = str(erro), None
        with _trava:
            if len(_erros) < 50:
                _erros.append({'mensagem': mensagem, 'pilha': pilha, 'tipo': tipo or 'erro'})
        _garantir_thread()
    except Exception:
        pass


def _postar(rota, corpo, env=None):
    cred = _credencial(env)
    if not cred:
        return False
    url, token = cred
    req = urllib.request.Request(
        url + '/api/metricas' + rota, data=json.dumps(corpo, separators=(',', ':')).encode('utf-8'), method='POST',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': _AGENTE},
    )
    try:
        with urllib.request.urlopen(req, timeout=_TEMPO_HTTP) as r:
            r.read()
        return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


def enviar(env=None):
    """Manda agora o que está guardado. Devolve `True` quando nada falhou."""
    with _trava:
        eventos = list(_contadores.values()) + _duracoes[:]
        erros = _erros[:]
        _contadores.clear()
        del _duracoes[:]
        del _erros[:]
    ok = True
    for i in range(0, len(eventos), 200):
        ok = _postar('', {'eventos': eventos[i:i + 200]}, env) and ok
    for i in range(0, len(erros), 10):
        ok = _postar('/erros', {'erros': erros[i:i + 10]}, env) and ok
    return ok


atexit.register(lambda: enviar() if (_contadores or _duracoes or _erros) else None)
