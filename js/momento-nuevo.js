/**
 * momento-nuevo.js — Momentos fuera de la liturgia del día (celebraciones y costumbres de cada comunidad), común
 * al reproductor, Misas y el editor.
 *
 *  - momentosHabituales(misas, comunidad): los momentos propios que la comunidad usó en sus últimas misas, con
 *    dónde iban y el canto de la última vez (se calculan de las misas guardadas; no se guarda nada nuevo).
 *  - ponerHabituales(momentos, habituales): los agrega a una misa nueva, en su lugar y con su canto.
 *  - gruposDeMomentos(momentos, { habituales, celebracion }) y opcionesMomento(grupos): la lista agrupada de
 *    «+ Agregar momento» (De tu comunidad, De la misa, cada celebración, Costumbres) para un <select>.
 *  - crearMomento({ momentos, biblioteca, misas, comunidad, fechaUso, tiempoLiturgico, celebracion }) abre el
 *    asistente «Crear un momento» (nombre con ideas, dónde va y su canto) → Promise { nombre, posicion,
 *    cancionId } (cancionId "" = sin canto) o null.
 *
 * Usa buscarCanciones de editor/js/buscar.js (script clásico cargado antes).
 */

import {
  MOMENTOS_MISA, CELEBRACIONES, MOMENTOS_COMUNIDAD, claveMomento, ordenMomento, posicionMomento, candidatosMomento,
  celebracionPorId
} from "./liturgia.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const esDeCelebracion = new Set(CELEBRACIONES.flatMap((c) => c.momentos.map((m) => claveMomento(m.nombre))));
const fechaDe = (m) => String(m.fechaUso || m.creado || "");

// ============ MOMENTOS HABITUALES DE LA COMUNIDAD ============

// Los de las últimas «ultimas» misas de la comunidad que no son de la misa ni de una celebración.
// → [{ momento, despues, cancionId, veces, marcado }] (marcado: se usó más de una vez o en la última misa)
export function momentosHabituales(misas, comunidad, { ultimas = 8 } = {}) {
  if (!comunidad) return [];
  const propias = (misas || []).filter((m) => m.comunidad === comunidad && !m.celebracion)
    .sort((a, b) => fechaDe(b).localeCompare(fechaDe(a))).slice(0, ultimas);
  const vistos = new Map();
  propias.forEach((m, n) => m.momentos.forEach((x, i) => {
    const k = claveMomento(x.momento);
    if (ordenMomento(x.momento) < 999 || esDeCelebracion.has(k)) return;
    let h = vistos.get(k);
    if (!h) {
      // La primera vez que se ve es la más reciente: de ahí el lugar y el canto
      h = { momento: x.momento, despues: i > 0 ? m.momentos[i - 1].momento : "", cancionId: "", veces: 0, ultima: n === 0 };
      vistos.set(k, h);
    }
    h.veces++;
    if (!h.cancionId) h.cancionId = x.canciones.find((c) => !c.sugerida)?.cancionId || x.canciones[0]?.cancionId || "";
  }));
  return [...vistos.values()].map(({ ultima, ...h }) => ({ ...h, marcado: h.veces > 1 || ultima }));
}

// El canto que la comunidad usó la última vez para ese momento ("" si nunca)
export function ultimoCanto(misas, comunidad, nombre) {
  const k = claveMomento(nombre);
  const m = (misas || []).filter((x) => x.comunidad === comunidad).sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)))
    .find((x) => x.momentos.some((y) => claveMomento(y.momento) === k && y.canciones.length));
  return m?.momentos.find((y) => claveMomento(y.momento) === k && y.canciones.length).canciones[0].cancionId || "";
}

// Dónde va un habitual: después del mismo momento que la última vez; si la misa no lo tiene, según su nombre
export function lugarHabitual(momentos, h) {
  const i = h.despues ? momentos.findIndex((m) => claveMomento(m.momento) === claveMomento(h.despues)) : -1;
  return i >= 0 ? i + 1 : posicionMomento(momentos, h.momento);
}

export function ponerHabituales(momentos, habituales) {
  const lista = momentos.slice();
  for (const h of habituales) {
    if (lista.some((m) => claveMomento(m.momento) === claveMomento(h.momento))) continue;
    lista.splice(lugarHabitual(lista, h), 0, { momento: h.momento, canciones: h.cancionId ? [{ cancionId: h.cancionId, desplazamiento: 0 }] : [] });
  }
  return lista;
}

// ============ «+ AGREGAR MOMENTO» ============

