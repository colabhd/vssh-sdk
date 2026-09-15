"""O backend do template Python, medido EXECUTANDO as funções dele.

O par de `tests/template-galeria.test.js`, que faz o mesmo do lado Node — só que lá é preciso
recortar o fonte e passar por `new Function`, e aqui basta importar. O que se mede é idêntico, e
não por acaso: são as mesmas perguntas, porque é o mesmo app.

A junção entre marcação, comportamento e rotas NÃO é medida aqui: ela vale para os dois templates
de uma vez, e quem a garante é `tests/galeria-paridade.test.js` (as peças e as rotas são as mesmas)
somado ao `tests/template-galeria.test.js` (elas se encontram). Repetir aqui seria uma terceira
cópia da mesma pergunta, com uma a mais para esquecer de atualizar.
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
import unittest.mock

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEMPLATE = os.path.join(RAIZ, "templates", "hello-vssh-app")

# O runtime `vssh` que o `backend/main.py` importa: o do `PYTHONPATH` quando há um (a fonte, ou o
# que `scripts/ambiente-de-dev.sh` exporta), e a cópia gerada em `runtime/python` deste checkout
# quando não há. Um checkout esparso sem nenhum dos dois não tem o que medir: o módulo inteiro se
# pula dizendo o que falta, em vez de reprovar por ausência de ambiente.
RUNTIME = os.path.join(RAIZ, "runtime", "python")
if importlib.util.find_spec("vssh") is None and os.path.isdir(os.path.join(RUNTIME, "vssh")):
    sys.path.insert(0, RUNTIME)
SEM_LIBS = None if importlib.util.find_spec("vssh") else (
    "sem o runtime `vssh` neste checkout: o canal do sistema o escreve em runtime/python, ou "
    "exporte PYTHONPATH")


def carregar_backend(env):
    """Importa o `backend/main.py` com um ambiente controlado, e o DEIXA aplicado.

    O módulo faz trabalho no nível de topo (log, fs privado, spa), e é isso que se quer: se algum
    desses passos quebrar num ambiente magro, o app não sobe — e este import falharia junto, que é
    a resposta certa.

    O ambiente continua valendo depois do import porque as funções o leem NA CHAMADA — como o
    `process.env` do lado Node. Restaurá-lo aqui mediria um processo que já não é o do app: foi
    exatamente o que a primeira versão deste arquivo fez, e ela reprovou o `segredo()` por não
    encontrar uma variável que o próprio teste tinha acabado de tirar. Quem desfaz é o `tearDown`.
    """
    patcher = unittest.mock.patch.dict(os.environ, env, clear=True)
    patcher.start()
    try:
        spec = importlib.util.spec_from_file_location(
            "hello_backend", os.path.join(TEMPLATE, "backend", "main.py"))
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
    except Exception:
        patcher.stop()
        raise
    return modulo, patcher


@unittest.skipIf(SEM_LIBS, SEM_LIBS)
class BaseTemplate(unittest.TestCase):
    def setUp(self):
        self._patcher = None

    def tearDown(self):
        if self._patcher:
            self._patcher.stop()

    def carregar(self, extra=None):
        tmp = tempfile.mkdtemp(prefix="vssh-tpl-")
        env = {
            "VSSH_APP_ID": "hello-world",
            "VSSH_APP_DATA_DIR": os.path.join(tmp, "data"),
            "HOME": tmp,
            "PATH": os.environ.get("PATH", ""),
        }
        env.update(extra or {})
        self.tmp = tmp
        modulo, self._patcher = carregar_backend(env)
        return modulo


class TestSegredo(BaseTemplate):
    """A peça mais fácil de estragar da galeria, porque estragá-la não quebra nada.

    Bastaria devolver o valor do segredo junto com o resto e a demonstração continuaria
    "funcionando" — só teria virado exatamente o hábito que ela existe para ensinar a não ter.
    """

    def test_o_backend_NUNCA_devolve_o_valor_do_segredo(self):
        m = self.carregar({"HELLO_SEGREDO": "sk-nao-pode-vazar-9f8e7d"})
        r = m.segredo()
        self.assertTrue(r["definido"])
        self.assertNotIn("sk-nao-pode-vazar", json.dumps(r),
                         "o valor do segredo atravessou a rota — é assim que uma credencial vai "
                         "parar no log de alguém")
        self.assertEqual(r["tamanho"], len("sk-nao-pode-vazar-9f8e7d"))
        # Sem o prefixo de hash não dá para responder "é o mesmo que eu guardei?".
        self.assertRegex(r["sha256"], r"^[0-9a-f]{12}$")

    def test_a_ausencia_diz_O_QUE_FAZER(self):
        m = self.carregar()
        r = m.segredo()
        self.assertFalse(r["definido"])
        self.assertIn("reinicie", r["leitura"].lower())

    def test_guardado_no_cofre_e_ausente_do_ambiente_e_o_TERCEIRO_estado(self):
        # O caso que pareceu defeito ao testar num servidor: guardar, reabrir a janela, e a peça
        # dizer que não havia nada. Reabrir a janela não reinicia o processo — a janela é uma view,
        # o backend continua o mesmo —, e o ambiente de um processo é fixado no start.
        #
        # Olhando só o ambiente, "nunca guardado" e "guardado depois deste processo subir" dão a
        # MESMA resposta. E a segunda é a única em que a pessoa fez tudo certo, o que a torna a
        # mais cara de diagnosticar: ela conclui que o cofre não funciona.
        tmp = tempfile.mkdtemp(prefix="vssh-cofre-")
        dados = os.path.join(tmp, "data")
        os.makedirs(dados, exist_ok=True)
        with open(os.path.join(tmp, "secrets.json"), "w", encoding="utf-8") as fh:
            json.dump({"HELLO_SEGREDO": "sk-x"}, fh)

        m, self._patcher = carregar_backend({"VSSH_APP_ID": "hello-world", "VSSH_APP_DATA_DIR": dados,
                                             "HOME": tmp, "PATH": os.environ.get("PATH", "")})
        r = m.segredo()
        self.assertFalse(r["definido"])
        self.assertTrue(r["noCofre"], "a peça não olha o cofre em disco: o estado do meio some")
        self.assertRegex(r["leitura"], r"J[ÁA] EST[ÁA] GUARDADO")
        # E só as chaves: o valor não pode aparecer em lugar nenhum da resposta.
        self.assertNotIn("sk-x", json.dumps(r), "a peça leu o VALOR do cofre em disco")


class TestLimites(BaseTemplate):
    def test_o_limite_mostrado_vem_do_CGROUP_e_nao_do_manifesto(self):
        # É a demonstração inteira: o manifesto diz o que se PEDIU, o cgroup diz o que se RECEBEU.
        # Ler o próprio manifesto aqui daria sempre a resposta bonita — inclusive num servidor onde
        # nada foi aplicado, que é justamente o caso que a peça precisa saber mostrar.
        import inspect

        m = self.carregar()
        fonte = inspect.getsource(m.limites_do_cgroup)
        self.assertIn("/proc/self/cgroup", fonte)
        self.assertIn("memory.max", fonte)
        self.assertNotIn("vssh-app.json", fonte)
        self.assertNotIn("resources", fonte)
        # "max" é o valor do kernel para "sem teto", e é TEXTO. Confundi-lo com número faria um app
        # sem limite nenhum aparecer como limitadíssimo.
        self.assertIn('!= "max"', fonte)

    def test_nao_sei_e_diferente_de_sem_teto(self):
        m = self.carregar()
        r = m.limites_do_cgroup()
        # Num Linux com cgroup v2 responde `contido`; sem cgroupfs, `contido: None` com motivo. O
        # que NÃO pode acontecer é os dois casos virarem `False`, que significa "medi, e não há
        # limite".
        self.assertIn(r["contido"], (True, False, None))
        if r["contido"] is None:
            self.assertIn("motivo", r)


class TestGpu(BaseTemplate):
    """A GPU é o que o lançador concedeu, lido do registro dele; o app não vasculha `/sys`."""

    def _conceder(self, *dispositivos):
        """O registro que o `vssh-app-run` deixa ao lado do diretório de dados, com a decisão."""
        with open(os.path.join(self.tmp, "limits.json"), "w", encoding="utf-8") as fh:
            json.dump({"gpu": "concedida", "gpuInfo": {"dispositivos": list(dispositivos)}}, fh)

    def test_sem_registro_do_lancador_a_resposta_e_nao_com_motivo(self):
        # O app subiu por fora do lançador (a bancada, o `--tcp` de quem desenvolve). Não há
        # decisão a ler, e a peça diz isso; inventar um inventário seria a peça mentindo sobre o
        # que o ambiente decidiu.
        m = self.carregar()
        r = m.gpu_do_ambiente()
        self.assertFalse(r["concedida"])
        self.assertIn("registro", r["motivo"])
        self.assertEqual(r["dispositivos"], [])
        self.assertIn("cudaVisibleDevices", r)

    def test_o_que_o_lancador_concedeu_e_o_que_a_peca_mostra(self):
        m = self.carregar({"CUDA_VISIBLE_DEVICES": "0"})
        self._conceder(
            {"card": "card0", "fabricante": "AMD", "driver": "amdgpu", "virtual": False,
             "video": "vaapi", "renderNode": "/dev/dri/renderD128", "acesso": "ok"},
            {"card": "card1", "fabricante": "NVIDIA", "driver": "nvidia", "virtual": False,
             "video": "nvenc", "renderNode": "/dev/dri/renderD129", "acesso": "negado"},
        )
        r = m.gpu_do_ambiente()
        self.assertTrue(r["concedida"])
        self.assertIsNone(r["motivo"])
        # Só o que este processo abre: a placa sem acesso não entra no que se pode usar.
        self.assertEqual([d["card"] for d in r["dispositivos"]], ["card0"])
        self.assertEqual(r["cudaVisibleDevices"], "0")

    def test_a_falha_da_GPU_e_CLASSIFICADA_porque_as_causas_pedem_acoes_OPOSTAS(self):
        m = self.carregar()
        VIRTUAL = {"virtual": True, "fabricante": "virtio", "driver": "virtio-pci"}
        FISICA = {"virtual": False, "fabricante": "AMD", "driver": "amdgpu"}

        # O caso REAL, medido num servidor: `vaInitialize: 2` numa virtio. A primeira versão
        # hesitava — "instale o driver, SE ela for física" — mesmo com a descoberta já sabendo que
        # é virtual. E aí a pessoa vai procurar pacote para um problema que nenhum pacote resolve.
        s = "Failed to initialise VAAPI connection: 2 (resource allocation failed)."
        self.assertIn("NÃO implementa VA-API", m._por_que_vaapi_falhou(s, VIRTUAL))
        self.assertIn("nenhum pacote resolve", m._por_que_vaapi_falhou(s, VIRTUAL),
                      "a resposta deixou esperança onde não há — pior que uma resposta ruim")

        # A MESMA saída numa placa física é outro diagnóstico: aí o pacote É o caminho.
        self.assertIn("driver ausente", m._por_que_vaapi_falhou(s, FISICA))
        self.assertNotIn("nenhum pacote resolve", m._por_que_vaapi_falhou(s, FISICA))

        self.assertIn("compilado SEM VAAPI", m._por_que_vaapi_falhou("Unknown encoder 'h264_vaapi'", FISICA))
        self.assertIn("grupo `render`",
                      m._por_que_vaapi_falhou("Failed to open /dev/dri/renderD128: Permission denied", FISICA))
        self.assertIn("GPU VIRTUAL",
                      m._por_que_vaapi_falhou("No usable encoding entrypoint found for profile", VIRTUAL))

        # ⚠ O caso que motivou tudo isto: NVIDIA de verdade, `vainfo` instalado, libva 1.22
        # respondendo — e "Failed to initialise VAAPI connection: -1". A resposta antiga era
        # "driver ausente ... o driver NVIDIA", e mandava instalar o que já estava instalado. Não é
        # driver: o proprietário da NVIDIA não fala VA-API, e o caminho é outro.
        NVIDIA = {"virtual": False, "fabricante": "NVIDIA", "driver": "nvidia", "video": "nvenc"}
        d = m._por_que_vaapi_falhou("Failed to initialise VAAPI connection: -1 (unknown libva error).",
                                    NVIDIA)
        self.assertIn("NVENC", d)
        self.assertNotIn("driver ausente", d, "mandou procurar driver onde o driver está instalado")

        # E os erros do PRÓPRIO NVENC, que têm nome e não se confundem com os do VA-API.
        self.assertIn("SEM NVENC", m._por_que_vaapi_falhou("Unknown encoder 'h264_nvenc'", NVIDIA))
        self.assertIn("libnvidia-encode",
                      m._por_que_vaapi_falhou("Cannot load libnvidia-encode.so.1", NVIDIA))
        self.assertIn("atualizar o driver",
                      m._por_que_vaapi_falhou("Driver does not support the required nvenc API version. "
                                              "Required: 12.0 Found: 11.1", NVIDIA))
        self.assertIn("NVENC", m._por_que_vaapi_falhou("No capable devices found", NVIDIA))

        # Inventar diagnóstico custa mais que não ter nenhum.
        self.assertIsNone(m._por_que_vaapi_falhou("", VIRTUAL))
        self.assertIsNone(m._por_que_vaapi_falhou("algo que ninguém previu", VIRTUAL))
        # Sem dispositivo (o caminho do "não sei"), não pode afirmar que é virtual.
        self.assertNotIn("VIRTUAL", m._por_que_vaapi_falhou(s, None) or "")

    def test_o_stderr_do_ffmpeg_e_CAPTURADO(self):
        # Num servidor de verdade a mensagem foi: "Command failed: ffmpeg -hide_banner …". A linha
        # de comando truncada, e nenhuma palavra sobre o que houve. Erro que não dá o que procurar
        # é quase tão ruim quanto erro nenhum.
        import inspect

        m = self.carregar()
        fonte = inspect.getsource(m.benchmark_gpu)
        self.assertIn("stderr=subprocess.PIPE", fonte)
        self.assertNotIn("stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL", fonte)
        # E sem `-hwaccel vaapi`: aquilo acelera DECODE, e a fonte é gerada pelo próprio ffmpeg.
        # Pedi-lo faz o erro falar do decode em vez do encode que se queria medir.
        #
        # O recorte procura o ARGUMENTO, entre aspas — e não a palavra solta. O comentário logo
        # acima da chamada explica justamente por que ele não está lá, e uma guarda que o acusasse
        # estaria reprovando a explicação da própria regra que ela existe para impor.
        self.assertNotIn('"-hwaccel"', fonte)
        self.assertNotIn("'-hwaccel'", fonte)

    # O que o lançador teria concedido: uma placa, com o caminho de codificação que o
    # `vssh-gpu-info` do sistema anota a partir do driver.
    NVIDIA = {"card": "card0", "fabricante": "NVIDIA", "driver": "nvidia", "virtual": False,
              "video": "nvenc", "renderNode": "/dev/dri/renderD128", "acesso": "ok"}
    AMD = {"card": "card0", "fabricante": "AMD", "driver": "amdgpu", "virtual": False,
           "video": "vaapi", "renderNode": "/dev/dri/renderD128", "acesso": "ok"}
    INTEL = {"card": "card0", "fabricante": "Intel", "driver": "i915", "virtual": False,
             "video": "vaapi", "renderNode": "/dev/dri/renderD128", "acesso": "ok"}
    VIRTIO = {"card": "card0", "fabricante": "virtio", "driver": "virtio_gpu", "virtual": True,
              "video": None, "renderNode": "/dev/dri/renderD128", "acesso": "ok"}

    def _argvs_do_benchmark(self, dispositivo):
        """Roda o benchmark com um `subprocess.run` que só ANOTA, e devolve o que ele chamaria."""
        m = self.carregar()
        self._conceder(dispositivo)
        chamadas = []

        def falso_run(argv, **kw):
            chamadas.append(list(argv))
            return unittest.mock.Mock(returncode=0, stdout="", stderr=b"")

        with unittest.mock.patch.object(m.subprocess, "run", falso_run):
            r = m.benchmark_gpu()
        return m, r, [c for c in chamadas if c[0] == "ffmpeg" and "-version" not in c]

    def test_o_codificador_e_o_que_o_lancador_anotou_e_NVIDIA_e_NVENC(self):
        # O servidor de verdade: NVIDIA, `renderD128` presente, e o benchmark antigo tentava
        # `h264_vaapi` ali — falhava, e o diagnóstico mandava instalar driver.
        m, r, ffmpegs = self._argvs_do_benchmark(self.NVIDIA)
        self.assertEqual(r["video"], "nvenc")
        gpu = next(c for c in ffmpegs if "h264_nvenc" in c)
        self.assertNotIn("-vaapi_device", gpu, "NVENC não passa pelo render node")
        self.assertNotIn("hwupload", " ".join(gpu), "hwupload é do VA-API; no NVENC o encoder sobe o quadro")
        self.assertFalse(any("h264_vaapi" in c for c in ffmpegs), "tentou VA-API numa NVIDIA")
        self.assertTrue(r["gpu"]["ok"])

    def test_AMD_e_Intel_continuam_em_VAAPI(self):
        for dispositivo in (self.AMD, self.INTEL):
            m, r, ffmpegs = self._argvs_do_benchmark(dispositivo)
            self.assertEqual(r["video"], "vaapi", dispositivo["driver"])
            gpu = next(c for c in ffmpegs if "h264_vaapi" in c)
            self.assertIn("-vaapi_device", gpu)
            self.assertFalse(any("h264_nvenc" in c for c in ffmpegs))
            self._patcher.stop(); self._patcher = None

    def test_placa_virtual_nao_tenta_codificador_nenhum(self):
        # Tentar VA-API numa virtio é o que produzia "driver ausente" para uma placa que não tem,
        # nem vai ter, codificador. Agora ela nem chega ao ffmpeg.
        m, r, ffmpegs = self._argvs_do_benchmark(self.VIRTIO)
        self.assertIsNone(r["video"])
        self.assertFalse(r["gpu"]["ok"])
        self.assertIn("VIRTUAL", r["gpu"]["erro"])
        self.assertEqual([c for c in ffmpegs if "h264_vaapi" in c or "h264_nvenc" in c], [])

    def _benchmark_de_mentira(self, lados, dispositivo=NVIDIA):
        """O benchmark com relógio e processador FALSOS: nada roda, e cada lado é um perfil.

        `lados[rotulo] = (partida_ms, ms_por_quadro, nucleos)` — o que um ffmpeg daquele lado
        custaria: um fixo por execução, um por quadro, e quantos núcleos ele ocupa enquanto roda.
        O relógio e o `getrusage` são avançados pelo próprio `subprocess.run` de mentira, então o
        que se mede é a ARITMÉTICA do benchmark, sem placa e sem ffmpeg.
        """
        import re
        import types

        m = self.carregar()
        self._conceder(dispositivo)
        relogio = {"parede": 0.0, "cpu": 0.0}

        def falso_run(argv, **kw):
            argv = list(argv)
            if "-version" in argv:
                return unittest.mock.Mock(returncode=0)
            lado = "gpu" if any("nvenc" in a or "vaapi" in a for a in argv) else "cpu"
            duracao = float(re.search(r"duration=([\d.]+)", " ".join(argv)).group(1))
            partida, por_quadro, nucleos = lados[lado]
            parede = partida + por_quadro * duracao * 30
            relogio["parede"] += parede / 1000
            relogio["cpu"] += parede * nucleos / 1000
            return unittest.mock.Mock(returncode=0, stdout="", stderr=b"")

        falso_resource = types.SimpleNamespace(
            RUSAGE_CHILDREN=-1,
            getrusage=lambda quem: types.SimpleNamespace(ru_utime=relogio["cpu"], ru_stime=0.0))

        with unittest.mock.patch.object(m.subprocess, "run", falso_run), \
             unittest.mock.patch.object(m.time, "perf_counter", lambda: relogio["parede"]), \
             unittest.mock.patch.object(m, "resource", falso_resource), \
             unittest.mock.patch.object(m.os, "cpu_count", lambda: 16):
            return m.benchmark_gpu()

    def test_a_partida_e_descontada_e_o_fps_e_o_do_REGIME(self):
        # O servidor de verdade: RTX A5500 ao lado de um Ryzen de 16 núcleos. Em 300 quadros o
        # NVENC deu 366 fps contra 507 da CPU — e a média escondia que 450 ms eram partida (contexto
        # CUDA + sessão de encode), pagos UMA vez por transcode. Descontada a partida, a placa faz
        # 1250 fps em regime.
        r = self._benchmark_de_mentira({"cpu": (30, 2.0, 16), "gpu": (450, 0.8, 1)})
        self.assertEqual(r["cpu"]["fps"], 500)
        self.assertEqual(r["gpu"]["fps"], 1250, "o fps reportado ainda carrega a partida")
        self.assertAlmostEqual(r["gpu"]["partida"], 450, delta=5)
        self.assertGreater(r["ganho"], 2)
        self.assertGreater(r["economia"], 10, "16 núcleos contra um: a economia de processador sumiu")
        self.assertIn("mais rápida", r["leitura"])
        self.assertNotIn("virtual", r["leitura"])

    def test_placa_FISICA_mais_lenta_em_parede_mas_poupando_processador_NAO_e_chamada_de_virtual(self):
        # Uma placa modesta ao lado de uma CPU enorme: em parede perde, em processador ganha de
        # longe — e é o processador que o desktop de quem está trabalhando está usando. Foi esta
        # frase, solta para qualquer razão baixa, que chamou uma RTX A5500 de "placa virtual".
        r = self._benchmark_de_mentira({"cpu": (30, 2.0, 16), "gpu": (450, 3.0, 1)})
        self.assertLess(r["ganho"], 0.8)
        self.assertGreater(r["economia"], 3)
        self.assertNotIn("virtual", r["leitura"])
        self.assertIn("núcleos", r["leitura"])
        self.assertIn("menos processador", r["leitura"])

    def test_placa_lenta_que_tambem_nao_poupa_processador_nao_compensa_e_e_dito_sem_rotulo(self):
        # Mais lenta em parede e ocupando tanto processador quanto a CPU: aí não há o que
        # defender, e a leitura diz isso — sem chamar de virtual o que a descoberta não chamou.
        r = self._benchmark_de_mentira({"cpu": (30, 2.0, 4), "gpu": (100, 4.0, 4)})
        self.assertLess(r["ganho"], 0.8)
        self.assertIn("não compensa", r["leitura"])
        self.assertNotIn("virtual", r["leitura"])

    def test_sem_ffmpeg_nao_roda_e_o_motivo_aponta_o_requiredPackages(self):
        # `PATH` vazio: o ffmpeg deixa de ser encontrável, que é o caso de um servidor onde o
        # instalador deixou passar.
        m = self.carregar({"PATH": ""})
        r = m.benchmark_gpu()
        self.assertFalse(r["rodou"])
        self.assertIn("requiredPackages", r["motivo"],
                      "o motivo não liga a falta do ffmpeg ao mecanismo que deveria tê-la impedido")


class TestManifesto(unittest.TestCase):
    def manifesto(self):
        with open(os.path.join(TEMPLATE, "vssh-app.json"), encoding="utf-8") as fh:
            return json.load(fh)

    def test_declara_os_tres_e_o_secrets_SEM_valor(self):
        m = self.manifesto()
        self.assertTrue(m.get("resources", {}).get("memoryMax"))
        self.assertEqual([s["name"] for s in m["secrets"]], ["HELLO_SEGREDO"])
        for s in m["secrets"]:
            for proibido in ("value", "valor", "default"):
                self.assertNotIn(proibido, s,
                                 "o template traz o VALOR do segredo no manifesto")
        # `gpu: True` porque uma galeria existe para ser EXERCITADA num servidor: o benchmark
        # precisa da placa para medir.
        self.assertIs(m["gpu"], True)

    def test_declara_o_ffmpeg(self):
        m = self.manifesto()
        self.assertIn("ffmpeg", m["requiredPackages"],
                      "o benchmark usa ffmpeg e o manifesto não o declara")

    def test_o_healthcheck_e_o_saude_que_o_runtime_responde(self):
        # O `servidor.Pedido` responde `GET /saude` antes de chamar o app; um manifesto apontando
        # para outro caminho receberia 404 da sondagem, que o lifecycle conta como pronto.
        self.assertEqual(self.manifesto()["backend"]["healthcheckPath"], "/saude")


class OEnderecoVemDoRuntime(BaseTemplate):
    """Quem abre o endereço é o `servidor.escutar()` do runtime, e não um servidor montado à mão.

    A diferença não aparece num smoke: um `UnixStreamServer` escrito à mão binda o socket e serve a
    página igual. O que se perde é o que a lib faz em volta: limpar o socket órfão por tentativa de
    conexão (nunca por `exists`, que derrubaria a instância viva), o modo 0600 contra o umask, o
    portão de token e o `/saude`, e a saída com `0` quando outra instância já atende, que o
    lifecycle trata como sucesso em vez de como falha.

    Medido substituindo a função dentro do módulo do runtime, que é de onde o template a chama: se
    ele passar a montar o servidor por conta própria, o dublê não é chamado e o teste fica vermelho.
    """

    def test_o_main_pede_o_servidor_ao_runtime(self):
        modulo = self.carregar()
        from vssh import servidor

        chamadas = []
        # O `main()` registra o boot antes de servir, e o log do template escreve em stdout por
        # padrão, o que sujaria a saída da suíte com uma linha de NDJSON por execução.
        modulo.log = lambda *a, **kw: None
        with unittest.mock.patch.object(servidor, "escutar",
                                        lambda pedido, argv=None, nome=None: (chamadas.append(pedido), 0)[1]):
            self.assertEqual(modulo.main(), 0)

        self.assertEqual(len(chamadas), 1, "o backend do template não pediu o servidor ao runtime")
        self.assertIs(chamadas[0], modulo.Pedido,
                      "o servidor foi pedido com outro handler que não o do template")
        self.assertTrue(issubclass(modulo.Pedido, servidor.Pedido),
                        "o handler do template não herda o portão de token e o /saude do runtime")


if __name__ == "__main__":
    unittest.main()
