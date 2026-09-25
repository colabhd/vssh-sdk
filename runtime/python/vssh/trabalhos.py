"""
vssh.trabalhos: um trabalho longo que o app acompanha, na estação ou na fila, com a mesma cara.

    from vssh import trabalhos

    t = trabalhos.rodar('transcrever:3f2a', ['escriba-motor', '--entrada', a, '--saida', r],
                        titulo='Entrevista 03.m4a', ao_evento=publicar)
    t = trabalhos.na_fila('transcrever:3f2a', pedido, titulo='Entrevista 03.m4a',
                          ao_evento=publicar, linhas=True)

    t.estado()          # o registro: estado, progresso, motivo, código, job da fila
    t.cancelar()
    t.esperar(timeout)  # o registro final, ou o atual se o prazo acabar antes

`ao_evento(evento, registro)` recebe:

    estado      o trabalho mudou de estado (enviando, enviado, na_fila, rodando)
    progresso   o trabalho informou um progresso novo (`vssh.progresso`)
    linha       uma linha do stdout que não é de progresso, sem o `\\n`: o protocolo do próprio app
    fim         concluido, falhou ou cancelado; `motivo` e `codigo` dizem por quê

─── Na estação ──────────────────────────────────────────────────────────────

`rodar` sobe o processo num grupo próprio, e cancelar manda SIGTERM ao grupo inteiro: um motor
que abriu um `ffmpeg` filho não o deixa rodando sozinho. Cinco segundos depois, quem ainda estiver
de pé recebe SIGKILL. O stdout é lido linha a linha; as de progresso viram a atividade do trabalho
na bandeja, e as outras vão para o app. As últimas linhas do stderr dão o `motivo` de uma falha.
No fim, a notificação vai ao sino antes de a atividade sair, como em `avisos.limpar_atividade`.

─── Na fila ─────────────────────────────────────────────────────────────────

`na_fila` submete o pedido e segue o job pelos eventos do portal. Aqui a biblioteca não escreve
atividade nem notificação: o portal já põe o job em curso na bandeja e avisa o fim, e escrever de
novo daria duas linhas para o mesmo trabalho. Com `linhas=True`, ela segue também o log do
container quando ele começa a rodar, e entrega como `linha` o que não é progresso.

─── Depois de um reinício ──────────────────────────────────────────────────

O registro de cada trabalho mora em `$VSSH_APP_DATA_DIR/trabalhos/<chave>.json`, reescrito a cada
mudança. `retomar()` volta a seguir os da fila que estavam em curso, porque o job continua no
cluster. Um da estação não tem volta: o processo não é mais filho de ninguém, e o stdout dele se
perdeu. Ele é encerrado, para não segurar a GPU, e marcado como `falhou` com o motivo.

A chave segue a regra das atividades do shell (`[\\w:.-]`, até 64 caracteres), porque ela é a
chave da atividade na bandeja. Uma chave só tem um trabalho em curso de cada vez.
"""

import collections
import json
import os
import re
import signal
import subprocess
import threading
import time

from . import app as _app
from . import avisos
from . import fila
from . import progresso as _progresso

__all__ = ['rodar', 'na_fila', 'estado', 'listar', 'retomar', 'Trabalho', 'ESTADOS_FINAIS']

ESTADOS_FINAIS = ('concluido', 'falhou', 'cancelado')
_CHAVE = re.compile(r'^[\w:.-]{1,64}$')
_ESPERA_DO_SIGKILL_S = 5.0
# A bandeja não precisa de mais que duas atualizações por segundo, e um motor que informa cada
# milésimo escreveria o arquivo da atividade mil vezes.
_INTERVALO_DA_ATIVIDADE_S = 0.5

_tranca = threading.Lock()
_em_curso = {}
_renovacao = []


def _agora_ms():
    return int(time.time() * 1000)


def _diretorio(env):
    return os.path.join(_app.dados(env), 'trabalhos')


def _arquivo(chave, env):
    return os.path.join(_diretorio(env), chave + '.json')


def estado(chave, env=None):
    """O registro gravado de um trabalho, ou `None`."""
    try:
        with open(_arquivo(chave, env), encoding='utf-8') as f:
            r = json.load(f)
        return r if isinstance(r, dict) else None
    except (OSError, ValueError):
        return None


