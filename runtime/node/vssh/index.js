'use strict';

// vssh: o runtime de backend que o sistema instala em cada servidor, para apps em Node.
//
// Um app importa este pacote em vez de carregar uma cópia dele: o portal o põe em
// `/opt/vssh/sdk/node` e o `vssh-app-run` o expõe pelo `NODE_PATH` a todo app que sobe.
//
//   const { servidor, avisos, app } = require('vssh');
//   const servidor = require('vssh/servidor');          // ou um módulo por vez
//
// Num app escrito em ESM, `import 'vssh'` não passa pelo `NODE_PATH` (a resolução de ES modules
// do Node não o consulta); o caminho é o `createRequire`:
//
//   import { createRequire } from 'node:module';
//   const { servidor } = createRequire(import.meta.url)('vssh');
//
// Os sete módulos carregam sob demanda: quem só notifica não paga o servidor.
//
//   servidor   o socket unix do app, o portão de token, o `/saude`, o log
//   web        a SPA do app, com o SDK web e o Tuff injetados no `<head>`
//   eventos    SSE: um stream por resposta, e a difusão a quem assinou
//   dados      o filesystem privado do app, e as rotas que o frontend chama
//   avisos     notificar, atividade em curso e bandeja, para um app sem janela
//   app        quem sou, o diretório de dados, a versão do pacote instalado
//   gpu        o que o sistema concedeu de GPU a este app, e por que não

const modulos = {
  servidor: './servidor.js',
  web: './web.js',
  eventos: './eventos.js',
  dados: './dados.js',
  avisos: './avisos.js',
  app: './app.js',
  gpu: './gpu.js',
};

for (const [nome, caminho] of Object.entries(modulos)) {
  Object.defineProperty(module.exports, nome, {
    enumerable: true,
    get: () => require(caminho),
  });
}
