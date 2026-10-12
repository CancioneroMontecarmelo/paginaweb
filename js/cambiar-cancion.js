/**
 * cambiar-cancion.js — Elegir la canción que reemplaza a otra en un cancionero ya hecho (emergencias), en el
 * reproductor y en Misas.
 *
 *  elegirReemplazo({ biblioteca, momento, actual, fechaUso, tiempoLiturgico, celebracion, lecturas, misas })
 *    → Promise con el cancionId elegido, o null si se cierra sin elegir.
 *  Primero «Para este momento» (ordenadas por js/liturgia.js candidatosMomento: el tiempo litúrgico, la
 *  celebración…), después un buscador y toda la Biblioteca. Se toca una canción y listo.
 *
 * Usa buscarCanciones de editor/js/buscar.js (script clásico cargado antes).
 */

import { candidatosMomento } from "./liturgia.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const PASO = 60;

let dlg = null, estado = null;

function dialogo() {
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.className = "dlg-cambiar";
  dlg.innerHTML = `
    <div class="cc-cabeza">
      <h2 class="cc-titulo"></h2>
      <button type="button" class="cc-cerrar" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <div class="cc-buscar"><input type="search" placeholder="Buscar por título, autor o letra…" aria-label="Buscar en la Biblioteca" autocomplete="off"></div>
    <div class="cc-cuerpo"></div>`;
  dlg.querySelector("[data-cerrar]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => {
    const r = estado?.resolver;
    const elegida = estado?.elegida ?? null;
    estado = null;
    r?.(elegida);
  });
  dlg.querySelector("input").addEventListener("input", () => {
    if (!estado) return;
    estado.max = PASO;
    pintar();
  });
  dlg.querySelector(".cc-cuerpo").addEventListener("click", (e) => {
    const b = e.target.closest("[data-elegir], [data-mas]");
    if (!b || !estado) return;
    if (b.dataset.mas != null) {
      estado.max += PASO;
      pintar();
      return;
    }
    estado.elegida = b.dataset.elegir;
    dlg.close();
  });
  document.body.append(dlg);
  return dlg;
}

const fila = (x, actual) => {
  const c = x.cancion, es = c.id === actual;
  const sub = [c.letraDe || c.musicaDe || "", (c.etiquetas || []).slice(0, 4).join(" · ")].filter(Boolean).join(" — ");
  return `<li><button type="button" class="cc-fila${es ? " actual" : ""}" data-elegir="${esc(c.id)}"${es ? " disabled" : ""}>
    <b>${esc(c.titulo || "Sin título")}</b>${es ? " <em>(la de ahora)</em>" : ""}<small>${esc(sub)}</small></button></li>`;
};

function pintar() {
  const cuerpo = dlg.querySelector(".cc-cuerpo");
  const q = dlg.querySelector("input").value.trim();
  const { lista, actual, momento } = estado;
  let html = "";
  if (q) {
    const porCancion = new Map(lista.map((x) => [x.cancion, x]));
    const halladas = (typeof buscarCanciones === "function" ? buscarCanciones(lista.map((x) => x.cancion), q) : []).map((c) => porCancion.get(c));
    html = halladas.length ? `<h3>Resultados <small>${halladas.length}</small></h3><ul class="cc-lista">${halladas.slice(0, estado.max).map((x) => fila(x, actual)).join("")}</ul>`
      : `<p class="cc-nada">No hay canciones con «${esc(q)}».</p>`;
    if (halladas.length > estado.max) html += `<button type="button" class="cc-mas" data-mas>Ver más</button>`;
  } else {
    const del = lista.filter((x) => x.delMomento), resto = lista.filter((x) => !x.delMomento);
    if (del.length) html += `<h3>Para ${esc(momento || "este momento")} <small>${del.length}</small></h3><ul class="cc-lista">${del.slice(0, estado.max).map((x) => fila(x, actual)).join("")}</ul>`;
    const quedan = Math.max(0, estado.max - del.length);
    if (quedan || !del.length) {
      html += `<h3>Toda la Biblioteca <small>${resto.length}</small></h3><ul class="cc-lista">${resto.slice(0, quedan || PASO).map((x) => fila(x, actual)).join("")}</ul>`;
    }
    if (del.length + resto.length > estado.max) html += `<button type="button" class="cc-mas" data-mas>Ver más</button>`;
  }
  cuerpo.innerHTML = html;
}

export function elegirReemplazo({ biblioteca = [], momento = "", actual = null, fechaUso = "", tiempoLiturgico = "", celebracion = "", lecturas = null, misas = [] } = {}) {
  const d = dialogo();
  // Otro pedido con el diálogo abierto: el anterior queda sin elegir y el diálogo sigue abierto
  estado?.resolver(null);
  const vieja = biblioteca.find((c) => c.id === actual);
  d.querySelector(".cc-titulo").textContent = (vieja ? `Cambiar «${vieja.titulo}»` : "Elegir canción") + (momento ? " · " + momento : "");
  d.querySelector("input").value = "";
  return new Promise((resolver) => {
    estado = {
      resolver, actual, momento, max: PASO, elegida: null,
      lista: candidatosMomento(biblioteca, momento, { fechaUso, tiempoLiturgico, celebracion, lecturas, misas })
    };
    pintar();
    if (!d.open) d.showModal();
    d.querySelector(".cc-cuerpo").scrollTop = 0;
    if (matchMedia("(pointer: fine)").matches) d.querySelector("input").focus();
  });
}