def listar(env=None):
    """Os registros gravados, do mais novo ao mais velho."""
    try:
        nomes = [n for n in os.listdir(_diretorio(env)) if n.endswith('.json')]
    except OSError:
        return []
    registros = [estado(n[:-5], env) for n in nomes]
    return sorted((r for r in registros if r), key=lambda r: r.get('criadoEm') or 0, reverse=True)


class Trabalho:
    """Um trabalho em curso ou terminado. Quem cria é `rodar`, `na_fila` ou `retomar`."""

    def __init__(self, registro, ao_evento, env):
        self.chave = registro['chave']
        self._reg = registro
        self._ao_evento = ao_evento
        self._env = env
        self._tranca = threading.Lock()
        self._fim = threading.Event()
        self._cancelado = False
        self._processo = None
        self._ultima_atividade = 0.0
        if registro['estado'] in ESTADOS_FINAIS:
            self._fim.set()

    def estado(self):
        with self._tranca:
            return dict(self._reg)

    def esperar(self, timeout=None):
        self._fim.wait(timeout)
        return self.estado()

    def cancelar(self):
        """Pede o fim. Na estação, SIGTERM ao grupo e SIGKILL depois; na fila, o cancelar do portal."""
        if self._fim.is_set():
            return False
        self._cancelado = True
        if self._reg['onde'] == 'estacao' and self._processo is not None:
            _sinalizar_grupo(self._processo.pid, signal.SIGTERM)
            p = self._processo

            def matar():
                if p.poll() is None:
                    _sinalizar_grupo(p.pid, signal.SIGKILL)
            t = threading.Timer(_ESPERA_DO_SIGKILL_S, matar)
            t.daemon = True
            t.start()
        elif self._reg['onde'] == 'fila' and self._reg.get('job'):
            try:
                fila.cancelar(self._reg['job'], env=self._env)
            except fila.ErroDaFila:
                pass
        return True

    # ── por dentro ──────────────────────────────────────────────────────────

    def _mudar(self, evento, **campos):
        with self._tranca:
            self._reg.update(campos)
            registro = dict(self._reg)
            _gravar(registro, self._env)
        if evento and self._ao_evento:
            try:
                self._ao_evento(evento, registro)
            except Exception as e:  # o app que ouve não derruba o trabalho
                print('[vssh.trabalhos] ao_evento(%s) de %s falhou: %s' % (evento, self.chave, e))
        return registro

    def _linha(self, texto):
        if self._ao_evento:
            try:
                self._ao_evento('linha', dict(self._reg, linha=texto))
            except Exception as e:
                print('[vssh.trabalhos] ao_evento(linha) de %s falhou: %s' % (self.chave, e))

    def _terminar(self, estado_final, motivo=None, codigo=None, antes_de_anunciar=None):
        """Grava o fim, faz o que precisa estar feito antes de alguém saber dele (a notificação e a
        atividade), e só então avisa o app e solta quem espera. Na ordem inversa, um backend que
        encerra logo depois de `esperar()` perderia a notificação."""
        with _tranca:
            if _em_curso.get(self.chave) is self:
                del _em_curso[self.chave]
        registro = self._mudar(None, estado=estado_final, motivo=motivo, codigo=codigo, terminadoEm=_agora_ms())
        if antes_de_anunciar:
            try:
                antes_de_anunciar(registro)
            except Exception as e:
                print('[vssh.trabalhos] o fim de %s não foi registrado: %s' % (self.chave, e))
        if self._ao_evento:
            try:
                self._ao_evento('fim', dict(registro))
            except Exception as e:
                print('[vssh.trabalhos] ao_evento(fim) de %s falhou: %s' % (self.chave, e))
        self._fim.set()
        return registro


def _gravar(registro, env):
    arquivo = _arquivo(registro['chave'], env)
    try:
        os.makedirs(os.path.dirname(arquivo), exist_ok=True)
        tmp = arquivo + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(registro, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, arquivo)
    except OSError as e:
        print('[vssh.trabalhos] não foi possível gravar %s: %s' % (arquivo, e))


def _sinalizar_grupo(pid, sinal):
    try:
        os.killpg(pid, sinal)
    except (ProcessLookupError, PermissionError):
        pass


