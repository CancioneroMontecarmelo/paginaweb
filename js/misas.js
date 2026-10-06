/**
 * misas.js — Pantalla Misas (misas.html), común a todas las comunidades.
 *
 *  - Panel derecho: cancioneros de misa de la comunidad y sus momentos; «Agregar nuevo» pide nombre y fecha,
 *    arma los momentos con cantos sugeridos y «Publicar» los guarda y arma su página en el Drive.
 *  - Panel izquierdo: la Biblioteca, con dos pestañas: canciones (filtradas por la etiqueta del momento
 *    elegido, con checks) y las lecturas del día de la misa (eucaristiadiaria.cl, por el Apps Script).
 *  - Centro: la canción con acordes (transpuesta) y sus audios.
 *  - Diálogos: cancionero nuevo, publicar, guardar (fechas, ensayos y asistencia), coro, canciones y audios.
 *
 * Usa los scripts clásicos del editor cargados antes en la página (acordes, markdown, etiquetas, render)
 * más js/misas-shim.js. Los datos viven en el Drive a través del Apps Script (backend/Code.gs).
 */

import { llamarApi, sesionActual, puedeEditar, initNavSitio, comunidadesOpciones, ROLES } from "./auth.js";
import { COMUNIDADES } from "./comunidades.js";
import { aM4a, esAudio, esM4a, grabador } from "./audio-aac.js";
import { leerEtiquetasAudio } from "./etiquetas-audio.js";
import { activarPosturas } from "./posturas.js";
import { botonesPartituras } from "./partituras.js";
import { crearMezclador, pistasDeVoces } from "./voces.js";
import {
  MOMENTOS_MISA, TIEMPOS, claveMomento, esDelMomento, momentoPorLetra, ordenMomento, hoyIso, proximoDomingo, fechaLarga,
  tituloLiturgico, tiempoPorFecha, momentosDeMisa, sugerirCantos as sugerirDeLaBiblioteca,
  fechaEscrita, calendarioLiturgico, nombreDelDia
} from "./liturgia.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => escapeHtml(s == null ? "" : s);
const token = () => (sesionActual() || {}).token || "";
const movil = () => matchMedia("(max-width: 960px)").matches;

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
  busqueda: "",
  pestana: "canciones", // pestaña de la Biblioteca: canciones | lecturas
  lecturas: new Map(), // fecha → { cargando, datos, error, promesa }
  vivo: null // { codigo, misaId, enviado, reloj } mientras se dirige en vivo
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

const firma = (a) => JSON.stringify([a.nombre, a.comunidad, a.fechaUso, a.fechaLecturas || "", a.lecturas === undefined ? "" : a.lecturas,
  a.tiempoLiturgico, a.coroId, a.momentos]);
