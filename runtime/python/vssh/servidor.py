"""
O servidor HTTP de um app de backend: onde ele escuta, quem ele atende, como ele se anuncia.

Todo app de backend faz as mesmas quatro coisas antes de fazer a dele, e cada uma tem uma
armadilha que só aparece num servidor de verdade:

  1. Escuta no socket unix de `$VSSH_APP_SOCKET` (`~/.vssh-apps/<id>/app.sock`). Uma porta TCP
     em loopback é alcançável por qualquer conta Linux da máquina; um socket num diretório 0700
     faz por permissão de arquivo o que a conferência de token só promete. O arquivo de socket
     sobrevive ao processo, então o `bind()` seguinte tropeça no inode de uma encarnação
     anterior, e o modo do arquivo vem do umask, então um umask frouxo cria o socket 0755.
  2. Atende só quem traz o `X-Vssh-App-Token` do portal. O socket já é 0600, mas outro processo
     do mesmo usuário o alcança, e um app que sabe apagar arquivos ou abrir um shell não pode
     falar com quem não se identifica. O 403 do portão leva `X-Vssh-Token: recusado`, e é esse
     marcador que o separa dos 403 da aplicação ("Permissão negada", "Senha incorreta"): um 403
     marcado diz que o pedido nem foi despachado, então quem chama reconcilia o token e repete
     sem repetir um efeito.
  3. Responde `GET /saude` com `{ok, versao, pid}`, mais o que o app acrescentar. É o healthcheck
     do manifesto e a sondagem do portal.
  4. Escreve no log com o nome do app na frente, para o `run.log` dizer quem falou.

O `--tcp host:porta` na linha de comando troca o socket por uma porta, e existe para a bancada:
o Python do Windows não tem `AF_UNIX`, e é de lá que os testes sobem o app.

    from vssh import servidor

    class Pedido(servidor.Pedido):
        def atender(self, metodo):
            ...  # o que é do app; o portão e o /saude já passaram

    sys.exit(servidor.escutar(Pedido, sys.argv[1:]))
"""

import http.server
import json
import os
import socket
import socketserver
import sys
import threading
from datetime import datetime, timezone

from . import app as _app

__all__ = [
    'Pedido', 'escutar', 'endereco_do_ambiente', 'limpar_socket_orfao', 'ErroDeEndereco',
    'registrar', 'criar_log',
]

SEM_ENDERECO = 'SEM_ENDERECO'
SERVIDOR_ANTIGO = 'SERVIDOR_ANTIGO'
JA_ESCUTANDO = 'JA_ESCUTANDO'


# ── O log ─────────────────────────────────────────────────────────────────────────────────────

def registrar(mensagem, nome=None):
    """Uma linha no stderr com o nome do app na frente. O `run.log` é de todos os processos do
    app, e a linha sem dono é a que ninguém consegue atribuir."""
    sys.stderr.write('[%s] %s\n' % (nome or _app.ident(), mensagem))
    sys.stderr.flush()


def criar_log(arquivo='app.log', stdout=True, env=None):
    """Devolve `log(evento, detalhe=None)`, que escreve NDJSON em `<dados>/<arquivo>`.

    O `run.log` do lifecycle é rotacionado a cada start; este sobrevive a reinício, mora no
    diretório de dados e é lido por máquina: uma linha por evento, com a operação e o caminho
    que falharam, que é o que um frame minificado no console do navegador nunca diz. O retorno
    carrega `.caminho`, porque a primeira pergunta de quem depura é onde ele está.
    """
    diretorio = _app.dados(env)
    caminho = os.path.join(diretorio, arquivo)
    # O `http.server` atende cada pedido numa thread, e duas falhas ao mesmo tempo escrevem ao
    # mesmo tempo; sem a tranca, uma linha entra no meio da outra justamente no incidente em que
    # há muitas falhas juntas.
    tranca = threading.Lock()
    estado = {'arquivo': None}

    def log(evento, detalhe=None):
        entrada = {
            'ts': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'event': evento,
        }
        if detalhe:
            entrada.update(detalhe)
        # `default=str` para um objeto que não serializa (um `Path`, uma exceção) virar texto em
        # vez de derrubar o log; separadores compactos porque é o que o lado Node escreve, e um
        # `grep` que funciona num tem de funcionar no outro.
        linha = json.dumps(entrada, ensure_ascii=False, default=str, separators=(',', ':')) + '\n'
        if stdout:
            sys.stdout.write(linha)
            sys.stdout.flush()
        with tranca:
            try:
                if estado['arquivo'] is None:
                    os.makedirs(diretorio, exist_ok=True)
                    estado['arquivo'] = open(caminho, 'a', encoding='utf-8')
                estado['arquivo'].write(linha)
                estado['arquivo'].flush()
            except OSError:
                pass  # se nem o log grava, seguir servindo vale mais que morrer pelo diagnóstico

    log.caminho = caminho
    return log


