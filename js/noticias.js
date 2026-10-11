/**
 * Noticias tipo blog de la parroquia y de cada comunidad: se leen y se publican en el servidor
 * (acciones noticias, guardarNoticia y borrarNoticia). Quien puede editar en la comunidad las publica,
 * cambia o quita desde la misma página.
 */

import { llamarApi, puedeEditar, sesionActual } from "./auth.js";
import { COMUNIDADES, PARROQUIA, comunidadPorSlug, rutaBase } from "./comunidades.js";

const config = () => window.MONTECARMELO_CONFIG || {};
const token = () => (sesionActual() || {}).token || "";

export async function cargarNoticias(comunidad) {
  const api = config().apiUrl;
  if (!api) throw new Error("El servidor de la parroquia todavía no está conectado.");
  let r;
  try {
    r = await (await fetch(api + "?" + new URLSearchParams({ accion: "noticias", comunidad: comunidad || "" }), { cache: "no-store" })).json();
  } catch (_) {
    throw new Error("No se pudo consultar el servidor de la parroquia. Probá recargar la página.");
  }
  if (!r.ok) throw new Error(r.error || "El servidor de la parroquia no respondió");
  return r.noticias || [];
}

/** `acciones`: { alCambiar(noticia), alQuitar(noticia) } para mostrar los botones a quien puede editar. */
export function pintarNoticias(contenedor, items, acciones) {
  if (!contenedor) return;
  contenedor.replaceChildren();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "subtitulo";
    p.textContent = "Todavía no hay noticias publicadas.";
    contenedor.appendChild(p);
    return;
  }
  items.forEach((it, i) => {
    const art = document.createElement("article");
    art.className = "noticia";
    art.style.animationDelay = i * 0.05 + "s";
    const h = document.createElement("h2");
    h.textContent = it.titulo || "Sin título";
    const meta = document.createElement("p");
    meta.className = "noticia-meta";
    (Array.isArray(it.etiquetas) ? it.etiquetas : []).forEach((t) => {
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
    if (acciones && puedeEditar(it.comunidad)) {
      const botones = document.createElement("div");
      botones.className = "acciones-form";
      const cambiar = document.createElement("button");
      cambiar.type = "button";
      cambiar.className = "btn btn-secundario";
      cambiar.textContent = "Cambiar";
      cambiar.addEventListener("click", () => acciones.alCambiar(it));
      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.className = "btn btn-secundario";
      quitar.textContent = "Quitar";
      quitar.addEventListener("click", () => acciones.alQuitar(it));
      botones.append(cambiar, quitar);
      art.appendChild(botones);
    }
    contenedor.appendChild(art);
  });
}

/**
 * Lista + panel de edición en la página de una comunidad o en las noticias de la parroquia.
 * @param {{ slug: string }} opts  slug de la comunidad, o "parroquia"
 */
export async function iniciarPaginaNoticias(opts) {
  const slug = opts.slug;
  const listaEl = document.getElementById("lista-noticias");
  const panel = document.getElementById("panel-edicion");
  const sesionBar = document.getElementById("sesion-bar");
  const form = document.getElementById("form-noticia");
  const drop = document.getElementById("zona-drop-noticia");
  const msg = document.getElementById("msg-publicar");
  const boton = form && form.querySelector('button[type="submit"]');
  const campo = (id) => document.getElementById(id);
  const editable = puedeEditar(slug) && !!token();
  let enEdicion = null;
  let items = [];

  const avisar = (texto, error) => {
    if (!msg) return;
    msg.hidden = !texto;
    msg.className = error ? "msg-error" : "msg-ok";
    msg.textContent = texto || "";
  };

  const limpiar = () => {
    enEdicion = null;
    if (!form) return;
    form.reset();
    campo("campo-fecha").value = new Date().toISOString().slice(0, 10);
    if (boton) boton.textContent = "Publicar";
  };

  const acciones = editable ? {
    alCambiar(n) {
      enEdicion = n;
      campo("campo-titulo").value = n.titulo || "";
      campo("campo-fecha").value = n.fecha || "";
      campo("campo-etiquetas").value = (n.etiquetas || []).join(", ");
      campo("campo-cuerpo").value = n.cuerpo || "";
      if (boton) boton.textContent = "Guardar cambios";
      avisar("");
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      campo("campo-titulo").focus();
    },
    async alQuitar(n) {
      if (!confirm(`¿Quitar la noticia «${n.titulo}»?`)) return;
      try {
        await llamarApi("borrarNoticia", { token: token(), id: n.id });
        items = items.filter((x) => x.id !== n.id);
        pintarNoticias(listaEl, items, acciones);
        if (enEdicion && enEdicion.id === n.id) limpiar();
      } catch (err) {
        alert(err.message);
      }
    }
  } : null;

  try {
    items = await cargarNoticias(slug);
    pintarNoticias(listaEl, items, acciones);
  } catch (err) {
    if (listaEl) listaEl.innerHTML = `<p class="subtitulo"></p>`;
    if (listaEl) listaEl.firstChild.textContent = err.message;
  }

  if (sesionBar) {
    const s = sesionActual();
    sesionBar.hidden = false;
    if (s) {
      sesionBar.innerHTML = "Sesión: <strong></strong> (" + s.rol + ")" +
        (editable ? " · podés publicar aquí" : " · sin permiso para publicar en esta página");
      sesionBar.querySelector("strong").textContent = s.nombre || s.email;
    } else {
      sesionBar.innerHTML = 'Para publicar noticias, <a href="' + rutaBase() + 'login.html">identificate</a>.';
    }
  }
  if (panel) panel.hidden = !editable;
  if (!editable || !form) return;
  limpiar();

  const campoCuerpo = campo("campo-cuerpo");
  if (drop && campoCuerpo) {
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("sobre"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("sobre"); }));
    drop.addEventListener("drop", async (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      campoCuerpo.value = await file.text();
      const titulo = campo("campo-titulo");
      if (titulo && !titulo.value.trim()) titulo.value = file.name.replace(/\.txt$/i, "").replace(/[_-]+/g, " ");
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    avisar("");
    const noticia = {
      id: enEdicion ? enEdicion.id : undefined,
      comunidad: slug,
      titulo: (campo("campo-titulo").value || "").trim(),
      fecha: campo("campo-fecha").value || new Date().toISOString().slice(0, 10),
      etiquetas: String(campo("campo-etiquetas").value || "").split(/[,;]+/).map((x) => x.trim()).filter(Boolean),
      cuerpo: (campoCuerpo && campoCuerpo.value) || ""
    };
    if (!noticia.titulo) return avisar("Falta el título", true);
    if (boton) boton.disabled = true;
    try {
      const r = await llamarApi("guardarNoticia", { token: token(), noticia });
      items = [r.noticia, ...items.filter((x) => x.id !== r.noticia.id)]
        .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
      pintarNoticias(listaEl, items, acciones);
      avisar(enEdicion ? "Cambios guardados." : "Publicada.");
      limpiar();
    } catch (err) {
      avisar(err.message || "No se pudo publicar", true);
    } finally {
      if (boton) boton.disabled = false;
    }
  });
}

