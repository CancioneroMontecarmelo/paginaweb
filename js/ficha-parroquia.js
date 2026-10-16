/**
 * ficha-parroquia.js — La ficha de una parroquia o movimiento: tipo, diócesis, dirección en el mapa, sitio web,
 * galería de fotos (hasta 12) y la ubicación y foto de cada capilla, comunidad o grupo.
 *
 *  - Galería y extras de comunidad: Identificarse → Datos de la parroquia.
 *  - Tipo, mapa y sacerdote: panel Parroquias → Configurar (solo admin_general); seccionFicha queda por si se reutiliza.
 *  - Para todos (Inicio y Comunidad): pintarFichaPublica, con la galería y el mapa.
 * Las fotos se achican en el navegador (1600 px, JPG o WebP) antes de subirlas a /api/subir?tipo=foto.
 */

import { llamarApi, subirBinario, sesionActual } from "./auth.js";
import { elegirUbicacion, mostrarMapa } from "./mapa.js";

const token = () => (sesionActual() || {}).token || "";

export const CLASES = { capilla: "Capilla", comunidad: "Comunidad", grupo: "Grupo" };
export const TIPOS = { parroquia: "Parroquia", movimiento: "Movimiento o comunidad laical" };

function el(tag, props, ...hijos) {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...hijos.filter((h) => h !== null && h !== undefined));
  return e;
}

const campo = (etiqueta, control) => el("label", { className: "campo-admin" }, el("span", { textContent: etiqueta }), control);

function aviso(p, texto, error) {
  p.hidden = !texto;
  p.className = error ? "msg-error" : "msg-ok";
  p.textContent = texto || "";
}

function cargarImagen(archivo) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error("No se pudo leer la imagen. Probá con un JPG o PNG."));
    img.src = url;
  });
}

const webpSirve = (() => {
  try {
    return document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
  } catch (_) {
    return false;
  }
})();

