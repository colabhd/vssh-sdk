"""
O filesystem privado do app, confinado ao diretório de dados, e as rotas que o frontend chama.

`app.dados()` diz onde o app guarda o que não pode perder; este módulo faz desse diretório um
filesystem que o frontend alcança por HTTP: ler, escrever, listar, renomear, copiar, remover
(para uma lixeira, por padrão), e servir binário com `Range`. Toda entrada vinda do frontend
passa por um portão de caminho que resolve o ancestral existente mais próximo com `realpath` e
recusa o que sair da raiz: `..`, caminho absoluto de fora, e symlink dentro da raiz apontando
para fora, inclusive quando o arquivo final ainda não existe (o caso da escrita). A listagem
descarta symlinks, então um link para fora não vaza nem por leitura.

O backend roda como o próprio usuário Linux, e não há privilégio a proteger dele mesmo. O que
o portão evita é um defeito de caminho do frontend virar escrita fora da raiz, e um symlink na
raiz virar caminho de escrita arbitrário para outro processo que fale com este socket. Quem
chega ao socket já passou pelo portão de token do `servidor`, e por isso as rotas daqui não têm
um segundo.

    from vssh import dados, servidor

    arquivos = dados.rotas(dados.abrir())

    class Pedido(servidor.Pedido):
        def atender(self, metodo):
            if arquivos(self):
                return
            ...

`abrir()` devolve as operações (`Dados`), para o backend usar direto; `rotas(...)` devolve
`servir(pedido) -> bool`, com `False` querendo dizer que o pedido não é destas rotas.

── O contrato de wire ────────────────────────────────────────────────────────────────────────

É o do toolkit de apps (`vssh-app-fs`), sem mudança: um frontend escrito contra ele fala com
este backend em Python ou em Node sem tocar numa linha.

    POST <prefixo>                        {"op": …, …}  ->  {"ok": true, "result": …}
    POST <prefixo>/write-binary?path=…    corpo cru     ->  o mesmo de `write-file`
    GET  <arquivos><caminho>              o arquivo, com `Content-Type`, `Last-Modified`,
                                          `Accept-Ranges` e um intervalo de `Range`

    op            parâmetros        result
    exists        path              {exists}            200 nos dois casos
    stat          path              {type, size, mtime}
    read-file     path              {content}
    write-file    path, content     {path, size, mtime}
    mkdir         path              {}                  já existir não é erro
    mkdir-recur   path              {}
    readdir       path              [path]              recursivo, sem ocultos, sem filtro
    unlink        path              {recycled}          move para a lixeira; `recycle: false` apaga
    rename        from, to          {}
    copy          from, to          {}                  sobrescreve
    open-dir      path              {path, files: [{path, content, size, mtime, type}]}
    get-files     path              idem

`path` pode ser relativo à raiz ou absoluto dentro dela; `mtime` é epoch em milissegundos.
Erro é `{"ok": false, "error": {code, message, op}}`, com o status pelo código: `ENOENT` 404,
`EACCES` e `EPERM` 403, `EINVAL` e os errnos de caminho impossível (`EISDIR`, `ENOTDIR`,
`ENAMETOOLONG`, `ELOOP`) 400, `EEXIST` 409, método errado 405. 500 fica para o que é defeito do
servidor (`ENOSPC`, `EIO`, `EMFILE`, erro de programação), e essa fronteira é deliberada: um
caminho apagado respondido como 500 faria o monitoramento acordar alguém por um clique.

`exists` e `stat` respondem sobre um caminho ausente de propósito de jeitos diferentes: `stat`
pede metadados, e sem o arquivo não há resposta (404); `exists` pergunta, e a ausência é a
resposta (200). Sem a segunda, quem só quer saber se o arquivo está lá usa o erro da primeira
como fluxo de controle, e toda sondagem de rotina vira linha vermelha nos dois lados. Fora da
raiz, `exists` continua sendo `EACCES`: responder `false` já contaria que o portão foi olhar.

Arquivo acima de `max_bytes` é omitido de `open-dir`/`get-files`, e continua legível por
`read-file`. Listá-lo com conteúdo vazio seria pior: para o app ele pareceria vazio, e o
primeiro save por cima apagaria o conteúdo real.
"""

