// Coros (sistema/coros.json), actividades de las comunidades (actividades.json) y libro de visitas
// (sistema/libro.json, sistema/visitantes.json).
import { Buffer } from 'node:buffer';
import { ErrorApi, ROLES, COMUNIDADES, ahora, fecha as fechaValida, texto, hoyChile, fechaEn, comunidadValida, normEmail, emailValido, parsear, idNuevo } from './util.js';
import { usuarioDeToken, conPrivilegios, puedeEditar, exigirResponsable, auditar, todosLosUsuarios } from './auth.js';

// ==================== COROS ====================
const VOCES_CORO = ['soprano', 'contralto', 'tenor', 'bajo'];
const NIVELES_CORO = ['basico', 'intermedio', 'avanzado'];

function exigirComunidad(u, comunidad) {
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('Solo quienes tienen permisos en esta comunidad pueden ver estos datos.');
}

function limpiarIntegrante(i, comunidadCoro) {
  i = i || {};
  return {
    id: /^i-[\w-]{1,40}$/.test(String(i.id || '')) ? i.id : idNuevo('i-', 8),
    nombre: texto(i.nombre, 100),
    comunidad: comunidadValida(i.comunidad) ? i.comunidad : comunidadCoro,
    fechaIncorporacion: fechaValida(i.fechaIncorporacion),
    voz: VOCES_CORO.includes(i.voz) ? i.voz : '',
    instrumentos: texto(i.instrumentos, 200),
    leePartitura: !!i.leePartitura,
    nivel: NIVELES_CORO.includes(i.nivel) ? i.nivel : '',
    notas: texto(i.notas, 500),
    activo: i.activo !== false
  };
}

async function listarCoros(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const { results } = await c.db.prepare('SELECT datos FROM coros ORDER BY rowid').all();
  return { coros: results.map((r) => parsear(r.datos)).filter((x) => x && puedeEditar(u, x.comunidad)) };
}

async function guardarCoro(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const x = d.coro || {};
  const comunidad = String(x.comunidad || '');
  if (!comunidadValida(comunidad)) throw new ErrorApi('Elegí la comunidad del coro');
  exigirComunidad(u, comunidad);
  const nombre = texto(x.nombre, 100);
  if (!nombre) throw new ErrorApi('Escribí el nombre del coro');
  const fila = x.id ? await c.db.prepare('SELECT datos FROM coros WHERE id = ?').bind(String(x.id)).first() : null;
  const previo = fila && parsear(fila.datos);
  if (previo) exigirComunidad(u, previo.comunidad);
  const coro = {
    id: previo ? previo.id : 'coro-' + Date.now(),
    nombre, comunidad,
    integrantes: (Array.isArray(x.integrantes) ? x.integrantes : []).slice(0, 200)
      .map((i) => limpiarIntegrante(i, comunidad)).filter((i) => i.nombre),
    creado: previo ? previo.creado : ahora(), actualizado: ahora(), modificadoPor: u.email
  };
  await c.db.prepare(previo ? 'UPDATE coros SET comunidad = ?, datos = ? WHERE id = ?' : 'INSERT INTO coros (comunidad, datos, id) VALUES (?, ?, ?)')
    .bind(comunidad, JSON.stringify(coro), coro.id).run();
  await auditar(c, { tipo: 'coro_guardado', email: u.email, nombre: u.nombre, titulo: coro.nombre, comunidad });
  return { coro };
}

async function borrarCoro(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const fila = await c.db.prepare('SELECT datos FROM coros WHERE id = ?').bind(String(d.id || '')).first();
  if (fila) {
    exigirComunidad(u, parsear(fila.datos, {}).comunidad);
    await c.db.prepare('DELETE FROM coros WHERE id = ?').bind(String(d.id)).run();
  }
  await auditar(c, { tipo: 'coro_borrado', email: u.email, nombre: u.nombre, id: d.id });
  return {};
}

// ==================== ACTIVIDADES ====================
// Lo que se muestra en la marquesina de Inicio. Las publica quien puede editar en esa comunidad; las de toda
// la parroquia, los responsables y sacerdotes.

