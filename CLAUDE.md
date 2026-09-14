# CLAUDE.md

Orientação para quem vai editar este repositório, pessoa ou agente. O que está aqui vincula; a
visão geral está no [README.md](README.md).

## O que é

O SDK do VSSH: o que o autor de um vssh-app usa para escrever, buildar e publicar um app. O
repositório é público de propósito, para que o workflow reutilizável seja chamável do CI de
qualquer repositório de app com o `github.token` padrão. Nada que exija credencial entra aqui.

O sistema (o portal, o shell, os motores) mora no repositório privado `vssh-sso`. Trabalho dele
não se planeja aqui.

## Dois diretórios são gerados, e ninguém os edita

`api/` e `runtime/` são escritos por um job de CI do `vssh-sso` depois de cada deploy
(`scripts/gerar-sdk.js` de lá). O gerador confere o que está no destino contra os hashes do
`api/build-info.json` antes de escrever: um arquivo editado à mão para a rodada com o nome dele na
mensagem, e só um `--force` de uma pessoa passa por cima. Uma mudança que alguém queira em `api/`
se faz na fonte, no `vssh-sso`.

`runtime/` hoje tem só um README: as libs de backend ainda vêm do `vssh-app-toolkit`, e é isso que
o `installCommand` dos templates e dos exemplos declara. Quando o canal passar a publicá-las aqui,
o que muda está descrito em [MIGRATION.md](MIGRATION.md).

## Comandos

```bash
npm test            # a suíte Node (tests/); sem python3 os testes do validador se pulam
npm run test:py     # o template Python e os exemplos Python; pede as libs em vendor/py (abaixo)
```

As libs de um template se instalam pelo `installCommand` do manifesto dele, que é o que o
servidor roda. Para o Python: `cd templates/hello-vssh-app && bash -c "$(python3 -c 'import json;print(json.load(open("vssh-app.json"))["backend"]["installCommand"])')"`.
Para o Node, `npm ci` em `templates/hello-vssh-app-node`. Sem elas, os testes que as usam se
pulam dizendo o comando.

Não há dependência npm neste repositório, e é regra: a suíte é `node --test` sobre a biblioteca
padrão, e o validador do `vssh-app-publish` é Python da biblioteca padrão. Cada dependência seria
mais uma coisa a faltar num runner ou na máquina de quem desenvolve.

## Prosa: comentários, documentação e texto de interface

Toda prosa deste repositório passa pela skill [`.claude/skills/deslop`](.claude/skills/deslop/SKILL.md)
(MIT, de Stephen Turner): comentário de código, README, MIGRATION, texto que um template mostra a
uma pessoa, mensagem de commit, e este arquivo. A skill remove os padrões de escrita de modelo de
linguagem: travessão, contraste "não é X, é Y", frase curta de efeito fechando parágrafo, lista com
negrito na frente de cada item, pergunta retórica auto-respondida, voz passiva sem agente,
tricolon, seta unicode.

O catálogo de frases da skill é em inglês. Para o português valem as regras estruturais: sujeito
nomeado e voz ativa, ritmo variado, sem travessão, sem negrito na frente de item de lista, sem
contraste binário, especificidade no lugar de declaração vaga. A conferência é uma revisão com a
régua da própria skill: cinco dimensões (direção, ritmo, confiança no leitor, autenticidade,
densidade), nota de 1 a 10 em cada, e abaixo de 35 de 50 o texto volta.

Comentário e documentação descrevem o estado atual do código. O que foi diferente um dia, quando
mudou, e "atualizado em <data>" são registros do git, e ficam fora deles. Uma regra pode carregar
o motivo dela, em tempo presente, como propriedade do desenho. Texto novo nasce sob essas regras;
comentário existente muda quando alguém toca no arquivo, e aí muda o bloco inteiro de comentário
em que a pessoa mexeu.

## Invariantes

Cada um destes tem um modo de falha silencioso, e é por isso que estão aqui.

