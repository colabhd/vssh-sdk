# Consentimento

Ao terminar esta página você sabe o que um app alcança no filesystem da pessoa, quem concede esse
alcance, onde a concessão mora, o que ela protege e o que ela não protege. O mesmo modelo governa
o cofre de segredos, a impressão e os diálogos: o app pede, o shell mostra, e a pessoa decide.

## Escolher é consentir

O modelo é o da File System Access API do W3C. O app não recebe a home da pessoa; ele recebe o que
ela escolheu num seletor. Um `showDirectoryPicker()` abre o gerenciador de arquivos do ambiente
em modo de escolha; a pasta escolhida passa a ser alcançável pelo app, e só ela, com o que há
dentro. Não há segunda confirmação: a escolha é o consentimento.

Cada operação de arquivo do app atravessa a ponte e é conferida pelo shell contra a lista de
concessões (os grants) antes de chegar à API do portal. O app nunca fala com `/api/fs/*` direto.
Uma operação com dois caminhos (`renomear`, `copiar`) confere os dois: sem isso, um `renomear`
levaria um arquivo da pessoa para fora do que ela autorizou, e um `copiar` traria para dentro algo
que o app não podia ler, e as duas operações teriam sucesso sem erro nenhum. A recusa é um `403`
que nomeia o caminho reprovado.

## Onde o grant mora

O grant é do app, por servidor, e mora nas preferências da pessoa (`appGrants`, em
`/api/user/settings`). Ele viaja com ela: o mesmo app no mesmo servidor, aberto de outro computador,
encontra a concessão feita. O teto é de 64 caminhos por app; quem excede isso quase sempre quer um
caminho só, a raiz.

O handle da File System Access API é outra coisa: o polyfill o guarda no IndexedDB do navegador,
que é por perfil e não viaja. Daí a terceira resposta que um app precisa tratar: num computador
novo ele acorda com a permissão concedida e sem handle nenhum. Não é `granted` (não há por onde
ler) nem `denied` (ninguém negou). O app reconstrói o handle a partir do caminho concedido, sem
abrir seletor, porque a escolha já foi feita uma vez. O guia [arquivos com
consentimento](../guias/arquivos-com-consentimento.md) mostra o código.

Duas precisões sobre o que o shell responde:

- `queryPermission()` responde de verdade, consultando o shell. `requestPermission()` reabre o
  seletor, e só a partir de um gesto da pessoa; sem gesto ele devolve `'prompt'` sem abrir nada,
  que é a regra do navegador;
- `{ mode: 'read' | 'readwrite' }` é aceito e repassado, e todo grant de hoje é `readwrite`. Pedir
  `read` e receber `granted` está correto.

A pessoa revoga em Permissões de arquivo, no menu de contexto da janela do app. `'denied'` é um
estado normal, e um app o trata como tal.

## O que o grant protege

O grant mantém o app dentro do que a pessoa escolheu e transforma um erro de programação numa
mensagem clara. Ele não é uma fronteira contra um app hostil: o app roda num iframe de mesma
origem que o portal, e o JS dele alcança `/api/*` com o cookie de sessão, com ou sem a tabela de
grants. A fronteira de segurança é outra, e é a instalação: um admin instalou o app, como root, num
servidor compartilhado, e por isso ele é confiável. O backend do app já lê qualquer arquivo que a
pessoa lê, porque roda como a conta dela.

O que o ambiente ganha com o grant é uniformidade. Todo app pede do mesmo jeito, a pessoa concede
no mesmo seletor, revoga no mesmo lugar e vê a mesma lista. Um app que inventasse o próprio
caminho para a home (um campo de texto pedindo `/home/ana/dados`) teria o mesmo alcance e nenhuma
dessas propriedades.

## O mesmo modelo, em três outros lugares

O cofre de segredos: o manifesto declara de que credenciais o app precisa; o valor nunca vem do
manifesto, e o gate de publicação recusa um `value` ali. Quem guarda é a pessoa, pelo shell, e o
valor mora em `~/.vssh-apps/<id>/secrets.json` (modo `0600`) no servidor dela. O portal escreve e
esquece: não há coluna de segredo no portal, e a tela nunca relê o valor. O app pede pelo nome
(`vssh.segredos`), o shell mostra o campo, e o valor chega ao backend como variável de ambiente
na próxima subida. Um backend que já estava de pé precisa reiniciar, porque o ambiente de um
processo é fixado no `spawn`, e o shell diz isso ao app.

A impressão: `vssh.impressao` abre a tela de impressão do ambiente com o arquivo pedido. Quem
escolhe a impressora e confirma é a pessoa, com o nome do arquivo na tela. A chamada resolve
quando a tela abre, e não quando ela imprime.

Os diálogos: `vssh.dialogos` desenha a pergunta com a aparência do ambiente, fora do iframe. Um
modal desenhado dentro do app fica preso no iframe e não bloqueia o resto da janela; o do shell
bloqueia a janela inteira e devolve a resposta.

## O que não passa pelo consentimento, e por quê

O clipboard de texto e imagem é a API padrão do navegador, direto: o iframe recebe
`allow="clipboard-read; clipboard-write"`, e `clipboard.write()` exige ativação transitória da
pessoa, que não atravessa `postMessage`. Mediar pelo shell quebraria o que a mediação existiria
para permitir. O clipboard de arquivos, que é do gerenciador de arquivos, passa pela ponte.

O arraste de arquivos nas duas direções não declara nada no manifesto: o app é servido na mesma
origem, então o `drop` cai no documento dele e o `dataTransfer` é legível direto. O backend já lê
o que a pessoa lê; não haveria o que guardar.
