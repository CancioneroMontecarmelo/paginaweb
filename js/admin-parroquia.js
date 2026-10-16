/**
 * Ventanas del panel de Identificarse para quien administra la parroquia:
 *  - «Datos de la parroquia»: nombre, presentación, logo, portada, comunidades y páginas.
 *  - «Parroquias» (solo el administrador general): listar, crear, activar/ocultar y configurar
 *    tipo, mapa, diócesis y nombre del sacerdote (después de llamar a quien se sumó).
 */

import { llamarApi, subirBinario, sesionActual } from "./auth.js";
import { cargarParroquia, ponerParroquia } from "./comunidades.js";
import { seccionGaleria, extrasComunidad, TIPOS } from "./ficha-parroquia.js";
import { elegirUbicacion } from "./mapa.js";

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
  const galeria = seccionGaleria(() => p, listo);
  const esGeneral = (sesionActual() || {}).rol === "admin_general";

  cuerpo.replaceChildren(
    el("h3", { className: "auth-h2", textContent: "Nombre y presentación" }),
    formDatos,
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
    paginas,
    ...(esGeneral
      ? [el("p", { className: "aviso", textContent: "El tipo, el mapa, la diócesis y el nombre del sacerdote se configuran en Parroquias → Configurar (después de hablar con quien se sumó)." })]
      : [el("p", { className: "aviso", textContent: "El mapa y los datos de ubicación los completa el equipo del Cancionero después de contactarte." })])
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

/** Configurar tipo, mapa, diócesis y sacerdote de una parroquia (solo admin_general). */
function configurarParroquia(x, alGuardar) {
  const { cuerpo } = dialogo("Configurar · " + x.nombre);
  const tipo = el("select", {}, ...Object.entries(TIPOS).map(([v, t]) => el("option", { value: v, textContent: t, selected: (x.tipo || "parroquia") === v })));
  const diocesis = el("input", { maxLength: 100, value: x.diocesis || "", placeholder: "Arquidiócesis de Santiago" });
  const sitioWeb = el("input", { type: "url", maxLength: 300, value: x.sitioWeb || "", placeholder: "https://www.miparroquia.cl" });
  const sacerdote = el("input", { maxLength: 120, value: x.sacerdoteNombre || "", placeholder: "P. Juan Pérez (sin correo)" });
  const filaSacerdote = campo("Sacerdote responsable (nombre; no hace falta correo)", sacerdote);
  const actualizarSacerdote = () => { filaSacerdote.hidden = tipo.value === "movimiento"; };
  tipo.addEventListener("change", actualizarSacerdote);
  actualizarSacerdote();
  const cajaMapa = el("div", { className: "ficha-ubicacion" });
  const msg = el("p", { hidden: true });
  let ubic = null;
  elegirUbicacion(cajaMapa, { direccion: x.direccion, comuna: x.comuna, region: x.region, lat: x.lat, lng: x.lng })
    .then((u) => (ubic = u))
    .catch((err) => aviso(msg, err.message, true));
  const guardar = el("button", { type: "submit", className: "btn btn-primario", textContent: "Guardar configuración" });
  const form = el("form", { className: "form-noticia form-admin" },
    campo("Es una…", tipo),
    campo("Diócesis", diocesis),
    campo("Sitio web propio (si tiene)", sitioWeb),
    filaSacerdote,
    el("span", { className: "campo-admin" }, el("span", { textContent: "Dirección (aparece en el mapa del Cancionero)" })),
    cajaMapa,
    el("div", { className: "acciones-form" }, guardar),
    msg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    guardar.disabled = true;
    aviso(msg, "Guardando…");
    try {
      const u = ubic ? ubic.valor() : {};
      await llamarApi("guardarParroquia", {
        token: token(),
        slug: x.slug,
        parroquia: {
          tipo: tipo.value, diocesis: diocesis.value, sitioWeb: sitioWeb.value,
          sacerdoteNombre: tipo.value === "parroquia" ? sacerdote.value : "",
          configurada: true,
          ...u
        }
      });
      aviso(msg, "Guardado ✓");
      alGuardar();
    } catch (err) {
      aviso(msg, err.message, true);
    }
    guardar.disabled = false;
  });
  const quien = (x.solicitud && x.solicitud.email) || (x.responsables || [])[0] || x.creadoPor || "";
  cuerpo.append(
    el("p", { className: "aviso", textContent: "Después de llamar a quien se sumó, completa el mapa y (si es parroquia) el nombre del sacerdote. Quien la creó: " + (quien || "—") }),
    form
  );
}

