/**
 * pertenencias.js — Recuerdo de parroquias/movimientos del usuario común.
 * mc-solo-local: sin pertenencias → listas y preferencias solo en este equipo.
 */

const CLAVE_HECHA = "mc-entrada-hecha";
const CLAVE_PERT = "mc-pertenencias";
const CLAVE_LOCAL = "mc-solo-local";
const CLAVE_PARROQUIA = "mc-parroquia";

export const ZONAS = ["Centro", "Norte", "Cordillera", "Oriente", "Maipo", "Sur", "Oeste"];

export function entradaHecha() {
  try { return localStorage.getItem(CLAVE_HECHA) === "1"; } catch (_) { return true; }
}

export function marcarEntradaHecha() {
  try { localStorage.setItem(CLAVE_HECHA, "1"); } catch (_) { /* */ }
}

export function esSoloLocal() {
  try { return localStorage.getItem(CLAVE_LOCAL) === "1"; } catch (_) { return false; }
}

export function leerPertenencias() {
  try {
    const a = JSON.parse(localStorage.getItem(CLAVE_PERT) || "[]");
    return Array.isArray(a) ? a.filter((x) => x && x.slug) : [];
  } catch (_) {
    return [];
  }
}

export function guardarPertenencias(lista) {
  const limpia = (lista || []).map((x) => ({
    slug: String(x.slug),
    tipo: x.tipo === "movimiento" ? "movimiento" : "parroquia",
    nombre: String(x.nombre || x.slug)
  }));
  try {
    localStorage.setItem(CLAVE_PERT, JSON.stringify(limpia));
    if (limpia.length) {
      localStorage.removeItem(CLAVE_LOCAL);
    } else {
      localStorage.setItem(CLAVE_LOCAL, "1");
    }
  } catch (_) { /* */ }
  return limpia;
}

export function marcarSoloLocal() {
  try {
    localStorage.setItem(CLAVE_PERT, "[]");
    localStorage.setItem(CLAVE_LOCAL, "1");
    localStorage.setItem(CLAVE_PARROQUIA, "montecarmelo");
  } catch (_) { /* */ }
  marcarEntradaHecha();
}

export function activaSlug() {
  try {
    const s = localStorage.getItem(CLAVE_PARROQUIA);
    if (s && /^[a-z0-9-]{3,40}$/.test(s)) return s;
  } catch (_) { /* */ }
  return "montecarmelo";
}

export function setActiva(slug) {
  const s = String(slug || "montecarmelo");
  try { localStorage.setItem(CLAVE_PARROQUIA, s); } catch (_) { /* */ }
}

/** Elige la comunidad activa al confirmar el diálogo. */
export function elegirActiva(pertenencias) {
  if (!pertenencias.length) return "montecarmelo";
  const mc = pertenencias.find((p) => p.slug === "montecarmelo");
  if (mc) return "montecarmelo";
  const par = pertenencias.find((p) => p.tipo !== "movimiento");
  return (par || pertenencias[0]).slug;
}

export function puedeGuardarEnSitio() {
  return !esSoloLocal() && leerPertenencias().length > 0;
}

const claveSesion = (slug) => (slug === "montecarmelo" ? "montecarmelo.sesion" : "mc-sesion:" + slug);

/** Registra visitante en un slug (API de esa parroquia). */
export async function registrarVisitanteEn(slug, email, nombre) {
  const res = await fetch(location.origin + "/" + slug + "/api", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ accion: "entrarVisitante", email, nombre: nombre || "" })
  });
  const r = await res.json();
  if (!r.ok) throw new Error(r.error || "No se pudo anotar en " + slug);
  try {
    localStorage.setItem(claveSesion(slug), JSON.stringify({ ...r.sesion, token: r.token || "", desde: Date.now() }));
  } catch (_) { /* */ }
  return r;
}

export async function cargarDirectorio() {
  const res = await fetch(location.origin + "/api?accion=parroquias");
  const r = await res.json();
  if (!r.ok && !r.parroquias) throw new Error(r.error || "No se pudo cargar el directorio.");
  return Array.isArray(r.parroquias) ? r.parroquias : [];
}

/** Navega a la parroquia activa (/{slug}/ → / con cookie). */
export function irAActiva(slug) {
  const s = slug || activaSlug();
  const q = /[?&]cambiar=1\b/.test(location.search) ? "?cambiar=1" : "";
  location.replace("/" + s + "/" + q);
}