/** La foto achicada a `max` px de lado mayor, en WebP (o JPG donde no hay WebP). */
export async function fotoLiviana(archivo, max = 1600) {
  const img = await cargarImagen(archivo);
  const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = el("canvas", { width: Math.round(img.naturalWidth * escala), height: Math.round(img.naturalHeight * escala) });
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const tipo = webpSirve ? "image/webp" : "image/jpeg";
  return new Promise((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la foto"))), tipo, 0.82));
}

/** Sube una foto (de la galería o de una comunidad): devuelve la respuesta del servidor ({ foto, parroquia }). */
export async function subirFoto(archivo, params = {}) {
  const blob = await fotoLiviana(archivo);
  return subirBinario("foto", { mime: blob.type, ...params }, blob);
}

const textoUbicacion = (x) => [x.direccion, x.comuna, x.region].filter(Boolean).join(", ");

// ==================== RESPONSABLES ====================

/** Tipo, diócesis, sitio web y dirección en el mapa. `p()` da la parroquia actual; `listo(nueva)` al guardar. */
export function seccionFicha(p, listo) {
  const x = p();
  const tipo = el("select", {}, ...Object.entries(TIPOS).map(([v, t]) => el("option", { value: v, textContent: t, selected: (x.tipo || "parroquia") === v })));
  const diocesis = el("input", { maxLength: 100, value: x.diocesis || "", placeholder: "Arquidiócesis de Santiago" });
  const sitioWeb = el("input", { type: "url", maxLength: 300, value: x.sitioWeb || "", placeholder: "https://www.miparroquia.cl" });
  const caja = el("div", { className: "ficha-ubicacion" });
  const msg = el("p", { hidden: true });
  const guardar = el("button", { type: "submit", className: "btn btn-primario", textContent: "Guardar ubicación" });
  let ubic = null;
  elegirUbicacion(caja, { direccion: x.direccion, comuna: x.comuna, region: x.region, lat: x.lat, lng: x.lng })
    .then((u) => (ubic = u))
    .catch((err) => aviso(msg, err.message, true));
  const form = el("form", { className: "form-noticia form-admin" },
    campo("Es una…", tipo), campo("Diócesis", diocesis), campo("Sitio web propio (si tiene)", sitioWeb),
    el("span", { className: "campo-admin" }, el("span", { textContent: "Dirección (aparece en el mapa del Cancionero)" })), caja,
    el("div", { className: "acciones-form" }, guardar), msg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    guardar.disabled = true;
    aviso(msg, "Guardando…");
    try {
      const u = ubic ? ubic.valor() : {};
      const r = await llamarApi("guardarParroquia", {
        token: token(),
        parroquia: { tipo: tipo.value, diocesis: diocesis.value, sitioWeb: sitioWeb.value, ...u }
      });
      listo(r.parroquia);
      aviso(msg, "Guardado ✓" + (r.parroquia.lat == null ? " (sin punto en el mapa: buscá la dirección o tocá el lugar)" : ""));
    } catch (err) {
      aviso(msg, err.message, true);
    }
    guardar.disabled = false;
  });
  form.medir = () => ubic && ubic.medir();
  return form;
}

/** La galería: subir varias, escribir el pie, ordenar, usar de portada y quitar. */
export function seccionGaleria(p, listo) {
  const grilla = el("ul", { className: "galeria-admin" });
  const archivo = el("input", { type: "file", accept: "image/*", multiple: true });
  const msg = el("p", { hidden: true });

  const guardarLista = async (fotos, extra, okTexto) => {
    aviso(msg, "Guardando…");
    try {
      const r = await llamarApi("guardarParroquia", { token: token(), parroquia: { fotos, ...(extra || {}) } });
      listo(r.parroquia);
      pintar();
      aviso(msg, okTexto);
    } catch (err) {
      aviso(msg, err.message, true);
    }
  };

  function pintar() {
    const fotos = p().fotos || [];
    if (!fotos.length) {
      grilla.replaceChildren(el("li", { className: "aviso", textContent: "Todavía no hay fotos. Subí la del templo, la capilla o la comunidad reunida." }));
      return;
    }
    const lista = () => fotos.map((f) => ({ id: f.id, pie: f.pie }));
    grilla.replaceChildren(...fotos.map((f, i) => {
      const pie = el("input", { value: f.pie || "", maxLength: 200, placeholder: "Pie de foto (opcional)" });
      pie.addEventListener("change", () => {
        const l = lista();
        l[i].pie = pie.value.trim();
        guardarLista(l, null, "Pie guardado ✓");
      });
      const mover = (d) => {
        const l = lista();
        l.splice(i + d, 0, l.splice(i, 1)[0]);
        guardarLista(l, null, "Orden guardado ✓");
      };
      const izq = el("button", { type: "button", className: "btn-chico", textContent: "←", title: "Antes", disabled: i === 0 });
      const der = el("button", { type: "button", className: "btn-chico", textContent: "→", title: "Después", disabled: i === fotos.length - 1 });
      const esPortada = p().portada === f.url;
      const portada = el("button", { type: "button", className: "btn-chico", textContent: esPortada ? "Portada ✓" : "Usar de portada", disabled: esPortada });
      const quitar = el("button", { type: "button", className: "btn-chico", textContent: "Quitar" });
      izq.addEventListener("click", () => mover(-1));
      der.addEventListener("click", () => mover(1));
      portada.addEventListener("click", () => guardarLista(lista(), { portada: f.url }, "Portada cambiada ✓"));
      quitar.addEventListener("click", () => {
        if (confirm("¿Quitar esta foto? Se borra del Cancionero.")) guardarLista(lista().filter((y) => y.id !== f.id), null, "Foto quitada ✓");
      });
      return el("li", {}, el("img", { src: f.url, alt: f.pie || "", loading: "lazy" }), pie, el("div", { className: "galeria-botones" }, izq, der, portada, quitar));
    }));
  }

  archivo.addEventListener("change", async () => {
    const lista = Array.from(archivo.files || []);
    if (!lista.length) return;
    archivo.disabled = true;
    try {
      for (let i = 0; i < lista.length; i++) {
        aviso(msg, "Subiendo " + (lista.length > 1 ? "la foto " + (i + 1) + " de " + lista.length : "la foto") + "…");
        const r = await subirFoto(lista[i]);
        listo(r.parroquia);
        pintar();
      }
      aviso(msg, lista.length > 1 ? "Fotos subidas ✓" : "Foto subida ✓");
    } catch (err) {
      aviso(msg, err.message, true);
    }
    archivo.disabled = false;
    archivo.value = "";
  });
  pintar();
  return el("div", { className: "galeria-seccion" }, grilla, campo("Subir fotos (se achican solas; hasta 12)", archivo), msg);
}

/** Bajo el nombre de cada comunidad: si es capilla, comunidad o grupo, su dirección en el mapa y su foto. */
export function extrasComunidad(c, listo, msgCom) {
  const clase = el("select", { title: "Qué es" }, ...Object.entries(CLASES).map(([v, t]) => el("option", { value: v, textContent: t, selected: (c.clase || "comunidad") === v })));
  const resumen = el("span", { className: "aviso", textContent: textoUbicacion(c) || "sin dirección" });
  const abrir = el("button", { type: "button", className: "btn-chico", textContent: "Dirección y foto" });
  const panel = el("div", { className: "comunidad-ficha", hidden: true });
  const guardarCom = async (datos, ok) => {
    aviso(msgCom, "Guardando…");
    try {
      const r = await llamarApi("guardarComunidad", { token: token(), comunidad: { slug: c.slug, nombre: c.nombre, ...datos } });
      listo(r.parroquia);
      aviso(msgCom, ok);
      return r.parroquia;
    } catch (err) {
      aviso(msgCom, err.message, true);
      return null;
    }
  };
  clase.addEventListener("change", () => guardarCom({ clase: clase.value }, "Guardado ✓"));
  let armado = false, ubic = null;
  abrir.addEventListener("click", async () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    if (armado) { if (ubic) ubic.medir(); return; }
    armado = true;
    const mapa = el("div");
    const guardar = el("button", { type: "button", className: "btn btn-secundario", textContent: "Guardar dirección" });
    const foto = el("img", { className: "comunidad-foto", alt: "", hidden: !c.foto, src: c.foto || "" });
    const archivo = el("input", { type: "file", accept: "image/*" });
    const quitarFoto = el("button", { type: "button", className: "btn-chico", textContent: "Quitar foto", hidden: !c.foto });
    panel.append(mapa, el("div", { className: "acciones-form" }, guardar),
      el("div", { className: "fila-imagen" }, foto, campo("Foto de la " + (CLASES[c.clase] || "comunidad").toLowerCase(), archivo), quitarFoto));
    guardar.addEventListener("click", async () => {
      const u = ubic ? ubic.valor() : {};
      const nueva = await guardarCom(u, "Dirección guardada ✓");
      if (nueva) resumen.textContent = textoUbicacion(u) || "sin dirección";
    });
    archivo.addEventListener("change", async () => {
      const f = archivo.files && archivo.files[0];
      if (!f) return;
      archivo.disabled = true;
      aviso(msgCom, "Subiendo la foto…");
      try {
        const r = await subirFoto(f, { comunidad: c.slug });
        listo(r.parroquia);
        foto.src = r.foto.url;
        foto.hidden = quitarFoto.hidden = false;
        aviso(msgCom, "Foto guardada ✓");
      } catch (err) {
        aviso(msgCom, err.message, true);
      }
      archivo.disabled = false;
      archivo.value = "";
    });
    quitarFoto.addEventListener("click", async () => {
      if (!confirm("¿Quitar la foto?")) return;
      try {
        const r = await llamarApi("quitarFotoComunidad", { token: token(), comunidad: c.slug });
        listo(r.parroquia);
        foto.hidden = quitarFoto.hidden = true;
        aviso(msgCom, "Foto quitada ✓");
      } catch (err) {
        aviso(msgCom, err.message, true);
      }
    });
    try {
      ubic = await elegirUbicacion(mapa, { direccion: c.direccion, comuna: c.comuna, region: c.region, lat: c.lat, lng: c.lng });
    } catch (err) {
      aviso(msgCom, err.message, true);
    }
  });
  return el("div", { className: "comunidad-extras" }, clase, " ", abrir, " ", resumen, panel);
}

