/**
 * portada.js — La portada nacional (/ sin parroquia elegida): buscar por nombre o comuna, ver el mapa y elegir.
 * La lista viene puesta por el servidor (window.MC_PARROQUIAS) y también va escrita en la página (para los buscadores).
 */

import { mostrarMapa, distanciaKm } from "./mapa.js";
import { abrirUnirseFeligres } from "./feligres.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const lista = Array.isArray(window.MC_PARROQUIAS) ? window.MC_PARROQUIAS : [];
let tipo = "";
let cerca = null;

const lugar = (p) => [p.comuna, p.region].filter(Boolean).join(", ");
const TIPO = { parroquia: "Parroquia", movimiento: "Movimiento" };

function tarjeta(p) {
  const foto = p.foto ? `<img class="po-foto" src="${esc(p.foto)}" alt="" loading="lazy">` : `<img class="po-icono" src="${esc(p.icono)}" alt="" loading="lazy" width="64" height="64">`;
  const dist = cerca && p.lat != null ? ` · a ${Math.round(distanciaKm(cerca, p))} km` : "";
  const estado = p.configurada
    ? ""
    : `<em class="po-catalogo">Aún sin cancionero propio · entra como feligrés</em>`;
  return `<li data-slug="${esc(p.slug)}" data-nombre="${esc(p.nombre)}" data-comuna="${esc(p.comuna || "")}" data-configurada="${p.configurada ? "1" : "0"}">
    <a class="po-tarjeta" href="/${esc(p.slug)}/">
    <span class="po-media">${foto}</span>
    <span class="po-textos"><strong>${esc(p.nombre)}</strong>
      <span>${esc(TIPO[p.tipo] || "Parroquia")}${lugar(p) ? " · " + esc(lugar(p)) : ""}${dist}</span>
      ${p.lema ? `<em>${esc(p.lema)}</em>` : ""}${estado}</span></a>
    <span class="po-acciones">
      <a class="po-mas" href="/${esc(p.slug)}/">Abrir cancionero</a>
      <button type="button" class="po-feligres btn-chico" data-feligres>Soy feligrés</button>
    </span></li>`;
}

function filtradas() {
  const q = norm($("#po-q").value).trim();
  let r = lista.filter((p) => (!tipo || p.tipo === tipo) &&
    (!q || norm([p.nombre, p.nombreCorto, p.comuna, p.region, p.diocesis, ...(p.lugares || []).map((x) => x.nombre + " " + x.comuna)].join(" ")).includes(q)));
  if (cerca) r = r.slice().sort((a, b) => (a.lat == null ? 1e9 : distanciaKm(cerca, a)) - (b.lat == null ? 1e9 : distanciaKm(cerca, b)));
  return r;
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
  const listaEl = $("#po-lista");
  listaEl.innerHTML = r.map(tarjeta).join("");
  $("#po-vacio").hidden = r.length > 0;
  const n = lista.length;
  const conCancionero = lista.filter((p) => p.configurada).length;
  const q = ($("#po-q").value || "").trim();
  if (!n) {
    $("#po-resumen").textContent = "Todavía no hay parroquias en el directorio. Puedes sumar la tuya o entrar como feligrés escribiendo su nombre.";
  } else if (r.length === n) {
    $("#po-resumen").textContent = n + " en el directorio · " + conCancionero + (conCancionero === 1 ? " ya usa" : " ya usan") +
      " el Cancionero. Toca una para abrirla o entra como feligrés.";
  } else {
    $("#po-resumen").textContent = r.length + " de " + n + ".";
  }
  // Si busca y no hay resultados, ofrecer crear / unirse por nombre
  const vacio = $("#po-vacio");
  if (!r.length && q) {
    vacio.hidden = false;
    vacio.innerHTML = `No encontramos «${esc(q)}». <button type="button" class="btn btn-primario" id="po-crear-feligres">Entrar como feligrés de esa parroquia</button> o <a href="/sumar">súmala como administrador</a>.`;
    const b = $("#po-crear-feligres");
    if (b) b.addEventListener("click", () => abrirUnirseFeligres({ nombre: q }));
  }
  clearTimeout(pendienteMapa);
  pendienteMapa = setTimeout(() => {
    const caja = $("#po-mapa");
    const puntos = puntosDe(r);
    caja.hidden = !puntos.length && !!$("#po-q").value;
    mostrarMapa(caja, puntos).then((m) => {
      if (cerca) m.setView([cerca.lat, cerca.lng], 11);
    }).catch(() => (caja.hidden = true));
  }, 250);
}

function conectar() {
  const toggle = $(".nav-toggle"), links = $(".nav-links");
  toggle.addEventListener("click", () => links.classList.toggle("abierto"));
  $("#po-q").addEventListener("input", pintar);
  $("#po-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#buscar").scrollIntoView({ behavior: "smooth" }); }
  });
  document.querySelectorAll(".po-chip").forEach((b) => b.addEventListener("click", () => {
    tipo = b.dataset.tipo;
    document.querySelectorAll(".po-chip").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    pintar();
  }));
  $("#po-cerca").addEventListener("click", () => {
    const b = $("#po-cerca");
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
      alert("No pudimos saber dónde estás. Busca por tu comuna.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });
  $("#po-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-feligres]");
    if (!b) return;
    e.preventDefault();
    const li = b.closest("li");
    if (!li) return;
    abrirUnirseFeligres({ slug: li.dataset.slug, nombre: li.dataset.nombre, comuna: li.dataset.comuna });
  });
  const nav = $(".nav-sitio");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  const q = new URLSearchParams(location.search).get("q");
  if (q) $("#po-q").value = q;
  const params = new URLSearchParams(location.search);
  if (params.has("unir")) abrirUnirseFeligres({ nombre: params.get("unir") || "" });
}

conectar();
pintar();
