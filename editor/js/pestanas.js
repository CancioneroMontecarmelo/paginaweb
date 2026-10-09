'use strict';
// Pestañas: cada una es una canción con su texto, audios, historial y estado de guardado.

let docs = [];
let activeId = null;
// Canción de la Biblioteca que se está escuchando sin agregarla al cancionero (no es una pestaña)
let previa = null;

const cur = () => (previa && activeId === previa.id ? previa : docs.find(d => d.id === activeId) || docs[0]);

function makeDoc({ id, title = 'Sin título', text = '', audios = [], currentAudioId = null, clean = true, scrollSpeed = null,
  sheets = [], instruments = [], capos = {}, view = null, sheetSel = {}, panelInst = 0, tags = [], credits = null,
  mc = null, partituras = null, bibId = null } = {}) {
  const d = {
    id: id || uid(),
    title, text,
    audios: uniqueAudios(audios).map(normalizeAudio),
    currentAudioId,
    scrollSpeed: scrollSpeed ? clampLevel(scrollSpeed) : null,
    sheets: (sheets || []).map(normalizeSheet),
    instruments: instruments || [],
    capos: capos || {},
    view, sheetSel: sheetSel || {}, panelInst: panelInst || 0,
    tags: uniqueTags(tags || []),
    credits: normalizeCredits(credits),
    hist: { stack: [{ text, s: 0, e: 0 }], idx: 0, timer: null },
    sel: [0, 0],
    scroll: 0,
    clean: ''
  };
  // mc: canción de un cancionero de misa (cancionId, momento, posición y los ajustes guardados en la misa)
  if (mc) d.mc = mc;
  if (partituras?.length) d.partituras = partituras;
  if (bibId) d.bibId = bibId;
  if (!d.audios.some(a => a.id === d.currentAudioId)) d.currentAudioId = d.audios[0]?.id ?? null;
  if (clean) d.clean = docSignature(d);
  return d;
}

const docSignature = d => [d.title, d.text, d.audios.map(a => a.src).join('|'), d.sheets.map(h => h.src).join('|'),
  instrumentsToMeta(d.instruments), caposToMeta(d.capos), tagsToMeta(d.tags), d.credits.letra, d.credits.musica].join('\u0000');
const isDirty = d => docSignature(d) !== d.clean;
const isBlank = d => !d.text.trim() && !d.audios.length && !d.sheets.length;
const markClean = (d = cur()) => { d.clean = docSignature(d); };

// El editor contiene siempre el texto de la pestaña activa
function syncFromEditor() {
  const d = cur();
  if (!d) return;
  d.text = editor.value;
  d.title = titleEl.value;
  d.sel = [editor.selectionStart, editor.selectionEnd];
}

function activate(id) {
  activeId = id;
  const d = cur();
  editor.value = d.text;
  titleEl.value = d.title;
  try { editor.setSelectionRange(d.sel[0], d.sel[1]); } catch (_) {}
  updateAudioBar();
  refresh();
  if (typeof ytmVista === 'undefined' || ytmVista === 'cancionero') window.scrollTo(0, d.scroll || 0);
}

function leaveCurrent() {
  const d = cur();
  if (!d) return;
  histPush();
  syncFromEditor();
  if (typeof ytmVista === 'undefined' || ytmVista === 'cancionero') d.scroll = window.scrollY;
}

function switchTab(id) {
  if (id === activeId) return;
  leaveCurrent();
  activate(id);
}

// Abre una canción en una pestaña nueva (reutiliza la actual si está vacía)
function openInTab(data, reuse = true) {
  const c = cur();
  leaveCurrent();
  const d = makeDoc(data);
  if (reuse && c && isBlank(c)) docs.splice(docs.indexOf(c), 1, d);
  else docs.splice(c ? docs.indexOf(c) + 1 : docs.length, 0, d);
  activate(d.id);
  return d;
}

function newTab() {
  openInTab({ title: 'Sin título', text: '' }, false);
  setMode('edit');
  titleEl.select();
}

function closeTab(id = activeId) {
  const d = docs.find(x => x.id === id);
  if (!d) return;
  if (d.id === activeId) syncFromEditor();
  const cambios = d.mc ? mcCambio(d) : isDirty(d) && !isBlank(d);
  if (cambios && !confirm(`"${d.title}" tiene cambios sin guardar. ¿Quitarla del cancionero?`)) return;
  const i = docs.indexOf(d);
  revokeDocAudios(d);
  revokeDocSheets(d);
  forgetFileHandle(d.id);
  docs.splice(i, 1);
  if (!docs.length) docs.push(makeDoc());
  if (d.id === activeId) activate(docs[Math.min(i, docs.length - 1)].id);
  else { renderTabs(); scheduleSave(); }
}

