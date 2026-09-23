#!/usr/bin/env python3
"""Lupa: o visualizador de imagens e PDF do ambiente.

Mostra a imagem ou o PDF que a pessoa abriu e segue pela pasta, na ordem natural dos nomes.

─── Quem serve os bytes ─────────────────────────────────────────────────────

O backend não serve o arquivo aberto. `vssh.arquivos.urlFor(caminho)` devolve uma URL do portal,
com Range e ETag, e a página lê a imagem de lá, como o Palco faz com um vídeo. O que fica aqui é o
que a página não alcança sozinha. A lista da pasta é um caso: abrir um arquivo não concede a pasta
dele à página, então a listagem pela ponte seria recusada, e o backend, que roda como a pessoa,
lista. As miniaturas são o outro, porque reduzir uma foto de 12 MB no navegador exige baixá-la.

─── As rotas ────────────────────────────────────────────────────────────────

    GET  /api/vizinhos   ?caminho=               os irmãos de pasta, para anterior e próximo
    GET  /api/pasta      ?caminho=               uma pasta inteira, para a grade
    GET  /api/miniatura  ?caminho=&lado=&v=      uma miniatura, do cache ou gerada (`miniaturas.py`)
    GET  /api/info       ?caminho=               a ficha: tamanho, data, dimensões e o EXIF (`informacoes.py`)
    POST /api/girar      {caminho, graus}        gira um JPEG ou um PNG e grava, sem perda (`girar.py`)

O endereço, o portão do `X-Vssh-App-Token` e o `/saude` são do runtime `vssh`, que o servidor tem
em `/opt/vssh/sdk/python` e o `vssh-app-run` põe no `PYTHONPATH`. Fora do servidor,
`scripts/ambiente-de-dev.sh` do SDK aponta o `PYTHONPATH` para `runtime/python`, e
`python3 backend/main.py --tcp 127.0.0.1:0` sobe numa porta.
"""

import json
import os
import sys
import threading
from urllib.parse import parse_qs, urlsplit

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)

from vssh import app, servidor, web  # noqa: E402

import girar  # noqa: E402
import informacoes  # noqa: E402
import miniaturas  # noqa: E402
from pasta import vizinhanca  # noqa: E402

log = servidor.criar_log()

# Duas rotações do mesmo arquivo ao mesmo tempo leriam os mesmos bytes, e a segunda a gravar
# apagaria a primeira. Uma de cada vez basta: gravar uma rotação leva milissegundos num JPEG.
_girando = threading.Lock()

# O SDK web (`_sdk/vssh.js`) o `web.spa` injeta sozinho; a lista abaixo é o Tuff que a Lupa usa, na
# ordem de carga: as folhas antes da dela, e os scripts antes do `lupa.js`. `tuff-midia` traz o
# palco, a grade, a tira e o visor com zoom. Nenhum destes arquivos viaja no pacote: o sistema os
# serve em `_sdk/tuff/`, dentro do espaço de URL do app.
spa = web.spa(
    os.path.join(_AQUI, "..", "frontend"),
    tuff=["tuff-tokens.css", web.TUFF_BASE, "tuff.css", "tuff-midia.css",
          web.TUFF_ICONES, "tuff-midia.js"],
    folhas=["lupa.css"],
    scripts=["lupa.js"],
    dica="O frontend da Lupa não está no pacote.",
    ao_avisar=log,
)


def _seguro(caminho):
    """Um caminho absoluto de arquivo regular, ou `None`.

    O confinamento não protege a pessoa dela mesma, porque o backend roda como ela. Ele impede que
    um defeito do frontend faça o backend listar a pasta de um `/dev/urandom` ou de um caminho
    relativo ao diretório em que o processo subiu.
    """
    if not caminho or not isinstance(caminho, str) or not os.path.isabs(caminho):
        return None
    caminho = os.path.abspath(caminho)
    try:
        if not os.path.isfile(caminho):
            return None
    except OSError:
        return None
    return caminho


