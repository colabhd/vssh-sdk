'use strict';

// Hello World (Node): o template de partida para um vssh-app com backend Node.
//
// O backend importa `vssh`, o runtime que o sistema instala em cada servidor em
// `/opt/vssh/sdk/node` e que o `vssh-app-run` expõe pelo `NODE_PATH` a todo app que sobe. Nada
// disso viaja no pacote: o `package.json` deste template não tem dependência, e o manifesto não
// tem `installCommand`. O resto é stdlib do Node. O SDK web (`vssh`) e a biblioteca de UI também
// não viajam: o sistema os serve em `_sdk/` dentro do espaço de URL do app, e o backend só injeta
// as tags (ver `web.spa` abaixo).
//
// Fora do servidor, `scripts/ambiente-de-dev.sh` do SDK aponta `NODE_PATH` para a cópia de
// `runtime/node`, e `node backend/server.js --tcp 127.0.0.1:0` sobe o backend numa porta.
//
// O que este template já faz por você, e que a primeira versão de todo app esquece:
//   - log estruturado em $VSSH_APP_DATA_DIR desde a primeira linha (é o que salva a depuração
//     remota: frame minificado sustenta hipótese, log do backend nomeia op e caminho);
//   - o portão do X-Vssh-App-Token, em tempo constante, e o `/saude` que o ambiente sonda;
//   - um endpoint SSE com os cabeçalhos que sobrevivem ao proxy e ao CDN.

const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

// O barril é preguiçoso: cada módulo carrega no primeiro uso.
//
//   servidor   o endereço, o portão de token, o `/saude`, o log
//   web        a SPA do app, com o SDK web e o Tuff injetados no `<head>`
//   eventos    SSE, e a difusão a quem assinou
//   dados      o filesystem privado do app, e as rotas que o frontend chama
//   avisos     notificar, atividade em curso e bandeja, para um app sem janela
//   app        quem sou, e onde guardo as coisas
//   gpu        o que o lançador concedeu de GPU a este processo
//   fila       delegar um container ao cluster Kubernetes, e acompanhá-lo
//
// As duas vozes de um app sem janela dizem coisas diferentes, e trocar uma pela outra é o erro
// que enche o sino de quem usa o ambiente: `avisos.notificar` registra um fato que aconteceu, e
// que a pessoa vai querer reencontrar; `avisos.atividade` declara uma condição verdadeira agora,
// que some quando deixa de ser, sem deixar rastro. A bandeja (`avisos.bandeja`) é o par do
// `vssh.avisos.bandeja` do SDK web: aquele morre com a janela; este escreve um arquivo que o
// portal lê, e o clique volta como POST, porque a rede é assimétrica (o portal alcança o app; o
// app não alcança o portal).
const { servidor, web, eventos, dados, avisos, app, gpu, fila } = require('vssh');

// Onde este backend escuta é decisão do lifecycle, não deste arquivo: socket unix em
// $VSSH_APP_SOCKET. Quem lê a variável,
// limpa socket órfão e falha alto quando não veio nenhuma é o `escutar()`, lá no fim.
//
// Base só para PARSING de URL relativa. Ela era `http://127.0.0.1:${PORT}` e isso amarrava o
// roteamento ao transporte sem necessidade: num socket unix não existe porta, `${PORT}` vira `NaN`
// e o `new URL` estoura em toda requisição. O host aqui nunca vai à rede.
const BASE_URL = 'http://vssh-app.invalid';
const APP_ID = app.ident();

const log = servidor.criarLog();

// As duas metades do prazo de validade de uma atividade, ligadas no boot porque é uma linha cada e
// porque esquecê-las não quebra nada: só deixa uma barra mentindo no painel de outra pessoa.
//
//   manterAtividadesVivas()   renova o `at` das atividades vivas a cada 20 s. O portal descarta o
//                             que passa ~60 s sem renovar, porque um arquivo `live` sobrevive a
//                             um `kill -9`. Sem isto, toda atividade mais longa que um minuto some
//                             no meio, sozinha, o que parece defeito do ambiente. O temporizador
//                             é `unref` e não segura o processo.
//   limparAtividadesAoSair()  apaga o que ficou vivo num Ctrl+C ou num SIGTERM. O TTL já cobre o
//                             `kill -9`; isto cobre a saída limpa, onde 60 s de "sincronizando"
//                             seria um minuto de mentira que dava para não contar.
//
// A tarefa de exemplo dura 6,4 s contra um TTL de 60 s, então a renovação só morde no caso que
// ninguém exercita; `?lento=1` na rota da tarefa existe para exercitá-lo.
avisos.manterAtividadesVivas();
avisos.limparAtividadesAoSair();
// Ícone órfão mente sobre o estado do ambiente: ele fica na bandeja depois que o app morreu, e
// quem o vê conclui que o app está de pé.
avisos.limparBandejaAoSair();

// ── O armazém privado deste app ──────────────────────────────────────────────
//
// `dados.abrir('privado')` é `<diretório de dados>/privado`: dentro do `VSSH_APP_DATA_DIR`, que é
// o único diretório gravável garantido (o pacote em `/opt/vssh-apps/<id>/` é de root e somente
// leitura), e em `~/.vssh-apps/<id>/data` fora do lançador. A peça continua exercitável na sua
// máquina. É o filesystem privado do app, e não os arquivos do usuário, que são a File System
// Access da galeria.
const arquivosPrivados = dados.abrir('privado', { aoAvisar: log });
// As rotas que o frontend chama em `api/privado`. O portão de token fica no `servidor.portao`,
// na frente de tudo, e por isso estas rotas não têm um segundo.
const servirPrivado = dados.rotas(arquivosPrivados, { prefixo: '/api/privado', aoAvisar: log });