async function actividades(c, p) {
  const consulta = p && p.todas
    ? c.db.prepare('SELECT datos FROM actividades ORDER BY orden LIMIT 60')
    : c.db.prepare('SELECT datos FROM actividades WHERE fecha >= ? ORDER BY orden LIMIT 60').bind(hoyChile());
  const { results } = await consulta.all();
  return { ok: true, actividades: results.map((r) => parsear(r.datos)).filter(Boolean) };
}

async function guardarActividad(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const a = d.actividad || {};
  const comunidad = a.comunidad === 'parroquia' || COMUNIDADES[a.comunidad] ? a.comunidad : '';
  if (!comunidad) throw new ErrorApi('Elegí la comunidad de la actividad.');
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('No tenés permiso para publicar actividades de esa comunidad.');
  const x = {
    fecha: fechaValida(a.fecha), hora: /^\d{2}:\d{2}$/.test(String(a.hora || '')) ? a.hora : '',
    comunidad, titulo: texto(a.titulo, 120), descripcion: texto(a.descripcion, 400), lugar: texto(a.lugar, 120)
  };
  if (!x.fecha) throw new ErrorApi('Elegí la fecha de la actividad.');
  if (!x.titulo) throw new ErrorApi('Escribí el título de la actividad.');
  const fila = a.id ? await c.db.prepare('SELECT datos FROM actividades WHERE id = ?').bind(String(a.id)).first() : null;
  let r = fila && parsear(fila.datos);
  if (r && !puedeEditar(u, r.comunidad)) throw new ErrorApi('No tenés permiso para cambiar esa actividad.');
  if (r) Object.assign(r, x, { modificado: ahora(), modificadoPor: u.email });
  else r = Object.assign({ id: 'act-' + Date.now(), autor: u.email, autorNombre: u.nombre || u.email, creado: ahora() }, x);
  const limite = fechaEn('America/Santiago', new Date(Date.now() - 60 * 86400000));
  await c.db.batch([
    c.db.prepare('INSERT OR REPLACE INTO actividades (id, fecha, orden, datos) VALUES (?, ?, ?, ?)').bind(r.id, r.fecha, r.fecha + r.hora, JSON.stringify(r)),
    c.db.prepare('DELETE FROM actividades WHERE fecha < ?').bind(limite)
  ]);
  await auditar(c, { tipo: 'actividad', email: u.email, nombre: u.nombre, titulo: r.titulo, comunidad: r.comunidad });
  return { actividad: r };
}

async function borrarActividad(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const fila = await c.db.prepare('SELECT datos FROM actividades WHERE id = ?').bind(String(d.id || '')).first();
  if (!fila) throw new ErrorApi('Esa actividad ya no está.');
  const a = parsear(fila.datos, {});
  if (!puedeEditar(u, a.comunidad)) throw new ErrorApi('No tenés permiso para quitar esa actividad.');
  await c.db.prepare('DELETE FROM actividades WHERE id = ?').bind(String(d.id)).run();
  await auditar(c, { tipo: 'actividad_quitada', email: u.email, nombre: u.nombre, titulo: a.titulo, comunidad: a.comunidad });
  return {};
}

// ==================== LIBRO DE VISITAS ====================
// Mensajes de otras parroquias y personas. Se muestran en Inicio sin el correo; los responsables pueden
// ocultarlos. Quienes quieren colaborar aparecen marcados en el panel de Identificarse.

async function visitas(c) {
  const { results } = await c.db.prepare('SELECT datos FROM libro WHERE oculto = 0 ORDER BY cuando DESC LIMIT 100').all();
  return {
    ok: true,
    mensajes: results.map((r) => parsear(r.datos)).filter(Boolean).map((m) => ({
      id: m.id, nombre: m.nombre, parroquia: m.parroquia, ciudad: m.ciudad, mensaje: m.mensaje, colaborar: !!m.colaborar, cuando: m.cuando
    }))
  };
}