import errno
import json
import os
import re
import shutil
from email.utils import formatdate
from urllib.parse import parse_qs, unquote, urlsplit

from . import app as _app

__all__ = [
    'abrir', 'rotas', 'Dados', 'ErroDeDados', 'tipo_de_conteudo',
    'ENOENT', 'EACCES', 'EINVAL', 'EEXIST',
    'EXTENSOES', 'IGNORADOS', 'LIXEIRA', 'MAX_BYTES', 'MAX_CORPO',
]

# Erros com nome estável, para o transporte mapear em status sem casar frase.
ENOENT = 'ENOENT'
EACCES = 'EACCES'
EINVAL = 'EINVAL'
EEXIST = 'EEXIST'

# O errno traduzido em status. O que fica de fora cai em 500 de propósito: 500 quer dizer "o
# servidor não sabe o que aconteceu", e a distinção só serve se a lista do que ele sabe for
# honesta. `ENOSPC`, `EIO`, `EMFILE`, `EROFS` e erro de programação continuam em 500.
_STATUS = {
    ENOENT: 404,
    EACCES: 403, 'EPERM': 403,
    EINVAL: 400, 'EISDIR': 400, 'ENOTDIR': 400, 'ENAMETOOLONG': 400, 'ELOOP': 400,
    EEXIST: 409,
    'EMETHOD': 405,
}

#: Extensões cujo conteúdo entra em `open-dir`/`get-files`: texto que um app quer ler inteiro.
EXTENSOES = ['txt', 'md', 'markdown', 'json', 'csv', 'yml', 'yaml', 'html', 'css', 'js', 'xml']

#: O que fica fora das listagens filtradas. `ocultos` é qualquer componente que começa com `.`.
IGNORADOS = {
    'prefixos': [],
    'exatos': [],
    'pastas': ['node_modules', '.git'],
    'sufixos': ['.DS_Store'],
    'ocultos': True,
}

#: Para onde `remover` leva o que remove, relativo à raiz. Oculta, então fora das listagens.
LIXEIRA = '.lixeira'

#: Acima disto o arquivo fica fora de `open-dir`.
MAX_BYTES = 16 * 1024 * 1024

#: O teto do corpo de um pedido às rotas.
MAX_CORPO = 64 * 1024 * 1024

# O mapa é do conteúdo que o usuário guarda (imagem, PDF, áudio); o de `web` cobre bundle.
_TIPOS = {
    'md': 'text/markdown; charset=utf-8', 'txt': 'text/plain; charset=utf-8',
    'json': 'application/json; charset=utf-8', 'csv': 'text/csv; charset=utf-8',
    'html': 'text/html; charset=utf-8', 'css': 'text/css; charset=utf-8',
    'js': 'text/javascript; charset=utf-8', 'xml': 'application/xml; charset=utf-8',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
    'webp': 'image/webp', 'avif': 'image/avif', 'svg': 'image/svg+xml', 'ico': 'image/x-icon',
    'bmp': 'image/bmp', 'pdf': 'application/pdf',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4',
    'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
    'zip': 'application/zip',
}


def tipo_de_conteudo(caminho):
    """O `Content-Type` pela extensão; `application/octet-stream` para o que o mapa não tem."""
    _, _, ext = caminho.rpartition('.')
    return _TIPOS.get(ext.lower(), 'application/octet-stream')


class ErroDeDados(Exception):
    """Uma recusa com código estável (`ENOENT`, `EACCES`, `EINVAL`, `EEXIST`). A mensagem é
    para gente; o código é o que vira status."""

    def __init__(self, codigo, mensagem):
        super().__init__(mensagem)
        self.codigo = codigo


def _nao_encontrado(p):
    return ErroDeDados(ENOENT, 'não encontrado: %s' % p)


