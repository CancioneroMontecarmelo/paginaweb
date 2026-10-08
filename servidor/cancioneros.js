// Cancioneros guardados desde el editor (antes MonteCarmelo/Cancioneros/<comunidad>/<fecha>_<nombre>/ en el
// Drive + indice.json). Cada cancionero es una «carpeta» (folderId) con sus archivos en R2:
//   cancionero.m3u8 · canciones/*.md · audios/* · <Título>.html
import { ErrorApi, COMUNIDADES, MAX_ARCHIVO_BYTES, ahora, idNuevo, parsear, respuestaTexto } from './util.js';
import { usuarioDeToken, puedeEditar, esResponsable, auditar } from './auth.js';
import { guardarArchivo, borrarArchivos, filaArchivo, archivoEnBase64, leerCuerpo } from './archivos.js';
import { indexarEnBiblioteca } from './biblioteca.js';

async function leerCancionero(c, folderId) {
  const fila = await c.db.prepare('SELECT * FROM cancioneros WHERE folder_id = ?').bind(String(folderId || '')).first();
  if (!fila) throw new ErrorApi('Ese cancionero no pertenece al sitio');
  const entrada = parsear(fila.datos, {});
  const meta = parsear(fila.meta, null);
  return { fila, entrada: fila.pendiente ? meta : entrada, meta: meta || entrada };
}

async function archivosDe(c, folderId) {
  const { results } = await c.db.prepare('SELECT * FROM archivos WHERE tipo = ? AND carpeta = ? ORDER BY ruta').bind('cancionero', folderId).all();
  return results;
}

const listaArchivos = (filas) => filas.map((f) => ({ id: f.id, ruta: f.ruta, mime: f.mime, size: f.tamano }));

async function iniciarCancionero(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const comunidad = String(d.comunidad || '');
  if (!COMUNIDADES[comunidad]) throw new ErrorApi('Comunidad desconocida');
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('No tenés permiso para guardar cancioneros de ' + COMUNIDADES[comunidad]);
  const titulo = String(d.titulo || '').trim() || 'Cancionero';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || '')) ? d.fecha : ahora().slice(0, 10);
  const meta = JSON.stringify({ comunidad, titulo, fecha, autor: u.email });
  if (d.folderId) {
    const x = await leerCancionero(c, d.folderId);
    if (!puedeEditar(u, x.entrada.comunidad)) throw new ErrorApi('No tenés permiso para modificar este cancionero');
    await c.db.prepare('UPDATE cancioneros SET meta = ? WHERE folder_id = ?').bind(meta, x.fila.folder_id).run();
    return { folderId: x.fila.folder_id, existentes: listaArchivos(await archivosDe(c, x.fila.folder_id)) };
  }
  const folderId = idNuevo();
  await c.db.prepare('INSERT INTO cancioneros (folder_id, comunidad, fecha, pendiente, datos, meta) VALUES (?, ?, ?, 1, ?, ?)')
    .bind(folderId, comunidad, fecha, '{}', meta).run();
  return { folderId, existentes: [] };
}

// PUT /api/subir?tipo=cancionero&folderId=&ruta=&mime=
export async function subirArchivoCancionero(c, request, p, token) {
  const u = await usuarioDeToken(c, token);
  const x = await leerCancionero(c, p.folderId);
  if (!puedeEditar(u, x.entrada.comunidad)) throw new ErrorApi('Sin permiso');
  const partes = String(p.ruta || '').split('/').filter((s) => s && s !== '.' && s !== '..');
  if (!partes.length) throw new ErrorApi('Ruta vacía');
  const nombre = partes[partes.length - 1];
  const bytes = await leerCuerpo(request, MAX_ARCHIVO_BYTES, 'El archivo ' + nombre + ' supera los 30 MB');
  const ruta = partes.join('/');
  const { results: previos } = await c.db.prepare('SELECT * FROM archivos WHERE tipo = ? AND carpeta = ? AND ruta = ?')
    .bind('cancionero', x.fila.folder_id, ruta).all();
  await borrarArchivos(c, previos);
  const id = idNuevo();
  const fila = await guardarArchivo(c, {
    id, tipo: 'cancionero', r2: 'cancioneros/' + x.fila.folder_id + '/' + id, nombre,
    mime: p.mime || 'application/octet-stream', bytes, carpeta: x.fila.folder_id, ruta
  });
  return { fileId: fila.id, size: fila.tamano };
}

