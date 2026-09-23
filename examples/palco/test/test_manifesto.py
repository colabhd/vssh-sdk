"""O manifesto contra o código: as verdades que precisam continuar sendo uma.

O `vssh-app.json` é o que o ambiente lê para decidir o que mandar para cá. Ele e o backend
descrevem os mesmos fatos por dois caminhos que ninguém percorre junto, e quando divergem não há
erro nenhum, só uma janela que abre e não toca.
"""

import json
import os
import sys
import unittest

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_AQUI, "..", "backend"))

from pasta import EXTENSOES  # noqa: E402

with open(os.path.join(_AQUI, "..", "vssh-app.json"), encoding="utf-8") as _fh:
    MANIFESTO = json.load(_fh)


class TestOQueOAmbienteVaiMandar(unittest.TestCase):
    def test_o_manifesto_e_o_codigo_abrem_as_MESMAS_extensoes(self):
        # A divergência é silenciosa nos dois sentidos:
        #
        #   só no manifesto   o ambiente oferece o Palco no "Abrir com" de um `.wmv`, a janela abre,
        #                     e a fila da pasta não mostra o arquivo que está tocando;
        #   só no código      o Palco toca o formato e ninguém consegue chegar nele pelo ambiente.
        do_manifesto = {"." + e.lstrip(".").lower() for e in MANIFESTO["opens"]["extensions"]}
        self.assertEqual(do_manifesto, EXTENSOES)

    def test_o_ponto_de_entrada_existe(self):
        # Um `entrypoint` errado instala limpo e falha no healthcheck, com a mensagem "o app não
        # subiu", que não aponta para uma letra trocada num caminho.
        alvo = os.path.join(_AQUI, "..", MANIFESTO["backend"]["entrypoint"])
        self.assertTrue(os.path.isfile(alvo), MANIFESTO["backend"]["entrypoint"])

    def test_o_icone_existe_e_ESCALA(self):
        # Um `icon` apontando para arquivo que não existe publica limpo e o app aparece sem ícone.
        # E um SVG sem `viewBox` não escala: o ambiente o desenha a 22px, 42px e 48px, e sem a
        # caixa ele sai cortado em dois dos três lugares. Sem `<text>`, porque a fonte depende da
        # máquina que renderiza.
        rel = MANIFESTO.get("icon")
        self.assertTrue(rel, "o manifesto não declara ícone")
        alvo = os.path.join(_AQUI, "..", rel)
        self.assertTrue(os.path.isfile(alvo), rel)
        with open(alvo, encoding="utf-8") as fh:
            svg = fh.read()
        self.assertIn("viewBox", svg)
        self.assertNotIn("<text", svg)

    def test_o_ffmpeg_e_DECLARADO(self):
        # Sem ele no servidor, tudo que não seja o modo direto falha, e falha no meio de um vídeo.
        # `requiredPackages` move o erro para a instalação, onde ele se resolve.
        self.assertIn("ffmpeg", MANIFESTO.get("requiredPackages", []))


if __name__ == "__main__":
    unittest.main()