// ==================== PARA TODOS ====================

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function abrirFoto(fotos, i) {
  const d = el("dialog", { className: "dlg-foto" });
  const img = el("img", { alt: "" });
  const pie = el("p");
  const ir = (n) => {
    i = (n + fotos.length) % fotos.length;
    img.src = fotos[i].url;
    img.alt = fotos[i].pie || "";
    pie.textContent = fotos[i].pie || "";
    pie.hidden = !fotos[i].pie;
  };
  const cerrar = el("button", { type: "button", className: "dlg-foto-cerrar", textContent: "✕", ariaLabel: "Cerrar" });
  const ant = el("button", { type: "button", className: "dlg-foto-ant", textContent: "‹", ariaLabel: "Anterior", hidden: fotos.length < 2 });
  const sig = el("button", { type: "button", className: "dlg-foto-sig", textContent: "›", ariaLabel: "Siguiente", hidden: fotos.length < 2 });
  cerrar.addEventListener("click", () => d.close());
  ant.addEventListener("click", () => ir(i - 1));
  sig.addEventListener("click", () => ir(i + 1));
  d.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") ir(i - 1); if (e.key === "ArrowRight") ir(i + 1); });
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  d.addEventListener("close", () => d.remove());
  d.append(img, pie, ant, sig, cerrar);
  document.body.append(d);
  ir(i);
  d.showModal();
}

