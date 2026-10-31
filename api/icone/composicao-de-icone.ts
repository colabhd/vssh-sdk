// O ícone de app em camadas (`icone` no manifesto): o app entrega o glifo e, se quiser, um fundo, e
// o portal monta os dois com a máscara e o acabamento, iguais em todo app e em toda superfície.
//
// Módulo folha, sem import: a rota do ícone, a projeção do `GET /api/apps`, a Loja e o canal do SDK
// (`scripts/gerar-sdk.js`, que o publica para o `vssh-app-publish` montar o `icon.svg` de um portal
// anterior) leem a mesma regra, e ela precisa ser exercitada sozinha.
//
// ─── As quatro camadas ────────────────────────────────────────────────────────
//
// De baixo para cima: o fundo, o glifo, a máscara e o acabamento. As duas primeiras são do app; as
// duas últimas são do sistema, e nenhum app as desenha. Sem fundo declarado entra o da família, o
// #15171c com a luz radial do alto à esquerda. A máscara é o quadrado de raio 14 no quadro de 64, o
// raio que o menu iniciar e o Launchpad já dão por CSS a um ícone antigo, então os dois saem com o
// mesmo contorno lado a lado. O acabamento é um fio de 1 px por dentro da borda, claro em cima e
// escuro embaixo, que separa o ladrilho escuro do degrau escuro do shell.
//
// Cada camada entra por `<image>` com data URI. Os ids de dentro de uma camada não pintam a outra,
// e um script de dentro dela não roda, porque o shell desenha o resultado num `<img>`.

export const LADO = 64;
export const RAIO = 14;

export interface CamadasDeIcone {
  /** O caminho do glifo, relativo à raiz do pacote. */
  glifo: string;
  /** O caminho do fundo, relativo à raiz do pacote, ou `null`. */
  fundo: string | null;
  /** A cor do fundo, `#rrggbb`, quando o fundo é uma cor; `null` quando é arquivo ou da família. */
  cor: string | null;
}

/** Uma camada lida do disco: o tipo e os bytes em base64. */
export interface Camada {
  mime: string;
  dados: string;
}

const CAMINHO = /^[A-Za-z0-9][A-Za-z0-9/._-]*\.(?:svg|png|jpe?g)$/;
const COR = /^#[0-9a-fA-F]{6}$/;

function caminhoValido(rel: unknown): rel is string {
  return typeof rel === 'string' && rel.length <= 128 && CAMINHO.test(rel) && !rel.split('/').includes('..');
}

/**
 * As camadas que um manifesto (ou um `vssh-embutido.json`) declara em `icone`, ou `null` quando o
 * campo falta ou não tem um glifo que se possa ler. Um fundo recusado vale como fundo da família:
 * o glifo ainda diz que app é aquele. `monocromatico` é reservado, e nenhuma superfície o lê.
 */
export function lerCamadas(campo: unknown): CamadasDeIcone | null {
  if (!campo || typeof campo !== 'object' || Array.isArray(campo)) return null;
  const c = campo as Record<string, unknown>;
  if (!caminhoValido(c.glifo)) return null;
  const fundo = typeof c.fundo === 'string' ? c.fundo : null;
  return {
    glifo: c.glifo,
    fundo: fundo && caminhoValido(fundo) ? fundo : null,
    cor: fundo && COR.test(fundo) ? fundo.toLowerCase() : null,
  };
}

/** O tipo de uma camada pelo nome do arquivo. */
export function mimeDoIcone(rel: string): string {
  const ext = (rel.split('.').pop() || '').toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function imagem(c: Camada): string {
  return `<image href="data:${c.mime};base64,${c.dados}" width="${LADO}" height="${LADO}" preserveAspectRatio="xMidYMid meet"/>`;
}

const FUNDO_DA_FAMILIA =
  `<rect width="${LADO}" height="${LADO}" fill="#15171c"/><rect width="${LADO}" height="${LADO}" fill="url(#vssh-luz)"/>`;

const DEFS =
  '<radialGradient id="vssh-luz" cx="0.3" cy="0.2" r="0.85"><stop offset="0" stop-color="#2a2e38"/>' +
  '<stop offset="1" stop-color="#15171c" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="vssh-borda" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/>' +
  '<stop offset=".45" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>' +
  `<clipPath id="vssh-mascara"><rect width="${LADO}" height="${LADO}" rx="${RAIO}"/></clipPath>`;

const ACABAMENTO =
  `<rect x=".5" y=".5" width="${LADO - 1}" height="${LADO - 1}" rx="${RAIO - 0.5}" fill="none" stroke="url(#vssh-borda)"/>`;

/**
 * O SVG montado, de 64 × 64. `fundo` é uma camada lida do pacote, `{ cor }`, ou `null` para o fundo
 * da família.
 */
export function comporIcone(glifo: Camada, fundo: Camada | { cor: string } | null = null): string {
  const base = !fundo ? FUNDO_DA_FAMILIA
    : 'cor' in fundo ? `<rect width="${LADO}" height="${LADO}" fill="${COR.test(fundo.cor) ? fundo.cor : '#15171c'}"/>`
    : imagem(fundo);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LADO} ${LADO}" width="${LADO}" height="${LADO}">` +
    `<defs>${DEFS}</defs><g clip-path="url(#vssh-mascara)">${base}${imagem(glifo)}</g>${ACABAMENTO}</svg>`;
}