def _fora_da_raiz(p):
    return ErroDeDados(EACCES, 'caminho fora da raiz: %s' % p)


# ── O portão de caminho ───────────────────────────────────────────────────────────────────────

def _dentro_de(raiz, candidato):
    return candidato == raiz or candidato.startswith(raiz + os.sep)


def _real_do_ancestral_existente(alvo):
    """O `realpath` do ancestral existente mais próximo, e os componentes que faltam abaixo
    dele. É o que valida o destino de uma escrita cujo arquivo (às vezes o diretório pai) ainda
    não existe, resolvendo os symlinks dos diretórios que existem."""
    atual = os.path.abspath(alvo)
    faltando = []
    while True:
        if os.path.lexists(atual):
            return os.path.realpath(atual), list(reversed(faltando))
        pai = os.path.dirname(atual)
        if pai == atual:
            return atual, list(reversed(faltando))
        faltando.append(os.path.basename(atual))
        atual = pai


def _resolver(raiz_real, entrada):
    """Resolve um caminho recebido do cliente contra a raiz: relativo a ela ou absoluto dentro
    dela. Devolve `(absoluto, relativo)` com o absoluto já resolvido e dentro da raiz."""
    if not isinstance(entrada, str) or entrada == '':
        raise ErroDeDados(EINVAL, 'caminho ausente')
    if '\0' in entrada:
        raise ErroDeDados(EINVAL, 'caminho com byte nulo')
    junto = os.path.normpath(entrada) if os.path.isabs(entrada) else os.path.join(raiz_real, entrada)
    # A recusa lexical vem antes de tocar o disco.
    if not _dentro_de(raiz_real, os.path.normpath(junto)):
        raise _fora_da_raiz(entrada)
    real, faltando = _real_do_ancestral_existente(junto)
    # `real` é a parte que existe, com symlinks resolvidos. Fora da raiz, um symlink de dentro
    # aponta para fora.
    if not _dentro_de(raiz_real, real):
        raise _fora_da_raiz(entrada)
    absoluto = os.path.join(real, *faltando) if faltando else real
    if not _dentro_de(raiz_real, absoluto):
        raise _fora_da_raiz(entrada)
    rel = '' if absoluto == raiz_real else os.path.relpath(absoluto, raiz_real)
    return absoluto, rel


def _ext(p):
    _, _, ext = p.rpartition('.')
    return ext.lower() if '.' in os.path.basename(p) else ''


def _tem_componente_oculto(rel):
    return any(len(parte) > 1 and parte.startswith('.') and parte != '..' for parte in rel.split('/'))


def _ignorador(ignorar):
    cfg = dict(IGNORADOS)
    cfg.update(ignorar or {})

    def ignorado(rel):
        p = rel.replace(os.sep, '/')
        partes = [x for x in p.split('/') if x]
        if any(p == x or p.startswith(x + '/') for x in cfg['prefixos']):
            return True
        if p in cfg['exatos']:
            return True
        if any(parte in cfg['pastas'] for parte in partes[:-1]):
            return True
        if any(p.endswith(x) for x in cfg['sufixos']):
            return True
        return False

    ignorado.cfg = cfg
    return ignorado


def _info(st, caminho):
    return {
        'type': 'directory' if os.path.isdir(caminho) else 'file',
        'size': st.st_size,
        # Epoch em milissegundos, como o resto do contrato. Segundos fariam toda comparação de
        # mtime com o frontend errar por três ordens de grandeza.
        'mtime': int(st.st_mtime * 1000),
    }


# ── As operações ──────────────────────────────────────────────────────────────────────────────

