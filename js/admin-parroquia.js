/**
 * Ventanas del panel de Identificarse para quien administra la parroquia:
 *  - «Datos de la parroquia»: nombre, presentación, logo (pestaña del navegador y app instalada), foto de portada y comunidades.
 *  - «Parroquias» (solo el administrador general): crear parroquias nuevas, invitar a su responsable y activarlas o no.
 */

import { llamarApi, subirBinario, sesionActual } from "./auth.js";
import { cargarParroquia, ponerParroquia } from "./comunidades.js";
import { seccionFicha, seccionGaleria, extrasComunidad } from "./ficha-parroquia.js";

const token = () => (sesionActual() || {}).token || "";
const config = () => window.MONTECARMELO_CONFIG || {};

function el(tag, props, ...hijos) {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...hijos.filter((h) => h !== null && h !== undefined));
  return e;
}

function dialogo(titulo) {
  const cerrar = el("button", { type: "button", className: "btn-chico", textContent: "Cerrar ✕" });
  const cuerpo = el("div", { className: "dlg-cuerpo" });
  const dlg = el("dialog", { className: "dlg-admins" }, el("div", { className: "dlg-cabeza" }, el("h2", { textContent: titulo }), cerrar), cuerpo);
  cerrar.addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, cuerpo };
}

function campo(etiqueta, control) {
  return el("label", { className: "campo-admin" }, el("span", { textContent: etiqueta }), control);
}

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
    img.onerror = () => mal(new Error("No se pudo leer la imagen. Probá con un PNG o JPG."));
    img.src = url;
  });
}

const aBlob = (canvas, tipo, calidad) =>
  new Promise((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la imagen"))), tipo, calidad));

/** El logo recortado al cuadrado del centro, en PNG del tamaño pedido (el de 180 con fondo blanco: el iPhone pone negro lo transparente). */
function logoCuadrado(img, tam) {
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - lado) / 2, sy = (img.naturalHeight - lado) / 2;
  const canvas = el("canvas", { width: tam, height: tam });
  const ctx = canvas.getContext("2d");
  if (tam === 180) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tam, tam);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, lado, lado, 0, 0, tam, tam);
  return aBlob(canvas, "image/png");
}

/** La portada tal cual si es liviana; si no, achicada a 1920 px de ancho en JPG. */
async function portadaLiviana(archivo) {
  const tipos = ["image/jpeg", "image/png", "image/webp"];
  if (tipos.includes(archivo.type) && archivo.size <= 1.5 * 1024 * 1024) return archivo;
  const img = await cargarImagen(archivo);
  const escala = Math.min(1, 1920 / img.naturalWidth);
  const canvas = el("canvas", { width: Math.round(img.naturalWidth * escala), height: Math.round(img.naturalHeight * escala) });
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return aBlob(canvas, "image/jpeg", 0.85);
}

function actualizarMarca(p) {
  document.querySelectorAll(".nav-marca-parroquia, [data-parroquia='nombre']").forEach((x) => (x.textContent = p.nombre || ""));
  const icono = document.querySelector("link[rel='icon']");
  if (icono && p.iconos && p.iconos["192"]) icono.href = p.iconos["192"];
}

// ==================== DATOS DE LA PARROQUIA ====================

