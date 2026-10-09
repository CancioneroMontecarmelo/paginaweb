'use strict';
// Atril para la misa: pantalla completa en oscuro para no deslumbrar, con dos pestañas (Letra y acordes,
// Partituras). Solo se ajustan la velocidad del audio y la del desplazamiento, que vienen de la canción;
// el ▶ queda siempre a mano, pequeño. Se pasa de canción deslizando el dedo o con las flechas ← →.

const atril = { abierto: false, vista: 'letra', scrollOn: false, acc: 0, last: 0, wake: null, firma: '', hoja: 0, turno: 0, pantalla: false };

const atrilCuerpo = () => $('#atrilCuerpo');

// Partituras de la canción: las de la Biblioteca (servidor) y las hojas vinculadas en el editor
function partiturasDe(d) {
  const voz = v => (v && v !== 'todas' ? VOICES[v]?.label || v : '');
  return [
    ...(d.partituras || []).map(p => ({ web: p, nombre: 'Partitura' + (voz(p.voz) ? ' · ' + voz(p.voz) : '') })),
    ...(d.sheets || []).map(h => ({ hoja: h, nombre: h.name || (h.tipo === 'tablatura' ? 'Tablatura' : 'Partitura') }))
  ];
}

// ============ ABRIR Y CERRAR ============
function abrirAtril() {
  if (atril.abierto) { atrilPintar(); return; }
  stopAutoscroll();
  syncFromEditor();
  atril.abierto = true;
  atril.firma = '';
  atril.vista = 'letra';
  $('#atril').hidden = false;
  document.body.classList.add('atril-abierto');
  ytmCerrarCola();
  atrilPintar();
  atrilCuerpo().scrollTop = 0;
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().then(() => { atril.pantalla = true; }).catch(() => {});
  }
  atrilDespierto(true);
  // El botón «atrás» del celular cierra el atril en vez de salir del editor
  if (!history.state?.mcAtril) history.pushState({ mcAtril: true }, '');
  if (!localStorage.getItem('mc-pista-atril')) {
    localStorage.setItem('mc-pista-atril', '1');
    toast('Toca la letra para que avance sola · desliza el dedo (o ← →) para cambiar de canción', 5000);
  }
}

function cerrarAtril(desdeHistorial = false) {
  if (!atril.abierto) return;
  atrilParar();
  atril.abierto = false;
  atril.turno++;
  $('#atril').hidden = true;
  document.body.classList.remove('atril-abierto');
  $('#atrilLetra').innerHTML = $('#atrilHoja').innerHTML = '';
  if (atril.pantalla && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  atril.pantalla = false;
  atrilDespierto(false);
  if (!desdeHistorial && history.state?.mcAtril) history.back();
  ytmIrA('cancionero');
  refresh();
}

window.addEventListener('popstate', () => { if (atril.abierto) cerrarAtril(true); });

async function atrilDespierto(on) {
  try {
    if (on && !atril.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      atril.wake = await navigator.wakeLock.request('screen');
      atril.wake.addEventListener('release', () => { atril.wake = null; });
    } else if (!on && atril.wake) {
      await atril.wake.release();
      atril.wake = null;
    }
  } catch (_) {}
}
document.addEventListener('visibilitychange', () => { if (atril.abierto) atrilDespierto(true); });
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) atril.pantalla = false;
  $('#atrilPantalla').hidden = !!document.fullscreenElement;
});

// ============ PINTAR ============
function atrilPintar() {
  if (!atril.abierto) return;
  const d = cur();
  const key = detectedKey;
  const lista = docs.filter(x => !isBlank(x));
  const i = lista.indexOf(d);
  $('#atrilPos').textContent = i >= 0 && lista.length > 1 ? `${i + 1}/${lista.length}` : '';
  $('#atrilTitulo').textContent = d.title.trim() || 'Sin título';
  $('#atrilMomento').textContent = d.mc?.momento || '';
  const hojas = partiturasDe(d);
  const bPart = $('#atril [data-atril-vista="partituras"]');
  bPart.querySelector('small').textContent = hojas.length || '';
  bPart.classList.toggle('vacia', !hojas.length);
  document.querySelectorAll('#atril [data-atril-vista]').forEach(b => b.classList.toggle('activo', b.dataset.atrilVista === atril.vista));
  $('#atrilLetra').hidden = atril.vista !== 'letra';
  $('#atrilHojas').hidden = atril.vista !== 'partituras';
  atrilControles();

  const capo = capoPrincipal(d);
  const firma = [atril.vista, d.id, d.title, d.text, key?.idx, key?.minor, capo, state.notation, state.highlight, state.showComments,
    atril.vista === 'partituras' ? atril.hoja + '|' + hojas.length : ''].join('|');
  if (firma === atril.firma) return;
  const otraCancion = !atril.firma.startsWith(atril.vista + '|' + d.id + '|');
  atril.firma = firma;
  if (otraCancion) atril.hoja = 0;
  if (atril.vista === 'letra') atrilLetra(d, key, capo);
  else atrilHojas(d, hojas);
}