class Dados:
    """As operações confinadas a `raiz`. Toda entrada de caminho passa pelo portão; o que sai
    dele levanta `ErroDeDados`."""

    def __init__(self, raiz, extensoes=None, ignorar=None, lixeira=None, max_bytes=None, ao_avisar=None):
        os.makedirs(raiz, exist_ok=True)
        # Resolvida uma vez, no setup: toda comparação depois é contra o caminho real, senão um
        # symlink no meio da raiz derrubaria todas as checagens de prefixo.
        self.raiz = os.path.realpath(raiz)
        self._extensoes = set(x.lower() for x in (extensoes or EXTENSOES))
        self._ignorado = _ignorador(ignorar)
        self._ocultos = self._ignorado.cfg['ocultos']
        self._lixeira = lixeira or LIXEIRA
        self._max_bytes = MAX_BYTES if max_bytes is None else max_bytes
        self._avisar = ao_avisar or (lambda _evento, _detalhe: None)

    def _resolver(self, entrada):
        return _resolver(self.raiz, entrada)

    def _caminhar(self, inicio, aplicar_ignorados=False):
        """Recursivo: descarta symlinks, devolve só arquivos, caminhos absolutos. Os ocultos
        saem pela configuração, e nunca incondicionalmente, senão `ocultos: False` mentiria."""
        saida = []
        fila = [inicio]
        while fila:
            diretorio = fila.pop()
            try:
                entradas = list(os.scandir(diretorio))
            except FileNotFoundError:
                continue
            for e in entradas:
                if e.is_symlink():
                    continue
                absoluto = os.path.join(diretorio, e.name)
                rel = os.path.relpath(absoluto, self.raiz).replace(os.sep, '/')
                if self._ocultos and _tem_componente_oculto(rel):
                    continue
                if aplicar_ignorados and self._ignorado(rel):
                    continue
                if e.is_dir():
                    fila.append(absoluto)
                else:
                    saida.append(absoluto)
        saida.sort()
        return saida

    def _coletar(self, dir_abs):
        arquivos = []
        for absoluto in self._caminhar(dir_abs, aplicar_ignorados=True):
            if _ext(absoluto) not in self._extensoes:
                continue
            try:
                st = os.stat(absoluto)
            except FileNotFoundError:
                continue   # corrida com escrita externa
            if st.st_size > self._max_bytes:
                self._avisar('arquivo-omitido', {'caminho': absoluto, 'tamanho': st.st_size,
                                                 'teto': self._max_bytes})
                continue
            with open(absoluto, 'r', encoding='utf-8', errors='replace') as fh:
                conteudo = fh.read()
            info = _info(st, absoluto)
            arquivos.append({'path': absoluto, 'content': conteudo, 'size': info['size'],
                             'mtime': info['mtime'], 'type': info['type']})
        return arquivos

    def existe(self, caminho):
        """`{'exists': bool}`. Fora da raiz continua sendo recusa."""
        absoluto, _ = self._resolver(caminho)
        return {'exists': os.path.exists(absoluto)}

    def info(self, caminho):
        """`{'type', 'size', 'mtime'}`; `ENOENT` quando não existe."""
        absoluto, _ = self._resolver(caminho)
        try:
            return _info(os.stat(absoluto), absoluto)
        except FileNotFoundError:
            raise _nao_encontrado(caminho) from None

    def ler(self, caminho):
        """`{'content': texto}`, em UTF-8 com substituição do que não decodifica."""
        absoluto, _ = self._resolver(caminho)
        try:
            with open(absoluto, 'r', encoding='utf-8', errors='replace') as fh:
                return {'content': fh.read()}
        except FileNotFoundError:
            raise _nao_encontrado(caminho) from None
        except IsADirectoryError:
            raise ErroDeDados(EINVAL, 'não é arquivo: %s' % absoluto) from None

    def escrever(self, caminho, conteudo):
        """Grava texto ou bytes, criando o diretório pai. `{'path', 'size', 'mtime'}`."""
        absoluto, _ = self._resolver(caminho)
        # Gravar por cima de um diretório nunca é o que o chamador quis: o caminho chegou
        # errado. Sem a checagem, o `open` levanta `IsADirectoryError`, que o transporte não
        # classifica, e um pedido inválido do cliente vira 500.
        if os.path.isdir(absoluto):
            raise ErroDeDados(EINVAL, 'destino de escrita é um diretório: %s' % absoluto)
        if not isinstance(conteudo, (str, bytes, bytearray, memoryview)):
            raise ErroDeDados(EINVAL, 'conteúdo deve ser texto ou bytes, veio %s' % type(conteudo).__name__)
        os.makedirs(os.path.dirname(absoluto), exist_ok=True)
        if isinstance(conteudo, str):
            with open(absoluto, 'w', encoding='utf-8') as fh:
                fh.write(conteudo)
        else:
            with open(absoluto, 'wb') as fh:
                fh.write(bytes(conteudo))
        info = _info(os.stat(absoluto), absoluto)
        return {'path': absoluto, 'size': info['size'], 'mtime': info['mtime']}

    def criar_pasta(self, caminho, recursiva=False):
        """Cria a pasta; já existir é o estado pedido, e não erro."""
        absoluto, _ = self._resolver(caminho)
        if recursiva:
            os.makedirs(absoluto, exist_ok=True)
        else:
            try:
                os.mkdir(absoluto)
            except FileExistsError:
                pass
        return {}

    def listar(self, caminho=None, aplicar_ignorados=False):
        """Todos os arquivos abaixo de `caminho` (a raiz por padrão), recursivo, absolutos.
        Sem `aplicar_ignorados` a visão é a crua: quem lista costuma estar atrás justamente do
        que a regra esconde. Os ocultos seguem a configuração nos dois modos."""
        absoluto, _ = self._resolver(caminho or self.raiz)
        return self._caminhar(absoluto, aplicar_ignorados=aplicar_ignorados)

    def remover(self, caminho, lixeira=True):
        """Move para a lixeira, com o caminho relativo achatado (`pasta_nota.md`), para um
        "desfazer" continuar possível. `lixeira=False` apaga de verdade, para o que é
        descartável por natureza (cache) e não deve inchar a lixeira."""
        absoluto, rel = self._resolver(caminho)
        if not lixeira:
            try:
                os.unlink(absoluto)
            except FileNotFoundError:
                raise _nao_encontrado(caminho) from None
            return {'recycled': None}
        destino_dir, _ = self._resolver(self._lixeira)
        os.makedirs(destino_dir, exist_ok=True)
        destino = os.path.join(destino_dir, rel.replace(os.sep, '/').replace('/', '_'))
        try:
            os.replace(absoluto, destino)
        except FileNotFoundError:
            raise _nao_encontrado(caminho) from None
        except OSError as err:
            if err.errno == errno.EXDEV:   # a lixeira noutro device (bind mount)
                shutil.copyfile(absoluto, destino)
                os.unlink(absoluto)
            else:
                raise
        return {'recycled': destino}

    def renomear(self, de, para):
        de_abs, _ = self._resolver(de)
        para_abs, _ = self._resolver(para)
        os.makedirs(os.path.dirname(para_abs), exist_ok=True)
        try:
            os.replace(de_abs, para_abs)
        except FileNotFoundError:
            raise _nao_encontrado(de) from None
        return {}

    def copiar(self, de, para):
        """Sobrescreve sem confirmação; o contrato pede isso."""
        de_abs, _ = self._resolver(de)
        para_abs, _ = self._resolver(para)
        os.makedirs(os.path.dirname(para_abs), exist_ok=True)
        try:
            shutil.copyfile(de_abs, para_abs)
        except FileNotFoundError:
            raise _nao_encontrado(de) from None
        return {}

    def abrir_pasta(self, caminho=None):
        """`{'path', 'files'}`: os arquivos das extensões configuradas, com conteúdo, fora os
        ignorados e os maiores que o teto."""
        absoluto, _ = self._resolver(caminho or self.raiz)
        if not os.path.exists(absoluto):
            raise _nao_encontrado(caminho or self.raiz)
        if not os.path.isdir(absoluto):
            raise ErroDeDados(EINVAL, 'não é diretório: %s' % absoluto)
        return {'path': absoluto, 'files': self._coletar(absoluto)}

    def abrir_leitura(self, caminho):
        """Metadados e um abridor (`abrir() -> arquivo binário`), para o transporte servir
        bytes sem passar por JSON."""
        absoluto, _ = self._resolver(caminho)
        if not os.path.exists(absoluto) or os.path.isdir(absoluto):
            raise _nao_encontrado(caminho)
        info = _info(os.stat(absoluto), absoluto)
        return {'path': absoluto, 'size': info['size'], 'mtime': info['mtime'],
                'abrir': lambda: open(absoluto, 'rb')}


