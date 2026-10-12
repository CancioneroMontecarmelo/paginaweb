/**
 * partituras.js — Partituras y tablaturas de las canciones de la Biblioteca, en Misas y el reproductor.
 *
 *  - botonesPartituras(entrada, { editable, alCambiar, tono }) devuelve la fila «Partitura · Voz» / «Tablatura»
 *    (+ «+ Partitura» para quien puede editar la canción) o null si no hay nada que mostrar. tono() → { original, actual }
 *    (índices 0-11 del tono de la letra en la Biblioteca y del que suena) para trasponer MusicXML y Guitar Pro.
 *  - Ver una hoja la abre en un diálogo, dibujada en la página (PDF con pdf.js, fotos como imagen, MusicXML,
 *    Guitar Pro y alphaTex con alphaTab de editor/vendor) y un botón «Descargar».
 *  - Subir (PUT /api/subir?tipo=partitura) y quitar (quitarPartitura) van al servidor de la parroquia.
 *    alCambiar recibe la canción actualizada.
 *
 * Usa VOICES y VOICE_ORDER de editor/js/acordes.js (script clásico cargado antes: son const globales, no
 * propiedades de window).
 */

import { llamarApi, subirBinario, sesionActual } from "./auth.js";

const MAX_BYTES = 15 * 1024 * 1024;
const TIPOS = /\.(pdf|png|jpe?g|webp|musicxml|xml|mxl|gp|gp3|gp4|gp5|gpx|gp7|alphatex|atex)$/i;
const ACEPTA = ".pdf,.png,.jpg,.jpeg,.webp,.musicxml,.xml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.alphatex,.atex,application/pdf,image/png,image/jpeg,image/webp";
const VENDOR = new URL("../editor/vendor/", import.meta.url).href;
const PDFJS = VENDOR + "pdfjs/";

const urlArchivo = (id) => (window.MONTECARMELO_CONFIG || {}).apiUrl + "/archivo/" + encodeURIComponent(id);
export const descarga = (id) => urlArchivo(id) + "?descargar=1";

const voces = () => (typeof VOICES === "object" ? VOICES : {});
const nombreVoz = (v) => (v && v !== "todas" ? voces()[v]?.label || v : "");
const esTablatura = (p) => p.tipo === "tablatura";
export const etiquetaPartitura = (p) => (esTablatura(p) ? "Tablatura" : "Partitura") + (nombreVoz(p.voz) ? " · " + nombreVoz(p.voz) : "");
const formatoDe = (p) => p.formato || (p.mime === "application/pdf" ? "pdf" : "imagen");
const formatoPorNombre = (n) => {
  const ext = (String(n).split(".").pop() || "").toLowerCase();
  if (/^(musicxml|xml|mxl)$/.test(ext)) return "musicxml";
  if (/^gp[3-7x]?$/.test(ext)) return "gp";
  if (/^(alphatex|atex)$/.test(ext)) return "alphatex";
  return ext === "pdf" ? "pdf" : "imagen";
};
const semitonos = (n) => { n = ((n % 12) + 12) % 12; return n > 6 ? n - 12 : n; };

function boton(texto, clase, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = clase;
  b.textContent = texto;
  b.addEventListener("click", fn);
  return b;
}

export function botonesPartituras(entrada, { editable = false, alCambiar, tono } = {}) {
  const lista = entrada?.partituras || [];
  if (!lista.length && !editable) return null;
  const fila = document.createElement("div");
  fila.className = "partituras-fila";
  for (const p of lista) {
    const b = boton((esTablatura(p) ? "🎸 " : "𝄞 ") + etiquetaPartitura(p), "btn-chico btn-partitura", () => {
      const t = tono?.() || {};
      verPartitura(p, entrada.titulo, p.tono != null && t.actual != null ? semitonos(t.actual - p.tono) : 0);
    });
    b.title = p.nombre || "";
    fila.append(b);
  }
  if (editable) {
    const mas = boton("+ Partitura", "btn-chico btn-mas-partitura", () => abrirSubida(entrada, alCambiar, tono));
    mas.title = "Subir o quitar partituras y tablaturas de esta canción";
    fila.append(mas);
  }
  return fila;
}

// ============ VISTA PREVIA ============

let dlgVer = null;

function dialogoVer() {
  if (dlgVer) return dlgVer;
  dlgVer = document.createElement("dialog");
  dlgVer.className = "dlg-partitura";
  dlgVer.innerHTML = `
    <div class="partitura-cabeza">
      <h2 class="partitura-titulo"></h2>
      <a class="btn-chico partitura-bajar" target="_blank" rel="noopener">Descargar</a>
      <button type="button" class="btn-chico" data-cerrar>Cerrar</button>
    </div>
    <div class="partitura-marco" role="document"></div>`;
  dlgVer.querySelector("[data-cerrar]").addEventListener("click", () => dlgVer.close());
  dlgVer.addEventListener("close", () => {
    turnoVer++;
    const marco = dlgVer.querySelector(".partitura-marco");
    marco.querySelectorAll("img").forEach((img) => URL.revokeObjectURL(img.src));
    marco.replaceChildren();
  });
  document.body.append(dlgVer);
  return dlgVer;
}

