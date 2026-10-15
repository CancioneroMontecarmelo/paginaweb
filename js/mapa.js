/**
 * mapa.js — Mapas de parroquias, capillas y movimientos (Leaflet + OpenStreetMap)
 *
 *  - mostrarMapa(contenedor, lugares): los puntos con su nombre y enlace; se ajusta para mostrarlos todos.
 *  - elegirUbicacion(contenedor, valor, alCambiar): buscar una dirección (Nominatim, a lo más un pedido por segundo y
 *    solo al tocar «Buscar») y afinar el punto arrastrando el marcador o tocando el mapa.
 * Leaflet va en /js/vendor/leaflet (BSD-2); los mapas llevan la atribución de OpenStreetMap.
 */

const BASE = "/js/vendor/leaflet/";
const CHILE = { centro: [-35.7, -71.5], zoom: 4 };
const NOMINATIM = "https://nominatim.openstreetmap.org/";

let cargado = null;
export function cargarLeaflet() {
  cargado ||= new Promise((ok, mal) => {
    if (window.L && window.L.map) return ok(window.L);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = BASE + "leaflet.css";
    document.head.appendChild(css);
    const sc = document.createElement("script");
    sc.src = BASE + "leaflet.js";
    sc.onload = () => ok(window.L);
    sc.onerror = () => { cargado = null; mal(new Error("No se pudo cargar el mapa. Revisá tu conexión.")); };
    document.head.appendChild(sc);
  });
  return cargado;
}

const escapar = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function capaBase(L, mapa) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(mapa);
}

// Un punto redondo del color de cada tipo (parroquia, movimiento, capilla, comunidad o grupo)
const COLORES = { parroquia: "#8a1c2b", movimiento: "#1f5f8b", capilla: "#b8860b", comunidad: "#4b7f52", grupo: "#6b4c9a" };
function icono(L, tipo, grande) {
  const t = grande ? 30 : 22;
  return L.divIcon({
    className: "mapa-punto mapa-punto-" + (COLORES[tipo] ? tipo : "parroquia"),
    html: `<span style="--c:${COLORES[tipo] || COLORES.parroquia}"></span>`,
    iconSize: [t, t], iconAnchor: [t / 2, t / 2], popupAnchor: [0, -t / 2]
  });
}

/**
 * lugares: [{ lat, lng, titulo, subtitulo, href, foto, tipo }]. opciones: { zoomUno, alTocar(lugar) }.
 * Devuelve el mapa de Leaflet (o null si no hay puntos y opciones.vacio === false).
 */
export async function mostrarMapa(contenedor, lugares, opciones = {}) {
  const L = await cargarLeaflet();
  const puntos = (lugares || []).filter((x) => typeof x.lat === "number" && typeof x.lng === "number");
  if (contenedor._mapa) contenedor._mapa.remove();
  const mapa = L.map(contenedor, { scrollWheelZoom: false, tap: true });
  contenedor._mapa = mapa;
  capaBase(L, mapa);
  const marcas = puntos.map((x) => {
    const m = L.marker([x.lat, x.lng], { icon: icono(L, x.tipo, x.grande), title: x.titulo, alt: x.titulo }).addTo(mapa);
    const foto = x.foto ? `<img src="${escapar(x.foto)}" alt="" loading="lazy">` : "";
    const enlace = x.href ? `<a class="mapa-ir" href="${escapar(x.href)}">${escapar(x.textoEnlace || "Abrir")}</a>` : "";
    m.bindPopup(`<div class="mapa-globo">${foto}<strong>${escapar(x.titulo)}</strong>` +
      (x.subtitulo ? `<span>${escapar(x.subtitulo)}</span>` : "") + enlace + "</div>", { maxWidth: 240 });
    if (opciones.alTocar) m.on("click", () => opciones.alTocar(x));
    return m;
  });
  if (marcas.length > 1) mapa.fitBounds(L.featureGroup(marcas).getBounds().pad(0.15), { maxZoom: 15 });
  else if (marcas.length === 1) mapa.setView(marcas[0].getLatLng(), opciones.zoomUno || 15);
  else mapa.setView(CHILE.centro, CHILE.zoom);
  // Con la rueda solo después de tocar el mapa (para no quedar atrapado al bajar por la página)
  mapa.once("focus", () => mapa.scrollWheelZoom.enable());
  mapa.on("click", () => mapa.scrollWheelZoom.enable());
  return mapa;
}

// ==================== ELEGIR LA UBICACIÓN ====================

let ultimoPedido = 0;
async function nominatim(ruta, params) {
  const espera = ultimoPedido + 1100 - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimoPedido = Date.now();
  const res = await fetch(NOMINATIM + ruta + "?" + new URLSearchParams({ format: "jsonv2", addressdetails: "1", "accept-language": "es", ...params }));
  if (!res.ok) throw new Error("El buscador de direcciones no respondió. Probá de nuevo en un momento.");
  return res.json();
}

function desdeNominatim(r) {
  const a = r.address || {};
  const calle = [a.road || a.pedestrian || a.footway || "", a.house_number || ""].filter(Boolean).join(" ");
  return {
    lat: Math.round(Number(r.lat) * 1e6) / 1e6,
    lng: Math.round(Number(r.lon) * 1e6) / 1e6,
    direccion: calle || (r.name || ""),
    comuna: a.city || a.town || a.village || a.municipality || a.suburb || a.county || "",
    region: a.state || a.region || "",
    nombreLargo: r.display_name || ""
  };
}

