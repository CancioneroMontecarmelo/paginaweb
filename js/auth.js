/**
 * auth.js — Autenticación parroquial Monte Carmelo
 *
 * Roles:
 *  - admin_general  → Marcos Mora Vitta (otorga permisos)
 *  - admin_segundo  → segundo responsable del sitio
 *  - sacerdote      → párroco
 *  - admin          → administrador de una comunidad
 *  - editor         → editor de noticias/cancioneros
 *  - colaborador    → colaborador autorizado
 *
 * Contraseñas: SHA-256(salt + clave) — nunca se guarda la clave en claro.
 * Con apiUrl en config.js todo pasa por el Apps Script (backend/Code.gs): usuarios, solicitudes y
 * auditoría quedan en el Drive de la parroquia y la sesión lleva un token firmado.
 * Sin apiUrl (modo local de prueba): localStorage + semilla usuarios.json.
 */

import "./config.js";
import { COMUNIDADES } from "./comunidades.js";

export const SALT = "montecarmelo-v1";
export const CORREO_PARROQUIA = "cancionerolitugico@gmail.com";

const CLAVE_SESION = "montecarmelo.sesion";
const CLAVE_USUARIOS = "montecarmelo.usuarios.v2";
const CLAVE_SOLICITUDES = "montecarmelo.solicitudes.v1";
const CLAVE_AUDITORIA = "montecarmelo.auditoria.v1";
const CLAVE_CODIGOS = "montecarmelo.codigos.v1";

const HASH_MARCOS =
  "b35c972e25b1cb54b3ce4e281f7356d6f9b65da4a1f975b8d8ad041dc1774c3d";

/** Semilla fija del administrador general (Marcos Mora Vitta). */
export const ADMIN_GENERAL_SEED = {
  id: "u-marcos",
  usuario: "marcos.mora",
  nombres: "Marcos",
  apellidos: "Mora Vitta",
  nombre: "Marcos Mora Vitta",
  email: CORREO_PARROQUIA,
  rol: "admin_general",
  comunidad: "parroquia",
  hash: HASH_MARCOS,
  activo: true,
  debeCambiarClave: false,
  creado: "2026-08-21T00:00:00.000Z"
};

let cacheBase = null;

const apiUrl = () => (window.MONTECARMELO_CONFIG || {}).apiUrl || "";
export const usaBackend = () => !!apiUrl();

