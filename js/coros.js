// Diálogo «Coros de la comunidad» (Misas e Identificarse): coros, integrantes, su rol en el coro y, con correo,
// sus permisos en el sitio. El servidor dice qué puede hacer cada uno con cada coro (gestion):
// 'total' (responsables, sacerdote, administrador de la comunidad), 'director' (su propio coro) o '' (solo ver).
import { llamarApi, sesionActual, comunidadesOpciones } from "./auth.js";

const VOCES = { soprano: "Soprano", contralto: "Contralto", tenor: "Tenor", bajo: "Bajo" };
const NIVELES = { basico: "Básico", intermedio: "Intermedio", avanzado: "Avanzado" };
const ROLES_CORO = { director: "Director", subdirector: "Subdirector", integrante: "Integrante" };
const PERMISOS = { "": "Sin permisos", colaborador: "Colaborador", editor: "Editor" };
const COLUMNAS = 13;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opciones = (lista, valor) => lista.map(([v, t]) => `<option value="${esc(v)}"${v === valor ? " selected" : ""}>${esc(t)}</option>`).join("");
const token = () => (sesionActual() || {}).token || "";
const hoyIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const nombreComunidad = (slug) => comunidadesOpciones().find((c) => c.slug === slug)?.nombre || "";

let dlg = null;
let lista = [];
let ed = null;
let firma = "";
let opts = {};

const $ = (id) => dlg.querySelector("#" + id);

/** Igual que gestionaCoros del servidor: quién puede crear coros en una comunidad. */
export function gestionaCoros(comunidad, s = sesionActual()) {
  if (!s || s.activo === false) return false;
  if (["admin_general", "admin_segundo", "sacerdote"].includes(s.rol)) return true;
  return s.rol === "admin" && (s.comunidad === comunidad || s.comunidad === "parroquia");
}

const comunidadesGestion = () => comunidadesOpciones().filter((c) => gestionaCoros(c.slug));

/** Coros que ve la sesión (los de su comunidad y los que dirige), con la gestión de cada uno. */
export async function listarCoros(opciones) {
  return (await llamarApi("listarCoros", { token: token() }, opciones)).coros || [];
}

const HTML = `
  <form method="dialog" class="co-form">
    <div class="co-cabeza">
      <h2>Coros de la comunidad</h2>
      <button type="button" class="btn-chico" data-co-cerrar>Cerrar</button>
    </div>
    <div class="co-cuerpo">
      <div class="co-elegir">
        <label>Coro <select id="co-lista"></select></label>
        <button type="button" class="btn-chico" id="co-nuevo">+ Nuevo coro</button>
      </div>
      <p class="co-director" id="co-director"></p>
      <p class="co-nota" id="co-nota" hidden></p>
      <div class="co-grilla">
        <label>Nombre del coro <input type="text" id="co-nombre" required maxlength="100"></label>
        <label>Comunidad <select id="co-comunidad" required></select></label>
      </div>
      <h3 class="co-h3">Integrantes</h3>
      <p class="co-ayuda" id="co-ayuda"></p>
      <div class="co-scroll">
        <table class="co-tabla">
          <thead>
            <tr>
              <th>Nombre</th><th>Correo</th><th>Rol en el coro</th><th>Permisos en el sitio</th><th>Comunidad</th>
              <th>Incorporación</th><th>Voz</th><th>Instrumentos</th><th>Lee partitura</th><th>Nivel</th><th>Notas</th>
              <th>Activo</th><th></th>
            </tr>
          </thead>
          <tbody id="co-integrantes"></tbody>
        </table>
      </div>
      <button type="button" class="btn-chico" id="co-agregar">+ Agregar integrante</button>
      <p class="msg-error" id="co-error" hidden></p>
      <p class="msg-ok co-ok" id="co-ok" hidden></p>
      <div class="co-acciones">
        <button type="button" class="btn-chico co-peligro" id="co-borrar" hidden>Borrar coro</button>
        <span class="co-espacio"></span>
        <button type="button" class="btn btn-secundario" data-co-cerrar>Cerrar</button>
        <button type="submit" class="btn btn-primario" id="co-guardar">Guardar coro</button>
      </div>
    </div>
  </form>`;

function mensaje(id, texto) {
  $(id).textContent = texto || "";
  $(id).hidden = !texto;
}

