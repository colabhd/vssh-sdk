"""
Quem este app é, e onde ele guarda as coisas.

O `vssh-app-run` exporta a identidade (`VSSH_APP_ID`) e o diretório de dados
(`VSSH_APP_DATA_DIR`) ao subir o app; a versão vem do `vssh-app.json` instalado, que o portal
reescreve com o hash do conteúdo ao instalar. Ler as três coisas daqui, e de lugar nenhum mais,
é o que faz um app rodar igual sob o `vssh-app-run` e numa bancada que o sobe à mão.
"""

import json
import os
import sys

__all__ = ['ident', 'dados', 'raiz', 'manifesto', 'versao']

_MANIFESTO = 'vssh-app.json'


def raiz():
    """O diretório do pacote instalado: o que tem o `vssh-app.json`.

    Sobe a partir do script principal (`backend/agente.py` está um nível abaixo do manifesto, e
    um entrypoint mais fundo também é achado), e depois a partir do diretório corrente, que é o
    do pacote quando o `vssh-app-run` lança. Devolve `None` quando não há manifesto em nenhum dos
    dois caminhos: é o caso de um script solto, e aí não há pacote de que falar.
    """
    pontos = []
    principal = sys.modules.get('__main__')
    arquivo = getattr(principal, '__file__', None) or (sys.argv[0] if sys.argv else '')
    if arquivo:
        pontos.append(os.path.dirname(os.path.abspath(arquivo)))
    pontos.append(os.getcwd())
    for inicio in pontos:
        d = inicio
        while True:
            if os.path.isfile(os.path.join(d, _MANIFESTO)):
                return d
            pai = os.path.dirname(d)
            if pai == d:
                break
            d = pai
    return None


def manifesto():
    """O `vssh-app.json` instalado, como dicionário. Vazio quando não há."""
    r = raiz()
    if not r:
        return {}
    try:
        with open(os.path.join(r, _MANIFESTO), encoding='utf-8') as f:
            m = json.load(f)
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def versao():
    """A `version` do pacote instalado, `dev` fora de um pacote.

    É o que o `/saude` responde e o que o portal compara com a versão que ele tem na imagem: o
    instalador a reescreve como `<semver>+g<hash do conteúdo>`, então um byte diferente é uma
    versão diferente.
    """
    return str(manifesto().get('version') or 'dev')


def ident(env=None):
    """O id do app: `VSSH_APP_ID`, ou o `id` do manifesto quando o ambiente não o exportou."""
    env = os.environ if env is None else env
    return str(env.get('VSSH_APP_ID') or manifesto().get('id') or 'app')


def dados(env=None):
    """O diretório de dados por usuário: `VSSH_APP_DATA_DIR`, ou `~/.vssh-apps/<id>/data`.

    Sobrevive a reinstalação e a reinício, ao contrário do diretório do pacote, que o portal
    troca inteiro a cada versão. É onde um app guarda o que não pode perder.
    """
    env = os.environ if env is None else env
    declarado = env.get('VSSH_APP_DATA_DIR')
    if declarado:
        return declarado
    return os.path.join(env.get('HOME') or os.path.expanduser('~'), '.vssh-apps', ident(env), 'data')
