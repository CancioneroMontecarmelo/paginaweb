/**
 * Monte Carmelo — API en Google Apps Script (cuenta cancionerolitugico@gmail.com).
 *
 * Implementar como «Aplicación web»: Ejecutar como = Yo · Quién tiene acceso = Cualquier usuario.
 * El sitio (GitHub Pages) envía POST con cuerpo JSON en text/plain (sin preflight CORS).
 *
 * Drive:
 *   MonteCarmelo/
 *     sistema/usuarios.json · solicitudes.json · auditoria.json   (privados)
 *     indice.json                                                (lista pública de cancioneros)
 *     Cancioneros/<comunidad>/<fecha>_<slug>/
 *        cancionero.m3u8 · canciones/*.md · audios/* · <slug>.html
 */

var SALT = 'montecarmelo-v1';
var CORREO_PARROQUIA = 'cancionerolitugico@gmail.com';
var RAIZ_NOMBRE = 'MonteCarmelo';
var TOKEN_HORAS = 12;
var MAX_ARCHIVO_BYTES = 30 * 1024 * 1024;

var COMUNIDADES = {
  'maria-de-nazaret': 'Capilla María de Nazaret',
  'san-pablo-apostol': 'San Pablo Apóstol',
  'sagrada-familia': 'Sagrada Familia',
  'monte-carmelo': 'Nuestra Señora del Monte Carmelo'
};

var ADMIN_SEMILLA = {
  id: 'u-marcos',
  usuario: 'marcos.mora',
  nombres: 'Marcos',
  apellidos: 'Mora Vitta',
  nombre: 'Marcos Mora Vitta',
  email: CORREO_PARROQUIA,
  rol: 'admin_general',
  comunidad: 'parroquia',
  hash: 'b35c972e25b1cb54b3ce4e281f7356d6f9b65da4a1f975b8d8ad041dc1774c3d',
  activo: true,
  debeCambiarClave: false
};

// ==================== ENTRADA ====================

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.accion === 'listar') return json_(listar_(p));
    if (p.accion === 'ver') return verHtml_(p.id);
    if (p.accion === 'estadoCorreo') return json_({ ok: true, cuotaCorreo: MailApp.getRemainingDailyQuota() });
    return json_({ ok: true, app: 'MonteCarmelo', version: 1 });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  var datos;
  try {
    datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (_) {
    return json_({ ok: false, error: 'Solicitud inválida' });
  }
  try {
    var fn = ACCIONES[datos.accion];
    if (!fn) throw new Error('Acción desconocida: ' + datos.accion);
    var r = fn(datos) || {};
    r.ok = true;
    return json_(r);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

var ACCIONES = {
  login: login_,
  sesion: function (d) { return { sesion: sesionPublica_(usuarioDeToken_(d.token)) }; },
  cambiarClave: cambiarClave_,
  recuperarClave: recuperarClave_,
  crearUsuario: crearUsuario_,
  solicitarAcceso: solicitarAcceso_,
  listarSolicitudes: listarSolicitudes_,
  aceptarSolicitud: aceptarSolicitud_,
  rechazarSolicitud: rechazarSolicitud_,
  listarUsuarios: listarUsuarios_,
  darDeBaja: darDeBaja_,
  nombrarSegundo: nombrarSegundo_,
  auditoria: auditoria_,
  iniciarCancionero: iniciarCancionero_,
  subirArchivo: subirArchivo_,
  cerrarCancionero: cerrarCancionero_,
  abrir: abrir_,
  archivo: archivo_,
  borrarCancionero: borrarCancionero_,
  listar: listar_
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ==================== UTILIDADES ====================

function hex_(bytes) {
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, '0$1'); }).join('');
}

function hashClave_(clave) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, SALT + String(clave || ''), Utilities.Charset.UTF_8));
}

function normEmail_(s) {
  return String(s || '').trim().toLowerCase();
}

function slug_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cancionero';
}

function ahora_() {
  return new Date().toISOString();
}

function secreto_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SECRETO');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SECRETO', s);
  }
  return s;
}

function b64url_(texto) {
  return Utilities.base64EncodeWebSafe(texto, Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function firmar_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secreto_())).replace(/=+$/, '');
}

