'use strict';

// A GPU que o sistema concedeu a este app. O par de `vssh/gpu.py`.
//
// O `vssh-app-run` decide ao subir o app, com o que o servidor tem e com o que o manifesto pede em
// `recursos.gpu.modo`, e registra a decisão em `~/.vssh-apps/<id>/limits.json`. O app pergunta
// aqui, em vez de ler esse arquivo ou de olhar `CUDA_VISIBLE_DEVICES`, e a resposta é a mesma que
// a janela dele recebe por `vssh.gpu.estado()` e que o gerenciador de tarefas mostra.
//
// A arbitragem é por convenção. `concedida` quer dizer que o runtime CUDA enxerga a placa e que
// este processo abre o render node. A placa continua compartilhada com os outros processos do
// usuário.

const fs = require('node:fs');
const path = require('node:path');
const app = require('./app.js');

const REGISTRO = 'limits.json';

/** O `limits.json` deste app, ao lado do diretório de dados, ou `null` quando não há. */
function registro(env) {
  const caminho = path.join(path.dirname(app.dados(env)), REGISTRO);
  try {
    const r = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
  } catch {
    return null;
  }
}

/**
 * O que o sistema concedeu: `{ concedida: boolean, dispositivos: [...], motivo: string | null }`.
 *
 * `dispositivos` são os que este processo abre, cada um com `fabricante`, `driver`, `virtual`,
 * `video` (o caminho de codificação: `nvenc`, `vaapi` ou `null`) e `renderNode`; a lista é vazia
 * quando nada foi concedido. `motivo` é a frase do lançador quando a resposta é não (`não
 * declarada no manifesto`, `sem GPU utilizável: ...`, `não consegui consultar este servidor`), e
 * `null` quando é sim. Sem registro do lançador, o que acontece a um app que subiu por fora dele,
 * a resposta é não, e o motivo diz isso.
 */
function concedida(env = process.env) {
  const r = registro(env);
  if (!r || typeof r.gpu !== 'string') {
    return { concedida: false, dispositivos: [], motivo: 'sem registro do lançador' };
  }
  if (r.gpu === 'concedida') {
    const todos = Array.isArray(r.gpuInfo?.dispositivos) ? r.gpuInfo.dispositivos : [];
    return { concedida: true, dispositivos: todos.filter((d) => d && d.acesso === 'ok'), motivo: null };
  }
  const motivo = typeof r.gpuMotivo === 'string' && r.gpuMotivo ? r.gpuMotivo : null;
  return { concedida: false, dispositivos: [], motivo };
}

module.exports = { concedida };
