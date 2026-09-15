'use strict';

// A busca do site. O índice é `busca.json`, gerado no build com título, seção, cabeçalhos e o
// texto sem markup de cada página; o script o carrega na primeira digitação, normaliza (sem
// acento, minúsculas), exige todos os termos e mostra até 20 resultados numa `.tuff-lista` abaixo
// da caixa. `/` foca a caixa, Esc fecha, Enter abre o resultado marcado, setas mudam a marca.

(function () {
  const caixa = document.getElementById('site-busca');
  const lista = document.getElementById('site-busca-resultados');
  if (!caixa || !lista) return;
  const raiz = document.body.dataset.raiz || '';
  const TETO = 20;

  const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let indice = null;
  let carregando = null;
  function carregar() {
    if (indice) return Promise.resolve(indice);
    if (!carregando) {
      carregando = fetch(`${raiz}busca.json`)
        .then((r) => r.json())
        .then((paginas) => {
          indice = paginas.map((p) => ({
            ...p,
            nTitulo: normalizar(p.titulo),
            nCabecalhos: normalizar(p.cabecalhos.join('\n')),
            nTexto: normalizar(p.texto),
          }));
          return indice;
        })
        .catch(() => { carregando = null; return []; });
    }
    return carregando;
  }

  /** Cada termo tem de aparecer em algum lugar; onde ele aparece decide a ordem. */
  function buscar(paginas, consulta) {
    const termos = normalizar(consulta).split(/\s+/).filter(Boolean);
    if (!termos.length) return [];
    const achados = [];
    for (const p of paginas) {
      let pontos = 0;
      let todos = true;
      for (const t of termos) {
        if (p.nTitulo.includes(t)) pontos += 100;
        else if (p.nCabecalhos.includes(t)) pontos += 20;
        else if (p.nTexto.includes(t)) pontos += 1 + Math.min(9, p.nTexto.split(t).length - 1);
        else { todos = false; break; }
      }
      if (todos) achados.push({ p, pontos });
    }
    achados.sort((a, b) => b.pontos - a.pontos || a.p.titulo.localeCompare(b.p.titulo));
    return achados.slice(0, TETO).map((a) => a.p);
  }

  let marcado = -1;
  function marcar(k) {
    const itens = lista.querySelectorAll('.tuff-item');
    if (!itens.length) { marcado = -1; return; }
    marcado = (k + itens.length) % itens.length;
    itens.forEach((el, i) => el.setAttribute('aria-selected', String(i === marcado)));
    itens[marcado].scrollIntoView({ block: 'nearest' });
  }

  function mostrar(resultados) {
    lista.textContent = '';
    if (!resultados.length) {
      const nada = document.createElement('div');
      nada.className = 'site-busca-nada';
      nada.textContent = 'Nada com esses termos.';
      lista.appendChild(nada);
    }
    for (const p of resultados) {
      const a = document.createElement('a');
      a.className = 'tuff-item';
      a.setAttribute('role', 'option');
      a.setAttribute('aria-selected', 'false');
      a.href = raiz + p.url;
      const titulo = document.createElement('span');
      titulo.textContent = p.titulo;
      const secao = document.createElement('span');
      secao.className = 'tuff-tag';
      secao.textContent = p.secao;
      a.append(titulo, secao);
      lista.appendChild(a);
    }
    lista.hidden = false;
    marcar(0);
  }

  function fechar() {
    lista.hidden = true;
    lista.textContent = '';
    marcado = -1;
  }

  let ultimaConsulta = '';
  function atualizar() {
    const consulta = caixa.value.trim();
    ultimaConsulta = consulta;
    if (!consulta) { fechar(); return; }
    carregar().then((paginas) => {
      if (consulta !== ultimaConsulta) return;
      mostrar(buscar(paginas, consulta));
    });
  }

  caixa.addEventListener('input', atualizar);
  caixa.addEventListener('focus', () => { carregar(); if (caixa.value.trim()) atualizar(); });
  caixa.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!lista.hidden) fechar();
      else { caixa.value = ''; caixa.blur(); }
    } else if (e.key === 'Enter') {
      const alvo = lista.querySelectorAll('.tuff-item')[Math.max(0, marcado)];
      if (alvo) { e.preventDefault(); location.href = alvo.href; }
    } else if (e.key === 'ArrowDown' && !lista.hidden) {
      e.preventDefault();
      marcar(marcado + 1);
    } else if (e.key === 'ArrowUp' && !lista.hidden) {
      e.preventDefault();
      marcar(marcado - 1);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const alvo = e.target;
    if (alvo === caixa || (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) || alvo?.isContentEditable) return;
    e.preventDefault();
    caixa.focus();
    caixa.select();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!lista.hidden && !caixa.contains(e.target) && !lista.contains(e.target)) fechar();
  });
})();
