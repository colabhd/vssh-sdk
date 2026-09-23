"""Girar uma foto e gravar no arquivo, sem perda.

É a única edição da Lupa, e ela nunca perde informação: girar de volta devolve a imagem de antes,
e por isso a gravação não passa pela lixeira.

Num JPEG, o `jpegtran -perfect` gira os blocos DCT: os coeficientes são os mesmos, em outra
posição, e quatro voltas devolvem os mesmos pixels. A orientação que o EXIF já trazia entra
na mesma conta, e a etiqueta volta para 1. A foto fica em pé para qualquer programa, inclusive
para o Pillow, que ignora a etiqueta: `Image.open` devolve os pixels como estão gravados, e com
ele o `plt.imread` e boa parte dos carregadores de dataset. Uma foto endireitada só pela etiqueta
entraria deitada num notebook.

O `-perfect` recusa quando um bloco parcial da borda iria parar à esquerda ou em cima, onde o
formato não admite bloco parcial. Uma altura que não é múltipla de 16 (4000 × 3000 em 4:2:0) recusa
90 e 180 graus. Nesse caso, e num servidor sem o `jpegtran`, a rotação vai pela etiqueta, e os
dados da imagem ficam intactos:

  - a etiqueta existe: os dois bytes dela mudam no próprio arquivo, e nada mais;
  - não há EXIF: entra um segmento EXIF novo só com a etiqueta, logo depois do SOI (ou do APP0 de
    um JFIF, que tem de ser o primeiro);
  - há EXIF sem a etiqueta: o Pillow reescreve o bloco com a etiqueta a mais. Uma MakerNote impede
    este caso, porque os dados dela apontam para posições absolutas do arquivo e sairiam
    corrompidos ao mudar de lugar.

Um `tiff:Orientation` no XMP acompanha o EXIF, no lugar: é um dígito, e o tamanho não muda. Um
programa que lesse o XMP antes do EXIF mostraria a foto na orientação de antes.

Um PNG é regravado girado, com os mesmos pixels: o Pillow codifica a imagem, e os blocos de cor
(`iCCP`, `sRGB`, `gAMA`, `cHRM`, `cICP`), de texto, de data, de resolução e o `eXIf` vêm do arquivo
de antes. Um PNG de 16 bits por canal em cor fica de fora, porque o Pillow o lê em 8 bits. Os
outros formatos giram só na tela.
"""

import io
import os
import re
import shutil
import stat
import struct
import subprocess
import tempfile
import zlib

#: A orientação EXIF depois de girar a imagem mostrada 90 graus no sentido horário. As oito
#: orientações são o grupo diedral do retângulo: quatro rotações e quatro espelhos.
MAIS_90 = {1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2}
#: A operação do `jpegtran` que leva os pixels gravados até a imagem de cada orientação.
OPERACAO = {2: ("-flip", "horizontal"), 3: ("-rotate", "180"), 4: ("-flip", "vertical"),
            5: ("-transpose",), 6: ("-rotate", "90"), 7: ("-transverse",), 8: ("-rotate", "270")}
#: As orientações de um quarto de volta: nelas largura e altura trocam de lugar.
DEITADAS = (5, 6, 7, 8)

JPEG = {".jpg", ".jpeg"}
PNG = {".png"}
JPEGTRAN = "jpegtran"


class NaoSabe(Exception):
    """Este arquivo não gira sem perda, e a Lupa o gira só na tela."""