function crearToken_(u) {
  var payload = b64url_(JSON.stringify({ email: u.email, exp: Date.now() + TOKEN_HORAS * 3600 * 1000 }));
  return payload + '.' + firmar_(payload);
}

function usuarioDeToken_(token) {
  var partes = String(token || '').split('.');
  if (partes.length !== 2 || firmar_(partes[0]) !== partes[1]) throw new Error('Sesión inválida. Volvé a identificarte.');
  var datos = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString('UTF-8'));
  if (!datos.exp || datos.exp < Date.now()) throw new Error('La sesión venció. Volvé a identificarte.');
  var u = buscarUsuario_(datos.email);
  if (!u || u.activo === false) throw new Error('Cuenta inexistente o dada de baja.');
  return u;
}

function sesionPublica_(u) {
  return {
    id: u.id, usuario: u.usuario, email: u.email, nombres: u.nombres || '', apellidos: u.apellidos || '',
    nombre: u.nombre || [u.nombres, u.apellidos].filter(String).join(' '),
    rol: u.rol, comunidad: u.comunidad, debeCambiarClave: !!u.debeCambiarClave, activo: true
  };
}

function esResponsable_(u) {
  return u.rol === 'admin_general' || u.rol === 'admin_segundo';
}

function puedeEditar_(u, comunidad) {
  if (!u || u.activo === false) return false;
  if (esResponsable_(u) || u.rol === 'sacerdote' || u.comunidad === 'parroquia') return true;
  return u.comunidad === comunidad;
}

function exigirResponsable_(u) {
  if (!esResponsable_(u)) throw new Error('Solo el administrador general o el segundo responsable pueden hacer esto.');
}

// ==================== CARPETAS Y JSON EN DRIVE ====================

function raiz_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('RAIZ_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (_) {}
  }
  var it = DriveApp.getRootFolder().getFoldersByName(RAIZ_NOMBRE);
  var f = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(RAIZ_NOMBRE);
  props.setProperty('RAIZ_ID', f.getId());
  return f;
}

function subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

function carpetaRuta_(padre, partes) {
  var f = padre;
  for (var i = 0; i < partes.length; i++) f = subcarpeta_(f, partes[i]);
  return f;
}

function archivoEn_(carpeta, nombre) {
  var it = carpeta.getFilesByName(nombre);
  return it.hasNext() ? it.next() : null;
}

function leerJson_(carpeta, nombre, defecto) {
  var f = archivoEn_(carpeta, nombre);
  if (!f) return defecto;
  try { return JSON.parse(f.getBlob().getDataAsString('UTF-8')); } catch (_) { return defecto; }
}

function escribirJson_(carpeta, nombre, obj) {
  var texto = JSON.stringify(obj, null, 2);
  var f = archivoEn_(carpeta, nombre);
  if (f) f.setContent(texto);
  else carpeta.createFile(nombre, texto, 'application/json');
}

function sistema_() {
  return subcarpeta_(raiz_(), 'sistema');
}

function conCandado_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ==================== USUARIOS ====================

function leerUsuarios_() {
  var lista = leerJson_(sistema_(), 'usuarios.json', null);
  if (!lista) {
    lista = [ADMIN_SEMILLA];
    escribirJson_(sistema_(), 'usuarios.json', lista);
  }
  return lista;
}

function guardarUsuarios_(lista) {
  escribirJson_(sistema_(), 'usuarios.json', lista);
}

function buscarUsuario_(email) {
  var e = normEmail_(email);
  var lista = leerUsuarios_();
  for (var i = 0; i < lista.length; i++) if (normEmail_(lista[i].email) === e) return lista[i];
  return null;
}

function auditar_(evento) {
  conCandado_(function () {
    var log = leerJson_(sistema_(), 'auditoria.json', []);
    evento.id = 'a-' + Date.now();
    evento.cuando = ahora_();
    log.unshift(evento);
    escribirJson_(sistema_(), 'auditoria.json', log.slice(0, 1000));
  });
}

// Clave temporal pedida con «¿Primera vez u olvidaste tu clave?»: sirve 2 horas y no reemplaza a la
// clave actual (así nadie puede dejar a otro sin acceso pidiendo recuperaciones).
function usaRecuperacion_(u, hash) {
  return !!u.hashRecuperacion && u.recuperacionVence > Date.now() && u.hashRecuperacion === String(hash || '');
}

