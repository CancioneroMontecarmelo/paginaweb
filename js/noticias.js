/**
 * Noticias tipo blog: lectura de JSON, DnD de .txt, publicación (descarga / FS).
 */

import { puedeEditar, sesionActual } from "./auth.js";
import { COMUNIDADES, PARROQUIA, comunidadPorSlug, rutaBase } from "./comunidades.js";

export function noticiasVacias(comunidad) {
  return {
    comunidad: comunidad || "parroquia",
    actualizado: new Date().toISOString(),
    items: []
  };
}

export async function cargarNoticias(archivo) {
  const url = rutaBase() + "noticias/" + archivo;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return noticiasVacias();
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) return noticiasVacias(data && data.comunidad);
    return data;
  } catch (_) {
    return noticiasVacias();
  }
}

export function pintarNoticias(contenedor, data) {
  if (!contenedor) return;
  contenedor.replaceChildren();
  const items = (data && data.items) || [];
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "subtitulo";
    p.textContent = "Todavía no hay noticias publicadas.";
    contenedor.appendChild(p);
    return;
  }
  const orden = items.slice().sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  orden.forEach((it, i) => {
    const art = document.createElement("article");
    art.className = "noticia";
    art.style.animationDelay = i * 0.05 + "s";
    const h = document.createElement("h2");
    h.textContent = it.titulo || "Sin título";
    const meta = document.createElement("p");
    meta.className = "noticia-meta";
    const tags = Array.isArray(it.etiquetas) ? it.etiquetas : [];
    tags.forEach((t) => {
      const span = document.createElement("span");
      span.className = "etiqueta";
      span.textContent = t;
      meta.appendChild(span);
    });
    meta.appendChild(document.createTextNode(it.fecha || ""));
    if (it.autor) meta.appendChild(document.createTextNode(" · " + it.autor));
    const cuerpo = document.createElement("p");
    cuerpo.className = "noticia-cuerpo";
    cuerpo.textContent = it.cuerpo || "";
    art.append(h, meta, cuerpo);
    contenedor.appendChild(art);
  });
}

function descargarJson(nombre, objeto) {
  const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function guardarConPicker(nombre, objeto) {
  if (typeof window.showSaveFilePicker !== "function") {
    descargarJson(nombre, objeto);
    return "descarga";
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: nombre,
      id: "montecarmelo-noticias"
    });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(objeto, null, 2));
    await writable.close();
    return "archivo";
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    descargarJson(nombre, objeto);
    return "descarga";
  }
}

/**
 * Inicializa lista + panel de edición en una página de comunidad o noticias parroquiales.
 * @param {{ slug: string, archivo: string, nombreArchivo?: string }} opts
 */
