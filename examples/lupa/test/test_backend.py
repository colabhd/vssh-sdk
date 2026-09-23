"""O backend inteiro, de pé: o `main.py` como o `vssh-app-run` o sobe, pedido por HTTP.

O processo sobe com `--tcp 127.0.0.1:0` e lê a porta da linha que o `servidor.escutar` imprime.
Sem o runtime `vssh` (nem no `PYTHONPATH`, nem em `runtime/python` deste checkout) o módulo se
pula.
"""

import http.client
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import quote

_AQUI = os.path.dirname(os.path.abspath(__file__))
_APP = os.path.join(_AQUI, "..")
_RAIZ = os.path.abspath(os.path.join(_APP, "..", ".."))
_RUNTIME = os.path.join(_RAIZ, "runtime", "python")

if importlib.util.find_spec("vssh") is not None:
    _PYTHONPATH = os.environ.get("PYTHONPATH", "")
elif os.path.isdir(os.path.join(_RUNTIME, "vssh")):
    _PYTHONPATH = _RUNTIME
else:
    _PYTHONPATH = None

SEM_RUNTIME = None if _PYTHONPATH is not None else (
    "sem o runtime `vssh`: exporte PYTHONPATH (scripts/ambiente-de-dev.sh) ou gere runtime/python")

TOKEN = "token-de-bancada"

# As miniaturas pedem o Pillow e o `pdftoppm` que o manifesto declara; sem eles, os casos se pulam.
TEM_PIL = importlib.util.find_spec("PIL") is not None
TEM_PDFTOPPM = bool(shutil.which("pdftoppm"))
TEM_JPEGTRAN = bool(shutil.which("jpegtran"))