function login_(d) {
  var u = buscarUsuario_(d.email);
  var temporal = !!u && u.hash !== String(d.hash || '') && usaRecuperacion_(u, d.hash);
  if (!u || (u.hash !== String(d.hash || '') && !temporal)) {
    auditar_({ tipo: 'login_fallido', email: normEmail_(d.email), nombres: d.nombres || '', apellidos: d.apellidos || '' });
    throw new Error('Datos incorrectos. Revisá correo y clave.');
  }
  if (u.activo === false) {
    auditar_({ tipo: 'login_baja', email: u.email, nombre: u.nombre });
    throw new Error('Esta cuenta está dada de baja. Contactá a la parroquia.');
  }
  auditar_({ tipo: temporal ? 'entrada_clave_temporal' : 'entrada', email: u.email, nombre: u.nombre, rol: u.rol, comunidad: u.comunidad });
  var sesion = sesionPublica_(u);
  if (temporal) sesion.debeCambiarClave = true;
  return { token: crearToken_(u), sesion: sesion };
}

function cambiarClave_(d) {
  var u = usuarioDeToken_(d.token);
  if (!/^[0-9a-f]{64}$/.test(String(d.hashNuevo || ''))) throw new Error('Clave nueva inválida');
  return conCandado_(function () {
    var lista = leerUsuarios_();
    var x = lista.filter(function (v) { return normEmail_(v.email) === normEmail_(u.email); })[0];
    if (x.hash !== d.hashActual && !usaRecuperacion_(x, d.hashActual)) throw new Error('Clave actual o temporal incorrecta');
    x.hash = d.hashNuevo;
    x.debeCambiarClave = false;
    delete x.hashRecuperacion;
    delete x.recuperacionVence;
    guardarUsuarios_(lista);
    auditar_({ tipo: 'cambio_clave', email: x.email, nombre: x.nombre });
    return { sesion: sesionPublica_(x) };
  });
}

function listarUsuarios_(d) {
  exigirResponsable_(usuarioDeToken_(d.token));
  return {
    usuarios: leerUsuarios_().map(function (u) {
      var s = sesionPublica_(u);
      s.activo = u.activo !== false;
      s.creado = u.creado || '';
      return s;
    })
  };
}

function darDeBaja_(d) {
  var yo = usuarioDeToken_(d.token);
  var email = normEmail_(d.email);
  var propio = email === normEmail_(yo.email);
  if (!propio && !esResponsable_(yo) && yo.rol !== 'admin' && yo.rol !== 'sacerdote') throw new Error('Sin permiso para dar de baja');
  if (email === normEmail_(ADMIN_SEMILLA.email) && !propio) throw new Error('No se puede dar de baja al administrador general');
  return conCandado_(function () {
    var lista = leerUsuarios_();
    var u = lista.filter(function (v) { return normEmail_(v.email) === email; })[0];
    if (!u) throw new Error('Usuario no encontrado');
    u.activo = false;
    u.baja = ahora_();
    u.motivoBaja = String(d.motivo || '');
    u.bajaPor = yo.email;
    guardarUsuarios_(lista);
    auditar_({ tipo: 'baja', email: u.email, nombre: u.nombre, por: yo.email, motivo: u.motivoBaja });
    correo_(u.email, 'Baja en el sitio Monte Carmelo',
      'Hola ' + u.nombre + ',\n\nTu cuenta en el sitio de la Parroquia Nuestra Señora del Monte Carmelo fue dada de baja.\nMotivo: ' +
      (u.motivoBaja || '—') + '\n\nSi creés que es un error, escribí a ' + CORREO_PARROQUIA + '.');
    return { usuario: sesionPublica_(u) };
  });
}

function nombrarSegundo_(d) {
  var yo = usuarioDeToken_(d.token);
  if (yo.rol !== 'admin_general') throw new Error('Solo el administrador general puede nombrar al segundo responsable');
  return conCandado_(function () {
    var lista = leerUsuarios_();
    var u = lista.filter(function (v) { return normEmail_(v.email) === normEmail_(d.email) && v.activo !== false; })[0];
    if (!u) throw new Error('Usuario no encontrado o inactivo');
    lista.forEach(function (v) { if (v.rol === 'admin_segundo') v.rol = 'admin'; });
    u.rol = 'admin_segundo';
    u.comunidad = u.comunidad || 'parroquia';
    guardarUsuarios_(lista);
    auditar_({ tipo: 'nombrar_segundo', email: u.email, nombre: u.nombre, por: yo.email });
    return { usuario: sesionPublica_(u) };
  });
}