function cycleTab(delta) {
  const i = docs.indexOf(cur());
  switchTab(docs[(i + delta + docs.length) % docs.length].id);
}

function moveTab(fromId, toId) {
  const from = docs.findIndex(d => d.id === fromId);
  const to = docs.findIndex(d => d.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [d] = docs.splice(from, 1);
  docs.splice(to, 0, d);
  renderTabs();
  scheduleSave();
}

// La cola de la derecha: las canciones del cancionero, en orden (cada una es una pestaña)
const colaSub = d => {
  const key = detectKey(d.text);
  const capo = capoPrincipal(d);
  return [d.mc?.momento, key ? keyName(key.idx, key.minor) : '', capo ? 'Cejilla ' + capo : ''].filter(Boolean).join(' · ');
};
let colaFirma = '';

function renderTabs() {
  const bar = $('#tabs');
  const playing = typeof ytmSonando === 'function' && ytmSonando();
  const firma = JSON.stringify([activeId, playing, docs.map(d => [d.id, d.title, colaSub(d), isDirty(d) && !isBlank(d), !!d.audios.length,
    d.audios[0]?.src, d.mc && mcCambio(d)])]);
  if (firma === colaFirma && bar.childElementCount) return;
  colaFirma = firma;
  bar.innerHTML = '';
  const vacio = !docs.some(d => !isBlank(d));
  let num = 0;
  for (const d of docs) {
    const activa = d.id === activeId;
    // Las canciones nuevas sin escribir no ocupan lugar en la cola (salvo la que se está escribiendo)
    if (isBlank(d) && (vacio || !activa)) continue;
    num++;
    const t = el('div', 'tab' + (activa ? ' active' : '') + (activa && playing ? ' sonando' : ''));
    t.dataset.id = d.id;
    t.draggable = true;
    t.setAttribute('role', 'listitem');
    t.title = d.title + (isDirty(d) ? ' (cambios sin guardar)' : '');
    const cambio = d.mc ? mcCambio(d) : isDirty(d) && !isBlank(d);
    t.innerHTML = `<span class="tab-num">${num}</span>${caraHtml(caraInfoDoc(d), 'chica')}
      <span class="tab-texto"><span class="tab-title">${escapeHtml(d.title.trim() || (isBlank(d) ? 'Canción nueva' : 'Sin título'))}</span>
      <small>${escapeHtml(colaSub(d))}</small></span>
      ${cambio ? `<span class="tab-dirty" title="${d.mc ? 'Cambió el tono, la cejilla o las velocidades: falta guardarlo en la misa' : 'Cambios sin guardar'}">●</span>` : ''}
      <button type="button" class="tab-close" title="Quitar del cancionero">×</button>`;
    bar.appendChild(t);
  }
  if (vacio) {
    bar.appendChild(el('p', 'cola-vacia', 'El cancionero está vacío. Agrega canciones desde Inicio, Explorar o la Biblioteca, o abre un cancionero de misa.'));
  }
  $('#colaSub') && ($('#colaSub').textContent = colaResumen());
}

function colaResumen() {
  const n = docs.filter(d => !isBlank(d)).length;
  const m = state.mcMisa;
  return [`${n} ${n === 1 ? 'canción' : 'canciones'}`, m ? 'Cancionero de misa' : '', m?.fechaUso || ''].filter(Boolean).join(' · ');
}

function bindTabs() {
  const bar = $('#tabs');
  let dragId = null;
  bar.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    if (e.target.closest('.tab-close')) closeTab(t.dataset.id);
    else {
      switchTab(t.dataset.id);
      ytmIrA('cancionero');
    }
  });
  bar.addEventListener('auxclick', e => {
    const t = e.target.closest('.tab');
    if (t && e.button === 1) { e.preventDefault(); closeTab(t.dataset.id); }
  });
  bar.addEventListener('dragstart', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    dragId = t.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  bar.addEventListener('dragover', e => {
    const t = e.target.closest('.tab');
    if (!t || !dragId) return;
    e.preventDefault();
    bar.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    t.classList.add('drag-over');
  });
  // Arrastrar con el dedo: mantener apretada la canción y moverla
  let toque = null;
  bar.addEventListener('touchstart', e => {
    const t = e.target.closest('.tab');
    if (!t || e.target.closest('.tab-close') || !e.target.closest('.tab-num, .cara')) return;
    toque = { id: t.dataset.id };
  }, { passive: true });
  bar.addEventListener('touchmove', e => {
    if (!toque) return;
    e.preventDefault();
    const sobre = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY)?.closest('.tab');
    bar.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    if (sobre && sobre.dataset.id !== toque.id) { sobre.classList.add('drag-over'); toque.sobre = sobre.dataset.id; }
  }, { passive: false });
  bar.addEventListener('touchend', () => {
    if (toque?.sobre) moveTab(toque.id, toque.sobre);
    toque = null;
  });
  bar.addEventListener('drop', e => {
    const t = e.target.closest('.tab');
    if (t && dragId) { e.preventDefault(); moveTab(dragId, t.dataset.id); }
    dragId = null;
  });
  bar.addEventListener('dragend', () => {
    dragId = null;
    bar.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  });
}

