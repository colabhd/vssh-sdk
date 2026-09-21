'use strict';

// A galeria: uma peça por capacidade do ambiente.
//
// Este arquivo é o par de `index.html` e existe separado dele por um motivo prático: a marcação
// diz o que cada peça prova, e o código mostra o idioma que você vai copiar. Misturar os dois num
// arquivo só fazia a explicação sumir dentro do script.
//
// Três coisas valem para tudo aqui embaixo:
//
//   1. URLs relativas, sempre. O app é servido sob `/<serverId>/proxy/app/<id>/`, então uma
//      barra no começo aponta para a raiz do portal, e não para o app.
//   2. `vssh` vem de `_sdk/vssh.js`, que o backend deste app injeta no `<head>` e o sistema serve
//      de dentro do espaço de URL do app. Nenhuma cópia viaja no pacote: a versão que roda é a do
//      shell que a serviu, e `vssh.app.capacidades().shellVersion` é a versão dos dois lados. Se
//      `vssh` não existir, o caminho respondeu 404, e é o que acontece com o backend rodando solto
//      na sua máquina, onde não há sistema para servi-lo.
//   3. Ausência é resposta. Shell e apps são publicados à parte, e a lista de verbos que
//      `capacidades()` devolve é como um app pergunta se o shell em que caiu tem o que ele
//      precisa. Toda peça pergunta antes de usar, e diz o que falta em vez de estourar um
//      `undefined` que leva junto tudo que vinha depois.

// Este arquivo é injetado pelo backend deste app, e não é uma `<script src>` escrita no HTML. A
// diferença é o carimbo: o static-spa põe o hash do conteúdo na URL do que injeta, então conteúdo
// novo mora noutra URL e nenhum cache do caminho pode servir o velho no lugar. Uma tag comum
// dependeria de revalidação por Last-Modified, o elo fraco que produz "atualizei o app e nada
// mudou".
//
// O preço é que ele roda antes do `</head>`, com o `<body>` ainda inexistente: daí a espera pelo
// DOM. Sem ela, todo `getElementById` devolveria null e a página ficaria inerte, sem um erro.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', montarGaleria, { once: true });
} else {
  montarGaleria();
}

