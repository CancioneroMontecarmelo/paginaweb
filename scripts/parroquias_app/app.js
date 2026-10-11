// Parroquias del Cancionero Litúrgico (scripts/parroquias.py): mapa del sitio y alta/edición de parroquias.
// Todo pasa por el servidor local (/local/…), que llama a la API del sitio con la clave del administrador general.

const CLAVE_APP = document.querySelector('meta[name="clave-app"]').content;
const $ = (id) => document.getElementById(id);

const ROLES = {
  admin_general: "Administrador general",
  admin_segundo: "Responsable de la parroquia",
  sacerdote: "Sacerdote",
  admin: "Administrador de comunidad",
  editor: "Editor",
  colaborador: "Colaborador"
};
const ROLES_INVITABLES = ["admin_segundo", "sacerdote", "admin", "editor", "colaborador"];
const PRINCIPAL = "montecarmelo";

let ESTADO = { sitio: "" };
let ESTRUCTURA = { paginasComunes: [], migraciones: [], htmlBase: [] };
let PARROQUIAS = [];

// ==================== utilidades ====================

function el(tag, props, ...hijos) {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...hijos.flat().filter((h) => h !== null && h !== undefined && h !== false));
  return e;
}

function mensaje(nodo, texto, error) {
  nodo.hidden = !texto;
  nodo.className = "msg" + (texto ? (error ? " error" : " ok") : "");
  nodo.textContent = texto || "";
}

const campo = (etiqueta, control) => el("label", { className: "campo" }, el("span", { textContent: etiqueta }), control);
const absoluta = (ruta) => (ruta ? new URL(ruta, ESTADO.sitio).toString() : "");
const urlParroquia = (slug, resto = "") => ESTADO.sitio + slug + "/" + resto;
const enlace = (href, texto) => el("a", { href, target: "_blank", rel: "noopener", textContent: texto });
const enlaceWhatsapp = (tel, texto) => "https://wa.me/" + String(tel || "").replace(/\D/g, "") + "?text=" + encodeURIComponent(texto);
const slugDe = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/^parroquia\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function local(ruta, opciones = {}) {
  let res;
  try {
    res = await fetch(ruta, { ...opciones, headers: { "X-App-Clave": CLAVE_APP, ...(opciones.headers || {}) } });
  } catch (_) {
    throw new Error("La app local no responde: ¿se cerró el programa? Volvé a abrirlo desde el menú.");
  }
  let r;
  try {
    r = await res.json();
  } catch (_) {
    throw new Error("La app local respondió algo que no se entiende.");
  }
  if (!r.ok) throw new Error(r.error || "No se pudo completar.");
  return r;
}

const api = (destino, accion, datos = {}) => local("/local/api", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destino, datos: { ...datos, accion } })
});
const leer = (destino, accion, params = {}) => local("/local/leer?" + new URLSearchParams({ destino, accion, ...params }));
const subir = (destino, params, blob) => local("/local/subir?" + new URLSearchParams({ destino, ...params }), {
  method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob
});

function botonCopiar(texto) {
  const b = el("button", { type: "button", className: "btn", textContent: "Copiar" });
  b.addEventListener("click", () => navigator.clipboard.writeText(texto).then(() => (b.textContent = "Copiado ✓")));
  return b;
}

function cajaInvitacion(texto, tel) {
  return el("div", { className: "panel" },
    el("p", { className: "suave", textContent: "Enviale esta invitación (no se manda sola):" }),
    el("p", { className: "invitacion", textContent: texto }),
    el("div", { className: "fila" }, botonCopiar(texto),
      String(tel || "").replace(/\D/g, "") ? el("a", { className: "btn btn-primario", href: enlaceWhatsapp(tel, texto), target: "_blank", rel: "noopener", textContent: "Enviar por WhatsApp" }) : null));
}

// ==================== imágenes (como js/admin-parroquia.js del sitio) ====================

function cargarImagen(archivo) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error("No se pudo leer la imagen. Probá con un PNG o JPG."));
    img.src = URL.createObjectURL(archivo);
  });
}

const aBlob = (canvas, tipo, calidad) =>
  new Promise((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la imagen"))), tipo, calidad));

// El cuadrado del centro; el de 180 con fondo blanco (el iPhone pone negro lo transparente)
function logoCuadrado(img, tam) {
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = el("canvas", { width: tam, height: tam });
  const ctx = canvas.getContext("2d");
  if (tam === 180) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tam, tam);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, tam, tam);
  return aBlob(canvas, "image/png");
}

async function portadaLiviana(archivo) {
  if (["image/jpeg", "image/png", "image/webp"].includes(archivo.type) && archivo.size <= 1.5 * 1024 * 1024) return archivo;
  const img = await cargarImagen(archivo);
  const escala = Math.min(1, 1920 / img.naturalWidth);
  const canvas = el("canvas", { width: Math.round(img.naturalWidth * escala), height: Math.round(img.naturalHeight * escala) });
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return aBlob(canvas, "image/jpeg", 0.85);
}

function cuerpoDeHtml(texto) {
  if (!/<body[\s>]/i.test(texto)) return texto;
  return new DOMParser().parseFromString(texto, "text/html").body.innerHTML.trim();
}

// ==================== inicio, clave y pestañas ====================

function pintarEstado() {
  const partes = ["Sitio: " + ESTADO.sitio + (ESTADO.produccion ? "" : " (prueba)")];
  partes.push(ESTADO.claveVigente ? "Administrador: " + ESTADO.email : "Sin clave");
  $("estado-sitio").textContent = partes.join(" · ");
  $("enlace-clave").href = ESTADO.enlaceClave;
  $("panel-clave").hidden = !!ESTADO.claveVigente;
}

