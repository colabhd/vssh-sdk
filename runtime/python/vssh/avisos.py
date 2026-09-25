"""
A voz de um app sem janela: notificar, dizer o que está fazendo agora, e ter um ícone na bandeja.

Um app com janela fala com o shell pela ponte de `postMessage`, e não precisa disto. Um
`type: "engine"` ou `kind: "service"` não tem iframe, e é justamente ele que mais precisa ser
ouvido: o backup que falhou às 3h da manhã, o índice que está sendo reconstruído, o rclone que
sincroniza. O modelo é estado por arquivo, e quem lê é o coletor do portal
(`src/services/server-collector.ts`), um exec por servidor a cada poucos segundos, só enquanto
alguém tem o desktop aberto. Escrever é barato e não custa nada quando ninguém está olhando;
escrever em laço apertado não aparece mais rápido.

Três coisas diferentes, e escolher errado custa a atenção de quem usa:

    notificar   um fato que aconteceu. Vai para o histórico do sino, e fica.
    atividade   uma condição verdadeira agora, com título, texto e barra. Some quando acaba.
    bandeja     um ícone com badge. Cabe num símbolo e um número.

Os três arquivos, e o que cada um significa para o coletor:

    ~/.vssh-notifications/journal.ndjson   histórico, só acrescenta; o `id` decide o que é novo
    ~/.vssh-notifications/live/<chave>.json  atividade viva enquanto o arquivo existir e o `at`
                                             (epoch ms) tiver menos de ~60 s
    ~/.vssh-apps/<id>/tray.json              o ícone; sumiu o arquivo, sumiu o ícone

Nenhuma função daqui levanta. Um app tem trabalho de verdade a fazer, e ele não para porque um
aviso não coube no disco; fora do VSSH (sem `HOME`, sem dados do app) tudo devolve `None` ou
`False` sem barulho.
"""

import hashlib
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone

from . import app as _app

__all__ = [
    'notificar', 'caminho_do_journal',
    'atividade', 'limpar_atividade', 'manter_atividades_vivas', 'limpar_atividades_ao_sair',
    'caminho_da_atividade',
    'bandeja', 'limpar_bandeja', 'limpar_bandeja_ao_sair', 'caminho_da_bandeja',
]

_DIR = '.vssh-notifications'
_JOURNAL = 'journal.ndjson'

# Rotação do journal: acima do teto de bytes, o arquivo é reescrito com as últimas linhas. O
# número de linhas mantidas é bem maior que a janela que o coletor lê (~50): cortar perto da
# janela arriscaria apagar algo que ainda não foi entregue.
_MAX_BYTES = 256 * 1024
_MANTER_LINHAS = 200

_NIVEIS = ('info', 'success', 'warning', 'error')

# Renovação um pouco abaixo da metade do TTL do coletor (60 s): dois tiques perdidos ainda cabem
# no prazo, e uma pausa do interpretador não apaga a atividade sozinha.
_RENOVA_S = 20.0

_tranca = threading.Lock()
_vivas = {}


def _home(env):
    if env.get('HOME'):
        return env['HOME']
    # Sem HOME (systemd sem `User=`, container magro) a home sai do diretório de dados, que é
    # `<home>/.vssh-apps/<id>/data`.
    dados = env.get('VSSH_APP_DATA_DIR')
    if dados:
        return os.path.abspath(os.path.join(dados, '..', '..', '..'))
    return None


def _escrever_atomico(arquivo, corpo):
    """Temporário e `rename`: o coletor nunca lê um arquivo pela metade. Sem isso, o corte
    aconteceria justamente no instante do poll, e o sintoma seria um ícone ou uma barra piscando
    sob atualização frequente, que é quando eles importam."""
    os.makedirs(os.path.dirname(arquivo), exist_ok=True)
    tmp = arquivo + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(corpo, fh, ensure_ascii=False, default=str, separators=(',', ':'))
    os.replace(tmp, arquivo)


# ── Notificar ─────────────────────────────────────────────────────────────────────────────────

