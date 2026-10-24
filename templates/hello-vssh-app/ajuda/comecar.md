---
id: comecar
titulo: O Hello World e a galeria
cobre: [janela, menu:painel, segredo:HELLO_SEGREDO, recurso:gpu, recurso:fila, configuracoes]
palavras: [exemplo, galeria, modelo]
---

O Hello World é um app de exemplo. A janela dele é uma galeria: cada painel chama uma parte do ambiente e mostra o que voltou, e quem escreve um app copia o painel de que precisa.

## Uma segunda janela

{{Direito}} no ícone do app, no menu iniciar, e escolha [[Abrir o painel]]. Uma janela pequena abre ao lado da primeira, ligada ao mesmo backend.

## A placa de vídeo

O painel [[O que o ambiente decidiu por este app]] diz se o servidor deu uma placa de vídeo a este app. [[medir GPU × CPU (leva alguns segundos)]] codifica o mesmo vídeo duas vezes, uma no processador e outra na placa, e diz quantas vezes uma foi mais rápida que a outra.

## A fila de processamento

Um trabalho grande demais para este servidor vai para o cluster. No painel da fila, [[nvidia-smi no cluster (leva um minuto)]] sobe um contêiner com uma placa do cluster e mostra qual placa ele recebeu.

## A senha de exemplo

O app pede uma senha chamada `HELLO_SEGREDO`, que serve só para mostrar o cofre. [[guardar HELLO_SEGREDO]] abre o campo do ambiente, e o valor vai para o seu servidor. O app recebe o valor quando sobe de novo, então feche e abra o app depois de guardar. A senha guardada fica no {{t:ambiente/chaveiro|Chaveiro}}, onde você a troca ou apaga.

## A seção em Configurações

O app traz uma seção própria para {{t:ambiente/configuracoes|Configurações}}, com o nome dele. Ela aparece depois que você liga [[Mostrar em Configurações]] no painel da galeria.