def _registrar(chave, onde, titulo, env, **extra):
    if not isinstance(chave, str) or not _CHAVE.match(chave):
        raise ValueError('chave de trabalho inválida (use letras, números, ":", "." e "-", até 64): %r' % (chave,))
    with _tranca:
        vivo = _em_curso.get(chave)
        if vivo is not None and not vivo._fim.is_set():
            raise ValueError('já há um trabalho em curso com a chave %s' % chave)
    return dict({'chave': chave, 'titulo': titulo or chave, 'onde': onde, 'estado': 'enviando' if onde == 'fila' else 'rodando',
                 'progresso': None, 'motivo': None, 'codigo': None, 'criadoEm': _agora_ms(), 'terminadoEm': None}, **extra)


def _acompanhar_bandeja(env):
    with _tranca:
        if not _renovacao:
            _renovacao.append(avisos.manter_atividades_vivas(env=env))


# ── Na estação ────────────────────────────────────────────────────────────────

def _item_da_atividade(reg):
    p = reg.get('progresso') or {}
    return {
        'titulo': reg['titulo'],
        'texto': p.get('etapa') or 'Rodando',
        'formato': 'progresso',
        'progresso': {'feito': p['feito'], 'total': p['total']} if p.get('total') else {'indeterminado': True},
    }


def rodar(chave, comando, titulo=None, ao_evento=None, cwd=None, ambiente=None, registrar=True,
          acoes=None, rota=None, abrir=None, env=None):
    """Sobe `comando` (uma lista) e o acompanha. Devolve o `Trabalho`.

    `ambiente` é o ambiente do processo (o do app, por padrão). `registrar` decide a notificação
    do fim: `True` escreve uma com o título e o resultado, `False` não escreve, e uma função
    `registrar(registro) -> {titulo, texto, level} | None` escreve a que ela devolver. `acoes`,
    `rota` e `abrir` são os de `avisos.notificar`: botões na notificação, e o caminho dentro do
    app aonde o clique nela leva.
    """
    env = os.environ if env is None else env
    reg = _registrar(chave, 'estacao', titulo, env, pid=None)
    t = Trabalho(reg, ao_evento, env)
    processo = subprocess.Popen(list(comando), cwd=cwd, env=dict(ambiente) if ambiente is not None else None,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, bufsize=1, start_new_session=True)
    t._processo = processo
    with _tranca:
        _em_curso[chave] = t
    t._mudar(None, pid=processo.pid)
    _acompanhar_bandeja(env)
    avisos.atividade(chave, _item_da_atividade(reg), env=env)

    erros = collections.deque(maxlen=20)

    def ler_stderr():
        for linha in processo.stderr:
            if linha.strip():
                erros.append(linha.rstrip('\r\n'))

    def ler_stdout():
        for linha in processo.stdout:
            p = _progresso.ler(linha)
            if p is None:
                t._linha(linha.rstrip('\r\n'))
                continue
            registro = t._mudar('progresso', progresso=p)
            agora = time.monotonic()
            if agora - t._ultima_atividade >= _INTERVALO_DA_ATIVIDADE_S:
                t._ultima_atividade = agora
                avisos.atividade(chave, _item_da_atividade(registro), env=env)

    def esperar():
        leitores = [threading.Thread(target=ler_stdout, daemon=True), threading.Thread(target=ler_stderr, daemon=True)]
        for l in leitores:
            l.start()
        codigo = processo.wait()
        for l in leitores:
            l.join()
        if t._cancelado:
            estado_final, motivo = 'cancelado', None
        elif codigo == 0:
            estado_final, motivo = 'concluido', None
        else:
            estado_final, motivo = 'falhou', (erros[-1] if erros else 'saiu com o código %d' % codigo)
        def registrar_fim(registro):
            _notificar_fim(registro, registrar, acoes, rota, abrir, env)
            avisos.limpar_atividade(chave, env=env)
        t._terminar(estado_final, motivo=motivo, codigo=codigo, antes_de_anunciar=registrar_fim)

    threading.Thread(target=esperar, name='vssh-trabalho-%s' % chave, daemon=True).start()
    return t


