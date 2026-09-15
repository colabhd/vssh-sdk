'use strict';

// A gaveta do site: abrir e fechar numa janela estreita. O `TuffGaveta.ligar` do Tuff serve a uma
// página só, com seções que rolam; aqui cada item é um link para outra página, e o que sobra do
// comportamento é o botão, o véu, o Esc e o foco indo e voltando.

(function () {
  const ABERTA = 'tuff-gaveta--aberta';
  const raiz = document.getElementById('site-gaveta');
  if (!raiz) return;
  const botao = raiz.querySelector('[data-tuff-gaveta-abrir]');
  const veu = raiz.querySelector('.tuff-gaveta-veu');
  const lateral = raiz.querySelector('.tuff-gaveta-lateral');

  function abrir() {
    raiz.classList.add(ABERTA);
    botao.setAttribute('aria-expanded', 'true');
    // O foco entra na gaveta, no item da página atual: abrir por teclado leva a algum lugar.
    const alvo = lateral.querySelector('[aria-current="page"]') || lateral.querySelector('.tuff-gaveta-item');
    if (alvo) alvo.focus();
  }

  function fechar(devolverFoco) {
    if (!raiz.classList.contains(ABERTA)) return;
    raiz.classList.remove(ABERTA);
    botao.setAttribute('aria-expanded', 'false');
    if (devolverFoco) botao.focus();
  }

  botao.addEventListener('click', () => {
    if (raiz.classList.contains(ABERTA)) fechar(true); else abrir();
  });
  veu.addEventListener('click', () => fechar(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && raiz.classList.contains(ABERTA)) { e.preventDefault(); fechar(true); }
  });

  // A lateral persistente mostra a página atual mesmo quando o índice é mais alto que a janela.
  const atual = lateral.querySelector('[aria-current="page"]');
  if (atual) atual.scrollIntoView({ block: 'nearest' });
})();