export async function llamarApi(accion, datos) {
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

export async function sha256Hex(texto) {
  const data = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashClave(clave) {
  return sha256Hex(SALT + String(clave || ""));
}

// Las claves temporales del servidor son minúsculas sin espacios
function hashTemporal(clave) {
  return hashClave(String(clave || "").replace(/\s+/g, "").toLowerCase());
}

function leerLS(clave, fallback) {
  try {
    const raw = localStorage.getItem(clave);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function escribirLS(clave, valor) {
  localStorage.setItem(clave, JSON.stringify(valor));
}

async function cargarSemillaJson() {
  if (cacheBase) return cacheBase;
  try {
    const res = await fetch(rutaBaseAuth() + "usuarios.json", { cache: "no-store" });
    if (!res.ok) throw new Error("sin json");
    const data = await res.json();
    cacheBase = Array.isArray(data.usuarios) ? data.usuarios : [];
  } catch (_) {
    cacheBase = [];
  }
  return cacheBase;
}

function normalizarEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function slugUsuario(nombres, apellidos) {
  const base = (String(nombres || "") + "." + String(apellidos || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  return base || "usuario." + Date.now().toString(36);
}

function codigo6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function claveTemporal() {
  const a = Math.random().toString(36).slice(2, 6);
  const b = Math.floor(1000 + Math.random() * 9000);
  return "Mc" + a + b;
}

/** Lista unificada: Marcos + JSON + localStorage (local gana por email). */
export async function listarUsuarios() {
  if (usaBackend()) return (await llamarApi("listarUsuarios", { token: token() })).usuarios;
  const base = await cargarSemillaJson();
  const local = leerLS(CLAVE_USUARIOS, []);
  const mapa = new Map();
  mapa.set(normalizarEmail(ADMIN_GENERAL_SEED.email), { ...ADMIN_GENERAL_SEED });
  for (const u of base) {
    const email = normalizarEmail(u.email || u.correo || u.usuario);
    if (!email) continue;
    mapa.set(email, {
      ...u,
      email,
      nombre: u.nombre || [u.nombres, u.apellidos].filter(Boolean).join(" "),
      activo: u.activo !== false
    });
  }
  for (const u of local) {
    const email = normalizarEmail(u.email);
    if (!email) continue;
    const prev = mapa.get(email) || {};
    mapa.set(email, {
      ...prev,
      ...u,
      email,
      activo: u.activo !== false,
      nombre: u.nombre || [u.nombres, u.apellidos].filter(Boolean).join(" ") || prev.nombre
    });
  }
  // Garantizar identidad de Marcos, respetando hash local si cambió la clave
  const marcosEmail = normalizarEmail(ADMIN_GENERAL_SEED.email);
  const marcosLocal = local.find((u) => normalizarEmail(u.email) === marcosEmail);
  mapa.set(marcosEmail, {
    ...ADMIN_GENERAL_SEED,
    ...(marcosLocal || {}),
    rol: "admin_general",
    email: ADMIN_GENERAL_SEED.email,
    nombres: "Marcos",
    apellidos: "Mora Vitta",
    nombre: "Marcos Mora Vitta",
    activo: true
  });
  return Array.from(mapa.values());
}

function guardarUsuariosLocal(lista) {
  // Persistir todos los usuarios del mapa local (incluye override de Marcos si cambió la clave)
  const limpios = (lista || []).map((u) => ({
    id: u.id,
    usuario: u.usuario,
    nombres: u.nombres,
    apellidos: u.apellidos,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    comunidad: u.comunidad,
    hash: u.hash,
    activo: u.activo !== false,
    debeCambiarClave: !!u.debeCambiarClave,
    creado: u.creado,
    aceptadoPor: u.aceptadoPor,
    baja: u.baja,
    motivoBaja: u.motivoBaja,
    bajaPor: u.bajaPor
  }));
  escribirLS(CLAVE_USUARIOS, limpios);
}

export function registrarAuditoria(evento) {
  const log = leerLS(CLAVE_AUDITORIA, []);
  log.unshift({
    id: "a-" + Date.now(),
    cuando: new Date().toISOString(),
    ...evento
  });
  escribirLS(CLAVE_AUDITORIA, log.slice(0, 500));
}

export async function leerAuditoria(limite) {
  if (usaBackend()) return (await llamarApi("auditoria", { token: token(), limite: limite || 50 })).auditoria;
  const log = leerLS(CLAVE_AUDITORIA, []);
  return typeof limite === "number" ? log.slice(0, limite) : log;
}

/** La sesión se comparte con el editor (editor/js/nube.js), por eso vive en localStorage. */
export function sesionActual() {
  try {
    const raw = localStorage.getItem(CLAVE_SESION);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.email || !s.rol) return null;
    if (usaBackend() && !tokenVigente(s.token)) {
      localStorage.removeItem(CLAVE_SESION);
      return null;
    }
    return s;
  } catch (_) {
    return null;
  }
}

export function guardarSesion(sesion) {
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
}

export function cerrarSesion() {
  const s = sesionActual();
  if (s && !usaBackend()) {
    registrarAuditoria({
      tipo: "salida",
      email: s.email,
      nombre: s.nombre,
      rol: s.rol
    });
  }
  localStorage.removeItem(CLAVE_SESION);
}

export function esResponsableSitio(s) {
  s = s || sesionActual();
  return !!s && (s.rol === "admin_general" || s.rol === "admin_segundo");
}

export function esAdminVerificador(s) {
  s = s || sesionActual();
  if (!s) return false;
  return (
    s.rol === "admin_general" ||
    s.rol === "admin_segundo" ||
    s.rol === "sacerdote" ||
    s.rol === "admin"
  );
}

export function puedeEditar(comunidadSlug) {
  const s = sesionActual();
  if (!s || s.activo === false) return false;
  if (esResponsableSitio(s) || s.rol === "sacerdote") return true;
  if (!comunidadSlug) return ["admin", "editor", "colaborador"].includes(s.rol);
  if (s.comunidad === "parroquia") return true;
  return s.comunidad === comunidadSlug;
}

/**
 * Login: nombre, apellido, correo y clave.
 * También acepta solo correo + clave.
 */
export async function iniciarSesion({ nombres, apellidos, email, clave }) {
  const correo = normalizarEmail(email);
  const hash = await hashClave(clave);
  if (usaBackend()) {
    const r = await llamarApi("login", { email: correo, hash, hashTemporal: await hashTemporal(clave), nombres, apellidos });
    const sesion = { ...r.sesion, token: r.token, desde: Date.now() };
    guardarSesion(sesion);
    return sesion;
  }
  const lista = await listarUsuarios();
  let encontrado = lista.find((u) => normalizarEmail(u.email) === correo && u.hash === hash);

  if (!encontrado && nombres && apellidos) {
    const nom = String(nombres).trim().toLowerCase();
    const ape = String(apellidos).trim().toLowerCase();
    encontrado = lista.find((u) => {
      if (u.hash !== hash) return false;
      if (normalizarEmail(u.email) !== correo) return false;
      const un = String(u.nombres || "").trim().toLowerCase();
      const ua = String(u.apellidos || "").trim().toLowerCase();
      if (un && ua) return un === nom && ua === ape;
      return true;
    });
  }

  if (!encontrado) {
    registrarAuditoria({
      tipo: "login_fallido",
      email: correo,
      nombres,
      apellidos
    });
    const err = new Error("Datos incorrectos. Revisá nombre, apellido, correo y clave.");
    err.codigo = "credenciales";
    throw err;
  }

  if (encontrado.activo === false) {
    registrarAuditoria({ tipo: "login_baja", email: correo, nombre: encontrado.nombre });
    const err = new Error("Esta cuenta está dada de baja. Contactá a la parroquia.");
    err.codigo = "baja";
    throw err;
  }

  const sesion = {
    id: encontrado.id,
    usuario: encontrado.usuario,
    email: encontrado.email,
    nombres: encontrado.nombres || nombres || "",
    apellidos: encontrado.apellidos || apellidos || "",
    nombre: encontrado.nombre || [encontrado.nombres, encontrado.apellidos].filter(Boolean).join(" "),
    rol: encontrado.rol,
    comunidad: encontrado.comunidad,
    debeCambiarClave: !!encontrado.debeCambiarClave,
    activo: true,
    desde: Date.now()
  };
  guardarSesion(sesion);
  registrarAuditoria({
    tipo: "entrada",
    email: sesion.email,
    nombre: sesion.nombre,
    rol: sesion.rol,
    comunidad: sesion.comunidad
  });
  return sesion;
}

/** «¿Primera vez u olvidaste tu clave?»: el servidor envía una clave temporal por correo. */
export async function recuperarClave(email) {
  if (!usaBackend()) {
    throw new Error("La recuperación por correo necesita el servidor de la parroquia (apiUrl en js/config.js).");
  }
  await llamarApi("recuperarClave", { email: normalizarEmail(email) });
}

/** Alta directa por un responsable: crea la cuenta y envía la clave temporal por correo. */
export async function crearUsuario(datos) {
  if (!esResponsableSitio()) throw new Error("Solo el administrador general o el segundo responsable pueden crear usuarios.");
  if (!usaBackend()) throw new Error("Crear usuarios necesita el servidor de la parroquia (apiUrl en js/config.js).");
  return llamarApi("crearUsuario", { token: token(), ...datos, email: normalizarEmail(datos.email) });
}

export function listarSolicitudes() {
  if (usaBackend()) {
    return llamarApi("listarSolicitudes", { token: token() }).then((r) =>
      r.solicitudes.sort((a, b) => String(b.creado || "").localeCompare(String(a.creado || "")))
    );
  }
  return leerLS(CLAVE_SOLICITUDES, []).sort((a, b) =>
    String(b.creado || "").localeCompare(String(a.creado || ""))
  );
}

function guardarSolicitudes(lista) {
  escribirLS(CLAVE_SOLICITUDES, lista);
}

/**
 * Solicitud para ser administrador / colaborador.
 * Genera código de 6 dígitos para verificación por responsables.
 */
export async function solicitarAcceso(datos) {
  const email = normalizarEmail(datos.email);
  if (!email || !email.includes("@")) {
    throw new Error("Indicá un correo electrónico válido");
  }
  const nombres = String(datos.nombres || "").trim();
  const apellidos = String(datos.apellidos || "").trim();
  if (!nombres || !apellidos) throw new Error("Indicá nombres y apellidos");
  const comunidad = String(datos.comunidad || "").trim();
  if (!comunidad) throw new Error("Elegí la comunidad");
  const rolPedido = datos.rolPedido === "sacerdote" ? "sacerdote" : datos.rolPedido === "editor" ? "editor" : "admin";

  if (usaBackend()) {
    const r = await llamarApi("solicitarAcceso", { ...datos, email, nombres, apellidos, comunidad, rolPedido });
    return { solicitud: r.solicitud, codigo: null, correoParroquia: CORREO_PARROQUIA };
  }

  const existentes = await listarUsuarios();
  if (existentes.some((u) => normalizarEmail(u.email) === email && u.activo !== false)) {
    throw new Error("Ese correo ya está registrado. Iniciá sesión o pedí recuperación al admin general.");
  }

  const codigo = codigo6();
  const codigoHash = await hashClave(codigo);
  const solicitud = {
    id: "sol-" + Date.now(),
    nombres,
    apellidos,
    nombre: nombres + " " + apellidos,
    email,
    comunidad,
    rolPedido,
    motivo: String(datos.motivo || "").trim(),
    codigoHash,
    codigoPlanoTemp: codigo,
    estado: "pendiente",
    creado: new Date().toISOString()
  };

  const lista = listarSolicitudes();
  lista.unshift(solicitud);
  guardarSolicitudes(lista);

  const codigos = leerLS(CLAVE_CODIGOS, {});
  codigos[solicitud.id] = { codigo, expira: Date.now() + 7 * 24 * 3600 * 1000 };
  escribirLS(CLAVE_CODIGOS, codigos);

  registrarAuditoria({
    tipo: "solicitud",
    email,
    nombre: solicitud.nombre,
    comunidad,
    rolPedido
  });

  return {
    solicitud: { ...solicitud, codigoPlanoTemp: undefined },
    codigo,
    correoParroquia: CORREO_PARROQUIA
  };
}

export function obtenerCodigoSolicitud(id) {
  if (usaBackend()) return null;
  const bag = leerLS(CLAVE_CODIGOS, {});
  const item = bag[id];
  if (!item || (item.expira && item.expira < Date.now())) return null;
  return item.codigo || null;
}

/**
 * Aceptar solicitud (solo admin_general o admin_segundo).
 * Verifica el código de 6 dígitos. Asigna clave temporal.
 */
export async function aceptarSolicitud(idSolicitud, codigoIngresado, opts) {
  opts = opts || {};
  if (!esResponsableSitio()) {
    throw new Error("Solo el administrador general o el segundo responsable pueden aceptar.");
  }
  if (usaBackend()) {
    return llamarApi("aceptarSolicitud", {
      token: token(),
      id: idSolicitud,
      codigo: String(codigoIngresado || "").trim(),
      rol: opts.rol
    });
  }
  const lista = listarSolicitudes();
  const sol = lista.find((s) => s.id === idSolicitud);
  if (!sol || sol.estado !== "pendiente") throw new Error("Solicitud no encontrada o ya resuelta");

  const codigoOk = obtenerCodigoSolicitud(idSolicitud);
  const hashIn = await hashClave(String(codigoIngresado || "").trim());
  if (!codigoOk || (String(codigoIngresado).trim() !== codigoOk && hashIn !== sol.codigoHash)) {
    throw new Error("Código de verificación incorrecto");
  }

  const temp = claveTemporal();
  const hash = await hashClave(temp);
  const rol =
    opts.rol ||
    (sol.rolPedido === "sacerdote"
      ? "sacerdote"
      : sol.rolPedido === "editor"
        ? "editor"
        : "admin");

  const usuario = {
    id: "u-" + Date.now(),
    usuario: slugUsuario(sol.nombres, sol.apellidos),
    nombres: sol.nombres,
    apellidos: sol.apellidos,
    nombre: sol.nombre,
    email: sol.email,
    rol,
    comunidad: sol.comunidad,
    hash,
    activo: true,
    debeCambiarClave: true,
    creado: new Date().toISOString(),
    aceptadoPor: sesionActual().email
  };

  const usuarios = await listarUsuarios();
  usuarios.push(usuario);
  guardarUsuariosLocal(usuarios);

  sol.estado = "aceptada";
  sol.resuelto = new Date().toISOString();
  sol.resueltoPor = sesionActual().email;
  delete sol.codigoPlanoTemp;
  guardarSolicitudes(lista);

  const bag = leerLS(CLAVE_CODIGOS, {});
  delete bag[idSolicitud];
  escribirLS(CLAVE_CODIGOS, bag);

  registrarAuditoria({
    tipo: "aceptacion",
    email: usuario.email,
    nombre: usuario.nombre,
    rol: usuario.rol,
    comunidad: usuario.comunidad,
    por: sesionActual().email
  });

  return { usuario, claveTemporal: temp };
}

export async function rechazarSolicitud(idSolicitud, motivo) {
  if (!esResponsableSitio()) throw new Error("Sin permiso");
  if (usaBackend()) return llamarApi("rechazarSolicitud", { token: token(), id: idSolicitud, motivo });
  const lista = listarSolicitudes();
  const sol = lista.find((s) => s.id === idSolicitud);
  if (!sol || sol.estado !== "pendiente") throw new Error("Solicitud no encontrada");
  sol.estado = "rechazada";
  sol.motivoRechazo = String(motivo || "").trim();
  sol.resuelto = new Date().toISOString();
  sol.resueltoPor = sesionActual().email;
  guardarSolicitudes(lista);
  registrarAuditoria({
    tipo: "rechazo",
    email: sol.email,
    nombre: sol.nombre,
    por: sesionActual().email
  });
  return sol;
}

/**
 * Dar de baja (el mismo usuario puede solicitarlo; responsables lo ejecutan).
 */
export async function darDeBaja(emailObjetivo, motivo) {
  const s = sesionActual();
  if (!s) throw new Error("Sin sesión");
  const email = normalizarEmail(emailObjetivo);
  const propio = email === normalizarEmail(s.email);
  if (!propio && !esResponsableSitio() && !(s.rol === "admin" || s.rol === "sacerdote")) {
    throw new Error("Sin permiso para dar de baja");
  }
  if (email === normalizarEmail(ADMIN_GENERAL_SEED.email) && !propio) {
    throw new Error("No se puede dar de baja al administrador general desde otra cuenta");
  }
  if (usaBackend()) return (await llamarApi("darDeBaja", { token: token(), email, motivo })).usuario;

  const usuarios = await listarUsuarios();
  const u = usuarios.find((x) => normalizarEmail(x.email) === email);
  if (!u) throw new Error("Usuario no encontrado");
  u.activo = false;
  u.baja = new Date().toISOString();
  u.motivoBaja = String(motivo || "").trim();
  u.bajaPor = s.email;
  guardarUsuariosLocal(usuarios);

  registrarAuditoria({
    tipo: "baja",
    email: u.email,
    nombre: u.nombre,
    por: s.email,
    motivo: u.motivoBaja
  });
  return u;
}

/** Nombrar segundo administrador del sitio (solo admin_general). */
export async function nombrarSegundoAdmin(emailObjetivo) {
  const s = sesionActual();
  if (!s || s.rol !== "admin_general") {
    throw new Error("Solo el administrador general puede nombrar al segundo responsable");
  }
  const email = normalizarEmail(emailObjetivo);
  if (usaBackend()) return (await llamarApi("nombrarSegundo", { token: token(), email })).usuario;
  const usuarios = await listarUsuarios();
  const u = usuarios.find((x) => normalizarEmail(x.email) === email && x.activo !== false);
  if (!u) throw new Error("Usuario no encontrado o inactivo");
  // Quitar segundo anterior
  for (const x of usuarios) {
    if (x.rol === "admin_segundo") x.rol = "admin";
  }
  u.rol = "admin_segundo";
  u.comunidad = u.comunidad || "parroquia";
  guardarUsuariosLocal(usuarios);
  registrarAuditoria({
    tipo: "nombrar_segundo",
    email: u.email,
    nombre: u.nombre,
    por: s.email
  });
  return u;
}

export async function cambiarClavePropia(claveActual, claveNueva) {
  const s = sesionActual();
  if (!s) throw new Error("Sin sesión");
  if (String(claveNueva || "").length < 8) {
    throw new Error("La nueva clave debe tener al menos 8 caracteres");
  }
  if (usaBackend()) {
    const r = await llamarApi("cambiarClave", {
      token: s.token,
      hashActual: await hashClave(claveActual),
      hashTemporal: await hashTemporal(claveActual),
      hashNuevo: await hashClave(claveNueva)
    });
    guardarSesion({ ...s, ...r.sesion, token: s.token });
    return true;
  }
  const usuarios = await listarUsuarios();
  const email = normalizarEmail(s.email);
  let u = usuarios.find((x) => normalizarEmail(x.email) === email);
  if (!u) throw new Error("Usuario no encontrado");
  const hashAct = await hashClave(claveActual);
  if (u.hash !== hashAct) throw new Error("Clave actual incorrecta");
  u = { ...u, hash: await hashClave(claveNueva), debeCambiarClave: false };
  const resto = usuarios.filter((x) => normalizarEmail(x.email) !== email);
  // Incluir Marcos en local si cambió su clave
  guardarUsuariosLocal([...resto, u]);
  s.debeCambiarClave = false;
  guardarSesion(s);
  registrarAuditoria({ tipo: "cambio_clave", email: s.email, nombre: s.nombre });
  return true;
}

export function comunidadesOpciones() {
  return [
    { slug: "parroquia", nombre: "Parroquia (general) / Sacerdote" },
    ...COMUNIDADES.map((c) => ({ slug: c.slug, nombre: c.nombre }))
  ];
}

export function exportarUsuariosJson(usuarios) {
  return {
    salt: SALT,
    correoParroquia: CORREO_PARROQUIA,
    actualizado: new Date().toISOString(),
    ayuda:
      "Hashes SHA-256(salt+clave). Admin general: Marcos Mora Vitta. No guardar claves en claro.",
    usuarios: (usuarios || []).map((u) => ({
      id: u.id,
      usuario: u.usuario,
      nombres: u.nombres,
      apellidos: u.apellidos,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      comunidad: u.comunidad,
      hash: u.hash,
      activo: u.activo !== false,
      debeCambiarClave: !!u.debeCambiarClave
    }))
  };
}

export function descargarUsuariosJson() {
  return listarUsuarios().then((lista) => {
    const data = exportarUsuariosJson(lista);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "usuarios.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return data;
  });
}

export function pintarNavSesion(root) {
  const nodo = (root || document).querySelector("[data-nav-sesion]");
  if (!nodo) return;
  const base = rutaBaseAuth();
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
    nodo.href = base + "login.html";
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
