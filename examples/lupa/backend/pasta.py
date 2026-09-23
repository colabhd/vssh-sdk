"""Os irmãos de pasta, que dão à Lupa o "anterior" e o "próximo".

Quem abre uma foto quer ver a seguinte sem voltar ao gerenciador de arquivos. Aqui entra uma lista
de nomes e sai a ordem; listar o diretório fica no chamador, que é a parte que depende do disco.
"""

import re

#: O que a Lupa abre. Esta lista e `opens.extensions` do manifesto dizem a mesma coisa, e
#: `test/test_manifesto.py` confere as duas: uma extensão só no manifesto põe a Lupa no "Abrir
#: com" de um arquivo que a lista da pasta esconde, e uma só aqui mostra na pasta um arquivo que o
#: ambiente nunca manda para cá.
EXTENSOES = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".ico", ".svg",
    ".tif", ".tiff", ".heic", ".heif",
    ".pdf",
}

_PEDACOS = re.compile(r"(\d+)")


def chave_natural(nome):
    """A ordem em que uma pessoa lê os nomes, com `IMG_2` antes de `IMG_10`.

    A ordem do byte compara `1` com `2` e põe `IMG_10` antes de `IMG_2`, e numa pasta de câmera a
    foto seguinte vira uma de outro dia. O `split` com grupo alterna texto e número sempre na
    mesma posição, então duas chaves nunca comparam `int` com `str`.
    """
    return [int(p) if p.isdigit() else p.lower() for p in _PEDACOS.split(nome)]


def extensao_serve(nome):
    ponto = nome.rfind(".")
    return ponto > 0 and nome[ponto:].lower() in EXTENSOES


def em_ordem(nomes):
    """Só o que a Lupa abre, sem os ocultos, na ordem natural.

    Os ocultos saem porque uma pasta copiada de um Mac traz um `._IMG_0001.JPG` para cada foto,
    com a extensão certa e sem imagem dentro: na lista, cada um seria uma tela de erro entre duas
    fotos.
    """
    return sorted((n for n in nomes if not n.startswith(".") and extensao_serve(n)),
                  key=chave_natural)


def vizinhanca(nomes, atual):
    """`(lista_em_ordem, indice_do_atual)`.

    O atual entra na lista mesmo quando `em_ordem` o deixaria de fora: o ambiente pode tê-lo
    mandado por MIME ou pelo "Abrir com", e o nome pode ser oculto. Sem ele na lista, o "próximo"
    partiria de lugar nenhum.
    """
    lista = em_ordem(nomes)
    if atual and atual not in lista:
        lista = sorted([*lista, atual], key=chave_natural)
    return lista, (lista.index(atual) if atual in lista else -1)
