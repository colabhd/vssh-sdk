"""ffprobe e ffmpeg: o argv, e a execução fina em cima dele.

    argv_de_sonda(caminho)                  ffprobe … -print_format json
    argv_de_fluxo(decisao, caminho, …)      ffmpeg … pipe:1, ou None no modo direto
    argv_de_legenda(caminho, indice)        ffmpeg … -f webvtt pipe:1
    argv_de_capa(caminho, indice)           ffmpeg … -f mjpeg pipe:1
    ponto_de_corte(caminho, t)              onde um cano com a imagem copiada, pedido em `t`, começa
    sondar_arquivo(caminho)                 executa o ffprobe e devolve a Sonda
    achar_gpu(concedida)                    (Gpu | None, motivo): a placa concedida que CODIFICA

⚠ **Um ffmpeg mal montado não falha.** Ele roda, escreve bytes, sai com zero, e o `<video>` do
outro lado não toca nada, sem stderr para ler e sem status para conferir. Por isso o argv é
construído aqui, num lugar só, com teste.

⚠ **Sempre lista, nunca string de shell.** O caminho vem do sistema de arquivos de quem usa e pode
conter espaço, aspas e `$(...)`. Como elemento de argv isso é um nome de arquivo; interpolado numa
string de shell, vira execução de comando.
"""

import json
import os
import re
import subprocess
import threading
from dataclasses import dataclass
from typing import Optional

from decisao import sondar


@dataclass(frozen=True)
class Gpu:
    """Uma placa que codifica, e o caminho pelo qual ela codifica.

        via = "vaapi"   Intel e AMD, pelo render node do DRM (`no` = /dev/dri/renderD*)
        via = "nvenc"   NVIDIA, sem `no`: o ffmpeg abre `/dev/nvidiactl` sozinho

    O driver proprietário da NVIDIA não fala VA-API (o `nvidia-vaapi-driver` só decodifica), então
    uma placa NVIDIA montada como `h264_vaapi` morre em "Failed to initialise VAAPI connection".
    Quem diz qual das duas vias uma placa tem é o lançador, no campo `video` de cada dispositivo
    concedido.
    """
    via: str
    no: Optional[str] = None

    def __str__(self):
        return f"{self.via} em {self.no}" if self.no else self.via

# Os três `movflags` que fazem um MP4 existir num CANO, medidos em `test_ffmpeg_real.py`:
#
#   frag_keyframe       torna o cano possível. Um MP4 normal guarda o índice (`moov`) e o ffmpeg
#                       volta ao começo para escrevê-lo; num cano não há como voltar, e sem
#                       movflags nenhum ele recusa: "muxer does not support non seekable output".
#   empty_moov          faz aparecerem caixas `moof`, a forma de fMP4 que o navegador lê de um
#                       fluxo sem índice no fim.
#   default_base_moof   offsets relativos ao fragmento, a forma que o MSE espera ler.
_MOVFLAGS = "+frag_keyframe+empty_moov+default_base_moof"

# O teto de tempo do fragmento. `frag_keyframe` sozinho corta só em keyframe, então o fragmento
# tem o tamanho do GOP, e o player não desenha nada antes de o fragmento fechar. Num encode de
# acervo (GOP de 250 quadros, ~8 s) o vídeo toca um pedaço, para, e toca outro.
#
# Medido sobre um AVI 1280x720 de 20 s com GOP de 250:
#
#     sem frag_duration    1º quadro após 318 KB   ·   maior lacuna 317 KB
#     2 s                             95 KB        ·                97 KB   (+0,16%)
#     1 s                             60 KB        ·                62 KB   (+0,43%)
#     0,5 s                           43 KB        ·                44 KB   (+0,96%)
#
# 1 s é onde a curva vira: metade da espera de 2 s por menos de meio por cento de bytes. Os
# timestamps não mudam em nenhum dos casos, e o preço é só cabeçalho de fragmento.
_FRAG_DURACAO = "1000000"   # microssegundos

# Transcodificar em CPU é o último recurso, e ali o que importa é o vídeo começar: `veryfast`.
# `crf 23` é o padrão visualmente transparente do x264.
_X264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]