export async function iniciarPaginaNoticias(opts) {
  const slug = opts.slug;
  const archivo = opts.archivo;
  const listaEl = document.getElementById("lista-noticias");
  const panel = document.getElementById("panel-edicion");
  const sesionBar = document.getElementById("sesion-bar");
  const form = document.getElementById("form-noticia");
  const drop = document.getElementById("zona-drop-noticia");
  const msg = document.getElementById("msg-publicar");

  let data = await cargarNoticias(archivo);
  pintarNoticias(listaEl, data);

  const editable = puedeEditar(slug === "parroquia" ? "parroquia" : slug);
  if (sesionBar) {
    const s = sesionActual();
    if (s) {
      sesionBar.hidden = false;
      sesionBar.innerHTML =
        "Sesión: <strong>" +
        (s.nombre || s.usuario) +
        "</strong> (" +
        s.rol +
        ")" +
        (editable ? " · podés publicar aquí" : " · sin permiso de edición en esta página");
    } else {
      sesionBar.hidden = false;
      sesionBar.innerHTML =
        'Para publicar noticias, <a href="' + rutaBase() + 'login.html">identificate</a>.';
    }
  }
  if (panel) panel.hidden = !editable;
  if (!editable || !form) return;

  const campoCuerpo = document.getElementById("campo-cuerpo");

  if (drop && campoCuerpo) {
    ["dragenter", "dragover"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("sobre");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("sobre");
      });
    });
    drop.addEventListener("drop", async (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      const texto = await file.text();
      campoCuerpo.value = texto;
      const titulo = document.getElementById("campo-titulo");
      if (titulo && !titulo.value.trim()) {
        titulo.value = file.name.replace(/\.txt$/i, "").replace(/[_-]+/g, " ");
      }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msg) {
      msg.hidden = true;
      msg.className = "msg-ok";
    }
    const s = sesionActual();
    const item = {
      id: "n-" + Date.now(),
      titulo: (document.getElementById("campo-titulo").value || "").trim(),
      fecha: document.getElementById("campo-fecha").value || new Date().toISOString().slice(0, 10),
      etiquetas: String(document.getElementById("campo-etiquetas").value || "")
        .split(/[,;]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      cuerpo: (campoCuerpo && campoCuerpo.value) || "",
      autor: (s && (s.nombre || s.usuario)) || ""
    };
    if (!item.titulo) {
      if (msg) {
        msg.hidden = false;
        msg.className = "msg-error";
        msg.textContent = "Falta el título";
      }
      return;
    }
    data.items = data.items || [];
    data.items.unshift(item);
    data.actualizado = new Date().toISOString();
    data.comunidad = slug;
    const nombre = opts.nombreArchivo || archivo;
    try {
      const modo = await guardarConPicker(nombre, data);
      pintarNoticias(listaEl, data);
      form.reset();
      if (msg) {
        msg.hidden = false;
        msg.className = "msg-ok";
        msg.textContent =
          modo === "archivo"
            ? "Guardado. Asegurate de reemplazar noticias/" + nombre + " en el proyecto."
            : "Se descargó " + nombre + ". Copialo a la carpeta noticias/ y volvé a publicar el sitio.";
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (msg) {
        msg.hidden = false;
        msg.className = "msg-error";
        msg.textContent = err.message || "No se pudo publicar";
      }
    }
  });
}

export async function iniciarListaCancioneros(opts) {
  const el = document.getElementById("lista-cancioneros");
  if (!el) return;
  const comu = comunidadPorSlug(opts.slug);
  if (!comu) return;
  const api = (window.MONTECARMELO_CONFIG || {}).apiUrl;
  let entradas = [];
  let aviso = "Aún no hay cancioneros publicados. Los directores los guardan desde el editor con «Guardar en Drive».";
  if (!api) {
    aviso = "El Drive de la parroquia todavía no está conectado.";
  } else {
    try {
      const r = await (await fetch(api + "?accion=listar&comunidad=" + encodeURIComponent(opts.slug))).json();
      entradas = r.cancioneros || [];
    } catch (_) {
      aviso = "No se pudo consultar el Drive de la parroquia. Probá recargar la página.";
    }
  }
  el.replaceChildren();
  if (!entradas.length) {
    const p = document.createElement("p");
    p.className = "subtitulo";
    p.textContent = aviso;
    el.appendChild(p);
    return;
  }
  const editable = puedeEditar(opts.slug);
  const ul = document.createElement("ul");
  ul.className = "lista-cancioneros";
  entradas.forEach((c) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = rutaBase() + "ver.html?id=" + encodeURIComponent(c.htmlId);
    a.textContent = c.titulo || "Cancionero";
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = [c.fecha, c.canciones ? c.canciones + " canciones" : "", c.comentario].filter(Boolean).join(" · ");
    a.appendChild(meta);
    li.appendChild(a);
    if (editable) {
      const ed = document.createElement("a");
      ed.className = "btn btn-secundario";
      ed.style.marginTop = "0.35rem";
      ed.href = rutaBase() + "editor/?drive=" + encodeURIComponent(c.folderId);
      ed.textContent = "Editar";
      li.appendChild(ed);
    }
    ul.appendChild(li);
  });
  el.appendChild(ul);
}

export { COMUNIDADES, PARROQUIA };