/** @param {{ alCambiar?: (parroquia) => void }} opciones */
export async function abrirDatosParroquia(opciones) {
  const alCambiar = (opciones || {}).alCambiar || (() => {});
  const { cuerpo } = dialogo("Datos de la parroquia");
  cuerpo.append(el("p", { className: "aviso", textContent: "Cargando…" }));
  let p;
  try {
    p = await cargarParroquia({ recargar: true });
  } catch (err) {
    cuerpo.replaceChildren(el("p", { className: "msg-error", textContent: err.message }));
    return;
  }
  p = { ...p };

  const listo = (nueva) => {
    p = { ...nueva };
    ponerParroquia(nueva);
    actualizarMarca(nueva);
    alCambiar(nueva);
  };

  // --- Nombre y presentación ---
  const nombre = el("input", { required: true, maxLength: 120, value: p.nombre || "" });
  const nombreCorto = el("input", { maxLength: 40, value: p.nombreCorto || "", placeholder: "Santo Domingo" });
  const lema = el("input", { maxLength: 200, value: p.lema || "" });
  const descripcion = el("textarea", { maxLength: 4000, rows: 6, value: p.descripcion || "" });
  const correo = el("input", { type: "email", value: p.correo || "", placeholder: "contacto@parroquia.cl" });
  const msgDatos = el("p", { hidden: true });
  const guardar = el("button", { type: "submit", className: "btn btn-primario", textContent: "Guardar" });
  const formDatos = el("form", { className: "form-noticia form-admin" },
    campo("Nombre (aparece arriba, debajo de «Cancionero Litúrgico»)", nombre),
    campo("Nombre corto (para listas y menús)", nombreCorto),
    campo("Lema o frase de bienvenida (Inicio)", lema),
    campo("Presentación de la parroquia (Inicio; un párrafo por línea)", descripcion),
    campo("Correo de contacto", correo),
    el("div", { className: "acciones-form" }, guardar),
    msgDatos);
  formDatos.addEventListener("submit", async (e) => {
    e.preventDefault();
    aviso(msgDatos, "");
    guardar.disabled = true;
    try {
      const r = await llamarApi("guardarParroquia", {
        token: token(),
        parroquia: { nombre: nombre.value, nombreCorto: nombreCorto.value, lema: lema.value, descripcion: descripcion.value, correo: correo.value }
      });
      listo(r.parroquia);
      aviso(msgDatos, "Guardado ✓");
    } catch (err) {
      aviso(msgDatos, err.message, true);
    }
    guardar.disabled = false;
  });

  // --- Logo ---
  const vistaLogo = el("img", { className: "vista-logo", alt: "Logo de la parroquia", src: (p.iconos || {})["192"] || "" });
  const archivoLogo = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/svg+xml" });
  const msgLogo = el("p", { hidden: true });
  archivoLogo.addEventListener("change", async () => {
    const f = archivoLogo.files && archivoLogo.files[0];
    if (!f) return;
    aviso(msgLogo, "Preparando el logo…");
    archivoLogo.disabled = true;
    try {
      const img = await cargarImagen(f);
      let r;
      for (const tam of [512, 192, 180]) {
        aviso(msgLogo, "Subiendo el logo (" + tam + " px)…");
        r = await subirBinario("logo", { tam: String(tam) }, await logoCuadrado(img, tam));
      }
      listo(r.parroquia);
      vistaLogo.src = r.parroquia.iconos["192"];
      aviso(msgLogo, "Logo guardado ✓. Los teléfonos que ya instalaron la app lo toman la próxima vez que la abran (a veces tarda un día).");
    } catch (err) {
      aviso(msgLogo, err.message, true);
    }
    archivoLogo.disabled = false;
    archivoLogo.value = "";
  });

  // --- Portada ---
  const vistaPortada = el("div", { className: "vista-portada" });
  const pintarPortada = () => (vistaPortada.style.backgroundImage = p.portada ? "url(" + JSON.stringify(p.portada) + ")" : "");
  pintarPortada();
  const archivoPortada = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
  const msgPortada = el("p", { hidden: true });
  archivoPortada.addEventListener("change", async () => {
    const f = archivoPortada.files && archivoPortada.files[0];
    if (!f) return;
    archivoPortada.disabled = true;
    aviso(msgPortada, "Subiendo la foto…");
    try {
      const blob = await portadaLiviana(f);
      const r = await subirBinario("portada", { mime: blob.type }, blob);
      listo(r.parroquia);
      pintarPortada();
      aviso(msgPortada, "Foto guardada ✓");
    } catch (err) {
      aviso(msgPortada, err.message, true);
    }
    archivoPortada.disabled = false;
    archivoPortada.value = "";
  });

  // --- Comunidades ---
  const listaCom = el("ul", { className: "lista-comunidades-admin" });
  const msgCom = el("p", { hidden: true });
  const nuevaCom = el("input", { placeholder: "Nombre de la comunidad nueva", maxLength: 100 });
  const agregar = el("button", { type: "submit", className: "btn btn-secundario", textContent: "Agregar comunidad" });
  const formCom = el("form", { className: "form-noticia form-invitar" }, campo("Comunidad nueva", nuevaCom), el("div", { className: "acciones-form" }, agregar));

  async function accionComunidad(accion, datos, okTexto) {
    aviso(msgCom, "Guardando…");
    try {
      const r = await llamarApi(accion, { token: token(), ...datos });
      listo(r.parroquia);
      pintarComunidades();
      aviso(msgCom, okTexto);
      return true;
    } catch (err) {
      aviso(msgCom, err.message, true);
      return false;
    }
  }

  function pintarComunidades() {
    const coms = p.comunidades || [];
    if (!coms.length) {
      listaCom.replaceChildren(el("li", { className: "aviso", textContent: "Todavía no hay comunidades. Agregá la primera abajo." }));
      return;
    }
    listaCom.replaceChildren(...coms.map((c, i) => {
      const nombreC = el("input", { value: c.nombre, maxLength: 100, title: "Cambiá el nombre y salí del campo para guardarlo" });
      nombreC.addEventListener("change", () => {
        const v = nombreC.value.trim();
        if (!v || v === c.nombre) return (nombreC.value = c.nombre);
        accionComunidad("guardarComunidad", { comunidad: { slug: c.slug, nombre: v } }, "Nombre cambiado ✓");
      });
      const mover = (d) => {
        const orden = coms.map((x) => x.slug);
        orden.splice(i + d, 0, orden.splice(i, 1)[0]);
        accionComunidad("ordenarComunidades", { orden }, "Orden guardado ✓");
      };
      const subir = el("button", { type: "button", className: "btn-chico", textContent: "↑", title: "Subir", disabled: i === 0 });
      const bajar = el("button", { type: "button", className: "btn-chico", textContent: "↓", title: "Bajar", disabled: i === coms.length - 1 });
      const quitar = el("button", { type: "button", className: "btn-chico", textContent: "Quitar" });
      subir.addEventListener("click", () => mover(-1));
      bajar.addEventListener("click", () => mover(1));
      quitar.addEventListener("click", () => {
        if (confirm("¿Quitar la comunidad «" + c.nombre + "»? Sus noticias dejan de verse.")) {
          accionComunidad("borrarComunidad", { slug: c.slug }, "Comunidad quitada ✓");
        }
      });
      const ver = el("a", { href: config().base ? config().base + "comunidad?c=" + encodeURIComponent(c.slug) : "#", textContent: "ver", target: "_blank" });
      return el("li", {}, nombreC, " ", subir, " ", bajar, " ", quitar, " ", ver, extrasComunidad(c, listo, msgCom));
    }));
  }
  pintarComunidades();
  formCom.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = nuevaCom.value.trim();
    if (!v) return;
    agregar.disabled = true;
    if (await accionComunidad("guardarComunidad", { comunidad: { nombre: v } }, "Comunidad agregada ✓")) nuevaCom.value = "";
    agregar.disabled = false;
  });

  const paginas = seccionPaginas(listo);
  const ficha = seccionFicha(() => p, listo);
  const galeria = seccionGaleria(() => p, listo);
  const enRevision = p.estado === "pendiente"
    ? el("p", { className: "aviso-revision", textContent: "Tu solicitud está en revisión: mientras tanto podés cargar todo. Cuando la aprobemos aparecerá en el mapa y en la portada del Cancionero." })
    : null;

  cuerpo.replaceChildren(
    ...(enRevision ? [enRevision] : []),
    el("h3", { className: "auth-h2", textContent: "Nombre y presentación" }),
    formDatos,
    el("h3", { className: "auth-h2", textContent: "Tipo y ubicación" }),
    el("p", { className: "aviso", textContent: "Con la dirección, la parroquia aparece en el mapa de la portada y la gente puede encontrarla por su comuna." }),
    ficha,
    el("h3", { className: "auth-h2", textContent: "Logo" }),
    el("p", { className: "aviso", textContent: "Aparece en la pestaña del navegador y como ícono de la app instalada en el teléfono. Usá una imagen cuadrada (si no lo es, se toma el centro), de 512 px o más." }),
    el("div", { className: "fila-imagen" }, vistaLogo, archivoLogo),
    msgLogo,
    el("h3", { className: "auth-h2", textContent: "Foto de portada" }),
    el("p", { className: "aviso", textContent: "La foto grande del Inicio de la parroquia (horizontal)." }),
    el("div", { className: "fila-imagen" }, vistaPortada, archivoPortada),
    msgPortada,
    el("h3", { className: "auth-h2", textContent: "Fotos" }),
    el("p", { className: "aviso", textContent: "Aparecen en el Inicio, con el mapa. La primera (o la de portada) se usa al compartir el enlace." }),
    galeria,
    el("h3", { className: "auth-h2", textContent: "Comunidades" }),
    el("p", { className: "aviso", textContent: "Capillas, comunidades y grupos: cada una tiene su página con noticias, cancioneros de misa y coros, y puede tener su dirección en el mapa y su foto. Para cambiar un nombre, escribilo y salí del campo." }),
    listaCom,
    formCom,
    msgCom,
    el("h3", { className: "auth-h2", textContent: "En tu sitio web" }),
    el("p", { className: "aviso", textContent: "Si la parroquia ya tiene su página, pegá uno de estos códigos para mostrar el cancionero adentro o un botón que lo abre." }),
    codigoEmbebido(p),
    el("h3", { className: "auth-h2", textContent: "Páginas propias" }),
    el("p", { className: "aviso", textContent: "Páginas de la parroquia con su propio contenido (historia, horarios, contacto…), en " + (config().base || "/") + "p/… Las marcadas «en el menú» aparecen en el menú de arriba. Se pueden pegar textos con formato HTML o cargar un archivo .html; los scripts se quitan." }),
    paginas
  );
}

