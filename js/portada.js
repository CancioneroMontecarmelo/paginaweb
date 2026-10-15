/**
 * portada.js — La portada nacional (/ sin parroquia elegida): buscar por nombre o comuna, ver el mapa y elegir.
 * La lista viene puesta por el servidor (window.MC_PARROQUIAS) y también va escrita en la página (para los buscadores).
 */

import { mostrarMapa, distanciaKm } from "./mapa.js";

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
  return `<li><a class="po-tarjeta" href="/${esc(p.slug)}/">
    <span class="po-media">${foto}</span>
    <span class="po-textos"><strong>${esc(p.nombre)}</strong>
      <span>${esc(TIPO[p.tipo] || "Parroquia")}${lugar(p) ? " · " + esc(lugar(p)) : ""}${dist}</span>
      ${p.lema ? `<em>${esc(p.lema)}</em>` : ""}</span></a>
    <a class="po-mas" href="/${esc(p.slug)}/inicio">Página de la ${p.tipo === "movimiento" ? "comunidad" : "parroquia"}</a></li>`;
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
        href: "/" + p.slug + "/", textoEnlace: "Abrir su cancionero" });
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
  $("#po-lista").innerHTML = r.map(tarjeta).join("");
  $("#po-vacio").hidden = r.length > 0;
  const n = lista.length;
  $("#po-resumen").textContent = n
    ? (r.length === n ? n + (n === 1 ? " parroquia o movimiento ya usa" : " parroquias y movimientos ya usan") + " el Cancionero. Toca una para abrir su cancionero."
      : r.length + " de " + n + ".")
    : "Toca una para abrir su cancionero.";
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
  const nav = $(".nav-sitio");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  const q = new URLSearchParams(location.search).get("q");
  if (q) $("#po-q").value = q;
}

conectar();
pintar();
