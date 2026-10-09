'use strict';
// Aspecto «YouTube Music» del editor: menú lateral (Inicio, Explorar, Biblioteca, Cancionero, Atril),
// estanterías con la música de la parroquia, la cola a la derecha (= el cancionero, cada canción es una
// pestaña) y la barra de reproducción abajo, con la carátula junto al botón ▶.
// Lo esencial no cambia: mientras suena una canción, el centro muestra su letra y sus acordes.

let ytmVista = 'cancionero';

// ============ ÍCONOS ============
const ICONOS = {
  inicio: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  explorar: 'M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z',
  biblioteca: 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5c0 1.38-1.12 2.5-2.5 2.5S10 13.88 10 12.5s1.12-2.5 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z',
  cola: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  atril: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  play: 'M8 5v14l11-7z',
  pausa: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  anterior: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  siguiente: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  buscar: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  agregar: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  volumen: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  iglesia: 'M18 12.22V9l-5-2.5V5h2V3h-2V1h-2v2H9v2h2v1.5L6 9v3.22L2 14v8h8v-3c0-1.1.9-2 2-2s2 .9 2 2v3h8v-8l-4-1.78zM12 13.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  guardar: 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z'
};
const icono = (n, clase = '') => `<svg class="ico ${clase}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONOS[n]}"/></svg>`;
function ytmIconos(root = document) {
  root.querySelectorAll('[data-ico]').forEach(e => {
    e.insertAdjacentHTML('afterbegin', icono(e.dataset.ico));
    e.removeAttribute('data-ico');
  });
}

// Colores litúrgicos (sobre fondo oscuro): el acento de la página es el del tiempo del próximo domingo
const COLOR_LITURGICO = { Verde: '#4caf50', Morado: '#9c6ade', Rojo: '#e5534b', Blanco: '#d9b44a', Rosa: '#ec8fb8' };

// ============ DATOS ============
let ytmBibPromesa = null;
let ytmBibLista = [];
function ytmBiblioteca() {
  ytmBibPromesa ||= mcLeerPublico({ accion: 'biblioteca' })
    .then(r => (ytmBibLista = r.canciones || []))
    .catch(e => { ytmBibPromesa = null; throw e; });
  return ytmBibPromesa;
}
const ytmBibPorId = id => ytmBibLista.find(c => c.id === id);

let ytmLitPromesa = null;
const ytmLiturgia = () => (ytmLitPromesa ||= import(new URL('../js/liturgia.js', document.baseURI).href));

let ytmMisasPromesa = null;
const ytmMisas = () => (ytmMisasPromesa ||= mcLeerPublico({ accion: 'misas' }).then(r => r.misas || [])
  .catch(e => { ytmMisasPromesa = null; throw e; }));