def abrir(raiz=None, extensoes=None, ignorar=None, lixeira=None, max_bytes=None, ao_avisar=None, env=None):
    """As operações sobre `raiz`: o diretório de dados do app por padrão, ou um caminho
    relativo a ele (`abrir('privado')`), ou um absoluto. O diretório é criado se faltar.

    `extensoes` são as que entram com conteúdo em `open-dir` (`EXTENSOES`); `ignorar`
    sobrescreve chaves de `IGNORADOS`; `lixeira` é o destino de `remover`, relativo à raiz;
    `max_bytes` é o teto de `open-dir`. `ao_avisar(evento, detalhe)` recebe `arquivo-omitido`;
    o `log` de `servidor.criar_log()` serve direto.
    """
    base = _app.dados(env)
    if raiz is None:
        raiz = base
    elif not os.path.isabs(raiz):
        raiz = os.path.join(base, raiz)
    return Dados(raiz, extensoes=extensoes, ignorar=ignorar, lixeira=lixeira,
                 max_bytes=max_bytes, ao_avisar=ao_avisar)


# ── As rotas ──────────────────────────────────────────────────────────────────────────────────

def _mandar_json(pedido, status, corpo):
    dados = json.dumps(corpo, ensure_ascii=False, default=str, separators=(',', ':')).encode('utf-8')
    pedido.send_response(status)
    pedido.send_header('Content-Type', 'application/json; charset=utf-8')
    pedido.send_header('Content-Length', str(len(dados)))
    pedido.send_header('Cache-Control', 'no-store')
    for k, v in getattr(pedido, 'cabecalhos_fixos', {}).items():
        pedido.send_header(k, v)
    if getattr(pedido, 'close_connection', False):
        pedido.send_header('Connection', 'close')
    pedido.end_headers()
    if pedido.command != 'HEAD':
        pedido.wfile.write(dados)


