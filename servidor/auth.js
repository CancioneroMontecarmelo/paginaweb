// Sesiones, usuarios, permisos y registro de auditoría.
// El token es el mismo del Apps Script: base64url(JSON {email, exp en ms}) + "." + base64url(HMAC-SHA256),
// firmado con el mismo SECRETO: las sesiones y las claves de los scripts de escritorio siguen valiendo.
// La cuenta (correo, nombre, foto) es una sola; el rol y la comunidad van por parroquia (tabla miembros).
import { Buffer } from 'node:buffer';
import { ROLES, TOKEN_DIAS, ErrorApi, normEmail, emailValido, ahora, parsear } from './util.js';
import { comunidadValida, nombreComunidad, urlParroquia } from './parroquias.js';

const enc = new TextEncoder();
let claveCache = null;

async function clave(c) {
  const secreto = c.env.SECRETO;
  if (!secreto) throw new ErrorApi('Falta configurar el SECRETO del servidor (ver README, «Cloudflare»).');
  if (claveCache && claveCache.secreto === secreto) return claveCache.key;
  const key = await crypto.subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  claveCache = { secreto, key };
  return key;
}

export async function crearToken(c, u) {
  const payload = Buffer.from(JSON.stringify({ email: u.email, exp: Date.now() + TOKEN_DIAS * 86400 * 1000 })).toString('base64url');
  const firma = await crypto.subtle.sign('HMAC', await clave(c), enc.encode(payload));
  return payload + '.' + Buffer.from(firma).toString('base64url');
}

// Devuelve el usuario del token (y lo deja en c.yo para renovar el token en la respuesta)
export async function usuarioDeToken(c, token) {
  const partes = String(token || '').split('.');
  let valido = false;
  if (partes.length === 2 && partes[0] && partes[1]) {
    try {
      valido = await crypto.subtle.verify('HMAC', await clave(c), Buffer.from(partes[1], 'base64url'), enc.encode(partes[0]));
    } catch (e) {
      if (e instanceof ErrorApi) throw e;
    }
  }
  if (!valido) throw new ErrorApi('Sesión inválida. Volvé a identificarte.');
  const datos = parsear(Buffer.from(partes[0], 'base64url').toString('utf8'), {});
  if (!datos.exp || datos.exp < Date.now()) throw new ErrorApi('La sesión venció. Volvé a identificarte.');
  const u = await buscarUsuario(c, datos.email);
  if (!u || u.activo === false) throw new ErrorApi('Cuenta inexistente o sin acceso.');
  c.yo = u;
  return u;
}

export function sesionPublica(u) {
  return {
    id: u.id, email: u.email, nombre: u.nombre || u.email, foto: u.foto || '',
    rol: ROLES[u.rol] ? u.rol : 'visitante', comunidad: u.comunidad || '', activo: u.activo !== false,
    parroquia: u.parroquia || '', mostrarNombre: !!u.mostrarNombre
  };
}

export const esResponsable = (u) => !!u && u.activo !== false && (u.rol === 'admin_general' || u.rol === 'admin_segundo');

export function puedeEditar(u, comunidad) {
  if (!u || u.activo === false || !ROLES[u.rol]) return false;
  if (esResponsable(u) || u.rol === 'sacerdote' || u.comunidad === 'parroquia') return true;
  return u.comunidad === comunidad;
}

export function exigirResponsable(u) {
  if (!esResponsable(u)) throw new ErrorApi('Solo el administrador general o un responsable de la parroquia pueden hacer esto.');
}

export function conPrivilegios(u) {
  if (!ROLES[u.rol] || u.activo === false) throw new ErrorApi('Tu cuenta todavía no tiene permisos para esto en esta parroquia.');
  return u;
}

export async function soloAdminGeneral(c, token) {
  const u = await usuarioDeToken(c, token);
  if (u.rol !== 'admin_general') throw new ErrorApi('Solo el administrador general puede revisar y convertir los audios de la Biblioteca.');
  return u;
}

// ==================== USUARIOS ====================

// Administradores generales (todas las parroquias): el correo principal y, si hay, los de ADMINS_GENERALES
// (separados por comas, en wrangler.toml o en las variables del proyecto en Cloudflare)
const correoParroquia = (c) => normEmail(c.env.CORREO_PARROQUIA || 'cancionerolitugico@gmail.com');
const adminsGenerales = (c) => new Set([correoParroquia(c), ...String(c.env.ADMINS_GENERALES || '').split(',').map(normEmail).filter(Boolean)]);
export const esAdminGeneral = (c, email) => adminsGenerales(c).has(normEmail(email));

