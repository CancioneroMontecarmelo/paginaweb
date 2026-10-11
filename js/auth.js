/**
 * auth.js — Identificación en el Cancionero Litúrgico (sin claves)
 *
 *  - «Entrar con Google»: el servidor (servidor/auth.js) verifica la cuenta con Google y devuelve
 *    un token firmado. cancionerolitugico@gmail.com es siempre el administrador general (en todas las parroquias).
 *  - Visitante: solo el correo, sin verificar; nunca recibe privilegios. Queda en la lista de invitados de la parroquia.
 *
 * Roles con privilegios, por parroquia: admin_segundo (responsable de la parroquia) · sacerdote ·
 * admin (de una comunidad) · editor · colaborador. Los asignan los responsables desde login.html.
 */

import "./config.js?v=2";
import { COMUNIDADES, PARROQUIA } from "./comunidades.js";

export const CORREO_PARROQUIA = "cancionerolitugico@gmail.com";

export const ROLES = {
  admin_segundo: "Responsable de la parroquia",
  sacerdote: "Sacerdote",
  admin: "Administrador de comunidad",
  editor: "Editor",
  colaborador: "Colaborador"
};

const config = () => window.MONTECARMELO_CONFIG || {};

// La sesión es de cada parroquia (el rol y la comunidad cambian); la de Monte Carmelo conserva la clave de antes
const PREFIJO_SESION = "mc-sesion:";
const claveSesion = (slug) => (slug === "montecarmelo" ? "montecarmelo.sesion" : PREFIJO_SESION + slug);
const CLAVE_SESION = claveSesion(config().parroquia || "montecarmelo");
const apiUrl = () => config().apiUrl || "";
export const usaBackend = () => !!apiUrl();

/**
 * Si el pedido llevaba token y la sesión venció, pide entrar con Google encima de la pantalla
 * (sin cerrar nada) y repite el pedido; `{ reingreso: false }` lo evita.
 */
export async function llamarApi(accion, datos, opciones) {
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
    if (/sesi[oó]n (inv[aá]lida|venci[oó])/i.test(r.error || "")) {
      olvidarToken(datos && datos.token);
      if (datos && "token" in datos && (opciones || {}).reingreso !== false) {
        const s = await pedirReingreso();
        if (s && s.token) return llamarApi(accion, { ...datos, token: s.token }, { reingreso: false });
      }
    }
    throw new Error(r.error || "El servidor de la parroquia no respondió");
  }
  if (r.token && datos && datos.token) renovarToken(r.token);
  return r;
}

/**
 * Sube un archivo tal cual (PUT /api/subir?tipo=…, sin pasarlo a base64): `params` va en la dirección y el
 * token en la cabecera. Como llamarApi, si la sesión venció pide entrar de nuevo y repite.
 */
export async function subirBinario(tipo, params, archivo, opciones) {
  if (!usaBackend()) throw new Error("Falta la dirección del servidor de la parroquia (apiUrl en js/config.js).");
  const { token: t = token(), ...resto } = params || {};
  let r;
  try {
    const res = await fetch(apiUrl() + "/subir?" + new URLSearchParams({ tipo, ...resto }), {
      method: "PUT",
      headers: { Authorization: "Bearer " + t, "Content-Type": archivo.type || "application/octet-stream" },
      body: archivo
    });
    r = await res.json();
  } catch (_) {
    throw new Error("No se pudo conectar con el servidor de la parroquia. Revisá tu conexión a internet.");
  }
  if (!r.ok) {
    if (/sesi[oó]n (inv[aá]lida|venci[oó])/i.test(r.error || "")) {
      olvidarToken(t);
      if ((opciones || {}).reingreso !== false) {
        const s = await pedirReingreso();
        if (s && s.token) return subirBinario(tipo, { ...params, token: s.token }, archivo, { reingreso: false });
      }
    }
    throw new Error(r.error || "El servidor de la parroquia no respondió");
  }
  if (r.token) renovarToken(r.token);
  return r;
}

const token = () => (sesionActual() || {}).token || "";

function datosToken(t) {
  try {
    const p = String(t).split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4)));
  } catch (_) {
    return null;
  }
}

/** El servidor rechazó el token: se olvida solo el token (la pantalla sigue igual) y se pide al próximo pedido. */
function olvidarToken(rechazado) {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION));
    if (s && s.token && s.token === (rechazado || s.token)) localStorage.setItem(CLAVE_SESION, JSON.stringify({ ...s, token: "" }));
  } catch (_) { /* sin almacenamiento */ }
}

function renovarToken(nuevo) {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION));
    if (!s || s.rol === "visitante" || s.email !== (datosToken(nuevo) || {}).email) return;
    localStorage.setItem(CLAVE_SESION, JSON.stringify({ ...s, token: nuevo, renovada: Date.now() }));
  } catch (_) { /* sin almacenamiento: queda la sesión anterior */ }
}

const RENOVAR_CADA_MS = 30 * 60 * 1000;
let renovando = null;

