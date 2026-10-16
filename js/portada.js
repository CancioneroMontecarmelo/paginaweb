/**
 * portada.js — Portada nacional y /elegir: buscar, filtrar por zona, mapa y feligrés.
 */

import { mostrarMapa, distanciaKm } from "./mapa.js";
import { abrirUnirseFeligres } from "./feligres.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const ORDEN_DECANATO = ["Centro", "Norte", "Cordillera", "Oriente", "Maipo", "Sur", "Oeste"];
const esElegir = !!window.MC_ELEGIR;

const lista = Array.isArray(window.MC_PARROQUIAS) ? window.MC_PARROQUIAS : [];
let tipo = "";
let comuna = "";
let decanato = esElegir ? "" : "";
let cerca = null;

const lugar = (p) => [p.decanato ? "Zona " + p.decanato : "", p.comuna].filter(Boolean).join(" · ");
const TIPO = { parroquia: "Parroquia", movimiento: "Movimiento" };
const esPrincipal = (p) => p.slug === "montecarmelo";

const comunas = [...new Set(lista.map((p) => p.comuna).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
const decanatos = (() => {
  const set = new Set(lista.map((p) => p.decanato).filter(Boolean));
  const ordenados = ORDEN_DECANATO.filter((d) => set.has(d));
  const resto = [...set].filter((d) => !ORDEN_DECANATO.includes(d)).sort((a, b) => a.localeCompare(b, "es"));
  return [...ordenados, ...resto];
})();

function tarjeta(p, { destacar = false } = {}) {
  const foto = p.foto ? `<img class="po-foto" src="${esc(p.foto)}" alt="" loading="lazy">` : `<img class="po-icono" src="${esc(p.icono)}" alt="" loading="lazy" width="64" height="64">`;
  const dist = cerca && p.lat != null ? ` · a ${Math.round(distanciaKm(cerca, p))} km` : "";
  const estado = p.configurada
    ? ""
    : `<em class="po-catalogo">Aún sin cancionero propio · entra como feligrés</em>`;
  const clase = destacar ? " po-tarjeta-principal" : "";
  return `<li data-slug="${esc(p.slug)}" data-nombre="${esc(p.nombre)}" data-comuna="${esc(p.comuna || "")}" data-configurada="${p.configurada ? "1" : "0"}">
    <a class="po-tarjeta${clase}" href="/${esc(p.slug)}/">
    <span class="po-media">${foto}</span>
    <span class="po-textos"><strong>${esc(p.nombreCorto || p.nombre)}</strong>
      <span>${esc(TIPO[p.tipo] || "Parroquia")}${lugar(p) ? " · " + esc(lugar(p)) : ""}${dist}</span>
      ${destacar ? "<em>Parroquia principal del Cancionero</em>" : ""}
      ${p.lema && !destacar ? `<em>${esc(p.lema)}</em>` : ""}${estado}</span></a>
    <span class="po-acciones">
      <a class="po-mas" href="/${esc(p.slug)}/">Abrir cancionero</a>
      ${destacar ? "" : `<button type="button" class="po-feligres btn-chico" data-feligres>Soy feligrés</button>`}
    </span></li>`;
}

function filtradas() {
  const q = norm($("#po-q").value).trim();
  let r = lista.filter((p) => (!tipo || p.tipo === tipo) &&
    (!decanato || p.decanato === decanato || esPrincipal(p)) &&
    (!comuna || p.comuna === comuna || esPrincipal(p)) &&
    (!q || norm([p.nombre, p.nombreCorto, p.comuna, p.region, p.diocesis, p.decanato, p.slug, ...(p.lugares || []).map((x) => x.nombre + " " + x.comuna)].join(" ")).includes(q)));
  if (cerca) r = r.slice().sort((a, b) => (a.lat == null ? 1e9 : distanciaKm(cerca, a)) - (b.lat == null ? 1e9 : distanciaKm(cerca, b)));
  return r;
}

function ordenClaveDecanato(a, b) {
  if (a === "__principal__") return -1;
  if (b === "__principal__") return 1;
  const ia = ORDEN_DECANATO.indexOf(a);
  const ib = ORDEN_DECANATO.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.localeCompare(b, "es");
}

function htmlAgrupado(r) {
  const q = ($("#po-q").value || "").trim();
  const principal = r.find(esPrincipal);
  const resto = r.filter((p) => !esPrincipal(p));

  // En /elegir sin búsqueda: pedí zona primero (menos caos)
  if (esElegir && !q && !cerca && !decanato && !comuna) {
    let html = principal ? `<li class="po-grupo" aria-hidden="true"><h3 class="po-comuna-titulo">Tu parroquia principal</h3></li>` + tarjeta(principal, { destacar: true }) : "";
    html += `<li class="po-grupo" aria-hidden="true"><h3 class="po-comuna-titulo">Elegí una zona de Santiago</h3></li>`;
    html += `<li class="po-zonas">${decanatos.map((d) => {
      const n = lista.filter((p) => p.decanato === d && !esPrincipal(p)).length;
      return `<button type="button" class="po-zona-btn" data-zona="${esc(d)}"><strong>Zona ${esc(d)}</strong><span>${n} parroquias</span></button>`;
    }).join("")}</li>`;
    return html;
  }

  if (q || cerca) {
    let html = "";
    if (principal && r.includes(principal)) html += tarjeta(principal, { destacar: true });
    html += resto.map((p) => tarjeta(p)).join("");
    return html;
  }

  const grupos = new Map();
  if (principal && r.includes(principal)) grupos.set("__principal__", [principal]);
  for (const p of resto) {
    const k = p.decanato || p.comuna || "Sin zona";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const keys = [...grupos.keys()].sort(ordenClaveDecanato);
  return keys.map((k) => {
    if (k === "__principal__") {
      return `<li class="po-grupo" aria-hidden="true"><h3 class="po-comuna-titulo">Tu parroquia principal</h3></li>` +
        tarjeta(grupos.get(k)[0], { destacar: true });
    }
    const esZona = ORDEN_DECANATO.includes(k) || lista.some((p) => p.decanato === k);
    const titulo = esZona ? "Zona " + k : k;
    const items = grupos.get(k).slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return `<li class="po-grupo" aria-hidden="true"><h3 class="po-comuna-titulo">${esc(titulo)}</h3></li>` +
      items.map((p) => tarjeta(p)).join("");
  }).join("");
}

function puntosDe(r) {
  const puntos = [];
  for (const p of r) {
    if (p.lat != null) {
      puntos.push({ lat: p.lat, lng: p.lng, titulo: p.nombre, subtitulo: lugar(p), tipo: p.tipo, grande: true, foto: p.foto,
        href: "/" + p.slug + "/", textoEnlace: p.configurada ? "Abrir su cancionero" : "Entrar (feligrés)" });
    }
    for (const x of p.lugares || []) {
      puntos.push({ lat: x.lat, lng: x.lng, titulo: x.nombre, subtitulo: p.nombreCorto + (x.comuna ? " · " + x.comuna : ""), tipo: x.clase, foto: x.foto,
        href: "/" + p.slug + "/comunidad?c=" + encodeURIComponent(x.slug), textoEnlace: "Ver" });
    }
  }
  return puntos;
}

let pendienteMapa = 0;
function pintar() {
  const r = filtradas();
  $("#po-lista").innerHTML = htmlAgrupado(r);
  $("#po-vacio").hidden = r.length > 0;
  const n = lista.length;
  const conCancionero = lista.filter((p) => p.configurada).length;
  const q = ($("#po-q").value || "").trim();
  if (!n) {
    $("#po-resumen").textContent = "Todavía no hay parroquias en el directorio. Puedes sumar la tuya o entrar como feligrés escribiendo su nombre.";
  } else if (esElegir && !decanato && !comuna && !q && !cerca) {
    $("#po-resumen").textContent = "Empezá por Monte Carmelo o elegí la zona de Santiago donde está tu parroquia.";
  } else if (r.length === n && !comuna && !decanato && !q) {
    $("#po-resumen").textContent = n + " en el directorio · " + conCancionero + (conCancionero === 1 ? " ya usa" : " ya usan") +
      " el Cancionero. Agrupadas por zona.";
  } else {
    const donde = [decanato && ("zona " + decanato), comuna].filter(Boolean).join(", ");
    $("#po-resumen").textContent = r.length + " de " + n + (donde ? " en " + donde : "") + ".";
  }
  const vacio = $("#po-vacio");
  if (!r.length && q) {
    vacio.hidden = false;
    vacio.innerHTML = `No encontramos «${esc(q)}». <button type="button" class="btn btn-primario" id="po-crear-feligres">Entrar como feligrés de esa parroquia</button> o <a href="/sumar">súmala como administrador</a>.`;
    const b = $("#po-crear-feligres");
    if (b) b.addEventListener("click", () => abrirUnirseFeligres({ nombre: q }));
  } else if (!r.length && (comuna || decanato)) {
    vacio.hidden = false;
    const zona = decanato ? "zona " + decanato : comuna;
    vacio.innerHTML = `No hay resultados en ${esc(zona)}. <button type="button" class="btn btn-secundario" id="po-filtros-todos">Ver todas las zonas</button>`;
    const b = $("#po-filtros-todos");
    if (b) b.addEventListener("click", () => {
      comuna = "";
      decanato = "";
      if ($("#po-comuna")) $("#po-comuna").value = "";
      if ($("#po-decanato")) $("#po-decanato").value = "";
      pintar();
    });
  }
  clearTimeout(pendienteMapa);
  pendienteMapa = setTimeout(() => {
    const caja = $("#po-mapa");
    if (!caja) return;
    if (esElegir && !cerca && !q) {
      caja.hidden = true;
      return;
    }
    const puntos = puntosDe(r.filter((p) => !esPrincipal(p) || p.lat != null));
    caja.hidden = !puntos.length && !!(q || comuna || decanato);
    mostrarMapa(caja, puntos).then((m) => {
      if (cerca) m.setView([cerca.lat, cerca.lng], 11);
    }).catch(() => (caja.hidden = true));
  }, 250);
}

function armarSelects() {
  const selD = $("#po-decanato");
  if (selD) {
    selD.innerHTML = '<option value="">' + (esElegir ? "Elegí una zona…" : "Todas las zonas") + "</option>" +
      decanatos.map((d) => `<option value="${esc(d)}">Zona ${esc(d)}</option>`).join("");
    selD.addEventListener("change", () => { decanato = selD.value; pintar(); });
  }
  const sel = $("#po-comuna");
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas las comunas</option>' +
    comunas.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.addEventListener("change", () => { comuna = sel.value; pintar(); });
}

function conectar() {
  const toggle = $(".nav-toggle"), links = $(".nav-links");
  if (toggle && links) toggle.addEventListener("click", () => links.classList.toggle("abierto"));
  $("#po-q").addEventListener("input", pintar);
  $("#po-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#buscar").scrollIntoView({ behavior: "smooth" }); }
  });
  document.querySelectorAll(".po-chip").forEach((b) => b.addEventListener("click", () => {
    tipo = b.dataset.tipo;
    document.querySelectorAll(".po-chip").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    pintar();
  }));
  const cercaBtn = $("#po-cerca");
  if (cercaBtn) cercaBtn.addEventListener("click", () => {
    const b = cercaBtn;
    if (!navigator.geolocation) return alert("Este navegador no puede dar tu ubicación.");
    b.disabled = true;
    b.textContent = "Buscando…";
    navigator.geolocation.getCurrentPosition((pos) => {
      cerca = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      b.disabled = false;
      b.textContent = "Cerca de mí ✓";
      pintar();
      $("#buscar").scrollIntoView({ behavior: "smooth" });
    }, () => {
      b.disabled = false;
      b.textContent = "Cerca de mí";
      alert("No pudimos saber dónde estás. Busca por tu comuna o zona.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });
  $("#po-lista").addEventListener("click", (e) => {
    const zona = e.target.closest("[data-zona]");
    if (zona) {
      e.preventDefault();
      decanato = zona.dataset.zona;
      if ($("#po-decanato")) $("#po-decanato").value = decanato;
      pintar();
      $("#buscar").scrollIntoView({ behavior: "smooth" });
      return;
    }
    const b = e.target.closest("[data-feligres]");
    if (!b) return;
    e.preventDefault();
    const li = b.closest("li[data-slug]");
    if (!li) return;
    abrirUnirseFeligres({ slug: li.dataset.slug, nombre: li.dataset.nombre, comuna: li.dataset.comuna });
  });
  armarSelects();
  const nav = $(".nav-sitio");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  if (q) $("#po-q").value = q;
  if (params.get("decanato") && decanatos.includes(params.get("decanato"))) {
    decanato = params.get("decanato");
    if ($("#po-decanato")) $("#po-decanato").value = decanato;
  }
  if (params.get("comuna") && comunas.includes(params.get("comuna"))) {
    comuna = params.get("comuna");
    if ($("#po-comuna")) $("#po-comuna").value = comuna;
  }
  if (params.has("unir")) abrirUnirseFeligres({ nombre: params.get("unir") || "" });
  if (esElegir) {
    document.body.classList.add("pagina-elegir");
    const h = $("#buscar-titulo");
    if (h) h.textContent = "Elegí tu parroquia";
    const mapa = $("#po-mapa");
    if (mapa) mapa.hidden = true;
  }
}

conectar();
pintar();