/** El código para pegar en el sitio de la parroquia: el recuadro (/<slug>/embebido) o un botón. */
function codigoEmbebido(p) {
  const url = "https://www.cancioneroliturgico.cl/" + p.slug + "/";
  const codigos = [
    ["Recuadro con el cancionero", `<iframe src="${url}embebido" title="Cancionero Litúrgico · ${p.nombre}" width="100%" height="640"\n  style="border:0;border-radius:12px" allow="autoplay; fullscreen"></iframe>`],
    ["Botón", `<a href="${url}" target="_blank" rel="noopener"\n  style="display:inline-block;padding:12px 20px;border-radius:999px;background:#2f4a38;color:#fff;font:600 16px sans-serif;text-decoration:none">\n  🎵 Cancionero de la misa</a>`]
  ];
  return el("div", { className: "codigos-embebido" }, ...codigos.map(([titulo, codigo]) => {
    const copiar = el("button", { type: "button", className: "btn-chico", textContent: "Copiar" });
    copiar.addEventListener("click", () => navigator.clipboard && navigator.clipboard.writeText(codigo).then(() => (copiar.textContent = "Copiado ✓")));
    return el("div", {}, el("strong", { textContent: titulo + " " }), copiar, el("pre", { className: "po-codigo", textContent: codigo }));
  }), el("p", { className: "aviso" }, "Vista previa: ", el("a", { href: url + "embebido", target: "_blank", textContent: url.replace("https://", "") + "embebido" })));
}

