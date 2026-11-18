#!/usr/bin/env node
// palco-do-app: executa os passos da ajuda de um vssh-app na janela de verdade dele, num Chrome, e
// tira uma figura de cada passo. É o que leva a ajuda ao nível 3 (as figuras, com os rótulos
// conferidos) e ao 4 (o app responde ao `ajuda.mostrar` pela ponte).
//
//   node scripts/palco-do-app.mjs <diretório do app> --saida <pasta> [--url <backend de pé>]
//
// ─── O arranjo ───────────────────────────────────────────────────────────────
//
// O palco sobe a janela por `scripts/janela-de-bancada.mjs`, o mesmo arranjo da bancada do app: o
// backend do app numa porta de bancada (o `--tcp` do `servidor.escutar`, como o
// `tests/browser/template-fora-do-ambiente.test.js`), e põe na frente dele um HTTP que serve
// `_sdk/vssh.js` e `_sdk/tuff/` de `api/`, como o sistema faz. A raiz desse HTTP é um quadro de
// bancada no papel do shell: a janela do app num iframe do tamanho que o manifesto declara, na
// mesma origem, de modo que o SDK web dentro dele se sabe no ambiente e conversa com o pai.
// Todo pedido que o app faz ao shell recebe uma recusa, como um verbo que o shell não atende,
// menos os que a cena responde.
//
// ─── A cena ──────────────────────────────────────────────────────────────────
//
// Uma janela que nasce vazia (um cofre a escolher, uma conta a ligar) não tem o que mostrar nos
// passos. O app traz então `palco.mjs` na pasta da ajuda, com
// `export async function preparar({ home, dados, app, manifesto })`, que o palco chama antes de
// subir o backend, uma vez por passada. `home` é uma pasta descartável, que o backend recebe como
// HOME (com as pastas XDG embaixo dela), e `dados` é o diretório de dados do app; a função escreve
// ali o que a janela vai mostrar. Ela devolve o que a ponte responde, pelo nome público do verbo
// na tabela da ponte e com o valor como o shell o manda no fio:
//
//   return { ponte: { 'arquivos.escolherPasta': join(home, 'Projetos') } };
//
// Quando o mesmo verbo pede respostas diferentes, `ponte` é uma lista de regras, e a primeira cujo
// `quando` bate com os campos do pedido responde:
//
//   return { ponte: [
//     { verbo: 'arquivos.escolherPasta', quando: { titulo: 'A pasta de origem' }, valor: origem },
//     { verbo: 'arquivos.escolherPasta', valor: destino },
//   ] };
//
// O compilador da ajuda e o agente leem só os `.md` e o `alvos.json` da pasta, então o
// `palco.mjs` não entra na ajuda. Com `--url` o backend é de quem o subiu, e a HOME também; a cena
// ainda escreve na pasta dela e responde pela ponte.
//
// ─── O que ele mede ──────────────────────────────────────────────────────────
//
// Cada cerca `passos` com ações sobre os alvos do app (o `alvos.json` da pasta) é executada do
// começo, numa carga nova da janela. Quem acha um alvo e diz o nome dele é o SDK web da página,
// pelas mensagens que o shell manda na Ajuda. Num passo, o palco:
//
//   - pede cada alvo ao SDK pelo `ajuda-mostrar` e espera o retângulo de volta: é a busca do
//     "Mostrar onde fica", pelo `seletor` ou pelo nome que a pessoa vê;
//   - leva o alvo para o meio da janela e tira a figura do último controle que o passo aponta
//     (`clicar`, `mostrar`, `digitar`);
//   - faz o gesto (o clique, o texto, a tecla), e confere que cada `[[rótulo]]` do passo apareceu
//     na janela em algum momento dele, e que o controle apontado se chama por um deles. Um alvo
//     achado pelo seletor se chama como o "O que é isto?" responde no ponto dele, e um alvo com
//     `rotulo` no `alvos.json` fica fora dessa conferência.
//
// As receitas rodam em duas passadas, cada uma com a cena dela: a HOME, os dados, o backend e o
// Chrome são novos. Na primeira, o clique e o texto são os de verdade, do CDP, e as figuras saem
// dela. Na segunda, o `clicar` e o `digitar` vão pelo `ajuda-fazer`, o "Fazer por mim" do
// ambiente, que chama o `click()` do controle e escreve o `value` dele com os eventos `input` e
// `change`. Uma receita que anda na primeira e para na segunda tem um controle que o "Fazer por
// mim" não aciona (um botão que só atende a `pointerdown`, um campo que só lê as teclas), e a
// falta diz isso. A tecla vai pelo CDP nas duas.
//
// Uma janela que não carrega o `_sdk/vssh.js` não atende a essas mensagens. O palco põe nela o SDK
// de `api/` para achar os controles: as figuras saem, a ponte fica fora da evidência e a segunda
// passada não roda, porque o ambiente não tem "Fazer por mim" a oferecer ali. Com `--url` a
// segunda passada também não roda: o backend é de quem o subiu, com o estado que a primeira deixou.
//
// Uma ação `abrir <Janela>` é do shell, e o palco a pula. O que falta (um alvo que não aparece,
// um rótulo que não está na tela, um gesto que o "Fazer por mim" não faz) vira uma linha FALTA, e
// a figura daquele passo não conta.
//
// ─── A saída ─────────────────────────────────────────────────────────────────
//
// Em `--saida`: um `<topico>-<receita>-<passo>.png` por passo, o `indice.json` com as cenas na
// forma que o `juntarFiguras` do compilador lê, e o `palco.json` com as duas evidências. No
// stdout, linhas chave=valor para o bash do publish: FIGURAS=<n>, PONTE=0|1, EVIDENCIA_FIGURAS=0|1
// e uma FALTA=<onde: o quê> por problema. O código é 0 com o palco executado, 3 sem Chrome, sem
// `api/` ou sem backend que suba, e 1 num erro do próprio palco.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API, SDK_WEB, subirBackend, subirFrente, prepararCena } from './janela-de-bancada.mjs';

