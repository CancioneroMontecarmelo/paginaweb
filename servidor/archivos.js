// Archivos en R2: audios y partituras de la Biblioteca y archivos de los cancioneros.
// Se sirven directo (con Range, para que el audio empiece a sonar enseguida y se pueda adelantar).
import { Buffer } from 'node:buffer';
import { ErrorApi, ahora, idNuevo, encabezadosCors } from './util.js';

export const MIMES_AUDIO = {
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', webm: 'audio/webm', weba: 'audio/webm',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav'
};

export function mimeAudio(nombre, mime) {
  const ext = (String(nombre).match(/\.([a-z0-9]{2,5})$/i) || [, ''])[1].toLowerCase();
  return MIMES_AUDIO[ext] || String(mime || 'application/octet-stream');
}

export async function filaArchivo(c, id) {
  return c.db.prepare('SELECT * FROM archivos WHERE id = ?').bind(String(id || '')).first();
}

// Guarda los bytes en R2 y anota el archivo. Devuelve la fila.
export async function guardarArchivo(c, { id, tipo, r2, nombre, mime, bytes, carpeta = '', ruta = '' }) {
  id = id || idNuevo();
  r2 = r2 || (tipo === 'audio' ? 'audios/' : tipo === 'partitura' ? 'partituras/' : 'otros/') + id;
  await c.r2.put(r2, bytes, { httpMetadata: { contentType: mime }, customMetadata: { nombre } });
  const fila = { id, tipo, r2, nombre, mime, tamano: bytes.byteLength, carpeta, ruta, creado: ahora() };
  await c.db.prepare('INSERT OR REPLACE INTO archivos (id, tipo, r2, nombre, mime, tamano, carpeta, ruta, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(fila.id, fila.tipo, fila.r2, fila.nombre, fila.mime, fila.tamano, fila.carpeta, fila.ruta, fila.creado).run();
  return fila;
}

export async function borrarArchivos(c, filas) {
  if (!filas.length) return;
  for (let i = 0; i < filas.length; i += 500) {
    await c.r2.delete(filas.slice(i, i + 500).map((f) => f.r2));
  }
  const stmt = c.db.prepare('DELETE FROM archivos WHERE id = ?');
  await c.db.batch(filas.map((f) => stmt.bind(f.id)));
}

export async function bytesDeArchivo(c, fila) {
  const obj = await c.r2.get(fila.r2);
  if (!obj) throw new ErrorApi('El archivo ya no está en el servidor');
  return new Uint8Array(await obj.arrayBuffer());
}

export async function textoDeArchivo(c, fila) {
  const obj = await c.r2.get(fila.r2);
  return obj ? obj.text() : '';
}

// Respaldo con el formato que esperaban las páginas viejas: { base64, mime, nombre }
export async function archivoEnBase64(c, fila) {
  return { base64: Buffer.from(await bytesDeArchivo(c, fila)).toString('base64'), mime: fila.mime, nombre: fila.nombre };
}

function nombreDescarga(nombre) {
  const limpio = String(nombre || 'archivo').replace(/["\\\r\n]/g, '');
  return `filename="${limpio.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(limpio)}`;
}

// GET /api/audio/<id> y /api/archivo/<id>
export async function servirArchivo(c, request, fila, descargar) {
  const obj = await c.r2.get(fila.r2, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response('Archivo no encontrado', { status: 404, headers: encabezadosCors });
  const h = new Headers(encabezadosCors);
  obj.writeHttpMetadata(h);
  h.set('Content-Type', fila.mime || h.get('Content-Type') || 'application/octet-stream');
  h.set('ETag', obj.httpEtag);
  h.set('Accept-Ranges', 'bytes');
  h.set('Cache-Control', 'public, max-age=86400');
  h.set('Content-Disposition', (descargar ? 'attachment; ' : 'inline; ') + nombreDescarga(fila.nombre));
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
  if (obj.range && request.headers.has('range')) {
    const desde = obj.range.offset ?? (obj.size - obj.range.suffix);
    const largo = obj.range.length ?? (obj.size - desde);
    h.set('Content-Range', `bytes ${desde}-${desde + largo - 1}/${obj.size}`);
    h.set('Content-Length', String(largo));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers: h });
}

// Cuerpo de un PUT /api/subir (el archivo tal cual, sin base64)
export async function leerCuerpo(request, maximo, mensaje) {
  const declarado = Number(request.headers.get('content-length') || 0);
  if (declarado > maximo) throw new ErrorApi(mensaje);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw new ErrorApi('El archivo llegó vacío');
  if (bytes.length > maximo) throw new ErrorApi(mensaje);
  return bytes;
}
