/**
 * sumar.js — Alta mínima de una parroquia o movimiento (/sumar).
 *
 * Solo el nombre (y un slug propuesto) + «Entrar con Google»: crea la parroquia
 * publicada al tiro, deja al usuario como responsable y lo manda al reproductor.
 */

const $ = (s) => document.querySelector(s);
const SITIO = "https://www.cancioneroliturgico.cl/";
const API = location.origin + "/api";
const CORREO = "cancionerolitugico@gmail.com";
const CLIENT_ID = "446127505219-pei616euh78muqr6ak500br0ac41t2mk.apps.googleusercontent.com";
const GUARDADO = "mc-sumar";

let slugOk = false;
let slugTocado = false;

function error(texto) {
  const e = $("#su-error");
  e.textContent = texto || "";
  e.hidden = !texto;
  if (texto) e.scrollIntoView({ behavior: "smooth", block: "center" });
}

const PALABRAS_FUERA = new Set(["parroquia", "de", "del", "la", "las", "los", "el", "y", "movimiento", "comunidad"]);
function proponerSlug() {
  const partes = $("#su-nombre").value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w && !PALABRAS_FUERA.has(w));
  return partes.join("-").slice(0, 40).replace(/-+$/, "");
}

let revision = 0, temporizador = 0;
function revisarSlug() {
  const campo = $("#su-slug");
  campo.value = campo.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "").slice(0, 40);
  const s = campo.value.replace(/-+$/, "");
  const estado = $("#su-slug-estado");
  slugOk = false;
  clearTimeout(temporizador);
  if (!s) { estado.textContent = ""; estado.className = "su-estado"; return; }
  estado.textContent = "Revisando…";
  estado.className = "su-estado";
  const n = ++revision;
  temporizador = setTimeout(async () => {
    try {
      const r = await (await fetch(API + "?" + new URLSearchParams({ accion: "slugDisponible", slug: s }))).json();
      if (n !== revision) return;
      slugOk = !!r.disponible;
      estado.textContent = r.disponible ? "✓ Disponible: " + SITIO.replace("https://", "") + s : "✗ " + (r.motivo || "No disponible");
      estado.className = "su-estado " + (r.disponible ? "ok" : "mal");
    } catch (_) {
      if (n === revision) estado.textContent = "No se pudo revisar (¿sin internet?).";
    }
  }, 400);
}

let gsi = null;
function cargarGsi() {
  gsi ||= new Promise((ok, mal) => {
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.onload = ok;
    sc.onerror = () => { gsi = null; mal(new Error("No se pudo cargar el botón de Google. Revisa tu conexión.")); };
    document.head.append(sc);
  });
  return gsi;
}

async function armarGoogle() {
  const caja = $("#su-google");
  if (caja.dataset.listo) return;
  try {
    await cargarGsi();
    google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => enviar(r.credential), ux_mode: "popup" });
    google.accounts.id.renderButton(caja, { theme: "filled_blue", size: "large", text: "continue_with", shape: "pill", locale: "es" });
    caja.dataset.listo = "1";
  } catch (e) {
    error(e.message);
  }
}

function solicitud() {
  return {
    nombre: $("#su-nombre").value.trim(),
    slug: $("#su-slug").value.replace(/-+$/, "")
  };
}

async function enviar(credential) {
  const s = solicitud();
  const estado = $("#su-enviando");
  if (!s.nombre) return error("Escribe el nombre de la parroquia o del movimiento.");
  if (!s.slug) return error("Elige la dirección (se propone sola al escribir el nombre).");
  if (!slugOk) return error("Esa dirección no está disponible: prueba con otra.");
  error("");
  estado.textContent = "Creando tu espacio en el Cancionero…";
  let r;
  try {
    r = await (await fetch(API, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ accion: "solicitarParroquia", credential, solicitud: s })
    })).json();
  } catch (_) {
    estado.textContent = "";
    return error("No se pudo conectar. Revisa tu internet y vuelve a tocar el botón de Google.");
  }
  if (!r.ok) {
    estado.textContent = "";
    return error(r.error || "No se pudo crear. Prueba de nuevo.");
  }
  try {
    localStorage.setItem("mc-sesion:" + r.slug, JSON.stringify({ ...r.sesion, token: r.token, desde: Date.now() }));
    localStorage.setItem("mc-parroquia", r.slug);
    localStorage.setItem("mc-bienvenida", "1");
    localStorage.removeItem(GUARDADO);
  } catch (_) { /* sin almacenamiento */ }
  avisarCancionero(s, r);
  estado.textContent = "Listo. Entrando al cancionero…";
  location.replace("/" + r.slug + "/");
}

function avisarCancionero(s, r) {
  fetch("https://formsubmit.co/ajax/" + CORREO, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      _subject: "Nueva parroquia: " + s.nombre,
      _template: "table",
      Nombre: s.nombre,
      Enlace: SITIO + r.slug + "/",
      Correo: (r.sesion || {}).email || "",
      Revisar: SITIO + "montecarmelo/login (Parroquias → Configurar)"
    })
  }).catch(() => {});
}

function guardarBorrador() {
  try {
    localStorage.setItem(GUARDADO, JSON.stringify({ ...solicitud(), slugTocado }));
  } catch (_) { /* sin almacenamiento */ }
}

function recuperar() {
  let b = {};
  try { b = JSON.parse(localStorage.getItem(GUARDADO) || "{}") || {}; } catch (_) { /* */ }
  if (!b.nombre) return;
  $("#su-nombre").value = b.nombre || "";
  $("#su-slug").value = b.slug || "";
  slugTocado = !!b.slugTocado;
  if (b.slug) revisarSlug();
}

function conectar() {
  $(".nav-toggle").addEventListener("click", () => $(".nav-links").classList.toggle("abierto"));
  const proponer = () => {
    if (slugTocado) return;
    $("#su-slug").value = proponerSlug();
    revisarSlug();
    guardarBorrador();
  };
  $("#su-nombre").addEventListener("input", proponer);
  $("#su-slug").addEventListener("input", () => { slugTocado = !!$("#su-slug").value; revisarSlug(); guardarBorrador(); });
}

conectar();
recuperar();
armarGoogle();