const require = createRequire(import.meta.url);
const { abrirNavegador, caminhoDoNavegador } = require('./navegador.cjs');

const ESPERA_DO_ALVO_MS = 5000;
// O SDK responde na hora quando acha um controle pelo nome, e não responde quando não acha: a
// espera curta é o que separa os dois.
const ESPERA_DO_ROTULO_MS = 300;
// O prazo do "Fazer por mim" no shell (`AjudaNoQuadro.fazer`).
const ESPERA_DO_GESTO_MS = 5000;

const linha = (chave, valor) => process.stdout.write(`${chave}=${String(valor).replace(/[\r\n]+/g, ' ')}\n`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function argumentos(argv) {
  const r = { dir: null, saida: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--saida') r.saida = argv[++i];
    else if (argv[i] === '--url') r.url = argv[++i];
    else if (!r.dir) r.dir = argv[i];
    else throw new Error(`argumento inesperado: ${argv[i]}`);
  }
  if (!r.dir || !r.saida) throw new Error('uso: palco-do-app.mjs <diretório do app> --saida <pasta> [--url <backend>]');
  return r;
}

// ─── A ajuda e as receitas ───────────────────────────────────────────────────

async function compilar(dir, manifesto) {
  const { compilarAjudaDoApp } = await import(pathToFileURL(join(API, 'ajuda', 'compilador-da-ajuda.ts')).href);
  const ambiente = JSON.parse(readFileSync(join(API, 'ajuda', 'ambiente.json'), 'utf8'));
  const pasta = join(dir, manifesto.contributes.ajuda.pasta || 'ajuda');
  const arquivos = readdirSync(pasta).sort().filter((n) => /\.(md|json)$/.test(n) && statSync(join(pasta, n)).isFile())
    .map((n) => ({ caminho: n, texto: readFileSync(join(pasta, n), 'utf8') }));
  return compilarAjudaDoApp(arquivos, {
    manifesto, ambiente: { topicos: ambiente.topicos.map((t) => t.id), termos: ambiente.termos },
  });
}


// ─── Dentro da janela ────────────────────────────────────────────────────────
//
// O palco não procura controle por conta própria. Quem acha um alvo, diz como ele se chama e age
// nele é o SDK web da página (`_sdk/vssh.js`), pelas mensagens que o shell manda na Ajuda:
// `ajuda-mostrar` devolve o retângulo do alvo, `ajuda-modo` (o "O que é isto?") devolve o nome do
// controle sob o ponteiro, e `ajuda-fazer` faz o gesto do "Fazer por mim". Daqui saem duas coisas
// só: a leitura do texto que a janela mostra, para o rótulo que não é controle (um título, uma
// linha de uma lista, uma opção de um seletor), e a rolagem que põe no meio da janela o alvo que o
// SDK achou.

const TEXTO_DA_JANELA = `(() => {
  const doc = document.getElementById('app').contentDocument;
  if (!doc || !doc.body) return [];
  const linhas = new Set(doc.body.innerText.split('\\n').map((t) => t.replace(/\\s+/g, ' ').trim()).filter(Boolean));
  for (const el of doc.querySelectorAll('option')) linhas.add(el.textContent.trim());
  return [...linhas];
})()`;

/** Espera a expressão dar um valor verdadeiro na página do quadro; `null` quando o prazo acaba. */
async function esperar(pagina, expressao, prazo) {
  const fim = Date.now() + prazo;
  for (;;) {
    const v = await pagina.avaliar(expressao);
    if (v) return v;
    if (Date.now() > fim) return null;
    await dormir(50);
  }
}

const doAlvo = (alvo) => JSON.stringify({ ...(alvo.seletor ? { seletor: alvo.seletor } : {}), ...(alvo.nome ? { nome: alvo.nome } : {}) });

// A figura quer o alvo no meio da janela, e o SDK o rola só até a borda mais perto. O palco leva
// para o meio o elemento que ocupa o retângulo que o SDK respondeu: ele sobe a partir do ponto do
// centro até a caixa que bate com o retângulo. Um alvo coberto no centro fica onde o SDK o deixou.
const CENTRAR = (pedido) => `(() => {
  const doc = document.getElementById('app').contentDocument;
  const r = palco.achados[${pedido}];
  if (!doc || !r) return false;
  const perto = (a, b) => Math.abs(a - b) < 1;
  for (let el = doc.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2); el; el = el.parentElement) {
    const c = el.getBoundingClientRect();
    if (perto(c.left, r.x) && perto(c.top, r.y) && perto(c.width, r.w) && perto(c.height, r.h)) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    }
  }
  return false;
})()`;

/**
 * O retângulo de um alvo, pedido ao SDK da página pelo `ajuda-mostrar`; `null` quando o controle
 * não apareceu no prazo. O SDK manda o retângulo de novo a cada rolagem, e a leitura que vale é a
 * que para de mudar. Com `centrar`, o alvo vai antes para o meio da janela.
 */
async function acharAlvo(pagina, pedido, alvo, { prazo = ESPERA_DO_ALVO_MS, centrar = false } = {}) {
  await pagina.avaliar(`mostrar(${pedido}, ${doAlvo(alvo)})`);
  const lido = `(() => { const r = palco.achados[${pedido}]; return r && r.w > 0 && r.h > 0 ? r : null; })()`;
  let r = await esperar(pagina, lido, prazo);
  if (r) {
    if (centrar) await pagina.avaliar(CENTRAR(pedido));
    for (let volta = 0; volta < 8; volta++) {
      await dormir(60);
      const agora = (await pagina.avaliar(lido)) || r;
      const parou = agora.x === r.x && agora.y === r.y && agora.w === r.w && agora.h === r.h;
      r = agora;
      if (parou) break;
    }
  }
  await pagina.avaliar(`mostrar(${pedido}, null)`);
  return r;
}

/** O SDK da página atende às mensagens da Ajuda: ele responde quando o "O que é isto?" liga. */
async function sdkResponde(pagina) {
  await pagina.avaliar('modo(true)');
  const ouvindo = await esperar(pagina, 'palco.ouvindo', 2000);
  await pagina.avaliar('modo(false)');
  return !!ouvindo;
}

async function clicar(pagina, r, botao) {
  const x = r.x + r.w / 2;
  const y = r.y + r.h / 2;
  const button = botao === 'direito' ? 'right' : 'left';
  const vezes = botao === 'duplo' ? 2 : 1;
  for (let c = 1; c <= vezes; c++) {
    await pagina.enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: c });
    await pagina.enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: c });
  }
}