function auditoria_(d) {
  exigirResponsable_(usuarioDeToken_(d.token));
  var log = leerJson_(sistema_(), 'auditoria.json', []);
  return { auditoria: log.slice(0, Number(d.limite) || 50) };
}

// ==================== SOLICITUDES ====================

function correo_(para, asunto, cuerpo) {
  try {
    MailApp.sendEmail({ to: para, subject: asunto, body: cuerpo, name: 'Parroquia Monte Carmelo' });
    return true;
  } catch (err) {
    console.warn('Correo no enviado: ' + err);
    try { auditar_({ tipo: 'correo_fallido', email: para, error: String(err.message || err) }); } catch (_) {}
    return false;
  }
}

function solicitarAcceso_(d) {
  var email = normEmail_(d.email);
  if (!email || email.indexOf('@') < 0) throw new Error('Indicá un correo electrónico válido');
  var nombres = String(d.nombres || '').trim();
  var apellidos = String(d.apellidos || '').trim();
  if (!nombres || !apellidos) throw new Error('Indicá nombres y apellidos');
  var comunidad = String(d.comunidad || '').trim();
  if (!comunidad) throw new Error('Elegí la comunidad');
  var rolPedido = d.rolPedido === 'sacerdote' ? 'sacerdote' : d.rolPedido === 'editor' ? 'editor' : 'admin';
  var previo = buscarUsuario_(email);
  if (previo && previo.activo !== false) throw new Error('Ese correo ya está registrado. Iniciá sesión.');

  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  var sol = {
    id: 'sol-' + Date.now(), nombres: nombres, apellidos: apellidos, nombre: nombres + ' ' + apellidos,
    email: email, comunidad: comunidad, rolPedido: rolPedido, motivo: String(d.motivo || '').trim(),
    codigoHash: hashClave_(codigo), estado: 'pendiente', creado: ahora_()
  };
  conCandado_(function () {
    var lista = leerJson_(sistema_(), 'solicitudes.json', []);
    lista.unshift(sol);
    escribirJson_(sistema_(), 'solicitudes.json', lista);
  });
  auditar_({ tipo: 'solicitud', email: email, nombre: sol.nombre, comunidad: comunidad, rolPedido: rolPedido });

  correo_(CORREO_PARROQUIA, 'Solicitud de acceso: ' + sol.nombre,
    'Nueva solicitud en el sitio Monte Carmelo.\n\nNombre: ' + sol.nombre + '\nCorreo: ' + email +
    '\nComunidad: ' + (COMUNIDADES[comunidad] || comunidad) + '\nRol pedido: ' + rolPedido +
    '\nMotivo: ' + (sol.motivo || '—') + '\n\nCódigo de verificación: ' + codigo +
    '\n\nAceptala desde login.html → Panel responsables.');
  correo_(email, 'Recibimos tu solicitud — Parroquia Monte Carmelo',
    'Hola ' + sol.nombre + ',\n\nRecibimos tu solicitud de acceso como ' + rolPedido +
    '. Cuando un responsable la acepte te llegará un correo con tu clave temporal.');
  return { solicitud: { id: sol.id, estado: sol.estado } };
}

function listarSolicitudes_(d) {
  exigirResponsable_(usuarioDeToken_(d.token));
  var lista = leerJson_(sistema_(), 'solicitudes.json', []);
  return {
    solicitudes: lista.map(function (s) {
      var c = {};
      for (var k in s) if (k !== 'codigoHash') c[k] = s[k];
      return c;
    })
  };
}

function claveTemporal_() {
  return 'Mc' + Math.random().toString(36).slice(2, 6) + Math.floor(1000 + Math.random() * 9000);
}

