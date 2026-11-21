// O comando deste app no terminal: pergunta a hora ao backend e a escreve.
//
// O manifesto o declara em `contributes.comandos`, com `backend: true`, e o nome do comando é o id
// do app. Quem o roda na estação é o `vssh-app-comando`, que sobe o backend parado e põe no
// ambiente o socket e o token dele; o `servidor.pedir` do runtime conversa com o backend por ali,
// como a janela. Fora do ambiente, a bancada sobe o backend num socket e exporta `VSSH_APP_SOCKET`
// e `VSSH_APP_TOKEN` antes de rodar este arquivo (docs/guias/comandos.md).
//
// Os códigos de saída são os do `vssh`: 0 feito, 1 o backend respondeu com erro, 3 sem backend.

import { createRequire } from 'node:module';

const { servidor } = createRequire(import.meta.url)('vssh');

const USO = (nome) => `uso: ${nome} [--json]

Pergunta a hora ao backend do app e a escreve.

  --json   escreve a resposta do backend como JSON`;

async function principal(args) {
  if (args.includes('-h') || args.includes('--help')) {
    console.log(USO(process.env.VSSH_APP_ID || 'hello-world-node'));
    return 0;
  }
  let r;
  try {
    r = await servidor.pedir('/api/ping');
  } catch (e) {
    process.stderr.write(`O backend não respondeu: ${e.message}\n`);
    return 3;
  }
  if (r.status !== 200) {
    process.stderr.write(`O backend respondeu ${r.status}.\n`);
    return 1;
  }
  const resposta = JSON.parse(r.corpo.toString('utf8'));
  if (args.includes('--json')) console.log(JSON.stringify(resposta));
  else console.log(`${resposta.appId} respondeu às ${resposta.time}`);
  return 0;
}

process.exitCode = await principal(process.argv.slice(2));
