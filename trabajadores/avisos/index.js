// Aviso del sábado: a las 18:00 de Chile manda un Web Push sin contenido a cada equipo suscrito (tabla
// suscripciones de la base del sitio). El service worker del sitio (sw.js) lo recibe, pide el texto a su parroquia
// (accion=avisoDomingo) y guarda las letras del cancionero del domingo.
// Sin contenido no hace falta cifrar nada (RFC 8291): solo la firma VAPID (RFC 8292), un JWT ES256.
// Va por tandas (LOTE por ejecución; los crons corren cada 5 minutos el sábado) para no pasar el límite de pedidos
// por ejecución. Las suscripciones que el servicio da por terminadas (404 o 410) se borran.

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function horaChile(fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(fecha).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: +p.hour, semana: p.weekday };
}

let llave = null;
async function llavePrivada(env) {
  if (!llave) {
    const jwk = JSON.parse(env.VAPID_PRIVADA);
    llave = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  return llave;
}

const firmas = new Map();
async function cabeceraVapid(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const guardada = firmas.get(aud);
  if (guardada && guardada.vence > Date.now() + 60000) return guardada.valor;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const cuerpo = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' +
    b64url(enc.encode(JSON.stringify({ aud, exp, sub: env.VAPID_SUJETO || 'mailto:cancionerolitugico@gmail.com' })));
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await llavePrivada(env), enc.encode(cuerpo));
  const valor = `vapid t=${cuerpo}.${b64url(firma)}, k=${env.VAPID_PUBLICA}`;
  firmas.set(aud, { valor, vence: exp * 1000 });
  return valor;
}

async function avisar(env, endpoint) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: await cabeceraVapid(env, endpoint), TTL: '43200', Urgency: 'normal', 'Content-Length': '0' }
    });
    return res.status === 404 || res.status === 410 ? 'borrar' : res.ok ? 'ok' : 'error';
  } catch (_) {
    return 'error';
  }
}

async function tanda(env, forzar = false) {
  const { dia, hora, semana } = horaChile();
  if (!forzar && (semana !== 'Sat' || hora !== 18)) return { omitida: true, dia, hora, semana };
  const lote = Math.max(1, Math.min(500, +env.LOTE || 40));
  const { results } = await env.DB.prepare('SELECT endpoint FROM suscripciones WHERE avisado != ? LIMIT ?').bind(dia, lote).all();
  const r = { enviados: 0, borrados: 0, errores: 0 };
  const hechos = [], muertos = [];
  for (let i = 0; i < results.length; i += 10) {
    const parte = results.slice(i, i + 10);
    const estados = await Promise.all(parte.map((s) => avisar(env, s.endpoint)));
    estados.forEach((e, k) => {
      if (e === 'borrar') { muertos.push(parte[k].endpoint); r.borrados++; }
      else { hechos.push(parte[k].endpoint); if (e === 'ok') r.enviados++; else r.errores++; }
    });
  }
  const sentencias = [
    ...hechos.map((e) => env.DB.prepare('UPDATE suscripciones SET avisado = ? WHERE endpoint = ?').bind(dia, e)),
    ...muertos.map((e) => env.DB.prepare('DELETE FROM suscripciones WHERE endpoint = ?').bind(e))
  ];
  if (sentencias.length) await env.DB.batch(sentencias);
  return { dia, ...r, quedan: results.length === lote };
}

export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(tanda(env).then((r) => console.log(JSON.stringify(r))));
  },
  // Para probar a mano: GET /?clave=<PRUEBA> manda la tanda aunque no sea sábado a las 18:00
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.PRUEBA || url.searchParams.get('clave') !== env.PRUEBA) return new Response('Aviso del sábado del Cancionero Litúrgico', { status: 200 });
    return Response.json(await tanda(env, true));
  }
};
