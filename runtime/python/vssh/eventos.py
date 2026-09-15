"""
Eventos do backend para o frontend, por Server-Sent Events, e a difusão para quem assinou.

A receita do SSE tem um jeito cruel de falhar: sem os cabeçalhos certos, os eventos ficam presos
num buffer em algum ponto do caminho (o proxy do portal, o CDN na frente dele) e chegam em lote,
ou nunca. O app parece "não receber nada", e não há erro em lugar nenhum. `X-Accel-Buffering:
no` é o que impede a bufferização na borda, e é o cabeçalho que o portal usa nas rotas SSE dele.
O flush logo depois dos cabeçalhos é o que faz o `EventSource` do navegador disparar o `onopen`.

Duas peças:

    fluxo = eventos.abrir(pedido)          um stream sobre um pedido, para quem manda a um só
    difusor = eventos.Difusor()            um conjunto de assinantes, para quem publica a todos

    class Pedido(servidor.Pedido):
        def atender(self, metodo):
            if self.path.partition('?')[0] == '/eventos':
                difusor.atender(self)          # segura a thread até o cliente sair
                return
            ...

    difusor.publicar('progresso', {'feito': 3, 'total': 12})   # de qualquer thread

O `http.server` da stdlib atende um pedido por thread e só devolve a conexão quando o handler
retorna, e retornar fecha a conexão na hora. Um stream, portanto, segura a thread do pedido
dele: `Difusor.atender` e `Fluxo.esperar` fazem isso, e um `atender` que abrisse o stream e
retornasse veria o `EventSource` reconectar em laço, sem erro do lado do servidor.

O cliente que fecha a aba não avisa: o socket some. Toda escrita marca `fechado` em vez de
levantar, porque um `BrokenPipeError` estourando dentro de um `for` de difusão derrubaria o
envio para as outras janelas; e `esperar` observa o socket, para a saída do cliente ser notada
na hora, e não no próximo keepalive.

O fio é o do `EventSource`: `event: <nome>`, `data: <JSON>`, linha em branco. O JSON sai com
separadores compactos, que é o que o `JSON.stringify` do lado Node produz; um app emite os
mesmos bytes nos dois runtimes.
"""

import json
import select
import socket
import threading
import time

__all__ = ['Fluxo', 'abrir', 'Difusor']

_KEEPALIVE_MS = 15000


def _serializar(dados):
    if isinstance(dados, str):
        return dados
    return json.dumps(dados, ensure_ascii=False, default=str, separators=(',', ':'))


class Fluxo:
    """Um stream SSE aberto sobre um pedido (`servidor.Pedido` ou qualquer
    `BaseHTTPRequestHandler`). Os cabeçalhos saem no construtor."""

    def __init__(self, pedido, reconexao_ms=None, keepalive_ms=_KEEPALIVE_MS):
        self._pedido = pedido
        self._tranca = threading.Lock()
        self._timer = None
        self._ao_fechar = []
        self.fechado = False

        pedido.send_response(200)
        pedido.send_header('Content-Type', 'text/event-stream')
        pedido.send_header('Cache-Control', 'no-cache')
        # A resposta não tem tamanho nem vai em chunked: o fim dela é o fim da conexão, e o
        # cabeçalho diz isso ao cliente. É ele também que marca o `close_connection` do pedido,
        # para o servidor fechar o socket quando `esperar` retornar, em vez de tentar ler outro
        # pedido de um cliente que já foi embora.
        pedido.send_header('Connection', 'close')
        pedido.send_header('X-Accel-Buffering', 'no')
        for k, v in getattr(pedido, 'cabecalhos_fixos', {}).items():
            pedido.send_header(k, v)
        pedido.end_headers()
        self._descarregar()

        if reconexao_ms:
            self._escrever('retry: %d\n\n' % int(reconexao_ms))

        # Proxy e balanceador derrubam conexão ociosa. O comentário periódico é tráfego
        # suficiente para isso não acontecer, e o cliente o ignora. `daemon` porque um keepalive
        # não pode ser o motivo de o processo não encerrar.
        self._intervalo = (keepalive_ms or 0) / 1000.0
        if self._intervalo > 0:
            self._agendar()

    # ── interno ───────────────────────────────────────────────────────────────────────────

    def _descarregar(self):
        try:
            self._pedido.wfile.flush()
        except OSError:
            self._encerrar()

    def _escrever(self, texto):
        if self.fechado:
            return False
        with self._tranca:
            if self.fechado:
                return False
            try:
                self._pedido.wfile.write(texto.encode('utf-8'))
                self._pedido.wfile.flush()
                return True
            except OSError:
                self._encerrar()
                return False

    def _encerrar(self):
        """Marca o fim e avisa quem pediu (o difusor). Idempotente: o keepalive, o `esperar` e
        o próprio `fechar` podem descobrir o fim ao mesmo tempo."""
        if self.fechado:
            return
        self.fechado = True
        if self._timer:
            self._timer.cancel()
        for cb in self._ao_fechar:
            try:
                cb(self)
            except Exception:
                pass

    def _agendar(self):
        if self.fechado:
            return
        self._timer = threading.Timer(self._intervalo, self._bater)
        self._timer.daemon = True
        self._timer.start()

    def _bater(self):
        if self.fechado:
            return
        self.comentar()
        self._agendar()

    def _cliente_saiu(self, intervalo):
        """Observa o socket por até `intervalo` segundos. Um socket legível cujo `recv` devolve
        vazio é o cliente que fechou; sem `select` (um pedido de mentira, sem socket) resta
        dormir e deixar o keepalive descobrir."""
        conexao = getattr(self._pedido, 'connection', None)
        if not isinstance(conexao, socket.socket):
            time.sleep(intervalo)
            return False
        try:
            legivel, _, _ = select.select([conexao], [], [], intervalo)
            if not legivel:
                return False
            if conexao.recv(1, socket.MSG_PEEK) == b'':
                return True
        except (OSError, ValueError):
            return True
        # Bytes inesperados no fio (um cliente que fala num stream de saída). Ninguém os lê
        # daqui, e sem a pausa o `select` voltaria na hora, a cada volta.
        time.sleep(intervalo)
        return False

    # ── superfície ────────────────────────────────────────────────────────────────────────

    def enviar(self, evento, dados):
        """Um evento nomeado. `dados` vira JSON, a menos que já seja texto. Devolve `False`
        quando o cliente já foi embora."""
        return self._escrever('event: %s\ndata: %s\n\n' % (evento, _serializar(dados)))

    def comentar(self, texto=None):
        """Um comentário SSE: não vira evento no cliente, e mantém a conexão viva."""
        return self._escrever(': %s\n\n' % (texto or 'keep-alive'))

    def fechar(self):
        """Encerra do lado do servidor. `esperar` retorna, e o handler devolve a conexão."""
        self._encerrar()

    def esperar(self, intervalo=0.5):
        """Segura a thread do pedido enquanto o cliente estiver conectado, ou até `fechar`."""
        while not self.fechado:
            if self._cliente_saiu(intervalo):
                self._encerrar()

    def ao_fechar(self, cb):
        """Registra `cb(fluxo)` para o fim do stream, de qualquer origem."""
        self._ao_fechar.append(cb)