# ── O endereço ────────────────────────────────────────────────────────────────────────────────

class ErroDeEndereco(RuntimeError):
    """Falha ao descobrir ou tomar o endereço deste app. O `codigo` é contrato; a mensagem é
    para gente."""

    def __init__(self, mensagem, codigo):
        super().__init__(mensagem)
        self.codigo = codigo


def endereco_do_ambiente(env=None):
    """O caminho do socket que o lifecycle mandou (`VSSH_APP_SOCKET`).

    Um `VSSH_APP_PORT` presente e sozinho é um servidor cujo `vssh-app-run` é antigo demais, e a
    mensagem diz isso pelo nome: o conserto é no provisionamento, e procurá-lo dentro do app é o
    que custa a tarde de quem depura.
    """
    env = os.environ if env is None else env
    caminho = (env.get('VSSH_APP_SOCKET') or '').strip()
    if caminho:
        return caminho
    if (env.get('VSSH_APP_PORT') or '').strip():
        raise ErroDeEndereco(
            'Veio VSSH_APP_PORT, mas não VSSH_APP_SOCKET: o vssh-app-run deste servidor é antigo. '
            'O endereço de um app é um socket unix; atualize os binários de infra do servidor.',
            SERVIDOR_ANTIGO)
    raise ErroDeEndereco(
        'VSSH_APP_SOCKET não definido (ou use --tcp host:porta na bancada).', SEM_ENDERECO)


def limpar_socket_orfao(caminho):
    """Remove um socket que existe e que ninguém atende. Devolve `inexistente`, `vivo` ou
    `removido`.

    A checagem é uma tentativa de conexão, e nunca um `exists`: apagar pelo simples fato de o
    arquivo existir mataria a instância que está atendendo agora, e o sintoma ("o app reinicia
    sozinho quando alguém o abre duas vezes") não aponta para cá.
    """
    if not os.path.lexists(caminho):
        return 'inexistente'
    familia = getattr(socket, 'AF_UNIX', None)
    if familia is None:
        return 'inexistente'
    sonda = socket.socket(familia, socket.SOCK_STREAM)
    sonda.settimeout(2.0)
    try:
        sonda.connect(caminho)
        return 'vivo'
    except socket.timeout:
        return 'vivo'   # alguém aceitou e travou: de pé, só ocupado
    except OSError:
        try:
            os.unlink(caminho)
            return 'removido'
        except FileNotFoundError:
            return 'inexistente'
    finally:
        sonda.close()


# ── Os servidores ─────────────────────────────────────────────────────────────────────────────

