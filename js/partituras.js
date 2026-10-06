/**
 * partituras.js — Partituras (PDF o imagen) de las canciones de la Biblioteca, en Misas y el reproductor.
 *
 *  - botonesPartituras(entrada, { editable, alCambiar }) devuelve la fila «Partitura · Voz» (+ «+ Partitura»
 *    para quien puede editar la canción) o null si no hay nada que mostrar.
 *  - Ver una partitura la abre en un diálogo con la vista previa de Drive (no baja el archivo ni pregunta con
 *    qué app abrirlo) y un botón «Descargar».
 *  - Subir y quitar van al Apps Script (subirPartitura / quitarPartitura), que las guarda en
 *    Biblioteca/partituras con acceso por enlace. alCambiar recibe la canción actualizada.
 *
 * Usa VOICES y VOICE_ORDER de editor/js/acordes.js (script clásico cargado antes: son const globales, no
 * propiedades de window).
 */

import { llamarApi, sesionActual } from "./auth.js";

const MAX_BYTES = 15 * 1024 * 1024;
const TIPOS = /\.(pdf|png|jpe?g)$/i;

export const vistaPrevia = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
export const descarga = (id) => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;

const voces = () => (typeof VOICES === "object" ? VOICES : {});
const nombreVoz = (v) => (v && v !== "todas" ? voces()[v]?.label || v : "");
export const etiquetaPartitura = (p) => "Partitura" + (nombreVoz(p.voz) ? " · " + nombreVoz(p.voz) : "");

function boton(texto, clase, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = clase;
  b.textContent = texto;
  b.addEventListener("click", fn);
  return b;
}

export function botonesPartituras(entrada, { editable = false, alCambiar } = {}) {
  const lista = entrada?.partituras || [];
  if (!lista.length && !editable) return null;
  const fila = document.createElement("div");
  fila.className = "partituras-fila";
  for (const p of lista) {
    const b = boton("𝄞 " + etiquetaPartitura(p), "btn-chico btn-partitura", () => verPartitura(p, entrada.titulo));
    b.title = p.nombre || "";
    fila.append(b);
  }
  if (editable) {
    const mas = boton("+ Partitura", "btn-chico btn-mas-partitura", () => abrirSubida(entrada, alCambiar));
    mas.title = "Subir o quitar partituras (PDF o foto) de esta canción";
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
    <iframe class="partitura-marco" title="Partitura" allow="fullscreen"></iframe>`;
  dlgVer.querySelector("[data-cerrar]").addEventListener("click", () => dlgVer.close());
  dlgVer.addEventListener("close", () => dlgVer.querySelector("iframe").removeAttribute("src"));
  document.body.append(dlgVer);
  return dlgVer;
}

export function verPartitura(p, titulo) {
  const d = dialogoVer();
  d.querySelector(".partitura-titulo").textContent = (titulo ? titulo + " — " : "") + etiquetaPartitura(p);
  d.querySelector(".partitura-bajar").href = descarga(p.fileId);
  d.querySelector("iframe").src = vistaPrevia(p.fileId);
  d.showModal();
}

// ============ SUBIR Y QUITAR ============

let dlgSubir = null;
const sub = { entrada: null, alCambiar: null, ocupado: false };

function archivoBase64(f) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(",")[1] || "");
    lector.onerror = () => mal(new Error("No se pudo leer " + f.name));
    lector.readAsDataURL(f);
  });
}

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
        <label>Archivo (PDF, o foto PNG o JPG, hasta 15 MB)
          <input type="file" class="partitura-archivo" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg">
        </label>
        <label>Voz
          <select class="partitura-voz"><option value="">Todas las voces</option>${opciones}</select>
        </label>
        <p class="partitura-estado" role="status" hidden></p>
        <div class="partitura-acciones">
          <button type="button" class="btn btn-secundario" data-cerrar>Cerrar</button>
          <button type="submit" class="btn btn-primario partitura-enviar">Subir partitura</button>
        </div>
      </div>
    </form>`;
  dlgSubir.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => dlgSubir.close()));
  dlgSubir.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    subir();
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

function abrirSubida(entrada, alCambiar) {
  const d = dialogoSubir();
  sub.entrada = entrada;
  sub.alCambiar = alCambiar;
  d.querySelector(".partitura-titulo").textContent = "Partituras de «" + (entrada.titulo || "la canción") + "»";
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
  if (!f) return estado("Elegí el archivo de la partitura.", true);
  if (!TIPOS.test(f.name)) return estado("La partitura tiene que ser un PDF o una foto PNG o JPG.", true);
  if (f.size > MAX_BYTES) return estado("La partitura supera los 15 MB: achicala o partila en dos.", true);
  const boton = dlgSubir.querySelector(".partitura-enviar");
  sub.ocupado = boton.disabled = true;
  estado("Subiendo «" + f.name + "»…");
  try {
    const r = await llamarApi("subirPartitura", {
      token: (sesionActual() || {}).token || "", cancionId: sub.entrada.id,
      nombre: f.name, mime: f.type, voz: dlgSubir.querySelector(".partitura-voz").value, base64: await archivoBase64(f)
    });
    entrada.value = "";
    listo(r.cancion, "Listo: la partitura quedó en la canción.");
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
    listo(r.cancion, "Se quitó la partitura.");
  } catch (err) {
    estado(err.message, true);
  } finally {
    sub.ocupado = false;
  }
}