def caminho_do_journal(env=None):
    """O journal é do usuário, e não do app: um arquivo só, com todos os apps dele dentro, que o
    coletor lê num `tail` por usuário."""
    env = os.environ if env is None else env
    h = _home(env)
    return os.path.join(h, _DIR, _JOURNAL) if h else None


def _id_de(app_id, chave):
    """A `chave` vira id legível quando dá, e hash quando não dá: um journal é lido por gente."""
    limpa = re.sub(r'[^\w.:-]+', '-', str(chave))[:80]
    if limpa and limpa != '-':
        return '%s:%s' % (app_id, limpa)
    return '%s:%s' % (app_id, hashlib.sha1(str(chave).encode('utf-8')).hexdigest()[:16])


def notificar(corpo, titulo=None, nivel=None, chave=None, acoes=None, persistente=False,
              rota=None, abrir=None, app_id=None, quando=None, env=None):
    """Acrescenta uma notificação ao journal do usuário. Devolve o `id` gravado, ou `None`
    quando não havia onde escrever.

    O coletor manda uma janela do fim do arquivo, e quem impede a mesma notificação de chegar a
    cada tick é o `id`. Sem `chave`, cada chamada é um evento novo com id próprio. Com `chave`,
    o id é derivado dela: chamar duas vezes com a mesma chave avisa uma vez só, que é como se
    pede idempotência ("disco quase cheio", uma vez por dia).

    `nivel` é `info`, `success`, `warning` ou `error`. `acoes` são até três `{id, label}`, e
    `rota` é o caminho do seu backend que recebe o POST quando a pessoa clica numa delas.
    `abrir` é onde o clique na própria notificação leva: um caminho dentro do app
    (`?documento=entrevista-3`, `revisao/12`), colado na URL da janela nova ou entregue à janela
    aberta no evento `abertura`. Sem ele, o clique abre o app onde ele estiver.
    `persistente` pede que o aviso não suma sozinho. `quando` é o instante do evento em ms, e é
    do emissor: um evento que aconteceu com o desktop fechado mostra a hora em que aconteceu.
    """
    env = os.environ if env is None else env
    arquivo = caminho_do_journal(env)
    if not arquivo:
        return None

    app_id = str(app_id or _app.ident(env))[:64]
    if chave not in (None, ''):
        ident = _id_de(app_id, chave)
    else:
        # Tempo e aleatório, e não um contador: contador reinicia com o processo, e aí o id de
        # ontem volta a existir e o coletor o dá como já entregue.
        ident = '%s:%x-%s' % (app_id, int(time.time() * 1000), secrets.token_hex(4))

    entrada = {
        'id': ident,
        'appId': app_id,
        'body': str(corpo if corpo is not None else '')[:500],
        'at': int(quando) if isinstance(quando, (int, float)) else int(time.time() * 1000),
    }
    if titulo:
        entrada['title'] = str(titulo)[:120]
    if nivel in _NIVEIS:
        entrada['level'] = nivel
    if persistente:
        entrada['persistent'] = True
    if acoes:
        entrada['actions'] = [
            {'id': a['id'], 'label': a['label']}
            for a in acoes
            if isinstance(a, dict) and isinstance(a.get('id'), str) and isinstance(a.get('label'), str)
        ][:3]
    if rota:
        entrada['onAction'] = {'path': str(rota)}
    if abrir:
        entrada['rota'] = str(abrir)[:512]

    try:
        with _tranca:
            os.makedirs(os.path.dirname(arquivo), exist_ok=True)
            # Uma linha, uma escrita, em append. O `json.dumps` escapa a quebra de linha do
            # corpo, e é isso que impede uma notificação de várias linhas de virar várias
            # entradas quebradas.
            with open(arquivo, 'a', encoding='utf-8') as fh:
                fh.write(json.dumps(entrada, ensure_ascii=False, separators=(',', ':')) + '\n')
            _rotacionar(arquivo)
        return ident
    except OSError as err:
        print('[vssh.avisos] não foi possível escrever %s: %s' % (arquivo, err))
        return None