- Os dois templates são o mesmo app em dois runtimes: mesmas peças, mesmas rotas, e o
  `frontend/galeria.js` byte a byte idêntico. `tests/galeria-paridade.test.js` reprova a deriva.
  Uma peça nova entra nos dois lados no mesmo commit.
- O `vssh-app-publish` valida contra `api/vssh-app.schema.json`. Um checkout sem `api/` cai nas
  checagens mínimas e diz isso numa anotação do run. O validador implementa um subconjunto de
  JSON Schema (type, required, properties, enum, pattern, items, minimum/maximum,
  additionalProperties); um schema gerado com uma palavra-chave fora desse conjunto passa sem
  validar. `tests/publish-validacao.test.js` roda o validador de verdade contra o `api/` do
  checkout, e é o primeiro teste a olhar quando o canal trouxer um schema novo.
- Um workflow com byte de controle morre inteiro, com o GitHub apontando a linha 1.
  `tests/workflows.test.js` varre os `.yml`.
- Um diretório novo de teste Python tem de ser acrescentado ao `test:py` do `package.json`:
  `discover` não desce sozinho por `examples/*/test`.
- Todo JSON que vai para o wire usa separadores compactos nos dois runtimes dos templates, senão o
  mesmo app produz bytes diferentes conforme a linguagem.

## Testes

Um teste mede comportamento, executando. O que vincula:

- Não se escreve teste que lê o fonte como texto e afirma sobre ele (`assert.match(fonte, /…/)`,
  `css.includes('.classe')`). Uma regex sobre o fonte prova que uma linha existe: fica verde
  quando o defeito muda de casa e vermelha numa refatoração que não quebrou nada.
- Não escrever teste é um resultado permitido. Se o comportamento não dá para executar, entregue
  sem teste e diga no PR o que ficou sem cobertura e por quê.
- A exceção é a junção enumerada: um lado enumera um conjunto e exige que cada item exista do
  outro. Os arquivos que fazem isso são estes, e a lista é fechada:

  | arquivo | junção que ele fecha |
  |---|---|
  | `tests/galeria-paridade.test.js` | as duas galerias, byte a byte, e os dois manifestos |
  | `tests/template-galeria.test.js` | a marcação, o comportamento e as rotas do template Node |
  | `tests/docs-links.test.js` | todo link e âncora de `.md` e o arquivo e o cabeçalho que existem |
  | `tests/workflows.test.js` | os `.yml` e os bytes que o YAML aceita |

  Acrescentar um arquivo a ela é decisão de quem mantém o repositório, em PR separado da mudança
  que a motivou.

Rode o que a sua mudança alcança, com `node --test --test-concurrency=1 --test-timeout=120000
<arquivos>`; `npm test` inteiro é para antes de abrir o PR, e o CI roda de qualquer forma.

## Onde cada coisa mora

| Preciso mexer em... | Arquivo(s) |
|---|---|
| O contrato do manifesto | `api/vssh-app.schema.json`, gerado: a fonte é `schema/` do `vssh-sso` |
| Validação e empacotamento de um app | `scripts/vssh-app-publish` (o validador é o heredoc Python) + `tests/publish-validacao.test.js` |
| O portão de versão das libs | a seção `2b` do mesmo script + `tests/publish-libs-gate.test.js` |
| O reusable que o CI de um app chama | `.github/workflows/_publish-app-reusable.yml` |
| Publicar os templates e exemplos daqui | `.github/workflows/publish-apps.yml` (pede o secret `VSSH_REPO_PUBLISH_TOKEN` e a var `VSSH_REPO_API`) |
| O CI deste repositório | `.github/workflows/ci.yml` |
| Os templates | `templates/hello-vssh-app{,-node}/` + `tests/galeria-paridade.test.js` + `tests/template-galeria.test.js` + `tests/python/test_template.py` |
| Os exemplos | `examples/palco/` (testes em `examples/palco/test/`), `examples/print-engine/` |
| Conceitos e guias | `docs/` |
| O emulador | `emulador/`, na etapa seguinte |
