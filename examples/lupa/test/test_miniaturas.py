"""A poda do cache de miniaturas.

A poda roda uma vez, no boot do backend, e por isso se mede aqui, chamando o módulo, com o cache
numa pasta temporária. O par que importa: pedir uma miniatura renova a data do arquivo no cache, e
a poda leva só o que ninguém pediu em 90 dias.
"""

import importlib.util
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import miniaturas  # noqa: E402

TEM_PIL = importlib.util.find_spec("PIL") is not None
NOVENTA_E_UM_DIAS = 91 * 86400


class TestPoda(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="lupa-poda-")
        self.pasta_original = miniaturas.PASTA
        miniaturas.PASTA = os.path.join(self.tmp, "cache")

    def tearDown(self):
        miniaturas.PASTA = self.pasta_original
        shutil.rmtree(self.tmp, ignore_errors=True)

    def envelhecer(self, caminho):
        antes = time.time() - NOVENTA_E_UM_DIAS
        os.utime(caminho, (antes, antes))

    @unittest.skipUnless(TEM_PIL, "sem o Pillow neste Python")
    def test_a_miniatura_pedida_fica_e_a_esquecida_sai(self):
        from PIL import Image
        fotos = []
        for nome in ("pedida.png", "esquecida.png"):
            p = os.path.join(self.tmp, nome)
            Image.new("RGB", (300, 200), (10, 120, 200)).save(p)
            fotos.append(p)
        pedida, _, _ = miniaturas.miniatura(fotos[0], 128)
        esquecida, _, _ = miniaturas.miniatura(fotos[1], 128)
        self.envelhecer(pedida)
        self.envelhecer(esquecida)

        # A pedida volta a ser pedida, e sai do cache sem gerar de novo.
        de_novo, _, _ = miniaturas.miniatura(fotos[0], 128)
        self.assertEqual(de_novo, pedida)

        self.assertEqual(miniaturas.podar(dias=90), 1)
        self.assertTrue(os.path.exists(pedida), "a poda levou a miniatura que acabou de ser pedida")
        self.assertFalse(os.path.exists(esquecida))

    def test_com_o_cache_vazio_ou_ausente_a_poda_nao_faz_nada(self):
        self.assertEqual(miniaturas.podar(dias=90), 0)


if __name__ == "__main__":
    unittest.main()
