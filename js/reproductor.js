/**
 * reproductor.js — Reproductor de la Biblioteca (reproductor.html), sin sesión. Con el aspecto del editor
 * («YouTube Music»): menú a la izquierda (abajo en el celular), carátulas, la cola a la derecha y la barra abajo.
 *
 *  - Inicio: el próximo domingo y estanterías (cancioneros de misa, tus listas, sugeridas, cada momento), y
 *    «Crear nueva misa»: un canto por momento según las lecturas de la fecha elegida, guardado como cancionero.
 *    Se puede elegir una celebración (bautizo, matrimonio, funeral…) con sus momentos propios, agregar o quitar
 *    momentos y crear uno nuevo (js/momento-nuevo.js). El cancionero que suena se abre en el editor con el botón
 *    «Editor» del menú («Modificar en editor»), y sus canciones se cambian con ⇄ (js/cambiar-cancion.js). Si no es
 *    una misa que la cuenta puede editar, el botón dice «Editar esta canción» y abre la que suena en su tono.
 *  - Canciones: buscador de la Biblioteca y «Solo con audio». Tocar una canción la hace sonar (la cola es
 *    lo que se ve en la lista); «+» la agrega a una lista.
 *  - Listas: «Mis listas» en este equipo (localStorage mc-listas: crear, renombrar, ordenar, quitar, borrar)
 *    que se comparten con un enlace #l=… (WhatsApp o Copiar), y los cancioneros de misa (#misa=<id>) con
 *    sus momentos y tonos.
 *  - Reproduciendo: la letra con acordes en el tono del cancionero (Tono − / + lo cambia en este equipo), créditos,
 *    posturas al tocar un acorde,
 *    partituras y «Aprender las voces». Un solo <audio>, que recibe los audios de la Biblioteca directo de
 *    /api/audio/<id> (empiezan a sonar mientras se bajan). Precarga la letra de la siguiente, Media Session
 *    (pantalla bloqueada y auriculares)
 *    y Wake Lock (la pantalla no se apaga mientras se lee). Los enlaces de YouTube suenan con el reproductor
 *    de YouTube insertado arriba de la letra (js/youtube-embed.js), manejado con la misma barra; el audio de
 *    la Biblioteca va primero y, al terminar un video, no pasa sola a la siguiente.
 *  - En vivo (#vivo=<código>): sigue la canción que elige quien dirige desde Misas, consultando cada 4 s.
 *
 * Usa los scripts clásicos del editor cargados antes (acordes, markdown, etiquetas, buscar, instrumentos,
 * render) más js/misas-shim.js. Todo lo del servidor son lecturas públicas.
 */

import { initNavSitio, sesionActual, llamarApi, puedeEditar } from "./auth.js";
import { mostrarBienvenidaSiCorresponde } from "./bienvenida.js";
import { COMUNIDADES, PARROQUIA } from "./comunidades.js";
import * as lit from "./liturgia.js";
import { activarPosturas, cerrar as cerrarPostura } from "./posturas.js";
import { botonesPartituras } from "./partituras.js";
import { elegirReemplazo } from "./cambiar-cancion.js";
import { momentosHabituales, ponerHabituales, lugarHabitual, gruposDeMomentos, opcionesMomento, crearMomento } from "./momento-nuevo.js";
import { crearMezclador, pistasDeVoces } from "./voces.js";
import { crearReproductorYT, esYoutube, youtubeId } from "./youtube-embed.js";
import { conectarSala, codigoValido } from "./sala.js";
import { estadoAviso, activarAviso, desactivarAviso, actualizarComunidadAviso, esIphone, audiosGuardados, bajarAudios } from "./aviso.js";
import { compartirTarjeta } from "./tarjeta.js";

// editor/js/caratula.js (script clásico) busca la miniatura del video con esta función
window.youtubeId ||= youtubeId;

const $ = (s) => document.querySelector(s);
const esc = (s) => escapeHtml(s == null ? "" : s);

// ============ ÍCONOS (los mismos del editor) ============
const ICONOS = {
  inicio: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  buscar: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  biblioteca: "M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5c0 1.38-1.12 2.5-2.5 2.5S10 13.88 10 12.5s1.12-2.5 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z",
  nota: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z",
  vivo: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7.76 16.24l-1.41 1.41A7.97 7.97 0 0 1 4 12c0-2.21.9-4.21 2.35-5.65l1.41 1.41A5.98 5.98 0 0 0 6 12c0 1.66.67 3.16 1.76 4.24zM17.65 6.35A7.97 7.97 0 0 1 20 12c0 2.21-.9 4.21-2.35 5.65l-1.41-1.41A5.98 5.98 0 0 0 18 12c0-1.66-.67-3.16-1.76-4.24l1.41-1.41z",
  instalar: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  cola: "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z",
  play: "M8 5v14l11-7z",
  pausa: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  anterior: "M6 6h2v12H6zm3.5 6l8.5 6V6z",
  siguiente: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  agregar: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  editar: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  aleatorio: "M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
  repetir: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
  repetirUna: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z",
  iglesia: "M18 12.22V9l-5-2.5V5h2V3h-2V1h-2v2H9v2h2v1.5L6 9v3.22L2 14v8h8v-3c0-1.1.9-2 2-2s2 .9 2 2v3h8v-8l-4-1.78zM12 13.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  escenario: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  pantalla: "M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z",
  config: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z",
  qr: "M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M19 5h-6v6h6V5zm-6 8h1.5v1.5H13V13zm1.5 1.5H16V16h-1.5v-1.5zM16 13h1.5v1.5H16V13zm-3 3h1.5v1.5H13V16zm1.5 1.5H16V19h-1.5v-1.5zM16 16h1.5v1.5H16V16zm1.5-1.5H19V16h-1.5v-1.5zm0 3H19V19h-1.5v-1.5zM22 7h-2V4h-3V2h5v5zm0 15v-5h-2v3h-3v2h5zM2 22h5v-2H4v-3H2v5zM2 2v5h2V4h3V2H2z",
  gota: "M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z",
  caliz: "M12 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6 8h12c0 3.6-2.2 6.3-5 6.9V19h3v2.5H8V19h3v-4.1C8.2 14.3 6 11.6 6 8z",
  llama: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z",
  corazon: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  cruz: "M10 2h4v6h6v4h-6v10h-4V12H4V8h6z",
  estrella: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
};
const icono = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONOS[n]}"/></svg>`;
const ponerIconos = () => document.querySelectorAll("[data-ico]").forEach((e) => {
  e.insertAdjacentHTML("afterbegin", icono(e.dataset.ico));
  e.removeAttribute("data-ico");
});

// Colores litúrgicos sobre fondo oscuro: el acento del tema Noche es el del tiempo del próximo domingo
const COLOR_LITURGICO = { Verde: "#4caf50", Morado: "#9c6ade", Rojo: "#e5534b", Blanco: "#d9b44a", Rosa: "#ec8fb8" };
const colorDeMisa = (m) => COLOR_LITURGICO[lit.colorPorTiempo(m.tiempoLiturgico || lit.tiempoPorFecha(m.fechaUso))] || "#455a64";
const domingo = lit.proximoDomingo();
const tiempoDomingo = lit.tiempoPorFecha(domingo);
const acentoLiturgico = COLOR_LITURGICO[lit.colorPorTiempo(tiempoDomingo)] || COLOR_LITURGICO.Verde;
document.documentElement.style.setProperty("--rp-liturgico", acentoLiturgico);

// Carátula de una canción de la Biblioteca (editor/js/caratula.js)
const cara = (c, clase = "", momento = "") => caraHtml({ titulo: c?.titulo, etiquetas: c?.etiquetas, audios: c?.audios, momento }, clase);
const caraMisa = (m, clase = "") => `<span class="cara ${clase} cara-misa" style="--cara:${colorDeMisa(m)}" aria-hidden="true">${icono("iglesia")}</span>`;
const CARA_CELEBRACION = {
  bautizo: ["gota", "#2f7fb8"], "primera-comunion": ["caliz", "#b08a1e"], confirmacion: ["llama", "#c0392b"],
  matrimonio: ["corazon", "#c2185b"], "renovacion-votos": ["corazon", "#ad5a83"], funeral: ["cruz", "#5d4a6e"],
  difunto: ["cruz", "#6e6478"], "aniversario-sacerdotal": ["iglesia", "#8a6d1e"], consagracion: ["estrella", "#6b3fa0"],
  bendicion: ["estrella", "#2f6b3a"], corpus: ["caliz", "#c9a227"], "cristo-rey": ["estrella", "#b3261e"],
  "sagrado-corazon": ["corazon", "#b3261e"], mariana: ["estrella", "#3b6db3"], patronal: ["iglesia", "#9a4f2e"]
};
const caraCelebracion = (m, clase = "") => {
  const [ico, color] = CARA_CELEBRACION[m.celebracion] || ["iglesia", colorDeMisa(m)];
  return `<span class="cara ${clase} cara-misa" style="--cara:${color}" aria-hidden="true">${icono(ico)}</span>`;
};
const caraLista = (l, clase = "") => `<span class="cara ${clase} cara-misa" style="--cara:${caraColor([], l.nombre)}" aria-hidden="true">${icono("cola")}</span>`;
const audio = $("#rp-audio");
const reloj = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
const guardado = (clave, porDefecto) => {
  try { return localStorage.getItem(clave) ?? porDefecto; } catch (_) { return porDefecto; }
};
const guardar = (clave, valor) => {
  try { localStorage.setItem(clave, valor); } catch (_) { /* sin almacenamiento */ }
};
// La comunidad elegida es de cada parroquia; las listas personales son comunes (la Biblioteca es una)
const PARROQUIA_ACTUAL = (window.MONTECARMELO_CONFIG || {}).parroquia || "montecarmelo";
const CLAVE_COMUNIDAD = PARROQUIA_ACTUAL === "montecarmelo" ? "mc-rp-comunidad" : "mc-rp-comunidad:" + PARROQUIA_ACTUAL;

const st = {
  biblioteca: [],
  porId: new Map(),
  textos: new Map(),
  listas: [],
  abierta: "", // lista que se está editando
  cola: null, // { nombre, tipo: biblioteca|lista|misa|compartida, items: [{ cancionId, desplazamiento, momento }] }
  indice: -1,
  elegido: new Map(), // cancionId → índice del audio elegido en el selector de voz
  compartida: null,
  misas: null,
  comunidad: guardado(CLAVE_COMUNIDAD, ""),
  vista: "inicio",
  estantes: [], // las colas de las estanterías de Inicio
  mezclador: null,
  vivo: null
};

// ============ SERVIDOR ============

async function leer(params) {
  const api = (window.MONTECARMELO_CONFIG || {}).apiUrl;
  if (!api) throw new Error("El servidor de la parroquia todavía no está conectado.");
  let r;
  try {
    r = await (await fetch(api + "?" + new URLSearchParams(params))).json();
  } catch (_) {
    throw new Error("No se pudo conectar con el servidor de la parroquia. Revisá tu conexión.");
  }
  if (!r.ok) throw new Error(r.error || "El servidor de la parroquia no respondió");
  return r;
}

// La letra queda guardada en el equipo («mc-datos», la misma dirección que guarda el aviso del sábado): sin señal
// en el templo se usa la guardada
async function letraGuardable(id) {
  const url = (window.MONTECARMELO_CONFIG || {}).apiUrl + "?" + new URLSearchParams({ accion: "cancion", id });
  try {
    const r = await leer({ accion: "cancion", id });
    caches.open(CACHE_DATOS).then((c) => c.put(url, new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } }))).catch(() => {});
    return r;
  } catch (err) {
    try {
      const g = await (await caches.open(CACHE_DATOS)).match(url);
      if (g) return await g.json();
    } catch (_) { /* sin copia */ }
    throw err;
  }
}

function textoCancion(id) {
  if (!st.textos.has(id)) {
    const p = letraGuardable(id).then((r) => ({
      doc: parseMarkdown(r.texto, (r.cancion?.titulo || "cancion") + ".md"), cancion: r.cancion || {}
    }));
    st.textos.set(id, p);
    p.catch(() => st.textos.delete(id));
  }
  return st.textos.get(id);
}

const reproduceWebm = !!audio.canPlayType('audio/webm; codecs="opus"');
const urlAudio = (fileId) => (window.MONTECARMELO_CONFIG || {}).apiUrl + "/audio/" + encodeURIComponent(fileId);

const bytesDeAudio = async (fileId) => {
  const res = await fetch(urlAudio(fileId));
  if (!res.ok) throw new Error("No se pudo cargar el audio");
  return res.arrayBuffer();
};

// ============ AVISOS Y VISTAS ============

function avisar(texto) {
  const t = $("#rp-toast");
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (t.hidden = true), 3500);
}

function mostrarVista(v) {
  st.vista = v;
  document.querySelectorAll(".rp-pestana[data-vista]").forEach((b) => {
    b.classList.toggle("activa", b.dataset.vista === v);
    b.setAttribute("aria-selected", b.dataset.vista === v);
  });
  for (const id of ["inicio", "canciones", "listas", "sonando", "vivo"]) $("#vista-" + id).hidden = id !== v;
  document.body.dataset.vista = v;
  if (v !== "sonando") document.body.classList.remove("cola-abierta");
  moverA(document.scrollingElement, 0);
  if (v === "inicio" && inicioViejo && st.biblioteca.length) pintarInicio();
  if (v === "listas") {
    pintarListas();
    if (!st.misas) cargarMisas();
  }
  cerrarPostura();
  pedirPantalla();
  pintarBotonEditor();
  if (v === "sonando") alinear();
}

// ============ CANCIONES ============

const esVideo = (a) => !a.fileId && esYoutube(a.url);
const audiosReproducibles = (c) => (c?.audios || []).filter((a) => a.fileId || (a.url && (esYoutube(a.url) || !/youtu\.?be|vimeo\.com/i.test(a.url))));
const resultados = () => {
  let lista = buscarCanciones(st.biblioteca, $("#rp-buscar").value);
  if ($("#rp-con-audio").checked) lista = lista.filter((c) => audiosReproducibles(c).length);
  return lista;
};
const actualId = () => st.cola?.items[st.indice]?.cancionId || "";

function pintarCanciones() {
  const lista = resultados();
  const estado = $("#rp-estado-bib");
  estado.hidden = !!lista.length;
  if (!lista.length && st.biblioteca.length) estado.textContent = "No hay canciones que coincidan.";
  const actual = actualId();
  $("#rp-canciones").innerHTML = lista.slice(0, 300).map((c) => {
    const cred = creditsText(normalizeCredits({ letra: c.letraDe, musica: c.musicaDe }));
    const rep = audiosReproducibles(c);
    const sub = [rep.some((a) => !esVideo(a)) ? "♪ con audio" : rep.length ? "▶ con video" : "sin audio", cred].filter(Boolean).join(" · ");
    return `<li class="${c.id === actual ? "sonando" : ""}">
      <button type="button" class="rp-fila-cara" data-tocar="${esc(c.id)}" aria-label="Reproducir «${esc(c.titulo)}»">${cara(c)}<span class="rp-fila-play">${icono("play")}</span></button>
      <button type="button" class="rp-fila" data-tocar="${esc(c.id)}"><b>${esc(c.titulo)}</b><small>${esc(sub)}</small></button>
      <button type="button" class="rp-mas" data-agregar="${esc(c.id)}" aria-label="Agregar «${esc(c.titulo)}» a una lista" title="Agregar a una lista">+</button>
    </li>`;
  }).join("");
}

// La Biblioteca queda guardada en el equipo (Cache Storage «mc-datos»): se muestra al instante la guardada y se
// pide la nueva en segundo plano; si cambió, se vuelve a pintar
const CACHE_DATOS = "mc-datos";
const urlBiblioteca = () => (window.MONTECARMELO_CONFIG || {}).apiUrl + "?accion=biblioteca";

async function bibliotecaGuardada() {
  try {
    const r = await (await caches.open(CACHE_DATOS)).match(urlBiblioteca());
    return r ? await r.text() : null;
  } catch (_) {
    return null;
  }
}

async function bibliotecaNueva() {
  if (!(window.MONTECARMELO_CONFIG || {}).apiUrl) throw new Error("El servidor de la parroquia todavía no está conectado.");
  let texto;
  try {
    texto = await (await fetch(urlBiblioteca())).text();
  } catch (_) {
    throw new Error("No se pudo conectar con el servidor de la parroquia. Revisá tu conexión.");
  }
  let r = {};
  try { r = JSON.parse(texto); } catch (_) { /* no es la respuesta del servidor */ }
  if (!r.ok) throw new Error(r.error || "El servidor de la parroquia no respondió");
  caches.open(CACHE_DATOS).then((c) => c.put(urlBiblioteca(), new Response(texto, { headers: { "Content-Type": "application/json" } }))).catch(() => {});
  return texto;
}

function ponerBiblioteca(texto) {
  st.biblioteca = JSON.parse(texto).canciones || [];
  st.biblioteca.sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), "es"));
  st.porId = new Map(st.biblioteca.map((c) => [c.id, c]));
  $("#rp-estado-bib").textContent = st.biblioteca.length ? "" : "La Biblioteca todavía no tiene canciones.";
}

async function cargarBiblioteca() {
  let guardada = await bibliotecaGuardada();
  try {
    if (guardada) ponerBiblioteca(guardada);
  } catch (_) {
    guardada = null;
  }
  if (guardada) {
    bibliotecaNueva().then((nueva) => {
      if (nueva === guardada) return;
      ponerBiblioteca(nueva);
      pintarCanciones();
      if (st.vista === "inicio") pintarInicio();
      else inicioViejo = true;
    }).catch(() => {});
  } else {
    try {
      ponerBiblioteca(await bibliotecaNueva());
    } catch (e) {
      $("#rp-estado-bib").textContent = e.message;
    }
  }
  pintarCanciones();
}

// ============ INICIO ============
// Estanterías como las del editor: los cancioneros de misa, tus listas, los cantos sugeridos para el
// domingo y los de cada momento. Tocar una tarjeta hace sonar esa estantería desde esa canción.

const MOMENTOS_INICIO = ["Entrada", "Acto penitencial", "Gloria", "Aleluya", "Ofertorio", "Santo", "Cordero de Dios",
  "Comunión", "Acción de gracias", "Salida", "Canto a María"];

let misasPublicas = null;
const todasLasMisas = () => (misasPublicas ||= leer({ accion: "misas" }).then((r) => r.misas || [])
  .catch(() => { misasPublicas = null; return []; }));

// Los domingos con lecturas publicadas en eucaristiadiaria.cl (desde el primero del mes, para la cadena sin
// repetir canciones): [{ fecha, lecturas }]
// Inicio se pinta sin esperarlas (domingosListos queda null) y se vuelve a pintar cuando llegan.
let domingosLeidos = null;
let domingosListos = null;
const lecturasDelDia = (fecha) => leer({ accion: "lecturas", fecha }).then((r) => r.lecturas?.disponible ? r.lecturas : null);
const domingosConLecturas = () => (domingosLeidos ||= lit.domingosPublicados(lecturasDelDia)
  .catch(() => { domingosLeidos = null; return [{ fecha: domingo, lecturas: null }]; }));

const hash = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
};
// Primero las que tienen audio de la Biblioteca, después las de video; el resto cambia cada domingo
const puntos = (c) => (c.audios || []).some((a) => a.fileId) ? 2 : audiosReproducibles(c).length ? 1 : 0;
const ordenInicio = (a, b) => puntos(b) - puntos(a) || hash(domingo + a.id) - hash(domingo + b.id);
const subCancion = (c) => creditsText(normalizeCredits({ letra: c.letraDe, musica: c.musicaDe }))
  || (audiosReproducibles(c).length ? "" : "Sin audio: con la letra");
const nombreComunidad = (slug) => COMUNIDADES.find((c) => c.slug === slug)?.nombre || "";

const estante = (titulo, sobre, tarjetas) => tarjetas.length ? `<section class="rp-estante">
    <div class="rp-estante-cabeza">
      <span><small>${esc(sobre)}</small><h2>${esc(titulo)}</h2></span>
      <span class="rp-estante-flechas"><button type="button" class="rp-ico" data-desplazar="-1" aria-label="Anteriores">‹</button><button type="button" class="rp-ico" data-desplazar="1" aria-label="Siguientes">›</button></span>
    </div>
    <div class="rp-estante-fila">${tarjetas.join("")}</div>
  </section>` : "";

const tarjeta = (caraHtmlTxt, accion, titulo, sub) => `<div class="rp-tj">
    <div class="rp-tj-cara">${caraHtmlTxt}<button type="button" class="rp-tj-play" ${accion} aria-label="Reproducir «${esc(titulo)}»">${icono("play")}</button></div>
    <button type="button" class="rp-tj-titulo" ${accion}>${esc(titulo)}</button>
    <div class="rp-tj-sub">${esc(sub)}</div>
  </div>`;

