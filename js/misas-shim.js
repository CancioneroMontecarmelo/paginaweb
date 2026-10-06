'use strict';
// Lo mínimo que los scripts del editor (acordes, markdown, etiquetas, instrumentos, render) esperan encontrar.
var state = { highlight: 'todas', notation: 'latin', tagFamily: 'catolico' };
var mcCancionActual = null;
var ACORDES_BASE = 'editor/vendor/acordes/';
function isLatin() { return state.notation === 'latin'; }
function cur() { return mcCancionActual; }

const scriptsCargados = new Map();
function loadScript(src) {
  if (!scriptsCargados.has(src)) {
    scriptsCargados.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { scriptsCargados.delete(src); s.remove(); reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return scriptsCargados.get(src);
}
