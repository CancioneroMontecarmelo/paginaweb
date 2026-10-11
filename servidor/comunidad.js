// Coros (sistema/coros.json), actividades de las comunidades (actividades.json) y libro de visitas
// (sistema/libro.json, sistema/visitantes.json).
import { Buffer } from 'node:buffer';
// Todo es de la parroquia del pedido (c.slug).
import { ErrorApi, ROLES, ahora, fecha as fechaValida, texto, hoyChile, fechaEn, normEmail, emailValido, parsear, idNuevo } from './util.js';
import { usuarioDeToken, conPrivilegios, puedeEditar, exigirResponsable, auditar, todosLosUsuarios, esResponsable, buscarUsuario, guardarUsuario } from './auth.js';
import { comunidadValida, nombreComunidad } from './parroquias.js';

// ==================== COROS ====================
// Los coros los gestionan del todo los responsables, el sacerdote y el administrador de la comunidad (o de la
// parroquia). El director de cada coro (por su correo, aunque no tenga rol en el sitio) maneja los integrantes
// de su coro, pero no cambia quién dirige, la comunidad ni los permisos del sitio.
const VOCES_CORO = ['soprano', 'contralto', 'tenor', 'bajo'];
const NIVELES_CORO = ['basico', 'intermedio', 'avanzado'];
const ROLES_CORO = ['director', 'subdirector', 'integrante'];
const PERMISOS_CORO = ['', 'colaborador', 'editor'];

function exigirComunidad(u, comunidad) {
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('Solo quienes tienen permisos en esta comunidad pueden ver estos datos.');
}

export function gestionaCoros(u, comunidad) {
  if (!u || u.activo === false || !ROLES[u.rol]) return false;
  if (esResponsable(u) || u.rol === 'sacerdote') return true;
  return u.rol === 'admin' && (u.comunidad === comunidad || u.comunidad === 'parroquia');
}

const directorDe = (coro) => ((coro && coro.integrantes) || []).find((i) => i.rolCoro === 'director') || null;

function dirige(u, coro) {
  const d = directorDe(coro);
  return !!(u && u.activo !== false && d && d.email && d.email === normEmail(u.email));
}

const gestionDe = (u, coro) => (gestionaCoros(u, coro.comunidad) ? 'total' : dirige(u, coro) ? 'director' : '');

function limpiarIntegrante(c, i, comunidadCoro) {
  i = i || {};
  const email = normEmail(i.email);
  return {
    id: /^i-[\w-]{1,40}$/.test(String(i.id || '')) ? i.id : idNuevo('i-', 8),
    nombre: texto(i.nombre, 100),
    email: emailValido(email) ? email : '',
    rolCoro: ROLES_CORO.includes(i.rolCoro) ? i.rolCoro : 'integrante',
    comunidad: comunidadValida(c, i.comunidad) ? i.comunidad : comunidadCoro,
    fechaIncorporacion: fechaValida(i.fechaIncorporacion),
    voz: VOCES_CORO.includes(i.voz) ? i.voz : '',
    instrumentos: texto(i.instrumentos, 200),
    leePartitura: !!i.leePartitura,
    nivel: NIVELES_CORO.includes(i.nivel) ? i.nivel : '',
    notas: texto(i.notas, 500),
    activo: i.activo !== false
  };
}

// Un solo director por coro: queda el primero de la lista
function unSoloDirector(integrantes) {
  let hay = false;
  for (const i of integrantes) {
    if (i.rolCoro !== 'director') continue;
    if (hay) i.rolCoro = 'integrante';
    hay = true;
  }
}

// Lo que el coro puede cambiar del permiso en el sitio de un integrante: solo visitantes y editores o colaboradores
// de la misma comunidad. A los demás se les muestra su rol, sin poder tocarlo.
function permisoDe(c, x, comunidad) {
  if (!x || !ROLES[x.rol]) return { permisoActual: '', permisoFijo: x && x.activo === false ? 'Cuenta bloqueada' : '' };
  if ((x.rol === 'editor' || x.rol === 'colaborador') && x.comunidad === comunidad && x.activo !== false) return { permisoActual: x.rol, permisoFijo: '' };
  return {
    permisoActual: x.rol,
    permisoFijo: x.activo === false ? 'Cuenta bloqueada' : ROLES[x.rol] + ' · ' + (nombreComunidad(c, x.comunidad) || 'Parroquia')
  };
}