def _rotacionar(arquivo):
    try:
        if os.path.getsize(arquivo) <= _MAX_BYTES:
            return
        with open(arquivo, 'r', encoding='utf-8') as fh:
            linhas = [l for l in fh.read().split('\n') if l.strip()]
        tmp = arquivo + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(linhas[-_MANTER_LINHAS:]) + '\n')
        os.replace(tmp, arquivo)
    except OSError as err:
        # A notificação já está no arquivo; falhar em rotacionar não a desfaz.
        print('[vssh.avisos] rotação do journal falhou: %s' % err)


# ── Atividade em curso ────────────────────────────────────────────────────────────────────────

def _chave_valida(chave):
    """`[a-z0-9:_-]`, até 64: o mesmo alfabeto que o coletor aceita, conferido dos dois lados."""
    return isinstance(chave, str) and re.fullmatch(r'[a-z0-9:_-]{1,64}', chave, re.IGNORECASE)


def caminho_da_atividade(chave, env=None):
    env = os.environ if env is None else env
    home = env.get('HOME') or ''
    if not home or not _chave_valida(chave):
        return None
    return os.path.join(home, _DIR, 'live', '%s.json' % chave)


def atividade(chave, item, env=None):
    """Declara, ou atualiza, uma atividade. A mesma chave substitui no lugar: relatar progresso
    não empilha vinte linhas no painel de quem está trabalhando.

    Campos do `item`: `titulo`, `texto`, `level`, `formato` (`simples` ou `progresso`),
    `progresso` (`{feito, total}` ou `{indeterminado: True}`), `acoes` (`[{id, label}]`). Só
    dados. O `at` é escrito aqui a cada chamada; uma atividade que fica minutos sem novidade
    precisa de `manter_atividades_vivas()`, porque o coletor descarta o que passa ~60 s sem
    renovar. É de propósito: um arquivo sobrevive a um `kill -9`, e sem prazo o primeiro
    processo que morresse no meio pregaria "Sincronizando 3 de 12" no painel para sempre.

    Devolve `False`, sem levantar, quando não há onde escrever.
    """
    arquivo = caminho_da_atividade(chave, env)
    if not arquivo:
        return False
    corpo = dict(item or {})
    corpo['at'] = int(time.time() * 1000)
    try:
        _escrever_atomico(arquivo, corpo)
        with _tranca:
            _vivas[chave] = item
        return True
    except OSError as err:
        print('[vssh.avisos] não foi possível escrever %s: %s' % (arquivo, err))
        return False


def limpar_atividade(chave, registrar=None, env=None):
    """Encerra a atividade. Sem `registrar`, ela some e não deixa rastro, que é o certo para uma
    condição que passou: "o disco voltou" não é um fato que alguém releia amanhã. Com
    `registrar` (`{titulo, texto, level}`), o fim vira uma notificação, uma só.

    A notificação vai antes de o arquivo sair. O coletor lê estado (presença de arquivo), então
    não há como pedir "encerre e registre" pelo próprio `live/`. Nesta ordem, o pior caso de uma
    queda no meio é a atividade ficar na tela até o TTL; na inversa, é ela sumir sem nunca ter
    contado como terminou.
    """
    arquivo = caminho_da_atividade(chave, env)
    if not arquivo:
        return False
    with _tranca:
        _vivas.pop(chave, None)
    if registrar:
        try:
            notificar(
                str(registrar.get('texto') or registrar.get('body') or ''),
                titulo=registrar.get('titulo') or registrar.get('title'),
                nivel=registrar.get('level'),
                # Chave estável na da atividade: um retry que termine de novo substitui em vez
                # de empilhar dois "concluído" para a mesma coisa.
                chave='live:%s' % chave,
                env=env,
            )
        except Exception as err:  # registrar o fim não pode impedir o encerrar
            print('[vssh.avisos] não foi possível registrar o fim de %s: %s' % (chave, err))
    try:
        os.unlink(arquivo)
        return True
    except FileNotFoundError:
        return True
    except OSError:
        return False


