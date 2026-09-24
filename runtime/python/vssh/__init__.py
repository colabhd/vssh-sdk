"""
vssh: o runtime de backend que o sistema instala em cada servidor.

Um app de backend importa este pacote em vez de carregar uma cópia dele: o portal o põe em
`/opt/vssh/sdk/python` e o `vssh-app-run` o expõe pelo `PYTHONPATH` a todo app que sobe. É a
metade instalada da analogia com o .NET Framework: o app declara o que precisa, e a máquina em que
ele roda já tem o que ele importa.

Nove módulos, cada um importado por si:

    from vssh import servidor    # o socket unix do app, o portão de token, o `/saude`, o log
    from vssh import web         # a SPA do app, com o SDK web e o Tuff injetados no `<head>`
    from vssh import eventos     # SSE: um stream por pedido, e a difusão a quem assinou
    from vssh import dados       # o filesystem privado do app, e as rotas que o frontend chama
    from vssh import avisos      # notificar, atividade em curso e bandeja, para um app sem janela
    from vssh import app         # quem sou, o diretório de dados, a versão do pacote instalado
    from vssh import gpu         # o que o sistema concedeu de GPU a este app, e por que não
    from vssh import fila        # delegar um container ao cluster Kubernetes, e acompanhá-lo
    from vssh import progresso   # a linha de progresso de um trabalho longo: escrever e ler

Nenhum deles lê variável de ambiente além do contrato do vssh-app (`VSSH_APP_ID`,
`VSSH_APP_SOCKET`, `VSSH_APP_TOKEN`, `VSSH_APP_DATA_DIR`, `HOME`, e, para quem declarou
`recursos.fila`, `VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN`), e cada função que lê o ambiente
aceita `env` para que uma bancada meça sem mexer no processo.

Só biblioteca padrão. Um `pip install` por usuário é o tipo de dependência que falha em silêncio
num servidor que ninguém provisionou para isso, e este pacote roda em todos.
"""

__all__ = ['app', 'avisos', 'dados', 'eventos', 'fila', 'gpu', 'progresso', 'servidor', 'web']