function coroConGestion(c, u, coro, usuarios) {
  const gestion = gestionDe(u, coro);
  const integrantes = (coro.integrantes || []).map((i) => (i.email ? { ...i, ...permisoDe(c, usuarios.get(i.email), coro.comunidad) } : i));
  return { ...coro, integrantes, gestion };
}

async function mapaUsuarios(c) {
  return new Map((await todosLosUsuarios(c)).map((x) => [normEmail(x.email), x]));
}

async function listarCoros(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const { results } = await c.db.prepare('SELECT datos FROM coros WHERE parroquia = ? ORDER BY rowid').bind(c.slug).all();
  const visibles = results.map((r) => parsear(r.datos)).filter((x) => x && (puedeEditar(u, x.comunidad) || dirige(u, x)));
  const usuarios = visibles.length ? await mapaUsuarios(c) : new Map();
  return { coros: visibles.map((x) => coroConGestion(c, u, x, usuarios)) };
}

async function aplicarPermisoCoro(c, yo, i, comunidad, pedido, coroNombre) {
  let x = await buscarUsuario(c, i.email);
  if (x && x.activo === false) return null;
  const actual = x && ROLES[x.rol] ? x.rol : '';
  const tocable = !actual || ((actual === 'editor' || actual === 'colaborador') && x.comunidad === comunidad);
  if (!tocable || actual === pedido) return null;
  if (!x) x = { id: idNuevo('u-', 12), email: i.email, nombre: i.nombre || i.email, creado: ahora() };
  else if (!x.verificado && i.nombre) x.nombre = i.nombre;
  x.rol = pedido || 'visitante';
  x.comunidad = pedido ? comunidad : '';
  x.activo = true;
  x.modificadoPor = yo.email;
  await guardarUsuario(c, x);
  await auditar(c, { tipo: 'permisos', email: x.email, nombre: x.nombre, rol: x.rol, comunidad: x.comunidad, por: yo.email, coro: coroNombre });
  return { email: x.email, nombre: x.nombre, rol: x.rol };
}

async function guardarCoro(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const x = d.coro || {};
  const fila = x.id ? await c.db.prepare('SELECT datos FROM coros WHERE id = ? AND parroquia = ?').bind(String(x.id), c.slug).first() : null;
  const previo = fila && parsear(fila.datos);
  let comunidad = String(x.comunidad || '');
  const gestion = previo ? gestionDe(u, previo) : (comunidadValida(c, comunidad) && gestionaCoros(u, comunidad) ? 'total' : '');
  if (!gestion) throw new ErrorApi('Solo los responsables, el sacerdote, el administrador de la comunidad o el director del coro pueden cambiar los coros.');
  if (gestion === 'director') comunidad = previo.comunidad;
  if (!comunidadValida(c, comunidad)) throw new ErrorApi('Elegí la comunidad del coro');
  if (!gestionaCoros(u, comunidad) && gestion === 'total') throw new ErrorApi('No podés pasar el coro a una comunidad que no administrás.');
  const nombre = texto(x.nombre, 100);
  if (!nombre) throw new ErrorApi('Escribí el nombre del coro');
  const pedidos = Array.isArray(x.integrantes) ? x.integrantes.slice(0, 200) : [];
  const integrantes = pedidos.map((i) => limpiarIntegrante(c, i, comunidad)).filter((i) => i.nombre);
  if (gestion === 'director') {
    // El director sigue siendo el mismo, con su correo, aunque lo hayan quitado de la lista
    const dir = limpiarIntegrante(c, directorDe(previo), comunidad);
    const suyo = integrantes.find((i) => i.id === dir.id);
    if (suyo) Object.assign(suyo, { email: dir.email, rolCoro: 'director' });
    else integrantes.unshift(dir);
    for (const i of integrantes) if (i.rolCoro === 'director' && i.id !== dir.id) i.rolCoro = 'subdirector';
  }
  unSoloDirector(integrantes);
  const coro = {
    id: previo ? previo.id : 'coro-' + Date.now(),
    nombre, comunidad, integrantes,
    creado: previo ? previo.creado : ahora(), actualizado: ahora(), modificadoPor: u.email
  };
  await c.db.prepare(previo ? 'UPDATE coros SET comunidad = ?, datos = ? WHERE id = ? AND parroquia = ?' : 'INSERT INTO coros (comunidad, datos, id, parroquia) VALUES (?, ?, ?, ?)')
    .bind(comunidad, JSON.stringify(coro), coro.id, c.slug).run();
  await auditar(c, { tipo: 'coro_guardado', email: u.email, nombre: u.nombre, titulo: coro.nombre, comunidad });
  const permisos = [];
  if (gestion === 'total') {
    const pedidoDe = new Map(pedidos.filter((p) => p && PERMISOS_CORO.includes(p.permiso)).map((p) => [normEmail(p.email), p.permiso]));
    for (const i of integrantes) {
      if (!i.email || !pedidoDe.has(i.email)) continue;
      const r = await aplicarPermisoCoro(c, u, i, comunidad, pedidoDe.get(i.email), coro.nombre);
      if (r) permisos.push(r);
    }
  }
  return { coro: coroConGestion(c, u, coro, await mapaUsuarios(c)), permisos };
}