function semilla(c) {
  return { id: 'u-marcos', nombre: 'Marcos Mora Vitta', email: correoParroquia(c) };
}

const CAMPOS_CUENTA = ['id', 'email', 'nombre', 'foto', 'verificado', 'ultimaEntrada', 'creado', 'mostrarNombre'];
const CAMPOS_MIEMBRO = ['rol', 'comunidad', 'activo', 'invitado', 'invitadoPor', 'modificadoPor', 'creado'];
const elegir = (o, campos) => Object.fromEntries(campos.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// La cuenta con el rol que tiene en la parroquia del pedido
function conMiembro(c, cuenta, miembro) {
  const u = { ...elegir(cuenta, CAMPOS_CUENTA), parroquia: c.slug };
  if (esAdminGeneral(c, u.email)) return Object.assign(u, { rol: 'admin_general', comunidad: 'parroquia', activo: true });
  if (!miembro) return Object.assign(u, { rol: 'visitante', comunidad: '', activo: true });
  return Object.assign(u, elegir(miembro, CAMPOS_MIEMBRO), { creado: u.creado || miembro.creado, activo: miembro.activo !== false });
}

export async function buscarUsuario(c, email) {
  const e = normEmail(email);
  const [fila, m] = await Promise.all([
    c.db.prepare('SELECT datos FROM usuarios WHERE email = ?').bind(e).first(),
    c.db.prepare('SELECT datos FROM miembros WHERE parroquia = ? AND email = ?').bind(c.slug, e).first()
  ]);
  const cuenta = fila ? parsear(fila.datos, {}) : (esAdminGeneral(c, e) ? semilla(c) : m ? { email: e, nombre: e } : null);
  return cuenta ? conMiembro(c, cuenta, m && parsear(m.datos, {})) : null;
}

// Guarda la cuenta y, aparte, su rol en la parroquia del pedido. Sin rol ni bloqueo deja de ser miembro.
export async function guardarUsuario(c, u) {
  const email = normEmail(u.email);
  const ops = [c.db.prepare('INSERT OR REPLACE INTO usuarios (email, datos) VALUES (?, ?)').bind(email, JSON.stringify({ ...elegir(u, CAMPOS_CUENTA), email }))];
  if (!esAdminGeneral(c, email)) {
    const miembro = ROLES[u.rol] || u.activo === false;
    ops.push(miembro
      ? c.db.prepare('INSERT OR REPLACE INTO miembros (parroquia, email, datos) VALUES (?, ?, ?)')
        .bind(c.slug, email, JSON.stringify({ ...elegir(u, CAMPOS_MIEMBRO), rol: ROLES[u.rol] ? u.rol : 'visitante', activo: u.activo !== false }))
      : c.db.prepare('DELETE FROM miembros WHERE parroquia = ? AND email = ?').bind(c.slug, email));
  }
  await c.db.batch(ops);
}

// Quienes tienen un rol (o están bloqueados) en esta parroquia, más el administrador general
export async function todosLosUsuarios(c) {
  const { results } = await c.db.prepare(
    'SELECT m.email AS email, m.datos AS m, u.datos AS u FROM miembros m LEFT JOIN usuarios u ON u.email = m.email WHERE m.parroquia = ?'
  ).bind(c.slug).all();
  const lista = results.map((r) => conMiembro(c, parsear(r.u, null) || { email: r.email, nombre: r.email }, parsear(r.m, {})));
  if (!lista.some((u) => esAdminGeneral(c, u.email))) {
    const fila = await c.db.prepare('SELECT datos FROM usuarios WHERE email = ?').bind(correoParroquia(c)).first();
    lista.unshift(conMiembro(c, (fila && parsear(fila.datos, null)) || semilla(c), null));
  }
  return lista;
}

export async function auditar(c, evento) {
  evento.id = 'a-' + Date.now();
  evento.cuando = ahora();
  await c.db.batch([
    c.db.prepare('INSERT INTO auditoria (parroquia, datos) VALUES (?, ?)').bind(c.slug, JSON.stringify(evento)),
    c.db.prepare('DELETE FROM auditoria WHERE parroquia = ?1 AND n <= (SELECT MAX(n) FROM auditoria WHERE parroquia = ?1) - 20000').bind(c.slug)
  ]);
}

async function registrarVisitante(c, email, nombre, via) {
  try {
    const fila = await c.db.prepare('SELECT datos FROM visitantes WHERE parroquia = ? AND email = ?').bind(c.slug, email).first();
    const x = (fila && parsear(fila.datos)) || { email, nombre: nombre || '', primera: ahora(), veces: 0 };
    if (nombre) x.nombre = nombre;
    x.ultima = ahora();
    x.veces = (x.veces || 0) + 1;
    x.via = via;
    await c.db.prepare('INSERT OR REPLACE INTO visitantes (parroquia, email, ultima, datos) VALUES (?, ?, ?, ?)')
      .bind(c.slug, email, x.ultima, JSON.stringify(x)).run();
  } catch (err) {
    console.warn('No se pudo anotar el visitante: ' + err);
  }
}

// Comprueba con Google el «ID token» que entrega el botón «Entrar con Google»
export async function verificarGoogle(c, credencial) {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new ErrorApi('Falta configurar el ID de cliente de Google en el servidor.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(credencial || '')));
  if (r.status !== 200) throw new ErrorApi('Google no confirmó tu cuenta. Probá de nuevo.');
  const info = await r.json();
  if (info.aud !== clientId) throw new ErrorApi('La cuenta de Google no es para este sitio.');
  if (String(info.email_verified) !== 'true') throw new ErrorApi('Tu correo de Google no está verificado.');
  if (Number(info.exp) * 1000 < Date.now()) throw new ErrorApi('El ingreso con Google venció. Probá de nuevo.');
  return { email: normEmail(info.email), nombre: info.name || '', foto: info.picture || '' };
}

async function entrarGoogle(c, d) {
  const g = await verificarGoogle(c, d.credential);
  let x = await buscarUsuario(c, g.email);
  if (!x) x = { id: 'u-' + Date.now(), email: g.email, rol: 'visitante', comunidad: '', activo: true, creado: ahora(), parroquia: c.slug };
  if (g.nombre && (!x.nombre || x.nombre === x.email)) x.nombre = g.nombre;
  if (g.foto) x.foto = g.foto;
  x.verificado = true;
  x.ultimaEntrada = ahora();
  await guardarUsuario(c, x);
  if (x.activo === false) throw new ErrorApi('Esta cuenta no tiene acceso a esta parroquia. Contactá a sus responsables.');
  if (!ROLES[x.rol]) await registrarVisitante(c, x.email, x.nombre || g.nombre, 'google');
  await auditar(c, { tipo: 'entrada', email: x.email, nombre: x.nombre, rol: x.rol, comunidad: x.comunidad });
  return { token: await crearToken(c, x), sesion: sesionPublica(x) };
}

// Solo correo, sin verificar: queda anotado como visitante y nunca recibe privilegios ni token
async function entrarVisitante(c, d) {
  const email = normEmail(d.email);
  if (!emailValido(email)) throw new ErrorApi('Escribí un correo electrónico válido.');
  const nombre = String(d.nombre || '').trim().slice(0, 80);
  let x = await buscarUsuario(c, email);
  const conPermisos = !!(x && ROLES[x.rol]);
  if (x) {
    if (!x.verificado && nombre) x.nombre = nombre;
  } else {
    x = { id: 'u-' + Date.now(), email, nombre: nombre || email, rol: 'visitante', comunidad: '', activo: true, creado: ahora() };
  }
  await guardarUsuario(c, x);
  if (!conPermisos) await registrarVisitante(c, email, nombre, 'correo');
  await auditar(c, { tipo: 'entrada_visitante', email, nombre });
  return {
    sesion: { email, nombre: nombre || email, rol: 'visitante', comunidad: '', activo: true, parroquia: c.slug },
    aviso: conPermisos ? 'Esta cuenta tiene permisos: para usarlos entrá con el botón de Google.' : ''
  };
}

async function listarUsuarios(c, d) {
  exigirResponsable(await usuarioDeToken(c, d.token));
  return {
    usuarios: (await todosLosUsuarios(c)).map((u) => ({
      ...sesionPublica(u), verificado: !!u.verificado, invitado: !!u.invitado, ultimaEntrada: u.ultimaEntrada || '', creado: u.creado || ''
    }))
  };
}

// Crea o actualiza la persona y le asigna rol y comunidad (rol 'visitante' = sin privilegios)
async function aplicarRol(c, yo, d) {
  const email = normEmail(d.email);
  if (!emailValido(email)) throw new ErrorApi('Escribí un correo electrónico válido.');
  if (esAdminGeneral(c, email)) throw new ErrorApi('El administrador general no se puede modificar.');
  const rol = ROLES[d.rol] && d.rol !== 'admin_general' ? d.rol : 'visitante';
  if (rol === 'admin_segundo' && yo.rol !== 'admin_general') throw new ErrorApi('Solo el administrador general puede nombrar responsables de la parroquia.');
  let comunidad = String(d.comunidad || '');
  if (!comunidadValida(c, comunidad)) comunidad = '';
  if (rol !== 'visitante' && !comunidad) comunidad = 'parroquia';
  let x = await buscarUsuario(c, email);
  if (!x) {
    x = { id: 'u-' + Date.now(), email, nombre: String(d.nombre || '').trim() || email, creado: ahora() };
  } else if (x.rol === 'admin_segundo' && yo.rol !== 'admin_general') {
    throw new ErrorApi('Solo el administrador general puede cambiar a un responsable de la parroquia.');
  }
  if (d.nombre && !x.verificado) x.nombre = String(d.nombre).trim();
  x.rol = rol;
  x.comunidad = comunidad;
  x.activo = true;
  x.modificadoPor = yo.email;
  await guardarUsuario(c, x);
  return x;
}

async function asignarRol(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const x = await aplicarRol(c, yo, d);
  await auditar(c, { tipo: 'permisos', email: x.email, nombre: x.nombre, rol: x.rol, comunidad: x.comunidad, por: yo.email });
  return { usuario: sesionPublica(x) };
}

function textoInvitacion(c, yo, x) {
  const parroquia = (c.parroquia && c.parroquia.nombre) || 'la parroquia';
  return 'Hola' + (x.nombre && x.nombre !== x.email ? ' ' + x.nombre : '') + ', ' + (yo.nombre || parroquia) +
    ' te invita a ser ' + (ROLES[x.rol] || 'parte') + ' (' + (nombreComunidad(c, x.comunidad) || parroquia) +
    ') en el Cancionero Litúrgico de la ' + parroquia + '.\n\n' +
    'Para entrar abrí ' + urlParroquia(c) + 'login y tocá «Entrar con Google» con la cuenta ' + x.email + '. No necesitás clave.';
}

// Sin correo: la invitación se manda por WhatsApp o copiando el texto (panel de Identificarse)
async function invitar(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  if (!ROLES[d.rol]) throw new ErrorApi('Elegí qué privilegios tendrá.');
  const x = await aplicarRol(c, yo, d);
  x.invitado = true;
  x.invitadoPor = yo.email;
  await guardarUsuario(c, x);
  await auditar(c, { tipo: 'invitacion', email: x.email, nombre: x.nombre, rol: x.rol, comunidad: x.comunidad, por: yo.email });
  return { usuario: sesionPublica(x), texto: textoInvitacion(c, yo, x), correoEnviado: false };
}

async function eliminarUsuario(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const email = normEmail(d.email);
  if (esAdminGeneral(c, email)) throw new ErrorApi('El administrador general no se puede quitar.');
  const x = await buscarUsuario(c, email);
  if (x) {
    if (x.rol === 'admin_segundo' && yo.rol !== 'admin_general') throw new ErrorApi('Solo el administrador general puede quitar a un responsable de la parroquia.');
    // Deja de ser miembro de esta parroquia; la cuenta y sus roles en otras parroquias quedan
    await c.db.prepare('DELETE FROM miembros WHERE parroquia = ? AND email = ?').bind(c.slug, email).run();
  }
  await auditar(c, { tipo: 'quitado', email, por: yo.email });
  return {};
}

async function auditoria(c, d) {
  exigirResponsable(await usuarioDeToken(c, d.token));
  const limite = Math.max(1, Math.min(1000, Number(d.limite) || 50));
  const { results } = await c.db.prepare('SELECT datos FROM auditoria WHERE parroquia = ? ORDER BY n DESC LIMIT ?').bind(c.slug, limite).all();
  return { auditoria: results.map((r) => parsear(r.datos)).filter(Boolean) };
}

// entrada: primera vez en esta parroquia con la cuenta abierta en otra; sin rol acá, queda como invitado
async function sesion(c, d) {
  const u = await usuarioDeToken(c, d.token);
  if (d.entrada === true && !ROLES[u.rol]) await registrarVisitante(c, u.email, u.nombre, 'google');
  return { sesion: sesionPublica(u) };
}

export const accionesAuth = {
  entrarGoogle, entrarVisitante, sesion, listarUsuarios, asignarRol, invitar, eliminarUsuario, auditoria
};