/**
 * Galería, dirección y mapa. datos: la parroquia pública (window.MC_PARROQUIA). comunidad: el slug si es la página
 * de una comunidad (su foto y su punto, con el de la parroquia).
 */
export function pintarFichaPublica(contenedor, datos, comunidad) {
  if (!contenedor || !datos) return;
  const com = comunidad ? (datos.comunidades || []).find((x) => x.slug === comunidad) : null;
  const fotos = com ? (com.foto ? [{ url: com.foto, pie: com.nombre }] : []) : (datos.fotos || []);
  const centro = com && com.lat != null ? com : datos;
  const puntos = [];
  if (datos.lat != null) puntos.push({ lat: datos.lat, lng: datos.lng, titulo: datos.nombre, subtitulo: textoUbicacion(datos), tipo: datos.tipo, grande: true, foto: datos.foto });
  for (const x of datos.comunidades || []) {
    if (x.lat == null) continue;
    puntos.push({ lat: x.lat, lng: x.lng, titulo: x.nombre, subtitulo: (CLASES[x.clase] || "") + (x.direccion ? " · " + x.direccion : ""), tipo: x.clase,
      foto: x.foto, href: "./comunidad?c=" + encodeURIComponent(x.slug), textoEnlace: "Ver la comunidad", grande: com && com.slug === x.slug });
  }
  if (!fotos.length && !puntos.length) {
    contenedor.hidden = true;
    return;
  }
  contenedor.hidden = false;
  const comoLlegar = centro.lat != null
    ? `https://www.openstreetmap.org/directions?to=${centro.lat}%2C${centro.lng}#map=17/${centro.lat}/${centro.lng}` : "";
  const gmaps = centro.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${centro.lat},${centro.lng}` : "";
  contenedor.innerHTML = `
    ${fotos.length ? `<ul class="galeria">${fotos.map((f, i) => `<li><button type="button" data-foto="${i}" aria-label="Ver la foto${f.pie ? ": " + esc(f.pie) : ""}">
      <img src="${esc(f.url)}" alt="${esc(f.pie || "")}" loading="lazy"></button>${f.pie ? `<span>${esc(f.pie)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    ${puntos.length ? `<div class="ficha-lugar">
      <p class="ficha-direccion">${esc(textoUbicacion(centro) || "")}${datos.diocesis && !com ? `<br><small>${esc(datos.diocesis)}</small>` : ""}</p>
      <p class="ficha-llegar">${gmaps ? `<a class="btn btn-secundario" href="${gmaps}" target="_blank" rel="noopener">Cómo llegar (Google Maps)</a> ` : ""}${comoLlegar ? `<a class="btn btn-secundario" href="${comoLlegar}" target="_blank" rel="noopener">OpenStreetMap</a>` : ""}${datos.sitioWeb && !com ? ` <a class="btn btn-secundario" href="${esc(datos.sitioWeb)}" target="_blank" rel="noopener">Sitio web</a>` : ""}</p>
      <div class="ficha-mapa" aria-label="Mapa"></div></div>` : ""}`;
  contenedor.querySelectorAll("[data-foto]").forEach((b) => b.addEventListener("click", () => abrirFoto(fotos, +b.dataset.foto)));
  const caja = contenedor.querySelector(".ficha-mapa");
  if (!caja) return;
  // El mapa se arma cuando se va a ver (Leaflet y los mosaicos no se bajan si nadie llega hasta acá)
  const armar = () => mostrarMapa(caja, puntos, { zoomUno: 16 }).then((m) => { if (centro.lat != null && com) m.setView([centro.lat, centro.lng], 16); }).catch(() => (caja.hidden = true));
  if (!("IntersectionObserver" in window)) return armar();
  const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io.disconnect(); armar(); } }, { rootMargin: "300px" });
  io.observe(caja);
}