// A raiz vai absoluta, a partir deste arquivo. Uma relativa (`web.spa('frontend')`) resolve contra
// a pasta do `vssh-app.json` a partir do script principal, e numa bancada que importa este módulo
// o script principal é outro.
const spa = web.spa(path.join(__dirname, '..', 'frontend'), {
  // A ponte com o ambiente entra por uma tag, e a tag é tudo que este backend faz por ela:
  // `web.spa` acrescenta o `<script src="_sdk/vssh.js">` antes do `</head>` do index, e quem
  // responde esse caminho é o sistema. O caminho é relativo à raiz do app, e numa rota profunda
  // (`rotasProfundas`) o `<base href>` que a lib injeta o resolve. Fora do ambiente ninguém serve
  // `_sdk/`, e a galeria diz isso na peça "Ambiente".
  //
  // O Tuff, a biblioteca de UI, vem do mesmo espaço `_sdk/tuff/`. `web.TUFF` são os tokens, os
  // componentes e o comportamento; `TUFF_BASE` é o reset da página inteira, à parte porque um
  // bundle antigo com CSS próprio não o quer; `TUFF_ICONES` é o sprite, que não atravessa o
  // iframe e por isso entra como script. Adotar o Tuff é escolha deste app: um app com identidade
  // visual própria passa `tuff: false`, que é o padrão.
  tuff: [...web.TUFF, web.TUFF_BASE, web.TUFF_ICONES],

  // `galeria.js`, o código deste app, entra aqui, e não como uma `<script src>` no index, para
  // ganhar o carimbo de conteúdo na URL: só o que é injetado e existe no disco é carimbado, e o
  // carimbo é o que garante que uma reinstalação não sirva a versão velha de nenhum cache do
  // caminho. Ele vem depois do SDK e do Tuff, porque é o SDK que ele chama. Quem tem build (Vite
  // e afins) já recebe um nome com hash e não precisa disto.
  scripts: ['galeria.js'],

  // Descomente se o seu app usa roteamento HTML5 (History API) em vez de fragmento:
  // rotasProfundas: true,
  dica: 'Rode o build do frontend antes de subir o backend.',
  aoAvisar: log,
});

// ── Estado do processo, compartilhado por todas as janelas ────────────────────
//
// Um difusor de SSE e um contador. É o menor estado possível que ainda prova o modelo: N janelas,
// um backend. Quem assina `api/events` entra no difusor; quem incrementa publica para todos.
const difusor = new eventos.Difusor();
let contador = 0;
const subiuEm = new Date().toISOString();
// O temporizador da tarefa longa, para que um segundo clique reinicie em vez de empilhar.
let tarefaEmCurso = null;

const estado = () => ({ contador, conexoes: difusor.assinantes, subiuEm });
const difundir = () => difusor.publicar('estado', estado());
// A difusão genérica, para o que o backend recebe sem ninguém ter perguntado: o clique na bandeja
// e a ação de uma notificação chegam ao processo por POST, e é por aqui que uma janela aberta fica
// sabendo. Com nenhuma janela aberta, ninguém recebe, e o app recebeu do mesmo jeito.
const difundirEvento = (nome, dado) => difusor.publicar(nome, dado);

// ── O que o ambiente decidiu por este processo ────────────────────────────────
//
// Três coisas que o app DECLARA e o ambiente APLICA. As três se leem de dentro do processo, e é
// isso que as torna demonstráveis: o manifesto diz o que se pediu; isto aqui diz o que se recebeu.

/**
 * O teto de memória que está VALENDO, lido do cgroup — não o que o manifesto pediu.
 *
 * A diferença é o ponto da demonstração. O manifesto declara; o `vssh-app-run` traduz para um
 * escopo transitório do systemd; e um servidor sem gerenciador systemd do usuário não aplica nada
 * (`loginctl enable-linger`). Ler o cgroup é a única resposta que não é uma suposição — e quando
 * ela vem vazia, o app está rodando SEM limite, que é uma informação e não um erro.
 */
function limitesDoCgroup() {
  const fs = require('node:fs');
  try {
    // cgroup v2: uma linha só, `0::<caminho relativo à raiz>`.
    const linha = fs.readFileSync('/proc/self/cgroup', 'utf8').split('\n').find((l) => l.startsWith('0::'));
    if (!linha) return { contido: false, motivo: 'sem cgroup v2 neste servidor' };
    const base = path.join('/sys/fs/cgroup', linha.slice(3).trim());
    const ler = (nome) => {
      try { return fs.readFileSync(path.join(base, nome), 'utf8').trim(); } catch { return null; }
    };
    const memMax = ler('memory.max');
    return {
      // "max" é o valor que o kernel usa para "sem teto" — texto, não número, e confundir os dois
      // faria um app sem limite parecer limitadíssimo.
      contido: !!memMax && memMax !== 'max',
      cgroup: linha.slice(3).trim(),
      memoryMax: memMax, memoryHigh: ler('memory.high'), tasksMax: ler('pids.max'),
      // Quanto o processo está usando AGORA. É o que transforma o teto de número em noção.
      memoryCurrent: ler('memory.current'),
    };
  } catch (err) {
    // Não é Linux, ou o cgroupfs não está montado. "Não sei" é resposta, e diferente de "sem teto".
    return { contido: null, motivo: err.message };
  }
}

/**
 * A GPU, do ponto de vista deste processo: o que o lançador concedeu, e por que não.
 *
 * O `vssh-app-run` decide ao subir o app, com o que o servidor tem (fabricante pelo id do
 * barramento, driver, virtual ou física, e se este usuário abre o render node) e com o que o
 * manifesto pede, e registra a decisão. `gpu.concedida()` a lê; o app não vasculha `/sys` nem
 * olha `CUDA_VISIBLE_DEVICES` para descobrir, porque a resposta do lançador é a que vale, e é a
 * mesma que a janela recebe por `vssh.gpu.estado()` e que o gerenciador de tarefas mostra.
 *
 * `CUDA_VISIBLE_DEVICES` vai ao lado, e é outra coisa: o portão do runtime CUDA. Sozinho, o valor
 * `""` é ambíguo (o mesmo para "escondida deste app" e para "não há placa"); ao lado da decisão,
 * ele fica legível. Fora do lançador não há registro, e a resposta é "sem registro do lançador",
 * que é informação e não erro.
 */
function gpuDoAmbiente() {
  return { ...gpu.concedida(), cudaVisibleDevices: process.env.CUDA_VISIBLE_DEVICES ?? null };
}