def manter_atividades_vivas(env=None):
    """Renova o `at` das atividades deste processo enquanto elas existirem. Devolve a função
    que para a renovação.

    Opt-in, e a thread é daemon: uma lib que segura o processo impede o app de encerrar, e isso
    é pior que uma barra que expira.
    """
    parar = threading.Event()

    def laco():
        while not parar.wait(_RENOVA_S):
            with _tranca:
                itens = list(_vivas.items())
            for chave, item in itens:
                atividade(chave, item, env=env)

    threading.Thread(target=laco, name='vssh-atividades', daemon=True).start()
    return parar.set


def _ao_sair(adeus):
    """Liga `adeus` ao fim do processo: `atexit` cobre a saída normal e o Ctrl+C; o `SIGTERM`,
    que é como o lifecycle encerra um app, só é tomado se ninguém o tiver tomado antes.
    Sobrescrever o handler do app seria uma lib decidindo como ele encerra."""
    import atexit
    import signal

    atexit.register(adeus)
    try:
        if signal.getsignal(signal.SIGTERM) in (signal.SIG_DFL, None):
            def ao_terminar(sig, frame):
                adeus()
                raise SystemExit(0)
            signal.signal(signal.SIGTERM, ao_terminar)
    except (ValueError, OSError):
        pass  # fora da thread principal não há handler a instalar; o `atexit` continua valendo


def limpar_atividades_ao_sair(env=None):
    """O TTL cobre o `kill -9`; 60 s de "sincronizando" depois de um encerramento limpo é um
    minuto de mentira que dava para não contar."""
    def adeus(*_):
        for chave in list(_vivas.keys()):
            limpar_atividade(chave, env=env)
    _ao_sair(adeus)


# ── Bandeja ───────────────────────────────────────────────────────────────────────────────────

def caminho_da_bandeja(env=None):
    """O `tray.json` fica um nível acima do diretório de dados, ao lado do `status.json` que o
    supervisor escreve: é o diretório que o coletor varre."""
    env = os.environ if env is None else env
    dados = env.get('VSSH_APP_DATA_DIR')
    if dados:
        return os.path.join(os.path.dirname(os.path.normpath(dados)), 'tray.json')
    app_id = env.get('VSSH_APP_ID')
    if app_id:
        return os.path.join(env.get('HOME') or '', '.vssh-apps', app_id, 'tray.json')
    return None


def bandeja(item, env=None):
    """Publica, ou atualiza, o ícone deste app na bandeja. Um item por app; chamar de novo
    substitui, e o ícone não muda de lugar quando o badge muda a cada segundo.

    Campos: `icon`, `tooltip`, `badge` (`{count}`, `{dot: True}` ou `{text}`), `menu`
    (`[{id, label, icon, danger, disabled}]` ou `{separator: True}`), `onClick` (`{path}`, a
    rota do seu backend que recebe o POST do clique). Só dados: isto atravessa um arquivo.

    Devolve `False`, sem levantar, quando não há onde escrever.
    """
    arquivo = caminho_da_bandeja(env)
    if not arquivo:
        return False
    corpo = dict(item or {})
    corpo['updatedAt'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    try:
        _escrever_atomico(arquivo, corpo)
        return True
    except OSError as err:
        print('[vssh.avisos] não foi possível escrever %s: %s' % (arquivo, err))
        return False


def limpar_bandeja(env=None):
    """Remove o ícone. Chame ao encerrar: ícone órfão mente sobre o estado do ambiente."""
    arquivo = caminho_da_bandeja(env)
    if not arquivo:
        return False
    try:
        os.unlink(arquivo)
        return True
    except FileNotFoundError:
        return True
    except OSError:
        return False


def limpar_bandeja_ao_sair(env=None):
    _ao_sair(lambda *_: limpar_bandeja(env))
