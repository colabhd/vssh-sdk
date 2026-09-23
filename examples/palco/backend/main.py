#!/usr/bin/env python3
"""Palco: o player de mídia do ambiente.

Toca o vídeo ou a música que a pessoa abriu, segue pela pasta em ordem, e lembra onde ela parou.

─── A decisão que manda no arquivo inteiro ──────────────────────────────────

⚠ **O backend não serve bytes quando não precisa.** `vssh.arquivos.urlFor(caminho)` devolve uma
URL do portal com Range: um arquivo que o navegador abre sozinho toca dali, com busca nativa e sem
CPU no servidor. O ffmpeg só entra quando o cliente diz que não dá conta, e quem diz é o cliente,
porque a resposta muda por máquina, por sistema e por versão do navegador. Por isso `/api/abrir`
recebe o perfil junto com o caminho e devolve o modo; um servidor que decidisse sozinho, por
tabela, transcodificaria a 180% de CPU para metade das máquinas.

─── As rotas ────────────────────────────────────────────────────────────────

    POST   /api/abrir      {caminho, perfil}       modo, duração, faixas, etiquetas, onde retomar
    GET    /api/fluxo      ?caminho=&t=&perfil=     o cano de MP4 fragmentado (só nos modos pagos)
    GET    /api/corte      ?caminho=&t=&adiante=    com que `t` pedir o cano, e onde ele começa
    GET    /api/legenda    ?caminho=&faixa=         uma legenda embutida, em VTT
    GET    /api/capa       ?caminho=                a capa embutida de uma música, em JPEG
    GET    /api/vizinhos   ?caminho=                os irmãos de pasta, para próximo e anterior
    GET    /api/recentes                            o que a pessoa deixou pela metade
    POST   /api/marca      {caminho, seg, dur}      onde a pessoa parou
    DELETE /api/marca      ?caminho=                esquecer

O endereço, o portão do `X-Vssh-App-Token` e o `/saude` são do runtime `vssh`, que o servidor tem
em `/opt/vssh/sdk/python` e o `vssh-app-run` põe no `PYTHONPATH`. O resto é biblioteca padrão e o
ffmpeg que o manifesto declara. Fora do servidor, `scripts/ambiente-de-dev.sh` do SDK aponta o
`PYTHONPATH` para `runtime/python`, e `python3 backend/main.py --tcp 127.0.0.1:0` sobe numa porta.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

_AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _AQUI)

from vssh import app, gpu, servidor, web  # noqa: E402

from decisao import decidir, perfil_de  # noqa: E402
from fluxo import enquadrar, terminador  # noqa: E402
from midia import (  # noqa: E402
    achar_gpu, argv_de_capa, argv_de_fluxo, argv_de_legenda, corte_para_frente, ponto_de_corte,
    sondar_arquivo,
)
from pasta import vizinhanca  # noqa: E402
from retomar import assinatura_de, esquecer, lembrar, recentes, retomada  # noqa: E402

DADOS = app.dados()
log = servidor.criar_log()

# O SDK web (`_sdk/vssh.js`) o `web.spa` injeta sozinho; a lista abaixo é o Tuff que o Palco usa,
# em ordem: as folhas antes das dele, e os scripts antes do `palco.js`. `tuff-midia` traz a
# `TuffMidia` (trilha, timecode, volume) e fica fora do padrão de propósito, porque um app de
# formulário não paga por ela. Nenhum destes arquivos viaja no pacote: o sistema os serve em
# `_sdk/tuff/`, dentro do espaço de URL do app.
spa = web.spa(
    os.path.join(_AQUI, "..", "frontend"),
    tuff=["tuff-tokens.css", web.TUFF_BASE, "tuff.css", "tuff-midia.css",
          web.TUFF_ICONES, "tuff-midia.js"],
    folhas=["palco.css"],
    scripts=["palco.js"],
    dica="O frontend do Palco não está no pacote.",
    ao_avisar=log,
)

# ── A GPU ────────────────────────────────────────────────────────────────────
#
# O manifesto pede `recursos.gpu` como opcional, e o lançador decide ao subir o app. Conceder não
# prova que a placa codifica vídeo, então `achar_gpu` testa cada candidata com meio segundo de
# codificação. O teste roda numa thread para o boot não esperar por ele: até a resposta chegar,
# um transcode vai pela CPU, que é o degrau que sempre existe.
_GPU = {"placa": None, "motivo": "medindo"}


def _medir_gpu():
    placa, motivo = achar_gpu(gpu.concedida())
    _GPU.update(placa=placa, motivo=motivo)
    log("gpu", {"placa": str(placa) if placa else None, "motivo": motivo})


threading.Thread(target=_medir_gpu, name="medir-gpu", daemon=True).start()


def _seguro(caminho):
    """Um caminho que este app aceita abrir, absoluto, ou `None`.

    ⚠ O confinamento aqui não protege o usuário dele mesmo: o backend roda como ele, que já lê os
    próprios arquivos por mil caminhos. Ele impede que um defeito do frontend vire um `ffmpeg`
    sobre `/dev/urandom` ou um socket, entradas que não terminam e travariam o app sem erro.
    """
    if not caminho or not isinstance(caminho, str):
        return None
    caminho = os.path.abspath(os.path.expanduser(caminho))
    try:
        if not os.path.isfile(caminho):
            return None
    except OSError:
        return None
    return caminho


def _instante(t):
    """Um instante vindo da URL (`12`, `8.333`), ou 0 quando não é um."""
    if t is None or not re.fullmatch(r"\d{1,6}(\.\d{1,6})?", str(t)):
        return 0
    return float(t)


def _faixa(f, com_canais=False):
    item = {"indice": f.indice, "codec": f.codec, "idioma": f.idioma, "titulo": f.titulo,
            "padrao": f.padrao}
    if com_canais:
        item["canais"] = f.canais
    return item


class Pedido(servidor.Pedido):

    def saude(self):
        placa = _GPU["placa"]
        return {**super().saude(), "gpu": str(placa) if placa else None,
                "gpuMotivo": _GPU["motivo"]}

    # ── plumbing ─────────────────────────────────────────────────────────────

    def _json(self, status, corpo):
        dados = json.dumps(corpo, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados)

    def _ler_corpo(self):
        """Os bytes do corpo, lidos sempre, e uma vez por pedido.

        ⚠ A conexão é keep-alive: um corpo que ninguém lê fica no socket, e o pedido seguinte
        chega com ele colado na frente da linha de método (`Unsupported method ('{"startTime"…
        GET')`). Um POST numa rota que não o usa (o beacon `/cdn-cgi/rum` da borda é um caso
        real) corromperia a página seguinte. Um corpo maior que o teto não é lido, e a conexão
        fecha depois da resposta.
        """
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = -1
        if tamanho == 0:
            return b""
        if tamanho < 0 or tamanho > 256 * 1024:
            self.close_connection = True
            return b""
        return self.rfile.read(tamanho)

    @staticmethod
    def _json_de(bruto):
        try:
            corpo = json.loads(bruto.decode("utf-8")) if bruto else {}
        except (ValueError, UnicodeDecodeError):
            return {}
        return corpo if isinstance(corpo, dict) else {}

    def _bombear(self, argv, relogio):
        """Roda um processo e escreve o stdout dele como blocos `chunked`.

        Devolve `(status, bytes_enviados, ms_do_primeiro, stderr, abortado)`. Separado de
        `_canalizar` para que a mesma resposta possa ser servida por um SEGUNDO processo quando o
        primeiro morre sem escrever nada (ver a alternativa sem GPU lá).
        """
        try:
            proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as e:
            log("ffmpeg-ausente", {"erro": str(e)})
            return None, 0, None, str(e), False

        # ⚠ O `stderr` é lido numa thread. Um cano de stderr cheio BLOQUEIA o ffmpeg: ele para de
        # escrever vídeo e o player congela sem nada aparecer em lugar nenhum.
        erros = []
        leitor = threading.Thread(target=lambda: erros.append(proc.stderr.read()), daemon=True)
        leitor.start()

        ms_primeiro = None
        enviados = 0
        abortado = False
        try:
            while True:
                # ⚠ `read1`, porque `read(65536)` num `BufferedReader` segura os bytes até juntar
                # os 65536 ou o processo morrer, e os primeiros quadros ficariam parados no buffer
                # do servidor. `read1` devolve o que já chegou.
                bloco = proc.stdout.read1(64 * 1024)
                if not bloco:
                    break
                if ms_primeiro is None:
                    ms_primeiro = int((time.monotonic() - relogio) * 1000)
                self.wfile.write(enquadrar(bloco))
                enviados += len(bloco)
        except OSError:
            # A pessoa buscou e o navegador abortou o pedido. O processo morre aqui: sem isso cada
            # arraste na linha do tempo deixaria um ffmpeg vivo mastigando o filme inteiro.
            abortado = True
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()

        # Esperar o leitor, com prazo: sem a espera, `erros` costuma estar vazio no instante em
        # que se lê, e o log da falha sairia sem a linha que diz o que o ffmpeg não conseguiu.
        leitor.join(timeout=2)
        saida = ((erros[0] if erros else b"") or b"").decode("utf-8", "replace")
        return proc.returncode, enviados, ms_primeiro, saida, abortado

    def _canalizar(self, argv, tipo, rotulo, alternativa=None):
        """Roda um processo e repassa o stdout dele como corpo da resposta.

        ⚠ **Sem `Content-Length` e sem Range.** Um cano não tem tamanho conhecido e não volta
        atrás, e `Accept-Ranges: none` é a resposta honesta. Por isso a busca neste modo é do lado
        do servidor: o frontend troca a fonte por `?t=<segundos>` e a `TuffMidia` recebe a régua
        verdadeira por `opcoes.tempo`. A codificação é `chunked`, e quem diz se o corpo terminou
        bem é o `terminador` (ver `fluxo.py`).

        `alternativa` é uma segunda linha de comando, tentada só quando a primeira morre sem ter
        escrito byte nenhum. É o que salva o transcode quando a GPU falha em uso (outro usuário
        segurando a placa, memória cheia): como nada foi enviado, o navegador recebe um corpo só.
        """
        if self.command == "HEAD":
            # Um corpo numa resposta a HEAD desalinha o enquadramento da conexão, e aqui custaria
            # um ffmpeg inteiro sobre o filme para bytes que ninguém lê.
            self.send_response(200)
            self.send_header("Content-Type", tipo)
            self.send_header("Accept-Ranges", "none")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return

        # A conferência vem antes dos cabeçalhos: depois de enviar `200 chunked` não há como
        # responder 503.
        if not shutil.which(argv[0]):
            log("ffmpeg-ausente", {"programa": argv[0]})
            self._json(503, {"error": f"{argv[0]} não está neste servidor"})
            return

        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Accept-Ranges", "none")
        self.send_header("Cache-Control", "no-store")
        # Sem isto a borda segura os primeiros blocos até fechar um buffer, e o vídeo demora a
        # começar por um motivo que não está no nosso código.
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        # Dois relógios no log: `ms_1o` (do `Popen` ao primeiro bloco) é o ffmpeg abrindo o
        # arquivo; `ms_tudo` (até o último) inclui o tempo em que `wfile.write` esperou o socket
        # esvaziar. Um ffmpeg que termina em 50 ms com `ms_tudo` em segundos diz que quem segura
        # os bytes está depois daqui: o portal, a rede ou o navegador.
        relogio = time.monotonic()
        status, enviados, ms_primeiro, saida, abortado = self._bombear(argv, relogio)

        if status not in (0, None) and enviados == 0 and alternativa:
            log("cano-alternativa", {"rotulo": rotulo, "status": status, "saida": saida[-400:]})
            status, enviados, ms_primeiro, saida, abortado = self._bombear(alternativa, relogio)

        self.close_connection = True
        tempos = {"ms_1o": ms_primeiro, "ms_tudo": int((time.monotonic() - relogio) * 1000)}
        if abortado:
            log("cano-abortado", {"rotulo": rotulo, "bytes": enviados, **tempos})
            return

        fim = terminador(status, enviados)
        if not fim:
            log("ffmpeg-erro", {"rotulo": rotulo, "status": status, "bytes": enviados, **tempos,
                                "saida": saida[-800:]})
        elif saida:
            # Saiu com zero e escreveu no stderr (avisos de timestamp, faixa ignorada): é o rastro
            # que se procura quando alguém diz "tocou torto".
            log("ffmpeg-avisou", {"rotulo": rotulo, "bytes": enviados, **tempos,
                                  "saida": saida[-800:]})
        else:
            log("cano", {"rotulo": rotulo, "bytes": enviados, **tempos})

        try:
            self.wfile.write(fim)
            self.wfile.flush()
        except OSError:
            log("cano-abortado", {"rotulo": rotulo, "bytes": enviados})

    # ── roteamento ───────────────────────────────────────────────────────────

    def atender(self, metodo):
        partes = urlsplit(self.path)
        rota = partes.path
        q = parse_qs(partes.query)
        um = lambda k: (q.get(k) or [None])[0]  # noqa: E731
        leitura = metodo in ("GET", "HEAD")

        try:
            bruto = self._ler_corpo()
            if rota == "/api/abrir" and metodo == "POST":
                return self._abrir(self._json_de(bruto))
            if rota == "/api/fluxo" and leitura:
                return self._fluxo(um("caminho"), um("t"), um("perfil"), um("audio"))
            if rota == "/api/corte" and leitura:
                return self._corte(um("caminho"), um("t"), um("adiante") == "1")
            if rota == "/api/legenda" and leitura:
                return self._legenda(um("caminho"), um("faixa"))
            if rota == "/api/capa" and leitura:
                return self._capa(um("caminho"))
            if rota == "/api/vizinhos" and leitura:
                return self._vizinhos(um("caminho"))
            if rota == "/api/recentes" and leitura:
                return self._recentes()
            if rota == "/api/marca" and metodo == "POST":
                return self._marcar(self._json_de(bruto))
            if rota == "/api/marca" and metodo == "DELETE":
                alvo = um("caminho")
                if alvo:
                    esquecer(DADOS, os.path.abspath(alvo))
                return self._json(200, {"ok": True})

            if spa(self):
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

    # ── as rotas ─────────────────────────────────────────────────────────────

    def _abrir(self, corpo):
        """Tudo que o frontend precisa saber para começar a tocar este arquivo."""
        caminho = _seguro(corpo.get("caminho"))
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})

        sonda = sondar_arquivo(caminho)
        d = decidir(sonda, perfil_de(corpo.get("perfil")))
        log("abrir", {"nome": os.path.basename(caminho), "modo": d.modo,
                      "container": sonda.container})

        return self._json(200, {
            "caminho": caminho,
            "nome": os.path.basename(caminho),
            "pasta": os.path.dirname(caminho),
            "duracao": sonda.duracao,
            "temVideo": sonda.video is not None,
            "largura": sonda.video.largura if sonda.video else None,
            "altura": sonda.video.altura if sonda.video else None,
            "modo": d.modo,
            "motivo": d.motivo,
            "faixaDeAudio": d.faixa_audio,
            "audios": [_faixa(f, com_canais=True) for f in sonda.audios],
            # Só as de TEXTO: PGS e VobSub são imagens, viram um VTT vazio sem erro, e uma escolha
            # que não aparece na tela ensina que o player não sabe mostrar legenda.
            "legendas": [_faixa(f) for f in sonda.legendas if f.e_texto],
            "etiquetas": sonda.etiquetas,
            "capa": sonda.capa is not None,
            "retomarEm": retomada(DADOS, caminho, assinatura=assinatura_de(caminho)),
        })

    def _fluxo(self, caminho, t, perfil_bruto, faixa_audio=None):
        caminho = _seguro(caminho)
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})

        try:
            perfil = perfil_de(json.loads(perfil_bruto)) if perfil_bruto else None
        except ValueError:
            perfil = None

        sonda = sondar_arquivo(caminho)
        d = decidir(sonda, perfil)

        # A faixa escolhida à mão vence a automática, se ela EXISTE neste arquivo: um índice
        # inventado viraria um `-map 0:99` que o ffmpeg recusa.
        if faixa_audio is not None and re.fullmatch(r"\d{1,3}", str(faixa_audio)):
            pedida = int(faixa_audio)
            escolhida = next((f for f in sonda.audios if f.indice == pedida), None)
            if escolhida is not None:
                d.faixa_audio = pedida
                # Trocar de faixa pode trocar de modo: sair de uma AAC para a AC3 original obriga a
                # recodificar o áudio, e manter `copiar` entregaria vídeo mudo. O codec vai junto
                # porque é ele que decide o filtro de bitstream do AAC em `midia.py`.
                toca = perfil and escolhida.codec in perfil.audio
                d.audio = "copiar" if toca else "recodificar"
                d.codec_audio = escolhida.codec
                if d.modo == "direto":
                    d.modo = "remux"
        inicio = _instante(t)
        placa = _GPU["placa"]
        argv = argv_de_fluxo(d, caminho, inicio=inicio, gpu=placa)
        if argv is None:
            # Modo direto: pedir o cano aqui é um defeito do frontend, e bytes esconderiam o
            # defeito atrás de CPU gasta em silêncio.
            return self._json(409, {"error": "este arquivo toca direto; use vssh.arquivos.urlFor",
                                     "modo": d.modo})
        # A mesma linha sem a placa, usada só se a primeira morrer sem escrever nada.
        cpu = argv_de_fluxo(d, caminho, inicio=inicio, gpu=None) if placa else None
        self._canalizar(argv, "video/mp4", f"fluxo:{os.path.basename(caminho)}", alternativa=cpu)

    def _corte(self, caminho, t, adiante):
        """Com que `t` pedir o cano, e onde ele começa de verdade (ver `midia.py`).

        `adiante` é uma busca para frente, que não pode voltar no tempo: ela vai ao quadro-chave
        seguinte quando o de antes do pedido fica muito para trás.
        """
        caminho = _seguro(caminho)
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})
        pedido = _instante(t)
        if pedido <= 0:
            return self._json(200, {"pedido": 0, "inicio": 0})
        if adiante:
            pedido, inicio = corte_para_frente(caminho, pedido)
        else:
            inicio = ponto_de_corte(caminho, pedido)
        return self._json(200, {"pedido": pedido, "inicio": inicio})

    def _legenda(self, caminho, faixa):
        caminho = _seguro(caminho)
        if not caminho or faixa is None or not re.fullmatch(r"\d{1,3}", str(faixa)):
            return self._json(400, {"error": "caminho ou faixa inválidos"})
        self._canalizar(argv_de_legenda(caminho, int(faixa)), "text/vtt; charset=utf-8",
                        f"legenda:{faixa}")

    def _capa(self, caminho):
        """A capa embutida, como uma imagem só; 404 quando o arquivo não tem uma.

        Um JPEG de capa tem dezenas de KB, e cabe na memória: a resposta sai com
        `Content-Length`, e o navegador a guarda por cinco minutos.
        """
        caminho = _seguro(caminho)
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})
        sonda = sondar_arquivo(caminho)
        if sonda.capa is None:
            return self._json(404, {"error": "este arquivo não tem capa"})
        try:
            p = subprocess.run(argv_de_capa(caminho, sonda.capa), capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError) as e:
            log("capa-erro", {"nome": os.path.basename(caminho), "erro": str(e)[:200]})
            return self._json(503, {"error": "não consegui ler a capa"})
        if p.returncode != 0 or not p.stdout:
            log("capa-erro", {"nome": os.path.basename(caminho), "status": p.returncode,
                              "saida": p.stderr.decode("utf-8", "replace")[-300:]})
            return self._json(404, {"error": "não consegui ler a capa"})
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(p.stdout)))
        self.send_header("Cache-Control", "private, max-age=300")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(p.stdout)

    def _vizinhos(self, caminho):
        """Os irmãos de pasta, em ordem natural: é o que faz "próximo" e "anterior" existirem."""
        caminho = _seguro(caminho)
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})
        diretorio = os.path.dirname(caminho)
        try:
            nomes = [n for n in os.listdir(diretorio)
                     if os.path.isfile(os.path.join(diretorio, n))]
        except OSError:
            nomes = []

        lista, atual = vizinhanca(nomes, os.path.basename(caminho))
        return self._json(200, {
            "pasta": diretorio,
            "itens": [{"nome": n, "caminho": os.path.join(diretorio, n)} for n in lista],
            "atual": atual,
        })

    def _recentes(self):
        itens = [{**r, "nome": os.path.basename(r["caminho"]),
                  "pasta": os.path.dirname(r["caminho"])} for r in recentes(DADOS)]
        return self._json(200, {"itens": itens})

    def _marcar(self, corpo):
        caminho = _seguro(corpo.get("caminho"))
        if not caminho:
            return self._json(404, {"error": "arquivo não encontrado"})
        lembrar(DADOS, caminho, corpo.get("seg") or 0, corpo.get("dur"),
                assinatura=assinatura_de(caminho))
        return self._json(200, {"ok": True})


def main():
    log("boot", {"appId": app.ident(), "versao": app.versao(),
                 "tokenExigido": bool(os.environ.get("VSSH_APP_TOKEN"))})
    return servidor.escutar(Pedido, sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