/**
 * O nome do controle sob o ponto do alvo, como o "O que é isto?" o diz. Com o modo ligado, o SDK
 * engole o clique, que não chega ao app, e responde o nome do controle clicado.
 */
async function nomeDoControle(pagina, r) {
  await pagina.avaliar('modo(true)');
  let nome = null;
  if (await esperar(pagina, 'palco.ouvindo', 2000)) {
    await clicar(pagina, r);
    const isto = await esperar(pagina, 'palco.isto', 2000);
    nome = isto ? isto.nome : null;
  }
  await pagina.avaliar('modo(false)');
  return nome;
}

/**
 * Marca em `vistos` os rótulos que a janela mostra agora. Um rótulo é o texto de uma linha da
 * janela ou o nome de um controle; o nome de um controle é o SDK quem conhece, e a pergunta é o
 * `ajuda-mostrar` pelo nome.
 */
async function verRotulos(pagina, rotulos, vistos, proximoPedido) {
  const falta = rotulos.filter((x) => !vistos.has(x));
  if (!falta.length) return;
  const texto = new Set(await pagina.avaliar(TEXTO_DA_JANELA));
  for (const rotulo of falta) {
    if (texto.has(rotulo) || await acharAlvo(pagina, proximoPedido(), { nome: rotulo }, { prazo: ESPERA_DO_ROTULO_MS })) vistos.add(rotulo);
  }
}

