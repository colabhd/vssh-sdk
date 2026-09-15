# Para `source`, e nunca para executar: põe o runtime `vssh` deste checkout no caminho dos dois
# interpretadores, que é o que o `vssh-app-run` faz num servidor com /opt/vssh/sdk.
#
#     source scripts/ambiente-de-dev.sh
#     node backend/server.js --tcp 127.0.0.1:0        # o backend de um app, numa porta de bancada
#
# Exporta VSSH_SDK (a raiz deste checkout), NODE_PATH (runtime/node, à frente do que já houver)
# e PYTHONPATH (runtime/python, idem). No PowerShell, o par é `scripts/ambiente-de-dev.ps1`.
#
# A raiz sai da localização deste arquivo, e não do diretório corrente: quem faz `source` de
# dentro do repositório do próprio app está noutro lugar. `BASH_SOURCE` é do bash; o zsh diz o
# arquivo em curso por `%x`, e é o único outro shell em que isto foi medido.

if [ -n "${ZSH_VERSION:-}" ]; then
  _vssh_sdk_aqui="${(%):-%x}"
else
  _vssh_sdk_aqui="${BASH_SOURCE[0]}"
fi

VSSH_SDK="$(cd "$(dirname "${_vssh_sdk_aqui}")/.." && pwd)"
export VSSH_SDK
export NODE_PATH="${VSSH_SDK}/runtime/node${NODE_PATH:+:${NODE_PATH}}"
export PYTHONPATH="${VSSH_SDK}/runtime/python${PYTHONPATH:+:${PYTHONPATH}}"
unset _vssh_sdk_aqui
