#!/usr/bin/env node
// compilar-ajuda: compila a pasta de ajuda de um vssh-app com o compilador que o portal executa, e
// diz o nível dela. O `vssh-app-publish` o chama antes de empacotar; quem escreve a ajuda o roda na
// própria máquina para ver os erros e o nível sem publicar nada.
//
//   node scripts/compilar-ajuda.mjs <diretório do app> [--saida <ajuda.json>] [--palco <pasta>]
//   node scripts/compilar-ajuda.mjs --hiperlink <manifesto PWA> [--pasta <pasta>] --saida <ajuda.json>
//
// O segundo é o build de uma plataforma que entra no ambiente como hiperlink: o manifesto PWA dela
// declara a ajuda no membro `vssh` (`contributes.ajuda: { "url": "ajuda.json", "inicio": "..." }`),
// a pasta dos tópicos fica ao lado dele (`ajuda/`, ou a de `--pasta`), e o `ajuda.json` sai com as
// fontes junto (`fontes`), que o portal compila de novo a cada leitura do manifesto.
//
// A saída são linhas chave=valor, uma por fato, que o bash do publish lê:
//
//   NIVEL=<0 a 4>         o nível da ajuda; 0 quando o manifesto não declara contributes.ajuda
//   INICIO=<id>           o tópico que o F1 abre
//   TOPICOS=<n>           quantos tópicos a pasta tem
//   SUPERFICIES=<n>       quantas superfícies o manifesto declara
//   SEM_TOPICO=<rótulo>   uma linha por superfície que nenhum tópico cobre
//   FIGURA=<arquivo>      uma linha por figura do palco que o pacote cita, com `--palco`
//   ERRO=<arquivo:linha: motivo>   uma linha por erro da pasta
//
// Com algum ERRO o código de saída é 1 e o `--saida` não é escrito. Sem o compilador no checkout
// (`api/ajuda/`, que o canal do sistema gera), ou com um Node que não o importa, o código é 3, com
// uma linha SEM_COMPILADOR.
//
// O compilador é `api/ajuda/compilador-da-ajuda.ts`, o mesmo arquivo do portal, em TypeScript
// apagável: o Node 22.18 ou mais novo o importa sem build. O `api/ajuda/ambiente.json` ao lado
// traz os tópicos e os termos do ambiente, que um link do app (`{{t:ambiente/<id>|…}}`,
// `{{g:<termo>}}`) pode citar.
//
// O nível 3 pede as figuras do palco do app, e o 4 o app respondendo ao `ajuda.mostrar` pela
// ponte. Quem mede os dois é o `palco-do-app.mjs`, e `--palco` aponta a pasta que ele escreveu: o
// `palco.json` traz as duas evidências, e o `indice.json` as cenas que o `juntarFiguras` pendura
// nos passos. Sem `--palco` o nível vai até o 2.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = process.env.VSSH_SDK_API || join(dirname(fileURLToPath(import.meta.url)), '..', 'api');
const COMPILADOR = join(API, 'ajuda', 'compilador-da-ajuda.ts');
const AMBIENTE = join(API, 'ajuda', 'ambiente.json');

const linha = (chave, valor) => process.stdout.write(`${chave}=${String(valor).replace(/[\r\n]+/g, ' ')}\n`);

function argumentos(argv) {
  const r = { dir: null, saida: null, palco: null, hiperlink: null, pasta: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--saida') r.saida = argv[++i];
    else if (argv[i] === '--palco') r.palco = argv[++i];
    else if (argv[i] === '--hiperlink') r.hiperlink = argv[++i];
    else if (argv[i] === '--pasta') r.pasta = argv[++i];
    else if (!r.dir) r.dir = argv[i];
    else throw new Error(`argumento inesperado: ${argv[i]}`);
  }
  if (!r.dir && !r.hiperlink) throw new Error('informe o diretório do app, ou --hiperlink com o manifesto da plataforma');
  return r;
}

/**
 * Os arquivos da pasta, com o caminho relativo a ela. Uma subpasta entra com a barra no caminho,
 * para o compilador recusá-la pelo nome em vez de ela sumir calada.
 */
