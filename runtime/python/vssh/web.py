"""
O frontend de um app: uma SPA servida de um diretório, com o SDK web e o Tuff no `<head>`.

Todo app com janela publica um diretório de arquivos estáticos e um `index.html`, e todo mundo
tropeça nas mesmas quatro coisas ao fazer isso à mão. Este módulo as resolve de uma vez:

  1. O SDK web. O sistema serve `_sdk/vssh.js` dentro do espaço de URL de todo app, e um app o
     alcança por esse caminho relativo à própria raiz. Por padrão a tag entra no `<head>` de
     todo index servido daqui; `tuff=True` acrescenta o ambiente visual (`_sdk/tuff/…`). Nada
     em `_sdk/` leva carimbo, porque os bytes são do portal, e nada em `_sdk/` é servido
     daqui, porque o portal responde antes de o pedido chegar ao backend.
  2. O carimbo de versão dos arquivos do próprio app. Um script injetado sai como
     `boot.js?v=<hash do conteúdo>` e é servido como imutável; conteúdo novo mora noutra URL, e
     nenhum cache no caminho (navegador, portal, CDN) consegue servir o velho no lugar do novo.
     O `index.html` sai `no-store`, e é ele que traz a URL nova. `Cache-Control` sozinho não
     bastava: basta um elo do caminho guardar a resposta e o navegador executa um script antigo
     com o arquivo em disco já certo.
  3. O `<base>` das rotas profundas. Uma SPA com roteamento HTML5 recebe o index em
     `/biblioteca/library`, e ali todo caminho relativo do HTML resolve contra essa rota:
     `<script src="app.js">` vira `/biblioteca/app.js`. O servidor injeta
     `<base href="../">` com a profundidade da rota, logo depois de `<head>`, e o preload
     scanner do navegador o vê antes de qualquer tag. Um `<base>` calculado por script inline
     chega tarde para o scanner, que já disparou os pedidos. Um `<base>` escrito pelo app manda.
  4. O confinamento. Um caminho só é servido se cair dentro da raiz depois de resolvido, e o
     caminho real é revalidado depois do `stat`, porque um symlink dentro do bundle apontando
     para fora passaria pela checagem lexical.

    from vssh import servidor, web

    spa = web.spa('frontend', tuff=True, rotas_profundas=True, scripts=['boot.js'])

    class Pedido(servidor.Pedido):
        def atender(self, metodo):
            if spa(self):
                return
            self.responder_json(404, {'error': 'Rota desconhecida.'})

`spa(...)` devolve `servir(pedido) -> bool`, e `False` quer dizer que o pedido não é desta SPA:
404 é decisão de quem compõe as rotas, e um handler que respondesse sozinho impediria o app de
tentar as próprias rotas depois dele.

O que fica de fora de propósito: reescrever caminho absoluto (`/static/…`) para relativo. Isso
é fato do bundle, resolvido no build; reescrever HTML a cada resposta esconderia o problema.
"""

import hashlib
import os
import re
import threading
from email.utils import formatdate, parsedate_to_datetime
from urllib.parse import parse_qs, unquote, urlsplit

from . import app as _app

__all__ = ['spa', 'tipo_de_conteudo', 'SDK', 'TUFF', 'TUFF_BASE', 'TUFF_ICONES', 'TUFF_MIDIA']

#: O SDK web, servido pelo sistema. Entra no `<head>` por padrão.
SDK = '_sdk/vssh.js'

#: O Tuff que `tuff=True` injeta: os valores, os componentes e o comportamento, na ordem em que
#: têm de carregar (os tokens declaram as variáveis que o resto lê).
TUFF = ['tuff-tokens.css', 'tuff.css', 'tuff.js']

#: O reset da página inteira (caixa, tipografia, foco). Fora de `TUFF` porque um bundle grande e
#: antigo traz o CSS dele inteiro, e um `box-sizing` global entrando por adoção parcial muda a
#: medida de todo elemento que não declara a própria caixa.
TUFF_BASE = 'tuff-base.css'

