/**
 * entrada.js — Primera visita: carrusel + Entrar.
 * Parroquias/movimientos: solo en «Cambiar parroquia» (?cambiar=1 / menú).
 */
import {
  ZONAS,
  entradaHecha,
  marcarEntradaHecha,
  leerPertenencias,
  guardarPertenencias,
  marcarSoloLocal,
  elegirActiva,
  setActiva,
  registrarVisitanteEn,
  cargarDirectorio,
  irAActiva,
  activaSlug
} from "./pertenencias.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function abrirFondo(claseDlg, html) {
  const wrap = document.createElement("div");
  wrap.className = "dlg-fondo dlg-entrada-fondo";
  wrap.innerHTML = `<div class="dlg ${claseDlg}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  return wrap;
}

function cerrarDlg(wrap) {
  wrap?.remove();
}

function limpiarQueryCambiar() {
  if (!/[?&]cambiar=1\b/.test(location.search)) return;
  const u = new URL(location.href);
  u.searchParams.delete("cambiar");
  history.replaceState({}, "", u.pathname + (u.search || "") + u.hash);
}

/** Solo si ya respondió la bienvenida vieja (no usar mc-parroquia: config.js la setea siempre). */
function migrarBienvenidaVieja() {
  try {
    if (localStorage.getItem("mc-bienvenida") !== "1") return false;
    const slugViejo = localStorage.getItem("mc-parroquia");
    if (slugViejo && !leerPertenencias().length && localStorage.getItem("mc-solo-local") !== "1") {
      guardarPertenencias([{ slug: slugViejo, tipo: "parroquia", nombre: slugViejo }]);
    } else if (!leerPertenencias().length) {
      marcarSoloLocal();
      return true;
    }
    marcarEntradaHecha();
    return true;
  } catch (_) {
    return false;
  }
}

const SLIDES = [
  {
    img: "/Imagenes/onboarding/slide-1.jpg",
    titulo: "Cantos para el domingo",
    texto: "El próximo domingo y las sugerencias según el tiempo litúrgico y las lecturas: sabés qué tocar en la misa."
  },
  {
    img: "/Imagenes/onboarding/slide-2.jpg",
    titulo: "Letra, acordes y audio",
    texto: "Cada canción trae letra con acordes en notación latina y audio. Transponé el tono y ensayá en el celular."
  },
  {
    img: "/Imagenes/onboarding/slide-3.jpg",
    titulo: "Listas y cancioneros",
    texto: "Armá listas, guardá el cancionero de la misa y compartilo con el coro o la asamblea."
  },
  {
    img: "/Imagenes/onboarding/slide-4.jpg",
    titulo: "Tu parroquia, cuando quieras",
    texto: "Podés usar el cancionero ya, sin identificarte. Después, en «Cambiar parroquia», unís tu comunidad."
  }
];

/**
 * Primera visita: carrusel + Entrar (solo local, sin pedir parroquia).
 * @returns {boolean}
 */
export function mostrarOnboardingSiCorresponde() {
  if (entradaHecha()) return false;
  if (migrarBienvenidaVieja()) return false;
  if (document.querySelector(".dlg-onboarding")) return true;

  let indice = 0;
  const wrap = abrirFondo(
    "dlg-onboarding",
    `
    <div class="onb-marca">Cancionero Litúrgico</div>
    <div class="onb-carrusel" id="onb-carrusel">
      <div class="onb-pista" id="onb-pista">
        ${SLIDES.map(
          (s, i) => `<article class="onb-slide" data-i="${i}" ${i === 0 ? "" : "hidden"}>
            <figure class="onb-figura">
              <img class="onb-captura" src="${esc(s.img)}" alt="" width="640" height="480" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
            </figure>
            <h2>${esc(s.titulo)}</h2>
            <p class="onb-texto">${esc(s.texto)}</p>
          </article>`
        ).join("")}
      </div>
      <div class="onb-nav">
        <button type="button" class="onb-flecha" id="onb-prev" aria-label="Anterior">‹</button>
        <div class="onb-puntos" id="onb-puntos" role="tablist" aria-label="Pasos">
          ${SLIDES.map((_, i) => `<button type="button" class="onb-punto${i === 0 ? " onb-punto-activo" : ""}" data-i="${i}" aria-label="Paso ${i + 1}"></button>`).join("")}
        </div>
        <button type="button" class="onb-flecha" id="onb-next" aria-label="Siguiente">›</button>
      </div>
    </div>
    <button type="button" class="btn btn-primario onb-entrar" id="onb-entrar">Entrar</button>
    <p class="onb-pie">Sin identificarte podés usar el cancionero en este equipo.</p>
    <p class="onb-admin"><a href="/montecarmelo/login">Soy administrador</a></p>
  `
  );

  const pista = wrap.querySelector("#onb-pista");
  const puntos = wrap.querySelectorAll(".onb-punto");

  function pintar() {
    pista.querySelectorAll(".onb-slide").forEach((el, i) => {
      el.hidden = i !== indice;
    });
    puntos.forEach((el, i) => el.classList.toggle("onb-punto-activo", i === indice));
    wrap.querySelector("#onb-prev").disabled = indice === 0;
    wrap.querySelector("#onb-next").disabled = indice === SLIDES.length - 1;
  }

  function ir(i) {
    indice = Math.max(0, Math.min(SLIDES.length - 1, i));
    pintar();
  }

  wrap.querySelector("#onb-prev").addEventListener("click", () => ir(indice - 1));
  wrap.querySelector("#onb-next").addEventListener("click", () => ir(indice + 1));
  wrap.querySelector("#onb-puntos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (b) ir(+b.dataset.i);
  });

  let touchX = null;
  const carrusel = wrap.querySelector("#onb-carrusel");
  carrusel.addEventListener(
    "touchstart",
    (e) => {
      touchX = e.changedTouches[0].clientX;
    },
    { passive: true }
  );
  carrusel.addEventListener(
    "touchend",
    (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) < 40) return;
      if (dx < 0) ir(indice + 1);
      else ir(indice - 1);
    },
    { passive: true }
  );

  wrap.querySelector("#onb-entrar").addEventListener("click", () => {
    marcarSoloLocal();
    cerrarDlg(wrap);
    const activa = activaSlug();
    const cfg = (window.MONTECARMELO_CONFIG || {}).parroquia || "montecarmelo";
    if (cfg !== activa) irAActiva(activa);
  });

  pintar();
  return true;
}

/**
 * Formulario de parroquias/movimientos (menú o ?cambiar=1).
 */
export async function editarPertenencias() {
  if (document.querySelector(".dlg-entrada")) return true;

  let directorio = [];
  try {
    directorio = await cargarDirectorio();
  } catch (e) {
    console.warn("[entrada]", e);
  }

  const prev = leerPertenencias();
  const prevSlugs = new Set(prev.map((p) => p.slug));
  const pars = directorio.filter((p) => (p.tipo || "parroquia") !== "movimiento");
  const movs = directorio.filter((p) => p.tipo === "movimiento");

  const porZona = {};
  for (const z of ZONAS) porZona[z] = [];
  const otras = [];
  for (const p of pars) {
    const z = p.decanato && porZona[p.decanato] ? p.decanato : null;
    if (z) porZona[z].push(p);
    else otras.push(p);
  }

  function bloqueZona(nombre, items) {
    if (!items.length) return "";
    const checks = items
      .map((p) => {
        const marcada = prevSlugs.has(p.slug) || (!prev.length && p.slug === "montecarmelo");
        return `<label class="dlg-entrada-check">
          <input type="checkbox" name="pert" value="${esc(p.slug)}" data-tipo="parroquia" data-nombre="${esc(p.nombre)}" ${marcada ? "checked" : ""}>
          <span>${esc(p.nombreCorto || p.nombre)}</span>
        </label>`;
      })
      .join("");
    const abierta = nombre === "Centro" || items.some((i) => i.slug === "montecarmelo" || prevSlugs.has(i.slug));
    return `<details class="dlg-entrada-zona"${abierta ? " open" : ""}>
      <summary>${esc(nombre)} <span class="dlg-entrada-zona-n">(${items.length})</span></summary>
      <div class="dlg-entrada-checks">${checks}</div>
    </details>`;
  }

  const htmlZonas = ZONAS.map((z) => bloqueZona(z, porZona[z])).join("") +
    (otras.length ? bloqueZona("Otras", otras) : "");

  const htmlMovs = movs.length
    ? `<div class="dlg-entrada-sec">
        <h3>Movimientos</h3>
        <div class="dlg-entrada-checks">
          ${movs
            .map(
              (p) => `<label class="dlg-entrada-check">
            <input type="checkbox" name="pert" value="${esc(p.slug)}" data-tipo="movimiento" data-nombre="${esc(p.nombre)}" ${prevSlugs.has(p.slug) ? "checked" : ""}>
            <span>${esc(p.nombreCorto || p.nombre)}</span>
          </label>`
            )
            .join("")}
        </div>
      </div>`
    : "";

  const wrap = abrirFondo(
    "dlg-entrada",
    `
    <h2 id="dlg-entrada-titulo">Cambiar parroquia</h2>
    <p class="dlg-entrada-lead">Elegí tu parroquia o movimiento. El correo es opcional: sin él entras igual.</p>
    <form id="form-entrada" class="dlg-entrada-form">
      <div class="dlg-entrada-sec dlg-entrada-identidad" hidden>
        <label>Correo <span class="dlg-entrada-opcional">(opcional)</span>
          <input type="email" name="email" autocomplete="email" placeholder="tu@correo.com"></label>
        <label>Nombre <span class="dlg-entrada-opcional">(opcional)</span>
          <input type="text" name="nombre" autocomplete="name" placeholder="Tu nombre"></label>
      </div>
      <div class="dlg-entrada-sec">
        <h3>Parroquias (por zona)</h3>
        <div class="dlg-entrada-zonas">${htmlZonas || "<p class=\"dlg-entrada-vacio\">No hay parroquias en el directorio aún.</p>"}</div>
      </div>
      ${htmlMovs}
      <p class="dlg-entrada-err" id="entrada-err" hidden></p>
      <div class="dlg-entrada-acciones">
        <button type="submit" class="btn btn-primario" id="btn-entrar-pert">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btn-solo-local">Seguir sin parroquia ni movimiento</button>
        <button type="button" class="btn btn-fantasma" id="btn-cerrar-entrada">Cerrar</button>
      </div>
      <p class="dlg-entrada-admin"><a href="/montecarmelo/login">Soy administrador</a></p>
    </form>
  `
  );

  const form = wrap.querySelector("#form-entrada");
  const cajaId = wrap.querySelector(".dlg-entrada-identidad");
  const errEl = wrap.querySelector("#entrada-err");

  function seleccionados() {
    return [...form.querySelectorAll('input[name="pert"]:checked')].map((el) => ({
      slug: el.value,
      tipo: el.dataset.tipo || "parroquia",
      nombre: el.dataset.nombre || el.value
    }));
  }

  function syncIdentidad() {
    cajaId.hidden = seleccionados().length === 0;
  }

  form.addEventListener("change", (e) => {
    if (e.target && e.target.name === "pert") syncIdentidad();
  });
  syncIdentidad();

  function mostrarErr(msg) {
    errEl.hidden = !msg;
    errEl.textContent = msg || "";
  }

  wrap.querySelector("#btn-cerrar-entrada").addEventListener("click", () => {
    limpiarQueryCambiar();
    cerrarDlg(wrap);
  });

  wrap.querySelector("#btn-solo-local").addEventListener("click", () => {
    marcarSoloLocal();
    limpiarQueryCambiar();
    cerrarDlg(wrap);
    irAActiva("montecarmelo");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    mostrarErr("");
    const lista = seleccionados();
    if (!lista.length) {
      mostrarErr("Marcá al menos una parroquia o movimiento, o usá «Seguir sin parroquia ni movimiento».");
      return;
    }
    const email = (form.email.value || "").trim().toLowerCase();
    const nombre = (form.nombre.value || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      mostrarErr("Si ponés correo, tiene que ser válido. También podés dejarlo vacío y entrar igual.");
      form.email.focus();
      return;
    }

    const btn = form.querySelector("#btn-entrar-pert");
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      if (email) {
        for (const p of lista) {
          await registrarVisitanteEn(p.slug, email, nombre);
        }
      }
      guardarPertenencias(lista);
      const activa = elegirActiva(lista);
      setActiva(activa);
      marcarEntradaHecha();
      limpiarQueryCambiar();
      cerrarDlg(wrap);
      irAActiva(activa);
    } catch (err) {
      mostrarErr(err.message || "No se pudo guardar.");
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });

  return true;
}

/**
 * Arranque del reproductor: onboarding la primera vez; ?cambiar=1 abre parroquias.
 */
export async function mostrarEntradaSiCorresponde() {
  if (/[?&]cambiar=1\b/.test(location.search)) {
    return editarPertenencias();
  }
  return mostrarOnboardingSiCorresponde();
}

export { entradaHecha, leerPertenencias, esSoloLocal, puedeGuardarEnSitio } from "./pertenencias.js";
