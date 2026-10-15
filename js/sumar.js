/**
 * sumar.js — Asistente para sumar una parroquia o un movimiento (/sumar).
 *
 * 1 tipo, nombre, diócesis, comuna y dirección (se revisa al escribirla) · 2 dónde (mapa) y una foto ·
 * 3 capillas o grupos · 4 responsable: nombre, cargo, WhatsApp y «Entrar con Google», que crea la parroquia
 * oculta y en revisión (solicitarParroquia) y deja la sesión abierta · 5 listo, con el código para su sitio web.
 * Al terminar se avisa al Cancionero por FormSubmit para revisarla y darle la bienvenida.
 */

import { elegirUbicacion } from "./mapa.js";
import { fotoLiviana } from "./ficha-parroquia.js";

const $ = (s) => document.querySelector(s);
const SITIO = "https://www.cancioneroliturgico.cl/";
const API = location.origin + "/api";
const CORREO = "cancionerolitugico@gmail.com";
const CLIENT_ID = "446127505219-pei616euh78muqr6ak500br0ac41t2mk.apps.googleusercontent.com";
const CLASES = { capilla: "Capilla", comunidad: "Comunidad", grupo: "Grupo" };
const GUARDADO = "mc-sumar";

let paso = 1;
let ubic = null;
let foto = null;
let coms = [];
let slugOk = false;
let slugTocado = false;
let creada = null;

const tipo = () => (document.querySelector("input[name=tipo]:checked") || {}).value || "parroquia";

