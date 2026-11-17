"""
O executor de um trabalho da estação: o processo destacado que `vssh.trabalhos.rodar` sobe, e
que sobe o comando do app como filho.

    python3 <este arquivo> <diretório do trabalho>

Ele existe porque só o pai de um processo recebe o código de saída dele. Com o comando como filho
do backend, um reinício do app deixava o comando órfão, com a saída num pipe fechado e o código
perdido. Com o executor no meio, o comando segue, e o que ele diz fica em arquivos que o backend
lê de onde parou.

─── O diretório do trabalho ──────────────────────────────────────────────────────────────────

    pedido.json   de quem dispara: `chave`, `titulo`, `comando`, `cwd`
    pid           de quem dispara: o pid do executor e o instante em que ele nasceu
    grupo         o grupo de processos do comando e o instante em que ele nasceu: é o que o
                  governador da estação leva a `nice` 19 e o que um cancelamento encerra
    saida         o stdout do comando, como ele o escreveu
    erros         o stderr do comando
    cancel        de quem cancela: se existir, o executor encerra o comando
    fim.json      `estado` (concluido, falhou, cancelado), `codigo`, `motivo`, `terminadoEm`
    exit          o código de saída, escrito por último: é o sinal de que acabou

O ambiente do comando chega pelo stdin, em JSON, e não pelo `pedido.json`: ele pode levar uma
credencial, e o arquivo fica no disco até a faxina.

─── O que o executor faz enquanto o comando roda ─────────────────────────────────────────────

As linhas de progresso (`vssh.progresso`) viram a atividade do trabalho na bandeja, que ele
renova, com o backend do app de pé ou não. Cancelar manda SIGTERM ao grupo do comando, e SIGKILL
cinco segundos depois a quem ainda estiver de pé: um comando que quer limpar o que fez pela metade
trata o SIGTERM. O executor não escreve a notificação do fim nem tira a atividade: isso é do
backend, que conhece o texto, e sem ele a atividade expira sozinha.
"""

import collections
import json
import os
import signal
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vssh import avisos, progresso   # noqa: E402  (o caminho acima vem antes)
from vssh.trabalhos import _nascimento   # noqa: E402

ESPERA_DO_SIGKILL_S = 5.0
# A bandeja não precisa de mais que duas atualizações por segundo, e um comando que informa cada
# milésimo escreveria o arquivo da atividade mil vezes.
INTERVALO_DA_ATIVIDADE_S = 0.5
VOLTA_S = 0.2


def item_da_atividade(titulo, p):
    p = p or {}
    return {
        'titulo': titulo,
        'texto': p.get('etapa') or 'Rodando',
        'formato': 'progresso',
        'progresso': {'feito': p['feito'], 'total': p['total']} if p.get('total') else {'indeterminado': True},
    }


def _escrever(caminho, texto):
    tmp = caminho + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(texto)
    os.replace(tmp, caminho)   # quem lê nunca vê o arquivo pela metade


def _sinalizar(grupo, sinal):
    try:
        if hasattr(os, 'killpg'):
            os.killpg(grupo, sinal)
        else:
            os.kill(grupo, sinal)
    except (OSError, ValueError):
        pass


