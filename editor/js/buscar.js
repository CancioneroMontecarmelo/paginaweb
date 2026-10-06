'use strict';
// Búsqueda de canciones de la Biblioteca por título, etiquetas, autores y letra (el campo «inicio» que arma el
// Apps Script: la primera estrofa y las dos primeras líneas de las demás, separadas por « / »).
// No distingue mayúsculas ni tildes, encuentra fragmentos en medio de una línea y tolera las faltas de
// ortografía comunes (h, b/v, c/s/z, ll/y, letras de más o de menos). La usan Misas y el editor.

const BUSCAR_COMUNES = new Set(['de', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'a', 'en', 'un', 'una', 'del', 'al', 'que', 'se', 'lo']);

// Minúsculas, sin tildes ni signos, con un solo espacio. mapa[i] = posición en el texto original.
function buscarPlanoConMapa(s) {
  s = String(s || '');
  let out = '';
  const mapa = [];
  for (let i = 0; i < s.length; i++) {
    let n = s[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!/^[a-z0-9]$/.test(n)) n = ' ';
    if (n === ' ' && (!out || out.endsWith(' '))) continue;
    out += n;
    mapa.push(i);
  }
  if (out.endsWith(' ')) { out = out.slice(0, -1); mapa.pop(); }
  return { out, mapa };
}
const buscarPlano = s => buscarPlanoConMapa(s).out;

// Clave de una palabra que iguala las faltas más comunes del español: «habre» = «abre», «bive» = «vive»
function buscarClave(w) {
  return w.replace(/ch/g, '\u0001').replace(/h/g, '')
    .replace(/g(?=[ei])/g, 'j').replace(/gu(?=[ei])/g, 'g').replace(/qu(?=[ei])/g, 'k')
    .replace(/c(?=[ei])/g, 's').replace(/[cq]/g, 'k').replace(/z/g, 's').replace(/[vw]/g, 'b')
    .replace(/ll/g, 'y').replace(/y$/, 'i').replace(/(.)\1+/g, '$1').replace(/\u0001/g, 'ch');
}

// Distancia de edición con trasposición; corta en cuanto supera «tope»
function buscarDistancia(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let ant2 = null, ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(ant[j] + 1, fila[j - 1] + 1, ant[j - 1] + c);
      if (ant2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, ant2[j - 2] + 1);
      fila.push(v);
      if (v < min) min = v;
    }
    if (min > tope) return tope + 1;
    ant2 = ant;
    ant = fila;
  }
  return ant[b.length];
}

// 3 = igual, 2 = empieza así, 1 = parecida (una letra distinta; dos en palabras largas), 0 = no
// Las palabras cortas solo cuentan como comienzo si son la última (la que se está escribiendo)
function buscarCalidad(q, w, ultima = true) {
  if (w === q) return 3;
  if (q.length >= (ultima ? 3 : 4) && w.startsWith(q)) return 2;
  const tope = q.length >= 9 ? 2 : q.length >= 4 ? 1 : 0;
  if (!tope) return 0;
  if (buscarDistancia(q, w, tope) <= tope) return 1;
  if (q.length >= 5 && w.length > q.length && buscarDistancia(q, w.slice(0, q.length), tope) <= tope) return 1;
  return 0;
}

const buscarClaves = plano => plano ? plano.split(' ').map(buscarClave) : [];

// Índice de cada canción (se arma una vez por objeto)
const BUSCAR_INDICE = new WeakMap();
function buscarIndice(c) {
  let ix = BUSCAR_INDICE.get(c);
  const fuente = [c.inicio, c.letraDe, c.musicaDe].join('\u0000');
  if (ix && ix.fuente === fuente) return ix;
  const lineas = String(c.inicio || '').split(/\s+\/\s+/).filter(Boolean);
  const titulo = buscarPlano(c.titulo), etiquetas = (c.etiquetas || []).map(buscarPlano).join(' | ');
  const autores = [c.letraDe, c.musicaDe].filter(Boolean).map(buscarPlano).join(' | ');
  const lineasPlanas = lineas.map(buscarPlano);
  ix = {
    fuente, lineas, titulo, etiquetas, autores, lineasPlanas,
    pTitulo: new Set(buscarClaves(titulo)), pEtiquetas: new Set(buscarClaves(etiquetas.replace(/ \| /g, ' '))),
    pAutores: new Set(buscarClaves(autores.replace(/ \| /g, ' '))),
    pLetra: new Set(lineasPlanas.flatMap(buscarClaves)),
    secuencia: [buscarClaves(titulo), ...autores.split(' | ').filter(Boolean).map(buscarClaves), ...lineasPlanas.map(buscarClaves)]
  };
  BUSCAR_INDICE.set(c, ix);
  return ix;
}

function buscarConsulta(texto) {
  const plano = buscarPlano(texto);
  const todas = plano ? plano.split(' ') : [];
  const utiles = todas.filter(w => !BUSCAR_COMUNES.has(w));
  const palabras = (utiles.length ? utiles : todas).map(buscarClave);
  return { plano, palabras, memo: palabras.map(() => new Map()) };
}