// Siempre responde lo mismo, exista o no el correo (no revela quién está registrado)
function recuperarClave_(d) {
  var email = normEmail_(d.email);
  if (!email || email.indexOf('@') < 0) throw new Error('Indicá un correo electrónico válido');
  conCandado_(function () {
    var lista = leerUsuarios_();
    var u = lista.filter(function (v) { return normEmail_(v.email) === email && v.activo !== false; })[0];
    if (!u) {
      auditar_({ tipo: 'recuperacion_desconocido', email: email });
      return;
    }
    if (u.recuperacionPedida && Date.now() - u.recuperacionPedida < 60 * 1000) return;
    var temp = claveTemporal_();
    u.hashRecuperacion = hashClave_(temp);
    u.recuperacionVence = Date.now() + 2 * 3600 * 1000;
    u.recuperacionPedida = Date.now();
    guardarUsuarios_(lista);
    auditar_({ tipo: 'recuperacion', email: u.email, nombre: u.nombre });
    correo_(u.email, 'Tu clave temporal — Parroquia Monte Carmelo',
      'Hola ' + u.nombre + ',\n\nPediste entrar al sitio de la Parroquia Nuestra Señora del Monte Carmelo.\n\n' +
      'Clave temporal: ' + temp + '\n\nSirve durante 2 horas. Entrá en Identificarse con tu correo y esta clave: ' +
      'el sitio te pedirá crear tu clave definitiva.\n\nSi no lo pediste, ignorá este correo: tu clave actual sigue funcionando.');
  });
  return {};
}

var ROLES_ASIGNABLES = ['admin', 'editor', 'sacerdote', 'colaborador'];

function crearUsuario_(d) {
  var yo = usuarioDeToken_(d.token);
  exigirResponsable_(yo);
  var email = normEmail_(d.email);
  if (!email || email.indexOf('@') < 0) throw new Error('Indicá un correo electrónico válido');
  var nombres = String(d.nombres || '').trim();
  var apellidos = String(d.apellidos || '').trim();
  if (!nombres || !apellidos) throw new Error('Indicá nombres y apellidos');
  var rol = ROLES_ASIGNABLES.indexOf(d.rol) >= 0 ? d.rol : 'editor';
  var comunidad = String(d.comunidad || '').trim();
  if (comunidad !== 'parroquia' && !COMUNIDADES[comunidad]) throw new Error('Elegí la comunidad');
  return conCandado_(function () {
    var lista = leerUsuarios_();
    var previo = lista.filter(function (u) { return normEmail_(u.email) === email; })[0];
    if (previo && previo.activo !== false) throw new Error('Ese correo ya tiene una cuenta activa');
    var temp = claveTemporal_();
    var usuario = {
      id: 'u-' + Date.now(),
      usuario: slug_(nombres + '.' + apellidos).replace(/-/g, '.'),
      nombres: nombres, apellidos: apellidos, nombre: nombres + ' ' + apellidos, email: email,
      rol: rol, comunidad: comunidad, hash: hashClave_(temp), activo: true, debeCambiarClave: true,
      creado: ahora_(), aceptadoPor: yo.email
    };
    lista = lista.filter(function (u) { return normEmail_(u.email) !== email; });
    lista.push(usuario);
    guardarUsuarios_(lista);
    auditar_({ tipo: 'alta_directa', email: email, nombre: usuario.nombre, rol: rol, comunidad: comunidad, por: yo.email });
    var enviado = correo_(email, 'Tu cuenta en el sitio — Parroquia Monte Carmelo',
      'Hola ' + usuario.nombre + ',\n\n' + yo.nombre + ' te creó una cuenta en el sitio de la Parroquia Nuestra Señora del Monte Carmelo como ' +
      rol + ' (' + (COMUNIDADES[comunidad] || 'Parroquia') + ').\n\nCorreo: ' + email + '\nClave temporal: ' + temp +
      '\n\nAl entrar por primera vez en Identificarse el sitio te pedirá crear tu clave definitiva.');
    return { usuario: sesionPublica_(usuario), claveTemporal: temp, correoEnviado: enviado };
  });
}

