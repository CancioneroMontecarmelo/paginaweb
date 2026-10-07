/**
 * reproductor.js — Reproductor de la Biblioteca (reproductor.html), sin sesión.
 *
 *  - Canciones: buscador de la Biblioteca y «Solo con audio». Tocar una canción la hace sonar (la cola es
 *    lo que se ve en la lista); «+» la agrega a una lista.
 *  - Listas: «Mis listas» en este equipo (localStorage mc-listas: crear, renombrar, ordenar, quitar, borrar)
 *    que se comparten con un enlace #l=… (WhatsApp o Copiar), y los cancioneros de misa (#misa=<id>) con
 *    sus momentos y tonos.
 *  - Reproduciendo: la letra con acordes en el tono del cancionero, créditos, posturas al tocar un acorde,
 *    partituras y «Aprender las voces». Un solo <audio>, que los audios del Drive reciben por accion=audio
 *    del Apps Script (Drive rechaza con 403 el enlace directo pedido desde otra página). Precarga la
 *    siguiente, Media Session (pantalla bloqueada y auriculares)
 *    y Wake Lock (la pantalla no se apaga mientras se lee). Los enlaces de YouTube suenan con el reproductor
 *    de YouTube insertado arriba de la letra (js/youtube-embed.js), manejado con la misma barra; el audio del
 *    Drive va primero y, al terminar un video, no pasa sola a la siguiente.
 *  - En vivo (#vivo=<código>): sigue la canción que elige quien dirige desde Misas, consultando cada 4 s.
 *
 * Usa los scripts clásicos del editor cargados antes (acordes, markdown, etiquetas, buscar, instrumentos,
 * render) más js/misas-shim.js. Todo lo del servidor son lecturas públicas.
 */

import { initNavSitio } from "./auth.js";
import { COMUNIDADES } from "./comunidades.js";
import { activarPosturas, cerrar as cerrarPostura } from "./posturas.js";
import { botonesPartituras } from "./partituras.js";
import { crearMezclador, pistasDeVoces } from "./voces.js";
import { SILENCIO, desbloquear } from "./silencio.js";
import { crearReproductorYT, esYoutube } from "./youtube-embed.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => escapeHtml(s == null ? "" : s);
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
  comunidad: guardado("mc-rp-comunidad", ""),
  vista: "canciones",
  mezclador: null,
  vivo: null
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

function textoCancion(id) {
  if (!st.textos.has(id)) {
    const p = leer({ accion: "cancion", id }).then((r) => ({
      doc: parseMarkdown(r.texto, (r.cancion?.titulo || "cancion") + ".md"), cancion: r.cancion || {}
    }));
    st.textos.set(id, p);
    p.catch(() => st.textos.delete(id));
  }
  return st.textos.get(id);
}

const reproduceWebm = !!audio.canPlayType('audio/webm; codecs="opus"');
let desbloqueado = false;
const MAX_BLOBS = 12;
const blobs = new Map();
function blobDeAudio(fileId) {
  if (blobs.has(fileId)) {
    const p = blobs.get(fileId);
    blobs.delete(fileId);
    blobs.set(fileId, p);
    return p;
  }
  const p = leer({ accion: "audio", id: fileId }).then((r) => {
    if (/webm/i.test(r.mime || r.nombre || "") && !reproduceWebm) {
      throw new Error("este audio todavía está en el formato anterior (WebM), que este equipo no reproduce. Cuando la Biblioteca termine de pasar a .m4a va a sonar.");
    }
    const bytes = Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: r.mime || "audio/mp4" }));
  });
  blobs.set(fileId, p);
  p.catch(() => blobs.delete(fileId));
  // Los más viejos se liberan, salvo el que está sonando
  for (const [id, viejo] of blobs) {
    if (blobs.size <= MAX_BLOBS) break;
    viejo.then((url) => { if (audio.src !== url) URL.revokeObjectURL(url); }, () => {});
    blobs.delete(id);
  }
  return p;
}

