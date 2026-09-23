"""Girar e gravar: arquivos de verdade, girados pelo `girar.py`, lidos de volta pelo Pillow.

Um JPEG tem dois caminhos, e cada um tem a sua prova. Pelo `jpegtran`, a foto fica em pé para o
Pillow sem `exif_transpose`, que é o que um notebook vê, e quatro voltas devolvem os mesmos pixels.
Pela etiqueta, os dados da imagem, do SOS ao fim, são os mesmos bytes antes e depois, e a imagem
como um visualizador a mostra (`exif_transpose`) é a de antes girada pelo Pillow.

Os casos da etiqueta desligam o `jpegtran`, e medem aquele caminho em qualquer máquina. Os do
`jpegtran` se pulam sem ele; o CI o instala, como a instalação do app.
"""

import importlib.util
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zlib
from unittest import mock

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_AQUI, "..", "backend"))

import girar  # noqa: E402

TEM_PIL = importlib.util.find_spec("PIL") is not None
TEM_JPEGTRAN = bool(shutil.which("jpegtran"))


def dados_da_imagem(b):
    """Do SOS ao fim de um JPEG: os dados comprimidos da imagem."""
    p = 2
    while b[p + 1] != 0xDA:
        p += 2 + struct.unpack(">H", b[p + 2:p + 4])[0]
    return b[p:]


def primeiros_segmentos(b):
    p, marcadores = 2, []
    while b[p + 1] != 0xDA:
        marcadores.append(b[p + 1])
        p += 2 + struct.unpack(">H", b[p + 2:p + 4])[0]
    return marcadores


def app1_de_camera(miniatura, largura, altura, sobra=b""):
    """Um APP1 EXIF como o de uma câmera: a IFD0 com a orientação 1 e o ponteiro do EXIF, as
    dimensões no EXIF, e a IFD1 com a miniatura no fim do segmento (depois dela, `sobra`)."""
    def ifd(entradas, proxima):
        return (struct.pack(">H", len(entradas))
                + b"".join(struct.pack(">HHI", tag, tipo, 1) + valor for tag, tipo, valor in entradas)
                + struct.pack(">I", proxima))
    curto = lambda v: struct.pack(">HH", v, 0)  # noqa: E731
    longo = lambda v: struct.pack(">I", v)  # noqa: E731
    # O cabeçalho ocupa 0..7, a IFD0 8..37, o EXIF 38..67, a IFD1 68..109, e a miniatura vem em 110.
    tiff = (b"MM\x00\x2a" + struct.pack(">I", 8)
            + ifd([(0x0112, 3, curto(1)), (0x8769, 4, longo(38))], 68)
            + ifd([(0xA002, 3, curto(largura)), (0xA003, 3, curto(altura))], 0)
            + ifd([(0x0103, 3, curto(6)), (0x0201, 4, longo(110)), (0x0202, 4, longo(len(miniatura)))], 0)
            + miniatura + sobra)
    corpo = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(corpo) + 2) + corpo


def miniatura_do_exif(b):
    """Os bytes da miniatura da IFD1, ou `None` se a IFD0 não aponta para uma IFD1."""
    p = 2
    while not (b[p + 1] == 0xE1 and b[p + 4:p + 10] == b"Exif\x00\x00"):
        p += 2 + struct.unpack(">H", b[p + 2:p + 4])[0]
    t = p + 10
    e = "<" if b[t:t + 2] == b"II" else ">"
    u16 = lambda x: struct.unpack(e + "H", b[x:x + 2])[0]  # noqa: E731
    u32 = lambda x: struct.unpack(e + "I", b[x:x + 4])[0]  # noqa: E731
    ifd0 = t + u32(t + 4)
    proxima = u32(ifd0 + 2 + 12 * u16(ifd0))
    if not proxima:
        return None
    ifd1 = t + proxima
    campos = {u16(ifd1 + 2 + 12 * i): u32(ifd1 + 2 + 12 * i + 8) for i in range(u16(ifd1))}
    return b[t + campos[0x0201]:t + campos[0x0201] + campos[0x0202]]


def ler(caminho):
    with open(caminho, "rb") as fh:
        return fh.read()


