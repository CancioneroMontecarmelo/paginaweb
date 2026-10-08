// Biblioteca de canciones: tabla `canciones` (índice + texto del .md) y audios/partituras en R2.
// La lista pública (GET biblioteca) se guarda ya armada en R2 (cache/biblioteca.json) y se rehace con cada
// cambio: así cada lectura cuesta un solo acceso, aunque haya miles de canciones.
import { ErrorApi, COMUNIDADES, MAX_ARCHIVO_BYTES, ahora, slug, ordenTitulo, sello, parsear } from './util.js';
import { usuarioDeToken, conPrivilegios, puedeEditar, soloAdminGeneral, auditar } from './auth.js';
import {
  cabeceraMd, soloAudioMd, letraInicio, conVideoDeCabecera, textoConAudios, idDeEnlace
} from './markdown.js';
import {
  filaArchivo, guardarArchivo, borrarArchivos, bytesDeArchivo, textoDeArchivo, archivoEnBase64, leerCuerpo, mimeAudio
} from './archivos.js';

const CLAVE_CACHE = 'cache/biblioteca.json';

// ==================== LECTURA Y ESCRITURA ====================

export async function leerCancion(c, id) {
  const fila = await c.db.prepare('SELECT datos, md FROM canciones WHERE id = ?').bind(String(id || '')).first();
  return fila ? { e: parsear(fila.datos), md: fila.md } : null;
}

async function exigirCancion(c, id) {
  const r = await leerCancion(c, id);
  if (!r) throw new ErrorApi('Canción no encontrada en la Biblioteca');
  return r;
}

export function sentenciaGuardarCancion(c, e, md) {
  return c.db.prepare('INSERT OR REPLACE INTO canciones (id, orden, datos, md) VALUES (?, ?, ?, ?)')
    .bind(e.id, ordenTitulo(e.titulo), JSON.stringify(e), md);
}

async function guardarCancion(c, e, md) {
  await sentenciaGuardarCancion(c, e, md).run();
}