# O equivalente no NVENC: `p4` é o meio da escala p1–p7, e `-rc vbr -cq 23 -b:v 0` é a qualidade
# constante. Sem o `-b:v 0` o `-cq` vira só um teto por cima da taxa padrão de 2 Mbps, e um 1080p
# sai borrado sem nenhum erro para ler.
_NVENC = ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23", "-b:v", "0"]


def segundos(t):
    """Um instante para o `-ss`, em milésimos. O cano e o `ponto_de_corte` usam a mesma forma."""
    mil = round(float(t) * 1000)
    return str(mil // 1000) if mil % 1000 == 0 else f"{mil / 1000:.3f}"


def argv_de_corte(caminho, t):
    """O primeiro quadro de vídeo que um cano com `-ss t` e a imagem copiada entrega.

    O mesmo `-ss` do cano, e a saída é uma linha por pacote (`framecrc`) de um quadro só. Com
    `-copyts -start_at_zero` o timestamp é o do arquivo, contado do começo dele.
    """
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", segundos(t), "-i", caminho,
        "-map", "0:v:0", "-c", "copy", "-copyts", "-start_at_zero",
        "-frames:v", "1", "-f", "framecrc", "-",
    ]


_BASE_DE_TEMPO = re.compile(r"^#tb 0: (\d+)/(\d+)", re.M)
_PACOTE = re.compile(r"^0,\s*-?\d+,\s*(-?\d+),", re.M)


def ponto_de_corte(caminho, t, tempo_limite=10):
    """Onde o cano pedido em `t` de fato começa quando a imagem é copiada.

    ⚠ Com `-c:v copy` o ffmpeg não pode começar no meio de um grupo de quadros, e começa num
    quadro-chave antes do pedido; os timestamps do cano contam dali. Se o frontend somasse o `t`
    pedido, o relógio e as legendas ficariam adiantados em relação à imagem pela distância até o
    quadro-chave, que num arquivo de acervo passa de 8 s.

    Qual quadro-chave é decisão do ffmpeg, e depende de regras internas dele: ele soma o
    `start_time` do arquivo ao `-ss` (um AC3 começa em −0,006 s, e a busca em 2 s vira 1,994) e,
    com quadros B, recua a busca em 3/23 s. Em vez de imitar as regras, a resposta vem do próprio
    ffmpeg, com o mesmo `-ss`.

    Falha vira o próprio `t`: a busca continua funcionando, com o desvio do quadro-chave.
    """
    try:
        p = subprocess.run(argv_de_corte(caminho, t), capture_output=True, timeout=tempo_limite,
                           check=True)
        saida = p.stdout.decode("utf-8", "replace")
        num, den = map(int, _BASE_DE_TEMPO.search(saida).groups())
        pts = int(_PACOTE.search(saida).group(1))
        return max(0.0, pts * num / den)
    except (subprocess.SubprocessError, OSError, ValueError, AttributeError, ZeroDivisionError):
        return float(t)


def argv_de_quadros_chave(caminho, t, janela=30):
    """Os quadros-chave de vídeo de `t` até `t + janela`, um instante por linha."""
    return [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0", "-skip_frame", "nokey",
        "-read_intervals", f"{segundos(t)}%+{int(janela)}",
        "-show_entries", "frame=pts_time", "-of", "csv=p=0", caminho,
    ]


def proximo_quadro_chave(caminho, t, tempo_limite=10):
    """O primeiro quadro-chave em `t` ou depois, ou `None` quando não há um nos 30 s seguintes."""
    try:
        p = subprocess.run(argv_de_quadros_chave(caminho, t), capture_output=True,
                           timeout=tempo_limite, check=True)
    except (subprocess.SubprocessError, OSError):
        return None
    for linha in p.stdout.decode("utf-8", "replace").split():
        try:
            k = float(linha.strip(","))
        except ValueError:
            continue
        if k >= t - 0.05:
            return k
    return None


