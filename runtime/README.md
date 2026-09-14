# runtime

Este diretório é gerado pelo sistema, como `api/`, e ninguém o edita à mão. Nele o canal de
publicação vai depositar as libs de backend de um vssh-app (Node e Python), para o emulador e para
o editor de quem escreve um app; em produção elas vêm do próprio servidor VSSH.

Enquanto o canal não as publica aqui, as libs continuam sendo instaladas do `vssh-app-toolkit`,
pelo gerenciador de pacotes do runtime do app: é o que os templates e os exemplos deste
repositório declaram no `installCommand`. O `vssh-app-publish` lê deste diretório a versão de
referência das libs (`runtime/package.json`); sem ele, o portão de versão avisa que não conferiu.
