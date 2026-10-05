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
 *     Lecturas/<fecha>.json                                      (lecturas del día ya leídas)
 *     Cancioneros/<comunidad>/<fecha>_<slug>/
 *        cancionero.m3u8 · canciones/*.md · audios/* · <slug>.html
 */

var CORREO_PARROQUIA = 'cancionerolitugico@gmail.com';
var RAIZ_NOMBRE = 'MonteCarmelo';
// La sesión se renueva en cada pedido con token: solo vence tras TOKEN_DIAS sin usar el sitio.
var TOKEN_DIAS = 90;
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
    if (p.accion === 'biblioteca') return json_(biblioteca_());
    if (p.accion === 'cancion') return json_(cancionBiblioteca_(p.id));
    if (p.accion === 'audio') return json_(audioBiblioteca_(p.id));
    if (p.accion === 'misas') return json_(listarMisas_(p));
    if (p.accion === 'lecturas') return json_(lecturas_(p.fecha));
    return json_({ ok: true, app: 'MonteCarmelo', version: 3 });
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
  usuarioPedido_ = null;
  try {
    var fn = ACCIONES[datos.accion];
    if (!fn) throw new Error('Acción desconocida: ' + datos.accion);
    var r = fn(datos) || {};
    r.ok = true;
    if (usuarioPedido_ && !r.token) r.token = crearToken_(usuarioPedido_);
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
  listar: listar_,
  subirAudioBiblioteca: subirAudioBiblioteca_,
  subirCancion: subirCancion_,
  vincularAudio: vincularAudio_,
  desvincularAudio: desvincularAudio_,
  guardarMisa: guardarMisa_,
  borrarMisa: borrarMisa_,
  leerEnsayos: leerEnsayos_,
  guardarEnsayos: guardarEnsayos_,
  listarCoros: listarCoros_,
  guardarCoro: guardarCoro_,
  borrarCoro: borrarCoro_
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

var usuarioPedido_ = null;

function crearToken_(u) {
  var payload = b64url_(JSON.stringify({ email: u.email, exp: Date.now() + TOKEN_DIAS * 86400 * 1000 }));
  return payload + '.' + firmar_(payload);
}

function usuarioDeToken_(token) {
  var partes = String(token || '').split('.');
  if (partes.length !== 2 || firmar_(partes[0]) !== partes[1]) throw new Error('Sesión inválida. Volvé a identificarte.');
  var datos = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString('UTF-8'));
  if (!datos.exp || datos.exp < Date.now()) throw new Error('La sesión venció. Volvé a identificarte.');
  var u = buscarUsuario_(datos.email);
  if (!u || u.activo === false) throw new Error('Cuenta inexistente o sin acceso.');
  usuarioPedido_ = u;
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
  try {
    indexarEnBiblioteca_(carpeta, entrada.comunidad, u);
  } catch (err) {
    console.warn('Biblioteca: ' + err);
  }
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

// ==================== BIBLIOTECA DE CANCIONES ====================
// MonteCarmelo/Biblioteca/{canciones,audios} + biblioteca.json (público). Se llena con cada cancionero
// guardado desde el editor y con las canciones que se suben desde la pantalla Misas.

function conPrivilegios_(u) {
  if (!ROLES[u.rol]) throw new Error('Tu cuenta todavía no tiene permisos para esto.');
  return u;
}

function leerBiblioteca_() {
  var data = leerJson_(raiz_(), 'biblioteca.json', null);
  if (!data || !data.canciones) data = { v: 1, canciones: [] };
  return data;
}

function carpetaBiblioteca_(sub) {
  return carpetaRuta_(raiz_(), ['Biblioteca', sub]);
}

function desescapar_(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escaparAtributo_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Id de un archivo de Drive a partir de sus enlaces habituales (uc?id=…, open?id=…, /file/d/…)
function idDeDrive_(url) {
  var m = String(url || '').match(/^https?:\/\/(?:drive|docs)\.google\.com\/(?:.*[?&]id=|file\/d\/)([\w-]{20,})/i);
  return m ? m[1] : '';
}

function urlAudioDrive_(fileId) {
  return 'https://drive.google.com/uc?export=download&id=' + fileId;
}

// Un audio con enlace: si apunta a un archivo de Biblioteca/audios queda como fileId (reproducción con respaldo)
function audioDeEnlace_(nombre, voz, url, audiosBib) {
  var id = idDeDrive_(url);
  if (id) {
    try {
      if (enCarpeta_(DriveApp.getFileById(id), audiosBib)) return { nombre: nombre, voz: voz, fileId: id };
    } catch (_) { /* no es nuestro: queda como enlace */ }
  }
  return { nombre: nombre || url, voz: voz, url: url };
}

// Etiqueta <audio> con el mismo formato que escribe el editor (editor/js/markdown.js)
function etiquetaAudio_(a) {
  var src = a.fileId ? urlAudioDrive_(a.fileId) : a.url;
  var voz = a.voz && a.voz !== 'todas' ? ' data-voz="' + escaparAtributo_(a.voz) + '"' : '';
  return '<audio controls src="' + escaparAtributo_(src) + '" title="' + escaparAtributo_(a.nombre || 'Audio') + '"' + voz + '></audio>';
}

// Título, tono, etiquetas y audios de una canción .md del editor
function cabeceraMd_(texto, nombreArchivo) {
  var t = String(texto || '').replace(/\r\n?/g, '\n');
  var meta = {};
  var m = t.match(/^---\n([\s\S]*?)\n---/);
  if (m) m[1].split('\n').forEach(function (l) {
    var i = l.indexOf(':');
    if (i < 1) return;
    var v = l.slice(i + 1).trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch (_) { v = v.slice(1, -1); } }
    meta[l.slice(0, i).trim().toLowerCase()] = v;
  });
  var h = t.match(/^#\s+(.+)$/m);
  var titulo = String(meta.titulo || meta.title || (h && h[1]) || String(nombreArchivo || '').replace(/\.md$/i, '') || 'Sin título').trim();
  var etiquetas = String(meta.etiquetas || meta.tags || '').split(',')
    .map(function (x) { return x.trim(); }).filter(Boolean);
  var audios = (t.match(/<audio\b[^>]*>/gi) || []).map(function (tag) {
    var at = function (n) { var r = tag.match(new RegExp('\\s' + n + '="([^"]*)"', 'i')); return r ? desescapar_(r[1]) : ''; };
    return { src: at('src'), nombre: at('title'), voz: at('data-voz') };
  }).filter(function (a) { return a.src; });
  return { titulo: titulo.slice(0, 150), tono: String(meta.tono || '').slice(0, 40), etiquetas: etiquetas.slice(0, 40), audios: audios };
}

function enCarpeta_(archivo, carpeta) {
  var padres = archivo.getParents();
  while (padres.hasNext()) if (padres.next().getId() === carpeta.getId()) return true;
  return false;
}

// Devuelve el id del audio en Biblioteca/audios (reutiliza el que tenga el mismo nombre y tamaño)
function guardarAudioBiblioteca_(nombre, tamano, crear) {
  var carpeta = carpetaBiblioteca_('audios');
  var it = carpeta.getFilesByName(nombre);
  while (it.hasNext()) {
    var f = it.next();
    if (f.getSize() === tamano) return f.getId();
  }
  var nuevo = crear(carpeta);
  nuevo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return nuevo.getId();
}

// items: [{ texto, cab, audios }] → entradas del índice (una canción por título)
function registrarEnBiblioteca_(items, comunidad, u) {
  var carpeta = carpetaBiblioteca_('canciones');
  return conCandado_(function () {
    var bib = leerBiblioteca_();
    var hechas = items.map(function (it) {
      var id = 'c-' + slug_(it.cab.titulo);
      var previa = bib.canciones.filter(function (x) { return x.id === id; })[0];
      var f = null;
      if (previa && previa.mdId) { try { f = DriveApp.getFileById(previa.mdId); } catch (_) {} }
      if (f) f.setContent(it.texto);
      else f = carpeta.createFile(slug_(it.cab.titulo) + '.md', it.texto, 'text/markdown');
      var e = {
        id: id, titulo: it.cab.titulo, tono: it.cab.tono, etiquetas: it.cab.etiquetas, mdId: f.getId(),
        audios: it.audios.length ? it.audios : (previa ? previa.audios : []),
        comunidad: (previa && previa.comunidad) || comunidad || '',
        autor: (previa && previa.autor) || u.email, actualizado: ahora_()
      };
      // Canción que estaba solo con audios (subida desde Misas) y ahora llega con letra: el .md nuevo no los
      // nombra, pero siguen siendo suyos
      if (!it.audios.length && e.audios.length) {
        var faltan = e.audios.filter(function (a) { return it.texto.indexOf(a.fileId || a.url) < 0; });
        if (faltan.length) actualizarAudiosMd_(e, faltan, []);
      }
      bib.canciones = bib.canciones.filter(function (x) { return x.id !== id; });
      bib.canciones.push(e);
      return e;
    });
    bib.canciones.sort(function (a, b) { return a.titulo.localeCompare(b.titulo); });
    bib.actualizado = ahora_();
    escribirJson_(raiz_(), 'biblioteca.json', bib);
    return hechas;
  });
}

function indexarEnBiblioteca_(carpeta, comunidad, u) {
  var archivos = listarArchivos_(carpeta, '', []);
  var audiosBib = carpetaBiblioteca_('audios');
  var porRuta = {};
  archivos.forEach(function (f) { porRuta[f.ruta] = f; });
  var items = archivos.filter(function (f) { return /^canciones\/[^\/]+\.md$/i.test(f.ruta); }).map(function (f) {
    var texto = DriveApp.getFileById(f.id).getBlob().getDataAsString('UTF-8');
    var cab = cabeceraMd_(texto, f.ruta.split('/').pop());
    var audios = cab.audios.map(function (a) {
      if (/^https?:/i.test(a.src)) return audioDeEnlace_(a.nombre, a.voz, a.src, audiosBib);
      var ruta;
      try { ruta = decodeURIComponent(a.src); } catch (_) { ruta = a.src; }
      var fa = porRuta[ruta.replace(/^(\.\.?\/)+/, '')];
      if (!fa) return null;
      var original = DriveApp.getFileById(fa.id);
      var id = guardarAudioBiblioteca_(original.getName(), original.getSize(), function (destino) {
        return original.makeCopy(original.getName(), destino);
      });
      return { nombre: a.nombre || original.getName(), voz: a.voz, fileId: id };
    }).filter(Boolean);
    return { texto: texto, cab: cab, audios: audios };
  });
  return items.length ? registrarEnBiblioteca_(items, comunidad, u) : [];
}

function biblioteca_() {
  return { ok: true, canciones: leerBiblioteca_().canciones };
}

function cancionBiblioteca_(id) {
  var e = leerBiblioteca_().canciones.filter(function (x) { return x.id === id; })[0];
  if (!e) throw new Error('Canción no encontrada');
  return { ok: true, cancion: e, texto: DriveApp.getFileById(e.mdId).getBlob().getDataAsString('UTF-8') };
}

// Respaldo por si el navegador no puede reproducir el enlace directo de Drive
function audioBiblioteca_(fileId) {
  var usado = leerBiblioteca_().canciones.some(function (c) {
    return (c.audios || []).some(function (a) { return a.fileId === fileId; });
  });
  if (!usado) throw new Error('Audio no encontrado');
  var f = DriveApp.getFileById(fileId);
  return { ok: true, base64: Utilities.base64Encode(f.getBlob().getBytes()), mime: f.getMimeType(), nombre: f.getName() };
}

function subirAudioBiblioteca_(d) {
  conPrivilegios_(usuarioDeToken_(d.token));
  var bytes = Utilities.base64Decode(String(d.base64 || ''));
  if (bytes.length > MAX_ARCHIVO_BYTES) throw new Error('El audio supera los 30 MB');
  var nombre = nombreAudio_(d);
  var mime = /\.webm$/i.test(nombre) ? 'audio/webm' : String(d.mime || 'application/octet-stream');
  var id = guardarAudioBiblioteca_(nombre, bytes.length, function (carpeta) {
    return carpeta.createFile(Utilities.newBlob(bytes, mime, nombre));
  });
  return { fileId: id, nombre: nombre };
}

// <canción>-<voz>-<fecha>.<ext>: así la carpeta Biblioteca/audios queda ordenada al abrirla en Drive
function nombreAudio_(d) {
  var original = String(d.nombre || 'audio').replace(/[\/\\]/g, '-');
  var ext = (original.match(/\.([a-z0-9]{2,5})$/i) || [, 'webm'])[1].toLowerCase();
  var base = slug_(d.cancion || original.replace(/\.[^.]+$/, ''));
  var voz = d.voz && d.voz !== 'todas' ? '-' + slug_(d.voz) : '';
  var fecha = d.cancion ? '-' + ahora_().slice(0, 16).replace('T', '-').replace(':', '') : '';
  return (base + voz + fecha).slice(0, 140) + '.' + ext;
}

function buscarCancionBib_(bib, id) {
  var c = bib.canciones.filter(function (x) { return x.id === id; })[0];
  if (!c) throw new Error('Canción no encontrada en la Biblioteca');
  return c;
}

function exigirEditarCancion_(u, c) {
  if (c.comunidad && !puedeEditar_(u, c.comunidad)) throw new Error('No tenés permiso para modificar esta canción');
}

// Reescribe en el .md de Drive las etiquetas <audio>: agrega las de `nuevos` y quita las de `quitados`
function actualizarAudiosMd_(c, nuevos, quitados) {
  if (!c.mdId) return;
  var f;
  try { f = DriveApp.getFileById(c.mdId); } catch (_) { return; }
  var texto = f.getBlob().getDataAsString('UTF-8').replace(/\r\n?/g, '\n');
  (quitados || []).forEach(function (a) {
    texto = texto.replace(/[ \t]*<audio\b[^>]*>(?:\s*<\/audio>)?[ \t]*\n?/gi, function (tag) {
      var src = desescapar_((tag.match(/\ssrc="([^"]*)"/i) || [])[1] || '');
      var titulo = desescapar_((tag.match(/\stitle="([^"]*)"/i) || [])[1] || '');
      var es = a.fileId ? (idDeDrive_(src) === a.fileId || (!/^https?:/i.test(src) && titulo && titulo === a.nombre)) : src === a.url;
      return es ? '' : tag;
    });
  });
  if (nuevos && nuevos.length) {
    texto = texto.replace(/\s*$/, '\n\n') + nuevos.map(etiquetaAudio_).join('\n\n') + '\n';
  }
  f.setContent(texto.replace(/\n{3,}/g, '\n\n'));
}

function vincularAudio_(d) {
  var u = conPrivilegios_(usuarioDeToken_(d.token));
  var audiosBib = carpetaBiblioteca_('audios');
  var pedidos = (Array.isArray(d.audios) ? d.audios : []).slice(0, 20).map(function (a) {
    var f;
    try { f = DriveApp.getFileById(String(a.fileId || '')); } catch (_) { return null; }
    if (!enCarpeta_(f, audiosBib)) return null;
    return { nombre: String(a.nombre || f.getName()).slice(0, 150), voz: String(a.voz || '').slice(0, 30), fileId: f.getId() };
  }).filter(Boolean);
  if (!pedidos.length) throw new Error('No hay audios para vincular');
  var c = conCandado_(function () {
    var bib = leerBiblioteca_();
    var c = buscarCancionBib_(bib, String(d.cancionId || ''));
    exigirEditarCancion_(u, c);
    var ya = {};
    (c.audios || []).forEach(function (a) { if (a.fileId) ya[a.fileId] = true; });
    var nuevos = pedidos.filter(function (a) { return !ya[a.fileId]; });
    c.audios = (c.audios || []).concat(nuevos);
    actualizarAudiosMd_(c, nuevos, []);
    c.actualizado = ahora_();
    escribirJson_(raiz_(), 'biblioteca.json', bib);
    return c;
  });
  auditar_({ tipo: 'audio_vinculado', email: u.email, nombre: u.nombre, titulo: c.titulo });
  return { cancion: c };
}

function desvincularAudio_(d) {
  var u = conPrivilegios_(usuarioDeToken_(d.token));
  var fileId = String(d.fileId || ''), url = String(d.url || '');
  if (!fileId && !url) throw new Error('Falta el audio a quitar');
  var r = conCandado_(function () {
    var bib = leerBiblioteca_();
    var c = buscarCancionBib_(bib, String(d.cancionId || ''));
    exigirEditarCancion_(u, c);
    var quitados = (c.audios || []).filter(function (a) { return fileId ? a.fileId === fileId : a.url === url; });
    if (!quitados.length) throw new Error('Ese audio ya no está en la canción');
    c.audios = c.audios.filter(function (a) { return quitados.indexOf(a) < 0; });
    actualizarAudiosMd_(c, [], quitados);
    c.actualizado = ahora_();
    escribirJson_(raiz_(), 'biblioteca.json', bib);
    var enUso = fileId && bib.canciones.some(function (x) {
      return (x.audios || []).some(function (a) { return a.fileId === fileId; });
    });
    return { cancion: c, borrar: fileId && !enUso };
  });
  if (r.borrar) {
    try {
      var f = DriveApp.getFileById(fileId);
      if (enCarpeta_(f, carpetaBiblioteca_('audios'))) f.setTrashed(true);
    } catch (_) { /* ya no estaba */ }
  }
  auditar_({ tipo: 'audio_quitado', email: u.email, nombre: u.nombre, titulo: r.cancion.titulo });
  return { cancion: r.cancion };
}

function subirCancion_(d) {
  var u = conPrivilegios_(usuarioDeToken_(d.token));
  var texto = String(d.md || '');
  if (!texto.trim()) throw new Error('La canción está vacía');
  if (texto.length > 500000) throw new Error('La canción es demasiado grande');
  var audiosBib = carpetaBiblioteca_('audios');
  var audios = (Array.isArray(d.audios) ? d.audios : []).slice(0, 20).map(function (a) {
    var nombre = String(a.nombre || '').slice(0, 150), voz = String(a.voz || '').slice(0, 30);
    if (a.fileId) {
      var f;
      try { f = DriveApp.getFileById(String(a.fileId)); } catch (_) { return null; }
      return enCarpeta_(f, audiosBib) ? { nombre: nombre || f.getName(), voz: voz, fileId: f.getId() } : null;
    }
    return /^https?:\/\//i.test(String(a.url || '')) ? audioDeEnlace_(nombre, voz, String(a.url), audiosBib) : null;
  }).filter(Boolean);
  var comunidad = COMUNIDADES[d.comunidad] ? d.comunidad : (u.comunidad || '');
  var e = registrarEnBiblioteca_([{ texto: texto, cab: cabeceraMd_(texto, d.nombre), audios: audios }], comunidad, u)[0];
  // Los audios subidos reemplazan en el .md a su ruta local (misma etiqueta title) por el enlace de Drive
  var sinEnlace = audios.filter(function (a) { return a.fileId && texto.indexOf(a.fileId) < 0; });
  if (sinEnlace.length) actualizarAudiosMd_(e, sinEnlace, sinEnlace);
  auditar_({ tipo: 'cancion_subida', email: u.email, nombre: u.nombre, titulo: e.titulo });
  return { cancion: e };
}

// ==================== CANCIONEROS DE MISA ====================
// misas.json (público): nombre, fecha, momentos y canciones. Ensayos y asistencia en sistema/ensayos.json.

function leerMisas_() {
  var data = leerJson_(raiz_(), 'misas.json', null);
  if (!data || !data.misas) data = { v: 1, misas: [] };
  return data;
}

function buscarMisa_(id) {
  var m = leerMisas_().misas.filter(function (x) { return x.id === id; })[0];
  if (!m) throw new Error('Cancionero no encontrado');
  return m;
}

function fecha_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
}

function texto_(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max);
}

function listarMisas_(p) {
  var lista = leerMisas_().misas;
  if (p && p.comunidad) lista = lista.filter(function (m) { return m.comunidad === p.comunidad; });
  lista = lista.slice().sort(function (a, b) { return String(b.fechaUso || b.creado).localeCompare(String(a.fechaUso || a.creado)); });
  return { ok: true, misas: lista };
}

function limpiarMomentos_(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, 40).map(function (m) {
    return {
      momento: texto_(m.momento, 60) || 'Momento',
      canciones: (Array.isArray(m.canciones) ? m.canciones : []).slice(0, 10).map(function (c) {
        var r = { cancionId: texto_(c.cancionId, 120), desplazamiento: Math.max(-11, Math.min(11, Math.round(Number(c.desplazamiento) || 0))) };
        if (c.sugerida === true) r.sugerida = true;
        return r;
      }).filter(function (c) { return c.cancionId; })
    };
  });
}

function guardarMisa_(d) {
  var u = usuarioDeToken_(d.token);
  var m = d.misa || {};
  var comunidad = String(m.comunidad || '');
  if (!COMUNIDADES[comunidad]) throw new Error('Elegí la comunidad');
  if (!puedeEditar_(u, comunidad)) throw new Error('No tenés permiso para guardar cancioneros de ' + COMUNIDADES[comunidad]);
  var nombre = texto_(m.nombre, 120);
  if (!nombre) throw new Error('Escribí el nombre del cancionero');
  var misa = conCandado_(function () {
    var data = leerMisas_();
    var previa = m.id ? data.misas.filter(function (x) { return x.id === m.id; })[0] : null;
    if (previa && !puedeEditar_(u, previa.comunidad)) throw new Error('No tenés permiso para modificar este cancionero');
    var nueva = {
      id: previa ? previa.id : 'm-' + Date.now(),
      nombre: nombre, comunidad: comunidad, comunidadNombre: COMUNIDADES[comunidad],
      fechaUso: fecha_(m.fechaUso), tiempoLiturgico: texto_(m.tiempoLiturgico, 60), coroId: texto_(m.coroId, 40),
      momentos: limpiarMomentos_(m.momentos),
      autor: previa ? previa.autor : u.email, autorNombre: previa ? previa.autorNombre : u.nombre,
      creado: previa ? previa.creado : ahora_(), actualizado: ahora_()
    };
    // La carpeta y la página del Drive solo cambian al publicar; un guardado común las conserva
    var publicada = m.drive && /^[\w-]{10,}$/.test(String(m.drive.folderId || '')) ? {
      folderId: String(m.drive.folderId), htmlId: /^[\w-]{10,}$/.test(String(m.drive.htmlId || '')) ? String(m.drive.htmlId) : ''
    } : null;
    var drive = publicada || (previa && previa.drive) || null;
    if (drive) nueva.drive = drive;
    if (publicada) nueva.publicada = ahora_();
    else if (previa && previa.publicada) nueva.publicada = previa.publicada;
    data.misas = data.misas.filter(function (x) { return x.id !== nueva.id; });
    data.misas.unshift(nueva);
    escribirJson_(raiz_(), 'misas.json', data);
    return nueva;
  });
  if (d.ensayos) escribirEnsayos_(misa.id, d.ensayos);
  auditar_({ tipo: 'misa_guardada', email: u.email, nombre: u.nombre, titulo: misa.nombre, comunidad: comunidad });
  return { misa: misa };
}

function borrarMisa_(d) {
  var u = usuarioDeToken_(d.token);
  var m = buscarMisa_(d.id);
  if (!puedeEditar_(u, m.comunidad)) throw new Error('No tenés permiso para borrar este cancionero');
  conCandado_(function () {
    var data = leerMisas_();
    data.misas = data.misas.filter(function (x) { return x.id !== m.id; });
    escribirJson_(raiz_(), 'misas.json', data);
    var ens = leerJson_(sistema_(), 'ensayos.json', {});
    delete ens[m.id];
    escribirJson_(sistema_(), 'ensayos.json', ens);
  });
  auditar_({ tipo: 'misa_borrada', email: u.email, nombre: u.nombre, titulo: m.nombre });
  return {};
}

function limpiarEnsayos_(e) {
  e = e || {};
  var vistas = {};
  return {
    fechasPosibles: (Array.isArray(e.fechasPosibles) ? e.fechasPosibles : []).map(fecha_)
      .filter(function (f) { return f && !vistas[f] && (vistas[f] = true); }).sort().slice(0, 60),
    realizados: (Array.isArray(e.realizados) ? e.realizados : []).slice(0, 60).map(function (r) {
      return {
        fecha: fecha_(r.fecha),
        presentes: (Array.isArray(r.presentes) ? r.presentes : []).slice(0, 200).map(function (p) { return texto_(p, 60); }).filter(Boolean),
        nota: texto_(r.nota, 500)
      };
    }).filter(function (r) { return r.fecha; }).sort(function (a, b) { return a.fecha.localeCompare(b.fecha); })
  };
}

function escribirEnsayos_(id, e) {
  return conCandado_(function () {
    var ens = leerJson_(sistema_(), 'ensayos.json', {});
    ens[id] = limpiarEnsayos_(e);
    escribirJson_(sistema_(), 'ensayos.json', ens);
    return ens[id];
  });
}

function exigirComunidad_(u, comunidad) {
  if (!puedeEditar_(u, comunidad)) throw new Error('Solo quienes tienen permisos en esta comunidad pueden ver estos datos.');
}

function leerEnsayos_(d) {
  var u = usuarioDeToken_(d.token);
  var m = buscarMisa_(d.id);
  exigirComunidad_(u, m.comunidad);
  return { ensayos: leerJson_(sistema_(), 'ensayos.json', {})[m.id] || { fechasPosibles: [], realizados: [] } };
}

function guardarEnsayos_(d) {
  var u = usuarioDeToken_(d.token);
  var m = buscarMisa_(d.id);
  exigirComunidad_(u, m.comunidad);
  return { ensayos: escribirEnsayos_(m.id, d.ensayos) };
}

// ==================== COROS ====================
// sistema/coros.json (privado): coros con sus integrantes y conocimientos musicales.

var VOCES_CORO = ['soprano', 'contralto', 'tenor', 'bajo'];
var NIVELES_CORO = ['basico', 'intermedio', 'avanzado'];

function comunidadValida_(c) {
  return c === 'parroquia' || !!COMUNIDADES[c];
}

function limpiarIntegrante_(i, comunidadCoro) {
  i = i || {};
  return {
    id: /^i-[\w-]{1,40}$/.test(String(i.id || '')) ? i.id : 'i-' + Utilities.getUuid().slice(0, 8),
    nombre: texto_(i.nombre, 100),
    comunidad: comunidadValida_(i.comunidad) ? i.comunidad : comunidadCoro,
    fechaIncorporacion: fecha_(i.fechaIncorporacion),
    voz: VOCES_CORO.indexOf(i.voz) >= 0 ? i.voz : '',
    instrumentos: texto_(i.instrumentos, 200),
    leePartitura: !!i.leePartitura,
    nivel: NIVELES_CORO.indexOf(i.nivel) >= 0 ? i.nivel : '',
    notas: texto_(i.notas, 500),
    activo: i.activo !== false
  };
}

function listarCoros_(d) {
  var u = conPrivilegios_(usuarioDeToken_(d.token));
  return { coros: leerJson_(sistema_(), 'coros.json', []).filter(function (c) { return puedeEditar_(u, c.comunidad); }) };
}

function guardarCoro_(d) {
  var u = conPrivilegios_(usuarioDeToken_(d.token));
  var c = d.coro || {};
  var comunidad = String(c.comunidad || '');
  if (!comunidadValida_(comunidad)) throw new Error('Elegí la comunidad del coro');
  exigirComunidad_(u, comunidad);
  var nombre = texto_(c.nombre, 100);
  if (!nombre) throw new Error('Escribí el nombre del coro');
  var coro = conCandado_(function () {
    var lista = leerJson_(sistema_(), 'coros.json', []);
    var previo = c.id ? lista.filter(function (x) { return x.id === c.id; })[0] : null;
    if (previo) exigirComunidad_(u, previo.comunidad);
    var nuevo = {
      id: previo ? previo.id : 'coro-' + Date.now(),
      nombre: nombre, comunidad: comunidad,
      integrantes: (Array.isArray(c.integrantes) ? c.integrantes : []).slice(0, 200)
        .map(function (i) { return limpiarIntegrante_(i, comunidad); }).filter(function (i) { return i.nombre; }),
      creado: previo ? previo.creado : ahora_(), actualizado: ahora_(), modificadoPor: u.email
    };
    lista = lista.filter(function (x) { return x.id !== nuevo.id; });
    lista.push(nuevo);
    escribirJson_(sistema_(), 'coros.json', lista);
    return nuevo;
  });
  auditar_({ tipo: 'coro_guardado', email: u.email, nombre: u.nombre, titulo: coro.nombre, comunidad: comunidad });
  return { coro: coro };
}

function borrarCoro_(d) {
  var u = conPrivilegios_(usuarioDeToken_(d.token));
  conCandado_(function () {
    var lista = leerJson_(sistema_(), 'coros.json', []);
    var c = lista.filter(function (x) { return x.id === d.id; })[0];
    if (!c) return;
    exigirComunidad_(u, c.comunidad);
    escribirJson_(sistema_(), 'coros.json', lista.filter(function (x) { return x !== c; }));
  });
  auditar_({ tipo: 'coro_borrado', email: u.email, nombre: u.nombre, id: d.id });
  return {};
}

// ==================== LECTURAS DEL DÍA ====================
// Fuente: eucaristiadiaria.cl (Área de Liturgia, Arzobispado de Santiago). Publican mes a mes: un día que
// todavía no está devuelve la página sin secciones. Los días encontrados quedan en Lecturas/<fecha>.json.

var LECTURAS_URL = 'https://www.eucaristiadiaria.cl/dia_cal.php?fecha=';
var LECTURAS_SECCIONES = { inicio: 'Ritos iniciales', liturgia: 'Liturgia de la Palabra', evangelio: 'Evangelio', eucaristia: 'Liturgia eucarística' };

function lecturas_(fecha) {
  fecha = fecha_(fecha);
  if (!fecha) throw new Error('Fecha inválida');
  var cache = CacheService.getScriptCache();
  var clave = 'lecturas-v1-' + fecha;
  var guardado = cache.get(clave);
  if (guardado) return JSON.parse(guardado);
  var carpeta = subcarpeta_(raiz_(), 'Lecturas');
  var l = leerJson_(carpeta, fecha + '.json', null);
  if (!l) {
    var res = UrlFetchApp.fetch(LECTURAS_URL + fecha, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) throw new Error('No se pudo leer eucaristiadiaria.cl (' + res.getResponseCode() + ')');
    l = parsearLecturas_(res.getContentText('UTF-8'));
    l.fecha = fecha;
    l.fuente = LECTURAS_URL + fecha;
    if (l.disponible) escribirJson_(carpeta, fecha + '.json', l);
  }
  var r = { ok: true, lecturas: l };
  try { cache.put(clave, JSON.stringify(r), l.disponible ? 21600 : 1800); } catch (_) {}
  return r;
}

function parsearLecturas_(html) {
  var fin = html.indexOf('id="pie"');
  if (fin > 0) html = html.slice(0, fin);
  var t = /class="titulos"[^>]*>([\s\S]*?)<br/i.exec(html);
  var l = { disponible: false, dia: t ? textoHtml_(t[1]) : '', titulo: '', color: '', tiempo: '', secciones: [] };
  var re = /<a name="(\w+)" class="subtitulos">([\s\S]*?)<\/a>/gi, m, marcas = [];
  while ((m = re.exec(html))) marcas.push({ id: m[1], nombre: textoHtml_(m[2]), desde: re.lastIndex });
  marcas.forEach(function (s, i) {
    var cuerpo = html.slice(s.desde, i + 1 < marcas.length ? marcas[i + 1].desde : html.length);
    var bloques = [], pm, rp = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    while ((pm = rp.exec(cuerpo))) {
      var b = bloqueLectura_(pm[1], pm[2]);
      if (b) bloques.push(b);
    }
    if (bloques.length) l.secciones.push({ id: s.id, nombre: LECTURAS_SECCIONES[s.id] || s.nombre, bloques: bloques });
  });
  l.disponible = l.secciones.some(function (s) { return s.id === 'liturgia' || s.id === 'evangelio'; });
  // Al comienzo de los ritos iniciales van, centrados y en rojo: la fecha, la celebración y el color litúrgico
  var ini = l.secciones.filter(function (s) { return s.id === 'inicio'; })[0];
  if (ini) {
    var centrados = [];
    while (ini.bloques.length && ini.bloques[0].centro) centrados.push(ini.bloques.shift().x);
    if (centrados.length > 1) l.titulo = centrados[1];
    if (centrados.length > 2 && /^(verde|blanco|rojo|morado|rosado|negro|azul)/i.test(centrados[2])) l.color = centrados[2];
    if (!l.titulo && centrados.length) l.titulo = centrados[0];
    if (!ini.bloques.length) l.secciones = l.secciones.filter(function (s) { return s !== ini; });
  }
  l.tiempo = tiempoDeTitulo_(l.titulo);
  l.secciones.forEach(function (s) { s.bloques.forEach(function (b) { delete b.centro; }); });
  return l;
}

// Bloque de una lectura: h = título (todo en rojo), c = de dónde se lee (con la cita en rojo),
// e = frase que resume la lectura (cursiva), p = texto
function bloqueLectura_(atributos, interior) {
  var x = textoHtml_(interior);
  if (!x || x === '+++') return null;
  var rojo = /<span style="color:\s*rgb\((?:238|255), 0, 0\)">([\s\S]*?)<\/span>/gi, m, enRojo = '';
  while ((m = rojo.exec(interior))) enRojo += textoHtml_(m[1]);
  var b = { t: 'p', x: x };
  if (enRojo && enRojo.replace(/\s+/g, '') === x.replace(/\s+/g, '')) b.t = 'h';
  else if (/^\s*(<span[^>]*>\s*)*<em>/i.test(interior)) b.t = 'e';
  else if (/\d/.test(enRojo) && x.length < 220) b.t = 'c';
  if (/text-align:\s*center/i.test(atributos) && b.t === 'h') b.centro = true;
  return b;
}

var ACENTOS_HTML_ = { acute: '\u0301', grave: '\u0300', circ: '\u0302', uml: '\u0308', tilde: '\u0303', cedil: '\u0327' };
var ENTIDADES_HTML_ = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', sbquo: '‚', bdquo: '„', hellip: '…', ndash: '–', mdash: '—', iexcl: '¡', iquest: '¿',
  ordf: 'ª', ordm: 'º', deg: '°', middot: '·', bull: '•', szlig: 'ß', aelig: 'æ', oelig: 'œ', copy: '©', dagger: '†'
};

