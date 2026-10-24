#!/usr/bin/env node
// compilar-ajuda: compila a pasta de ajuda de um vssh-app com o compilador que o portal executa, e
// diz o nível dela. O `vssh-app-publish` o chama antes de empacotar; quem escreve a ajuda o roda na
// própria máquina para ver os erros e o nível sem publicar nada.
//
//   node scripts/compilar-ajuda.mjs <diretório do app> [--saida <ajuda.json>]
//
// A saída são linhas chave=valor, uma por fato, que o bash do publish lê:
//
//   NIVEL=<0 a 4>         o nível da ajuda; 0 quando o manifesto não declara contributes.ajuda
//   INICIO=<id>           o tópico que o F1 abre
//   TOPICOS=<n>           quantos tópicos a pasta tem
//   SUPERFICIES=<n>       quantas superfícies o manifesto declara
//   SEM_TOPICO=<rótulo>   uma linha por superfície que nenhum tópico cobre
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
// ponte. Este script ainda não mede nenhum dos dois, e por isso o nível que ele diz vai até o 2.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = process.env.VSSH_SDK_API || join(dirname(fileURLToPath(import.meta.url)), '..', 'api');
const COMPILADOR = join(API, 'ajuda', 'compilador-da-ajuda.ts');
const AMBIENTE = join(API, 'ajuda', 'ambiente.json');

const linha = (chave, valor) => process.stdout.write(`${chave}=${String(valor).replace(/[\r\n]+/g, ' ')}\n`);

function argumentos(argv) {
  const r = { dir: null, saida: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--saida') r.saida = argv[++i];
    else if (!r.dir) r.dir = argv[i];
    else throw new Error(`argumento inesperado: ${argv[i]}`);
  }
  if (!r.dir) throw new Error('informe o diretório do app');
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
  const { dir, saida } = argumentos(process.argv.slice(2));
  const manifesto = JSON.parse(readFileSync(join(dir, 'vssh-app.json'), 'utf8'));
  const declarada = manifesto.contributes?.ajuda;
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
  const { compilarAjudaDoApp } = await import(pathToFileURL(COMPILADOR).href);
  const ambiente = JSON.parse(readFileSync(AMBIENTE, 'utf8'));

  const pasta = join(dir, declarada.pasta || 'ajuda');
  const arquivos = existsSync(pasta) ? arquivosDaPasta(pasta) : [];
  const r = compilarAjudaDoApp(arquivos, {
    manifesto,
    ambiente: { topicos: ambiente.topicos.map((t) => t.id), termos: ambiente.termos },
  });
  if (!existsSync(pasta)) r.erros.unshift(`${declarada.pasta || 'ajuda'}: a pasta que contributes.ajuda declara não existe`);
  if (!r.ajuda || r.erros.length) {
    for (const e of r.erros) linha('ERRO', e);
    return 1;
  }

  const { ajuda } = r;
  linha('NIVEL', ajuda.nivel);
  linha('INICIO', ajuda.inicio);
  linha('TOPICOS', ajuda.topicos.length);
  linha('SUPERFICIES', ajuda.superficies.length);
  for (const s of ajuda.superficies) if (!s.topicos.length) linha('SEM_TOPICO', s.rotulo);
  if (saida) writeFileSync(saida, JSON.stringify(ajuda));
  return 0;
}

main().then((codigo) => { process.exitCode = codigo; }, (err) => {
  linha('ERRO', err.message);
  process.exitCode = 1;
});