// ── A fila de processamento ───────────────────────────────────────────────────
//
// A quarta coisa que o app declara e o ambiente decide: `recursos.fila` no manifesto pede ao
// portal a credencial (`VSSH_PORTAL_URL` + `VSSH_PORTAL_TOKEN`), e com ela o backend manda um
// container ao cluster em vez de rodá-lo nesta máquina. A sonda abaixo é o menor trabalho que
// prova o caminho inteiro: `nvidia-smi` numa imagem CUDA, com uma GPU do cluster, e a tabela volta
// como arquivo de saída.

const sondas = new Map();

function registrarSonda(id, evento, campos) {
  const atual = sondas.get(id) || { id, eventos: [], saida: null };
  if (evento) atual.eventos.push(evento);
  Object.assign(atual, campos);
  sondas.set(id, atual);
  const registro = { ...atual, eventos: [...atual.eventos] };
  difundirEvento('fila', registro);
  return registro;
}

/**
 * Submete o `nvidia-smi` ao cluster e acompanha em segundo plano. Devolve o registro inicial.
 *
 * O comando escreve em `/vssh/saidas/placa.txt`, que é o que o pod sobe ao terminar; `baixar` traz
 * o arquivo para o diretório de dados do app, e a galeria mostra o conteúdo. Uma GPU só entra no
 * pedido quando o cluster oferece algum tipo: sem GPU o job roda do mesmo jeito e o `nvidia-smi`
 * diz que não achou placa, o que também é uma medição.
 */
async function sondarFila() {
  const oferta = await fila.disponivel();
  if (!oferta.disponivel) return { ok: false, motivo: oferta.motivo };
  const tipo = oferta.gpus?.[0]?.tipo;
  const trabalho = {
    nome: 'sonda-gpu',
    imagem: 'nvidia/cuda:12.6.0-base-ubuntu24.04',
    comando: ['sh', '-c', 'nvidia-smi > /vssh/saidas/placa.txt 2>&1'],
    saidas: ['placa.txt'],
    cpu: '1', memoria: '1Gi', prazo: 600,
  };
  if (tipo) trabalho.gpu = { quantidade: 1, tipo };
  const id = await fila.submeter(trabalho);
  const registro = registrarSonda(id, null, { estado: 'enviado', gpu: tipo ?? null });

  (async () => {
    try {
      const final = await fila.acompanhar(id, (evento, job) => registrarSonda(id,
        `${evento}: ${job.estado}${job.motivo ? ` (${job.motivo})` : ''}`,
        { estado: job.estado, motivo: job.motivo ?? null }));
      let saida = null;
      if (final.estado === 'concluido') {
        const fs = require('node:fs');
        const destino = path.join(app.dados(), 'fila', id);
        for (const caminho of await fila.baixar(id, destino)) saida = fs.readFileSync(caminho, 'utf8').slice(0, 4000);
      }
      registrarSonda(id, null, { estado: final.estado, motivo: final.motivo ?? null, exit: final.exit ?? null, saida, fim: true });
    } catch (err) {
      registrarSonda(id, null, { estado: 'falhou', motivo: err.mensagem || err.message, fim: true });
    }
  })();
  return { ok: true, ...registro };
}

/**
 * O segredo do cofre — e **nunca o valor dele**.
 *
 * O que se devolve é: chegou, quantos caracteres tem, e um prefixo de hash que serve para conferir
 * "é o mesmo que eu guardei?" sem que o valor atravesse a rede outra vez. É o hábito que se quer
 * ensinar: um app que ecoa a própria credencial põe a credencial no log de alguém.
 */
function segredo() {
  const v = process.env.HELLO_SEGREDO;

  // O COFRE em disco, lido só pelas CHAVES. Sem isto a peça só sabia olhar `process.env`, e aí
  // "não guardado" e "guardado depois deste processo subir" davam a MESMA resposta — que foi
  // exatamente o que se viu ao testar: guardar, reabrir a janela, e o cartão dizer que não há nada.
  //
  // Reabrir a janela não reinicia o processo: a janela é uma view, o backend continua o mesmo. E o
  // ambiente de um processo é fixado no start — então o valor novo só chega no próximo start. Com
  // as duas fontes a peça distingue os três casos, e o do meio é o que responde "por que não
  // funcionou?".
  //
  // Só as CHAVES. O app já recebe os valores pelo ambiente; reler valores do arquivo não
  // acrescentaria nada e ensinaria o hábito errado a quem copia este template.
  let noCofre = null;
  try {
    const fs = require('node:fs');
    const dados = process.env.VSSH_APP_DATA_DIR;
    if (dados) {
      const j = JSON.parse(fs.readFileSync(path.join(dados, '..', 'secrets.json'), 'utf8'));
      noCofre = Object.keys(j || {});
    }
  } catch { noCofre = null; }   // ausente ou ilegível é "não sei", não "vazio"

  if (!v) {
    const guardadoAgora = Array.isArray(noCofre) && noCofre.includes('HELLO_SEGREDO');
    return {
      definido: false, noCofre: guardadoAgora,
      leitura: guardadoAgora
        ? 'JÁ ESTÁ GUARDADO no cofre — este processo é que subiu antes dele. Reabrir a janela não ' +
          'basta: a janela é uma view, o backend continua o mesmo. Pare e inicie o app (menu de ' +
          'contexto da janela, ou Configurações → Serviços) para ele receber o valor.'
        : 'nada guardado — use o botão "guardar HELLO_SEGREDO" aqui em cima, e depois reinicie o app',
    };
  }
  return {
    definido: true, tamanho: v.length,
    sha256: crypto.createHash('sha256').update(v).digest('hex').slice(0, 12),
    leitura: 'chegou pelo ambiente; o valor não sai daqui',
  };
}