function error(texto) {
  const e = $("#su-error");
  e.textContent = texto || "";
  e.hidden = !texto;
  if (texto) e.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ==================== LA DIRECCIÓN ====================

const PALABRAS_FUERA = new Set(["parroquia", "de", "del", "la", "las", "los", "el", "y", "movimiento", "comunidad"]);
function proponerSlug() {
  const partes = $("#su-nombre").value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w && !PALABRAS_FUERA.has(w));
  const comuna = $("#su-comuna").value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let s = partes.join("-").slice(0, 30);
  if (comuna && s && !s.includes(comuna)) s = (s + "-" + comuna).slice(0, 40);
  return s.replace(/-+$/, "");
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

// ==================== CAPILLAS ====================

function pintarComs() {
  $("#su-coms").innerHTML = "";
  coms.forEach((c, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span><strong></strong> <small></small></span><button type="button" class="btn-chico">Quitar</button>`;
    li.querySelector("strong").textContent = c.nombre;
    li.querySelector("small").textContent = CLASES[c.clase];
    li.querySelector("button").addEventListener("click", () => { coms.splice(i, 1); pintarComs(); });
    $("#su-coms").append(li);
  });
  if (!coms.length) $("#su-coms").innerHTML = '<li class="su-vacio">Todavía ninguna (puedes seguir sin agregar).</li>';
}

function agregarCom() {
  const nombre = $("#su-com-nombre").value.trim();
  if (!nombre) return $("#su-com-nombre").focus();
  coms.push({ nombre, clase: $("#su-com-clase").value });
  $("#su-com-nombre").value = "";
  $("#su-com-nombre").focus();
  pintarComs();
}

// ==================== PASOS ====================

function validar(n) {
  if (n === 1) {
    if (!$("#su-nombre").value.trim()) return "Escribe el nombre.";
    if (!$("#su-comuna").value.trim()) return "Escribe la comuna.";
    if (!$("#su-slug").value.trim()) return "Elige la dirección.";
    if (!slugOk) return "Esa dirección no está disponible: prueba con otra (por ejemplo agregando la comuna).";
  }
  if (n === 2 && tipo() === "parroquia" && !(ubic && ubic.valor().lat != null)) {
    return "Marca el templo en el mapa: busca la dirección o toca el lugar.";
  }
  return "";
}

function irA(n) {
  paso = n;
  document.querySelectorAll(".su-paso").forEach((s) => (s.hidden = +s.dataset.paso !== n));
  document.querySelectorAll("#su-progreso li").forEach((li) => {
    li.classList.toggle("hecho", +li.dataset.paso < n);
    li.toggleAttribute("aria-current", +li.dataset.paso === n);
  });
  $("#su-atras").hidden = n === 1 || n >= 5;
  $("#su-seguir").hidden = n >= 4;
  $("#su-seguir").textContent = n === 3 ? (coms.length ? "Seguir" : "Seguir sin agregar") : "Seguir";
  error("");
  if (n === 2) armarMapa();
  if (n === 4) armarGoogle();
  window.scrollTo({ top: 0, behavior: "smooth" });
  guardarBorrador();
}

async function armarMapa() {
  const mov = tipo() === "movimiento";
  $("#su-t2").textContent = mov ? "¿Dónde se reúnen?" : "¿Dónde está?";
  $("#su-donde-ayuda").textContent = mov
    ? "Opcional: el lugar donde se reúnen habitualmente. Si no tienen uno fijo, sigue sin marcarlo."
    : "Busca la dirección del templo y revisa que el punto quede bien: así aparece en el mapa y la encuentran por su comuna.";
  if (ubic) return ubic.medir();
  const b = borrador();
  ubic = await elegirUbicacion($("#su-mapa"), { comuna: $("#su-comuna").value.trim(), ...(b.ubic || {}) }, guardarBorrador);
}

// ==================== GOOGLE Y ENVÍO ====================

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
  const u = ubic ? ubic.valor() : {};
  return {
    tipo: tipo(),
    nombre: $("#su-nombre").value.trim(),
    diocesis: $("#su-diocesis").value.trim(),
    slug: $("#su-slug").value.replace(/-+$/, ""),
    sitioWeb: $("#su-web").value.trim(),
    direccion: u.direccion || "", comuna: u.comuna || $("#su-comuna").value.trim(), region: u.region || "", lat: u.lat ?? null, lng: u.lng ?? null,
    comunidades: coms,
    responsable: { nombre: $("#su-resp-nombre").value.trim(), cargo: $("#su-resp-cargo").value.trim(), telefono: $("#su-resp-tel").value.trim() }
  };
}

async function enviar(credential) {
  const s = solicitud();
  const estado = $("#su-enviando");
  if (s.responsable.telefono.replace(/\D/g, "").length < 8) return error("Escribe tu WhatsApp (con código de país, por ejemplo +56 9 1234 5678) y vuelve a tocar el botón de Google.");
  error("");
  estado.textContent = "Creando " + (s.tipo === "movimiento" ? "el espacio del movimiento" : "la parroquia") + "…";
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
  creada = r;
  // La sesión queda abierta en la parroquia nueva (la misma clave que usa js/auth.js)
  try {
    localStorage.setItem("mc-sesion:" + r.slug, JSON.stringify({ ...r.sesion, token: r.token, desde: Date.now() }));
    localStorage.setItem("mc-parroquia", r.slug);
    localStorage.removeItem(GUARDADO);
  } catch (_) { /* sin almacenamiento */ }
  if (foto) {
    estado.textContent = "Subiendo la foto…";
    try {
      const blob = await fotoLiviana(foto);
      await fetch(location.origin + "/" + r.slug + "/api/subir?" + new URLSearchParams({ tipo: "foto", mime: blob.type }), {
        method: "PUT", headers: { Authorization: "Bearer " + r.token, "Content-Type": blob.type }, body: blob
      });
    } catch (_) { /* la foto se puede subir después */ }
  }
  avisarCancionero(s, r);
  estado.textContent = "";
  listo(s, r);
}

function avisarCancionero(s, r) {
  fetch("https://formsubmit.co/ajax/" + CORREO, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      _subject: "Nueva solicitud: " + s.nombre + " (" + (s.comuna || "sin comuna") + ")",
      _template: "table",
      Tipo: s.tipo, Nombre: s.nombre, Diócesis: s.diocesis, Comuna: s.comuna, Región: s.region, Dirección: s.direccion,
      Enlace: SITIO + r.slug + "/", Responsable: s.responsable.nombre + " (" + s.responsable.cargo + ")",
      WhatsApp: s.responsable.telefono, Correo: (r.sesion || {}).email || "",
      Capillas: s.comunidades.map((c) => c.nombre + " (" + c.clase + ")").join(", ") || "—",
      Revisar: SITIO + "montecarmelo/login (Parroquias → Solicitudes)"
    })
  }).catch(() => {});
}

function listo(s, r) {
  const url = SITIO + r.slug + "/";
  $("#su-listo-texto").textContent = "Ya existe " + url.replace("https://", "") + " y eres su responsable. Mientras la revisamos (te escribimos por WhatsApp), " +
    "puedes armar los cancioneros, subir fotos y sumar a tus comunidades. Cuando la aprobemos aparecerá en el mapa y en los buscadores.";
  $("#su-abrir").href = "/" + r.slug + "/inicio";
  $("#su-compartir").href = "https://wa.me/?text=" + encodeURIComponent("Ya tenemos nuestro cancionero de misa en " + url + " 🎶");
  $("#su-codigo-iframe").textContent = `<iframe src="${url}embebido" title="Cancionero Litúrgico · ${s.nombre}" width="100%" height="640"\n  style="border:0;border-radius:12px" allow="autoplay; fullscreen"></iframe>`;
  $("#su-codigo-boton").textContent = `<a href="${url}" target="_blank" rel="noopener"\n  style="display:inline-block;padding:12px 20px;border-radius:999px;background:#2f4a38;color:#fff;font:600 16px sans-serif;text-decoration:none">\n  🎵 Cancionero de la misa</a>`;
  irA(5);
}

// ==================== BORRADOR ====================
// Lo escrito queda en el equipo hasta terminar (por si se cierra la página a medio camino)

function borrador() {
  try {
    return JSON.parse(localStorage.getItem(GUARDADO) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function guardarBorrador() {
  if (creada) return;
  try {
    const s = solicitud();
    localStorage.setItem(GUARDADO, JSON.stringify({ ...s, slugTocado, ubic: ubic ? ubic.valor() : borrador().ubic }));
  } catch (_) { /* sin almacenamiento */ }
}

function recuperar() {
  const b = borrador();
  if (!b.nombre) return;
  const radio = document.querySelector(`input[name=tipo][value="${b.tipo}"]`);
  if (radio) radio.checked = true;
  $("#su-nombre").value = b.nombre || "";
  $("#su-diocesis").value = b.diocesis || "";
  $("#su-comuna").value = b.comuna || "";
  $("#su-slug").value = b.slug || "";
  $("#su-web").value = b.sitioWeb || "";
  coms = Array.isArray(b.comunidades) ? b.comunidades : [];
  const r = b.responsable || {};
  $("#su-resp-nombre").value = r.nombre || "";
  $("#su-resp-cargo").value = r.cargo || "";
  $("#su-resp-tel").value = r.telefono || "";
  slugTocado = !!b.slugTocado;
  if (b.slug) revisarSlug();
}

// ==================== INICIO ====================

function cambioTipo() {
  const mov = tipo() === "movimiento";
  $("#su-nombre-et").textContent = mov ? "Nombre del movimiento o comunidad" : "Nombre de la parroquia";
  $("#su-nombre").placeholder = mov ? "Movimiento Apostólico de Schoenstatt · Rama juvenil" : "Parroquia Santo Domingo de Guzmán";
}

function conectar() {
  $(".nav-toggle").addEventListener("click", () => $(".nav-links").classList.toggle("abierto"));
  document.querySelectorAll("input[name=tipo]").forEach((r) => r.addEventListener("change", () => { cambioTipo(); guardarBorrador(); }));
  const proponer = () => {
    if (slugTocado) return;
    $("#su-slug").value = proponerSlug();
    revisarSlug();
  };
  $("#su-nombre").addEventListener("input", proponer);
  $("#su-comuna").addEventListener("input", proponer);
  $("#su-slug").addEventListener("input", () => { slugTocado = !!$("#su-slug").value; revisarSlug(); });
  document.querySelectorAll(".su-paso input").forEach((i) => i.addEventListener("change", guardarBorrador));
  $("#su-foto").addEventListener("change", () => {
    foto = $("#su-foto").files[0] || null;
    const v = $("#su-foto-vista");
    v.hidden = !foto;
    if (foto) v.src = URL.createObjectURL(foto);
  });
  $("#su-com-agregar").addEventListener("click", agregarCom);
  $("#su-com-nombre").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); agregarCom(); } });
  $("#su-seguir").addEventListener("click", () => {
    const e = validar(paso);
    if (e) return error(e);
    irA(paso + 1);
  });
  $("#su-atras").addEventListener("click", () => irA(paso - 1));
  document.querySelectorAll("[data-copiar]").forEach((b) => b.addEventListener("click", () => {
    const t = document.getElementById(b.dataset.copiar).textContent;
    navigator.clipboard?.writeText(t).then(() => { b.textContent = "Copiado ✓"; setTimeout(() => (b.textContent = b.dataset.copiar.includes("iframe") ? "Copiar el recuadro" : "Copiar el botón"), 2000); });
  }));
}

conectar();
recuperar();
cambioTipo();
pintarComs();
irA(1);