def _codigo(err):
    """O código estável de um erro: o de `ErroDeDados`, ou o nome do errno de um `OSError`."""
    codigo = getattr(err, 'codigo', None)
    if not codigo and getattr(err, 'errno', None):
        codigo = errno.errorcode.get(err.errno)
    return codigo or 'EINTERNAL'


def _mandar_erro(pedido, err, op=None):
    codigo = _codigo(err)
    corpo = {'ok': False, 'error': {'code': codigo, 'message': str(err)}}
    if op:
        corpo['error']['op'] = op
    _mandar_json(pedido, _STATUS.get(codigo, 500), corpo)


def _metodo_errado(pedido, use):
    _mandar_json(pedido, 405, {'ok': False, 'error': {'code': 'EMETHOD', 'message': 'use ' + use}})


def _ler_corpo(pedido, maximo):
    """O corpo inteiro: por `Content-Length`, ou em `chunked` quando o portal só repassa o que
    o navegador mandou. Acima do teto, `EINVAL`, e a conexão fecha depois da resposta, porque o
    que não foi lido ficaria na frente do próximo pedido."""
    te = (pedido.headers.get('Transfer-Encoding') or '').lower()
    if 'chunked' in te:
        pedacos = []
        total = 0
        while True:
            linha = pedido.rfile.readline(65537)
            tamanho = int(linha.split(b';', 1)[0].strip() or b'0', 16)
            if tamanho == 0:
                while pedido.rfile.readline(65537) not in (b'\r\n', b'\n', b''):
                    pass   # trailers
                break
            total += tamanho
            if total > maximo:
                pedido.close_connection = True
                raise ErroDeDados(EINVAL, 'corpo maior que o teto (%d)' % maximo)
            pedacos.append(pedido.rfile.read(tamanho))
            pedido.rfile.readline(65537)   # o CRLF depois do pedaço
        return b''.join(pedacos)
    tamanho = int(pedido.headers.get('Content-Length') or 0)
    if tamanho > maximo:
        pedido.close_connection = True
        raise ErroDeDados(EINVAL, 'corpo maior que o teto (%d > %d)' % (tamanho, maximo))
    return pedido.rfile.read(tamanho) if tamanho else b''


