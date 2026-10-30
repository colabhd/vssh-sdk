# `vssh.desempenho`

> Página gerada da tabela da ponte ([`api/abi.json`](../../api/abi.json)) pelo canal de publicação
> do sistema. Uma mudança se faz na fonte, `vssh-client/js/app/abi.js` do `vssh-sso`.

O que o app mede no aparelho de quem usa, entregue à equipe que cuida do VSSH, para a página
Desempenho do painel admin. A medida só sai com a confirmação da pessoa, num diálogo que o shell
abre.

## Verbos

| verbo | responde |
|---|---|
| [`vssh.desempenho.mandarMedida(medida)`](#mandarmedida) | sim, em até 10 min |

### `mandarMedida`

`vssh.desempenho.mandarMedida(medida)`

Manda o resultado de uma bancada do app, como o "Medir este aparelho" dele, ao portal, junto da
descrição deste aparelho e da classe de cada experiência que o shell tem. O shell pergunta antes,
num diálogo com o nome do app, e a resposta é `{ mandado: true }`, ou `{ mandado: false }` quando a
pessoa não quis. A medida é um objeto de até 2000 campos, com nomes de letras, números e `_`, oito
níveis no máximo e o corpo inteiro abaixo de 96 KB; o portal a guarda sem quem mandou.

Responde: uma promessa, com prazo de 10 min (ritmo `humano`, a resposta depende de uma pessoa).
Num hiperlink: recusado. A medida vai com a descrição do aparelho, e só um vssh-app a manda.
No fio: `type: "desempenho", op: "mandar"`.

| argumento | tipo | opcional | no fio |
|---|---|---|---|
| `medida` | `Record<string, unknown>` | não | `medida` |

## Eventos

Este espaço não declara eventos; `vssh.desempenho.ao()` recusa qualquer nome.