function montarGaleria() {
  // ── O painel: a MESMA página servindo outra coisa ──────────────────────────
  //
  // A janela extra abre `?painel=1`, e é aqui que ela deixa de ser uma cópia. Um app real teria
  // uma rota própria (ou o roteador da SPA dele); num template de um arquivo, um parâmetro basta
  // para o ponto: o que muda entre as duas janelas é a VISÃO, não o processo — o contador abaixo
  // é o mesmo do backend, e mexer nele daqui mexe na janela grande.
  if (new URLSearchParams(location.search).has('painel')) return montarPainel();

  const $ = (id) => document.getElementById(id);
  const escrever = (id, texto) => { $(id).textContent = texto; };
  const falhar = (id, err) => { $(id).textContent = 'erro: ' + (err?.message || err); };

  // ── A gaveta ────────────────────────────────────────────────────────────────
  //
  // São 22 peças, e sem uma lateral a única forma de achar uma é rolar às cegas. A lateral é
  // persistente numa janela larga e vira gaveta numa estreita — quem decide é a largura do
  // CONTÊINER, não a da tela, porque um app pode estar numa janela pequena de um monitor grande.
  //
  // ⚠ A lista sai das PRÓPRIAS seções, e os ids também. Escrevê-la à mão criaria uma segunda lista
  // para manter, e o sintoma de esquecer seria uma peça que existe na página e não existe na
  // navegação — ou, pior, um item que aponta para uma seção apagada. É o mesmo argumento que fez a
  // galeria de ícones da biblioteca sair de `TuffIcones.nomes()`.
  (function montarGaveta() {
    const nav = document.getElementById('gaveta-nav');
    // Ausência não é erro: sem a biblioteca de UI a página continua inteira, só sem a lateral.
    if (!nav || typeof TuffGaveta === 'undefined') return;

    const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    for (const secao of document.querySelectorAll('.galeria > section')) {
      const h2 = secao.querySelector('h2');
      if (!h2) continue;
      const texto = h2.textContent.trim();
      if (!secao.id) secao.id = 's-' + slug(texto);
      const item = document.createElement('button');
      item.className = 'tuff-gaveta-item';
      item.dataset.alvo = secao.id;
      item.title = texto;               // o nome inteiro, já que o rótulo trunca
      const rotulo = document.createElement('span');
      rotulo.textContent = texto;       // textContent, e não innerHTML: título vem do DOM, não daqui
      item.appendChild(rotulo);
      nav.appendChild(item);
    }
    TuffGaveta.ligar(document.getElementById('gaveta'));
  })();

  // ── Ambiente ─────────────────────────────────────────────────────────────────
  //
  // A primeira peça, e a que responde "por que aquilo ali não funciona". `capacidades()` pergunta
  // ao shell, e a resposta traz a versão dele e a tabela de exportação: a lista de verbos e de
  // eventos que este shell sabe atender. É com essa lista que um app decide, antes de clicar, se
  // uma peça vai responder. O SDK é servido pelo mesmo shell, então não há uma segunda versão a
  // comparar: a que roda aqui é a de lá.
  (async () => {
    if (typeof vssh === 'undefined') {
      escrever('ambiente',
        'vssh AUSENTE: `_sdk/vssh.js` não foi servido.\n' +
        'Dentro do ambiente quem responde esse caminho é o sistema, sem nada a configurar no app. '
        + 'Fora dele (o backend rodando solto na sua máquina) o caminho responde 404 e tudo que '
        + 'depende da ponte fica desligado nesta página; o `api/vssh.js` do vssh-sdk é o mesmo '
        + 'arquivo, para quem quiser servi-lo em desenvolvimento.');
      return;
    }

    const linhas = [`dentro do ambiente: ${vssh.noAmbiente}`];
    try {
      const cap = await vssh.app.capacidades();
      // Fora do ambiente não há shell nenhum, e "shell antigo" seria diagnosticar um problema que
      // não existe. `shellVersion: null` tem duas causas, e elas pedem ações opostas.
      linhas.push(vssh.noAmbiente
        ? `shell do servidor: ${cap.shellVersion || 'não informada: shell velho demais para se declarar'}`
        : 'shell do servidor: nenhum, esta página está fora do ambiente');
      linhas.push(`host: ${cap.host} · apps nativos: ${cap.nativeApps} · interop X11: ${cap.x11Interop}`);
      const verbos = Array.isArray(cap.verbos) ? cap.verbos : [];
      linhas.push(`tabela de exportação: ${verbos.length} verbo(s), ${(cap.eventos || []).length} evento(s)`);
      // O idioma de perguntar antes de usar: um nome da tabela, e não um `typeof` sobre o objeto.
      // A função `vssh.janela.abrir` existe em todo SDK; o que varia é o shell saber respondê-la.
      linhas.push(`janela.abrir neste shell: ${verbos.includes('janela.abrir') ? 'sim' : 'não'}`);
    } catch (e) {
      linhas.push('capacidades() falhou: ' + e.message);
    }
    linhas.push(`File System Access: ${typeof showDirectoryPicker === 'function' ? 'disponível' : 'ausente'}`);
    escrever('ambiente', linhas.join('\n'));
  })();

  // ── Backend próprio ──────────────────────────────────────────────────────────

  // ── O que o ambiente decidiu por este app ───────────────────────────────────
  //
  // Lida no boot, e não só no clique: as três respostas valem para ESTA execução do processo, e a
  // mais comum delas ("o segredo ainda não chegou porque o app não reiniciou") só faz sentido se
  // estiver na tela antes de alguém procurar por ela.
  async function lerRuntime() {
    escrever('runtimeout', 'lendo...');
    try {
      const r = await fetch('api/runtime');
      const d = await r.json();
      const linhas = [
        `limite  ${d.limites?.contido === true ? `APLICADO — memory.max=${d.limites.memoryMax}`
          : d.limites?.contido === false ? `NÃO aplicado (memory.max=${d.limites.memoryMax || '—'})`
          : `não sei — ${d.limites?.motivo || 'sem resposta'}`}`,
        d.limites?.memoryCurrent ? `        usando agora: ${d.limites.memoryCurrent} bytes` : null,
        // O que o lançador decidiu, e não um inventário feito pelo app: `concedida` com a lista
        // do que este processo abre, ou o motivo da negativa (não declarada no manifesto, sem
        // placa utilizável, sem registro porque o app subiu fora do lançador).
        `GPU     ${d.gpu?.concedida ? 'concedida' : `negada: ${d.gpu?.motivo || 'sem resposta'}`}`,
        d.gpu?.dispositivos?.length
          ? d.gpu.dispositivos.map((g) =>
              `        ${g.card}: ${g.fabricante} ${g.vendor || ''} driver=${g.driver || '—'}` +
              `${g.virtual ? ' (virtual)' : ''} via=${g.video || 'sem codificador de vídeo'}`).join('\n')
          : null,
        // Reportado ao LADO da decisão de propósito. Sozinha, a string vazia é ambígua: ela é o
        // mesmo valor para "o ambiente escondeu de mim" e para "não há placa nenhuma".
        `CUDA    CUDA_VISIBLE_DEVICES=${JSON.stringify(d.gpu?.cudaVisibleDevices)}` +
          `${d.gpu?.cudaVisibleDevices === '' ? ', escondida deste app pelo lançador' : ''}`,
        `cofre   ${d.segredo?.definido
          ? `HELLO_SEGREDO chegou (${d.segredo.tamanho} caracteres, sha256 ${d.segredo.sha256}…)`
          : d.segredo?.leitura}`,
        // O caso do meio merece destaque, porque é o que parece defeito e não é: guardado no cofre
        // e ausente do ambiente significa só que o processo é mais velho que o segredo.
        d.segredo?.noCofre ? '        ↑ o cofre TEM o valor; falta este processo reiniciar' : null,
        '',
        JSON.stringify(d, null, 2),
      ].filter((l) => l !== null);
      escrever('runtimeout', linhas.join('\n'));
    } catch (e) { falhar('runtimeout', e); }
  }
  $('runtime').addEventListener('click', lerRuntime);
  lerRuntime();

  // O benchmark. Botão desabilitado enquanto roda: ele leva segundos e queima CPU, e dois cliques
  // seguidos mediriam um contra o outro.
  $('bench').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; const antes = b.textContent;
    b.disabled = true; b.textContent = 'medindo…';
    escrever('runtimeout', 'codificando o mesmo vídeo em CPU e em GPU…');
    try {
      const r = await fetch('api/gpu/benchmark', { method: 'POST' });
      const d = await r.json();
      // O fps é o de REGIME (partida descontada), e o processador vem ao lado: 500 fps de x264
      // são 16 núcleos a 100%, 400 de NVENC são um — a média de parede sozinha esconde isso.
      const lado = (l) => (l.ok
        ? `${l.fps} fps em regime · partida ${l.partida} ms`
          + (l.cpuMs != null ? ` · ${l.cpuMs} ms de processador` : '')
        : `falhou: ${l.erro}`);
      escrever('runtimeout', d.rodou
        ? [
            d.leitura,
            '',
            `cpu   ${lado(d.cpu)}`,
            `gpu   ${lado(d.gpu)}`,
            `nó    ${d.renderNode || '—'}`,
            // O caminho pelo qual a placa codifica — NVENC numa NVIDIA, VA-API em Intel e AMD. É
            // o que separa "tem placa" de "o vídeo acelera", e o que o benchmark escolheu.
            `via   ${d.video || '— (esta placa não codifica vídeo)'}`,
            // O que a placa DIZ que sabe fazer, quando o encode falhou — pela ferramenta do caminho
            // dela (`vainfo`, ou o próprio ffmpeg no NVENC). É a resposta à pergunta seguinte —
            // "então ela serve para quê?" — em vez de um beco.
            d.capacidades?.tem
              ? `\n${d.capacidades.ferramenta} (codifica: ${d.capacidades.codifica ? 'sim' : 'NÃO'}):\n` +
                d.capacidades.entrypoints.map((l) => `      ${l}`).join('\n')
              : d.capacidades ? `\n${d.capacidades.ferramenta} não respondeu: ${d.capacidades.motivo}` : null,
          ].filter((l) => l !== null).join('\n')
        : `não deu para medir — ${d.motivo}`);
    } catch (e) { falhar('runtimeout', e); }
    b.disabled = false; b.textContent = antes;
  });

  // ── A fila de processamento ──────────────────────────────────────────────────
  //
  // Lida no boot como o runtime: "disponível ou não, e por quê" vale para esta execução do
  // processo, e o motivo mais comum (o app ainda não reiniciou desde que declarou) só ajuda se
  // estiver na tela antes de alguém clicar.
  async function lerFila() {
    escrever('filaout', 'lendo...');
    try {
      const r = await fetch('api/fila');
      const d = await r.json();
      const linhas = [
        `fila    ${d.disponivel ? `disponível: cluster ${d.cluster}` : `indisponível: ${d.motivo || 'sem resposta'}`}`,
        d.gpus?.length
          ? `GPUs    ${d.gpus.map((g) => `${g.tipo} (${g.memoriaGiB} GiB)`).join(', ')}`
          : (d.disponivel ? 'GPUs    nenhuma neste cluster' : null),
        d.disponivel ? `quotas  ${d.quotas?.maxJobs} jobs, ${d.quotas?.maxGpus} GPUs, prazo até ${d.quotas?.maxPrazoS} s` : null,
        d.disponivel ? `em uso  ${d.uso?.ativos ?? 0} jobs, ${d.uso?.gpus ?? 0} GPUs` : null,
        '',
        JSON.stringify(d, null, 2),
      ].filter((l) => l !== null);
      escrever('filaout', linhas.join('\n'));
    } catch (e) { falhar('filaout', e); }
  }
  $('fila-ler').addEventListener('click', lerFila);
  lerFila();

  // A sonda. O POST devolve na hora, com o id; o resto é acompanhar. A galeria lê o registro do
  // backend a cada dois segundos em vez de assinar o SSE: o processo é quem acompanha o job, e a
  // janela pode fechar e reabrir no meio sem perder nada.
  $('fila-sonda').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; const antes = b.textContent;
    b.disabled = true; b.textContent = 'submetendo…';
    escrever('filaout', 'submetendo o nvidia-smi ao cluster…');
    try {
      const r = await fetch('api/fila/sonda', { method: 'POST' });
      let d = await r.json();
      if (!d.ok) { escrever('filaout', `não deu para submeter: ${d.motivo}`); return; }
      const pintar = () => escrever('filaout', [
        `job     ${d.id}`,
        `estado  ${d.estado}${d.motivo ? ` (${d.motivo})` : ''}`,
        d.gpu ? `GPU     1× ${d.gpu}` : 'GPU     nenhuma pedida',
        '',
        ...(d.eventos || []).map((l) => `  ${l}`),
        d.saida != null ? `\n${d.saida}` : null,
      ].filter((l) => l !== null).join('\n'));
      pintar();
      b.textContent = 'acompanhando…';
      while (!d.fim) {
        await new Promise((ok) => setTimeout(ok, 2000));
        const s = await fetch(`api/fila/sonda/${encodeURIComponent(d.id)}`);
        if (!s.ok) break;
        d = await s.json();
        pintar();
      }
    } catch (e) { falhar('filaout', e); }
    finally { b.disabled = false; b.textContent = antes; }
  });

  // A seção deste app em Configurações. O manifesto a declara opcional (`settingsOptIn`), então
  // ela só existe para quem a ligar aqui: `ligada()` lê o estado, `ligar()` grava a escolha (por
  // usuário, e ela acompanha a pessoa), e `abrir()` leva a Configurações na seção. Num app que
  // não declara, `ligada()` responde `{ ligada: true, opcional: false }`, e o interruptor não
  // teria o que fazer.
  const secaoEstado = $('secao-estado');
  const secaoLigar = $('secao-ligar');
  const pintarSecao = (r) => {
    if (r === null) {
      secaoLigar.disabled = true;
      secaoEstado.textContent = 'sem ponte com o ambiente (dev local).';
      return;
    }
    secaoLigar.checked = r.ligada;
    secaoLigar.disabled = !r.opcional;
    secaoEstado.textContent = r.opcional
      ? (r.ligada ? 'ligada: a seção está na lateral de Configurações.' : 'desligada: Configurações não a lista.')
      : 'este app não declara settingsOptIn: a seção existe sempre.';
  };
  if (window.vssh?.configuracoes) vssh.configuracoes.ligada().then(pintarSecao).catch(() => pintarSecao(null));
  else pintarSecao(null);
  secaoLigar.addEventListener('change', async () => {
    try { pintarSecao(await vssh.configuracoes.ligar(secaoLigar.checked)); }
    catch (e) { secaoEstado.textContent = String(e?.message || e); }
  });
  $('secao-abrir').addEventListener('click', async () => {
    if (!window.vssh?.configuracoes) return pintarSecao(null);
    try {
      const r = await vssh.configuracoes.abrir();
      secaoEstado.textContent = r?.secao ? `aberta em Configurações, na seção ${r.secao}.` : 'Configurações abriu no índice: a seção está desligada.';
    } catch (e) { secaoEstado.textContent = String(e?.message || e); }
  });

  // O segredo, pedido de dentro do app. É a correção de desenho: quem sabe que falta credencial, e
  // sabe na hora em que falta, é o app, e não a tela de Configurações. O valor não passa por aqui:
  // `pedir` abre o campo de senha do ambiente, grava no servidor e responde só os nomes.
  $('segredo').addEventListener('click', async () => {
    if (!window.vssh?.segredos) return escrever('runtimeout', 'sem ponte com o ambiente (dev local).');
    escrever('runtimeout', 'pedindo o segredo ao ambiente…');
    try {
      const r = await vssh.segredos.pedir('HELLO_SEGREDO', 'Um segredo de demonstração',
        'Qualquer texto. Serve para demonstrar o cofre: ele vai para o SEU servidor e volta para '
        + 'este app como variável de ambiente.');
      if (r === null) return escrever('runtimeout', 'cofre indisponível fora do ambiente.');
      if (r.cancelado) return escrever('runtimeout', 'você cancelou, e cancelar é resposta, não erro.');
      escrever('runtimeout',
        `guardado. Agora em ${r.names.length} segredo(s): ${r.names.join(', ')}\n\n` +
        (r.requerReinicio
          ? 'REINICIE o app para recebê-lo: o ambiente de um processo é fixado no start.'
          : ''));
    } catch (e) { falhar('runtimeout', e); }
  });

  // O cofre tem três verbos e nenhum `ler`, por desenho: o valor chega ao app pelo ambiente do
  // processo (`HELLO_SEGREDO`), e um cofre que devolvesse o que guardou seria uma porta a mais sem
  // servir para nada. `listar` responde `{ names }`, só os nomes.
  $('segredo-listar').addEventListener('click', async () => {
    if (!window.vssh?.segredos) return escrever('runtimeout', 'sem ponte com o ambiente (dev local).');
    const r = await vssh.segredos.listar();
    escrever('runtimeout', r === null
      ? 'fora do ambiente não há cofre, e isso responde `null`, não uma lista vazia: '
        + '"não há onde perguntar" e "não há nada guardado" pedem coisas diferentes de quem lê.'
      : r.names.length
        ? `guardados para este app: ${r.names.join(', ')}\n(só os nomes; o valor não sai do seu servidor)`
        : 'nada guardado ainda para este app.');
  });

  $('segredo-apagar').addEventListener('click', async () => {
    if (!window.vssh?.segredos) return escrever('runtimeout', 'sem ponte com o ambiente (dev local).');
    const r = await vssh.segredos.apagar('HELLO_SEGREDO');
    escrever('runtimeout', r === null
      ? 'cofre indisponível fora do ambiente.'
      : `apagado. Restam: ${r.names.length ? r.names.join(', ') : '(nenhum)'}\n`
        + (r.requerReinicio
          ? 'O processo continua com o valor ANTIGO na memória até reiniciar: apagar do cofre não '
            + 'apaga do ambiente de um processo que já subiu.'
          : ''));
  });

  $('ping').addEventListener('click', async () => {
    escrever('out', 'chamando...');
    try {
      const r = await fetch('api/ping');
      escrever('out', JSON.stringify(await r.json(), null, 2));
    } catch (e) { falhar('out', e); }
  });

  // ── SSE, e a difusão que faz a peça das duas janelas funcionar ───────────────

  $('sub').addEventListener('click', (e) => {
    e.target.disabled = true;
    const src = new EventSource('api/events');
    src.addEventListener('tick', (m) => escrever('events', m.data));
    // O mesmo stream carrega o estado compartilhado: quem incrementa é uma janela, e a difusão
    // alcança todas. É por isso que o contador muda na janela em que você NÃO clicou.
    src.addEventListener('estado', (m) => mostrarEstado(JSON.parse(m.data)));
    // Os dois eventos que provam que o backend fala sem ser perguntado: o clique na BANDEJA e o
    // clique na AÇÃO de uma notificação chegam ao processo, não a esta página — e é por aqui que
    // esta página fica sabendo. Com a janela fechada, o backend teria recebido igual.
    src.addEventListener('bandeja', (m) => escrever('tray-back',
      `o backend recebeu um clique na bandeja: ${m.data}`));
    src.addEventListener('acao', (m) => escrever('live',
      `o backend recebeu a ação da notificação: ${m.data}\n`
      + 'Repare: esta janela não pediu nada. O clique foi do sino para o processo, e de lá para cá.'));
    src.onerror = () => {
      escrever('events', 'conexão SSE caiu');
      src.close();
      e.target.disabled = false;
    };
  });

  // ── Duas janelas, um backend ─────────────────────────────────────────────────

  function mostrarEstado(s) {
    escrever('estado',
      `contador: ${s.contador}\njanelas conectadas (SSE): ${s.conexoes}\nbackend subiu em: ${s.subiuEm}`);
  }

  $('somar').addEventListener('click', async () => {
    try {
      const r = await fetch('api/estado/incrementar', { method: 'POST' });
      mostrarEstado(await r.json());
    } catch (e) { falhar('estado', e); }
  });

  $('reler').addEventListener('click', async () => {
    try {
      const r = await fetch('api/estado');
      mostrarEstado(await r.json());
    } catch (e) { falhar('estado', e); }
  });

  // ── O armazém PRIVADO do app, servido pelo próprio backend ───────────────────
  //
  // Isto não passa pelo SDK: são rotas HTTP que a lib de filesystem do backend publica sob
  // `api/privado/`, confinadas a uma raiz dentro do VSSH_APP_DATA_DIR. Por isso funciona igual fora
  // do ambiente, e por isso não serve para os arquivos do usuário, que são a peça da File System
  // Access. O contrato é um RPC JSON num POST só: `{ op, …parâmetros }`. Um verbo HTTP por operação
  // pareceria mais REST e diria menos: `unlink` aqui move para a reciclagem em vez de apagar, e
  // chamá-lo de `DELETE` prometeria uma coisa que a lib deliberadamente não faz.
  const privado = async (rotulo, corpo) => {
    try {
      const r = await fetch('api/privado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const d = await r.json();
      escrever('privado', `${rotulo} → HTTP ${r.status}\n${JSON.stringify(d, null, 2)}`
        + (d.ok === false
          ? `\n\nO erro vem CLASSIFICADO (${d.error?.code}): um caminho que não existe é 404, e `
            + 'não um 500 dizendo que o servidor quebrou. É a diferença entre "o app pediu o que '
            + 'não há" e "o app está com defeito" — e só a segunda merece alguém acordado.'
          : ''));
    } catch (e) { falhar('privado', e); }
  };

  $('priv-escrever').addEventListener('click', () => privado('write-file nota.txt',
    { op: 'write-file', path: 'nota.txt', content: `gravado em ${new Date().toISOString()}\n` }));

  $('priv-listar').addEventListener('click', () => privado('readdir .', { op: 'readdir', path: '.' }));
  $('priv-ler').addEventListener('click', () => privado('read-file nota.txt',
    { op: 'read-file', path: 'nota.txt' }));

  // Clique duas vezes: a segunda responde o erro classificado de "não está lá". E repare no
  // `recycled` da primeira — `unlink` MOVE para a reciclagem; a lib não apaga nada de verdade.
  $('priv-apagar').addEventListener('click', () => privado('unlink nota.txt',
    { op: 'unlink', path: 'nota.txt' }));

  // A notificação de backend COM ação. O clique não volta para esta página: ele vai para o backend,
  // como POST — porque quando alguém clicar, a janela pode não existir mais. O backend difunde o
  // resultado pelo SSE, e é assim que a linha abaixo muda sem esta página ter pedido nada.
  $('avisar-backend-acao').addEventListener('click', async () => {
    const r = await fetch('api/avisar-com-acao', { method: 'POST' }).then((x) => x.json());
    escrever('live', `notificado com a ação "${r.acao}".\n`
      + 'Abra o sino e clique no botão da notificação: quem recebe é o BACKEND, na rota que o '
      + 'journal carregou em `onAction`. Esta janela fica sabendo pelo SSE — assine-o acima.');
  });

  // A janela EXTRA: o app pedindo, e escolhendo o que vai dentro. Fica aqui, e não no bloco da
  // ponte lá embaixo, porque é desta peça que ela fala; o `vssh` ausente é tratado na hora do
  // clique, com a explicação no lugar onde a pessoa está olhando. Os argumentos vão na ordem da
  // tabela: rota, título, largura, altura.
  $('extra').addEventListener('click', async () => {
    if (typeof vssh === 'undefined') {
      escrever('estado', 'sem o SDK não há a quem pedir a janela; veja a peça "Ambiente".');
      return;
    }
    const ok = await vssh.janela.abrir('?painel=1', 'Painel do Hello World', 380, 330);
    escrever('estado', ok
      ? 'painel aberto: outra janela, do MESMO backend. Some 1 aqui e olhe lá, e vice-versa.'
      : 'o shell recusou a janela extra (uma rota fora do app, ou um shell anterior a esta '
        + 'capacidade). O menu de contexto da janela tem "Nova janela", que abre uma CÓPIA.');
  });

  // ── Falar com outro app, sem ponte nossa ────────────────────────────────────
  //
  // `BroadcastChannel` é do navegador, e por isso este bloco fica FORA do `if (vssh)`: ele funciona
  // no `npm run dev` igual, e é o único mecanismo de conversa entre apps que o ambiente oferece —
  // de propósito. Shell e apps compartilham uma origem só, então a mensagem alcança as duas
  // janelas deste app, o shell, e qualquer outro vssh-app aberto.
  const canal = new BroadcastChannel('hello-world:exemplo');
  let recebidas = 0;
  canal.onmessage = (e) => {
    recebidas++;
    escrever('canalout', `recebi (${recebidas}): ${JSON.stringify(e.data)}\n`
      + 'veio de outra janela ou de outro app — nunca do backend, que não fala este canal.');
  };
  $('canal').addEventListener('click', () => {
    // A própria janela NÃO recebe o que ela mesma manda: é regra do BroadcastChannel, e quem
    // esperar o eco vai achar que o canal está quebrado. Abra o painel para ver chegando.
    canal.postMessage({ de: 'janela principal', em: new Date().toISOString() });
    escrever('canalout', 'mandei. Quem recebe é a OUTRA janela (abra o painel) ou outro app — '
      + 'quem envia não recebe o próprio eco, e isso é regra do navegador, não defeito.');
  });
  window.addEventListener('pagehide', () => canal.close());

  // ── Daqui para baixo tudo depende da ponte ───────────────────────────────────

  if (typeof vssh === 'undefined') {
    escrever('bridge', 'sem o SDK não há ponte; veja a peça "Ambiente".');
  } else {

    escrever('bridge', vssh.noAmbiente
      ? 'dentro do ambiente VSSH: diálogos e avisos são os do shell'
      : 'fora do ambiente: o SDK degrada para alert/confirm do navegador e os avisos vão ao console');

    // O aviso efêmero: some em segundos e não entra no histórico. Os argumentos vão na ordem da
    // tabela (mensagem, título, nível, duração, chave); a `chave` faz o segundo clique reescrever
    // o primeiro em vez de empilhar um aviso novo.
    $('toast').addEventListener('click', () => {
      vssh.avisos.avisar('Copiado', 'Hello World', 'info', 4000, 'exemplo');
      escrever('bridge', 'avisar: aparece e some. Olhe o sino, não há nada lá.');
    });

    // O fato: fica no sino até ser lido, com o id deste app como dono.
    $('notify').addEventListener('click', () => {
      vssh.avisos.notificar('Round-trip concluído', 'Hello World', 'success');
      escrever('bridge', 'notificar: abra o sino. Está lá, e continua lá amanhã.');
    });

    // `prioridade: 'alta'` fica na tela até a pessoa responder. A ação é dado (id e rótulo), e o
    // clique nela volta pelo evento `acaoDeNotificacao`, assinado logo abaixo, para a janela do
    // app que teve foco por último.
    $('notify-acao').addEventListener('click', () => {
      vssh.avisos.notificar('Não consegui falar com o servidor de índices.', 'Hello World', 'error',
        'alta', 'indice:falhou', [{ id: 'retry', label: 'Tentar de novo' }]);
      escrever('bridge', 'notificar com prioridade alta: não some sozinho, e pode ser respondido depois.');
    });
    vssh.avisos.ao('acaoDeNotificacao', ({ notificacaoId, acaoId }) => {
      escrever('bridge', `a pessoa clicou em "${acaoId}" na notificação ${notificacaoId}.\n`
        + 'Chegou a esta janela pelo evento `acaoDeNotificacao`; quem sabe o que o id significa é o app.');
    });

    // Os cinco diálogos. Repare no que se faz com a resposta: `perguntar` e `senha` devolvem
    // `null` quando a pessoa desiste, e `null` não é string vazia. Quem trata os dois igual grava
    // um valor em branco por cima do que já estava lá.
    $('dialog-alert').addEventListener('click', async () => {
      await vssh.dialogos.mostrar('Um recado, sem pergunta nenhuma.', 'Hello World');
      escrever('bridge', 'mostrar: fechou. Ele não devolve valor, só interrompe.');
    });

    $('dialog-error').addEventListener('click', async () => {
      await vssh.dialogos.erro('Não consegui abrir o índice.', 'Hello World');
      escrever('bridge', 'erro: o mesmo que mostrar, com a cor de erro. É tom, e não gravidade: '
        + 'para algo que a pessoa vá querer reencontrar, use notificar.');
    });

    $('confirm').addEventListener('click', async () => {
      const ok = await vssh.dialogos.confirmar('Isto veio do ambiente, não do navegador. Confirma?');
      escrever('bridge', 'confirmar devolveu: ' + ok);
    });

    $('dialog-prompt').addEventListener('click', async () => {
      const v = await vssh.dialogos.perguntar('Como você quer chamar isto?', 'sem título');
      escrever('bridge', v === null
        ? 'perguntar devolveu null: a pessoa DESISTIU. Não é o mesmo que texto vazio.'
        : `perguntar devolveu: ${JSON.stringify(v)}`);
    });

    $('dialog-password').addEventListener('click', async () => {
      const v = await vssh.dialogos.senha('Digite uma senha qualquer (nada é guardado).');
      escrever('bridge', v === null
        ? 'senha devolveu null: desistiu.'
        : `senha devolveu ${v.length} caractere(s), e a galeria não mostra o valor, `
          + 'porque um app que ecoa uma senha põe a senha no log de alguém.');
    });

    // ── Menu de contexto ───────────────────────────────────────────────────────
    //
    // Só dados atravessam: nem HTML, nem função. O shell devolve o `id` do escolhido (ou o
    // `label`, se o item não tiver id) e `null` quando fecharam sem escolher, e `null` aqui é
    // resposta, não erro.
    let marcado = true;
    const abrirMenu = async (ev) => {
      ev.preventDefault();
      // Coordenadas do seu viewport: quem soma a posição da janela é o shell. Passar coordenada de
      // tela abriria o menu longe do ponteiro, e a distância cresce com a janela mais para a direita.
      const escolha = await vssh.dialogos.menuDeContexto(ev.clientX, ev.clientY, [
        { header: 'Uma peça da galeria' },
        { id: 'copiar', label: 'Copiar', icon: 'copy' },
        { id: 'marcar', label: 'Marcado', checked: marcado },
        { id: 'inerte', label: 'Indisponível agora', disabled: true },
        { separator: true },
        {
          label: 'Mais',
          submenu: [
            { id: 'sub-a', label: 'Item de submenu' },
            // Um nível só: o shell ignora submenu dentro de submenu, então o que estivesse aqui
            // dentro simplesmente não apareceria, sem erro nenhum.
            { id: 'sub-b', label: 'Outro' },
          ],
        },
        { separator: true },
        { id: 'apagar', label: 'Apagar', icon: 'trash', danger: true },
      ]);
      if (escolha === 'marcar') marcado = !marcado;
      escrever('menuout', escolha === null
        ? 'fechou sem escolher: `null`, que é resposta e não erro'
        : `escolheu: ${escolha}${escolha === 'marcar' ? ` (agora ${marcado ? 'marcado' : 'desmarcado'})` : ''}`);
    };
    $('menu').addEventListener('contextmenu', abrirMenu);
    $('menu').addEventListener('click', abrirMenu);

    // ── Controles da janela ────────────────────────────────────────────────────
    //
    // O app pede; quem decide é o ambiente. Minimizar sem volta deixaria a peça sem saída, daí o
    // `restaurar` no relógio, que é o mesmo cuidado de não abrir um diálogo sem botão de fechar.
    $('win-min').addEventListener('click', () => {
      escrever('janela', 'minimizada, volta em 2 s');
      vssh.janela.minimizar();
      setTimeout(() => { vssh.janela.restaurar(); escrever('janela', 'restaurada pelo relógio'); }, 2000);
    });
    $('win-max').addEventListener('click', () => {
      vssh.janela.maximizar();
      escrever('janela', 'maximizada. Não existe redimensionar nem posicionar: depois do manifesto, '
        + 'o tamanho é do usuário.');
    });
    $('win-restore').addEventListener('click', () => {
      vssh.janela.restaurar();
      escrever('janela', 'restaurada');
    });

    // ── O que está acontecendo agora ────────────────────────────────────────────
    //
    // O ciclo inteiro num só lugar: `atividade` a cada passo (a mesma chave reescreve no lugar), e
    // `encerrarAtividade` no fim. Com `registrar`, o fim vira uma notificação; sem, a atividade só
    // some, que é o certo para uma condição que deixou de valer e não é um fato a guardar.

    let _liveTimer = null;

    const pararLive = (registrar) => {
      clearInterval(_liveTimer);
      _liveTimer = null;
      vssh.avisos.encerrarAtividade('exemplo', registrar || undefined);
    };

    $('live-ir').addEventListener('click', () => {
      if (_liveTimer) return;
      const total = 10;
      let feito = 0;
      const passo = () => {
        feito++;
        vssh.avisos.atividade('exemplo', {
          titulo: 'Processando',
          texto: `item ${feito}`,
          formato: 'progresso',
          progresso: { feito, total },
        });
        escrever('live', `${feito} de ${total}: olhe a bandeja e o painel do sino`);
        if (feito >= total) {
          pararLive({ titulo: 'Processamento concluído', texto: `${total} itens`, level: 'success' });
          escrever('live', 'acabou: a atividade sumiu, e deixou UMA notificação no sino');
        }
      };
      passo();
      _liveTimer = setInterval(passo, 700);
    });

    $('live-parar').addEventListener('click', () => {
      pararLive(null);
      escrever('live', 'desisti: a atividade sumiu SEM deixar rastro nenhum');
    });

    // O MESMO ciclo, do outro lado: quem escreve é o backend, por arquivo, e funciona com esta
    // janela fechada — que é o caso que um `kind:"service"` vive.
    $('live-backend').addEventListener('click', async () => {
      const r = await fetch('api/tarefa-longa', { method: 'POST' }).then(x => x.json());
      escrever('live', `o backend começou ${r.total} passos — feche esta janela e olhe a bandeja`);
    });

    // A MESMA rota, devagar de propósito: 80 s é mais que o TTL de 60 s com que o portal descarta
    // uma atividade que parou de renovar o carimbo. É a única forma de VER a renovação funcionando
    // — numa tarefa de seis segundos, um backend que esqueceu o `keepLiveAlive()` parece correto.
    $('live-backend-lento').addEventListener('click', async () => {
      const r = await fetch('api/tarefa-longa?lento=1', { method: 'POST' }).then(x => x.json());
      escrever('live', `o backend começou ${r.total} passos de ${r.intervalo / 1000}s `
        + `(${r.duracaoMs / 1000}s no total).\nO TTL do portal é ~60s: se a barra atravessar, a `
        + `renovação está ligada; se sumir no meio, falta keepLiveAlive() no backend.`);
    });

    $('avisar-backend').addEventListener('click', async () => {
      const r = await fetch('api/avisar', { method: 'POST' }).then(x => x.json());
      escrever('live', `notificado com key “${r.key}” — clicar de novo hoje NÃO gera outra`);
    });

    // ── Bandeja ────────────────────────────────────────────────────────────────
    //
    // Só dados atravessam a ponte: função não serializa. O clique no ícone e a escolha no menu
    // voltam pelo evento `acaoNaBandeja`, assinado uma vez; o shell devolve só o id do item, e quem
    // sabe o que ele significa é o app.
    let pendentes = 0;

    const mostrarNaBandeja = async () => {
      const ok = await vssh.avisos.bandeja({
        icon:    'refresh',
        tooltip: pendentes ? `Hello World: ${pendentes} pendente(s)` : 'Hello World: ocioso',
        badge:   { count: pendentes },      // count 0 remove o badge, não desenha um "0"
        menu: [
          { id: 'focus', label: 'Trazer a janela para a frente', icon: 'launch' },
          { separator: true },
          { id: 'reset', label: 'Zerar contador', icon: 'refresh', danger: true },
        ],
      });
      // `false` não é erro: é "este ambiente não tem bandeja", que é o caso fora do ambiente.
      escrever('tray', ok ? `na bandeja (badge: ${pendentes})` : 'sem bandeja neste ambiente');
    };
    vssh.avisos.ao('acaoNaBandeja', ({ evento, menuId }) => {
      if (evento === 'click') return escrever('tray', 'clique esquerdo no ícone da bandeja');
      escrever('tray', 'menu da bandeja: ' + menuId);
      if (menuId === 'focus') vssh.janela.focar();
      if (menuId === 'reset') { pendentes = 0; mostrarNaBandeja(); }
    });

    $('tray-on').addEventListener('click', mostrarNaBandeja);
    $('tray-bump').addEventListener('click', () => { pendentes++; mostrarNaBandeja(); });
    $('tray-off').addEventListener('click', async () => {
      await vssh.avisos.tirarDaBandeja();
      pendentes = 0;
      escrever('tray', 'removido da bandeja');
    });

    // ── Impressão ──────────────────────────────────────────────────────────────
    //
    // Duas chamadas, e a primeira dá sentido à segunda: `escolherArquivo` é onde o usuário
    // escolhe. `imprimir` resolve quando a tela abre, e não quando o usuário imprime: o app não
    // fica sabendo o que foi impresso, e não precisa.
    $('print').addEventListener('click', async () => {
      const path = await vssh.arquivos.escolherArquivo('Escolha um arquivo para imprimir');
      if (!path) { escrever('printout', 'cancelado no seletor'); return; }
      const abriu = await vssh.impressao.imprimir(path);
      escrever('printout', abriu
        ? `tela de impressão aberta para ${path}`
        : 'imprimir devolveu false: fora do ambiente, ou shell sem suporte a impressão');
    });

    // ── A bandeja pela lib do BACKEND ──────────────────────────────────────────
    //
    // A mesma bandeja, pelo outro caminho — o do app SEM janela. Aqui a página só dispara: quem
    // escreve o `tray.json` é o processo, e o clique volta como POST no backend dele. É por isso
    // que o texto abaixo chega pelo SSE, e não como resposta desta requisição.
    $('tray-backend').addEventListener('click', async () => {
      const r = await fetch('api/bandeja', { method: 'POST' }).then((x) => x.json());
      escrever('tray-back', r.ok
        ? 'o BACKEND pôs o ícone. Clique nele: a resposta chega pelo SSE, porque quem recebe o '
          + 'clique é o processo — esta janela nem precisa estar aberta.'
        : `a lib não conseguiu escrever: ${r.motivo}`);
    });

    $('tray-backend-off').addEventListener('click', async () => {
      await fetch('api/bandeja', { method: 'DELETE' });
      escrever('tray-back', 'removido pelo backend');
    });

    // ── Seletores ──────────────────────────────────────────────────────────────
    //
    // Os três devolvem caminho absoluto no servidor, ou `null`. O `null` do cancelamento é
    // indistinguível do `null` de "fora do ambiente" de propósito: nos dois casos não há caminho, e
    // o app não deve seguir como se houvesse. Os argumentos vão na ordem da tabela: título,
    // filtro, pasta, nome.
    $('pick-file').addEventListener('click', async () => {
      const p = await vssh.arquivos.escolherArquivo('Escolha um arquivo', 'Texto (*.txt *.md)');
      escrever('picks', p ? `escolherArquivo → ${p}` : 'escolherArquivo → null (cancelado, ou fora do ambiente)');
    });

    $('pick-save').addEventListener('click', async () => {
      // O `nome` só faz sentido aqui: é o que aparece preenchido na caixa de salvar.
      const p = await vssh.arquivos.escolherDestino('Onde salvar?', undefined, undefined, 'exemplo.txt');
      escrever('picks', p
        ? `escolherDestino → ${p}\n(o arquivo NÃO foi criado: o seletor devolve um caminho, quem escreve é você)`
        : 'escolherDestino → null (cancelado)');
    });

    $('pick-dir').addEventListener('click', async () => {
      const p = await vssh.arquivos.escolherPasta('Escolha uma pasta');
      escrever('picks', p ? `escolherPasta → ${p}` : 'escolherPasta → null (cancelado)');
    });

    // ── Abrir no ambiente ──────────────────────────────────────────────────────

    $('abrir-arquivo').addEventListener('click', async () => {
      const p = await vssh.arquivos.escolherArquivo('Escolha um arquivo para abrir no visualizador');
      if (!p) return escrever('abrir', 'cancelado no seletor');
      vssh.arquivos.abrir(p);
      escrever('abrir', `pedi para abrir ${p}\nQuem escolhe o visualizador é o ambiente, pela `
        + 'extensão: PDF e vídeo no navegador do ambiente, texto no editor, planilha no editor de '
        + 'office. O app não decide, e não fica sabendo: não há resposta para esperar.');
    });

    $('abrir-pasta').addEventListener('click', async () => {
      const p = await vssh.arquivos.escolherPasta('Escolha uma pasta');
      if (!p) return escrever('abrir', 'cancelado no seletor');
      vssh.arquivos.abrirPasta(p);
      escrever('abrir', `abri ${p} no gerenciador de arquivos do ambiente`);
    });

    $('abrir-com').addEventListener('click', async () => {
      const p = await vssh.arquivos.escolherArquivo('Escolha um arquivo');
      if (!p) return escrever('abrir', 'cancelado no seletor');
      const escolhido = await vssh.arquivos.abrirCom(p);
      escrever('abrir', escolhido
        ? `o usuário escolheu abrir com: ${escolhido}`
        : 'fechou sem escolher: `null`, e não um erro');
    });

    $('abrir-url').addEventListener('click', async () => {
      await vssh.arquivos.abrirLink('https://example.org/');
      escrever('abrir', 'abri no navegador DO AMBIENTE.\n'
        + 'Repare no que isso significa: aquele navegador resolve a rede a partir do servidor '
        + 'Linux. Um `http://localhost:3000` ali é o loopback DO SERVIDOR, não o da sua máquina, '
        + 'e é assim que se alcança um serviço que só escuta lá dentro. Só http/https: o ambiente '
        + 'recusa o resto, porque um esquema arbitrário abriria o que o app quisesse na máquina '
        + 'de quem olha.');
    });

    // O link comum ao lado não tem handler, e é esse o ponto: o SDK intercepta `window.open` e o
    // clique em `target="_blank"`. O app não escreve uma linha e mesmo assim o link não escapa
    // para uma aba do navegador hospedeiro, onde ele estaria fora do ambiente.
    $('link-alvo').addEventListener('click', () => {
      escrever('abrir', 'este é um `<a target="_blank">` sem código nenhum: quem o desviou para o '
        + 'navegador do ambiente foi o SDK. É API sem chamada, o que um app portado ganha sem '
        + 'trocar uma linha.');
    });

    // ── Área de transferência ──────────────────────────────────────────────────

    $('clip-ler').addEventListener('click', async () => {
      const c = await vssh.arquivos.areaDeTransferencia();
      escrever('clip', c
        ? `${c.action}: ${c.paths.length} caminho(s)\n${c.paths.join('\n')}`
        : 'não há arquivo na área de transferência do ambiente (copie um no gerenciador de '
          + 'arquivos e tente de novo). `null` é "não havia", não uma falha.');
    });

    $('clip-por').addEventListener('click', async () => {
      const p = await vssh.arquivos.escolherArquivo('Escolha o arquivo a copiar');
      if (!p) return escrever('clip', 'cancelado no seletor');
      const quantos = await vssh.arquivos.copiarParaAreaDeTransferencia([p]);
      escrever('clip', quantos
        ? `copiado: ${p}\nAgora cole no gerenciador de arquivos: é a MESMA área de transferência.`
        : 'o ambiente recusou (fora do ambiente, ou shell mais antigo que este app)');
    });

    // A área de transferência muda por fora do app: quem copia um arquivo é o gerenciador de
    // arquivos, e o app não tem como saber sozinho. Este ouvinte não tem botão de propósito: ele
    // já está ligado desde que a página abriu, e é assim que se escreve um "colar" que sabe se há
    // o que colar. Cancelar importa: o ouvinte vive no documento.
    const pararClipboard = vssh.arquivos.ao('areaDeTransferenciaMudou', ({ conteudo }) => {
      escrever('clip', conteudo
        ? `a área de transferência MUDOU por fora: ${conteudo.paths.length} caminho(s)\n${conteudo.paths.join('\n')}`
        : 'a área de transferência de arquivos foi esvaziada por fora');
    });
    window.addEventListener('pagehide', () => pararClipboard());

    $('clip-img-ler').addEventListener('click', async () => {
      try {
        const blob = await vssh.arquivos.imagemCopiada();
        escrever('clip', blob
          ? `imagem na área de transferência: ${blob.type}, ${blob.size} bytes`
          : 'não havia imagem: `null`, e isso não é erro');
      } catch (e) {
        // O motivo nomeado é o que separa "faltou o gesto" de "o navegador recusou". Sem ele, os
        // dois viram "falhou ao ler", e só um deles é conserto de quem escreve o app.
        escrever('clip', `recusado (${e.reason || 'sem motivo'}): ${e.message}\n` + ({
          'no-user-activation': 'o navegador exige um GESTO recente. Chame no clique, não depois '
            + 'de um await longo: este é o único dos quatro que se conserta no seu código.',
          denied: 'a permissão foi negada ao site. É decisão do usuário, no navegador.',
          unsupported: 'este navegador não lê imagem da área de transferência. Não há contorno.',
        }[e.reason] || ''));
      }
    });

    $('clip-img-por').addEventListener('click', async () => {
      // Uma imagem de mentira, desenhada agora: o template não carrega binário só para demonstrar.
      const cv = document.createElement('canvas');
      cv.width = 160; cv.height = 90;
      const g = cv.getContext('2d');
      g.fillStyle = '#4f8cff'; g.fillRect(0, 0, 160, 90);
      g.fillStyle = '#fff'; g.font = '16px system-ui'; g.fillText('hello vssh', 24, 50);
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
      try {
        const ok = await vssh.arquivos.copiarImagem(blob);
        escrever('clip', ok ? 'imagem copiada, cole em qualquer lugar' : 'o ambiente recusou');
      } catch (e) {
        escrever('clip', `recusado (${e.reason || 'sem motivo'}): ${e.message}`);
      }
    });

    // ── Arraste de arquivo, nas duas direções ──────────────────────────────────
    //
    // O contrato é um tipo MIME com caminhos absolutos, um por linha. Publicá-lo é o que faz as
    // três direções (ambiente para app, app para ambiente, app para app) caírem de uma coisa só.
    escrever('mime', vssh.arquivos.MIME);

    let soltos = [];
    const zonaDeSoltura = $('solte');
    // `aoSoltarArquivos` cuida do `preventDefault` no `dragover`. Sem ele o navegador entende que
    // o alvo recusa a soltura e o `drop` nunca acontece, sem erro nenhum: é a armadilha inteira.
    const desligar = vssh.arquivos.aoSoltarArquivos((info) => {
      soltos = info.caminhos;
      zonaDeSoltura.classList.remove('sobre');
      escrever('arrastar', `${info.caminhos.length} caminho(s), soltos em (${info.x}, ${info.y}):\n`
        + info.caminhos.join('\n')
        + '\n\nSão caminhos NO SERVIDOR, e não `File` do navegador. Para ler o conteúdo, '
        + '`vssh.arquivos.ler()` ou a File System Access; o arraste entrega o endereço, não os bytes.');
    }, { alvo: zonaDeSoltura });
    zonaDeSoltura.addEventListener('dragover', () => zonaDeSoltura.classList.add('sobre'));
    zonaDeSoltura.addEventListener('dragleave', () => zonaDeSoltura.classList.remove('sobre'));
    window.addEventListener('pagehide', () => desligar());

    // A direção de saída: o app escreve o mesmo tipo e avisa o ambiente, porque todo alvo de
    // soltura do ambiente abre o portão num estado do documento dele. `arrastarArquivos` faz as
    // duas coisas, e o fim do gesto é avisado sozinho.
    $('arraste').addEventListener('dragstart', (ev) => {
      const caminhos = soltos.length ? soltos : ['/etc/hostname'];
      const ok = vssh.arquivos.arrastarArquivos(ev.dataTransfer, caminhos);
      escrever('arrastar', ok
        ? `arrastando ${caminhos.length} caminho(s) para fora:\n${caminhos.join('\n')}\n`
          + 'Solte numa pasta do gerenciador de arquivos, ou noutro vssh-app.'
        : 'nenhum caminho absoluto para arrastar: o ambiente só aceita caminho absoluto.');
    });

    // ── Voltar no lugar certo ──────────────────────────────────────────────────

    $('rota-lembrar').addEventListener('click', () => {
      vssh.app.lembrarRota('?painel=1');
      escrever('rota', 'lembrado: "?painel=1".\nSe a sessão for restaurada, esta janela reabre no '
        + 'PAINEL em vez desta página, sem código de restauração nenhum do seu lado. É um '
        + 'ponteiro, e não um armazém: cabem 512 caracteres, e o que não couber num endereço vai '
        + 'para o backend do seu app.');
    });

    $('rota-limpar').addEventListener('click', () => {
      vssh.app.lembrarRota('');
      escrever('rota', 'esquecido: a janela volta a abrir na página inicial.');
    });

    // "Abra assim": o arquivo com que o app foi aberto, a pasta de um "Abrir Terminal Aqui", ou a
    // rota de um item da jump list quando a janela já estava aberta. Com o app fechado a rota entra
    // na URL; com ele aberto, chega pelo evento `abertura`, já com os nomes públicos dos campos
    // (`caminho`, `url`, `tipo`, `rota`). Sem tratar isto, o item da jump list funciona só na
    // primeira abertura, que é o defeito mais difícil de reparar (funciona uma vez).
    vssh.app.ao('abertura', (ctx) => {
      escrever('rota', `abriram este app com um contexto:\n${JSON.stringify(ctx, null, 2)}\n\n`
        + (ctx.rota ? `veio uma ROTA ("${ctx.rota}"): clique num item da jump list (botão direito `
            + 'no ícone do app). Quem navega é o app: o ambiente não sabe se ir a "/novo" é trocar '
            + 'de tela, abrir um painel ou criar um documento.'
          : ctx.caminho ? `veio um CAMINHO (${ctx.tipo || 'tipo não informado'}). É o que chega quando `
            + 'alguém abre um arquivo ".hello" com este app, ou pede "abrir aqui" numa pasta.'
          : ''));
      // Um app de verdade navegaria aqui (seu roteador, sua troca de tela). Esta galeria é de uma
      // página só, então ela faz o que cabe e é honesto: leva a rota pedida até onde ela é
      // visível. Inventar uma navegação de mentira ensinaria um padrão que não existe.
      if (ctx.rota) $('c-runtime').scrollIntoView({ behavior: 'smooth' });
    });

    // ── Arquivos do usuário: a File System Access API ──────────────────────────
    //
    // O polyfill entra junto com `_sdk/vssh.js` e responde `showDirectoryPicker()` pelo seletor do
    // ambiente. O handle é guardado no IndexedDB e sobrevive ao reload: um handle é objeto com
    // métodos e structured clone descarta métodos, e quem reidrata na leitura é o polyfill,
    // envelopando `IDBObjectStore.get`. Por isso este código é o mesmo que você escreveria num
    // navegador, sem nada de especial.
    const NOME = 'vssh-galeria.txt';
    const NOME2 = 'vssh-galeria-renomeado.txt';
    let pasta = null;
    let arquivo = NOME;

    const idb = {
      abrir: () => new Promise((ok, nao) => {
        const r = indexedDB.open('galeria', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('handles');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => nao(r.error);
      }),
      async guardar(chave, valor) {
        const db = await idb.abrir();
        return new Promise((ok, nao) => {
          const t = db.transaction('handles', 'readwrite');
          t.objectStore('handles').put(valor, chave);
          t.oncomplete = () => ok();
          t.onerror = () => nao(t.error);
        });
      },
      async ler(chave) {
        const db = await idb.abrir();
        return new Promise((ok, nao) => {
          const r = db.transaction('handles').objectStore('handles').get(chave);
          r.onsuccess = () => ok(r.result);
          r.onerror = () => nao(r.error);
        });
      },
    };

    const botoesDePasta = ['fsa-listar', 'fsa-escrever', 'fsa-ler', 'fsa-mover', 'fsa-apagar', 'fsa-permissao'];
    const habilitar = (ligado) => botoesDePasta.forEach((id) => { $(id).disabled = !ligado; });

    async function adotar(handle, origem) {
      pasta = handle;
      habilitar(true);
      // `queryPermission` responde de verdade — 'granted' ou 'prompt', consultando o shell. Não
      // presuma 'granted' só porque o handle voltou do IndexedDB: o usuário pode ter revogado.
      const estado = await pasta.queryPermission({ mode: 'readwrite' });
      escrever('fsa', `pasta: ${pasta.name} (${origem})\npermissão: ${estado}`);
    }

    $('fsa-pick').addEventListener('click', async () => {
      try {
        // Escolher É consentir — não há segunda confirmação. Quem abre o seletor é o desktop.
        const h = await showDirectoryPicker({ mode: 'readwrite' });
        await idb.guardar('pasta', h);
        await adotar(h, 'escolhida agora, e guardada no IndexedDB');
      } catch (e) {
        escrever('fsa', e?.name === 'AbortError' ? 'cancelado no seletor' : 'erro: ' + e.message);
      }
    });

    $('fsa-listar').addEventListener('click', async () => {
      try {
        const itens = [];
        for await (const [nome, h] of pasta.entries()) {
          itens.push(`${h.kind === 'directory' ? '📁' : '📄'} ${nome}`);
          if (itens.length >= 30) { itens.push('… (cortado em 30)'); break; }
        }
        escrever('fsa', `${pasta.name} — ${itens.length} entrada(s):\n` + (itens.join('\n') || '(vazia)'));
      } catch (e) { falhar('fsa', e); }
    });

    $('fsa-escrever').addEventListener('click', async () => {
      try {
        const fh = await pasta.getFileHandle(arquivo, { create: true });
        const w = await fh.createWritable();
        await w.write(`escrito pela galeria em ${new Date().toISOString()}\n`);
        await w.close();
        escrever('fsa', `${arquivo} gravado em ${pasta.name}`);
      } catch (e) { falhar('fsa', e); }
    });

    $('fsa-ler').addEventListener('click', async () => {
      try {
        const fh = await pasta.getFileHandle(arquivo);
        const f = await fh.getFile();
        escrever('fsa', `${arquivo} — ${f.size} bytes, ${new Date(f.lastModified).toLocaleString()}\n\n${await f.text()}`);
      } catch (e) { falhar('fsa', e); }
    });

    // `move()` não é do padrão original — é a parte de FileSystemHandle que o Chrome implementa e
    // que apps portados usam para renomear sem reescrever o arquivo inteiro. O handle é atualizado
    // no lugar: o mesmo objeto passa a apontar para o nome novo.
    $('fsa-mover').addEventListener('click', async () => {
      try {
        const fh = await pasta.getFileHandle(arquivo);
        const destino = arquivo === NOME ? NOME2 : NOME;
        await fh.move(destino);
        arquivo = destino;
        escrever('fsa', `renomeado para ${arquivo} — e o handle continua válido (${fh.name})`);
      } catch (e) { falhar('fsa', e); }
    });

    // `removeEntry` de uma PASTA não vazia falha sem `{ recursive: true }`, e isso é deliberado: a
    // rota de baixo é um `rm -rf`, então apagar em silêncio uma pasta cheia era perda de dado sem
    // desfazer. Aqui é arquivo, mas vale conhecer o guarda-corpo.
    $('fsa-apagar').addEventListener('click', async () => {
      try {
        await pasta.removeEntry(arquivo);
        escrever('fsa', `${arquivo} apagado`);
        arquivo = NOME;
      } catch (e) { falhar('fsa', e); }
    });

    // `requestPermission()` reabre o seletor, e por isso precisa de um GESTO do usuário — sem gesto
    // ele devolve 'prompt' sem abrir nada, que é a regra do navegador. Se a pessoa escolher outra
    // pasta, a resposta é 'denied' e o handle antigo continua fora. 'denied' é estado normal.
    $('fsa-permissao').addEventListener('click', async () => {
      try {
        const r = await pasta.requestPermission({ mode: 'readwrite' });
        escrever('fsa', `requestPermission devolveu: ${r}`);
      } catch (e) { falhar('fsa', e); }
    });

    // Reabre sozinho o que ficou de antes — é o caso real de um editor que volta no mesmo grafo.
    idb.ler('pasta')
      .then((h) => { if (h && typeof h.queryPermission === 'function') return adotar(h, 'restaurada do IndexedDB'); })
      .catch(() => {});

    // ── `vssh.arquivos`, por caminho ───────────────────────────────────────────

    let alvo = null;
    let pararWatch = null;
    const botoesDeCaminho = ['fs-exists', 'fs-stat', 'fs-read', 'fs-bytes', 'fs-copy', 'fs-rename',
                             'fs-watch'];

    $('fs-pick').addEventListener('click', async () => {
      alvo = await vssh.arquivos.escolherArquivo('Escolha um arquivo para exercitar vssh.arquivos');
      if (!alvo) { escrever('fs', 'cancelado no seletor'); return; }
      botoesDeCaminho.forEach((id) => { $(id).disabled = false; });
      escrever('fs', alvo);
    });

    // `existe` responde `{ exists }`, e só o 404 do servidor vira `false`. Permissão negada e
    // servidor fora lançam, porque "não pude perguntar" e "não existe" pedem do app ações opostas.
    $('fs-exists').addEventListener('click', async () => {
      try {
        const a = await vssh.arquivos.existe(alvo);
        const b = await vssh.arquivos.existe(alvo + '.nao-existe');
        escrever('fs', `existe(${alvo}) → ${a.exists}\n` +
                       `existe(${alvo}.nao-existe) → ${b.exists}`);
      } catch (e) { falhar('fs', e); }
    });

    $('fs-stat').addEventListener('click', async () => {
      try {
        const s = await vssh.arquivos.consultar(alvo);
        escrever('fs', `consultar(${alvo}):\n${JSON.stringify(s, null, 2)}\n\n`
          + `mtime é epoch em MILISSEGUNDOS: ${new Date(s.mtime).toLocaleString()}`);
      } catch (e) { falhar('fs', e); }
    });

    // As duas leituras, e a diferença não é estilo: texto-encodar bytes os corrompe. Um PNG lido
    // como texto volta maior e quebrado, e o defeito só aparece na hora de gravar de volta.
    $('fs-read').addEventListener('click', async () => {
      try {
        const t = await vssh.arquivos.ler(alvo);
        escrever('fs', `ler(${alvo}) → ${t.length} caracteres\n\n${t.slice(0, 600)}`
          + (t.length > 600 ? '\n… (cortado na exibição)' : ''));
      } catch (e) { falhar('fs', e); }
    });

    $('fs-bytes').addEventListener('click', async () => {
      try {
        const b = await vssh.arquivos.lerBytes(alvo);
        const hex = [...b.slice(0, 16)].map((n) => n.toString(16).padStart(2, '0')).join(' ');
        escrever('fs', `lerBytes(${alvo}) → ${b.length} bytes (Uint8Array)\nprimeiros 16: ${hex}\n\n`
          + 'Para binário é este o caminho: `ler()` devolve texto, e texto-encodar bytes os '
          + 'corrompe em silêncio; o arquivo só volta errado quando alguém o grava de volta.');
      } catch (e) { falhar('fs', e); }
    });

    // Origem e destino precisam ambos estar concedidos, e quem impõe isso é o shell. Como os dois
    // caminhos aqui moram na mesma pasta que o usuário escolheu no seletor, os dois estão dentro.
    // A política é o terceiro argumento: `'overwrite'` substitui um destino que já existe.
    $('fs-copy').addEventListener('click', async () => {
      try {
        await vssh.arquivos.copiar(alvo, alvo + '.bak', 'overwrite');
        escrever('fs', `copiado para ${alvo}.bak`);
      } catch (e) { falhar('fs', e); }
    });

    // Sem `'overwrite'` um destino existente falha, de propósito: perder arquivo em silêncio não
    // tem desfazer.
    $('fs-rename').addEventListener('click', async () => {
      try {
        await vssh.arquivos.renomear(alvo + '.bak', alvo + '.bak2');
        escrever('fs', `${alvo}.bak → ${alvo}.bak2`);
      } catch (e) { falhar('fs', e); }
    });

    // `acompanhar` é `vigiar` mais o evento `arquivoMudou` mais `pararDeVigiar`, com o id do vigia
    // escolhido pelo SDK. Devolve a função que para.
    $('fs-watch').addEventListener('click', async () => {
      if (pararWatch) {
        pararWatch(); pararWatch = null;
        $('fs-watch').textContent = 'acompanhar';
        escrever('fs', 'acompanhamento cancelado: o vigia do servidor foi solto');
        return;
      }
      try {
        escrever('fs', `acompanhando ${alvo}: altere o arquivo por fora (outro editor, um git pull)`);
        pararWatch = await vssh.arquivos.acompanhar(alvo, ({ caminho, encerrado }) => {
          escrever('fs', encerrado ? `a assinatura de ${caminho} acabou` : `mudou por fora: ${caminho} (${new Date().toLocaleTimeString()})`);
        });
        $('fs-watch').textContent = 'parar de acompanhar';
      } catch (e) { falhar('fs', e); }
    });

    // Cancelar quando a página morre não é higiene opcional: cada assinatura segura um vigia vivo
    // do outro lado, e há teto por usuário.
    window.addEventListener('pagehide', () => pararWatch?.());

    // ── A outra metade de vssh.arquivos: escrever ──────────────────────────────
    //
    // O ciclo inteiro numa pasta que ele mesmo cria e apaga: nada do que o usuário já tinha é
    // tocado, e a demonstração pode ser repetida sem deixar sujeira.
    let base = null;

    // `escreverBytes` recebe base64: um `ArrayBuffer` não atravessa o `postMessage` entre os dois
    // documentos sem cópia, então os bytes viajam em texto. Em blocos, porque
    // `String.fromCharCode(...u8)` estoura a pilha num arquivo grande.
    const paraBase64 = (u8) => {
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(bin);
    };

    $('fs-dir').addEventListener('click', async () => {
      base = await vssh.arquivos.escolherPasta('Uma pasta onde o exemplo pode criar e apagar');
      if (!base) return escrever('fs-escrita', 'cancelado no seletor');
      ['fs-ciclo', 'fs-url'].forEach((id) => { $(id).disabled = false; });
      escrever('fs-escrita', `pasta de trabalho: ${base}`);
    });

    $('fs-ciclo').addEventListener('click', async () => {
      const pasta = `${base}/vssh-galeria-exemplo`;
      const txt = `${pasta}/nota.txt`;
      const bin = `${pasta}/quatro-bytes.bin`;
      try {
        escrever('fs-escrita', 'criarPasta…');
        await vssh.arquivos.criarPasta(pasta);
        await vssh.arquivos.escrever(txt, `escrito pela galeria em ${new Date().toISOString()}\n`);
        await vssh.arquivos.escreverBytes(bin, paraBase64(new Uint8Array([0xde, 0xad, 0xbe, 0xef])));
        const l = await vssh.arquivos.listar(pasta);
        const linhas = l.items.map((e) => {
          // Duas grafias para a mesma coisa chegam de respostas diferentes, e tratar só uma faz
          // toda pasta parecer arquivo em metade dos caminhos.
          const dir = e.type === 'directory' || e.isDirectory === true;
          return `  ${dir ? 'd' : '-'} ${e.name}${e.size != null ? ` (${e.size} bytes)` : ''}`;
        });
        await vssh.arquivos.apagar(bin);
        const depois = await vssh.arquivos.listar(pasta);
        escrever('fs-escrita', [
          `criarPasta     ${pasta}`,
          `escrever       ${txt}`,
          `escreverBytes  ${bin}  (4 bytes crus, em base64 no fio)`,
          `listar         ${l.items.length} entrada(s):`, ...linhas,
          `apagar         ${bin}`,
          `listar         sobrou ${depois.items.length}: ${depois.items.map((e) => e.name).join(', ')}`,
          '',
          `A pasta ${pasta} ficou; apague-a com o gerenciador de arquivos quando quiser. Um `
          + 'exemplo que apaga a própria pasta esconderia justamente o que se quer conferir.',
        ].join('\n'));
      } catch (e) { falhar('fs-escrita', e); }
    });

    // `urlFor` é síncrona de propósito: é o que permite pôr o caminho direto num `src`, no lugar
    // de `URL.createObjectURL`. A rota aceita `Range`, então serve para vídeo grande sem baixar tudo.
    $('fs-url').addEventListener('click', async () => {
      const p = await vssh.arquivos.escolherArquivo('Escolha uma imagem', 'Imagens (*.png *.jpg *.jpeg *.gif *.webp)');
      if (!p) return escrever('fs-escrita', 'cancelado no seletor');
      const url = vssh.arquivos.urlFor(p);
      $('fs-imagem').innerHTML = '';
      const img = document.createElement('img');
      img.alt = p;
      img.src = url;
      img.onerror = () => escrever('fs-escrita', `a URL respondeu erro para ${p}: o arquivo é mesmo uma imagem?`);
      $('fs-imagem').appendChild(img);
      escrever('fs-escrita', `urlFor(${p}) →\n${url}\n\n`
        + 'Síncrona: dá para usar direto num `src`, e é isso que a torna substituta do '
        + '`URL.createObjectURL` num app portado. Aceita Range, então um vídeo grande toca sem '
        + 'baixar o arquivo inteiro antes.');
    });

    // ── Permissão: quem decide é o shell, e o espelho responde sem esperar ─────
    $('fs-grants').addEventListener('click', async () => {
      const caminhos = vssh.arquivos.concedidos();
      const alvoDoTeste = alvo || base || caminhos[0] || '/etc/hostname';
      const r = await vssh.arquivos.permissoes(alvoDoTeste);
      escrever('grants', [
        `permissoes(${alvoDoTeste}) → ${JSON.stringify(r)}`,
        r === true ? '  → pode tocar: siga.'
          : r === false ? '  → NÃO tem permissão: abra um seletor e deixe o usuário conceder.'
          : '  → fora do ambiente não há a quem perguntar, e a resposta é `null`.',
        '',
        `concedidos() → ${caminhos.length} caminho(s)`,
        ...caminhos.map((c) => `  ${c}`),
        '',
        'Síncrona porque o espelho já está em memória, alimentado pelo shell. E a lista inclui o '
        + 'que foi concedido em OUTRA sessão e em outra máquina: o grant mora no usuário, não '
        + 'neste navegador.',
      ].join('\n'));
    });

    // ── OPFS ───────────────────────────────────────────────────────────────────
    //
    // O armazenamento privado do navegador é por origem, e todo vssh-app vive na mesma. O SDK
    // confina cada app numa raiz `vssh-app-<id>`; sem isso, este app abriria o `cache.db` do
    // vizinho, e o pior caso não é ler: é gravar.
    const opfs = () => navigator.storage.getDirectory();

    // O namespace só existe quando dá para identificar o app pela URL — ou seja, sob o proxy do
    // portal. Rodando o backend solto na sua máquina, a raiz é a da origem, sem
    // nome: ali não há outro app com quem colidir, e inventar uma pasta esconderia o
    // armazenamento de quem está desenvolvendo contra ele.
    const nomeDaRaiz = (raiz) => raiz.name || '(raiz da origem — fora do proxy não há namespace)';

    $('opfs-escrever').addEventListener('click', async () => {
      try {
        const raiz = await opfs();
        const fh = await raiz.getFileHandle('anotacao.txt', { create: true });
        const w = await fh.createWritable();
        await w.write(`gravado em ${new Date().toISOString()}`);
        await w.close();
        escrever('opfs', `gravado em anotacao.txt\nraiz: ${nomeDaRaiz(raiz)}`);
      } catch (e) { falhar('opfs', e); }
    });

    $('opfs-ler').addEventListener('click', async () => {
      try {
        const raiz = await opfs();
        const f = await (await raiz.getFileHandle('anotacao.txt')).getFile();
        escrever('opfs', `raiz: ${nomeDaRaiz(raiz)}\n${await f.text()}`);
      } catch (e) { falhar('opfs', e); }
    });

    // ── Som ────────────────────────────────────────────────────────────────────
    //
    // Repare no que não tem aqui: nenhuma chamada a `vssh.midia` para obedecer ao mixer. O app
    // toca do jeito mais banal possível e obedece ao slider assim mesmo. `vssh.midia.ganho()` e
    // `vssh.midia.mudo()` são só a leitura, para quem desenha o próprio controle.

    // Um segundo de senoide em memória, em loop. Um arquivo de áudio no pacote seria mais simples de
    // ler, mas o template não deve carregar binário só para demonstrar.
    const tomWav = (hz = 220, taxa = 8000) => {
      const n = taxa, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
      const txt = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      txt(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, taxa, true); dv.setUint32(28, taxa * 2, true);
      dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
      txt(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * hz * i / taxa) * 6000, true);
      return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    };

    let el = null;
    $('som-media').addEventListener('click', (e) => {
      if (el) { el.pause(); el.remove(); el = null; e.target.textContent = 'tocar um <audio>'; relatarSom(); return; }
      el = new Audio(tomWav(220));
      el.loop = true;
      el.volume = 0.5;          // "metade do MEU volume máximo"
      document.body.appendChild(el);
      el.play();
      e.target.textContent = 'parar o <audio>';
      relatarSom();
    });

    let ctx = null, osc = null;
    $('som-wa').addEventListener('click', (e) => {
      if (osc) { osc.stop(); osc.disconnect(); osc = null; e.target.textContent = 'tocar por AudioContext'; relatarSom(); return; }
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume();
      const g = ctx.createGain();
      g.gain.value = 0.15;      // senoide crua é agressiva; isto é do APP, não do ambiente
      osc = ctx.createOscillator();
      osc.frequency.value = 330;
      osc.connect(g);
      g.connect(ctx.destination);   // é esta linha que o SDK intercepta
      osc.start();
      e.target.textContent = 'parar o AudioContext';
      relatarSom();
    });

    // O ambiente multiplica: quem lê `el.volume` continua vendo o valor que o app pediu, e o que
    // sai pelo alto-falante é o produto dos dois. Se fosse sobrescrita, o próximo `el.volume = 1`
    // do app desfaria o mixer em silêncio. O evento `volume` chega no load e a cada mexida no
    // mixer, e serve só a quem desenha o próprio controle.
    function relatarSom() {
      const meu = el ? ` · o app pediu el.volume=${el.volume}` : '';
      escrever('audio', `ambiente: ganho=${vssh.midia.ganho().toFixed(2)} mudo=${vssh.midia.mudo()}${meu}`);
    }
    vssh.midia.ao('volume', relatarSom);
    relatarSom();

    // ── A cor que a pessoa escolheu ─────────────────────────────────────────────
    //
    // A única coisa da aparência do ambiente que muda em runtime. Ela mora no `<html>` do shell, e
    // este app é outro documento: nada atravessa sozinho. Um app que não pergunte fica com a cor
    // de fábrica enquanto o ambiente inteiro está noutra, e a janela dele é a única fora do tom.
    //
    // São quatro variáveis, e não uma: o realce, a versão clara, o fundo translúcido e a seleção.
    // O shell calcula a clara com uma conta própria; derivá-la aqui traria essa conta para dentro
    // do app, onde ela envelheceria sem ninguém notar.
    function pintarCor(t) {
      const amostras = $('cor-amostras');
      amostras.textContent = '';
      if (!t) {
        escrever('cor', 'null: não há ambiente a quem perguntar.\n'
          + 'Não é falha: quer dizer "não sobrescreva nada". O padrão já veio na folha de estilo, '
          + 'e é ele que está pintando esta página agora.');
        return;
      }
      for (const [nome, valor] of Object.entries(t)) {
        const bloco = document.createElement('span');
        bloco.style.cssText = 'display:inline-block;width:5.5rem;height:2rem;border-radius:6px;'
          + 'margin:0 .4rem .4rem 0;border:1px solid var(--linha);vertical-align:middle';
        bloco.style.background = valor;
        bloco.title = `${nome}: ${valor}`;
        amostras.appendChild(bloco);
      }
      escrever('cor', Object.entries(t).map(([n, v]) => `${n}: ${v}`).join('\n'));
    }

    $('cor-ler').addEventListener('click', () => pintarCor(vssh.aparencia.tokens()));
    // Ao vivo, e sem recarregar. `aoMudar` só dispara quando o valor muda: o shell reescreve o
    // `style` do `<html>` dele por outros motivos (papel de parede, posição da barra), e acordar
    // o app a cada um deles seria trabalho no meio de um quadro para repintar a mesma cor.
    vssh.aparencia.aoMudar(pintarCor);
    pintarCor(vssh.aparencia.tokens());
  }
}