// Suma 1 al contador `clave` (que vence en `seg`) y devuelve el valor nuevo
async function contar(c, clave, seg) {
  const ahoraMs = Date.now();
  const fila = await c.db.prepare(
    'INSERT INTO limites (clave, valor, vence) VALUES (?1, 1, ?2) ' +
    'ON CONFLICT(clave) DO UPDATE SET valor = CASE WHEN vence < ?3 THEN 1 ELSE valor + 1 END, vence = CASE WHEN vence < ?3 THEN ?2 ELSE vence END ' +
    'RETURNING valor'
  ).bind(clave, ahoraMs + seg * 1000, ahoraMs).first();
  return fila ? fila.valor : 1;
}

// Sin sesión: la protección es el campo trampa, los largos máximos, un máximo de firmas por minuto y no repetir
async function firmarLibro(c, d) {
  if (String(d.sitio || '').trim()) return {};
  const m = {
    nombre: texto(d.nombre, 80), parroquia: texto(d.parroquia, 120), ciudad: texto(d.ciudad, 80),
    mensaje: texto(d.mensaje, 1000), colaborar: d.colaborar === true, correo: normEmail(d.correo).slice(0, 120)
  };
  if (!m.nombre) throw new ErrorApi('Escribí tu nombre.');
  if (m.mensaje.length < 3) throw new ErrorApi('Escribí un mensaje.');
  if (m.correo && !emailValido(m.correo)) throw new ErrorApi('El correo no es válido (puedes dejarlo vacío).');
  if (/https?:\/\/|www\./i.test(m.mensaje + m.nombre + m.parroquia)) throw new ErrorApi('El mensaje no puede llevar enlaces.');
  await c.db.prepare('DELETE FROM limites WHERE vence < ?').bind(Date.now()).run();
  if (await contar(c, 'libro-' + Math.floor(Date.now() / 60000), 120) > 5) {
    throw new ErrorApi('Hay muchas firmas en este momento. Probá de nuevo en un minuto.');
  }
  const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m.nombre + '|' + m.mensaje));
  if (await contar(c, 'libro-h-' + Buffer.from(huella).toString('base64url'), 21600) > 1) return {};
  m.id = 'lv-' + Date.now();
  m.cuando = ahora();
  await c.db.batch([
    c.db.prepare('INSERT INTO libro (id, cuando, oculto, datos) VALUES (?, ?, 0, ?)').bind(m.id, m.cuando, JSON.stringify(m)),
    c.db.prepare('DELETE FROM libro WHERE id NOT IN (SELECT id FROM libro ORDER BY cuando DESC LIMIT 2000)')
  ]);
  return { mensaje: { id: m.id, nombre: m.nombre, parroquia: m.parroquia, ciudad: m.ciudad, mensaje: m.mensaje, colaborar: m.colaborar, cuando: m.cuando } };
}

async function ocultarVisita(c, d) {
  exigirResponsable(await usuarioDeToken(c, d.token));
  const fila = await c.db.prepare('SELECT datos FROM libro WHERE id = ?').bind(String(d.id || '')).first();
  if (!fila) throw new ErrorApi('Ese mensaje ya no está.');
  const m = parsear(fila.datos, {});
  m.oculto = d.oculto !== false;
  await c.db.prepare('UPDATE libro SET oculto = ?, datos = ? WHERE id = ?').bind(m.oculto ? 1 : 0, JSON.stringify(m), String(d.id)).run();
  return {};
}

async function listarVisitantes(c, d) {
  exigirResponsable(await usuarioDeToken(c, d.token));
  const conRol = new Set((await todosLosUsuarios(c)).filter((u) => ROLES[u.rol]).map((u) => normEmail(u.email)));
  const { results: vis } = await c.db.prepare('SELECT datos FROM visitantes ORDER BY ultima DESC').all();
  const { results: lib } = await c.db.prepare('SELECT datos FROM libro ORDER BY cuando DESC LIMIT 300').all();
  return {
    visitantes: vis.map((r) => parsear(r.datos)).filter((v) => v && !conRol.has(v.email)),
    libro: lib.map((r) => parsear(r.datos)).filter(Boolean)
  };
}

export const accionesComunidad = {
  listarCoros, guardarCoro, borrarCoro, guardarActividad, borrarActividad, firmarLibro, ocultarVisita, listarVisitantes
};
export const lecturasComunidad = { actividades, visitas };