async function borrarCoro(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const fila = await c.db.prepare('SELECT datos FROM coros WHERE id = ? AND parroquia = ?').bind(String(d.id || ''), c.slug).first();
  if (fila) {
    if (!gestionaCoros(u, parsear(fila.datos, {}).comunidad)) throw new ErrorApi('Solo los responsables, el sacerdote o el administrador de la comunidad pueden borrar un coro.');
    await c.db.prepare('DELETE FROM coros WHERE id = ? AND parroquia = ?').bind(String(d.id), c.slug).run();
  }
  await auditar(c, { tipo: 'coro_borrado', email: u.email, nombre: u.nombre, id: d.id });
  return {};
}

// ==================== ACTIVIDADES ====================
// Lo que se muestra en la marquesina de Inicio. Las publica quien puede editar en esa comunidad; las de toda
// la parroquia, los responsables y sacerdotes.

async function actividades(c, p) {
  const consulta = p && p.todas
    ? c.db.prepare('SELECT datos FROM actividades WHERE parroquia = ? ORDER BY orden LIMIT 60').bind(c.slug)
    : c.db.prepare('SELECT datos FROM actividades WHERE parroquia = ? AND fecha >= ? ORDER BY orden LIMIT 60').bind(c.slug, hoyChile());
  const { results } = await consulta.all();
  return { ok: true, actividades: results.map((r) => parsear(r.datos)).filter(Boolean) };
}

async function guardarActividad(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const a = d.actividad || {};
  const comunidad = comunidadValida(c, a.comunidad) ? a.comunidad : '';
  if (!comunidad) throw new ErrorApi('Elegí la comunidad de la actividad.');
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('No tenés permiso para publicar actividades de esa comunidad.');
  const x = {
    fecha: fechaValida(a.fecha), hora: /^\d{2}:\d{2}$/.test(String(a.hora || '')) ? a.hora : '',
    comunidad, titulo: texto(a.titulo, 120), descripcion: texto(a.descripcion, 400), lugar: texto(a.lugar, 120)
  };
  if (!x.fecha) throw new ErrorApi('Elegí la fecha de la actividad.');
  if (!x.titulo) throw new ErrorApi('Escribí el título de la actividad.');
  const fila = a.id ? await c.db.prepare('SELECT datos FROM actividades WHERE id = ? AND parroquia = ?').bind(String(a.id), c.slug).first() : null;
  let r = fila && parsear(fila.datos);
  if (r && !puedeEditar(u, r.comunidad)) throw new ErrorApi('No tenés permiso para cambiar esa actividad.');
  if (r) Object.assign(r, x, { modificado: ahora(), modificadoPor: u.email });
  else r = Object.assign({ id: 'act-' + Date.now(), autor: u.email, autorNombre: u.nombre || u.email, creado: ahora() }, x);
  const limite = fechaEn('America/Santiago', new Date(Date.now() - 60 * 86400000));
  await c.db.batch([
    c.db.prepare('INSERT OR REPLACE INTO actividades (id, fecha, orden, datos, parroquia) VALUES (?, ?, ?, ?, ?)').bind(r.id, r.fecha, r.fecha + r.hora, JSON.stringify(r), c.slug),
    c.db.prepare('DELETE FROM actividades WHERE fecha < ?').bind(limite)
  ]);
  await auditar(c, { tipo: 'actividad', email: u.email, nombre: u.nombre, titulo: r.titulo, comunidad: r.comunidad });
  return { actividad: r };
}