function aceptarSolicitud_(d) {
  var yo = usuarioDeToken_(d.token);
  exigirResponsable_(yo);
  return conCandado_(function () {
    var sols = leerJson_(sistema_(), 'solicitudes.json', []);
    var sol = sols.filter(function (s) { return s.id === d.id; })[0];
    if (!sol || sol.estado !== 'pendiente') throw new Error('Solicitud no encontrada o ya resuelta');
    if (hashClave_(String(d.codigo || '').trim()) !== sol.codigoHash) throw new Error('Código de verificación incorrecto');

    var temp = claveTemporal_();
    var rol = d.rol || sol.rolPedido;
    var usuarios = leerUsuarios_().filter(function (u) { return normEmail_(u.email) !== sol.email; });
    var usuario = {
      id: 'u-' + Date.now(),
      usuario: slug_(sol.nombres + '.' + sol.apellidos).replace(/-/g, '.'),
      nombres: sol.nombres, apellidos: sol.apellidos, nombre: sol.nombre, email: sol.email,
      rol: rol, comunidad: sol.comunidad, hash: hashClave_(temp), activo: true, debeCambiarClave: true,
      creado: ahora_(), aceptadoPor: yo.email
    };
    usuarios.push(usuario);
    guardarUsuarios_(usuarios);

    sol.estado = 'aceptada';
    sol.resuelto = ahora_();
    sol.resueltoPor = yo.email;
    escribirJson_(sistema_(), 'solicitudes.json', sols);
    auditar_({ tipo: 'aceptacion', email: usuario.email, nombre: usuario.nombre, rol: rol, comunidad: usuario.comunidad, por: yo.email });

    var enviado = correo_(usuario.email, 'Acceso aceptado — Parroquia Monte Carmelo',
      'Hola ' + usuario.nombre + ',\n\nTu acceso fue aceptado como ' + rol + ' (' + (COMUNIDADES[usuario.comunidad] || usuario.comunidad) +
      ').\n\nClave temporal: ' + temp + '\n\nAl entrar por primera vez el sitio te pedirá crear tu clave definitiva.');
    return { usuario: sesionPublica_(usuario), claveTemporal: temp, correoEnviado: enviado };
  });
}

function rechazarSolicitud_(d) {
  var yo = usuarioDeToken_(d.token);
  exigirResponsable_(yo);
  return conCandado_(function () {
    var sols = leerJson_(sistema_(), 'solicitudes.json', []);
    var sol = sols.filter(function (s) { return s.id === d.id; })[0];
    if (!sol || sol.estado !== 'pendiente') throw new Error('Solicitud no encontrada');
    sol.estado = 'rechazada';
    sol.motivoRechazo = String(d.motivo || '');
    sol.resuelto = ahora_();
    sol.resueltoPor = yo.email;
    escribirJson_(sistema_(), 'solicitudes.json', sols);
    auditar_({ tipo: 'rechazo', email: sol.email, nombre: sol.nombre, por: yo.email });
    return {};
  });
}

// ==================== CANCIONEROS ====================

function carpetaCancionero_(id) {
  var f = DriveApp.getFolderById(id);
  var indice = leerIndice_();
  var e = indice.cancioneros.filter(function (c) { return c.folderId === id; })[0];
  var pendientes = PropertiesService.getScriptProperties().getProperty('pendiente:' + id);
  if (!e && !pendientes) throw new Error('Ese cancionero no pertenece al sitio');
  return { carpeta: f, entrada: e || JSON.parse(pendientes) };
}

function leerIndice_() {
  var data = leerJson_(raiz_(), 'indice.json', null);
  if (!data || !data.cancioneros) data = { v: 1, cancioneros: [] };
  return data;
}

function listarArchivos_(carpeta, prefijo, out) {
  var files = carpeta.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    out.push({ id: f.getId(), ruta: prefijo + f.getName(), mime: f.getMimeType(), size: f.getSize() });
  }
  var subs = carpeta.getFolders();
  while (subs.hasNext()) {
    var s = subs.next();
    listarArchivos_(s, prefijo + s.getName() + '/', out);
  }
  return out;
}