// Lo más cantado, los cancioneros del domingo de las otras parroquias (las más cercanas primero) y quienes colaboran
const radianes = (g) => (g * Math.PI) / 180;
const distanciaKm = (a, b) => {
  const h = Math.sin(radianes(b.lat - a.lat) / 2) ** 2 + Math.cos(radianes(a.lat)) * Math.cos(radianes(b.lat)) * Math.sin(radianes(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const km = (d) => (d == null ? "" : d < 1 ? "menos de 1 km" : d < 20 ? d.toFixed(1).replace(".", ",") + " km" : Math.round(d) + " km");

async function dondeEstoy() {
  try {
    if ((await navigator.permissions?.query({ name: "geolocation" }))?.state === "granted") {
      const pos = await new Promise((ok, mal) => navigator.geolocation.getCurrentPosition(ok, mal, { timeout: 4000, maximumAge: 3600e3 }));
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }
  } catch (_) { /* sin ubicación del equipo */ }
  const p = window.MC_PARROQUIA || {};
  return typeof p.lat === "number" ? { lat: p.lat, lng: p.lng } : null;
}

let inspiracionLeida = null;
const datosInspiracion = () => (inspiracionLeida ||= Promise.all([
  leer({ accion: "masCantados" }).then((r) => r.canciones || []).catch(() => []),
  leer({ accion: "domingoEnOtras", excluir: PARROQUIA_ACTUAL }).then((r) => r.misas || []).catch(() => []),
  leer({ accion: "parroquias" }).then((r) => r.parroquias || []).catch(() => []),
  leer({ accion: "colaboradores" }).catch(() => null),
  dondeEstoy()
]).then(([cantados, otras, parroquias, colaboran, aqui]) => {
  const lejos = (x) => (aqui && typeof x.lat === "number" ? distanciaKm(aqui, x) : null);
  const porDistancia = (a, b) => (a.km ?? 1e9) - (b.km ?? 1e9);
  return {
    cantados,
    otras: otras.map((m) => ({ ...m, km: lejos(m.parroquia) })).sort(porDistancia),
    cerca: aqui ? parroquias.filter((p) => p.slug !== PARROQUIA_ACTUAL).map((p) => ({ ...p, km: lejos(p) }))
      .filter((p) => p.km != null && p.km < 150).sort(porDistancia).slice(0, 16) : [],
    colaboran
  };
}));

function seccionColaboran(x) {
  if (!x) return "";
  const t = x.totales || {};
  const cifras = [[t.canciones, "canciones"], [t.audios, "audios"], [t.partituras, "partituras"], [t.cancioneros, "cancioneros de misa"]]
    .filter(([n]) => n > 0).map(([n, que]) => `<li><b>${n}</b> ${que}</li>`).join("");
  const nombres = x.nombres || [];
  if (!cifras && !nombres.length) return "";
  const otros = x.otros > 0 ? (nombres.length ? ` y ${x.otros} ${x.otros === 1 ? "persona más" : "personas más"}` : `${x.otros} ${x.otros === 1 ? "persona" : "personas"}`) : "";
  return `<section class="rp-gracias">
    <h2>Gracias a quienes colaboran</h2>
    ${cifras ? `<ul class="rp-gracias-cifras">${cifras}</ul>` : ""}
    ${nombres.length || otros ? `<p>${esc(nombres.join(", "))}${esc(otros)}.</p>` : ""}
    <p class="rp-gracias-pie">Cada canción, audio y cancionero que se sube queda para todas las parroquias.
      <a href="/agradecimientos">Agradecimientos</a>${sesionActual() ? ` · <a href="./login.html#colaborador">Mostrar mi nombre</a>` : ""}</p>
  </section>`;
}

let inicioViejo = true;
async function pintarInicio() {
  inicioViejo = false;
  const inspiracion = datosInspiracion();
  const lista = st.biblioteca;
  $("#rp-portada-sobre").textContent = "Próximo domingo · " + lit.fechaLarga(domingo);
  $("#rp-portada-titulo").textContent = lit.nombreDelDia(domingo) || tiempoDomingo;
  $("#rp-portada-tiempo").innerHTML = `<span class="rp-punto" style="background:${acentoLiturgico}"></span>${esc(tiempoDomingo)} · color ${esc(lit.colorPorTiempo(tiempoDomingo).toLowerCase())}`;
  const domingos = domingosListos;
  if (!domingos) {
    domingosConLecturas().then((d) => {
      if (domingosListos) return;
      domingosListos = d;
      if (st.vista === "inicio") pintarInicio();
      else inicioViejo = true;
    });
  }
  $("#rp-portada-acciones").innerHTML = `<button type="button" class="rp-btn rp-btn-claro" data-crear-misa="1">${icono("agregar")} Armar cancionero para celebración</button>`
    + `<button type="button" class="rp-btn" data-ir="vivo">${icono("vivo")} Seguir en vivo</button>`;
  const misas = (await todasLasMisas()).filter(cuantas);

  st.estantes = [];
  // pares: [canción, momento, motivo corto]
  const deCanciones = (titulo, sobre, pares) => {
    pares = pares.slice(0, 24);
    if (!pares.length) return "";
    const k = st.estantes.push({ nombre: titulo, items: pares.map(([c, momento]) => ({ cancionId: c.id, desplazamiento: 0, ...(momento ? { momento } : {}) })) }) - 1;
    return estante(titulo, sobre, pares.map(([c, momento, motivo], i) =>
      tarjeta(cara(c, "grande", momento), `data-estante="${k}" data-i="${i}"`, c.titulo,
        momento ? momento + (motivo ? " · " + motivo : "") : motivo || subCancion(c))));
  };

  const hoy = lit.hoyIso();
  const proximas = misas.filter((m) => (m.fechaUso || "") >= hoy).sort((a, b) => a.fechaUso.localeCompare(b.fechaUso));
  const pasadas = misas.filter((m) => !proximas.includes(m)).sort((a, b) => String(b.fechaUso || "").localeCompare(String(a.fechaUso || "")));
  // Bautizos, matrimonios, primeras comuniones…: los que vienen y los de las últimas dos semanas
  const desde = lit.hoyIso(-14);
  const ceremonia = (m) => lit.celebracionPorId(m.celebracion)?.grupo === "sacramento";
  let html = estante("Celebraciones", "Lo que se cantará en cada una", [...proximas, ...pasadas.filter((m) => (m.fechaUso || "") >= desde)]
    .filter(ceremonia).slice(0, 20).map((m) => {
      const cel = lit.celebracionPorId(m.celebracion);
      return tarjeta(caraCelebracion(m, "grande"), `data-misa="${esc(m.id)}"`, cel.nombre + (m.intencion ? ": " + m.intencion : ""),
        [fechaCorta(m.fechaUso), nombreComunidad(m.comunidad)].filter(Boolean).join(" · "));
    }));
  html += estante("Cancioneros de misa", "Para escuchar y ensayar", [...proximas, ...pasadas].slice(0, 20).map((m) => {
    const n = cuantas(m);
    return tarjeta(caraMisa(m, "grande"), `data-misa="${esc(m.id)}"`, m.nombre || "Cancionero de misa",
      [nombreComunidad(m.comunidad), fechaCorta(m.fechaUso), n + (n === 1 ? " canción" : " canciones")].filter(Boolean).join(" · "));
  }));
  html += estante("Tus listas", "En este equipo", st.listas.filter((l) => l.items.length).map((l) =>
    tarjeta(caraLista(l, "grande"), `data-inicio-lista="${esc(l.id)}"`, l.nombre, l.items.length + (l.items.length === 1 ? " canción" : " canciones"))));

  // Inspiración: lo que cantan las demás parroquias y movimientos de Chile
  const ins = await inspiracion;
  if (lista.length) {
    html += deCanciones("Lo más cantado en Chile", "En los cancioneros de las parroquias este mes", ins.cantados
      .map((x) => [st.porId.get(x.id), "", x.parroquias > 1 ? `En ${x.parroquias} parroquias` : "En 1 parroquia"]).filter(([c]) => c));
    st.otras = ins.otras.map((m) => ({ ...m, items: m.items.filter((x) => st.porId.has(x.cancionId)) })).filter((m) => m.items.length);
    html += estante("Este domingo en otras parroquias", "Para escuchar e inspirarse", st.otras.map((m, k) =>
      tarjeta(caraCelebracion(m, "grande"), `data-otra="${k}"`, m.nombre || "Cancionero de misa",
        [m.parroquia.nombreCorto, m.km != null ? "a " + km(m.km) : "", m.items.length + " cantos"].filter(Boolean).join(" · "))));
  }
  html += estante("Cerca de ti", "Parroquias y movimientos que usan el Cancionero", ins.cerca.map((p) => `<div class="rp-tj">
      <a class="rp-tj-cara rp-tj-foto" href="/${esc(p.slug)}/inicio">${p.foto ? `<img src="${esc(p.foto)}" alt="" loading="lazy">` : `<img src="${esc(p.icono)}" alt="" loading="lazy" class="rp-tj-icono">`}</a>
      <a class="rp-tj-titulo" href="/${esc(p.slug)}/inicio">${esc(p.nombre)}</a>
      <div class="rp-tj-sub">${esc([p.comuna, km(p.km)].filter(Boolean).join(" · "))}</div>
    </div>`));

  if (lista.length) {
    // Un estante por domingo desde hoy: los cantos sugeridos sin repetir ninguno en el mes
    if (domingos) try {
      for (const d of lit.sugerirDomingos(domingos, { biblioteca: lista, misas }).filter((x) => x.fecha >= domingo)) {
        const ev = lit.evangelioDe(d.lecturas);
        const nombre = d.lecturas?.titulo ? lit.tituloLiturgico(d.lecturas.titulo) : lit.nombreDelDia(d.fecha);
        const sobre = [nombre, ev ? "Evangelio según " + ev.cita : "Según el tiempo litúrgico (lecturas aún no publicadas)"].join(" · ");
        const dia = new Date(d.fecha + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
        html += deCanciones(dia.charAt(0).toUpperCase() + dia.slice(1), sobre, d.misa.momentos.flatMap((m) =>
          m.canciones.map((c) => [st.porId.get(c.cancionId), m.momento, d.motivos.get(m.momento)?.corto])).filter(([c]) => c));
      }
    } catch (_) { /* sin sugerencias */ }
    const t = tiempoDomingo.toLowerCase();
    html += deCanciones("Del tiempo: " + tiempoDomingo, "Tiempo litúrgico",
      lista.filter((c) => (c.etiquetas || []).some((x) => x.toLowerCase() === t)).sort(ordenInicio).map((c) => [c]));
    for (const m of MOMENTOS_INICIO) {
      if (m === "Canto a María") {
        // Los de María según el tiempo: en Navidad villancicos, en Cuaresma la Dolorosa…
        const tema = lit.temaMarianoDe(tiempoDomingo, domingo);
        html += deCanciones(m, tema ? "Para " + tema.nombre : "Momentos de la misa", lit.candidatosMomento(lista, m, { fechaUso: domingo, tiempoLiturgico: tiempoDomingo })
          .filter((x) => x.delMomento).map((x) => [x.cancion, m]));
      } else html += deCanciones(m, "Momentos de la misa", lista.filter((c) => lit.esDelMomento(c, m)).sort(ordenInicio).map((c) => [c, m]));
    }
  }
  html += seccionColaboran(ins.colaboran);
  $("#rp-estantes").innerHTML = html || `<p class="rp-aviso">${esc($("#rp-estado-bib").textContent || "Todavía no hay canciones.")}</p>`;
}

function accionInicio(e) {
  const b = e.target.closest("button, a");
  if (!b) return;
  const d = b.dataset;
  if (d.desplazar) {
    const fila = b.closest(".rp-estante").querySelector(".rp-estante-fila");
    fila.scrollBy({ left: +d.desplazar * fila.clientWidth * 0.9, behavior: "smooth" });
  } else if (d.estante) {
    const s = st.estantes[+d.estante];
    colaPropia({ nombre: s.nombre, tipo: "biblioteca", items: s.items.map((x) => ({ ...x })) });
    reproducir(+d.i);
    mostrarVista("sonando");
  } else if (d.misa) {
    const h = "#misa=" + encodeURIComponent(d.misa);
    if (location.hash === h) leerHash();
    else location.hash = h;
  } else if (d.otra) {
    const m = st.otras?.[+d.otra];
    if (!m) return;
    colaPropia({ nombre: (m.nombre || "Cancionero de misa") + " · " + m.parroquia.nombreCorto, tipo: "biblioteca", items: m.items.map((x) => ({ ...x })) });
    reproducir(0);
    mostrarVista("sonando");
  } else if (d.inicioLista) {
    const l = st.listas.find((x) => x.id === d.inicioLista);
    if (!l) return;
    colaPropia({ nombre: l.nombre, tipo: "lista", listaId: l.id, items: l.items.map((x) => ({ ...x })) });
    reproducir(0);
    mostrarVista("sonando");
  } else if (d.crearMisa) abrirCrear();
  else if (d.ir) mostrarVista(d.ir);
}

// ============ MIS LISTAS ============

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function leerListas() {
  try {
    const l = JSON.parse(localStorage.getItem("mc-listas") || "[]");
    return Array.isArray(l) ? l.filter((x) => x && Array.isArray(x.items)) : [];
  } catch (_) {
    return [];
  }
}
const guardarListas = () => {
  guardar("mc-listas", JSON.stringify(st.listas));
  inicioViejo = true;
};

// Enlace compartible: «nombre|id|id*desplazamiento…» en base64url, sin el «c-» de los ids
function codificarLista(nombre, items) {
  const partes = [String(nombre).replace(/\|/g, "/"), ...items.map((it) =>
    it.cancionId.replace(/^c-/, "") + (it.desplazamiento ? "*" + it.desplazamiento : ""))];
  const bytes = new TextEncoder().encode(partes.join("|"));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodificarLista(codigo) {
  const b64 = codigo.replace(/-/g, "+").replace(/_/g, "/");
  const texto = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  const [nombre, ...ids] = texto.split("|");
  const items = ids.filter(Boolean).slice(0, 200).map((s) => {
    const [id, d] = s.split("*");
    return { cancionId: "c-" + id, desplazamiento: Math.max(-11, Math.min(11, parseInt(d, 10) || 0)) };
  });
  return { nombre: nombre || "Lista compartida", items };
}

const enlace = (hash) => location.origin + location.pathname + "#" + hash;
const enlaceLista = (l) => enlace("l=" + codificarLista(l.nombre, l.items));
const whatsapp = (texto, url) => "https://wa.me/?text=" + encodeURIComponent(texto + " " + url);

async function copiar(url) {
  try {
    await navigator.clipboard.writeText(url);
    avisar("Enlace copiado.");
  } catch (_) {
    prompt("Copiá el enlace:", url);
  }
}

function pintarListas() {
  $("#rp-sin-listas").hidden = st.listas.length > 0;
  $("#rp-listas").innerHTML = st.listas.map((l) => {
    const url = enlaceLista(l);
    const canciones = l.items.map((it, i) => `<li>
        <button type="button" class="rp-fila" data-l-tocar="${esc(l.id)}" data-i="${i}"><b>${esc(st.porId.get(it.cancionId)?.titulo || "Canción que ya no está en la Biblioteca")}</b></button>
        <button type="button" class="rp-ico" data-l-subir="${esc(l.id)}" data-i="${i}" aria-label="Subir"${i ? "" : " disabled"}>↑</button>
        <button type="button" class="rp-ico" data-l-bajar="${esc(l.id)}" data-i="${i}" aria-label="Bajar"${i < l.items.length - 1 ? "" : " disabled"}>↓</button>
        <button type="button" class="rp-ico" data-l-quitar="${esc(l.id)}" data-i="${i}" aria-label="Quitar de la lista">✕</button>
      </li>`).join("");
    return `<li class="rp-tarjeta" data-lista="${esc(l.id)}">
      <div class="rp-tarjeta-cabeza">
        ${caraLista(l, "media")}
        <div><b>${esc(l.nombre)}</b><small>${l.items.length} ${l.items.length === 1 ? "canción" : "canciones"}</small></div>
        <button type="button" class="rp-btn rp-btn-fuerte" data-l-tocar="${esc(l.id)}" data-i="0"${l.items.length ? "" : " disabled"}>▶ Reproducir</button>
      </div>
      <div class="rp-tarjeta-acciones">
        <a class="rp-btn" href="${esc(whatsapp("Lista «" + l.nombre + "» para escuchar:", url))}" target="_blank" rel="noopener">WhatsApp</a>
        <button type="button" class="rp-btn" data-l-copiar="${esc(l.id)}">Copiar enlace</button>
        <button type="button" class="rp-btn" data-l-editar="${esc(l.id)}" aria-expanded="${st.abierta === l.id}">${st.abierta === l.id ? "Listo" : "Editar"}</button>
      </div>
      <div class="rp-editar" ${st.abierta === l.id ? "" : "hidden"}>
        <label>Nombre <input type="text" maxlength="80" value="${esc(l.nombre)}" data-l-nombre="${esc(l.id)}"></label>
        <ol class="rp-lista rp-lista-edit">${canciones || '<li class="rp-aviso">Lista vacía: agregá canciones con «+».</li>'}</ol>
        <button type="button" class="rp-btn rp-peligro" data-l-borrar="${esc(l.id)}">Borrar la lista</button>
      </div>
    </li>`;
  }).join("");
}

// La lista sugerida lleva el nombre de quien escucha: el de su sesión o el que dio una vez en este equipo
function miNombre(preguntar) {
  let n = String(sesionActual()?.nombre || "").trim() || guardado("mc-mi-nombre", "");
  if (!n && preguntar && !guardado("mc-mi-nombre-pedido", "")) {
    guardar("mc-mi-nombre-pedido", "1");
    n = String(prompt("¿Cómo te llamás? Tu lista va a llevar tu nombre.", "") || "").trim().slice(0, 40);
    if (n) guardar("mc-mi-nombre", n);
  }
  return n;
}
const nombreSugerido = (preguntar) => {
  const n = miNombre(preguntar);
  return n ? "Lista de " + n : "Mi lista";
};

function nuevaLista(items = [], nombre) {
  nombre = (nombre ?? prompt("Nombre de la lista:", nombreSugerido(false)))?.trim();
  if (!nombre) return null;
  const usados = new Set(st.listas.map((l) => l.nombre));
  let final = nombre.slice(0, 80);
  for (let n = 2; usados.has(final); n++) final = nombre.slice(0, 74) + " (" + n + ")";
  const l = { id: uid(), nombre: final, items: items.map(({ cancionId, desplazamiento, momento }) =>
    ({ cancionId, desplazamiento: desplazamiento || 0, ...(momento ? { momento } : {}) })) };
  st.listas.push(l);
  guardarListas();
  pintarListas();
  return l;
}

function accionLista(e) {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset, i = +d.i;
  const l = st.listas.find((x) => x.id === (d.lTocar || d.lSubir || d.lBajar || d.lQuitar || d.lCopiar || d.lEditar || d.lBorrar));
  if (!l) return;
  if (d.lTocar) {
    if (!l.items.length) return;
    colaPropia({ nombre: l.nombre, tipo: "lista", listaId: l.id, items: l.items.map((x) => ({ ...x })) });
    reproducir(i);
    mostrarVista("sonando");
    return;
  }
  if (d.lCopiar) return copiar(enlaceLista(l));
  if (d.lEditar) st.abierta = st.abierta === l.id ? "" : l.id;
  if (d.lSubir && i > 0) [l.items[i - 1], l.items[i]] = [l.items[i], l.items[i - 1]];
  if (d.lBajar && i < l.items.length - 1) [l.items[i + 1], l.items[i]] = [l.items[i], l.items[i + 1]];
  if (d.lQuitar) l.items.splice(i, 1);
  if (d.lBorrar) {
    if (!confirm(`¿Borrar la lista «${l.nombre}»?`)) return;
    st.listas = st.listas.filter((x) => x !== l);
  }
  guardarListas();
  pintarListas();
}

// Agregar a una lista
let agregando = "";
function abrirAgregar(id) {
  if (!id) return avisar("Elegí primero una canción.");
  agregando = id;
  const c = st.porId.get(id);
  $("#rp-agregar-que").textContent = "«" + (c?.titulo || "Canción") + "»";
  const sugerido = nombreSugerido(true);
  const suya = st.listas.find((l) => l.nombre === sugerido);
  const fila = (l, clase = "") =>
    `<li class="${clase}"><button type="button" class="rp-fila" data-a-lista="${esc(l.id)}"><b>${esc(l.nombre)}</b><small>${l.items.length} ${l.items.length === 1 ? "canción" : "canciones"}${l.items.some((x) => x.cancionId === id) ? " · ya está" : ""}</small></button></li>`;
  $("#rp-agregar-listas").innerHTML = (suya ? fila(suya, "rp-sugerida")
    : `<li class="rp-sugerida"><button type="button" class="rp-fila" data-a-sugerida="${esc(sugerido)}"><b>${esc(sugerido)}</b><small>Lista nueva</small></button></li>`)
    + st.listas.filter((l) => l !== suya).map((l) => fila(l)).join("");
  $("#rp-dlg-agregar").showModal();
}
function agregarA(l) {
  l.items.push({ cancionId: agregando, desplazamiento: 0 });
  guardarListas();
  $("#rp-dlg-agregar").close();
  avisar(`Agregada a «${l.nombre}».`);
  pintarListas();
}

// ============ CANCIONEROS DE MISA ============

async function cargarMisas() {
  $("#rp-estado-misas").hidden = false;
  $("#rp-estado-misas").textContent = "Cargando…";
  try {
    st.misas = (await leer({ accion: "misas", ...(st.comunidad ? { comunidad: st.comunidad } : {}) })).misas || [];
  } catch (e) {
    st.misas = null;
    $("#rp-estado-misas").textContent = e.message;
    return;
  }
  pintarMisas();
}

const cuantas = (m) => m.momentos.reduce((n, x) => n + x.canciones.length, 0);
const fechaCorta = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";

function pintarMisas() {
  const lista = (st.misas || []).filter((m) => cuantas(m));
  $("#rp-estado-misas").hidden = !!lista.length;
  if (!lista.length) $("#rp-estado-misas").textContent = "No hay cancioneros con canciones.";
  $("#rp-misas").innerHTML = lista.map((m) => {
    const n = cuantas(m), comunidad = COMUNIDADES.find((c) => c.slug === m.comunidad)?.nombre || "";
    return `<li class="rp-tarjeta">
      <div class="rp-tarjeta-cabeza">
        ${caraMisa(m, "media")}
        <div><b>${esc(m.nombre)}</b><small>${esc([fechaCorta(m.fechaUso), st.comunidad ? "" : comunidad, n + (n === 1 ? " canción" : " canciones")].filter(Boolean).join(" · "))}</small></div>
        <a class="rp-btn rp-btn-fuerte" href="#misa=${esc(encodeURIComponent(m.id))}">▶ Reproducir</a>
      </div>
      <div class="rp-tarjeta-acciones">
        <button type="button" class="rp-btn" data-misa-escenario="${esc(m.id)}" title="Solo la letra y los acordes a pantalla completa, para cantar en la misa">${icono("escenario")} Modo escenario</button>
      </div>
    </li>`;
  }).join("");
}

function colaDeMisa(m) {
  return {
    nombre: m.nombre || "Cancionero de misa", tipo: "misa", misaId: m.id, comunidad: m.comunidad || "",
    items: m.momentos.flatMap((x, mi) => x.canciones.map((c, ci) => ({
      cancionId: c.cancionId, desplazamiento: c.desplazamiento || 0, momento: x.momento, capo: c.capo || 0, velocidad: c.velocidad || 1,
      ...(c.scroll ? { scroll: c.scroll } : {}), mi, ci
    })))
  };
}

async function abrirMisa(id, tocar = true) {
  let m = null;
  try {
    const copia = JSON.parse(localStorage.getItem("mc-reproducir") || "null");
    if (copia?.id === id && Date.now() - copia.t < 12 * 3600e3) m = copia;
  } catch (_) { /* sin copia local */ }
  if (!m) {
    try {
      m = ((await leer({ accion: "misas" })).misas || []).find((x) => x.id === id);
    } catch (e) {
      return avisar(e.message);
    }
  }
  if (!m || !cuantas(m)) return avisar("Ese cancionero no existe o todavía no tiene canciones.");
  st.cola = colaDeMisa(m);
  colaHash = location.hash;
  mostrarVista("sonando");
  reproducir(0, tocar);
  return true;
}

// Botón Editor del menú: con un cancionero de misa sonando que la cuenta puede editar, lo abre en la canción que suena;
// si no, abre la canción que suena (como vista previa) en el tono de Sonando
function pintarBotonEditor() {
  const c = st.cola, b = $("#rp-editor-menu");
  if (!b) return;
  b.hidden = tv;
  const it = c && !tv ? c.items[st.indice] : null;
  const misa = !!it && c.tipo === "misa" && !!c.misaId && puedeEditar(c.comunidad);
  const dif = it ? (((it.desplazamiento || 0) - (it.tonoBase ?? (it.desplazamiento || 0))) % 12 + 12) % 12 : 0;
  const extra = dif > 6 ? dif - 12 : dif;
  b.href = misa ? "/editor/?misa=" + encodeURIComponent(c.misaId) + (it.mi != null ? "&foco=" + it.mi + "." + it.ci : "")
      + "&editar=1" + (extra ? "&tono=" + extra : "")
    : it ? "/editor/?cancion=" + encodeURIComponent(it.cancionId) + (it.desplazamiento ? "&tono=" + it.desplazamiento : "")
    : "/editor/";
  b.classList.toggle("con-misa", !!it);
  b.title = misa ? "Editar la canción que suena dentro de su cancionero, en el tono de Sonando: «Guardar en la misa» lo deja para todo el coro"
    : it ? "Abrir la canción que suena en el editor, en el tono de Sonando"
    : "Editar canciones y audios, transponer, grabar, partituras y tablaturas";
  b.querySelector(".rp-no-celular").textContent = it ? "Editar esta canción" : "Editor";
}

// ============ CREAR NUEVA MISA ============
// Inicio → «Crear nueva misa»: la fecha; un canto sugerido por momento según las lecturas de ese día (para un domingo
// de los estantes de Inicio, el mismo de ese estante); elegir uno de cada momento y guardar el cancionero: en la
// comunidad si la cuenta puede editarla, si no en «Mis listas» de este equipo.

const crear = { paso: "fecha", fecha: "", lecturas: null, tiempo: "", momentos: [], motivos: new Map(), sugeridas: [], eleccion: [], candidatos: [], turno: 0,
  celebracion: "", celTocada: false, intencion: "", misas: [], habituales: [], habComunidad: "" };
const oido = new Audio();
let oyendo = "";

const fechaDia = (iso) => {
  const d = new Date(iso + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  return d.charAt(0).toUpperCase() + d.slice(1);
};
// Cada momento: elegida = cancionId, "" = sin canto, undefined = todavía no
const completa = () => crear.momentos.length > 0 && crear.eleccion.every((x) => x !== undefined);

function abrirCrear() {
  if (!crear.fecha) crear.fecha = domingo;
  $("#rp-crear-fecha").value = crear.fecha;
  const sel = $("#rp-crear-celebracion");
  if (!sel.options.length) {
    sel.innerHTML = `<optgroup label="Misa"><option value="">Misa del día</option></optgroup>` + lit.celebracionesPorGrupo().map(([g, l]) =>
      `<optgroup label="${esc(g)}">${l.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}</optgroup>`).join("");
  }
  sel.value = crear.celebracion;
  $("#rp-crear-intencion").value = crear.intencion;
  pintarDiaCrear();
  pasoCrear("fecha");
  $("#rp-dlg-crear").showModal();
  // Los momentos que la comunidad suele agregar (la que se propone después para guardar)
  todasLasMisas().then((misas) => {
    crear.misas = misas;
    const com = comunidadPorDefecto()?.slug || "";
    if (com !== crear.habComunidad || !crear.habituales.length) {
      crear.habComunidad = com;
      crear.habituales = momentosHabituales(misas, com);
    }
    pintarHabituales();
  }).catch(() => {});
}

function pintarHabituales() {
  const box = $("#rp-crear-habituales"), com = COMUNIDADES.find((c) => c.slug === crear.habComunidad);
  box.innerHTML = crear.habituales.length ? `<fieldset class="rp-crear-hab"><legend>Momentos que suele agregar ${esc(com?.nombre || "tu comunidad")}</legend>
    ${crear.habituales.map((h, k) => `<label><input type="checkbox" data-c-hab="${k}"${h.marcado ? " checked" : ""}> ${esc(h.momento)}${h.cancionId && st.porId.get(h.cancionId)
      ? ` <small>· con «${esc(st.porId.get(h.cancionId).titulo)}»</small>` : ""}</label>`).join("")}</fieldset>` : "";
}

function pintarDiaCrear() {
  const f = $("#rp-crear-fecha").value, box = $("#rp-crear-dia");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
    box.innerHTML = "";
    return;
  }
  const tiempo = lit.tiempoPorFecha(f), color = lit.colorPorTiempo(tiempo);
  box.innerHTML = `<b>${esc(fechaDia(f))}</b><span>${esc(lit.nombreDelDia(f))}</span>
    <span><span class="rp-punto" style="background:${COLOR_LITURGICO[color] || acentoLiturgico}"></span>${esc(tiempo)} · color ${esc(color.toLowerCase())}</span>`;
  // Corpus, Cristo Rey, Sagrado Corazón o una fiesta de la Virgen: se propone sola (si no se eligió otra)
  if (!crear.celTocada) {
    lecturasDelDia(f).catch(() => null).then((l) => {
      if (crear.celTocada || $("#rp-crear-fecha").value !== f) return;
      crear.celebracion = lit.celebracionDelDia(l, f);
      $("#rp-crear-celebracion").value = crear.celebracion;
    });
  }
}

// La comunidad donde se propone guardar: la elegida en el reproductor, la de la cuenta o la sede de la parroquia
function comunidadPorDefecto() {
  const s = sesionActual();
  const propias = COMUNIDADES.filter((c) => puedeEditar(c.slug));
  const plano = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const sede = propias.find((c) => c.nombre && plano(PARROQUIA.nombre).includes(plano(c.nombre)));
  return propias.find((c) => c.slug === st.comunidad) || propias.find((c) => c.slug === s?.comunidad) || sede || propias[0] || null;
}

function pasoCrear(p) {
  crear.paso = p;
  const dlg = $("#rp-dlg-crear");
  dlg.querySelectorAll("section[data-paso]").forEach((s) => (s.hidden = s.dataset.paso !== p));
  dlg.querySelectorAll(".rp-crear-pasos li").forEach((li) => li.classList.toggle("activo", li.dataset.paso === p));
  $("#rp-crear-atras").hidden = p === "fecha";
  const seguir = $("#rp-crear-seguir");
  seguir.textContent = { fecha: "Sugerir cantos", elegir: "Crear cancionero", crear: "Guardar" }[p];
  seguir.disabled = p === "elegir" && !completa();
  dlg.querySelector(".rp-crear-cuerpo").scrollTop = 0;
  if (p === "crear") pintarPasoGuardar();
}

// Los momentos de esa fecha con su canto sugerido: { lecturas, tiempo, momentos, motivos }
async function sugerenciasDe(fecha) {
  const biblioteca = st.biblioteca, misas = (await todasLasMisas()).filter(cuantas);
  const esDomingo = new Date(fecha + "T12:00:00").getDay() === 0;
  const cel = lit.celebracionPorId(crear.celebracion);
  const habituales = crear.habituales.filter((h) => h.marcado);
  // Un domingo sin celebración: los mismos cantos del estante de Inicio
  const listo = !cel && esDomingo && domingosListos?.some((d) => d.fecha === fecha)
    && lit.sugerirDomingos(domingosListos, { biblioteca, misas }).find((d) => d.fecha === fecha);
  let lecturas, tiempo, momentos, motivos;
  const borrador = () => ({ id: "nueva-" + fecha, comunidad: crear.habComunidad, fechaUso: fecha, tiempoLiturgico: tiempo,
    celebracion: crear.celebracion, momentos });
  if (listo) {
    ({ lecturas } = listo);
    tiempo = listo.misa.tiempoLiturgico;
    motivos = new Map(listo.motivos);
    momentos = ponerHabituales(listo.misa.momentos.map((m) => ({ momento: m.momento, canciones: m.canciones.map((c) => ({ ...c })) })), habituales);
    if (habituales.length) lit.sugerirCantos(borrador(), lecturas, { biblioteca, misas, motivos });
  } else {
    lecturas = await lecturasDelDia(fecha).catch(() => null);
    const base = lit.momentosDeMisa(fecha, lecturas, crear.celebracion);
    tiempo = base.tiempo;
    // El Gloria va los domingos (fuera de Adviento y Cuaresma), en las solemnidades, en las fiestas y en las celebraciones que lo llevan
    const fiesta = lit.etiquetasDelDia(lecturas?.titulo).fiestas.length || /SOLEMNIDAD|FIESTA/i.test(lecturas?.titulo || "");
    momentos = ponerHabituales(base.momentos.filter((m) => esDomingo || fiesta || cel?.gloria === true || m.momento !== "Gloria"), habituales);
    motivos = new Map();
    const evitar = esDomingo && !cel ? await lit.evitadosDelMes(fecha, lecturasDelDia, { biblioteca, misas }).catch(() => null) : null;
    lit.sugerirCantos(borrador(), lecturas, { biblioteca, misas, motivos, evitar });
  }
  for (const h of habituales) if (h.cancionId) motivos.set(h.momento, { texto: "El que cantaron la última vez", corto: "como la última vez" });
  // En Cuaresma no se canta el aleluya: la aclamación al Evangelio es otra
  if (lit.TIEMPOS_SIN_ALELUYA.includes(tiempo)) {
    for (const m of momentos.filter((x) => x.momento === "Aleluya")) {
      if (motivos.has(m.momento)) motivos.set("Aclamación al Evangelio", motivos.get(m.momento));
      m.momento = "Aclamación al Evangelio";
    }
  }
  return { lecturas, tiempo, momentos, motivos };
}

// La sugerida primero; después las del momento (por su etiqueta, el título o la letra) según el tiempo y la celebración
function candidatosDe(momento, sugerida) {
  const lista = lit.candidatosMomento(st.biblioteca, momento, { fechaUso: crear.fecha, tiempoLiturgico: crear.tiempo,
    celebracion: crear.celebracion, lecturas: crear.lecturas }).filter((x) => x.delMomento && x.cancion.id !== sugerida).map((x) => x.cancion);
  const s = sugerida && st.porId.get(sugerida);
  return [...(s ? [s] : []), ...lista.slice(0, 30)];
}

// Agrega un momento en el paso «Cantos»: con su canto (cancionId; "" = sin canto) o con el primero que le calce
function agregarEnCrear(nombre, pos = lit.posicionMomento(crear.momentos, nombre), cancionId = null) {
  if (crear.momentos.some((m) => lit.claveMomento(m.momento) === lit.claveMomento(nombre))) return;
  const sug = cancionId ?? (candidatosDe(nombre, "")[0]?.id || "");
  crear.momentos.splice(pos, 0, { momento: nombre, canciones: [] });
  crear.sugeridas.splice(pos, 0, cancionId == null ? sug : "");
  crear.eleccion.splice(pos, 0, cancionId != null ? cancionId : sug || undefined);
  crear.candidatos.splice(pos, 0, candidatosDe(nombre, sug));
  pintarElegir();
  $(`#rp-crear-estantes [data-c-momento="${pos}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function quitarEnCrear(i) {
  for (const k of ["momentos", "sugeridas", "eleccion", "candidatos"]) crear[k].splice(i, 1);
  pintarElegir();
}

async function agregarMomentoCrear(valor) {
  if (valor !== "__otro") return agregarEnCrear(valor);
  const r = await crearMomento({ momentos: crear.momentos, biblioteca: st.biblioteca, misas: crear.misas, comunidad: crear.habComunidad,
    fechaUso: crear.fecha, tiempoLiturgico: crear.tiempo, celebracion: crear.celebracion });
  if (r) agregarEnCrear(r.nombre, r.posicion, r.cancionId);
}

async function sugerirParaFecha() {
  const fecha = $("#rp-crear-fecha").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return avisar("Elegí la fecha de la misa.");
  if (!st.biblioteca.length) return avisar("La Biblioteca todavía no está cargada.");
  const t = ++crear.turno;
  crear.fecha = fecha;
  pasoCrear("elegir");
  $("#rp-crear-buscar").value = "";
  $("#rp-crear-resumen").textContent = "";
  $("#rp-crear-estantes").innerHTML = `<p class="rp-aviso">Buscando las lecturas y los cantos para el ${esc(fechaDia(fecha).toLowerCase())}…</p>`;
  $("#rp-crear-seguir").disabled = true;
  let r;
  try {
    r = await sugerenciasDe(fecha);
  } catch (e) {
    if (t === crear.turno) $("#rp-crear-estantes").innerHTML = `<p class="rp-error">${esc(e.message)}</p>`;
    return;
  }
  if (t !== crear.turno) return;
  Object.assign(crear, r);
  crear.sugeridas = r.momentos.map((m) => m.canciones[0]?.cancionId || "");
  crear.eleccion = crear.sugeridas.map((id) => id || undefined);
  crear.candidatos = r.momentos.map((m, i) => candidatosDe(m.momento, crear.sugeridas[i]));
  pintarElegir();
}

const tarjetaCrear = (c, i, momento, elegida, sub) => `<div class="rp-tj${elegida ? " elegida" : ""}" data-c-elegir="${i}" data-id="${esc(c.id)}">
    <div class="rp-tj-cara">${cara(c, "grande", momento)}<button type="button" class="rp-tj-play" data-c-oir="${esc(c.id)}" aria-label="Escuchar «${esc(c.titulo)}»">${icono(oyendo === c.id && !oido.paused ? "pausa" : "play")}</button></div>
    <button type="button" class="rp-tj-titulo">${esc(c.titulo)}</button>
    <div class="rp-tj-sub">${esc(sub)}</div>
  </div>`;

const estadoMomento = (i) => {
  const e = crear.eleccion[i];
  return e === undefined ? "Elegí uno" : e ? "✓ " + (st.porId.get(e)?.titulo || "") : "✓ Sin canto";
};

function pintarResumen() {
  const ev = lit.evangelioDe(crear.lecturas);
  const nombre = crear.lecturas?.titulo ? lit.tituloLiturgico(crear.lecturas.titulo) : lit.nombreDelDia(crear.fecha);
  const n = crear.eleccion.filter((x) => x !== undefined).length;
  $("#rp-crear-resumen").innerHTML = `<b>${esc(fechaDia(crear.fecha))}</b> · ${esc(nombre)}`
    + (ev ? ` · Evangelio según ${esc(ev.cita)}` : crear.lecturas ? "" : " · lecturas aún no publicadas: según el tiempo litúrgico")
    + `<span class="rp-crear-cuenta${n === crear.momentos.length ? " lista" : ""}">${n} de ${crear.momentos.length} momentos elegidos</span>`;
  $("#rp-crear-seguir").disabled = !completa();
}

function pintarElegir() {
  const q = $("#rp-crear-buscar").value.trim();
  const hallados = q ? buscarCanciones(st.biblioteca, q).slice(0, 24) : null;
  pintarResumen();
  $("#rp-crear-estantes").innerHTML = crear.momentos.map((m, i) => {
    const elegida = crear.eleccion[i], motivo = crear.motivos.get(m.momento);
    let lista = hallados || crear.candidatos[i];
    if (elegida && !lista.some((c) => c.id === elegida) && st.porId.get(elegida)) lista = [st.porId.get(elegida), ...lista];
    const tarjetas = lista.map((c) => tarjetaCrear(c, i, m.momento, c.id === elegida,
      c.id === crear.sugeridas[i] ? "Sugerida" + (motivo?.corto ? " · " + motivo.corto : "") : subCancion(c)));
    tarjetas.push(`<div class="rp-tj rp-tj-sin${elegida === "" ? " elegida" : ""}" data-c-elegir="${i}" data-id="">
      <div class="rp-tj-cara"><span class="cara grande rp-cara-sin" aria-hidden="true">—</span></div>
      <button type="button" class="rp-tj-titulo">Sin canto</button><div class="rp-tj-sub">Dejar este momento vacío</div></div>`);
    return `<div class="rp-crear-momento" data-c-momento="${i}"><button type="button" class="rp-ico rp-crear-quitar" data-c-quitar="${i}"
      title="Quitar «${esc(m.momento)}» de esta misa" aria-label="Quitar ${esc(m.momento)}">✕</button>${estante(m.momento, estadoMomento(i), tarjetas)}</div>`;
  }).join("");
  $("#rp-crear-agregar").innerHTML = opcionesMomento(gruposDeMomentos(crear.momentos, { habituales: crear.habituales, celebracion: crear.celebracion }),
    "Elegí uno o creá uno nuevo…");
}

function elegirEnCrear(tj) {
  const i = +tj.dataset.cElegir, caja = tj.closest("[data-c-momento]");
  crear.eleccion[i] = tj.dataset.id;
  caja.querySelectorAll("[data-c-elegir]").forEach((x) => x.classList.toggle("elegida", x === tj));
  caja.querySelector(".rp-estante-cabeza small").textContent = estadoMomento(i);
  pintarResumen();
}

// ▶ en una tarjeta: escuchar la canción sin elegirla (con su audio de la Biblioteca)
function escuchar(id) {
  if (oyendo === id && !oido.paused) return oido.pause();
  const rep = audiosReproducibles(st.porId.get(id));
  const a = rep.find((x) => x.fileId) || rep.find((x) => !esVideo(x));
  if (!a) return avisar(rep.length ? "Esa canción solo tiene video: escuchala después en el reproductor." : "Esa canción no tiene audio.");
  if (!audio.paused) audio.pause();
  if (yt?.activo && !yt.paused) yt.pause();
  oyendo = id;
  oido.src = a.fileId ? urlAudio(a.fileId) : a.url;
  oido.play().catch(() => avisar("No se pudo reproducir el audio."));
}
const pintarOido = () => document.querySelectorAll("#rp-crear-estantes [data-c-oir]").forEach((b) => {
  const k = oyendo === b.dataset.cOir && !oido.paused ? "pausa" : "play";
  if (b.dataset.estado !== k) {
    b.dataset.estado = k;
    b.innerHTML = icono(k);
  }
});

// «Matrimonio · Juan y Ana · sábado 14 de noviembre», «Misa por Juan Pérez · …»
function nombreCrear() {
  const cel = lit.celebracionPorId(crear.celebracion), para = crear.intencion.trim(), dia = fechaDia(crear.fecha).toLowerCase();
  if (!cel) return para ? `Misa por ${para} · ${dia}` : "Misa " + dia;
  return [cel.nombre, para, dia].filter(Boolean).join(" · ");
}

function pintarPasoGuardar() {
  const nombre = $("#rp-crear-nombre"), para = [crear.fecha, crear.celebracion, crear.intencion].join("|");
  if (nombre.dataset.para !== para) {
    nombre.value = nombreCrear();
    nombre.dataset.para = para;
  }
  const s = sesionActual();
  const propias = COMUNIDADES.filter((c) => puedeEditar(c.slug));
  if (propias.length) {
    // Al volver a este paso queda la que se había elegido
    const previo = $("#rp-crear-comunidad")?.value;
    const def = previo != null ? propias.find((c) => c.slug === previo) || null : comunidadPorDefecto();
    $("#rp-crear-donde").innerHTML = `<label class="rp-campo">Guardar en
      <select id="rp-crear-comunidad">${propias.map((c) => `<option value="${esc(c.slug)}"${c === def ? " selected" : ""}>Cancioneros de ${esc(c.nombre)}</option>`).join("")}
        <option value=""${def ? "" : " selected"}>Mis listas (solo en este equipo)</option></select></label><div id="rp-crear-aviso-com"></div>`;
  } else {
    $("#rp-crear-donde").innerHTML = `<p class="rp-aviso">Se guarda en <b>Mis listas</b> de este equipo. ${s
      ? "Tu cuenta todavía no tiene permiso para guardar cancioneros de misa: pedíselo a un responsable de la parroquia."
      : `<a href="/login">Identificate</a> para guardarlo como cancionero de tu comunidad.`}</p>`;
  }
  $("#rp-crear-lista").innerHTML = crear.momentos.map((m, i) => `<li><small>${esc(m.momento)}</small>
    <b>${esc(crear.eleccion[i] ? st.porId.get(crear.eleccion[i])?.titulo || "" : "Sin canto")}</b></li>`).join("");
}

async function guardarCrear() {
  const nombre = $("#rp-crear-nombre").value.trim();
  if (!nombre) return avisar("Escribí el nombre del cancionero.");
  const comunidad = $("#rp-crear-comunidad")?.value || "";
  const momentos = crear.momentos.map((m, i) => ({
    momento: m.momento, canciones: crear.eleccion[i]
      ? [{ cancionId: crear.eleccion[i], desplazamiento: 0, ...(crear.eleccion[i] === crear.sugeridas[i] ? { sugerida: true } : {}) }] : []
  }));
  if (!momentos.some((m) => m.canciones.length)) return avisar("Elegí al menos una canción.");
  if (!comunidad) {
    const l = nuevaLista(momentos.flatMap((m) => m.canciones.map((c) => ({ cancionId: c.cancionId, desplazamiento: 0, momento: m.momento }))), nombre);
    if (!l) return;
    $("#rp-dlg-crear").close();
    st.abierta = l.id;
    mostrarVista("listas");
    avisar(`Se guardó «${l.nombre}» en Mis listas.`);
    return;
  }
  const boton = $("#rp-crear-seguir");
  boton.disabled = true;
  boton.textContent = "Guardando…";
  try {
    const r = await llamarApi("guardarMisa", {
      token: sesionActual()?.token || "",
      misa: { nombre, comunidad, fechaUso: crear.fecha, tiempoLiturgico: crear.tiempo, celebracion: crear.celebracion,
        intencion: crear.intencion.trim(), momentos }
    });
    misasPublicas = null;
    st.misas = null;
    inicioViejo = true;
    guardar("mc-reproducir", JSON.stringify({ ...r.misa, t: Date.now() }));
    $("#rp-dlg-crear").close();
    history.replaceState(null, "", location.pathname + location.search + "#misa=" + encodeURIComponent(r.misa.id));
    await abrirMisa(r.misa.id, false);
    avisar(`Se creó «${r.misa.nombre}». Con «Modificar en editor» del menú cambiás tonos, letras y canciones.`);
  } catch (e) {
    avisar(e.message);
  } finally {
    boton.disabled = false;
    boton.textContent = "Guardar";
  }
}

function conectarCrear() {
  const dlg = $("#rp-dlg-crear");
  dlg.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
  $("#rp-crear-cerrar").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => {
    oido.pause();
    oyendo = "";
  });
  $("#rp-crear-fecha").addEventListener("input", pintarDiaCrear);
  $("#rp-crear-celebracion").addEventListener("change", (e) => {
    crear.celebracion = e.target.value;
    crear.celTocada = true;
  });
  $("#rp-crear-intencion").addEventListener("input", (e) => (crear.intencion = e.target.value));
  $("#rp-crear-habituales").addEventListener("change", (e) => {
    const k = e.target.dataset.cHab;
    if (k != null && crear.habituales[+k]) crear.habituales[+k].marcado = e.target.checked;
  });
  $("#rp-crear-agregar").addEventListener("change", (e) => {
    const v = e.target.value;
    e.target.value = "";
    if (v) agregarMomentoCrear(v);
  });
  // Otra comunidad en el paso 3: sus momentos habituales son otros, se ofrece agregarlos
  $("#rp-crear-donde").addEventListener("change", (e) => {
    if (e.target.id !== "rp-crear-comunidad") return;
    const slug = e.target.value, caja = $("#rp-crear-aviso-com");
    const otros = slug && slug !== crear.habComunidad ? momentosHabituales(crear.misas, slug)
      .filter((h) => !crear.momentos.some((m) => lit.claveMomento(m.momento) === lit.claveMomento(h.momento))) : [];
    caja.innerHTML = otros.length ? `<p class="rp-aviso">${esc(COMUNIDADES.find((c) => c.slug === slug)?.nombre || "Esa comunidad")} suele agregar
      ${otros.map((h) => "«" + esc(h.momento) + "»").join(", ")}. <button type="button" class="rp-btn" data-c-hab-agregar="${esc(slug)}">Agregarlos</button></p>` : "";
  });
  $("#rp-crear-donde").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c-hab-agregar]");
    if (!b) return;
    const slug = b.dataset.cHabAgregar;
    for (const h of momentosHabituales(crear.misas, slug)) agregarEnCrear(h.momento, lugarHabitual(crear.momentos, h), h.cancionId || null);
    crear.habComunidad = slug;
    crear.habituales = momentosHabituales(crear.misas, slug);
    $("#rp-crear-aviso-com").innerHTML = "";
    pintarPasoGuardar();
  });
  $("#rp-crear-seguir").addEventListener("click", () => {
    if (crear.paso === "fecha") sugerirParaFecha();
    else if (crear.paso === "elegir" && completa()) pasoCrear("crear");
    else if (crear.paso === "crear") guardarCrear();
  });
  $("#rp-crear-atras").addEventListener("click", () => pasoCrear(crear.paso === "crear" ? "elegir" : "fecha"));
  let espera = 0;
  $("#rp-crear-buscar").addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(pintarElegir, 200);
  });
  $("#rp-crear-estantes").addEventListener("click", (e) => {
    const des = e.target.closest("[data-desplazar]");
    if (des) {
      const fila = des.closest(".rp-estante").querySelector(".rp-estante-fila");
      return fila.scrollBy({ left: +des.dataset.desplazar * fila.clientWidth * 0.9, behavior: "smooth" });
    }
    const oir = e.target.closest("[data-c-oir]");
    if (oir) return escuchar(oir.dataset.cOir);
    const q = e.target.closest("[data-c-quitar]");
    if (q) return quitarEnCrear(+q.dataset.cQuitar);
    const tj = e.target.closest("[data-c-elegir]");
    if (tj) elegirEnCrear(tj);
  });
  for (const ev of ["play", "pause", "ended", "emptied"]) oido.addEventListener(ev, pintarOido);
  $("#rp-crear-nombre").addEventListener("keydown", (e) => {
    if (e.key === "Enter") guardarCrear();
  });
}

// ============ COLA GUARDADA ============
// Al refrescar o volver a abrir, sigue en la misma cola y canción; la cola cambia solo al elegir otra cosa

const SONANDO = "mc-rp-sonando";
let colaHash = "", retomarEn = 0, ultimoGuardado = 0, turnoSonando = -1;

// Una cola elegida dentro de la página deja de depender del enlace con que se abrió
function colaPropia(cola) {
  if (/^#(l|misa)=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  colaHash = "";
  st.cola = cola;
}

function guardarSonando(desde) {
  if (!st.cola || st.indice < 0) return;
  ultimoGuardado = Date.now();
  const m = motor();
  // Mientras llega el audio de una canción nueva, el <audio> todavía tiene el segundo de la anterior
  const actual = m === audio && turnoSonando !== turno ? 0 : m.currentTime;
  guardar(SONANDO, JSON.stringify({
    cola: st.cola, indice: st.indice,
    segundo: Math.floor(desde ?? (retomarEn || actual || 0)),
    audio: st.elegido.get(actualId()) ?? null,
    orden: modos.aleatorio && ordenDe === st.cola ? orden : null,
    hash: colaHash, cuando: Date.now()
  }));
}

function sonandoGuardado() {
  try {
    const s = JSON.parse(guardado(SONANDO, "null"));
    if (!s?.cola?.items?.length || !(s.indice >= 0 && s.indice < s.cola.items.length)) return null;
    if (Date.now() - (s.cuando || 0) > 7 * 86400e3) return null;
    if (st.porId.size && !st.porId.has(s.cola.items[s.indice].cancionId)) return null;
    return s;
  } catch (_) {
    return null;
  }
}

function recuperarSonando(s) {
  st.cola = s.cola;
  colaHash = s.hash || "";
  if (Number.isInteger(s.audio)) st.elegido.set(s.cola.items[s.indice].cancionId, s.audio);
  if (modos.aleatorio && s.orden?.length === s.cola.items.length) {
    orden = s.orden;
    ordenDe = st.cola;
  }
  reproducir(s.indice, false, s.segundo || 0);
  avisar(`Seguís en «${s.cola.nombre}»: tocá ▶ abajo para continuar.`);
}

// Al abrir: un enlace distinto arma su cola; si no, sigue con la guardada
function arrancar() {
  const h = location.hash, s = /^#(vivo=|pantalla)/.test(h) ? null : sonandoGuardado();
  if (s && (!h || h === s.hash)) recuperarSonando(s);
  else leerHash();
  // El teléfono que manejaba una pantalla vuelve a conectarse solo
  const p = guardado("mc-rp-pantalla", "");
  if (!tv && !remoto && codigoValido(p)) conectarPantalla(p);
}

// ============ REPRODUCCIÓN ============

let turno = 0;

// El reproductor de YouTube se crea con el primer video; mientras tiene uno cargado, la barra lo maneja a él
let yt = null;
const reproductorYT = () => yt || (yt = crearReproductorYT($("#rp-video"), {
  alCambiar: () => {
    pintarBarra();
    if (!yt.activo) return;
    if (!yt.paused) saltos = retomarEn = 0;
    else if (yt.currentTime) guardarSonando();
    estadoDeMedios(yt.paused);
  },
  // Un video que termina se detiene, salvo con aleatorio o repetir
  alTerminar: () => {
    pintarBarra();
    if (modos.aleatorio || modos.repetir !== "no") alTerminarPista();
  },
  alError: (_, texto) => noDisponible(turno, texto)
}));
const motor = () => (remoto?.listo ? motorRemoto : yt?.activo ? yt : audio);
const tocarMotor = () => {
  const m = motor();
  if (m === audio) audio.play().catch(sinPermisoDeSonido);
  else m.play();
};

function quitarVideo() {
  if (yt?.activo) yt.destruir();
  $("#rp-video").hidden = $("#rp-video-nota").hidden = true;
}

function elegirAudio(entrada) {
  const lista = audiosReproducibles(entrada);
  if (!lista.length) return { lista, i: -1 };
  let i = st.elegido.get(entrada.id);
  if (!(i >= 0 && i < lista.length)) {
    const mia = guardado("mc-mi-voz", "");
    // A igualdad, el audio de la Biblioteca antes que el video de YouTube
    const buscar = (f) => {
      const k = lista.findIndex((a) => f(a) && !esVideo(a));
      return k >= 0 ? k : lista.findIndex(f);
    };
    i = buscar((a) => mia && a.voz === mia);
    if (i < 0) i = buscar((a) => !a.voz || a.voz === "todas" || a.voz === "unica");
    if (i < 0) i = buscar(() => true);
  }
  return { lista, i };
}

const nombreAudio = (a) => {
  const voz = a.voz && a.voz !== "todas" ? VOICES[a.voz]?.label || a.voz : "Todas las voces";
  if (esVideo(a)) return "Video de YouTube" + (a.voz && a.voz !== "todas" && a.voz !== "unica" ? " — " + voz : "");
  const nombre = String(a.nombre || "").trim();
  return nombre && !voz.toLowerCase().startsWith(nombre.toLowerCase()) ? `${voz} — ${nombre}` : voz;
};

function cargarAudio(a, tocar, desde = 0) {
  const t = ++turno;
  retomarEn = desde;
  audio.onerror = null;
  audio.pause();
  if (desde && a && !esVideo(a)) {
    audio.addEventListener("loadedmetadata", () => {
      if (t !== turno) return;
      audio.currentTime = Math.min(desde, audio.duration || desde);
    }, { once: true });
  }
  if (!a || esVideo(a)) {
    audio.removeAttribute("src");
    audio.load();
  }
  if (!a) {
    quitarVideo();
    pintarBarra();
    return;
  }
  if (esVideo(a)) {
    $("#rp-video").hidden = $("#rp-video-nota").hidden = false;
    reproductorYT().cargar(a.url, tocar, desde);
    pintarBarra();
    return;
  }
  quitarVideo();
  if (!a.fileId) {
    audio.onerror = () => noDisponible(t, "No se pudo cargar el audio: el enlace no responde.");
    audio.src = a.url;
    if (tocar) audio.play().catch(sinPermisoDeSonido);
    return;
  }
  audio.onerror = () => noDisponible(t, reproduceWebm ? "No se pudo cargar el audio."
    : "No se pudo cargar el audio: puede que todavía esté en el formato anterior (WebM), que este equipo no reproduce.");
  audio.src = urlAudio(a.fileId);
  if (tocar) audio.play().catch(sinPermisoDeSonido);
}

function pintarDonde(extra) {
  const c = st.cola;
  if (!c) return;
  $("#rp-donde").textContent = extra || `${c.nombre} · ${st.indice + 1} de ${c.items.length}`;
}

// desdeTv: el teléfono conectado a una pantalla solo se pone al día con la canción que el TV ya cambió
async function reproducir(i, tocar = true, desde = 0, desdeTv = false) {
  const c = st.cola;
  if (!c || i < 0 || i >= c.items.length) return;
  st.indice = i;
  guardarSonando(desde);
  const item = c.items[i];
  const entrada = st.porId.get(item.cancionId) || { id: item.cancionId, titulo: "", audios: [] };
  st.mezclador?.cerrar();
  cerrarPostura();
  $("#rp-nada").hidden = true;
  $("#rp-sonando").hidden = false;
  $("#rp-tono").hidden = true;
  $("#rp-barra").hidden = false;
  document.body.classList.add("con-barra");
  // La cejilla y la velocidad que eligieron en el editor para esta misa
  const etiqueta = [item.momento, item.capo ? "Capo " + item.capo : "", item.velocidad && item.velocidad !== 1 ? String(item.velocidad).replace(".", ",") + "×" : ""];
  $("#rp-momento").hidden = !etiqueta.some(Boolean);
  $("#rp-momento").textContent = etiqueta.filter(Boolean).join(" · ");
  audio.defaultPlaybackRate = audio.playbackRate = item.velocidad || 1;
  pintarDonde();
  $("#rp-titulo").textContent = $("#rp-barra-titulo").textContent = entrada.titulo || "";
  $("#rp-barra-sub").textContent = [item.momento || creditsText(normalizeCredits({ letra: entrada.letraDe, musica: entrada.musicaDe })), c.nombre]
    .filter(Boolean).join(" · ");

  const { lista, i: elegido } = elegirAudio(entrada);
  $("#rp-voz-caja").hidden = lista.length < 2;
  $("#rp-voz").innerHTML = lista.map((a, k) => `<option value="${k}"${k === elegido ? " selected" : ""}>${esc(nombreAudio(a))}</option>`).join("");
  $("#rp-sin-audio").hidden = lista.length > 0;
  if (!remoto?.listo) cargarAudio(lista[elegido], tocar, desde);
  else if (!desdeTv) enviarAPantalla(i, tocar, desde);
  pintarCaras(entrada, item, lista[elegido]);
  pintarBarra();
  pintarExtras(entrada);
  pintarCanciones();
  pintarCola();
  pintarBotonEditor();
  sesionDeMedios(entrada, item);
  if (escena.abierto) pintarEscenario();
  await pintarLetra(item, entrada);
  precargar(vecino(1));
}

let turnoLetra = 0;
async function pintarLetra(item, entrada) {
  const box = $("#rp-letra");
  const t = ++turnoLetra;
  box.innerHTML = `<div class="rp-vacio"><p>Cargando «${esc(entrada.titulo || "la canción")}»…</p></div>`;
  let r;
  try {
    r = await textoCancion(item.cancionId);
  } catch (e) {
    if (t === turnoLetra) box.innerHTML = `<div class="rp-vacio"><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (t !== turnoLetra) return;
  box.innerHTML = htmlCancion(r, item.desplazamiento, entrada);
  pintarTono(item);
  box.scrollTop = 0;
  moverA(document.scrollingElement, 0);
  alinear();
  prepararKaraoke(r);
  $("#rp-titulo").textContent = $("#rp-barra-titulo").textContent = r.doc.title || entrada.titulo || r.cancion.titulo || "";
}

// ============ LETRA QUE AVANZA SOLA ============
// Con los tiempos marcados en el editor (Herramientas → Marcar los tiempos) para el audio que suena, la línea que se
// canta se ilumina y queda a un tercio de la pantalla (en Reproduciendo y en el escenario). Si la persona desplaza la
// letra con el dedo, se respeta unos segundos.

const karaoke = { tiempos: null, actual: -1, manual: 0 };
const sigueLaLetra = () => guardado("mc-rp-sigue", "si") !== "no";

function prepararKaraoke(r) {
  const entrada = st.porId.get(actualId());
  const { lista, i } = elegirAudio(entrada || { audios: [] });
  const a = lista[i];
  const clave = a ? a.fileId || a.url : "";
  karaoke.tiempos = (clave && r?.doc?.sincro?.[clave]) || null;
  karaoke.actual = -2;
  pasoKaraoke();
}

function lineaCantada(t) {
  let k = -1;
  karaoke.tiempos.forEach((x, j) => { if (x != null && x <= t) k = j; });
  return k;
}

function pasoKaraoke() {
  const activo = !!karaoke.tiempos && sigueLaLetra();
  const cajas = [$("#rp-letra"), $("#rp-esc-letra")];
  if (!activo) {
    if (karaoke.actual !== -1) for (const b of cajas) {
      b.classList.remove("karaoke");
      b.querySelectorAll(".cantando").forEach((x) => x.classList.remove("cantando"));
    }
    karaoke.actual = -1;
    return;
  }
  const k = lineaCantada(motor().currentTime || 0);
  if (k === karaoke.actual) return;
  karaoke.actual = k;
  const libre = Date.now() - karaoke.manual > 4000;
  for (const box of cajas) {
    box.classList.toggle("karaoke", k >= 0);
    box.querySelectorAll(".cantando").forEach((x) => x.classList.remove("cantando"));
    const l = box.querySelectorAll(".lyric-line")[k];
    if (!l || !l.offsetHeight) continue;
    l.classList.add("cantando");
    if (!libre) continue;
    if (box.id === "rp-esc-letra") {
      if (!escena.abierto || escena.avanza) continue;
      const el = $("#rp-esc-cuerpo");
      irA(el, el.scrollTop + l.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3, true);
    } else if (st.vista === "sonando" && !escena.abierto) {
      const el = document.scrollingElement;
      irA(el, el.scrollTop + l.getBoundingClientRect().top - innerHeight / 3, true);
    }
  }
}

// ============ TONO DE LA CANCIÓN QUE SUENA ============
// Se cambia solo en este equipo (la cola, Sonando guardado y la lista propia); el cancionero del servidor no se toca.
// item.tonoBase guarda el tono con que llegó para volver con «Tono original».
const nombreTono = (idx, menor) => spell(idx, keyPrefersFlats(idx, menor), true) + (menor ? "m" : "");

function pintarTono(item) {
  const box = $("#rp-tono");
  if (!box) return;
  box.hidden = !!tv || !item || tonoSonando.actual == null;
  if (box.hidden) return;
  $("#rp-tono-nombre").textContent = nombreTono(tonoSonando.actual, tonoSonando.menor);
  const cambiado = item.tonoBase != null && (item.desplazamiento || 0) !== item.tonoBase;
  $("#rp-tono-original").hidden = $("#rp-tono-nota").hidden = !cambiado;
}

function cambiarTono(paso) {
  const item = st.cola?.items[st.indice];
  if (!item || tonoSonando.actual == null) return;
  if (item.tonoBase == null) item.tonoBase = item.desplazamiento || 0;
  aplicarTono(item, (item.desplazamiento || 0) + paso);
}

function restaurarTono() {
  const item = st.cola?.items[st.indice];
  if (item?.tonoBase != null) aplicarTono(item, item.tonoBase);
}

// De −5 a +6 semitonos: cualquier tono queda a un paso del original
const semitonos = (d) => {
  const m = mod12(Math.round(+d || 0));
  return m > 6 ? m - 12 : m;
};

function aplicarTono(item, d) {
  const c = st.cola;
  item.desplazamiento = semitonos(d);
  const l = c.listaId && st.listas.find((x) => x.id === c.listaId);
  const k = l ? l.items.findIndex((x, n) => x.cancionId === item.cancionId && (n === st.indice || x.momento === item.momento)) : -1;
  if (k >= 0) {
    l.items[k].desplazamiento = item.desplazamiento;
    guardarListas();
  }
  guardarSonando();
  repintarLetra(item);
  pintarBotonEditor();
  if (remoto?.listo) ordenTv("tono", { indice: st.indice, cancionId: item.cancionId, desplazamiento: item.desplazamiento });
}

// La letra en el nuevo tono, sin recargar el audio ni perder la línea que se estaba leyendo
async function repintarLetra(item) {
  const entrada = st.porId.get(item.cancionId) || { id: item.cancionId, titulo: "" };
  let r;
  try {
    r = await textoCancion(item.cancionId);
  } catch (_) {
    return;
  }
  if (st.cola?.items[st.indice] !== item) return;
  mantenerLugar(() => {
    $("#rp-letra").innerHTML = htmlCancion(r, item.desplazamiento, entrada);
    if (escena.abierto) {
      $("#rp-esc-letra").innerHTML = htmlCancion(r, item.desplazamiento, entrada);
      ajustarEscenario();
    }
  });
  pintarTono(item);
  alinear();
}

// La carátula va en la cabecera de la canción y junto al ▶ de la barra; si el audio trae imagen, esa
let turnoCara = 0;
// «Audio: <canal de YouTube o sitio>»: el reconocimiento a quien lo puso en internet
let fuentes = null;
const fuentesLeidas = () => (fuentes ||= leer({ accion: "fuentesAudios" }).then((r) => r.fuentes || {}).catch(() => ({})));
function pintarFuente(a) {
  const p = $("#rp-fuente");
  p.hidden = true;
  if (!a || a.fileId || !a.url) return;
  const url = a.url;
  fuentesLeidas().then((f) => {
    const actual = elegirAudio(st.porId.get(actualId()) || {});
    if (actual.lista[actual.i]?.url !== url) return;
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return; }
    const quien = f[url] ? f[url] + (esYoutube(url) ? " (YouTube)" : "") : esYoutube(url) ? "YouTube" : host;
    p.innerHTML = `Audio: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(quien)}</a>`;
    p.hidden = false;
  });
}

function pintarCaras(entrada, item, a) {
  pintarFuente(a);
  const t = ++turnoCara;
  const c = { ...entrada, titulo: entrada.titulo || "♪" };
  $("#rp-hero-cara").innerHTML = cara(c, "cara-grande", item.momento);
  $("#rp-barra-cara").innerHTML = cara(c, "chica", item.momento);
  if (!a?.fileId) return;
  caraDelAudio(urlAudio(a.fileId)).then((img) => {
    if (!img || t !== turnoCara) return;
    for (const box of [$("#rp-hero-cara"), $("#rp-barra-cara")]) {
      const span = box.querySelector(".cara");
      span?.querySelector("img")?.remove();
      span?.insertAdjacentHTML("beforeend", `<img src="${esc(img)}" alt="">`);
    }
  });
}

// ============ COLA ============
// A la derecha en pantallas anchas (se puede ocultar); en el celular sube como una hoja desde la barra

const anchoCola = matchMedia("(min-width: 1100px)");

function pintarCola() {
  const c = st.cola, box = $("#rp-cola-lista");
  $("#rp-cola-nombre").textContent = c?.nombre || "";
  if (!c) {
    box.innerHTML = "";
    return;
  }
  const cambia = sePuedeCambiar(c);
  box.innerHTML = c.items.map((it, i) => {
    const e = st.porId.get(it.cancionId) || { titulo: "Canción que ya no está en la Biblioteca" };
    const sub = it.momento || subCancion(e);
    return `<li class="${[i === st.indice ? "sonando" : "", cambia ? "con-cambiar" : ""].join(" ").trim()}"><button type="button" class="rp-cola-item" data-cola-i="${i}">
      <span class="rp-cola-num">${i + 1}</span>${cara(e, "chica", it.momento)}<span class="rp-cola-txt"><b>${esc(e.titulo)}</b><small>${esc(sub)}</small></span>
    </button>${cambia ? `<button type="button" class="rp-cola-cambiar" data-cola-cambiar="${i}" title="Cambiar por otra canción" aria-label="Cambiar «${esc(e.titulo)}» por otra">⇄</button>` : ""}</li>`;
  }).join("");
  centrarCola();
  pintarPieCola();
}

// Los audios de la Biblioteca que van a sonar (el elegido de cada canción, o el primero propio)
const urlsDeAudios = (c) => [...new Set(c.items.map((it) => {
  const { lista, i } = elegirAudio(st.porId.get(it.cancionId) || { id: it.cancionId, audios: [] });
  const a = lista[i]?.fileId ? lista[i] : lista.find((x) => x.fileId);
  return a ? urlAudio(a.fileId) : "";
}).filter(Boolean))];

let bajando = false;
function pintarPieCola() {
  const c = st.cola, pie = $("#rp-cola-pie");
  if (!c || tv) {
    pie.innerHTML = "";
    return;
  }
  const urls = urlsDeAudios(c);
  const misa = c.tipo === "misa" && !!c.misaId;
  pie.innerHTML = `<button type="button" class="rp-btn" data-pie="tarjeta" title="Una imagen con los cantos para mandar por WhatsApp o subir a las redes">Compartir tarjeta</button>`
    + (urls.length ? `<button type="button" class="rp-btn" data-pie="bajar" title="Guardar los audios en este equipo para escucharlos sin señal"${bajando ? " disabled" : ""}>Bajar audios</button>` : "")
    + (misa ? `<button type="button" class="rp-btn" data-pie="votar">${votoDe(c.misaId) ? "Cambiar mi voto" : "¿Qué canto te gustó más?"}</button>` : "")
    + `<small id="rp-cola-pie-estado"></small>`;
  if (urls.length && !bajando) audiosGuardados(urls).then((n) => {
    const e = $("#rp-cola-pie-estado");
    if (e && n && st.cola === c) e.textContent = n === urls.length ? "Los audios ya están guardados en este equipo." : `${n} de ${urls.length} audios guardados en este equipo.`;
  });
}

async function accionPieCola(e) {
  const b = e.target.closest("[data-pie]");
  const c = st.cola;
  if (!b || !c) return;
  if (b.dataset.pie === "tarjeta") return tarjetaDeCola(c);
  if (b.dataset.pie === "votar") return abrirVoto(c);
  if (b.dataset.pie === "bajar" && !bajando) {
    bajando = true;
    b.disabled = true;
    const estado = $("#rp-cola-pie-estado");
    try {
      const r = await bajarAudios(urlsDeAudios(c), (n, total) => { if (estado) estado.textContent = `Bajando audios: ${n} de ${total}…`; });
      avisar(r.fallas ? `Se guardaron ${r.hechos} audios; ${r.fallas} no se pudieron bajar.` : "Listo: los audios quedaron en este equipo para escucharlos sin señal.");
    } catch (_) {
      avisar("No se pudieron guardar los audios en este equipo.");
    } finally {
      bajando = false;
      pintarPieCola();
    }
  }
}

async function tarjetaDeCola(c) {
  const p = window.MC_PARROQUIA || {};
  const titulos = c.items.map((it) => ({ momento: it.momento || "", titulo: st.porId.get(it.cancionId)?.titulo || "" })).filter((x) => x.titulo);
  const misa = c.tipo === "misa" && c.misaId;
  const m = misa ? ((await todasLasMisas()).find((x) => x.id === c.misaId) || {}) : {};
  const fecha = m.fechaUso ? lit.fechaLarga(m.fechaUso) : "";
  const una = titulos.length === 1 ? st.porId.get(c.items[0].cancionId) : null;
  let lineas = [];
  if (una) {
    try {
      const { doc } = await textoCancion(una.id);
      lineas = String(doc.text || "").split("\n").map((l) => l.trim()).filter((l) => l && !isChordLine(l) && !/^[#>{]/.test(l)).slice(0, 8);
    } catch (_) { /* sin letra */ }
  }
  const url = misa ? `${location.origin}/${PARROQUIA_ACTUAL}/#misa=${encodeURIComponent(c.misaId)}` : location.origin + "/" + PARROQUIA_ACTUAL + "/";
  try {
    const r = await compartirTarjeta({
      titulo: una ? una.titulo : c.nombre,
      subtitulo: una ? creditsText(normalizeCredits({ letra: una.letraDe, musica: una.musicaDe })) : [fecha, nombreComunidad(c.comunidad)].filter(Boolean).join(" · "),
      items: una ? [] : titulos, lineas,
      pie: p.nombre || "Cancionero Litúrgico",
      direccion: "cancioneroliturgico.cl/" + PARROQUIA_ACTUAL,
      color: misa ? colorDeMisa(m) : acentoLiturgico,
      url
    });
    if (r === "descargada") avisar("La tarjeta quedó en tus descargas.");
  } catch (e) {
    avisar(e.message || "No se pudo armar la tarjeta.");
  }
}

// ============ AVISO DEL SÁBADO ============

async function pintarAviso() {
  const b = $("#rp-cfg-aviso"), e = $("#rp-cfg-aviso-estado");
  const estado = await estadoAviso().catch(() => "no");
  b.hidden = estado === "no" || estado === "instalar";
  b.setAttribute("aria-pressed", estado === "activo");
  b.textContent = estado === "activo" ? "Dejar de avisarme" : "Avisarme el sábado";
  e.textContent = {
    activo: "Activo en este equipo.",
    bloqueado: "Los avisos están bloqueados para este sitio: actívalos en los ajustes del navegador.",
    instalar: "En el iPhone, primero instala la app (Compartir → «Agregar a pantalla de inicio») y actívalo desde ahí.",
    no: esIphone() ? "En el iPhone se necesita iOS 16.4 o más nuevo y la app instalada." : "Este navegador no recibe avisos.",
    inactivo: ""
  }[estado];
}

// ============ ¿QUÉ CANTO TE GUSTÓ MÁS? ============

const equipoId = () => {
  let id = guardado("mc-equipo-id", "");
  if (!/^[a-z0-9-]{8,60}$/i.test(id)) {
    id = crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    guardar("mc-equipo-id", id);
  }
  return id;
};
const votoDe = (misaId) => guardado("mc-voto:" + misaId, "");

function abrirVoto(c) {
  const ya = votoDe(c.misaId);
  const vistos = new Set();
  const items = c.items.filter((it) => !vistos.has(it.cancionId) && vistos.add(it.cancionId) && st.porId.has(it.cancionId));
  if (!items.length) return;
  $("#rp-votar-que").textContent = ya ? "Ya votaste en este cancionero; puedes cambiar tu voto." : "Tu voto ayuda al coro a elegir los cantos de las próximas misas.";
  $("#rp-votar-lista").innerHTML = items.map((it) => {
    const e = st.porId.get(it.cancionId);
    return `<li><button type="button" data-votar="${esc(it.cancionId)}" class="${it.cancionId === ya ? "elegida" : ""}">${cara(e, "chica", it.momento)}
      <span><b>${esc(e.titulo)}</b><small>${esc(it.momento || "")}</small></span></button></li>`;
  }).join("");
  $("#rp-dlg-votar").dataset.misa = c.misaId;
  $("#rp-dlg-votar").showModal();
}

async function votar(cancion) {
  const d = $("#rp-dlg-votar"), misa = d.dataset.misa;
  try {
    await llamarApi("reaccionar", { misa, cancion, equipo: equipoId() });
    guardar("mc-voto:" + misa, cancion);
    d.close();
    avisar("¡Gracias! Tu voto quedó para el coro.");
    pintarPieCola();
  } catch (e) {
    avisar(e.message);
  }
}

// ⇄ en los cancioneros de misa y en las listas (emergencias: cambiar una canción por otra)
const sePuedeCambiar = (c) => !tv && !!c && (c.tipo === "misa" || c.tipo === "lista");

async function misaDeServidor(id) {
  const m = ((await leer({ accion: "misas" })).misas || []).find((x) => x.id === id);
  if (!m) throw new Error("ese cancionero ya no está en el servidor");
  return m;
}

// Reemplaza la canción en el cancionero guardado (vuelve a leerlo para no pisar otros cambios)
async function cambiarEnMisa(c, it, id) {
  const m = await misaDeServidor(c.misaId);
  let mi = it.mi, ci = it.ci;
  if (m.momentos[mi]?.canciones[ci]?.cancionId !== it.cancionId) {
    mi = m.momentos.findIndex((x) => x.momento === it.momento && x.canciones.some((y) => y.cancionId === it.cancionId));
    if (mi < 0) mi = m.momentos.findIndex((x) => x.canciones.some((y) => y.cancionId === it.cancionId));
    if (mi < 0) throw new Error("esa canción ya no está en el cancionero");
    ci = m.momentos[mi].canciones.findIndex((y) => y.cancionId === it.cancionId);
  }
  m.momentos[mi].canciones[ci] = { cancionId: id, desplazamiento: 0 };
  const { drive, lecturas, ...misa } = m;
  const r = await llamarApi("guardarMisa", { token: sesionActual()?.token || "", misa });
  misasPublicas = null;
  st.misas = null;
  inicioViejo = true;
  guardar("mc-reproducir", JSON.stringify({ ...r.misa, t: Date.now() }));
  Object.assign(it, { mi, ci });
}

async function cambiarEnCola(i) {
  const c = st.cola, it = c?.items[i];
  if (!it || !sePuedeCambiar(c)) return;
  if (!st.biblioteca.length) return avisar("La Biblioteca todavía no está cargada.");
  const esMisa = c.tipo === "misa" && !!c.misaId;
  const misa = esMisa ? await misaDeServidor(c.misaId).catch(() => null) : null;
  const id = await elegirReemplazo({
    biblioteca: st.biblioteca, momento: it.momento || "", actual: it.cancionId,
    fechaUso: misa?.fechaUso || lit.hoyIso(), tiempoLiturgico: misa?.tiempoLiturgico || "", celebracion: misa?.celebracion || ""
  });
  if (!id || id === it.cancionId || st.cola !== c || c.items[i] !== it) return;
  const vieja = st.porId.get(it.cancionId)?.titulo || "la canción";
  let aviso;
  if (esMisa && puedeEditar(c.comunidad)) {
    try {
      avisar("Guardando el cambio en el cancionero…");
      await cambiarEnMisa(c, it, id);
      aviso = `Cambiada en «${c.nombre}» para todos.`;
    } catch (e) {
      if (!confirm(`No se pudo guardar en el cancionero (${e.message}).\n\n¿Cambiar «${vieja}» solo en este equipo?`)) return;
      aviso = "Cambiada solo en este equipo.";
    }
  } else if (esMisa) {
    if (!confirm(`Tu cuenta no puede modificar «${c.nombre}».\n\n¿Cambiar «${vieja}» solo en este equipo?`)) return;
    aviso = "Cambiada solo en este equipo: el cancionero sigue igual para los demás.";
  } else {
    const l = c.listaId && st.listas.find((x) => x.id === c.listaId);
    const k = l ? l.items.findIndex((x, n) => x.cancionId === it.cancionId && (n === i || x.momento === it.momento)) : -1;
    if (k >= 0) {
      l.items[k] = { cancionId: id, desplazamiento: 0, ...(it.momento ? { momento: it.momento } : {}) };
      guardarListas();
      pintarListas();
    }
    aviso = k >= 0 ? `Cambiada en «${l.nombre}».` : "Cambiada en esta cola.";
  }
  Object.assign(it, { cancionId: id, desplazamiento: 0, capo: 0, velocidad: 1 });
  delete it.scroll;
  if (i === st.indice) reproducir(i, !motor().paused);
  else {
    pintarCola();
    guardarSonando();
  }
  avisar(aviso);
}

function centrarCola() {
  const box = $("#rp-cola-lista"), li = box.querySelector(".sonando");
  if (li && box.clientHeight) box.scrollTop = li.offsetTop - box.clientHeight / 3;
}

function alternarCola(abrir) {
  if (anchoCola.matches) {
    const oculta = abrir === undefined ? !document.body.classList.contains("cola-oculta") : !abrir;
    document.body.classList.toggle("cola-oculta", oculta);
    guardar("mc-rp-cola-oculta", oculta ? "si" : "no");
  } else {
    document.body.classList.toggle("cola-abierta", abrir);
  }
  $("#rp-cola-btn").setAttribute("aria-pressed", anchoCola.matches ? !document.body.classList.contains("cola-oculta") : document.body.classList.contains("cola-abierta"));
  centrarCola();
}

function htmlCancion({ doc, cancion }, desplazamiento, entrada = {}) {
  const titulo = doc.title || entrada.titulo || cancion.titulo || "Canción";
  const orig = detectKey(doc.text);
  const d = desplazamiento || 0;
  const tono = orig ? { idx: mod12(orig.idx + d), minor: orig.minor } : null;
  const texto = orig && d ? transposeText(doc.text, d, keyPrefersFlats(tono.idx, tono.minor)) : doc.text;
  tonoSonando = { original: orig ? orig.idx : null, actual: tono ? tono.idx : null, menor: !!orig?.minor };
  mcCancionActual = {
    tags: [],
    credits: normalizeCredits({ letra: doc.credits?.letra || entrada.letraDe || cancion.letraDe, musica: doc.credits?.musica || entrada.musicaDe || cancion.musicaDe })
  };
  return doc.text.trim() ? renderSong(titulo, texto, tono)
    : `<div class="rp-vacio"><p><b>${esc(titulo)}</b></p><p>Esta canción todavía no tiene la letra cargada.</p></div>`;
}

// Tono de la letra en la Biblioteca y el que suena: para trasponer las tablaturas y partituras MusicXML/Guitar Pro
let tonoSonando = { original: null, actual: null, menor: false };

function pintarExtras(entrada) {
  const box = $("#rp-extras");
  box.replaceChildren();
  const pistas = pistasDeVoces(entrada.audios);
  if (pistas.length >= 2) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rp-btn btn-voces";
    b.textContent = "🎚 Aprender las voces";
    b.addEventListener("click", () => {
      motor().pause();
      b.hidden = true;
      const m = crearMezclador({ contenedor: box, pistas, leerAudio: bytesDeAudio,
        alCerrar: () => { b.hidden = false; if (st.mezclador === m) st.mezclador = null; } });
      st.mezclador = m;
    });
    box.append(b);
  }
  const p = botonesPartituras(entrada, { tono: () => tonoSonando });
  if (p) {
    p.querySelectorAll("button").forEach((x) => x.classList.add("rp-btn"));
    box.prepend(p);
  }
  if (sePuedeCambiar(st.cola) && st.indice >= 0) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rp-btn rp-cambiar-sonando";
    b.textContent = "⇄ Cambiar esta canción";
    b.title = "Reemplazarla por otra en " + (st.cola.tipo === "misa" ? "el cancionero" : "la lista");
    b.addEventListener("click", () => cambiarEnCola(st.indice));
    box.append(b);
  }
}

function precargar(i) {
  const it = st.cola?.items[i];
  if (!it) return;
  textoCancion(it.cancionId).catch(() => {});
}

// ============ ALEATORIO Y REPETIR ============

const modos = { aleatorio: guardado("mc-rp-aleatorio", "no") === "si", repetir: guardado("mc-rp-repetir", "no") };
let orden = null, ordenDe = null;

function mezclar(n, primero) {
  const a = [...Array(n).keys()].filter((k) => k !== primero);
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return primero >= 0 ? [primero, ...a] : a;
}

// En aleatorio, la cola se recorre en un orden mezclado que empieza por la canción que suena
function ordenActual() {
  if (!modos.aleatorio || !st.cola) return null;
  if (ordenDe !== st.cola || orden.length !== st.cola.items.length) {
    orden = mezclar(st.cola.items.length, st.indice);
    ordenDe = st.cola;
  }
  return orden;
}

// Posición vecina en la cola, o -1 si no hay; con «mover», al dar la vuelta en aleatorio se vuelve a mezclar
function vecino(paso, mover = false, desde = st.indice) {
  const c = st.cola;
  if (!c) return -1;
  const n = c.items.length, o = ordenActual();
  const p = (o ? o.indexOf(desde) : desde) + paso;
  if (p >= 0 && p < n) return o ? o[p] : p;
  if (modos.repetir !== "lista") return -1;
  if (o && p >= n) {
    if (!mover) return o[0];
    orden = mezclar(n, -1);
    if (n > 1 && orden[0] === desde) [orden[0], orden[1]] = [orden[1], orden[0]];
    return orden[0];
  }
  const q = (p + n) % n;
  return o ? o[q] : q;
}

// Al reproducir de corrido se saltan las canciones que no tienen audio ni video (como el salmo de una
// misa sin grabación); tocarlas a propósito en la lista igual las abre, para cantarlas con la letra
const conAudio = (i) => audiosReproducibles(st.porId.get(st.cola?.items[i]?.cancionId)).length > 0;
function vecinoConAudio(paso, mover = false) {
  const n = st.cola?.items.length || 0;
  let k = st.indice;
  for (let vuelta = 0; vuelta < n; vuelta++) {
    k = vecino(paso, mover, k);
    if (k < 0 || k === st.indice) return -1;
    if (conAudio(k)) return k;
  }
  return -1;
}

const siguiente = () => {
  const i = vecinoConAudio(1, true);
  return i >= 0 && (reproducir(i), true);
};
const anterior = () => {
  const m = motor();
  if (m.currentTime > 4) m.currentTime = 0;
  else {
    const i = vecinoConAudio(-1, true);
    if (i >= 0) reproducir(i);
  }
};

// En el TV manda siempre el teléfono: al terminar, la letra queda en pantalla hasta que el teléfono elija otra
const tituloActual = () => st.porId.get(actualId())?.titulo || "la canción";

function alTerminarPista() {
  if (modos.repetir === "una") {
    const m = motor();
    m.currentTime = 0;
    tocarMotor();
    return;
  }
  if (tv) {
    tv.queriaSonar = false;
    enviarEstadoTv(true);
    tv.sala?.enviar({ tipo: "aviso", texto: `Terminó «${tituloActual()}» en el TV: elegí la siguiente cuando quieras.` });
    return;
  }
  if (siguiente()) return;
  avisar(vecino(1) >= 0 ? "No quedan más canciones con audio en la lista." : "Terminó la lista.");
  // Al terminar el cancionero de una misa, una sola vez por misa en este equipo
  const c = st.cola;
  if (vecino(1) < 0 && c?.tipo === "misa" && c.misaId && !votoDe(c.misaId) && !guardado("mc-voto-preguntado:" + c.misaId, "")) {
    guardar("mc-voto-preguntado:" + c.misaId, "1");
    abrirVoto(c);
  }
}

function pintarModos() {
  const a = $("#rp-aleatorio"), r = $("#rp-repetir");
  a.setAttribute("aria-pressed", modos.aleatorio);
  a.title = modos.aleatorio ? "Aleatorio: sí" : "Aleatorio: no";
  const texto = { no: "Repetir: no", lista: "Repetir toda la lista", una: "Repetir esta canción" }[modos.repetir];
  r.setAttribute("aria-pressed", modos.repetir !== "no");
  r.setAttribute("aria-label", texto);
  r.title = texto;
  r.innerHTML = icono(modos.repetir === "una" ? "repetirUna" : "repetir");
}

// Si un video o un audio no se puede reproducir, pasa a la siguiente; se detiene si ya probó toda la cola
let saltos = 0;
function noDisponible(t, motivo) {
  if (t !== turno) return;
  if (tv) {
    enviarEstadoTv(true);
    tv.sala?.enviar({ tipo: "aviso", texto: `El TV no pudo reproducir el audio de «${tituloActual()}»; la letra sigue en pantalla.` });
    return;
  }
  const n = st.cola?.items.length || 0;
  if (++saltos >= n || vecinoConAudio(1) < 0) {
    saltos = 0;
    avisar(motivo);
    return;
  }
  avisar("No disponible: pasando a la siguiente.");
  siguiente();
}

// La barra se repinta varias veces por segundo: los vecinos se recalculan solo si cambió algo
let vecinosCache = { clave: [] };
function vecinosDeBarra() {
  const clave = [st.cola, st.indice, modos.aleatorio, modos.repetir, orden, st.porId];
  if (clave.some((x, k) => x !== vecinosCache.clave[k])) {
    vecinosCache = { clave, anterior: vecinoConAudio(-1), siguiente: vecinoConAudio(1) };
  }
  return vecinosCache;
}

function pintarBarra() {
  const m = motor();
  const tiene = m === motorRemoto ? !!remoto.estado?.tiene : m !== audio || !!audio.getAttribute("src");
  const play = $("#rp-play"), ico = m.paused ? "play" : "pausa";
  play.disabled = !tiene;
  if (play.dataset.icono !== ico) {
    play.innerHTML = icono(ico);
    play.dataset.icono = ico;
  }
  play.setAttribute("aria-label", m.paused ? "Reproducir" : "Pausa");
  document.body.classList.toggle("sonando", !m.paused);
  const v = vecinosDeBarra();
  $("#rp-anterior").disabled = !st.cola || (v.anterior < 0 && !tiene);
  $("#rp-siguiente").disabled = v.siguiente < 0;
  const dur = isFinite(m.duration) ? m.duration : 0;
  $("#rp-progreso").max = dur || 1;
  $("#rp-progreso").value = m.currentTime || 0;
  $("#rp-progreso").disabled = !dur;
  $("#rp-progreso").style.setProperty("--pos", (dur ? Math.min(100, (m.currentTime || 0) / dur * 100) : 0) + "%");
  $("#rp-actual").textContent = reloj(m.currentTime);
  $("#rp-total").textContent = reloj(dur);
  if (!m.paused && Date.now() - ultimoGuardado > 5000) guardarSonando();
  sincronizarEscena();
  if (tv) enviarEstadoTv();
}

function sesionDeMedios(entrada, item) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: entrada.titulo || "Canción",
    artist: item.momento || creditsText(normalizeCredits({ letra: entrada.letraDe, musica: entrada.musicaDe })) || "Cancionero Litúrgico",
    album: st.cola?.nombre || ""
  });
}

function estadoDeMedios(pausado) {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = pausado ? "paused" : "playing";
}

function conectarMedios() {
  if (!("mediaSession" in navigator)) return;
  const h = {
    play: tocarMotor, pause: () => motor().pause(), previoustrack: anterior, nexttrack: siguiente,
    seekto: (d) => { motor().currentTime = d.seekTime; }
  };
  for (const [k, fn] of Object.entries(h)) {
    try { navigator.mediaSession.setActionHandler(k, fn); } catch (_) { /* acción no soportada */ }
  }
}

// La pantalla no se apaga mientras se lee la letra o se sigue en vivo
let bloqueo = null;
async function pedirPantalla() {
  const quiere = !!tv || escena.abierto || (st.vista === "sonando" && !!st.cola) || (st.vista === "vivo" && !!st.vivo);
  if (!quiere || document.hidden) {
    bloqueo?.release().catch(() => {});
    bloqueo = null;
    return;
  }
  if (bloqueo || !("wakeLock" in navigator)) return;
  try {
    bloqueo = await navigator.wakeLock.request("screen");
    bloqueo.addEventListener("release", () => { bloqueo = null; });
  } catch (_) { /* sin permiso o sin batería */ }
}

// ============ MODO ESCENARIO ============
// Solo la letra y los acordes a pantalla completa, con un reproductor mínimo. La letra se desplaza sola a la
// velocidad que dejaron en el cancionero o en la canción (mientras suena el audio); si no hay, la decide quien canta.

const SCROLL_SPEEDS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 19, 22, 26, 31, 38, 48, 60]; // px/s, los del editor
const escena = { abierto: false, avanza: false, porAudio: false, detenido: false, listo: false, preset: 0, nivel: 5, acc: 0, antes: 0, raf: 0, turno: 0, primera: false };
const nivelGuardado = () => Math.max(1, Math.min(20, +guardado("mc-rp-escenario-scroll", "5") || 5));

function abrirEscenario() {
  if (!st.cola || st.indice < 0) return avisar("Elegí primero un cancionero o una canción.");
  if (escena.abierto) return;
  escena.abierto = escena.primera = true;
  $("#rp-escenario").hidden = false;
  document.body.classList.add("en-escenario");
  document.body.classList.remove("cola-abierta");
  history.pushState({ rpEscenario: true }, "");
  document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  pedirPantalla();
  pintarEscenario();
}

function cerrarEscenario(desdeHistorial = false) {
  if (!escena.abierto || tv) return;
  escena.abierto = false;
  escena.turno++;
  avanzar(false);
  $("#rp-escenario").hidden = true;
  document.body.classList.remove("en-escenario");
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (!desdeHistorial && history.state?.rpEscenario) history.back();
  pedirPantalla();
  alinear();
}

async function pintarEscenario() {
  const c = st.cola, item = c?.items[st.indice];
  if (!item) return;
  const t = ++escena.turno;
  const entrada = st.porId.get(item.cancionId) || { id: item.cancionId, titulo: "" };
  avanzar(false);
  escena.listo = escena.detenido = false;
  escena.preset = 0;
  $("#rp-esc-pos").textContent = `${st.indice + 1}/${c.items.length}`;
  $("#rp-esc-momento").textContent = [item.momento, item.capo ? "Capo " + item.capo : ""].filter(Boolean).join(" · ");
  $("#rp-esc-titulo").textContent = entrada.titulo || "";
  const box = $("#rp-esc-letra"), cuerpo = $("#rp-esc-cuerpo");
  box.innerHTML = `<div class="rp-vacio"><p>Cargando «${esc(entrada.titulo || "la canción")}»…</p></div>`;
  moverA(cuerpo, 0);
  sincronizarEscena();
  let r;
  try {
    r = await textoCancion(item.cancionId);
  } catch (e) {
    if (t === escena.turno) box.innerHTML = `<div class="rp-vacio"><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (t !== escena.turno) return;
  box.innerHTML = htmlCancion(r, item.desplazamiento, entrada);
  karaoke.actual = -2;
  $("#rp-esc-titulo").textContent = r.doc.title || entrada.titulo || r.cancion.titulo || "";
  ajustarEscenario();
  moverA(cuerpo, 0);
  alinear();
  const preset = Math.round(+item.scroll || +r.doc.scrollSpeed || 0);
  escena.preset = preset >= 1 && preset <= 20 ? preset : 0;
  escena.nivel = escena.preset || nivelGuardado();
  pintarNivel();
  escena.listo = true;
  if (escena.primera) {
    escena.primera = false;
    avisar(escena.preset ? `La letra se desplaza sola mientras suena (velocidad ${escena.preset}). Tocala para detenerla.`
      : "Tocá la letra o ▼ para que se desplace; deslizá a los lados para cambiar de canción.");
  }
  sincronizarEscena();
}

// La línea más larga ocupa todo el ancho, sin pasar del tamaño elegido con A+ más un poco
let proporcionLetra = 0;
function ajustarEscenario() {
  const box = $("#rp-esc-letra");
  if (!escena.abierto || !box.clientWidth) return;
  if (!proporcionLetra) {
    const s = document.createElement("span");
    s.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-weight:bold";
    s.style.fontFamily = getComputedStyle(box).fontFamily;
    s.textContent = "M".repeat(50);
    document.body.append(s);
    proporcionLetra = s.getBoundingClientRect().width / 5000 || 0.6;
    s.remove();
  }
  let largo = 0;
  for (const l of box.querySelectorAll(".line:not(.blank)")) {
    if (l.offsetParent) largo = Math.max(largo, l.textContent.replace(/\s+$/, "").length);
  }
  const base = +guardado("mc-rp-letra", "18") || 18;
  // En el TV se lee desde lejos: la letra puede crecer mucho más
  const max = tv ? base * 3 : Math.max(base + 6, Math.round(base * 1.6));
  const px = largo ? Math.min(max, Math.floor((box.clientWidth - 8) / (largo * proporcionLetra) * 10) / 10) : max;
  box.style.setProperty("--song-font", Math.max(11, px) + "px");
}

function avanzar(si, porAudio = false) {
  cancelAnimationFrame(escena.raf);
  escena.avanza = si;
  escena.porAudio = si && porAudio;
  escena.acc = escena.antes = 0;
  if (si) escena.raf = requestAnimationFrame(pasoEscena);
  pintarAvance();
  if (tv) enviarEstadoTv();
}

// Con el teléfono conectado a un TV, el ▼ y la velocidad del escenario son los del TV
function pintarAvance() {
  const si = remoto?.listo ? !!remoto.estado?.avanza : escena.avanza, b = $("#rp-esc-avanza");
  b.setAttribute("aria-pressed", si);
  b.textContent = si ? "⏸" : "▼";
  b.setAttribute("aria-label", si ? "Detener el desplazamiento" : "Desplazar la letra");
}

function paginaEscena(d) {
  if (remoto?.listo) return ordenTv("pagina", { d });
  const c = $("#rp-esc-cuerpo");
  c.scrollBy({ top: d * c.clientHeight * 0.8, behavior: "smooth" });
}

function pasoEscena(ahora) {
  if (!escena.avanza) return;
  const c = $("#rp-esc-cuerpo");
  if (escena.antes) {
    escena.acc += Math.min(0.1, (ahora - escena.antes) / 1000) * SCROLL_SPEEDS[escena.nivel - 1];
    const px = Math.floor(escena.acc);
    if (px) {
      // Mientras el TV va hacia donde lo llevó el teléfono, el avance corre esa meta
      if (sigue.el === c) sigue.meta += px;
      else c.scrollTop += px;
      escena.acc -= px;
    }
  }
  escena.antes = ahora;
  if (c.scrollTop + c.clientHeight >= c.scrollHeight - 2) {
    escena.detenido = true;
    return avanzar(false);
  }
  escena.raf = requestAnimationFrame(pasoEscena);
}

function alternarAvance() {
  if (remoto?.listo) return ordenTv("avance");
  if (escena.avanza) {
    escena.detenido = true;
    return avanzar(false);
  }
  const c = $("#rp-esc-cuerpo");
  if (c.scrollTop + c.clientHeight >= c.scrollHeight - 2) c.scrollTop = 0;
  escena.detenido = false;
  avanzar(true);
}

function cambiarNivel(d) {
  if (remoto?.listo) return ordenTv("nivel", { d });
  escena.nivel = Math.max(1, Math.min(20, escena.nivel + d));
  if (!escena.preset) guardar("mc-rp-escenario-scroll", String(escena.nivel));
  pintarNivel();
}

function pintarNivel() {
  const n = (remoto?.listo && remoto.estado?.nivel) || escena.nivel;
  $("#rp-esc-nivel").textContent = n;
  $("#rp-esc-lento").disabled = n <= 1;
  $("#rp-esc-rapido").disabled = n >= 20;
  if (tv) enviarEstadoTv();
}

// ⏮ ⏭ recorren todas las canciones, también las que no tienen audio: en la misa se cantan igual
function cambiarEnEscena(paso) {
  const i = vecino(paso, true);
  if (i < 0) return avisar(paso > 0 ? "Es la última canción de la lista." : "Es la primera canción de la lista.");
  reproducir(i, !motor().paused);
}

// Se llama con cada cambio del audio (desde pintarBarra): el ▶ mínimo y el desplazamiento preprogramado lo siguen
function sincronizarEscena() {
  if (!escena.abierto) return;
  const m = motor(), tiene = m !== audio || !!audio.getAttribute("src");
  const play = $("#rp-esc-play"), ico = m.paused ? "play" : "pausa";
  if (play.dataset.icono !== ico) {
    play.innerHTML = icono(ico);
    play.dataset.icono = ico;
  }
  play.disabled = !tiene;
  play.setAttribute("aria-label", m.paused ? "Reproducir" : "Pausa");
  $("#rp-esc-anterior").disabled = vecino(-1) < 0;
  $("#rp-esc-siguiente").disabled = vecino(1) < 0;
  if (!escena.listo || !escena.preset || remoto?.listo) return;
  if (!m.paused && !escena.avanza && !escena.detenido) avanzar(true, true);
  else if (m.paused && escena.avanza && escena.porAudio) avanzar(false);
}

function conectarEscenario() {
  $("#rp-esc-abrir").addEventListener("click", abrirEscenario);
  $("#rp-esc-barra").addEventListener("click", abrirEscenario);
  $("#rp-esc-menu").addEventListener("click", abrirEscenario);
  $("#rp-esc-cerrar").addEventListener("click", () => cerrarEscenario());
  $("#rp-esc-anterior").addEventListener("click", () => cambiarEnEscena(-1));
  $("#rp-esc-siguiente").addEventListener("click", () => cambiarEnEscena(1));
  $("#rp-esc-play").addEventListener("click", () => $("#rp-play").click());
  $("#rp-esc-lento").addEventListener("click", () => cambiarNivel(-1));
  $("#rp-esc-rapido").addEventListener("click", () => cambiarNivel(1));
  $("#rp-esc-avanza").addEventListener("click", alternarAvance);
  window.addEventListener("popstate", () => cerrarEscenario(true));
  window.addEventListener("resize", ajustarEscenario);

  // Tocar la letra la desplaza o la detiene; deslizar a los lados cambia de canción
  const cuerpo = $("#rp-esc-cuerpo");
  let toque = null;
  cuerpo.addEventListener("touchstart", (e) => {
    const p = e.touches[0];
    toque = e.touches.length === 1 ? { x: p.clientX, y: p.clientY } : null;
  }, { passive: true });
  cuerpo.addEventListener("touchend", (e) => {
    if (!toque) return;
    const p = e.changedTouches[0], dx = p.clientX - toque.x, dy = p.clientY - toque.y;
    toque = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) cambiarEnEscena(dx < 0 ? 1 : -1);
  }, { passive: true });
  cuerpo.addEventListener("click", (e) => {
    if (e.target.closest("a, button") || String(getSelection())) return;
    alternarAvance();
  });

  // Teclado y pedales (los pedales Bluetooth mandan flechas o Avance/Retroceso de página)
  window.addEventListener("keydown", (e) => {
    if (!escena.abierto || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    const pagina = paginaEscena;
    const acciones = {
      Escape: () => cerrarEscenario(),
      " ": alternarAvance,
      ArrowRight: () => cambiarEnEscena(1),
      ArrowLeft: () => cambiarEnEscena(-1),
      ArrowDown: () => pagina(1),
      PageDown: () => pagina(1),
      ArrowUp: () => pagina(-1),
      PageUp: () => pagina(-1),
      "+": () => cambiarNivel(1),
      "=": () => cambiarNivel(1),
      "-": () => cambiarNivel(-1),
      k: () => $("#rp-play").click(),
      K: () => $("#rp-play").click()
    };
    const f = acciones[e.key];
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    f();
  }, true);
}

// ============ PANTALLA GRANDE (TV O PROYECTOR) ============
// El TV abre reproductor#pantalla: muestra un código y, cuando un teléfono se conecta, solo la letra y los acordes,
// y hace sonar el audio. El teléfono que escanea o escribe el código queda como control remoto: lo que se elige en él
// pasa en el TV, y el teléfono muestra lo que pasa en el TV (js/sala.js, trabajadores/sala).

let tv = null; // en el TV: { codigo, llave, sala, conectado, colaRev, ultimo, ultimoClave, sonido, ver }
let remoto = null; // en el teléfono: { codigo, sala, listo, estado, colaTv, controles, sinTv, reloj, ver }

const conEspacio = (c) => String(c).slice(0, 3) + " " + String(c).slice(3);
const codigoDeQr = (texto) => (String(texto).match(/#control=(\d{6})\b/) || String(texto).match(/^\s*(\d{3})\s?(\d{3})\s*$/))?.slice(1).join("") || "";
const sitioPublico = () => (window.MONTECARMELO_CONFIG || {}).sitio || location.origin + "/";
const baseParroquia = () => (window.MONTECARMELO_CONFIG || {}).base || sitioPublico();

// ---- La letra en el mismo lugar en el teléfono y en el TV ----
// Lo que se recorre a mano en el teléfono (en Reproduciendo o en el escenario) se ve igual en el TV, y lo que el TV
// avanza solo o por página lo sigue el teléfono. Como cada pantalla tiene su tamaño de letra, el lugar es la línea
// que queda arriba de lo visible: { indice de la canción, i: la línea, f: cuánto de ella ya pasó }.

const sigue = { el: null, meta: 0, raf: 0 };
const movidoAqui = new WeakMap(); // lo que se desplaza → hasta dónde lo movió el programa
let tocando = false, tocado = 0; // el dedo en el teléfono, y cuándo movió la letra por última vez
let verT = 0, verUltimo = 0;

// Dónde se lee la letra: { el: lo que se desplaza, letra, tope: la altura de la pantalla donde empieza lo visible }
function desplazador() {
  if (!tv && !remoto?.listo) return null;
  if (escena.abierto) {
    const el = $("#rp-esc-cuerpo");
    return { el, letra: $("#rp-esc-letra"), tope: el.getBoundingClientRect().top + (parseFloat(getComputedStyle(el).paddingTop) || 0) };
  }
  if (tv || st.vista !== "sonando") return null;
  // El panel del TV queda pegado debajo de la barra del sitio (css): la letra visible empieza bajo él
  const panel = $("#rp-control-tv");
  return { el: document.scrollingElement, letra: $("#rp-letra"), tope: $(".nav-sitio").getBoundingClientRect().bottom + (panel.hidden ? 0 : panel.offsetHeight) };
}

function anclaDe(d) {
  const lineas = d.letra.querySelectorAll(".line");
  if (!lineas.length) return null;
  if (d.el.scrollTop < 1) return { i: 0, f: 0 };
  for (let i = 0; i < lineas.length; i++) {
    const r = lineas[i].getBoundingClientRect();
    if (r.height && r.bottom > d.tope) return { i, f: Math.round(Math.max(0, Math.min(1, (d.tope - r.top) / r.height)) * 1000) / 1000 };
  }
  return { i: lineas.length - 1, f: 1 };
}

// Una línea oculta de este lado (los acordes con «Solo letra») pasa a la siguiente que se ve
function metaDeAncla(d, a) {
  const lineas = d.letra.querySelectorAll(".line");
  if (!lineas.length) return null;
  let k = entero(a.i, 0, lineas.length - 1), f = Math.max(0, Math.min(1, +a.f || 0));
  if (!k && !f) return 0;
  while (k < lineas.length - 1 && !lineas[k].offsetHeight) {
    k++;
    f = 0;
  }
  const r = lineas[k].getBoundingClientRect();
  return d.el.scrollTop + r.top - d.tope + f * r.height;
}

// Sin animar (el sitio desplaza suave, css/site.css), y anotado para no tomarlo por un movimiento del usuario
function moverA(el, top) {
  const html = document.documentElement, antes = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  el.scrollTop = top;
  html.style.scrollBehavior = antes;
  movidoAqui.set(el, el.scrollTop);
}

function irA(el, meta, suave) {
  if (!suave || Math.abs(meta - el.scrollTop) > 2 * el.clientHeight) {
    sigue.el = null;
    return moverA(el, meta);
  }
  Object.assign(sigue, { el, meta });
  if (!sigue.raf) sigue.raf = requestAnimationFrame(pasoSeguir);
}

function pasoSeguir() {
  sigue.raf = 0;
  const el = sigue.el;
  if (!el) return;
  const antes = el.scrollTop, d = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, sigue.meta)) - antes;
  if (Math.abs(d) >= 1) moverA(el, antes + (Math.abs(d) < 5 ? d : d * 0.2));
  if (el.scrollTop === antes) sigue.el = null;
  else sigue.raf = requestAnimationFrame(pasoSeguir);
}

// La letra visible va donde está la del otro lado, si es la misma canción
function alinear(suave = false) {
  const v = tv ? tv.ver : remoto?.listo ? remoto.ver : null;
  const d = v && v.indice === st.indice ? desplazador() : null;
  const meta = d ? metaDeAncla(d, v) : null;
  if (meta != null) irA(d.el, meta, suave);
}

// Al cambiar el tamaño de la letra o los acordes, la misma línea sigue arriba
function mantenerLugar(cambiar) {
  const d = desplazador(), a = d && anclaDe(d);
  cambiar();
  const meta = a ? metaDeAncla(d, a) : null;
  if (meta != null) moverA(d.el, meta);
}

function alDesplazar(e) {
  const d = desplazador();
  if (!d || (e.target === document ? document.scrollingElement : e.target) !== d.el) return;
  if (Math.abs(d.el.scrollTop - (movidoAqui.get(d.el) ?? -9)) < 1) return;
  movidoAqui.delete(d.el);
  sigue.el = null;
  if (remoto) tocado = Date.now();
  mandarVer();
}

// Como mucho cada 150 ms, y siempre la última posición
function mandarVer() {
  clearTimeout(verT);
  const falta = 150 - (Date.now() - verUltimo);
  if (falta > 0) {
    verT = setTimeout(mandarVer, falta);
    return;
  }
  verUltimo = Date.now();
  const d = desplazador(), a = d && anclaDe(d);
  if (!a) return;
  const v = { indice: st.indice, ...a };
  if (tv) tv.sala?.enviar({ tipo: "ver", ...v });
  else if (remoto?.listo) {
    remoto.ver = v;
    remoto.sala.enviar({ tipo: "orden", accion: "ver", ...v });
  }
}

// ---- En el TV ----

function iniciarPantalla() {
  tv = { codigo: "", llave: crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now(), sala: null, conectado: false, colaRev: 0, ultimo: 0, ultimoClave: "", sonido: false, ver: null };
  document.body.classList.add("rp-tv");
  document.body.append($("#rp-video"));
  $("#rp-tv").hidden = false;
  $("#rp-tv-direccion").textContent = sitioPublico().replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Los navegadores no dejan sonar nada hasta que alguien toca la pantalla (o el OK del control remoto del TV)
  const activar = () => {
    tv.sonido = true;
    $("#rp-tv-activar").textContent = "Sonido activado ✓";
    $("#rp-tv-sonido").hidden = true;
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    if (tv.queriaSonar && st.cola) tocarMotor();
    document.removeEventListener("pointerdown", activar, true);
    document.removeEventListener("keydown", activar, true);
  };
  document.addEventListener("pointerdown", activar, true);
  document.addEventListener("keydown", activar, true);
  // Queda recordado: al volver a abrir el sitio en este equipo aparece directo el QR (js/config.js)
  guardar("mc-equipo", "tv");
  $("#rp-tv-salir").addEventListener("click", () => {
    guardar("mc-equipo", "normal");
    location.replace(location.pathname + location.search);
  });
  $("#rp-tv-activar").focus();
  pedirPantalla();
  conectarComoPantalla();
}

function conectarComoPantalla() {
  tv.sala?.cerrar();
  tv.codigo = String(100000 + Math.floor(Math.random() * 900000));
  tv.conectado = false;
  document.body.classList.remove("rp-tv-conectada");
  motor().pause();
  escena.abierto = false;
  avanzar(false);
  $("#rp-escenario").hidden = true;
  $("#rp-tv-emparejar").hidden = false;
  $("#rp-tv-sonido").hidden = true;
  $("#rp-tv-codigo").textContent = conEspacio(tv.codigo);
  $("#rp-tv-estado").textContent = "Conectando…";
  pintarQrTv(baseParroquia() + "reproductor#control=" + tv.codigo);
  const sala = tv.sala = conectarSala(tv.codigo, "tv", {
    llave: tv.llave,
    alMensaje: ordenEnTv,
    alEstado: (e) => {
      if (tv.sala !== sala) return;
      if (e === "conectada") {
        $("#rp-tv-estado").textContent = "Lista: esperando un teléfono";
        enviarColaTv();
        enviarEstadoTv(true);
      } else if (e === "reintentando") {
        $("#rp-tv-estado").textContent = "Sin conexión a internet: reintentando…";
      } else if (e === "cerrada") {
        conectarComoPantalla(); // otra pantalla tenía ese código: se elige otro
      }
    }
  });
}

async function pintarQrTv(url) {
  const box = $("#rp-tv-qr");
  try {
    const { default: qrcode } = await import("./vendor/qrcode.mjs");
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: "Código QR para conectar el teléfono" });
  } catch (_) {
    box.replaceChildren();
  }
}

function abrirEscenarioTv() {
  tv.conectado = true;
  document.body.classList.add("rp-tv-conectada");
  $("#rp-tv-emparejar").hidden = true;
  escena.abierto = true;
  $("#rp-escenario").hidden = false;
  document.body.classList.add("en-escenario");
  if (st.cola && st.indice >= 0) pintarEscenario();
  else $("#rp-esc-letra").innerHTML = '<div class="rp-vacio"><p>Pantalla conectada. Elegí una canción en el teléfono.</p></div>';
}

const entero = (n, min, max) => Math.max(min, Math.min(max, Math.round(+n || 0)));

function ordenEnTv(o) {
  if (o.tipo === "cambiar-codigo") return conectarComoPantalla();
  if (o.tipo !== "orden") return;
  if (!tv.conectado) abrirEscenarioTv();
  if (o.accion === "ver") {
    tv.ver = { indice: o.indice, i: o.i, f: o.f };
    return alinear(true);
  }
  if (o.accion === "tono") {
    const it = st.cola?.items[o.indice];
    if (!it || it.cancionId !== o.cancionId) return;
    it.desplazamiento = semitonos(o.desplazamiento);
    if (o.indice === st.indice) repintarLetra(it);
    return;
  }
  if (o.modos) {
    modos.aleatorio = !!o.modos.aleatorio;
    modos.repetir = ["no", "lista", "una"].includes(o.modos.repetir) ? o.modos.repetir : "no";
  }
  const desde = Math.max(0, +o.desde || 0);
  if (o.tocar) tv.queriaSonar = true;
  switch (o.accion) {
    case "cola":
      if (!Array.isArray(o.cola?.items) || !o.cola.items.length) break;
      st.cola = { nombre: String(o.cola.nombre || "Lista").slice(0, 120), tipo: String(o.cola.tipo || "lista"), items: o.cola.items.filter((x) => x && typeof x.cancionId === "string") };
      ordenDe = null;
      tv.colaRev++;
      tv.ver = null;
      enviarColaTv();
      reproducir(entero(o.indice, 0, st.cola.items.length - 1), !!o.tocar, desde);
      break;
    case "ir": {
      tv.ver = null;
      const i = st.cola ? entero(o.indice, 0, st.cola.items.length - 1) : -1;
      // Si la lista del TV no es la del teléfono, el número sería otra canción: se pide la lista
      if (i < 0 || (o.cancionId && st.cola.items[i].cancionId !== o.cancionId)) {
        tv.sala?.enviar({ tipo: "pide-cola", cancionId: o.cancionId, tocar: !!o.tocar, desde });
        break;
      }
      reproducir(i, !!o.tocar, desde);
      break;
    }
    case "play": tv.queriaSonar = true; tocarMotor(); break;
    case "pausa": tv.queriaSonar = false; motor().pause(); break;
    case "buscar": motor().currentTime = Math.max(0, +o.segundo || 0); break;
    case "voz": if (o.cancionId === actualId()) cambiarVoz(entero(o.i, 0, 50)); break;
    case "avance": alternarAvance(); break;
    case "nivel": cambiarNivel(entero(o.d, -19, 19)); break;
    case "pagina": paginaEscena(o.d < 0 ? -1 : 1); break;
    case "acordes":
      guardar("mc-rp-acordes", o.si ? "si" : "no");
      mantenerLugar(() => {
        aplicarAjustes();
        ajustarEscenario();
      });
      break;
    case "tam":
      guardar("mc-rp-letra", String(entero((+guardado("mc-rp-letra", "18") || 18) + (+o.d || 0), 12, 36)));
      mantenerLugar(() => {
        aplicarAjustes();
        ajustarEscenario();
      });
      break;
  }
  if (o.accion === "hola") enviarColaTv();
  enviarEstadoTv(true);
  // El teléfono que llega se pone en el mismo lugar de la letra
  if (o.accion === "hola") mandarVer();
}

function sinPermisoDeSonido(e) {
  if (!tv || e?.name !== "NotAllowedError") return;
  $("#rp-tv-sonido").hidden = !tv.conectado || tv.sonido;
  tv.sala?.enviar({ tipo: "aviso", texto: "El TV todavía no tiene el sonido activado: presioná OK en su control remoto (o hacé clic en la pantalla)." });
}

function enviarColaTv() {
  if (tv?.sala && st.cola) tv.sala.enviar({ tipo: "cola", cola: st.cola, rev: tv.colaRev, guardar: true });
}

// Al cambiar algo se avisa enseguida; mientras suena, el avance cada 2 segundos
function enviarEstadoTv(forzar = false) {
  if (!tv?.sala) return;
  const m = motor();
  const e = {
    indice: st.cola ? st.indice : -1, paused: m.paused, tiene: m !== audio || !!audio.getAttribute("src"),
    dur: isFinite(m.duration) ? Math.round(m.duration) : 0, nivel: escena.nivel, avanza: escena.avanza, preset: escena.preset,
    colaRev: tv.colaRev, acordes: guardado("mc-rp-acordes", "si") !== "no", letra: +guardado("mc-rp-letra", "18") || 18,
    voz: st.elegido.get(actualId()) ?? null, cancionId: actualId()
  };
  const clave = JSON.stringify(e), ahora = Date.now(), cambio = clave !== tv.ultimoClave;
  if (!forzar && !cambio && (m.paused || ahora - tv.ultimo < 2000)) return;
  tv.ultimoClave = clave;
  tv.ultimo = ahora;
  tv.sala.enviar({ tipo: "estado", ...e, t: Math.round((m.currentTime || 0) * 10) / 10, guardar: cambio || forzar });
}

// ---- En el teléfono ----

// Hace de <audio> para la barra y los botones: lee el estado que manda el TV y le manda las órdenes
const motorRemoto = {
  get paused() { return remoto?.estado?.paused ?? true; },
  get currentTime() {
    const e = remoto?.estado;
    if (!e) return 0;
    return e.paused ? e.t || 0 : Math.min(e.dur || Infinity, (e.t || 0) + (Date.now() - e.recibido) / 1000);
  },
  set currentTime(s) {
    if (remoto?.estado) Object.assign(remoto.estado, { t: s, recibido: Date.now() });
    clearTimeout(motorRemoto.espera);
    motorRemoto.espera = setTimeout(() => ordenTv("buscar", { segundo: s }), 150);
  },
  get duration() { return remoto?.estado?.dur || NaN; },
  play() { ordenTv("play"); },
  pause() { ordenTv("pausa"); }
};

function ordenTv(accion, extra = {}) {
  return !!remoto?.sala?.enviar({ tipo: "orden", accion, ...extra, modos: { aleatorio: modos.aleatorio, repetir: modos.repetir } });
}

// La lista se da por entregada solo cuando el TV la devuelve (mensajeDelTv, «cola»). Hasta que el TV confirma la
// canción pedida (remoto.pide), lo que mande de antes no la cambia; si no se pudo enviar, queda en remoto.pendiente
function enviarAPantalla(i, tocar, desde) {
  const r = remoto, cancionId = st.cola.items[i]?.cancionId || "";
  r.ver = null;
  r.pide = { cancionId, hasta: Date.now() + 8000 };
  const enviada = r.colaTv === st.cola ? ordenTv("ir", { indice: i, cancionId, tocar, desde })
    : ordenTv("cola", { cola: st.cola, indice: i, tocar, desde });
  r.pendiente = enviada ? null : { tocar, desde };
  if (!enviada) avisar("Reconectando con el TV… la canción va a pasar apenas vuelva la conexión.");
  if (r.estado) Object.assign(r.estado, { indice: i, paused: !tocar, t: desde || 0, recibido: Date.now() });
}

const esperandoTv = (r) => !!r.pendiente || (!!r.pide && Date.now() < r.pide.hasta);

const mismaCola = (a, b) => !!a && !!b && a.nombre === b.nombre && a.items.length === b.items.length
  && a.items.every((x, k) => x.cancionId === b.items[k].cancionId && (x.desplazamiento || 0) === (b.items[k].desplazamiento || 0));

function conectarPantalla(codigo) {
  codigo = String(codigo || "").replace(/\D/g, "");
  if (!codigoValido(codigo)) return errorPantalla("El código de la pantalla tiene 6 cifras.");
  desconectarPantalla(false);
  $("#rp-pant-error").hidden = true;
  remoto = { codigo, sala: null, listo: false, estado: null, colaTv: null, controles: 1, sinTv: false, ver: null, pide: null, pendiente: null };
  guardar("mc-rp-pantalla", codigo);
  const r = remoto;
  r.sala = conectarSala(codigo, "control", {
    alMensaje: (m) => remoto === r && mensajeDelTv(m),
    alEstado: (e, cierre) => {
      if (remoto !== r) return;
      if (e === "conectada") {
        r.sala.enviar({ tipo: "orden", accion: "hola" });
        // Lo que se eligió mientras no había conexión va completo: el TV pudo quedar con otra lista
        if (r.pendiente && st.cola && st.indice >= 0) {
          const p = r.pendiente;
          r.colaTv = null;
          enviarAPantalla(st.indice, p.tocar, p.desde);
        }
      }
      if (e === "cerrada") {
        desconectarPantalla();
        return errorPantalla(cierre?.code === 4004 ? `No hay ninguna pantalla con el código ${conEspacio(codigo)}: revisalo en el TV.`
          : cierre?.code === 4002 ? "La pantalla cambió de código: el teléfono quedó desconectado."
            : "Se cortó la conexión con la pantalla.");
      }
      pintarRemoto();
    }
  });
  r.reloj = setInterval(() => remoto === r && r.listo && !r.estado?.paused && pintarBarra(), 1000);
  pintarRemoto();
}

function errorPantalla(texto) {
  if ($("#rp-dlg-pantalla").open) {
    $("#rp-pant-error").textContent = texto;
    $("#rp-pant-error").hidden = false;
  } else avisar(texto);
}

function mensajeDelTv(m) {
  const r = remoto;
  if (m.tipo === "ver") {
    r.ver = { indice: m.indice, i: m.i, f: m.f };
    // Mientras el dedo recorre la letra en el teléfono, manda el teléfono
    if (!tocando && Date.now() - tocado > 1200) alinear(true);
    return;
  }
  if (m.tipo === "controles") {
    if (r.listo && m.n > r.controles) avisar("Se conectó otro teléfono a la pantalla.");
    r.controles = m.n;
  } else if (m.tipo === "sin-tv") {
    r.sinTv = true;
  } else if (m.tipo === "aviso") {
    avisar(String(m.texto || "").slice(0, 200));
  } else if (m.tipo === "pide-cola") {
    // El TV tenía otra lista: va completa (solo el teléfono que pidió esa canción)
    if (r.pide?.cancionId !== m.cancionId || !st.cola || st.indice < 0) return;
    r.colaTv = null;
    enviarAPantalla(st.indice, !!m.tocar, +m.desde || 0);
  } else if (m.tipo === "cola" && Array.isArray(m.cola?.items)) {
    if (mismaCola(st.cola, m.cola)) r.colaTv = st.cola;
    else if (!esperandoTv(r)) {
      st.cola = m.cola;
      ordenDe = null;
      colaHash = "";
      if (r.listo) pintarCola();
      r.colaTv = st.cola;
    }
  } else if (m.tipo === "estado") {
    r.sinTv = false;
    // Un estado de antes de la canción pedida (otra lista, o el guardado al reconectar) no la cambia
    if (r.listo && esperandoTv(r) && m.cancionId != null && m.cancionId !== r.pide?.cancionId) return pintarRemoto();
    if (r.pide && m.cancionId === r.pide.cancionId) r.pide = null;
    r.estado = { ...m, recibido: Date.now() };
    if (!r.listo) primeraConexion();
    else if (m.indice >= 0 && st.cola && m.indice !== st.indice && (m.cancionId == null || st.cola.items[m.indice]?.cancionId === m.cancionId)) {
      reproducir(m.indice, false, 0, true);
    }
    if (m.voz != null && $("#rp-voz").value !== String(m.voz)) $("#rp-voz").value = m.voz;
    pintarBarra();
  }
  pintarRemoto();
}

// Al conectarse: si el TV ya tiene algo, el teléfono se pone al día; si no, lo que sonaba en el teléfono pasa al TV
function primeraConexion() {
  const r = remoto, e = r.estado;
  const local = yt?.activo ? yt : audio, sonaba = !local.paused, segundo = local.currentTime || 0;
  ++turno;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  quitarVideo();
  st.mezclador?.cerrar();
  r.listo = true;
  avanzar(false); // desde ahora la letra avanza sola en el TV, y el teléfono la sigue
  if ($("#rp-dlg-pantalla").open) $("#rp-dlg-pantalla").close();
  if (e.indice >= 0 && r.colaTv) {
    reproducir(e.indice, false, 0, true);
    mostrarVista("sonando");
  } else if (st.cola && st.indice >= 0) {
    enviarAPantalla(st.indice, sonaba, segundo);
    mostrarVista("sonando");
    mandarVer();
  }
  avisar(`Conectado a la pantalla ${conEspacio(r.codigo)}: lo que elijas aquí suena y se ve en el TV.`);
}

function desconectarPantalla(olvidar = true) {
  const r = remoto;
  if (!r) return;
  remoto = null;
  r.sala?.cerrar();
  clearInterval(r.reloj);
  if (olvidar) guardar("mc-rp-pantalla", "");
  pintarRemoto();
  // Lo que sonaba en el TV queda listo en el teléfono, en pausa
  if (r.listo && st.cola && st.indice >= 0) reproducir(st.indice, false, r.estado?.t || 0);
  pintarBarra();
}

function pintarRemoto() {
  const r = remoto, e = r?.estado;
  document.body.classList.toggle("rp-remoto", !!r?.listo);
  pintarAvance();
  pintarNivel();
  for (const b of [$("#rp-pant-menu"), $("#rp-pant-barra")]) b.classList.toggle("conectada", !!r);
  $("#rp-pant-barra").setAttribute("aria-pressed", !!r);
  $("#rp-control-tv").hidden = !r;
  $("#rp-pant-desconectado").hidden = !!r;
  $("#rp-pant-conectado").hidden = !r;
  if (!r) return;
  const estado = !r.sala?.abierta ? "Reconectando…" : r.sinTv ? "El TV se desconectó: esperando que vuelva…"
    : !r.listo ? "Conectando…" : r.controles > 1 ? `Conectada · ${r.controles} teléfonos` : "Conectada";
  $("#rp-control-titulo").textContent = "Pantalla " + conEspacio(r.codigo);
  $("#rp-control-estado").textContent = estado;
  $("#rp-pant-cod").textContent = conEspacio(r.codigo);
  $("#rp-pant-info").textContent = estado;
  $("#rp-tv-nivel").textContent = e?.nivel ?? "–";
  const av = $("#rp-tv-avanza");
  av.setAttribute("aria-pressed", !!e?.avanza);
  av.textContent = e?.avanza ? "⏸" : "▼";
  av.setAttribute("aria-label", e?.avanza ? "Detener el desplazamiento en el TV" : "Desplazar la letra en el TV");
  $("#rp-tv-acordes").setAttribute("aria-pressed", e?.acordes !== false);
  const play = $("#rp-tv-play"), ico = motor().paused ? "play" : "pausa";
  if (play.dataset.icono !== ico) {
    play.innerHTML = icono(ico);
    play.dataset.icono = ico;
  }
}

async function escanearPantalla() {
  $("#rp-pant-error").hidden = true;
  try {
    const { leerQr } = await import("./lector-qr.js");
    const texto = await leerQr({ texto: "Apuntá la cámara al código QR que muestra el TV" });
    if (texto == null) return;
    const codigo = codigoDeQr(texto);
    if (!codigo) return errorPantalla("Ese QR no es el de una pantalla del reproductor.");
    $("#rp-pant-codigo").value = conEspacio(codigo);
    conectarPantalla(codigo);
  } catch (e) {
    errorPantalla(e.message);
  }
}

function conectarControlesPantalla() {
  const abrir = () => {
    pintarRemoto();
    $("#rp-pant-error").hidden = true;
    $("#rp-dlg-pantalla").showModal();
  };
  $("#rp-pant-menu").addEventListener("click", abrir);
  $("#rp-pant-barra").addEventListener("click", abrir);
  $("#rp-control-opciones").addEventListener("click", abrir);
  $("#rp-pant-direccion").textContent = sitioPublico().replace(/^https?:\/\//, "") + "tv";
  // En un teléfono lo primero es escanear; en un equipo grande y sin pantalla táctil, mostrar el QR
  const telefono = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 768;
  const primero = telefono ? $("#rp-pant-soy-control") : $("#rp-pant-soy-tv");
  $("#rp-pant-roles").prepend(primero);
  primero.classList.add("sugerido");
  $("#rp-pant-soy-control").addEventListener("click", escanearPantalla);
  $("#rp-pant-soy-tv").addEventListener("click", () => {
    guardar("mc-equipo", "tv");
    location.hash = "pantalla";
    location.reload();
  });
  $("#rp-pant-conectar").addEventListener("click", () => conectarPantalla($("#rp-pant-codigo").value));
  $("#rp-pant-codigo").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    conectarPantalla($("#rp-pant-codigo").value);
  });
  $("#rp-pant-desconectar").addEventListener("click", () => {
    desconectarPantalla();
    $("#rp-dlg-pantalla").close();
    avisar("Desconectado de la pantalla: ahora suena en este teléfono.");
  });
  $("#rp-pant-cambiar").addEventListener("click", () => {
    remoto?.sala?.enviar({ tipo: "cambiar-codigo" });
    desconectarPantalla();
    $("#rp-dlg-pantalla").close();
    avisar("El TV muestra un código nuevo: todos los teléfonos quedaron desconectados.");
  });
  $("#rp-tv-play").addEventListener("click", () => $("#rp-play").click());
  $("#rp-tv-anterior").addEventListener("click", () => cambiarEnEscena(-1));
  $("#rp-tv-siguiente").addEventListener("click", () => cambiarEnEscena(1));
  $("#rp-tv-arriba").addEventListener("click", () => ordenTv("pagina", { d: -1 }));
  $("#rp-tv-abajo").addEventListener("click", () => ordenTv("pagina", { d: 1 }));
  $("#rp-tv-avanza").addEventListener("click", () => ordenTv("avance"));
  $("#rp-tv-lento").addEventListener("click", () => ordenTv("nivel", { d: -1 }));
  $("#rp-tv-rapido").addEventListener("click", () => ordenTv("nivel", { d: 1 }));
  $("#rp-tv-acordes").addEventListener("click", () => ordenTv("acordes", { si: remoto?.estado?.acordes === false }));
  $("#rp-tv-menos").addEventListener("click", () => ordenTv("tam", { d: -2 }));
  $("#rp-tv-mas").addEventListener("click", () => ordenTv("tam", { d: 2 }));

  window.addEventListener("scroll", alDesplazar, { passive: true });
  $("#rp-esc-cuerpo").addEventListener("scroll", alDesplazar, { passive: true });
  document.addEventListener("touchstart", () => { tocando = true; }, { passive: true, capture: true });
  for (const ev of ["touchend", "touchcancel"]) {
    document.addEventListener(ev, (e) => { tocando = e.touches.length > 0; }, { passive: true, capture: true });
  }
}

// ============ AJUSTES DE LA LETRA ============

function aplicarAjustes() {
  const soloLetra = guardado("mc-rp-acordes", "si") === "no";
  $("#rp-letra").classList.toggle("solo-letra", soloLetra);
  $("#rp-esc-letra").classList.toggle("solo-letra", soloLetra);
  for (const b of [$("#rp-acordes"), $("#rp-cfg-acordes")]) {
    b.setAttribute("aria-pressed", !soloLetra);
    b.textContent = soloLetra ? "Solo letra" : "Letra y acordes";
  }
  const tam = +guardado("mc-rp-letra", "18") || 18;
  document.documentElement.style.setProperty("--rp-letra", tam + "px");
  $("#rp-cfg-tam").textContent = tam + " px";
  aplicarColores();
}

// ============ COLORES ============

// Color litúrgico de hoy sobre fondo claro (tema Litúrgico): primero el calculado con el calendario y, cuando
// llegan, el de las lecturas del día; queda guardado con la fecha para el próximo arranque
const COLOR_CLARO = { Verde: "#2f6b3a", Morado: "#6b3fa0", Rojo: "#b3261e", Blanco: "#9a7414", Rosa: "#b4507f" };
const HOY = lit.hoyIso();
let colorHoy = (() => {
  try {
    const g = JSON.parse(guardado("mc-rp-color-dia", "null"));
    if (g?.fecha === HOY && COLOR_CLARO[g.color]) return g.color;
  } catch (_) { /* guardado roto */ }
  return lit.colorDelDia(HOY);
})();
const fijarColorHoy = (color) => {
  colorHoy = COLOR_CLARO[color] ? color : "Verde";
  guardar("mc-rp-color-dia", JSON.stringify({ fecha: HOY, color: colorHoy, hex: COLOR_CLARO[colorHoy] }));
};
fijarColorHoy(colorHoy);
lecturasDelDia(HOY).then((l) => {
  const c = l && lit.colorDelDia(HOY, l);
  if (c && c !== colorHoy) {
    fijarColorHoy(c);
    aplicarColores();
  }
}).catch(() => {});

// Mezcla dos colores #rrggbb (para el color de la barra del navegador, que no entiende color-mix)
const mezclarColor = (a, b, p) => "#" + [1, 3, 5].map((i) =>
  Math.round(parseInt(a.substr(i, 2), 16) * p + parseInt(b.substr(i, 2), 16) * (1 - p)).toString(16).padStart(2, "0")).join("");

const TEMAS = [
  { id: "liturgico", nombre: "Litúrgico", fondo: "#f6f4ea", acento: "#2f6b3a" },
  { id: "noche", nombre: "Noche", fondo: "#030303", acento: acentoLiturgico, oscuro: true },
  { id: "dia", nombre: "Día", fondo: "#faf3e4", acento: "#9a4f2e" },
  { id: "carmelo", nombre: "Carmelo", fondo: "#241811", acento: "#d9b26a", oscuro: true },
  { id: "mariano", nombre: "Mariano", fondo: "#0e1a2e", acento: "#8fb8e8", oscuro: true },
  { id: "penitencial", nombre: "Penitencial", fondo: "#1a1322", acento: "#b58ad6", oscuro: true }
];
const temaActual = () => TEMAS.find((t) => t.id === guardado("mc-rp-tema", "liturgico")) || TEMAS[0];

function aplicarColores() {
  const lit0 = TEMAS[0];
  lit0.acento = COLOR_CLARO[colorHoy];
  lit0.fondo = mezclarColor(lit0.acento, "#f6f4ea", 0.07);
  const t = temaActual(), acento = guardado("mc-rp-acento", "");
  const b = document.body;
  b.dataset.rpTema = t.id;
  b.classList.toggle("rp-oscuro", !!t.oscuro);
  b.style.setProperty("--rp-dia", lit0.acento);
  for (const v of ["--rp-acento", "--rp-acorde"]) {
    if (acento) b.style.setProperty(v, acento);
    else b.style.removeProperty(v);
  }
  document.querySelector('meta[name="theme-color"]').content = t.fondo;
  $("#rp-config-dia").textContent = t === lit0 && !acento
    ? `Litúrgico usa el color de hoy: ${colorHoy === "Rosa" ? "rosado" : colorHoy.toLowerCase()}.` : "";
  $("#rp-acento-color").value = acento || t.acento;
  $("#rp-acento-restablecer").disabled = !acento;
  $("#rp-temas").innerHTML = TEMAS.map((x) =>
    `<button type="button" class="rp-tema-op" role="radio" aria-checked="${x === t}" data-tema="${x.id}"><span class="rp-muestra" style="--m-fondo:${x.fondo};--m-acento:${acento || x.acento}"></span>${esc(x.nombre)}</button>`
  ).join("");
}

// ============ EN VIVO (quienes siguen) ============

const vivoVista = () => guardado("mc-vivo-vista", "letra");

function pintarVivoVista() {
  const v = vivoVista();
  document.querySelectorAll("[data-vivo-vista]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.vivoVista === v));
  $("#rp-vivo-letra").classList.toggle("solo-letra", v === "letra");
}

function seguirVivo(codigo) {
  dejarVivo(false);
  st.vivo = { codigo, rev: -1, cancionId: "", desplazamiento: 0, reloj: 0, primera: true, terminado: false };
  $("#rp-vivo-form").hidden = true;
  $("#rp-vivo").hidden = false;
  $("#rp-vivo-error").hidden = true;
  $("#rp-vivo-estado").textContent = "Conectando con el código " + codigo + "…";
  $("#rp-vivo-letra").innerHTML = '<div class="rp-vacio"><p>Esperando la primera canción…</p></div>';
  $("#rp-vivo-momento").hidden = true;
  document.body.classList.remove("vivo-terminado");
  pintarVivoVista();
  mostrarVista("vivo");
  consultarVivo();
}

function programarVivo() {
  const v = st.vivo;
  if (!v || v.terminado) return;
  clearTimeout(v.reloj);
  if (document.hidden) return; // vuelve a consultar al mostrarse
  v.reloj = setTimeout(consultarVivo, 4000 + Math.random() * 1200);
}

async function consultarVivo() {
  const v = st.vivo;
  if (!v || v.terminado) return;
  clearTimeout(v.reloj);
  let r;
  try {
    r = (await leer({ accion: "vivo", codigo: v.codigo })).vivo;
  } catch (e) {
    if (st.vivo !== v) return;
    if (v.primera) {
      dejarVivo(false);
      $("#rp-vivo-error").textContent = e.message;
      $("#rp-vivo-error").hidden = false;
      return;
    }
    $("#rp-vivo-estado").textContent = "Sin conexión: reintentando…";
    return programarVivo();
  }
  if (st.vivo !== v) return;
  v.primera = false;
  if (!r.activo) {
    v.terminado = true;
    document.body.classList.add("vivo-terminado");
    $("#rp-vivo-estado").textContent = "Terminó la transmisión de «" + (r.nombre || "la misa") + "».";
    pedirPantalla();
    return;
  }
  $("#rp-vivo-estado").textContent = "En vivo · " + (r.nombre || "Cancionero") + " · código " + v.codigo;
  if (r.rev !== v.rev) {
    v.rev = r.rev;
    const cambia = r.cancionId !== v.cancionId;
    if (r.cancionId && (cambia || r.desplazamiento !== v.desplazamiento)) await pintarVivo(r, cambia);
    v.cancionId = r.cancionId || "";
    v.desplazamiento = r.desplazamiento || 0;
    $("#rp-vivo-momento").hidden = !r.momento;
    $("#rp-vivo-momento").textContent = r.momento || "";
  }
  programarVivo();
}

async function pintarVivo(r, arriba) {
  const box = $("#rp-vivo-letra");
  try {
    const t = await textoCancion(r.cancionId);
    box.innerHTML = htmlCancion(t, r.desplazamiento, st.porId.get(r.cancionId));
  } catch (e) {
    box.innerHTML = `<div class="rp-vacio"><p>${esc(e.message)}</p></div>`;
  }
  if (arriba) window.scrollTo({ top: 0, behavior: "smooth" });
}

function dejarVivo(limpiarHash = true) {
  if (st.vivo) clearTimeout(st.vivo.reloj);
  st.vivo = null;
  $("#rp-vivo").hidden = true;
  $("#rp-vivo-form").hidden = false;
  if (limpiarHash && location.hash.startsWith("#vivo=")) history.replaceState(null, "", location.pathname + location.search);
  pedirPantalla();
}

// ============ ENLACES ============

function leerHash() {
  const h = location.hash.slice(1);
  const [clave, ...resto] = h.split("=");
  const valor = decodeURIComponent(resto.join("="));
  if (clave === "l" && valor) {
    try {
      const l = decodificarLista(valor);
      if (!l.items.length) throw new Error("vacía");
      st.compartida = l;
      $("#rp-compartida-nombre").textContent = l.nombre + " (" + l.items.length + (l.items.length === 1 ? " canción)" : " canciones)");
      $("#rp-compartida").hidden = false;
      st.cola = { nombre: l.nombre, tipo: "compartida", items: l.items };
      colaHash = location.hash;
      mostrarVista("sonando");
      reproducir(0);
    } catch (_) {
      avisar("El enlace de la lista no se pudo leer.");
    }
  } else if (clave === "buscar" && valor) {
    // Desde Agradecimientos: los cantos de un autor
    history.replaceState(null, "", location.pathname + location.search);
    mostrarVista("canciones");
    $("#rp-buscar").value = valor;
    pintarCanciones();
  } else if (clave === "misa" && valor) abrirMisa(valor);
  else if (clave === "vivo" && /^\d{4}$/.test(valor)) seguirVivo(valor);
  else if (clave === "pantalla" && !tv) iniciarPantalla();
  else if (clave === "control" && codigoValido(valor)) {
    // El QR del TV leído con la cámara del teléfono
    history.replaceState(null, "", location.pathname + location.search);
    conectarPantalla(valor);
  }
}

function cambiarVoz(k) {
  const entrada = st.porId.get(actualId());
  const a = entrada && audiosReproducibles(entrada)[k];
  if (!a) return;
  st.elegido.set(entrada.id, k);
  const antes = motor();
  const t = antes.currentTime, sonaba = !antes.paused;
  cargarAudio(a, sonaba);
  pintarFuente(a);
  textoCancion(entrada.id).then(prepararKaraoke).catch(() => {});
  // Las voces de una misma grabación siguen en el mismo punto; el video es otra grabación
  if (antes === audio && motor() === audio) {
    audio.addEventListener("loadedmetadata", () => { audio.currentTime = Math.min(t, audio.duration || t); }, { once: true });
  }
}

// ============ EVENTOS ============

function conectar() {
  document.querySelector(".rp-pestanas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vista]");
    if (b) mostrarVista(b.dataset.vista);
  });
  // La marca lleva al Inicio sin recargar: no corta lo que está sonando
  $("#rp-marca").addEventListener("click", (e) => {
    e.preventDefault();
    mostrarVista("inicio");
    scrollTo({ top: 0, behavior: "smooth" });
  });
  let espera = 0;
  $("#rp-buscar").addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(pintarCanciones, 120);
  });
  $("#rp-con-audio").addEventListener("change", pintarCanciones);
  $("#rp-canciones").addEventListener("click", (e) => {
    const tocar = e.target.closest("[data-tocar]"), mas = e.target.closest("[data-agregar]");
    if (mas) return abrirAgregar(mas.dataset.agregar);
    if (!tocar) return;
    const lista = resultados();
    const q = $("#rp-buscar").value.trim();
    colaPropia({ nombre: q ? `Búsqueda «${q}»` : "Biblioteca", tipo: "biblioteca", items: lista.map((c) => ({ cancionId: c.id, desplazamiento: 0 })) });
    reproducir(lista.findIndex((c) => c.id === tocar.dataset.tocar));
    mostrarVista("sonando");
  });

  $("#rp-nueva-lista").addEventListener("click", () => {
    const l = nuevaLista();
    if (l) {
      st.abierta = l.id;
      pintarListas();
    }
  });
  $("#rp-listas").addEventListener("click", accionLista);
  $("#rp-listas").addEventListener("change", (e) => {
    const i = e.target.closest("[data-l-nombre]");
    const l = i && st.listas.find((x) => x.id === i.dataset.lNombre);
    if (!l || !i.value.trim()) return;
    l.nombre = i.value.trim().slice(0, 80);
    guardarListas();
    pintarListas();
  });
  $("#rp-agregar-listas").addEventListener("click", (e) => {
    const s = e.target.closest("[data-a-sugerida]");
    if (s) {
      const l = nuevaLista([], s.dataset.aSugerida);
      if (l) agregarA(l);
      return;
    }
    const b = e.target.closest("[data-a-lista]");
    const l = b && st.listas.find((x) => x.id === b.dataset.aLista);
    if (l) agregarA(l);
  });
  for (const id of ["#rp-agregar-actual", "#rp-barra-agregar"]) $(id).addEventListener("click", () => abrirAgregar(actualId()));
  $("#rp-agregar-nueva").addEventListener("click", () => {
    const l = nuevaLista();
    if (l) agregarA(l);
  });
  $("#rp-guardar-compartida").addEventListener("click", () => {
    const l = st.compartida && nuevaLista(st.compartida.items, st.compartida.nombre);
    if (!l) return;
    $("#rp-compartida").hidden = true;
    st.compartida = null;
    avisar(`Se guardó «${l.nombre}» en tus listas.`);
  });

  const sel = $("#rp-comunidad");
  sel.innerHTML = `<option value="">Todas las comunidades</option>` + COMUNIDADES.map((c) => `<option value="${c.slug}">${esc(c.nombre)}</option>`).join("");
  sel.value = st.comunidad;
  sel.addEventListener("change", () => {
    st.comunidad = sel.value;
    guardar(CLAVE_COMUNIDAD, st.comunidad);
    inicioViejo = true;
    cargarMisas();
    actualizarComunidadAviso(st.comunidad);
  });

  $("#rp-voz").addEventListener("change", (e) => {
    if (!remoto?.listo) return cambiarVoz(+e.target.value);
    st.elegido.set(actualId(), +e.target.value);
    ordenTv("voz", { cancionId: actualId(), i: +e.target.value });
  });
  $("#rp-cfg-sigue").setAttribute("aria-pressed", sigueLaLetra());
  $("#rp-cfg-sigue").addEventListener("click", (e) => {
    guardar("mc-rp-sigue", sigueLaLetra() ? "no" : "si");
    e.currentTarget.setAttribute("aria-pressed", sigueLaLetra());
    karaoke.actual = -2;
    pasoKaraoke();
  });
  setInterval(pasoKaraoke, 200);
  for (const ev of ["wheel", "touchmove"]) addEventListener(ev, () => { karaoke.manual = Date.now(); }, { passive: true });
  for (const id of ["#rp-acordes", "#rp-cfg-acordes"]) $(id).addEventListener("click", () => {
    guardar("mc-rp-acordes", guardado("mc-rp-acordes", "si") === "no" ? "si" : "no");
    aplicarAjustes();
  });
  const tam = (d) => {
    guardar("mc-rp-letra", String(Math.max(12, Math.min(36, (+guardado("mc-rp-letra", "18") || 18) + d))));
    aplicarAjustes();
  };
  $("#rp-tono-menos").addEventListener("click", () => cambiarTono(-1));
  $("#rp-tono-mas").addEventListener("click", () => cambiarTono(1));
  $("#rp-tono-original").addEventListener("click", restaurarTono);
  for (const [id, d] of [["#rp-menos", -2], ["#rp-mas", 2], ["#rp-cfg-menos", -2], ["#rp-cfg-mas", 2]]) $(id).addEventListener("click", () => tam(d));
  for (const id of ["#rp-colores", "#rp-config-menu"]) $(id).addEventListener("click", () => {
    pintarAviso();
    $("#rp-dlg-colores").showModal();
  });
  $("#rp-cfg-aviso").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      if ((await estadoAviso()) === "activo") {
        await desactivarAviso();
        avisar("Listo: ya no te avisaremos los sábados.");
      } else {
        await activarAviso(st.comunidad);
        avisar("Listo: el sábado a las 18:00 te avisamos el cancionero del domingo.");
      }
    } catch (err) {
      avisar(err.message || "No se pudo activar el aviso.");
    }
    b.disabled = false;
    pintarAviso();
  });
  $("#rp-temas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tema]");
    if (!b) return;
    guardar("mc-rp-tema", b.dataset.tema);
    aplicarColores();
  });
  $("#rp-acento-color").addEventListener("input", (e) => {
    guardar("mc-rp-acento", e.target.value);
    aplicarColores();
  });
  $("#rp-acento-restablecer").addEventListener("click", () => {
    guardar("mc-rp-acento", "");
    aplicarColores();
  });

  $("#rp-play").addEventListener("click", () => {
    const m = motor();
    if (m.paused) {
      st.mezclador?.cerrar();
      tocarMotor();
    } else m.pause();
  });
  $("#rp-siguiente").addEventListener("click", siguiente);
  $("#rp-anterior").addEventListener("click", anterior);
  for (const id of ["#rp-barra-titulo", "#rp-barra-cara"]) $(id).addEventListener("click", () => mostrarVista("sonando"));
  $("#rp-estantes").addEventListener("click", accionInicio);
  $("#rp-portada-acciones").addEventListener("click", accionInicio);
  $("#rp-cola-lista").addEventListener("click", (e) => {
    const x = e.target.closest("[data-cola-cambiar]");
    if (x) return cambiarEnCola(+x.dataset.colaCambiar);
    const b = e.target.closest("[data-cola-i]");
    if (!b) return;
    reproducir(+b.dataset.colaI);
    document.body.classList.remove("cola-abierta");
  });
  $("#rp-cola-btn").addEventListener("click", () => {
    if (st.vista !== "sonando") {
      mostrarVista("sonando");
      return alternarCola(true);
    }
    alternarCola();
  });
  $("#rp-cola-cerrar").addEventListener("click", () => alternarCola(false));
  $("#rp-cola-velo").addEventListener("click", () => alternarCola(false));
  $("#rp-cola-pie").addEventListener("click", accionPieCola);
  $("#rp-votar-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-votar]");
    if (b) votar(b.dataset.votar);
  });
  document.body.classList.toggle("cola-oculta", guardado("mc-rp-cola-oculta", "no") === "si");
  anchoCola.addEventListener("change", () => {
    document.body.classList.remove("cola-abierta");
    centrarCola();
  });
  // En el celular la barra es angosta: aleatorio y repetir pasan a la cabecera de la cola
  const celular = matchMedia("(max-width: 720px)");
  const ubicarModos = () => {
    if (celular.matches) $("#rp-cola-modos").append($("#rp-repetir"), $("#rp-aleatorio"));
    else $("#rp-cola-btn").before($("#rp-repetir"), $("#rp-aleatorio"));
  };
  celular.addEventListener("change", ubicarModos);
  ubicarModos();
  $("#rp-progreso").addEventListener("input", (e) => {
    motor().currentTime = +e.target.value;
    if (retomarEn) retomarEn = +e.target.value;
  });
  for (const ev of ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "emptied"]) audio.addEventListener(ev, pintarBarra);
  audio.addEventListener("play", () => estadoDeMedios(false));
  // La pausa que hace cargarAudio al cambiar de canción no se guarda: el segundo sería el de la anterior
  audio.addEventListener("playing", () => {
    saltos = 0;
    turnoSonando = turno;
    retomarEn = 0;
  });
  audio.addEventListener("pause", () => {
    estadoDeMedios(true);
    if (turnoSonando === turno) guardarSonando();
  });
  audio.addEventListener("ended", alTerminarPista);
  $("#rp-aleatorio").addEventListener("click", () => {
    modos.aleatorio = !modos.aleatorio;
    guardar("mc-rp-aleatorio", modos.aleatorio ? "si" : "no");
    ordenDe = null;
    pintarModos();
    pintarBarra();
    avisar(modos.aleatorio ? "Aleatorio activado." : "Aleatorio desactivado.");
  });
  $("#rp-repetir").addEventListener("click", () => {
    modos.repetir = { no: "lista", lista: "una", una: "no" }[modos.repetir] || "no";
    guardar("mc-rp-repetir", modos.repetir);
    pintarModos();
    pintarBarra();
    avisar($("#rp-repetir").title + ".");
  });
  pintarModos();

  $("#rp-vivo-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const codigo = $("#rp-vivo-codigo").value.replace(/\D/g, "");
    if (codigo.length !== 4) {
      $("#rp-vivo-error").textContent = "El código tiene 4 cifras.";
      $("#rp-vivo-error").hidden = false;
      return;
    }
    history.replaceState(null, "", "#vivo=" + codigo);
    seguirVivo(codigo);
  });
  document.querySelectorAll("[data-vivo-vista]").forEach((b) => b.addEventListener("click", () => {
    guardar("mc-vivo-vista", b.dataset.vivoVista);
    pintarVivoVista();
  }));
  $("#rp-vivo-salir").addEventListener("click", () => dejarVivo());

  document.addEventListener("visibilitychange", () => {
    pedirPantalla();
    if (document.hidden) guardarSonando();
    else pintarBarra();
    if (!st.vivo || st.vivo.terminado) return;
    if (document.hidden) clearTimeout(st.vivo.reloj);
    else consultarVivo();
  });
  window.addEventListener("hashchange", leerHash);
  // Volver a tocar el cancionero que ya está en la dirección no dispara hashchange
  $("#rp-misas").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-misa-escenario]");
    if (b) {
      const id = b.dataset.misaEscenario;
      history.replaceState(null, "", "#misa=" + encodeURIComponent(id));
      if (await abrirMisa(id, false)) abrirEscenario();
      return;
    }
    const a = e.target.closest('a[href^="#misa="]');
    if (a && a.getAttribute("href") === location.hash) {
      e.preventDefault();
      leerHash();
    }
  });
  window.addEventListener("pagehide", () => guardarSonando());
  activarPosturas($("#rp-letra"));
  activarPosturas($("#rp-vivo-letra"));
  conectarMedios();
  conectarEscenario();
  conectarControlesPantalla();
  conectarCrear();
}

// ============ APP INSTALABLE ============

// Una sola app, la de la página principal (/app.webmanifest, /sw.js con alcance /). «Instalar app» está siempre
// fuera de la app: con el instalador del navegador si lo ofrece, o con los pasos para este equipo.
function prepararApp() {
  if (window.MC_EMBEBIDO) return;
  const app = document.body.classList.contains("rp-app");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  if (app) return;
  if (document.body.classList.contains("rp-app-vieja")) $("#rp-app-aviso").hidden = false;
  const botones = document.querySelectorAll(".rp-instalar");
  const mostrar = (si) => botones.forEach((b) => (b.hidden = !si));
  let pedido = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pedido = e;
  });
  window.addEventListener("appinstalled", () => {
    pedido = null;
    mostrar(false);
    avisar("Listo: el Cancionero quedó instalado.");
  });
  mostrar(true);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const equipo = ios ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "pc";
  botones.forEach((b) => b.addEventListener("click", async () => {
    if (!pedido) {
      document.querySelectorAll("#rp-dlg-instalar [data-equipo]").forEach((l) => (l.hidden = l.dataset.equipo !== equipo));
      return $("#rp-dlg-instalar").showModal();
    }
    pedido.prompt();
    const { outcome } = await pedido.userChoice.catch(() => ({}));
    pedido = null;
    if (outcome === "accepted") mostrar(false);
  }));
}

async function iniciar() {
  ponerIconos();
  initNavSitio();
  prepararApp();
  st.listas = leerListas();
  aplicarAjustes();
  conectar();
  document.body.dataset.vista = st.vista;
  await cargarBiblioteca();
  pintarInicio();
  arrancar();
  mostrarBienvenidaSiCorresponde();
}

iniciar();
