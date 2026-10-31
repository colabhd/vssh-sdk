#!/usr/bin/env node
// montar-icone: monta o ícone em camadas de um vssh-app (`icone` no manifesto) com o compositor que o
// portal executa, e mede o glifo na grade. O `vssh-app-publish` o chama antes de empacotar; quem
// desenha o ícone o roda na própria máquina para ver o resultado e a medida sem publicar nada.
//
//   node scripts/montar-icone.mjs <diretório do app> [--saida <icon.svg>]
//
// A saída são linhas chave=valor, uma por fato, que o bash do publish lê:
//
//   MONTADO=<arquivo>          o SVG montado, quando `--saida` foi dado
//   CAIXA=<x0 y0 x1 y1>        a caixa do glifo no quadro de 64, medida num Chrome
//   FORA_DA_GRADE=<motivo>     o glifo passa da área viva de 46 × 46 ou foge do centro
//   NAO_MEDIDO=<motivo>        não havia Chrome para medir
//   ERRO=<motivo>              o manifesto não declara `icone`, ou uma camada não existe no pacote
//
// Com algum ERRO o código de saída é 1 e o `--saida` não é escrito. Sem o compositor no checkout
// (`api/icone/`, que o canal do sistema gera), ou com um Node que não o importa, o código é 3, com
// uma linha SEM_COMPOSITOR.
//
// O compositor é `api/icone/composicao-de-icone.ts`, o mesmo arquivo do portal, em TypeScript
// apagável: o Node 22.18 ou mais novo o importa sem build. A grade e a luz estão no guia
// `docs/guias/icone.md`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSITOR = join(RAIZ, 'api', 'icone', 'composicao-de-icone.ts');
const linha = (k, v) => process.stdout.write(`${k}=${String(v).replace(/[\r\n]+/g, ' ')}\n`);

// A área viva e a folga da medida: um pixel de borda suavizada não é um glifo fora da grade.
const AREA = { x0: 9, y0: 9, x1: 55, y1: 55 };
const FOLGA = 1;
const FUGA_DO_CENTRO = 2;

async function medir(glifo) {
  const require = createRequire(import.meta.url);
  const { abrirNavegador, caminhoDoNavegador } = require('./navegador.cjs');
  if (!caminhoDoNavegador()) return null;
  const navegador = await abrirNavegador();
  try {
    const pagina = await navegador.novaPagina();
    const url = `data:${glifo.mime};base64,${glifo.dados}`;
    return await pagina.avaliar(`(async () => {
      const N = 256, img = new Image(); img.src = ${JSON.stringify(url)}; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = N;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data;
      let x0 = N, y0 = N, x1 = -1, y1 = -1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (d[(y * N + x) * 4 + 3] > 25) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const k = 64 / N;
      return x1 < 0 ? null : { x0: x0 * k, y0: y0 * k, x1: (x1 + 1) * k, y1: (y1 + 1) * k };
    })()`);
  } finally {
    await navegador.fechar();
  }
}

async function principal() {
  const args = process.argv.slice(2);
  const pasta = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--saida');
  const saida = args.includes('--saida') ? args[args.indexOf('--saida') + 1] : null;
  if (!pasta) { linha('ERRO', 'informe o diretório do app'); return 1; }

  if (!existsSync(COMPOSITOR)) { linha('SEM_COMPOSITOR', 'api/icone/ não existe neste checkout'); return 3; }
  if (!process.features.typescript) {
    linha('SEM_COMPOSITOR', `o Node ${process.version} não importa TypeScript, e o compositor pede o 22.18 ou mais novo`);
    return 3;
  }
  const { lerCamadas, comporIcone, mimeDoIcone } = await import(pathToFileURL(COMPOSITOR).href);

  let manifesto;
  try { manifesto = JSON.parse(readFileSync(join(pasta, 'vssh-app.json'), 'utf8')); } catch (e) {
    linha('ERRO', `o vssh-app.json não abre: ${e.message}`); return 1;
  }
  const camadas = lerCamadas(manifesto.icone);
  if (!camadas) { linha('ERRO', 'o manifesto não declara icone com um glifo .svg, .png ou .jpg'); return 1; }

  const camada = (rel) => {
    const arquivo = join(pasta, rel);
    if (!existsSync(arquivo)) return null;
    return { mime: mimeDoIcone(rel), dados: readFileSync(arquivo).toString('base64') };
  };
  const glifo = camada(camadas.glifo);
  if (!glifo) { linha('ERRO', `icone.glifo aponta ${camadas.glifo}, que não está no pacote`); return 1; }
  let fundo = camadas.cor ? { cor: camadas.cor } : null;
  if (camadas.fundo) {
    fundo = camada(camadas.fundo);
    if (!fundo) { linha('ERRO', `icone.fundo aponta ${camadas.fundo}, que não está no pacote`); return 1; }
  }

  if (saida) {
    writeFileSync(saida, comporIcone(glifo, fundo));
    linha('MONTADO', saida);
  }

  let caixa = null;
  try { caixa = await medir(glifo); } catch (e) { linha('NAO_MEDIDO', `o Chrome não abriu: ${e.message}`); return 0; }
  if (caixa === null) { linha('NAO_MEDIDO', 'nenhum Chrome nesta máquina (VSSH_TEST_CHROME aponta um)'); return 0; }
  const um = (n) => n.toFixed(1);
  linha('CAIXA', [caixa.x0, caixa.y0, caixa.x1, caixa.y1].map(um).join(' '));
  const fora = caixa.x0 < AREA.x0 - FOLGA || caixa.y0 < AREA.y0 - FOLGA || caixa.x1 > AREA.x1 + FOLGA || caixa.y1 > AREA.y1 + FOLGA;
  const cx = (caixa.x0 + caixa.x1) / 2, cy = (caixa.y0 + caixa.y1) / 2;
  if (fora) {
    linha('FORA_DA_GRADE', `o glifo vai de ${um(caixa.x0)},${um(caixa.y0)} a ${um(caixa.x1)},${um(caixa.y1)} e a área viva é de 9 a 55 nos dois eixos`);
  } else if (Math.abs(cx - 32) > FUGA_DO_CENTRO || Math.abs(cy - 32) > FUGA_DO_CENTRO) {
    linha('FORA_DA_GRADE', `o centro da caixa do glifo está em ${um(cx)},${um(cy)}, e o do quadro é 32,32`);
  }
  return 0;
}

process.exitCode = await principal();