async function cerrarCancionero(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const x = await leerCancionero(c, d.folderId);
  if (!puedeEditar(u, x.entrada.comunidad)) throw new ErrorApi('Sin permiso');
  const folderId = x.fila.folder_id;
  let archivos = await archivosDe(c, folderId);
  if (Array.isArray(d.conservar)) {
    const quedan = new Set(d.conservar);
    await borrarArchivos(c, archivos.filter((f) => !quedan.has(f.ruta)));
    archivos = archivos.filter((f) => quedan.has(f.ruta));
  }
  const html = d.htmlRuta ? archivos.find((f) => f.ruta === d.htmlRuta) : null;
  const previa = x.fila.pendiente ? {} : parsear(x.fila.datos, {});
  const meta = x.meta;
  const e = {
    folderId,
    htmlId: (html && html.id) || previa.htmlId || '',
    titulo: meta.titulo,
    comunidad: meta.comunidad,
    comunidadNombre: COMUNIDADES[meta.comunidad],
    fecha: meta.fecha,
    canciones: Number(d.canciones) || 0,
    audios: Number(d.audios) || 0,
    comentario: String(d.comentario || previa.comentario || ''),
    autor: previa.autor || u.email,
    autorNombre: previa.autorNombre || u.nombre,
    creado: previa.creado || ahora(),
    actualizado: ahora()
  };
  await c.db.prepare('UPDATE cancioneros SET html_id = ?, comunidad = ?, fecha = ?, pendiente = 0, actualizado = ?, datos = ?, meta = NULL WHERE folder_id = ?')
    .bind(e.htmlId, e.comunidad, e.fecha, e.actualizado, JSON.stringify(e), folderId).run();
  try {
    await indexarEnBiblioteca(c, folderId, e.comunidad, u);
  } catch (err) {
    console.warn('Biblioteca: ' + err);
  }
  await auditar(c, { tipo: 'cancionero_guardado', email: u.email, nombre: u.nombre, titulo: e.titulo, comunidad: e.comunidad });
  return { cancionero: e };
}

async function listar(c, d) {
  const comunidad = d && d.comunidad ? String(d.comunidad) : '';
  const consulta = comunidad
    ? c.db.prepare('SELECT datos FROM cancioneros WHERE pendiente = 0 AND comunidad = ? ORDER BY fecha DESC, actualizado DESC').bind(comunidad)
    : c.db.prepare('SELECT datos FROM cancioneros WHERE pendiente = 0 ORDER BY fecha DESC, actualizado DESC');
  const { results } = await consulta.all();
  return { ok: true, cancioneros: results.map((r) => parsear(r.datos)).filter(Boolean) };
}

async function abrir(c, d) {
  await usuarioDeToken(c, d.token);
  const x = await leerCancionero(c, d.folderId);
  return { cancionero: x.entrada, archivos: listaArchivos(await archivosDe(c, x.fila.folder_id)) };
}

// Respaldo con el formato de antes (base64): el editor nuevo baja los archivos de /api/archivo/<id>
async function archivo(c, d) {
  await usuarioDeToken(c, d.token);
  const fila = await filaArchivo(c, d.id);
  if (!fila || fila.tipo !== 'cancionero') throw new ErrorApi('Ese archivo no pertenece a un cancionero');
  return archivoEnBase64(c, fila);
}

// GET ?accion=ver&id=<htmlId>: la página del cancionero, como texto (ver.html la muestra)
export async function verHtml(c, id) {
  const fila = await c.db.prepare('SELECT folder_id FROM cancioneros WHERE html_id = ? AND pendiente = 0').bind(String(id || '')).first();
  const archivoHtml = fila ? await filaArchivo(c, id) : null;
  const obj = archivoHtml ? await c.r2.get(archivoHtml.r2) : null;
  if (!obj) return respuestaTexto('Cancionero no encontrado');
  return respuestaTexto(await obj.text());
}

async function borrarCancionero(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const x = await leerCancionero(c, d.folderId);
  if (!esResponsable(u) && !(u.rol === 'admin' && puedeEditar(u, x.entrada.comunidad))) throw new ErrorApi('Sin permiso para borrar');
  await borrarArchivos(c, await archivosDe(c, x.fila.folder_id));
  await c.db.prepare('DELETE FROM cancioneros WHERE folder_id = ?').bind(x.fila.folder_id).run();
  await auditar(c, { tipo: 'cancionero_borrado', email: u.email, nombre: u.nombre, titulo: x.entrada.titulo });
  return {};
}

export const accionesCancioneros = { iniciarCancionero, cerrarCancionero, abrir, archivo, borrarCancionero, listar };
export const lecturasCancioneros = { listar };
