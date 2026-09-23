"""Como o cano é enquadrado: o `chunked` de uma resposta sem tamanho conhecido.

    enquadrar(dados)             um bloco `chunked`
    terminador(status, enviados) o fim do corpo, ou `b""` para deixá-lo INCOMPLETO

O arquivo que o navegador abre sozinho não passa por aqui: ele sai do portal por
`vssh.arquivos.urlFor`, com Range. O cano é o que o ffmpeg escreve nos modos remux, audio e
transcode, e ele não tem `Content-Length`, então quem diz onde o corpo acaba é o terminador
`0\\r\\n\\r\\n`.

⚠ **O terminador é condicional.** Escrito sempre, um ffmpeg morto no primeiro quadro produziria um
corpo bem formado e curto, igual byte a byte a um filme que acabou: o navegador dispararia `ended`
e o player avançaria para o próximo arquivo, sem a falha ter por onde chegar à tela. Um corpo
`chunked` incompleto é erro de rede para o navegador, `error` no `<video>`, e uma frase que a
pessoa pode ler.

Nada aqui abre socket nem lê disco.
"""

_TERMINADOR = b"0\r\n\r\n"


def enquadrar(dados):
    """Um bloco no enquadramento `chunked`. Bloco vazio não existe: ele É o terminador."""
    if not dados:
        return b""
    return b"%X\r\n" % len(dados) + bytes(dados) + b"\r\n"


def terminador(status, enviados):
    """O fim do corpo, ou `b""` quando a resposta tem de ficar incompleta de propósito.

    Duas condições, e a segunda não é redundante: um ffmpeg que sai com zero **sem escrever byte
    nenhum** também é falha. Ele acontece (entrada sem faixa mapeável, filtro que não casa), e um
    corpo vazio bem terminado é um vídeo de duração zero, que o navegador aceita em silêncio.
    """
    return _TERMINADOR if status == 0 and enviados > 0 else b""