const gestion = () => (ed && ed.gestion) || "";

function leerForm() {
  if (!ed) return;
  ed.nombre = $("co-nombre").value.trim();
  if (gestion() === "total") ed.comunidad = $("co-comunidad").value;
}

function cambios() {
  leerForm();
  return !!ed && gestion() !== "" && JSON.stringify(ed) !== firma;
}

const confirmarDescartar = (texto) => !cambios() || confirm(texto || "Hay cambios sin guardar en este coro. ¿Descartarlos?");

function pintarLista() {
  const items = lista.map((c) => [c.id, `${c.nombre} · ${nombreComunidad(c.comunidad)}`]);
  if (comunidadesGestion().length) items.push(["", "— Coro nuevo —"]);
  $("co-lista").innerHTML = opciones(items, ed?.id || "");
  $("co-lista").disabled = items.length < 2;
}

function pintarDirector() {
  const d = ed.integrantes.find((i) => i.rolCoro === "director");
  const p = $("co-director");
  p.replaceChildren();
  if (d && d.nombre) {
    p.append("Director: ", Object.assign(document.createElement("strong"), { textContent: d.nombre }));
    if (d.email) p.append(Object.assign(document.createElement("span"), { textContent: " · " + d.email }));
  } else {
    p.append("Director: ", Object.assign(document.createElement("em"), { textContent: "todavía sin director (elegilo en «Rol en el coro»)" }));
  }
}

function elegir(id) {
  const c = lista.find((x) => x.id === id);
  const propias = comunidadesGestion();
  const porDefecto = propias.some((x) => x.slug === opts.comunidad) ? opts.comunidad : propias[0]?.slug || "";
  ed = c ? structuredClone(c) : { nombre: "", comunidad: porDefecto, integrantes: [], gestion: propias.length ? "total" : "" };
  firma = JSON.stringify(ed);
  const g = gestion();
  $("co-nombre").value = ed.nombre;
  $("co-nombre").disabled = !g;
  const comunidades = g === "total" ? propias : comunidadesOpciones().filter((x) => x.slug === ed.comunidad);
  $("co-comunidad").innerHTML = opciones(comunidades.map((x) => [x.slug, x.nombre]), ed.comunidad);
  $("co-comunidad").disabled = g !== "total";
  $("co-borrar").hidden = !(ed.id && g === "total");
  $("co-guardar").hidden = $("co-agregar").hidden = !g;
  $("co-nuevo").hidden = !propias.length;
  mensaje("co-nota", g === "director"
    ? "Dirigís este coro: podés cambiar sus integrantes y nombrar subdirectores. Quién dirige, la comunidad y los permisos en el sitio los cambian los administradores."
    : g ? "" : "Solo lectura: los coros los cambian los responsables, el sacerdote, el administrador de la comunidad o el director del coro.");
  $("co-ayuda").textContent = g === "total"
    ? "Con su correo de Google, cada integrante puede recibir permisos en el sitio para esta comunidad: Colaborador o Editor."
    : "";
  mensaje("co-error", "");
  mensaje("co-ok", "");
  pintarLista();
  pintarIntegrantes();
}

function celdaPermiso(p, g) {
  if (!p.email) return '<span class="co-tenue">Falta el correo</span>';
  if (p.permisoFijo) return `<span class="co-fijo" title="Este permiso se cambia en «Administradores y permisos»">${esc(p.permisoFijo)}</span>`;
  const valor = p.permiso ?? (PERMISOS[p.permisoActual] ? p.permisoActual : "");
  if (g !== "total") return `<span class="co-tenue">${esc(PERMISOS[valor] || "Sin permisos")}</span>`;
  return `<select data-campo="permiso" aria-label="Permisos en el sitio">${opciones(Object.entries(PERMISOS), valor)}</select>`;
}

