/**
 * inicio.js — Página de Inicio (inicio.html).
 *
 *  - Marquesina bajo los botones del hero con las próximas actividades de las comunidades; quien puede
 *    editar en una comunidad las publica con «+ Actividad».
 *  - Calendario litúrgico: el día (tiempo, semana, color, celebración y santoral) y los próximos 7 días.
 *  - Próximo domingo: el cancionero de cada comunidad si ya está armado; si no, los cantos sugeridos y
 *    «Armarlo en Misas».
 *  - Libro de visitas (otras parroquias y personas) y Colaborar (formulario por FormSubmit, como el editor).
 */

import { llamarApi, sesionActual, puedeEditar, initNavSitio, esResponsableSitio } from "./auth.js";
import { COMUNIDADES } from "./comunidades.js";
import {
  hoyIso, proximoDomingo, fechaLarga, tituloLiturgico, tiempoPorFecha, colorPorTiempo, santoDelDia,
  semanaDelTitulo, momentosDeMisa, sugerirCantos
} from "./liturgia.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const CORREO_CONTACTO = "cancionerolitugico@gmail.com";
const nombreComunidad = (slug) => slug === "parroquia" ? "Toda la parroquia" : COMUNIDADES.find((c) => c.slug === slug)?.nombre || "";
const fecha = (iso, opciones) => new Date(iso + "T12:00:00").toLocaleDateString("es", opciones);
const token = () => (sesionActual() || {}).token || "";
const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)");

async function leer(params) {
  const api = (window.MONTECARMELO_CONFIG || {}).apiUrl;
  if (!api) throw new Error("El servidor de la parroquia todavía no está conectado.");
  let r;
  try {
    r = await (await fetch(api + "?" + new URLSearchParams(params))).json();
  } catch (_) {
    throw new Error("No se pudo conectar con el servidor de la parroquia.");
  }
  if (!r.ok) throw new Error(r.error || "El servidor de la parroquia no respondió");
  return r;
}

const mostrar = (sel, texto) => {
  const el = $(sel);
  el.textContent = texto || "";
  el.hidden = !texto;
};

// ============ MARQUESINA DE ACTIVIDADES ============

let actividades = [];

async function cargarActividades() {
  try {
    actividades = (await leer({ accion: "actividades" })).actividades || [];
  } catch (_) {
    actividades = null;
  }
  pintarMarquesina();
}