export async function abrirParroquias() {
  const { cuerpo } = dialogo("Parroquias del Cancionero");
  const tabla = el("tbody");
  const msgLista = el("p", { hidden: true });

  async function refrescar() {
    tabla.replaceChildren(el("tr", {}, el("td", { colSpan: 4, className: "aviso", textContent: "Cargando…" })));
    try {
      const r = await llamarApi("listarParroquias", { token: token() });
      tabla.replaceChildren(...r.parroquias.map(filaParroquia));
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
    const configBtn = el("button", { type: "button", className: "btn-chico", textContent: "Configurar" });
    configBtn.addEventListener("click", () => configurarParroquia(x, refrescar));
  const origen = x.origen === "catalogo" ? " · catálogo" : x.origen === "feligres" ? " · feligrés" : "";
  const falta = x.configurada ? "" : (!x.comuna && x.lat == null ? " · sin mapa" : " · por configurar");
  const tipoTxt = x.tipo === "movimiento" ? "Movimiento" : "Parroquia";
  const persona = el("td", { className: "persona" },
    el("strong", {}, el("img", { src: x.icono, alt: "", className: "icono-parroquia" }), " ", x.nombre,
      el("small", { textContent: " · " + tipoTxt + origen + falta })),
    el("span", {}, el("a", { href: x.url, target: "_blank", textContent: x.url.replace(/^https?:\/\//, "") }),
      x.responsables.length ? " · Responsable: " + x.responsables.join(", ") : " · sin responsable",
      x.sacerdoteNombre ? " · Sacerdote: " + x.sacerdoteNombre : ""));
  return el("tr", {}, persona, el("td", {}, el("label", { title: activa.title }, activa, " Activa"), el("br"),
    el("label", { title: oculta.title }, oculta, " Oculta"), el("br"), configBtn), estado);
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

  const importar = el("button", { type: "button", className: "btn btn-secundario", textContent: "Importar catálogo (Santiago + movimientos)" });
  const msgImport = el("p", { hidden: true });
  importar.addEventListener("click", async () => {
    if (!confirm("¿Importar el catálogo diocesano? Solo agrega las que aún no existen; no borra ni pisa las actuales.")) return;
    importar.disabled = true;
    aviso(msgImport, "Importando…");
    try {
      const r = await llamarApi("importarCatalogo", { token: token() });
      aviso(msgImport, "Listo: " + r.creadas + " nuevas, " + r.omitidas + " ya estaban (de " + r.totalCatalogo + " en el archivo).");
      refrescar();
    } catch (err) {
      aviso(msgImport, err.message, true);
    }
    importar.disabled = false;
  });

  cuerpo.append(
    el("p", { className: "aviso", textContent: "Quienes se suman en /sumar o entran como feligreses quedan publicadas al tiro. Acá las activás u ocultás, importás el directorio diocesano y con Configurar completás el mapa y el sacerdote." }),
    el("div", { className: "acciones-form" }, importar),
    msgImport,
    el("table", { className: "tabla-personas" },
      el("thead", {}, el("tr", {}, el("th", { textContent: "Parroquia" }), el("th", { textContent: "Activa" }), el("th"))),
      tabla),
    msgLista,
    el("h3", { className: "auth-h2", textContent: "Parroquia nueva" }),
    el("p", { className: "aviso", textContent: "También podés crear una a mano e invitar a su responsable. El mapa y el sacerdote se configuran después." }),
    form,
    vistaUrl,
    msgCrear,
    resultado
  );
  refrescar();
}
