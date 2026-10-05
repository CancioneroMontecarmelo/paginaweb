'use strict';
// Lo mínimo que los scripts del editor (acordes, markdown, etiquetas, render) esperan encontrar.
var state = { highlight: 'todas', notation: 'latin', tagFamily: 'catolico' };
var mcCancionActual = null;
function isLatin() { return state.notation === 'latin'; }
function cur() { return mcCancionActual; }
