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
    saida       na fila, com `saidasAoVivo` no pedido: uma saída que subiu com o job rodando, em
                `registro['saida']` (`nome`, `tamanho`), já pronta para `fila.baixar`
    fim         concluido, falhou ou cancelado; `motivo` e `codigo` dizem por quê

─── Na estação ──────────────────────────────────────────────────────────────

`rodar` sobe o comando destacado do backend, por um executor (`vssh/executor.py`) que grava o
stdout e o stderr dele em arquivos, num diretório do trabalho em `~/.cache/vssh/trabalhos/<id>/`.
O backend segue o trabalho lendo esses arquivos: as linhas de progresso viram eventos e a
atividade do trabalho na bandeja, e as outras vão para o app. Cancelar manda SIGTERM ao grupo do
comando: um motor que abriu um `ffmpeg` filho não o deixa rodando sozinho. Cinco segundos depois,
quem ainda estiver de pé recebe SIGKILL. As últimas linhas do stderr dão o `motivo` de uma falha.
No fim, a notificação vai ao sino antes de a atividade sair, como em `avisos.limpar_atividade`.

─── Na fila ─────────────────────────────────────────────────────────────────

`na_fila` submete o pedido e segue o job pelos eventos do portal. Aqui a biblioteca não escreve
atividade nem notificação: o portal já põe o job em curso na bandeja e avisa o fim, e escrever de
novo daria duas linhas para o mesmo trabalho. Com `linhas=True`, ela segue também o log do
container quando ele começa a rodar, e entrega como `linha` o que não é progresso. Cada saída que
sobe ao vivo chega uma vez como `saida`; depois de um `retomar`, as que já tinham subido chegam de
novo, e o app que as baixa confere se já as tem.

─── Depois de um reinício ──────────────────────────────────────────────────

O registro de cada trabalho mora em `$VSSH_APP_DATA_DIR/trabalhos/<chave>.json`, reescrito a cada
mudança. `retomar()` volta a seguir os que estavam em curso. Um da fila continua no cluster.

Um da estação continua rodando sem o backend, porque o comando não é filho dele. O que o backend
que volta faz com esse trabalho, quem decide é o `rodar`:

    rodar(..., retomavel=True)   o backend volta a segui-lo: lê os arquivos de onde tinha parado, e
                                 o fim que aconteceu com ele fora chega na volta, com a notificação
    rodar(...)                   o trabalho é encerrado, para não segurar a GPU, e marcado como
                                 `falhou` com o motivo. É o padrão: o app que retoma um trabalho
                                 precisa ter em `retomar` quem ouça os eventos dele

A posição lida é gravada depois da entrega, então uma linha pode chegar de novo depois de um
reinício, e o app que não pode repeti-la confere se já a tem. O app que guarda na memória o que
ouviu pede `retomar(desde_o_comeco=True)`: a saída inteira do trabalho chega de novo, da primeira
linha, e ele refaz o que tinha. Um trabalho cujo executor morreu sem
escrever o fim (um SIGKILL, a estação reiniciada) termina em `falhou`.

No registro, `pid` é o do comando, e `executor` é o do processo que o acompanha.

