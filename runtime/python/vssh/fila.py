"""
A fila de processamento: delegar um container ao cluster Kubernetes, em vez de rodá-lo aqui.

O app declara `recursos.fila: true` no manifesto e recebe do portal, a cada subida,
`VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN`: a URL pública do portal e a identidade deste app diante
dele. É com esse par que tudo aqui fala com `/api/fila/*`. Sem ele, `disponivel()` diz o motivo e
`submeter()` levanta `ErroDaFila`; um servidor sem cluster configurado responde o mesmo, pela
mesma pergunta. O app pergunta antes de prometer um botão.

O trabalho é um container: a imagem do app, o comando, arquivos de entrada da estação e os nomes
das saídas que ele vai escrever em `/vssh/saidas`. Os arquivos viajam pelo S3 do cluster, por URLs
que o portal assina; este módulo sobe as entradas e baixa as saídas com `urllib`, em stream.

    from vssh import fila

    if fila.disponivel()['disponivel']:
        ident = fila.submeter({
            'nome': 'transcodificar',
            'imagem': 'ghcr.io/colabhd/ffmpeg:7',
            'comando': ['ffmpeg', '-i', 'entradas/v.mp4', 'saidas/v.webm'],
            'entradas': {'v.mp4': '/home/ana/videos/v.mp4'},
            'saidas': ['v.webm'],
            'gpu': {'quantidade': 1, 'tipo': 'rtx-a5000'},
            'cpu': '4', 'memoria': '8Gi', 'prazo': 3600,
        })
        final = fila.acompanhar(ident, ao_evento=lambda ev, job: print(ev, job['estado']))
        if final['estado'] == 'concluido':
            fila.baixar(ident, '/home/ana/videos/saida')

Estados de um job: `declarado`, `enviado`, `na_fila`, `rodando`, e os finais `concluido`,
`falhou` (com `motivo`: `prazo`, `imagem`, `entrada:<nome>`, `codigo:<n>`, `sumiu`) e
`cancelado`. Dentro do container, `VSSH_ENTRADAS` e `VSSH_SAIDAS` apontam os dois diretórios, e o
diretório de trabalho é `/vssh`.

Um trabalho que imprime linhas de `vssh.progresso` no stdout tem o progresso lido pelo portal: o
`ao_evento` de `acompanhar` recebe `progresso` com o job, e `job['progresso']` traz `feito`,
`total` e `etapa`. Quem já baixou as saídas chama `remover` para o dado sair do S3 na hora.

Só biblioteca padrão, como o resto do pacote.
"""

import json
import os
import urllib.error
import urllib.request

__all__ = ['ErroDaFila', 'disponivel', 'submeter', 'estado', 'acompanhar', 'log', 'cancelar', 'remover', 'baixar', 'listar']

BLOCO = 4 * 1024 * 1024
_TEMPO_HTTP = 60


class ErroDaFila(Exception):
    """Uma recusa do portal (`status`, `mensagem`) ou a ausência da credencial (`status` 0)."""

    def __init__(self, status, mensagem, extra=None):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem
        self.extra = extra or {}


def _credencial(env=None):
    env = os.environ if env is None else env
    url = (env.get('VSSH_PORTAL_URL') or '').rstrip('/')
    token = env.get('VSSH_PORTAL_TOKEN') or ''
    if not url or not token:
        return None
    return url, token


# O SDK se apresenta pelo nome. O portal fica atrás do Cloudflare, e a regra de bots dele
# recusa o `Python-urllib/3.x` que o urllib manda por padrão (erro 1010, "browser signature
# banned"); um nome próprio passa, e diz no log do portal quem chamou.
_AGENTE = 'vssh-sdk-fila/python'


def _pedir(metodo, rota, corpo=None, env=None, stream=False):
    cred = _credencial(env)
    if not cred:
        raise ErroDaFila(0, 'o app não tem credencial da fila: declare recursos.fila no manifesto e reinicie o app')
    url, token = cred
    dados = None
    cabecalhos = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'User-Agent': _AGENTE}
    if corpo is not None:
        dados = json.dumps(corpo).encode('utf-8')
        cabecalhos['Content-Type'] = 'application/json'
    req = urllib.request.Request(url + '/api/fila' + rota, data=dados, method=metodo, headers=cabecalhos)
    try:
        r = urllib.request.urlopen(req, timeout=None if stream else _TEMPO_HTTP)
    except urllib.error.HTTPError as e:
        texto = e.read().decode('utf-8', 'replace')
        try:
            j = json.loads(texto)
        except ValueError:
            j = {}
        raise ErroDaFila(e.code, j.get('error') or texto or ('HTTP %d' % e.code), {k: v for k, v in j.items() if k != 'error'})
    except urllib.error.URLError as e:
        raise ErroDaFila(0, 'o portal não respondeu: %s' % e.reason)
    if stream:
        return r
    with r:
        texto = r.read().decode('utf-8')
    return json.loads(texto) if texto else None


