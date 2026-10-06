/**
 * posturas.js — Al tocar un acorde de la canción (.chord[data-chord]) muestra cómo se toca, con las
 * posturas del editor (editor/js/instrumentos.js: findVoicings y chordDiagramSvg). Lo usan Misas y el
 * reproductor; la página tiene que cargar antes acordes.js e instrumentos.js (y misas-shim.js).
 */

const INSTRUMENTOS = ["guitarra", "ukelele", "charango", "mandolina"];
const CLAVE = "mc-instrumento";

let caja = null, actual = null;

const instrumentoGuardado = () => {
  try {
    const id = localStorage.getItem(CLAVE);
    return INSTRUMENTOS.includes(id) ? id : "guitarra";
  } catch (_) {
    return "guitarra";
  }
};

function crearCaja() {
  caja = document.createElement("div");
  caja.className = "postura-pop";
  caja.setAttribute("role", "dialog");
  caja.hidden = true;
  caja.innerHTML = `<div class="postura-cabeza"><b class="postura-nombre"></b>
      <select class="postura-inst" aria-label="Instrumento">${INSTRUMENTOS.map((id) =>
        `<option value="${id}">${findInstrument(id).nombre}</option>`).join("")}</select>
      <button type="button" class="postura-cerrar" aria-label="Cerrar">✕</button></div>
    <div class="postura-dibujo"></div>
    <div class="postura-pie"><button type="button" data-paso="-1" aria-label="Postura anterior">◀</button>
      <span class="postura-n"></span><button type="button" data-paso="1" aria-label="Postura siguiente">▶</button></div>`;
  document.body.append(caja);
  caja.querySelector(".postura-cerrar").addEventListener("click", cerrar);
  caja.querySelector(".postura-inst").addEventListener("change", (e) => {
    try { localStorage.setItem(CLAVE, e.target.value); } catch (_) { /* sin almacenamiento */ }
    if (actual) { actual.i = 0; pintar(); }
  });
  caja.querySelector(".postura-pie").addEventListener("click", (e) => {
    const b = e.target.closest("[data-paso]");
    if (!b || !actual?.vs.length) return;
    actual.i = (actual.i + Number(b.dataset.paso) + actual.vs.length) % actual.vs.length;
    pintar();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });
  document.addEventListener("pointerdown", (e) => {
    if (!caja.hidden && !caja.contains(e.target) && !e.target.closest(".chord[data-chord]")) cerrar();
  });
  window.addEventListener("acordes-cargados", () => { if (actual) pintar(); });
}

function pintar() {
  const id = caja.querySelector(".postura-inst").value;
  const sel = { id, tuning: findInstrument(id).afinaciones[0].id };
  const inst = findInstrument(id), info = tuningInfo(inst, findTuning(inst, sel.tuning));
  actual.vs = findVoicings(sel, actual.acorde);
  if (actual.i >= actual.vs.length) actual.i = 0;
  const v = actual.vs[actual.i];
  caja.querySelector(".postura-nombre").textContent = actual.acorde;
  caja.querySelector(".postura-dibujo").innerHTML = v ? chordDiagramSvg(v, info)
    : '<p class="postura-nada">No encontré una postura para este acorde.</p>';
  caja.querySelector(".postura-n").textContent = actual.vs.length ? `${actual.i + 1} de ${actual.vs.length}` : "";
  caja.querySelector(".postura-pie").hidden = actual.vs.length < 2;
}

function ubicar(el) {
  const r = el.getBoundingClientRect(), w = caja.offsetWidth, h = caja.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const abajo = r.bottom + 8 + h <= window.innerHeight || r.top - 8 - h < 0;
  caja.style.left = x + "px";
  caja.style.top = (abajo ? r.bottom + 8 : r.top - 8 - h) + "px";
}

export function cerrar() {
  if (caja) caja.hidden = true;
  actual = null;
}

export function mostrarPostura(el) {
  if (!caja) crearCaja();
  caja.querySelector(".postura-inst").value = instrumentoGuardado();
  actual = { acorde: el.dataset.chord, i: 0, vs: [] };
  caja.hidden = false;
  pintar();
  ubicar(el);
}

/** Tocar un acorde dentro de `contenedor` abre la ventanita con su postura */
export function activarPosturas(contenedor) {
  contenedor.addEventListener("click", (e) => {
    const c = e.target.closest(".chord[data-chord]");
    if (!c || !contenedor.contains(c)) return;
    if (actual && actual.el === c) { cerrar(); return; }
    mostrarPostura(c);
    actual.el = c;
  });
  contenedor.classList.add("con-posturas");
}