/**
 * O BENCHMARK. Descobrir não basta: um inventário não diz se a placa serve para alguma coisa.
 *
 * **Por que ffmpeg, e não CUDA.** Um benchmark de CUDA só roda onde há CUDA, que é justamente o
 * caso que a versão anterior já cobria e o único. VAAPI atravessa Intel, AMD e NVIDIA, e roda
 * contra o render node do DRM — o mesmo caminho genérico que a descoberta usa. E `ffmpeg` é um
 * pacote, não um SDK: por isso este template o DECLARA em `requiredPackages`, e o ambiente confere
 * antes de instalar.
 *
 * **O número útil é a RAZÃO.** "180 fps" sozinho não diz nada — depende do vídeo, do preset, da
 * máquina. O mesmo trabalho em CPU e em GPU, medido em seguida, responde a pergunta que se tem de
 * fato: *vale a pena usar a placa deste servidor?*
 *
 * **E são DUAS razões, porque a de parede sozinha mentiu num servidor de verdade.** Uma RTX A5500
 * ao lado de um Ryzen de 16 núcleos deu 366 fps contra 507 — e a leitura chamou a placa de
 * "virtual". Dois erros na mesma linha:
 *
 *   - o clipe tem 10 s, e abrir o contexto CUDA mais a sessão do NVENC custa centenas de ms UMA
 *     vez. Num filme isso some; aqui era metade da medida. Por isso cada lado roda duas vezes,
 *     curta e longa, e o que se reporta é a DIFERENÇA (o regime) com a partida à parte;
 *   - 507 fps de x264 são 16 núcleos a 100%; 366 de NVENC são um. No ambiente o transcode corre
 *     ao LADO do desktop de quem está trabalhando — o que a placa compra é deixar o processador
 *     livre, e um benchmark que não mede tempo de processador não vê isso. O Node não expõe o
 *     `rusage` de um filho; o `time` do bash expõe, e a razão entre os dois lados é a segunda
 *     resposta.
 *
 * Timeboxed e não-fatal: um encoder que trava não pode segurar a requisição nem derrubar o app.
 */
/**
 * Traduz o stderr do ffmpeg no motivo, em português, de a GPU não ter codificado.
 *
 * Existe porque as causas pedem ações OPOSTAS e chegam parecidas: uma se conserta instalando um
 * driver, outra dando permissão, e a mais comum não se conserta de jeito nenhum — a placa
 * simplesmente não tem encoder de vídeo, que é o caso de praticamente toda GPU virtual. Sem
 * separá-las, "a GPU não codificou" manda a pessoa caçar driver por horas para descobrir que a
 * resposta era "esta placa não faz isso, e isso é normal".
 */
function _porQueVaapiFalhou(stderr, dispositivo) {
  const s = (stderr || '').toLowerCase();
  if (!s) return null;

  // ── NVENC primeiro: os erros dele têm nome próprio e não se confundem com os do VA-API ──
  if (s.includes('h264_nvenc') && s.includes('unknown encoder')) {
    return 'este ffmpeg foi compilado SEM NVENC — é do pacote, não do servidor nem da placa';
  }
  if (s.includes('libnvidia-encode') || s.includes('libcuda.so')) {
    return 'o userspace NVIDIA está incompleto — falta a libnvidia-encode.so.1, que vem com o ' +
           'driver. Num container ou LXC ela precisa ter sido montada do host junto com o resto';
  }
  if (s.includes('nvenc api version')) {
    return 'o driver NVIDIA é mais velho que o NVENC deste ffmpeg — atualizar o driver resolve';
  }
  if (s.includes('no capable devices') || s.includes('no nvenc capable devices')) {
    return 'nenhuma placa com NVENC alcançável — ou `/dev/nvidia*` não está neste ambiente, ou esta ' +
           'placa não tem motor de codificação (A100 e H100 não têm; é computação, não vídeo)';
  }
  if (s.includes('out of memory (10)') || s.includes('openencodesessionex failed')) {
    return 'a placa recusou mais uma sessão de NVENC — placa de consumo limita as sessões ' +
           'simultâneas, e outra coisa neste servidor já as ocupa';
  }

  if (s.includes('unknown encoder')) {
    return 'este ffmpeg foi compilado SEM VAAPI — é do pacote, não do servidor nem da placa';
  }
  if (s.includes('permission denied')) {
    return 'sem permissão no render node — falta o grupo `render` (usermod -aG render <usuario>)';
  }

  // **O diagnóstico usa o que a DESCOBERTA já sabe.** A primeira versão não recebia o dispositivo e
  // por isso hesitava — "instale o driver, SE ela for física" — mesmo tendo a resposta a uma função
  // de distância. Num servidor real isso mandou procurar pacote para uma virtio, onde nenhum
  // pacote resolve. Duas informações que existiam e não se encontravam: o mesmo defeito que fez
  // "sem GPU" e "sem permissão" darem a mesma resposta.
  const virtual = dispositivo && dispositivo.virtual === true;
  const naoInicializou = s.includes('vainitialize') || s.includes('no va display') ||
    s.includes('failed to initialise') || s.includes('failed to create') || s.includes('not implemented');
  const semEntrypoint = s.includes('entrypoint') || s.includes('not supported') || s.includes('unsupported');

  if (virtual && (naoInicializou || semEntrypoint)) {
    // Definitivo, e de propósito: uma resposta que deixa esperança onde não há custa mais que uma
    // resposta ruim. Quem lê isto precisa parar de procurar pacote e trocar de servidor.
    return `esta é uma GPU VIRTUAL (${dispositivo.fabricante || dispositivo.driver}) — ela NÃO ` +
           'implementa VA-API, e nenhum pacote resolve. Ela existe para desenhar tela, não para ' +
           'codificar vídeo nem computar. Um app que depende de aceleração precisa de outro ' +
           'servidor, com placa física — e descobrir isso agora é o que esta peça existe para fazer';
  }
  if (semEntrypoint) {
    return 'a placa abre, mas NÃO tem motor de codificação de vídeo — ela pode servir para render ' +
           'e não para vídeo';
  }
  if (naoInicializou && dispositivo?.fabricante === 'NVIDIA') {
    // É a NVIDIA que mais engana: `vainfo` instalado, libva respondendo, e nada codifica. Não é
    // driver faltando — é a API errada. O pacote de VA-API que existe para ela só decodifica.
    return 'NVIDIA não codifica por VA-API — o driver proprietário não a implementa, e nenhum ' +
           'pacote muda isso. O caminho é o NVENC (`h264_nvenc`), que este benchmark escolhe ' +
           'sozinho quando a descoberta diz `video: nvenc`';
  }
  if (naoInicializou) {
    return 'o VAAPI não inicializou nesta placa física — driver ausente. O pacote do fabricante ' +
           '(mesa-va-drivers para AMD, intel-media-va-driver para Intel) é o caminho';
  }
  return null;
}