/**
 * Buscador de dirección + mapa con marcador arrastrable. valor: { direccion, comuna, region, lat, lng }.
 * alCambiar(valor) cada vez que cambia algo. Devuelve { valor(), fijar(valor) }.
 */
export async function elegirUbicacion(contenedor, valor = {}, alCambiar = () => {}) {
  let actual = { direccion: "", comuna: "", region: "", lat: null, lng: null, ...valor };
  contenedor.classList.add("ubicacion");
  contenedor.innerHTML = `
    <div class="ubicacion-buscar">
      <input type="search" class="campo" placeholder="Calle y número, comuna (ej.: Av. Matta 520, Santiago)" aria-label="Buscar la dirección" autocomplete="street-address">
      <button type="button" class="btn btn-secundario">Buscar</button>
    </div>
    <ul class="ubicacion-resultados" hidden></ul>
    <p class="ubicacion-estado" aria-live="polite"></p>
    <div class="ubicacion-mapa" role="application" aria-label="Mapa: tocá para marcar el lugar o arrastrá el marcador"></div>
    <p class="ayuda">Si el punto no queda justo, arrastrá el marcador o tocá el lugar exacto en el mapa.</p>`;
  const entrada = contenedor.querySelector("input");
  const boton = contenedor.querySelector("button");
  const lista = contenedor.querySelector(".ubicacion-resultados");
  const estado = contenedor.querySelector(".ubicacion-estado");
  entrada.value = [actual.direccion, actual.comuna].filter(Boolean).join(", ");

  const L = await cargarLeaflet();
  const mapa = L.map(contenedor.querySelector(".ubicacion-mapa"), { scrollWheelZoom: false });
  capaBase(L, mapa);
  let marca = null;
  const poner = (lat, lng, centrar) => {
    if (!marca) {
      marca = L.marker([lat, lng], { draggable: true, autoPan: true, title: "Arrastrá para ajustar" }).addTo(mapa);
      marca.on("dragend", () => {
        const p = marca.getLatLng();
        moverA(p.lat, p.lng);
      });
    } else marca.setLatLng([lat, lng]);
    if (centrar) mapa.setView([lat, lng], Math.max(mapa.getZoom() || 0, 16));
  };
  const avisar = () => alCambiar({ ...actual });
  // Al mover el punto a mano se completa la comuna y la región, sin pisar la dirección escrita
  const moverA = async (lat, lng) => {
    actual.lat = Math.round(lat * 1e6) / 1e6;
    actual.lng = Math.round(lng * 1e6) / 1e6;
    poner(actual.lat, actual.lng, false);
    avisar();
    try {
      const r = desdeNominatim(await nominatim("reverse", { lat: actual.lat, lon: actual.lng, zoom: "18" }));
      if (!actual.direccion) actual.direccion = r.direccion;
      actual.comuna = r.comuna || actual.comuna;
      actual.region = r.region || actual.region;
      avisar();
    } catch (_) { /* sin comuna: queda el punto */ }
  };
  if (typeof actual.lat === "number" && typeof actual.lng === "number") {
    poner(actual.lat, actual.lng, false);
    mapa.setView([actual.lat, actual.lng], 16);
  } else mapa.setView(CHILE.centro, CHILE.zoom);
  mapa.on("click", (e) => moverA(e.latlng.lat, e.latlng.lng));
  mapa.on("focus", () => mapa.scrollWheelZoom.enable());

  const elegir = (r) => {
    actual = { ...actual, lat: r.lat, lng: r.lng, direccion: r.direccion || actual.direccion, comuna: r.comuna, region: r.region };
    lista.hidden = true;
    estado.textContent = "Listo: " + [actual.direccion, actual.comuna].filter(Boolean).join(", ");
    poner(r.lat, r.lng, true);
    avisar();
  };
  const buscar = async () => {
    const q = entrada.value.trim();
    if (q.length < 4) { estado.textContent = "Escribí la calle, el número y la comuna."; return; }
    boton.disabled = true;
    estado.textContent = "Buscando…";
    try {
      const res = (await nominatim("search", { q, countrycodes: "cl", limit: "6" })).map(desdeNominatim);
      if (!res.length) {
        estado.textContent = "No encontramos esa dirección. Probá solo con la calle y la comuna, o tocá el lugar en el mapa.";
        lista.hidden = true;
      } else if (res.length === 1) elegir(res[0]);
      else {
        estado.textContent = "Elegí la que corresponde:";
        lista.innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}">${escapar(r.nombreLargo)}</button></li>`).join("");
        lista.hidden = false;
        lista.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => elegir(res[+b.dataset.i])));
      }
    } catch (e) {
      estado.textContent = e.message || String(e);
    } finally {
      boton.disabled = false;
    }
  };
  boton.addEventListener("click", buscar);
  entrada.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } });
  // El contenedor puede haber estado oculto (un paso del asistente, un diálogo): el mapa se vuelve a medir
  setTimeout(() => mapa.invalidateSize(), 50);
  return {
    valor: () => ({ ...actual }),
    fijar: (v) => { actual = { ...actual, ...v }; if (typeof actual.lat === "number") poner(actual.lat, actual.lng, true); },
    medir: () => mapa.invalidateSize()
  };
}

/** Distancia en km entre dos puntos (para «Parroquias cerca de ti»). */
export function distanciaKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
