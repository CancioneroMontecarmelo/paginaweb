// Todo lo que llega a /api y /api/… lo atiende servidor/api.js, salvo /api/sala/<código>: el WebSocket entre una
// pantalla (TV o proyector) y los teléfonos que la manejan, que va a la sala (trabajadores/sala)
import { atender } from '../../servidor/api.js';

export const onRequest = (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const sala = url.pathname.match(/^\/api\/sala\/(\d{6})$/);
  if (!sala) return atender(ctx);
  if (!env.SALA) return new Response("La conexión con pantallas todavía no está activada.", { status: 503 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Se espera un WebSocket", { status: 426 });
  // Solo desde las páginas del propio sitio
  const origen = request.headers.get("Origin");
  if (origen && origen !== url.origin) return new Response("Origen no permitido", { status: 403 });
  return env.SALA.get(env.SALA.idFromName(sala[1])).fetch(request);
};
