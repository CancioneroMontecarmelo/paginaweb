/**
 * bienvenida.js — Primera vez en el reproductor: ¿perteneces a una parroquia o movimiento?
 * Se puede seguir sin identificarse (listas y cola quedan en el equipo).
 */

import { abrirUnirseFeligres } from "./feligres.js";

const CLAVE = "mc-bienvenida";

function yaRespondio() {
  try { return localStorage.getItem(CLAVE) === "1"; } catch (_) { return true; }
}

function marcar() {
  try { localStorage.setItem(CLAVE, "1"); } catch (_) { /* sin almacenamiento */ }
}

function el(tag, props, ...hijos) {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...hijos.filter((h) => h != null));
  return e;
}

function abrirDialogo(titulo, texto) {
  if (document.querySelector(".dlg-bienvenida")) return;
  const dlg = el("dialog", { className: "dlg-bienvenida", "aria-labelledby": "mc-bien-titulo" });
  const cerrar = () => { marcar(); dlg.close(); dlg.remove(); };
  const feligres = el("button", { type: "button", className: "btn btn-primario", textContent: "Soy feligrés (correo o Google)" });
  feligres.addEventListener("click", () => { cerrar(); abrirUnirseFeligres({}); });
  dlg.append(
    el("h2", { id: "mc-bien-titulo", textContent: titulo }),
    el("p", { textContent: texto }),
    el("div", { className: "dlg-bienvenida-acciones" },
      feligres,
      el("a", { className: "btn btn-secundario", href: "/elegir", textContent: "Buscar en el mapa" }),
      el("a", { className: "btn btn-secundario", href: "/sumar", textContent: "Sumar la mía (administrador)" }),
      (() => {
        const b = el("button", { type: "button", className: "btn btn-fantasma", textContent: "Seguir así" });
        b.addEventListener("click", cerrar);
        return b;
      })()
    )
  );
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); cerrar(); });
  document.body.append(dlg);
  if (typeof dlg.showModal === "function") dlg.showModal();
  else cerrar();
}

/** Primera visita al reproductor (equipo sin parroquia elegida). */
export function mostrarBienvenidaSiCorresponde() {
  if (yaRespondio()) return;
  try {
    if (localStorage.getItem("mc-parroquia")) { marcar(); return; }
  } catch (_) { /* */ }
  abrirDialogo(
    "¿De qué parroquia o movimiento eres?",
    "Puedes entrar como feligrés con tu correo, buscarla en el mapa, sumarla como administrador, o seguir sin identificarte. Sin cuenta, lo que guardes queda en este equipo."
  );
}

/** Tras entrar con correo o Google como visitante: preguntar pertenencia si aún no respondió. */
export function preguntarPertenenciaTrasEntrar() {
  if (yaRespondio()) return;
  abrirDialogo(
    "¿Perteneces a alguna parroquia o comunidad?",
    "Entra como feligrés con tu correo (si no está, la creamos al tiro), búscala en el mapa, o súmala si quieres administrarla."
  );
}