function actividadHtml(a) {
  const cuando = [fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" }), a.hora].filter(Boolean).join(" · ");
  return `<span class="marquesina-item"><b>${esc(cuando)}</b> <span class="m-com">${esc(nombreComunidad(a.comunidad))}</span>
    <strong>${esc(a.titulo)}</strong>${a.lugar ? ` <span class="m-lugar">(${esc(a.lugar)})</span>` : ""}${a.descripcion ? ` — ${esc(a.descripcion)}` : ""}</span>`;
}

function pintarMarquesina() {
  const cinta = $("#marquesina-cinta");
  const editor = comunidadesParaActividades().length > 0;
  $("#btn-actividad").hidden = !editor;
  if (!actividades || !actividades.length) {
    cinta.classList.remove("anima");
    cinta.innerHTML = `<span class="marquesina-item">${actividades ? "No hay actividades anunciadas por ahora." : "No se pudieron cargar las actividades."}${
      editor && actividades ? " Agrega la primera con «+ Actividad»." : ""}</span>`;
    return;
  }
  const items = actividades.map(actividadHtml).join('<span class="marquesina-sep" aria-hidden="true">✦</span>');
  const anima = !sinMovimiento.matches;
  cinta.innerHTML = `<div class="marquesina-grupo">${items}</div>` + (anima ? `<div class="marquesina-grupo" aria-hidden="true">${items}</div>` : "");
  cinta.classList.toggle("anima", anima);
  const largo = cinta.firstElementChild.textContent.length;
  cinta.style.setProperty("--duracion", Math.max(18, Math.round(largo * 0.22)) + "s");
}

// ============ ACTIVIDADES: PUBLICAR, CAMBIAR Y QUITAR ============

function comunidadesParaActividades() {
  const s = sesionActual();
  if (!s || s.rol === "visitante" || !s.token) return [];
  const lista = COMUNIDADES.filter((c) => puedeEditar(c.slug)).map((c) => [c.slug, c.nombre]);
  if (puedeEditar("parroquia")) lista.unshift(["parroquia", "Toda la parroquia"]);
  return lista;
}

function limpiarFormActividad(a = null) {
  $("#a-id").value = a?.id || "";
  $("#a-fecha").value = a?.fecha || hoyIso();
  $("#a-hora").value = a?.hora || "";
  $("#a-titulo").value = a?.titulo || "";
  $("#a-lugar").value = a?.lugar || "";
  $("#a-descripcion").value = a?.descripcion || "";
  const sel = $("#a-comunidad");
  const s = sesionActual() || {};
  sel.innerHTML = comunidadesParaActividades().map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
  sel.value = a?.comunidad || ([...sel.options].some((o) => o.value === s.comunidad) ? s.comunidad : sel.options[0]?.value || "");
  $("#a-guardar").textContent = a ? "Guardar cambios" : "Publicar actividad";
  $("#a-nueva").hidden = !a;
  mostrar("#a-error", "");
}

function pintarListaActividades() {
  const mias = (actividades || []).filter((a) => puedeEditar(a.comunidad));
  $("#act-lista").innerHTML = mias.length ? mias.map((a) => `<li>
      <span><b>${esc(fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" }))}${a.hora ? " · " + esc(a.hora) : ""}</b>
        ${esc(a.titulo)} <small>${esc(nombreComunidad(a.comunidad))}</small></span>
      <button type="button" class="btn btn-secundario" data-cambiar="${esc(a.id)}">Cambiar</button>
      <button type="button" class="btn btn-secundario" data-quitar="${esc(a.id)}">Quitar</button></li>`).join("")
    : '<li class="aviso">Todavía no hay actividades tuyas anunciadas.</li>';
}

function abrirActividades() {
  limpiarFormActividad();
  pintarListaActividades();
  $("#dlg-actividad").showModal();
  $("#a-titulo").focus();
}

async function guardarActividad(e) {
  e.preventDefault();
  const actividad = {
    id: $("#a-id").value || undefined, fecha: $("#a-fecha").value, hora: $("#a-hora").value, comunidad: $("#a-comunidad").value,
    titulo: $("#a-titulo").value.trim(), lugar: $("#a-lugar").value.trim(), descripcion: $("#a-descripcion").value.trim()
  };
  if (!actividad.fecha) return mostrar("#a-error", "Elige la fecha.");
  if (!actividad.titulo) return mostrar("#a-error", "Escribe el título de la actividad.");
  const boton = $("#a-guardar");
  boton.disabled = true;
  try {
    await llamarApi("guardarActividad", { token: token(), actividad });
    await cargarActividades();
    limpiarFormActividad();
    pintarListaActividades();
  } catch (err) {
    mostrar("#a-error", err.message);
  } finally {
    boton.disabled = false;
  }
}

async function quitarActividad(id) {
  const a = (actividades || []).find((x) => x.id === id);
  if (!a || !confirm(`¿Quitar «${a.titulo}» de las actividades?`)) return;
  try {
    await llamarApi("borrarActividad", { token: token(), id });
    await cargarActividades();
    pintarListaActividades();
  } catch (err) {
    mostrar("#a-error", err.message);
  }
}

// ============ CALENDARIO LITÚRGICO ============

const COLORES = { verde: "#2e7d32", blanco: "#f4efe2", rojo: "#c62828", morado: "#6a1b9a", rosado: "#e57399", negro: "#222", azul: "#1f5fae" };
const colorCss = (c) => COLORES[String(c || "").toLowerCase().match(/[a-z]+/)?.[0]] || "#9e9e9e";
const colorNombre = (c) => { const t = String(c || "").trim().replace(/\.$/, ""); return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : ""; };

let dias = [];
let diaElegido = 0;
let avisoCalendario = "";

async function cargarCalendario() {
  try {
    dias = (await leer({ accion: "calendario", desde: hoyIso(), dias: 7 })).dias || [];
  } catch (e) {
    avisoCalendario = e.message;
    dias = Array.from({ length: 7 }, (_, i) => ({ fecha: hoyIso(i), disponible: false }));
  }
  dias = dias.map((d) => {
    const tiempo = d.tiempo || tiempoPorFecha(d.fecha);
    return { ...d, tiempo, color: d.color || colorPorTiempo(tiempo), calculado: !d.disponible };
  });
  pintarCalendario();
}

function pintarDia() {
  const d = dias[diaElegido];
  if (!d) return;
  const titulo = (tituloLiturgico(d.titulo) || d.tiempo)
    .replace(/\s*\((M|F|S)\)$/i, (_, x) => " · " + { M: "memoria", F: "fiesta", S: "solemnidad" }[x.toUpperCase()]);
  const semana = semanaDelTitulo(d.titulo);
  const santo = santoDelDia(d.titulo) || (new Date(d.fecha + "T12:00:00").getDay() === 0 ? "Domingo" : "Feria");
  const cuando = (diaElegido === 0 ? "Hoy, " : "") + fecha(d.fecha, { weekday: "long", day: "numeric", month: "long" });
  $("#lit-hoy").innerHTML = `<div class="lit-franja" style="--color-lit:${colorCss(d.color)}"></div>
    <div class="lit-cuerpo">
      <p class="lit-fecha">${esc(cuando)}</p>
      <h3>${esc(titulo)}</h3>
      <dl class="lit-datos">
        <div><dt>Tiempo</dt><dd>${esc(d.tiempo || "—")}</dd></div>
        <div><dt>Semana</dt><dd>${esc(semana || "—")}</dd></div>
        <div><dt>Color</dt><dd><span class="lit-punto" style="--color-lit:${colorCss(d.color)}"></span>${esc(colorNombre(d.color) || "—")}</dd></div>
        <div><dt>Santoral</dt><dd>${esc(santo)}</dd></div>
      </dl>
      ${d.calculado ? `<p class="lit-nota">${avisoCalendario ? esc(avisoCalendario) + " " : ""}Las lecturas de este día todavía no están publicadas: el tiempo y el color son los del calendario.</p>` : ""}
    </div>`;
}

function pintarCalendario() {
  $("#lit-semana").innerHTML = dias.map((d, i) => {
    const dt = new Date(d.fecha + "T12:00:00");
    const corto = tituloLiturgico(d.titulo) || d.tiempo || "";
    return `<li><button type="button" data-dia="${i}" aria-pressed="${i === diaElegido}"${dt.getDay() === 0 ? ' class="domingo"' : ""}>
      <span class="lit-dsem">${i === 0 ? "Hoy" : esc(fecha(d.fecha, { weekday: "short" }))}</span>
      <span class="lit-dnum">${dt.getDate()}</span>
      <span class="lit-punto" style="--color-lit:${colorCss(d.color)}" title="${esc(colorNombre(d.color))}"></span>
      <span class="lit-dtit">${esc(corto)}</span></button></li>`;
  }).join("");
  pintarDia();
}

// ============ PRÓXIMO DOMINGO ============

async function cargarDomingo() {
  const dom = proximoDomingo();
  const [bib, mis, lec] = await Promise.allSettled([
    leer({ accion: "biblioteca" }), leer({ accion: "misas" }), leer({ accion: "lecturas", fecha: dom })
  ]);
  const biblioteca = bib.status === "fulfilled" ? bib.value.canciones || [] : [];
  const misas = mis.status === "fulfilled" ? mis.value.misas || [] : [];
  const l = lec.status === "fulfilled" && lec.value.lecturas?.disponible ? lec.value.lecturas : null;
  const porId = new Map(biblioteca.map((c) => [c.id, c]));
  const titulo = (id) => porId.get(id)?.titulo || "Canción que ya no está en la Biblioteca";
  const esHoy = dom === hoyIso();
  $("#domingo-sub").textContent = `${esHoy ? "Hoy, " : ""}${fecha(dom, { weekday: "long", day: "numeric", month: "long" })} · ${tituloLiturgico(l?.titulo) || tiempoPorFecha(dom)}`;
  if (bib.status === "rejected" && mis.status === "rejected") {
    $("#domingo-grilla").innerHTML = `<p class="aviso">${esc(bib.reason.message)}</p>`;
    return;
  }
  const lista = (momentos) => `<ol class="domingo-momentos">${momentos.filter((m) => m.canciones.length).map((m) =>
    `<li><span>${esc(m.momento)}</span> ${m.canciones.map((c) => esc(titulo(c.cancionId))).join(" · ")}</li>`).join("") ||
    '<li class="aviso">Sin canciones todavía.</li>'}</ol>`;
  $("#domingo-grilla").innerHTML = COMUNIDADES.map((c) => {
    const hecha = misas.filter((m) => m.comunidad === c.slug && m.fechaUso === dom)
      .sort((a, b) => String(b.actualizado || b.creado || "").localeCompare(String(a.actualizado || a.creado || "")))[0];
    if (hecha) {
      const ver = hecha.drive?.htmlId ? `<a class="btn btn-secundario" href="./ver.html?id=${encodeURIComponent(hecha.drive.htmlId)}">Ver la página</a>` : "";
      return `<article class="domingo-tarjeta lista">
        <h3>${esc(c.nombre)}</h3><p class="domingo-estado">✓ ${esc(hecha.nombre)}</p>${lista(hecha.momentos)}
        <div class="domingo-acciones"><a class="btn btn-primario" href="./misas.html?comunidad=${encodeURIComponent(c.slug)}&cancionero=${encodeURIComponent(hecha.id)}">Abrir en Misas</a>${ver}</div>
      </article>`;
    }
    const { tiempo, momentos } = momentosDeMisa(dom, l);
    const borrador = { id: "sugerencia-" + c.slug, comunidad: c.slug, fechaUso: dom, tiempoLiturgico: tiempo, momentos };
    sugerirCantos(borrador, l, { biblioteca, misas });
    return `<article class="domingo-tarjeta">
      <h3>${esc(c.nombre)}</h3><p class="domingo-estado">Sugerencia automática (todavía no hay cancionero)</p>${lista(borrador.momentos)}
      <div class="domingo-acciones"><a class="btn btn-primario" href="./misas.html?comunidad=${encodeURIComponent(c.slug)}&nuevo=${dom}">Armarlo en Misas</a></div>
    </article>`;
  }).join("");
}

// ============ LIBRO DE VISITAS ============

let mensajes = [];

async function cargarVisitas() {
  try {
    mensajes = (await leer({ accion: "visitas" })).mensajes || [];
    pintarVisitas();
  } catch (e) {
    $("#visitas-lista").innerHTML = `<li class="aviso">${esc(e.message)}</li>`;
  }
}

function pintarVisitas() {
  const admin = esResponsableSitio() && !!token();
  $("#visitas-lista").innerHTML = mensajes.length ? mensajes.map((m) => `<li>
      <blockquote>${esc(m.mensaje).replace(/\n/g, "<br>")}</blockquote>
      <p class="visita-firma"><b>${esc(m.nombre)}</b>${m.parroquia ? ", " + esc(m.parroquia) : ""}${m.ciudad ? " · " + esc(m.ciudad) : ""}
        · ${esc(new Date(m.cuando).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }))}
        ${m.colaborar ? '<span class="etiqueta">Quiere colaborar</span>' : ""}
        ${admin ? `<button type="button" class="btn-ocultar" data-ocultar="${esc(m.id)}">Ocultar</button>` : ""}</p></li>`).join("")
    : '<li class="aviso">Todavía no hay mensajes. ¡Sé el primero en saludar!</li>';
}

async function firmarLibro(e) {
  e.preventDefault();
  const v = (id) => $(id).value.trim();
  const datos = {
    nombre: v("#v-nombre"), parroquia: v("#v-parroquia"), ciudad: v("#v-ciudad"), mensaje: v("#v-mensaje"),
    colaborar: $("#v-colaborar").checked, correo: v("#v-correo"), sitio: $("#v-sitio").value
  };
  if (!datos.nombre) return mostrar("#v-error", "Escribe tu nombre.");
  if (datos.mensaje.length < 3) return mostrar("#v-error", "Escribe un mensaje.");
  if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) return mostrar("#v-error", "El correo no es válido (puedes dejarlo vacío).");
  mostrar("#v-error", "");
  const boton = $("#v-enviar");
  boton.disabled = true;
  try {
    const r = await llamarApi("firmarLibro", datos);
    if (r.mensaje) mensajes.unshift(r.mensaje);
    pintarVisitas();
    $("#form-visitas").reset();
    boton.textContent = "¡Gracias por tu mensaje!";
    setTimeout(() => { boton.textContent = "Firmar el libro"; }, 4000);
  } catch (err) {
    mostrar("#v-error", err.message);
  } finally {
    boton.disabled = false;
  }
}