function atrilLetra(d, key, capo) {
  const box = $('#atrilLetra');
  box.innerHTML = renderSong(d.title, d.text, key);
  // En el atril no se editan créditos ni tags
  box.querySelectorAll('[data-action]').forEach(e => e.removeAttribute('data-action'));
  if (capo) {
    const meta = box.querySelector('.song-meta');
    const formas = key ? ` (formas de ${escapeHtml(keyName(mod12(key.idx - capo), key.minor))})` : '';
    if (meta) meta.insertAdjacentHTML('beforeend', `${meta.textContent.trim() ? ' · ' : ''}<strong class="atril-capo">Cejilla ${capo}${formas}</strong>`);
  }
  atrilAjustar();
}

// La letra se agranda hasta donde la línea más larga cabe en el ancho de la pantalla
function atrilAjustar() {
  const box = $('#atrilLetra');
  if (!atril.abierto || box.hidden || !box.clientWidth) return;
  charRatio ||= measureCharRatio();
  let largo = 0;
  for (const line of box.querySelectorAll('.line:not(.blank)')) largo = Math.max(largo, line.textContent.replace(/\s+$/, '').length);
  const ancho = box.clientWidth - 8;
  const max = Math.max(state.fontSize + 6, Math.round(state.fontSize * 1.6));
  const px = largo ? Math.min(max, Math.floor(ancho / (largo * charRatio) * 10) / 10) : max;
  box.style.setProperty('--song-font', Math.max(11, px) + 'px');
}
window.addEventListener('resize', () => { if (atril.abierto) atrilAjustar(); });

async function atrilHojas(d, hojas) {
  const lista = $('#atrilHojasLista'), host = $('#atrilHoja');
  const t = ++atril.turno;
  if (!hojas.length) {
    lista.innerHTML = '';
    host.innerHTML = `<p class="atril-vacio">«${escapeHtml(d.title.trim() || 'Esta canción')}» no tiene partituras.</p>`;
    return;
  }
  const n = Math.min(atril.hoja, hojas.length - 1);
  lista.innerHTML = hojas.length > 1
    ? hojas.map((x, k) => `<button type="button" class="chip${k === n ? ' activo' : ''}" data-atril-hoja="${k}">${escapeHtml(x.nombre)}</button>`).join('')
    : '';
  const x = hojas[n];
  host.innerHTML = '<div class="sheet-loading">Cargando la partitura…</div>';
  if (x.web) {
    try {
      const m = await import(new URL('../js/partituras.js', document.baseURI).href);
      if (t === atril.turno) await m.dibujarPartitura(x.web, host);
    } catch (e) {
      if (t === atril.turno) host.innerHTML = `<p class="atril-vacio">No se pudo mostrar la partitura: ${escapeHtml(e.message || String(e))}</p>`;
    }
  } else {
    await drawSheet(x.hoja, host, { semis: sheetSemis(x.hoja, detectedKey), view: x.hoja.tipo, stale: () => t !== atril.turno || !atril.abierto });
  }
}

function atrilControles() {
  const a = currentAudio();
  $('#atrilVel b').textContent = a ? speedText(a.speed || 1) : '—';
  $('#atrilVel').classList.toggle('apagado', !a);
  $('#atrilVel').querySelectorAll('button').forEach(b => { b.disabled = !a; });
  $('#atrilScroll b').textContent = scrollLevel();
  $('#atrilScroll').classList.toggle('on', atril.scrollOn);
  $('#atrilAvanza').textContent = atril.scrollOn ? '⏸' : '▼';
  $('#atrilAvanza').title = atril.scrollOn ? 'Detener el desplazamiento (barra espaciadora)' : 'Desplazar la letra sola (barra espaciadora o tocar la letra)';
  $('#atrilPlay').classList.toggle('sin-audio', !a);
  $('#atrilPantalla').hidden = !!document.fullscreenElement || !document.documentElement.requestFullscreen;
}

// ============ DESPLAZAMIENTO AUTOMÁTICO ============
function atrilPaso(ts) {
  if (!atril.scrollOn) return;
  const c = atrilCuerpo();
  if (atril.last) {
    atril.acc += (ts - atril.last) / 1000 * SCROLL_SPEEDS[scrollLevel() - 1];
    const px = Math.floor(atril.acc);
    if (px) { c.scrollTop += px; atril.acc -= px; }
  }
  atril.last = ts;
  if (c.scrollTop + c.clientHeight >= c.scrollHeight - 2) { atrilParar(); return; }
  requestAnimationFrame(atrilPaso);
}