const bytesDeAudio = async (fileId) => {
  const r = await leer({ accion: "audio", id: fileId });
  return Uint8Array.from(atob(r.base64), (ch) => ch.charCodeAt(0)).buffer;
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
  document.querySelectorAll(".rp-pestana").forEach((b) => {
    b.classList.toggle("activa", b.dataset.vista === v);
    b.setAttribute("aria-selected", b.dataset.vista === v);
  });
  for (const id of ["canciones", "listas", "sonando", "vivo"]) $("#vista-" + id).hidden = id !== v;
  if (v === "listas") {
    pintarListas();
    if (!st.misas) cargarMisas();
  }
  cerrarPostura();
  pedirPantalla();
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
      <button type="button" class="rp-fila" data-tocar="${esc(c.id)}"><b>${esc(c.titulo)}</b><small>${esc(sub)}</small></button>
      <button type="button" class="rp-mas" data-agregar="${esc(c.id)}" aria-label="Agregar «${esc(c.titulo)}» a una lista" title="Agregar a una lista">+</button>
    </li>`;
  }).join("");
}

async function cargarBiblioteca() {
  try {
    st.biblioteca = (await leer({ accion: "biblioteca" })).canciones || [];
    st.biblioteca.sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), "es"));
    st.porId = new Map(st.biblioteca.map((c) => [c.id, c]));
    $("#rp-estado-bib").textContent = st.biblioteca.length ? "" : "La Biblioteca todavía no tiene canciones.";
  } catch (e) {
    $("#rp-estado-bib").textContent = e.message;
  }
  pintarCanciones();
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
const guardarListas = () => guardar("mc-listas", JSON.stringify(st.listas));

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

function nuevaLista(items = [], nombre) {
  nombre = (nombre ?? prompt("Nombre de la lista:", "Mi lista"))?.trim();
  if (!nombre) return null;
  const usados = new Set(st.listas.map((l) => l.nombre));
  let final = nombre.slice(0, 80);
  for (let n = 2; usados.has(final); n++) final = nombre.slice(0, 74) + " (" + n + ")";
  const l = { id: uid(), nombre: final, items: items.map(({ cancionId, desplazamiento }) => ({ cancionId, desplazamiento: desplazamiento || 0 })) };
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
    st.cola = { nombre: l.nombre, tipo: "lista", items: l.items.map((x) => ({ ...x })) };
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
  agregando = id;
  const c = st.porId.get(id);
  $("#rp-agregar-que").textContent = "«" + (c?.titulo || "Canción") + "»";
  $("#rp-agregar-listas").innerHTML = st.listas.map((l) =>
    `<li><button type="button" class="rp-fila" data-a-lista="${esc(l.id)}"><b>${esc(l.nombre)}</b><small>${l.items.length} ${l.items.length === 1 ? "canción" : "canciones"}${l.items.some((x) => x.cancionId === id) ? " · ya está" : ""}</small></button></li>`
  ).join("") || '<li class="rp-aviso">Todavía no tenés listas.</li>';
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
        <div><b>${esc(m.nombre)}</b><small>${esc([fechaCorta(m.fechaUso), st.comunidad ? "" : comunidad, n + (n === 1 ? " canción" : " canciones")].filter(Boolean).join(" · "))}</small></div>
        <a class="rp-btn rp-btn-fuerte" href="#misa=${esc(encodeURIComponent(m.id))}">▶ Reproducir</a>
      </div>
    </li>`;
  }).join("");
}

function colaDeMisa(m) {
  return {
    nombre: m.nombre || "Cancionero de misa", tipo: "misa",
    items: m.momentos.flatMap((x) => x.canciones.map((c) => ({ cancionId: c.cancionId, desplazamiento: c.desplazamiento || 0, momento: x.momento })))
  };
}

async function abrirMisa(id) {
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
  mostrarVista("sonando");
  reproducir(0);
}

// ============ REPRODUCCIÓN ============

let turno = 0;

// El reproductor de YouTube se crea con el primer video; mientras tiene uno cargado, la barra lo maneja a él
let yt = null;
const reproductorYT = () => yt || (yt = crearReproductorYT($("#rp-video"), {
  alCambiar: pintarBarra,
  alTerminar: pintarBarra,
  alError: (_, texto) => avisar(texto)
}));
const motor = () => (yt?.activo ? yt : audio);
const tocarMotor = () => {
  const m = motor();
  if (m === audio) audio.play().catch(() => {});
  else m.play();
};

function quitarVideo() {
  if (yt?.activo) yt.destruir();
  $("#rp-video").hidden = true;
}

