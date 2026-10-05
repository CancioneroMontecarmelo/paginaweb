/**
 * misas.js — Pantalla Misas (misas.html), común a todas las comunidades.
 *
 *  - Panel derecho: cancioneros de misa de la comunidad y sus momentos; «Agregar nuevo» crea un borrador.
 *  - Panel izquierdo: la Biblioteca de canciones filtrada por la etiqueta del momento elegido, con checks.
 *  - Centro: la canción con acordes (transpuesta) y sus audios.
 *  - Diálogos: guardar el cancionero (fechas, ensayos y asistencia), coro e integrantes, subir canciones.
 *
 * Usa los scripts clásicos del editor cargados antes en la página (acordes, markdown, etiquetas, render)
 * más js/misas-shim.js. Los datos viven en el Drive a través del Apps Script (backend/Code.gs).
 */

import { llamarApi, sesionActual, puedeEditar, initNavSitio, comunidadesOpciones, ROLES } from "./auth.js";
import { COMUNIDADES } from "./comunidades.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => escapeHtml(s == null ? "" : s);
const token = () => (sesionActual() || {}).token || "";
const movil = () => matchMedia("(max-width: 960px)").matches;

const grupoCatolico = (nombre) => TAG_FAMILIES.catolico.groups.find((g) => g.name === nombre).tags;
const MOMENTOS_MISA = grupoCatolico("Momentos de la misa");
const TIEMPOS = grupoCatolico("Tiempos litúrgicos");
const MOMENTOS_BASE = ["Entrada", "Acto penitencial", "Gloria", "Salmo responsorial", "Aleluya", "Ofertorio",
  "Santo", "Cordero de Dios", "Comunión", "Acción de gracias", "Salida"];

// Etiquetas que valen para el mismo momento (la primera es la que se muestra)
const SINONIMOS = [
  ["Acto penitencial", "Señor ten piedad (Kyrie)", "Señor ten piedad", "Perdón", "Piedad", "Kyrie"],
  ["Aleluya", "Aclamación al Evangelio", "Aclamación"],
  ["Ofertorio", "Presentación de los dones", "Ofrenda", "Ofrendas"],
  ["Santo", "Sanctus"],
  ["Cordero de Dios", "Cordero", "Agnus", "Agnus Dei"],
  ["Salida", "Envío", "Despedida"],
  ["Salmo responsorial", "Salmo"],
  ["Padre Nuestro", "Padrenuestro"],
  ["Paz", "Saludo de la paz"],
  ["Canto a María", "María", "Virgen"]
];
const claveMomento = (t) => {
  const k = tagNorm(t);
  const g = SINONIMOS.find((lista) => lista.some((x) => tagNorm(x) === k));
  return g ? tagNorm(g[0]) : k;
};
const esDelMomento = (cancion, momento) => {
  const k = claveMomento(momento);
  return (cancion.etiquetas || []).some((t) => claveMomento(t) === k);
};
const ordenMomento = (nombre) => {
  const i = MOMENTOS_MISA.findIndex((x) => claveMomento(x) === claveMomento(nombre));
  return i < 0 ? 999 : i;
};

const VOCES = { soprano: "Soprano", contralto: "Contralto", tenor: "Tenor", bajo: "Bajo" };
const NIVELES = { basico: "Básico", intermedio: "Intermedio", avanzado: "Avanzado" };

const st = {
  sesion: sesionActual(),
  comunidad: "",
  biblioteca: [],
  porId: new Map(),
  errorBiblioteca: "",
  misas: [],
  errorMisas: "",
  cargandoMisas: true,
  actual: null, // cancionero abierto (copia que se edita)
  original: "", // firma del cancionero tal como se cargó
  momento: -1,
  indice: 0, // canción elegida dentro del momento
  vista: null, // { cancionId, desplazamiento, ref, previa }
  tonoOriginal: null,
  textos: new Map(),
  coros: null,
  busqueda: ""
};

// ============ SERVIDOR ============

async function leer(params) {
  const api = (window.MONTECARMELO_CONFIG || {}).apiUrl;
  if (!api) throw new Error("El Drive de la parroquia todavía no está conectado.");
  let r;
  try {
    r = await (await fetch(api + "?" + new URLSearchParams(params))).json();
  } catch (_) {
    throw new Error("No se pudo conectar con el servidor de la parroquia. Revisá tu conexión.");
  }
  if (!r.ok) throw new Error(r.error || "El servidor de la parroquia no respondió");
  return r;
}

async function cargarBiblioteca() {
  try {
    st.biblioteca = (await leer({ accion: "biblioteca" })).canciones || [];
    st.errorBiblioteca = "";
  } catch (e) {
    st.errorBiblioteca = e.message;
  }
  st.porId = new Map(st.biblioteca.map((c) => [c.id, c]));
}

async function cargarMisas() {
  st.cargandoMisas = true;
  pintarMisas();
  try {
    const p = { accion: "misas" };
    if (st.comunidad) p.comunidad = st.comunidad;
    st.misas = (await leer(p)).misas || [];
    st.errorMisas = "";
  } catch (e) {
    st.misas = [];
    st.errorMisas = e.message;
  }
  st.cargandoMisas = false;
}

async function cargarCoros(forzar) {
  if (st.coros && !forzar) return st.coros;
  st.coros = (await llamarApi("listarCoros", { token: token() })).coros || [];
  return st.coros;
}

async function textoCancion(id) {
  if (!st.textos.has(id)) {
    const p = leer({ accion: "cancion", id }).then((r) => parseMarkdown(r.texto, (r.cancion?.titulo || "cancion") + ".md"));
    st.textos.set(id, p);
    p.catch(() => st.textos.delete(id));
  }
  return st.textos.get(id);
}

// ============ UTILIDADES ============

const firma = (a) => JSON.stringify([a.nombre, a.comunidad, a.fechaUso, a.tiempoLiturgico, a.coroId, a.momentos]);
const sucio = () => !!st.actual && (st.actual.borrador || firma(st.actual) !== st.original);
const editable = () => !!st.actual && puedeEditar(st.actual.comunidad || undefined);
const momentoActual = () => st.actual?.momentos[st.momento] || null;
const tituloDe = (id) => st.porId.get(id)?.titulo || "Canción que ya no está en la Biblioteca";
const nombreComunidad = (slug) => COMUNIDADES.find((c) => c.slug === slug)?.nombre || (slug === "parroquia" ? "Parroquia (todas)" : "");

function hoyIso(desplazarDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desplazarDias);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

const proximoDomingo = () => hoyIso((7 - new Date().getDay()) % 7);