#: O sprite de ícones. Script, porque um `<use href="#ico-…">` só resolve dentro do próprio
#: documento, e o sprite do shell não atravessa o iframe.
TUFF_ICONES = 'tuff-icones.js'

#: As peças de mídia: trilha, volume, grade virtualizada, visor com zoom.
TUFF_MIDIA = ['tuff-midia.css', 'tuff-midia.js']

# O mapa é de bundle web (js, css, fonte, wasm). O de `dados` cobre o conteúdo que o usuário
# guarda; duplicar um mapa pequeno é o preço de as duas peças não dependerem uma da outra.
_TIPOS = {
    'html': 'text/html; charset=utf-8',
    # XHTML é o único jeito de pedir ao navegador o parser de XML, e há coisa que só funciona
    # nele (tag auto-fechada, namespace, entidade declarada). Servido como `octet-stream`, o
    # navegador baixa o arquivo em vez de renderizar, sem nada dizendo por quê.
    'xhtml': 'application/xhtml+xml; charset=utf-8',
    'xml': 'application/xml; charset=utf-8',
    'js': 'text/javascript; charset=utf-8',
    'mjs': 'text/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'json': 'application/json; charset=utf-8',
    'map': 'application/json; charset=utf-8',
    'wasm': 'application/wasm',
    'svg': 'image/svg+xml',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'eot': 'application/vnd.ms-fontobject',
    'txt': 'text/plain; charset=utf-8',
    'md': 'text/markdown; charset=utf-8',
    'pdf': 'application/pdf',
    'bin': 'application/octet-stream',
}

# Acima disto o carimbo sai de mtime e tamanho, e não do conteúdo: ler um wasm de 40 MB para
# carimbar custaria mais do que o problema resolve. É um carimbo pior (muda entre instalações
# da mesma versão, o que custa um download a mais), e nunca deixa de mudar quando o conteúdo
# muda, que é a propriedade da qual a correção depende.
_HASH_MAX_BYTES = 4 * 1024 * 1024

_IMUTAVEL = 'public, max-age=31536000, immutable'


def tipo_de_conteudo(caminho):
    """O `Content-Type` pela extensão; `application/octet-stream` para o que o mapa não tem."""
    _, _, ext = caminho.rpartition('.')
    return _TIPOS.get(ext.lower(), 'application/octet-stream')


def _real(caminho):
    """Canonicaliza. A raiz e o alvo passam pela mesma função, porque duas grafias do mesmo
    diretório nunca casam, e o sintoma é todo caminho aninhado virar 404 enquanto o index
    continua servindo (`/tmp` no macOS é symlink para `/private/tmp`; um deploy no idioma
    `current -> releases/N` cai no mesmo buraco)."""
    try:
        return os.path.realpath(caminho)
    except OSError:
        return os.path.abspath(caminho)


def _absoluto(caminho):
    """Um caminho relativo é relativo ao pacote do app (o diretório do `vssh-app.json`), e ao
    diretório corrente fora de um pacote. É o que faz `web.spa('frontend')` achar o mesmo
    diretório sob o `vssh-app-run` e numa bancada que sobe o app de outro lugar."""
    if os.path.isabs(caminho):
        return caminho
    return os.path.join(_app.raiz() or os.getcwd(), caminho)


def _mesma_data(recebida, nossa):
    """Compara `If-Modified-Since` sem exigir a mesma grafia: a data do cliente pode vir num
    formato equivalente, e comparar texto faria o 304 nunca acontecer."""
    if recebida == nossa:
        return True
    try:
        return parsedate_to_datetime(recebida) == parsedate_to_datetime(nossa)
    except (TypeError, ValueError):
        return False