async function ocultarMensaje(id) {
  if (!confirm("¿Ocultar este mensaje del libro de visitas? (se puede volver a mostrar desde Identificarse → Administradores)")) return;
  try {
    await llamarApi("ocultarVisita", { token: token(), id, oculto: true });
    mensajes = mensajes.filter((m) => m.id !== id);
    pintarVisitas();
  } catch (err) {
    alert(err.message);
  }
}

// ============ COLABORAR ============
// El mismo formulario de «Ayúdanos a seguir trabajando» del editor: llega al correo por FormSubmit

async function enviarColaborar(e) {
  e.preventDefault();
  const v = (id) => $(id).value.trim();
  const datos = { nombre: v("#c-nombre"), correo: v("#c-correo"), motivo: v("#c-motivo"), mensaje: v("#c-mensaje") };
  mostrar("#c-ok", "");
  if (!datos.nombre) return mostrar("#c-error", "Escribe tu nombre.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) return mostrar("#c-error", "Escribe un correo válido para poder responderte.");
  if (!datos.mensaje && !/econ[oó]mica/i.test(datos.motivo)) return mostrar("#c-error", "Escribe tu mensaje.");
  mostrar("#c-error", "");
  const boton = $("#c-enviar");
  boton.disabled = true;
  boton.textContent = "Enviando…";
  let ok = false;
  try {
    const r = await fetch(`https://formsubmit.co/ajax/${CORREO_CONTACTO}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: `Sitio Monte Carmelo: ${datos.motivo} (${datos.nombre})`,
        _replyto: datos.correo,
        _template: "table",
        _honey: $("#c-trampa").value,
        Nombre: datos.nombre,
        Correo: datos.correo,
        Motivo: datos.motivo,
        Mensaje: datos.mensaje || "(sin mensaje)",
        "Publicar su nombre en agradecimientos": $("#c-publicar").checked ? "Sí" : "No",
        Desde: "Página de Inicio"
      })
    });
    const res = await r.json().catch(() => ({}));
    ok = r.ok && String(res.success) === "true";
  } catch (_) { /* sin internet: se ofrece el correo */ }
  boton.disabled = false;
  boton.textContent = "Enviar";
  if (ok) {
    $("#form-colaborar").reset();
    mostrar("#c-ok", `¡Gracias, ${datos.nombre}! Recibimos tu mensaje y te responderemos a ${datos.correo}.`);
    return;
  }
  const cuerpo = `Nombre: ${datos.nombre}\nCorreo: ${datos.correo}\nMotivo: ${datos.motivo}\n\n${datos.mensaje}`;
  const err = $("#c-error");
  err.hidden = false;
  err.innerHTML = `No se pudo enviar desde aquí (¿sin internet?).
    <a href="mailto:${CORREO_CONTACTO}?subject=${encodeURIComponent(datos.motivo)}&body=${encodeURIComponent(cuerpo)}">Envíalo con tu correo</a>.`;
}

// ============ INICIO ============

function conectar() {
  $("#btn-actividad").addEventListener("click", abrirActividades);
  $("#form-actividad").addEventListener("submit", guardarActividad);
  $("#a-nueva").addEventListener("click", () => limpiarFormActividad());
  $("#act-lista").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.quitar) quitarActividad(b.dataset.quitar);
    else if (b.dataset.cambiar) {
      limpiarFormActividad((actividades || []).find((a) => a.id === b.dataset.cambiar));
      $("#a-titulo").focus();
    }
  });
  $("#lit-semana").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dia]");
    if (!b) return;
    diaElegido = +b.dataset.dia;
    $("#lit-semana").querySelectorAll("[data-dia]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    pintarDia();
  });
  $("#form-visitas").addEventListener("submit", firmarLibro);
  $("#visitas-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ocultar]");
    if (b) ocultarMensaje(b.dataset.ocultar);
  });
  $("#form-colaborar").addEventListener("submit", enviarColaborar);
  sinMovimiento.addEventListener?.("change", pintarMarquesina);
}

initNavSitio();
conectar();
cargarActividades();
cargarCalendario();
cargarDomingo();
cargarVisitas();
