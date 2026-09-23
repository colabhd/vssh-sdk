"""O backend inteiro, de pé: o `main.py` como o `vssh-app-run` o sobe, pedido por HTTP.

Os outros arquivos medem as peças soltas. Este mede o que elas viram juntas sobre o runtime
`vssh`: a página que carrega o SDK e o Tuff, o portão de token, o `/saude`, e as rotas com um
arquivo de verdade no disco. O processo sobe com `--tcp 127.0.0.1:0` e lê a porta da linha que o
`servidor.escutar` imprime.

Sem o runtime `vssh` (nem no `PYTHONPATH`, nem em `runtime/python` deste checkout) o módulo se
pula; sem ffmpeg, só as rotas que dependem de mídia se pulam.
"""

import http.client
import importlib.util
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
TEM_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))

TOKEN = "token-de-bancada"

# O que um Chrome de mesa responde: abre MP4 e Matroska com H.264, não abre AVI.
PERFIL = {"containers": ["mp4", "webm", "matroska", "mp3", "flac", "wav", "ogg"],
          "video": ["h264", "vp9", "av1"], "audio": ["aac", "opus", "mp3", "flac"]}


def _ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", *args, "-y"],
                   check=True, capture_output=True, timeout=60)


@unittest.skipIf(SEM_RUNTIME, SEM_RUNTIME)
class TestBackendDePe(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="palco-backend-")
        cls.midia = os.path.join(cls.tmp, "Músicas e vídeos")
        os.makedirs(cls.midia)
        env = {**os.environ, "VSSH_APP_ID": "palco", "VSSH_APP_TOKEN": TOKEN,
               "VSSH_APP_DATA_DIR": os.path.join(cls.tmp, "dados"), "HOME": cls.tmp,
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

    def pedir(self, metodo, rota, corpo=None, token=TOKEN):
        con = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=60)
        cabecalhos = {"X-Vssh-App-Token": token} if token else {}
        dados = None
        if corpo is not None:
            dados = json.dumps(corpo).encode("utf-8")
            cabecalhos["Content-Type"] = "application/json"
        con.request(metodo, rota, body=dados, headers=cabecalhos)
        r = con.getresponse()
        resposta = (r.status, dict(r.getheaders()), r.read())
        con.close()
        return resposta

    def json(self, metodo, rota, corpo=None):
        status, _, dados = self.pedir(metodo, rota, corpo)
        return status, json.loads(dados.decode("utf-8"))

    # ── O que o runtime faz ──────────────────────────────────────────────────

    def test_a_pagina_carrega_o_SDK_o_Tuff_de_midia_e_o_app(self):
        # É o SDK servido que traz `vssh.app.ao('abertura')`: sem ele o arquivo que o gerenciador
        # de arquivos manda chega e ninguém o escuta.
        status, cab, dados = self.pedir("GET", "/")
        pagina = dados.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertIn("text/html", cab.get("Content-Type", ""))
        for tag in ('src="_sdk/vssh.js"', 'src="_sdk/tuff/tuff-midia.js"',
                    'href="_sdk/tuff/tuff-midia.css"', 'src="palco.js?v=', 'href="palco.css?v='):
            self.assertIn(tag, pagina)

    def test_sem_o_token_o_portao_recusa(self):
        status, cab, _ = self.pedir("GET", "/", token=None)
        self.assertEqual(status, 403)
        self.assertEqual(cab.get("X-Vssh-Token"), "recusado")

    def test_a_saude_responde_e_diz_a_gpu(self):
        status, corpo = self.json("GET", "/saude")
        self.assertEqual(status, 200)
        self.assertTrue(corpo["ok"])
        self.assertIn("gpu", corpo)

    def test_rota_desconhecida_e_404_em_JSON(self):
        status, corpo = self.json("GET", "/api/nada")
        self.assertEqual(status, 404)
        self.assertTrue(corpo["error"])

    def test_um_corpo_que_nenhuma_rota_le_nao_corrompe_o_pedido_SEGUINTE(self):
        # A conexão é keep-alive. Um POST com corpo numa rota que não o usa (o beacon da borda,
        # `/cdn-cgi/rum`) deixava os bytes no socket, e o pedido seguinte chegava com eles colados
        # na linha de método: a folha de estilo da página voltava 501.
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

    def test_um_caminho_que_nao_e_arquivo_e_recusado(self):
        for caminho in ("/dev/urandom", self.tmp, "relativo.mp4", None):
            status, _ = self.json("POST", "/api/abrir", {"caminho": caminho})
            self.assertEqual(status, 404, caminho)

    # ── Com mídia de verdade ─────────────────────────────────────────────────

    @unittest.skipUnless(TEM_FFMPEG, "sem ffmpeg/ffprobe neste ambiente")
    def test_o_avi_sai_pelo_cano_como_MP4_fragmentado_e_TERMINADO(self):
        avi = os.path.join(self.midia, "ep02.avi")
        _ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=3",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                "-c:v", "libx264", "-preset", "ultrafast", "-g", "300", "-sc_threshold", "0",
                "-c:a", "aac", avi)

        status, r = self.json("POST", "/api/abrir", {"caminho": avi, "perfil": PERFIL})
        self.assertEqual(status, 200)
        self.assertEqual(r["modo"], "remux", r["motivo"])
        self.assertTrue(r["temVideo"])
        self.assertAlmostEqual(r["duracao"], 3.0, delta=0.5)

        # O único quadro-chave da amostra é o primeiro: pedido em 1,5 s, o cano começa no zero.
        status, corte = self.json("GET", f"/api/corte?caminho={quote(avi)}&t=1.5")
        self.assertEqual((status, corte["inicio"]), (200, 0.0))

        rota = (f"/api/fluxo?caminho={quote(avi)}&t=1"
                f"&perfil={quote(json.dumps(PERFIL))}")
        # O `http.client` desenquadra o `chunked` e lança `IncompleteRead` quando o terminador não
        # vem: ler até o fim sem exceção é a prova de que o ffmpeg terminou bem.
        status, cab, corpo = self.pedir("GET", rota)
        self.assertEqual(status, 200)
        self.assertEqual(cab.get("Transfer-Encoding"), "chunked")
        self.assertEqual(cab.get("Accept-Ranges"), "none")
        self.assertEqual(corpo[4:8], b"ftyp")
        self.assertIn(b"moof", corpo)

    @unittest.skipUnless(TEM_FFMPEG, "sem ffmpeg/ffprobe neste ambiente")
    def test_o_arquivo_que_o_navegador_abre_NAO_passa_pelo_cano(self):
        mp4 = os.path.join(self.midia, "ep01.mp4")
        _ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
                "-c:v", "libx264", "-preset", "ultrafast", mp4)
        status, r = self.json("POST", "/api/abrir", {"caminho": mp4, "perfil": PERFIL})
        self.assertEqual((status, r["modo"]), (200, "direto"))
        status, _ = self.json("GET", f"/api/fluxo?caminho={quote(mp4)}"
                                     f"&perfil={quote(json.dumps(PERFIL))}")
        self.assertEqual(status, 409)

    @unittest.skipUnless(TEM_FFMPEG, "sem ffmpeg/ffprobe neste ambiente")
    def test_a_musica_traz_etiquetas_e_a_capa_sai_em_JPEG(self):
        mp3 = os.path.join(self.midia, "faixa 03.mp3")
        _ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=2",
                "-f", "lavfi", "-i", "color=c=teal:s=900x900:d=1",
                "-map", "0:a", "-map", "1:v", "-frames:v", "1",
                "-c:a", "libmp3lame", "-c:v", "png", "-disposition:v", "attached_pic",
                "-metadata", "title=Asa Branca", "-metadata", "artist=Luiz Gonzaga",
                "-metadata", "album=Asa Branca", mp3)

        status, r = self.json("POST", "/api/abrir", {"caminho": mp3, "perfil": PERFIL})
        self.assertEqual(status, 200)
        self.assertEqual((r["modo"], r["temVideo"], r["capa"]), ("direto", False, True))
        self.assertEqual(r["etiquetas"], {"titulo": "Asa Branca", "artista": "Luiz Gonzaga",
                                          "album": "Asa Branca"})

        status, cab, jpeg = self.pedir("GET", f"/api/capa?caminho={quote(mp3)}")
        self.assertEqual(status, 200)
        self.assertEqual(cab.get("Content-Type"), "image/jpeg")
        self.assertEqual(jpeg[:2], b"\xff\xd8")
        self.assertEqual(int(cab["Content-Length"]), len(jpeg))

        mp4 = os.path.join(self.midia, "sem-capa.mp4")
        _ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=1", "-c:a", "aac", mp4)
        status, _ = self.json("GET", f"/api/capa?caminho={quote(mp4)}")
        self.assertEqual(status, 404)

    def test_a_fila_da_pasta_vem_em_ordem_natural_e_so_com_midia(self):
        pasta = os.path.join(self.tmp, "serie")
        os.makedirs(pasta)
        for nome in ("ep10.mkv", "ep2.mkv", "ep1.mkv", "capa.jpg", "notas.txt"):
            with open(os.path.join(pasta, nome), "wb") as fh:
                fh.write(b"x")
        status, r = self.json("GET", f"/api/vizinhos?caminho={quote(os.path.join(pasta, 'ep2.mkv'))}")
        self.assertEqual(status, 200)
        self.assertEqual([i["nome"] for i in r["itens"]], ["ep1.mkv", "ep2.mkv", "ep10.mkv"])
        self.assertEqual(r["atual"], 1)

    def test_a_marca_aparece_em_recentes_e_esquecer_a_tira(self):
        filme = os.path.join(self.tmp, "filme longo.mkv")
        with open(filme, "wb") as fh:
            fh.write(b"x" * 128)
        status, _ = self.json("POST", "/api/marca", {"caminho": filme, "seg": 1800, "dur": 5400})
        self.assertEqual(status, 200)

        _, r = self.json("GET", "/api/recentes")
        self.assertIn({"caminho": filme, "seg": 1800, "dur": 5400, "nome": "filme longo.mkv",
                       "pasta": self.tmp}, r["itens"])
        _, aberto = self.json("POST", "/api/abrir", {"caminho": filme})
        self.assertEqual(aberto["retomarEm"], 1800)

        self.json("DELETE", f"/api/marca?caminho={quote(filme)}")
        _, r = self.json("GET", "/api/recentes")
        self.assertNotIn(filme, [i["caminho"] for i in r["itens"]])


if __name__ == "__main__":
    unittest.main()