/**
 * O que a placa DIZ que sabe fazer, pela ferramenta do caminho dela. É a resposta, não um consolo.
 *
 * NVENC não tem `vainfo`: quem responde é o próprio ffmpeg, listando os codificadores `*_nvenc`
 * que ele carrega. É menos que um inventário de perfis, e é a pergunta certa — "este ffmpeg fala
 * com esta placa?" —, que é onde a NVIDIA costuma falhar (userspace incompleto no container).
 */
function _oQueAPlacaSabe(alvo) {
  const { execFileSync } = require('node:child_process');
  if (alvo.video === 'nvenc') {
    try {
      const saida = execFileSync('ffmpeg', ['-hide_banner', '-encoders'],
        { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
      const linhas = saida.split('\n').filter((l) => l.includes('nvenc')).map((l) => l.trim());
      return { tem: true, ferramenta: 'ffmpeg -encoders', entrypoints: linhas.slice(0, 40),
               codifica: linhas.some((l) => l.includes('h264_nvenc')) };
    } catch (err) {
      return { tem: false, ferramenta: 'ffmpeg -encoders',
               motivo: (err.stderr?.toString() || err.message || '').split('\n')[0].slice(0, 200) };
    }
  }
  const node = alvo.renderNode;
  try {
    const saida = execFileSync('vainfo', ['--display', 'drm', '--device', node],
      { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    const perfis = saida.split('\n').filter((l) => l.includes('VAEntrypoint')).map((l) => l.trim());
    return { tem: true, ferramenta: 'vainfo', entrypoints: perfis.slice(0, 40),
             codifica: perfis.some((l) => /VAEntrypointEnc/.test(l)) };
  } catch (err) {
    // `vainfo` ausente é o caso COMUM e não é erro — ele não vem instalado por padrão. Devolver o
    // `spawnSync vainfo ENOENT` cru seria jogar na cara de quem lê um detalhe de implementação do
    // Node em vez da única coisa acionável: instale o pacote e a pergunta fica respondida.
    const bruto = (err.stderr?.toString() || err.message || '');
    return {
      tem: false,
      ferramenta: 'vainfo',
      motivo: /ENOENT/.test(bruto)
        ? 'o `vainfo` não está instalado neste servidor — `apt-get install -y vainfo` e esta peça ' +
          'passa a listar o que a placa sabe fazer'
        : bruto.split('\n')[0].slice(0, 200),
    };
  }
}

function benchmarkGpu({ frames = 300 } = {}) {
  const { execFileSync } = require('node:child_process');
  // Quadros da execução CURTA de cada lado: o bastante para o ffmpeg passar da partida, pouco o
  // bastante para não custar nada. A diferença entre ela e a longa é o regime.
  const AQUECER = 30;
  // O dispositivo concedido, e não só o caminho dele: o diagnóstico da falha precisa saber se a
  // placa é virtual para responder em vez de hesitar.
  const alvo = gpu.concedida().dispositivos.find((d) => d.acesso === 'ok') || null;
  const node = alvo?.renderNode || null;

  const temFfmpeg = (() => {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 }); return true; }
    catch { return false; }
  })();
  if (!temFfmpeg) {
    return { rodou: false, motivo: 'ffmpeg não está neste servidor — o app o declara em ' +
                                   'requiredPackages, então o instalador deveria ter recusado' };
  }

  // `testsrc` é gerado pelo próprio ffmpeg: sem arquivo de entrada, sem download, sem depender de
  // nada em disco. Saída para /dev/null — o que se mede é o encode, não o I/O.
  //
  // **stderr é CAPTURADO.** A primeira versão usava `stdio: 'ignore'`, e o `err.stderr` vinha nulo:
  // o que sobrava era `err.message`, ou seja, "Command failed: ffmpeg …" — a linha de comando
  // truncada, que não diz absolutamente nada sobre o que houve. Num servidor real isso virou "a
  // GPU não codificou" sem uma pista de por quê. Erro que não dá o que procurar é quase tão ruim
  // quanto erro nenhum.
  //
  // O `time` do bash é o que dá o tempo de PROCESSADOR do ffmpeg. O `-loglevel error` fica, e o
  // stderr do ffmpeg continua sendo o stderr: a linha do `time` vai para o STDOUT (o malabarismo de
  // descritores é só isso), então o diagnóstico de uma falha lê o que era do ffmpeg e nada mais.
  const rodar = (args, rotulo) => {
    const t0 = process.hrtime.bigint();
    let saida = '';
    try {
      saida = execFileSync('bash', [
        '-c', 'TIMEFORMAT="vssh-cpu %U %S"; { time ffmpeg "$@" 2>&3; } 3>&2 2>&1',
        'ffmpeg', '-hide_banner', '-loglevel', 'error', ...args,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    } catch (err) {
      const saida = (err.stderr?.toString() || '').trim();
      return {
        rotulo, ok: false,
        // As ÚLTIMAS linhas: o ffmpeg põe a causa no fim, e o começo costuma ser ruído de init.
        erro: saida ? saida.split('\n').slice(-4).join(' · ').slice(0, 400)
                    : (err.message || '').slice(0, 200),
        diagnostico: _porQueVaapiFalhou(saida, alvo),
      };
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const t = /vssh-cpu ([\d.]+) ([\d.]+)/.exec(String(saida || ''));
    return { rotulo, ok: true, ms: Math.round(ms),
             cpuMs: t ? Math.round((Number(t[1]) + Number(t[2])) * 1000) : null };
  };

  /**
   * Duas execuções, curta e longa; a diferença é o regime, e a sobra da curta é a partida.
   *
   * `fps` é o do REGIME: o que um filme inteiro veria. `partida` é o que se paga uma vez por
   * transcode — e é ela que, somada à média, fazia o NVENC parecer mais lento que a CPU.
   */
  const medir = (argsDe, rotulo) => {
    const curta = rodar(argsDe(AQUECER), rotulo);
    if (!curta.ok) return curta;
    const longa = rodar(argsDe(frames), rotulo);
    if (!longa.ok) return longa;
    const delta = longa.ms - curta.ms;
    const quadros = frames - AQUECER;
    let fps, partida;
    if (delta <= 0) {
      // Ruído maior que a medida: reporta a média crua, sem inventar partida.
      fps = (frames / Math.max(longa.ms, 1)) * 1000; partida = 0;
    } else {
      fps = (quadros / delta) * 1000;
      partida = Math.max(0, curta.ms - (AQUECER / fps) * 1000);
    }
    return { ...longa, fps: Math.round(fps), partida: Math.round(partida) };
  };

  const fonte = (n) => ['-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=30:duration=${n / 30}`];
  const cpu = medir((n) => [...fonte(n), '-c:v', 'libx264', '-preset', 'veryfast', '-f', 'null', '-'], 'cpu');
  // Sem `-hwaccel vaapi`: aquilo é para DECODIFICAR em hardware, e a fonte aqui é gerada pelo
  // próprio ffmpeg. Pedir aceleração de decode de um `lavfi` faz o ffmpeg tentar inicializar um
  // caminho que não existe — e o erro que sai daí fala do decode, não do encode que se queria medir.
  //
  // **O codificador é escolhido pelo `video` da descoberta, e não é detalhe.** A primeira versão só
  // sabia `h264_vaapi`, e num servidor NVIDIA de verdade — com `vainfo` instalado e a libva
  // respondendo — ela dizia "driver ausente" para uma placa que codifica fino. Não era driver: era
  // a API errada. NVENC não usa o render node: o ffmpeg abre `/dev/nvidiactl` sozinho, e o quadro
  // vai em memória de sistema — o próprio codificador o sobe para a placa.
  const gpuRes = !node
    ? { rotulo: 'gpu', ok: false, erro: 'nenhum render node acessível — ver o inventário acima' }
    : alvo.video === 'nvenc'
      ? medir((n) => [...fonte(n), '-vf', 'format=nv12', '-c:v', 'h264_nvenc', '-f', 'null', '-'], 'gpu')
    : alvo.video === 'vaapi'
      ? medir((n) => ['-vaapi_device', node, ...fonte(n),
                      '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'], 'gpu')
    // Virtual, ou driver que a descoberta não conhece. Tentar VA-API aqui é o que produzia "driver
    // ausente" numa placa que não tem, nem vai ter, codificador.
    : { rotulo: 'gpu', ok: false,
        erro: `${alvo.fabricante} (${alvo.driver || 'sem driver'}) não codifica vídeo por caminho ` +
              'nenhum que este benchmark conheça — ' +
              (alvo.virtual ? 'é uma placa VIRTUAL, ela existe para desenhar tela'
                            : 'driver fora da tabela da descoberta') };

  // A razão só existe quando os DOIS lados mediram. Inventar um número a partir de um lado que
  // falhou seria pior que não ter número nenhum.
  const ganho = cpu.ok && gpuRes.ok && cpu.fps > 0 ? +(gpuRes.fps / cpu.fps).toFixed(2) : null;
  // Quantas vezes menos processador a placa gasta pelo mesmo trabalho. É a razão que importa num
  // servidor compartilhado, e é `null` quando não deu para medir — nunca um chute.
  const economia = ganho !== null && cpu.cpuMs && gpuRes.cpuMs ? +(cpu.cpuMs / gpuRes.cpuMs).toFixed(1) : null;
  // Só quando falhou, e só quando há placa: perguntar "o que você sabe fazer?" a uma placa que
  // acabou de codificar seria gastar segundos para confirmar o óbvio.
  const capacidades = !gpuRes.ok && node ? _oQueAPlacaSabe(alvo) : null;

  let leitura;
  if (ganho === null) {
    leitura = gpuRes.ok ? 'não deu para comparar'
      // O diagnóstico primeiro, o stderr depois. Quem lê quer saber o que FAZER; o texto do ffmpeg
      // é a prova, e ela vem embaixo para quem for atrás.
      : `a GPU não codificou — ${gpuRes.diagnostico || gpuRes.erro}`;
  } else if (ganho >= 1.2) {
    leitura = `a GPU deste servidor é ${ganho}× mais rápida que a CPU neste trabalho` +
              (economia ? `, gastando ${economia}× menos processador` : '');
  } else if (economia && economia >= 3) {
    // O caso da placa boa ao lado de uma CPU enorme. Parede a CPU ganha; processador a placa ganha
    // de longe — e é o processador que o resto do ambiente está usando.
    const nucleos = require('node:os').availableParallelism?.() || require('node:os').cpus().length || 1;
    leitura = `a GPU é mais lenta que ESTA CPU em parede (${ganho}×) — são ${nucleos} núcleos contra ` +
              `um motor de vídeo — mas gasta ${economia}× menos processador. Num servidor ` +
              'compartilhado é isso que vale: o transcode corre sem tirar os núcleos de quem está ' +
              'trabalhando';
  } else if (ganho <= 0.8) {
    // Sem "placa virtual" aqui: uma virtual nem chega a medir (`video` é null). Era esta frase,
    // solta para qualquer razão baixa, que chamou uma RTX A5500 de placa virtual.
    leitura = `a GPU é MAIS LENTA que a CPU aqui (${ganho}×)` +
              (economia ? ' e não poupa processador' : '') + ' — esta placa não compensa neste trabalho';
  } else {
    leitura = `empate técnico (${ganho}×) — a GPU deste servidor não compensa neste trabalho`;
  }

  return {
    rodou: true, frames, renderNode: node, video: alvo?.video ?? null,
    cpu, gpu: gpuRes, ganho, economia, capacidades, leitura,
  };
}

/**
 * O corpo JSON de uma requisição — para os POSTs que o AMBIENTE faz no seu backend (o clique na
 * bandeja, a ação de uma notificação).
 *
 * Corpo ilegível vira `{}` em vez de erro, de propósito: estas rotas existem para reagir a um
 * clique do usuário, e derrubar a reação porque o JSON veio torto seria perder o gesto dele. O
 * teto é para que um corpo enorme não vire memória — um clique não tem 64 KB a dizer.
 */
function lerCorpo(req) {
  return new Promise((resolve) => {
    let corpo = '';
    req.on('data', (pedaco) => {
      corpo += pedaco;
      if (corpo.length > 64 * 1024) { corpo = ''; req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(corpo || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// O portão na frente de tudo: recusa quem não traz o `X-Vssh-App-Token` do ambiente (403 com
// `X-Vssh-Token: recusado`, em tempo constante), responde `GET /saude` com `{ok, versao, pid}` e
// entrega o resto ao handler. O `/saude` é o que o lifecycle sonda, até 15x/1s, segurando o
// clique de "abrir app"; a sondagem vai com o token, e a resposta não toca em nada, então ela diz
// só se o processo subiu. O que não conta como pronto é 000, 5xx e 401/403.
//
// O socket é 0600 do dono, e ainda assim outro processo do mesmo usuário Linux o alcança. Um app
// que dá acesso sensível (shell, arquivos) confere o token; um app trivial pode não conferir, e
// aí basta não passar pelo portão.
const server = http.createServer(servidor.portao(async (req, res) => {
  const url = new URL(req.url, BASE_URL);

  try {
    // ── A tarefa longa, e o ciclo completo de uma atividade ────────────────────
    //
    // O que este endpoint demonstra é o que um `kind:"service"` faz o dia inteiro: trabalho que
    // demora, com o usuário podendo estar olhando para outra coisa. Três decisões dentro dele:
    //
    //  1. `avisos.atividade` a cada passo, com a mesma chave. Ela reescreve no lugar: vinte
    //     relatos de progresso não viram vinte linhas no painel de quem está trabalhando;
    //  2. a renovação do `at`, ligada uma vez no boot por `manterAtividadesVivas()` (ver o topo
    //     do arquivo). O portal descarta a atividade que passa ~60 s sem renovar o carimbo de
    //     tempo, porque um arquivo chamado `live` sobrevive a um `kill -9`, e uma barra parada em
    //     30% para sempre é pior que barra nenhuma;
    //  3. `limparAtividade` com `registrar` no fim. A atividade some e deixa uma notificação. Se
    //     o desfecho não interessasse (uma indisponibilidade que se resolveu), seria
    //     `limparAtividade` sem argumento nenhum, e não sobraria rastro, que é o certo nesse caso.
    //
    // `?lento=1` é o que torna a decisão 2 observável: oito passos de 10 s passam de 80 s, bem
    // além do TTL de 60 s. Com a renovação ligada, a barra atravessa; sem ela, some no meio
    // sozinha, que é o defeito que dorme numa demonstração de 6 segundos.
    if (url.pathname === '/api/tarefa-longa' && req.method === 'POST') {
      const lento = url.searchParams.get('lento') === '1';
      const intervalo = lento ? 10000 : 800;
      const total = 8;
      let feito = 0;
      // Uma tarefa por vez: um segundo clique reinicia em vez de somar dois temporizadores
      // escrevendo na mesma chave. Dois donos do mesmo arquivo é progresso que anda para trás.
      if (tarefaEmCurso) clearInterval(tarefaEmCurso);
      const passo = () => {
        feito++;
        avisos.atividade('exemplo-backend', {
          titulo: 'Tarefa do backend',
          texto: `passo ${feito}${lento ? ' (devagar, atravessa o TTL)' : ''}`,
          formato: 'progresso',
          progresso: { feito, total },
        });
        if (feito >= total) {
          clearInterval(tarefaEmCurso);
          tarefaEmCurso = null;
          avisos.limparAtividade('exemplo-backend', {
            registrar: { titulo: 'Tarefa concluída', texto: `${total} passos`, level: 'success' },
          });
        }
      };
      passo();
      tarefaEmCurso = setInterval(passo, intervalo);
      // `unref`: um temporizador de demonstração não pode ser o motivo de o processo não encerrar.
      tarefaEmCurso.unref?.();

      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ iniciada: true, total, intervalo, duracaoMs: total * intervalo }));
      return;
    }

    // Uma notificação de backend com `chave` estável. O portal lê uma janela do fim do journal, e
    // não um delta, então é a chave que impede o mesmo aviso de chegar a cada tick. Chamar isto
    // dez vezes no mesmo dia rende uma notificação; no dia seguinte, outra.
    if (url.pathname === '/api/avisar' && req.method === 'POST') {
      const hoje = new Date().toISOString().slice(0, 10);
      avisos.notificar('O disco do servidor está acima de 90%.', {
        titulo: 'Hello World', nivel: 'warning', chave: `disco-cheio-${hoje}`,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ notificada: true, key: `disco-cheio-${hoje}` }));
      return;
    }

    // Uma notificação com ação, vinda do backend. A diferença para a de cima é a `rota`: sem ela,
    // o botão da notificação não teria para onde mandar a resposta. O clique pode acontecer com o
    // app sem janela nenhuma aberta, e é por isso que o destino é uma rota do processo, e não um
    // callback do frontend.
    if (url.pathname === '/api/avisar-com-acao' && req.method === 'POST') {
      avisos.notificar('O índice está desatualizado. Reconstruir agora?', {
        titulo: 'Hello World', nivel: 'warning', persistente: true,
        acoes: [{ id: 'reconstruir', label: 'Reconstruir' }],
        rota: '/api/acao',
        chave: `indice-${Date.now()}`,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ notificada: true, acao: 'reconstruir', rota: '/api/acao' }));
      return;
    }

    // O destino da ação. Quem faz este POST é o desktop, não o seu frontend.
    if (url.pathname === '/api/acao' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      log('acao-de-notificacao', { acao: corpo });   // aninhado pela mesma razão da rota da bandeja
      difundirEvento('acao', { ...corpo, em: new Date().toISOString() });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── A bandeja pela lib, e o clique que volta ────────────────────────────
    if (url.pathname === '/api/bandeja' && req.method === 'POST') {
      const ok = avisos.bandeja({
        icon: 'refresh',
        tooltip: 'Hello World, posto pelo backend',
        badge: { dot: true },
        menu: [
          { id: 'oi', label: 'Um item do menu' },
          { separator: true },
          { id: 'sair', label: 'Remover este ícone', danger: true },
        ],
        // Só dados atravessam o arquivo: aqui vai uma rota, e não uma função. É a mesma restrição
        // do menu de contexto, pela mesma razão, porque função não serializa.
        onClick: { path: '/api/bandeja/clique' },
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok, motivo: ok ? null : 'sem VSSH_APP_DATA_DIR nem VSSH_APP_ID' }));
      return;
    }

    if (url.pathname === '/api/bandeja' && req.method === 'DELETE') {
      avisos.limparBandeja();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/api/bandeja/clique' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      // Aninhado, e não espalhado. O `log` monta `{ts, event, ...detalhe}`, e o corpo que o
      // ambiente manda tem uma chave `event` (`click`/`menu`). Espalhá-lo sequestraria o nome do
      // evento: as duas rotas do app apareceriam no log como `"event":"click"` e `"event":"menu"`,
      // sem uma palavra dizendo que vieram da bandeja.
      log('clique-na-bandeja', { clique: corpo });
      if (corpo.menuId === 'sair') avisos.limparBandeja();
      difundirEvento('bandeja', corpo);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // O filesystem privado, servido pela lib. Ela devolve `true` quando atendeu, o mesmo contrato
    // do `spa`, e pela mesma razão: quem compõe as rotas é o app, e não a lib.
    if (await servirPrivado(req, res, url)) return;

    if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ pong: true, appId: APP_ID, time: new Date().toISOString() }));
      return;
    }

    // Exemplo de SSE. Prove que eventos chegam sem buffer: `curl -N <baseUrl>api/events`.
    //
    // O stream entra no difusor, e é isso que faz a demonstração de "duas janelas, um backend"
    // funcionar: quem incrementa é uma janela, e a difusão alcança todas as outras. O difusor
    // tira o stream do conjunto no `close` da resposta; sem isso, cada abrir-e-fechar de janela
    // deixaria um stream morto no conjunto e o número de conexões só subiria.
    if (url.pathname === '/api/events') {
      difusor.atender(res, (fluxo) => {
        fluxo.enviar('estado', estado());
        let n = 0;
        const timer = setInterval(() => {
          fluxo.enviar('tick', { n: ++n, time: new Date().toISOString() });
        }, 1000);
        fluxo.aoFechar(() => { clearInterval(timer); difundir(); });
      });
      return;
    }

    // ── Duas janelas, um backend ────────────────────────────────────────────
    //
    // O contador vive AQUI, no processo. Duas janelas do mesmo app (menu de contexto da janela →
    // "Nova janela") são duas visões deste mesmo processo — mesma porta, mesmo token, mesmo
    // VSSH_APP_DATA_DIR. É o que este par de rotas demonstra, e também o que ele avisa: estado de
    // UI guardado no backend passa a ter mais de um cliente.
    if (url.pathname === '/api/estado' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(estado()));
      return;
    }

    if (url.pathname === '/api/estado/incrementar' && req.method === 'POST') {
      contador += 1;
      difundir();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(estado()));
      return;
    }

    // ── O que o AMBIENTE decidiu por este processo ──────────────────────────
    //
    // Três coisas que o app não escolhe sozinho — ele DECLARA no manifesto e o ambiente decide.
    // Esta rota existe para que dê para ver as três de dentro do processo, que é o único lugar
    // onde a resposta é a verdadeira.
    if (url.pathname === '/api/runtime') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ limites: limitesDoCgroup(), gpu: gpuDoAmbiente(), segredo: segredo() }));
      return;
    }

    // O benchmark fica numa rota À PARTE, e num POST. Ele leva segundos e queima CPU: pendurá-lo
    // no `/api/runtime` faria toda abertura da galeria pagar por um número que ninguém pediu.
    if (url.pathname === '/api/gpu/benchmark' && req.method === 'POST') {
      const r = benchmarkGpu();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r));
      return;
    }

    // A fila: o que este servidor oferece (cluster, GPUs, quotas), e por que não.
    if (url.pathname === '/api/fila' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(await fila.disponivel()));
      return;
    }

    // A sonda: um job de verdade no cluster. POST, porque cria trabalho lá fora.
    if (url.pathname === '/api/fila/sonda' && req.method === 'POST') {
      let r;
      try { r = await sondarFila(); } catch (err) {
        r = { ok: false, motivo: `o portal recusou (${err.status ?? '?'}): ${err.mensagem || err.message}` };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r));
      return;
    }

    if (url.pathname.startsWith('/api/fila/sonda/') && req.method === 'GET') {
      const registro = sondas.get(url.pathname.slice('/api/fila/sonda/'.length));
      res.writeHead(registro ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(registro || { error: 'sonda desconhecida' }));
      return;
    }

    // O `spa` devolve false quando não atendeu: 404 é decisão de quem compõe as rotas.
    if (await spa(req, res, url)) return;

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('não encontrado\n');
  } catch (err) {
    log('request-failed', { path: url.pathname, message: err.message, stack: err.stack });
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('erro interno\n');
  }
}));