def corte_para_frente(caminho, t):
    """`(pedido, inicio)` de uma busca PARA FRENTE com a imagem copiada.

    O `-ss` cai num quadro-chave antes de `t`, e num grupo longo (8 s é comum) esse ponto pode
    ficar atrás de onde a mídia já está: apertar "avançar 10 s" voltaria no tempo. Quando o corte
    cai mais de meio segundo antes do pedido, a busca vai ao quadro-chave seguinte. A folga de
    0,3 s acima dele cobre o que o ffmpeg desconta da busca (o `start_time`, a heurística dos
    quadros B), e o ponto final vem do próprio ffmpeg, como em toda busca.
    """
    inicio = ponto_de_corte(caminho, t)
    if inicio >= t - 0.5:
        return t, inicio
    seguinte = proximo_quadro_chave(caminho, t)
    if seguinte is None:
        return t, inicio
    pedido = round(seguinte + 0.3, 3)
    novo = ponto_de_corte(caminho, pedido)
    return (pedido, novo) if novo > inicio else (t, inicio)


def argv_de_sonda(caminho):
    """`ffprobe` respondendo JSON, e mais nada."""
    return [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        caminho,
    ]


def argv_de_fluxo(decisao, caminho, inicio=0, gpu=None):
    """A linha do ffmpeg para servir este arquivo, ou `None` quando não há o que fazer.

    ⚠ `None` no modo **direto** é a resposta certa: o arquivo sai do portal como está, e um argv
    ali gastaria CPU remuxando o que o navegador abre sozinho, sem nada mudar na tela.
    """
    if decisao.modo not in ("remux", "audio", "transcode"):
        return None

    argv = ["ffmpeg", "-hide_banner", "-loglevel", "error"]

    # ── A busca ──────────────────────────────────────────────────────────────
    #
    # ⚠ `-ss` **antes** do `-i` é busca de ENTRADA: o ffmpeg salta pelo índice do arquivo e começa
    # a ler dali. Depois do `-i` viraria busca de saída, que decodifica desde o começo e joga fora
    # tudo até o ponto; buscar aos 40 min de um filme levaria minutos de CPU.
    #
    # E `-ss 0` faz o ffmpeg procurar keyframe e pode cortar o primeiro quadro, por isso o zero não
    # vai na linha.
    if inicio and inicio > 0:
        argv += ["-ss", segundos(inicio)]

    if decisao.modo == "transcode" and gpu:
        # A decodificação também vai para a GPU: subir quadro por quadro para a placa só para
        # codificar desperdiça a metade barata do trabalho.
        if gpu.via == "vaapi":
            argv += ["-vaapi_device", gpu.no, "-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi"]
        else:
            # NVDEC, sem `-hwaccel_output_format cuda`: o quadro desce para a memória de sistema e
            # o `format=nv12` abaixo roda em CPU. Custa uma cópia por quadro e cobre o HEVC de 10
            # bits, que decodificado vira p010; o `h264_nvenc` não aceita 10 bits em H.264 na
            # maioria das placas, e o `scale_cuda` que converteria não existe no ffmpeg do apt.
            argv += ["-hwaccel", "cuda"]

    argv += ["-i", caminho]

    # ── O que sai ────────────────────────────────────────────────────────────
    #
    # ⚠ Sem `-map`, o ffmpeg escolhe a faixa "melhor", que costuma ser a de seis canais que o
    # navegador não decodifica, e a escolha do `decisao.py` se perderia na última linha.
    argv += ["-map", "0:v:0"]
    if decisao.faixa_audio is not None and decisao.audio != "nenhum":
        argv += ["-map", f"0:{decisao.faixa_audio}"]

    if decisao.video == "copiar":
        argv += ["-c:v", "copy"]
    elif gpu and gpu.via == "vaapi":
        argv += ["-vf", "scale_vaapi=format=nv12", "-c:v", "h264_vaapi"]
    elif gpu:
        argv += ["-vf", "format=nv12", *_NVENC]
    else:
        argv += _X264

    if decisao.audio == "copiar":
        argv += ["-c:a", "copy"]
        # ⚠ **Copiar AAC pede um filtro.** Num AVI ou num MPEG-TS o AAC vem em enquadramento ADTS,
        # cada quadro com o próprio cabeçalho, e o muxer de MP4 quer ASC, com a configuração numa
        # caixa e os quadros crus. Sem o filtro ele recusa com "Malformed AAC bitstream detected",
        # depois de já ter escrito o cabeçalho e alguns quadros (o bastante para o navegador
        # desenhar um). As versões novas do ffmpeg inserem o filtro sozinhas em alguns containers,
        # então a mesma linha funciona numa máquina e falha noutra.
        #
        # Medido: sobre um AAC que já estava em ASC (de MKV, de MP4) a saída é byte a byte a
        # mesma. Sobre áudio que não é AAC ele mata o ffmpeg com EINVAL e zero byte, e por isso a
        # condição olha o codec, e não o container.
        if decisao.codec_audio == "aac":
            argv += ["-bsf:a", "aac_adtstoasc"]
    elif decisao.audio == "recodificar":
        # `-ac 2` usa o rebaixamento do ffmpeg, que preserva o canal central de um 5.1, onde mora a
        # fala. Uma soma ingênua de seis canais para dois a enterra.
        argv += ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]

    # ⚠ Nada de `-copyts`: os timestamps saem começando em zero, e é o frontend que soma o
    # deslocamento (`opcoes.tempo` da TuffMidia). Com `-copyts` a linha do tempo andaria dobrado.
    argv += ["-frag_duration", _FRAG_DURACAO, "-movflags", _MOVFLAGS, "-f", "mp4", "pipe:1"]
    return argv