// → [{ titulo, nombres }] sin los que la misa ya tiene
export function gruposDeMomentos(momentos, { habituales = [], celebracion = "" } = {}) {
  const ya = new Set(momentos.map((m) => claveMomento(m.momento)));
  const usados = new Set(ya);
  const grupo = (titulo, nombres) => {
    const libres = nombres.filter((n) => {
      const k = claveMomento(n);
      if (usados.has(k)) return false;
      usados.add(k);
      return true;
    });
    return libres.length ? [{ titulo, nombres: libres }] : [];
  };
  const cel = celebracionPorId(celebracion);
  const celebraciones = cel ? [cel, ...CELEBRACIONES.filter((c) => c !== cel)] : CELEBRACIONES;
  return [
    ...grupo("De tu comunidad", habituales.map((h) => h.momento)),
    ...grupo("De la misa", MOMENTOS_MISA),
    ...celebraciones.flatMap((c) => grupo(c.nombre, c.momentos.map((m) => m.nombre))),
    ...grupo("Costumbres de las comunidades", MOMENTOS_COMUNIDAD.map((m) => m.nombre))
  ];
}

// Las <option> de un <select> «+ Agregar momento…»; «__otro» abre el asistente
export const opcionesMomento = (grupos, primera = "+ Agregar momento…") => `<option value="">${esc(primera)}</option>`
  + grupos.map((g) => `<optgroup label="${esc(g.titulo)}">${g.nombres.map((n) => `<option>${esc(n)}</option>`).join("")}</optgroup>`).join("")
  + `<option value="__otro">Otro: crear un momento…</option>`;

// ============ ASISTENTE «CREAR UN MOMENTO» ============

const PASO = 40;
let dlg = null, est = null;

function dialogo() {
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.className = "dlg-momento";
  dlg.innerHTML = `
    <div class="cc-cabeza">
      <h2 class="cc-titulo">Crear un momento</h2>
      <button type="button" class="cc-cerrar" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <div class="cc-cuerpo">
      <label class="mn-campo">Nombre del momento
        <input type="text" class="mn-nombre" maxlength="60" autocomplete="off" placeholder="Por ejemplo: Saludo a los cumpleañeros">
      </label>
      <div class="mn-ideas"></div>
      <label class="mn-campo">Va después de
        <select class="mn-donde"></select>
      </label>
      <div class="mn-campo">Canto
        <input type="search" class="mn-buscar" placeholder="Buscar otro en la Biblioteca…" aria-label="Buscar un canto" autocomplete="off">
      </div>
      <div class="mn-cantos"></div>
    </div>
    <div class="mn-pie">
      <button type="button" data-cerrar>Cancelar</button>
      <button type="button" class="mn-listo">Agregar momento</button>
    </div>`;
  dlg.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  dlg.addEventListener("close", () => {
    const r = est?.resolver, v = est?.valor ?? null;
    est = null;
    r?.(v);
  });
  const nombre = dlg.querySelector(".mn-nombre");
  let espera = 0;
  nombre.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(() => nombreCambio(false), 250);
  });
  dlg.querySelector(".mn-ideas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-idea]");
    if (!b) return;
    nombre.value = b.dataset.idea;
    nombreCambio(true);
  });
  dlg.querySelector(".mn-donde").addEventListener("change", () => { if (est) est.dondeTocado = true; });
  dlg.querySelector(".mn-buscar").addEventListener("input", () => {
    if (!est) return;
    est.max = PASO;
    pintarCantos();
  });
  dlg.querySelector(".mn-cantos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-canto], [data-mas]");
    if (!b || !est) return;
    if (b.dataset.mas != null) {
      est.max += PASO;
      return pintarCantos();
    }
    est.cancionId = b.dataset.canto;
    est.tocado = true;
    pintarCantos();
  });
  dlg.querySelector(".mn-listo").addEventListener("click", aceptar);
  nombre.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); aceptar(); } });
  document.body.append(dlg);
  return dlg;
}