function iniciarCancionero_(d) {
  var u = usuarioDeToken_(d.token);
  var comunidad = String(d.comunidad || '');
  if (!COMUNIDADES[comunidad]) throw new Error('Comunidad desconocida');
  if (!puedeEditar_(u, comunidad)) throw new Error('No tenés permiso para guardar cancioneros de ' + COMUNIDADES[comunidad]);
  var titulo = String(d.titulo || '').trim() || 'Cancionero';
  var fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || '')) ? d.fecha : ahora_().slice(0, 10);

  var carpeta, existentes = [];
  if (d.folderId) {
    var c = carpetaCancionero_(d.folderId);
    if (!puedeEditar_(u, c.entrada.comunidad)) throw new Error('No tenés permiso para modificar este cancionero');
    carpeta = c.carpeta;
    existentes = listarArchivos_(carpeta, '', []);
  } else {
    var base = carpetaRuta_(raiz_(), ['Cancioneros', COMUNIDADES[comunidad]]);
    var nombre = fecha + '_' + slug_(titulo), n = 2, finalNombre = nombre;
    while (base.getFoldersByName(finalNombre).hasNext()) finalNombre = nombre + '-' + (n++);
    carpeta = base.createFolder(finalNombre);
  }
  PropertiesService.getScriptProperties().setProperty('pendiente:' + carpeta.getId(),
    JSON.stringify({ comunidad: comunidad, titulo: titulo, fecha: fecha, autor: u.email }));
  return { folderId: carpeta.getId(), existentes: existentes };
}

function subirArchivo_(d) {
  var u = usuarioDeToken_(d.token);
  var c = carpetaCancionero_(d.folderId);
  if (!puedeEditar_(u, c.entrada.comunidad)) throw new Error('Sin permiso');
  var partes = String(d.ruta || '').split('/').filter(function (p) { return p && p !== '.' && p !== '..'; });
  if (!partes.length) throw new Error('Ruta vacía');
  var bytes = Utilities.base64Decode(String(d.base64 || ''));
  if (bytes.length > MAX_ARCHIVO_BYTES) throw new Error('El archivo ' + partes[partes.length - 1] + ' supera los 30 MB');
  var nombre = partes.pop();
  var destino = carpetaRuta_(c.carpeta, partes);
  var previo = destino.getFilesByName(nombre);
  while (previo.hasNext()) previo.next().setTrashed(true);
  var f = destino.createFile(Utilities.newBlob(bytes, d.mime || 'application/octet-stream', nombre));
  return { fileId: f.getId(), size: f.getSize() };
}