def argv_de_legenda(caminho, indice):
    """Uma faixa de legenda embutida, convertida para o único formato que o `<track>` lê."""
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", caminho,
        "-map", f"0:{indice}",
        "-f", "webvtt", "pipe:1",
    ]


def argv_de_capa(caminho, indice):
    """A capa embutida de uma música (o stream `attached_pic`), como um JPEG de até 600 px.

    Recodificar em vez de copiar deixa um só tipo de resposta, qualquer que seja o formato
    guardado (JPEG, PNG, BMP), e o teto de largura evita mandar à tela a digitalização de 3000 px
    que alguns álbuns carregam. O `\\,` escapa a vírgula dentro da expressão do `scale`, que de
    outro modo separaria filtros.
    """
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", caminho,
        "-map", f"0:{indice}",
        "-frames:v", "1",
        "-vf", "scale=w=min(iw\\,600):h=-2",
        "-f", "mjpeg", "pipe:1",
    ]


# ── A execução, que é fina de propósito ──────────────────────────────────────


# A sonda de cada arquivo, guardada. ⚠ **A chave inclui `mtime` e tamanho**, e não só o caminho:
# um arquivo que ainda está sendo copiado ou baixado muda de duração enquanto se olha para ele, e
# uma memória por caminho serviria a duração antiga para sempre, com a linha do tempo mentindo e a
# busca caindo no lugar errado.
#
# Ela existe porque cada abertura sonda o arquivo em `/api/abrir` e de novo em `/api/fluxo`, e
# cada busca no modo cano repete a sonda: um processo novo a cada vez, ~37 ms numa máquina rápida.
_MEMORIA = {}
_MEMORIA_TETO = 64
_TRAVA = threading.Lock()


def sondar_arquivo(caminho, tempo_limite=20):
    """Roda o `ffprobe` e devolve a `Sonda`. Falha vira sonda vazia, nunca exceção.

    O modo `desconhecido` que sai daí é uma resposta que a interface sabe mostrar; uma exceção
    subindo pelo handler viraria 500 numa tela que não explica nada.
    """
    try:
        st = os.stat(caminho)
        chave = (caminho, st.st_mtime_ns, st.st_size)
    except OSError:
        chave = None

    if chave is not None:
        with _TRAVA:
            guardada = _MEMORIA.get(chave)
        if guardada is not None:
            return guardada

    try:
        saida = subprocess.run(argv_de_sonda(caminho), capture_output=True, timeout=tempo_limite,
                               check=True)
        sonda = sondar(json.loads(saida.stdout.decode("utf-8", "replace")), os.path.basename(caminho))
    except (subprocess.SubprocessError, OSError, ValueError):
        # ⚠ A falha NÃO é guardada. Um `ffprobe` que estourou o prazo porque o disco estava ocupado
        # deixaria o arquivo marcado como "desconhecido" até o processo reiniciar.
        return sondar({}, os.path.basename(caminho))

    if chave is not None:
        with _TRAVA:
            if len(_MEMORIA) >= _MEMORIA_TETO:
                # Teto simples e sem política: quem usa isto abre dezenas de arquivos por sessão,
                # não milhares.
                _MEMORIA.clear()
            _MEMORIA[chave] = sonda
    return sonda


