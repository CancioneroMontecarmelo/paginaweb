/**
 * Monte Carmelo — API en Google Apps Script (cuenta cancionerolitugico@gmail.com).
 *
 * Implementar como «Aplicación web»: Ejecutar como = Yo · Quién tiene acceso = Cualquier usuario.
 * El sitio (GitHub Pages) envía POST con cuerpo JSON en text/plain (sin preflight CORS).
 * Sin claves: se entra con «Entrar con Google» (el servidor verifica la cuenta con Google) o, como
 * visitante, escribiendo solo el correo. Los privilegios los asignan los responsables desde el panel.
 *
 * Drive:
 *   MonteCarmelo/
 *     sistema/usuarios.json · auditoria.json                     (privados)
 *     indice.json                                                (lista pública de cancioneros)
 *     Cancioneros/<comunidad>/<fecha>_<slug>/
 *        cancionero.m3u8 · canciones/*.md · audios/* · <slug>.html
 */

var CORREO_PARROQUIA = 'cancionerolitugico@gmail.com';
var RAIZ_NOMBRE = 'MonteCarmelo';
var TOKEN_HORAS = 12;
var MAX_ARCHIVO_BYTES = 30 * 1024 * 1024;
var SITIO_URL = 'https://cancioneromontecarmelo.github.io/paginaweb/';
// «ID de cliente» OAuth (Google Cloud → Credenciales). Es público: el mismo va en js/config.js.
var GOOGLE_CLIENT_ID = '446127505219-pei616euh78muqr6ak500br0ac41t2mk.apps.googleusercontent.com';

var COMUNIDADES = {
  'maria-de-nazaret': 'Capilla María de Nazaret',
  'san-pablo-apostol': 'San Pablo Apóstol',
  'sagrada-familia': 'Sagrada Familia',
  'monte-carmelo': 'Nuestra Señora del Monte Carmelo'
};

// Roles con privilegios. Cualquier otra cuenta es «visitante».
var ROLES = {
  admin_general: 'Administrador general',
  admin_segundo: 'Responsable del sitio',
  sacerdote: 'Sacerdote',
  admin: 'Administrador de comunidad',
  editor: 'Editor',
  colaborador: 'Colaborador'
};

var ADMIN_SEMILLA = {
  id: 'u-marcos',
  nombre: 'Marcos Mora Vitta',
  email: CORREO_PARROQUIA,
  rol: 'admin_general',
  comunidad: 'parroquia',
  activo: true
};

// ==================== ENTRADA ====================

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.accion === 'listar') return json_(listar_(p));
    if (p.accion === 'ver') return verHtml_(p.id);
    return json_({ ok: true, app: 'MonteCarmelo', version: 2 });
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
  entrarGoogle: entrarGoogle_,
  entrarVisitante: entrarVisitante_,
  sesion: function (d) { return { sesion: sesionPublica_(usuarioDeToken_(d.token)) }; },
  listarUsuarios: listarUsuarios_,
  asignarRol: asignarRol_,
  invitar: invitar_,
  eliminarUsuario: eliminarUsuario_,
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

function normEmail_(s) {
  return String(s || '').trim().toLowerCase();
}

function emailValido_(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
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
  if (!u || u.activo === false) throw new Error('Cuenta inexistente o sin acceso.');
  return u;
}

function sesionPublica_(u) {
  return {
    id: u.id, email: u.email, nombre: u.nombre || u.email, foto: u.foto || '',
    rol: ROLES[u.rol] ? u.rol : 'visitante', comunidad: u.comunidad || '', activo: u.activo !== false
  };
}

function esResponsable_(u) {
  return u.rol === 'admin_general' || u.rol === 'admin_segundo';
}

function puedeEditar_(u, comunidad) {
  if (!u || u.activo === false || !ROLES[u.rol]) return false;
  if (esResponsable_(u) || u.rol === 'sacerdote' || u.comunidad === 'parroquia') return true;
  return u.comunidad === comunidad;
}