export function verPartitura(p, titulo, semis = 0) {
  const d = dialogoVer();
  d.querySelector(".partitura-titulo").textContent = (titulo ? titulo + " — " : "") + etiquetaPartitura(p);
  d.querySelector(".partitura-bajar").href = descarga(p.fileId);
  d.showModal();
  mostrar(p, d.querySelector(".partitura-marco"), semis);
}

const cargados = new Map();
function cargarScript(src) {
  if (!cargados.has(src)) {
    cargados.set(src, new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => {
        cargados.delete(src);
        mal(new Error("no se pudo cargar el visor"));
      };
      document.head.append(s);
    }));
  }
  return cargados.get(src);
}

async function cargarPdfJs() {
  if (!window.pdfjsLib) await cargarScript(PDFJS + "pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
  return window.pdfjsLib;
}

function nota(texto) {
  const p = document.createElement("p");
  p.className = "partitura-nota";
  p.textContent = texto;
  return p;
}

// El atril del editor dibuja la partitura dentro de su propia pantalla
export const dibujarPartitura = (p, marco, semis = 0) => mostrar(p, marco, semis);

let turnoVer = 0, alphaTab = null;
async function mostrar(p, marco, semis = 0) {
  const t = ++turnoVer;
  marco.replaceChildren(nota("Cargando la " + (esTablatura(p) ? "tablatura" : "partitura") + "…"));
  try {
    alphaTab?.destroy?.();
  } catch (_) { /* ya no estaba */ }
  alphaTab = null;
  try {
    const res = await fetch(urlArchivo(p.fileId));
    if (!res.ok) throw new Error("ya no está en el servidor");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (t !== turnoVer) return;
    const formato = formatoDe(p);
    if (formato === "musicxml" || formato === "gp" || formato === "alphatex") {
      await cargarScript(VENDOR + "alphatab/alphaTab.min.js");
      if (t !== turnoVer) return;
      marco.replaceChildren();
      if (semis) marco.append(nota(`Traspuesta ${semis > 0 ? "+" : ""}${semis} semitonos para seguir el tono que suena.`));
      const caja = document.createElement("div");
      caja.className = "partitura-alphatab";
      marco.append(caja);
      const perfil = esTablatura(p) ? (formato === "musicxml" ? "Default" : "Tab") : "Score";
      alphaTab = new window.alphaTab.AlphaTabApi(caja, {
        core: { useWorkers: false, engine: "svg", enableLazyLoading: false, fontDirectory: VENDOR + "alphatab/font/" },
        display: { staveProfile: perfil },
        notation: { transpositionPitches: Array(64).fill(semis) },
        player: { enablePlayer: false }
      });
      alphaTab.error.on((err) => {
        if (t === turnoVer) marco.replaceChildren(nota("No se pudo leer: " + (err?.message || String(err)) + ". Probá con «Descargar»."));
      });
      if (formato === "alphatex") alphaTab.tex(new TextDecoder().decode(bytes));
      else alphaTab.load(bytes);
      return;
    }
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
      const img = document.createElement("img");
      img.className = "partitura-imagen";
      img.alt = etiquetaPartitura(p);
      img.src = URL.createObjectURL(new Blob([bytes], { type: p.mime || res.headers.get("Content-Type") || "image/jpeg" }));
      marco.replaceChildren(...(semis ? [nota("Es una imagen: no se traspone.")] : []), img);
      return;
    }
    const lib = await cargarPdfJs();
    const pdf = await lib.getDocument({ data: bytes }).promise;
    if (t !== turnoVer) return;
    marco.replaceChildren(...(semis ? [nota("Es un PDF: no se traspone.")] : []));
    const ancho = Math.min((marco.clientWidth || 760) - 16, 1100);
    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= pdf.numPages; i++) {
      const pagina = await pdf.getPage(i);
      if (t !== turnoVer) return;
      const vp = pagina.getViewport({ scale: (ancho / pagina.getViewport({ scale: 1 }).width) * dpr });
      const c = document.createElement("canvas");
      c.className = "partitura-pagina";
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      c.style.width = ancho + "px";
      marco.append(c);
      await pagina.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    }
  } catch (e) {
    if (t === turnoVer) marco.replaceChildren(nota("No se pudo mostrar: " + e.message + ". Probá con «Descargar»."));
  }
}

// ============ SUBIR Y QUITAR ============

let dlgSubir = null;
const sub = { entrada: null, alCambiar: null, tono: null, ocupado: false };

