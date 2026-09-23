"""O enquadramento do cano: o `chunked` que o ffmpeg escreve, e o fim que só vem quando deu certo.

Nada aqui abre socket. O teste de ponta a ponta, com o backend de verdade servindo o cano, é o
`test_backend.py`.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from fluxo import enquadrar, terminador  # noqa: E402


class TestOCanoDizQuandoFalhou(unittest.TestCase):
    """Um corpo `chunked` sempre fechado faria um ffmpeg morto no primeiro quadro parecer um filme
    curto que acabou: o navegador dispararia `ended`, e o `ended` avançaria a pasta. O corpo
    incompleto é o único canal pelo qual a falha chega a quem está assistindo.
    """

    def test_saindo_bem_o_corpo_e_FECHADO(self):
        self.assertEqual(terminador(0, 4096), b"0\r\n\r\n")

    def test_saindo_MAL_o_corpo_fica_incompleto(self):
        # Um `chunked` sem terminador é erro de rede para o navegador, `error` no `<video>`, e uma
        # frase legível.
        for status in (1, 127, -9, 255):
            self.assertEqual(terminador(status, 4096), b"",
                             f"status {status} tinha de deixar o corpo incompleto")

    def test_zero_byte_com_status_zero_TAMBEM_e_falha(self):
        # Um ffmpeg pode sair com zero sem escrever nada (entrada sem faixa mapeável, filtro que
        # não casa). Um corpo vazio bem terminado é um vídeo de duração zero, que o navegador
        # aceita em silêncio.
        self.assertEqual(terminador(0, 0), b"")

    def test_o_bloco_declara_o_tamanho_em_HEXA(self):
        # O enquadramento `chunked` é em base 16, e escrevê-lo em decimal produz um corpo que só
        # quebra em blocos maiores que nove bytes, ou seja, passa em qualquer teste pequeno demais.
        self.assertEqual(enquadrar(b"x" * 255), b"FF\r\n" + b"x" * 255 + b"\r\n")
        self.assertEqual(enquadrar(b"abc"), b"3\r\nabc\r\n")

    def test_bloco_vazio_nao_e_escrito(self):
        # `0\r\n\r\n` é o terminador. Um bloco de tamanho zero no meio do corpo encerraria a
        # resposta ali, entregando meio filme com cara de filme inteiro.
        self.assertEqual(enquadrar(b""), b"")

    def test_o_corpo_completo_remonta_os_bytes(self):
        dados = bytes(i % 251 for i in range(5000))
        corpo = b"".join(enquadrar(dados[i:i + 1024]) for i in range(0, len(dados), 1024))
        corpo += terminador(0, len(dados))
        # Desenquadrar de volta é a única asserção que pega um `\r\n` a mais ou a menos.
        fora, resto = bytearray(), corpo
        while True:
            cabeca, _, resto = resto.partition(b"\r\n")
            n = int(cabeca, 16)
            if n == 0:
                break
            fora += resto[:n]
            resto = resto[n + 2:]
        self.assertEqual(bytes(fora), dados)


if __name__ == "__main__":
    unittest.main()
