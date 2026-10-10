#!/usr/bin/env bash
# Instala numa imagem Debian ou Ubuntu o runtime que o SkyPilot montaria no pod de cada job da fila.
#
# O SkyPilot roda a imagem de um job como imagem do pod e, antes do comando, prepara nela o runtime
# dele: pacotes por apt, o uv, um Python 3.10 e um venv com o Ray e o próprio SkyPilot. Ele faz isso
# em todo job, porque cada job ganha um pod novo, e baixa tudo da internet. Num pod do cluster essa
# etapa leva de 25 a 66 s. Cada passo se pula quando o que ele instalaria já existe, e este script
# deixa tudo no lugar onde o SkyPilot procura:
#
#   pacotes     rsync curl wget nc gcc patch lspci sshd, conferidos com `command -v`
#   uv          ~/.local/bin/uv
#   venv        ~/skypilot-runtime, com Python 3.10
#   Ray         ray[default]==2.9.3 no venv (a guarda é `uv pip list | grep "ray " | grep 2.9.3`)
#   SkyPilot    skypilot[kubernetes,remote] no venv, na versão do servidor
#
# A sequência de `uv pip install` é a do pod (sky/skylet/constants.py e
# sky/templates/kubernetes-ray.yml.j2, SkyPilot 0.14.0): cada passo aperta ou solta uma versão que o
# seguinte confere, e na mesma ordem o pod encontra cada requisito satisfeito e não baixa nada. O
# instalador do pacote `skypilot` desce o `click` para 8.1.8, e é por isso que o `click<8.3.0`
# que o pod pede de novo a cada job já está satisfeito.
#
# O venv mora no HOME de quem roda a imagem. O pod do SkyPilot roda como o usuário da imagem, e
# uma imagem derivada que troca o USER perde o runtime: o SkyPilot instala tudo de novo no HOME
# novo. `conferir-runtime-skypilot.sh` diz se uma imagem derivada ainda o tem.
#
# Uma versão nova do SkyPilot no servidor pede a imagem refeita com SKYPILOT_VERSAO nova. Uma
# imagem com a versão antiga continua funcionando: o SkyPilot reinstala o wheel dele por cima, sem
# rede, e o resto do venv segue valendo enquanto o Ray pedido for o mesmo.

set -euo pipefail

SKYPILOT_VERSAO=${SKYPILOT_VERSAO:-0.14.0}
RAY_VERSAO=${RAY_VERSAO:-2.9.3}
UV_VERSAO=${UV_VERSAO:-0.13.0}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates rsync curl wget netcat-openbsd gcc patch pciutils openssh-server
rm -rf /var/lib/apt/lists/*

curl -LsSf "https://astral.sh/uv/${UV_VERSAO}/install.sh" \
  | env UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh

# As mesmas variáveis com que o pod chama o uv: um PYTHONPATH ou um UV_SYSTEM_PYTHON da imagem não
# podem entrar no venv do runtime.
uv() { env -u PYTHONPATH UV_LINK_MODE=copy UV_SYSTEM_PYTHON=false "$HOME/.local/bin/uv" "$@"; }

uv venv --seed "$HOME/skypilot-runtime" --python 3.10
export VIRTUAL_ENV="$HOME/skypilot-runtime"
uv pip install "setuptools<70"
uv pip install "click<8.3.0"
uv pip install -U "ray[default]==${RAY_VERSAO}" "pydantic-core==2.41.1" "click<8.3.0"
uv pip install "skypilot[kubernetes,remote]==${SKYPILOT_VERSAO}"
uv cache clean