class _Comum(socketserver.ThreadingMixIn):
    """Uma thread por conexão, e um cliente que some não vira traceback no `run.log`."""
    daemon_threads = True
    request_queue_size = 64

    def handle_error(self, request, client_address):
        # Fechar a aba no meio de um SSE, ou desistir de um download, é o gatilho mais comum e o
        # mais inocente. Qualquer outra exceção continua indo ao stderr com o traceback inteiro:
        # um defeito de verdade não aprende a se esconder atrás desta conveniência.
        erro = sys.exc_info()[1]
        if isinstance(erro, (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class _ServidorUnix(_Comum, socketserver.TCPServer):
    """HTTP sobre socket unix."""
    address_family = getattr(socket, 'AF_UNIX', None)   # inexistente no Python do Windows (bancada)
    allow_reuse_address = False

    def server_bind(self):
        caminho = self.server_address
        antigo = os.umask(0o077)
        try:
            self.socket.bind(caminho)
        finally:
            os.umask(antigo)
        # O diretório 0700 já protege; isto é a segunda defesa, para o dia em que ele mudar de
        # modo por outra razão.
        os.chmod(caminho, 0o600)

    def get_request(self):
        # Num `AF_UNIX` o endereço do par é a string vazia, e o `BaseHTTPRequestHandler` supõe
        # uma tupla `(host, porta)`: o `address_string()` da stdlib quebra dentro do tratamento
        # de um pedido que ia bem. A tupla diz o que há do outro lado, que é nada.
        conexao, _ = super().get_request()
        return conexao, ('socket-unix', 0)


class _ServidorTcp(_Comum, http.server.HTTPServer):
    """Só para a bancada: o Python do Windows não tem AF_UNIX."""
    allow_reuse_address = True


# ── O handler base ────────────────────────────────────────────────────────────────────────────

class Pedido(http.server.BaseHTTPRequestHandler):
    """HTTP/1.1 com keep-alive, log calado por pedido, o portão de token e o `/saude`.

    O app herda e implementa `atender(metodo)`; quando ele é chamado, o portão já passou e o
    `/saude` já foi respondido. `saude()` devolve o dicionário do healthcheck, e o app o estende
    com o que sabe de si (`sessoes`, `processos`). `cabecalhos_fixos` vai em toda resposta que
    esta classe monta, e `recusa` é a frase do 403 do portão.
    """
    protocol_version = 'HTTP/1.1'
    sys_version = ''
    server_version = 'vssh-app'
    cabecalhos_fixos = {}
    recusa = 'Sem autorização.'

    # Uma linha por pedido é ruído num log que ninguém lê; erro sai pelo `log_error`.
    def log_message(self, fmt, *args):
        pass

    def log_error(self, fmt, *args):
        registrar(fmt % args, getattr(self.server, 'nome', None))

    def do_GET(self):     self._receber('GET')
    def do_HEAD(self):    self._receber('HEAD')
    def do_POST(self):    self._receber('POST')
    def do_PUT(self):     self._receber('PUT')
    def do_DELETE(self):  self._receber('DELETE')

    # `token`, `nome` e `versao` são do servidor que `escutar` monta; um handler posto num
    # servidor montado à mão cai nos padrões do ambiente em vez de quebrar no primeiro pedido.
    def _receber(self, metodo):
        token = getattr(self.server, 'token', None)
        if token is None:
            token = os.environ.get('VSSH_APP_TOKEN', '')
        if token and self.headers.get('X-Vssh-App-Token', '') != token:
            self.responder_json(403, {'error': self.recusa}, {'X-Vssh-Token': 'recusado'})
            return
        if metodo == 'GET' and self.path.partition('?')[0] == '/saude':
            self.responder_json(200, self.saude())
            return
        self.atender(metodo)

    def saude(self):
        """O que o healthcheck responde. Estenda com o que este app sabe de si."""
        versao = getattr(self.server, 'versao', None) or _app.versao()
        return {'ok': True, 'versao': versao, 'pid': os.getpid()}

    def atender(self, metodo):
        """O que é do app. O padrão responde 404 a tudo."""
        self.responder_json(404, {'error': 'Rota desconhecida.'})

    def responder_json(self, status, obj, cabecalhos=None):
        corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        for k, v in self.cabecalhos_fixos.items():
            self.send_header(k, v)
        for k, v in (cabecalhos or {}).items():
            self.send_header(k, v)
        if self.close_connection:
            self.send_header('Connection', 'close')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(corpo)
        self.wfile.flush()


# ── Subir ─────────────────────────────────────────────────────────────────────────────────────

def _opcao(argv, nome):
    for i, a in enumerate(argv):
        if a == nome and i + 1 < len(argv):
            return argv[i + 1]
    return None


def escutar(pedido, argv=None, nome=None):
    """Sobe o servidor com o handler `pedido` e atende até o processo acabar.

    Devolve o código de saída: `0` no fim normal e também quando outra instância já atende no
    socket (o lifecycle lê `0` como "está de pé"); `2` quando não há onde escutar. A linha
    `[<nome>] versão <v> escutando em <onde>` no stdout é o que a bancada lê para descobrir a
    porta, e o que o `run.log` mostra de um app que subiu.
    """
    argv = sys.argv[1:] if argv is None else argv
    nome = nome or _app.ident()
    versao = _app.versao()

    tcp = _opcao(argv, '--tcp')
    if tcp:
        host, porta = tcp.rsplit(':', 1)
        srv = _ServidorTcp((host, int(porta)), pedido)
        onde = '%s:%d' % (host, srv.server_address[1])
    else:
        try:
            caminho = endereco_do_ambiente()
        except ErroDeEndereco as e:
            registrar(str(e), nome)
            return 2
        diretorio = os.path.dirname(caminho)
        if diretorio:
            os.makedirs(diretorio, mode=0o700, exist_ok=True)
        # O `vssh-app-run` já sondou o socket antes de subir; quem roda o app à mão chega aqui
        # direto, e a sondagem se repete porque custa nada e nunca derruba quem está atendendo.
        if limpar_socket_orfao(caminho) == 'vivo':
            registrar('já há um backend atendendo em %s.' % caminho, nome)
            return 0
        srv = _ServidorUnix(caminho, pedido)
        onde = caminho

    srv.nome = nome
    srv.versao = versao
    srv.token = os.environ.get('VSSH_APP_TOKEN', '')
    sys.stdout.write('[%s] versão %s escutando em %s\n' % (nome, versao, onde))
    sys.stdout.flush()
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0