function arquivosDaPasta(pasta) {
  const saida = [];
  for (const nome of readdirSync(pasta).sort()) {
    if (nome.startsWith('.')) continue;
    const p = join(pasta, nome);
    if (statSync(p).isDirectory()) {
      for (const dentro of readdirSync(p).sort()) saida.push({ caminho: `${nome}/${dentro}`, texto: '' });
    } else if (/\.(md|json)$/.test(nome)) {
      saida.push({ caminho: nome, texto: readFileSync(p, 'utf8') });
    }
  }
  return saida;
}

async function main() {
  const { dir, saida, palco, hiperlink, pasta: pastaDada } = argumentos(process.argv.slice(2));
  const pwa = hiperlink ? JSON.parse(readFileSync(hiperlink, 'utf8')) : null;
  let manifesto = pwa ? null : JSON.parse(readFileSync(join(dir, 'vssh-app.json'), 'utf8'));
  const declarada = pwa ? pwa.vssh?.contributes?.ajuda : manifesto.contributes?.ajuda;
  if (!declarada && pwa) {
    linha('ERRO', `${hiperlink}: o membro vssh não declara contributes.ajuda`);
    return 1;
  }
  if (!declarada) {
    linha('NIVEL', 0);
    return 0;
  }
  if (!existsSync(COMPILADOR) || !existsSync(AMBIENTE)) {
    linha('SEM_COMPILADOR', `${API}/ajuda não existe neste checkout`);
    return 3;
  }
  if (!process.features.typescript) {
    linha('SEM_COMPILADOR', `o Node ${process.version} não importa TypeScript, e o compilador pede o 22.18 ou mais novo`);
    return 3;
  }
  const { compilarAjudaDoApp, juntarFiguras, manifestoDoHiperlink } = await import(pathToFileURL(COMPILADOR).href);
  const ambiente = JSON.parse(readFileSync(AMBIENTE, 'utf8'));
  if (pwa) {
    if (typeof manifestoDoHiperlink !== 'function') {
      linha('SEM_COMPILADOR', `o compilador de ${API}/ajuda não conhece a ajuda de um hiperlink; atualize este checkout`);
      return 3;
    }
    manifesto = manifestoDoHiperlink(pwa);
  }

  const pasta = pwa ? (pastaDada || join(dirname(hiperlink), 'ajuda')) : join(dir, declarada.pasta || 'ajuda');
  const arquivos = existsSync(pasta) ? arquivosDaPasta(pasta) : [];
  const doPalco = palco && existsSync(join(palco, 'palco.json')) ? JSON.parse(readFileSync(join(palco, 'palco.json'), 'utf8')) : null;
  const r = compilarAjudaDoApp(arquivos, {
    manifesto,
    ambiente: { topicos: ambiente.topicos.map((t) => t.id), termos: ambiente.termos },
    evidencias: { figuras: doPalco?.figuras === true, ponte: doPalco?.ponte === true },
  });
  if (!existsSync(pasta)) r.erros.unshift(`${pwa ? pasta : declarada.pasta || 'ajuda'}: a pasta da ajuda não existe`);
  if (!r.ajuda || r.erros.length) {
    for (const e of r.erros) linha('ERRO', e);
    return 1;
  }

  const { ajuda } = r;
  // As figuras entram no pacote mesmo abaixo do nível 3: o passo que o palco executou sem falta
  // ganha a figura dele, e a falta de outro passo só segura o nível.
  if (doPalco && existsSync(join(palco, 'indice.json'))) {
    const { cenas } = JSON.parse(readFileSync(join(palco, 'indice.json'), 'utf8'));
    juntarFiguras(ajuda, cenas || {});
    for (const id of Object.keys(cenas || {})) if (existsSync(join(palco, `${id}.png`))) linha('FIGURA', `${id}.png`);
  }
  linha('NIVEL', ajuda.nivel);
  linha('INICIO', ajuda.inicio);
  linha('TOPICOS', ajuda.topicos.length);
  linha('SUPERFICIES', ajuda.superficies.length);
  for (const s of ajuda.superficies) if (!s.topicos.length) linha('SEM_TOPICO', s.rotulo);
  // A ajuda de um hiperlink leva as fontes: o portal a compila de novo a partir delas.
  if (saida) writeFileSync(saida, JSON.stringify(pwa ? { ...ajuda, fontes: arquivos } : ajuda));
  return 0;
}

main().then((codigo) => { process.exitCode = codigo; }, (err) => {
  linha('ERRO', err.message);
  process.exitCode = 1;
});