def compor(orientacao, graus):
    o = orientacao if orientacao in MAIS_90 else 1
    for _ in range((graus // 90) % 4):
        o = MAIS_90[o]
    return o


def _gravar(caminho, dados):
    """Troca o conteúdo do arquivo, sem que quem o lê veja meio arquivo.

    A troca é por renomeação, que é atômica. Um arquivo com mais de um nome (hard link) ou de outro
    dono é reescrito no lugar, como o vim faz: renomear separaria os nomes ou passaria o arquivo
    para o dono do processo.
    """
    st = os.stat(caminho)
    uid = getattr(os, "getuid", lambda: st.st_uid)()
    if st.st_nlink > 1 or st.st_uid != uid:
        with open(caminho, "r+b") as fh:
            fh.write(dados)
            fh.truncate()
        return
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(caminho), prefix=".lupa-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(dados)
        os.chmod(tmp, stat.S_IMODE(st.st_mode))
        os.replace(tmp, caminho)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _no_lugar(caminho, trocas):
    """Escreve `{posicao: bytes}` sobre o arquivo, sem mudar o tamanho dele."""
    with open(caminho, "r+b") as fh:
        for onde, dados in sorted(trocas.items()):
            fh.seek(onde)
            fh.write(dados)


# ── EXIF ─────────────────────────────────────────────────────────────────────

class _Tiff:
    """O bloco TIFF de um EXIF, de `tiff` a `fim` dentro de `b`, lido e alterado no lugar.

    Os deslocamentos do TIFF contam a partir do cabeçalho dele, então nada do que muda aqui mexe
    em outra posição do bloco.
    """

    def __init__(self, b, tiff, fim):
        self.b, self.tiff, self.fim = b, tiff, fim
        ordem = bytes(b[tiff:tiff + 2])
        if ordem not in (b"II", b"MM"):
            raise NaoSabe("EXIF torto")
        self.e = "<" if ordem == b"II" else ">"
        self.ifd0, self.proxima0 = self.ifd(self.ler("I", tiff + 4))

    def ler(self, fmt, pos):
        return struct.unpack(self.e + fmt, self.b[pos:pos + struct.calcsize(fmt)])[0]

    def ifd(self, deslocamento):
        """`({tag: (posicao, tipo, quantidade)}, posicao do ponteiro para a IFD seguinte)`."""
        pos = self.tiff + deslocamento
        n = self.ler("H", pos)
        if pos + 2 + 12 * n + 4 > self.fim:
            raise NaoSabe("EXIF torto")
        entradas = {}
        for i in range(n):
            p = pos + 2 + 12 * i
            tag, tipo, qtd = struct.unpack(self.e + "HHI", self.b[p:p + 8])
            entradas[tag] = (p, tipo, qtd)
        return entradas, pos + 2 + 12 * n

    def valor(self, entrada):
        """O número de uma entrada SHORT ou LONG de um valor só, ou `None`."""
        if not entrada or entrada[2] != 1 or entrada[1] not in (3, 4):
            return None
        return self.ler("H" if entrada[1] == 3 else "I", entrada[0] + 8)

    def escrever(self, entrada, valor):
        fmt = "H" if entrada[1] == 3 else "I"
        self.b[entrada[0] + 8:entrada[0] + 8 + struct.calcsize(fmt)] = struct.pack(self.e + fmt, valor)

    def orientacao(self):
        entrada = self.ifd0.get(0x0112)
        return entrada if self.valor(entrada) in MAIS_90 else None


# ── JPEG ─────────────────────────────────────────────────────────────────────

XMP = b"http://ns.adobe.com/xap/1.0/\x00"
_XMP_ORIENTACAO = re.compile(rb"tiff:Orientation\s*=\s*[\"']([1-8])[\"']"
                             rb"|<tiff:Orientation>\s*([1-8])\s*</tiff:Orientation>")


def _segmentos(b):
    """`(marcador, inicio, tamanho)` de cada segmento até o SOS; os dados da imagem vêm depois."""
    if b[:2] != b"\xff\xd8":
        raise NaoSabe("o arquivo não é JPEG")
    p = 2
    while p + 4 <= len(b):
        if b[p] != 0xFF:
            raise NaoSabe("JPEG torto")
        marcador = b[p + 1]
        if marcador == 0xFF:
            p += 1
            continue
        tamanho = struct.unpack(">H", b[p + 2:p + 4])[0]
        yield marcador, p, 2 + tamanho
        if marcador == 0xDA:
            return
        p += 2 + tamanho


def _exif(b, segmentos):
    """`(inicio, tamanho, _Tiff)` do primeiro APP1 EXIF, ou `None`."""
    for m, p, t in segmentos:
        if m == 0xE1 and b[p + 4:p + 10] == b"Exif\x00\x00":
            return p, t, _Tiff(b, p + 10, p + t)
    return None


def _xmp(b, segmentos, orientacao):
    """As trocas que põem `orientacao` em todo `tiff:Orientation` do XMP."""
    trocas = {}
    for m, p, t in segmentos:
        if m == 0xE1 and b[p + 4:p + 4 + len(XMP)] == XMP:
            for achado in _XMP_ORIENTACAO.finditer(b, p, p + t):
                trocas[achado.start(1 if achado.group(1) else 2)] = str(orientacao).encode()
    return trocas


def _app1_minimo(orientacao):
    """Um APP1 EXIF com a IFD0 levando só a orientação."""
    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + struct.pack(">H", 1)
    tiff += struct.pack(">HHIHH", 0x0112, 3, 1, orientacao, 0) + struct.pack(">I", 0)
    corpo = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(corpo) + 2) + corpo


def _jpegtran(dados, orientacao, progressivo=False):
    """`dados` com os blocos levados à `orientacao`, ou `None` se o `jpegtran` não faz sem perda.

    Um JPEG progressivo sai progressivo, e um sequencial sai com as tabelas de Huffman otimizadas:
    sem uma das duas opções, o `jpegtran` grava sequencial com as tabelas padrão.
    """
    exe = shutil.which(JPEGTRAN)
    if not exe:
        return None
    comando = [exe, "-copy", "all", "-perfect", "-progressive" if progressivo else "-optimize",
               *OPERACAO[orientacao]]
    try:
        r = subprocess.run(comando, input=dados, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    # A saída 2 é aviso (dado truncado, marcador torto), e um arquivo assim fica como está.
    return r.stdout if r.returncode == 0 and r.stdout[:2] == b"\xff\xd8" else None


def _endireitar_exif(saida, orientacao):
    """O EXIF de um JPEG que o `jpegtran` acabou de girar até `orientacao`.

    A etiqueta e o XMP voltam a 1, as dimensões do EXIF trocam de eixo num quarto de volta, e a
    miniatura do EXIF gira junto, sem perda também. Ela só gira quando é a última coisa do
    segmento, o caso comum, porque crescer ou encolher no fim não desloca nada. Em outra posição,
    ou com bordas que não giram sem perda, ela sai do arquivo, e quem precisa de uma prévia a gera.
    """
    b = bytearray(saida)
    segmentos = list(_segmentos(b))
    for onde, dados in _xmp(b, segmentos, 1).items():
        b[onde:onde + len(dados)] = dados
    achado = _exif(b, segmentos)
    if not achado:
        return bytes(b)
    inicio, tamanho, tiff = achado
    entrada = tiff.orientacao()
    if entrada:
        tiff.escrever(entrada, 1)
    exif_ifd = tiff.valor(tiff.ifd0.get(0x8769))
    if orientacao in DEITADAS and exif_ifd:
        entradas, _ = tiff.ifd(exif_ifd)
        largura, altura = entradas.get(0xA002), entradas.get(0xA003)
        lv, av = tiff.valor(largura), tiff.valor(altura)
        if lv is not None and av is not None:
            tiff.escrever(largura, av)
            tiff.escrever(altura, lv)

    proxima = tiff.ler("I", tiff.proxima0)
    if not proxima:
        return bytes(b)
    try:
        ifd1, _ = tiff.ifd(proxima)
        desloc, n = tiff.valor(ifd1.get(0x0201)), tiff.valor(ifd1.get(0x0202))
    except (NaoSabe, struct.error):
        desloc = n = None
    fim = inicio + tamanho
    if desloc is not None and n and tiff.tiff + desloc + n == fim:
        ini = tiff.tiff + desloc
        mini = _jpegtran(bytes(b[ini:fim]), orientacao)
        if mini and tamanho - n + len(mini) - 2 <= 0xFFFF:
            tiff.escrever(ifd1[0x0202], len(mini))
            b[inicio + 2:inicio + 4] = struct.pack(">H", tamanho - n + len(mini) - 2)
            return bytes(b[:ini]) + mini + bytes(b[fim:])
    b[tiff.proxima0:tiff.proxima0 + 4] = b"\x00\x00\x00\x00"
    return bytes(b)


def girar_jpeg(caminho, graus):
    with open(caminho, "rb") as fh:
        b = bytearray(fh.read())
    try:
        segmentos = list(_segmentos(b))
        achado = _exif(b, segmentos)
        entrada = achado[2].orientacao() if achado else None
        nova = compor(achado[2].valor(entrada) if entrada else 1, graus)
    except (struct.error, IndexError) as err:
        raise NaoSabe("JPEG torto") from err

    if nova != 1:
        progressivo = any(m == 0xC2 for m, _, _ in segmentos)
        saida = _jpegtran(bytes(b), nova, progressivo=progressivo)
        if saida is not None:
            try:
                _gravar(caminho, _endireitar_exif(saida, nova))
                return {"orientacao": 1, "jpegtran": True}
            except (NaoSabe, struct.error, IndexError):
                # Os pixels girados com a etiqueta antiga ficariam girados duas vezes na tela.
                pass

    trocas = _xmp(b, segmentos, nova)
    if entrada:
        trocas[entrada[0] + 8] = struct.pack(achado[2].e + "H", nova)
        _no_lugar(caminho, trocas)
        return {"orientacao": nova, "jpegtran": False}

    for onde, dados in trocas.items():
        b[onde:onde + len(dados)] = dados
    if achado is None:
        # O APP0 de um JFIF tem de ser o primeiro segmento; o EXIF entra logo depois dele.
        depois = segmentos[0][1] + segmentos[0][2] if segmentos and segmentos[0][0] == 0xE0 else 2
        _gravar(caminho, bytes(b[:depois]) + _app1_minimo(nova) + bytes(b[depois:]))
        return {"orientacao": nova, "jpegtran": False}

    try:
        from PIL import Image
    except ImportError as err:
        raise NaoSabe("sem o Pillow para acrescentar a orientação") from err
    inicio, tamanho, _ = achado
    ex = Image.Exif()
    ex.load(bytes(b[inicio + 4:inicio + tamanho]))
    if ex.get_ifd(0x8769).get(0x927C) is not None:
        raise NaoSabe("o EXIF tem MakerNote, e reescrevê-lo a corromperia")
    ex[0x0112] = nova
    corpo = ex.tobytes()
    if len(corpo) + 2 > 0xFFFF:
        raise NaoSabe("o EXIF não cabe num segmento")
    segmento = b"\xff\xe1" + struct.pack(">H", len(corpo) + 2) + corpo
    _gravar(caminho, bytes(b[:inicio]) + segmento + bytes(b[inicio + tamanho:]))
    return {"orientacao": nova, "jpegtran": False}


# ── PNG ──────────────────────────────────────────────────────────────────────

ASSINATURA = b"\x89PNG\r\n\x1a\n"
#: Os blocos do arquivo de antes que continuam valendo para a imagem girada. A cor vem antes do
#: PLTE e do IDAT, pela regra do formato; o resto fica entre o PLTE e o IDAT.
DA_COR = (b"iCCP", b"sRGB", b"gAMA", b"cHRM", b"cICP")
DO_ARQUIVO = (b"pHYs", b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME")


def _blocos(b):
    if b[:8] != ASSINATURA:
        raise NaoSabe("o arquivo não é PNG")
    p = 8
    while p + 8 <= len(b):
        tamanho, tipo = struct.unpack(">I4s", b[p:p + 8])
        yield tipo, b[p + 8:p + 8 + tamanho]
        p += 12 + tamanho


def _bloco(tipo, dados):
    return struct.pack(">I", len(dados)) + tipo + dados + struct.pack(">I", zlib.crc32(tipo + dados))


def girar_png(caminho, graus):
    try:
        from PIL import Image, ImageOps
    except ImportError as err:
        raise NaoSabe("sem o Pillow") from err
    with open(caminho, "rb") as fh:
        original = fh.read()
    blocos = list(_blocos(original))
    ihdr = dict(blocos).get(b"IHDR", b"")
    if len(ihdr) < 10:
        raise NaoSabe("PNG torto")
    profundidade, cor = ihdr[8], ihdr[9]
    if profundidade == 16 and cor != 0:
        raise NaoSabe("o Pillow lê um PNG de 16 bits por canal em 8")
    if any(t == b"acTL" for t, _ in blocos):
        raise NaoSabe("um PNG animado perderia os quadros")

    voltas = (graus // 90) % 4
    with Image.open(io.BytesIO(original)) as im:
        im.load()
        transparencia = im.info.get("transparency")
        # Um `eXIf` com orientação já girava a imagem na tela: ela entra nos pixels antes da volta,
        # e o `eXIf` que vai junto sai com a orientação 1.
        deitada = im.getexif().get(0x0112, 1) in DEITADAS
        em_pe = ImageOps.exif_transpose(im)
        # `Image.Transpose` é do Pillow 9.1 em diante; o 9.0 do Ubuntu 22.04 tem as constantes soltas.
        T = getattr(Image, "Transpose", Image)
        girada = em_pe.transpose({1: T.ROTATE_270, 2: T.ROTATE_180, 3: T.ROTATE_90}[voltas])
    # A resolução do `pHYs` é por eixo do arquivo de antes, e troca de eixo com um quarto de volta.
    deitou = (voltas % 2 == 1) != deitada
    girada.info = {}
    saida = io.BytesIO()
    girada.save(saida, "PNG", **({"transparency": transparencia} if transparencia is not None else {}))
    do_pillow = list(_blocos(saida.getvalue()))

    def de_antes(tipos):
        for tipo, dados in blocos:
            if tipo not in tipos:
                continue
            if tipo == b"pHYs" and deitou and len(dados) == 9:
                dados = dados[4:8] + dados[0:4] + dados[8:]
            if tipo == b"eXIf":
                dados = bytearray(dados)
                try:
                    tiff = _Tiff(dados, 0, len(dados))
                    entrada = tiff.orientacao()
                except (struct.error, NaoSabe):
                    continue
                if entrada:
                    tiff.escrever(entrada, 1)
                dados = bytes(dados)
            yield _bloco(tipo, dados)

    # Do Pillow vêm só a imagem e o que depende da codificação dela (a paleta e a transparência).
    novo = [ASSINATURA]
    antes_do_idat = True
    for tipo, dados in do_pillow:
        if tipo == b"IDAT" and antes_do_idat:
            novo.extend(de_antes(DO_ARQUIVO))
            antes_do_idat = False
        if tipo in (b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"):
            novo.append(_bloco(tipo, dados))
        if tipo == b"IHDR":
            novo.extend(de_antes(DA_COR))
    _gravar(caminho, b"".join(novo))
    return {}


def girar(caminho, graus):
    """Gira `caminho` em `graus` (90, 180 ou 270, no sentido horário) e grava.

    Num JPEG, devolve `{orientacao, jpegtran}`: a etiqueta que ficou no arquivo, e se os blocos
    giraram. Num PNG, `{}`. Lança `NaoSabe` para o que não gira sem perda, e `PermissionError`
    para um arquivo que a pessoa não pode gravar.
    """
    if graus not in (90, 180, 270):
        raise ValueError("graus: 90, 180 ou 270")
    # Um link simbólico é seguido: a foto girada é a de destino, e o link continua link.
    caminho = os.path.realpath(caminho)
    # A troca por renomeação passaria por cima de um arquivo só de leitura, porque renomear pede
    # permissão na pasta e não no arquivo. Um arquivo protegido pela pessoa continua protegido.
    if not os.access(caminho, os.W_OK):
        raise PermissionError(caminho)
    ext = os.path.splitext(caminho)[1].lower()
    if ext in JPEG:
        return girar_jpeg(caminho, graus)
    if ext in PNG:
        return girar_png(caminho, graus)
    raise NaoSabe(f"{ext} gira só na tela")
