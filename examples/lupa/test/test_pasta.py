"""A ordem dos irmãos de pasta.

`pasta.py` não importa o runtime `vssh`, então este arquivo roda em qualquer máquina, inclusive no
Python do Windows, onde o backend inteiro não sobe por socket unix.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from pasta import em_ordem, vizinhanca  # noqa: E402


class TestOrdem(unittest.TestCase):
    def test_IMG_10_vem_depois_de_IMG_2(self):
        nomes = ["IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg", "IMG_100.jpg", "IMG_20.jpg"]
        self.assertEqual(em_ordem(nomes),
                         ["IMG_1.jpg", "IMG_2.jpg", "IMG_10.jpg", "IMG_20.jpg", "IMG_100.jpg"])

    def test_maiuscula_nao_separa_a_pasta_em_duas(self):
        # Ordem por byte põe todo `Z` antes de todo `a`, e a lista aparece cortada ao meio.
        self.assertEqual(em_ordem(["banana.png", "Abacaxi.png", "cereja.png"]),
                         ["Abacaxi.png", "banana.png", "cereja.png"])

    def test_acento_nao_manda_o_nome_para_o_fim(self):
        # Pelo código do caractere, `ç` vem depois de `n` e `É` depois de `z`. O nome inteiro
        # desempata os dois que só diferem na caixa.
        self.assertEqual(em_ordem(["zebra.jpg", "Évora.jpg", "animação.gif", "ação.pdf", "Ação.pdf"]),
                         ["Ação.pdf", "ação.pdf", "animação.gif", "Évora.jpg", "zebra.jpg"])

    def test_a_extensao_em_maiuscula_da_camera_entra(self):
        # Câmeras e celulares gravam `IMG_0001.JPG` e `IMG_0002.HEIC`.
        self.assertEqual(em_ordem(["IMG_0002.HEIC", "IMG_0001.JPG", "Relatorio.PDF"]),
                         ["IMG_0001.JPG", "IMG_0002.HEIC", "Relatorio.PDF"])

    def test_imagem_e_pdf_entram_e_o_resto_fica_de_fora(self):
        nomes = ["foto.jpg", "scan.tiff", "manual.pdf", "video.mp4", "notas.txt", "planilha.xlsx"]
        self.assertEqual(em_ordem(nomes), ["foto.jpg", "manual.pdf", "scan.tiff"])

    def test_oculto_e_sem_extensao_ficam_de_fora(self):
        # `._IMG_0001.JPG` é o par AppleDouble que uma pasta copiada de um Mac traz para cada foto:
        # extensão de imagem, e nenhuma imagem dentro.
        self.assertEqual(em_ordem(["._IMG_0001.JPG", "IMG_0001.JPG", ".jpg", "semponto"]),
                         ["IMG_0001.JPG"])


class TestVizinhanca(unittest.TestCase):
    def test_o_indice_aponta_para_o_arquivo_aberto(self):
        lista, i = vizinhanca(["b.png", "a.png", "c.png", "notas.txt"], "b.png")
        self.assertEqual((lista, i), (["a.png", "b.png", "c.png"], 1))

    def test_o_aberto_ENTRA_na_lista_mesmo_quando_ela_o_deixaria_de_fora(self):
        # O ambiente pode ter mandado o arquivo pelo "Abrir com", e o nome pode ser oculto. Sem ele
        # na lista, o "próximo" partiria de lugar nenhum.
        for aberto in ("estranho.jfif", ".oculta.png"):
            lista, i = vizinhanca(["a.png", "b.png"], aberto)
            self.assertEqual(lista[i], aberto)
            self.assertEqual(len(lista), 3)

    def test_pasta_de_um_arquivo_so(self):
        self.assertEqual(vizinhanca(["unica.pdf"], "unica.pdf"), (["unica.pdf"], 0))


if __name__ == "__main__":
    unittest.main()