def disponivel(env=None):
    """`{'disponivel': bool, 'motivo': str | None, 'cluster': str | None, 'gpus': [...], 'quotas': {...}, 'uso': {...}}`.

    Nunca levanta: sem credencial, ou com o portal fora, responde `disponivel: False` com o motivo.
    """
    if not _credencial(env):
        return {'disponivel': False, 'motivo': 'o app não declarou recursos.fila no manifesto (ou ainda não foi reiniciado)',
                'cluster': None, 'gpus': [], 'quotas': {}, 'uso': {}}
    try:
        r = _pedir('GET', '', env=env)
    except ErroDaFila as e:
        return {'disponivel': False, 'motivo': e.mensagem, 'cluster': None, 'gpus': [], 'quotas': {}, 'uso': {}}
    return {
        'disponivel': bool(r.get('disponivel')),
        'motivo': r.get('motivo'),
        'cluster': r.get('cluster'),
        'gpus': r.get('gpus') or [],
        'quotas': r.get('quotas') or {},
        'uso': r.get('uso') or {},
    }


def _entradas_de(trabalho):
    """`{'nome': caminho}` ou `[caminho, ...]` (nome = basename; colisão levanta)."""
    bruto = trabalho.get('entradas') or {}
    if isinstance(bruto, dict):
        pares = list(bruto.items())
    else:
        pares = [(os.path.basename(c), c) for c in bruto]
    vistos = set()
    for nome, caminho in pares:
        if nome in vistos:
            raise ErroDaFila(400, 'duas entradas com o mesmo nome: %s' % nome)
        vistos.add(nome)
        if not os.path.isfile(caminho):
            raise ErroDaFila(400, 'entrada não encontrada: %s' % caminho)
    return pares


def _subir(url, caminho, ao_progresso=None):
    tamanho = os.path.getsize(caminho)
    with open(caminho, 'rb') as f:
        req = urllib.request.Request(url, data=f, method='PUT',
                                     headers={'Content-Length': str(tamanho), 'Content-Type': 'application/octet-stream'})
        try:
            with urllib.request.urlopen(req, timeout=None) as r:
                if r.status not in (200, 201, 204):
                    raise ErroDaFila(r.status, 'o S3 recusou a entrada %s' % caminho)
        except urllib.error.HTTPError as e:
            raise ErroDaFila(e.code, 'o S3 recusou a entrada %s (%d)' % (caminho, e.code))
        except urllib.error.URLError as e:
            raise ErroDaFila(0, 'o S3 não respondeu ao subir %s: %s' % (caminho, e.reason))
    if ao_progresso:
        ao_progresso({'fase': 'entrada', 'arquivo': caminho, 'bytes': tamanho})


def submeter(trabalho, ao_progresso=None, env=None):
    """Declara, sobe as entradas e inicia. Devolve o id do job.

    `trabalho` leva `imagem` (obrigatória), `comando`, `args`, `env`, `entradas` (dict nome →
    caminho, ou lista de caminhos), `saidas` (nomes em /vssh/saidas), `gpu` (`{'quantidade',
    'tipo'}`), `cpu`, `memoria`, `disco`, `prazo` (segundos) e `nome`. O que o portal recusa vem
    como `ErroDaFila` com a mensagem dele, antes de qualquer byte subir.
    """
    pares = _entradas_de(trabalho)
    pedido = {k: v for k, v in trabalho.items() if k != 'entradas'}
    pedido['entradas'] = [nome for nome, _ in pares]
    decl = _pedir('POST', '/jobs', pedido, env=env)
    ident = decl['id']
    urls = {e['nome']: e['url'] for e in decl.get('entradas', [])}
    teto = decl.get('maxEntradaBytes')
    try:
        for nome, caminho in pares:
            if teto and os.path.getsize(caminho) > teto:
                raise ErroDaFila(413, 'a entrada %s passa do teto de %d bytes' % (caminho, teto))
            _subir(urls[nome], caminho, ao_progresso)
        _pedir('POST', '/jobs/%s/iniciar' % ident, env=env)
    except ErroDaFila:
        # O que ficou declarado não pode contar na cota de quem nem chegou a submeter.
        try:
            _pedir('DELETE', '/jobs/%s' % ident, env=env)
        except ErroDaFila:
            pass
        raise
    return ident


