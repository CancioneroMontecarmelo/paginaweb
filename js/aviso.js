// El aviso del sábado (Web Push): a las 18:00 del sábado llega «Mañana: <cancionero>» y las letras quedan guardadas
// para la misa. El aviso llega sin contenido; el service worker (sw.js) lee qué parroquia y comunidad eligió este
// equipo en la caché «mc-datos» (/__aviso) y le pide el texto al servidor.

const DATOS = "mc-datos";
const AVISO = "/__aviso";

const cfg = () => window.MONTECARMELO_CONFIG || {};
export const esIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const instalada = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const avisosPosibles = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function claveBytes(b64) {
  const s = atob((b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function api(accion, datos) {
  const r = await (await fetch(cfg().apiUrl, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ accion, ...datos })
  })).json();
  if (!r.ok) throw new Error(r.error || "El servidor no respondió");
  return r;
}

async function suscripcion() {
  if (!avisosPosibles()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

// "activo" | "inactivo" | "bloqueado" | "instalar" (iPhone sin la app instalada) | "no"
export async function estadoAviso() {
  if (!avisosPosibles()) return esIphone() && !instalada() ? "instalar" : "no";
  if (Notification.permission === "denied") return "bloqueado";
  return (await suscripcion()) ? "activo" : "inactivo";
}

export async function activarAviso(comunidad = "") {
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") {
    throw new Error("El permiso para los avisos quedó bloqueado: actívalo en los ajustes del navegador.");
  }
  const { clave } = await (await fetch(cfg().apiUrl + "?accion=avisoClave")).json();
  if (!clave) throw new Error("Los avisos todavía no están configurados en el servidor.");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready);
  const s = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(clave) });
  await api("suscribirAviso", { suscripcion: s.toJSON(), comunidad });
  const c = await caches.open(DATOS);
  await c.put(AVISO, new Response(JSON.stringify({ parroquia: cfg().parroquia, comunidad }), { headers: { "Content-Type": "application/json" } }));
}

export async function desactivarAviso() {
  const s = await suscripcion();
  if (s) {
    await api("desuscribirAviso", { endpoint: s.endpoint }).catch(() => {});
    await s.unsubscribe().catch(() => {});
  }
  await caches.open(DATOS).then((c) => c.delete(AVISO)).catch(() => {});
}

// Si cambió la comunidad elegida, el aviso trae el cancionero de la nueva
export async function actualizarComunidadAviso(comunidad = "") {
  const s = await suscripcion().catch(() => null);
  if (!s) return;
  await api("suscribirAviso", { suscripcion: s.toJSON(), comunidad }).catch(() => {});
  await caches.open(DATOS).then((c) => c.put(AVISO, new Response(JSON.stringify({ parroquia: cfg().parroquia, comunidad }),
    { headers: { "Content-Type": "application/json" } }))).catch(() => {});
}

// ==================== AUDIOS SIN CONEXIÓN ====================

const AUDIOS = "mc-audios";

export async function audiosGuardados(urls) {
  try {
    const c = await caches.open(AUDIOS);
    const r = await Promise.all(urls.map((u) => c.match(u)));
    return r.filter(Boolean).length;
  } catch (_) {
    return 0;
  }
}

// Baja los audios (los que faltan) uno por uno; alAvanzar(hechos, total)
export async function bajarAudios(urls, alAvanzar = () => {}) {
  const c = await caches.open(AUDIOS);
  let hechos = 0, fallas = 0;
  for (const u of urls) {
    if (!(await c.match(u))) {
      try {
        const res = await fetch(u, { cache: "no-store" });
        if (res.ok && res.status === 200) await c.put(u, res);
        else fallas++;
      } catch (_) {
        fallas++;
      }
    }
    alAvanzar(++hechos, urls.length);
  }
  return { hechos: hechos - fallas, fallas };
}

export async function borrarAudios() {
  await caches.delete(AUDIOS).catch(() => {});
}