class Pedido(servidor.Pedido):

    def _json(self, status, corpo):
        dados = json.dumps(corpo, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados)

    def _descartar_corpo(self):
        """Lê e joga fora o corpo de um pedido que nenhuma rota usa.

        A conexão é keep-alive, e um corpo que ninguém lê fica no socket: o pedido seguinte chega
        com ele colado na frente da linha de método. O beacon `/cdn-cgi/rum` da borda é um POST
        com corpo que chega a todo app, e sem a leitura ele corromperia o pedido seguinte da
        página. Um corpo acima do teto não é lido, e a conexão fecha depois da resposta.
        """
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = -1
        if tamanho == 0:
            return
        if tamanho < 0 or tamanho > 256 * 1024:
            self.close_connection = True
            return
        self.rfile.read(tamanho)

    def _corpo_json(self):
        """O corpo JSON do pedido, ou `None` se ele não for um objeto JSON de até 16 KB."""
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = -1
        if tamanho < 0 or tamanho > 16 * 1024:
            self.close_connection = True
            return None
        try:
            corpo = json.loads(self.rfile.read(tamanho).decode("utf-8") or "null")
        except (UnicodeDecodeError, ValueError):
            return None
        return corpo if isinstance(corpo, dict) else None

    def atender(self, metodo):
        partes = urlsplit(self.path)
        rota = partes.path
        q = parse_qs(partes.query)
        um = lambda k: (q.get(k) or [None])[0]  # noqa: E731
        leitura = metodo in ("GET", "HEAD")

        try:
            if rota == "/api/girar" and metodo == "POST":
                return self._girar(self._corpo_json())
            self._descartar_corpo()
            if rota == "/api/vizinhos" and leitura:
                return self._vizinhos(um("caminho"))
            if rota == "/api/pasta" and leitura:
                return self._pasta(um("caminho"))
            if rota == "/api/miniatura" and leitura:
                return self._miniatura(um("caminho"), um("lado"), um("v"))
            if rota == "/api/info" and leitura:
                caminho = _seguro(um("caminho"))
                if not caminho:
                    return self._json(404, {"error": "arquivo não encontrado"})
                return self._json(200, informacoes.ficha(caminho))

            if leitura and spa(self):
                return
            self._json(404, {"error": "rota desconhecida"})

        except BrokenPipeError:
            pass
        except Exception as e:  # noqa: BLE001
            log("erro", {"path": rota, "erro": repr(e)})
            try:
                self._json(500, {"error": "falha interna"})
            except OSError:
                pass

    def _vizinhos(self, caminho):
        """Os irmãos de pasta, em ordem natural, com o índice do arquivo aberto."""
        caminho = _seguro(caminho)
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})
        return self._listar(os.path.dirname(caminho), os.path.basename(caminho))

    def _pasta(self, caminho):
        """Uma pasta inteira, para a Lupa aberta nela: a lista dos vizinhos, sem arquivo aberto."""
        if not caminho or not isinstance(caminho, str) or not os.path.isabs(caminho):
            return self._json(404, {"error": "pasta não encontrada"})
        caminho = os.path.abspath(caminho)
        if not os.path.isdir(caminho):
            return self._json(404, {"error": "pasta não encontrada"})
        return self._listar(caminho, None)

    def _listar(self, diretorio, atual_nome):
        # `scandir` responde "é arquivo?" pelo tipo que a própria listagem traz, sem um `stat` por
        # nome; o `stat` fica só para os que entram na lista, que precisam da data e do tamanho.
        try:
            with os.scandir(diretorio) as it:
                entradas = {e.name: e for e in it if e.is_file()}
        except OSError:
            entradas = {}

        lista, atual = vizinhanca(list(entradas), atual_nome)
        itens = []
        for n in lista:
            item = {"nome": n, "caminho": os.path.join(diretorio, n)}
            try:
                st = entradas[n].stat() if n in entradas else os.stat(item["caminho"])
                # A data vai à URL da miniatura (`v`): um arquivo girado e salvo ganha URL nova, e o
                # navegador não fica com a miniatura de antes no cache dele.
                item.update(modificado=int(st.st_mtime * 1000), tamanho=st.st_size)
            except OSError:
                pass
            itens.append(item)
        return self._json(200, {"pasta": diretorio, "itens": itens, "atual": atual})

    def _girar(self, corpo):
        """Gira o arquivo e responde a data e o tamanho novos, que a página põe na URL da miniatura.

        A miniatura em cache não precisa de quem a apague: a chave dela leva a data do arquivo, e
        a próxima pedida gera outra.
        """
        corpo = corpo or {}
        caminho = _seguro(corpo.get("caminho"))
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})
        graus = corpo.get("graus")
        if graus not in (90, 180, 270):
            return self._json(400, {"error": "graus: 90, 180 ou 270"})
        nome = os.path.basename(caminho)
        try:
            with _girando:
                feito = girar.girar(caminho, graus)
        except PermissionError:
            return self._json(403, {"error": f"{nome} é só de leitura", "codigo": "so-leitura"})
        except girar.NaoSabe as e:
            log("girar-recusado", {"nome": nome, "motivo": str(e)})
            return self._json(415, {"error": str(e), "codigo": "so-na-tela"})
        st = os.stat(caminho)
        log("girar", {"nome": nome, "graus": graus, **feito})
        return self._json(200, {**feito, "modificado": int(st.st_mtime * 1000), "tamanho": st.st_size})

    def _miniatura(self, caminho, lado, versao):
        caminho = _seguro(caminho)
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})
        if miniaturas.extensao(caminho) not in miniaturas.DO_SERVIDOR:
            # A página desenha este tipo sozinha: SVG e AVIF pelo próprio arquivo, TIFF e HEIC pela
            # miniatura que já vem dentro dele.
            return self._json(415, {"error": "a miniatura deste tipo é feita no navegador",
                                     "codigo": "no-navegador"})
        nome = os.path.basename(caminho)
        try:
            arquivo, tipo, etag = miniaturas.miniatura(
                caminho, lado, ao_gerar=lambda ms: log("miniatura", {"nome": nome, "ms": ms}))
        except miniaturas.SemFerramenta as e:
            log("miniatura-sem-ferramenta", {"falta": str(e)})
            return self._json(503, {"error": f"falta {e} no servidor"})
        except ValueError as e:
            log("miniatura-falhou", {"nome": nome, "erro": str(e)})
            return self._json(422, {"error": "não consegui reduzir este arquivo"})

        etag = f'"{etag}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        with open(arquivo, "rb") as fh:
            dados = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("ETag", etag)
        # Com `v` (a data do arquivo) na URL, ela muda quando o arquivo muda, e o navegador guarda a
        # miniatura por uma semana. Sem `v`, ele confere o ETag a cada vez.
        self.send_header("Cache-Control", "private, max-age=604800" if versao else "private, no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados)


def _podar():
    saiu = miniaturas.podar()
    if saiu:
        log("miniaturas-podadas", {"arquivos": saiu})


def main():
    log("boot", {"appId": app.ident(), "versao": app.versao(),
                 "tokenExigido": bool(os.environ.get("VSSH_APP_TOKEN"))})
    # A poda anda pelo cache inteiro, e o boot não espera por ela.
    threading.Thread(target=_podar, name="podar-miniaturas", daemon=True).start()
    return servidor.escutar(Pedido, sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
