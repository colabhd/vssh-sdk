# Referência

> Páginas geradas pelo canal de publicação do sistema, a partir da tabela da ponte, do schema do
> manifesto e do lançador de apps. Uma mudança se faz na fonte, no `vssh-sso`.

## A ponte, espaço a espaço

A superfície que o SDK web (`_sdk/vssh.js`) expõe a um app com janela: `vssh.<espaco>.<verbo>()`
para pedir, `vssh.<espaco>.ao('<evento>', cb)` para ouvir. 9 espaços, 60 verbos e 13 eventos.

| espaço | verbos | eventos | o que cobre |
|---|---|---|---|
| [`vssh.app`](app.md) | 3 | 1 | Quem o app é e em que ambiente ele está: as capacidades do shell, os verbos disponíveis, o título que a janela mostra e a rota que a sessão restaura. |
| [`vssh.janela`](janela.md) | 12 | 4 | A janela do app: controlada em runtime pelo app que a ocupa, e declarada no manifesto para quem a abre. |
| [`vssh.arquivos`](arquivos.md) | 25 | 3 | Ler e escrever com o consentimento do usuário, escolher, vigiar, abrir, abrir com, arrastar, e a área de transferência de arquivos. |
| [`vssh.avisos`](avisos.md) | 6 | 3 | Notificação, aviso efêmero, atividade em curso e bandeja, para um app com janela aberta. |
| [`vssh.dialogos`](dialogos.md) | 6 | 0 | Os diálogos do sistema e o menu de contexto, desenhados pelo shell com os dados que o app manda. |
| [`vssh.segredos`](segredos.md) | 3 | 0 | O cofre: o app pede uma credencial pelo nome, o shell mostra o campo e grava, e o valor nunca passa pelo app. A pessoa confere, troca e apaga o que guardou no Chaveiro, a janela do ambiente que lista as credenciais de todo app. |
| [`vssh.midia`](midia.md) | 3 | 2 | O que o app está tocando, o transporte que ele sabe fazer e o volume que o usuário deixou para ele. |
| [`vssh.impressao`](impressao.md) | 1 | 0 | Imprimir pela tela do sistema: o app pede, e quem escolhe a impressora e confirma é o usuário. |
| [`vssh.gpu`](gpu.md) | 1 | 0 | O recurso que o sistema arbitra ao subir o app. O manifesto declara o que o app precisa em `recursos.gpu.modo`; quem decide, com o que o servidor tem, é o `vssh-app-run`, e o app pergunta o que recebeu sem conhecer `CUDA_VISIBLE_DEVICES` nem o inventário do servidor. |

## O manifesto e o ambiente

| página | o que cobre |
|---|---|
| [O manifesto](manifesto.md) | O `vssh-app.json` campo a campo, do schema: tipo, obrigatoriedade, padrão, valores e a descrição de cada um. |
| [O ambiente do backend](ambiente.md) | As variáveis que o lançador exporta ao backend e os arquivos de `~/.vssh-apps/<id>/`. |

## Os artefatos de que estas páginas saem

[`api/abi.json`](../../api/abi.json) é a tabela da ponte como dado; [`api/vssh.d.ts`](../../api/vssh.d.ts)
são os typings gerados dela; [`api/vssh-app.schema.json`](../../api/vssh-app.schema.json) é o schema
do manifesto. O [`api/build-info.json`](../../api/build-info.json) ao lado diz de qual versão do shell
tudo isso veio.
