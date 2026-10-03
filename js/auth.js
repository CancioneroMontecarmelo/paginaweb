/**
 * auth.js — Identificación en el sitio Monte Carmelo (sin claves)
 *
 *  - «Entrar con Google»: el Apps Script (backend/Code.gs) verifica la cuenta con Google y devuelve
 *    un token firmado. cancionerolitugico@gmail.com es siempre el administrador general.
 *  - Visitante: solo el correo, sin verificar; nunca recibe privilegios.
 *
 * Roles con privilegios: admin_general · admin_segundo (responsable del sitio) · sacerdote ·
 * admin (de una comunidad) · editor · colaborador. Los asignan los responsables desde login.html.
 */

import "./config.js";
import { COMUNIDADES } from "./comunidades.js";

export const CORREO_PARROQUIA = "cancionerolitugico@gmail.com";

export const ROLES = {
  admin_segundo: "Responsable del sitio",
  sacerdote: "Sacerdote",
  admin: "Administrador de comunidad",
  editor: "Editor",
  colaborador: "Colaborador"
};

const CLAVE_SESION = "montecarmelo.sesion";

const config = () => window.MONTECARMELO_CONFIG || {};
const apiUrl = () => config().apiUrl || "";
export const usaBackend = () => !!apiUrl();

export async function llamarApi(accion, datos) {
  if (!usaBackend()) throw new Error("Falta la dirección del servidor de la parroquia (apiUrl en js/config.js).");
  let r;
  try {
    const res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ accion, ...(datos || {}) })
    });
    r = await res.json();
  } catch (_) {
    throw new Error("No se pudo conectar con el servidor de la parroquia. Revisá tu conexión a internet.");
  }
  if (!r.ok) {
    if (/sesi[oó]n (inv[aá]lida|venci[oó])/i.test(r.error || "")) localStorage.removeItem(CLAVE_SESION);
    throw new Error(r.error || "El servidor de la parroquia no respondió");
  }
  return r;
}

const token = () => (sesionActual() || {}).token || "";

function tokenVigente(t) {
  try {
    const p = String(t).split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4))).exp > Date.now();
  } catch (_) {
    return false;
  }
}

export function rutaBaseAuth() {
  const path = location.pathname.replace(/\\/g, "/");
  if (path.includes("/comunidades/") || path.includes("/editor/")) return "../";
  return "./";
}

const normalizarEmail = (email) => String(email || "").trim().toLowerCase();

/** La sesión se comparte con el editor (editor/js/nube.js), por eso vive en localStorage. */
export function sesionActual() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION));
    if (!s || !s.email || !s.rol) return null;
    if (s.rol !== "visitante" && !tokenVigente(s.token)) {
      localStorage.removeItem(CLAVE_SESION);
      return null;
    }
    return s;
  } catch (_) {
    return null;
  }
}

function guardarSesion(sesion) {
  localStorage.setItem(CLAVE_SESION, JSON.stringify({ ...sesion, desde: Date.now() }));
}

export function cerrarSesion() {
  localStorage.removeItem(CLAVE_SESION);
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
}

export function esResponsableSitio(s) {
  s = s || sesionActual();
  return !!s && (s.rol === "admin_general" || s.rol === "admin_segundo");
}

export function puedeEditar(comunidadSlug) {
  const s = sesionActual();
  if (!s || s.activo === false || s.rol === "visitante") return false;
  if (esResponsableSitio(s) || s.rol === "sacerdote") return true;
  if (!comunidadSlug) return ["admin", "editor", "colaborador"].includes(s.rol);
  if (s.comunidad === "parroquia") return true;
  return s.comunidad === comunidadSlug;
}

// ============ ENTRAR ============

let gsiCargado = null;
function cargarGsi() {
  gsiCargado ||= new Promise((ok, mal) => {
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.onload = ok;
    sc.onerror = () => mal(new Error("No se pudo cargar el botón de Google. Revisá tu conexión."));
    document.head.appendChild(sc);
  });
  return gsiCargado;
}

/** Dibuja el botón «Entrar con Google» en `contenedor`; `alEntrar(sesion)` / `alFallar(error)`. */
export async function botonGoogle(contenedor, alEntrar, alFallar) {
  const clientId = config().googleClientId;
  if (!clientId) throw new Error("Falta el ID de cliente de Google (googleClientId en js/config.js).");
  await cargarGsi();
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (r) => entrarConGoogle(r.credential).then(alEntrar, alFallar),
    ux_mode: "popup"
  });
  google.accounts.id.renderButton(contenedor, {
    theme: "filled_blue",
    size: "large",
    text: "signin_with",
    shape: "pill",
    locale: "es"
  });
}

export async function entrarConGoogle(credential) {
  const r = await llamarApi("entrarGoogle", { credential });
  const sesion = { ...r.sesion, token: r.token };
  guardarSesion(sesion);
  return sesion;
}

export async function entrarVisitante(email, nombre) {
  const r = await llamarApi("entrarVisitante", { email: normalizarEmail(email), nombre });
  guardarSesion(r.sesion);
  return { sesion: r.sesion, aviso: r.aviso };
}

// ============ RESPONSABLES ============

export async function listarUsuarios() {
  return (await llamarApi("listarUsuarios", { token: token() })).usuarios;
}

export async function asignarRol(datos) {
  return (await llamarApi("asignarRol", { token: token(), ...datos, email: normalizarEmail(datos.email) })).usuario;
}

/** Registra los privilegios y devuelve el texto de la invitación (y si salió por correo). */
export function invitar(datos) {
  return llamarApi("invitar", { token: token(), ...datos, email: normalizarEmail(datos.email) });
}

export function eliminarUsuario(email) {
  return llamarApi("eliminarUsuario", { token: token(), email: normalizarEmail(email) });
}

export async function leerAuditoria(limite) {
  return (await llamarApi("auditoria", { token: token(), limite: limite || 50 })).auditoria;
}

export function comunidadesOpciones() {
  return [
    { slug: "parroquia", nombre: "Parroquia (todas)" },
    ...COMUNIDADES.map((c) => ({ slug: c.slug, nombre: c.nombre }))
  ];
}

// ============ NAVEGACIÓN ============

export function pintarNavSesion(root) {
  const nodo = (root || document).querySelector("[data-nav-sesion]");
  if (!nodo) return;
  const s = sesionActual();
  if (s) {
    nodo.textContent = "Salir (" + (s.nombre || s.email) + ")";
    nodo.href = "#";
    nodo.onclick = (e) => {
      e.preventDefault();
      cerrarSesion();
      location.reload();
    };
  } else {
    nodo.textContent = "Identificarse";
    nodo.href = rutaBaseAuth() + "login.html";
    nodo.onclick = null;
  }
}

export function initNavSitio() {
  const nav = document.querySelector(".nav-sitio");
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("abierto"));
  }
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  pintarNavSesion();
}