const tonoCorto = t => {
  const m = /^([A-Z]{2,3})([#b]?)(m?)$/.exec(t || '');
  return m ? m[1][0] + m[1].slice(1).toLowerCase() + m[2] + m[3] : t || '';
};
const infoBib = c => ({ titulo: c.titulo, etiquetas: c.etiquetas, audios: c.audios });
const subBib = (c, extra = '') => [extra, c.tono && 'Tono ' + tonoCorto(c.tono), (c.etiquetas || []).filter(t => t !== extra).slice(0, 2).join(', ')]
  .filter(Boolean).join(' · ');
const ytmHash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return h >>> 0; };
const ytmCargando = texto => `<div class="ytm-cargando"><span class="install-spin"></span>${escapeHtml(texto)}</div>`;
const ytmError = e => `<div class="ytm-cargando">No se pudo cargar: ${escapeHtml(e.message || String(e))}
  <button type="button" class="chip" data-reintentar>Reintentar</button></div>`;

// ============ CEJILLA (la del primer instrumento de la canción) ============
function capoPrincipal(d = cur()) {
  if (!d) return 0;
  const id = songInstruments(d)[0].id;
  return d.capos?.[id] || 0;
}

function cambiarCapo(paso) {
  const d = cur();
  const inst = songInstruments(d)[0];
  if (instrumentKind(findInstrument(inst.id)) !== 'trastes') { toast('El instrumento de esta canción no usa cejilla'); return; }
  const n = Math.max(0, Math.min(11, capoPrincipal(d) + paso));
  d.capos ||= {};
  if (n) d.capos[inst.id] = n; else delete d.capos[inst.id];
  if (!d.instruments?.length) d.instruments = [{ ...inst }];
  refresh();
  toast(n ? `Cejilla en el traste ${n}` : 'Sin cejilla', 1200);
}

function cambiarVelocidad(paso) {
  const a = currentAudio();
  if (!a) { toast('Esta canción no tiene audio'); return; }
  setSpeed((a.speed || 1) + paso * speedStep());
  refresh();
}

// «Sol mayor · Cejilla 3 (formas de Mi)»
function ytmTonoTexto(d, key) {
  const partes = [];
  if (key) {
    let t = 'Tono ' + keyLabel(key);
    const des = d.mc && d.mc.tonoOriginal != null ? signedSemis(key.idx - d.mc.tonoOriginal) : 0;
    if (des) t += ` (${des > 0 ? '+' : ''}${des} del original)`;
    partes.push(t);
  }
  const capo = capoPrincipal(d);
  if (capo) partes.push(`Cejilla ${capo}` + (key ? ` (formas de ${keyName(mod12(key.idx - capo), key.minor)})` : ''));
  return partes.join(' · ');
}

// ============ VISTAS ============
const YTM_VISTAS = ['inicio', 'explorar', 'biblioteca', 'cancionero'];

function ytmIrA(v, { buscar = null } = {}) {
  if (v === 'atril') { abrirAtrilDesdeMenu(); return; }
  if (!YTM_VISTAS.includes(v)) v = 'inicio';
  const antes = ytmVista;
  if (antes === 'cancionero' && v !== 'cancionero') { cur().scroll = window.scrollY; stopAutoscroll(); }
  ytmVista = v;
  for (const x of YTM_VISTAS) $('#vista-' + x).hidden = x !== v;
  document.body.dataset.vista = v;
  document.querySelectorAll('[data-vista]').forEach(b => b.classList.toggle('activo', b.dataset.vista === v));
  ytmCerrarCola();
  if (v === 'inicio') ytmPintarInicio();
  else if (v === 'explorar') ytmPintarExplorar();
  else if (v === 'biblioteca') ytmPintarBiblioteca(buscar);
  if (v === 'cancionero') {
    if (antes !== v) { refresh(); window.scrollTo(0, cur().scroll || 0); }
  } else if (antes !== v) window.scrollTo(0, 0);
}

// ============ TARJETAS Y ESTANTES ============
function ytmTarjeta(c, extra = '') {
  const id = escapeHtml(c.id);
  return `<div class="tarjeta" data-id="${id}">
    <div class="tarjeta-cara">${caraHtml(infoBib(c), 'grande')}
      <button type="button" class="tarjeta-play" data-bib="escuchar" data-id="${id}" title="Escuchar y ver la letra">${icono('play')}</button>
      <button type="button" class="tarjeta-mas" data-bib="agregar" data-id="${id}" title="Agregar al cancionero">${icono('agregar')}</button>
    </div>
    <button type="button" class="tarjeta-titulo" data-bib="escuchar" data-id="${id}" title="${escapeHtml(c.titulo)}">${escapeHtml(c.titulo)}</button>
    <div class="tarjeta-sub">${escapeHtml(subBib(c, extra))}</div>
  </div>`;
}

function ytmTarjetaMisa(m, lit) {
  const tiempo = m.tiempoLiturgico || lit.tiempoPorFecha(m.fechaUso);
  const color = COLOR_LITURGICO[lit.colorPorTiempo(tiempo)] || '#455a64';
  const n = m.momentos.reduce((s, x) => s + x.canciones.length, 0);
  const id = escapeHtml(m.id);
  return `<div class="tarjeta tarjeta-misa">
    <div class="tarjeta-cara"><span class="cara grande cara-misa" style="--cara:${color}">${icono('iglesia')}<small>${escapeHtml(tiempo)}</small></span>
      <button type="button" class="tarjeta-play" data-misa-abrir="${id}" title="Abrir en el cancionero">${icono('play')}</button></div>
    <button type="button" class="tarjeta-titulo" data-misa-abrir="${id}">${escapeHtml(m.nombre || 'Cancionero de misa')}</button>
    <div class="tarjeta-sub">${escapeHtml([m.comunidadNombre, m.fechaUso ? lit.fechaLarga(m.fechaUso) : '', `${n} ${n === 1 ? 'canción' : 'canciones'}`].filter(Boolean).join(' · '))}</div>
  </div>`;
}

function ytmTarjetaNube(c) {
  return `<div class="tarjeta tarjeta-misa">
    <div class="tarjeta-cara"><span class="cara grande cara-misa" style="--cara:${caraColor([c.comentario || ''], c.titulo)}">${icono('cola')}<small>${escapeHtml(c.comunidadNombre || '')}</small></span>
      <button type="button" class="tarjeta-play" data-nube="${escapeHtml(c.folderId)}" title="Abrir en el cancionero">${icono('play')}</button></div>
    <button type="button" class="tarjeta-titulo" data-nube="${escapeHtml(c.folderId)}">${escapeHtml(c.titulo || 'Cancionero')}</button>
    <div class="tarjeta-sub">${escapeHtml([c.fecha, `${c.canciones || 0} canciones`].filter(Boolean).join(' · '))}</div>
  </div>`;
}

function ytmEstante(titulo, tarjetas, { sobre = '', explorar = '' } = {}) {
  if (!tarjetas.length) return '';
  return `<section class="estante">
    <div class="estante-cabeza"><div>${sobre ? `<small>${escapeHtml(sobre)}</small>` : ''}<h2>${escapeHtml(titulo)}</h2></div>
      <span class="estante-acciones">${explorar ? `<button type="button" class="chip" data-explorar="${escapeHtml(explorar)}">Ver todo</button>` : ''}
        <button type="button" class="redondo" data-desliza="-1" aria-label="Anteriores">‹</button>
        <button type="button" class="redondo" data-desliza="1" aria-label="Siguientes">›</button></span></div>
    <div class="estante-fila">${tarjetas.join('')}</div>
  </section>`;
}

// ============ INICIO ============
const MOMENTOS_INICIO = ['Entrada', 'Acto penitencial', 'Gloria', 'Salmo responsorial', 'Aleluya', 'Ofertorio', 'Santo',
  'Cordero de Dios', 'Comunión', 'Acción de gracias', 'Salida'];
let ytmInicioListo = false;

async function ytmPintarInicio() {
  const box = $('#vista-inicio');
  if (ytmInicioListo) return;
  box.innerHTML = ytmCargando('Cargando la música de la parroquia…');
  try {
    const [lista, lit] = await Promise.all([ytmBiblioteca(), ytmLiturgia()]);
    const [misas, nubes] = await Promise.all([ytmMisas().catch(() => []), mcListar().catch(() => [])]);
    const domingo = lit.proximoDomingo();
    const tiempo = lit.tiempoPorFecha(domingo);
    const colorNombre = lit.colorPorTiempo(tiempo);
    const acento = COLOR_LITURGICO[colorNombre] || COLOR_LITURGICO.Verde;
    document.documentElement.style.setProperty('--acento', acento);
    const tTiempo = tagNorm(tiempo);
    const puntos = c => ((c.etiquetas || []).some(t => tagNorm(t) === tTiempo) ? 4 : 0) + ((c.audios || []).length ? 2 : 0);
    const orden = (a, b) => puntos(b) - puntos(a) || ytmHash(domingo + a.id) - ytmHash(domingo + b.id);

    // Cantos sugeridos para el domingo, como los de la pantalla Misas
    const borrador = { id: 'inicio', comunidad: '', fechaUso: domingo, tiempoLiturgico: tiempo, momentos: lit.momentosDeMisa(domingo).momentos };
    lit.sugerirCantos(borrador, null, { biblioteca: lista, misas });
    const sugeridos = borrador.momentos.flatMap(m => m.canciones.map(c => [ytmBibPorId(c.cancionId), m.momento])).filter(([c]) => c);

    const proximas = misas.filter(m => (m.fechaUso || '') >= lit.hoyIso()).sort((a, b) => a.fechaUso.localeCompare(b.fechaUso));
    const pasadas = misas.filter(m => !proximas.includes(m)).sort((a, b) => String(b.fechaUso || '').localeCompare(String(a.fechaUso || '')));
    const delDomingo = misas.find(m => m.fechaUso === domingo);

    // «Recién agregadas»: solo las que cambiaron después de la carga inicial de la Biblioteca
    const veces = new Map();
    lista.forEach(c => veces.set(c.actualizado, (veces.get(c.actualizado) || 0) + 1));
    const masComun = [...veces].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const nuevas = lista.filter(c => c.actualizado > masComun).sort((a, b) => b.actualizado.localeCompare(a.actualizado)).slice(0, 20);

    const marianos = lista.filter(c => (c.etiquetas || []).some(t => /marian/i.test(t)) || lit.esDelMomento(c, 'Canto a María')).sort(orden);
    const delTiempo = lista.filter(c => (c.etiquetas || []).some(t => tagNorm(t) === tTiempo)).sort(orden);

    let html = `<section class="ytm-hero">
      <div class="hero-color" style="--acento:${acento}"></div>
      <div class="hero-contenido">
        <small>Próximo domingo · ${escapeHtml(lit.fechaLarga(domingo))}</small>
        <h1>${escapeHtml(lit.nombreDelDia(domingo) || tiempo)}</h1>
        <p><span class="punto-color" style="background:${acento}"></span>${escapeHtml(tiempo)} · color ${escapeHtml(colorNombre.toLowerCase())}</p>
        <div class="hero-botones">
          ${delDomingo ? `<button type="button" class="btn-acento" data-misa-abrir="${escapeHtml(delDomingo.id)}">${icono('play')} Abrir «${escapeHtml(delDomingo.nombre)}»</button>` : ''}
          <a class="btn-borde" href="../misas.html">${icono('iglesia')} Armar el cancionero en Misas</a>
        </div>
      </div>
    </section>
    <div class="chips">${MOMENTOS_INICIO.map(m => `<button type="button" class="chip" data-explorar="momento|${escapeHtml(m)}">${escapeHtml(m)}</button>`).join('')}
      <button type="button" class="chip" data-explorar="etiqueta|Marianos">Marianos</button></div>`;
    html += ytmEstante('Sugeridos para el domingo', sugeridos.map(([c, m]) => ytmTarjeta(c, m)), { sobre: 'Un canto para cada momento' });
    html += ytmEstante('Cancioneros de misa', [...proximas, ...pasadas].slice(0, 16).map(m => ytmTarjetaMisa(m, lit)),
      { sobre: proximas.length ? 'Los próximos y los últimos' : 'Los últimos' });
    if (tiempo) html += ytmEstante(`Para ${/^tiempo/i.test(tiempo) ? 'el ' + tiempo.toLowerCase() : tiempo}`, delTiempo.slice(0, 24).map(c => ytmTarjeta(c)),
      { sobre: 'Tiempo litúrgico', explorar: 'etiqueta|' + tiempo });
    for (const m of MOMENTOS_INICIO) {
      const canciones = lista.filter(c => lit.esDelMomento(c, m)).sort(orden);
      html += ytmEstante(m, canciones.slice(0, 24).map(c => ytmTarjeta(c)), { sobre: 'Momentos de la misa', explorar: 'momento|' + m });
    }
    html += ytmEstante('Marianos', marianos.slice(0, 24).map(c => ytmTarjeta(c)), { sobre: 'Virgen María', explorar: 'etiqueta|Marianos' });
    html += ytmEstante('Recién agregadas', nuevas.map(c => ytmTarjeta(c)), { sobre: 'Biblioteca' });
    html += ytmEstante('Cancioneros guardados en la nube', nubes.slice(0, 16).map(ytmTarjetaNube), { sobre: 'De las comunidades' });
    box.innerHTML = html;
    ytmInicioListo = true;
  } catch (e) {
    box.innerHTML = ytmError(e);
  }
}

// ============ EXPLORAR ============
let ytmFiltro = '';
let ytmExplorarMax = 60;

async function ytmPintarExplorar() {
  const box = $('#vista-explorar');
  if (!box.dataset.listo) box.innerHTML = ytmCargando('Cargando la Biblioteca…');
  try {
    const [lista, lit] = await Promise.all([ytmBiblioteca(), ytmLiturgia()]);
    const cuenta = f => lista.filter(f).length;
    const conTag = t => c => (c.etiquetas || []).some(x => tagNorm(x) === tagNorm(t));
    const momentos = lit.MOMENTOS_MISA.map(m => [m, cuenta(c => lit.esDelMomento(c, m))]).filter(x => x[1]);
    const tiempos = lit.TIEMPOS.map(t => [t, cuenta(conTag(t))]).filter(x => x[1]);
    const comunidades = Object.entries(MC_COMUNIDADES).map(([slug, n]) => [slug, n, cuenta(c => c.comunidad === slug)]).filter(x => x[2]);
    const yaEstan = new Set([...lit.MOMENTOS_MISA, ...lit.TIEMPOS, ...lit.SINONIMOS.flat()].map(tagNorm));
    const otras = new Map();
    lista.forEach(c => (c.etiquetas || []).forEach(t => { if (!yaEstan.has(tagNorm(t))) otras.set(t, (otras.get(t) || 0) + 1); }));
    const masEtiquetas = [...otras].filter(x => x[1] >= 3).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const chip = (valor, texto, n) => `<button type="button" class="chip${ytmFiltro === valor ? ' activo' : ''}" data-filtro="${escapeHtml(valor)}">${escapeHtml(texto)} <small>${n}</small></button>`;
    const grupo = (titulo, chips) => chips.length ? `<div class="grupo-chips"><h3>${escapeHtml(titulo)}</h3><div class="chips">${chips.join('')}</div></div>` : '';

    let html = '<h1 class="vista-titulo">Explorar</h1>';
    html += grupo('Momentos de la misa', momentos.map(([m, n]) => chip('momento|' + m, m, n)));
    html += grupo('Tiempos litúrgicos', tiempos.map(([t, n]) => chip('etiqueta|' + t, t, n)));
    html += grupo('Comunidades', comunidades.map(([slug, nombre, n]) => chip('comunidad|' + slug, nombre, n)));
    html += grupo('Más etiquetas', masEtiquetas.map(([t, n]) => chip('etiqueta|' + t, t, n)));
    if (ytmFiltro) {
      const [tipo, valor] = ytmFiltro.split('|');
      const f = tipo === 'momento' ? c => lit.esDelMomento(c, valor)
        : tipo === 'comunidad' ? c => c.comunidad === valor
          : valor === 'Marianos' ? c => (c.etiquetas || []).some(t => /marian/i.test(t)) || lit.esDelMomento(c, 'Canto a María')
            : conTag(valor);
      const halladas = lista.filter(f).sort((a, b) => ((b.audios || []).length ? 1 : 0) - ((a.audios || []).length ? 1 : 0) || a.titulo.localeCompare(b.titulo));
      const nombre = tipo === 'comunidad' ? MC_COMUNIDADES[valor] || valor : valor;
      html += `<section class="explorar-resultado" id="explorarResultado"><h2>${escapeHtml(nombre)} <small>${halladas.length} canciones</small></h2>
        <div class="grilla">${halladas.slice(0, ytmExplorarMax).map(c => ytmTarjeta(c)).join('')}</div>
        ${halladas.length > ytmExplorarMax ? '<button type="button" class="chip ver-mas" data-explorar-mas>Ver más</button>' : ''}</section>`;
    }
    box.innerHTML = html;
    box.dataset.listo = '1';
  } catch (e) {
    box.innerHTML = ytmError(e);
  }
}

function ytmExplorar(filtro) {
  ytmFiltro = filtro;
  ytmExplorarMax = 60;
  if (ytmVista !== 'explorar') ytmIrA('explorar'); else ytmPintarExplorar();
  setTimeout(() => $('#explorarResultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}

// ============ BIBLIOTECA ============
let ytmBibMax = 80;

async function ytmPintarBiblioteca(buscar) {
  const box = $('#vista-biblioteca');
  if (!box.dataset.listo) {
    box.innerHTML = `<div class="bib-cabeza">
        <h1 class="vista-titulo">Biblioteca de la parroquia</h1>
        <div class="bib-filtros">
          <label class="bib-buscar">${icono('buscar')}<input type="search" id="bibBuscar" autocomplete="off"
            placeholder="Título, etiqueta o una frase de la letra" title="No importan mayúsculas, tildes ni faltas de ortografía"></label>
          <select id="bibComunidad" aria-label="Comunidad"><option value="">Todas las comunidades</option>${Object.entries(MC_COMUNIDADES)
            .map(([slug, n]) => `<option value="${slug}">${escapeHtml(n)}</option>`).join('')}</select>
          <label class="bib-check"><input type="checkbox" id="bibConAudio"> Solo con audio</label>
        </div>
        <small id="bibCuenta"></small>
      </div>
      <div class="bib-lista" id="bibLista">${ytmCargando('Cargando la Biblioteca…')}</div>`;
    box.dataset.listo = '1';
    let reloj = 0;
    const filtrar = () => { clearTimeout(reloj); reloj = setTimeout(() => { ytmBibMax = 80; ytmListarBiblioteca(); }, 120); };
    $('#bibBuscar').addEventListener('input', () => { $('#buscarTop').value = $('#bibBuscar').value; filtrar(); });
    $('#bibComunidad').addEventListener('change', filtrar);
    $('#bibConAudio').addEventListener('change', filtrar);
  }
  if (buscar != null) $('#bibBuscar').value = buscar;
  await ytmListarBiblioteca();
}

async function ytmListarBiblioteca() {
  const ul = $('#bibLista');
  let lista;
  try { lista = await ytmBiblioteca(); } catch (e) { ul.innerHTML = ytmError(e); return; }
  const q = $('#bibBuscar').value;
  const com = $('#bibComunidad').value, conAudio = $('#bibConAudio').checked;
  let halladas = lista.filter(c => (!com || c.comunidad === com) && (!conAudio || (c.audios || []).length));
  halladas = q.trim() ? buscarCanciones(halladas, q) : halladas.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  $('#bibCuenta').textContent = `${halladas.length} de ${lista.length} canciones`;
  const enCola = new Set(docs.map(d => d.bibId || d.mc?.cancionId).filter(Boolean));
  ul.innerHTML = halladas.slice(0, ytmBibMax).map(c => {
    const id = escapeHtml(c.id);
    const n = (c.audios || []).length;
    const frase = q.trim() ? fragmentoLetra(c, q) : '';
    return `<div class="fila" data-id="${id}">
      <button type="button" class="fila-cara" data-bib="escuchar" data-id="${id}" title="Escuchar y ver la letra">${caraHtml(infoBib(c), 'chica')}<span class="fila-play">${icono('play')}</span></button>
      <div class="fila-texto"><button type="button" class="fila-titulo" data-bib="escuchar" data-id="${id}">${escapeHtml(c.titulo)}</button>
        <small>${escapeHtml(subBib(c))}</small>${frase ? `<small class="mc-letra">${frase}</small>` : ''}</div>
      <span class="fila-dato">${n ? `♪ ${n}` : ''}</span>
      <span class="fila-dato">${escapeHtml(MC_COMUNIDADES[c.comunidad] || '')}</span>
      <button type="button" class="redondo${enCola.has(c.id) ? ' hecho' : ''}" data-bib="agregar" data-id="${id}" title="${enCola.has(c.id) ? 'Ya está en el cancionero' : 'Agregar al cancionero'}">${enCola.has(c.id) ? '✓' : icono('agregar')}</button>
    </div>`;
  }).join('') + (halladas.length > ytmBibMax ? '<button type="button" class="chip ver-mas" data-bib-mas>Ver más</button>' : '')
    || '<p class="ytm-cargando">No hay canciones que coincidan.</p>';
}

// ============ ESCUCHAR Y AGREGAR ============
let ytmAntesDePrevia = null;

async function ytmEscuchar(id, tocar = true) {
  const enCola = docs.find(d => d.bibId === id || d.mc?.cancionId === id);
  try {
    if (enCola) {
      previa = null;
      switchTab(enCola.id);
    } else if (previa?.bibId === id) {
      if (activeId !== previa.id) { leaveCurrent(); activate(previa.id); }
    } else {
      toast('Abriendo la canción…', 30000);
      const d = await mcDocDeBiblioteca(id);
      toast('');
      if (!previa || activeId !== previa.id) ytmAntesDePrevia = activeId;
      leaveCurrent();
      previa = d;
      activate(d.id);
    }
  } catch (e) {
    mcError('No se pudo abrir la canción', e);
    return;
  }
  setMode('atril');
  ytmIrA('cancionero');
  if (tocar) ytmTocar();
}

async function ytmAgregar(id) {
  if (docs.some(d => d.bibId === id || d.mc?.cancionId === id)) { toast('Ya está en el cancionero'); return; }
  syncFromEditor();
  let d;
  if (previa?.bibId === id) {
    d = previa;
    previa = null;
  } else {
    try {
      toast('Agregando…', 30000);
      d = await mcDocDeBiblioteca(id);
    } catch (e) { mcError('No se pudo agregar la canción', e); return; }
  }
  const activaBlanca = cur() !== d && isBlank(cur());
  docs = docs.filter(x => !isBlank(x));
  docs.push(d);
  if (activaBlanca || (activeId !== d.id && !docs.some(x => x.id === activeId))) activate(d.id);
  else refresh();
  scheduleSave();
  toast(`«${d.title}» agregada al cancionero (${docs.length})`, 2500);
  if (ytmVista === 'biblioteca') ytmListarBiblioteca();
}

function ytmCerrarPrevia() {
  if (!previa) return;
  const volver = docs.find(d => d.id === ytmAntesDePrevia) || docs[0];
  leaveCurrent();
  previa = null;
  activate(volver.id);
}

async function ytmElegirMisa() {
  if (!mcConfigurado()) return;
  toast('Buscando los cancioneros de misa…', 30000);
  let misas;
  try { misas = await ytmMisas(); } catch (e) { mcError('No se pudieron leer los cancioneros de misa', e); return; }
  toast('');
  if (!misas.length) { showModal({ title: 'Cancioneros de misa', body: '<p>Todavía no hay cancioneros de misa guardados.</p>' }); return; }
  let elegida = null;
  await showModal({
    title: 'Abrir un cancionero de misa',
    wide: true,
    body: `<ul class="mc-lista">${misas.map(m => `<li><span>${escapeHtml(m.nombre || 'Cancionero')}
        <small>${escapeHtml([m.comunidadNombre, m.fechaUso, m.tiempoLiturgico].filter(Boolean).join(' · '))}</small></span>
        <button type="button" class="btn primary" data-id="${escapeHtml(m.id)}">Abrir</button></li>`).join('')}</ul>`,
    onOpen: d => d.querySelectorAll('[data-id]').forEach(b => { b.onclick = () => { elegida = b.dataset.id; d.close(); }; }),
    buttons: [{ label: 'Cancelar' }]
  });
  if (elegida) mcAbrirMisa(elegida, null, { misa: misas.find(m => m.id === elegida) });
}

async function abrirAtrilDesdeMenu() {
  if (await mcAtrilActivo()) return;
  abrirAtril();
}

// ============ COLA (el cancionero) ============
const anchoCola = matchMedia('(min-width: 1281px)');

function ytmAlternarCola() {
  if (anchoCola.matches) {
    const oculta = document.body.classList.toggle('cola-oculta');
    localStorage.setItem('mc-cola-oculta', oculta ? '1' : '0');
  } else document.body.classList.toggle('cola-abierta');
}
const ytmCerrarCola = () => document.body.classList.remove('cola-abierta');

let colaCaraFirma = '';
function ytmPintarCola() {
  const m = state.mcMisa;
  const nombre = state.cancioneroName || 'Cancionero nuevo';
  const firma = nombre + '|' + (m?.tiempoLiturgico || '');
  if (firma !== colaCaraFirma) {
    colaCaraFirma = firma;
    $('#colaCara').innerHTML = m
      ? `<span class="cara media cara-misa" style="--cara:${caraColor([m.tiempoLiturgico || ''], nombre)}">${icono('iglesia')}</span>`
      : caraHtml({ titulo: nombre, etiquetas: [] }, 'media');
  }
  $('#colaSub').textContent = colaResumen();
  const cambios = mcCambiosMisa().length;
  for (const b of document.querySelectorAll('.btn-guardar-misa')) {
    b.hidden = !m;
    b.disabled = !cambios;
    b.title = cambios ? `Guardar el tono, la cejilla y las velocidades de ${cambios === 1 ? 'una canción' : cambios + ' canciones'} en la misa (Ctrl+S)`
      : 'No hay cambios para guardar en la misa';
  }
  $('#heroGuardarMisa').hidden = !m || !cambios;
}

// ============ CABECERA DE LA CANCIÓN ============
let heroFirma = '';
function ytmPintarCabecera() {
  const d = cur();
  const a = currentAudio(d);
  const firma = d.id + '|' + d.title + '|' + (d.audios[0]?.src || '') + '|' + (d.caraEmbebida || '');
  if (firma !== heroFirma) {
    heroFirma = firma;
    $('#heroCara').innerHTML = caraHtml(caraInfoDoc(d), 'hero');
  }
  $('#heroSobre').textContent = [d.mc?.momento, d === previa ? 'Biblioteca de la parroquia' : state.cancioneroName || 'Cancionero nuevo'].filter(Boolean).join(' · ');
  $('#heroInfo').textContent = ytmTonoTexto(d, detectedKey);
  $('#heroCapo').textContent = capoPrincipal(d) || '0';
  $('#heroVel').textContent = a ? speedText(a.speed || 1) : '—';
  document.querySelectorAll('[data-action="velMenos"], [data-action="velMas"]').forEach(b => { b.disabled = !a; });
  $('#previaBanner').hidden = d !== previa;
}

// ============ BARRA DE REPRODUCCIÓN ============
const player = $('#audioPlayer');
const enModoYt = () => $('#audioBar').classList.contains('yt-mode');
const enModoPagina = () => $('#audioBar').classList.contains('page-mode');

function ytmSonando() {
  if (enModoYt()) return ytPlaying();
  return !player.paused && !!player.dataset.src;
}

// Reproduce la canción activa (después de cambiar de canción)
function ytmTocar() {
  const a = currentAudio();
  if (!a) return;
  if (enModoYt()) { if (!ytPlaying()) ytToggle(a); } else if (!enModoPagina()) player.play().catch(() => {});
}

function ytmPlayPausa() {
  const a = currentAudio();
  if (!a) { toast('Esta canción no tiene audio. Se le agrega en Herramientas → Vincular con audio o video.', 4000); return; }
  const empieza = !ytmSonando();
  if (enModoYt()) ytToggle(a);
  else if (enModoPagina()) $('#pageBtn').click();
  else if (player.paused) player.play().catch(() => toast('No se pudo reproducir el audio', 3000));
  else player.pause();
  // Lo esencial: lo que suena se ve con su letra y sus acordes
  if (empieza && ytmVista !== 'cancionero' && !atril.abierto) ytmIrA('cancionero');
}

// La canción vecina del cancionero (conAudio: salta las que no tienen audio)
function ytmVecina(paso, conAudio = false) {
  const lista = docs.filter(d => !isBlank(d));
  const i = lista.indexOf(cur());
  if (i < 0) return paso > 0 ? lista.find(d => !conAudio || d.audios.length) || null : null;
  for (let k = i + paso; k >= 0 && k < lista.length; k += paso) if (!conAudio || lista[k].audios.length) return lista[k];
  return null;
}

function ytmSaltar(paso, { tocar = ytmSonando(), auto = false } = {}) {
  if (paso < 0 && !enModoYt() && player.currentTime > 3) { player.currentTime = 0; return; }
  const d = ytmVecina(paso, auto);
  if (!d) {
    if (!auto) toast(paso > 0 ? 'Es la última canción del cancionero' : 'Es la primera canción del cancionero', 1800);
    return;
  }
  stopAutoscroll();
  if (cur() === previa) previa = null;
  switchTab(d.id);
  if (tocar) ytmTocar();
}

const fmtTiempo = s => {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function ytmTiempo() {
  let t = 0, dur = 0;
  if (enModoYt()) {
    if (yt.player?.getCurrentTime) { t = yt.player.getCurrentTime() || 0; dur = yt.player.getDuration?.() || 0; }
  } else {
    t = player.currentTime || 0;
    dur = isFinite(player.duration) ? player.duration : 0;
  }
  const barra = $('#repProgreso');
  if (!barra.matches(':active')) barra.value = dur ? Math.round(t / dur * 1000) : 0;
  barra.style.setProperty('--pos', (dur ? t / dur * 100 : 0) + '%');
  $('#repTiempo').textContent = dur ? `${fmtTiempo(t)} / ${fmtTiempo(dur)}` : '';
}

let ytReloj = 0;
function ytmPintarPlay() {
  const s = ytmSonando();
  const ico = icono(s ? 'pausa' : 'play');
  for (const b of [$('#repPlay'), $('#atrilPlay')]) {
    if (b.dataset.estado !== String(s)) { b.dataset.estado = String(s); b.innerHTML = ico; }
    b.title = s ? 'Pausa (k)' : 'Reproducir (k)';
  }
  document.body.classList.toggle('sonando', s);
  clearInterval(ytReloj);
  if (s && enModoYt()) ytReloj = setInterval(ytmTiempo, 500);
  const t = document.querySelector('#tabs .tab.active');
  if (t) t.classList.toggle('sonando', s);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s ? 'playing' : 'paused';
}

let repFirma = '';
function ytmPintarReproductor() {
  const d = cur();
  const a = currentAudio(d);
  $('#repTitulo').textContent = d.title.trim() || (isBlank(d) ? 'Canción nueva' : 'Sin título');
  $('#repSub').textContent = [d.mc?.momento || (d === previa ? 'Biblioteca' : state.cancioneroName), a ? '' : 'sin audio']
    .filter(Boolean).join(' · ');
  $('#audioBar').classList.toggle('sin-audio', !a);
  const firma = d.id + '|' + (a?.id || '') + '|' + (d.caraEmbebida || '');
  if (firma !== repFirma) {
    repFirma = firma;
    $('#repCara').innerHTML = caraHtml(caraInfoDoc(d));
    ytmTiempo();
    if (a && !d.caraEmbebida) {
      caraDelAudio(audioPlayableSrc(a)).then(url => {
        if (!url || d.caraEmbebida) return;
        d.caraEmbebida = url;
        if (cur() === d) refresh();
      });
    }
    ytmSesionDeMedios(d);
  }
  ytmPintarPlay();
}

// Controles del sistema (pantalla bloqueada del celular, teclas multimedia)
function ytmSesionDeMedios(d) {
  if (!('mediaSession' in navigator)) return;
  try {
    const img = d.caraEmbebida || caraYoutube(d.audios);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: d.title || 'Canción', artist: d.mc?.momento || state.cancioneroName || 'Monte Carmelo', album: state.cancioneroName || '',
      artwork: img ? [{ src: img, sizes: '320x180' }] : []
    });
  } catch (_) {}
}
if ('mediaSession' in navigator) {
  const accion = (n, f) => { try { navigator.mediaSession.setActionHandler(n, f); } catch (_) {} };
  accion('play', () => { if (!ytmSonando()) ytmPlayPausa(); });
  accion('pause', () => { if (ytmSonando()) ytmPlayPausa(); });
  accion('previoustrack', () => ytmSaltar(-1, { tocar: true }));
  accion('nexttrack', () => ytmSaltar(1, { tocar: true }));
}

function ytmFinDePista() {
  ytmPintarPlay();
  // En la misa, el atril no pasa solo a la canción siguiente
  if (!atril.abierto) ytmSaltar(1, { tocar: true, auto: true });
}

// ============ REFRESCO (lo llama refresh() de app.js) ============
function ytmRefresh() {
  ytmPintarCabecera();
  ytmPintarReproductor();
  ytmPintarCola();
  atrilPintar();
}

// ============ INICIO ============
function ytmInit() {
  ytmIconos();
  document.body.classList.add('ytm');
  if (localStorage.getItem('mc-cola-oculta') === '1') document.body.classList.add('cola-oculta');

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-vista], [data-bib], [data-misa-abrir], [data-nube], [data-explorar], [data-filtro], [data-desliza], [data-reintentar], [data-bib-mas], [data-explorar-mas]');
    if (!t || t.closest('dialog')) return;
    if (t.dataset.vista) {
      e.preventDefault();
      // En pantallas sin lugar para la cola, «Cancionero» estando ahí muestra la lista de canciones
      if (t.dataset.vista === 'cancionero' && ytmVista === 'cancionero' && !anchoCola.matches && t.closest('.ytm-nav')) ytmAlternarCola();
      else ytmIrA(t.dataset.vista);
    }
    else if (t.dataset.bib === 'escuchar') ytmEscuchar(t.dataset.id);
    else if (t.dataset.bib === 'agregar') ytmAgregar(t.dataset.id);
    else if (t.dataset.misaAbrir) ytmMisas().then(l => mcAbrirMisa(t.dataset.misaAbrir, null, { misa: l.find(m => m.id === t.dataset.misaAbrir) }));
    else if (t.dataset.nube) driveOpenFolder(t.dataset.nube).then(() => ytmIrA('cancionero'));
    else if (t.dataset.explorar) ytmExplorar(t.dataset.explorar);
    else if (t.dataset.filtro) ytmExplorar(ytmFiltro === t.dataset.filtro ? '' : t.dataset.filtro);
    else if (t.dataset.desliza) {
      const fila = t.closest('.estante').querySelector('.estante-fila');
      fila.scrollBy({ left: +t.dataset.desliza * fila.clientWidth * 0.85, behavior: 'smooth' });
    } else if ('bibMas' in t.dataset) { ytmBibMax += 120; ytmListarBiblioteca(); }
    else if ('explorarMas' in t.dataset) { ytmExplorarMax += 120; ytmPintarExplorar(); }
    else if ('reintentar' in t.dataset) { ytmInicioListo = false; ytmIrA(ytmVista); }
  });

  // Buscar desde la barra de arriba lleva a la Biblioteca
  let reloj = 0;
  $('#buscarTop').addEventListener('input', () => {
    clearTimeout(reloj);
    reloj = setTimeout(() => {
      if (ytmVista !== 'biblioteca') ytmIrA('biblioteca', { buscar: $('#buscarTop').value });
      else { $('#bibBuscar').value = $('#buscarTop').value; ytmBibMax = 80; ytmListarBiblioteca(); }
      $('#buscarTop').focus();
    }, 150);
  });
  $('#buscarTop').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); } });
  $('#buscarAbrir').addEventListener('click', () => {
    document.body.classList.toggle('buscando');
    if (document.body.classList.contains('buscando')) $('#buscarTop').focus();
  });

  $('#navCorta').addEventListener('click', () => document.body.classList.toggle('nav-corta'));
  $('#colaCerrar').addEventListener('click', ytmAlternarCola);
  $('#repCola').addEventListener('click', ytmAlternarCola);
  $('#colaVelo').addEventListener('click', ytmCerrarCola);
  $('#previaAgregar').addEventListener('click', () => previa && ytmAgregar(previa.bibId));
  $('#previaCerrar').addEventListener('click', ytmCerrarPrevia);

  $('#repPlay').addEventListener('click', ytmPlayPausa);
  $('#repAnterior').addEventListener('click', () => ytmSaltar(-1));
  $('#repSiguiente').addEventListener('click', () => ytmSaltar(1));
  for (const id of ['#repCara', '#repTitulo']) $(id).addEventListener('click', () => { if (atril.abierto) return; ytmIrA('cancionero'); });
  $('#repProgreso').addEventListener('input', e => {
    const f = e.target.value / 1000;
    if (enModoYt()) { const dur = yt.player?.getDuration?.(); if (dur) yt.player.seekTo(f * dur, true); }
    else if (isFinite(player.duration)) player.currentTime = f * player.duration;
    ytmTiempo();
  });
  $('#repVolumen').addEventListener('input', e => {
    player.volume = +e.target.value;
    yt.player?.setVolume?.(Math.round(e.target.value * 100));
  });
  for (const ev of ['play', 'pause', 'playing', 'emptied']) player.addEventListener(ev, ytmPintarPlay);
  for (const ev of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) player.addEventListener(ev, ytmTiempo);
  player.addEventListener('ended', ytmFinDePista);
  document.addEventListener('mc-yt', e => {
    ytmPintarPlay();
    ytmTiempo();
    if (e.detail === 0) ytmFinDePista();
  });

  // k o la barra multimedia: reproducir o pausar (fuera de los campos de texto)
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('dialog') || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'k' || e.key === 'K') { e.preventDefault(); ytmPlayPausa(); }
  });
}
