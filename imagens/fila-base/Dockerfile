# A imagem base da fila de processamento: Ubuntu com o runtime do SkyPilot já instalado, para o
# job de um app não esperar o SkyPilot montá-lo no pod. O porquê está em
# instalar-runtime-skypilot.sh, e o uso, em docs/guias/trabalho-longo.md.
#
# `BASE` troca a imagem de partida, que tem de ser Debian ou Ubuntu e rodar como root. A publicada
# parte de ubuntu:24.04: um app de GPU recebe o driver do runtime da NVIDIA do nó, e as bibliotecas
# CUDA vêm do pip, com o torch.
ARG BASE=ubuntu:24.04
FROM ${BASE}

ARG SKYPILOT_VERSAO=0.14.0

COPY instalar-runtime-skypilot.sh conferir-runtime-skypilot.sh /opt/vssh-fila/
RUN SKYPILOT_VERSAO="${SKYPILOT_VERSAO}" bash /opt/vssh-fila/instalar-runtime-skypilot.sh \
 && bash /opt/vssh-fila/conferir-runtime-skypilot.sh

LABEL org.opencontainers.image.source="https://github.com/colabhd/vssh-sdk" \
      org.opencontainers.image.description="Base da fila do VSSH: Ubuntu com o runtime do SkyPilot pré-instalado" \
      org.opencontainers.image.licenses="MIT"
