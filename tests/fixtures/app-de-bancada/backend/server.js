'use strict';

// O backend do app de bancada: serve a janela pelo `vssh.web`, que põe o SDK web no `<head>`.

const http = require('node:http');
const path = require('node:path');
const { servidor, web } = require('vssh');

const spa = web.spa(path.join(__dirname, '..', 'frontend'), { scripts: ['cenas.js'] });

const server = http.createServer(servidor.portao(async (req, res) => {
  const url = new URL(req.url, 'http://app');
  if (url.pathname === '/saude') { res.writeHead(200); res.end('ok'); return; }
  if (await spa(req, res, url)) return;
  res.writeHead(404);
  res.end();
}));

servidor.escutar(server);