function fechaLarga(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function confirmarDescartar() {
  if (!sucio()) return true;
  return confirm(`Hay cambios sin guardar en «${st.actual.nombre || "Cancionero nuevo"}». ¿Descartarlos?`);
}

function avisar(texto, error) {
  let t = $(".misas-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "misas-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.textContent = texto;
  t.classList.toggle("error", !!error);
  t.classList.add("visible");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => t.classList.remove("visible"), error ? 6000 : 3500);
}

function actualizarUrl() {
  const p = new URLSearchParams();
  if (st.comunidad) p.set("comunidad", st.comunidad);
  if (st.actual && !st.actual.borrador) p.set("cancionero", st.actual.id);
  history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
}

function opciones(lista, valor) {
  return lista.map(([v, t]) => `<option value="${esc(v)}"${v === valor ? " selected" : ""}>${esc(t)}</option>`).join("");
}

// ============ CABECERA ============

function pintarCabecera() {
  const a = st.actual;
  $("#info-nombre").textContent = a ? a.nombre || "Cancionero nuevo" : "Elegí un cancionero";
  $("#info-fecha").textContent = a?.fechaUso ? fechaLarga(a.fechaUso) : "—";
  $("#info-autor").textContent = a ? a.autorNombre || a.autor || "—" : "—";
}

function pintarUsuario() {
  const s = st.sesion;
  const rol = s ? (s.rol === "admin_general" ? "Administrador general" : ROLES[s.rol] || "Visitante") : "";
  $("#info-usuario").innerHTML = s
    ? `${esc(s.nombre || s.email)} <small>(${esc(rol)})</small>`
    : `<a href="./login.html">Identificate</a> para crear cancioneros`;
  const privilegios = !!s && s.rol !== "visitante";
  $("#btn-coro").hidden = !privilegios;
  $("#btn-subir").hidden = !privilegios;
}

function pintarSelectorComunidad() {
  $("#sel-comunidad").innerHTML = opciones([["", "Todas las comunidades"], ...COMUNIDADES.map((c) => [c.slug, c.nombre])], st.comunidad);
}

// ============ PANEL IZQUIERDO: CANCIONEROS ============

function pintarMisas() {
  const cont = $("#lista-misas");
  $("#btn-nuevo").hidden = !puedeEditar(st.comunidad || undefined);
  const lista = st.misas.slice();
  if (st.actual?.borrador) lista.unshift(st.actual);
  if (!lista.length) {
    cont.innerHTML = `<p class="aviso">${esc(st.cargandoMisas ? "Cargando…" : st.errorMisas ||
      "Todavía no hay cancioneros" + (st.comunidad ? " en esta comunidad" : "") + ".")}</p>`;
    return;
  }
  cont.innerHTML = lista.map((m) => {
    const abierto = st.actual?.id === m.id;
    const a = abierto ? st.actual : m;
    const meta = [a.fechaUso ? fechaLarga(a.fechaUso) : "Sin fecha", !st.comunidad && nombreComunidad(a.comunidad), a.tiempoLiturgico]
      .filter(Boolean).join(" · ");
    return `<div class="misa-item${abierto ? " abierto" : ""}${a.borrador ? " borrador" : ""}">
      <button type="button" class="misa-boton" data-accion="abrir" data-id="${esc(m.id)}" aria-expanded="${abierto}">
        <strong>${esc(a.nombre || "Cancionero nuevo")}</strong><small>${esc(meta)}</small>
      </button>
      ${abierto ? momentosHtml() : ""}
    </div>`;
  }).join("");
}

function momentosHtml() {
  const a = st.actual;
  const ed = editable();
  const items = a.momentos.map((m, i) => {
    const titulos = m.canciones.map((c) => tituloDe(c.cancionId)).join(" · ");
    return `<li class="momento${i === st.momento ? " activo" : ""}">
      <button type="button" class="momento-boton" data-accion="momento" data-i="${i}">
        <b>${esc(m.momento)}</b>
        <span class="canciones-momento${titulos ? "" : " vacio"}">${esc(titulos || (ed ? "Elegí una canción →" : "Sin canción"))}</span>
      </button>
      ${ed ? `<button type="button" class="quitar" data-accion="quitar-momento" data-i="${i}" title="Quitar ${esc(m.momento)}">×</button>` : ""}
    </li>`;
  }).join("");
  const presentes = new Set(a.momentos.map((m) => claveMomento(m.momento)));
  const faltan = MOMENTOS_MISA.filter((m) => !presentes.has(claveMomento(m)));
  return `<ul class="momentos">${items || '<li class="aviso">Sin momentos.</li>'}</ul>
    ${ed ? `<div class="momento-agregar"><select id="nuevo-momento" aria-label="Agregar momento">
      <option value="">+ Agregar momento…</option>${faltan.map((m) => `<option>${esc(m)}</option>`).join("")}
      <option value="__otro">Otro…</option></select></div>` : ""}
    <div class="misa-acciones">
      ${ed ? `<button type="button" class="btn-chico${sucio() ? " importante" : ""}" data-accion="guardar">${a.borrador ? "Guardar…" : sucio() ? "Guardar cambios…" : "Fechas y ensayos…"}</button>` : ""}
      ${ed && sucio() && !a.borrador ? '<button type="button" class="btn-chico" data-accion="descartar">Descartar cambios</button>' : ""}
      <button type="button" class="btn-chico" data-accion="cerrar">${a.borrador ? "Descartar" : "Cerrar"}</button>
    </div>`;
}

function abrirMisa(id) {
  if (st.actual?.id === id) return cerrarMisa();
  if (!confirmarDescartar()) return;
  const m = st.misas.find((x) => x.id === id);
  if (!m) return;
  st.actual = structuredClone(m);
  st.original = firma(st.actual);
  const conCancion = st.actual.momentos.findIndex((x) => x.canciones.length);
  st.momento = st.actual.momentos.length ? Math.max(0, conCancion) : -1;
  st.indice = 0;
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
  actualizarUrl();
}

function cerrarMisa() {
  if (!confirmarDescartar()) return;
  st.actual = null;
  st.original = "";
  st.momento = -1;
  st.vista = null;
  pintarTodo();
  actualizarUrl();
}

function descartarCambios() {
  const m = st.misas.find((x) => x.id === st.actual?.id);
  if (!m || !confirm("¿Volver a la versión guardada?")) return;
  st.actual = structuredClone(m);
  st.original = firma(st.actual);
  st.momento = Math.min(st.momento, st.actual.momentos.length - 1);
  st.indice = 0;
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
}

function nuevoCancionero() {
  if (!confirmarDescartar()) return;
  const s = st.sesion || {};
  const propia = COMUNIDADES.some((c) => c.slug === s.comunidad) ? s.comunidad : "";
  st.actual = {
    id: "nuevo",
    borrador: true,
    nombre: "",
    comunidad: st.comunidad || propia,
    fechaUso: proximoDomingo(),
    tiempoLiturgico: "",
    coroId: "",
    momentos: MOMENTOS_BASE.map((momento) => ({ momento, canciones: [] })),
    autorNombre: s.nombre || s.email || ""
  };
  st.original = "";
  st.momento = 0;
  st.indice = 0;
  st.vista = null;
  pintarTodo();
  actualizarUrl();
  if (movil()) abrirCajon("biblioteca");
}

function elegirMomento(i) {
  st.momento = i;
  st.indice = 0;
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
  if (movil()) {
    cerrarCajones();
    if (editable() && !momentoActual().canciones.length) abrirCajon("biblioteca");
  }
}

function agregarMomento(nombre) {
  nombre = String(nombre || "").trim().slice(0, 60);
  if (!nombre || !st.actual) return;
  const momentos = st.actual.momentos;
  if (momentos.some((m) => claveMomento(m.momento) === claveMomento(nombre))) return;
  let pos = momentos.findIndex((m) => ordenMomento(m.momento) > ordenMomento(nombre));
  if (pos < 0) pos = momentos.length;
  momentos.splice(pos, 0, { momento: nombre, canciones: [] });
  elegirMomento(pos);
}

function quitarMomento(i) {
  const m = st.actual.momentos[i];
  if (m.canciones.length && !confirm(`«${m.momento}» tiene canciones elegidas. ¿Quitarlo igual?`)) return;
  st.actual.momentos.splice(i, 1);
  if (st.momento === i) st.momento = Math.min(i, st.actual.momentos.length - 1);
  else if (st.momento > i) st.momento--;
  st.indice = 0;
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
}

function mostrarCancionDelMomento() {
  const c = momentoActual()?.canciones[st.indice];
  st.vista = c ? { cancionId: c.cancionId, desplazamiento: c.desplazamiento || 0, ref: editable() ? c : null } : null;
  pintarLienzo();
}

// ============ PANEL DERECHO: BIBLIOTECA ============

function pintarBiblioteca() {
  const cont = $("#lista-biblioteca");
  const m = momentoActual();
  const ed = editable() && !!m;
  const soloMomento = !!m && $("#bib-solo-momento").checked;
  $("#bib-filtro-caja").hidden = !m;
  if (m) $("#bib-filtro-texto").textContent = `Solo canciones de «${m.momento}»`;
  $("#bib-titulo").textContent = m
    ? ed ? `Marcá las canciones para «${m.momento}»` : `Canciones para «${m.momento}»`
    : "Todas las canciones";

  if (!st.biblioteca.length) {
    cont.innerHTML = `<p class="aviso">${esc(st.errorBiblioteca ||
      "La Biblioteca está vacía. Se llena sola cuando alguien guarda un cancionero desde el editor con «Guardar en Drive», o con «Subir canción».")}</p>`;
    return;
  }
  const terminos = st.busqueda.split(",").map(tagNorm).filter(Boolean);
  let lista = st.biblioteca;
  if (soloMomento) lista = lista.filter((c) => esDelMomento(c, m.momento));
  if (terminos.length) {
    lista = lista.filter((c) => terminos.every((q) =>
      tagNorm(c.titulo).includes(q) || (c.etiquetas || []).some((t) => tagNorm(t).includes(q))));
  }
  if (!lista.length) {
    const motivo = soloMomento
      ? `No hay canciones con la etiqueta «${m.momento}»${terminos.length ? " que coincidan con la búsqueda" : ""}. Desmarcá «Solo canciones de…» para ver todas.`
      : "Ninguna canción coincide con la búsqueda.";
    cont.innerHTML = `<p class="aviso">${esc(motivo)}</p>`;
    return;
  }
  const elegidas = new Set(m ? m.canciones.map((c) => c.cancionId) : []);
  const claveM = m ? claveMomento(m.momento) : "";
  cont.innerHTML = lista.map((c) => {
    const audios = (c.audios || []).length;
    const meta = [c.tono, audios ? `♪ ${audios} audio${audios > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
    const etiquetas = (c.etiquetas || []).filter((t) => tagNorm(t) !== "catolico").slice(0, 6)
      .map((t) => `<span${claveM && claveMomento(t) === claveM ? ' class="coincide"' : ""}>${esc(t)}</span>`).join("");
    return `<div class="bib-cancion${st.vista?.cancionId === c.id ? " en-lienzo" : ""}">
      ${ed ? `<input type="checkbox" data-accion="marcar" data-id="${esc(c.id)}"${elegidas.has(c.id) ? " checked" : ""} aria-label="Usar «${esc(c.titulo)}» en ${esc(m.momento)}">` : ""}
      <button type="button" class="bib-ver" data-accion="ver" data-id="${esc(c.id)}">
        <strong>${esc(c.titulo)}</strong>${meta ? `<small>${esc(meta)}</small>` : ""}
        ${etiquetas ? `<span class="bib-etiquetas">${etiquetas}</span>` : ""}
      </button>
    </div>`;
  }).join("");
}

function marcarCancion(id, usar) {
  const m = momentoActual();
  if (!m || !editable()) return;
  const i = m.canciones.findIndex((c) => c.cancionId === id);
  if (usar) {
    if (i < 0) m.canciones.push({ cancionId: id, desplazamiento: 0 });
    st.indice = m.canciones.findIndex((c) => c.cancionId === id);
  } else if (i >= 0) {
    m.canciones.splice(i, 1);
    st.indice = Math.max(0, Math.min(st.indice, m.canciones.length - 1));
  }
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
}

function verCancion(id) {
  const m = momentoActual();
  const i = m ? m.canciones.findIndex((c) => c.cancionId === id) : -1;
  if (i >= 0) {
    st.indice = i;
    mostrarCancionDelMomento();
  } else {
    st.vista = { cancionId: id, desplazamiento: 0, ref: null, previa: true };
    pintarLienzo();
  }
  pintarBiblioteca();
  if (movil()) cerrarCajones();
}

// ============ LIENZO CENTRAL ============

let turnoLienzo = 0;

async function pintarLienzo() {
  const turno = ++turnoLienzo;
  pintarCabecera();
  pintarBarraMomento();
  const v = st.vista;
  const box = $("#cancion");
  if (!v) {
    st.tonoOriginal = null;
    mcCancionActual = null;
    const m = momentoActual();
    box.innerHTML = `<div class="lienzo-vacio"><p>${esc(m
      ? editable() ? `Marcá en la Biblioteca la canción para «${m.momento}».` : `«${m.momento}» todavía no tiene canción.`
      : st.actual ? "Elegí un momento del cancionero." : "Elegí un cancionero y uno de sus momentos para ver la canción.")}</p></div>`;
    $("#audios").hidden = true;
    pintarTrasponedor();
    return;
  }
  const entrada = st.porId.get(v.cancionId);
  if (!entrada) {
    st.tonoOriginal = null;
    box.innerHTML = '<div class="lienzo-vacio"><p>Esta canción ya no está en la Biblioteca.</p></div>';
    $("#audios").hidden = true;
    pintarTrasponedor();
    return;
  }
  if (!st.textos.has(v.cancionId)) {
    st.tonoOriginal = null;
    pintarTrasponedor();
    box.innerHTML = `<div class="lienzo-vacio"><p>Cargando «${esc(entrada.titulo)}»…</p></div>`;
  }
  let cancion;
  try {
    cancion = await textoCancion(v.cancionId);
  } catch (e) {
    if (turno === turnoLienzo) box.innerHTML = `<div class="lienzo-vacio"><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (turno !== turnoLienzo) return;
  const orig = detectKey(cancion.text);
  st.tonoOriginal = orig;
  const d = v.desplazamiento || 0;
  const tono = orig ? { idx: mod12(orig.idx + d), minor: orig.minor } : null;
  const texto = orig && d ? transposeText(cancion.text, d, keyPrefersFlats(tono.idx, tono.minor)) : cancion.text;
  mcCancionActual = { tags: cancion.tags || entrada.etiquetas };
  box.innerHTML = renderSong(cancion.title || entrada.titulo, texto, tono);
  pintarTrasponedor();
  pintarAudios(entrada);
}

function pintarBarraMomento() {
  const bar = $("#lienzo-momento");
  const m = momentoActual();
  const v = st.vista;
  if (v?.previa) {
    bar.hidden = false;
    bar.innerHTML = '<span class="vista-previa">Vista previa de la Biblioteca</span>' +
      (m && editable() ? ` <button type="button" class="btn-chico" data-accion="usar" data-id="${esc(v.cancionId)}">Usar en «${esc(m.momento)}»</button>` : "") +
      (m ? ' <button type="button" class="btn-chico" data-accion="volver">Volver al momento</button>' : "");
    return;
  }
  if (!m) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `<b>${esc(m.momento)}</b>` + (m.canciones.length > 1
    ? m.canciones.map((c, i) =>
      `<button type="button" class="pestana${i === st.indice ? " activa" : ""}" data-accion="pestana" data-i="${i}">${esc(tituloDe(c.cancionId))}</button>`).join("")
    : "");
}

function pintarAudios(entrada) {
  const box = $("#audios");
  const lista = entrada.audios || [];
  box.hidden = !lista.length;
  box.replaceChildren(...lista.map((a) => {
    const div = document.createElement("div");
    div.className = "audio-item";
    const et = document.createElement("span");
    const voz = a.voz && a.voz !== "todas" ? VOICES[a.voz]?.label || a.voz : "";
    et.textContent = "♪ " + (a.nombre || "Audio") + (voz ? " · " + voz : "");
    div.append(et);
    if (a.fileId) {
      const au = document.createElement("audio");
      au.controls = true;
      au.preload = "none";
      au.src = "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(a.fileId);
      au.addEventListener("error", () => audioDeRespaldo(au, a.fileId), { once: true });
      div.append(au);
    } else if (a.url && /youtu\.?be|vimeo\.com/i.test(a.url)) {
      const link = document.createElement("a");
      link.href = a.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Abrir el video";
      div.append(link);
    } else if (a.url) {
      const au = document.createElement("audio");
      au.controls = true;
      au.preload = "none";
      au.src = a.url;
      div.append(au);
    }
    return div;
  }));
}

// Si el navegador no puede reproducir el enlace directo de Drive, se pide el audio al Apps Script
async function audioDeRespaldo(au, fileId) {
  const aviso = document.createElement("small");
  aviso.textContent = "Cargando el audio desde el Drive…";
  au.after(aviso);
  try {
    const r = await leer({ accion: "audio", id: fileId });
    const bytes = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
    au.src = URL.createObjectURL(new Blob([bytes], { type: r.mime || "audio/mpeg" }));
    aviso.remove();
    au.play().catch(() => {});
  } catch (e) {
    aviso.textContent = "No se pudo cargar el audio: " + e.message;
  }
}

// ============ TRASPONEDOR ============

function pintarTrasponedor() {
  const orig = st.vista ? st.tonoOriginal : null;
  const minor = !!orig?.minor;
  const d = st.vista?.desplazamiento || 0;
  const actual = orig ? mod12(orig.idx + d) : -1;
  $("#trasponedor").innerHTML = Array.from({ length: 12 }, (_, i) => {
    const clases = ["nota-btn"];
    if (ACCIDENTAL_KEYS.has(i)) clases.push("sostenido");
    if (i === actual) clases.push("activo");
    if (orig && i === orig.idx) clases.push("original");
    const titulo = orig && i === orig.idx ? "Tono original" : "Pasar a " + keyName(i, minor);
    return `<button type="button" class="${clases.join(" ")}" data-tono="${i}" title="${esc(titulo)}"${orig ? "" : " disabled"}>${esc(keyName(i, minor))}</button>`;
  }).join("");
  $("#bajar").disabled = !orig;
  $("#subir").disabled = !orig;
  let info = "";
  if (orig) {
    info = `Original: <b>${esc(keyLabel(orig))}</b>`;
    if (d) info += ` · ${d > 0 ? "+" : ""}${d} semitono${Math.abs(d) > 1 ? "s" : ""}`;
    if (st.vista.ref) info += " · se guarda en el cancionero";
  } else if (st.vista && st.porId.has(st.vista.cancionId) && st.textos.has(st.vista.cancionId)) {
    info = "Sin acordes para transponer";
  }
  $("#tono-info").innerHTML = info;
}

function transponer(d) {
  const v = st.vista;
  if (!v || !st.tonoOriginal) return;
  d = mod12(d);
  if (d > 6) d -= 12;
  v.desplazamiento = d;
  if (v.ref) {
    v.ref.desplazamiento = d;
    pintarMisas();
  }
  pintarLienzo();
}

// ============ CAJONES (CELULAR) ============

function abrirCajon(lado) {
  cerrarCajones();
  $("#panel-" + lado).classList.add("abierto");
  $("#velo").hidden = false;
}

function cerrarCajones() {
  document.querySelectorAll(".panel-flotante.abierto").forEach((p) => p.classList.remove("abierto"));
  $("#velo").hidden = true;
}

function pintarTodo() {
  pintarMisas();
  pintarBiblioteca();
  pintarLienzo();
}

// ============ DIÁLOGO: GUARDAR CANCIONERO ============

let ensayos = null; // { fechasPosibles, realizados } en edición; null si no se pudieron leer

function comunidadesEditables() {
  return COMUNIDADES.filter((c) => puedeEditar(c.slug));
}

function corosDeComunidad(comunidad) {
  return (st.coros || []).filter((c) => c.comunidad === comunidad || c.comunidad === "parroquia");
}

function pintarCoroSelect() {
  const a = st.actual;
  const comunidad = $("#g-comunidad").value;
  const lista = corosDeComunidad(comunidad);
  const valor = $("#g-coro").value || a.coroId;
  $("#g-coro").innerHTML = opciones([["", lista.length ? "Sin coro" : "No hay coros en esta comunidad"], ...lista.map((c) => [c.id, c.nombre])],
    lista.some((c) => c.id === valor) ? valor : "");
}

const coroElegido = () => (st.coros || []).find((c) => c.id === $("#g-coro").value) || null;

function pintarEnsayos() {
  const privado = !!ensayos;
  $("#g-privado").hidden = !privado;
  $("#g-privado-aviso").hidden = privado;
  if (!privado) return;
  $("#g-posibles").innerHTML = ensayos.fechasPosibles.map((f, i) =>
    `<span class="fecha-chip"><input type="date" value="${esc(f)}" data-posible="${i}" aria-label="Fecha posible de ensayo">` +
    `<button type="button" class="quitar" data-quitar-posible="${i}" title="Quitar fecha">×</button></span>`).join("") ||
    '<p class="aviso">Todavía no hay fechas propuestas.</p>';

  const coro = coroElegido();
  $("#g-ayuda-asistencia").textContent = coro
    ? `Marcá quiénes de «${coro.nombre}» estuvieron presentes en cada ensayo.`
    : "Elegí el coro arriba para marcar la asistencia de sus integrantes.";
  $("#g-realizados").innerHTML = ensayos.realizados.map((r, i) => {
    const presentes = new Set(r.presentes);
    const integrantes = coro ? coro.integrantes.filter((p) => p.activo !== false || presentes.has(p.id)) : [];
    const cuenta = coro ? `${integrantes.filter((p) => presentes.has(p.id)).length} de ${integrantes.length} presentes` : "";
    return `<div class="ensayo" data-ensayo="${i}">
      <div class="ensayo-cabeza">
        <input type="date" value="${esc(r.fecha)}" data-campo="fecha" aria-label="Fecha del ensayo">
        <small class="cuenta">${esc(cuenta)}</small>
        <span class="espacio"></span>
        <button type="button" class="quitar" data-quitar-ensayo="${i}" title="Quitar ensayo">×</button>
      </div>
      ${integrantes.length ? `<div class="asistencia">${integrantes.map((p) =>
        `<label><input type="checkbox" value="${esc(p.id)}" data-campo="presente"${presentes.has(p.id) ? " checked" : ""}> ${esc(p.nombre)}${p.voz ? ` <small>${esc(VOCES[p.voz] || p.voz)}</small>` : ""}</label>`).join("")}</div>`
        : coro ? '<p class="aviso">El coro no tiene integrantes cargados.</p>' : ""}
      <textarea data-campo="nota" placeholder="Nota del ensayo (opcional)" maxlength="500">${esc(r.nota)}</textarea>
    </div>`;
  }).join("") || '<p class="aviso">Todavía no se registraron ensayos.</p>';
}

async function abrirGuardar() {
  const a = st.actual;
  if (!a || !editable()) return;
  const dlg = $("#dlg-guardar");
  $("#g-nombre").value = a.nombre || "";
  const comunidades = comunidadesEditables();
  $("#g-comunidad").innerHTML = (comunidades.some((c) => c.slug === a.comunidad) ? "" : '<option value="">Elegí la comunidad</option>') +
    opciones(comunidades.map((c) => [c.slug, c.nombre]), a.comunidad);
  $("#g-fecha").value = a.fechaUso || "";
  const tiempos = TIEMPOS.includes(a.tiempoLiturgico) || !a.tiempoLiturgico ? TIEMPOS : [a.tiempoLiturgico, ...TIEMPOS];
  $("#g-tiempo").innerHTML = opciones([["", "—"], ...tiempos.map((t) => [t, t])], a.tiempoLiturgico || "");
  $("#g-coro").innerHTML = '<option value="">Cargando coros…</option>';
  $("#g-borrar").hidden = !!a.borrador;
  $("#g-error").hidden = true;
  ensayos = { fechasPosibles: [], realizados: [] };
  pintarEnsayos();
  dlg.showModal();
  const errores = [];
  await Promise.all([
    cargarCoros().catch((e) => { st.coros = st.coros || []; errores.push(e.message); }),
    a.borrador ? null : llamarApi("leerEnsayos", { token: token(), id: a.id })
      .then((r) => { ensayos = r.ensayos; })
      .catch((e) => { ensayos = null; errores.push(e.message); })
  ]);
  pintarCoroSelect();
  pintarEnsayos();
  if (errores.length) mostrarError("#g-error", errores.join(" · "));
}

function mostrarError(sel, texto) {
  const el = $(sel);
  el.textContent = texto;
  el.hidden = !texto;
}

async function guardarCancionero(e) {
  e.preventDefault();
  const a = st.actual;
  const nombre = $("#g-nombre").value.trim();
  const comunidad = $("#g-comunidad").value;
  if (!nombre) return mostrarError("#g-error", "Escribí el nombre del cancionero.");
  if (!comunidad) return mostrarError("#g-error", "Elegí la comunidad.");
  const boton = $("#g-guardar");
  boton.disabled = true;
  boton.textContent = "Guardando…";
  mostrarError("#g-error", "");
  try {
    const misa = {
      id: a.borrador ? undefined : a.id,
      nombre, comunidad,
      fechaUso: $("#g-fecha").value,
      tiempoLiturgico: $("#g-tiempo").value,
      coroId: $("#g-coro").value,
      momentos: a.momentos
    };
    const r = await llamarApi("guardarMisa", { token: token(), misa, ensayos: ensayos || undefined });
    if (st.comunidad && st.comunidad !== r.misa.comunidad) {
      st.comunidad = r.misa.comunidad;
      pintarSelectorComunidad();
      await cargarMisas();
    } else {
      st.misas = [r.misa, ...st.misas.filter((x) => x.id !== r.misa.id)]
        .sort((x, y) => String(y.fechaUso || y.creado).localeCompare(String(x.fechaUso || x.creado)));
    }
    st.actual = structuredClone(r.misa);
    st.original = firma(st.actual);
    $("#dlg-guardar").close();
    mostrarCancionDelMomento();
    pintarMisas();
    pintarBiblioteca();
    actualizarUrl();
    avisar(`Se guardó «${r.misa.nombre}».`);
  } catch (err) {
    mostrarError("#g-error", err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = "Guardar";
  }
}

async function borrarCancionero() {
  const a = st.actual;
  if (!a || a.borrador || !confirm(`¿Borrar el cancionero «${a.nombre}» con sus ensayos? No se puede deshacer.`)) return;
  try {
    await llamarApi("borrarMisa", { token: token(), id: a.id });
    st.misas = st.misas.filter((x) => x.id !== a.id);
    st.actual = null;
    st.original = "";
    st.momento = -1;
    st.vista = null;
    $("#dlg-guardar").close();
    pintarTodo();
    actualizarUrl();
    avisar(`Se borró «${a.nombre}».`);
  } catch (err) {
    mostrarError("#g-error", err.message);
  }
}

function conectarGuardar() {
  $("#form-guardar").addEventListener("submit", guardarCancionero);
  $("#g-borrar").addEventListener("click", borrarCancionero);
  $("#g-comunidad").addEventListener("change", () => { pintarCoroSelect(); pintarEnsayos(); });
  $("#g-coro").addEventListener("change", pintarEnsayos);
  $("#g-agregar-posible").addEventListener("click", () => {
    const ultima = ensayos.fechasPosibles[ensayos.fechasPosibles.length - 1];
    ensayos.fechasPosibles.push(ultima || hoyIso(1));
    pintarEnsayos();
    $("#g-posibles").querySelector("input:last-of-type")?.focus();
  });
  $("#g-agregar-ensayo").addEventListener("click", () => {
    const hechas = new Set(ensayos.realizados.map((r) => r.fecha));
    const fecha = ensayos.fechasPosibles.find((f) => !hechas.has(f) && f <= hoyIso()) || hoyIso();
    ensayos.realizados.push({ fecha, presentes: [], nota: "" });
    pintarEnsayos();
  });
  const privado = $("#g-privado");
  privado.addEventListener("click", (e) => {
    const qp = e.target.closest("[data-quitar-posible]");
    const qe = e.target.closest("[data-quitar-ensayo]");
    if (qp) ensayos.fechasPosibles.splice(+qp.dataset.quitarPosible, 1);
    else if (qe) {
      const r = ensayos.realizados[+qe.dataset.quitarEnsayo];
      if (r.presentes.length && !confirm(`¿Quitar el ensayo del ${fechaLarga(r.fecha)} con su asistencia?`)) return;
      ensayos.realizados.splice(+qe.dataset.quitarEnsayo, 1);
    } else return;
    pintarEnsayos();
  });
  privado.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.posible != null) {
      ensayos.fechasPosibles[+t.dataset.posible] = t.value;
      return;
    }
    const caja = t.closest("[data-ensayo]");
    if (!caja) return;
    const r = ensayos.realizados[+caja.dataset.ensayo];
    if (t.dataset.campo === "fecha") r.fecha = t.value;
    if (t.dataset.campo === "presente") {
      r.presentes = r.presentes.filter((id) => id !== t.value);
      if (t.checked) r.presentes.push(t.value);
      const coro = coroElegido();
      const presentes = new Set(r.presentes);
      const lista = coro.integrantes.filter((p) => p.activo !== false || presentes.has(p.id));
      caja.querySelector(".cuenta").textContent = `${lista.filter((p) => presentes.has(p.id)).length} de ${lista.length} presentes`;
    }
  });
  privado.addEventListener("input", (e) => {
    const caja = e.target.closest("[data-ensayo]");
    if (caja && e.target.dataset.campo === "nota") ensayos.realizados[+caja.dataset.ensayo].nota = e.target.value;
  });
}

// ============ DIÁLOGO: CORO E INTEGRANTES ============

let coroEd = null;
let coroFirma = "";

const integranteVacio = (comunidad) => ({
  nombre: "", comunidad, fechaIncorporacion: hoyIso(), voz: "", instrumentos: "",
  leePartitura: false, nivel: "", notas: "", activo: true
});

function comunidadesCoro() {
  return comunidadesOpciones().filter((c) => puedeEditar(c.slug));
}

function leerFormCoro() {
  coroEd.nombre = $("#c-nombre").value.trim();
  coroEd.comunidad = $("#c-comunidad").value;
}

function pintarListaCoros() {
  const lista = st.coros || [];
  $("#c-lista").innerHTML = opciones([...lista.map((c) => [c.id, `${c.nombre} · ${nombreComunidad(c.comunidad)}`]), ["", "— Coro nuevo —"]],
    coroEd?.id || "");
}

function elegirCoro(id) {
  const c = (st.coros || []).find((x) => x.id === id);
  const editables = comunidadesCoro();
  const porDefecto = editables.some((x) => x.slug === st.comunidad) ? st.comunidad : editables[0]?.slug || "";
  coroEd = c ? structuredClone(c) : { nombre: "", comunidad: porDefecto, integrantes: [] };
  coroFirma = JSON.stringify(coroEd);
  $("#c-nombre").value = coroEd.nombre;
  $("#c-comunidad").innerHTML = opciones(editables.map((x) => [x.slug, x.nombre]), coroEd.comunidad);
  $("#c-borrar").hidden = !coroEd.id;
  mostrarError("#c-error", "");
  $("#c-ok").hidden = true;
  pintarListaCoros();
  pintarIntegrantes();
}

function pintarIntegrantes() {
  const comunidades = comunidadesOpciones().map((c) => [c.slug, c.nombre]);
  $("#c-integrantes").innerHTML = coroEd.integrantes.map((p, i) => `<tr data-i="${i}">
      <td data-et="Nombre"><input type="text" class="i-nombre" data-campo="nombre" value="${esc(p.nombre)}" maxlength="100" aria-label="Nombre"></td>
      <td data-et="Comunidad"><select data-campo="comunidad" aria-label="Comunidad">${opciones(comunidades, p.comunidad || coroEd.comunidad)}</select></td>
      <td data-et="Incorporación"><input type="date" data-campo="fechaIncorporacion" value="${esc(p.fechaIncorporacion)}" aria-label="Fecha de incorporación"></td>
      <td data-et="Voz"><select data-campo="voz" aria-label="Voz">${opciones([["", "—"], ...Object.entries(VOCES)], p.voz || "")}</select></td>
      <td data-et="Instrumentos"><input type="text" class="i-instr" data-campo="instrumentos" value="${esc(p.instrumentos)}" placeholder="guitarra, flauta…" maxlength="200" aria-label="Instrumentos"></td>
      <td data-et="Lee partitura" class="centro"><input type="checkbox" data-campo="leePartitura"${p.leePartitura ? " checked" : ""} aria-label="Lee partitura"></td>
      <td data-et="Nivel"><select data-campo="nivel" aria-label="Nivel musical">${opciones([["", "—"], ...Object.entries(NIVELES)], p.nivel || "")}</select></td>
      <td data-et="Notas"><input type="text" class="i-notas" data-campo="notas" value="${esc(p.notas)}" maxlength="500" aria-label="Notas"></td>
      <td data-et="Activo" class="centro"><input type="checkbox" data-campo="activo"${p.activo !== false ? " checked" : ""} aria-label="Activo"></td>
      <td><button type="button" class="quitar" data-quitar="${i}" title="Quitar integrante">×</button></td>
    </tr>`).join("") || '<tr><td colspan="10" class="aviso">Todavía no hay integrantes.</td></tr>';
}

async function abrirCoros() {
  const dlg = $("#dlg-coro");
  $("#c-integrantes").innerHTML = '<tr><td colspan="10" class="aviso">Cargando…</td></tr>';
  mostrarError("#c-error", "");
  if (!dlg.open) dlg.showModal();
  try {
    await cargarCoros(true);
  } catch (e) {
    st.coros = st.coros || [];
    mostrarError("#c-error", e.message);
  }
  const propio = st.coros.find((c) => c.comunidad === st.comunidad) || st.coros[0];
  elegirCoro(propio?.id || "");
}

async function guardarCoro(e) {
  e.preventDefault();
  leerFormCoro();
  if (!coroEd.nombre) return mostrarError("#c-error", "Escribí el nombre del coro.");
  if (!coroEd.comunidad) return mostrarError("#c-error", "Elegí la comunidad del coro.");
  const boton = $("#c-guardar");
  boton.disabled = true;
  mostrarError("#c-error", "");
  try {
    const r = await llamarApi("guardarCoro", { token: token(), coro: coroEd });
    st.coros = [...(st.coros || []).filter((c) => c.id !== r.coro.id), r.coro];
    elegirCoro(r.coro.id);
    $("#c-ok").textContent = `Se guardó «${r.coro.nombre}» con ${r.coro.integrantes.length} integrante${r.coro.integrantes.length === 1 ? "" : "s"}.`;
    $("#c-ok").hidden = false;
    if ($("#dlg-guardar").open) {
      pintarCoroSelect();
      pintarEnsayos();
    }
  } catch (err) {
    mostrarError("#c-error", err.message);
  } finally {
    boton.disabled = false;
  }
}

async function borrarCoro() {
  if (!coroEd?.id || !confirm(`¿Borrar el coro «${coroEd.nombre}» y sus integrantes?`)) return;
  try {
    await llamarApi("borrarCoro", { token: token(), id: coroEd.id });
    st.coros = st.coros.filter((c) => c.id !== coroEd.id);
    elegirCoro(st.coros[0]?.id || "");
  } catch (err) {
    mostrarError("#c-error", err.message);
  }
}

function cambiosEnCoro() {
  leerFormCoro();
  return JSON.stringify(coroEd) !== coroFirma;
}

function conectarCoro() {
  $("#btn-coro").addEventListener("click", abrirCoros);
  $("#form-coro").addEventListener("submit", guardarCoro);
  $("#c-borrar").addEventListener("click", borrarCoro);
  $("#c-lista").addEventListener("change", (e) => {
    if (cambiosEnCoro() && !confirm("Hay cambios sin guardar en este coro. ¿Descartarlos?")) {
      e.target.value = coroEd.id || "";
      return;
    }
    elegirCoro(e.target.value);
  });
  $("#c-nuevo").addEventListener("click", () => {
    if (cambiosEnCoro() && !confirm("Hay cambios sin guardar en este coro. ¿Descartarlos?")) return;
    elegirCoro("");
    $("#c-nombre").focus();
  });
  $("#c-agregar").addEventListener("click", () => {
    leerFormCoro();
    coroEd.integrantes.push(integranteVacio(coroEd.comunidad));
    pintarIntegrantes();
    $("#c-integrantes").querySelector("tr:last-child .i-nombre")?.focus();
  });
  const tabla = $("#c-integrantes");
  const actualizar = (e) => {
    const fila = e.target.closest("tr[data-i]");
    const campo = e.target.dataset.campo;
    if (!fila || !campo) return;
    coroEd.integrantes[+fila.dataset.i][campo] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  };
  tabla.addEventListener("input", actualizar);
  tabla.addEventListener("change", actualizar);
  tabla.addEventListener("click", (e) => {
    const q = e.target.closest("[data-quitar]");
    if (!q) return;
    const p = coroEd.integrantes[+q.dataset.quitar];
    if (p.nombre && !confirm(`¿Quitar a ${p.nombre} del coro?`)) return;
    coroEd.integrantes.splice(+q.dataset.quitar, 1);
    pintarIntegrantes();
  });
  $("#dlg-coro").addEventListener("cancel", (e) => {
    if (cambiosEnCoro() && !confirm("Hay cambios sin guardar en este coro. ¿Cerrar igual?")) e.preventDefault();
  });
}

// ============ DIÁLOGO: SUBIR CANCIONES ============

const nombreBase = (ruta) => String(ruta || "").split(/[\\/]/).pop().normalize("NFC").toLowerCase();

function archivoBase64(f) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(",")[1] || "");
    lector.onerror = () => mal(new Error("No se pudo leer " + f.name));
    lector.readAsDataURL(f);
  });
}