@unittest.skipIf(SEM_RUNTIME, SEM_RUNTIME)
class TestBackendDePe(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="lupa-backend-")
        env = {**os.environ, "VSSH_APP_ID": "lupa", "VSSH_APP_TOKEN": TOKEN,
               "VSSH_APP_DATA_DIR": os.path.join(cls.tmp, "dados"), "HOME": cls.tmp,
               "XDG_CACHE_HOME": os.path.join(cls.tmp, "cache"),
               "PYTHONPATH": _PYTHONPATH, "PYTHONUNBUFFERED": "1"}
        cls.proc = subprocess.Popen(
            [sys.executable, os.path.join(_APP, "backend", "main.py"), "--tcp", "127.0.0.1:0"],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        # O `criar_log` também escreve no stdout, então a linha do endereço vem entre as do log.
        lidas = []
        for linha in cls.proc.stdout:
            lidas.append(linha)
            if "escutando em" in linha or len(lidas) > 20:
                break
        if not lidas or "escutando em" not in lidas[-1]:
            cls.proc.kill()
            raise RuntimeError(f"o backend não subiu: {lidas!r} {cls.proc.stderr.read()[-800:]}")
        cls.porta = int(lidas[-1].rsplit(":", 1)[1])
        # O stdout continua recebendo o log; sem quem o leia, o cano enche e o backend trava.
        threading.Thread(target=lambda: [None for _ in cls.proc.stdout], daemon=True).start()
        threading.Thread(target=lambda: [None for _ in cls.proc.stderr], daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.proc.kill()
        cls.proc.wait(timeout=10)

    def pedir(self, metodo, rota, token=TOKEN, cabecalhos=None, corpo=None):
        con = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=30)
        if corpo is not None:
            corpo = json.dumps(corpo).encode("utf-8")
            cabecalhos = {"Content-Type": "application/json", **(cabecalhos or {})}
        con.request(metodo, rota, body=corpo,
                    headers={**({"X-Vssh-App-Token": token} if token else {}), **(cabecalhos or {})})
        r = con.getresponse()
        resposta = (r.status, dict(r.getheaders()), r.read())
        con.close()
        return resposta

    def json(self, rota):
        status, _, dados = self.pedir("GET", rota)
        return status, json.loads(dados.decode("utf-8"))

    def pasta(self, nome, arquivos):
        caminho = os.path.join(self.tmp, nome)
        os.makedirs(caminho)
        for a in arquivos:
            with open(os.path.join(caminho, a), "wb") as fh:
                fh.write(b"x")
        return caminho

    # ── O que o runtime faz ──────────────────────────────────────────────────

    def test_a_pagina_carrega_o_SDK_o_Tuff_de_midia_e_o_app(self):
        # É o SDK servido que traz `vssh.app.ao('abertura')`: sem ele o arquivo que o gerenciador
        # de arquivos manda chega e ninguém o escuta.
        status, cab, dados = self.pedir("GET", "/")
        pagina = dados.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertIn("text/html", cab.get("Content-Type", ""))
        for tag in ('src="_sdk/vssh.js"', 'src="_sdk/tuff/tuff-midia.js"',
                    'href="_sdk/tuff/tuff-midia.css"', 'src="_sdk/tuff/tuff-icones.js"',
                    'src="lupa.js?v=', 'href="lupa.css?v='):
            self.assertIn(tag, pagina)

    def test_o_js_e_o_css_do_app_sao_servidos(self):
        for arquivo, tipo in (("lupa.js", "javascript"), ("lupa.css", "text/css")):
            status, cab, dados = self.pedir("GET", "/" + arquivo)
            self.assertEqual(status, 200, arquivo)
            self.assertIn(tipo, cab.get("Content-Type", ""))
            self.assertTrue(dados)

    def test_sem_o_token_o_portao_recusa(self):
        status, cab, _ = self.pedir("GET", "/", token=None)
        self.assertEqual(status, 403)
        self.assertEqual(cab.get("X-Vssh-Token"), "recusado")

    def test_a_saude_responde(self):
        status, corpo = self.json("/saude")
        self.assertEqual(status, 200)
        self.assertTrue(corpo["ok"])

    def test_rota_desconhecida_e_404_em_JSON(self):
        status, corpo = self.json("/api/nada")
        self.assertEqual(status, 404)
        self.assertTrue(corpo["error"])

    def test_um_corpo_que_nenhuma_rota_le_nao_corrompe_o_pedido_SEGUINTE(self):
        # A conexão é keep-alive, e o beacon `/cdn-cgi/rum` da borda é um POST com corpo que chega
        # a todo app. Sem a leitura, os bytes ficariam no socket e o pedido seguinte chegaria com
        # eles colados na linha de método.
        con = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=30)
        try:
            con.request("POST", "/cdn-cgi/rum", body=b'{"eventType":3}' * 40,
                        headers={"X-Vssh-App-Token": TOKEN, "Content-Type": "application/json"})
            r = con.getresponse()
            r.read()
            self.assertEqual(r.status, 404)
            con.request("GET", "/saude", headers={"X-Vssh-App-Token": TOKEN})
            r = con.getresponse()
            self.assertEqual(r.status, 200)
            self.assertTrue(json.loads(r.read())["ok"])
        finally:
            con.close()

    # ── A pasta ──────────────────────────────────────────────────────────────

    def test_a_pasta_vem_em_ordem_natural_so_com_imagem_e_pdf(self):
        pasta = self.pasta("Fotos da viagem", [
            "IMG_10.JPG", "IMG_2.jpg", "IMG_1.heic", "manual.pdf", "._IMG_2.jpg",
            "video.mp4", "notas.txt",
        ])
        os.makedirs(os.path.join(pasta, "subpasta.jpg"))
        status, r = self.json(f"/api/vizinhos?caminho={quote(os.path.join(pasta, 'IMG_2.jpg'))}")
        self.assertEqual(status, 200)
        self.assertEqual([i["nome"] for i in r["itens"]],
                         ["IMG_1.heic", "IMG_2.jpg", "IMG_10.JPG", "manual.pdf"])
        self.assertEqual(r["atual"], 1)
        self.assertEqual(r["pasta"], pasta)
        self.assertEqual(r["itens"][2]["caminho"], os.path.join(pasta, "IMG_10.JPG"))
        # A data e o tamanho vão junto: a data entra na URL da miniatura, e o tamanho na ficha.
        self.assertEqual(r["itens"][2]["tamanho"], 1)
        self.assertEqual(r["itens"][2]["modificado"] // 1000,
                         int(os.stat(os.path.join(pasta, "IMG_10.JPG")).st_mtime))

    def test_a_pasta_inteira_vem_em_ordem_sem_arquivo_aberto(self):
        pasta = self.pasta("pasta-inteira", ["b10.png", "b2.png", "notas.txt", "a.pdf", "._b2.png"])
        status, r = self.json(f"/api/pasta?caminho={quote(pasta)}")
        self.assertEqual(status, 200)
        self.assertEqual([i["nome"] for i in r["itens"]], ["a.pdf", "b2.png", "b10.png"])
        self.assertEqual((r["atual"], r["pasta"]), (-1, pasta))
        for recusado in (os.path.join(pasta, "b2.png"), os.path.join(pasta, "sumiu"), "relativa"):
            status, _ = self.json(f"/api/pasta?caminho={quote(recusado)}")
            self.assertEqual(status, 404, recusado)

    def test_o_arquivo_aberto_esta_na_lista_mesmo_oculto(self):
        pasta = self.pasta("oculta", ["a.png", ".rascunho.png"])
        status, r = self.json(f"/api/vizinhos?caminho={quote(os.path.join(pasta, '.rascunho.png'))}")
        self.assertEqual(status, 200)
        self.assertEqual(r["itens"][r["atual"]]["nome"], ".rascunho.png")

    def test_um_caminho_que_nao_e_arquivo_e_recusado(self):
        pasta = self.pasta("recusas", ["a.png"])
        for caminho in (os.path.join(pasta, "sumiu.png"), pasta, "a.png", ""):
            status, _ = self.json(f"/api/vizinhos?caminho={quote(caminho)}")
            self.assertEqual(status, 404, caminho)
        status, _ = self.json("/api/vizinhos")
        self.assertEqual(status, 404)

    # ── As miniaturas ────────────────────────────────────────────────────────

    def miniatura(self, caminho, lado=200, cabecalhos=None):
        return self.pedir("GET", f"/api/miniatura?caminho={quote(caminho)}&lado={lado}",
                          cabecalhos=cabecalhos)

    def geradas(self, nome):
        """Quantas vezes o backend gerou a miniatura de `nome`, pelo log dele."""
        with open(os.path.join(self.tmp, "dados", "app.log"), encoding="utf-8") as fh:
            eventos = [json.loads(linha) for linha in fh if linha.strip()]
        return sum(1 for e in eventos if e.get("event") == "miniatura" and e.get("nome") == nome)

    @unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
    def test_a_miniatura_de_uma_foto_deitada_sai_em_pe_e_em_WebP(self):
        from PIL import Image
        pasta = self.pasta("foto-deitada", [])
        foto = os.path.join(pasta, "IMG_0001.JPG")
        # 1200 × 800, azul em cima à esquerda, e a orientação EXIF 6: na tela, 800 × 1200 em pé,
        # com o azul em cima à direita.
        im = Image.new("RGB", (1200, 800), (200, 30, 30))
        im.paste((30, 30, 200), (0, 0, 600, 400))
        exif = Image.Exif()
        exif[274] = 6
        im.save(foto, exif=exif, quality=90)

        status, cab, dados = self.miniatura(foto, lado=200)
        self.assertEqual(status, 200)
        self.assertEqual(cab.get("Content-Type"), "image/webp")
        m = Image.open(io.BytesIO(dados)).convert("RGB")
        self.assertEqual(m.size, (171, 256), "o pedido de 200 recebe a de 256, e em pé")
        r, g, b = m.getpixel((150, 30))
        self.assertTrue(b > 150 and r < 80, f"em cima à direita devia ser azul: {(r, g, b)}")

    @unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
    def test_pedidos_juntos_geram_uma_vez_e_o_arquivo_editado_ganha_miniatura_nova(self):
        from PIL import Image
        pasta = self.pasta("simultaneos", [])
        foto = os.path.join(pasta, "juntos.png")
        Image.new("RGB", (900, 600), (0, 160, 0)).save(foto)

        respostas = []
        fios = [threading.Thread(target=lambda: respostas.append(self.miniatura(foto)))
                for _ in range(8)]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual([r[0] for r in respostas], [200] * 8)
        self.assertEqual(len({r[2] for r in respostas}), 1, "os oito receberam bytes diferentes")
        self.assertEqual(self.geradas("juntos.png"), 1, "oito pedidos juntos geraram mais de uma vez")

        status, cab, _ = self.miniatura(foto)
        self.assertEqual((status, self.geradas("juntos.png")), (200, 1), "o segundo pedido não veio do cache")
        status, _, _ = self.miniatura(foto, cabecalhos={"If-None-Match": cab["ETag"]})
        self.assertEqual(status, 304)

        # O arquivo muda (a Lupa gira e salva): a data e o tamanho mudam, e a chave junto.
        Image.new("RGB", (600, 900), (160, 0, 0)).save(foto)
        os.utime(foto, (os.stat(foto).st_atime, os.stat(foto).st_mtime + 5))
        status, cab2, dados = self.miniatura(foto)
        self.assertEqual((status, self.geradas("juntos.png")), (200, 2))
        self.assertNotEqual(cab2["ETag"], cab["ETag"])
        self.assertEqual(Image.open(io.BytesIO(dados)).size, (171, 256))

    @unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
    def test_um_png_transparente_continua_transparente(self):
        from PIL import Image
        pasta = self.pasta("transparente", [])
        png = os.path.join(pasta, "logo.png")
        im = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
        im.paste((255, 200, 0, 255), (100, 100, 300, 300))
        im.save(png)
        status, _, dados = self.miniatura(png, lado=128)
        self.assertEqual(status, 200)
        m = Image.open(io.BytesIO(dados))
        self.assertEqual(m.mode, "RGBA")
        self.assertEqual(m.getpixel((2, 2))[3], 0, "o canto transparente virou fundo")
        self.assertEqual(m.getpixel((64, 64))[3], 255)

    @unittest.skipUnless(TEM_PIL and TEM_PDFTOPPM, "sem o Pillow ou o pdftoppm")
    def test_a_miniatura_de_um_pdf_e_a_primeira_pagina(self):
        from PIL import Image
        pasta = self.pasta("pdf", [])
        pdf = os.path.join(pasta, "relatorio.pdf")
        vermelha = Image.new("RGB", (600, 800), (220, 20, 20))
        azul = Image.new("RGB", (600, 800), (20, 20, 220))
        vermelha.save(pdf, save_all=True, append_images=[azul])
        status, cab, dados = self.miniatura(pdf, lado=256)
        self.assertEqual(status, 200)
        self.assertEqual(cab.get("Content-Type"), "image/jpeg")
        m = Image.open(io.BytesIO(dados)).convert("RGB")
        self.assertEqual(max(m.size), 256)
        r, g, b = m.getpixel((m.size[0] // 2, m.size[1] // 2))
        self.assertTrue(r > 150 and b < 80, f"a primeira página é a vermelha: {(r, g, b)}")

    def test_o_tipo_que_o_navegador_desenha_nao_passa_pelo_servidor(self):
        pasta = self.pasta("do-navegador", ["a.svg", "b.avif", "c.tif", "d.heic"])
        for nome in ("a.svg", "b.avif", "c.tif", "d.heic"):
            status, dados = self.json(f"/api/miniatura?caminho={quote(os.path.join(pasta, nome))}")
            self.assertEqual((status, dados.get("codigo")), (415, "no-navegador"), nome)

    def test_um_arquivo_que_nao_e_imagem_de_verdade_responde_422(self):
        pasta = self.pasta("torta", ["quebrada.jpg"])
        status, _ = self.json(f"/api/miniatura?caminho={quote(os.path.join(pasta, 'quebrada.jpg'))}")
        self.assertEqual(status, 422 if TEM_PIL else 503)

    # ── A ficha ──────────────────────────────────────────────────────────────

    @unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
    def test_a_ficha_traz_as_dimensoes_em_pe_e_o_EXIF_da_camera(self):
        from PIL import Image
        from PIL.TiffImagePlugin import IFDRational
        pasta = self.pasta("ficha", [])
        foto = os.path.join(pasta, "praia.jpg")
        exif = Image.Exif()
        exif[271], exif[272], exif[274] = "Canon", "Canon EOS R6", 6
        e = exif.get_ifd(0x8769)
        e[33434], e[33437], e[34855] = IFDRational(1, 250), IFDRational(28, 10), 400
        e[36867], e[37386], e[42036] = "2024:05:01 10:20:30", IFDRational(35, 1), "RF24-105mm F4 L IS USM"
        g = exif.get_ifd(0x8825)
        g[1], g[2] = "S", (IFDRational(23, 1), IFDRational(33, 1), IFDRational(0, 1))
        g[3], g[4] = "W", (IFDRational(46, 1), IFDRational(38, 1), IFDRational(0, 1))
        Image.new("RGB", (600, 400), (90, 90, 90)).save(foto, exif=exif)

        status, f = self.json(f"/api/info?caminho={quote(foto)}")
        self.assertEqual(status, 200)
        self.assertEqual((f["largura"], f["altura"]), (400, 600), "a foto de lado aparece em pé")
        self.assertEqual(f["tamanho"], os.path.getsize(foto))
        self.assertEqual({k: f.get(k) for k in ("camera", "lente", "exposicao", "abertura", "iso",
                                                 "focal", "capturada")},
                         {"camera": "Canon EOS R6", "lente": "RF24-105mm F4 L IS USM",
                          "exposicao": "1/250 s", "abertura": "f/2.8", "iso": 400, "focal": "35 mm",
                          "capturada": "2024-05-01T10:20:30"})
        self.assertEqual(f["gps"], {"lat": -23.55, "lon": -46.633333})

    def test_a_ficha_de_um_arquivo_que_o_Pillow_nao_abre_fica_com_o_disco(self):
        pasta = self.pasta("ficha-heic", ["foto.heic"])
        status, f = self.json(f"/api/info?caminho={quote(os.path.join(pasta, 'foto.heic'))}")
        self.assertEqual(status, 200)
        self.assertEqual((f["nome"], f["tamanho"]), ("foto.heic", 1))
        self.assertNotIn("largura", f)

    # ── Girar e gravar ───────────────────────────────────────────────────────

    def girar(self, caminho, graus):
        status, _, dados = self.pedir("POST", "/api/girar", corpo={"caminho": caminho, "graus": graus})
        return status, json.loads(dados.decode("utf-8"))

    @unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
    def test_girar_uma_foto_grava_e_a_miniatura_e_a_ficha_acompanham(self):
        from PIL import Image
        pasta = self.pasta("girar", [])
        foto = os.path.join(pasta, "deitada.jpg")
        Image.new("RGB", (1200, 800), (40, 90, 160)).save(foto, quality=90)
        _, cab, dados = self.miniatura(foto, lado=256)
        self.assertEqual(Image.open(io.BytesIO(dados)).size, (256, 171))
        mtime_antes = os.stat(foto).st_mtime_ns

        # Com o `jpegtran`, os blocos giram e a etiqueta fica em 1; sem ele, a etiqueta vira 6.
        status, r = self.girar(foto, 90)
        self.assertEqual((status, r["orientacao"], r["jpegtran"]),
                         (200, 1, True) if TEM_JPEGTRAN else (200, 6, False))
        self.assertEqual(r["tamanho"], os.path.getsize(foto))
        self.assertNotEqual(os.stat(foto).st_mtime_ns, mtime_antes)

        # A miniatura em cache era da foto deitada, e a chave dela leva a data do arquivo.
        _, cab2, dados = self.miniatura(foto, lado=256)
        self.assertEqual(Image.open(io.BytesIO(dados)).size, (171, 256))
        self.assertNotEqual(cab2["ETag"], cab["ETag"])
        _, f = self.json(f"/api/info?caminho={quote(foto)}")
        self.assertEqual((f["largura"], f["altura"]), (800, 1200))

        status, r = self.girar(foto, 270)
        self.assertEqual((status, r["orientacao"]), (200, 1))
        _, dados = self.miniatura(foto, lado=256)[1:]
        self.assertEqual(Image.open(io.BytesIO(dados)).size, (256, 171))

    def test_girar_um_formato_sem_rotacao_sem_perda_responde_que_fica_na_tela(self):
        pasta = self.pasta("girar-gif", ["anima.gif"])
        gif = os.path.join(pasta, "anima.gif")
        status, r = self.girar(gif, 90)
        self.assertEqual((status, r.get("codigo")), (415, "so-na-tela"))
        with open(gif, "rb") as fh:
            self.assertEqual(fh.read(), b"x")

    def test_girar_recusa_o_que_nao_e_um_quarto_de_volta_ou_nao_e_arquivo(self):
        pasta = self.pasta("girar-recusas", ["a.jpg"])
        self.assertEqual(self.girar(os.path.join(pasta, "a.jpg"), 45)[0], 400)
        self.assertEqual(self.girar(os.path.join(pasta, "a.jpg"), "90")[0], 400)
        for caminho in (os.path.join(pasta, "sumiu.jpg"), pasta, "a.jpg"):
            self.assertEqual(self.girar(caminho, 90)[0], 404, caminho)
        status, _, _ = self.pedir("POST", "/api/girar", corpo=["não", "é", "objeto"])
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