const TECLAS = { Enter: 13, Escape: 27, Tab: 9, Space: 32, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };

async function tecla(pagina, combinacao) {
  const partes = combinacao.split('+');
  const key = partes.pop();
  const mods = { Alt: 1, Ctrl: 2, Super: 4, Shift: 8 };
  const modifiers = partes.reduce((n, p) => n | (mods[p] || 0), 0);
  const codigo = TECLAS[key] || key.toUpperCase().charCodeAt(0);
  const nome = key === 'Space' ? ' ' : key;
  await pagina.enviar('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: nome, windowsVirtualKeyCode: codigo, modifiers });
  await pagina.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: nome, windowsVirtualKeyCode: codigo, modifiers });
}

// A figura de um passo é o pedaço da janela em volta do alvo, do tamanho da coluna de texto da
// Ajuda (576 × 352 px), preso à beirada da janela mais perto dele, como no palco do ambiente: a
// janela inteira encolheria na coluna até a letra de dentro sumir. A altura cresce até 472 px
// quando o alvo fica um pouco mais para baixo. As bordas que cortam a janela no meio vão em
// `corte`, e a Ajuda as esmaece.
const LARGURA_DA_FIGURA = 576;
const ALTURA_DA_FIGURA = 352;

function recorteDe(alvo, largura, altura) {
  let x0 = 0, x1 = largura, y0 = 0, y1 = altura;
  if (largura > LARGURA_DA_FIGURA && alvo.w <= LARGURA_DA_FIGURA - 48) {
    if (alvo.x + alvo.w + 24 <= LARGURA_DA_FIGURA) x1 = LARGURA_DA_FIGURA;
    else if (alvo.x - 24 >= largura - LARGURA_DA_FIGURA) x0 = largura - LARGURA_DA_FIGURA;
    else { x0 = Math.round(alvo.x + alvo.w / 2 - LARGURA_DA_FIGURA / 2); x1 = x0 + LARGURA_DA_FIGURA; }
  }
  if (altura > ALTURA_DA_FIGURA + 120 && alvo.h <= ALTURA_DA_FIGURA + 72) {
    if (alvo.y + alvo.h + 48 <= ALTURA_DA_FIGURA + 120) y1 = Math.max(ALTURA_DA_FIGURA, Math.ceil(alvo.y + alvo.h + 48));
    else if (alvo.y - 48 >= altura - ALTURA_DA_FIGURA) y0 = altura - ALTURA_DA_FIGURA;
    else { y0 = Math.round(alvo.y + alvo.h / 2 - ALTURA_DA_FIGURA / 2); y1 = y0 + ALTURA_DA_FIGURA; }
  }
  const corte = [[x0 > 0, 'esquerda'], [x1 < largura, 'direita'], [y0 > 0, 'cima'], [y1 < altura, 'baixo']].filter(([s]) => s).map(([, lado]) => lado);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, corte };
}

async function figura(pagina, saida, id, recorte) {
  const r = await pagina.enviar('Page.captureScreenshot', { format: 'png', clip: { x: recorte.x, y: recorte.y, width: recorte.w, height: recorte.h, scale: 1 } });
  writeFileSync(join(saida, `${id}.png`), Buffer.from(r.data, 'base64'));
}

