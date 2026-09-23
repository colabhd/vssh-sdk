"""O manifesto contra o código.

O `vssh-app.json` é o que o ambiente lê para decidir o que mandar para a Lupa. Ele e o backend
descrevem os mesmos fatos por dois caminhos, e quando divergem nada falha: a janela abre, e o
arquivo não aparece na lista da pasta dela.
"""

import json
import os
import sys
import unittest
from xml.etree import ElementTree

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_AQUI, "..", "backend"))

from pasta import EXTENSOES  # noqa: E402

with open(os.path.join(_AQUI, "..", "vssh-app.json"), encoding="utf-8") as _fh:
    MANIFESTO = json.load(_fh)


class TestOQueOAmbienteVaiMandar(unittest.TestCase):
    def test_o_manifesto_e_o_codigo_abrem_as_MESMAS_extensoes(self):
        # Só no manifesto: o ambiente oferece a Lupa para o arquivo, e a lista da pasta o esconde.
        # Só no código: a Lupa mostra o formato, e ninguém chega nele pelo ambiente.
        do_manifesto = {"." + e.lstrip(".").lower() for e in MANIFESTO["opens"]["extensions"]}
        self.assertEqual(do_manifesto, EXTENSOES)

    def test_o_ponto_de_entrada_existe(self):
        # Um `entrypoint` errado instala limpo e falha no healthcheck, com "o app não subiu".
        alvo = os.path.join(_AQUI, "..", MANIFESTO["backend"]["entrypoint"])
        self.assertTrue(os.path.isfile(alvo), MANIFESTO["backend"]["entrypoint"])

    def test_o_icone_existe_e_ESCALA(self):
        # O ambiente desenha o ícone a 22px, 42px e 48px, e um SVG sem `viewBox` sai cortado em
        # dois desses lugares. Sem `<text>`, porque a fonte depende da máquina que renderiza.
        rel = MANIFESTO.get("icon")
        self.assertTrue(rel, "o manifesto não declara ícone")
        alvo = os.path.join(_AQUI, "..", rel)
        self.assertTrue(os.path.isfile(alvo), rel)
        raiz = ElementTree.parse(alvo).getroot()
        self.assertEqual(raiz.tag, "{http://www.w3.org/2000/svg}svg")
        self.assertEqual(raiz.get("viewBox"), "0 0 64 64")
        self.assertEqual([e.tag for e in raiz.iter() if e.tag.endswith("}text")], [])


if __name__ == "__main__":
    unittest.main()