function atrilAlternarScroll() {
  if (atril.scrollOn) { atrilParar(); return; }
  atril.scrollOn = true;
  atril.acc = atril.last = 0;
  atrilControles();
  requestAnimationFrame(atrilPaso);
}

function atrilParar() {
  if (!atril.scrollOn) return;
  atril.scrollOn = false;
  atrilControles();
}

function atrilVelocidadScroll(paso) {
  setScrollSpeed(scrollLevel() + paso);
  atrilControles();
  toast(`Desplazamiento: ${scrollLevel()} de ${SCROLL_SPEEDS.length}`, 1000);
}

// ============ CAMBIAR DE CANCIÓN ============
function atrilCancion(paso) {
  const d = ytmVecina(paso);
  if (!d) { toast(paso > 0 ? 'Es la última canción' : 'Es la primera canción', 1500); return; }
  atrilParar();
  if (cur() === previa) previa = null;
  switchTab(d.id);
  atrilCuerpo().scrollTop = 0;
  const lista = docs.filter(x => !isBlank(x));
  toast(`${lista.indexOf(d) + 1} de ${lista.length} · ${d.title.trim() || 'Sin título'}`, 1500);
}

// Pedal o teclado: abajo baja una pantalla y, al final de la canción, pasa a la siguiente
function atrilPagina(paso) {
  const c = atrilCuerpo();
  const alFinal = c.scrollTop + c.clientHeight >= c.scrollHeight - 4;
  if (paso > 0 && alFinal) { atrilCancion(1); return; }
  if (paso < 0 && c.scrollTop <= 0) return;
  c.scrollBy({ top: paso * c.clientHeight * 0.8, behavior: 'smooth' });
}

// ============ EVENTOS ============
function atrilInit() {
  $('#atrilCerrar').addEventListener('click', () => cerrarAtril());
  $('#atrilPantalla').addEventListener('click', () => {
    document.documentElement.requestFullscreen?.().then(() => { atril.pantalla = true; }).catch(() => toast('No se pudo activar la pantalla completa'));
  });
  $('#atrilPlay').addEventListener('click', ytmPlayPausa);
  $('#atrilAvanza').addEventListener('click', atrilAlternarScroll);
  $('#atrilVel').addEventListener('click', e => {
    const b = e.target.closest('button[data-paso]');
    if (b) cambiarVelocidad(+b.dataset.paso);
  });
  $('#atrilScroll').addEventListener('click', e => {
    const b = e.target.closest('button[data-paso]');
    if (b) atrilVelocidadScroll(+b.dataset.paso);
  });
  $('#atril').addEventListener('click', e => {
    const v = e.target.closest('[data-atril-vista]');
    if (v) {
      atrilParar();
      atril.vista = v.dataset.atrilVista;
      atrilPintar();
      atrilCuerpo().scrollTop = 0;
      return;
    }
    const h = e.target.closest('[data-atril-hoja]');
    if (h) { atril.hoja = +h.dataset.atrilHoja; atrilPintar(); }
  });

  // Tocar la letra: avanza sola o se detiene. Deslizar a los lados: otra canción
  let toque = null;
  const cuerpo = atrilCuerpo();
  cuerpo.addEventListener('touchstart', e => {
    toque = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
  }, { passive: true });
  cuerpo.addEventListener('touchend', e => {
    if (!toque) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - toque.x, dy = p.clientY - toque.y;
    const rapido = Date.now() - toque.t < 700;
    toque = null;
    if (rapido && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) atrilCancion(dx < 0 ? 1 : -1);
  }, { passive: true });
  cuerpo.addEventListener('click', e => {
    if (atril.vista !== 'letra' || e.target.closest('button, a, select, input') || String(window.getSelection()).trim()) return;
    atrilAlternarScroll();
  });
  // Mover la letra con el dedo o la rueda mientras avanza sola no la detiene: sigue desde ahí

  window.addEventListener('keydown', e => {
    if (!atril.abierto || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('dialog')) return;
    const acciones = {
      Escape: () => cerrarAtril(),
      ' ': atrilAlternarScroll,
      ArrowRight: () => atrilCancion(1),
      ArrowLeft: () => atrilCancion(-1),
      PageDown: () => atrilPagina(1),
      PageUp: () => atrilPagina(-1),
      ArrowDown: () => atrilPagina(1),
      ArrowUp: () => atrilPagina(-1),
      '+': () => atrilVelocidadScroll(1),
      '=': () => atrilVelocidadScroll(1),
      '-': () => atrilVelocidadScroll(-1),
      k: ytmPlayPausa,
      K: ytmPlayPausa
    };
    const f = acciones[e.key];
    if (!f) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    f();
  }, true);
}