function dialogoSubir() {
  if (dlgSubir) return dlgSubir;
  dlgSubir = document.createElement("dialog");
  dlgSubir.className = "dlg-partitura dlg-partitura-subir";
  const opciones = (typeof VOICE_ORDER === "object" ? VOICE_ORDER : []).map((k) => `<option value="${k}">${nombreVoz(k)}</option>`).join("");
  dlgSubir.innerHTML = `
    <form method="dialog">
      <div class="partitura-cabeza">
        <h2 class="partitura-titulo">Partituras</h2>
        <button type="button" class="btn-chico" data-cerrar>Cerrar</button>
      </div>
      <div class="partitura-cuerpo">
        <ul class="partitura-actuales"></ul>
        <label>Archivo (PDF, foto, MusicXML, Guitar Pro o alphaTex, hasta 15 MB)
          <input type="file" class="partitura-archivo" accept="${ACEPTA}">
        </label>
        <label>Es
          <select class="partitura-clase"><option value="partitura">🎼 Partitura</option><option value="tablatura">🎸 Tablatura</option></select>
        </label>
        <label>Voz
          <select class="partitura-voz"><option value="">Todas las voces</option>${opciones}</select>
        </label>
        <p class="partitura-estado" role="status" hidden></p>
        <div class="partitura-acciones">
          <button type="button" class="btn btn-secundario" data-cerrar>Cerrar</button>
          <button type="submit" class="btn btn-primario partitura-enviar">Subir</button>
        </div>
      </div>
    </form>`;
  dlgSubir.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => dlgSubir.close()));
  dlgSubir.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    subir();
  });
  dlgSubir.querySelector(".partitura-archivo").addEventListener("change", (e) => {
    const f = e.target.files[0];
    const formato = f ? formatoPorNombre(f.name) : "";
    if (formato === "gp" || formato === "alphatex") dlgSubir.querySelector(".partitura-clase").value = "tablatura";
    else if (formato) dlgSubir.querySelector(".partitura-clase").value = "partitura";
  });
  dlgSubir.querySelector(".partitura-actuales").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quitar]");
    if (b) quitar(b.dataset.quitar);
  });
  dlgSubir.addEventListener("cancel", (e) => sub.ocupado && e.preventDefault());
  document.body.append(dlgSubir);
  return dlgSubir;
}

function estado(texto, error) {
  const p = dlgSubir.querySelector(".partitura-estado");
  p.hidden = !texto;
  p.textContent = texto || "";
  p.classList.toggle("error", !!error);
}

function pintarActuales() {
  const ul = dlgSubir.querySelector(".partitura-actuales");
  const lista = sub.entrada.partituras || [];
  ul.replaceChildren(...lista.map((p) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = etiquetaPartitura(p) + (p.nombre ? " — " + p.nombre : "");
    const q = document.createElement("button");
    q.type = "button";
    q.className = "btn-chico peligro";
    q.dataset.quitar = p.fileId;
    q.textContent = "Quitar";
    li.append(span, q);
    return li;
  }));
  ul.hidden = !lista.length;
}

function abrirSubida(entrada, alCambiar, tono) {
  const d = dialogoSubir();
  sub.entrada = entrada;
  sub.alCambiar = alCambiar;
  sub.tono = tono || null;
  d.querySelector(".partitura-titulo").textContent = "Partituras y tablaturas de «" + (entrada.titulo || "la canción") + "»";
  d.querySelector(".partitura-archivo").value = "";
  estado("");
  pintarActuales();
  d.showModal();
}

function listo(cancion, texto) {
  sub.entrada = cancion;
  pintarActuales();
  estado(texto);
  sub.alCambiar?.(cancion);
}

async function subir() {
  if (sub.ocupado) return;
  const entrada = dlgSubir.querySelector(".partitura-archivo");
  const f = entrada.files[0];
  if (!f) return estado("Elegí el archivo.", true);
  if (!TIPOS.test(f.name)) return estado("Tiene que ser un PDF, una foto (PNG, JPG, WEBP), MusicXML, Guitar Pro o alphaTex.", true);
  if (f.size > MAX_BYTES) return estado("El archivo supera los 15 MB: achicalo o partilo en dos.", true);
  const boton = dlgSubir.querySelector(".partitura-enviar");
  sub.ocupado = boton.disabled = true;
  estado("Subiendo «" + f.name + "»…");
  try {
    const original = sub.tono?.()?.original;
    const r = await subirBinario("partitura", {
      cancionId: sub.entrada.id, nombre: f.name, mime: f.type || "application/octet-stream", voz: dlgSubir.querySelector(".partitura-voz").value,
      clase: dlgSubir.querySelector(".partitura-clase").value, ...(original != null ? { tono: original } : {})
    }, f);
    entrada.value = "";
    listo(r.cancion, "Listo: quedó en la canción.");
  } catch (err) {
    estado(err.message, true);
  } finally {
    sub.ocupado = boton.disabled = false;
  }
}

async function quitar(fileId) {
  const p = (sub.entrada.partituras || []).find((x) => x.fileId === fileId);
  if (!p || sub.ocupado || !confirm(`¿Quitar «${etiquetaPartitura(p)}» de «${sub.entrada.titulo}»?`)) return;
  sub.ocupado = true;
  estado("Quitando…");
  try {
    const r = await llamarApi("quitarPartitura", { token: (sesionActual() || {}).token || "", cancionId: sub.entrada.id, fileId });
    listo(r.cancion, "Se quitó.");
  } catch (err) {
    estado(err.message, true);
  } finally {
    sub.ocupado = false;
  }
}
