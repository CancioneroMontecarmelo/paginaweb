/**
 * reproductor.js — Reproductor de la Biblioteca (reproductor.html), sin sesión.
 *
 *  - Canciones: buscador de la Biblioteca y «Solo con audio». Tocar una canción la hace sonar (la cola es
 *    lo que se ve en la lista); «+» la agrega a una lista.
 *  - Listas: «Mis listas» en este equipo (localStorage mc-listas: crear, renombrar, ordenar, quitar, borrar)
 *    que se comparten con un enlace #l=… (WhatsApp o Copiar), y los cancioneros de misa (#misa=<id>) con
 *    sus momentos y tonos.
 *  - Reproduciendo: la letra con acordes en el tono del cancionero, créditos, posturas al tocar un acorde,
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

import { initNavSitio, sesionActual } from "./auth.js";
import { COMUNIDADES } from "./comunidades.js";
import { activarPosturas, cerrar as cerrarPostura } from "./posturas.js";
import { botonesPartituras } from "./partituras.js";
import { crearMezclador, pistasDeVoces } from "./voces.js";
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
    colaPropia({ nombre: l.nombre, tipo: "lista", items: l.items.map((x) => ({ ...x })) });
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
  colaHash = location.hash;
  mostrarVista("sonando");
  reproducir(0);
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
  mostrarVista("sonando");
  reproducir(s.indice, false, s.segundo || 0);
  avisar(`Seguís en «${s.cola.nombre}»: tocá ▶ para continuar.`);
}

// Al abrir: un enlace distinto arma su cola; si no, sigue con la guardada
function arrancar() {
  const h = location.hash, s = h.startsWith("#vivo=") ? null : sonandoGuardado();
  if (s && (!h || h === s.hash)) recuperarSonando(s);
  else leerHash();
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
const motor = () => (yt?.activo ? yt : audio);
const tocarMotor = () => {
  const m = motor();
  if (m === audio) audio.play().catch(() => {});
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
    if (tocar) audio.play().catch(() => {});
    return;
  }
  audio.onerror = () => noDisponible(t, reproduceWebm ? "No se pudo cargar el audio."
    : "No se pudo cargar el audio: puede que todavía esté en el formato anterior (WebM), que este equipo no reproduce.");
  audio.src = urlAudio(a.fileId);
  if (tocar) audio.play().catch(() => {});
}

function pintarDonde(extra) {
  const c = st.cola;
  if (!c) return;
  $("#rp-donde").textContent = extra || `${c.nombre} · ${st.indice + 1} de ${c.items.length}`;
}

async function reproducir(i, tocar = true, desde = 0) {
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
  $("#rp-barra").hidden = false;
  document.body.classList.add("con-barra");
  $("#rp-momento").hidden = !item.momento;
  $("#rp-momento").textContent = item.momento || "";
  pintarDonde();

  const { lista, i: elegido } = elegirAudio(entrada);
  $("#rp-voz-caja").hidden = lista.length < 2;
  $("#rp-voz").innerHTML = lista.map((a, k) => `<option value="${k}"${k === elegido ? " selected" : ""}>${esc(nombreAudio(a))}</option>`).join("");
  $("#rp-sin-audio").hidden = lista.length > 0;
  cargarAudio(lista[elegido], tocar, desde);
  pintarBarra();
  pintarExtras(entrada);
  pintarCanciones();
  sesionDeMedios(entrada, item);
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
function vecino(paso, mover = false) {
  const c = st.cola;
  if (!c) return -1;
  const n = c.items.length, o = ordenActual();
  const p = (o ? o.indexOf(st.indice) : st.indice) + paso;
  if (p >= 0 && p < n) return o ? o[p] : p;
  if (modos.repetir !== "lista") return -1;
  if (o && p >= n) {
    if (!mover) return 0;
    orden = mezclar(n, -1);
    if (n > 1 && orden[0] === st.indice) [orden[0], orden[1]] = [orden[1], orden[0]];
    return orden[0];
  }
  const q = (p + n) % n;
  return o ? o[q] : q;
}

const siguiente = () => {
  const i = vecino(1, true);
  return i >= 0 && (reproducir(i), true);
};
const anterior = () => {
  const m = motor();
  if (m.currentTime > 4) m.currentTime = 0;
  else {
    const i = vecino(-1, true);
    if (i >= 0) reproducir(i);
  }
};

function alTerminarPista() {
  if (modos.repetir === "una") {
    const m = motor();
    m.currentTime = 0;
    tocarMotor();
    return;
  }
  if (!siguiente()) avisar("Terminó la lista.");
}

function pintarModos() {
  const a = $("#rp-aleatorio"), r = $("#rp-repetir");
  a.setAttribute("aria-pressed", modos.aleatorio);
  a.title = modos.aleatorio ? "Aleatorio: sí" : "Aleatorio: no";
  const texto = { no: "Repetir: no", lista: "Repetir toda la lista", una: "Repetir esta canción" }[modos.repetir];
  r.setAttribute("aria-pressed", modos.repetir !== "no");
  r.setAttribute("aria-label", texto);
  r.title = texto;
  r.textContent = modos.repetir === "una" ? "↻1" : "↻";
}

// Si un video o un audio no se puede reproducir, pasa a la siguiente; se detiene si ya probó toda la cola
let saltos = 0;
function noDisponible(t, motivo) {
  if (t !== turno) return;
  const n = st.cola?.items.length || 0;
  if (++saltos >= n || vecino(1) < 0) {
    saltos = 0;
    avisar(motivo);
    return;
  }
  avisar("No disponible: pasando a la siguiente.");
  siguiente();
}

function pintarBarra() {
  const m = motor();
  const tiene = m !== audio || !!audio.getAttribute("src");
  $("#rp-play").disabled = !tiene;
  $("#rp-play").textContent = m.paused ? "▶" : "⏸";
  $("#rp-play").setAttribute("aria-label", m.paused ? "Reproducir" : "Pausa");
  $("#rp-anterior").disabled = !st.cola || (vecino(-1) < 0 && !tiene);
  $("#rp-siguiente").disabled = vecino(1) < 0;
  const dur = isFinite(m.duration) ? m.duration : 0;
  $("#rp-progreso").max = dur || 1;
  $("#rp-progreso").value = m.currentTime || 0;
  $("#rp-progreso").disabled = !dur;
  $("#rp-actual").textContent = reloj(m.currentTime);
  $("#rp-total").textContent = reloj(dur);
  if (!m.paused && Date.now() - ultimoGuardado > 5000) guardarSonando();
}

function sesionDeMedios(entrada, item) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: entrada.titulo || "Canción",
    artist: item.momento || creditsText(normalizeCredits({ letra: entrada.letraDe, musica: entrada.musicaDe })) || "Monte Carmelo",
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
  aplicarColores();
}

// ============ COLORES ============

const TEMAS = [
  { id: "noche", nombre: "Noche", fondo: "#14110d", acento: "#e0a36f", oscuro: true },
  { id: "dia", nombre: "Día", fondo: "#faf3e4", acento: "#9a4f2e" },
  { id: "carmelo", nombre: "Carmelo", fondo: "#241811", acento: "#d9b26a", oscuro: true },
  { id: "mariano", nombre: "Mariano", fondo: "#0e1a2e", acento: "#8fb8e8", oscuro: true },
  { id: "liturgico", nombre: "Litúrgico", fondo: "#f3f1e7", acento: "#2f6b3a" },
  { id: "penitencial", nombre: "Penitencial", fondo: "#1a1322", acento: "#b58ad6", oscuro: true }
];
const temaActual = () => TEMAS.find((t) => t.id === guardado("mc-rp-tema", "noche")) || TEMAS[0];

function aplicarColores() {
  const t = temaActual(), acento = guardado("mc-rp-acento", "");
  const b = document.body;
  b.dataset.rpTema = t.id;
  b.classList.toggle("rp-oscuro", !!t.oscuro);
  for (const v of ["--rp-acento", "--rp-acorde"]) {
    if (acento) b.style.setProperty(v, acento);
    else b.style.removeProperty(v);
  }
  document.querySelector('meta[name="theme-color"]').content = t.fondo;
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
  $("#rp-colores").addEventListener("click", () => $("#rp-dlg-colores").showModal());
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
  $("#rp-barra-titulo").addEventListener("click", () => mostrarVista("sonando"));
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
  $("#rp-misas").addEventListener("click", (e) => {
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
}

// ============ APP INSTALABLE ============

function prepararApp() {
  const app = document.body.classList.contains("rp-app");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw-reproductor.js", { scope: "./reproductor" }).catch(() => {});
  if (app) {
    // En la app la página de la parroquia se abre en el navegador, sin salir del reproductor
    $("#rp-marca").target = "_blank";
    $("#rp-marca").rel = "noopener";
    return;
  }
  const b = $("#rp-instalar");
  let pedido = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pedido = e;
    b.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    pedido = null;
    b.hidden = true;
    avisar("Listo: el reproductor quedó instalado.");
  });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) b.hidden = false;
  b.addEventListener("click", async () => {
    if (!pedido) return $("#rp-dlg-instalar").showModal();
    pedido.prompt();
    await pedido.userChoice.catch(() => {});
    pedido = null;
    b.hidden = true;
  });
}

async function iniciar() {
  initNavSitio();
  prepararApp();
  st.listas = leerListas();
  aplicarAjustes();
  conectar();
  await cargarBiblioteca();
  arrancar();
}

iniciar();