class Bancada(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="lupa-girar-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def quadrantes(self, modo="RGB", tamanho=(64, 40)):
        """Uma imagem de quatro cores, uma por quadrante: toda rotação e todo espelho é distinto."""
        from PIL import Image
        im = Image.new("RGB", tamanho, (220, 30, 30))
        w, h = tamanho
        im.paste((30, 30, 220), (w // 2, 0, w, h // 2))
        im.paste((30, 200, 30), (0, h // 2, w // 2, h))
        im.paste((240, 240, 240), (w // 2, h // 2, w, h))
        return im.convert(modo)

    def jpeg(self, nome, exif=None, tamanho=(64, 40), xmp=None, **opcoes):
        """Um JPEG de quadrantes. O XMP entra à mão, como um APP1 depois dos outros segmentos APP:
        o `xmp=` do `save` é do Pillow 11, e o 10.2 do Ubuntu 24.04 o ignora sem avisar."""
        caminho = os.path.join(self.tmp, nome)
        self.quadrantes(tamanho=tamanho).save(caminho, "JPEG", quality=92,
                                              **({"exif": exif} if exif else {}), **opcoes)
        if xmp:
            b = ler(caminho)
            p = 2
            while 0xE0 <= b[p + 1] <= 0xEF:
                p += 2 + struct.unpack(">H", b[p + 2:p + 4])[0]
            corpo = b"http://ns.adobe.com/xap/1.0/\x00" + xmp
            with open(caminho, "wb") as fh:
                fh.write(b[:p] + b"\xff\xe1" + struct.pack(">H", len(corpo) + 2) + corpo + b[p:])
        return caminho

    def na_tela(self, caminho):
        from PIL import Image, ImageOps
        with Image.open(caminho) as im:
            return ImageOps.exif_transpose(im).convert("RGB")

    def crua(self, caminho):
        """A imagem como o Pillow a abre, sem aplicar a etiqueta: é o que um notebook vê."""
        from PIL import Image
        with Image.open(caminho) as im:
            return im.convert("RGB")

    def orientacao(self, caminho):
        from PIL import Image
        with Image.open(caminho) as im:
            return im.getexif().get(0x0112)

    def assertMesmaImagem(self, a, b, msg=None):
        self.assertEqual(a.size, b.size, msg)
        self.assertEqual(a.tobytes(), b.tobytes(), msg)

    def assertParecida(self, a, b, msg=None):
        """A mesma imagem a menos do arredondamento do IDCT, que muda de lado quando os blocos giram.

        A diferença medida é de até 3 níveis; uma orientação errada nos quadrantes dá centenas.
        """
        from PIL import ImageChops
        self.assertEqual(a.size, b.size, msg)
        maior = max(hi for _, hi in ImageChops.difference(a, b).getextrema())
        self.assertLessEqual(maior, 6, msg)


# ── JPEG, pela etiqueta ──────────────────────────────────────────────────────

@unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
class TestPelaEtiqueta(Bancada):

    def setUp(self):
        super().setUp()
        desligado = mock.patch.object(girar, "JPEGTRAN", "jpegtran-que-nao-existe")
        desligado.start()
        self.addCleanup(desligado.stop)

    def test_um_jpeg_com_a_etiqueta_muda_dois_bytes_e_quatro_voltas_devolvem_o_arquivo(self):
        from PIL import Image
        exif = Image.Exif()
        exif[0x0112] = 1
        exif[0x010F] = "Canon"
        foto = self.jpeg("praia.jpg", exif)
        antes, tela_antes = ler(foto), self.na_tela(foto)

        self.assertEqual(girar.girar(foto, 90), {"orientacao": 6, "jpegtran": False})
        depois = ler(foto)
        self.assertEqual(len(depois), len(antes))
        self.assertEqual(sum(1 for x, y in zip(antes, depois) if x != y), 1,
                         "a etiqueta é um SHORT, e de 1 para 6 muda um byte")
        self.assertEqual(dados_da_imagem(depois), dados_da_imagem(antes))
        self.assertMesmaImagem(self.na_tela(foto), tela_antes.transpose(Image.Transpose.ROTATE_270))

        for _ in range(3):
            girar.girar(foto, 90)
        self.assertEqual(ler(foto), antes)

    def test_as_oito_orientacoes_giram_no_sentido_da_tela(self):
        # Os espelhos (2, 4, 5, 7) são os que uma tabela errada troca sem ninguém ver numa foto de
        # celular, que só usa 1, 3, 6 e 8.
        from PIL import Image
        for o in range(1, 9):
            for graus, pillow in ((90, Image.Transpose.ROTATE_270), (180, Image.Transpose.ROTATE_180),
                                  (270, Image.Transpose.ROTATE_90)):
                exif = Image.Exif()
                exif[0x0112] = o
                foto = self.jpeg(f"o{o}-{graus}.jpg", exif)
                esperada = self.na_tela(foto).transpose(pillow)
                girar.girar(foto, graus)
                self.assertMesmaImagem(self.na_tela(foto), esperada, f"orientação {o}, {graus} graus")

    def test_um_jpeg_sem_exif_ganha_um_depois_do_jfif(self):
        from PIL import Image
        foto = self.jpeg("sem-exif.jpg")
        antes, tela_antes = ler(foto), self.na_tela(foto)
        self.assertEqual(primeiros_segmentos(antes)[0], 0xE0)
        self.assertIsNone(self.orientacao(foto))

        self.assertEqual(girar.girar(foto, 270)["orientacao"], 8)
        depois = ler(foto)
        self.assertEqual(primeiros_segmentos(depois)[:2], [0xE0, 0xE1], "o APP0 do JFIF continua o primeiro")
        self.assertEqual(dados_da_imagem(depois), dados_da_imagem(antes))
        self.assertEqual(self.orientacao(foto), 8)
        self.assertMesmaImagem(self.na_tela(foto), tela_antes.transpose(Image.Transpose.ROTATE_90))

        girar.girar(foto, 90)
        self.assertEqual(self.orientacao(foto), 1)
        self.assertMesmaImagem(self.na_tela(foto), tela_antes)

    def test_um_exif_sem_a_etiqueta_a_ganha_e_guarda_o_resto(self):
        from PIL import Image
        from PIL.TiffImagePlugin import IFDRational
        exif = Image.Exif()
        exif[0x010F], exif[0x0110] = "Canon", "Canon EOS R6"
        # A sub-IFD entra como dicionário inteiro: no Pillow 10.2, o `get_ifd` de um EXIF novo
        # devolve um dicionário solto, e o que se põe nele não é gravado.
        exif[0x8825] = {1: "S", 2: (IFDRational(23, 1), IFDRational(33, 1), IFDRational(0, 1))}
        foto = self.jpeg("sem-etiqueta.jpg", exif)
        antes = ler(foto)
        with Image.open(foto) as im:
            self.assertEqual(im.getexif().get_ifd(0x8825).get(1), "S", "a foto de teste nasceu sem GPS")

        self.assertEqual(girar.girar(foto, 180)["orientacao"], 3)
        self.assertEqual(dados_da_imagem(ler(foto)), dados_da_imagem(antes))
        with Image.open(foto) as im:
            e = im.getexif()
            self.assertEqual((e.get(0x0112), e.get(0x0110)), (3, "Canon EOS R6"))
            self.assertEqual(e.get_ifd(0x8825).get(1), "S", "o GPS se perdeu")

    def test_um_exif_sem_a_etiqueta_e_com_makernote_nao_e_reescrito(self):
        from PIL import Image
        exif = Image.Exif()
        exif[0x010F] = "Nikon"
        exif[0x8769] = {0x927C: b"Nikon\x00\x02\x10\x00\x00MM\x00*\x00\x00\x00\x08"}
        foto = self.jpeg("makernote.jpg", exif)
        antes = ler(foto)
        with Image.open(foto) as im:
            self.assertIsNotNone(im.getexif().get_ifd(0x8769).get(0x927C), "a foto de teste nasceu sem MakerNote")
        with self.assertRaises(girar.NaoSabe):
            girar.girar(foto, 90)
        self.assertEqual(ler(foto), antes)

    def test_o_xmp_acompanha_o_exif(self):
        from PIL import Image
        exif = Image.Exif()
        exif[0x0112] = 1
        xmp = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/'
               b'22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/" '
               b'tiff:Orientation="1"/></rdf:RDF></x:xmpmeta>')
        foto = self.jpeg("com-xmp.jpg", exif, xmp=xmp)
        antes = ler(foto)
        self.assertIn(b'tiff:Orientation="1"', antes)
        girar.girar(foto, 90)
        depois = ler(foto)
        self.assertIn(b'tiff:Orientation="6"', depois)
        self.assertEqual(len(depois), len(antes))
        self.assertEqual(dados_da_imagem(depois), dados_da_imagem(antes))


# ── JPEG, pelo jpegtran ──────────────────────────────────────────────────────

@unittest.skipUnless(TEM_PIL and TEM_JPEGTRAN, "sem o Pillow ou o jpegtran")
class TestPeloJpegtran(Bancada):

    # Largura e altura múltiplas de 16, o bloco de um JPEG 4:2:0: toda operação é sem perda.
    ALINHADA = (64, 48)

    def test_a_foto_fica_em_pe_para_o_pillow_e_quatro_voltas_devolvem_os_pixels(self):
        from PIL import Image
        exif = Image.Exif()
        exif[0x0112] = 1
        exif[0x010F] = "Canon"
        foto = self.jpeg("praia.jpg", exif, self.ALINHADA)
        crua_antes = self.crua(foto)

        self.assertEqual(girar.girar(foto, 90), {"orientacao": 1, "jpegtran": True})
        self.assertParecida(self.crua(foto), crua_antes.transpose(Image.Transpose.ROTATE_270))
        with Image.open(foto) as im:
            self.assertEqual((im.getexif().get(0x0112), im.getexif().get(0x010F)), (1, "Canon"))

        for _ in range(3):
            girar.girar(foto, 90)
        self.assertMesmaImagem(self.crua(foto), crua_antes)

    def test_as_oito_orientacoes_ficam_em_pe_sem_a_etiqueta(self):
        from PIL import Image
        for o in range(1, 9):
            for graus, pillow in ((90, Image.Transpose.ROTATE_270), (180, Image.Transpose.ROTATE_180),
                                  (270, Image.Transpose.ROTATE_90)):
                exif = Image.Exif()
                exif[0x0112] = o
                foto = self.jpeg(f"o{o}-{graus}.jpg", exif, self.ALINHADA)
                esperada = self.na_tela(foto).transpose(pillow)
                girar.girar(foto, graus)
                self.assertEqual(self.orientacao(foto), 1, f"orientação {o}, {graus} graus")
                self.assertParecida(self.crua(foto), esperada, f"orientação {o}, {graus} graus")

    def test_uma_altura_fora_do_bloco_gira_pela_etiqueta(self):
        # 90 graus levariam a fileira parcial de baixo para a esquerda, onde o JPEG não admite
        # bloco parcial, e o `-perfect` recusa. É o caso de uma foto de 4000 × 3000.
        foto = self.jpeg("desalinhada.jpg", tamanho=(64, 40))
        antes = ler(foto)
        self.assertEqual(girar.girar(foto, 90), {"orientacao": 6, "jpegtran": False})
        self.assertEqual(dados_da_imagem(ler(foto)), dados_da_imagem(antes))

    def test_um_jpeg_progressivo_continua_progressivo(self):
        from PIL import Image
        foto = self.jpeg("progressiva.jpg", tamanho=self.ALINHADA, progressive=True)
        girar.girar(foto, 90)
        with Image.open(foto) as im:
            self.assertEqual(im.size, (48, 64))
            self.assertTrue(im.info.get("progressive"))

    def test_o_xmp_volta_a_1_com_a_etiqueta(self):
        from PIL import Image
        exif = Image.Exif()
        exif[0x0112] = 6
        xmp = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/'
               b'22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/">'
               b'<tiff:Orientation>6</tiff:Orientation></rdf:Description></rdf:RDF></x:xmpmeta>')
        foto = self.jpeg("com-xmp.jpg", exif, self.ALINHADA, xmp=xmp)
        girar.girar(foto, 90)
        self.assertIn(b"<tiff:Orientation>1</tiff:Orientation>", ler(foto))
        self.assertEqual(self.orientacao(foto), 1)

    def foto_de_camera(self, nome, sobra=b""):
        """Uma foto 64 × 48 com a miniatura 32 × 16 no EXIF, como a de uma câmera."""
        import io
        mini = io.BytesIO()
        self.quadrantes(tamanho=(32, 16)).save(mini, "JPEG", quality=90)
        caminho = self.jpeg(nome, tamanho=self.ALINHADA)
        b = ler(caminho)
        depois = 2 + 2 + struct.unpack(">H", b[4:6])[0]   # depois do APP0 do JFIF
        with open(caminho, "wb") as fh:
            fh.write(b[:depois] + app1_de_camera(mini.getvalue(), 64, 48, sobra) + b[depois:])
        return caminho, mini.getvalue()

    def test_a_miniatura_do_exif_gira_junto_e_as_dimensoes_trocam(self):
        import io
        from PIL import Image
        foto, mini_antes = self.foto_de_camera("camera.jpg")
        girar.girar(foto, 90)
        with Image.open(foto) as im:
            self.assertEqual(im.size, (48, 64))
            e = im.getexif().get_ifd(0x8769)
            self.assertEqual((e.get(0xA002), e.get(0xA003)), (48, 64))
        mini = Image.open(io.BytesIO(miniatura_do_exif(ler(foto)))).convert("RGB")
        antes = Image.open(io.BytesIO(mini_antes)).convert("RGB")
        self.assertParecida(mini, antes.transpose(Image.Transpose.ROTATE_270))

    def test_a_miniatura_que_nao_esta_no_fim_sai_do_arquivo(self):
        from PIL import Image
        foto, _ = self.foto_de_camera("camera-sobra.jpg", sobra=b"\x00" * 4)
        girar.girar(foto, 90)
        self.assertIsNone(miniatura_do_exif(ler(foto)))
        with Image.open(foto) as im:
            self.assertEqual(im.size, (48, 64))


# ── PNG e o arquivo ──────────────────────────────────────────────────────────

@unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
class TestGirar(Bancada):

    def blocos(self, caminho):
        b, p, saida = ler(caminho), 8, []
        while p < len(b):
            n, tipo = struct.unpack(">I4s", b[p:p + 8])
            saida.append((tipo, b[p + 8:p + 8 + n]))
            p += 12 + n
        return saida

    def test_um_png_gira_com_os_mesmos_pixels_e_os_blocos_de_antes(self):
        from PIL import Image, PngImagePlugin
        png = os.path.join(self.tmp, "tela.png")
        im = self.quadrantes("RGBA", (300, 200))
        im.putpixel((0, 0), (10, 20, 30, 0))
        meta = PngImagePlugin.PngInfo()
        meta.add_text("Title", "Captura")
        meta.add_itxt("Description", "Descrição com acento", lang="pt-BR")
        meta.add(b"gAMA", struct.pack(">I", 55000))
        im.save(png, pnginfo=meta, dpi=(300, 72))
        tela_antes = Image.open(png).convert("RGBA")

        self.assertEqual(girar.girar(png, 90), {})
        with Image.open(png) as depois:
            self.assertMesmaImagem(depois.convert("RGBA"), tela_antes.transpose(Image.Transpose.ROTATE_270))
            self.assertEqual(depois.text.get("Title"), "Captura")
            self.assertEqual(depois.text.get("Description"), "Descrição com acento")
            self.assertAlmostEqual(depois.info["gamma"], 0.55)
            dpi = depois.info["dpi"]
            self.assertEqual((round(dpi[0]), round(dpi[1])), (72, 300), "a resolução troca de eixo")
        tipos = [t for t, _ in self.blocos(png)]
        self.assertLess(tipos.index(b"gAMA"), tipos.index(b"IDAT"))

        for _ in range(3):
            girar.girar(png, 90)
        with Image.open(png) as depois:
            self.assertMesmaImagem(depois.convert("RGBA"), tela_antes)

    def test_um_png_de_paleta_guarda_a_transparencia(self):
        from PIL import Image
        png = os.path.join(self.tmp, "icone.png")
        im = self.quadrantes("RGB", (32, 20)).quantize(8)
        im.info["transparency"] = 0
        im.save(png, transparency=0)
        antes = Image.open(png).convert("RGBA")
        girar.girar(png, 180)
        with Image.open(png) as depois:
            self.assertEqual(depois.mode, "P")
            self.assertMesmaImagem(depois.convert("RGBA"), antes.transpose(Image.Transpose.ROTATE_180))

    def test_um_png_cinza_de_16_bits_gira_sem_perder_bits(self):
        from PIL import Image
        png = os.path.join(self.tmp, "cinza16.png")
        im = Image.new("I;16", (3, 2))
        for i, v in enumerate([0, 1, 257, 4000, 65534, 65535]):
            im.putpixel((i % 3, i // 3), v)
        im.save(png)
        girar.girar(png, 90)
        with Image.open(png) as depois:
            self.assertEqual(depois.size, (2, 3))
            valores = [depois.getpixel((x, y)) for y in range(3) for x in range(2)]
            self.assertEqual(sorted(valores), [0, 1, 257, 4000, 65534, 65535])
            self.assertEqual(depois.getpixel((1, 0)), 0, "o canto de cima à esquerda vai para a direita")

    def test_um_png_de_16_bits_em_cor_fica_na_tela(self):
        # O Pillow o lê em 8 bits por canal, e gravá-lo perderia a metade de baixo de cada valor.
        png = os.path.join(self.tmp, "cor16.png")
        ihdr = struct.pack(">IIBBBBB", 1, 1, 16, 2, 0, 0, 0)
        idat = zlib.compress(b"\x00" + b"\x12\x34" * 3)
        bloco = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))  # noqa: E731
        with open(png, "wb") as fh:
            fh.write(girar.ASSINATURA + bloco(b"IHDR", ihdr) + bloco(b"IDAT", idat) + bloco(b"IEND", b""))
        antes = ler(png)
        with self.assertRaises(girar.NaoSabe):
            girar.girar(png, 90)
        self.assertEqual(ler(png), antes)

    def test_um_png_com_orientacao_no_exif_gira_como_aparece(self):
        from PIL import Image
        png = os.path.join(self.tmp, "exif.png")
        exif = Image.Exif()
        exif[0x0112] = 6
        self.quadrantes("RGB", (60, 40)).save(png, exif=exif)
        tela_antes = self.na_tela(png)
        self.assertEqual(tela_antes.size, (40, 60))
        girar.girar(png, 90)
        self.assertEqual(self.orientacao(png), 1)
        self.assertMesmaImagem(self.na_tela(png), tela_antes.transpose(Image.Transpose.ROTATE_270))

    def test_outro_formato_fica_na_tela(self):
        gif = os.path.join(self.tmp, "anima.gif")
        self.quadrantes().save(gif)
        antes = ler(gif)
        with self.assertRaises(girar.NaoSabe):
            girar.girar(gif, 90)
        self.assertEqual(ler(gif), antes)

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "o root grava em qualquer arquivo")
    def test_um_arquivo_so_de_leitura_continua_como_estava(self):
        foto = self.jpeg("protegida.jpg")
        antes = ler(foto)
        os.chmod(foto, 0o444)
        self.addCleanup(os.chmod, foto, 0o644)
        with self.assertRaises(PermissionError):
            girar.girar(foto, 90)
        self.assertEqual(ler(foto), antes)

    def test_um_link_simbolico_continua_link_e_o_destino_gira(self):
        foto = self.jpeg("destino.jpg")
        antes = ler(foto)
        link = os.path.join(self.tmp, "atalho.jpg")
        try:
            os.symlink(foto, link)
        except (OSError, NotImplementedError):
            self.skipTest("este sistema não cria link simbólico sem privilégio")
        girar.girar(link, 90)
        self.assertTrue(os.path.islink(link))
        self.assertNotEqual(ler(foto), antes)

    def test_um_png_com_dois_nomes_gira_nos_dois(self):
        # A troca por renomeação separaria os nomes: um giraria, e o outro ficaria com a de antes.
        from PIL import Image
        png = os.path.join(self.tmp, "um.png")
        outro = os.path.join(self.tmp, "outro.png")
        self.quadrantes("RGB", (30, 20)).save(png)
        os.link(png, outro)
        girar.girar(png, 90)
        with Image.open(outro) as im:
            self.assertEqual(im.size, (20, 30))
        self.assertEqual(os.stat(png).st_ino, os.stat(outro).st_ino)

    def test_o_angulo_e_um_quarto_de_volta(self):
        foto = self.jpeg("angulo.jpg")
        for graus in (0, 45, 360, -90):
            with self.assertRaises(ValueError):
                girar.girar(foto, graus)


if __name__ == "__main__":
    unittest.main()