def abrir(pedido, reconexao_ms=None, keepalive_ms=_KEEPALIVE_MS):
    """Abre um stream SSE sobre um pedido. `reconexao_ms` é a dica de reconexão que o
    `EventSource` respeita; `keepalive_ms=0` desliga o comentário periódico."""
    return Fluxo(pedido, reconexao_ms=reconexao_ms, keepalive_ms=keepalive_ms)


class Difusor:
    """Os assinantes de um mesmo canal, e a publicação para todos eles de uma vez.

    `assinar(pedido)` abre o stream e o registra; `publicar(evento, dados)` escreve em todos os
    vivos e devolve quantos alcançou. Um assinante que sumiu sai do conjunto na primeira escrita
    que falha, ou antes, quando o `esperar` dele nota o socket fechado.
    """

    def __init__(self, reconexao_ms=None, keepalive_ms=_KEEPALIVE_MS):
        self._reconexao_ms = reconexao_ms
        self._keepalive_ms = keepalive_ms
        self._tranca = threading.Lock()
        self._fluxos = set()

    @property
    def assinantes(self):
        """Quantos streams estão registrados agora."""
        with self._tranca:
            return len(self._fluxos)

    def assinar(self, pedido):
        """Abre um stream sobre o pedido e o registra. Quem chama segura a thread com
        `esperar()`, ou usa `atender`, que faz as duas coisas."""
        fluxo = Fluxo(pedido, reconexao_ms=self._reconexao_ms, keepalive_ms=self._keepalive_ms)
        fluxo.ao_fechar(self._esquecer)
        with self._tranca:
            self._fluxos.add(fluxo)
        return fluxo

    def atender(self, pedido, ao_abrir=None):
        """Assina, chama `ao_abrir(fluxo)` (o lugar do estado inicial) e segura a thread até o
        cliente sair. É a forma de um `atender` do app responder à rota de eventos."""
        fluxo = self.assinar(pedido)
        if ao_abrir:
            ao_abrir(fluxo)
        fluxo.esperar()

    def publicar(self, evento, dados):
        """Manda o evento a todos os assinantes vivos. Devolve quantos o receberam."""
        with self._tranca:
            fluxos = list(self._fluxos)
        return sum(1 for f in fluxos if f.enviar(evento, dados))

    def fechar(self):
        """Encerra todos os streams; cada `esperar` retorna e o handler dele devolve a conexão."""
        with self._tranca:
            fluxos = list(self._fluxos)
        for f in fluxos:
            f.fechar()

    def _esquecer(self, fluxo):
        with self._tranca:
            self._fluxos.discard(fluxo)