function elegirAudio(entrada) {
  const lista = audiosReproducibles(entrada);
  if (!lista.length) return { lista, i: -1 };
  let i = st.elegido.get(entrada.id);
  if (!(i >= 0 && i < lista.length)) {
    const mia = guardado("mc-mi-voz", "");
    // A igualdad, el audio del Drive antes que el video de YouTube
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

function cargarAudio(a, tocar) {
  const t = ++turno;
  audio.onerror = null;
  audio.pause();
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
    $("#rp-video").hidden = false;
    reproductorYT().cargar(a.url, tocar);
    pintarBarra();
    return;
  }
  quitarVideo();
  if (!a.fileId) {
    audio.onerror = () => { if (t === turno) avisar("No se pudo cargar el audio: el enlace no responde."); };
    audio.src = a.url;
    if (tocar) audio.play().catch(() => {});
    return;
  }
  if (tocar && !desbloqueado) {
    desbloqueado = true;
    desbloquear(audio);
  } else audio.removeAttribute("src");
  pintarDonde("Cargando el audio desde el Drive…");
  blobDeAudio(a.fileId).then((url) => {
    if (t !== turno) return;
    audio.src = url;
    if (tocar) audio.play().catch(() => {});
  }, (e) => {
    if (t === turno) avisar("No se pudo cargar el audio: " + e.message);
  }).finally(() => { if (t === turno) pintarDonde(); });
}

function pintarDonde(extra) {
  const c = st.cola;
  if (!c) return;
  $("#rp-donde").textContent = extra || `${c.nombre} · ${st.indice + 1} de ${c.items.length}`;
}

async function reproducir(i, tocar = true) {
  const c = st.cola;
  if (!c || i < 0 || i >= c.items.length) return;
  st.indice = i;
  const item = c.items[i];
  const entrada = st.porId.get(item.cancionId) || { id: item.cancionId, titulo: "", audios: [] };
  st.mezclador?.cerrar();
  cerrarPostura();
  $("#rp-nada").hidden = true;
  $("#rp-sonando").hidden = false;
  $("#rp-barra").hidden = false;
  document.body.classList.add("con-barra");
  $("#rp-momento").hidden = !item.momento;
  $("#rp-momento").textContent = item.momento || "";
  pintarDonde();

  const { lista, i: elegido } = elegirAudio(entrada);
  $("#rp-voz-caja").hidden = lista.length < 2;
  $("#rp-voz").innerHTML = lista.map((a, k) => `<option value="${k}"${k === elegido ? " selected" : ""}>${esc(nombreAudio(a))}</option>`).join("");
  $("#rp-sin-audio").hidden = lista.length > 0;
  cargarAudio(lista[elegido], tocar);
  pintarBarra();
  pintarExtras(entrada);
  pintarCanciones();
  sesionDeMedios(entrada, item);
  await pintarLetra(item, entrada);
  precargar(i + 1);
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
  box.scrollTop = 0;
  window.scrollTo({ top: 0 });
  $("#rp-barra-titulo").textContent = r.doc.title || entrada.titulo || r.cancion.titulo || "";
}

function htmlCancion({ doc, cancion }, desplazamiento, entrada = {}) {
  const titulo = doc.title || entrada.titulo || cancion.titulo || "Canción";
  const orig = detectKey(doc.text);
  const d = desplazamiento || 0;
  const tono = orig ? { idx: mod12(orig.idx + d), minor: orig.minor } : null;
  const texto = orig && d ? transposeText(doc.text, d, keyPrefersFlats(tono.idx, tono.minor)) : doc.text;
  mcCancionActual = {
    tags: [],
    credits: normalizeCredits({ letra: doc.credits?.letra || entrada.letraDe || cancion.letraDe, musica: doc.credits?.musica || entrada.musicaDe || cancion.musicaDe })
  };
  return doc.text.trim() ? renderSong(titulo, texto, tono)
    : `<div class="rp-vacio"><p><b>${esc(titulo)}</b></p><p>Esta canción todavía no tiene la letra cargada.</p></div>`;
}

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
  const p = botonesPartituras(entrada);
  if (p) {
    p.querySelectorAll("button").forEach((x) => x.classList.add("rp-btn"));
    box.prepend(p);
  }
}

function precargar(i) {
  const it = st.cola?.items[i];
  if (!it) return;
  textoCancion(it.cancionId).catch(() => {});
  const entrada = st.porId.get(it.cancionId);
  const { lista, i: k } = elegirAudio(entrada || {});
  const a = lista[k];
  if (a?.fileId) blobDeAudio(a.fileId).catch(() => {});
}

const siguiente = () => st.cola && st.indice < st.cola.items.length - 1 && reproducir(st.indice + 1);
const anterior = () => {
  const m = motor();
  if (m.currentTime > 4) m.currentTime = 0;
  else if (st.cola && st.indice > 0) reproducir(st.indice - 1);
};

function pintarBarra() {
  const m = motor();
  const tiene = m !== audio || !!audio.getAttribute("src");
  $("#rp-play").disabled = !tiene;
  $("#rp-play").textContent = m.paused ? "▶" : "⏸";
  $("#rp-play").setAttribute("aria-label", m.paused ? "Reproducir" : "Pausa");
  $("#rp-anterior").disabled = !st.cola || (st.indice <= 0 && !tiene);
  $("#rp-siguiente").disabled = !st.cola || st.indice >= st.cola.items.length - 1;
  const dur = isFinite(m.duration) ? m.duration : 0;
  $("#rp-progreso").max = dur || 1;
  $("#rp-progreso").value = m.currentTime || 0;
  $("#rp-progreso").disabled = !dur;
  $("#rp-actual").textContent = reloj(m.currentTime);
  $("#rp-total").textContent = reloj(dur);
}