function buscarMejor(q, i, conjunto) {
  let mejor = 0;
  const memo = q.memo[i];
  for (const w of conjunto) {
    let v = memo.get(w);
    if (v === undefined) { v = buscarCalidad(q.palabras[i], w, i === q.palabras.length - 1); memo.set(w, v); }
    if (v > mejor && (mejor = v) === 3) break;
  }
  return mejor;
}

// Puntaje de una canción (0 = no coincide). Un fragmento tal cual vale más que palabras sueltas parecidas.
function buscarPuntaje(q, c) {
  if (!q.plano) return 1;
  const ix = buscarIndice(c);
  let p = 0;
  if (ix.titulo.includes(q.plano)) p = ix.titulo.startsWith(q.plano) ? 100 : 85;
  else if (ix.etiquetas.includes(q.plano)) p = 70;
  else if (ix.autores.includes(q.plano)) p = 60;
  else {
    const l = ix.lineasPlanas.find(x => x.includes(q.plano));
    if (l !== undefined) p = l.startsWith(q.plano) ? 65 : 55;
  }
  if (p) return p;
  if (!q.palabras.length) return 0;
  // En una frase de 4 o más palabras se perdona una de cada cuatro que no aparezca (muy mal escrita o
  // cambiada), siempre que las demás estén juntas en el título o en una misma línea
  let total = 0, perdonables = Math.floor(q.palabras.length / 4);
  const halladas = [];
  for (let i = 0; i < q.palabras.length; i++) {
    const v = Math.max(buscarMejor(q, i, ix.pTitulo) * 3, buscarMejor(q, i, ix.pEtiquetas) * 2, buscarMejor(q, i, ix.pAutores) * 2, buscarMejor(q, i, ix.pLetra));
    if (v) halladas.push(i);
    else if (--perdonables < 0) return 0;
    total += v;
  }
  // Todas las palabras en el título o en una misma línea de la letra valen más que repartidas
  const juntas = halladas.length > 1 && ix.secuencia.some(s => halladas.every(i => buscarMejor(q, i, s) > 0));
  if (halladas.length < q.palabras.length && !juntas) return 0;
  return Math.round(total / q.palabras.length * 5) + (juntas ? 16 : 0);
}

const puntajeCancion = (consulta, c) => buscarPuntaje(buscarConsulta(consulta), c);

// Las canciones que coinciden, de la más parecida a la menos (las de igual puntaje, en su orden)
function buscarCanciones(lista, consulta) {
  const q = buscarConsulta(consulta);
  if (!q.plano) return lista.slice();
  return lista.map((c, i) => ({ c, i, p: buscarPuntaje(q, c) })).filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i).map(x => x.c);
}

// ¿Aparece la frase (palabras seguidas, con faltas comunes) en el título o en la letra?
function fraseEnCancion(c, frase) {
  const f = buscarClaves(buscarPlano(frase));
  if (!f.length) return false;
  return buscarIndice(c).secuencia.some(s => {
    for (let i = 0; i + f.length <= s.length; i++) if (f.every((w, k) => s[i + k] === w)) return true;
    return false;
  });
}

const buscarEsc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Línea de la letra donde coincidió la búsqueda, en HTML con lo encontrado en <mark> ('' si fue por el título)
function fragmentoLetra(c, consulta) {
  const q = buscarConsulta(consulta);
  if (!q.plano) return '';
  const ix = buscarIndice(c);
  if (ix.titulo.includes(q.plano) || !ix.lineas.length) return '';
  const i = ix.lineasPlanas.findIndex(x => x.includes(q.plano));
  if (i >= 0) {
    const linea = ix.lineas[i], { out, mapa } = buscarPlanoConMapa(linea);
    const k = out.indexOf(q.plano), desde = mapa[k], hasta = mapa[k + q.plano.length - 1] + 1;
    return buscarEsc(linea.slice(0, desde)) + '<mark>' + buscarEsc(linea.slice(desde, hasta)) + '</mark>' + buscarEsc(linea.slice(hasta));
  }
  if (!q.palabras.length) return '';
  const marcar = w => {
    const k = buscarClave(buscarPlano(w));
    return !!k && q.palabras.some((p, j) => {
      let v = q.memo[j].get(k);
      if (v === undefined) v = buscarCalidad(p, k, j === q.palabras.length - 1);
      return v > 0;
    });
  };
  let mejor = -1, mejorN = 0;
  ix.lineas.forEach((l, j) => {
    const n = (l.match(/\S+/g) || []).filter(marcar).length;
    if (n > mejorN) { mejor = j; mejorN = n; }
  });
  if (mejor < 0) return '';
  return ix.lineas[mejor].split(/(\s+)/).map(t => /\S/.test(t) && marcar(t) ? '<mark>' + buscarEsc(t) + '</mark>' : buscarEsc(t)).join('');
}