A chave segue a regra das atividades do shell (`[\\w:.-]`, até 64 caracteres), porque ela é a
chave da atividade na bandeja. Uma chave só tem um trabalho em curso de cada vez.
"""

import collections
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time

from . import app as _app
from . import avisos
from . import fila
from . import progresso as _progresso

__all__ = ['rodar', 'na_fila', 'estado', 'listar', 'retomar', 'Trabalho', 'ESTADOS_FINAIS',
           'disparar', 'vivo', 'grupo', 'fim', 'encerrar']

ESTADOS_FINAIS = ('concluido', 'falhou', 'cancelado')
_CHAVE = re.compile(r'^[\w:.-]{1,64}$')
# De quanto em quanto tempo o backend lê os arquivos de um trabalho da estação.
_VOLTA_S = 0.25
_EXECUTOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'executor.py')

_tranca = threading.Lock()
_em_curso = {}


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
        if registro['estado'] in ESTADOS_FINAIS:
            self._fim.set()

    def estado(self):
        with self._tranca:
            return dict(self._reg)

    def esperar(self, timeout=None):
        self._fim.wait(timeout)
        return self.estado()

    def cancelar(self):
        """Pede o fim. Na estação, o executor manda SIGTERM ao grupo do comando e SIGKILL depois;
        na fila, é o cancelar do portal."""
        if self._fim.is_set():
            return False
        self._cancelado = True
        if self._reg['onde'] == 'estacao' and self._reg.get('dir'):
            try:
                with open(os.path.join(self._reg['dir'], 'cancel'), 'w'):
                    pass
            except OSError:
                return False
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

    def _saida(self, saida):
        if self._ao_evento:
            try:
                self._ao_evento('saida', dict(self._reg, saida=dict(saida)))
            except Exception as e:
                print('[vssh.trabalhos] ao_evento(saida) de %s falhou: %s' % (self.chave, e))

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


# ── Na estação ────────────────────────────────────────────────────────────────

def _base(env):
    """Onde moram os diretórios dos trabalhos da estação: `~/.cache/vssh/trabalhos`."""
    home = env.get('HOME')
    if not home and env.get('VSSH_APP_DATA_DIR'):
        home = os.path.abspath(os.path.join(env['VSSH_APP_DATA_DIR'], '..', '..', '..'))
    return os.path.join(home or os.path.expanduser('~'), '.cache', 'vssh', 'trabalhos')


def _novo_id():
    n, alfabeto, texto = _agora_ms(), '0123456789abcdefghijklmnopqrstuvwxyz', ''
    while n:
        n, r = divmod(n, 36)
        texto = alfabeto[r] + texto
    return '%s-%s' % (texto or '0', os.urandom(4).hex())


def _nascimento(pid):
    """O instante em que o processo nasceu, em tiques desde o boot (campo 22 de
    `/proc/<pid>/stat`), ou `None` fora do Linux. O nome do processo vem entre parênteses e pode
    ter espaço, então a contagem começa depois do último `)`."""
    try:
        with open('/proc/%d/stat' % pid) as f:
            return f.read().rsplit(')', 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def _executor_vivo(d):
    """O executor do trabalho em `d` ainda roda? O pid está de pé e é o do processo que nasceu
    quando o trabalho foi disparado: o kernel reaproveita o número de um processo que morreu."""
    try:
        with open(os.path.join(d, 'pid')) as f:
            partes = f.read().split()
        pid = int(partes[0])
        if os.name != 'posix':
            return False   # no Windows, `os.kill(pid, 0)` mata o processo
        os.kill(pid, 0)
        return len(partes) < 2 or _nascimento(pid) == partes[1]
    except (OSError, ValueError, IndexError):
        return False


def _grupo_do_comando(d):
    """O grupo de processos do comando do trabalho em `d`, se ele ainda é o que nasceu ali: o
    nascimento gravado garante que não é o de outro processo que herdou o número. `None` quando
    o comando não subiu ou já saiu."""
    try:
        with open(os.path.join(d, 'grupo')) as f:
            partes = f.read().split()
        if len(partes) > 1 and _nascimento(int(partes[0])) == partes[1]:
            return int(partes[0])
    except (OSError, ValueError, IndexError):
        pass
    return None


def _encerrar_orfao(d):
    """O executor morreu sem escrever o fim (um SIGKILL, a memória acabou), e o comando ficou sem
    ninguém: ele é encerrado, para não segurar a GPU."""
    grupo = _grupo_do_comando(d)
    if grupo is not None:
        _sinalizar_grupo(grupo, signal.SIGKILL)


def _encerrar(d):
    """Encerra de vez o trabalho em `d`: o executor primeiro, para ele não escrever um fim, e o
    comando depois."""
    if _executor_vivo(d):
        try:
            with open(os.path.join(d, 'pid')) as f:
                os.kill(int(f.read().split()[0]), signal.SIGKILL)
        except (OSError, ValueError, IndexError):
            pass
    _encerrar_orfao(d)


def _pid_do_comando(d):
    try:
        with open(os.path.join(d, 'grupo')) as f:
            return int(f.read().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def _ler_json(caminho):
    try:
        with open(caminho, encoding='utf-8') as f:
            r = json.load(f)
        return r if isinstance(r, dict) else None
    except (OSError, ValueError):
        return None


def _posicao_lida(d):
    try:
        with open(os.path.join(d, 'lido')) as f:
            return int(f.read().strip() or 0)
    except (OSError, ValueError):
        return 0


def _entregar(t, d, posicao, tudo):
    """Entrega ao app o que o comando escreveu desde `posicao`, e devolve a posição nova. Sem
    `tudo`, uma linha que ainda não terminou espera a volta seguinte."""
    try:
        with open(os.path.join(d, 'saida'), 'rb') as f:
            f.seek(posicao)
            novo = f.read()
    except OSError:
        return posicao
    if not tudo:
        novo = novo[:novo.rfind(b'\n') + 1]
    if not novo:
        return posicao
    for linha in novo.decode('utf-8', 'replace').splitlines():
        p = _progresso.ler(linha)
        if p is None:
            t._linha(linha)
        else:
            t._mudar('progresso', progresso=p)
    posicao += len(novo)
    try:
        tmp = os.path.join(d, 'lido.tmp')
        with open(tmp, 'w') as f:
            f.write(str(posicao))
        os.replace(tmp, os.path.join(d, 'lido'))
    except OSError:
        pass
    return posicao


def _seguir_na_estacao(t, processo, registrar, env, desde_o_comeco=False):
    """Lê os arquivos do trabalho até o fim dele, e então grava o fim, notifica, tira a atividade
    e apaga o diretório. `processo` é o executor quando foi este backend que o subiu."""
    d = t._reg['dir']
    posicao = 0 if desde_o_comeco else _posicao_lida(d)
    while True:
        if t._reg.get('pid') is None:
            pid = _pid_do_comando(d)
            if pid is not None:
                t._mudar(None, pid=pid)
        # O fim é conferido antes da leitura: o que o comando escreveu até sair entra nela.
        acabou = os.path.exists(os.path.join(d, 'exit'))
        if not acabou:
            vivo = processo.poll() is None if processo is not None else _executor_vivo(d)
            if not vivo:
                acabou = os.path.exists(os.path.join(d, 'exit'))   # escrito entre as duas leituras
        else:
            vivo = False
        posicao = _entregar(t, d, posicao, tudo=acabou or not vivo)
        if acabou or not vivo:
            if not acabou:
                _encerrar_orfao(d)
            break
        time.sleep(_VOLTA_S)
    if processo is not None:
        try:
            processo.wait(5)   # recolhe o executor, que já escreveu o fim
        except subprocess.TimeoutExpired:
            pass
    fim = _ler_json(os.path.join(d, 'fim.json')) if acabou else None
    if fim is None:
        fim = {'estado': 'falhou', 'codigo': None, 'motivo': 'o trabalho parou antes de terminar'}

    def registrar_fim(registro):
        _notificar_fim(registro, registrar.get('registrar', True), registrar.get('acoes'), registrar.get('rota'),
                       registrar.get('abrir'), env)
        avisos.limpar_atividade(t.chave, env=env)
        shutil.rmtree(d, ignore_errors=True)
    t._terminar(fim.get('estado') if fim.get('estado') in ESTADOS_FINAIS else 'falhou', motivo=fim.get('motivo'),
                codigo=fim.get('codigo'), antes_de_anunciar=registrar_fim)


# ── A peça de baixo: disparar um comando destacado, e perguntar por ele ──────────────────────────
#
# `rodar` é isto mais o registro, os eventos e a notificação. Quem já tem o próprio jeito de contar
# o que acontece (o agente do sistema, com os jobs de arquivo que o shell segue por SSE) usa só
# esta parte: o disparo, a marca de quem está vivo e o fim.

def disparar(comando, base=None, cwd=None, ambiente=None, pedido=None, arquivos=None, env=None):
    """Sobe `comando` (uma lista) destacado, por um executor, num diretório de trabalho novo.
    Devolve `(diretório, processo do executor)`.

    `base` é onde o diretório nasce (`~/.cache/vssh/trabalhos` por padrão). `pedido` são os
    campos a mais do `pedido.json`: com `chave` e `titulo`, o executor mantém a atividade do
    trabalho na bandeja, e `atividade: False` a desliga. `arquivos` (`{nome: texto}`) são
    gravados no diretório antes de o comando subir: é por onde entra um `params.json`. O comando
    recebe o diretório em `VSSH_TRABALHO_DIR`, e `ambiente`, que pode levar uma credencial, vai
    ao executor pelo stdin e não toca o disco.
    """
    env = os.environ if env is None else env
    d = os.path.join(base or _base(env), _novo_id())
    os.makedirs(d, mode=0o700)
    try:
        for nome, texto in (arquivos or {}).items():
            with open(os.path.join(d, os.path.basename(nome)), 'w', encoding='utf-8') as f:
                f.write(texto)
        with open(os.path.join(d, 'pedido.json'), 'w', encoding='utf-8') as f:
            json.dump(dict(pedido or {}, app=env.get('VSSH_APP_ID'), comando=list(comando), cwd=cwd), f, ensure_ascii=False)
        # O executor roda com o ambiente de quem dispara (é dele a atividade na bandeja), e recebe o
        # do comando pelo stdin. Sessão própria: ele não morre com quem o disparou.
        processo = subprocess.Popen([sys.executable or 'python3', _EXECUTOR, d], env=dict(env), stdin=subprocess.PIPE,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError:
        shutil.rmtree(d, ignore_errors=True)
        raise
    nasceu = _nascimento(processo.pid)
    with open(os.path.join(d, 'pid'), 'w') as f:
        f.write('%d %s' % (processo.pid, nasceu) if nasceu else str(processo.pid))
    try:
        processo.stdin.write(json.dumps({'ambiente': dict(ambiente) if ambiente is not None else None}).encode('utf-8'))
        processo.stdin.close()
    except OSError:
        pass   # o executor morreu antes de ler: quem acompanha vê o trabalho parado, sem fim
    return d, processo


def vivo(d):
    """O trabalho do diretório `d` ainda roda: não escreveu o fim, e o executor dele está de pé."""
    return not os.path.exists(os.path.join(d, 'exit')) and _executor_vivo(d)


def grupo(d):
    """O grupo de processos do comando do trabalho em `d`, ou `None` quando o comando não subiu
    ou já saiu. É o que se leva a `nice` 19 para o trabalho ceder a vez."""
    return _grupo_do_comando(d)


def fim(d):
    """O fim do trabalho em `d` (`estado`, `codigo`, `motivo`, `terminadoEm`), ou `None` enquanto
    ele não terminou de escrevê-lo."""
    return _ler_json(os.path.join(d, 'fim.json')) if os.path.exists(os.path.join(d, 'exit')) else None


def encerrar(d):
    """Encerra de vez o trabalho em `d`, sem esperar o comando limpar nada: o executor, e o grupo
    do comando. É para o trabalho que ficou sem ninguém; quem quer que o comando saia por conta
    própria escreve o arquivo `cancel`."""
    _encerrar(d)


def rodar(chave, comando, titulo=None, ao_evento=None, cwd=None, ambiente=None, registrar=True,
          acoes=None, rota=None, abrir=None, retomavel=False, env=None):
    """Sobe `comando` (uma lista) destacado do backend e o acompanha. Devolve o `Trabalho`.

    Com `retomavel=True`, o `retomar()` de um backend que reiniciou volta a seguir o trabalho; sem
    ele, o `retomar()` o encerra.

    `ambiente` é o ambiente do processo (o do app, por padrão). `registrar` decide a notificação
    do fim: `True` escreve uma com o título e o resultado, `False` não escreve, e uma função
    `registrar(registro) -> {titulo, texto, level} | None` escreve a que ela devolver. `acoes`,
    `rota` e `abrir` são os de `avisos.notificar`: botões na notificação, e o caminho dentro do
    app aonde o clique nela leva. O que não é função fica gravado com o trabalho, e vale também
    depois de um `retomar`.
    """
    env = os.environ if env is None else env
    reg = _registrar(chave, 'estacao', titulo, env, pid=None, executor=None, dir=None, retomavel=bool(retomavel))
    notificacao = {'registrar': 'funcao' if callable(registrar) else bool(registrar), 'acoes': acoes, 'rota': rota, 'abrir': abrir}
    d, processo = disparar(comando, cwd=cwd, ambiente=ambiente, env=env, pedido={
        'chave': chave, 'titulo': reg['titulo'], 'notificacao': notificacao, 'criadoEm': reg['criadoEm']})
    t = Trabalho(dict(reg, dir=d), ao_evento, env)
    with _tranca:
        _em_curso[chave] = t
    t._mudar(None, executor=processo.pid)
    seguir = {'registrar': registrar, 'acoes': acoes, 'rota': rota, 'abrir': abrir}
    threading.Thread(target=_seguir_na_estacao, args=(t, processo, seguir, env), name='vssh-trabalho-%s' % chave,
                     daemon=True).start()
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

    # As duas threads terminam o trabalho em qualquer erro. Uma exceção que escapasse mataria a
    # thread calada, e o trabalho ficaria no último estado para sempre, sem motivo na tela.
    def submeter():
        try:
            ident = fila.submeter(pedido, env=env)
        except fila.ErroDaFila as e:
            t._terminar('falhou', motivo=e.mensagem, codigo=None)
            return
        except Exception as e:
            t._terminar('falhou', motivo='a submissão à fila quebrou: %s' % (str(e) or type(e).__name__), codigo=None)
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
    saidas = set()

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
        elif evento == 'saida' and isinstance(job.get('saida'), dict) and job['saida'].get('nome') not in saidas:
            saidas.add(job['saida'].get('nome'))
            t._saida(job['saida'])

    try:
        final = fila.acompanhar(ident, ao_evento=ao_evento, env=env)
    except fila.ErroDaFila as e:
        t._terminar('falhou', motivo=e.mensagem)
        return
    except Exception as e:
        t._terminar('falhou', motivo='o acompanhamento do job quebrou: %s' % (str(e) or type(e).__name__))
        return
    t._terminar(final.get('estado') or 'falhou', motivo=final.get('motivo'), codigo=final.get('exit'))


# ── Depois de um reinício ─────────────────────────────────────────────────────

def _vivo(pid):
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError, TypeError):
        return False


# Um diretório de trabalho sem registro em curso é sobra: o app apagou o registro, ou caiu entre
# criar o diretório e gravá-lo. A hora de espera cobre um `rodar` que está nesse intervalo agora.
_SOBRA_S = 60 * 60


def _faxina(env):
    """Apaga os diretórios deste app que nenhum registro em curso segue e cujo executor já saiu."""
    base = _base(env)
    seguidos = {r.get('dir') for r in listar(env) if r.get('estado') not in ESTADOS_FINAIS}
    try:
        nomes = os.listdir(base)
    except OSError:
        return
    limite = time.time() - _SOBRA_S
    for nome in nomes:
        d = os.path.join(base, nome)
        if d in seguidos or (_ler_json(os.path.join(d, 'pedido.json')) or {}).get('app') != env.get('VSSH_APP_ID'):
            continue
        try:
            if os.stat(d).st_mtime >= limite or (not os.path.exists(os.path.join(d, 'exit')) and _executor_vivo(d)):
                continue
        except OSError:
            continue
        shutil.rmtree(d, ignore_errors=True)


def retomar(ao_evento=None, linhas=False, registrar=None, desde_o_comeco=False, env=None):
    """Volta a seguir os trabalhos que estavam em curso: os da fila, e os da estação que o
    `rodar` marcou com `retomavel=True`. Os outros da estação são encerrados.

    Devolve os `Trabalho` retomados. Chame no boot do backend, antes de servir. `registrar` é a
    função da notificação do fim para os trabalhos da estação que tinham uma (`rodar` não tem
    como gravá-la); sem ela, o fim desses escreve a notificação padrão. Com `desde_o_comeco`, a
    saída de cada trabalho da estação chega de novo da primeira linha, e não de onde o backend
    anterior parou.
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
        elif reg.get('onde') == 'estacao' and reg.get('retomavel') and reg.get('dir') and os.path.isdir(reg['dir']):
            pedido = _ler_json(os.path.join(reg['dir'], 'pedido.json')) or {}
            seguir = dict(pedido.get('notificacao') or {})
            if seguir.get('registrar') == 'funcao':
                seguir['registrar'] = registrar if callable(registrar) else True
            with _tranca:
                _em_curso[t.chave] = t
            threading.Thread(target=_seguir_na_estacao, args=(t, None, seguir, env, desde_o_comeco),
                             name='vssh-trabalho-%s' % t.chave, daemon=True).start()
            retomados.append(t)
        else:
            # O trabalho da estação que o app não pediu para retomar é encerrado, para não segurar
            # a GPU. Um sem diretório é de um runtime anterior, em que o comando era filho do
            # backend e o `pid` gravado era o dele.
            d = reg.get('dir') if reg.get('onde') == 'estacao' else None
            if d and os.path.isdir(d):
                _encerrar(d)
            elif reg.get('onde') == 'estacao' and not d and reg.get('pid') and _vivo(reg['pid']):
                _sinalizar_grupo(reg['pid'], signal.SIGKILL)
            motivo = 'o app reiniciou no meio' if reg.get('onde') == 'estacao' else 'o envio à fila foi interrompido'

            def limpar(_r, t=t, d=d):
                avisos.limpar_atividade(t.chave, env=env)
                if d:
                    shutil.rmtree(d, ignore_errors=True)
            t._terminar('falhou', motivo=motivo, antes_de_anunciar=limpar)
    _faxina(env)
    return retomados