class _Carimbador:
    """Hash do conteúdo, memoizado por (mtime, tamanho). `None` quando o arquivo não se lê."""

    def __init__(self, avisar):
        self._cache = {}
        self._tranca = threading.Lock()
        self._avisar = avisar

    def de(self, arquivo):
        try:
            st = os.stat(arquivo)
        except OSError:
            return None
        if not os.path.isfile(arquivo):
            return None
        chave = (st.st_mtime_ns, st.st_size)
        with self._tranca:
            achou = self._cache.get(arquivo)
            if achou and achou[0] == chave:
                return achou[1]
        if st.st_size > _HASH_MAX_BYTES:
            h = hashlib.sha1(('%d:%d' % (st.st_mtime_ns, st.st_size)).encode('utf-8')).hexdigest()[:12]
        else:
            try:
                with open(arquivo, 'rb') as fh:
                    h = hashlib.sha1(fh.read()).hexdigest()[:12]
            except OSError as err:
                self._avisar('carimbo-falhou', {'arquivo': arquivo, 'erro': str(err)})
                return None
        with self._tranca:
            self._cache[arquivo] = (chave, h)
        return h


def _lista_do_tuff(tuff):
    if tuff is True:
        return list(TUFF)
    if not tuff:
        return []
    if isinstance(tuff, str):
        tuff = [tuff]
    for nome in tuff:
        if '/' in nome or not (nome.endswith('.css') or nome.endswith('.js')):
            raise ValueError("tuff: '%s' não é um arquivo de _sdk/tuff/ (um nome, .css ou .js)." % nome)
    return list(tuff)


