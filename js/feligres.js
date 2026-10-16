/**
 * feligres.js — Entrar como feligrés de una parroquia (correo o Google).
 * Si no existe, el servidor crea un espacio mínimo y se entra al reproductor.
 */

const API = () => (location.origin + "/api");
const CLIENT_ID = "446127505219-pei616euh78muqr6ak500br0ac41t2mk.apps.googleusercontent.com";

function el(tag, props, ...hijos) {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...hijos.filter((h) => h != null));
  return e;
}

function aviso(p, texto, error) {
  p.hidden = !texto;
  p.className = error ? "msg-error" : "msg-ok";
  p.textContent = texto || "";
}

let gsi = null;
function cargarGsi() {
  gsi ||= new Promise((ok, mal) => {
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.onload = ok;
    sc.onerror = () => { gsi = null; mal(new Error("No se pudo cargar Google. Revisa tu conexión.")); };
    document.head.append(sc);
  });
  return gsi;
}

async function enviar(cuerpo) {
  const r = await (await fetch(API(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ accion: "unirseComoFeligres", ...cuerpo })
  })).json();
  if (!r.ok) throw new Error(r.error || "No se pudo entrar.");
  return r;
}

function guardarYEntrar(r) {
  try {
    localStorage.setItem("mc-sesion:" + r.slug, JSON.stringify({ ...r.sesion, desde: Date.now() }));
    localStorage.setItem("mc-parroquia", r.slug);
    localStorage.setItem("mc-bienvenida", "1");
  } catch (_) { /* */ }
  location.replace("/" + r.slug + "/");
}

/**
 * Diálogo: soy feligrés de esta parroquia (slug conocido) o de un nombre escrito.
 * @param {{ slug?: string, nombre?: string, comuna?: string }} opts
 */
export function abrirUnirseFeligres(opts = {}) {
  if (document.querySelector(".dlg-feligres")) return;
  const dlg = el("dialog", { className: "dlg-feligres dlg-bienvenida", "aria-labelledby": "mc-fel-titulo" });
  const titulo = opts.slug
    ? "Entra como feligrés"
    : "¿De qué parroquia o movimiento eres?";
  const nombre = el("input", {
    maxLength: 120, required: true, autocomplete: "organization",
    value: opts.nombre || "", placeholder: "Parroquia Santo Domingo…",
    hidden: !!opts.slug
  });
  const email = el("input", { type: "email", maxLength: 120, autocomplete: "email", placeholder: "tu@correo.com", required: true });
  const msg = el("p", { hidden: true });
  const cajaGoogle = el("div", { className: "su-google" });
  const cerrar = () => { dlg.close(); dlg.remove(); };

  const conCorreo = el("button", { type: "button", className: "btn btn-primario", textContent: "Entrar con mi correo" });
  conCorreo.addEventListener("click", async () => {
    aviso(msg, "Entrando…");
    conCorreo.disabled = true;
    try {
      const r = await enviar({
        slug: opts.slug || "",
        nombre: opts.nombre || nombre.value.trim(),
        comuna: opts.comuna || "",
        email: email.value.trim()
      });
      guardarYEntrar(r);
    } catch (err) {
      aviso(msg, err.message, true);
      conCorreo.disabled = false;
    }
  });

  const cancelar = el("button", { type: "button", className: "btn btn-fantasma", textContent: "Cancelar" });
  cancelar.addEventListener("click", cerrar);
  dlg.append(
    el("h2", { id: "mc-fel-titulo", textContent: titulo }),
    el("p", { textContent: opts.slug
      ? "Entra con tu correo o con Google. Quedas como feligrés (sin administrar). Si aún no hay cancionero propio, igual puedes usar la Biblioteca."
      : "Si no está en la lista, la creamos al tiro y entras como feligrés. El mapa y el resto los configuramos después." }),
    opts.slug ? el("p", { className: "suave", textContent: opts.nombre || opts.slug }) : null,
    opts.slug ? null : el("label", { className: "campo-admin" }, el("span", { textContent: "Nombre" }), nombre),
    el("label", { className: "campo-admin" }, el("span", { textContent: "Tu correo" }), email),
    el("div", { className: "dlg-bienvenida-acciones" }, conCorreo, cajaGoogle, cancelar),
    msg
  );
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); cerrar(); });
  document.body.append(dlg);
  dlg.showModal();

  cargarGsi().then(() => {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (resp) => {
        aviso(msg, "Entrando…");
        try {
          const r = await enviar({
            slug: opts.slug || "",
            nombre: opts.nombre || nombre.value.trim(),
            comuna: opts.comuna || "",
            credential: resp.credential
          });
          guardarYEntrar(r);
        } catch (err) {
          aviso(msg, err.message, true);
        }
      },
      ux_mode: "popup"
    });
    google.accounts.id.renderButton(cajaGoogle, { theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: "es" });
  }).catch((e) => aviso(msg, e.message, true));
}
