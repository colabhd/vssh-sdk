"""As miniaturas da tira, da grade e da lateral do PDF.

Uma pasta de câmera tem centenas de fotos de 5 a 12 MB, e baixar cada uma para desenhar um
quadrado de 96 pixels custaria gigabytes numa rolagem. O servidor reduz, guarda em disco e serve
alguns quilobytes.

O que o servidor reduz, e com quê, saiu de uma medição numa estação (Debian 13): o Pillow do
`python3-pil` faz a miniatura de uma foto de 24 MP em 12 a 58 ms, dentro do próprio processo e
com a orientação EXIF aplicada, e o `pdftoppm` do `poppler-utils` desenha a primeira página de um
PDF em 73 ms. O resto fica com o navegador: o Pillow da estação não lê AVIF, e SVG nenhum dos dois
desenha, então a página usa o próprio arquivo; TIFF e HEIC têm a miniatura dentro do arquivo, que
o decodificador do Tuff lê por Range.

A miniatura sai em WebP, que guarda a transparência de um PNG ou de um ícone; a de um PDF sai em
JPEG, direto do `pdftoppm`. O cache fica em `~/.cache/vssh/lupa/` (ou sob `XDG_CACHE_HOME`, quando a
sessão o define), com a chave feita do caminho,
da data de modificação, do tamanho e do lado: um arquivo editado ganha miniatura nova sem ninguém
apagar a velha, e a velha sai na poda, que roda no boot e leva o que ninguém pediu em 90 dias.
"""

import hashlib
import os
import subprocess
import tempfile
import threading
import time

#: O que o servidor reduz. O resto (SVG, AVIF, TIFF, HEIC) a página mostra por conta própria.
IMAGENS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico"}
PDF = {".pdf"}
DO_SERVIDOR = IMAGENS | PDF

#: Os lados que existem. Um pedido de 96 recebe a de 128: poucos tamanhos no cache, e a página
#: reduz o resto sem perda visível.
LADOS = (128, 256, 512)

PASTA = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache"),
                     "vssh", "lupa")


class SemFerramenta(Exception):
    """O programa ou a biblioteca que gera esta miniatura não está no servidor."""


def extensao(caminho):
    return os.path.splitext(caminho)[1].lower()


def lado_de(pedido):
    """O menor dos `LADOS` que cobre o pedido, e o maior deles para um pedido acima de todos."""
    try:
        n = int(pedido)
    except (TypeError, ValueError):
        n = LADOS[1]
    return next((lado for lado in LADOS if lado >= n), LADOS[-1])


def chave(caminho, st, lado):
    bruto = f"{caminho}\0{st.st_mtime_ns}\0{st.st_size}\0{lado}".encode("utf-8", "surrogateescape")
    return hashlib.sha1(bruto).hexdigest()


def _gravar(destino, escrever):
    """Grava por `escrever(arquivo_temporario)` e troca de uma vez: quem lê o cache nunca vê meia
    miniatura, nem numa queda no meio."""
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(destino), prefix=".parcial-")
    os.close(fd)
    try:
        escrever(tmp)
        os.replace(tmp, destino)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _da_imagem(origem, lado, destino):
    try:
        from PIL import Image, ImageOps
    except ImportError as e:
        raise SemFerramenta("python3-pil") from e

    def escrever(tmp):
        with Image.open(origem) as im:
            # `draft` pede ao decodificador de JPEG a menor escala de DCT que ainda cobre o lado:
            # uma foto de 24 MP é lida a um oitavo, sem passar pelos 96 MB de pixels.
            im.draft("RGB", (lado, lado))
            im = ImageOps.exif_transpose(im)
            im.thumbnail((lado, lado))
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB")
            im.save(tmp, "WEBP", quality=80, method=4)

    _gravar(destino, escrever)


def _do_pdf(origem, lado, destino):
    def escrever(tmp):
        base = tmp + "-pagina"
        try:
            r = subprocess.run(
                ["pdftoppm", "-f", "1", "-l", "1", "-scale-to", str(lado), "-jpeg",
                 "-jpegopt", "quality=80", "-singlefile", origem, base],
                capture_output=True, timeout=30)
        except FileNotFoundError as e:
            raise SemFerramenta("poppler-utils") from e
        if r.returncode != 0 or not os.path.exists(base + ".jpg"):
            raise ValueError(r.stderr.decode("utf-8", "replace")[-300:] or "pdftoppm falhou")
        os.replace(base + ".jpg", tmp)

    _gravar(destino, escrever)


# Pedidos simultâneos pela mesma miniatura geram uma vez: a tira pede as vizinhas todas de uma vez,
# e a grade de uma pasta nova pede dezenas. O primeiro gera, os outros esperam o evento dele.
_em_andamento = {}
_tranca = threading.Lock()


def miniatura(caminho, pedido, ao_gerar=None):
    """`(arquivo_do_cache, tipo, chave)` da miniatura de `caminho`, gerando se preciso.

    Lança `SemFerramenta` quando falta o programa, `ValueError` quando o arquivo não se deixa
    reduzir (corrompido, grande demais para o Pillow), e `OSError` do disco. `ao_gerar(ms)` é
    chamado só quando a miniatura foi gerada, e não lida do cache.
    """
    ext = extensao(caminho)
    lado = lado_de(pedido)
    st = os.stat(caminho)
    k = chave(caminho, st, lado)
    sufixo, tipo = (".jpg", "image/jpeg") if ext in PDF else (".webp", "image/webp")
    destino = os.path.join(PASTA, k[:2], k + sufixo)

    while True:
        if os.path.exists(destino):
            try:
                os.utime(destino)   # a poda conta a partir do último uso
            except OSError:
                pass
            return destino, tipo, k
        with _tranca:
            evento = _em_andamento.get(k)
            dono = evento is None
            if dono:
                evento = _em_andamento[k] = threading.Event()
        if not dono:
            evento.wait(timeout=60)
            if os.path.exists(destino):
                continue
            raise ValueError("a miniatura não foi gerada")
        try:
            inicio = time.monotonic()
            if ext in PDF:
                _do_pdf(caminho, lado, destino)
            else:
                try:
                    _da_imagem(caminho, lado, destino)
                except SemFerramenta:
                    raise
                except Exception as e:   # noqa: BLE001  o Pillow lança de tudo num arquivo torto
                    raise ValueError(str(e)[:300]) from e
            if ao_gerar:
                ao_gerar(int((time.monotonic() - inicio) * 1000))
        finally:
            with _tranca:
                _em_andamento.pop(k, None)
            evento.set()


def podar(dias=90, agora=None):
    """Apaga do cache o que ninguém pediu em `dias`. Devolve quantos arquivos saíram."""
    limite = (agora or time.time()) - dias * 86400
    saiu = 0
    for raiz, _dirs, arquivos in os.walk(PASTA):
        for nome in arquivos:
            p = os.path.join(raiz, nome)
            try:
                if os.stat(p).st_mtime < limite:
                    os.unlink(p)
                    saiu += 1
            except OSError:
                pass
    return saiu
