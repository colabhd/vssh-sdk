#!/usr/bin/env bash
# Diz se o SkyPilot vai pular a preparação do runtime numa imagem, conferindo cada coisa como o pod
# confere. Roda dentro da imagem, como o usuário dela:
#
#   docker run --rm <imagem> bash /opt/vssh-fila/conferir-runtime-skypilot.sh
#
# Sai com 0 quando tudo está no lugar, e com 1 listando o que falta. Uma imagem derivada da base da
# fila que troca o USER, apaga o HOME ou reinstala o Ray noutra versão volta a pagar a preparação
# inteira em cada job, e é isto que mostra.

set -u

RAY_VERSAO=${RAY_VERSAO:-2.9.3}
falta=0
ok() { printf 'ok     %s\n' "$1"; }
sem() { printf 'falta  %s\n' "$1"; falta=1; }

# Os pacotes, como o passo do apt do pod os procura: o binário no PATH, e o lspci e o sshd também
# nos caminhos de sistema, que o PATH de um usuário comum não tem.
for binario in rsync curl wget nc gcc patch; do
  if command -v "$binario" >/dev/null 2>&1; then ok "$binario"; else sem "$binario"; fi
done
if command -v lspci >/dev/null 2>&1 || [ -x /usr/sbin/lspci ] || [ -x /sbin/lspci ]; then ok lspci; else sem lspci; fi
if command -v sshd >/dev/null 2>&1 || [ -x /usr/sbin/sshd ] || [ -x /sbin/sshd ]; then ok sshd; else sem sshd; fi

uv="$HOME/.local/bin/uv"
if "$uv" -V >/dev/null 2>&1; then ok "uv em $uv"; else sem "uv em $uv"; fi

venv="$HOME/skypilot-runtime"
if [ -d "$venv" ]; then
  ok "venv em $venv"
  pacotes=$(VIRTUAL_ENV="$venv" env -u PYTHONPATH "$uv" pip list 2>/dev/null || true)
  if printf '%s\n' "$pacotes" | grep "ray " | grep -q "$RAY_VERSAO"; then ok "ray $RAY_VERSAO"; else sem "ray $RAY_VERSAO no venv"; fi
  if printf '%s\n' "$pacotes" | grep -q "^skypilot "; then ok "skypilot no venv"; else sem "skypilot no venv"; fi
  click=$(printf '%s\n' "$pacotes" | awk '$1 == "click" {print $2}')
  case "$click" in
    8.[012].*|[0-7].*) ok "click $click" ;;
    *) sem "click abaixo de 8.3 (está ${click:-ausente})" ;;
  esac
else
  sem "venv em $venv"
fi

exit "$falta"