/**
 * A janela extra: pequena, com uma coisa só, e ligada ao mesmo processo.
 *
 * Ela não usa os helpers da galeria de propósito — não há `#ping` nem `#fsa` aqui, e procurar por
 * eles devolveria null. Um app de verdade teria rota e componentes próprios; o que importa para a
 * demonstração é que esta janela mostra OUTRA COISA e mesmo assim compartilha o backend.
 */
function montarPainel() {
  document.title = 'Painel do Hello World';
  document.body.innerHTML = `
    <section style="border:1px solid rgba(127,127,127,.35);border-radius:10px;padding:1rem;
                    display:flex;flex-direction:column;gap:.6rem">
      <h2 style="margin:0;font-size:1.05rem">Painel</h2>
      <p style="margin:0;opacity:.75;font-size:.92em">
        Esta janela é <strong>outra</strong>, não uma cópia — e o contador abaixo é o mesmo
        processo da janela grande. Some aqui e olhe lá.
      </p>
      <div style="font:600 2.4rem/1 system-ui;letter-spacing:-.02em" id="p-contador">—</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button id="p-somar" style="font:inherit;padding:.4rem .8rem;border-radius:6px;
                border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer">somar 1</button>
        <button id="p-fechar" style="font:inherit;padding:.4rem .8rem;border-radius:6px;
                border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer">fechar</button>
      </div>
      <pre id="p-estado" style="margin:0;padding:.6rem .8rem;border-radius:6px;font-size:.85em;
           background:rgba(127,127,127,.12);white-space:pre-wrap">conectando…</pre>
    </section>`;

  const num = document.getElementById('p-contador');
  const nota = document.getElementById('p-estado');
  const pintar = (s) => {
    num.textContent = s.contador;
    nota.textContent = `janelas conectadas: ${s.conexoes}\nbackend subiu em: ${s.subiuEm}`;
  };

  // O mesmo stream da janela grande. É ele que faz o número mudar aqui quando o clique foi lá.
  const src = new EventSource('api/events');
  src.addEventListener('estado', (m) => pintar(JSON.parse(m.data)));
  src.onerror = () => { nota.textContent = 'conexão SSE caiu'; };

  document.getElementById('p-somar').addEventListener('click', async () => {
    try { pintar(await (await fetch('api/estado/incrementar', { method: 'POST' })).json()); }
    catch (e) { nota.textContent = 'erro: ' + e.message; }
  });

  // Fechar a janela é pedido ao shell, porque a janela é dele. Fora do ambiente o disparo não faz
  // nada e não lança, e é por isso que o botão não some.
  document.getElementById('p-fechar').addEventListener('click', () => {
    if (typeof vssh !== 'undefined') vssh.janela.fechar(); else window.close();
  });
}
