# runtime

Diretório gerado pelo canal de publicação do sistema (`scripts/gerar-sdk.js` do `vssh-sso`), como
`api/`; ninguém o edita, e o [`api/build-info.json`](../api/build-info.json) carrega o hash de
cada arquivo daqui.

O que há: as libs de backend de um vssh-app, o pacote `vssh` em Python (`python/vssh/`) e em Node
(`node/vssh/`), copiadas de `infra/sdk/` do sistema como estavam na rodada. Em produção elas vêm
instaladas no servidor, em `/opt/vssh/sdk`, e o lançador as põe no `PYTHONPATH` e no `NODE_PATH`
do app; a cópia daqui serve ao emulador e ao editor de quem escreve um app
(`PYTHONPATH=runtime/python`, `NODE_PATH=runtime/node`). O que cada variável e cada arquivo do
ambiente significam está em [`docs/referencia/ambiente.md`](../docs/referencia/ambiente.md).