// ==================== PÁGINAS PROPIAS ====================

/** El contenido de un .html: solo lo de adentro de <body> (si es una página completa). */
function cuerpoDeHtml(texto) {
  if (!/<body[\s>]/i.test(texto)) return texto;
  return new DOMParser().parseFromString(texto, "text/html").body.innerHTML.trim();
}

function seccionPaginas(listo) {
  const caja = el("div");
  const lista = el("ul", { className: "lista-comunidades-admin" });
  const msg = el("p", { hidden: true });
  const titulo = el("input", { required: true, maxLength: 120, placeholder: "Nuestra historia" });
  const direccion = el("input", { maxLength: 60, pattern: "[a-z0-9][a-z0-9-]{0,58}[a-z0-9]", placeholder: "historia (vacío = sale del título)" });
  const html = el("textarea", { rows: 12, placeholder: "<p>Texto de la página…</p>" });
  const enMenu = el("input", { type: "checkbox", checked: true });
  const archivo = el("input", { type: "file", accept: ".html,.htm,text/html" });
  const guardar = el("button", { type: "submit", className: "btn btn-primario", textContent: "Guardar página" });
  const nueva = el("button", { type: "button", className: "btn btn-secundario", textContent: "Página nueva" });
  const form = el("form", { className: "form-noticia form-admin" },
    campo("Título", titulo), campo("Dirección (…/p/historia)", direccion), campo("Contenido (HTML)", html),
    campo("O cargar un archivo .html", archivo),
    el("label", {}, enMenu, " Mostrar en el menú"),
    el("div", { className: "acciones-form" }, guardar, " ", nueva), msg);
  let editando = null;

  const limpiar = () => {
    editando = null;
    form.reset();
    enMenu.checked = true;
    direccion.disabled = false;
    guardar.textContent = "Guardar página";
  };
  nueva.addEventListener("click", () => { limpiar(); aviso(msg, ""); });
  archivo.addEventListener("change", async () => {
    const f = archivo.files && archivo.files[0];
    if (!f) return;
    const texto = await f.text();
    html.value = cuerpoDeHtml(texto);
    if (!titulo.value) {
      const t = new DOMParser().parseFromString(texto, "text/html").title;
      titulo.value = t || f.name.replace(/\.html?$/i, "");
    }
    archivo.value = "";
  });

  async function refrescar() {
    try {
      const r = await llamarApi("listarPaginas", { token: token() });
      if (!r.paginas.length) {
        lista.replaceChildren(el("li", { className: "aviso", textContent: "Todavía no hay páginas propias." }));
        return;
      }
      lista.replaceChildren(...r.paginas.map((x) => {
        const editar = el("button", { type: "button", className: "btn-chico", textContent: "Editar" });
        const quitar = el("button", { type: "button", className: "btn-chico", textContent: "Quitar" });
        editar.addEventListener("click", () => {
          editando = x.slug;
          titulo.value = x.titulo;
          direccion.value = x.slug;
          direccion.disabled = true;
          html.value = x.html || "";
          enMenu.checked = x.enMenu !== false;
          guardar.textContent = "Guardar cambios";
          titulo.focus();
        });
        quitar.addEventListener("click", async () => {
          if (!confirm("¿Quitar la página «" + x.titulo + "»?")) return;
          try {
            const r2 = await llamarApi("borrarPagina", { token: token(), slug: x.slug });
            listo(r2.parroquia);
            if (editando === x.slug) limpiar();
            aviso(msg, "Página quitada ✓");
            refrescar();
          } catch (err) {
            aviso(msg, err.message, true);
          }
        });
        return el("li", {}, el("a", { href: x.url, target: "_blank", textContent: x.titulo }),
          x.enMenu ? " · en el menú " : " · fuera del menú ", editar, " ", quitar);
      }));
    } catch (err) {
      lista.replaceChildren();
      aviso(msg, err.message, true);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    guardar.disabled = true;
    aviso(msg, "Guardando…");
    try {
      const r = await llamarApi("guardarPagina", {
        token: token(),
        pagina: { slug: editando || direccion.value.trim(), titulo: titulo.value, html: html.value, enMenu: enMenu.checked, nueva: !editando }
      });
      listo(r.parroquia);
      limpiar();
      aviso(msg, "Página guardada ✓ ");
      msg.append(el("a", { href: r.pagina.url, target: "_blank", textContent: "Verla" }));
      refrescar();
    } catch (err) {
      aviso(msg, err.message, true);
    }
    guardar.disabled = false;
  });

  refrescar();
  caja.append(lista, form);
  return caja;
}