// ============ HISTORIAL (deshacer / rehacer) por pestaña ============
function histPush() {
  const h = cur().hist;
  clearTimeout(h.timer);
  h.timer = null;
  const text = editor.value;
  if (h.stack[h.idx]?.text === text) return;
  h.stack.length = h.idx + 1;
  h.stack.push({ text, s: editor.selectionStart, e: editor.selectionEnd });
  if (h.stack.length > 300) h.stack.shift();
  h.idx = h.stack.length - 1;
}

function histSchedule() {
  const h = cur().hist;
  clearTimeout(h.timer);
  h.timer = setTimeout(histPush, 500);
}

function applySnapshot(snap) {
  editor.value = snap.text;
  try { editor.setSelectionRange(snap.s, snap.e); } catch (_) {}
  refresh();
}

function undo() {
  histPush();
  const h = cur().hist;
  if (h.idx <= 0) { toast('Nada que deshacer', 1200); return; }
  h.idx--;
  applySnapshot(h.stack[h.idx]);
}

function redo() {
  histPush();
  const h = cur().hist;
  if (h.idx >= h.stack.length - 1) { toast('Nada que rehacer', 1200); return; }
  h.idx++;
  applySnapshot(h.stack[h.idx]);
}

// ============ SESIÓN (guardado automático en el navegador) ============
const STORE_KEY = 'montecarmelo-editor.v1';
const OLD_STORE_KEY = 'montecarmelo-editor.v0';
// editor/?publicar=1 es el editor que la pantalla Misas abre oculto para publicar y editor/?atril=1 el que
// abre su botón «Atril»: no restauran ni pisan las pestañas que el usuario tenga guardadas en este navegador
const MC_PARAMS = new URLSearchParams(location.search);
const ATRIL_MISA = MC_PARAMS.get('atril') === '1' && !!MC_PARAMS.get('misa');
const EFIMERO = MC_PARAMS.get('publicar') === '1' || ATRIL_MISA;
let saveTimer = null;

// Solo las preferencias de vista guardadas (tamaño de letra, notación, modo noche…), sin pestañas ni Drive
function loadViewPrefs() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) {}
  const s = data?.state || {};
  for (const k of ['notation', 'showComments', 'fontSize', 'highlight', 'bannerHidden', 'scrollSpeed', 'night']) {
    if (s[k] !== undefined) state[k] = s[k];
  }
}

function saveNow() {
  clearTimeout(saveTimer);
  if (EFIMERO) return;
  syncFromEditor();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      activeId,
      state,
      docs: docs.map(d => ({
        id: d.id, title: d.title, text: d.text,
        audios: d.audios.map(({ objectUrl, retries, fallbackTried, viaOrigin, ...rest }) => rest),
        currentAudioId: d.currentAudioId,
        scrollSpeed: d.scrollSpeed,
        sheets: d.sheets.map(storableSheet),
        instruments: d.instruments, capos: d.capos, view: d.view, sheetSel: d.sheetSel, panelInst: d.panelInst,
        tags: d.tags,
        credits: d.credits,
        mc: d.mc || null,
        partituras: d.partituras || null,
        bibId: d.bibId || null,
        clean: !isDirty(d)
      }))
    }));
  } catch (_) {}
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function loadSession() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) {}
  if (data?.docs?.length) {
    Object.assign(state, data.state || {});
    docs = data.docs.map(makeDoc);
    activeId = docs.some(d => d.id === data.activeId) ? data.activeId : docs[0].id;
    return true;
  }
  try { data = JSON.parse(localStorage.getItem(OLD_STORE_KEY)); } catch (_) {}
  if (data && typeof data.text === 'string') {
    const { showPreview, ...oldState } = data.state || {};
    Object.assign(state, oldState);
    docs = [makeDoc({ title: data.title || 'Sin título', text: data.text, audios: data.audios || [] })];
    activeId = docs[0].id;
    return true;
  }
  return false;
}

window.addEventListener('beforeunload', saveNow);