// `escutar` lê `$VSSH_APP_SOCKET`, limpa um socket órfão por tentativa de conexão, põe o modo
// 0600 e anuncia `[<id>] versão <v> escutando em <onde>` no stdout. Com `--tcp host:porta` na
// linha de comando ele abre uma porta, para a bancada.
servidor.escutar(server)
  .then(({ transporte, endereco }) => {
    log('listening', { transporte, endereco, appId: APP_ID, tokenRequired: Boolean(process.env.VSSH_APP_TOKEN) });
  })
  .catch((err) => {
    // `JA_ESCUTANDO` não é falha: outra instância já atende neste endereço, e o lifecycle trata
    // sair em silêncio como sucesso (é o mesmo contrato do `exit 0` do `vssh-app-run` quando
    // encontra alguém escutando). Qualquer outro erro é fatal e tem de aparecer: um backend que
    // não escuta e não reclama vira janela em branco sem causa.
    if (err.code === servidor.JA_ESCUTANDO) {
      log('already-listening', { message: err.message });
      process.exit(0);
    }
    log('listen-failed', { message: err.message, code: err.code });
    servidor.registrar(`não consegui escutar: ${err.message}`);
    process.exit(1);
  });

// Sem estes dois, uma falha assíncrona derruba o processo sem deixar rastro nenhum — e o lifecycle
// só mostra que o app "não subiu".
process.on('uncaughtException', (err) => log('uncaught', { message: err.message, stack: err.stack }));
process.on('unhandledRejection', (err) => log('unhandled-rejection', { message: String(err) }));