const sucio = () => !!st.actual && (st.actual.borrador || firma(st.actual) !== st.original);
const editable = () => !!st.actual && puedeEditar(st.actual.comunidad || undefined);
const momentoActual = () => st.actual?.momentos[st.momento] || null;
const tituloDe = (id) => st.porId.get(id)?.titulo || "Canción que ya no está en la Biblioteca";
const nombreComunidad = (slug) => COMUNIDADES.find((c) => c.slug === slug)?.nombre || (slug === "parroquia" ? "Parroquia (todas)" : "");

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
  guardarActivo();
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
  const mover = ed && a.momentos.length > 1;
  const items = a.momentos.map((m, i) => {
    const titulos = m.canciones.map((c) => esc(tituloDe(c.cancionId)) +
      (c.sugerida && ed ? ' <em class="sugerida" title="La sugirió el sistema: tocá el momento para cambiarla">sugerida</em>' : "")).join(" · ");
    return `<li class="momento${i === st.momento ? " activo" : ""}" data-i="${i}">
      ${mover ? `<button type="button" class="arrastrar" data-i="${i}" title="Arrastrá para cambiar el orden (o usá las flechas ↑ ↓)" aria-label="Mover ${esc(m.momento)}">⠿</button>` : ""}
      <button type="button" class="momento-boton" data-accion="momento" data-i="${i}">
        <b>${esc(m.momento)}</b>
        <span class="canciones-momento${titulos ? "" : " vacio"}">${titulos || esc(ed ? "Elegí una canción →" : "Sin canción")}</span>
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
      <button type="button" class="btn-chico btn-atril" data-accion="atril" title="Abre las canciones de este cancionero en el atril del editor, en una pestaña nueva">▶ Atril</button>
      <button type="button" class="btn-chico btn-atril" data-accion="reproducir" title="Escuchar este cancionero en el reproductor, con la letra de cada canción">♪ Reproducir</button>
      ${ed && !a.borrador ? `<button type="button" class="btn-chico btn-atril${st.vivo?.misaId === a.id ? " en-vivo" : ""}" data-accion="vivo" title="El coro sigue en sus celulares la canción que vas eligiendo, en su tono">${st.vivo?.misaId === a.id ? "● En vivo" : "📡 En vivo"}</button>` : ""}
      ${ed ? `<button type="button" class="btn-chico" data-accion="guardar">${a.borrador ? "Guardar…" : sucio() ? "Guardar cambios…" : "Fechas y ensayos…"}</button>` : ""}
      ${ed && st.biblioteca.length ? '<button type="button" class="btn-chico" data-accion="sugerir" title="Vuelve a elegir los cantos de los momentos que siguen con la sugerencia del sistema o vacíos">Volver a sugerir</button>' : ""}
      ${ed && sucio() && !a.borrador ? '<button type="button" class="btn-chico" data-accion="descartar">Descartar cambios</button>' : ""}
      <button type="button" class="btn-chico" data-accion="cerrar">${a.borrador ? "Descartar" : "Cerrar"}</button>
    </div>
    ${publicadaHtml(a)}
    ${ed ? `<button type="button" class="btn btn-primario btn-publicar" data-accion="publicar">${a.drive ? sucio() ? "Publicar cambios" : "Publicar de nuevo" : "Publicar"}</button>` : ""}`;
}

function publicadaHtml(a) {
  if (!a.drive?.folderId) return "";
  const cuando = a.publicada ? new Date(a.publicada).toLocaleDateString("es", { day: "numeric", month: "short" }) : "";
  return `<p class="misa-publicada">Publicado${cuando ? " el " + esc(cuando) : ""}:
    ${a.drive.htmlId ? `<a href="${esc(urlVer(a.drive.htmlId))}" target="_blank" rel="noopener">ver la página</a> ·` : ""}
    <a href="${esc(urlEditor(a.drive.folderId))}" target="_blank" rel="noopener">editar en el editor</a></p>`;
}

const urlVer = (htmlId) => new URL("ver.html?id=" + encodeURIComponent(htmlId), location.href).href;
const urlEditor = (folderId) => new URL("editor/?drive=" + encodeURIComponent(folderId), location.href).href;

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
  soltarActivo();
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

// Borrador con los momentos de la misa y un canto sugerido en cada uno (lecturas: null si no están)
function crearBorrador({ nombre, fecha, comunidad, lecturas }) {
  const s = st.sesion || {};
  const { tiempo, momentos } = momentosDeMisa(fecha, lecturas);
  st.actual = {
    id: "nuevo",
    borrador: true,
    nombre,
    comunidad,
    fechaUso: fecha,
    tiempoLiturgico: tiempo,
    coroId: "",
    momentos,
    autorNombre: s.nombre || s.email || ""
  };
  st.original = "";
  const sugeridos = sugerirCantos(st.actual, lecturas);
  st.momento = 0;
  st.indice = 0;
  cambiarPestana("lecturas");
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
  actualizarUrl();
  avisar(sugeridos
    ? `Se sugirieron cantos para ${sugeridos} ${sugeridos === 1 ? "momento" : "momentos"}. Tocá un momento para cambiar su canto.`
    : "Tocá cada momento para elegir sus cantos en la Biblioteca.");
  if (movil()) abrirCajon("cancioneros");
}

function elegirMomento(i) {
  st.momento = i;
  st.indice = 0;
  if (st.pestana !== "canciones") cambiarPestana("canciones");
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

// El sacerdote o la liturgia pueden pedir otro orden: el momento elegido sigue elegido donde quede
function moverMomento(desde, hacia) {
  const lista = st.actual?.momentos;
  if (!lista || hacia === desde || hacia < 0 || hacia >= lista.length) return false;
  const activo = lista[st.momento];
  lista.splice(hacia, 0, lista.splice(desde, 1)[0]);
  if (activo) st.momento = lista.indexOf(activo);
  pintarMisas();
  return true;
}

const copiaParaAtril = (a) => ({
  id: a.id, nombre: a.nombre || "Cancionero nuevo", comunidad: a.comunidad, fechaUso: a.fechaUso, tiempoLiturgico: a.tiempoLiturgico,
  momentos: a.momentos.map((m) => ({ momento: m.momento, canciones: m.canciones.map(({ cancionId, desplazamiento }) => ({ cancionId, desplazamiento })) }))
});

// El cancionero abierto aquí es el «activo»: el botón Atril del editor lo ofrece (editor/js/nube.js, mcAtrilActivo).
// «t» cambia solo cuando cambia el contenido, para que el editor sepa si ya lo tiene cargado.
const MC_ACTIVO = "mc-activo";
let activoFirma = "";
function guardarActivo() {
  const a = st.actual;
  if (!a || !a.momentos.some((m) => m.canciones.length)) return;
  const copia = copiaParaAtril(a);
  const f = JSON.stringify(copia);
  if (f === activoFirma) return;
  try {
    localStorage.setItem(MC_ACTIVO, JSON.stringify({ ...copia, t: Date.now() }));
    activoFirma = f;
  } catch (_) { /* sin espacio: el editor sigue con sus pestañas */ }
}
function soltarActivo() {
  activoFirma = "";
  try { localStorage.removeItem(MC_ACTIVO); } catch (_) {}
}

function abrirAtril() {
  const a = st.actual;
  if (!a) return;
  if (!a.momentos.some((m) => m.canciones.length)) return avisar("Este cancionero todavía no tiene canciones.", true);
  const copia = { ...copiaParaAtril(a), t: Date.now() };
  let copiada = true;
  try {
    localStorage.setItem("mc-atril", JSON.stringify(copia));
  } catch (_) {
    copiada = false; // el atril lee la versión guardada
  }
  if (a.borrador && !copiada) return avisar("Guardá el cancionero para abrirlo en el atril.", true);
  window.open(new URL("editor/?atril=1&misa=" + encodeURIComponent(a.id), location.href).href, "_blank");
}

// El reproductor usa esta copia (con los cambios sin guardar) si es del mismo cancionero; si no, la del servidor
function abrirReproductor() {
  const a = st.actual;
  if (!a) return;
  if (!a.momentos.some((m) => m.canciones.length)) return avisar("Este cancionero todavía no tiene canciones.", true);
  let copiada = true;
  try {
    localStorage.setItem("mc-reproducir", JSON.stringify({ ...copiaParaAtril(a), t: Date.now() }));
  } catch (_) {
    copiada = false;
  }
  if (a.borrador && !copiada) return avisar("Guardá el cancionero para escucharlo en el reproductor.", true);
  window.open(new URL("reproductor.html#misa=" + encodeURIComponent(a.id), location.href).href, "_blank");
}

// ============ EN VIVO (quien dirige) ============
// El coro sigue desde reproductor.html#vivo=<código>. Cada canción o tono que se elige aquí se envía con
// moverVivo, esperando un instante por si se cambia varias veces seguidas.

const enlaceVivo = (codigo) => new URL("reproductor.html#vivo=" + codigo, location.href).href;

function pintarFranjaVivo() {
  const v = st.vivo;
  $("#franja-vivo").hidden = !v;
  if (!v) return;
  $("#vivo-codigo").textContent = v.codigo;
  $("#vivo-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(
    `Seguí en vivo los cantos de «${v.nombre}» (código ${v.codigo}): ${enlaceVivo(v.codigo)}`);
}

async function iniciarVivo() {
  const a = st.actual;
  if (!a || a.borrador) return avisar("Guardá el cancionero antes de transmitirlo en vivo.", true);
  if (st.vivo?.misaId === a.id) return copiarEnlaceVivo();
  try {
    const r = await llamarApi("iniciarVivo", { token: token(), misaId: a.id });
    st.vivo = { codigo: r.codigo, misaId: a.id, nombre: a.nombre, enviado: "", reloj: 0 };
    try { sessionStorage.setItem("mc-vivo", JSON.stringify({ codigo: r.codigo, misaId: a.id, nombre: a.nombre })); } catch (_) {}
    pintarFranjaVivo();
    pintarMisas();
    avisar(`En vivo con el código ${r.codigo}: compartí el enlace con el coro.`);
    programarVivo(0);
  } catch (e) {
    avisar(e.message, true);
  }
}

function programarVivo(espera = 700) {
  const v = st.vivo;
  if (!v || st.actual?.id !== v.misaId || !st.vista) return;
  clearTimeout(v.reloj);
  v.reloj = setTimeout(enviarVivo, espera);
}

async function enviarVivo() {
  const v = st.vivo;
  if (!v || st.actual?.id !== v.misaId || !st.vista) return;
  const datos = { cancionId: st.vista.cancionId, desplazamiento: st.vista.desplazamiento || 0, momento: momentoActual()?.momento || "" };
  const firma = JSON.stringify(datos);
  if (firma === v.enviado) return;
  v.enviado = firma;
  try {
    await llamarApi("moverVivo", { token: token(), codigo: v.codigo, ...datos });
  } catch (e) {
    v.enviado = "";
    avisar("En vivo: " + e.message, true);
  }
}

async function copiarEnlaceVivo() {
  const url = enlaceVivo(st.vivo.codigo);
  try {
    await navigator.clipboard.writeText(url);
    avisar("Enlace copiado: " + url);
  } catch (_) {
    prompt("Copiá el enlace para el coro:", url);
  }
}

async function terminarVivo() {
  const v = st.vivo;
  if (!v || !confirm("¿Terminar la transmisión en vivo? Al coro le va a aparecer «Terminó».")) return;
  clearTimeout(v.reloj);
  try {
    await llamarApi("terminarVivo", { token: token(), codigo: v.codigo });
  } catch (e) {
    avisar(e.message, true);
  }
  st.vivo = null;
  try { sessionStorage.removeItem("mc-vivo"); } catch (_) {}
  pintarFranjaVivo();
  pintarMisas();
}

function conectarVivo() {
  $("#vivo-copiar").addEventListener("click", copiarEnlaceVivo);
  $("#vivo-terminar").addEventListener("click", terminarVivo);
  try {
    const guardado = JSON.parse(sessionStorage.getItem("mc-vivo") || "null");
    if (guardado?.codigo) st.vivo = { ...guardado, enviado: "", reloj: 0 };
  } catch (_) {}
  pintarFranjaVivo();
}

function mostrarCancionDelMomento() {
  const c = momentoActual()?.canciones[st.indice];
  st.vista = c ? { cancionId: c.cancionId, desplazamiento: c.desplazamiento || 0, ref: editable() ? c : null } : null;
  pintarLienzo();
}

// ============ PANEL DERECHO: BIBLIOTECA ============

function pintarBiblioteca() {
  if (st.pestana === "lecturas") pintarLecturas();
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
  const consulta = st.busqueda.trim();
  const buscadas = consulta ? buscarCanciones(st.biblioteca, consulta) : st.biblioteca;
  let grupos;
  if (soloMomento) {
    // Primero las que tienen la etiqueta del momento; después las que lo sugieren por el título o la letra
    const conEtiqueta = buscadas.filter((c) => esDelMomento(c, m.momento));
    const porLetra = buscadas.filter((c) => !esDelMomento(c, m.momento))
      .map((c, i) => ({ c, i, r: momentoPorLetra(c, m.momento) })).filter((x) => x.r)
      .sort((a, b) => (consulta ? 0 : a.r.orden - b.r.orden) || a.i - b.i);
    grupos = [
      { lista: conEtiqueta },
      { lista: porLetra.map((x) => x.c), motivo: new Map(porLetra.map((x) => [x.c.id, x.r])),
        titulo: `Sin la etiqueta «${m.momento}», pero su título o su letra lo sugieren` }
    ];
  } else {
    grupos = [{ lista: buscadas }];
  }
  if (!grupos.some((g) => g.lista.length)) {
    const motivo = soloMomento
      ? `No hay canciones para «${m.momento}»${consulta ? " que coincidan con la búsqueda" : ""}. Desmarcá «Solo canciones de…» para ver todas.`
      : "Ninguna canción coincide con la búsqueda.";
    cont.innerHTML = `<p class="aviso">${esc(motivo)}</p>`;
    return;
  }
  const elegidas = new Set(m ? m.canciones.map((c) => c.cancionId) : []);
  const claveM = m ? claveMomento(m.momento) : "";
  const fila = (c, motivo) => {
    const audios = (c.audios || []).length;
    const meta = [c.tono, audios ? `♪ ${audios} audio${audios > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
    const etiquetas = (c.etiquetas || []).filter((t) => tagNorm(t) !== "catolico").slice(0, 6)
      .map((t) => `<span${claveM && claveMomento(t) === claveM ? ' class="coincide"' : ""}>${esc(t)}</span>`).join("");
    const linea = consulta ? fragmentoLetra(c, consulta) : "";
    const porque = motivo ? `<span class="bib-motivo">${motivo.como === "titulo" ? "Por el título" : `Su letra dice «${esc(motivo.palabra)}»`}</span>` : "";
    return `<div class="bib-cancion${st.vista?.cancionId === c.id ? " en-lienzo" : ""}">
      ${ed ? `<input type="checkbox" data-accion="marcar" data-id="${esc(c.id)}"${elegidas.has(c.id) ? " checked" : ""} aria-label="Usar «${esc(c.titulo)}» en ${esc(m.momento)}">` : ""}
      <button type="button" class="bib-ver" data-accion="ver" data-id="${esc(c.id)}">
        <strong>${esc(c.titulo)}</strong>${meta ? `<small>${esc(meta)}</small>` : ""}
        ${linea ? `<span class="bib-letra">${linea}</span>` : ""}${porque}
        ${etiquetas ? `<span class="bib-etiquetas">${etiquetas}</span>` : ""}
      </button>
    </div>`;
  };
  cont.innerHTML = grupos.filter((g) => g.lista.length).map((g) =>
    (g.titulo ? `<p class="bib-grupo">${esc(g.titulo)}</p>` : "") + g.lista.map((c) => fila(c, g.motivo?.get(c.id))).join("")).join("");
}

function marcarCancion(id, usar) {
  const m = momentoActual();
  if (!m || !editable()) return;
  // Elegir una canción a mano reemplaza a la sugerida (o la confirma si es la misma)
  if (usar) m.canciones = m.canciones.filter((c) => !c.sugerida || c.cancionId === id);
  const i = m.canciones.findIndex((c) => c.cancionId === id);
  if (usar) {
    if (i < 0) m.canciones.push({ cancionId: id, desplazamiento: 0 });
    else delete m.canciones[i].sugerida;
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

// ============ BIBLIOTECA: LECTURAS DEL DÍA ============

function cambiarPestana(p) {
  st.pestana = p;
  document.querySelectorAll(".bib-pestanas .modo").forEach((b) => {
    const activa = b.dataset.pestana === p;
    b.classList.toggle("activo", activa);
    b.setAttribute("aria-selected", String(activa));
  });
  $("#lista-biblioteca").hidden = p !== "canciones";
  $("#bib-cab-canciones").hidden = p !== "canciones";
  $("#lista-lecturas").hidden = p !== "lecturas";
  $("#lect-sub").hidden = p !== "lecturas";
  if (p === "lecturas") pintarLecturas();
}

// clave: una fecha (lecturas del día) o «misa:<id>» (las corregidas a mano de ese cancionero)
function cargarLecturas(clave) {
  if (!clave) return Promise.resolve(null);
  let e = st.lecturas.get(clave);
  if (!e) {
    e = { cargando: true, datos: null, error: "" };
    const pedido = clave.startsWith("misa:") ? { accion: "lecturas", misa: clave.slice(5) } : { accion: "lecturas", fecha: clave };
    e.promesa = leer(pedido)
      .then((r) => { e.datos = r.lecturas; }, (err) => { e.error = err.message; })
      .finally(() => {
        e.cargando = false;
        if (st.pestana === "lecturas") pintarLecturas();
      });
    st.lecturas.set(clave, e);
  }
  return e.promesa.then(() => {
    if (e.error) throw new Error(e.error);
    return e.datos;
  });
}

// Lecturas de un cancionero: las corregidas en esta pantalla (a.lecturas), las corregidas guardadas
// (a.lecturasPropias) o las del día elegido para las lecturas (fechaLecturas; si no, la fecha de la misa).
// a.lecturas === null: se pidió volver a las del día (se borra el texto propio al guardar).
const fechaDeLecturas = (a) => a?.fechaLecturas || a?.fechaUso || "";
const usaPropiasGuardadas = (a) => !!a?.lecturasPropias && a.lecturas === undefined && !a.borrador;
const claveLecturas = (a) => usaPropiasGuardadas(a) ? "misa:" + a.id : fechaDeLecturas(a);
function lecturasDe(a) {
  if (a?.lecturas) return Promise.resolve({ ...a.lecturas, disponible: true, propias: true });
  return cargarLecturas(claveLecturas(a));
}

// Cancionero cuyas lecturas se están corrigiendo (al abrir otro, se deja de corregir)
let editandoLecturas = null;

function pintarLecturas() {
  const cont = $("#lista-lecturas");
  const a = st.actual;
  const fecha = fechaDeLecturas(a);
  const clave = a ? claveLecturas(a) : "";
  const e = !a?.lecturas && clave ? st.lecturas.get(clave) : null;
  const editando = !!a && editandoLecturas === a && editable();
  const firmaVista = [a ? a.id : "", clave, a?.lecturas ? JSON.stringify(a.lecturas) : "", editando, editable(),
    e ? (e.cargando ? "c" : e.error ? "e" : "ok") : "-"].join("|");
  $("#lect-sub").textContent = a?.fechaUso
    ? `Misa del ${fechaLarga(a.fechaUso)}${a.fechaLecturas && a.fechaLecturas !== a.fechaUso ? ` · lecturas del ${fechaLarga(a.fechaLecturas)}` : ""}` : "";
  if (pintarLecturas.clave === firmaVista && cont.childElementCount) return;
  pintarLecturas.clave = firmaVista;
  const aviso = (t) => `<p class="aviso">${esc(t)}</p>`;
  if (!a) {
    cont.innerHTML = aviso("Elegí o creá un cancionero para ver las lecturas del día de esa misa.");
    return;
  }
  if (!fecha && !a.lecturas) {
    cont.innerHTML = aviso("Este cancionero no tiene fecha. Ponésela con «Fechas y ensayos…» para ver sus lecturas.") + herramientasLecturas(null);
    return;
  }
  if (!a.lecturas && !e) {
    cargarLecturas(clave).catch(() => {});
    return pintarLecturas();
  }
  if (e?.cargando) {
    cont.innerHTML = aviso("Cargando las lecturas…");
    return;
  }
  if (e?.error) {
    cont.innerHTML = aviso("No se pudieron traer las lecturas: " + e.error) +
      '<button type="button" class="btn-chico" data-accion="reintentar-lecturas">Reintentar</button>' + herramientasLecturas(null);
    return;
  }
  const l = a.lecturas ? { ...a.lecturas, disponible: true, propias: true } : e.datos;
  if (editando) {
    cont.innerHTML = editorLecturas(l?.disponible ? l : null);
    return;
  }
  const fuente = l.propias ? '<p class="lect-fuente">Texto corregido para este cancionero.</p>'
    : `<p class="lect-fuente">Fuente: <a href="${esc(l.fuente)}" target="_blank" rel="noopener">eucaristiadiaria.cl</a>,
    Área de Liturgia del Arzobispado de Santiago.</p>`;
  if (!l.disponible) {
    cont.innerHTML = herramientasLecturas(l) +
      aviso(`Las lecturas del ${fechaLarga(fecha)} todavía no están publicadas: eucaristiadiaria.cl las publica mes a mes. Volvé a mirar más cerca de la fecha, usá otra fecha o escribilas con «Escribir las lecturas».`) + fuente;
    return;
  }
  const bloque = (b) => {
    const x = esc(b.x).replace(/\n/g, "<br>");
    if (b.t === "h") return `<h4>${x}</h4>`;
    if (b.t === "c") return `<p class="lect-cita">${x}</p>`;
    if (b.t === "e") return `<p class="lect-lema">${x}</p>`;
    return `<p>${x}</p>`;
  };
  cont.innerHTML = herramientasLecturas(l) + `<div class="lect-cabeza">
      <strong>${esc(tituloLiturgico(l.titulo) || l.dia || (fecha ? nombreDelDia(fecha) : ""))}</strong>
      <small>${esc([l.dia || (fecha ? fechaLarga(fecha) : ""), l.color && "Color " + l.color.toLowerCase()].filter(Boolean).join(" · "))}</small>
    </div>
    ${l.secciones.map((s) => `<details class="lect-seccion"${s.id === "liturgia" || s.id === "evangelio" || l.propias ? " open" : ""}>
      <summary>${esc(s.nombre)}</summary>${s.bloques.map(bloque).join("")}</details>`).join("")}
    ${fuente}`;
}

// De qué día son las lecturas y, para quien puede editar: usar otra fecha, corregir el texto o volver a las del día
function herramientasLecturas(l) {
  const a = st.actual;
  const fecha = fechaDeLecturas(a);
  const propias = !!a.lecturas || usaPropiasGuardadas(a);
  const otraFecha = a.fechaLecturas && a.fechaLecturas !== a.fechaUso;
  const de = propias ? "Lecturas corregidas para este cancionero"
    : fecha ? `Lecturas del ${fechaLarga(fecha)}${otraFecha ? " (no es el día de la misa)" : ""}` : "";
  if (!editable()) return de ? `<p class="lect-de">${esc(de)}</p>` : "";
  return `<div class="lect-herramientas">
      ${de ? `<p class="lect-de">${esc(de)}</p>` : ""}
      <label class="lect-otra-fecha">Tomar las lecturas del día
        <input type="date" id="lect-fecha" value="${esc(fecha)}">
      </label>
      <div class="lect-botones">
        <button type="button" class="btn-chico" data-accion="lect-editar">${propias ? "Seguir corrigiendo" : l?.disponible ? "Corregir el texto" : "Escribir las lecturas"}</button>
        ${propias || otraFecha ? '<button type="button" class="btn-chico" data-accion="lect-originales">Volver a las del día de la misa</button>' : ""}
      </div>
    </div>`;
}

// Cada lectura: su nombre y el texto (párrafos separados por una línea en blanco; «# » al comienzo = título)
function editorLecturas(l) {
  const secciones = l?.secciones?.length ? l.secciones
    : [{ id: "liturgia", nombre: "Liturgia de la Palabra", bloques: [] }, { id: "evangelio", nombre: "Evangelio", bloques: [] }];
  const texto = (s) => s.bloques.map((b) => (b.t === "h" ? "# " : "") + b.x).join("\n\n");
  return `<div class="lect-editor">
      <label>Celebración <input type="text" id="lect-titulo" maxlength="200" value="${esc(l?.titulo || nombreDelDia(fechaDeLecturas(st.actual)) || "")}"></label>
      ${secciones.map((s) => `<fieldset class="lect-ed-seccion" data-id="${esc(s.id)}">
        <div class="lect-ed-cab"><input type="text" class="lect-ed-nombre" maxlength="80" value="${esc(s.nombre)}" aria-label="Nombre de la lectura">
          <button type="button" class="btn-chico" data-accion="lect-quitar">Quitar</button></div>
        <textarea class="lect-ed-texto" rows="8" aria-label="Texto de ${esc(s.nombre)}">${esc(texto(s))}</textarea>
      </fieldset>`).join("")}
      <p class="lect-ayuda">Separá los párrafos con una línea en blanco. Un párrafo que empieza con «# » se muestra como título.</p>
      <div class="lect-botones">
        <button type="button" class="btn-chico" data-accion="lect-agregar">+ Agregar lectura</button>
        <span class="espacio"></span>
        <button type="button" class="btn-chico" data-accion="lect-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primario" data-accion="lect-listo">Listo</button>
      </div>
    </div>`;
}

function leerEditorLecturas(base) {
  const tipos = new Map((base?.secciones || []).flatMap((s) => s.bloques.map((b) => [b.x.trim(), b.t])));
  const secciones = [...document.querySelectorAll(".lect-ed-seccion")].map((f) => ({
    id: f.dataset.id || "propia",
    nombre: f.querySelector(".lect-ed-nombre").value.trim() || "Lectura",
    bloques: f.querySelector(".lect-ed-texto").value.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      .map((p) => /^#\s+/.test(p) ? { t: "h", x: p.replace(/^#\s+/, "") } : { t: tipos.get(p) || "p", x: p })
  })).filter((s) => s.bloques.length);
  return { titulo: $("#lect-titulo").value.trim(), dia: base?.dia || "", color: base?.color || "", secciones };
}

function lecturasCambiadas() {
  pintarLecturas();
  pintarMisas();
}

async function accionLecturas(accion, boton) {
  const a = st.actual;
  if (!a || !editable()) return;
  if (accion === "lect-editar") {
    editandoLecturas = a;
    return pintarLecturas();
  }
  if (accion === "lect-cancelar") {
    editandoLecturas = null;
    return pintarLecturas();
  }
  if (accion === "lect-agregar") {
    const f = document.createElement("fieldset");
    f.className = "lect-ed-seccion";
    f.dataset.id = "propia";
    f.innerHTML = `<div class="lect-ed-cab"><input type="text" class="lect-ed-nombre" maxlength="80" value="Lectura" aria-label="Nombre de la lectura">
      <button type="button" class="btn-chico" data-accion="lect-quitar">Quitar</button></div>
      <textarea class="lect-ed-texto" rows="8" aria-label="Texto de la lectura"></textarea>`;
    document.querySelector(".lect-ayuda").before(f);
    return f.querySelector("input").select();
  }
  if (accion === "lect-quitar") return boton.closest(".lect-ed-seccion").remove();
  if (accion === "lect-listo") {
    let base = null;
    try { base = await lecturasDe(a); } catch (_) { /* se guarda lo escrito */ }
    const l = leerEditorLecturas(base?.disponible ? base : null);
    if (!l.secciones.length) return avisar("Escribí al menos una lectura, o tocá «Cancelar».", true);
    a.lecturas = l;
    editandoLecturas = null;
    lecturasCambiadas();
    return avisar("Lecturas corregidas. Guardá el cancionero para que queden.");
  }
  if (accion === "lect-originales") {
    a.lecturas = a.lecturasPropias && !a.borrador ? null : undefined;
    a.fechaLecturas = "";
    return lecturasCambiadas();
  }
}

function cambiarFechaLecturas(fecha) {
  const a = st.actual;
  if (!a || !editable() || !fecha) return;
  if ((a.lecturas || usaPropiasGuardadas(a)) && !confirm("Las lecturas corregidas a mano se reemplazan por las de ese día. ¿Seguir?")) {
    pintarLecturas.clave = "";
    return pintarLecturas();
  }
  a.lecturas = a.lecturasPropias && !a.borrador ? null : undefined;
  a.fechaLecturas = fecha === a.fechaUso ? "" : fecha;
  lecturasCambiadas();
}

// Sugerencias de js/liturgia.js con la Biblioteca y los cancioneros cargados en esta pantalla
const sugerirCantos = (misa, lecturas, opciones = {}) =>
  sugerirDeLaBiblioteca(misa, lecturas, { ...opciones, biblioteca: st.biblioteca, misas: st.misas });

async function volverASugerir() {
  const a = st.actual;
  if (!a || !editable()) return;
  let l = null;
  try { l = await lecturasDe(a); } catch (_) { /* se sugiere solo con el tiempo litúrgico */ }
  if (st.actual !== a) return;
  const n = sugerirCantos(a, l?.disponible ? l : null, { reemplazar: true });
  st.indice = 0;
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
  avisar(n ? `Cantos sugeridos para ${n} ${n === 1 ? "momento" : "momentos"}. Los elegidos a mano no se tocaron.`
    : "No hay canciones de la Biblioteca para estos momentos (ni por etiqueta ni por su título o letra).");
}

// ============ LIENZO CENTRAL ============

let turnoLienzo = 0;

async function pintarLienzo() {
  const turno = ++turnoLienzo;
  pintarCabecera();
  pintarBarraMomento();
  const v = st.vista;
  const box = $("#cancion");
  if (mezclador && mezclador.cancionId !== v?.cancionId) mezclador.cerrar();
  programarVivo();
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
  mcCancionActual = { tags: cancion.tags || entrada.etiquetas, credits: creditosDe(cancion, entrada) };
  box.innerHTML = cancion.text.trim() ? renderSong(cancion.title || entrada.titulo, texto, tono)
    : `<div class="lienzo-vacio"><p><b>${esc(cancion.title || entrada.titulo)}</b></p>
      <p>Por ahora esta canción tiene solo audio: la letra y los acordes se agregan en el editor.</p></div>`;
  pintarTrasponedor();
  pintarAudios(entrada);
}

// Los del .md mandan; las canciones guardadas antes de tener créditos pueden traerlos solo en biblioteca.json
const creditosDe = (cancion, entrada) => normalizeCredits({
  letra: cancion.credits?.letra || entrada.letraDe, musica: cancion.credits?.musica || entrada.musicaDe
});

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

const reproduceWebm = !!document.createElement("audio").canPlayType('audio/webm; codecs="opus"');

let mezclador = null;

// Las voces se piden por el respaldo del Apps Script: Web Audio necesita los bytes, sin restricciones entre sitios
async function bytesDeAudio(fileId) {
  const r = await leer({ accion: "audio", id: fileId });
  return Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0)).buffer;
}

function botonVoces(entrada, box) {
  const pistas = pistasDeVoces(entrada.audios);
  if (pistas.length < 2) return null;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn-chico btn-voces";
  b.textContent = "🎚 Aprender las voces";
  b.title = "Escuchar " + pistas.map((p) => VOICES[p.voz]?.label || p.voz).join(", ") + " juntas, con volumen, silencio y solo por voz";
  b.addEventListener("click", () => {
    b.hidden = true;
    const m = crearMezclador({ contenedor: box, pistas, leerAudio: bytesDeAudio,
      alCerrar: () => { box.querySelector(".btn-voces")?.removeAttribute("hidden"); if (mezclador === m) mezclador = null; } });
    mezclador = Object.assign(m, { cancionId: entrada.id, el: box.querySelector(".mezclador") });
    mezclador.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  return b;
}

function pintarAudios(entrada) {
  const box = $("#audios");
  const lista = entrada.audios || [];
  const puedeAgregar = !$("#btn-subir").hidden && (!entrada.comunidad || puedeEditar(entrada.comunidad));
  // Cambiar el tono vuelve a pintar la misma canción: el mezclador sigue sonando
  const sigue = mezclador?.cancionId === entrada.id && pistasDeVoces(entrada.audios).length >= 2 ? mezclador : null;
  if (!sigue) mezclador?.cerrar();
  box.hidden = !lista.length && !puedeAgregar && !entrada.partituras?.length;
  const voces = botonVoces(entrada, box);
  if (sigue) voces.hidden = true;
  box.replaceChildren(...(voces ? [voces] : []), ...(sigue ? [sigue.el] : []), ...lista.map((a) => {
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
  if (puedeAgregar) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-chico btn-mas-audio";
    b.textContent = "+ Audio";
    b.title = "Subir, grabar o quitar audios de esta canción";
    b.addEventListener("click", () => abrirSubir({ modo: "existente", cancionId: entrada.id }));
    box.append(b);
  }
  const partituras = botonesPartituras(entrada, { editable: puedeAgregar, alCambiar: actualizarCancionBib });
  if (partituras) box.append(partituras);
}

// Si el navegador no puede reproducir el enlace directo de Drive, se pide el audio al Apps Script
async function audioDeRespaldo(au, fileId) {
  const aviso = document.createElement("small");
  aviso.textContent = "Cargando el audio desde el Drive…";
  au.after(aviso);
  try {
    const r = await leer({ accion: "audio", id: fileId });
    if (/webm/i.test(r.mime || r.nombre || "") && !reproduceWebm) {
      throw new Error("este audio todavía está en el formato anterior (WebM), que este equipo no reproduce. Cuando la Biblioteca termine de pasar a .m4a va a sonar.");
    }
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
    delete v.ref.sugerida;
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

// ============ DIÁLOGO: CANCIONERO NUEVO ============
// Primero el nombre, después la fecha de la misa (y la comunidad). Con editar: completa los datos
// del cancionero abierto antes de publicarlo.

// fechaTocada: la fecha ya se eligió (a mano, con el buscador o al abrir), así que el nombre no la cambia
const nuevo = { paso: 1, editar: false, fechaTocada: false };

function abrirNuevo({ editar = false, fecha = "" } = {}) {
  if (!editar && !confirmarDescartar()) return;
  const a = editar ? st.actual : null;
  nuevo.editar = editar;
  nuevo.fechaTocada = editar || !!fecha;
  $("#n-buscar-fecha").value = "";
  $("#n-titulo").textContent = editar ? "Datos para publicar" : "Cancionero nuevo";
  $("#n-nombre").value = a?.nombre || (fecha ? `Misa del ${fechaLarga(fecha)}` : "");
  $("#n-fecha").value = a?.fechaUso || fecha || proximoDomingo();
  const comunidades = comunidadesEditables();
  const s = st.sesion || {};
  const pre = [a?.comunidad, st.comunidad, s.comunidad].find((c) => comunidades.some((x) => x.slug === c)) || "";
  $("#n-comunidad").innerHTML = (pre ? "" : '<option value="">Elegí la comunidad</option>') +
    opciones(comunidades.map((c) => [c.slug, c.nombre]), pre);
  $("#n-comunidad-caja").hidden = comunidades.length === 1 && !!pre;
  mostrarError("#n-error", "");
  $("#dlg-nuevo").showModal();
  pasoNuevo(editar && a?.nombre ? 2 : 1);
}

function pasoNuevo(n) {
  nuevo.paso = n;
  $("#n-paso1").hidden = n !== 1;
  $("#n-paso2").hidden = n !== 2;
  $("#n-paso1-marca").classList.toggle("activo", n === 1);
  $("#n-paso2-marca").classList.toggle("activo", n === 2);
  $("#n-atras").hidden = n !== 2;
  $("#n-seguir").textContent = n === 1 ? "Siguiente" : nuevo.editar ? "Publicar" : "Crear cancionero";
  if (n === 1) {
    $("#n-nombre").focus();
    return;
  }
  const nombre = $("#n-nombre").value.trim();
  $("#n-resumen").textContent = `«${nombre}»`;
  // «Misa del 18 de octubre»: la fecha del nombre queda puesta (antes quedaba el próximo domingo)
  const delNombre = fechaEscrita(nombre);
  if (delNombre && !nuevo.fechaTocada) $("#n-fecha").value = delNombre;
  mostrarDiaNuevo();
  pintarFechasNuevo();
  $("#n-fecha").focus();
}

function elegirFechaNuevo(fecha) {
  nuevo.fechaTocada = true;
  $("#n-fecha").value = fecha;
  mostrarDiaNuevo();
  pintarFechasNuevo();
}

async function mostrarDiaNuevo() {
  const fecha = $("#n-fecha").value;
  const el = $("#n-dia");
  const delNombre = fechaEscrita($("#n-nombre").value);
  const aviso = $("#n-aviso-fecha");
  aviso.hidden = !delNombre || !fecha || delNombre === fecha;
  if (!aviso.hidden) {
    aviso.innerHTML = `El nombre dice <b>${esc(fechaLarga(delNombre))}</b>, pero la fecha elegida es <b>${esc(fechaLarga(fecha))}</b>:
      las lecturas y los cantos sugeridos serán de la fecha elegida.
      <button type="button" class="btn-chico" data-fecha="${esc(delNombre)}">Usar ${esc(fechaLarga(delNombre))}</button>`;
  }
  if (!fecha) {
    el.textContent = "";
    return;
  }
  const base = `${fechaLarga(fecha)} · ${nombreDelDia(fecha)}`;
  el.textContent = base + " · buscando las lecturas…";
  let l = null;
  try { l = await cargarLecturas(fecha); } catch (_) { /* sin lecturas: queda el nombre calculado */ }
  if ($("#n-fecha").value !== fecha) return;
  el.textContent = l?.disponible ? `${fechaLarga(fecha)} · ${tituloLiturgico(l.titulo)}`
    : base + (l ? " · las lecturas de esta fecha todavía no están publicadas" : "");
}

// Próximos domingos y fiestas (12 semanas), o los del próximo año que coinciden con lo escrito
function pintarFechasNuevo() {
  const q = $("#n-buscar-fecha").value.trim();
  const hoy = hoyIso();
  const entradas = calendarioLiturgico(hoy, q ? 400 : 84).map((x) => {
    const [, m, d] = x.fecha.split("-").map(Number);
    const mes = new Date(2000, m - 1, 1).toLocaleDateString("es", { month: "long" });
    return { ...x, titulo: x.nombre, etiquetas: [x.numero ? `${x.numero} domingo` : "", `${d} de ${mes}`, `${d}/${m}`, fechaLarga(x.fecha)] };
  });
  let lista = q ? buscarCanciones(entradas, q) : entradas;
  const escrita = q ? fechaEscrita(q, hoy) : "";
  if (escrita) {
    lista = lista.filter((x) => x.fecha !== escrita);
    lista.unshift(entradas.find((x) => x.fecha === escrita) || { fecha: escrita, nombre: nombreDelDia(escrita) });
  }
  const elegida = $("#n-fecha").value;
  $("#n-fechas").innerHTML = lista.slice(0, 14).map((x) => `<li><button type="button" data-fecha="${esc(x.fecha)}"
      class="${x.fecha === elegida ? "elegida" : ""}${x.domingo ? " domingo" : ""}"><b>${esc(fechaLarga(x.fecha))}</b>
      <span>${esc(x.nombre)}</span></button></li>`).join("") ||
    `<li class="aviso">No encontré esa fecha ni esa celebración. Probá con «18 de octubre», «18/10» o el nombre de la fiesta.</li>`;
}

async function enviarNuevo(e) {
  e.preventDefault();
  const nombre = $("#n-nombre").value.trim();
  if (nuevo.paso === 1) {
    if (!nombre) return mostrarError("#n-error", "Escribí el nombre del cancionero.");
    mostrarError("#n-error", "");
    return pasoNuevo(2);
  }
  const fecha = $("#n-fecha").value;
  const comunidad = $("#n-comunidad").value;
  if (!nombre) return pasoNuevo(1);
  if (!fecha) return mostrarError("#n-error", "Elegí la fecha de la misa.");
  if (!comunidad) return mostrarError("#n-error", "Elegí la comunidad.");
  const boton = $("#n-seguir");
  boton.disabled = true;
  boton.textContent = "Preparando…";
  let l = null;
  try {
    l = await Promise.race([cargarLecturas(fecha), new Promise((r) => setTimeout(r, 15000, null))]);
  } catch (_) { /* se arma igual, sin lecturas */ }
  boton.disabled = false;
  $("#dlg-nuevo").close();
  const lecturas = l?.disponible ? l : null;
  if (nuevo.editar && st.actual) {
    const a = st.actual;
    if (a.fechaUso !== fecha || !a.tiempoLiturgico) a.tiempoLiturgico = lecturas?.tiempo || tiempoPorFecha(fecha);
    Object.assign(a, { nombre, fechaUso: fecha, comunidad });
    pintarTodo();
    return publicarCancionero();
  }
  crearBorrador({ nombre, fecha, comunidad, lecturas });
}

function conectarNuevo() {
  $("#form-nuevo").addEventListener("submit", enviarNuevo);
  $("#n-atras").addEventListener("click", () => pasoNuevo(1));
  $("#n-fecha").addEventListener("change", () => elegirFechaNuevo($("#n-fecha").value));
  $("#n-buscar-fecha").addEventListener("input", pintarFechasNuevo);
  $("#n-buscar-fecha").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const b = $("#n-fechas [data-fecha]");
    if (b) elegirFechaNuevo(b.dataset.fecha);
  });
  for (const sel of ["#n-fechas", "#n-aviso-fecha"]) {
    $(sel).addEventListener("click", (e) => {
      const b = e.target.closest("[data-fecha]");
      if (b) elegirFechaNuevo(b.dataset.fecha);
    });
  }
}

// ============ PUBLICAR ============
// Guarda el cancionero y lo abre en el editor (iframe oculto, editor/?misa=…&publicar=1), que arma la
// carpeta con la página .html en el Drive igual que «Guardar en Drive» y avisa por postMessage.

let publicando = false;

function pasoPublicar(texto, valor) {
  $("#p-paso").textContent = texto;
  $("#p-barra").value = valor;
}

async function publicarCancionero() {
  const a = st.actual;
  if (!a || !editable() || publicando) return;
  if (!a.nombre || !COMUNIDADES.some((c) => c.slug === a.comunidad) || !puedeEditar(a.comunidad)) return abrirNuevo({ editar: true });
  if (!a.momentos.some((m) => m.canciones.length)) return avisar("Elegí al menos una canción antes de publicar.", true);
  publicando = true;
  const dlg = $("#dlg-publicar");
  $("#p-titulo").textContent = `Publicando «${a.nombre}»`;
  $("#p-avance").hidden = false;
  $("#p-listo").hidden = true;
  $("#p-copiar").hidden = $("#p-whatsapp").hidden = true;
  $("#p-cerrar").hidden = $("#p-cerrar-x").hidden = true;
  mostrarError("#p-error", "");
  pasoPublicar("Guardando el cancionero…", 0);
  dlg.showModal();
  try {
    // Al publicar, las sugerencias quedan como elegidas
    const momentos = a.momentos.map((m) => ({ momento: m.momento, canciones: m.canciones.map(({ sugerida, ...c }) => c) }));
    let r = await llamarApi("guardarMisa", {
      token: token(),
      misa: { id: a.borrador ? undefined : a.id, nombre: a.nombre, comunidad: a.comunidad, fechaUso: a.fechaUso,
        fechaLecturas: a.fechaLecturas || "", lecturas: a.lecturas, tiempoLiturgico: a.tiempoLiturgico, coroId: a.coroId, momentos }
    });
    await aplicarMisaGuardada(r.misa);
    pasoPublicar("Armando la página del cancionero…", 0.05);
    const fin = await publicarEnDrive(r.misa.id);
    pasoPublicar("Guardando el enlace…", 0.97);
    r = await llamarApi("guardarMisa", { token: token(), misa: { ...r.misa, drive: { folderId: fin.folderId, htmlId: fin.htmlId } } });
    if (!r.misa.drive) throw new Error("El servidor no guardó el enlace de la página publicada.");
    await aplicarMisaGuardada(r.misa);
    mostrarPublicado(r.misa, fin);
  } catch (err) {
    $("#p-avance").hidden = true;
    $("#p-titulo").textContent = "No se pudo publicar";
    mostrarError("#p-error", err.message + (st.actual && !st.actual.borrador ? " El cancionero sí quedó guardado: podés volver a publicar." : ""));
  } finally {
    publicando = false;
    $("#p-cerrar").hidden = $("#p-cerrar-x").hidden = false;
  }
}

function publicarEnDrive(id) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.className = "publicador";
    iframe.title = "Armando la página del cancionero";
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = `./editor/?misa=${encodeURIComponent(id)}&publicar=1`;
    let reloj = 0;
    const vigilar = () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => terminar(new Error("El editor no respondió a tiempo. Revisá la conexión y publicá de nuevo.")), 180000);
    };
    const alMensaje = (e) => {
      if (e.origin !== location.origin || e.source !== iframe.contentWindow) return;
      const d = e.data || {};
      if (d.misa !== id) return;
      if (d.mcPublicar === "avance") {
        vigilar();
        pasoPublicar(d.texto || "Armando la página…", 0.05 + 0.9 * (d.valor || 0));
      } else if (d.mcPublicar === "listo") terminar(null, d);
      else if (d.mcPublicar === "error") terminar(new Error(d.mensaje || "No se pudo armar la página del cancionero."));
    };
    function terminar(err, datos) {
      clearTimeout(reloj);
      removeEventListener("message", alMensaje);
      iframe.remove();
      if (err) reject(err);
      else resolve(datos);
    }
    addEventListener("message", alMensaje);
    vigilar();
    document.body.append(iframe);
  });
}

function mostrarPublicado(misa, fin) {
  const ver = misa.drive?.htmlId ? urlVer(misa.drive.htmlId) : "";
  $("#p-titulo").textContent = "Publicado ✓";
  $("#p-avance").hidden = true;
  $("#p-listo").hidden = false;
  const n = misa.momentos.reduce((t, m) => t + m.canciones.length, 0);
  $("#p-mensaje").textContent = `«${misa.nombre}» quedó guardado en la web con ${n} ${n === 1 ? "canción" : "canciones"} ` +
    `y ya aparece en la página de ${misa.comunidadNombre || nombreComunidad(misa.comunidad)}.`;
  $("#p-ver").hidden = !ver;
  $("#p-ver").href = ver;
  $("#p-editar").href = urlEditor(misa.drive.folderId);
  const notas = [
    fin.faltantes && `${fin.faltantes} ${fin.faltantes === 1 ? "canción ya no está" : "canciones ya no están"} en la Biblioteca y no ${fin.faltantes === 1 ? "entró" : "entraron"} en la página.`
  ].filter(Boolean);
  $("#p-notas").hidden = !notas.length;
  $("#p-notas").textContent = notas.join(" ");
  $("#p-copiar").hidden = $("#p-whatsapp").hidden = !ver;
  $("#p-copiar").dataset.url = ver;
  $("#p-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(
    `Cancionero «${misa.nombre}» (${misa.comunidadNombre || nombreComunidad(misa.comunidad)}${misa.fechaUso ? ", " + fechaLarga(misa.fechaUso) : ""}): ${ver}`);
}

function conectarPublicar() {
  $("#dlg-publicar").addEventListener("cancel", (e) => { if (publicando) e.preventDefault(); });
  $("#p-copiar").addEventListener("click", (e) => {
    const b = e.currentTarget;
    navigator.clipboard?.writeText(b.dataset.url).then(() => { b.textContent = "Enlace copiado ✓"; }, () => prompt("Copiá el enlace:", b.dataset.url));
    setTimeout(() => { b.textContent = "Copiar enlace"; }, 2500);
  });
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
      fechaLecturas: a.fechaLecturas || "",
      lecturas: a.lecturas,
      tiempoLiturgico: $("#g-tiempo").value,
      coroId: $("#g-coro").value,
      momentos: a.momentos
    };
    const r = await llamarApi("guardarMisa", { token: token(), misa, ensayos: ensayos || undefined });
    $("#dlg-guardar").close();
    await aplicarMisaGuardada(r.misa);
    avisar(`Se guardó «${r.misa.nombre}».`);
  } catch (err) {
    mostrarError("#g-error", err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = "Guardar";
  }
}

async function aplicarMisaGuardada(misa) {
  if (st.comunidad && st.comunidad !== misa.comunidad) {
    st.comunidad = misa.comunidad;
    pintarSelectorComunidad();
    await cargarMisas();
  }
  st.misas = [misa, ...st.misas.filter((x) => x.id !== misa.id)]
    .sort((x, y) => String(y.fechaUso || y.creado).localeCompare(String(x.fechaUso || x.creado)));
  st.lecturas.delete("misa:" + misa.id);
  st.actual = structuredClone(misa);
  st.original = firma(st.actual);
  mostrarCancionDelMomento();
  pintarMisas();
  pintarBiblioteca();
  actualizarUrl();
}

async function borrarCancionero() {
  const a = st.actual;
  if (!a || a.borrador || !confirm(`¿Borrar el cancionero «${a.nombre}» con sus ensayos? No se puede deshacer.`)) return;
  try {
    await llamarApi("borrarMisa", { token: token(), id: a.id });
    st.misas = st.misas.filter((x) => x.id !== a.id);
    soltarActivo();
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

// ============ DIÁLOGO: CANCIONES Y AUDIOS ============
// Canción nueva (.md + audios, o solo audios) o audios para una canción de la Biblioteca. Los audios se
// convierten a AAC (.m4a) en el navegador apenas se agregan, se suben a Biblioteca/audios y quedan vinculados
// al .md. Con solo audios, el .md se arma con lo que traen sus etiquetas (Editag: letra y acordes, título,
// momentos) o queda solo con el título, para completarlo después en el editor.

const nombreBase = (ruta) => String(ruta || "").split(/[\\/]/).pop().normalize("NFC").toLowerCase();
const sinExtension = (n) => String(n || "").replace(/\.[^.]+$/, "");
const esMd = (f) => /\.(md|markdown|txt)$/i.test(f.name || "") || /^text\//i.test(f.type || "");
const mb = (b) => (b / 1048576).toFixed(1).replace(".", ",") + " MB";
const MAX_SUBIDA = 30 * 1024 * 1024;

const sub = { modo: "nueva", items: [], cancionId: "", grabacion: null, reloj: 0, cadena: Promise.resolve(), seq: 0, subiendo: false };

// «01 - Santo_santo (soprano).mp3» → «Santo santo (soprano)»
const tituloDeArchivo = (n) => sinExtension(n).replace(/[_]+/g, " ").replace(/^\s*\d{1,3}\s*[-.)]\s*/, "").replace(/\s+/g, " ").trim();
// Mismo id que da el Apps Script (slug_ en Code.gs) a la canción de ese título
const idDeTitulo = (t) => "c-" + (String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "cancionero");
// En «Canción nueva» sin ningún .md, cada audio dice a qué canción va (por su título)
const soloAudios = () => sub.modo === "nueva" && !sub.items.some((i) => i.tipo === "md");

function archivoBase64(f) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(",")[1] || "");
    lector.onerror = () => mal(new Error("No se pudo leer " + f.name));
    lector.readAsDataURL(f);
  });
}

const opcionesVoz = (voz) => opciones([["", "Todas las voces"], ...VOICE_ORDER.map((k) => [k, VOICES[k].label])], voz || "");

function mismoArchivo(src, archivo) {
  const a = nombreBase(src), b = nombreBase(archivo.name);
  return a === b || sinExtension(a) === sinExtension(b);
}

// Nombre y voz de cada audio según la etiqueta <audio> del .md que lo nombra (si el usuario no los cambió)
function sugerirDesdeMd() {
  const locales = sub.items.filter((i) => i.tipo === "md" && i.datos)
    .flatMap((m) => (m.datos.audios || []).filter((a) => a.kind === "local"));
  for (const it of sub.items) {
    if (it.tipo !== "audio" || it.tocado || it.grabacion) continue;
    const info = locales.find((a) => mismoArchivo(a.src, it.archivo));
    if (!info) continue;
    it.nombre = info.name || it.nombre;
    it.voz = info.voice && info.voice !== "todas" && VOICES[info.voice] ? info.voice : it.voz;
  }
}

async function agregarArchivos(lista, { grabacion = false } = {}) {
  mostrarError("#s-error", "");
  const avisos = [];
  for (const f of lista) {
    if (esAudio(f)) {
      const meta = grabacion ? null : await leerEtiquetasAudio(f).catch(() => null);
      const it = {
        id: ++sub.seq, tipo: "audio", archivo: f, grabacion, voz: "", estado: "En espera…", meta,
        nombre: grabacion ? "Grabación " + new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : sinExtension(f.name),
        cancion: meta?.titulo || (grabacion ? "" : tituloDeArchivo(f.name)),
        url: grabacion ? URL.createObjectURL(f) : ""
      };
      it.conversion = sub.cadena = sub.cadena.then(() => convertirItem(it));
      sub.items.push(it);
    } else if (esMd(f)) {
      if (sub.modo === "existente") {
        avisos.push(`«${f.name}» es una canción: para subir canciones usá «Canción nueva».`);
        continue;
      }
      let texto = "", datos = null;
      try {
        texto = await f.text();
        datos = parseMarkdown(texto, f.name);
      } catch (_) { /* queda marcada con error */ }
      sub.items.push({ id: ++sub.seq, tipo: "md", archivo: f, texto, datos, estado: f.name, error: datos ? "" : "No se pudo leer el archivo" });
    } else {
      avisos.push(`«${f.name}» no es una canción (.md) ni un audio.`);
    }
  }
  sugerirDesdeMd();
  pintarListaSubir();
  if (avisos.length) mostrarError("#s-error", avisos.join(" "));
}

async function convertirItem(it) {
  if (!sub.items.includes(it)) return;
  it.estado = "Convirtiendo a .m4a…";
  pintarEstado(it);
  try {
    const r = await aM4a(it.archivo, (x) => {
      it.estado = `Convirtiendo a .m4a ${Math.round(x * 100)} %`;
      pintarEstado(it);
    }, {
      forzar: it.grabacion,
      alEstado: (t) => { it.estado = t; pintarEstado(it); }
    });
    it.listo = r.archivo;
    it.estado = (esM4a(r.archivo) ? ".m4a · " : "") + mb(r.archivo.size) + (r.aviso ? " · " + r.aviso : "");
    if (r.archivo.size > MAX_SUBIDA) it.error = `Pesa ${mb(r.archivo.size)}: el máximo es 30 MB.`;
  } catch (e) {
    it.error = e.message;
  }
  pintarEstado(it);
}

function pintarEstado(it) {
  const li = document.querySelector(`#s-lista li[data-id="${it.id}"]`);
  if (!li) return;
  li.querySelector(".estado").textContent = it.error || it.estado;
  li.classList.toggle("con-error", !!it.error);
}

function nodoItem(it) {
  const li = document.createElement("li");
  li.className = "archivo-item" + (it.error ? " con-error" : "");
  li.dataset.id = it.id;
  const quitar = `<button type="button" class="btn-chico" data-quitar="${it.id}" ${sub.subiendo ? "disabled" : ""}>Quitar</button>`;
  li.innerHTML = it.tipo === "md"
    ? `<span class="tipo">Canción</span>
      <span class="archivo-nombre">${esc(it.datos?.title || it.archivo.name)}</span>
      <small class="estado">${esc(it.error || it.estado)}</small>${quitar}`
    : `<span class="tipo">${it.grabacion ? "Grabación" : "Audio"}</span>
      <input type="text" class="a-nombre" value="${esc(it.nombre)}" aria-label="Nombre del audio" title="Nombre del audio" maxlength="150">
      <select class="a-voz" aria-label="Voz">${opcionesVoz(it.voz)}</select>
      <small class="estado">${esc(it.error || it.estado)}</small>${quitar}
      ${soloAudios() ? `<label class="a-cancion-caja">Canción
        <input type="text" class="a-cancion" value="${esc(it.cancion)}" maxlength="150" placeholder="Título de la canción">
      </label>${metaHtml(it.meta)}` : ""}
      ${it.url ? `<audio class="a-escuchar" controls preload="metadata" src="${esc(it.url)}"></audio>` : ""}`;
  return li;
}

function metaHtml(meta) {
  if (!meta) return "";
  const partes = [meta.letra ? (meta.conAcordes ? "Trae letra y acordes" : "Trae la letra (sin acordes)") : "",
    meta.etiquetas.length ? "Etiquetas: " + meta.etiquetas.join(", ") : ""].filter(Boolean);
  return partes.length ? `<small class="a-meta">${esc(partes.join(" · "))}</small>` : "";
}

function pintarListaSubir() {
  $("#s-lista").replaceChildren(...sub.items.map(nodoItem));
}

function quitarItem(id) {
  const it = sub.items.find((i) => i.id === +id);
  if (!it) return;
  if (it.url) URL.revokeObjectURL(it.url);
  sub.items = sub.items.filter((i) => i !== it);
  pintarListaSubir();
}

function limpiarItems() {
  sub.items.forEach((i) => i.url && URL.revokeObjectURL(i.url));
  sub.items = [];
  pintarListaSubir();
}

const cancionesEditables = () => st.biblioteca.filter((c) => !c.comunidad || puedeEditar(c.comunidad));

function pintarSelectorCancion() {
  const lista = buscarCanciones(cancionesEditables(), $("#s-buscar").value);
  const elegida = st.porId.get(sub.cancionId);
  if (elegida && !lista.includes(elegida)) lista.unshift(elegida);
  $("#s-cancion").innerHTML = opciones([["", lista.length ? "Elegí la canción…" : "No hay canciones que coincidan"],
    ...lista.map((c) => [c.id, c.titulo])], sub.cancionId);
}

function pintarActuales() {
  const ul = $("#s-actuales");
  const c = st.porId.get(sub.cancionId);
  if (!c) {
    ul.replaceChildren();
    return;
  }
  const audios = c.audios || [];
  ul.innerHTML = audios.length
    ? audios.map((a, i) => `<li class="archivo-item">
        <span class="tipo">Vinculado</span>
        <span class="archivo-nombre">${esc(a.nombre || "Audio")}${a.voz ? ` <small>· ${esc(VOICES[a.voz]?.label || a.voz)}</small>` : ""}</span>
        <small class="estado">${a.fileId ? "En el Drive" : "Enlace"}</small>
        <button type="button" class="btn-chico" data-desvincular="${i}">Quitar</button></li>`).join("")
    : '<li class="suave">Esta canción todavía no tiene audios.</li>';
}

function pintarSubir() {
  const nueva = sub.modo === "nueva";
  document.querySelectorAll("#dlg-subir .modo").forEach((b) => {
    const activo = b.dataset.modo === sub.modo;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-selected", String(activo));
  });
  $("#s-existente").hidden = nueva;
  $("#s-comunidad-caja").hidden = !nueva;
  $("#s-zona-que").textContent = nueva ? "las canciones (.md) y sus audios, o solo audios" : "los audios de esta canción";
  $("#s-archivos").accept = (nueva ? ".md,.markdown,.txt,text/markdown,text/plain," : "") + "audio/*,video/*,.webm,.weba,.opus,.m4a,.mp3";
  $("#s-ayuda").textContent = nueva
    ? "Con una sola canción (.md), todos los audios se le vinculan; con varias, cada audio va a la canción cuyo .md lo nombra. " +
      "También se pueden subir solo audios: cada uno queda como canción con el título que le pongas (los de igual título van juntos) " +
      "y, si el MP3 trae letra y acordes en sus etiquetas (Editag), se usan. La letra se completa después en el editor (Archivo → Abrir → Canción de la Biblioteca y después Guardar canción en la Biblioteca): queda unida a sus audios."
    : "Elegí la canción y agregá los audios: se convierten a .m4a (suenan en todos los equipos), se guardan en el Drive de la parroquia y quedan vinculados a su .md.";
  $("#s-enviar").textContent = nueva ? "Subir" : "Vincular audios";
  if (!nueva) {
    pintarSelectorCancion();
    pintarActuales();
  }
  pintarListaSubir();
}

function cambiarModo(modo) {
  if (modo === sub.modo || sub.subiendo) return;
  sub.modo = modo;
  if (modo === "existente" && sub.items.some((i) => i.tipo === "md")) {
    sub.items = sub.items.filter((i) => i.tipo !== "md");
    avisar("Las canciones (.md) se quitaron de la lista: en este modo solo se agregan audios.");
  }
  mostrarError("#s-error", "");
  $("#s-ok").hidden = true;
  pintarSubir();
}

function abrirSubir({ modo, cancionId } = {}) {
  const editables = comunidadesEditables();
  const s = st.sesion || {};
  const valor = editables.some((c) => c.slug === st.comunidad) ? st.comunidad : editables.some((c) => c.slug === s.comunidad) ? s.comunidad : "";
  $("#s-comunidad").innerHTML = opciones([["", "Sin comunidad"], ...editables.map((c) => [c.slug, c.nombre])], valor);
  if (modo) sub.modo = modo;
  if (cancionId) {
    sub.cancionId = cancionId;
    $("#s-buscar").value = "";
  }
  mostrarError("#s-error", "");
  $("#s-ok").hidden = true;
  pintarSubir();
  if (!$("#dlg-subir").open) $("#dlg-subir").showModal();
}

// ---- Grabar ----

function pintarBotonGrabar() {
  const b = $("#s-grabar");
  b.classList.toggle("grabando", !!sub.grabacion);
  b.innerHTML = sub.grabacion ? "&#9632; Detener la grabación" : "&#9679; Grabar con el micrófono";
  $("#s-grabando").hidden = !sub.grabacion;
}

async function alternarGrabacion() {
  const b = $("#s-grabar");
  if (sub.grabacion) {
    const g = sub.grabacion;
    sub.grabacion = null;
    clearInterval(sub.reloj);
    b.disabled = true;
    const archivo = await g.detener();
    b.disabled = false;
    pintarBotonGrabar();
    await agregarArchivos([archivo], { grabacion: true });
    return;
  }
  mostrarError("#s-error", "");
  try {
    sub.grabacion = await grabador();
  } catch (e) {
    mostrarError("#s-error", e.message);
    return;
  }
  pintarBotonGrabar();
  const tic = () => {
    const seg = Math.floor(sub.grabacion?.segundos || 0);
    $("#s-grabando").textContent = `Grabando… ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
  };
  tic();
  sub.reloj = setInterval(tic, 500);
}

function cancelarGrabacion() {
  if (!sub.grabacion) return;
  sub.grabacion.cancelar();
  sub.grabacion = null;
  clearInterval(sub.reloj);
  pintarBotonGrabar();
}

// ---- Subir ----

async function subirAudiosItems(audios, tituloCancion) {
  const hechos = [];
  for (const [i, it] of audios.entries()) {
    if (!it.fileId) {
      if (!it.listo && !it.error) {
        it.estado = "Esperando la conversión…";
        pintarEstado(it);
      }
      await it.conversion;
      if (it.error) throw new Error(`«${it.nombre}»: ${it.error}`);
      it.estado = `Subiendo ${i + 1} de ${audios.length}…`;
      pintarEstado(it);
      const r = await llamarApi("subirAudioBiblioteca", {
        token: token(), nombre: it.listo.name, mime: it.listo.type || "audio/mp4",
        base64: await archivoBase64(it.listo), cancion: tituloCancion, voz: it.voz
      });
      it.fileId = r.fileId;
      it.estado = "Subido ✓";
      pintarEstado(it);
    }
    hechos.push({ nombre: it.nombre.trim() || sinExtension(it.archivo.name), voz: it.voz, fileId: it.fileId });
  }
  return hechos;
}

function actualizarCancionBib(c) {
  st.biblioteca = st.biblioteca.map((x) => (x.id === c.id ? c : x));
  if (!st.biblioteca.includes(c)) st.biblioteca.push(c);
  st.porId.set(c.id, c);
  st.textos.delete(c.id);
  pintarBiblioteca();
  if (st.vista?.cancionId === c.id) pintarLienzo();
  pintarActuales();
}

// .md con lo que trae el audio (letra y acordes de Editag, etiquetas) o solo con el título
function mdDeAudio({ titulo, artista, letraDe, musicaDe, letra, etiquetas }) {
  let texto = String(letra || "");
  if (texto && looksLikeChordPro(texto)) texto = chordProToText(texto).text;
  const tono = texto ? detectKey(texto) : null;
  const out = ["---", `titulo: ${JSON.stringify(titulo)}`];
  if (tono) out.push(`tono: ${JSON.stringify(keyLabel(tono, true))}`);
  if (etiquetas.length) out.push(`etiquetas: ${tagsToMeta(etiquetas)}`);
  if (artista) out.push(`autor: ${JSON.stringify(artista)}`);
  if (letraDe) out.push(`letra-de: ${JSON.stringify(letraDe)}`);
  if (musicaDe) out.push(`musica-de: ${JSON.stringify(musicaDe)}`);
  out.push(`exportado: ${hoyIso()}`, "---", "", `# ${titulo}`, "");
  if (tono) out.push(`**Tono:** ${keyLabel(tono, true)}`, "");
  const ticks = Math.max(2, ...(texto.match(/`+/g) || []).map((s) => s.length));
  const valla = "`".repeat(ticks + 1);
  out.push(valla + "cancion", texto, valla);
  return out.join("\n") + "\n";
}

// Solo audios: los que dicen la misma canción van juntos. Si la canción ya está en la Biblioteca, los audios
// se le suman (su letra no se toca); si no, se crea con el .md que arma mdDeAudio.
async function subirSoloAudios(audios, estado) {
  const grupos = new Map();
  for (const it of audios) {
    const titulo = (it.cancion || "").trim().slice(0, 150) || it.nombre.trim() || tituloDeArchivo(it.archivo.name);
    const id = idDeTitulo(titulo);
    if (!grupos.has(id)) grupos.set(id, { titulo, audios: [] });
    grupos.get(id).audios.push(it);
  }
  for (const id of grupos.keys()) {
    const previa = st.porId.get(id);
    if (previa?.comunidad && !puedeEditar(previa.comunidad)) {
      throw new Error(`«${previa.titulo}» ya está en la Biblioteca y es de otra comunidad: cambiá el título de la canción.`);
    }
  }
  const comunidad = $("#s-comunidad").value;
  const nuevas = [], sumadas = [];
  let n = 0;
  for (const [id, g] of grupos) {
    estado.textContent = `Canción ${++n} de ${grupos.size}: «${g.titulo}»…`;
    const previa = st.porId.get(id);
    const lista = await subirAudiosItems(g.audios, previa?.titulo || g.titulo);
    if (previa) {
      const r = await llamarApi("vincularAudio", { token: token(), cancionId: id, audios: lista });
      actualizarCancionBib(r.cancion);
      sumadas.push(r.cancion.titulo);
      continue;
    }
    const metas = g.audios.map((a) => a.meta).filter(Boolean);
    const conLetra = metas.find((m) => m.conAcordes) || metas.find((m) => m.letra);
    const md = mdDeAudio({
      titulo: g.titulo,
      artista: (conLetra || metas[0])?.artista || "",
      letraDe: metas.find((m) => m.letrista)?.letrista || "",
      musicaDe: metas.find((m) => m.compositor)?.compositor || "",
      letra: conLetra?.letra || "",
      etiquetas: uniqueTags(metas.flatMap((m) => m.etiquetas).map(canonicalTag))
    });
    const r = await llamarApi("subirCancion", { token: token(), md, nombre: g.titulo + ".md", comunidad, audios: lista });
    st.textos.delete(r.cancion.id);
    nuevas.push(r.cancion.titulo);
  }
  await cargarBiblioteca();
  pintarBiblioteca();
  if (st.vista) pintarLienzo();
  const nombres = (ts) => ts.map((t) => `«${t}»`).join(", ");
  return ["Listo:",
    nuevas.length ? `${nuevas.length === 1 ? "se creó la canción" : "se crearon las canciones"} ${nombres(nuevas)}.` : "",
    sumadas.length ? `Se sumaron audios a ${nombres(sumadas)}, que ya ${sumadas.length === 1 ? "estaba" : "estaban"} en la Biblioteca.` : "",
    nuevas.length ? "La letra y los acordes que falten se completan en el editor (Archivo → Abrir → Canción de la Biblioteca y después Guardar canción en la Biblioteca): queda unida a sus audios." : ""
  ].filter(Boolean).join(" ");
}

async function subirCancionesNuevas(estado) {
  const mds = sub.items.filter((i) => i.tipo === "md");
  const audios = sub.items.filter((i) => i.tipo === "audio");
  if (!mds.length && !audios.length) throw new Error("Agregá canciones (.md) o audios: arrastralos, elegilos o grabalos.");
  if (!mds.length) return subirSoloAudios(audios, estado);
  const ilegible = mds.find((m) => !m.datos);
  if (ilegible) throw new Error(`No se pudo leer «${ilegible.archivo.name}».`);
  const grupos = mds.map((m) => ({ m, locales: (m.datos.audios || []).filter((a) => a.kind === "local"), audios: [] }));
  if (grupos.length === 1) grupos[0].audios = audios;
  else {
    for (const it of audios) {
      const g = grupos.find((x) => x.locales.some((a) => mismoArchivo(a.src, it.archivo)));
      if (!g) throw new Error(`No se sabe a qué canción va «${it.nombre}»: subí de a una canción o usá «Agregar audio a una canción».`);
      g.audios.push(it);
    }
  }
  const comunidad = $("#s-comunidad").value;
  const subidas = [];
  for (const [i, g] of grupos.entries()) {
    estado.textContent = `Canción ${i + 1} de ${grupos.length}: «${g.m.datos.title}»…`;
    const lista = await subirAudiosItems(g.audios, g.m.datos.title);
    const enlaces = (g.m.datos.audios || []).filter((a) => a.kind === "url")
      .map((a) => ({ nombre: a.name, voz: a.voice === "todas" ? "" : a.voice, url: a.src }));
    const r = await llamarApi("subirCancion", { token: token(), md: g.m.texto, nombre: g.m.archivo.name, comunidad, audios: [...lista, ...enlaces] });
    g.m.estado = "Subida ✓";
    pintarEstado(g.m);
    st.textos.delete(r.cancion.id);
    subidas.push(r.cancion.titulo);
  }
  await cargarBiblioteca();
  pintarBiblioteca();
  if (st.vista) pintarLienzo();
  return `Listo: ${subidas.length === 1 ? "se subió" : "se subieron"} ${subidas.map((t) => `«${t}»`).join(", ")}.`;
}

async function vincularAudiosExistente(estado) {
  const c = st.porId.get(sub.cancionId);
  if (!c) throw new Error("Elegí la canción de la Biblioteca.");
  const audios = sub.items.filter((i) => i.tipo === "audio");
  if (!audios.length) throw new Error("Agregá al menos un audio: arrastralo, elegilo o grabalo.");
  estado.textContent = `Audios para «${c.titulo}»…`;
  const lista = await subirAudiosItems(audios, c.titulo);
  const r = await llamarApi("vincularAudio", { token: token(), cancionId: c.id, audios: lista });
  actualizarCancionBib(r.cancion);
  return `Listo: ${audios.length === 1 ? "el audio quedó vinculado" : `${audios.length} audios quedaron vinculados`} a «${c.titulo}».`;
}

async function enviarSubir(e) {
  e.preventDefault();
  if (sub.subiendo) return;
  if (sub.grabacion) return mostrarError("#s-error", "Detené la grabación antes de subir.");
  const boton = $("#s-enviar");
  const estado = $("#s-ok");
  sub.subiendo = true;
  boton.disabled = true;
  mostrarError("#s-error", "");
  estado.hidden = false;
  pintarListaSubir();
  try {
    estado.textContent = await (sub.modo === "nueva" ? subirCancionesNuevas(estado) : vincularAudiosExistente(estado));
    limpiarItems();
  } catch (err) {
    estado.hidden = true;
    mostrarError("#s-error", err.message);
  } finally {
    sub.subiendo = false;
    boton.disabled = false;
    pintarListaSubir();
  }
}

async function desvincular(i) {
  const c = st.porId.get(sub.cancionId);
  const a = c?.audios?.[+i];
  if (!a || !confirm(`¿Quitar «${a.nombre || "Audio"}» de «${c.titulo}»?`)) return;
  try {
    const r = await llamarApi("desvincularAudio", { token: token(), cancionId: c.id, ...(a.fileId ? { fileId: a.fileId } : { url: a.url }) });
    actualizarCancionBib(r.cancion);
    avisar(`Se quitó «${a.nombre || "Audio"}».`);
  } catch (err) {
    mostrarError("#s-error", err.message);
  }
}

function conectarSubir() {
  const dlg = $("#dlg-subir");
  const zona = $("#s-zona");
  const entrada = $("#s-archivos");
  $("#btn-subir").addEventListener("click", () => abrirSubir());
  $("#form-subir").addEventListener("submit", enviarSubir);
  dlg.addEventListener("close", cancelarGrabacion);
  document.querySelectorAll("#dlg-subir .modo").forEach((b) => b.addEventListener("click", () => cambiarModo(b.dataset.modo)));
  $("#s-buscar").addEventListener("input", pintarSelectorCancion);
  $("#s-cancion").addEventListener("change", (e) => {
    sub.cancionId = e.target.value;
    pintarActuales();
  });
  $("#s-actuales").addEventListener("click", (e) => {
    const b = e.target.closest("[data-desvincular]");
    if (b) desvincular(b.dataset.desvincular);
  });
  $("#s-grabar").addEventListener("click", alternarGrabacion);
  const lista = $("#s-lista");
  lista.addEventListener("click", (e) => {
    const b = e.target.closest("[data-quitar]");
    if (b) quitarItem(b.dataset.quitar);
  });
  lista.addEventListener("input", (e) => {
    const it = sub.items.find((i) => i.id === +e.target.closest("li")?.dataset.id);
    if (it && e.target.classList.contains("a-nombre")) {
      it.nombre = e.target.value;
      it.tocado = true;
    } else if (it && e.target.classList.contains("a-cancion")) it.cancion = e.target.value;
  });
  lista.addEventListener("change", (e) => {
    const it = sub.items.find((i) => i.id === +e.target.closest("li")?.dataset.id);
    if (it && e.target.classList.contains("a-voz")) {
      it.voz = e.target.value;
      it.tocado = true;
    }
  });

  // Arrastrar y soltar: todo el diálogo recibe archivos; tocar la zona abre el selector del sistema
  const conArchivos = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  let dentro = 0;
  dlg.addEventListener("dragenter", (e) => {
    if (!conArchivos(e)) return;
    e.preventDefault();
    dentro++;
    zona.classList.add("encima");
  });
  dlg.addEventListener("dragleave", () => {
    if (--dentro <= 0) {
      dentro = 0;
      zona.classList.remove("encima");
    }
  });
  dlg.addEventListener("dragover", (e) => {
    if (!conArchivos(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  dlg.addEventListener("drop", (e) => {
    if (!conArchivos(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dentro = 0;
    zona.classList.remove("encima");
    if (!sub.subiendo) agregarArchivos([...e.dataTransfer.files]);
  });
  zona.addEventListener("click", () => entrada.click());
  zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      entrada.click();
    }
  });
  entrada.addEventListener("change", () => {
    agregarArchivos([...entrada.files]);
    entrada.value = "";
  });
  // Un archivo soltado fuera del diálogo no reemplaza la página: quien puede subir abre el diálogo con él
  window.addEventListener("dragover", (e) => { if (conArchivos(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!conArchivos(e)) return;
    e.preventDefault();
    if ($("#btn-subir").hidden || document.querySelector("dialog[open]")) return;
    abrirSubir();
    agregarArchivos([...e.dataTransfer.files]);
  });
}

// ============ ORDEN DE LOS MOMENTOS (arrastrar y soltar) ============
// Con eventos de puntero (mouse, dedo o lápiz) desde el asa ⠿ de cada momento; con el teclado, flechas.

function conectarArrastreMomentos() {
  const cont = $("#lista-misas");
  let arr = null;

  const limpiarMarcas = () => cont.querySelectorAll(".marca-antes, .marca-despues")
    .forEach((x) => x.classList.remove("marca-antes", "marca-despues"));

  const terminar = (soltar) => {
    if (!arr) return;
    const { desde, hacia, movio } = arr;
    clearInterval(arr.auto);
    arr.li.classList.remove("arrastrando");
    arr.li.style.transform = "";
    arr.ul.classList.remove("ordenando");
    limpiarMarcas();
    arr = null;
    if (soltar && movio && moverMomento(desde, hacia)) {
      cont.querySelector(`.arrastrar[data-i="${hacia}"]`)?.focus({ preventScroll: true });
    }
  };

  const ubicar = () => {
    const otros = [...arr.ul.querySelectorAll(":scope > .momento")].filter((x) => x !== arr.li);
    arr.hacia = otros.filter((x) => {
      const r = x.getBoundingClientRect();
      return arr.y > r.top + r.height / 2;
    }).length;
    arr.li.style.transform = `translateY(${arr.y - arr.y0 + cont.scrollTop - arr.scroll0}px)`;
    limpiarMarcas();
    if (arr.hacia < otros.length) otros[arr.hacia].classList.add("marca-antes");
    else otros.at(-1)?.classList.add("marca-despues");
  };

  cont.addEventListener("pointerdown", (e) => {
    const asa = e.target.closest(".arrastrar");
    if (!asa || e.button > 0 || !editable()) return;
    e.preventDefault();
    asa.setPointerCapture(e.pointerId);
    const li = asa.closest(".momento");
    arr = { desde: +asa.dataset.i, hacia: +asa.dataset.i, li, ul: li.parentElement, y0: e.clientY, y: e.clientY,
      scroll0: cont.scrollTop, movio: false, auto: 0 };
  });
  cont.addEventListener("pointermove", (e) => {
    if (!arr) return;
    arr.y = e.clientY;
    if (!arr.movio) {
      if (Math.abs(arr.y - arr.y0) < 5) return;
      arr.movio = true;
      arr.li.classList.add("arrastrando");
      arr.ul.classList.add("ordenando");
      // Cerca del borde del panel, la lista se desplaza sola
      arr.auto = setInterval(() => {
        const r = cont.getBoundingClientRect();
        const paso = arr.y < r.top + 40 ? -8 : arr.y > r.bottom - 40 ? 8 : 0;
        if (!paso) return;
        cont.scrollTop += paso;
        ubicar();
      }, 30);
    }
    ubicar();
  });
  cont.addEventListener("pointerup", () => terminar(true));
  cont.addEventListener("pointercancel", () => terminar(false));
  cont.addEventListener("lostpointercapture", () => terminar(true));
  cont.addEventListener("keydown", (e) => {
    const asa = e.target.closest(".arrastrar");
    if (!asa || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const i = +asa.dataset.i, j = i + (e.key === "ArrowUp" ? -1 : 1);
    if (moverMomento(i, j)) cont.querySelector(`.arrastrar[data-i="${j}"]`)?.focus();
  });
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
    if (st.actual) soltarActivo();
    st.actual = null;
    st.original = "";
    st.momento = -1;
    st.vista = null;
    actualizarUrl();
    pintarTodo();
    await cargarMisas();
    pintarMisas();
  });

  $("#btn-nuevo").addEventListener("click", () => abrirNuevo());

  document.querySelectorAll(".bib-pestanas .modo").forEach((b) => b.addEventListener("click", () => cambiarPestana(b.dataset.pestana)));
  $("#lista-lecturas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accion]");
    if (!b) return;
    if (b.dataset.accion === "reintentar-lecturas") {
      if (st.actual) st.lecturas.delete(claveLecturas(st.actual));
      pintarLecturas();
    } else if (b.dataset.accion.startsWith("lect-")) accionLecturas(b.dataset.accion, b);
  });
  $("#lista-lecturas").addEventListener("change", (e) => {
    if (e.target.id === "lect-fecha") cambiarFechaLecturas(e.target.value);
  });

  $("#lista-misas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accion]");
    if (!b) return;
    const accion = b.dataset.accion;
    if (accion === "abrir") abrirMisa(b.dataset.id);
    else if (accion === "momento") elegirMomento(+b.dataset.i);
    else if (accion === "quitar-momento") quitarMomento(+b.dataset.i);
    else if (accion === "guardar") abrirGuardar();
    else if (accion === "sugerir") volverASugerir();
    else if (accion === "publicar") publicarCancionero();
    else if (accion === "atril") abrirAtril();
    else if (accion === "reproducir") abrirReproductor();
    else if (accion === "vivo") iniciarVivo();
    else if (accion === "descartar") descartarCambios();
    else if (accion === "cerrar") cerrarMisa();
  });
  conectarArrastreMomentos();
  // Al pasar al editor (otra pestaña) queda al día lo que se cambió sin repintar la lista, como el tono
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") guardarActivo(); });
  window.addEventListener("blur", guardarActivo);
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
  activarPosturas($("#cancion"));
  $("#bajar").addEventListener("click", () => transponer((st.vista?.desplazamiento || 0) - 1));
  $("#subir").addEventListener("click", () => transponer((st.vista?.desplazamiento || 0) + 1));

  const buscar = $("#buscar");
  buscar.addEventListener("input", () => {
    st.busqueda = buscar.value;
    if (st.pestana !== "canciones") cambiarPestana("canciones");
    pintarBiblioteca();
  });
  $("#form-buscar").addEventListener("submit", (e) => {
    e.preventDefault();
    st.busqueda = buscar.value;
    cambiarPestana("canciones");
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
    if (sucio() || publicando) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  conectarNuevo();
  conectarPublicar();
  conectarGuardar();
  conectarCoro();
  conectarSubir();
  conectarVivo();
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
  // Desde Inicio, «Armarlo en Misas»: abre el cancionero nuevo con esa fecha
  const fechaNueva = p.get("nuevo");
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaNueva || "") && !id) {
    if (comunidadesEditables().length) abrirNuevo({ fecha: fechaNueva });
    else avisar("Para armar el cancionero entrá con tu cuenta de Google (arriba a la derecha) y una cuenta con permisos de tu comunidad.", true);
  }
}

iniciar();