def executar(d):
    with open(os.path.join(d, 'pedido.json'), encoding='utf-8') as f:
        pedido = json.load(f)
    try:
        ambiente = (json.load(sys.stdin) or {}).get('ambiente')
    except ValueError:
        ambiente = None
    chave, titulo = pedido['chave'], pedido.get('titulo') or pedido['chave']

    def terminar(estado, codigo, motivo):
        _escrever(os.path.join(d, 'fim.json'), json.dumps(
            {'estado': estado, 'codigo': codigo, 'motivo': motivo, 'terminadoEm': int(time.time() * 1000)},
            ensure_ascii=False, separators=(',', ':')))
        _escrever(os.path.join(d, 'exit'), str(codigo if isinstance(codigo, int) else 1))

    comando = [str(x) for x in pedido['comando']]
    try:
        filho = subprocess.Popen(comando, cwd=pedido.get('cwd') or None, env=ambiente, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    except OSError as e:
        terminar('falhou', None, 'não consegui rodar %s: %s' % (comando[0] if comando else '', e.strerror or e))
        return
    nasceu = _nascimento(filho.pid)
    _escrever(os.path.join(d, 'grupo'), '%d %s' % (filho.pid, nasceu) if nasceu else str(filho.pid))

    parar_renovacao = avisos.manter_atividades_vivas()
    avisos.atividade(chave, item_da_atividade(titulo, None))
    ultimos_erros = collections.deque(maxlen=20)

    def copiar_saida():
        ultima = 0.0
        with open(os.path.join(d, 'saida'), 'ab') as arquivo:
            for linha in filho.stdout:
                arquivo.write(linha)
                arquivo.flush()
                p = progresso.ler(linha)
                if p is None:
                    continue
                agora = time.monotonic()
                if agora - ultima >= INTERVALO_DA_ATIVIDADE_S:
                    ultima = agora
                    avisos.atividade(chave, item_da_atividade(titulo, p))

    def copiar_erros():
        with open(os.path.join(d, 'erros'), 'ab') as arquivo:
            for linha in filho.stderr:
                arquivo.write(linha)
                arquivo.flush()
                texto = linha.decode('utf-8', 'replace').rstrip('\r\n')
                if texto.strip():
                    ultimos_erros.append(texto)

    leitores = [threading.Thread(target=copiar_saida, daemon=True), threading.Thread(target=copiar_erros, daemon=True)]
    for leitor in leitores:
        leitor.start()

    # Um SIGTERM ao executor (a estação desligando, alguém encerrando a árvore) encerra o comando
    # do mesmo jeito que um cancelamento, e o fim diz que foi interrompido.
    interrompido = threading.Event()
    for sinal in (signal.SIGTERM, signal.SIGINT) + ((signal.SIGHUP,) if hasattr(signal, 'SIGHUP') else ()):
        try:
            signal.signal(sinal, lambda *_: interrompido.set())
        except (ValueError, OSError):
            pass

    cancelado = False
    pedido_de_fim = None   # o instante do SIGTERM ao grupo
    matou = False
    while filho.poll() is None:
        if pedido_de_fim is None:
            cancelado = os.path.exists(os.path.join(d, 'cancel'))
            if cancelado or interrompido.is_set():
                pedido_de_fim = time.monotonic()
                _sinalizar(filho.pid, signal.SIGTERM)
        elif not matou and time.monotonic() - pedido_de_fim >= ESPERA_DO_SIGKILL_S:
            matou = True
            _sinalizar(filho.pid, getattr(signal, 'SIGKILL', signal.SIGTERM))
        try:
            filho.wait(VOLTA_S)
        except subprocess.TimeoutExpired:
            pass
    codigo = filho.returncode
    # Um neto que herdou o pipe o segura aberto depois de o comando sair. Num cancelamento ele é
    # do grupo e já recebeu o sinal; fora dele, a leitura espera um pouco e segue.
    if pedido_de_fim is not None:
        _sinalizar(filho.pid, getattr(signal, 'SIGKILL', signal.SIGTERM))
    for leitor in leitores:
        leitor.join(5.0)
    parar_renovacao()

    if cancelado or os.path.exists(os.path.join(d, 'cancel')):
        terminar('cancelado', codigo, None)
    elif interrompido.is_set():
        terminar('falhou', codigo, 'o trabalho foi interrompido')
    elif codigo == 0:
        terminar('concluido', 0, None)
    else:
        terminar('falhou', codigo, ultimos_erros[-1] if ultimos_erros else 'saiu com o código %d' % codigo)


if __name__ == '__main__':
    try:
        executar(sys.argv[1])
    except Exception as erro:   # sem o fim escrito, o acompanhamento só veria o executor morto
        try:
            _escrever(os.path.join(sys.argv[1], 'fim.json'), json.dumps(
                {'estado': 'falhou', 'codigo': None, 'motivo': 'o executor falhou: %s' % erro,
                 'terminadoEm': int(time.time() * 1000)}, ensure_ascii=False, separators=(',', ':')))
            _escrever(os.path.join(sys.argv[1], 'exit'), '1')
        except OSError:
            pass
        sys.exit(1)
