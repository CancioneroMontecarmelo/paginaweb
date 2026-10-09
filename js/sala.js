/**
 * sala.js — Conexión en tiempo real entre una pantalla (TV o proyector) y los teléfonos que la manejan,
 * por WebSocket a /api/sala/<código> (functions/api/[[ruta]].js → trabajadores/sala). Se reconecta sola.
 *
 *   conectarSala(codigo, rol, { llave, alMensaje(m), alEstado(estado, cierre) })
 *     rol: "tv" | "control"; llave: la de la pantalla, para recuperar su código al reconectarse
 *     estado: "conectando" | "conectada" | "reintentando" | "cerrada"; cierre: { code, reason } al cerrar
 *     → { enviar(objeto), cerrar() }
 *
 * Códigos de cierre de la sala que no se reintentan: 4001 código ocupado por otra pantalla, 4002 la pantalla
 * cambió de código, 4003 la misma pantalla se conectó de nuevo, 4004 no hay ninguna pantalla con ese código.
 */

const FINALES = new Set([4001, 4002, 4003, 4004]);

export const codigoValido = (c) => /^\d{6}$/.test(String(c || ""));

export function urlSala(codigo, params) {
  const u = new URL((window.MONTECARMELO_CONFIG || {}).apiUrl + "/sala/" + codigo, location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.href;
}

export function conectarSala(codigo, rol, { llave = "", alMensaje, alEstado } = {}) {
  let ws = null, cerrada = false, espera = 1000, reintento = 0, latido = 0;

  const estado = (e, cierre) => alEstado?.(e, cierre);

  function abrir() {
    if (cerrada) return;
    estado(reintento ? "reintentando" : "conectando");
    try {
      ws = new WebSocket(urlSala(codigo, { rol, llave }));
    } catch (_) {
      return programar();
    }
    ws.onopen = () => {
      espera = 1000;
      estado("conectada");
      clearInterval(latido);
      latido = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      let m;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      alMensaje?.(m);
    };
    ws.onclose = (e) => {
      clearInterval(latido);
      ws = null;
      if (cerrada) return;
      if (FINALES.has(e.code)) {
        cerrada = true;
        return estado("cerrada", { code: e.code, reason: e.reason });
      }
      programar();
    };
  }

  function programar() {
    if (cerrada) return;
    reintento++;
    estado("reintentando");
    clearTimeout(abrir.t);
    abrir.t = setTimeout(abrir, espera);
    espera = Math.min(espera * 2, 15000);
  }

  // Al volver a la página (el teléfono se bloqueó) se reconecta enseguida
  const alVolver = () => {
    if (!document.hidden && !cerrada && !ws) {
      clearTimeout(abrir.t);
      espera = 1000;
      abrir();
    }
  };
  document.addEventListener("visibilitychange", alVolver);
  window.addEventListener("online", alVolver);

  // Después de devolver el objeto, para que quien llama ya lo tenga cuando llegue el primer aviso
  queueMicrotask(abrir);
  return {
    enviar(o) {
      if (ws?.readyState !== 1) return false;
      ws.send(JSON.stringify(o));
      return true;
    },
    get abierta() { return ws?.readyState === 1; },
    cerrar() {
      cerrada = true;
      clearTimeout(abrir.t);
      clearInterval(latido);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", alVolver);
      try { ws?.close(1000, "chao"); } catch (_) { /* ya cerrada */ }
      ws = null;
    }
  };
}
