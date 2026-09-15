# Para dot-sourcing, e nunca para executar: põe o runtime `vssh` deste checkout no caminho dos
# dois interpretadores, que é o que o `vssh-app-run` faz num servidor com /opt/vssh/sdk.
#
#     . .\scripts\ambiente-de-dev.ps1
#     node backend\server.js --tcp 127.0.0.1:0        # o backend de um app, numa porta de bancada
#
# Exporta VSSH_SDK (a raiz deste checkout), NODE_PATH (runtime\node, à frente do que já houver)
# e PYTHONPATH (runtime\python, idem). No bash e no zsh, o par é `scripts/ambiente-de-dev.sh`.
#
# A raiz sai da localização deste arquivo (`$PSScriptRoot`), e não do diretório corrente: quem
# faz o dot-sourcing de dentro do repositório do próprio app está noutro lugar. O separador de
# lista é o do sistema: `;` no Windows, `:` no resto, que é o que o Node e o Python leem.

$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sep = [System.IO.Path]::PathSeparator

$env:VSSH_SDK = $raiz
$env:NODE_PATH = (Join-Path $raiz 'runtime' 'node') + $(if ($env:NODE_PATH) { "$sep$env:NODE_PATH" } else { '' })
$env:PYTHONPATH = (Join-Path $raiz 'runtime' 'python') + $(if ($env:PYTHONPATH) { "$sep$env:PYTHONPATH" } else { '' })