async function subirCanciones(e) {
  e.preventDefault();
  const mds = [...$("#s-md").files];
  const audios = [...$("#s-audios").files];
  const comunidad = $("#s-comunidad").value;
  if (!mds.length) return mostrarError("#s-error", "Elegí al menos un archivo .md.");
  const grande = audios.find((f) => f.size > 30 * 1024 * 1024);
  if (grande) return mostrarError("#s-error", `«${grande.name}» supera los 30 MB.`);
  const boton = $("#s-enviar");
  const estado = $("#s-ok");
  boton.disabled = true;
  mostrarError("#s-error", "");
  estado.hidden = false;
  try {
    const canciones = await Promise.all(mds.map(async (f) => {
      const texto = await f.text();
      const datos = parseMarkdown(texto, f.name);
      const locales = (datos.audios || []).filter((a) => a.kind === "local");
      const propios = mds.length === 1
        ? audios.map((archivo) => ({ archivo, info: locales.find((a) => nombreBase(a.src) === nombreBase(archivo.name)) }))
        : locales.map((info) => ({ info, archivo: audios.find((x) => nombreBase(x.name) === nombreBase(info.src)) })).filter((x) => x.archivo);
      const enlaces = (datos.audios || []).filter((a) => a.kind === "url")
        .map((a) => ({ nombre: a.name, voz: a.voice === "todas" ? "" : a.voice, url: a.src }));
      return { f, texto, titulo: datos.title, propios, enlaces };
    }));
    const usados = [...new Set(canciones.flatMap((c) => c.propios.map((p) => p.archivo)))];
    const ids = new Map();
    for (const [i, archivo] of usados.entries()) {
      estado.textContent = `Subiendo audio ${i + 1} de ${usados.length}: ${archivo.name}…`;
      const r = await llamarApi("subirAudioBiblioteca", {
        token: token(), nombre: archivo.name, mime: archivo.type || "audio/mpeg", base64: await archivoBase64(archivo)
      });
      ids.set(archivo, r.fileId);
    }
    const subidas = [];
    for (const [i, c] of canciones.entries()) {
      estado.textContent = `Subiendo canción ${i + 1} de ${canciones.length}: ${c.titulo}…`;
      const lista = [
        ...c.propios.map(({ archivo, info }) => ({
          nombre: info?.name || archivo.name.replace(/\.[^.]+$/, ""),
          voz: info && info.voice !== "todas" ? info.voice : "",
          fileId: ids.get(archivo)
        })),
        ...c.enlaces
      ];
      const r = await llamarApi("subirCancion", { token: token(), md: c.texto, nombre: c.f.name, comunidad, audios: lista });
      subidas.push(r.cancion.titulo);
      st.textos.delete(r.cancion.id);
    }
    await cargarBiblioteca();
    pintarBiblioteca();
    estado.textContent = `Listo: ${subidas.length === 1 ? "se subió" : "se subieron"} ${subidas.map((t) => `«${t}»`).join(", ")}.`;
    $("#form-subir").reset();
    $("#s-comunidad").value = comunidad;
  } catch (err) {
    estado.hidden = true;
    mostrarError("#s-error", err.message);
  } finally {
    boton.disabled = false;
  }
}

