#!/usr/bin/env python3
"""Hello World (Python): o template de partida para um vssh-app com backend Python.

É o mesmo app que o `hello-vssh-app-node`. Mesmas peças, mesmas rotas, mesmo frontend: o
`frontend/galeria.js` é byte a byte idêntico ao de lá, e há um teste que reprova a divergência
(`tests/galeria-paridade.test.js`). A escolha entre os dois templates é de linguagem, e mais nada.

O backend importa `vssh`, o runtime que o sistema instala em cada servidor em
`/opt/vssh/sdk/python` e que o `vssh-app-run` expõe pelo `PYTHONPATH` a todo app que sobe. Nada
disso viaja no pacote, e o manifesto não tem `installCommand`. O resto é stdlib. O SDK web
(`vssh`) e a biblioteca de UI também não viajam: o sistema os serve em `_sdk/` dentro do espaço
de URL do app, e o backend só injeta as tags (ver `web.spa` abaixo).

Fora do servidor, `scripts/ambiente-de-dev.sh` do SDK aponta `PYTHONPATH` para a cópia de
`runtime/python`, e `python3 backend/main.py --tcp 127.0.0.1:0` sobe o backend numa porta.

O que este template já faz por você, e que a primeira versão de todo app esquece:
  - log estruturado em $VSSH_APP_DATA_DIR desde a primeira linha (é o que salva a depuração
    remota: frame minificado sustenta hipótese, log do backend nomeia op e caminho);
  - o portão do X-Vssh-App-Token, em tempo constante, e o `/saude` que o ambiente sonda;
  - um endpoint SSE com os cabeçalhos que sobrevivem ao proxy e ao CDN.

Este arquivo não lê `VSSH_APP_PORT`, e ler seria o defeito: o endereço de um app é um socket
unix, e o `transport: "tcp"` que entregaria uma porta saiu do schema. Quem lê o endereço, limpa
socket órfão e falha alto quando não veio nada é o `servidor.escutar()`, lá no fim.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

try:
    import resource  # tempo de processador dos FILHOS — é o que o benchmark da GPU compara
except ImportError:  # Windows de desenvolvimento; o app roda em Linux
    resource = None
from urllib.parse import parse_qs, urlsplit

# Os módulos do runtime, cada um importado por si:
#
#   servidor   o endereço, o portão de token, o `/saude`, o log
#   web        a SPA do app, com o SDK web e o Tuff injetados no `<head>`
#   eventos    SSE, e a difusão a quem assinou
#   dados      o filesystem privado do app, e as rotas que o frontend chama
#   avisos     notificar, atividade em curso e bandeja, para um app sem janela
#   app        quem sou, e onde guardo as coisas
#   gpu        o que o lançador concedeu de GPU a este processo
#   fila       delegar um container ao cluster Kubernetes, e acompanhá-lo
#
# As duas vozes de um app sem janela dizem coisas diferentes, e trocar uma pela outra é o erro
# que enche o sino de quem usa o ambiente: `avisos.notificar` registra um fato que aconteceu, e
# que a pessoa vai querer reencontrar; `avisos.atividade` declara uma condição verdadeira agora,
# que some quando deixa de ser, sem deixar rastro. A bandeja (`avisos.bandeja`) é o par do
# `vssh.avisos.bandeja` do SDK web: aquele morre com a janela; este escreve um arquivo que o
# portal lê, e o clique volta como POST, porque a rede é assimétrica (o portal alcança o app; o
# app não alcança o portal).
from vssh import app, avisos, dados, eventos, fila, gpu, servidor, web

_AQUI = os.path.dirname(os.path.abspath(__file__))

APP_ID = app.ident()

log = servidor.criar_log()

# As duas metades do prazo de validade de uma atividade, ligadas no boot porque é uma linha cada e
# porque esquecê-las não quebra nada: só deixa uma barra mentindo no painel de outra pessoa. A
# renovação cobre o `kill -9` (o portal descarta o que passa ~60 s sem renovar o `at`); a limpeza
# ao sair cobre a saída limpa, onde 60 s de "sincronizando" seria um minuto de mentira.
avisos.manter_atividades_vivas()
avisos.limpar_atividades_ao_sair()
# Ícone órfão mente sobre o estado do ambiente: ele fica na bandeja depois que o app morreu, e quem
# o vê conclui que o app está de pé.
avisos.limpar_bandeja_ao_sair()

# ── O armazém privado deste app ──────────────────────────────────────────────
#
# `dados.abrir("privado")` é `<diretório de dados>/privado`: dentro do VSSH_APP_DATA_DIR, que é o
# único diretório gravável garantido (o pacote em /opt/vssh-apps/<id>/ é de root e somente
# leitura), e em `~/.vssh-apps/<id>/data` fora do lançador. É o filesystem privado do app, e não
# os arquivos do usuário, que são a File System Access da galeria.
arquivos_privados = dados.abrir("privado", ao_avisar=log)
# As rotas que o frontend chama em `api/privado`. O portão de token fica no `servidor.Pedido`, na
# frente de tudo, e por isso estas rotas não têm um segundo.
servir_privado = dados.rotas(arquivos_privados, prefixo="/api/privado", ao_avisar=log)

# A raiz vai absoluta, a partir deste arquivo. Uma relativa (`web.spa("frontend")`) resolve contra
# a pasta do `vssh-app.json` a partir do script principal, e numa bancada que importa este módulo
# o script principal é outro.
spa = web.spa(
    os.path.join(_AQUI, "..", "frontend"),
    # A ponte com o ambiente entra por uma tag, e a tag é tudo que este backend faz por ela:
    # `web.spa` acrescenta o `<script src="_sdk/vssh.js">` antes do `</head>` do index, e quem
    # responde esse caminho é o sistema. O caminho é relativo à raiz do app, e numa rota profunda
    # (`rotas_profundas`) o `<base href>` que a lib injeta o resolve. Fora do ambiente ninguém
    # serve `_sdk/`, e a galeria diz isso na peça "Ambiente".
    #
    # O Tuff, a biblioteca de UI, vem do mesmo espaço `_sdk/tuff/`. `web.TUFF` são os tokens, os
    # componentes e o comportamento; `TUFF_BASE` é o reset da página inteira, à parte porque um
    # bundle antigo com CSS próprio não o quer; `TUFF_ICONES` é o sprite, que não atravessa o
    # iframe e por isso entra como script. Adotar o Tuff é escolha deste app: um app com
    # identidade visual própria passa `tuff=False`, que é o padrão.
    tuff=[*web.TUFF, web.TUFF_BASE, web.TUFF_ICONES],
    # `galeria.js`, o código deste app, entra aqui, e não como uma `<script src>` no index, para
    # ganhar o carimbo de conteúdo na URL: só o que é injetado e existe no disco é carimbado, e o
    # carimbo é o que garante que uma reinstalação não sirva a versão velha de nenhum cache do
    # caminho. Ele vem depois do SDK e do Tuff, porque é o SDK que ele chama.
    scripts=["galeria.js"],
    # Descomente se o seu app usa roteamento HTML5 (History API) em vez de fragmento:
    # rotas_profundas=True,
    dica="Rode o build do frontend antes de subir o backend.",
    ao_avisar=log,
)

# ── Estado do processo, compartilhado por todas as janelas ────────────────────
#
# Um difusor de SSE e um contador. É o menor estado possível que ainda prova o modelo: N janelas,
# um backend. Quem assina `api/events` entra no difusor; quem incrementa publica para todos.
difusor = eventos.Difusor()
_tranca = threading.Lock()
contador = 0
subiu_em = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
tarefa_em_curso = None


def estado():
    return {"contador": contador, "conexoes": difusor.assinantes, "subiuEm": subiu_em}


def difundir():
    difusor.publicar("estado", estado())


# A difusão genérica, para o que o backend recebe sem ninguém ter perguntado: o clique na bandeja e
# a ação de uma notificação chegam ao processo por POST, e é por aqui que uma janela aberta fica
# sabendo. Com nenhuma janela aberta, ninguém recebe, e o app recebeu do mesmo jeito.
def difundir_evento(nome, dado):
    difusor.publicar(nome, dado)


# ── O que o ambiente decidiu por este processo ────────────────────────────────
#
# Três coisas que o app DECLARA e o ambiente APLICA. As três se leem de dentro do processo, e é
# isso que as torna demonstráveis: o manifesto diz o que se pediu; isto aqui diz o que se recebeu.


def limites_do_cgroup():
    """O teto de memória que está VALENDO, lido do cgroup — não o que o manifesto pediu.

    A diferença é o ponto da demonstração. O manifesto declara; o `vssh-app-run` traduz para um
    escopo transitório do systemd; e um servidor sem gerenciador systemd do usuário não aplica nada
    (`loginctl enable-linger`). Ler o cgroup é a única resposta que não é suposição — e quando ela
    vem vazia, o app está rodando SEM limite, que é informação e não erro.
    """
    try:
        with open("/proc/self/cgroup", encoding="utf-8") as fh:
            linha = next((l for l in fh.read().split("\n") if l.startswith("0::")), None)
        if not linha:
            return {"contido": False, "motivo": "sem cgroup v2 neste servidor"}
        base = os.path.join("/sys/fs/cgroup", linha[3:].strip().lstrip("/"))

        def ler(nome):
            try:
                with open(os.path.join(base, nome), encoding="utf-8") as fh:
                    return fh.read().strip()
            except OSError:
                return None

        mem_max = ler("memory.max")
        return {
            # "max" é o valor que o kernel usa para "sem teto" — TEXTO, não número, e confundir os
            # dois faria um app sem limite parecer limitadíssimo.
            "contido": bool(mem_max) and mem_max != "max",
            "cgroup": linha[3:].strip(),
            "memoryMax": mem_max,
            "memoryHigh": ler("memory.high"),
            "tasksMax": ler("pids.max"),
            # Quanto o processo está usando AGORA. É o que transforma o teto de número em noção.
            "memoryCurrent": ler("memory.current"),
        }
    except OSError as err:
        # Não é Linux, ou o cgroupfs não está montado. "Não sei" é resposta, e é diferente de
        # "sem teto".
        return {"contido": None, "motivo": str(err)}


def gpu_do_ambiente():
    """A GPU, do ponto de vista deste processo: o que o lançador concedeu, e por que não.

    O `vssh-app-run` decide ao subir o app, com o que o servidor tem (fabricante pelo id do
    barramento, driver, virtual ou física, e se este usuário abre o render node) e com o que o
    manifesto pede, e registra a decisão. `gpu.concedida()` a lê; o app não vasculha `/sys` nem
    olha `CUDA_VISIBLE_DEVICES` para descobrir, porque a resposta do lançador é a que vale, e é a
    mesma que a janela recebe por `vssh.gpu.estado()` e que o gerenciador de tarefas mostra.

    `CUDA_VISIBLE_DEVICES` vai ao lado, e é outra coisa: o portão do runtime CUDA. Sozinho, o
    valor `""` é ambíguo (o mesmo para "escondida deste app" e para "não há placa"); ao lado da
    decisão, ele fica legível. Fora do lançador não há registro, e a resposta é "sem registro do
    lançador", que é informação e não erro.
    """
    return {**gpu.concedida(), "cudaVisibleDevices": os.environ.get("CUDA_VISIBLE_DEVICES")}


# ── A fila de processamento ───────────────────────────────────────────────────
#
# A quarta coisa que o app declara e o ambiente decide: `recursos.fila` no manifesto pede ao
# portal a credencial (`VSSH_PORTAL_URL` + `VSSH_PORTAL_TOKEN`), e com ela o backend manda um
# container ao cluster em vez de rodá-lo nesta máquina. A sonda abaixo é o menor trabalho que
# prova o caminho inteiro: `nvidia-smi` numa imagem CUDA, com uma GPU do cluster, e a tabela volta
# como arquivo de saída.

_sondas = {}
_tranca_da_fila = threading.Lock()


def _registrar_sonda(ident, evento=None, **campos):
    with _tranca_da_fila:
        atual = _sondas.setdefault(ident, {"id": ident, "eventos": [], "saida": None})
        if evento:
            atual["eventos"].append(evento)
        atual.update(campos)
        registro = dict(atual)
    difundir_evento("fila", registro)
    return registro


def sondar_fila():
    """Submete o `nvidia-smi` ao cluster e acompanha numa thread. Devolve o registro inicial.

    O comando escreve em `/vssh/saidas/placa.txt`, que é o que o pod sobe ao terminar; `baixar`
    traz o arquivo para o diretório de dados do app, e a galeria mostra o conteúdo. Uma GPU só
    entra no pedido quando o cluster oferece algum tipo: sem GPU o job roda do mesmo jeito e o
    `nvidia-smi` diz que não achou placa, o que também é uma medição.
    """
    oferta = fila.disponivel()
    if not oferta["disponivel"]:
        return {"ok": False, "motivo": oferta["motivo"]}
    tipo = (oferta["gpus"] or [{}])[0].get("tipo")
    trabalho = {
        "nome": "sonda-gpu",
        "imagem": "nvidia/cuda:12.6.0-base-ubuntu24.04",
        "comando": ["sh", "-c", "nvidia-smi > /vssh/saidas/placa.txt 2>&1"],
        "saidas": ["placa.txt"],
        "cpu": "1", "memoria": "1Gi", "prazo": 600,
    }
    if tipo:
        trabalho["gpu"] = {"quantidade": 1, "tipo": tipo}
    ident = fila.submeter(trabalho)
    registro = _registrar_sonda(ident, estado="enviado", gpu=tipo)

    def acompanhar():
        try:
            final = fila.acompanhar(ident, lambda evento, job: _registrar_sonda(
                ident, evento=f"{evento}: {job.get('estado')}" + (f" ({job['motivo']})" if job.get("motivo") else ""),
                estado=job.get("estado"), motivo=job.get("motivo")))
            saida = None
            if final.get("estado") == "concluido":
                destino = os.path.join(app.dados(), "fila", ident)
                for caminho in fila.baixar(ident, destino):
                    with open(caminho, encoding="utf-8", errors="replace") as fh:
                        saida = fh.read(4000)
            _registrar_sonda(ident, estado=final.get("estado"), motivo=final.get("motivo"),
                             exit=final.get("exit"), saida=saida, fim=True)
        except fila.ErroDaFila as err:
            _registrar_sonda(ident, estado="falhou", motivo=err.mensagem, fim=True)
        except Exception as err:  # noqa: BLE001
            _registrar_sonda(ident, estado="falhou", motivo=str(err), fim=True)

    threading.Thread(target=acompanhar, daemon=True).start()
    return {"ok": True, **registro}


def segredo():
    """O segredo do cofre — e **nunca o valor dele**.

    O que se devolve é: chegou, quantos caracteres tem, e um prefixo de hash que serve para
    conferir "é o mesmo que eu guardei?" sem que o valor atravesse a rede outra vez. É o hábito que
    se quer ensinar: um app que ecoa a própria credencial põe a credencial no log de alguém.
    """
    v = os.environ.get("HELLO_SEGREDO")

    # O COFRE em disco, lido só pelas CHAVES. Sem isto a peça só sabia olhar o ambiente, e aí "não
    # guardado" e "guardado depois deste processo subir" davam a MESMA resposta — que foi
    # exatamente o que se viu ao testar: guardar, reabrir a janela, e o cartão dizer que não há
    # nada. Reabrir a janela não reinicia o processo: a janela é uma view, o backend continua o
    # mesmo. E o ambiente de um processo é fixado no start.
    #
    # Só as CHAVES. O app já recebe os valores pelo ambiente; reler valores do arquivo não
    # acrescentaria nada e ensinaria o hábito errado a quem copia este template.
    no_cofre = None
    try:
        dados = os.environ.get("VSSH_APP_DATA_DIR")
        if dados:
            with open(os.path.join(dados, "..", "secrets.json"), encoding="utf-8") as fh:
                no_cofre = list(json.load(fh).keys())
    except (OSError, ValueError):
        no_cofre = None  # ausente ou ilegível é "não sei", não "vazio"

    if not v:
        guardado_agora = isinstance(no_cofre, list) and "HELLO_SEGREDO" in no_cofre
        return {
            "definido": False,
            "noCofre": guardado_agora,
            "leitura": (
                "JÁ ESTÁ GUARDADO no cofre — este processo é que subiu antes dele. Reabrir a "
                "janela não basta: a janela é uma view, o backend continua o mesmo. Pare e inicie "
                "o app (menu de contexto da janela, ou Configurações → Serviços) para ele receber "
                "o valor."
                if guardado_agora else
                'nada guardado — use o botão "guardar HELLO_SEGREDO" aqui em cima, e depois '
                "reinicie o app"
            ),
        }
    return {
        "definido": True,
        "tamanho": len(v),
        "sha256": hashlib.sha256(v.encode("utf-8")).hexdigest()[:12],
        "leitura": "chegou pelo ambiente; o valor não sai daqui",
    }


def _por_que_vaapi_falhou(stderr, dispositivo):
    """Traduz o stderr do ffmpeg no motivo, em português, de a GPU não ter codificado.

    Existe porque as causas pedem ações OPOSTAS e chegam parecidas: uma se conserta instalando um
    driver, outra dando permissão, e a mais comum não se conserta de jeito nenhum — a placa
    simplesmente não tem encoder de vídeo, que é o caso de praticamente toda GPU virtual.
    """
    s = (stderr or "").lower()
    if not s:
        return None

    # ── NVENC primeiro: os erros dele têm nome próprio e não se confundem com os do VA-API ──
    if "h264_nvenc" in s and "unknown encoder" in s:
        return "este ffmpeg foi compilado SEM NVENC — é do pacote, não do servidor nem da placa"
    if "libnvidia-encode" in s or "libcuda.so" in s:
        return ("o userspace NVIDIA está incompleto — falta a libnvidia-encode.so.1, que vem com o "
                "driver. Num container ou LXC ela precisa ter sido montada do host junto com o resto")
    if "nvenc api version" in s:
        return "o driver NVIDIA é mais velho que o NVENC deste ffmpeg — atualizar o driver resolve"
    if "no capable devices" in s or "no nvenc capable devices" in s:
        return ("nenhuma placa com NVENC alcançável — ou `/dev/nvidia*` não está neste ambiente, ou "
                "esta placa não tem motor de codificação (A100 e H100 não têm; é computação, não vídeo)")
    if "out of memory (10)" in s or "openencodesessionex failed" in s:
        return ("a placa recusou mais uma sessão de NVENC — placa de consumo limita as sessões "
                "simultâneas, e outra coisa neste servidor já as ocupa")

    if "unknown encoder" in s:
        return "este ffmpeg foi compilado SEM VAAPI — é do pacote, não do servidor nem da placa"
    if "permission denied" in s:
        return "sem permissão no render node — falta o grupo `render` (usermod -aG render <usuario>)"

    # O diagnóstico usa o que a DESCOBERTA já sabe. A primeira versão não recebia o dispositivo e
    # por isso hesitava — "instale o driver, SE ela for física" — mesmo tendo a resposta a uma
    # função de distância. Num servidor real isso mandou procurar pacote para uma virtio, onde
    # nenhum pacote resolve.
    virtual = bool(dispositivo and dispositivo.get("virtual") is True)
    nao_inicializou = any(x in s for x in ("vainitialize", "no va display", "failed to initialise",
                                           "failed to create", "not implemented"))
    sem_entrypoint = any(x in s for x in ("entrypoint", "not supported", "unsupported"))

    if virtual and (nao_inicializou or sem_entrypoint):
        # Definitivo, e de propósito: uma resposta que deixa esperança onde não há custa mais que
        # uma resposta ruim. Quem lê isto precisa parar de procurar pacote e trocar de servidor.
        quem = dispositivo.get("fabricante") or dispositivo.get("driver")
        return (f"esta é uma GPU VIRTUAL ({quem}) — ela NÃO implementa VA-API, e nenhum pacote "
                "resolve. Ela existe para desenhar tela, não para codificar vídeo: para isso, "
                "outro servidor.")
    if nao_inicializou and (dispositivo or {}).get("fabricante") == "NVIDIA":
        # É a NVIDIA que mais engana: `vainfo` instalado, libva respondendo, e nada codifica. Não
        # é driver faltando — é a API errada. O pacote de VA-API que existe para ela só decodifica.
        return ("NVIDIA não codifica por VA-API — o driver proprietário não a implementa, e nenhum "
                "pacote muda isso. O caminho é o NVENC (`h264_nvenc`), que este benchmark escolhe "
                "sozinho quando a descoberta diz `video: nvenc`")
    if nao_inicializou:
        return ("a VA-API não inicializou — driver ausente ou incompleto para esta placa "
                "(mesa-va-drivers para AMD, intel-media-va-driver para Intel)")
    if sem_entrypoint:
        return "a placa não expõe entrypoint de ENCODE para este perfil"
    return None


def _o_que_a_placa_sabe(alvo):
    """O que a placa DIZ que sabe fazer, pela ferramenta do caminho dela.

    NVENC não tem `vainfo`: quem responde é o próprio ffmpeg, listando os codificadores `*_nvenc`
    que ele carrega. É menos que um inventário de perfis, e é a pergunta certa — "este ffmpeg
    fala com esta placa?" —, que é onde a NVIDIA costuma falhar (userspace incompleto no container).
    """
    if alvo.get("video") == "nvenc":
        try:
            saida = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"],
                                   capture_output=True, text=True, timeout=15, check=True).stdout
            linhas = [l.strip() for l in saida.split("\n") if "nvenc" in l]
            return {"tem": True, "ferramenta": "ffmpeg -encoders", "entrypoints": linhas[:40],
                    "codifica": any("h264_nvenc" in l for l in linhas)}
        except (OSError, subprocess.SubprocessError) as err:
            return {"tem": False, "ferramenta": "ffmpeg -encoders",
                    "motivo": str(getattr(err, "stderr", None) or err).split("\n")[0][:200]}

    node = alvo.get("renderNode")
    try:
        saida = subprocess.run(["vainfo", "--display", "drm", "--device", node],
                               capture_output=True, text=True, timeout=15, check=True).stdout
        perfis = [l.strip() for l in saida.split("\n") if "VAEntrypoint" in l]
        return {"tem": True, "ferramenta": "vainfo", "entrypoints": perfis[:40],
                "codifica": any(re.search(r"VAEntrypointEnc", l) for l in perfis)}
    except (OSError, subprocess.SubprocessError) as err:
        # `vainfo` ausente é o caso COMUM e não é erro — ele não vem instalado por padrão. Devolver
        # o erro cru seria jogar na cara de quem lê um detalhe de implementação em vez da única
        # coisa acionável: instale o pacote e a pergunta fica respondida.
        bruto = getattr(err, "stderr", None) or str(err)
        return {
            "tem": False,
            "ferramenta": "vainfo",
            "motivo": ("o `vainfo` não está instalado neste servidor — `apt-get install -y vainfo` "
                       "e esta peça passa a listar o que a placa sabe fazer"
                       if isinstance(err, FileNotFoundError) else str(bruto).split("\n")[0][:200]),
        }


# Quadros da execução CURTA de cada lado: o bastante para o ffmpeg passar da partida, pouco o
# bastante para não custar nada. A diferença entre ela e a longa é o regime.
_AQUECER = 30


def benchmark_gpu(frames=300):
    """Descobrir não basta: um inventário não diz se a placa serve para alguma coisa.

    **Por que ffmpeg, e não CUDA.** Um benchmark de CUDA só roda onde há CUDA. O ffmpeg fala com
    qualquer placa — VA-API para Intel e AMD pelo render node do DRM, NVENC para NVIDIA — e é um
    pacote, não um SDK: por isso este template o DECLARA em `requiredPackages`, e o ambiente
    confere antes de instalar.

    **O codificador é escolhido pelo `video` da descoberta, e não é detalhe.** A primeira versão
    só sabia `h264_vaapi`, e num servidor NVIDIA de verdade — com `vainfo` instalado e a libva
    respondendo — ela dizia "driver ausente" para uma placa que codifica fino. Não era driver:
    era a API errada.

    **O número útil é a RAZÃO.** "180 fps" sozinho não diz nada — depende do vídeo, do preset, da
    máquina. O mesmo trabalho em CPU e em GPU responde a pergunta que se tem de fato: *vale a pena
    usar a placa deste servidor?*

    **E são DUAS razões, porque a de parede sozinha mentiu num servidor de verdade.** Uma RTX
    A5500 ao lado de um Ryzen de 16 núcleos deu 366 fps contra 507 — e a leitura chamou a placa de
    "virtual". Dois erros na mesma linha:

      - o clipe tem 10 s, e abrir o contexto CUDA mais a sessão do NVENC custa centenas de ms UMA
        vez. Num filme isso some; aqui era metade da medida. Por isso cada lado roda duas vezes,
        curta e longa, e o que se reporta é a DIFERENÇA (o regime) com a partida à parte;
      - 507 fps de x264 são 16 núcleos a 100%; 366 de NVENC são um. No ambiente o transcode corre
        ao LADO do desktop de quem está trabalhando — o que a placa compra é deixar o processador
        livre, e um benchmark que não mede tempo de processador não vê isso. `getrusage` dos
        filhos é a medida, e a razão entre os dois lados é a segunda resposta.
    """
    # O dispositivo concedido, e não só o caminho dele: o diagnóstico da falha precisa saber se a
    # placa é virtual para responder em vez de hesitar.
    alvo = next((d for d in gpu.concedida()["dispositivos"] if d["acesso"] == "ok"), None)
    node = alvo["renderNode"] if alvo else None

    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5, check=True)
    except (OSError, subprocess.SubprocessError):
        return {"rodou": False,
                "motivo": "ffmpeg não está neste servidor — o app o declara em requiredPackages, "
                          "então o instalador deveria ter recusado"}

    def rodar(args, rotulo):
        antes = resource.getrusage(resource.RUSAGE_CHILDREN) if resource else None
        t0 = time.perf_counter()
        try:
            # **stderr é CAPTURADO.** Descartá-lo deixa só "Command failed: ffmpeg …" — a linha de
            # comando truncada, que não diz absolutamente nada sobre o que houve. Num servidor real
            # isso virou "a GPU não codificou" sem uma pista de por quê.
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", *args],
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                           timeout=60, check=True)
        except subprocess.CalledProcessError as err:
            saida = (err.stderr or b"").decode("utf-8", "replace").strip()
            return {"rotulo": rotulo, "ok": False,
                    # As ÚLTIMAS linhas: o ffmpeg põe a causa no fim, e o começo costuma ser ruído.
                    "erro": (" · ".join(saida.split("\n")[-4:])[:400] if saida else str(err)[:200]),
                    "diagnostico": _por_que_vaapi_falhou(saida, alvo)}
        except (OSError, subprocess.SubprocessError) as err:
            return {"rotulo": rotulo, "ok": False, "erro": str(err)[:200], "diagnostico": None}
        ms = (time.perf_counter() - t0) * 1000
        cpu_ms = None
        if antes:
            depois = resource.getrusage(resource.RUSAGE_CHILDREN)
            cpu_ms = ((depois.ru_utime - antes.ru_utime) + (depois.ru_stime - antes.ru_stime)) * 1000
        return {"rotulo": rotulo, "ok": True, "ms": round(ms),
                "cpuMs": round(cpu_ms) if cpu_ms is not None else None}

    def medir(args_de, rotulo):
        """Duas execuções, curta e longa; a diferença é o regime, e a sobra da curta é a partida.

        `fps` é o do REGIME: o que um filme inteiro veria. `partida` é o que se paga uma vez por
        transcode — e é ela que, somada à média, fazia o NVENC parecer mais lento que a CPU.
        """
        curta = rodar(args_de(_AQUECER), rotulo)
        if not curta["ok"]:
            return curta
        longa = rodar(args_de(frames), rotulo)
        if not longa["ok"]:
            return longa
        delta, quadros = longa["ms"] - curta["ms"], frames - _AQUECER
        if delta <= 0:
            # Ruído maior que a medida: reporta a média crua, sem inventar partida.
            fps, partida = frames / max(longa["ms"], 1) * 1000, 0
        else:
            fps = quadros / delta * 1000
            partida = max(0.0, curta["ms"] - _AQUECER / fps * 1000)
        return {**longa, "fps": round(fps), "partida": round(partida)}

    # `testsrc` é gerado pelo próprio ffmpeg: sem arquivo de entrada, sem download, sem depender de
    # nada em disco. Saída para /dev/null — o que se mede é o encode, não o I/O.
    def fonte(n):
        return ["-f", "lavfi", "-i", f"testsrc=size=1280x720:rate=30:duration={n / 30}"]

    cpu = medir(lambda n: [*fonte(n), "-c:v", "libx264", "-preset", "veryfast", "-f", "null", "-"], "cpu")
    # Sem `-hwaccel`: aquilo é para DECODIFICAR em hardware, e a fonte aqui é gerada pelo próprio
    # ffmpeg. Pedi-lo faz o erro falar do decode em vez do encode que se queria medir.
    if not node:
        gpu_res = {"rotulo": "gpu", "ok": False,
                   "erro": "nenhum render node acessível — ver o inventário acima"}
    elif alvo.get("video") == "nvenc":
        # NVENC não usa o render node: o ffmpeg abre `/dev/nvidiactl` sozinho, e o quadro vai em
        # memória de sistema — o próprio codificador o sobe para a placa.
        gpu_res = medir(lambda n: [*fonte(n), "-vf", "format=nv12", "-c:v", "h264_nvenc",
                                   "-f", "null", "-"], "gpu")
    elif alvo.get("video") == "vaapi":
        gpu_res = medir(lambda n: ["-vaapi_device", node, *fonte(n), "-vf", "format=nv12,hwupload",
                                   "-c:v", "h264_vaapi", "-f", "null", "-"], "gpu")
    else:
        # Virtual, ou driver que a descoberta não conhece. Tentar VA-API aqui é o que produzia
        # "driver ausente" numa placa que não tem, nem vai ter, codificador.
        gpu_res = {"rotulo": "gpu", "ok": False,
                   "erro": (f"{alvo.get('fabricante')} ({alvo.get('driver') or 'sem driver'}) não "
                            "codifica vídeo por caminho nenhum que este benchmark conheça — "
                            + ("é uma placa VIRTUAL, ela existe para desenhar tela"
                               if alvo.get("virtual") else "driver fora da tabela da descoberta"))}

    # A razão só existe quando os DOIS lados mediram. Inventar um número a partir de um lado que
    # falhou seria pior que não ter número nenhum.
    ganho = (round(gpu_res["fps"] / cpu["fps"], 2)
             if cpu["ok"] and gpu_res["ok"] and cpu["fps"] > 0 else None)
    # Quantas vezes menos processador a placa gasta pelo mesmo trabalho. É a razão que importa num
    # servidor compartilhado, e é `None` quando não deu para medir — nunca um chute.
    economia = (round(cpu["cpuMs"] / gpu_res["cpuMs"], 1)
                if ganho is not None and cpu.get("cpuMs") and gpu_res.get("cpuMs") else None)
    # Só quando falhou, e só quando há placa: perguntar "o que você sabe fazer?" a uma placa que
    # acabou de codificar seria gastar segundos para confirmar o óbvio.
    capacidades = _o_que_a_placa_sabe(alvo) if (not gpu_res["ok"] and node) else None

    if ganho is None:
        leitura = ("não deu para comparar" if gpu_res["ok"] else
                   # O diagnóstico primeiro, o stderr depois. Quem lê quer saber o que FAZER.
                   f"a GPU não codificou — {gpu_res.get('diagnostico') or gpu_res.get('erro')}")
    elif ganho >= 1.2:
        leitura = (f"a GPU deste servidor é {ganho}× mais rápida que a CPU neste trabalho"
                   + (f", gastando {economia}× menos processador" if economia else ""))
    elif economia and economia >= 3:
        # O caso da placa boa ao lado de uma CPU enorme. Parede a CPU ganha; processador a placa
        # ganha de longe — e é o processador que o resto do ambiente está usando.
        nucleos = os.cpu_count() or 1
        leitura = (f"a GPU é mais lenta que ESTA CPU em parede ({ganho}×) — são {nucleos} núcleos "
                   f"contra um motor de vídeo — mas gasta {economia}× menos processador. Num "
                   "servidor compartilhado é isso que vale: o transcode corre sem tirar os núcleos "
                   "de quem está trabalhando")
    elif ganho <= 0.8:
        # Sem "placa virtual" aqui: uma virtual nem chega a medir (`video` é None). Era esta frase,
        # solta para qualquer razão baixa, que chamou uma RTX A5500 de placa virtual.
        leitura = (f"a GPU é MAIS LENTA que a CPU aqui ({ganho}×)"
                   + (" e não poupa processador" if economia else "")
                   + " — esta placa não compensa neste trabalho")
    else:
        leitura = f"empate técnico ({ganho}×) — a GPU deste servidor não compensa neste trabalho"

    return {"rodou": True, "frames": frames, "renderNode": node,
            "video": alvo.get("video") if alvo else None,
            "cpu": cpu, "gpu": gpu_res, "ganho": ganho, "economia": economia,
            "capacidades": capacidades, "leitura": leitura}


class Pedido(servidor.Pedido):
    """O handler do app. A base traz o HTTP/1.1 com keep-alive, o log calado por pedido, o portão
    do `X-Vssh-App-Token` (403 com `X-Vssh-Token: recusado`, em tempo constante) e o `GET /saude`
    com `{ok, versao, pid}`; quando `atender` é chamado, os dois já passaram.

    O `/saude` é o que o lifecycle sonda, até 15x/1s, segurando o clique de "abrir app"; a sondagem
    vai com o token, e a resposta não toca em nada, então ela diz só se o processo subiu. O que não
    conta como pronto é 000, 5xx e 401/403. O socket é 0600 do dono, e ainda assim outro processo
    do mesmo usuário Linux o alcança: um app que dá acesso sensível (shell, arquivos) confere o
    token; um app trivial pode não conferir, e aí basta não herdar desta base.
    """

    # ── plumbing ─────────────────────────────────────────────────────────────

    def _json(self, status, corpo):
        # Separadores compactos, porque é o que o `JSON.stringify` do template Node escreve, e o
        # mesmo app produz os mesmos bytes nos dois runtimes.
        dados_ = json.dumps(corpo, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dados_)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados_)

    def _corpo(self):
        """O corpo JSON de uma requisição, para os POSTs que o ambiente faz no seu backend.

        Corpo ilegível vira `{}` em vez de erro, de propósito: estas rotas existem para reagir a um
        clique do usuário, e derrubar a reação porque o JSON veio torto seria perder o gesto dele.
        """
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
            if tamanho <= 0 or tamanho > 64 * 1024:
                return {}
            return json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except (ValueError, OSError, UnicodeDecodeError):
            return {}

    # ── roteamento ───────────────────────────────────────────────────────────

    def atender(self, metodo):
        global contador, tarefa_em_curso
        partes = urlsplit(self.path)
        caminho = partes.path

        try:
            # ── A tarefa longa, e o ciclo completo de uma atividade ────────────
            #
            #  1. `avisos.atividade` a cada passo, com a mesma chave: ela reescreve no lugar;
            #  2. a renovação do `at`, ligada uma vez no boot por `manter_atividades_vivas()`;
            #  3. `limpar_atividade` com `registrar` no fim: a atividade some e deixa uma
            #     notificação.
            #
            # `?lento=1` é o que torna a decisão 2 observável: oito passos de 10 s passam de 80 s,
            # bem além do TTL de 60 s. Com a renovação ligada, a barra atravessa; sem ela, some no
            # meio sozinha, que é o defeito que dorme numa demonstração de seis segundos.
            if caminho == "/api/tarefa-longa" and metodo == "POST":
                lento = parse_qs(partes.query).get("lento", [None])[0] == "1"
                intervalo = 10.0 if lento else 0.8
                total = 8

                if tarefa_em_curso:
                    tarefa_em_curso.set()
                parar = threading.Event()
                tarefa_em_curso = parar

                def rodar():
                    for feito in range(1, total + 1):
                        if parar.is_set():
                            return
                        avisos.atividade("exemplo-backend", {
                            "titulo": "Tarefa do backend",
                            "texto": f"passo {feito}" + (" (devagar, atravessa o TTL)" if lento else ""),
                            "formato": "progresso",
                            "progresso": {"feito": feito, "total": total},
                        })
                        if feito < total:
                            parar.wait(intervalo)
                    avisos.limpar_atividade("exemplo-backend", registrar={
                        "titulo": "Tarefa concluída", "texto": f"{total} passos", "level": "success"})

                threading.Thread(target=rodar, daemon=True).start()
                self._json(202, {"iniciada": True, "total": total,
                                 "intervalo": int(intervalo * 1000),
                                 "duracaoMs": int(total * intervalo * 1000)})
                return

            # Uma notificação de backend com `chave` estável. O portal lê uma janela do fim do
            # journal, e não um delta, então é a chave que impede o mesmo aviso de chegar a cada
            # tick. Chamar isto dez vezes no mesmo dia rende uma notificação.
            if caminho == "/api/avisar" and metodo == "POST":
                hoje = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                avisos.notificar("O disco do servidor está acima de 90%.",
                                 titulo="Hello World", nivel="warning", chave=f"disco-cheio-{hoje}")
                self._json(200, {"notificada": True, "key": f"disco-cheio-{hoje}"})
                return

            # Uma notificação com ação. A diferença para a de cima é a `rota`: sem ela, o botão da
            # notificação não teria para onde mandar a resposta. O clique pode acontecer com o app
            # sem janela nenhuma aberta.
            if caminho == "/api/avisar-com-acao" and metodo == "POST":
                avisos.notificar("O índice está desatualizado. Reconstruir agora?",
                                 titulo="Hello World", nivel="warning", persistente=True,
                                 acoes=[{"id": "reconstruir", "label": "Reconstruir"}],
                                 rota="/api/acao", chave=f"indice-{int(time.time() * 1000)}")
                self._json(200, {"notificada": True, "acao": "reconstruir", "rota": "/api/acao"})
                return

            # O destino da ação. Quem faz este POST é o desktop, não o seu frontend.
            if caminho == "/api/acao" and metodo == "POST":
                corpo = self._corpo()
                # Aninhado, e não espalhado: o corpo que o ambiente manda tem chaves próprias, e
                # espalhá-las por cima do registro sequestraria o nome do evento no log.
                log("acao-de-notificacao", {"acao": corpo})
                difundir_evento("acao", {**corpo, "em": datetime.now(timezone.utc).isoformat()})
                self._json(200, {"ok": True})
                return

            # ── A bandeja pela lib, e o clique que volta ────────────────────
            if caminho == "/api/bandeja" and metodo == "POST":
                ok = avisos.bandeja({
                    "icon": "refresh",
                    "tooltip": "Hello World, posto pelo backend",
                    "badge": {"dot": True},
                    "menu": [
                        {"id": "oi", "label": "Um item do menu"},
                        {"separator": True},
                        {"id": "sair", "label": "Remover este ícone", "danger": True},
                    ],
                    # Só dados atravessam o arquivo: aqui vai uma rota, e não uma função.
                    "onClick": {"path": "/api/bandeja/clique"},
                })
                self._json(200, {"ok": ok,
                                 "motivo": None if ok else "sem VSSH_APP_DATA_DIR nem VSSH_APP_ID"})
                return

            if caminho == "/api/bandeja" and metodo == "DELETE":
                avisos.limpar_bandeja()
                self._json(200, {"ok": True})
                return

            if caminho == "/api/bandeja/clique" and metodo == "POST":
                corpo = self._corpo()
                log("clique-na-bandeja", {"clique": corpo})
                if corpo.get("menuId") == "sair":
                    avisos.limpar_bandeja()
                difundir_evento("bandeja", corpo)
                self._json(200, {"ok": True})
                return

            # O filesystem privado, servido pela lib. Ela devolve `True` quando atendeu, o mesmo
            # contrato do `spa`, e pela mesma razão: quem compõe as rotas é o app, e não a lib.
            if servir_privado(self):
                return

            if caminho == "/api/ping":
                self._json(200, {"pong": True, "appId": APP_ID,
                                 "time": datetime.now(timezone.utc).isoformat(
                                     timespec="milliseconds").replace("+00:00", "Z")})
                return

            # Exemplo de SSE. Prove que eventos chegam sem buffer: `curl -N <baseUrl>api/events`.
            #
            # O stream entra no difusor, e é isso que faz a demonstração de "duas janelas, um
            # backend" funcionar: quem incrementa é uma janela, e a difusão alcança todas as
            # outras. Este laço segura a thread do pedido, e é assim que tem de ser: em
            # `http.server`, retornar do handler fecha a conexão, e o `EventSource` do navegador
            # reconectaria em laço sem um erro sequer do lado do servidor. A escrita que falha
            # marca o stream como fechado, e o difusor o esquece.
            if caminho == "/api/events":
                fluxo = difusor.assinar(self)
                fluxo.enviar("estado", estado())
                n = 0
                try:
                    while not fluxo.fechado:
                        time.sleep(1.0)
                        n += 1
                        fluxo.enviar("tick", {"n": n, "time": datetime.now(timezone.utc).isoformat()})
                finally:
                    fluxo.fechar()
                    difundir()
                return

            # ── Duas janelas, um backend ────────────────────────────────────
            #
            # O contador vive AQUI, no processo. Duas janelas do mesmo app são duas visões deste
            # mesmo processo — mesmo socket, mesmo token, mesmo VSSH_APP_DATA_DIR.
            if caminho == "/api/estado" and metodo == "GET":
                self._json(200, estado())
                return

            if caminho == "/api/estado/incrementar" and metodo == "POST":
                with _tranca:
                    contador += 1
                difundir()
                self._json(200, estado())
                return

            # ── O que o AMBIENTE decidiu por este processo ──────────────────
            if caminho == "/api/runtime":
                self._json(200, {"limites": limites_do_cgroup(), "gpu": gpu_do_ambiente(),
                                 "segredo": segredo()})
                return

            # O benchmark fica numa rota À PARTE, e num POST. Ele leva segundos e queima CPU:
            # pendurá-lo no `/api/runtime` faria toda abertura da galeria pagar por um número que
            # ninguém pediu.
            if caminho == "/api/gpu/benchmark" and metodo == "POST":
                self._json(200, benchmark_gpu())
                return

            # A fila: o que este servidor oferece (cluster, GPUs, quotas), e por que não.
            if caminho == "/api/fila" and metodo == "GET":
                self._json(200, fila.disponivel())
                return

            # A sonda: um job de verdade no cluster. POST, porque cria trabalho lá fora.
            if caminho == "/api/fila/sonda" and metodo == "POST":
                try:
                    self._json(200, sondar_fila())
                except fila.ErroDaFila as err:
                    self._json(200, {"ok": False, "motivo": f"o portal recusou ({err.status}): {err.mensagem}"})
                return

            if caminho.startswith("/api/fila/sonda/") and metodo == "GET":
                with _tranca_da_fila:
                    registro = _sondas.get(caminho[len("/api/fila/sonda/"):])
                if registro is None:
                    self._json(404, {"error": "sonda desconhecida"})
                else:
                    self._json(200, registro)
                return

            # O spa devolve False quando não atendeu: 404 é decisão de quem compõe as rotas.
            if spa(self):
                return

            corpo = "não encontrado\n".encode("utf-8")
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(corpo)

        except Exception as err:  # noqa: BLE001
            # Sem isto, uma falha derruba a thread da requisição sem deixar rastro nenhum, e o
            # lifecycle só mostra que o app "não respondeu".
            import traceback

            log("request-failed", {"path": caminho, "message": str(err),
                                   "stack": traceback.format_exc()})
            try:
                self._json(500, {"error": "erro interno"})
            except OSError:
                pass


def main():
    # `servidor.escutar` lê `$VSSH_APP_SOCKET`, limpa um socket órfão por tentativa de conexão, põe
    # o modo 0600, anuncia `[<id>] versão <v> escutando em <onde>` no stdout e atende até o
    # processo acabar. Com `--tcp host:porta` na linha de comando ele abre uma porta, para a
    # bancada. O código de saída é dele: `0` no fim normal e também quando outra instância já
    # atende (o lifecycle lê `0` como "está de pé"), `2` quando não há onde escutar.
    log("boot", {"appId": APP_ID, "tokenRequired": bool(os.environ.get("VSSH_APP_TOKEN"))})
    return servidor.escutar(Pedido, sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