// ─── A execução ──────────────────────────────────────────────────────────────

/** As cercas `passos` com alguma ação sobre um alvo do app: as que o palco executa. */
const receitasDoApp = (ajuda, receitas) => receitas.filter((rc) => rc.tipo === 'passos'
  && rc.passos.some((p) => p.acoes.some((a) => a.alvo && ajuda.alvos[a.alvo])));

/**
 * Uma receita, do começo, numa carga nova da janela. `comoFaz` é quem faz o `clicar` e o
 * `digitar`: `'mao'`, com o clique e o texto de verdade do CDP, e é a passada que tira as figuras;
 * ou `'sdk'`, pelo `ajuda-fazer`, que é o "Fazer por mim" do ambiente. A tecla vai pelo CDP nas
 * duas. Devolve as faltas da passada, e `semSdk` quando a página não atende às mensagens da Ajuda.
 */
async function executarReceita(pagina, ajuda, rc, pasta, comoFaz, tirar, proximoPedido) {
  const faltas = [];
  await pagina.avaliar('carregar()');
  await dormir(300);
  // Uma janela que não carrega o SDK web não responde à ponte. O palco põe nela o SDK da bancada,
  // para achar os controles pelo mesmo código, e a ponte fica de fora da evidência.
  let daPagina = true;
  if (!await sdkResponde(pagina)) {
    daPagina = false;
    await pagina.avaliar('carregarSdk()');
    if (!await sdkResponde(pagina)) return { faltas, daPagina, semSdk: true };
  }

  for (const [i, passo] of rc.passos.entries()) {
    // O compilador lê a pasta como o livro `<id>/` do app; quem lê a falta conhece a pasta.
    const onde = `${pasta}/${rc.arquivo.slice(rc.arquivo.indexOf('/') + 1)}:${passo.linha}`;
    const vistos = new Set();
    await verRotulos(pagina, passo.rotulos, vistos, proximoPedido);
    const apontado = passo.acoes.findLast((a) => ['clicar', 'mostrar', 'digitar'].includes(a.verbo) && a.alvo);
    let falhou = false;
    for (const ac of passo.acoes) {
      if (ac.verbo === 'abrir') continue;
      if (ac.verbo === 'tecla') { await tecla(pagina, ac.tecla); await dormir(200); continue; }
      const alvo = ajuda.alvos[ac.alvo];
      if (!alvo) continue;
      const prazo = ['esperar', 'pronto'].includes(ac.verbo) ? 3 * ESPERA_DO_ALVO_MS : ESPERA_DO_ALVO_MS;
      const r = await acharAlvo(pagina, proximoPedido(), alvo, { prazo, centrar: comoFaz === 'mao' });
      if (!r) { faltas.push(`${onde}: o alvo ${ac.alvo} não apareceu na janela`); falhou = true; break; }
      if (ac === apontado && tirar) {
        const nome = await tirar(i, r, alvo);
        if (passo.rotulos.length && !alvo.rotulo && !passo.rotulos.includes(nome)) {
          faltas.push(`${onde}: o passo cita ${passo.rotulos.map((x) => `[[${x}]]`).join(', ')}, e o controle ${ac.alvo} se chama "${nome}" na janela`);
        }
      }
      if (ac.verbo === 'clicar' || ac.verbo === 'digitar') {
        if (comoFaz === 'sdk') {
          const n = proximoPedido();
          await pagina.avaliar(`fazer(${n}, ${doAlvo(alvo)}, ${JSON.stringify({ verbo: ac.verbo, ...(ac.botao ? { botao: ac.botao } : {}), ...(ac.texto !== undefined ? { texto: ac.texto } : {}) })})`);
          const fez = await esperar(pagina, `palco.feitos[${n}] === undefined ? null : { ok: palco.feitos[${n}] }`, ESPERA_DO_GESTO_MS);
          if (!fez || !fez.ok) { faltas.push(`${onde}: o controle ${ac.alvo} não respondeu ao gesto`); falhou = true; break; }
        } else if (ac.verbo === 'clicar') {
          await clicar(pagina, r, ac.botao);
        } else {
          await clicar(pagina, r);
          await pagina.enviar('Input.insertText', { text: ac.texto || '' });
        }
      }
      await dormir(250);
      await verRotulos(pagina, passo.rotulos, vistos, proximoPedido);
    }
    if (falhou) break;
    for (const rotulo of passo.rotulos) {
      if (!vistos.has(rotulo)) faltas.push(`${onde}: o passo ${i + 1} cita [[${rotulo}]], e a janela não mostra esse nome`);
    }
  }
  return { faltas, daPagina, semSdk: false };
}

