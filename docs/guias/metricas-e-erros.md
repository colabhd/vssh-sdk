# Métricas e erros

Ao terminar este guia você sabe como o seu app conta o que faz e mede quanto leva, como ele manda
uma exceção ao log do ambiente, o que o erro de JavaScript da janela já faz sozinho, e o que
nenhum rótulo pode carregar.

Tudo o que o app publica cai na plataforma de observabilidade do cluster, ao lado do que o portal
mede: as métricas no VictoriaMetrics e os erros no VictoriaLogs, os dois lidos pelo Grafana.

## O erro da janela já chega sozinho

O SDK web (`_sdk/vssh.js`) ouve o `error` e o `unhandledrejection` do quadro do app e os manda ao
shell por `vssh.app.relatarErro`. O shell carimba o id do app pela janela que recebeu a mensagem,
tira a query da URL da fonte, e manda o mesmo erro uma vez a cada dez minutos ao log do portal.
Nada disso pede código nem declaração.

Um erro que o app tratou e quer registrar vai pelo mesmo verbo, com o tipo `relatado`:

```js
try {
  await exportar(documento);
} catch (e) {
  vssh.app.relatarErro(e.message, e.stack, undefined, undefined, undefined, 'relatado');
  mostrarFalha(e);
}
```

## Declarar no manifesto

O backend precisa da credencial do app diante do portal, como na fila:

```json
{ "recursos": { "metricas": true } }
```

Com a declaração, o portal escreve `VSSH_PORTAL_URL` e `VSSH_PORTAL_TOKEN` no ambiente do app a
cada subida, com o escopo das métricas. Um app que já estava de pé quando declarou precisa de um
restart. Um app que também declara `recursos.fila` ou `recursos.salas` recebe uma credencial só,
com todos os escopos.

## Contar, medir e relatar no backend

```python
from vssh import metricas

metricas.contar('transcricoes', rotulos={'motor': 'whisperx', 'onde': 'fila'})
metricas.contar('audio_segundos', 312.5, {'lingua': 'pt'})

with metricas.cronometro('transcricao', {'motor': 'whisperx'}):
    transcrever(arquivo)

try:
    exportar(documento)
except Exception as e:
    metricas.relatar_erro(e)
    raise
```

```js
const { metricas } = require('vssh');

metricas.contar('transcricoes', 1, { motor: 'whisperx', onde: 'fila' });
await metricas.cronometrar('transcricao', { motor: 'whisperx' }, () => transcrever(arquivo));
try { exportar(doc); } catch (e) { metricas.relatarErro(e); throw e; }
```

| no SDK | no portal |
|---|---|
| `contar(nome, valor, rotulos)` | soma a `vssh_app_events_total{app, event, ...}` |
| `duracao(nome, segundos, rotulos)`, `cronometro` (`cronometrar` em Node) | uma observação em `vssh_app_event_duration_seconds{app, event, ...}` |
| `relatar_erro(e)` (`relatarErro` em Node) | uma linha do log do portal com a origem `backend`, o app, o servidor e a pessoa da credencial |

Publicar nunca lança e nunca espera a rede. Os eventos se juntam na memória, os contadores somados
por série, e saem a cada 10 s e na saída do processo; um envio que falhou não volta. Sem a
credencial nada é guardado nem sai, e `metricas.disponivel()` diz por quê, o que deixa o mesmo
código rodar num servidor em que o app não declarou nada.

## O que um rótulo pode carregar

Um rótulo diz de que tipo é o evento: o motor, a língua, onde rodou, o formato. Ele nunca diz quem
causou o evento nem qual arquivo: cada valor distinto de um rótulo vira uma série nova, e uma série
por pessoa ou por arquivo encheria o banco e poria dado pessoal num endpoint que máquina lê.

O portal confere a forma de cada evento e recusa o que não serve:

- o nome em minúsculas, dígitos e `_`, começando por letra;
- até cinco rótulos, com a chave no mesmo alfabeto do nome, e fora `app`, `event` e `le`;
- o valor com até 64 letras sem acento, dígitos e `_.:+-`, o que deixa caminho de arquivo e e-mail
  de fora;
- até 300 séries por app; passado o teto, a série nova é recusada e conta em
  `vssh_app_events_dropped_total{app, reason}`.

## Onde ver

No Grafana, a pasta VSSH tem o painel do portal, com a tabela dos eventos que cada app publicou e
os erros relatados por origem e app. O log fica no VictoriaLogs do sítio do portal:

```
k8s.namespace.name:vssh | unpack_json | modulo:=relato app:=meu-app
```