function exigirResponsable_(u) {
  if (!esResponsable_(u)) throw new Error('Solo el administrador general o un responsable del sitio pueden hacer esto.');
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

// Comprueba con Google el «ID token» que entrega el botón «Entrar con Google»
function verificarGoogle_(credencial) {
  if (!GOOGLE_CLIENT_ID) throw new Error('Falta configurar el ID de cliente de Google en el servidor.');
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(credencial || '')),
    { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Google no confirmó tu cuenta. Probá de nuevo.');
  var info = JSON.parse(r.getContentText());
  if (info.aud !== GOOGLE_CLIENT_ID) throw new Error('La cuenta de Google no es para este sitio.');
  if (String(info.email_verified) !== 'true') throw new Error('Tu correo de Google no está verificado.');
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('El ingreso con Google venció. Probá de nuevo.');
  return { email: normEmail_(info.email), nombre: info.name || '', foto: info.picture || '' };
}

function entrarGoogle_(d) {
  var g = verificarGoogle_(d.credential);
  var u = conCandado_(function () {
    var lista = leerUsuarios_();
    var x = lista.filter(function (v) { return normEmail_(v.email) === g.email; })[0];
    if (!x) {
      x = { id: 'u-' + Date.now(), email: g.email, rol: 'visitante', comunidad: '', activo: true, creado: ahora_() };
      lista.push(x);
    }
    if (g.email === normEmail_(CORREO_PARROQUIA)) {
      x.rol = 'admin_general';
      x.comunidad = 'parroquia';
      x.activo = true;
    }
    if (g.nombre && (!x.nombre || x.nombre === x.email)) x.nombre = g.nombre;
    if (g.foto) x.foto = g.foto;
    x.verificado = true;
    x.ultimaEntrada = ahora_();
    ['hash', 'hashRecuperacion', 'recuperacionVence', 'recuperacionPedida', 'debeCambiarClave'].forEach(function (k) { delete x[k]; });
    guardarUsuarios_(lista);
    return x;
  });
  if (u.activo === false) throw new Error('Esta cuenta no tiene acceso. Contactá a la parroquia.');
  auditar_({ tipo: 'entrada', email: u.email, nombre: u.nombre, rol: u.rol, comunidad: u.comunidad });
  return { token: crearToken_(u), sesion: sesionPublica_(u) };
}

// Solo correo, sin verificar: queda anotado como visitante y nunca recibe privilegios ni token
function entrarVisitante_(d) {
  var email = normEmail_(d.email);
  if (!emailValido_(email)) throw new Error('Escribí un correo electrónico válido.');
  var nombre = String(d.nombre || '').trim().slice(0, 80);
  var conPermisos = false;
  conCandado_(function () {
    var lista = leerUsuarios_();
    var x = lista.filter(function (v) { return normEmail_(v.email) === email; })[0];
    if (x) {
      conPermisos = !!ROLES[x.rol];
      if (!x.verificado && nombre) x.nombre = nombre;
    } else {
      lista.push({ id: 'u-' + Date.now(), email: email, nombre: nombre || email, rol: 'visitante', comunidad: '', activo: true, creado: ahora_() });
    }
    guardarUsuarios_(lista);
  });
  auditar_({ tipo: 'entrada_visitante', email: email, nombre: nombre });
  return {
    sesion: { email: email, nombre: nombre || email, rol: 'visitante', comunidad: '', activo: true },
    aviso: conPermisos ? 'Esta cuenta tiene permisos: para usarlos entrá con el botón de Google.' : ''
  };
}

function listarUsuarios_(d) {
  exigirResponsable_(usuarioDeToken_(d.token));
  return {
    usuarios: leerUsuarios_().map(function (u) {
      var s = sesionPublica_(u);
      s.verificado = !!u.verificado;
      s.invitado = !!u.invitado;
      s.ultimaEntrada = u.ultimaEntrada || '';
      s.creado = u.creado || '';
      return s;
    })
  };
}

// Crea o actualiza la persona y le asigna rol y comunidad (rol 'visitante' = sin privilegios)
function aplicarRol_(yo, d) {
  var email = normEmail_(d.email);
  if (!emailValido_(email)) throw new Error('Escribí un correo electrónico válido.');
  if (email === normEmail_(CORREO_PARROQUIA)) throw new Error('El administrador general no se puede modificar.');
  var rol = ROLES[d.rol] && d.rol !== 'admin_general' ? d.rol : 'visitante';
  if (rol === 'admin_segundo' && yo.rol !== 'admin_general') throw new Error('Solo el administrador general puede nombrar responsables del sitio.');
  var comunidad = String(d.comunidad || '');
  if (comunidad !== 'parroquia' && !COMUNIDADES[comunidad]) comunidad = '';
  if (rol !== 'visitante' && !comunidad) comunidad = 'parroquia';
  return conCandado_(function () {
    var lista = leerUsuarios_();
    var x = lista.filter(function (v) { return normEmail_(v.email) === email; })[0];
    if (!x) {
      x = { id: 'u-' + Date.now(), email: email, nombre: String(d.nombre || '').trim() || email, creado: ahora_() };
      lista.push(x);
    } else if (x.rol === 'admin_segundo' && yo.rol !== 'admin_general') {
      throw new Error('Solo el administrador general puede cambiar a un responsable del sitio.');
    }
    if (d.nombre && !x.verificado) x.nombre = String(d.nombre).trim();
    x.rol = rol;
    x.comunidad = comunidad;
    x.activo = true;
    x.modificadoPor = yo.email;
    guardarUsuarios_(lista);
    return x;
  });
}

function asignarRol_(d) {
  var yo = usuarioDeToken_(d.token);
  exigirResponsable_(yo);
  var x = aplicarRol_(yo, d);
  auditar_({ tipo: 'permisos', email: x.email, nombre: x.nombre, rol: x.rol, comunidad: x.comunidad, por: yo.email });
  return { usuario: sesionPublica_(x) };
}

function textoInvitacion_(yo, x) {
  return 'Hola' + (x.nombre && x.nombre !== x.email ? ' ' + x.nombre : '') + ', ' + (yo.nombre || 'la parroquia') +
    ' te invita a ser ' + (ROLES[x.rol] || 'parte') + ' (' + (COMUNIDADES[x.comunidad] || 'Parroquia') +
    ') en el sitio de la Parroquia Nuestra Señora del Monte Carmelo.\n\n' +
    'Para entrar abrí ' + SITIO_URL + 'login.html y tocá «Entrar con Google» con la cuenta ' + x.email + '. No necesitás clave.';
}

function invitar_(d) {
  var yo = usuarioDeToken_(d.token);
  exigirResponsable_(yo);
  if (!ROLES[d.rol]) throw new Error('Elegí qué privilegios tendrá.');
  var x = aplicarRol_(yo, d);
  conCandado_(function () {
    var lista = leerUsuarios_();
    var y = lista.filter(function (v) { return normEmail_(v.email) === normEmail_(x.email); })[0];
    y.invitado = true;
    y.invitadoPor = yo.email;
    guardarUsuarios_(lista);
  });
  var texto = textoInvitacion_(yo, x);
  var enviado = d.porCorreo ? correo_(x.email, 'Invitación al sitio — Parroquia Monte Carmelo', texto) : false;
  auditar_({ tipo: 'invitacion', email: x.email, nombre: x.nombre, rol: x.rol, comunidad: x.comunidad, por: yo.email, correo: enviado });
  return { usuario: sesionPublica_(x), texto: texto, correoEnviado: enviado };
}

function eliminarUsuario_(d) {
  var yo = usuarioDeToken_(d.token);
  exigirResponsable_(yo);
  var email = normEmail_(d.email);
  if (email === normEmail_(CORREO_PARROQUIA)) throw new Error('El administrador general no se puede quitar.');
  conCandado_(function () {
    var lista = leerUsuarios_();
    var x = lista.filter(function (v) { return normEmail_(v.email) === email; })[0];
    if (!x) return;
    if (x.rol === 'admin_segundo' && yo.rol !== 'admin_general') throw new Error('Solo el administrador general puede quitar a un responsable del sitio.');
    guardarUsuarios_(lista.filter(function (v) { return v !== x; }));
  });
  auditar_({ tipo: 'quitado', email: email, por: yo.email });
  return {};
}

function auditoria_(d) {
  exigirResponsable_(usuarioDeToken_(d.token));
  var log = leerJson_(sistema_(), 'auditoria.json', []);
  return { auditoria: log.slice(0, Number(d.limite) || 50) };
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

/** Ejecutar a mano desde el editor de Apps Script (una vez, y otra si cambian los permisos) para autorizar
 *  Drive, correo y la verificación de cuentas de Google. */
function prepararPrimeraVez() {
  raiz_();
  sistema_();
  leerUsuarios_();
  secreto_();
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=prueba', { muteHttpExceptions: true });
  console.log('Listo. Carpeta raíz: ' + raiz_().getUrl());
  console.log(GOOGLE_CLIENT_ID ? 'ID de cliente de Google configurado.' : 'Falta GOOGLE_CLIENT_ID al principio de Code.gs.');
}