def estado(ident, env=None):
    """O job como o portal o vê: `id`, `estado`, `motivo`, `saidas`, `faltantes`, datas."""
    return _pedir('GET', '/jobs/%s' % ident, env=env)


def _eventos(rota, env=None):
    """Itera `(evento, dados)` de um SSE do portal até ele fechar."""
    r = _pedir('GET', rota, env=env, stream=True)
    with r:
        evento, linhas = None, []
        for crua in r:
            linha = crua.decode('utf-8').rstrip('\r\n')
            if linha == '':
                if evento is not None:
                    try:
                        dados = json.loads(''.join(linhas)) if linhas else None
                    except ValueError:
                        dados = None
                    yield evento, dados
                evento, linhas = None, []
                continue
            if linha.startswith(':'):
                continue
            if linha.startswith('event:'):
                evento = linha[6:].strip()
            elif linha.startswith('data:'):
                linhas.append(linha[5:].strip())


def acompanhar(ident, ao_evento=None, env=None):
    """Segue o job até um estado final e o devolve. `ao_evento(evento, job)` a cada mudança.

    Um blip de rede entre o app e o portal não é o fim do job: o SSE reabre e continua do estado
    atual, que o portal manda ao conectar.
    """
    while True:
        final = None
        for evento, dados in _eventos('/jobs/%s/eventos' % ident, env=env):
            if ao_evento and dados is not None:
                try:
                    ao_evento(evento, dados)
                except Exception:
                    pass
            if evento in ('concluido', 'falhou', 'cancelado'):
                final = dados
        if final is not None:
            return final
        atual = estado(ident, env=env)
        if atual.get('estado') in ('concluido', 'falhou', 'cancelado'):
            return atual


def log(ident, env=None):
    """As linhas do container principal, como iterador; segue o pod enquanto ele vive."""
    for evento, dados in _eventos('/jobs/%s/log' % ident, env=env):
        if evento == 'linha' and dados:
            yield dados.get('linha', '')
        elif evento == 'error' and dados:
            raise ErroDaFila(0, dados.get('error') or 'erro no log')


def cancelar(ident, env=None):
    """Cancela; `True` quando o portal aceitou (um job já terminado também responde `True`)."""
    r = _pedir('POST', '/jobs/%s/cancelar' % ident, env=env)
    return bool(r and r.get('success'))


def remover(ident, env=None):
    """Apaga do S3 as entradas e as saídas de um job terminado, sem esperar a faxina da retenção.
    Serve a quem já baixou o que precisava e não quer o dado no cluster nem mais um minuto. Um job
    em curso responde 409: cancele antes."""
    r = _pedir('DELETE', '/jobs/%s' % ident, env=env)
    return bool(r and r.get('removido'))


def baixar(ident, destino, nomes=None, env=None):
    """Baixa as saídas para `destino` (criado se preciso) e devolve os caminhos gravados."""
    r = _pedir('GET', '/jobs/%s/saidas' % ident, env=env)
    os.makedirs(destino, exist_ok=True)
    gravados = []
    for s in r.get('saidas', []):
        if nomes is not None and s['nome'] not in nomes:
            continue
        caminho = os.path.join(destino, s['nome'])
        try:
            with urllib.request.urlopen(s['url'], timeout=None) as resp, open(caminho, 'wb') as f:
                while True:
                    b = resp.read(BLOCO)
                    if not b:
                        break
                    f.write(b)
        except urllib.error.HTTPError as e:
            raise ErroDaFila(e.code, 'o S3 recusou a saída %s (%d)' % (s['nome'], e.code))
        except urllib.error.URLError as e:
            raise ErroDaFila(0, 'o S3 não respondeu ao baixar %s: %s' % (s['nome'], e.reason))
        gravados.append(caminho)
    return gravados


def listar(env=None):
    """Os jobs deste app para este usuário, do mais novo ao mais velho."""
    r = _pedir('GET', '/jobs', env=env)
    return r.get('jobs', []) if r else []