$("form-clave").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    ESTADO = await local("/local/clave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: $("campo-clave").value }) });
    $("campo-clave").value = "";
    mensaje($("msg-clave"), "");
    pintarEstado();
    mostrarVista("mapa");
  } catch (err) {
    mensaje($("msg-clave"), err.message, true);
  }
});

$("btn-salir").addEventListener("click", async () => {
  if (!confirm("¿Cerrar la app de parroquias?")) return;
  await local("/local/salir", { method: "POST" }).catch(() => {});
  document.body.replaceChildren(el("main", {}, el("h1", { textContent: "La app se cerró" }),
    el("p", { className: "suave", textContent: "Ya podés cerrar esta pestaña. Para volver, abrí «Parroquias del Cancionero» desde el menú." })));
});

let editando = "";

function mostrarVista(nombre, slug) {
  if (slug !== undefined) editando = slug;
  document.querySelectorAll("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.vista === nombre));
  document.querySelectorAll(".vista").forEach((v) => (v.hidden = v.id !== "vista-" + nombre));
  if (nombre === "mapa") pintarMapa();
  if (nombre === "nueva") pintarNueva();
  if (nombre === "editar") pintarEditar();
  window.scrollTo(0, 0);
}

document.querySelectorAll("#pestanas button").forEach((b) => b.addEventListener("click", () => mostrarVista(b.dataset.vista)));

async function cargarParroquias() {
  const r = await api(PRINCIPAL, "listarParroquias");
  PARROQUIAS = r.parroquias;
  return PARROQUIAS;
}

// ==================== MAPA DEL SITIO ====================

function insignias(x) {
  return [
    el("span", { className: "insignia " + (x.activa ? "activa" : "inactiva"), textContent: x.activa ? "activa" : "desactivada" }),
    x.oculta ? el("span", { className: "insignia oculta", textContent: "oculta (de prueba)" }) : null
  ];
}

async function pintarMapa() {
  const v = $("vista-mapa");
  v.replaceChildren(el("p", { className: "suave", textContent: "Cargando…" }));
  let lista;
  try {
    lista = await cargarParroquias();
  } catch (err) {
    v.replaceChildren(el("p", { className: "msg error", textContent: err.message }));
    return;
  }
  const comunes = ESTRUCTURA.paginasComunes.map((x) => x.slug);
  const comun = el("div", { className: "panel" },
    el("h2", { textContent: "Cómo está armado " + ESTADO.sitio.replace(/^https?:\/\//, "").replace(/\/$/, "") }),
    el("ul", { className: "arbol" },
      el("li", {}, el("strong", { textContent: "Común a todas las parroquias" }),
        el("ul", {},
          el("li", {}, "Biblioteca de canciones (una sola; se sube con «Subir canciones a la Biblioteca»)"),
          el("li", {}, "Lecturas del día y calendario litúrgico"),
          el("li", {}, enlace(ESTADO.sitio + "editor/", "Editor de cancioneros"), " (/editor/; toma el nombre y el logo de la parroquia elegida)"),
          el("li", {}, "Páginas base: " + ESTRUCTURA.htmlBase.join(", "),
            el("ul", {}, el("li", { className: "suave", textContent: "Son las mismas para todas: el servidor les pone el nombre, el logo y el menú de cada parroquia." }))),
          el("li", {}, "Base de datos (D1): " + ESTRUCTURA.migraciones.join(", ")))),
      el("li", {}, el("strong", { textContent: "Cada parroquia, en " + ESTADO.sitio + "<parroquia>/" }),
        el("ul", {},
          el("li", {}, "Páginas: " + comunes.join(", ") + " y sus páginas propias en p/<página>"),
          el("li", {}, "Su logo (pestaña del navegador y app instalada), su portada, sus comunidades y sus noticias"),
          el("li", {}, "Sus personas: responsable, sacerdote, administradores y editores por comunidad, e invitados"),
          el("li", {}, "Sus cancioneros, misas y coros, guardados en cada comunidad")))));
  const titulo = el("div", { className: "fila" }, el("h2", { textContent: "Parroquias (" + lista.length + ")" }),
    el("button", { type: "button", className: "btn", textContent: "Actualizar", onclick: pintarMapa }),
    el("button", { type: "button", className: "btn btn-primario", textContent: "Nueva parroquia", onclick: () => mostrarVista("nueva") }));
  v.replaceChildren(comun, titulo, ...lista.map(detalleParroquia));
}

function detalleParroquia(x) {
  const editar = el("button", { type: "button", className: "btn-chico", textContent: "Editar" });
  editar.addEventListener("click", (e) => {
    e.preventDefault();
    mostrarVista("editar", x.slug);
  });
  const cuerpo = el("div");
  const d = el("details", { className: "parroquia" },
    el("summary", {},
      el("img", { className: "icono-parroquia", src: absoluta(x.icono), alt: "" }),
      el("strong", { textContent: x.nombre }),
      enlace(x.url, "/" + x.slug + "/"),
      insignias(x),
      el("span", { className: "suave", textContent: x.responsables.length ? "Responsable: " + x.responsables.join(", ") : "sin responsable" }),
      editar),
    cuerpo);
  d.addEventListener("toggle", () => {
    if (!d.open || cuerpo.dataset.cargado) return;
    cuerpo.dataset.cargado = "1";
    cargarDetalle(x, cuerpo);
  });
  return d;
}

const valor = (r, clave, defecto) => (r.status === "fulfilled" ? r.value[clave] : defecto);

async function cargarDetalle(x, cuerpo) {
  if (!x.activa) {
    cuerpo.replaceChildren(el("p", { className: "suave", textContent: "Está desactivada: no se puede entrar ni leer sus datos. Activala desde «Editar»." }));
    return;
  }
  cuerpo.replaceChildren(el("p", { className: "suave", textContent: "Cargando…" }));
  const rs = await Promise.allSettled([
    leer(x.slug, "parroquia"), api(x.slug, "listarUsuarios"), api(x.slug, "listarVisitantes"), leer(x.slug, "noticias"), api(x.slug, "listarPaginas")
  ]);
  const p = valor(rs[0], "parroquia", null);
  if (!p) {
    cuerpo.replaceChildren(el("p", { className: "msg error", textContent: rs[0].reason.message }));
    return;
  }
  const usuarios = valor(rs[1], "usuarios", []).filter((u) => u.rol !== "visitante");
  const invitados = valor(rs[2], "visitantes", []);
  const noticias = valor(rs[3], "noticias", []);
  const paginas = valor(rs[4], "paginas", []);
  const personasDe = (com) => usuarios.filter((u) => u.comunidad === com)
    .map((u) => el("li", {}, u.nombre && u.nombre !== u.email ? u.nombre + " · " : "", u.email, " ", el("span", { className: "rol", textContent: "(" + (ROLES[u.rol] || u.rol) + (u.activo ? "" : ", bloqueado") + ")" })));
  const noticiasDe = (com) => noticias.filter((n) => n.comunidad === com).length;

  const colPaginas = el("div", {}, el("h3", { textContent: "Páginas" }),
    el("ul", { className: "arbol" },
      ESTRUCTURA.paginasComunes.map((pg) => el("li", {}, enlace(urlParroquia(x.slug, pg.slug), pg.titulo), el("span", { className: "suave", textContent: " /" + pg.slug }))),
      paginas.length
        ? paginas.map((pg) => el("li", {}, "★ ", enlace(pg.url, pg.titulo), el("span", { className: "suave", textContent: " /p/" + pg.slug + (pg.enMenu ? " · en el menú" : "") })))
        : el("li", { className: "suave", textContent: "Sin páginas propias" })));

  const colComunidades = el("div", {}, el("h3", { textContent: "Comunidades (" + p.comunidades.length + ")" }),
    el("ul", { className: "arbol" },
      el("li", {}, el("strong", { textContent: "Toda la parroquia" }), " · " + noticiasDe("parroquia") + " noticias",
        el("ul", {}, personasDe("parroquia"))),
      p.comunidades.map((c) => el("li", {}, enlace(urlParroquia(x.slug, "comunidad?c=" + encodeURIComponent(c.slug)), c.nombre),
        " · " + noticiasDe(c.slug) + " noticias",
        el("ul", {}, personasDe(c.slug))))));

  const porRol = Object.keys(ROLES).map((r) => [r, usuarios.filter((u) => u.rol === r).length]).filter(([, n]) => n);
  const colPersonas = el("div", {}, el("h3", { textContent: "Personas" }),
    el("ul", { className: "arbol" },
      porRol.map(([r, n]) => el("li", { textContent: ROLES[r] + ": " + n })),
      el("li", {}, el("details", {}, el("summary", { textContent: "Invitados: " + invitados.length }),
        el("ul", {}, invitados.map((i) => el("li", { textContent: (i.nombre && i.nombre !== i.email ? i.nombre + " · " : "") + (i.email || "") })))))),
    el("h3", { textContent: "Noticias: " + noticias.length }),
    el("ul", { className: "arbol" }, noticias.slice(0, 3).map((n) => el("li", { textContent: (n.fecha || "") + " · " + n.titulo }))),
    el("h3", { textContent: "Logo y portada" }),
    el("p", { className: "suave", textContent: (p.logoPropio ? "Logo propio ✓" : "Sin logo propio (usa el del Cancionero)") + " · " + (p.portada ? "Portada ✓" : "Sin portada") }));

  cuerpo.replaceChildren(el("div", { className: "columnas" }, colPaginas, colComunidades, colPersonas));
}

// ==================== NUEVA PARROQUIA ====================

function pintarNueva() {
  const v = $("vista-nueva");
  const nombre = el("input", { required: true, maxLength: 120, placeholder: "Parroquia San José" });
  const nombreCorto = el("input", { maxLength: 40, placeholder: "San José" });
  const slug = el("input", { required: true, maxLength: 40, pattern: "[a-z0-9][a-z0-9-]{1,38}[a-z0-9]", placeholder: "sanjose-lareina" });
  const lema = el("input", { maxLength: 200, placeholder: "Una comunidad que canta su fe" });
  const descripcion = el("textarea", { maxLength: 4000, rows: 4, placeholder: "Presentación de la parroquia (Inicio; un párrafo por línea)" });
  const correoContacto = el("input", { type: "email", placeholder: "contacto@parroquia.cl" });
  const correoResp = el("input", { type: "email", placeholder: "responsable@gmail.com" });
  const nombreResp = el("input", { maxLength: 80, placeholder: "Nombre del responsable (opcional)" });
  const tel = el("input", { type: "tel", placeholder: "+56 9 1234 5678" });
  const oculta = el("input", { type: "checkbox", checked: true });
  const vistaUrl = el("p", { className: "suave" });
  const msg = el("p", { className: "msg", hidden: true });
  const crear = el("button", { type: "submit", className: "btn btn-primario", textContent: "Crear y seguir con el logo y las comunidades" });
  const pintarUrl = () => (vistaUrl.textContent = "Dirección: " + ESTADO.sitio + (slug.value || "…") + "/");
  nombre.addEventListener("input", () => {
    if (!slug.dataset.tocado) slug.value = slugDe(nombre.value);
    if (!nombreCorto.dataset.tocado) nombreCorto.value = nombre.value.replace(/^parroquia\s+/i, "").slice(0, 40);
    pintarUrl();
  });
  slug.addEventListener("input", () => {
    slug.dataset.tocado = "1";
    slug.value = slug.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-");
    pintarUrl();
  });
  nombreCorto.addEventListener("input", () => (nombreCorto.dataset.tocado = "1"));
  pintarUrl();

  const form = el("form", { className: "campos" },
    campo("Nombre (aparece arriba, debajo de «Cancionero Litúrgico»)", nombre),
    campo("Nombre corto (app instalada, listas)", nombreCorto),
    campo("Dirección (cancioneroliturgico.cl/…)", slug), vistaUrl,
    campo("Lema o frase de bienvenida", lema),
    campo("Presentación", descripcion),
    campo("Correo de contacto de la parroquia (formulario del Inicio)", correoContacto),
    el("h3", { textContent: "Responsable de la parroquia" }),
    el("p", { className: "suave", textContent: "Administra la parroquia desde su propio espacio: logo, comunidades, noticias, páginas e invitaciones a los administradores de cada comunidad. Entra con su cuenta de Google." }),
    campo("Correo de Google del responsable", correoResp),
    campo("Nombre del responsable", nombreResp),
    campo("WhatsApp del responsable (para mandarle la invitación)", tel),
    el("label", {}, oculta, " Oculta mientras se prepara: se entra con su dirección, pero no aparece en «Elegí tu parroquia»"),
    el("div", { className: "fila" }, crear), msg);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    crear.disabled = true;
    mensaje(msg, "Creando…");
    try {
      const r = await api(PRINCIPAL, "crearParroquia", {
        slug: slug.value.trim(), nombre: nombre.value.trim(), nombreCorto: nombreCorto.value.trim(), correo: correoResp.value.trim(), oculta: oculta.checked
      });
      const nuevo = r.parroquia.slug;
      const extra = { lema: lema.value, descripcion: descripcion.value };
      if (correoContacto.value.trim()) extra.correo = correoContacto.value.trim();
      await api(nuevo, "guardarParroquia", { parroquia: extra });
      let invitacion = r.texto || "";
      if (correoResp.value.trim() && nombreResp.value.trim()) {
        const inv = await api(nuevo, "invitar", { email: correoResp.value.trim(), nombre: nombreResp.value.trim(), rol: "admin_segundo", comunidad: "parroquia" });
        invitacion = inv.texto;
      }
      INVITACION_NUEVA = invitacion ? { slug: nuevo, texto: invitacion, tel: tel.value } : null;
      mostrarVista("editar", nuevo);
    } catch (err) {
      mensaje(msg, err.message, true);
    }
    crear.disabled = false;
  });

  v.replaceChildren(el("div", { className: "panel" },
    el("h2", { textContent: "Nueva parroquia" }),
    el("p", { className: "suave", textContent: "Primero los datos y el responsable; después sigue el logo, la portada, las comunidades, los administradores y las páginas propias." }),
    form));
}

let INVITACION_NUEVA = null;

// ==================== EDITAR PARROQUIA ====================

async function pintarEditar() {
  const v = $("vista-editar");
  v.replaceChildren(el("p", { className: "suave", textContent: "Cargando…" }));
  try {
    if (!PARROQUIAS.length || !PARROQUIAS.some((x) => x.slug === editando)) await cargarParroquias();
  } catch (err) {
    v.replaceChildren(el("p", { className: "msg error", textContent: err.message }));
    return;
  }
  if (!editando || !PARROQUIAS.some((x) => x.slug === editando)) editando = (PARROQUIAS[0] || {}).slug || "";
  const elegir = el("select", {}, PARROQUIAS.map((x) => el("option", { value: x.slug, textContent: x.nombre + " (/" + x.slug + "/)", selected: x.slug === editando })));
  elegir.addEventListener("change", () => mostrarVista("editar", elegir.value));
  const x = PARROQUIAS.find((y) => y.slug === editando);
  const cabeza = el("div", { className: "panel" }, el("div", { className: "fila" }, campo("Parroquia", elegir), x ? enlace(x.url + "inicio", "Abrir en el sitio ↗") : null));
  if (!x) {
    v.replaceChildren(cabeza);
    return;
  }
  const contenedor = el("div");
  v.replaceChildren(cabeza, contenedor);
  if (INVITACION_NUEVA && INVITACION_NUEVA.slug === x.slug) {
    cabeza.append(el("p", { className: "msg ok", textContent: "Parroquia creada ✓ Seguí con el logo, la portada y las comunidades." }),
      cajaInvitacion(INVITACION_NUEVA.texto, INVITACION_NUEVA.tel));
    INVITACION_NUEVA = null;
  }
  await new Editor(x, contenedor).iniciar();
}

class Editor {
  constructor(resumen, nodo) {
    this.x = resumen;
    this.slug = resumen.slug;
    this.nodo = nodo;
    this.p = null;
    this.usuarios = [];
    this.invitados = [];
    this.paginas = [];
    this.pasos = el("ul", { className: "pasos" });
  }

  async iniciar() {
    const estado = this.seccionEstado();
    if (!this.x.activa) {
      this.nodo.replaceChildren(estado, el("p", { className: "suave", textContent: "Está desactivada: activala para editar sus datos." }));
      return;
    }
    try {
      this.p = (await leer(this.slug, "parroquia")).parroquia;
    } catch (err) {
      this.nodo.replaceChildren(estado, el("p", { className: "msg error", textContent: err.message }));
      return;
    }
    await Promise.all([this.cargarUsuarios(), this.cargarPaginas()]);
    this.nodo.replaceChildren(
      el("div", { className: "panel" }, el("h2", { textContent: this.p.nombre }), el("p", { className: "suave", textContent: "Pasos:" }), this.pasos),
      estado, this.seccionDatos(), this.seccionLogo(), this.seccionPortada(), this.seccionComunidades(), this.seccionPersonas(),
      this.seccionPaginas(), this.seccionResumen());
    this.pintarPasos();
  }

  async cargarUsuarios() {
    const [u, v] = await Promise.allSettled([api(this.slug, "listarUsuarios"), api(this.slug, "listarVisitantes")]);
    this.usuarios = valor(u, "usuarios", []).filter((x) => x.rol !== "visitante");
    this.invitados = valor(v, "visitantes", []);
  }

  async cargarPaginas() {
    this.paginas = await api(this.slug, "listarPaginas").then((r) => r.paginas).catch(() => []);
  }

  cambio(p) {
    if (p) this.p = p;
    this.pintarPasos();
    if (this.repintarResumen) this.repintarResumen();
  }

  faltas() {
    const p = this.p;
    return [
      ["datos", "Presentación", !!(p.descripcion && p.lema)],
      ["logo", "Logo", !!p.logoPropio],
      ["portada", "Portada", !!p.portada],
      ["comunidades", "Comunidades", p.comunidades.length > 0],
      ["personas", "Responsable", this.usuarios.some((u) => u.rol === "admin_segundo")],
      ["paginas", "Páginas propias (opcional)", this.paginas.length > 0]
    ];
  }

  pintarPasos() {
    this.pasos.replaceChildren(...this.faltas().map(([id, nombre, hecho]) =>
      el("li", { className: hecho ? "hecho" : "" }, el("a", { href: "#sec-" + id, textContent: nombre }))));
  }

  // --- Activa / oculta (por la principal: una desactivada no responde por su dirección) ---
  seccionEstado() {
    const activa = el("input", { type: "checkbox", checked: this.x.activa });
    const oculta = el("input", { type: "checkbox", checked: this.x.oculta });
    const msg = el("p", { className: "msg", hidden: true });
    const guardar = async (cambios, check) => {
      mensaje(msg, "Guardando…");
      try {
        await api(PRINCIPAL, "guardarParroquia", { slug: this.slug, parroquia: cambios });
        Object.assign(this.x, cambios);
        mensaje(msg, "Guardado ✓");
        if ("activa" in cambios) mostrarVista("editar", this.slug);
      } catch (err) {
        check.checked = !check.checked;
        mensaje(msg, err.message, true);
      }
    };
    activa.addEventListener("change", () => guardar({ activa: activa.checked }, activa));
    oculta.addEventListener("change", () => guardar({ oculta: oculta.checked }, oculta));
    return el("div", { className: "panel" }, el("h3", { textContent: "Estado" }),
      el("div", { className: "fila" },
        el("label", {}, activa, " Activa (se puede entrar)"),
        el("label", {}, oculta, " Oculta (no aparece en «Elegí tu parroquia»)")), msg);
  }

  // --- Datos ---
  seccionDatos() {
    const p = this.p;
    const nombre = el("input", { required: true, maxLength: 120, value: p.nombre });
    const nombreCorto = el("input", { maxLength: 40, value: p.nombreCorto });
    const lema = el("input", { maxLength: 200, value: p.lema });
    const descripcion = el("textarea", { maxLength: 4000, rows: 6, value: p.descripcion });
    const correo = el("input", { type: "email", value: p.correo });
    const msg = el("p", { className: "msg", hidden: true });
    const form = el("form", { className: "campos" },
      campo("Nombre", nombre), campo("Nombre corto", nombreCorto), campo("Lema o frase de bienvenida", lema),
      campo("Presentación (Inicio; un párrafo por línea)", descripcion), campo("Correo de contacto", correo),
      el("div", { className: "fila" }, el("button", { type: "submit", className: "btn btn-primario", textContent: "Guardar datos" })), msg);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      mensaje(msg, "Guardando…");
      try {
        const r = await api(this.slug, "guardarParroquia", {
          parroquia: { nombre: nombre.value, nombreCorto: nombreCorto.value, lema: lema.value, descripcion: descripcion.value, correo: correo.value }
        });
        this.cambio(r.parroquia);
        mensaje(msg, "Guardado ✓");
      } catch (err) {
        mensaje(msg, err.message, true);
      }
    });
    return el("div", { className: "panel", id: "sec-datos" }, el("h3", { textContent: "1. Datos" }), form);
  }

  // --- Logo ---
  seccionLogo() {
    const vista = el("img", { className: "vista-logo", alt: "Logo", src: absoluta(this.p.iconos["192"]) });
    const archivo = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/svg+xml" });
    const msg = el("p", { className: "msg", hidden: true });
    archivo.addEventListener("change", async () => {
      const f = archivo.files && archivo.files[0];
      if (!f) return;
      archivo.disabled = true;
      try {
        const img = await cargarImagen(f);
        let r;
        for (const tam of [512, 192, 180]) {
          mensaje(msg, "Subiendo el logo (" + tam + " px)…");
          r = await subir(this.slug, { tipo: "logo", tam: String(tam) }, await logoCuadrado(img, tam));
        }
        this.cambio(r.parroquia);
        vista.src = absoluta(r.parroquia.iconos["192"]);
        mensaje(msg, "Logo guardado ✓ (pestaña del navegador y app instalada)");
      } catch (err) {
        mensaje(msg, err.message, true);
      }
      archivo.disabled = false;
      archivo.value = "";
    });
    return el("div", { className: "panel", id: "sec-logo" }, el("h3", { textContent: "2. Logo" }),
      el("p", { className: "suave", textContent: "Imagen cuadrada de 512 px o más (si no es cuadrada se toma el centro). Se generan los tamaños 512, 192 y 180." }),
      el("div", { className: "fila" }, vista, archivo), msg);
  }

  // --- Portada ---
  seccionPortada() {
    const vista = el("div", { className: "vista-portada" });
    const pintar = () => (vista.style.backgroundImage = this.p.portada ? "url(" + JSON.stringify(absoluta(this.p.portada)) + ")" : "");
    pintar();
    const archivo = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
    const msg = el("p", { className: "msg", hidden: true });
    archivo.addEventListener("change", async () => {
      const f = archivo.files && archivo.files[0];
      if (!f) return;
      archivo.disabled = true;
      mensaje(msg, "Subiendo la foto…");
      try {
        const blob = await portadaLiviana(f);
        const r = await subir(this.slug, { tipo: "portada", mime: blob.type }, blob);
        this.cambio(r.parroquia);
        pintar();
        mensaje(msg, "Foto guardada ✓");
      } catch (err) {
        mensaje(msg, err.message, true);
      }
      archivo.disabled = false;
      archivo.value = "";
    });
    return el("div", { className: "panel", id: "sec-portada" }, el("h3", { textContent: "3. Foto de portada" }),
      el("p", { className: "suave", textContent: "La foto grande del Inicio (horizontal)." }),
      el("div", { className: "fila" }, vista, archivo), msg);
  }

  // --- Comunidades ---
  seccionComunidades() {
    const lista = el("ul", { className: "lista-simple" });
    const msg = el("p", { className: "msg", hidden: true });
    const accion = async (nombre, datos, ok) => {
      mensaje(msg, "Guardando…");
      try {
        const r = await api(this.slug, nombre, datos);
        this.cambio(r.parroquia);
        pintar();
        if (this.repintarPersonas) this.repintarPersonas();
        mensaje(msg, ok);
        return true;
      } catch (err) {
        mensaje(msg, err.message, true);
        return false;
      }
    };
    const pintar = () => {
      const coms = this.p.comunidades;
      if (!coms.length) {
        lista.replaceChildren(el("li", { className: "suave", textContent: "Todavía no hay comunidades." }));
        return;
      }
      lista.replaceChildren(...coms.map((c, i) => {
        const nombre = el("input", { value: c.nombre, maxLength: 100, title: "Cambiá el nombre y salí del campo para guardarlo" });
        nombre.addEventListener("change", () => {
          const v = nombre.value.trim();
          if (!v || v === c.nombre) return (nombre.value = c.nombre);
          accion("guardarComunidad", { comunidad: { slug: c.slug, nombre: v } }, "Nombre cambiado ✓");
        });
        const mover = (d) => {
          const orden = coms.map((y) => y.slug);
          orden.splice(i + d, 0, orden.splice(i, 1)[0]);
          accion("ordenarComunidades", { orden }, "Orden guardado ✓");
        };
        const subirB = el("button", { type: "button", className: "btn-chico", textContent: "↑", disabled: i === 0, onclick: () => mover(-1) });
        const bajarB = el("button", { type: "button", className: "btn-chico", textContent: "↓", disabled: i === coms.length - 1, onclick: () => mover(1) });
        const quitar = el("button", { type: "button", className: "btn-chico", textContent: "Quitar" });
        quitar.addEventListener("click", () => {
          if (confirm("¿Quitar la comunidad «" + c.nombre + "»?")) accion("borrarComunidad", { slug: c.slug }, "Comunidad quitada ✓");
        });
        return el("li", {}, nombre, subirB, bajarB, quitar, enlace(urlParroquia(this.slug, "comunidad?c=" + encodeURIComponent(c.slug)), "ver"));
      }));
    };
    pintar();
    const nueva = el("textarea", { rows: 3, placeholder: "Una comunidad por línea (capillas, coros con su propia página…)" });
    const form = el("form", { className: "campos" }, campo("Comunidades nuevas", nueva),
      el("div", { className: "fila" }, el("button", { type: "submit", className: "btn btn-primario", textContent: "Agregar" })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nombres = nueva.value.split("\n").map((s) => s.trim()).filter(Boolean);
      for (const n of nombres) {
        if (!(await accion("guardarComunidad", { comunidad: { nombre: n } }, "Comunidad agregada ✓"))) return;
      }
      nueva.value = "";
    });
    return el("div", { className: "panel", id: "sec-comunidades" }, el("h3", { textContent: "4. Comunidades" }),
      el("p", { className: "suave", textContent: "Cada comunidad tiene su página con noticias, cancioneros de misa y coros. Los registrados guardan sus cancioneros en su comunidad." }),
      lista, form, msg);
  }

  // --- Personas ---
  seccionPersonas() {
    const lista = el("ul", { className: "lista-simple" });
    const invitadosNodo = el("div");
    const msg = el("p", { className: "msg", hidden: true });
    const resultado = el("div");
    const nombreCom = (s) => (s === "parroquia" ? "Toda la parroquia" : (this.p.comunidades.find((c) => c.slug === s) || {}).nombre || s || "—");
    const pintar = () => {
      lista.replaceChildren(...(this.usuarios.length ? this.usuarios.map((u) => {
        const quitar = u.rol === "admin_general" ? null : el("button", { type: "button", className: "btn-chico", textContent: "Quitar permisos" });
        if (quitar) {
          quitar.addEventListener("click", async () => {
            if (!confirm("¿Quitarle los permisos en esta parroquia a " + u.email + "?")) return;
            try {
              await api(this.slug, "eliminarUsuario", { email: u.email });
              await this.cargarUsuarios();
              pintar();
              this.cambio();
              mensaje(msg, "Permisos quitados ✓");
            } catch (err) {
              mensaje(msg, err.message, true);
            }
          });
        }
        return el("li", {}, el("strong", { textContent: u.nombre || u.email }), el("span", { textContent: u.email }),
          el("span", { className: "rol", textContent: (ROLES[u.rol] || u.rol) + " · " + nombreCom(u.comunidad) + (u.activo ? "" : " · bloqueado") }), quitar);
      }) : [el("li", { className: "suave", textContent: "Nadie tiene permisos todavía." })]));
      invitadosNodo.replaceChildren(el("details", {}, el("summary", { textContent: "Invitados que entraron sin permisos: " + this.invitados.length }),
        el("ul", {}, this.invitados.map((i) => el("li", { textContent: (i.nombre && i.nombre !== i.email ? i.nombre + " · " : "") + (i.email || "") })))));
      const actual = comunidad.value;
      comunidad.replaceChildren(el("option", { value: "parroquia", textContent: "Toda la parroquia" }),
        ...this.p.comunidades.map((c) => el("option", { value: c.slug, textContent: c.nombre })));
      if ([...comunidad.options].some((o) => o.value === actual)) comunidad.value = actual;
    };
    this.repintarPersonas = pintar;

    const email = el("input", { type: "email", required: true, placeholder: "correo@gmail.com" });
    const nombre = el("input", { maxLength: 80, placeholder: "Nombre (opcional)" });
    const rol = el("select", {}, ROLES_INVITABLES.map((r) => el("option", { value: r, textContent: ROLES[r] })));
    const comunidad = el("select");
    const tel = el("input", { type: "tel", placeholder: "WhatsApp (opcional)" });
    rol.value = "admin";
    const form = el("form", { className: "campos" },
      el("div", { className: "fila" }, email, nombre),
      el("div", { className: "fila" }, rol, comunidad, tel),
      el("div", { className: "fila" }, el("button", { type: "submit", className: "btn btn-primario", textContent: "Invitar" })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      mensaje(msg, "Guardando…");
      resultado.replaceChildren();
      try {
        const r = await api(this.slug, "invitar", { email: email.value.trim(), nombre: nombre.value.trim(), rol: rol.value, comunidad: comunidad.value });
        await this.cargarUsuarios();
        pintar();
        this.cambio();
        mensaje(msg, "Invitación lista ✓");
        resultado.replaceChildren(cajaInvitacion(r.texto, tel.value));
        email.value = nombre.value = tel.value = "";
      } catch (err) {
        mensaje(msg, err.message, true);
      }
    });
    pintar();
    return el("div", { className: "panel", id: "sec-personas" }, el("h3", { textContent: "5. Responsable y administradores" }),
      el("p", { className: "suave", textContent: "El Responsable administra toda la parroquia; el Administrador de comunidad, su comunidad (noticias, coros, cancioneros e invitaciones). Entran con su cuenta de Google, sin clave." }),
      lista, invitadosNodo, el("h3", { textContent: "Invitar" }), form, msg, resultado);
  }

  // --- Páginas propias ---
  seccionPaginas() {
    const lista = el("ul", { className: "lista-simple" });
    const msg = el("p", { className: "msg", hidden: true });
    const titulo = el("input", { required: true, maxLength: 120, placeholder: "Nuestra historia" });
    const direccion = el("input", { maxLength: 60, pattern: "[a-z0-9][a-z0-9-]{0,58}[a-z0-9]", placeholder: "historia (vacío = sale del título)" });
    const html = el("textarea", { className: "codigo", placeholder: "<p>Texto de la página…</p>\n<h2>Horarios</h2>\n<ul><li>Domingo 10:00</li></ul>" });
    const enMenu = el("input", { type: "checkbox", checked: true });
    const archivo = el("input", { type: "file", accept: ".html,.htm,text/html" });
    const previa = el("iframe", { className: "vista-previa", sandbox: "", title: "Vista previa" });
    const guardar = el("button", { type: "submit", className: "btn btn-primario", textContent: "Guardar página" });
    let editandoPagina = null;

    const pintarPrevia = () => {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      previa.srcdoc = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><base href="${esc(urlParroquia(this.slug, "p/"))}">` +
        `<link rel="stylesheet" href="${esc(ESTADO.sitio)}css/site.css"><style>.pagina{padding-top:1.5rem}</style></head><body>` +
        `<main class="pagina pagina-ancha"><h1>${esc(titulo.value || "Título")}</h1><p class="subtitulo">${esc(this.p.nombre)}</p>` +
        `<article class="pagina-propia">${html.value}</article></main></body></html>`;
    };
    let espera = 0;
    const previaLuego = () => {
      clearTimeout(espera);
      espera = setTimeout(pintarPrevia, 400);
    };
    titulo.addEventListener("input", previaLuego);
    html.addEventListener("input", previaLuego);

    const limpiar = () => {
      editandoPagina = null;
      titulo.value = direccion.value = html.value = "";
      direccion.disabled = false;
      enMenu.checked = true;
      guardar.textContent = "Guardar página";
      pintarPrevia();
    };
    archivo.addEventListener("change", async () => {
      const f = archivo.files && archivo.files[0];
      if (!f) return;
      const texto = await f.text();
      html.value = cuerpoDeHtml(texto);
      if (!titulo.value) titulo.value = new DOMParser().parseFromString(texto, "text/html").title || f.name.replace(/\.html?$/i, "");
      archivo.value = "";
      pintarPrevia();
    });

    const pintar = () => {
      lista.replaceChildren(...(this.paginas.length ? this.paginas.map((pg) => {
        const editar = el("button", { type: "button", className: "btn-chico", textContent: "Editar" });
        editar.addEventListener("click", () => {
          editandoPagina = pg.slug;
          titulo.value = pg.titulo;
          direccion.value = pg.slug;
          direccion.disabled = true;
          html.value = pg.html || "";
          enMenu.checked = pg.enMenu !== false;
          guardar.textContent = "Guardar cambios";
          pintarPrevia();
          titulo.focus();
        });
        const quitar = el("button", { type: "button", className: "btn-chico", textContent: "Quitar" });
        quitar.addEventListener("click", async () => {
          if (!confirm("¿Quitar la página «" + pg.titulo + "»?")) return;
          try {
            const r = await api(this.slug, "borrarPagina", { slug: pg.slug });
            await this.cargarPaginas();
            if (editandoPagina === pg.slug) limpiar();
            pintar();
            this.cambio(r.parroquia);
            mensaje(msg, "Página quitada ✓");
          } catch (err) {
            mensaje(msg, err.message, true);
          }
        });
        return el("li", {}, enlace(pg.url, pg.titulo), el("span", { className: "suave", textContent: "/p/" + pg.slug + (pg.enMenu ? " · en el menú" : " · fuera del menú") }), editar, quitar);
      }) : [el("li", { className: "suave", textContent: "Todavía no hay páginas propias." })]));
    };

    const form = el("form", { className: "campos" },
      campo("Título", titulo), campo("Dirección (…/p/historia)", direccion),
      campo("Contenido (HTML: <p>, <h2>, <ul>, <img>, <a>, <table>, videos de YouTube…; los scripts se quitan)", html),
      campo("O cargar un archivo .html de la computadora", archivo),
      el("label", {}, enMenu, " Mostrar en el menú de arriba"),
      el("div", { className: "fila" }, guardar, el("button", { type: "button", className: "btn", textContent: "Página nueva", onclick: limpiar })), msg);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      guardar.disabled = true;
      mensaje(msg, "Guardando…");
      try {
        const r = await api(this.slug, "guardarPagina", {
          pagina: { slug: editandoPagina || direccion.value.trim(), titulo: titulo.value, html: html.value, enMenu: enMenu.checked, nueva: !editandoPagina }
        });
        await this.cargarPaginas();
        pintar();
        this.cambio(r.parroquia);
        limpiar();
        mensaje(msg, "Página guardada ✓ " + r.pagina.url);
      } catch (err) {
        mensaje(msg, err.message, true);
      }
      guardar.disabled = false;
    });
    pintar();
    pintarPrevia();
    return el("div", { className: "panel", id: "sec-paginas" }, el("h3", { textContent: "6. Páginas propias" }),
      el("p", { className: "suave", textContent: "Páginas con contenido propio de la parroquia (historia, horarios, contacto, sacramentos…) en " + urlParroquia(this.slug, "p/…") + ". El responsable también las edita desde el sitio (Identificarse → Datos de la parroquia)." }),
      lista, form, el("h3", { textContent: "Vista previa" }), previa);
  }

  // --- Resumen ---
  seccionResumen() {
    const caja = el("div", { className: "panel", id: "sec-resumen" });
    const pintar = () => {
      const faltan = this.faltas().filter(([, , hecho]) => !hecho);
      caja.replaceChildren(el("h3", { textContent: "7. Resumen" }),
        faltan.length
          ? el("p", {}, "Falta: " + faltan.map(([, n]) => n).join(", ") + ".")
          : el("p", { className: "msg ok", textContent: "La parroquia está completa ✓" }),
        this.x.oculta ? el("p", { className: "suave", textContent: "Sigue oculta: cuando esté lista, desmarcá «Oculta» arriba para que aparezca en «Elegí tu parroquia»." }) : null,
        el("ul", { className: "arbol" },
          ESTRUCTURA.paginasComunes.map((pg) => el("li", {}, enlace(urlParroquia(this.slug, pg.slug), pg.titulo + " (/" + pg.slug + ")"))),
          this.paginas.map((pg) => el("li", {}, enlace(pg.url, pg.titulo + " (/p/" + pg.slug + ")"))),
          el("li", {}, enlace(urlParroquia(this.slug, "login"), "Identificarse (donde entran el responsable y los administradores)"))));
    };
    this.repintarResumen = pintar;
    pintar();
    return caja;
  }
}

// ==================== arranque ====================

(async function iniciar() {
  try {
    ESTADO = await local("/local/estado");
  } catch (err) {
    $("estado-sitio").textContent = err.message;
    return;
  }
  pintarEstado();
  ESTRUCTURA = await local("/local/estructura").catch(() => ESTRUCTURA);
  if (ESTADO.claveVigente) mostrarVista("mapa");
})();