/**
 * Uma passada: todas as receitas, na ordem, na mesma janela. Na passada `'mao'` sai a figura de
 * cada passo, com o nome do controle apontado. Devolve as faltas de cada receita, pelo índice dela.
 */
async function executar(pagina, ajuda, executaveis, pasta, comoFaz, figuras) {
  const porReceita = [];
  let semSdk = false;
  let daPagina = true;
  // O número de um pedido vale pela passada inteira: o quadro guarda as respostas pelo número, e a
  // janela recarrega a cada receita sem que ele recarregue.
  let pedido = 0;
  const proximoPedido = () => ++pedido;
  for (const rc of executaveis) {
    const tirar = figuras && (async (i, r, alvo) => {
      const id = `${rc.topico}-${rc.receita}-${i}`;
      const rec = recorteDe(r, figuras.largura, figuras.altura);
      await figura(pagina, figuras.saida, id, rec);
      // O nome do alvo na figura é o `rotulo` que o `alvos.json` deu a ele, como no palco do
      // ambiente. Sem `rotulo`, um alvo achado pelo nome se chama por ele, e o achado pelo seletor
      // se chama como o "O que é isto?" responde.
      const nome = alvo.rotulo || alvo.nome || ((await nomeDoControle(pagina, r)) ?? '');
      figuras.cenas[id] = {
        topico: rc.topico, receita: rc.receita, passo: i, tela: 'larga', largura: rec.w, altura: rec.h,
        alvos: [{ x: Math.round(r.x - rec.x), y: Math.round(r.y - rec.y), w: Math.round(r.w), h: Math.round(r.h), nome }],
        ...(rec.corte.length ? { corte: rec.corte } : {}),
      };
      return nome;
    });
    const r = await executarReceita(pagina, ajuda, rc, pasta, comoFaz, tirar || null, proximoPedido);
    if (r.semSdk) { semSdk = true; break; }
    if (!r.daPagina) daPagina = false;
    porReceita.push(r.faltas);
  }
  return { porReceita, semSdk, daPagina };
}

/**
 * Sobe a cena e a janela (a HOME e os dados descartáveis, o backend, o quadro e um Chrome com o
 * perfil vazio), chama `fn(pagina)` e desmonta tudo. Cada passada tem a cena dela: a segunda
 * começa do estado em que a primeira começou, e não do que a primeira deixou.
 */