async function renovarSesion() {
  const s = sesionActual();
  if (!s || !s.token || !usaBackend() || renovando) return;
  if (Date.now() - (s.renovada || s.desde || 0) < RENOVAR_CADA_MS) return;
  renovando = llamarApi("sesion", { token: s.token }, { reingreso: false })
    .then((r) => {
      const act = sesionActual();
      if (act && r.sesion) localStorage.setItem(CLAVE_SESION, JSON.stringify({ ...act, ...r.sesion }));
    })
    .catch(() => {})
    .finally(() => { renovando = null; });
}

let sesionVigilada = false;
/** Mantiene viva la sesión mientras la página está abierta, también al volver del reposo. */
export function mantenerSesionViva() {
  if (sesionVigilada) return;
  sesionVigilada = true;
  renovarSesion();
  setInterval(renovarSesion, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renovarSesion(); });
  window.addEventListener("focus", renovarSesion);
  window.addEventListener("online", renovarSesion);
}

let reingreso = null;
function pedirReingreso() {
  if (!config().googleClientId || typeof HTMLDialogElement === "undefined") return Promise.resolve(null);
  reingreso ||= new Promise((resolver) => {
    const d = document.createElement("dialog");
    d.className = "dlg-reingreso";
    d.innerHTML = `<h2>Volvé a entrar</h2>
      <p>Tu sesión se cerró. No se perdió nada: al entrar se completa lo que estabas haciendo.</p>
      <div class="boton-google"></div>
      <p class="error" hidden></p>
      <button type="button" class="btn btn-secundario">Cancelar</button>`;
    document.body.appendChild(d);
    let sesion = null;
    const error = d.querySelector(".error");
    const fallar = (e) => { error.hidden = false; error.textContent = e.message || String(e); };
    d.addEventListener("close", () => { d.remove(); reingreso = null; resolver(sesion); });
    d.querySelector("button").addEventListener("click", () => d.close());
    d.showModal();
    botonGoogle(d.querySelector(".boton-google"), (s) => { sesion = s; pintarNavSesion(); d.close(); }, fallar).catch(fallar);
  });
  return reingreso;
}

export function rutaBaseAuth() {
  const path = location.pathname.replace(/\\/g, "/");
  if (path.includes("/comunidades/") || path.includes("/editor/")) return config().base || "../";
  return "./";
}

const normalizarEmail = (email) => String(email || "").trim().toLowerCase();

/**
 * La sesión se comparte con el editor (editor/js/nube.js), por eso vive en localStorage. Solo la borra
 * «Salir»: si el token vence, el servidor lo rechaza y llamarApi pide volver a entrar sin cerrar nada.
 */
export function sesionActual() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION));
    if (!s || !s.email || !s.rol) return null;
    return s;
  } catch (_) {
    return null;
  }
}

function guardarSesion(sesion) {
  localStorage.setItem(CLAVE_SESION, JSON.stringify({ ...sesion, desde: Date.now() }));
}

function clavesDeSesion() {
  const claves = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === "montecarmelo.sesion" || (k && k.startsWith(PREFIJO_SESION))) claves.push(k);
    }
  } catch (_) { /* sin almacenamiento */ }
  return claves;
}

/** «Salir» cierra la cuenta en todas las parroquias de este equipo. */
export function cerrarSesion() {
  for (const k of clavesDeSesion()) localStorage.removeItem(k);
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
}

/**
 * Primera vez en esta parroquia con la cuenta abierta en otra: con Google se pide el rol que tiene acá (con el mismo
 * token); quien entró solo con el correo queda anotado como invitado de esta parroquia. Si tiene permisos, la página
 * se vuelve a cargar para mostrarlos.
 */
let traida = null;
export function traerSesionDeOtraParroquia() {
  if (traida) return traida;
  traida = (async () => {
    if (sesionActual() || !usaBackend()) return null;
    let otra = null;
    for (const k of clavesDeSesion()) {
      try {
        const s = JSON.parse(localStorage.getItem(k));
        if (s && s.email && (!otra || (s.token && !otra.token) || (!!s.token === !!otra.token && (s.desde || 0) > (otra.desde || 0)))) otra = s;
      } catch (_) { /* clave dañada */ }
    }
    if (!otra) return null;
    if (otra.token) {
      const r = await llamarApi("sesion", { token: otra.token, entrada: true }, { reingreso: false });
      guardarSesion({ ...r.sesion, token: r.token || otra.token });
      pintarNavSesion();
      if (r.sesion && r.sesion.rol !== "visitante") location.reload();
      return sesionActual();
    }
    const v = await entrarVisitante(otra.email, otra.nombre);
    pintarNavSesion();
    return v.sesion;
  })().catch(() => null);
  return traida;
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

/** Registra los privilegios y devuelve el texto de la invitación (para WhatsApp o copiarlo). */
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
    { slug: "parroquia", nombre: (PARROQUIA.nombreCorto || "Parroquia") + " (todas las comunidades)" },
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
  mantenerSesionViva();
  traerSesionDeOtraParroquia();
}