def rotas(dados, prefixo='/api/dados', arquivos=None, max_corpo=None, ao_avisar=None):
    """Devolve `servir(pedido) -> bool` para o contrato de wire sobre `dados`.

    `prefixo` é a rota do RPC (e de `<prefixo>/write-binary`); `arquivos` é o prefixo dos
    binários, `<prefixo>/arquivos/` por padrão, e um app portado do toolkit mantém o frontend
    dele passando `prefixo='/api/fs', arquivos='/assets/'`. `ao_avisar(evento, detalhe)`
    recebe `op-falhou` e `escrita-binaria-falhou`, com `esperado: True` no `ENOENT`, que é
    resposta de rotina para quem sonda antes de criar.
    """
    arquivos = arquivos or (prefixo.rstrip('/') + '/arquivos/')
    maximo = MAX_CORPO if max_corpo is None else max_corpo
    avisar = ao_avisar or (lambda _evento, _detalhe: None)

    ops = {
        'exists': lambda p: dados.existe(p.get('path')),
        'stat': lambda p: dados.info(p.get('path')),
        'read-file': lambda p: dados.ler(p.get('path')),
        'write-file': lambda p: dados.escrever(p.get('path'), p.get('content') or ''),
        'mkdir': lambda p: dados.criar_pasta(p.get('path') or p.get('dir')),
        'mkdir-recur': lambda p: dados.criar_pasta(p.get('path') or p.get('dir'), recursiva=True),
        'readdir': lambda p: dados.listar(p.get('path') or p.get('dir'),
                                          aplicar_ignorados=bool(p.get('applyIgnore'))),
        'unlink': lambda p: dados.remover(p.get('path'), lixeira=p.get('recycle') is not False),
        'rename': lambda p: dados.renomear(p.get('from') or p.get('old'), p.get('to') or p.get('new')),
        'copy': lambda p: dados.copiar(p.get('from') or p.get('old'), p.get('to') or p.get('new')),
        'open-dir': lambda p: dados.abrir_pasta(p.get('path') or p.get('dir')),
        'get-files': lambda p: dados.abrir_pasta(p.get('path') or p.get('dir')),
    }

    def falha(evento, err, extra):
        """O que vai ao `ao_avisar`. `esperado` marca `ENOENT`: "não existe" é resposta de
        rotina para quem sonda antes de criar, e sem a marca a linha parece defeito."""
        detalhe = dict(extra)
        detalhe['code'] = _codigo(err)
        detalhe['message'] = str(err)
        if detalhe['code'] == ENOENT:
            detalhe['esperado'] = True
        avisar(evento, detalhe)

    def rpc(pedido):
        if pedido.command != 'POST':
            _metodo_errado(pedido, 'POST')
            return
        try:
            carga = json.loads(_ler_corpo(pedido, maximo).decode('utf-8') or '{}')
        except ErroDeDados as err:
            _mandar_erro(pedido, err)
            return
        except (ValueError, UnicodeDecodeError) as err:
            _mandar_erro(pedido, ErroDeDados(EINVAL, 'corpo não é JSON: %s' % err))
            return
        nome = carga.get('op') if isinstance(carga, dict) else None
        op = ops.get(nome)
        if not op:
            _mandar_json(pedido, 400, {'ok': False, 'error': {'code': EINVAL, 'message': 'op desconhecida: %s' % nome}})
            return
        try:
            _mandar_json(pedido, 200, {'ok': True, 'result': op(carga)})
        except (ErroDeDados, OSError) as err:
            falha('op-falhou', err, {'op': nome, 'path': carga.get('path')})
            _mandar_erro(pedido, err, nome)

    def escrever_binario(pedido, consulta):
        if pedido.command not in ('POST', 'PUT'):
            _metodo_errado(pedido, 'POST')
            return
        alvo = (parse_qs(consulta).get('path') or [None])[0]
        try:
            corpo = _ler_corpo(pedido, maximo)
            _mandar_json(pedido, 200, {'ok': True, 'result': dados.escrever(alvo, corpo)})
        except (ErroDeDados, OSError) as err:
            falha('escrita-binaria-falhou', err, {'path': alvo})
            _mandar_erro(pedido, err, 'write-binary')

    def arquivo(pedido, relativo):
        if pedido.command not in ('GET', 'HEAD'):
            _metodo_errado(pedido, 'GET')
            return
        try:
            decodificado = unquote(relativo, errors='strict')
        except (UnicodeDecodeError, ValueError):
            _mandar_erro(pedido, ErroDeDados(EINVAL, 'caminho de arquivo inválido: %s' % relativo))
            return
        try:
            alvo = dados.abrir_leitura(decodificado)
        except (ErroDeDados, OSError) as err:
            _mandar_erro(pedido, err)
            return

        ultima = formatdate(alvo['mtime'] / 1000.0, usegmt=True)
        faixa = pedido.headers.get('Range')
        if pedido.headers.get('If-Modified-Since') == ultima and not faixa:
            pedido.send_response(304)
            pedido.send_header('Last-Modified', ultima)
            pedido.send_header('Cache-Control', 'no-cache')
            pedido.end_headers()
            return

        tamanho = alvo['size']
        inicio, fim = 0, tamanho - 1
        parcial = False
        # Um intervalo só: é o que um leitor de PDF ou um `<video>` usa para não baixar o
        # arquivo inteiro. Multipart não vale o custo, e nenhum cliente do ambiente o pede.
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', faixa or '')
        if m and tamanho > 0:
            cru_inicio, cru_fim = m.group(1), m.group(2)
            try:
                if cru_inicio == '':
                    inicio, fim = tamanho - int(cru_fim), tamanho - 1
                else:
                    inicio = int(cru_inicio)
                    fim = int(cru_fim) if cru_fim else tamanho - 1
            except ValueError:
                inicio, fim = 0, -1
            inicio = max(0, inicio)
            fim = min(tamanho - 1, fim)
            if inicio > fim:
                pedido.send_response(416)
                pedido.send_header('Content-Range', 'bytes */%d' % tamanho)
                pedido.send_header('Content-Length', '0')
                pedido.end_headers()
                return
            parcial = True

        comprimento = fim - inicio + 1 if tamanho else 0
        pedido.send_response(206 if parcial else 200)
        pedido.send_header('Content-Type', tipo_de_conteudo(alvo['path']))
        pedido.send_header('Last-Modified', ultima)
        pedido.send_header('Cache-Control', 'no-cache')
        pedido.send_header('Accept-Ranges', 'bytes')
        if parcial:
            pedido.send_header('Content-Range', 'bytes %d-%d/%d' % (inicio, fim, tamanho))
        pedido.send_header('Content-Length', str(comprimento))
        for k, v in getattr(pedido, 'cabecalhos_fixos', {}).items():
            pedido.send_header(k, v)
        pedido.end_headers()
        if pedido.command == 'HEAD':
            return
        with alvo['abrir']() as fh:
            fh.seek(inicio)
            restante = comprimento
            while restante > 0:
                pedaco = fh.read(min(64 * 1024, restante))
                if not pedaco:
                    break
                pedido.wfile.write(pedaco)
                restante -= len(pedaco)

    def servir(pedido):
        partes = urlsplit(pedido.path)
        caminho = partes.path
        if caminho == prefixo:
            rpc(pedido)
        elif caminho == prefixo + '/write-binary':
            escrever_binario(pedido, partes.query)
        elif caminho.startswith(arquivos):
            arquivo(pedido, caminho[len(arquivos):])
        else:
            return False
        return True

    return servir