def argv_de_teste(gpu):
    """Codificar meio segundo de nada. É o menor trabalho que prova a placa."""
    fonte = ["-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=0.5"]
    if gpu.via == "vaapi":
        return [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-vaapi_device", gpu.no, *fonte,
            # `format=nv12,hwupload` é obrigatório: sem subir o quadro para a placa, o `h264_vaapi`
            # recusa a entrada e o teste diria "não codifica" de uma placa que codifica.
            "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi",
            "-f", "null", "-",
        ]
    # NVENC sobe o quadro sozinho: nada de `hwupload`, nada de dispositivo.
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", *fonte,
            "-vf", "format=nv12", "-c:v", "h264_nvenc", "-f", "null", "-"]


def achar_gpu(concedida, tempo_limite=20):
    """A placa concedida que CODIFICA, ou `(None, motivo)` quando não há nenhuma.

    `concedida` é a resposta de `vssh.gpu.concedida()`: o lançador decide ao subir o app, com o que
    o servidor tem e o que o manifesto pede em `recursos.gpu`, e só o que ele concede este processo
    abre. Conceder não prova que a placa codifica vídeo: uma GPU virtual (virtio) existe para
    desenhar tela, e todo transcode nela morre com "Failed to initialise VAAPI connection". Por
    isso cada candidata passa por meio segundo de codificação de verdade, uma vez, no boot.
    """
    if not concedida or not concedida.get("concedida"):
        motivo = (concedida or {}).get("motivo") or "o lançador não concedeu GPU"
        return None, motivo
    return escolher_gpu(candidatos(concedida), _codifica_mesmo(tempo_limite))


def candidatos(concedida):
    """Os dispositivos concedidos que têm um caminho de codificação, na ordem do lançador."""
    lista = []
    for d in (concedida or {}).get("dispositivos") or []:
        if not isinstance(d, dict):
            continue
        via = d.get("video")
        if via == "nvenc":
            lista.append(Gpu("nvenc"))
        elif via == "vaapi" and d.get("renderNode"):
            lista.append(Gpu("vaapi", d["renderNode"]))
    return lista


def _codifica_mesmo(tempo_limite):
    """A prova de fogo de uma candidata: `(ok, motivo)`."""
    def testar(gpu):
        try:
            p = subprocess.run(argv_de_teste(gpu), capture_output=True, timeout=tempo_limite)
        except (OSError, subprocess.SubprocessError) as e:
            return False, str(e)
        if p.returncode == 0:
            return True, f"codifica por {gpu.via}"
        return False, p.stderr.decode("utf-8", "replace").strip()[-300:]
    return testar


def escolher_gpu(candidatas, testar):
    """A primeira candidata que passa no teste, ou `(None, motivo)`.

    Separada de `achar_gpu` porque a regra, "só vale se codificar", é o que precisa de teste, e ela
    não pode depender de a máquina que roda a suíte ter uma placa.
    """
    if not candidatas:
        return None, "nenhum dispositivo concedido tem caminho de codificação (nvenc ou vaapi)"

    ultimo = None
    for gpu in candidatas:
        ok, motivo = testar(gpu)
        if ok:
            return gpu, f"{gpu}: {motivo}"
        ultimo = f"{gpu}: {motivo}"

    # Falhar aqui é a resposta comum, e o transcode cai na CPU, que é o último degrau e sempre
    # existe.
    return None, ultimo or "nenhuma candidata respondeu"