def spa(raiz, indice='index.html', scripts=None, folhas=None, montagens=None, apelidos=None,
        rotas_profundas=False, sdk=True, tuff=False, dica='', ao_avisar=None):
    """Devolve `servir(pedido) -> bool` para a SPA em `raiz`.

    `scripts` e `folhas` são caminhos do próprio app, relativos à raiz, injetados no `<head>`
    com o carimbo de conteúdo: as folhas como `<link rel="stylesheet">`, antes dos scripts,
    porque o `<link>` bloqueia a primeira pintura e descobri-lo cedo é o que evita um quadro
    sem estilo. `sdk=False` deixa o `_sdk/vssh.js` de fora, para o app que escreve a tag à mão.
    `tuff=True` injeta `TUFF`; uma lista nomeia os arquivos de `_sdk/tuff/` que entram, para
    quem quer também `TUFF_BASE`, `TUFF_ICONES` ou `TUFF_MIDIA`. Os do Tuff saem antes dos do
    app, e o SDK antes de qualquer script.

    `montagens` serve um prefixo de URL (com `/` nas duas pontas) de outro diretório, com o mesmo
    confinamento, o mesmo 304 e o mesmo carimbo do bundle. `apelidos` mapeia um prefixo em outro
    quando o caminho pedido não existe (`{'/static/': '/'}`, para um bundle que assume dois
    prefixos para os mesmos arquivos). A precedência é caminho direto, montagem, apelido: o app
    é dono da própria raiz, e o apelido é o palpite de último recurso.

    `rotas_profundas=True` serve o index em rota que não é arquivo nenhum, quando o pedido é de
    navegação (`Accept: text/html`, sem ponto no último segmento), com o `<base>` da
    profundidade. Um `fetch('/api/x')` que erra o caminho continua recebendo `False`, e não o
    index, senão o app faria `JSON.parse` de HTML longe da causa.

    `dica` é uma linha a mais na resposta de bundle ausente, dizendo como reconstruí-lo.
    `ao_avisar(evento, detalhe)` recebe o que a SPA não consegue resolver sozinha
    (`index-ausente`, `carimbo-falhou`); o `log` de `servidor.criar_log()` serve direto.
    """
    scripts_do_app = [str(s) for s in (scripts or [])]
    folhas_do_app = [str(f) for f in (folhas or [])]
    do_tuff = ['_sdk/tuff/' + n for n in _lista_do_tuff(tuff)]
    todas_as_folhas = [t for t in do_tuff if t.endswith('.css')] + folhas_do_app
    todos_os_scripts = ([SDK] if sdk else []) + [t for t in do_tuff if t.endswith('.js')] + scripts_do_app
    apelidos = list((apelidos or {}).items())
    avisar = ao_avisar or (lambda _evento, _detalhe: None)

    raiz = _real(_absoluto(raiz))

    montadas = []
    for prefixo, diretorio in (montagens or {}).items():
        if not (prefixo.startswith('/') and prefixo.endswith('/')):
            raise ValueError(
                "montagens: o prefixo '%s' precisa começar e terminar com '/'; sem isso, "
                "'/docsX' casaria com '/docs'." % prefixo)
        montadas.append((prefixo, _real(_absoluto(diretorio))))

    carimbador = _Carimbador(avisar)
    cache = {'chave': None, 'corpo': None, 'com_base': {}}
    tranca = threading.Lock()

    def arquivo_do_src(src):
        """O arquivo em disco de um `src` injetado, pela mesma precedência que serve o pedido."""
        rel = src.split('?')[0]
        caminho = rel if rel.startswith('/') else '/' + rel
        for prefixo, base in montadas:
            if caminho.startswith(prefixo):
                return os.path.join(base, caminho[len(prefixo):])
        return os.path.join(raiz, caminho.lstrip('/'))

    def carimbo(src):
        # O que é do sistema nunca leva carimbo: os bytes moram no portal, e um `?v=` aqui
        # afirmaria um conteúdo que este processo não tem como conhecer.
        if src.startswith('_sdk/'):
            return None
        return carimbador.de(arquivo_do_src(src))

    def url(src):
        v = carimbo(src)
        sep = '&' if '?' in src else '?'
        return ('%s%sv=%s' % (src, sep, v) if v else src).replace('"', '&quot;')

    def tags():
        # Sem `defer`: precisa executar antes dos scripts diferidos do bundle, que já esperam o
        # parse. As aspas duplas são escapadas porque interpolar em HTML sem escapar envelhece
        # mal, mesmo com o `src` vindo do app.
        #
        # O `<link>` sai auto-fechado: a barra é ignorada em HTML (`link` é void) e obrigatória
        # em XML. Sem ela, um index XHTML morre com erro fatal de parse no lugar do app.
        saida = ['<link rel="stylesheet" href="%s"/>' % url(f) for f in todas_as_folhas]
        saida += ['<script src="%s"></script>' % url(s) for s in todos_os_scripts]
        return '\n'.join(saida)

    def corpo_do_index():
        caminho = os.path.join(raiz, indice)
        st = os.stat(caminho)
        # Os carimbos entram na chave do cache, e não só no corpo: um script atualizado sem que
        # o index mude é o caso normal de uma reinstalação. Sem isto o processo continuaria
        # servindo a URL carimbada antiga até alguém tocar no index, e o carimbo teria virado
        # enfeite justamente no cenário que ele existe para cobrir. As folhas entram na chave
        # pelo mesmo motivo, e no caso delas uma cor velha parece decisão de design.
        chave = (st.st_mtime_ns, tuple((s, carimbo(s)) for s in todas_as_folhas + todos_os_scripts))
        with tranca:
            if cache['chave'] == chave:
                return cache['corpo']
        with open(caminho, 'r', encoding='utf-8') as fh:
            html = fh.read()
        if todas_as_folhas or todos_os_scripts:
            marcas = tags()
            if '</head>' in html:
                html = html.replace('</head>', marcas + '\n</head>', 1)
            else:
                html = marcas + html
        corpo = html.encode('utf-8')
        with tranca:
            cache['chave'] = chave
            cache['corpo'] = corpo
            # As variantes com `<base>` são montadas sobre este corpo, e caem junto: um index
            # recarregado que continuasse servindo a variante antiga daria HTML novo na raiz e
            # velho em toda rota profunda.
            cache['com_base'] = {}
        return corpo

    def index_com_base(corpo, caminho_url):
        """O index com um `<base>` que leva à raiz do app, para a rota profunda.

        O `href` é relativo e sobe a profundidade do diretório da rota, uma barra a menos que o
        caminho tem, porque a última componente é o "arquivo" e não conta: `/a/b` resolve a
        partir de `/a/`, um nível; `/a/b/c` a partir de `/a/b/`, dois. O cache é por
        profundidade, e não por rota: são dois ou três valores numa SPA inteira, e chavear por
        rota faria um mapa que cresce com o tráfego.
        """
        niveis = max(0, caminho_url.count('/') - 1)
        if not niveis:
            return corpo
        with tranca:
            pronto = cache['com_base'].get(niveis)
        if pronto is not None:
            return pronto
        html = corpo.decode('utf-8')
        saida = corpo
        # Um `<base>` escrito pelo app manda. Dois `<base href>` no mesmo documento não é erro,
        # o navegador usa o primeiro, e o nosso venceria calado.
        if not re.search(r'<base\s[^>]*href', html, re.I):
            marca = '<base href="%s"/>' % ('../' * niveis)
            # Logo depois de `<head>`, e nunca antes de `</head>`: o `<base>` só vale para as
            # URLs que vêm depois dele, e o preload scanner lê na ordem do documento.
            achou = re.search(r'<head[^>]*>', html, re.I)
            if achou:
                html = html[:achou.end()] + marca + html[achou.end():]
            else:
                html = marca + html   # sem `<head>` o navegador cria um implícito
            saida = html.encode('utf-8')
        with tranca:
            cache['com_base'][niveis] = saida
        return saida

    def stat_dentro(caminho_url, base=None):
        """Um caminho só é servido se cair dentro da base depois de resolvido, e o caminho real
        é revalidado depois do `stat`: um symlink dentro do bundle apontando para fora passaria
        pela checagem lexical."""
        base = raiz if base is None else base
        alvo = os.path.normpath(os.path.join(base, caminho_url.lstrip('/')))
        if alvo != base and not alvo.startswith(base + os.sep):
            return None
        try:
            st = os.stat(alvo)
        except OSError:
            return None
        if os.path.isdir(alvo):
            return None
        real = _real(alvo)
        if real != base and not real.startswith(base + os.sep):
            return None
        return alvo, st

    def resolver(caminho_url):
        direto = stat_dentro(caminho_url)
        if direto:
            return direto
        for prefixo, base in montadas:
            if caminho_url.startswith(prefixo):
                achado = stat_dentro(caminho_url[len(prefixo) - 1:], base)
                if achado:
                    return achado
        for prefixo, substituto in apelidos:
            if caminho_url.startswith(prefixo):
                achado = stat_dentro(substituto + caminho_url[len(prefixo):])
                if achado:
                    return achado
        return None

    def cabecalhos(pedido, status, tipo, tamanho, extras=None):
        pedido.send_response(status)
        pedido.send_header('Content-Type', tipo)
        pedido.send_header('Content-Length', str(tamanho))
        for k, v in getattr(pedido, 'cabecalhos_fixos', {}).items():
            pedido.send_header(k, v)
        for k, v in (extras or {}).items():
            pedido.send_header(k, v)
        if getattr(pedido, 'close_connection', False):
            pedido.send_header('Connection', 'close')
        pedido.end_headers()

    def mandar_texto(pedido, status, texto):
        corpo = texto.encode('utf-8')
        cabecalhos(pedido, status, _TIPOS['txt'], len(corpo))
        if pedido.command != 'HEAD':
            pedido.wfile.write(corpo)

    def mandar_index(pedido, caminho_url=None):
        """Serve o index; com `caminho_url`, com o `<base>` da profundidade dele. Só o caminho
        das rotas profundas passa o argumento: na raiz o relativo já resolve certo."""
        try:
            corpo = corpo_do_index()
            if caminho_url is not None:
                corpo = index_com_base(corpo, caminho_url)
        except OSError as err:
            avisar('index-ausente', {'raiz': raiz, 'erro': str(err)})
            mandar_texto(pedido, 500, 'Bundle não encontrado em %s.\n%s' % (raiz, dica + '\n' if dica else ''))
            return True
        # O tipo sai do nome do index: um `index.xhtml` servido como `text/html` carrega no
        # parser errado, e o sintoma aparece a três níveis de distância da causa.
        cabecalhos(pedido, 200, tipo_de_conteudo(indice), len(corpo), {'Cache-Control': 'no-store'})
        if pedido.command != 'HEAD':
            pedido.wfile.write(corpo)
        return True

    def servir(pedido):
        if pedido.command not in ('GET', 'HEAD'):
            return False
        partes = urlsplit(pedido.path)
        # `%` malformado faz o unquote devolver lixo em vez de levantar; o que importa é um
        # caminho inválido não virar 500 genérico no `except` de quem compõe as rotas.
        try:
            caminho_url = unquote(partes.path, errors='strict')
        except (UnicodeDecodeError, ValueError):
            mandar_texto(pedido, 400, 'Caminho inválido.\n')
            return True
        # O espaço `_sdk/` é do sistema, que o responde antes de o pedido chegar aqui. Um pedido
        # que chega é de uma hospedagem sem o portal na frente, e a resposta certa é a de quem
        # compõe as rotas, e nunca um arquivo do app com esse nome.
        if caminho_url.startswith('/_sdk/'):
            return False
        if caminho_url in ('/', '/' + indice):
            return mandar_index(pedido)

        achado = resolver(caminho_url)
        if not achado:
            aceita_html = 'text/html' in (pedido.headers.get('Accept') or '')
            ultimo = caminho_url[caminho_url.rfind('/') + 1:]
            if rotas_profundas and pedido.command != 'HEAD' and aceita_html and '.' not in ultimo:
                return mandar_index(pedido, caminho_url)
            return False

        alvo, st = achado
        # O `?v=` é conferido contra o hash de agora, e nunca aceito de boca: um carimbo velho,
        # de um index que sobreviveu em algum cache apesar do `no-store`, ganharia `immutable` e
        # fixaria os bytes errados por um ano.
        pedido_v = (parse_qs(partes.query).get('v') or [None])[0]
        imutavel = bool(pedido_v) and pedido_v == carimbador.de(alvo)

        ultima = formatdate(st.st_mtime, usegmt=True)
        ims = pedido.headers.get('If-Modified-Since')
        if not imutavel and ims and _mesma_data(ims, ultima):
            pedido.send_response(304)
            pedido.send_header('Last-Modified', ultima)
            pedido.send_header('Cache-Control', 'no-cache')
            for k, v in getattr(pedido, 'cabecalhos_fixos', {}).items():
                pedido.send_header(k, v)
            pedido.end_headers()
            return True

        cabecalhos(pedido, 200, tipo_de_conteudo(alvo), st.st_size, {
            'Last-Modified': ultima,
            # Com carimbo válido, conteúdo novo mora noutra URL, e esta pode ser cacheada para
            # sempre. Sem carimbo é bundle de nome fixo (`main.js`), e cache longo serviria a
            # versão velha depois de um upgrade: `no-cache` revalida, e o 304 resolve em zero
            # bytes.
            'Cache-Control': _IMUTAVEL if imutavel else 'no-cache',
        })
        if pedido.command != 'HEAD':
            with open(alvo, 'rb') as fh:
                # Em pedaços: um wasm de 40 MB lido de uma vez é 40 MB de RAM por pedido, e o
                # app tem um teto de memória declarado no manifesto.
                while True:
                    pedaco = fh.read(64 * 1024)
                    if not pedaco:
                        break
                    pedido.wfile.write(pedaco)
        return True

    return servir
