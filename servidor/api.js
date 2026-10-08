// API del sitio (Cloudflare Pages Functions). Mismas acciones y respuestas que el Apps Script de antes:
//   GET  /api?accion=…              lecturas públicas
//   POST /api  {accion, token, …}   (JSON en text/plain) acciones con sesión; responde siempre 200 con {ok, error}
//   PUT  /api/subir?tipo=…          archivos (el cuerpo es el archivo; token en «Authorization: Bearer …»)
//   GET  /api/audio/<id>            audio de la Biblioteca (streaming, con Range)
//   GET  /api/archivo/<id>          partitura o archivo de un cancionero (?descargar=1 para bajarlo)
import { ErrorApi, respuestaJson, encabezadosCors } from './util.js';
import { accionesAuth, crearToken } from './auth.js';
import { filaArchivo, servirArchivo } from './archivos.js';
import {
  accionesBiblioteca, lecturasBiblioteca, bibliotecaGet, subirAudio, subirPartitura, reemplazarAudio
} from './biblioteca.js';
import { accionesCancioneros, lecturasCancioneros, subirArchivoCancionero, verHtml } from './cancioneros.js';
import { accionesMisas, lecturasMisas, lecturasDeMisa, verVivo } from './misas.js';
import { accionesComunidad, lecturasComunidad } from './comunidad.js';
import { lecturas, calendario } from './lecturas.js';

const ACCIONES = {
  ...accionesAuth,
  ...accionesCancioneros,
  ...accionesBiblioteca,
  ...accionesMisas,
  ...accionesComunidad,
  subirArchivo: () => { throw new ErrorApi('Actualizá la página: los archivos ahora se suben de otra forma.'); }
};

const LECTURAS = {
  ...lecturasCancioneros,
  ...lecturasBiblioteca,
  ...lecturasMisas,
  ...lecturasComunidad,
  lecturas: (c, p) => (p.misa ? lecturasDeMisa(c, p.misa) : lecturas(c, p.fecha)),
  calendario,
  vivo: (c, p) => verVivo(c, p.codigo)
};

const SUBIDAS = {
  audio: subirAudio,
  partitura: subirPartitura,
  cancionero: subirArchivoCancionero,
  reemplazo: reemplazarAudio
};

function contexto(ctx) {
  const { env, request } = ctx;
  if (!env.DB || !env.ARCHIVOS) throw new Error('Faltan la base de datos (DB) o el almacenamiento (ARCHIVOS) en la configuración de Cloudflare.');
  const sitio = env.SITIO_URL || new URL(request.url).origin + '/';
  return { env, db: env.DB, r2: env.ARCHIVOS, sitio: sitio.endsWith('/') ? sitio : sitio + '/', yo: null };
}

const error = (err) => {
  if (!(err instanceof ErrorApi)) console.error(err);
  return respuestaJson({ ok: false, error: String((err && err.message) || err) });
};

// Si la acción usó la sesión, la respuesta lleva el token renovado (la sesión solo vence tras 90 días sin uso)
async function conToken(c, r) {
  r = r || {};
  r.ok = true;
  if (c.yo && !r.token) r.token = await crearToken(c, c.yo);
  return respuestaJson(r);
}

async function porGet(c, request, url) {
  const p = Object.fromEntries(url.searchParams);
  if (p.accion === 'biblioteca') return bibliotecaGet(c, request);
  if (p.accion === 'ver') return verHtml(c, p.id);
  const fn = LECTURAS[p.accion];
  if (!fn) return respuestaJson({ ok: true, app: 'MonteCarmelo', version: 4 });
  return respuestaJson(await fn(c, p));
}

async function porPost(c, request) {
  let datos;
  try {
    datos = JSON.parse((await request.text()) || '{}');
  } catch (_) {
    return respuestaJson({ ok: false, error: 'Solicitud inválida' });
  }
  const fn = ACCIONES[datos.accion];
  if (!fn) throw new ErrorApi('Acción desconocida: ' + datos.accion);
  return conToken(c, await fn(c, datos));
}

async function porPut(c, request, url) {
  const p = Object.fromEntries(url.searchParams);
  const fn = SUBIDAS[p.tipo];
  if (!fn) throw new ErrorApi('Tipo de archivo desconocido: ' + p.tipo);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return conToken(c, await fn(c, request, p, token));
}

export async function atender(ctx) {
  const { request } = ctx;
  const url = new URL(request.url);
  const ruta = url.pathname.replace(/\/+$/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: encabezadosCors });
  let c;
  try {
    c = contexto(ctx);
    const archivo = ruta.match(/^\/api\/(audio|archivo)\/([\w-]+)$/);
    if (archivo && (request.method === 'GET' || request.method === 'HEAD')) {
      const fila = await filaArchivo(c, archivo[2]);
      if (!fila || (archivo[1] === 'audio' && fila.tipo !== 'audio')) {
        return new Response('Archivo no encontrado', { status: 404, headers: encabezadosCors });
      }
      return servirArchivo(c, request, fila, url.searchParams.has('descargar'));
    }
    if (ruta === '/api/subir' && request.method === 'PUT') return await porPut(c, request, url);
    if (ruta !== '/api') return new Response('No encontrado', { status: 404, headers: encabezadosCors });
    if (request.method === 'POST') return await porPost(c, request);
    if (request.method === 'GET' || request.method === 'HEAD') return await porGet(c, request, url);
    return new Response('Método no permitido', { status: 405, headers: encabezadosCors });
  } catch (err) {
    return error(err);
  }
}