function cerrarCancionero_(d) {
  var u = usuarioDeToken_(d.token);
  var c = carpetaCancionero_(d.folderId);
  if (!puedeEditar_(u, c.entrada.comunidad)) throw new Error('Sin permiso');
  var carpeta = c.carpeta;
  var meta = JSON.parse(PropertiesService.getScriptProperties().getProperty('pendiente:' + d.folderId) || 'null') || c.entrada;

  if (Array.isArray(d.conservar)) {
    var keep = {};
    d.conservar.forEach(function (r) { keep[r] = true; });
    listarArchivos_(carpeta, '', []).forEach(function (f) {
      if (!keep[f.ruta]) DriveApp.getFileById(f.id).setTrashed(true);
    });
  }

  var htmlId = '';
  if (d.htmlRuta) {
    var archivos = listarArchivos_(carpeta, '', []).filter(function (f) { return f.ruta === d.htmlRuta; });
    if (archivos.length) {
      htmlId = archivos[0].id;
      DriveApp.getFileById(htmlId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
  }

  var entrada = conCandado_(function () {
    var indice = leerIndice_();
    var previa = indice.cancioneros.filter(function (x) { return x.folderId === d.folderId; })[0] || {};
    var e = {
      folderId: d.folderId,
      htmlId: htmlId || previa.htmlId || '',
      titulo: meta.titulo,
      comunidad: meta.comunidad,
      comunidadNombre: COMUNIDADES[meta.comunidad],
      fecha: meta.fecha,
      canciones: Number(d.canciones) || 0,
      audios: Number(d.audios) || 0,
      comentario: String(d.comentario || previa.comentario || ''),
      autor: previa.autor || u.email,
      autorNombre: previa.autorNombre || u.nombre,
      creado: previa.creado || ahora_(),
      actualizado: ahora_()
    };
    indice.cancioneros = indice.cancioneros.filter(function (x) { return x.folderId !== d.folderId; });
    indice.cancioneros.unshift(e);
    indice.actualizado = ahora_();
    escribirJson_(raiz_(), 'indice.json', indice);
    return e;
  });
  PropertiesService.getScriptProperties().deleteProperty('pendiente:' + d.folderId);
  auditar_({ tipo: 'cancionero_guardado', email: u.email, nombre: u.nombre, titulo: entrada.titulo, comunidad: entrada.comunidad });
  return { cancionero: entrada };
}

function listar_(d) {
  var indice = leerIndice_();
  var lista = indice.cancioneros;
  if (d && d.comunidad) lista = lista.filter(function (c) { return c.comunidad === d.comunidad; });
  lista = lista.slice().sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
  return { ok: true, cancioneros: lista };
}

function abrir_(d) {
  usuarioDeToken_(d.token);
  var c = carpetaCancionero_(d.folderId);
  return { cancionero: c.entrada, archivos: listarArchivos_(c.carpeta, '', []) };
}

function dentroDeCancioneros_(f) {
  var base = carpetaRuta_(raiz_(), ['Cancioneros']).getId();
  var padres = f.getParents();
  for (var n = 0; padres.hasNext() && n < 8; n++) {
    var p = padres.next();
    if (p.getId() === base) return true;
    padres = p.getParents();
  }
  return false;
}

function archivo_(d) {
  usuarioDeToken_(d.token);
  var f = DriveApp.getFileById(d.id);
  if (!dentroDeCancioneros_(f)) throw new Error('Ese archivo no pertenece a un cancionero');
  return { base64: Utilities.base64Encode(f.getBlob().getBytes()), mime: f.getMimeType(), nombre: f.getName() };
}

function verHtml_(id) {
  var indice = leerIndice_();
  var e = indice.cancioneros.filter(function (c) { return c.htmlId === id; })[0];
  if (!e) return ContentService.createTextOutput('Cancionero no encontrado').setMimeType(ContentService.MimeType.TEXT);
  var texto = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
  return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.TEXT);
}

function borrarCancionero_(d) {
  var u = usuarioDeToken_(d.token);
  var c = carpetaCancionero_(d.folderId);
  if (!esResponsable_(u) && !(u.rol === 'admin' && puedeEditar_(u, c.entrada.comunidad))) throw new Error('Sin permiso para borrar');
  c.carpeta.setTrashed(true);
  conCandado_(function () {
    var indice = leerIndice_();
    indice.cancioneros = indice.cancioneros.filter(function (x) { return x.folderId !== d.folderId; });
    escribirJson_(raiz_(), 'indice.json', indice);
  });
  auditar_({ tipo: 'cancionero_borrado', email: u.email, nombre: u.nombre, titulo: c.entrada.titulo });
  return {};
}

/** Ejecutar una vez a mano desde el editor de Apps Script para autorizar Drive y correo. */
function prepararPrimeraVez() {
  raiz_();
  sistema_();
  leerUsuarios_();
  secreto_();
  console.log('Listo. Carpeta raíz: ' + raiz_().getUrl());
}

// Ejecutar desde el editor de Apps Script si el correo de «¿Primera vez…?» no llega: la clave temporal
// aparece en el registro de ejecución (solo lo ve el dueño del script) y sirve 2 horas.
function claveTemporalAdmin() {
  var temp = claveTemporal_();
  conCandado_(function () {
    var lista = leerUsuarios_();
    var u = lista.filter(function (v) { return normEmail_(v.email) === normEmail_(CORREO_PARROQUIA); })[0];
    if (!u) { u = JSON.parse(JSON.stringify(ADMIN_SEMILLA)); lista.push(u); }
    u.activo = true;
    u.hashRecuperacion = hashClave_(temp);
    u.recuperacionVence = Date.now() + 2 * 3600 * 1000;
    guardarUsuarios_(lista);
  });
  auditar_({ tipo: 'recuperacion_editor', email: CORREO_PARROQUIA });
  console.log('Clave temporal para ' + CORREO_PARROQUIA + ': ' + temp + '  (sirve 2 horas)');
  try {
    console.log('Correos disponibles hoy: ' + MailApp.getRemainingDailyQuota());
    MailApp.sendEmail(CORREO_PARROQUIA, 'Prueba de correo — Monte Carmelo', 'Si ves este correo, el envío funciona.');
    console.log('Correo de prueba enviado a ' + CORREO_PARROQUIA);
  } catch (err) {
    console.log('El envío de correo falla: ' + err);
  }
}