export async function regenerarBiblioteca(c) {
  const { results } = await c.db.prepare('SELECT datos FROM canciones ORDER BY orden, id').all();
  const texto = '{"ok":true,"actualizado":' + JSON.stringify(ahora()) + ',"canciones":[' + results.map((r) => r.datos).join(',') + ']}';
  await c.r2.put(CLAVE_CACHE, texto, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return texto;
}

export async function todasLasCanciones(c) {
  const { results } = await c.db.prepare('SELECT datos FROM canciones').all();
  return results.map((r) => parsear(r.datos)).filter(Boolean);
}

// GET ?accion=biblioteca (con ETag: si no cambió, el navegador usa la copia que ya tiene)
export async function bibliotecaGet(c, request) {
  const previa = request.headers.get('if-none-match');
  let obj = await c.r2.get(CLAVE_CACHE, previa ? { onlyIf: { etagDoesNotMatch: previa.replace(/^W\//, '').replace(/"/g, '') } } : undefined);
  if (obj && !('body' in obj && obj.body)) {
    return new Response(null, { status: 304, headers: { ETag: obj.httpEtag, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' } });
  }
  if (!obj) {
    await regenerarBiblioteca(c);
    obj = await c.r2.get(CLAVE_CACHE);
  }
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: obj.httpEtag, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }
  });
}

async function cancionGet(c, p) {
  const r = await leerCancion(c, p.id);
  if (!r) throw new ErrorApi('Canción no encontrada');
  return { ok: true, cancion: r.e, texto: r.md };
}

// Respaldo con el formato de antes (base64) para las páginas .html viejas: lo nuevo usa /api/audio/<id>
async function audioGet(c, p) {
  const fila = await filaArchivo(c, p.id);
  if (!fila || fila.tipo !== 'audio') throw new ErrorApi('Audio no encontrado');
  return { ok: true, ...(await archivoEnBase64(c, fila)) };
}

// ==================== AUDIOS ====================

export async function audioPropio(c, fileId) {
  const fila = await filaArchivo(c, fileId);
  return fila && fila.tipo === 'audio' ? fila : null;
}

// Un audio con enlace: si apunta a un audio de la Biblioteca queda como fileId
export async function audioDeEnlace(c, nombre, voz, url) {
  const id = idDeEnlace(url);
  if (id && await audioPropio(c, id)) return { nombre, voz, fileId: id };
  return { nombre: nombre || url, voz, url };
}

// Carpetas que sube la app de escritorio «Subir canciones» tal como están en la computadora
const CARPETAS_RESERVADAS = { audios: true, canciones: true, partituras: true };
export function partesCarpeta(ruta) {
  if (!ruta) return null;
  const partes = String(ruta).split('/').map((p) => p.replace(/[\x00-\x1f\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100))
    .filter((p) => p && p !== '.' && p !== '..');
  if (!partes.length) return null;
  if (partes.length > 8) throw new ErrorApi('La carpeta tiene demasiados niveles: ' + ruta);
  if (CARPETAS_RESERVADAS[partes[0].toLowerCase()]) throw new ErrorApi('«' + partes[0] + '» es una carpeta interna de la Biblioteca: elegí otra carpeta para subir');
  return partes;
}

const nombreArchivoLimpio = (nombre) =>
  String(nombre || 'archivo').replace(/[\x00-\x1f/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'archivo';

// <canción>-<voz>-<fecha>.<ext>
function nombreAudio(d) {
  const original = String(d.nombre || 'audio').replace(/[/\\]/g, '-');
  const ext = (original.match(/\.([a-z0-9]{2,5})$/i) || [, 'm4a'])[1].toLowerCase();
  const base = slug(d.cancion || original.replace(/\.[^.]+$/, ''));
  const voz = d.voz && d.voz !== 'todas' ? '-' + slug(d.voz) : '';
  const fecha = d.cancion ? '-' + sello() : '';
  return (base + voz + fecha).slice(0, 140) + '.' + ext;
}

// Id del audio de la Biblioteca en `carpeta` (reutiliza el que tenga el mismo nombre y tamaño)
async function guardarAudioBiblioteca(c, nombre, tamano, bytes, carpeta = '') {
  const igual = await c.db.prepare('SELECT id FROM archivos WHERE tipo = ? AND carpeta = ? AND nombre = ? AND tamano = ? LIMIT 1')
    .bind('audio', carpeta, nombre, tamano).first();
  if (igual) return igual.id;
  const b = typeof bytes === 'function' ? await bytes() : bytes;
  return (await guardarArchivo(c, { tipo: 'audio', nombre, mime: mimeAudio(nombre), bytes: b, carpeta })).id;
}

// PUT /api/subir?tipo=audio&nombre=&mime=&cancion=&voz=&carpeta=
export async function subirAudio(c, request, p, token) {
  conPrivilegios(await usuarioDeToken(c, token));
  const bytes = await leerCuerpo(request, MAX_ARCHIVO_BYTES, 'El audio supera los 30 MB');
  const partes = partesCarpeta(p.carpeta);
  const nombre = partes ? nombreArchivoLimpio(p.nombre) : nombreAudio(p);
  const igual = await c.db.prepare('SELECT id FROM archivos WHERE tipo = ? AND carpeta = ? AND nombre = ? AND tamano = ? LIMIT 1')
    .bind('audio', partes ? partes.join('/') : '', nombre, bytes.length).first();
  const id = igual ? igual.id : (await guardarArchivo(c, {
    tipo: 'audio', nombre, mime: mimeAudio(nombre, p.mime), bytes, carpeta: partes ? partes.join('/') : ''
  })).id;
  return { fileId: id, nombre };
}

function exigirEditarCancion(u, e) {
  if (e.comunidad && !puedeEditar(u, e.comunidad)) throw new ErrorApi('No tenés permiso para modificar esta canción');
}

async function vincularAudio(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const pedidos = [];
  for (const a of (Array.isArray(d.audios) ? d.audios : []).slice(0, 20)) {
    const fila = await audioPropio(c, a.fileId);
    if (fila) pedidos.push({ nombre: String(a.nombre || fila.nombre).slice(0, 150), voz: String(a.voz || '').slice(0, 30), fileId: fila.id });
  }
  if (!pedidos.length) throw new ErrorApi('No hay audios para vincular');
  const { e, md } = await exigirCancion(c, String(d.cancionId || ''));
  exigirEditarCancion(u, e);
  const ya = new Set((e.audios || []).filter((a) => a.fileId).map((a) => a.fileId));
  const nuevos = pedidos.filter((a) => !ya.has(a.fileId));
  e.audios = (e.audios || []).concat(nuevos);
  e.actualizado = ahora();
  await guardarCancion(c, e, textoConAudios(c, md, nuevos, []));
  await regenerarBiblioteca(c);
  await auditar(c, { tipo: 'audio_vinculado', email: u.email, nombre: u.nombre, titulo: e.titulo });
  return { cancion: e };
}

async function desvincularAudio(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const fileId = String(d.fileId || ''), url = String(d.url || '');
  if (!fileId && !url) throw new ErrorApi('Falta el audio a quitar');
  const { e, md } = await exigirCancion(c, String(d.cancionId || ''));
  exigirEditarCancion(u, e);
  const quitados = (e.audios || []).filter((a) => (fileId ? a.fileId === fileId : a.url === url));
  if (!quitados.length) throw new ErrorApi('Ese audio ya no está en la canción');
  e.audios = e.audios.filter((a) => !quitados.includes(a));
  e.actualizado = ahora();
  await guardarCancion(c, e, textoConAudios(c, md, [], quitados));
  if (fileId) {
    const enUso = await c.db.prepare('SELECT 1 FROM canciones WHERE instr(datos, ?) > 0 LIMIT 1').bind('"fileId":"' + fileId + '"').first();
    const fila = enUso ? null : await audioPropio(c, fileId);
    if (fila && !fila.carpeta) await borrarArchivos(c, [fila]);
  }
  await regenerarBiblioteca(c);
  await auditar(c, { tipo: 'audio_quitado', email: u.email, nombre: u.nombre, titulo: e.titulo });
  return { cancion: e };
}

// ==================== CANCIONES ====================

// items: [{ texto, cab, audios, rutaCarpeta?, nombreMd? }] → entradas de la Biblioteca (una canción por título)
export async function registrarEnBiblioteca(c, items, comunidad, u, { regenerar = true } = {}) {
  const hechas = [];
  for (const it of items) {
    const id = 'c-' + slug(it.cab.titulo);
    const previo = await leerCancion(c, id);
    const previa = previo && previo.e;
    let md = String(it.texto).replace(/\r\n?/g, '\n');
    const e = {
      id, titulo: it.cab.titulo, tono: it.cab.tono, etiquetas: it.cab.etiquetas, mdId: id,
      soloAudio: soloAudioMd(md), inicio: letraInicio(md),
      audios: conVideoDeCabecera(it.audios.length ? it.audios : (previa ? previa.audios || [] : []), md),
      comunidad: (previa && previa.comunidad) || comunidad || '',
      autor: (previa && previa.autor) || u.email, actualizado: ahora()
    };
    if (it.rutaCarpeta) e.carpeta = it.rutaCarpeta;
    else if (previa && previa.carpeta) e.carpeta = previa.carpeta;
    if (it.nombreMd) e.nombreMd = it.nombreMd;
    else if (previa && previa.nombreMd) e.nombreMd = previa.nombreMd;
    if (previa && previa.carpetasExtra && previa.carpetasExtra.length) e.carpetasExtra = previa.carpetasExtra;
    if (it.cab.letraDe) e.letraDe = it.cab.letraDe;
    if (it.cab.musicaDe) e.musicaDe = it.cab.musicaDe;
    if (previa && previa.partituras && previa.partituras.length) e.partituras = previa.partituras;
    // Canción que estaba solo con audios y ahora llega con letra: el .md nuevo no los nombra, pero siguen siendo suyos
    if (!it.audios.length && e.audios.length) {
      const faltan = e.audios.filter((a) => md.indexOf(a.fileId || a.url) < 0);
      if (faltan.length) md = textoConAudios(c, md, faltan, []);
    }
    await guardarCancion(c, e, md);
    hechas.push(e);
  }
  if (regenerar && hechas.length) await regenerarBiblioteca(c);
  return hechas;
}

async function subirCancion(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const texto = String(d.md || '');
  if (!texto.trim()) throw new ErrorApi('La canción está vacía');
  if (texto.length > 500000) throw new ErrorApi('La canción es demasiado grande');
  const audios = [];
  for (const a of (Array.isArray(d.audios) ? d.audios : []).slice(0, 20)) {
    const nombre = String(a.nombre || '').slice(0, 150), voz = String(a.voz || '').slice(0, 30);
    if (a.fileId) {
      const fila = await audioPropio(c, String(a.fileId));
      if (fila) audios.push({ nombre: nombre || fila.nombre, voz, fileId: fila.id });
    } else if (/^https?:\/\//i.test(String(a.url || ''))) {
      audios.push(await audioDeEnlace(c, nombre, voz, String(a.url)));
    }
  }
  const comunidad = COMUNIDADES[d.comunidad] ? d.comunidad : (u.comunidad || '');
  const item = { texto, cab: cabeceraMd(texto, d.nombre), audios };
  const partes = partesCarpeta(d.carpeta);
  if (partes) {
    item.rutaCarpeta = partes.join('/');
    item.nombreMd = nombreArchivoLimpio(d.nombre || slug(item.cab.titulo) + '.md');
  }
  const [e] = await registrarEnBiblioteca(c, [item], comunidad, u, { regenerar: false });
  // Los audios subidos reemplazan en el .md a su ruta local (misma etiqueta title) por su enlace
  const sinEnlace = audios.filter((a) => a.fileId && texto.indexOf(a.fileId) < 0);
  let accesos = 0;
  if (sinEnlace.length || partes) {
    const actual = await leerCancion(c, e.id);
    let md = actual.md;
    if (sinEnlace.length) md = textoConAudios(c, md, sinEnlace, sinEnlace);
    // La misma canción en otras carpetas de la computadora (Comunión y Navidad/Comunión)
    if (partes) {
      const extra = new Set(e.carpetasExtra || []);
      for (const ruta of (Array.isArray(d.accesos) ? d.accesos : []).slice(0, 10)) {
        const p = partesCarpeta(ruta);
        if (!p || p.join('/') === e.carpeta || extra.has(p.join('/'))) continue;
        extra.add(p.join('/'));
        accesos++;
      }
      if (extra.size) e.carpetasExtra = [...extra].slice(0, 20);
    }
    await guardarCancion(c, e, md);
  }
  await regenerarBiblioteca(c);
  await auditar(c, { tipo: 'cancion_subida', email: u.email, nombre: u.nombre, titulo: e.titulo });
  return { cancion: e, accesos };
}

// Canciones de un cancionero guardado desde el editor: pasan a la Biblioteca con sus audios
export async function indexarEnBiblioteca(c, folderId, comunidad, u) {
  const { results: archivos } = await c.db.prepare('SELECT * FROM archivos WHERE tipo = ? AND carpeta = ?').bind('cancionero', folderId).all();
  const porRuta = new Map(archivos.map((f) => [f.ruta, f]));
  const items = [];
  for (const f of archivos.filter((x) => /^canciones\/[^/]+\.md$/i.test(x.ruta))) {
    const texto = await textoDeArchivo(c, f);
    const cab = cabeceraMd(texto, f.ruta.split('/').pop());
    const audios = [];
    for (const a of cab.audios) {
      if (/^https?:/i.test(a.src)) { audios.push(await audioDeEnlace(c, a.nombre, a.voz, a.src)); continue; }
      let ruta;
      try { ruta = decodeURIComponent(a.src); } catch (_) { ruta = a.src; }
      const fa = porRuta.get(ruta.replace(/^(\.\.?\/)+/, ''));
      if (!fa) continue;
      const id = await guardarAudioBiblioteca(c, fa.nombre, fa.tamano, () => bytesDeArchivo(c, fa));
      audios.push({ nombre: a.nombre || fa.nombre, voz: a.voz, fileId: id });
    }
    items.push({ texto, cab, audios });
  }
  return items.length ? registrarEnBiblioteca(c, items, comunidad, u) : [];
}

// ==================== PARTITURAS ====================
const MAX_PARTITURA_BYTES = 15 * 1024 * 1024;
const PARTITURAS = {
  pdf: { mime: 'application/pdf', firma: [0x25, 0x50, 0x44, 0x46] },
  png: { mime: 'image/png', firma: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', firma: [0xff, 0xd8] },
  jpeg: { mime: 'image/jpeg', firma: [0xff, 0xd8] }
};

// PUT /api/subir?tipo=partitura&cancionId=&nombre=&voz=
export async function subirPartitura(c, request, p, token) {
  const u = conPrivilegios(await usuarioDeToken(c, token));
  const original = String(p.nombre || 'partitura').replace(/[/\\]/g, '-');
  const ext = (original.match(/\.([a-z0-9]{2,5})$/i) || [, ''])[1].toLowerCase();
  const tipo = PARTITURAS[ext];
  if (!tipo) throw new ErrorApi('La partitura tiene que ser un PDF o una imagen PNG o JPG');
  const cancionId = String(p.cancionId || ''), voz = String(p.voz || '').slice(0, 30);
  const { e, md } = await exigirCancion(c, cancionId);
  exigirEditarCancion(u, e);
  if ((e.partituras || []).length >= 12) throw new ErrorApi('La canción ya tiene 12 partituras: quitá alguna antes de subir otra');
  const bytes = await leerCuerpo(request, MAX_PARTITURA_BYTES, 'La partitura está vacía o supera los 15 MB');
  if (!tipo.firma.every((b, i) => bytes[i] === b)) throw new ErrorApi('El archivo no es un ' + ext.toUpperCase() + ' válido');
  const nombreArchivo = (slug(e.titulo) + (voz ? '-' + slug(voz) : '') + '-' + sello()).slice(0, 140) + '.' + ext;
  const fila = await guardarArchivo(c, { tipo: 'partitura', nombre: nombreArchivo, mime: tipo.mime, bytes });
  e.partituras = (e.partituras || []).concat([{ fileId: fila.id, nombre: original.replace(/\.[^.]+$/, '').slice(0, 100) || 'Partitura', voz, mime: tipo.mime }]);
  e.actualizado = ahora();
  await guardarCancion(c, e, md);
  await regenerarBiblioteca(c);
  await auditar(c, { tipo: 'partitura_subida', email: u.email, nombre: u.nombre, titulo: e.titulo });
  return { cancion: e };
}

async function quitarPartitura(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const fileId = String(d.fileId || '');
  const { e, md } = await exigirCancion(c, String(d.cancionId || ''));
  exigirEditarCancion(u, e);
  const antes = (e.partituras || []).length;
  e.partituras = (e.partituras || []).filter((x) => x.fileId !== fileId);
  if (e.partituras.length === antes) throw new ErrorApi('Esa partitura ya no está en la canción');
  e.actualizado = ahora();
  await guardarCancion(c, e, md);
  const fila = await filaArchivo(c, fileId);
  if (fila && fila.tipo === 'partitura') await borrarArchivos(c, [fila]);
  await regenerarBiblioteca(c);
  await auditar(c, { tipo: 'partitura_quitada', email: u.email, nombre: u.nombre, titulo: e.titulo });
  return { cancion: e };
}

// ==================== CONVERSIÓN DE LOS AUDIOS A AAC (.m4a) ====================
// Panel del administrador general: los audios que todavía no están en .m4a o .mp3 se convierten en su
// navegador y se reemplaza el contenido del mismo archivo (el id y los enlaces no cambian).
const AUDIO_UNIVERSAL_RE = /\.(m4a|mp3)$/i;

async function audiosAConvertir(c, d) {
  await soloAdminGeneral(c, d.token);
  const usados = new Map();
  let canciones = 0, usos = 0, externos = 0, videos = 0;
  for (const e of await todasLasCanciones(c)) {
    let conArchivo = false;
    for (const a of e.audios || []) {
      if (a.fileId) {
        usos++;
        conArchivo = true;
        if (!usados.has(a.fileId)) usados.set(a.fileId, { cancion: e.titulo, voz: a.voz || '' });
      } else if (/youtu\.?be|vimeo\.com/i.test(a.url || '')) videos++;
      else if (a.url) externos++;
    }
    if (conArchivo) canciones++;
  }
  const { results } = await c.db.prepare('SELECT id, nombre, tamano, mime, carpeta FROM archivos WHERE tipo = ?').bind('audio').all();
  const filas = new Map(results.map((f) => [f.id, f]));
  const pendientes = [];
  let convertidos = 0, bytesPendientes = 0, bytesTotal = 0, perdidos = 0, fuera = 0;
  for (const [id, uso] of usados) {
    const f = filas.get(id);
    if (!f) { perdidos++; continue; }
    if (f.carpeta) fuera++;
    bytesTotal += f.tamano;
    if (AUDIO_UNIVERSAL_RE.test(f.nombre)) { convertidos++; continue; }
    bytesPendientes += f.tamano;
    pendientes.push({ fileId: id, nombre: f.nombre, tamano: f.tamano, mime: f.mime, cancion: uso.cancion, voz: uso.voz });
  }
  pendientes.sort((a, b) => a.cancion.localeCompare(b.cancion));
  return {
    pendientes, convertidos, bytesPendientes, bytesTotal,
    resumen: { archivos: usados.size, usos, canciones, externos, videos, perdidos, fuera }
  };
}

async function leerAudioAConvertir(c, d) {
  await soloAdminGeneral(c, d.token);
  const fila = await audioPropio(c, d.fileId);
  if (!fila) throw new ErrorApi('Ese archivo no es un audio de la Biblioteca');
  return archivoEnBase64(c, fila);
}

// PUT /api/subir?tipo=reemplazo&fileId=
export async function reemplazarAudio(c, request, p, token) {
  await soloAdminGeneral(c, token);
  const fila = await audioPropio(c, p.fileId);
  if (!fila) throw new ErrorApi('Ese archivo no es un audio de la Biblioteca');
  const bytes = await leerCuerpo(request, MAX_ARCHIVO_BYTES, 'El audio convertido está vacío o supera los 30 MB');
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) !== 'ftyp') throw new ErrorApi('Lo recibido no es un archivo .m4a válido');
  const nombre = fila.nombre.replace(/\.[^.]+$/, '') + '.m4a';
  await guardarArchivo(c, { ...fila, nombre, mime: 'audio/mp4', bytes });
  return { fileId: fila.id, nombre, tamano: bytes.length };
}

// Después de cargar la base (scripts/migrar-a-cloudflare.py): completa la letra de las canciones que no la
// tenían (de a 100 por pedido) y rehace la lista pública
async function rehacerBiblioteca(c, d) {
  await soloAdminGeneral(c, d.token);
  const { results } = await c.db.prepare("SELECT id, datos, md FROM canciones WHERE datos NOT LIKE '%\"inicio\":%' LIMIT 100").all();
  if (results.length) {
    const stmt = c.db.prepare('UPDATE canciones SET datos = ? WHERE id = ?');
    await c.db.batch(results.map((f) => {
      const e = parsear(f.datos, {});
      e.inicio = letraInicio(f.md || '');
      if (e.soloAudio === undefined) e.soloAudio = soloAudioMd(f.md || '');
      return stmt.bind(JSON.stringify(e), f.id);
    }));
  }
  const faltan = (await c.db.prepare("SELECT COUNT(*) AS n FROM canciones WHERE datos NOT LIKE '%\"inicio\":%'").first()).n;
  if (!faltan) await regenerarBiblioteca(c);
  return { completadas: results.length, faltan };
}

// Herramientas que trabajaban sobre las carpetas del Drive: quedaron hechas en la mudanza
function herramientaDelDrive() {
  throw new ErrorApi('Esta herramienta era para las carpetas del Drive y ya no hace falta: la Biblioteca está ahora en el servidor de la parroquia.');
}

export const accionesBiblioteca = {
  subirCancion, vincularAudio, desvincularAudio, quitarPartitura, audiosAConvertir, leerAudioAConvertir, rehacerBiblioteca,
  vincularAudiosSueltos: herramientaDelDrive, indexarCarpetas: herramientaDelDrive, quitarAudiosDeYoutube: herramientaDelDrive,
  subirAudioBiblioteca: () => { throw new ErrorApi('Actualizá la página (o la aplicación de escritorio): los audios ahora se suben de otra forma.'); }
};

export const lecturasBiblioteca = { cancion: cancionGet, audio: audioGet };