async function comACena({ dir, manifesto, pasta, largura, altura, url }, fn) {
  const roteiro = join(dir, pasta, 'palco.mjs');
  const dados = mkdtempSync(join(tmpdir(), 'vssh-palco-'));
  const home = existsSync(roteiro) ? mkdtempSync(join(tmpdir(), 'vssh-palco-home-')) : null;
  let backend = null;
  let frente = null;
  let navegador = null;
  try {
    const respostas = home
      ? await prepararCena(roteiro, `${pasta}/palco.mjs`, { home, dados, app: resolve(dir), manifesto })
      : [];
    try {
      backend = url ? { proc: null, url } : await subirBackend(resolve(dir), manifesto, dados, home);
    } catch (err) {
      if (err.semPalco) return { semPalco: err.message };
      throw err;
    }
    frente = await subirFrente(backend.url, largura, altura, respostas);
    navegador = await abrirNavegador();
    const pagina = await navegador.novaPagina(`http://127.0.0.1:${frente.address().port}/`);
    // Em 2x, como as figuras do ambiente: a figura sai na coluna em tamanho real, e numa tela de
    // alta densidade a letra de dentro fica nítida.
    await pagina.enviar('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 2, mobile: false });
    return await fn(pagina);
  } finally {
    await navegador?.fechar();
    if (frente) await new Promise((ok) => frente.close(ok));
    if (backend?.proc) { backend.proc.kill(); await new Promise((ok) => { backend.proc.once('exit', ok); setTimeout(ok, 3000).unref?.(); }); }
    rmSync(dados, { recursive: true, force: true });
    if (home) rmSync(home, { recursive: true, force: true });
  }
}

async function main() {
  const { dir, saida, url } = argumentos(process.argv.slice(2));
  const manifesto = JSON.parse(readFileSync(join(dir, 'vssh-app.json'), 'utf8'));
  if (!manifesto.contributes?.ajuda) { linha('SEM_PALCO', 'o manifesto não declara contributes.ajuda'); return 3; }
  if (!existsSync(join(API, 'ajuda', 'compilador-da-ajuda.ts')) || !existsSync(SDK_WEB)) { linha('SEM_PALCO', `sem api/ajuda ou api/vssh.js em ${API}`); return 3; }
  if (!process.features.typescript) { linha('SEM_PALCO', `o Node ${process.version} não importa o compilador`); return 3; }
  if (!caminhoDoNavegador()) { linha('SEM_PALCO', 'nenhum Chrome nesta máquina (VSSH_TEST_CHROME aponta um)'); return 3; }

  const { ajuda, erros, receitas } = await compilar(dir, manifesto);
  if (!ajuda) { for (const e of erros) linha('FALTA', e); return 1; }
  const executaveis = receitasDoApp(ajuda, receitas);
  if (!executaveis.length) { linha('SEM_PALCO', 'nenhum passo da ajuda aponta um alvo do alvos.json'); return 3; }
  mkdirSync(saida, { recursive: true });
  const largura = Math.round(manifesto.window?.width || 900);
  const altura = Math.round(manifesto.window?.height || 640);
  const pasta = manifesto.contributes.ajuda.pasta || 'ajuda';
  const cena = { dir, manifesto, pasta, largura, altura, url };

  // A primeira passada é a da pessoa: o clique e o texto de verdade, e a figura de cada passo.
  const cenas = {};
  const mao = await comACena(cena, (pagina) => executar(pagina, ajuda, executaveis, pasta, 'mao', { saida, largura, altura, cenas }));
  if (mao.semPalco) { linha('SEM_PALCO', mao.semPalco); return 3; }
  const faltas = mao.porReceita.flat();
  if (mao.semSdk) faltas.push(`${pasta}: o SDK web da bancada não respondeu na janela, e o palco acha os controles por ele`);

  // A segunda é a do "Fazer por mim": as mesmas receitas, numa cena nova, com o clique e o texto
  // feitos pelo SDK. Uma receita que passou na primeira e para na segunda tem um controle que o
  // "Fazer por mim" não aciona. Com `--url` o backend é de quem o subiu, com o estado que a
  // primeira passada deixou, e a segunda não roda. Ela também não roda numa janela que não
  // responde à ponte: lá o ambiente não tem "Fazer por mim" para oferecer.
  const temGesto = executaveis.some((rc) => rc.passos.some((p) => p.acoes.some((a) => a.verbo === 'clicar' || a.verbo === 'digitar')));
  if (!url && !mao.semSdk && mao.daPagina && temGesto) {
    const sdk = await comACena(cena, (pagina) => executar(pagina, ajuda, executaveis, pasta, 'sdk', null));
    for (const [n, daReceita] of (sdk.porReceita || []).entries()) {
      if (mao.porReceita[n]?.length) continue;
      for (const f of daReceita) faltas.push(`${f}, pelo "Fazer por mim" (com o clique de verdade o passo anda)`);
    }
  }

  const figuras = Object.keys(cenas).length;
  const evidenciaFiguras = figuras > 0 && faltas.length === 0;
  const ponte = !mao.semSdk && mao.daPagina;
  writeFileSync(join(saida, 'indice.json'), `${JSON.stringify({ cenas }, null, 2)}\n`);
  writeFileSync(join(saida, 'palco.json'), `${JSON.stringify({ figuras: evidenciaFiguras, ponte: evidenciaFiguras && ponte, faltas }, null, 2)}\n`);
  linha('RECEITAS', executaveis.length);
  linha('FIGURAS', figuras);
  linha('EVIDENCIA_FIGURAS', evidenciaFiguras ? 1 : 0);
  linha('PONTE', ponte ? 1 : 0);
  for (const f of faltas) linha('FALTA', f);
  return 0;
}

main().then((codigo) => { process.exitCode = codigo; }, (err) => {
  linha('ERRO', err.stack || err.message);
  process.exitCode = 1;
});