function textoHtml_(h) {
  return String(h || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&([a-zA-Z])(acute|grave|circ|uml|tilde|cedil);/g, function (_, l, a) { return (l + ACENTOS_HTML_[a]).normalize('NFC'); })
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(+n); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); })
    .replace(/&(\w+);/g, function (e, n) { return ENTIDADES_HTML_.hasOwnProperty(n) ? ENTIDADES_HTML_[n] : e; })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// Tiempo litúrgico según el título del día (los nombres son las etiquetas del grupo «Tiempos litúrgicos»)
function tiempoDeTitulo_(titulo) {
  var t = String(titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  var reglas = [
    [/MIERCOLES DE CENIZA/, 'Miércoles de Ceniza'], [/DOMINGO DE RAMOS/, 'Domingo de Ramos'],
    [/JUEVES SANTO/, 'Jueves Santo'], [/VIERNES SANTO/, 'Viernes Santo'], [/VIGILIA PASCUAL/, 'Vigilia Pascual'],
    [/SEMANA SANTA/, 'Semana Santa'], [/PENTECOSTES/, 'Pentecostés'], [/ASCENSION DEL SENOR/, 'Ascensión'],
    [/EPIFANIA/, 'Epifanía'], [/ADVIENTO/, 'Adviento'], [/CUARESMA/, 'Cuaresma'], [/PASCUA/, 'Pascua'],
    [/NAVIDAD|NATIVIDAD DEL SENOR/, 'Navidad'], [/TIEMPO ORDINARIO/, 'Tiempo ordinario']
  ];
  for (var i = 0; i < reglas.length; i++) if (reglas[i][0].test(t)) return reglas[i][1];
  return '';
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