def _notificar_fim(reg, registrar, acoes, rota, abrir, env):
    if not registrar or reg['estado'] == 'cancelado':   # quem cancelou já sabe
        return
    if callable(registrar):
        corpo = registrar(reg)
    elif reg['estado'] == 'concluido':
        corpo = {'titulo': reg['titulo'], 'texto': 'Terminou.', 'level': 'success'}
    else:
        corpo = {'titulo': reg['titulo'], 'texto': reg.get('motivo') or 'Falhou.', 'level': 'error'}
    if not corpo:
        return
    avisos.notificar(corpo.get('texto') or '', titulo=corpo.get('titulo'), nivel=corpo.get('level'),
                     chave='trabalho:%s:%s' % (reg['chave'], reg['criadoEm']), acoes=acoes, rota=rota, abrir=abrir, env=env)


# ── Na fila ───────────────────────────────────────────────────────────────────

def na_fila(chave, pedido, titulo=None, ao_evento=None, linhas=False, env=None):
    """Submete `pedido` à fila (o formato de `fila.submeter`) e o acompanha. Devolve o `Trabalho`."""
    env = os.environ if env is None else env
    reg = _registrar(chave, 'fila', titulo, env, job=None)
    t = Trabalho(reg, ao_evento, env)
    with _tranca:
        _em_curso[chave] = t
    t._mudar('estado')

    def submeter():
        try:
            ident = fila.submeter(pedido, env=env)
        except fila.ErroDaFila as e:
            t._terminar('falhou', motivo=e.mensagem, codigo=None)
            return
        t._mudar('estado', job=ident, estado='enviado')
        if t._cancelado:
            t.cancelar()
        _seguir(t, linhas, env)

    threading.Thread(target=submeter, name='vssh-trabalho-%s' % chave, daemon=True).start()
    return t


def _seguir(t, linhas, env):
    ident = t._reg['job']
    vistas = collections.OrderedDict()
    seguindo_log = []

    def seguir_log():
        # O log reabre se o stream cair com o job ainda rodando, e o portal manda de novo as
        # últimas linhas: as já entregues não saem duas vezes.
        while not t._fim.is_set():
            try:
                for linha in fila.log(ident, env=env):
                    if linha in vistas or _progresso.ler(linha) is not None:
                        continue
                    vistas[linha] = True
                    if len(vistas) > 2000:
                        vistas.popitem(last=False)
                    t._linha(linha)
            except fila.ErroDaFila:
                pass
            if t._fim.wait(3.0):
                return

    def ao_evento(evento, job):
        if evento == 'estado':
            t._mudar('estado', estado=job.get('estado') or t._reg['estado'], motivo=job.get('motivo'))
            if linhas and job.get('estado') == 'rodando' and not seguindo_log:
                seguindo_log.append(True)
                threading.Thread(target=seguir_log, daemon=True).start()
        elif evento == 'progresso' and job.get('progresso'):
            p = job['progresso']
            t._mudar('progresso', progresso={'feito': p.get('feito'), 'total': p.get('total'), 'etapa': p.get('etapa')})

    try:
        final = fila.acompanhar(ident, ao_evento=ao_evento, env=env)
    except fila.ErroDaFila as e:
        t._terminar('falhou', motivo=e.mensagem)
        return
    t._terminar(final.get('estado') or 'falhou', motivo=final.get('motivo'), codigo=final.get('exit'))


# ── Depois de um reinício ─────────────────────────────────────────────────────

def _vivo(pid):
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError, TypeError):
        return False


def retomar(ao_evento=None, linhas=False, env=None):
    """Volta a seguir os trabalhos da fila que estavam em curso, e encerra os da estação.

    Devolve os `Trabalho` retomados. Chame no boot do backend, antes de servir.
    """
    env = os.environ if env is None else env
    retomados = []
    for reg in listar(env):
        if reg.get('estado') in ESTADOS_FINAIS:
            continue
        with _tranca:
            if reg['chave'] in _em_curso:
                continue
        t = Trabalho(reg, ao_evento, env)
        if reg.get('onde') == 'fila' and reg.get('job'):
            with _tranca:
                _em_curso[t.chave] = t
            threading.Thread(target=_seguir, args=(t, linhas, env), daemon=True).start()
            retomados.append(t)
        else:
            if reg.get('pid') and _vivo(reg['pid']):
                _sinalizar_grupo(reg['pid'], signal.SIGKILL)
            motivo = 'o app reiniciou no meio' if reg.get('onde') == 'estacao' else 'o envio à fila foi interrompido'
            t._terminar('falhou', motivo=motivo, antes_de_anunciar=lambda _r: avisos.limpar_atividade(t.chave, env=env))
    return retomados