export async function iniciarListaCancioneros(opts) {
  const el = document.getElementById("lista-cancioneros");
  if (!el) return;
  const comu = comunidadPorSlug(opts.slug);
  if (!comu) return;
  const api = config().apiUrl;
  let entradas = [];
  let aviso = "Aún no hay cancioneros publicados. Los directores los guardan desde el editor con «Guardar en la nube».";
  if (!api) {
    aviso = "El servidor de la parroquia todavía no está conectado.";
  } else {
    try {
      const r = await (await fetch(api + "?accion=listar&comunidad=" + encodeURIComponent(opts.slug))).json();
      entradas = r.cancioneros || [];
    } catch (_) {
      aviso = "No se pudo consultar el servidor de la parroquia. Probá recargar la página.";
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
    a.href = rutaBase() + "ver?id=" + encodeURIComponent(c.htmlId);
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
      ed.href = "/editor/?drive=" + encodeURIComponent(c.folderId);
      ed.textContent = "Editar";
      li.appendChild(ed);
    }
    ul.appendChild(li);
  });
  el.appendChild(ul);
}

export async function iniciarListaMisas(opts) {
  const el = document.getElementById("lista-misas");
  if (!el) return;
  const api = config().apiUrl;
  const base = rutaBase() + "misas?comunidad=" + encodeURIComponent(opts.slug);
  let misas = [];
  let aviso = "Todavía no hay cancioneros de misa para esta comunidad.";
  if (!api) {
    aviso = "El servidor de la parroquia todavía no está conectado.";
  } else {
    try {
      const r = await (await fetch(api + "?accion=misas&comunidad=" + encodeURIComponent(opts.slug))).json();
      misas = r.misas || [];
    } catch (_) {
      aviso = "No se pudo consultar el servidor de la parroquia. Probá recargar la página.";
    }
  }
  el.replaceChildren();
  if (!misas.length) {
    const p = document.createElement("p");
    p.className = "subtitulo";
    p.textContent = aviso + " ";
    const a = document.createElement("a");
    a.href = base;
    a.textContent = "Abrir la pantalla Misas";
    p.appendChild(a);
    el.appendChild(p);
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "lista-cancioneros";
  misas.forEach((m) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = base + "&cancionero=" + encodeURIComponent(m.id);
    a.textContent = m.nombre || "Cancionero";
    const n = (m.momentos || []).reduce((t, x) => t + (x.canciones || []).length, 0);
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = [m.fechaUso, m.tiempoLiturgico, n ? n + (n === 1 ? " canción" : " canciones") : ""].filter(Boolean).join(" · ");
    a.appendChild(meta);
    li.appendChild(a);
    ul.appendChild(li);
  });
  el.appendChild(ul);
}

/** Enlaces a las páginas de las comunidades (en Noticias). */
export function pintarEnlacesComunidades(contenedor) {
  if (!contenedor) return;
  contenedor.replaceChildren();
  COMUNIDADES.forEach((c, i) => {
    if (i) contenedor.appendChild(document.createTextNode(" · "));
    const a = document.createElement("a");
    a.href = "./comunidad?c=" + encodeURIComponent(c.slug);
    a.textContent = c.nombre;
    contenedor.appendChild(a);
  });
}

export { COMUNIDADES, PARROQUIA };