function conectarSubir() {
  $("#btn-subir").addEventListener("click", () => {
    const editables = comunidadesEditables();
    const s = st.sesion || {};
    const valor = editables.some((c) => c.slug === st.comunidad) ? st.comunidad : editables.some((c) => c.slug === s.comunidad) ? s.comunidad : "";
    $("#s-comunidad").innerHTML = opciones([["", "Sin comunidad"], ...editables.map((c) => [c.slug, c.nombre])], valor);
    mostrarError("#s-error", "");
    $("#s-ok").hidden = true;
    $("#dlg-subir").showModal();
  });
  $("#form-subir").addEventListener("submit", subirCanciones);
}

// ============ EVENTOS E INICIO ============

function conectarEventos() {
  document.querySelectorAll("dialog [data-cerrar]").forEach((b) =>
    b.addEventListener("click", () => {
      const dlg = b.closest("dialog");
      if (dlg.id === "dlg-coro" && cambiosEnCoro() && !confirm("Hay cambios sin guardar en este coro. ¿Cerrar igual?")) return;
      dlg.close();
    }));

  $("#sel-comunidad").addEventListener("change", async (e) => {
    if (!confirmarDescartar()) {
      e.target.value = st.comunidad;
      return;
    }
    st.comunidad = e.target.value;
    st.actual = null;
    st.original = "";
    st.momento = -1;
    st.vista = null;
    actualizarUrl();
    pintarTodo();
    await cargarMisas();
    pintarMisas();
  });

  $("#btn-nuevo").addEventListener("click", nuevoCancionero);

  $("#lista-misas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accion]");
    if (!b) return;
    const accion = b.dataset.accion;
    if (accion === "abrir") abrirMisa(b.dataset.id);
    else if (accion === "momento") elegirMomento(+b.dataset.i);
    else if (accion === "quitar-momento") quitarMomento(+b.dataset.i);
    else if (accion === "guardar") abrirGuardar();
    else if (accion === "descartar") descartarCambios();
    else if (accion === "cerrar") cerrarMisa();
  });
  $("#lista-misas").addEventListener("change", (e) => {
    if (e.target.id !== "nuevo-momento") return;
    let nombre = e.target.value;
    if (nombre === "__otro") nombre = prompt("Nombre del momento (por ejemplo: Bautismo, Bendición de los ramos):") || "";
    agregarMomento(nombre);
    e.target.value = "";
  });

  $("#lista-biblioteca").addEventListener("change", (e) => {
    if (e.target.dataset.accion === "marcar") marcarCancion(e.target.dataset.id, e.target.checked);
  });
  $("#lista-biblioteca").addEventListener("click", (e) => {
    const b = e.target.closest('[data-accion="ver"]');
    if (b) verCancion(b.dataset.id);
  });
  $("#bib-solo-momento").addEventListener("change", pintarBiblioteca);

  $("#lienzo-momento").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accion]");
    if (!b) return;
    if (b.dataset.accion === "usar") marcarCancion(b.dataset.id, true);
    else if (b.dataset.accion === "volver") mostrarCancionDelMomento();
    else if (b.dataset.accion === "pestana") {
      st.indice = +b.dataset.i;
      mostrarCancionDelMomento();
      pintarBiblioteca();
    }
  });

  $("#trasponedor").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tono]");
    if (b && st.tonoOriginal) transponer(+b.dataset.tono - st.tonoOriginal.idx);
  });
  $("#bajar").addEventListener("click", () => transponer((st.vista?.desplazamiento || 0) - 1));
  $("#subir").addEventListener("click", () => transponer((st.vista?.desplazamiento || 0) + 1));

  const buscar = $("#buscar");
  buscar.addEventListener("input", () => {
    st.busqueda = buscar.value;
    pintarBiblioteca();
  });
  $("#form-buscar").addEventListener("submit", (e) => {
    e.preventDefault();
    st.busqueda = buscar.value;
    pintarBiblioteca();
    if (movil()) abrirCajon("biblioteca");
  });

  $("#abrir-cancioneros").addEventListener("click", () => abrirCajon("cancioneros"));
  $("#abrir-biblioteca").addEventListener("click", () => abrirCajon("biblioteca"));
  $("#velo").addEventListener("click", cerrarCajones);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector("dialog[open]")) cerrarCajones();
  });

  const cabecera = $("#cabecera");
  new ResizeObserver(() => document.body.style.setProperty("--cab-h", cabecera.offsetHeight + "px")).observe(cabecera);

  window.addEventListener("beforeunload", (e) => {
    if (sucio()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  conectarGuardar();
  conectarCoro();
  conectarSubir();
}

async function iniciar() {
  initNavSitio();
  const p = new URLSearchParams(location.search);
  const s = st.sesion;
  const pedida = p.get("comunidad");
  st.comunidad = pedida != null ? pedida : s && COMUNIDADES.some((c) => c.slug === s.comunidad) ? s.comunidad : "";
  if (!COMUNIDADES.some((c) => c.slug === st.comunidad)) st.comunidad = "";
  pintarSelectorComunidad();
  pintarUsuario();
  pintarTrasponedor();
  conectarEventos();
  await Promise.all([cargarBiblioteca(), cargarMisas()]);
  const id = p.get("cancionero");
  if (id && !st.misas.some((m) => m.id === id)) {
    try {
      const todas = (await leer({ accion: "misas" })).misas || [];
      const m = todas.find((x) => x.id === id);
      if (m) {
        st.comunidad = m.comunidad;
        pintarSelectorComunidad();
        await cargarMisas();
      }
    } catch (_) { /* se muestra la lista igual */ }
  }
  pintarTodo();
  if (id && st.misas.some((m) => m.id === id)) abrirMisa(id);
  else actualizarUrl();
}

iniciar();