function nombreCambio(desdeIdea) {
  if (!est) return;
  const n = dlg.querySelector(".mn-nombre").value.trim();
  dlg.querySelector(".mn-listo").disabled = !n;
  dlg.querySelectorAll("[data-idea]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.idea === n)));
  if (!est.dondeTocado) {
    const h = est.habituales.find((x) => claveMomento(x.momento) === claveMomento(n));
    const pos = n ? (h ? lugarHabitual(est.momentos, h) : posicionMomento(est.momentos, n)) : est.momentos.length;
    dlg.querySelector(".mn-donde").value = String(pos);
  }
  est.nombre = n;
  est.lista = n ? candidatosMomento(est.biblioteca, n, est.ctx) : est.biblioteca.map((c) => ({ cancion: c, delMomento: false }));
  est.ultimo = n ? ultimoCanto(est.misas, est.comunidad, n) : "";
  if (!est.tocado || desdeIdea) {
    est.cancionId = est.ultimo || est.lista.find((x) => x.delMomento)?.cancion.id || "";
    est.tocado = false;
  }
  est.max = PASO;
  pintarCantos();
}

const filaCanto = (c, elegida, nota = "") => `<li><button type="button" class="cc-fila${elegida ? " elegida" : ""}" data-canto="${esc(c.id)}" aria-pressed="${elegida}">
  <b>${elegida ? "✓ " : ""}${esc(c.titulo || "Sin título")}</b><small>${esc(nota || (c.etiquetas || []).slice(0, 4).join(" · "))}</small></button></li>`;

function pintarCantos() {
  const caja = dlg.querySelector(".mn-cantos");
  const q = dlg.querySelector(".mn-buscar").value.trim();
  const porId = new Map(est.biblioteca.map((c) => [c.id, c]));
  const sel = est.cancionId;
  let html = `<ul class="cc-lista"><li><button type="button" class="cc-fila${sel ? "" : " elegida"}" data-canto="" aria-pressed="${!sel}">
    <b>${sel ? "" : "✓ "}Sin canto</b><small>El momento queda sin canción (se puede elegir después)</small></button></li></ul>`;
  if (q) {
    const halladas = typeof buscarCanciones === "function" ? buscarCanciones(est.biblioteca, q) : [];
    html += `<h3>Resultados <small>${halladas.length}</small></h3><ul class="cc-lista">${halladas.slice(0, est.max).map((c) => filaCanto(c, c.id === sel)).join("")}</ul>`;
    if (halladas.length > est.max) html += `<button type="button" class="cc-mas" data-mas>Ver más</button>`;
  } else {
    const ultimo = est.ultimo && porId.get(est.ultimo);
    if (ultimo) html += `<h3>La última vez en tu comunidad</h3><ul class="cc-lista">${filaCanto(ultimo, ultimo.id === sel, "La cantaron la última vez en este momento")}</ul>`;
    const del = est.lista.filter((x) => x.delMomento && x.cancion.id !== est.ultimo).map((x) => x.cancion);
    if (del.length) html += `<h3>Para este momento <small>${del.length}</small></h3><ul class="cc-lista">${del.slice(0, est.max).map((c) => filaCanto(c, c.id === sel)).join("")}</ul>`;
    if (del.length > est.max) html += `<button type="button" class="cc-mas" data-mas>Ver más</button>`;
    // La elegida, aunque no esté en las listas de arriba
    const elegida = sel && porId.get(sel);
    if (elegida && elegida.id !== est.ultimo && !del.slice(0, est.max).includes(elegida)) {
      html += `<h3>Elegida</h3><ul class="cc-lista">${filaCanto(elegida, true)}</ul>`;
    }
    if (!ultimo && !del.length) html += `<p class="cc-nada">${est.nombre ? "No hay cantos con ese nombre o sus palabras: buscalo arriba o dejalo sin canto." : "Escribí el nombre (o tocá una idea) para ver cantos que le calcen."}</p>`;
  }
  caja.innerHTML = html;
}

function aceptar() {
  if (!est) return;
  const nombre = dlg.querySelector(".mn-nombre").value.trim().slice(0, 60);
  if (!nombre) return dlg.querySelector(".mn-nombre").focus();
  if (est.momentos.some((m) => claveMomento(m.momento) === claveMomento(nombre))) {
    alert(`La misa ya tiene «${nombre}».`);
    return;
  }
  est.valor = { nombre, posicion: +dlg.querySelector(".mn-donde").value, cancionId: est.cancionId || "" };
  dlg.close();
}

export function crearMomento({ momentos = [], biblioteca = [], misas = [], comunidad = "", fechaUso = "", tiempoLiturgico = "", celebracion = "", nombre = "" } = {}) {
  const d = dialogo();
  est?.resolver(null);
  const habituales = momentosHabituales(misas, comunidad);
  const ya = new Set(momentos.map((m) => claveMomento(m.momento)));
  const ideas = [...new Set([...habituales.map((h) => h.momento), ...MOMENTOS_COMUNIDAD.map((m) => m.nombre)])]
    .filter((n) => !ya.has(claveMomento(n)));
  d.querySelector(".mn-ideas").innerHTML = ideas.map((n) => `<button type="button" class="dc-chip" data-idea="${esc(n)}" aria-pressed="false">${esc(n)}</button>`).join("");
  d.querySelector(".mn-donde").innerHTML = `<option value="0">Al comienzo</option>`
    + momentos.map((m, i) => `<option value="${i + 1}">${esc(m.momento)}</option>`).join("");
  d.querySelector(".mn-nombre").value = nombre;
  d.querySelector(".mn-buscar").value = "";
  return new Promise((resolver) => {
    est = {
      resolver, momentos, biblioteca, misas, comunidad, habituales, valor: null, max: PASO, nombre: "", lista: [], ultimo: "",
      cancionId: "", tocado: false, dondeTocado: false, ctx: { fechaUso, tiempoLiturgico, celebracion, comunidad, misas }
    };
    nombreCambio(true);
    if (!d.open) d.showModal();
    d.querySelector(".cc-cuerpo").scrollTop = 0;
    if (matchMedia("(pointer: fine)").matches) d.querySelector(".mn-nombre").focus();
  });
}
