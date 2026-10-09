/**
 * Una sala por código de 6 cifras: la pantalla (TV o proyector, rol «tv») reproduce y muestra la letra; los
 * teléfonos (rol «control») la manejan. La sala solo reenvía mensajes:
 *   control → tv        órdenes  { tipo: "orden", ... }
 *   tv → controles      estado   { tipo: "estado" | "cola", ..., guardar }  (lo marcado «guardar» se le da a quien llega tarde)
 * Con WebSockets con hibernación: mientras nadie habla, la sala no gasta. No guarda datos personales.
 */
import { DurableObject } from "cloudflare:workers";

const VIDA_MS = 8 * 3600e3;
const MAX_MENSAJE = 512 * 1024;
const json = (o) => JSON.stringify(o);

export class Sala extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // El «ping» de los clientes para mantener viva la conexión se responde sin despertar la sala
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Se espera un WebSocket", { status: 426 });
    const p = new URL(request.url).searchParams;
    const rol = p.get("rol") === "tv" ? "tv" : "control";
    // La pantalla que se reconecta (se cortó el wifi) trae la misma llave y reemplaza a su conexión vieja
    const llave = "llave:" + String(p.get("llave") || "").slice(0, 64);
    const [cliente, servidor] = Object.values(new WebSocketPair());

    if (rol === "tv") {
      const otras = this.abiertos("tv");
      const propias = otras.filter((t) => this.ctx.getTags(t).includes(llave));
      this.ctx.acceptWebSocket(servidor, ["tv", llave]);
      if (otras.length > propias.length || llave === "llave:") {
        terminar(servidor, 4001, "ocupado");
      } else {
        for (const t of propias) terminar(t, 4003, "reemplazada");
        if (!propias.length) await this.ctx.storage.deleteAll();
      }
    } else {
      this.ctx.acceptWebSocket(servidor, ["control"]);
      if (!this.abiertos("tv").length) {
        terminar(servidor, 4004, "sin pantalla");
      } else {
        for (const clave of ["cola", "estado"]) {
          const m = await this.ctx.storage.get(clave);
          if (m) servidor.send(m);
        }
        this.contarControles();
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + VIDA_MS);
    return new Response(null, { status: 101, webSocket: cliente });
  }

  async webSocketMessage(ws, mensaje) {
    if (typeof mensaje !== "string" || mensaje.length > MAX_MENSAJE) return;
    let m;
    try {
      m = JSON.parse(mensaje);
    } catch (_) {
      return;
    }
    if (this.ctx.getTags(ws).includes("tv")) {
      if (m.guardar && (m.tipo === "estado" || m.tipo === "cola")) await this.ctx.storage.put(m.tipo, mensaje);
      for (const c of this.abiertos("control")) enviar(c, mensaje);
      return;
    }
    if (m.tipo === "cambiar-codigo") {
      for (const t of this.abiertos("tv")) enviar(t, json({ tipo: "cambiar-codigo" }));
      for (const c of this.abiertos("control")) terminar(c, 4002, "código nuevo");
      return;
    }
    const tvs = this.abiertos("tv");
    if (!tvs.length) return enviar(ws, json({ tipo: "sin-tv" }));
    for (const t of tvs) enviar(t, mensaje);
  }

  async webSocketClose(ws, codigo) {
    try { ws.close(codigo === 1005 ? 1000 : codigo, "chao"); } catch (_) { /* ya cerrado */ }
    if (this.ctx.getTags(ws).includes("tv")) {
      if (this.abiertos("tv").some((t) => t !== ws)) return;
      for (const c of this.abiertos("control")) enviar(c, json({ tipo: "sin-tv" }));
    } else {
      this.contarControles(ws);
    }
  }

  webSocketError(ws) {
    return this.webSocketClose(ws, 1011);
  }

  abiertos(rol) {
    return this.ctx.getWebSockets(rol).filter((w) => w.readyState === 1);
  }

  // Cuántos teléfonos manejan la pantalla: lo ven los teléfonos («se conectó otro control»), nunca el TV
  contarControles(saliente) {
    const controles = this.abiertos("control").filter((c) => c !== saliente);
    const m = json({ tipo: "controles", n: controles.length });
    for (const c of controles) enviar(c, m);
  }

  async alarm() {
    if (this.ctx.getWebSockets().some((w) => w.readyState === 1)) return this.ctx.storage.setAlarm(Date.now() + VIDA_MS);
    await this.ctx.storage.deleteAll();
  }
}

function enviar(ws, mensaje) {
  try { ws.send(mensaje); } catch (_) { /* se desconectó */ }
}

// El motivo va también como mensaje: el cierre con código no siempre llega completo al navegador
function terminar(ws, codigo, motivo) {
  enviar(ws, json({ tipo: "fin", codigo, motivo }));
  try { ws.close(codigo, motivo); } catch (_) { /* ya cerrado */ }
}

export default {
  fetch: () => new Response("montecarmelo-sala: se usa desde el sitio", { status: 404 })
};