async function borrarActividad(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const fila = await c.db.prepare('SELECT datos FROM actividades WHERE id = ? AND parroquia = ?').bind(String(d.id || ''), c.slug).first();
  if (!fila) throw new ErrorApi('Esa actividad ya no está.');
  const a = parsear(fila.datos, {});
  if (!puedeEditar(u, a.comunidad)) throw new ErrorApi('No tenés permiso para quitar esa actividad.');
  await c.db.prepare('DELETE FROM actividades WHERE id = ? AND parroquia = ?').bind(String(d.id), c.slug).run();
  await auditar(c, { tipo: 'actividad_quitada', email: u.email, nombre: u.nombre, titulo: a.titulo, comunidad: a.comunidad });
  return {};
}

// ==================== LIBRO DE VISITAS ====================
// Mensajes de otras parroquias y personas. Se muestran en Inicio sin el correo; los responsables pueden
// ocultarlos. Quienes quieren colaborar aparecen marcados en el panel de Identificarse.

async function visitas(c) {
  const { results } = await c.db.prepare('SELECT datos FROM libro WHERE parroquia = ? AND oculto = 0 ORDER BY cuando DESC LIMIT 100').bind(c.slug).all();
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
  if (await contar(c, 'libro-' + c.slug + '-' + Math.floor(Date.now() / 60000), 120) > 5) {
    throw new ErrorApi('Hay muchas firmas en este momento. Probá de nuevo en un minuto.');
  }
  const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c.slug + '|' + m.nombre + '|' + m.mensaje));
  if (await contar(c, 'libro-h-' + Buffer.from(huella).toString('base64url'), 21600) > 1) return {};
  m.id = 'lv-' + Date.now();
  m.cuando = ahora();
  await c.db.batch([
    c.db.prepare('INSERT INTO libro (id, cuando, oculto, datos, parroquia) VALUES (?, ?, 0, ?, ?)').bind(m.id, m.cuando, JSON.stringify(m), c.slug),
    c.db.prepare('DELETE FROM libro WHERE parroquia = ?1 AND id NOT IN (SELECT id FROM libro WHERE parroquia = ?1 ORDER BY cuando DESC LIMIT 2000)').bind(c.slug)
  ]);
  return { mensaje: { id: m.id, nombre: m.nombre, parroquia: m.parroquia, ciudad: m.ciudad, mensaje: m.mensaje, colaborar: m.colaborar, cuando: m.cuando } };
}

async function ocultarVisita(c, d) {
  exigirResponsable(await usuarioDeToken(c, d.token));
  const fila = await c.db.prepare('SELECT datos FROM libro WHERE id = ? AND parroquia = ?').bind(String(d.id || ''), c.slug).first();
  if (!fila) throw new ErrorApi('Ese mensaje ya no está.');
  const m = parsear(fila.datos, {});
  m.oculto = d.oculto !== false;
  await c.db.prepare('UPDATE libro SET oculto = ?, datos = ? WHERE id = ? AND parroquia = ?').bind(m.oculto ? 1 : 0, JSON.stringify(m), String(d.id), c.slug).run();
  return {};
}

// Los invitados de esta parroquia: quienes entraron solo con su correo o con Google sin tener un rol en ella
async function listarVisitantes(c, d) {
  exigirResponsable(await usuarioDeToken(c, d.token));
  const conRol = new Set((await todosLosUsuarios(c)).filter((u) => ROLES[u.rol]).map((u) => normEmail(u.email)));
  const { results: vis } = await c.db.prepare('SELECT datos FROM visitantes WHERE parroquia = ? ORDER BY ultima DESC').bind(c.slug).all();
  const { results: lib } = await c.db.prepare('SELECT datos FROM libro WHERE parroquia = ? ORDER BY cuando DESC LIMIT 300').bind(c.slug).all();
  return {
    visitantes: vis.map((r) => parsear(r.datos)).filter((v) => v && !conRol.has(v.email)),
    libro: lib.map((r) => parsear(r.datos)).filter(Boolean)
  };
}

export const accionesComunidad = {
  listarCoros, guardarCoro, borrarCoro, guardarActividad, borrarActividad, firmarLibro, ocultarVisita, listarVisitantes
};
export const lecturasComunidad = { actividades, visitas };