function pintarIntegrantes() {
  const g = gestion();
  const ro = g ? "" : " disabled";
  const comunidades = comunidadesOpciones().map((c) => [c.slug, c.nombre]);
  $("co-integrantes").innerHTML = ed.integrantes.map((p, i) => {
    const esDirector = p.rolCoro === "director";
    const fijo = g === "director" && esDirector ? " disabled" : ro;
    const roles = Object.entries(ROLES_CORO).filter(([k]) => g === "total" || k !== "director" || esDirector);
    return `<tr data-i="${i}"${esDirector ? ' class="co-es-director"' : ""}>
      <td data-et="Nombre"><input type="text" class="co-i-nombre" data-campo="nombre" value="${esc(p.nombre)}" maxlength="100" aria-label="Nombre"${ro}></td>
      <td data-et="Correo"><input type="email" class="co-i-correo" data-campo="email" value="${esc(p.email)}" placeholder="persona@gmail.com" maxlength="120" aria-label="Correo"${fijo}></td>
      <td data-et="Rol en el coro"><select data-campo="rolCoro" aria-label="Rol en el coro"${fijo}>${opciones(roles, p.rolCoro || "integrante")}</select></td>
      <td data-et="Permisos en el sitio" class="co-permiso">${celdaPermiso(p, g)}</td>
      <td data-et="Comunidad"><select data-campo="comunidad" aria-label="Comunidad"${ro}>${opciones(comunidades, p.comunidad || ed.comunidad)}</select></td>
      <td data-et="Incorporación"><input type="date" data-campo="fechaIncorporacion" value="${esc(p.fechaIncorporacion)}" aria-label="Fecha de incorporación"${ro}></td>
      <td data-et="Voz"><select data-campo="voz" aria-label="Voz"${ro}>${opciones([["", "—"], ...Object.entries(VOCES)], p.voz || "")}</select></td>
      <td data-et="Instrumentos"><input type="text" class="co-i-instr" data-campo="instrumentos" value="${esc(p.instrumentos)}" placeholder="guitarra, flauta…" maxlength="200" aria-label="Instrumentos"${ro}></td>
      <td data-et="Lee partitura" class="co-centro"><input type="checkbox" data-campo="leePartitura"${p.leePartitura ? " checked" : ""} aria-label="Lee partitura"${ro}></td>
      <td data-et="Nivel"><select data-campo="nivel" aria-label="Nivel musical"${ro}>${opciones([["", "—"], ...Object.entries(NIVELES)], p.nivel || "")}</select></td>
      <td data-et="Notas"><input type="text" class="co-i-notas" data-campo="notas" value="${esc(p.notas)}" maxlength="500" aria-label="Notas"${ro}></td>
      <td data-et="Activo" class="co-centro"><input type="checkbox" data-campo="activo"${p.activo !== false ? " checked" : ""} aria-label="Activo"${ro}></td>
      <td>${g && !(g === "director" && esDirector) ? `<button type="button" class="co-quitar" data-quitar="${i}" title="Quitar integrante">×</button>` : ""}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="${COLUMNAS}" class="co-tenue">Todavía no hay integrantes.</td></tr>`;
  pintarDirector();
}

function avisoPermisos(permisos) {
  return (permisos || []).map((p) => (p.rol === "visitante"
    ? `${p.nombre || p.email} quedó sin permisos en el sitio.`
    : `${p.nombre || p.email} ahora es ${PERMISOS[p.rol] || p.rol}: que entre con Google con ese correo (${p.email}).`)).join("\n");
}

async function guardar(e) {
  e.preventDefault();
  leerForm();
  if (!ed.nombre) return mensaje("co-error", "Escribí el nombre del coro.");
  if (!ed.comunidad) return mensaje("co-error", "Elegí la comunidad del coro.");
  const sinCorreo = ed.integrantes.find((p) => p.permiso && !p.email);
  if (sinCorreo) return mensaje("co-error", `Para dar permisos a ${sinCorreo.nombre || "un integrante"} escribí su correo.`);
  const boton = $("co-guardar");
  boton.disabled = true;
  mensaje("co-error", "");
  mensaje("co-ok", "");
  try {
    const r = await llamarApi("guardarCoro", { token: token(), coro: ed });
    lista = [...lista.filter((c) => c.id !== r.coro.id), r.coro];
    elegir(r.coro.id);
    const n = r.coro.integrantes.length;
    mensaje("co-ok", [`Se guardó «${r.coro.nombre}» con ${n} integrante${n === 1 ? "" : "s"}.`, avisoPermisos(r.permisos)].filter(Boolean).join("\n"));
    opts.alGuardar?.(lista);
  } catch (err) {
    mensaje("co-error", err.message);
  } finally {
    boton.disabled = false;
  }
}

async function borrar() {
  if (!ed?.id || !confirm(`¿Borrar el coro «${ed.nombre}» y sus integrantes?`)) return;
  try {
    await llamarApi("borrarCoro", { token: token(), id: ed.id });
    lista = lista.filter((c) => c.id !== ed.id);
    elegir(lista[0]?.id || "");
    opts.alGuardar?.(lista);
  } catch (err) {
    mensaje("co-error", err.message);
  }
}

function actualizar(e) {
  const fila = e.target.closest("tr[data-i]");
  const campo = e.target.dataset.campo;
  if (!fila || !campo) return;
  const p = ed.integrantes[+fila.dataset.i];
  p[campo] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  if (campo === "email" && e.type === "change") {
    p.email = p.email.trim().toLowerCase();
    delete p.permisoActual;
    delete p.permisoFijo;
    pintarIntegrantes();
  }
  if (campo === "rolCoro" && e.type === "change") {
    if (p.rolCoro === "director") ed.integrantes.forEach((x) => { if (x !== p && x.rolCoro === "director") x.rolCoro = "integrante"; });
    pintarIntegrantes();
  }
  if (campo === "nombre") pintarDirector();
}

function crearDialogo() {
  dlg = document.getElementById("dlg-coros");
  if (dlg) return;
  dlg = Object.assign(document.createElement("dialog"), { id: "dlg-coros", className: "dlg-coros", innerHTML: HTML });
  document.body.append(dlg);
  dlg.querySelector("form").addEventListener("submit", guardar);
  dlg.querySelectorAll("[data-co-cerrar]").forEach((b) =>
    b.addEventListener("click", () => {
      if (confirmarDescartar("Hay cambios sin guardar en este coro. ¿Cerrar igual?")) dlg.close();
    }));
  dlg.addEventListener("cancel", (e) => {
    if (!confirmarDescartar("Hay cambios sin guardar en este coro. ¿Cerrar igual?")) e.preventDefault();
  });
  $("co-borrar").addEventListener("click", borrar);
  $("co-lista").addEventListener("change", (e) => {
    if (!confirmarDescartar()) {
      e.target.value = ed?.id || "";
      return;
    }
    elegir(e.target.value);
  });
  $("co-nuevo").addEventListener("click", () => {
    if (!confirmarDescartar()) return;
    elegir("");
    $("co-nombre").focus();
  });
  $("co-agregar").addEventListener("click", () => {
    leerForm();
    ed.integrantes.push({
      nombre: "", email: "", rolCoro: "integrante", comunidad: ed.comunidad, fechaIncorporacion: hoyIso(), voz: "",
      instrumentos: "", leePartitura: false, nivel: "", notas: "", activo: true
    });
    pintarIntegrantes();
    $("co-integrantes").querySelector("tr:last-child .co-i-nombre")?.focus();
  });
  const tabla = $("co-integrantes");
  tabla.addEventListener("input", actualizar);
  tabla.addEventListener("change", actualizar);
  tabla.addEventListener("click", (e) => {
    const q = e.target.closest("[data-quitar]");
    if (!q) return;
    const p = ed.integrantes[+q.dataset.quitar];
    if (p.nombre && !confirm(`¿Quitar a ${p.nombre} del coro?`)) return;
    ed.integrantes.splice(+q.dataset.quitar, 1);
    pintarIntegrantes();
  });
}

/**
 * Abre el diálogo. `comunidad`: la que se elige primero (y la de un coro nuevo);
 * `alGuardar(coros)`: se llama con la lista actualizada después de guardar o borrar.
 */
export async function abrirCoros({ comunidad = "", alGuardar } = {}) {
  crearDialogo();
  opts = { comunidad: comunidad || sesionActual()?.comunidad || "", alGuardar };
  ed = null;
  $("co-integrantes").innerHTML = `<tr><td colspan="${COLUMNAS}" class="co-tenue">Cargando…</td></tr>`;
  mensaje("co-error", "");
  mensaje("co-ok", "");
  if (!dlg.open) dlg.showModal();
  try {
    lista = await listarCoros();
  } catch (e) {
    lista = [];
    mensaje("co-error", e.message);
  }
  const propio = lista.find((c) => c.comunidad === opts.comunidad) || lista[0];
  elegir(propio?.id || "");
  if (!propio && !comunidadesGestion().length) mensaje("co-nota", "Todavía no tenés coros para ver ni crear.");
}