// ==================== PARROQUIAS (administrador general) ====================

const enlaceWhatsapp = (tel, texto) =>
  "https://wa.me/" + String(tel || "").replace(/\D/g, "") + "?text=" + encodeURIComponent(texto);

const mailto = (email, asunto, texto) =>
  "mailto:" + encodeURIComponent(email || "") + "?subject=" + encodeURIComponent(asunto) + "&body=" + encodeURIComponent(texto);

/** Una solicitud de /sumar: los datos, quién la pide y aprobar, pedir cambios o rechazar (con el mensaje listo para mandar). */
function tarjetaSolicitud(x, alResolver) {
  const s = x.solicitud || {};
  const nota = el("textarea", { rows: 2, maxLength: 2000, placeholder: "Nota para el mensaje (opcional; para «Pedir cambios», qué hay que cambiar)" });
  const msg = el("p", { hidden: true, style: "white-space: pre-line" });
  const acciones = el("div", { className: "acciones-form" });
  const resultado = el("div", { className: "acciones-form" });
  const decidir = async (decision, confirmar) => {
    if (confirmar && !confirm(confirmar)) return;
    acciones.querySelectorAll("button").forEach((b) => (b.disabled = true));
    aviso(msg, "Guardando…");
    try {
      const r = await llamarApi("resolverSolicitud", { token: token(), slug: x.slug, decision, nota: nota.value });
      aviso(msg, r.mensaje);
      const copiar = el("button", { type: "button", className: "btn btn-secundario", textContent: "Copiar mensaje" });
      copiar.addEventListener("click", () => navigator.clipboard && navigator.clipboard.writeText(r.mensaje).then(() => (copiar.textContent = "Copiado ✓")));
      resultado.replaceChildren(copiar);
      if (String(r.telefono || "").replace(/\D/g, "")) {
        resultado.append(" ", el("a", { className: "btn btn-primario", href: enlaceWhatsapp(r.telefono, r.mensaje), target: "_blank", rel: "noopener", textContent: "Enviar por WhatsApp" }));
      }
      if (r.email) {
        const asunto = decision === "aprobar" ? "¡Bienvenidos al Cancionero Litúrgico!" : "Tu solicitud en el Cancionero Litúrgico";
        resultado.append(" ", el("a", { className: "btn btn-secundario", href: mailto(r.email, asunto, r.mensaje), textContent: "Enviar por correo" }));
      }
      alResolver();
    } catch (err) {
      aviso(msg, err.message, true);
      acciones.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
  const boton = (texto, clase, fn) => {
    const b = el("button", { type: "button", className: "btn " + clase, textContent: texto });
    b.addEventListener("click", fn);
    return b;
  };
  acciones.append(
    boton("Aprobar y dar la bienvenida", "btn-primario", () => decidir("aprobar")),
    " ", boton("Pedir cambios", "btn-secundario", () => decidir("cambios")),
    " ", boton("Rechazar", "btn-secundario", () => decidir("rechazar", "¿Rechazar " + x.nombre + "? Queda desactivada.")));
  const fecha = s.fecha ? new Date(s.fecha).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }) : "";
  const lugar = [x.direccion, x.comuna, x.region].filter(Boolean).join(", ");
  return el("article", { className: "solicitud" },
    el("h4", {}, el("img", { src: x.icono, alt: "", className: "icono-parroquia" }), " ", x.nombre,
      el("small", { textContent: " · " + (x.tipo === "movimiento" ? "Movimiento" : "Parroquia") + (x.cambiosPedidos ? " · cambios pedidos" : "") })),
    el("p", {}, el("a", { href: x.url + "inicio", target: "_blank", textContent: x.url.replace(/^https?:\/\//, "") }),
      lugar ? " · " + lugar : "", x.diocesis ? " · " + x.diocesis : "", x.sitioWeb ? " · " : "",
      x.sitioWeb ? el("a", { href: x.sitioWeb, target: "_blank", rel: "noopener", textContent: "sitio web" }) : null),
    el("p", { textContent: "Pide: " + (s.nombre || "") + (s.cargo ? " (" + s.cargo + ")" : "") + " · " + (s.email || "") +
      (s.telefono ? " · WhatsApp " + s.telefono : "") + (fecha ? " · " + fecha : "") }),
    nota, acciones, msg, resultado);
}

export async function abrirParroquias() {
  const { cuerpo } = dialogo("Parroquias del Cancionero");
  const tabla = el("tbody");
  const msgLista = el("p", { hidden: true });
  const listaSolicitudes = el("div", { className: "lista-solicitudes" });
  const pestanaLista = el("button", { type: "button", className: "pestana-admin", textContent: "Parroquias", ariaPressed: "true" });
  const pestanaSolic = el("button", { type: "button", className: "pestana-admin", textContent: "Solicitudes", ariaPressed: "false" });
  const panelLista = el("div");
  const panelSolic = el("div", { hidden: true }, el("p", { className: "aviso", textContent: "Las que llegaron desde /sumar: quedan ocultas y en revisión hasta aprobarlas. Quien la pidió ya es su responsable y puede ir cargándola." }), listaSolicitudes);
  const verPestana = (solic) => {
    panelLista.hidden = solic;
    panelSolic.hidden = !solic;
    pestanaLista.ariaPressed = String(!solic);
    pestanaSolic.ariaPressed = String(solic);
  };
  pestanaLista.addEventListener("click", () => verPestana(false));
  pestanaSolic.addEventListener("click", () => verPestana(true));

  // Después de resolver una solicitud se refresca la lista y el contador, sin borrar el mensaje para mandar
  async function refrescar(sinSolicitudes) {
    tabla.replaceChildren(el("tr", {}, el("td", { colSpan: 4, className: "aviso", textContent: "Cargando…" })));
    try {
      const r = await llamarApi("listarParroquias", { token: token() });
      tabla.replaceChildren(...r.parroquias.map(filaParroquia));
      const pendientes = r.parroquias.filter((x) => x.estado === "pendiente").sort((a, b) => String((b.solicitud || {}).fecha).localeCompare(String((a.solicitud || {}).fecha)));
      pestanaSolic.textContent = "Solicitudes" + (pendientes.length ? " (" + pendientes.length + ")" : "");
      pestanaSolic.classList.toggle("con-pendientes", pendientes.length > 0);
      if (!sinSolicitudes) {
        listaSolicitudes.replaceChildren(...(pendientes.length ? pendientes.map((x) => tarjetaSolicitud(x, () => refrescar(true)))
          : [el("p", { className: "aviso", textContent: "No hay solicitudes pendientes." })]));
      }
    } catch (err) {
      tabla.replaceChildren();
      aviso(msgLista, err.message, true);
    }
  }

  function filaParroquia(x) {
    const activa = el("input", { type: "checkbox", checked: x.activa, title: "Activa: se puede entrar desde su dirección" });
    const estado = el("td", { className: "estado" });
    activa.addEventListener("change", async () => {
      estado.textContent = "Guardando…";
      try {
        await llamarApi("guardarParroquia", { token: token(), slug: x.slug, parroquia: { activa: activa.checked } });
        estado.textContent = activa.checked ? "Activa ✓" : "Desactivada";
      } catch (err) {
        activa.checked = !activa.checked;
        estado.textContent = err.message;
      }
    });
    const oculta = el("input", { type: "checkbox", checked: x.oculta, title: "Oculta: se entra con su dirección, pero no aparece en la portada ni en el mapa" });
    oculta.addEventListener("change", async () => {
      estado.textContent = "Guardando…";
      try {
        await llamarApi("guardarParroquia", { token: token(), slug: x.slug, parroquia: { oculta: oculta.checked } });
        estado.textContent = oculta.checked ? "Oculta (de prueba)" : "Visible en la lista ✓";
      } catch (err) {
        oculta.checked = !oculta.checked;
        estado.textContent = err.message;
      }
    });
    const ESTADOS = { pendiente: " · en revisión", rechazada: " · rechazada" };
    const persona = el("td", { className: "persona" },
      el("strong", {}, el("img", { src: x.icono, alt: "", className: "icono-parroquia" }), " ", x.nombre, el("small", { textContent: ESTADOS[x.estado] || "" })),
      el("span", {}, el("a", { href: x.url, target: "_blank", textContent: x.url.replace(/^https?:\/\//, "") }),
        x.responsables.length ? " · Responsable: " + x.responsables.join(", ") : " · sin responsable"));
    return el("tr", {}, persona, el("td", {}, el("label", { title: activa.title }, activa, " Activa"), el("br"),
      el("label", { title: oculta.title }, oculta, " Oculta")), estado);
  }

  // --- Parroquia nueva ---
  const slug = el("input", { required: true, maxLength: 40, pattern: "[a-z0-9][a-z0-9-]{1,38}[a-z0-9]", placeholder: "sanjose-lareina" });
  const nombre = el("input", { required: true, maxLength: 120, placeholder: "Parroquia San José" });
  const nombreCorto = el("input", { maxLength: 40, placeholder: "San José" });
  const correo = el("input", { type: "email", placeholder: "responsable@gmail.com" });
  const tel = el("input", { type: "tel", placeholder: "+56 9 1234 5678" });
  const ocultaNueva = el("input", { type: "checkbox" });
  const vistaUrl = el("p", { className: "aviso" });
  const pintarUrl = () => (vistaUrl.textContent = "Dirección: " + (config().sitio || "/") + (slug.value || "…") + "/");
  slug.addEventListener("input", () => {
    slug.value = slug.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-");
    pintarUrl();
  });
  nombre.addEventListener("input", () => {
    if (slug.dataset.tocado) return;
    slug.value = nombre.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/^parroquia\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    pintarUrl();
  });
  slug.addEventListener("keydown", () => (slug.dataset.tocado = "1"));
  pintarUrl();
  const crear = el("button", { type: "submit", className: "btn btn-primario", textContent: "Crear parroquia" });
  const msgCrear = el("p", { hidden: true, style: "white-space: pre-line" });
  const resultado = el("div", { className: "acciones-form" });
  const form = el("form", { className: "form-noticia form-invitar" },
    campo("Nombre", nombre), campo("Nombre corto", nombreCorto), campo("Dirección (cancioneroliturgico.cl/…)", slug),
    campo("Correo de Google del responsable", correo), campo("WhatsApp del responsable (opcional)", tel),
    el("label", {}, ocultaNueva, " Oculta (de prueba): se entra con su dirección, pero no aparece en la portada ni en el mapa"),
    el("div", { className: "acciones-form" }, crear));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    aviso(msgCrear, "");
    resultado.replaceChildren();
    crear.disabled = true;
    try {
      const r = await llamarApi("crearParroquia", {
        token: token(), slug: slug.value.trim(), nombre: nombre.value.trim(), nombreCorto: nombreCorto.value.trim(), correo: correo.value.trim(),
        oculta: ocultaNueva.checked
      });
      if (r.texto) {
        aviso(msgCrear, "Parroquia creada en " + r.url + ". Enviale esta invitación al responsable:\n\n" + r.texto);
        const copiar = el("button", { type: "button", className: "btn btn-secundario", textContent: "Copiar invitación" });
        copiar.addEventListener("click", () => navigator.clipboard && navigator.clipboard.writeText(r.texto).then(() => (copiar.textContent = "Copiada ✓")));
        resultado.append(copiar);
        if (tel.value.replace(/\D/g, "")) {
          resultado.append(" ", el("a", { className: "btn btn-primario", href: enlaceWhatsapp(tel.value, r.texto), target: "_blank", rel: "noopener", textContent: "Enviar por WhatsApp" }));
        }
      } else {
        aviso(msgCrear, "Parroquia creada en " + r.url + ". Todavía no tiene responsable: entrá a su página de Identificarse para invitar a uno.");
      }
      resultado.append(" ", el("a", { className: "btn btn-secundario", href: r.url + "login", target: "_blank", textContent: "Abrir la parroquia" }));
      form.reset();
      delete slug.dataset.tocado;
      pintarUrl();
      refrescar();
    } catch (err) {
      aviso(msgCrear, err.message, true);
    }
    crear.disabled = false;
  });

  cuerpo.append(el("div", { className: "pestanas-admin" }, pestanaLista, pestanaSolic), panelLista, panelSolic);
  panelLista.append(
    el("p", { className: "aviso", textContent: "Cada parroquia tiene su dirección, su logo, sus comunidades, sus noticias y sus administradores. La biblioteca de canciones y las lecturas son comunes a todas." }),
    el("table", { className: "tabla-personas" },
      el("thead", {}, el("tr", {}, el("th", { textContent: "Parroquia" }), el("th", { textContent: "Activa" }), el("th"))),
      tabla),
    msgLista,
    el("h3", { className: "auth-h2", textContent: "Parroquia nueva" }),
    el("p", { className: "aviso", textContent: "El responsable puede después cargar el logo y las comunidades, e invitar a quienes administran cada comunidad." }),
    form,
    vistaUrl,
    msgCrear,
    resultado
  );
  refrescar();
}