function sesionDeMedios(entrada, item) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: entrada.titulo || "Canción",
    artist: item.momento || creditsText(normalizeCredits({ letra: entrada.letraDe, musica: entrada.musicaDe })) || "Monte Carmelo",
    album: st.cola?.nombre || ""
  });
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
  const quiere = (st.vista === "sonando" && !!st.cola) || (st.vista === "vivo" && !!st.vivo);
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

// ============ AJUSTES DE LA LETRA ============

function aplicarAjustes() {
  const soloLetra = guardado("mc-rp-acordes", "si") === "no";
  $("#rp-letra").classList.toggle("solo-letra", soloLetra);
  $("#rp-acordes").setAttribute("aria-pressed", !soloLetra);
  $("#rp-acordes").textContent = soloLetra ? "Solo letra" : "Letra y acordes";
  const tam = +guardado("mc-rp-letra", "18") || 18;
  document.documentElement.style.setProperty("--rp-letra", tam + "px");
  const noche = guardado("mc-rp-tema", "noche") === "noche";
  document.body.classList.toggle("rp-noche", noche);
  document.body.classList.toggle("rp-dia", !noche);
  $("#rp-tema").textContent = noche ? "☀︎" : "☾";
  $("#rp-tema").title = noche ? "Pasar a modo día" : "Pasar a modo noche";
  document.querySelector('meta[name="theme-color"]').content = noche ? "#14110d" : "#faf3e4";
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
      mostrarVista("sonando");
      reproducir(0);
    } catch (_) {
      avisar("El enlace de la lista no se pudo leer.");
    }
  } else if (clave === "misa" && valor) abrirMisa(valor);
  else if (clave === "vivo" && /^\d{4}$/.test(valor)) seguirVivo(valor);
}

// ============ EVENTOS ============

function conectar() {
  document.querySelector(".rp-pestanas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vista]");
    if (b) mostrarVista(b.dataset.vista);
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
    st.cola = { nombre: q ? `Búsqueda «${q}»` : "Biblioteca", tipo: "biblioteca", items: lista.map((c) => ({ cancionId: c.id, desplazamiento: 0 })) };
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
    const b = e.target.closest("[data-a-lista]");
    const l = b && st.listas.find((x) => x.id === b.dataset.aLista);
    if (l) agregarA(l);
  });
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
    guardar("mc-rp-comunidad", st.comunidad);
    cargarMisas();
  });

  $("#rp-voz").addEventListener("change", (e) => {
    const entrada = st.porId.get(actualId());
    if (!entrada) return;
    st.elegido.set(entrada.id, +e.target.value);
    const antes = motor();
    const t = antes.currentTime, sonaba = !antes.paused;
    cargarAudio(audiosReproducibles(entrada)[+e.target.value], sonaba);
    // Las voces de una misma grabación siguen en el mismo punto; el video es otra grabación
    if (antes === audio && motor() === audio) {
      audio.addEventListener("loadedmetadata", () => { audio.currentTime = Math.min(t, audio.duration || t); }, { once: true });
    }
  });
  $("#rp-acordes").addEventListener("click", () => {
    guardar("mc-rp-acordes", guardado("mc-rp-acordes", "si") === "no" ? "si" : "no");
    aplicarAjustes();
  });
  const tam = (d) => {
    guardar("mc-rp-letra", String(Math.max(12, Math.min(36, (+guardado("mc-rp-letra", "18") || 18) + d))));
    aplicarAjustes();
  };
  $("#rp-menos").addEventListener("click", () => tam(-2));
  $("#rp-mas").addEventListener("click", () => tam(2));
  $("#rp-tema").addEventListener("click", () => {
    guardar("mc-rp-tema", guardado("mc-rp-tema", "noche") === "noche" ? "dia" : "noche");
    aplicarAjustes();
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
  $("#rp-barra-titulo").addEventListener("click", () => mostrarVista("sonando"));
  $("#rp-progreso").addEventListener("input", (e) => { motor().currentTime = +e.target.value; });
  for (const ev of ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "emptied"]) audio.addEventListener(ev, pintarBarra);
  audio.addEventListener("play", () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; });
  audio.addEventListener("pause", () => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; });
  audio.addEventListener("ended", () => {
    if (audio.src === SILENCIO) return;
    if (!siguiente()) avisar("Terminó la lista.");
  });

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
    if (!st.vivo || st.vivo.terminado) return;
    if (document.hidden) clearTimeout(st.vivo.reloj);
    else consultarVivo();
  });
  window.addEventListener("hashchange", leerHash);
  activarPosturas($("#rp-letra"));
  activarPosturas($("#rp-vivo-letra"));
  conectarMedios();
}

async function iniciar() {
  initNavSitio();
  st.listas = leerListas();
  aplicarAjustes();
  conectar();
  await cargarBiblioteca();
  leerHash();
}

iniciar();
