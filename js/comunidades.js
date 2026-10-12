/**
 * La parroquia de la página y sus comunidades. Las páginas de /<parroquia>/… la traen puesta
 * (window.MC_PARROQUIA, de functions/_middleware.js): COMUNIDADES y PARROQUIA quedan listas al importar.
 * Fuera de esas páginas (o si cambió), cargarParroquia() la lee del servidor y la guarda en el equipo.
 */

import "./config.js?v=2";

const config = () => window.MONTECARMELO_CONFIG || {};
const CLAVE = (slug) => "mc-parroquia-datos:" + slug;

export const COMUNIDADES = [];
export const PARROQUIA = { slug: "parroquia", nombre: "", nombreCorto: "" };
/** Todos los datos públicos de la parroquia (nombre, lema, descripción, correo, portada, íconos, comunidades). */
export const DATOS_PARROQUIA = {};

function llenar(p) {
  if (!p || !p.slug) return false;
  for (const k of Object.keys(DATOS_PARROQUIA)) delete DATOS_PARROQUIA[k];
  Object.assign(DATOS_PARROQUIA, p);
  COMUNIDADES.splice(0, COMUNIDADES.length, ...(p.comunidades || []).map((c) => ({
    slug: c.slug, nombre: c.nombre, carpetaCancioneros: c.carpetaCancioneros || c.nombre
  })));
  PARROQUIA.nombre = p.nombre || "";
  PARROQUIA.nombreCorto = p.nombreCorto || p.nombre || "";
  return true;
}

function guardada(slug) {
  try {
    return JSON.parse(localStorage.getItem(CLAVE(slug)) || "null");
  } catch (_) {
    return null;
  }
}

function guardar(p) {
  try {
    localStorage.setItem(CLAVE(p.slug), JSON.stringify(p));
  } catch (_) { /* sin almacenamiento */ }
}

const puesta = window.MC_PARROQUIA && window.MC_PARROQUIA.slug === config().parroquia ? window.MC_PARROQUIA : null;
if (puesta) guardar(puesta);
llenar(puesta || guardada(config().parroquia));

let carga = null;
/** Los datos de la parroquia; `{ recargar: true }` los vuelve a pedir (después de cambiarlos). */
export function cargarParroquia(opciones) {
  const recargar = (opciones || {}).recargar;
  if (puesta && !recargar && !carga) return Promise.resolve(DATOS_PARROQUIA);
  if (carga && !recargar) return carga;
  carga = fetch(config().apiUrl + "?accion=parroquia", { cache: "no-store" })
    .then((r) => r.json())
    .then((r) => {
      if (!r.ok) throw new Error(r.error || "No se pudo leer la parroquia");
      guardar(r.parroquia);
      llenar(r.parroquia);
      return DATOS_PARROQUIA;
    })
    .catch((err) => {
      carga = null;
      if (DATOS_PARROQUIA.slug) return DATOS_PARROQUIA;
      throw err;
    });
  return carga;
}

/** Cambia los datos en memoria y en el equipo (después de guardarlos en el servidor). */
export function ponerParroquia(p) {
  guardar(p);
  llenar(p);
}

export function comunidadPorSlug(slug) {
  return COMUNIDADES.find((c) => c.slug === slug) || null;
}

export function nombreComunidad(slug) {
  if (slug === "parroquia") return PARROQUIA.nombre || "Parroquia";
  const c = comunidadPorSlug(slug);
  return c ? c.nombre : "";
}

/** Dirección de una página de la parroquia: urlPagina("comunidad?c=x"). */
export function urlPagina(pagina) {
  return (config().base || "./") + (pagina || "");
}

export function rutaBase() {
  const path = location.pathname.replace(/\\/g, "/");
  if (path === "/" || path.includes("/comunidades/") || path.includes("/editor/")) return urlPagina("");
  return "./";
}
