'use strict';

// Quem este app é, e onde ele guarda as coisas. O par de `vssh/app.py`.
//
// O `vssh-app-run` exporta a identidade (`VSSH_APP_ID`) e o diretório de dados
// (`VSSH_APP_DATA_DIR`) ao subir o app; a versão vem do `vssh-app.json` instalado, que o portal
// reescreve com o hash do conteúdo ao instalar. Ler as três coisas daqui, e de lugar nenhum mais,
// é o que faz um app rodar igual sob o `vssh-app-run` e numa bancada que o sobe à mão.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MANIFESTO = 'vssh-app.json';

/**
 * O diretório do pacote instalado: o que tem o `vssh-app.json`.
 *
 * Sobe a partir do script principal e depois a partir do diretório corrente, que é o do pacote
 * quando o `vssh-app-run` lança. `null` quando não há manifesto em nenhum dos dois caminhos.
 */
function raiz() {
  const pontos = [];
  const principal = require.main?.filename || process.argv[1];
  if (principal) pontos.push(path.dirname(path.resolve(principal)));
  pontos.push(process.cwd());
  for (const inicio of pontos) {
    let d = inicio;
    for (;;) {
      if (fs.existsSync(path.join(d, MANIFESTO))) return d;
      const pai = path.dirname(d);
      if (pai === d) break;
      d = pai;
    }
  }
  return null;
}

/** O `vssh-app.json` instalado, como objeto. Vazio quando não há. */
function manifesto() {
  const r = raiz();
  if (!r) return {};
  try {
    const m = JSON.parse(fs.readFileSync(path.join(r, MANIFESTO), 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

/**
 * A `version` do pacote instalado, `dev` fora de um pacote. O instalador a reescreve como
 * `<semver>+g<hash do conteúdo>`, então um byte diferente é uma versão diferente.
 */
function versao() {
  return String(manifesto().version || 'dev');
}

/** O id do app: `VSSH_APP_ID`, ou o `id` do manifesto quando o ambiente não o exportou. */
function ident(env = process.env) {
  return String(env.VSSH_APP_ID || manifesto().id || 'app');
}

/**
 * O diretório de dados por usuário: `VSSH_APP_DATA_DIR`, ou `~/.vssh-apps/<id>/data`. Sobrevive
 * a reinstalação e a reinício, ao contrário do diretório do pacote.
 */
function dados(env = process.env) {
  if (env.VSSH_APP_DATA_DIR) return env.VSSH_APP_DATA_DIR;
  return path.join(env.HOME || os.homedir(), '.vssh-apps', ident(env), 'data');
}

module.exports = { ident, dados, raiz, manifesto, versao };
