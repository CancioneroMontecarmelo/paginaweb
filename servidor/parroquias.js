// Parroquias: cada una tiene su dirección (/<slug>/…), su nombre, su logo, sus comunidades y sus noticias.
// La Biblioteca de canciones y las lecturas son comunes a todas.
import { ErrorApi, ahora, texto, fecha as fechaValida, normEmail, emailValido, parsear, slug as slugDe, MAX_ARCHIVO_BYTES } from './util.js';
import {
  usuarioDeToken, exigirResponsable, conPrivilegios, puedeEditar, auditar, buscarUsuario, guardarUsuario
} from './auth.js';
import { guardarArchivo, borrarArchivos, leerCuerpo } from './archivos.js';

export const PARROQUIA_DEFECTO = 'montecarmelo';

// Nombres que no pueden ser parroquias: carpetas y páginas del sitio
const RESERVADOS = new Set([
  'api', 'js', 'css', 'icons', 'imagenes', 'editor', 'comunidades', 'comunidad', 'noticias', 'scripts', 'functions',
  'servidor', 'migrations', 'trabajadores', 'dist', 'admin', 'www', 'static', 'assets', 'parroquia', 'parroquias',
  'inicio', 'login', 'misas', 'reproductor', 'tv', 'ver', 'index', 'sala', 'audio', 'archivo', 'nueva', 'elegir',
  'sw-reproductor', 'favicon', 'robots', 'sitemap', '404'
]);

export const slugValido = (s) => /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(String(s || '')) && !RESERVADOS.has(String(s));

export const TAMANOS_ICONO = ['180', '192', '512'];

// Lo leído de D1 se guarda unos segundos en memoria: el middleware lo pide en cada página
const CACHE_MS = 30000;
const cache = new Map();

export function olvidarParroquia(slug) {
  cache.delete(slug);
  cache.delete('*lista');
}

export async function leerParroquia(c, slug) {
  if (!slugValido(slug) && slug !== PARROQUIA_DEFECTO) return null;
  const guardada = cache.get(slug);
  if (guardada && guardada.vence > Date.now()) return guardada.p;
  const [fila, coms, pags] = await Promise.all([
    c.db.prepare('SELECT datos FROM parroquias WHERE slug = ?').bind(slug).first(),
    c.db.prepare('SELECT slug, orden, datos FROM comunidades WHERE parroquia = ? ORDER BY orden, slug').bind(slug).all(),
    c.db.prepare("SELECT slug, orden, json_extract(datos, '$.titulo') AS titulo, json_extract(datos, '$.enMenu') AS enMenu " +
      'FROM paginas WHERE parroquia = ? ORDER BY orden, slug').bind(slug).all().catch(() => ({ results: [] }))
  ]);
  const p = fila ? {
    ...parsear(fila.datos, {}),
    slug,
    comunidades: coms.results.map((r) => ({ ...parsear(r.datos, {}), slug: r.slug, orden: r.orden })),
    paginas: pags.results.map((r) => ({ slug: r.slug, titulo: r.titulo || r.slug, enMenu: !!r.enMenu, orden: r.orden }))
  } : null;
  if (p) p.activa = p.activa !== false;
  cache.set(slug, { p, vence: Date.now() + CACHE_MS });
  return p;
}

// La parroquia del pedido (c.slug). Da error si no existe o está desactivada.
export async function laParroquia(c) {
  if (c.parroquia) return c.parroquia;
  const p = await leerParroquia(c, c.slug);
  if (!p) throw new ErrorApi('No existe la parroquia «' + c.slug + '».');
  if (!p.activa) throw new ErrorApi('La ' + (p.nombre || 'parroquia') + ' no está disponible por ahora.');
  c.parroquia = p;
  return p;
}

export const esComunidad = (c, s) => !!(c.parroquia && c.parroquia.comunidades.some((x) => x.slug === s));
export const comunidadValida = (c, s) => s === 'parroquia' || esComunidad(c, s);

export function nombreComunidad(c, s) {
  if (s === 'parroquia') return (c.parroquia && c.parroquia.nombre) || 'Parroquia';
  const x = c.parroquia && c.parroquia.comunidades.find((y) => y.slug === s);
  return x ? x.nombre : '';
}

export const urlParroquia = (c, slug) => c.sitio + (slug || c.slug) + '/';

export function iconoDe(p, tam) {
  const id = p.iconos && p.iconos[tam];
  return '/' + p.slug + '/icono-' + tam + '.png' + (id ? '?v=' + String(id).slice(-8) : '');
}

// Lo que ven todos (páginas, manifest, app instalada)
export function parroquiaPublica(p) {
  return {
    slug: p.slug, nombre: p.nombre || '', nombreCorto: p.nombreCorto || p.nombre || '', lema: p.lema || '',
    descripcion: p.descripcion || '', correo: p.correo || '', portada: p.portada || '',
    iconos: Object.fromEntries(TAMANOS_ICONO.map((t) => [t, iconoDe(p, t)])),
    logoPropio: !!(p.iconos && p.iconos['192']),
    activa: p.activa !== false,
    comunidades: p.comunidades.map((x) => ({ slug: x.slug, nombre: x.nombre, carpetaCancioneros: x.carpetaCancioneros || x.nombre })),
    paginas: (p.paginas || []).map((x) => ({ slug: x.slug, titulo: x.titulo, enMenu: x.enMenu }))
  };
}

// ==================== LECTURAS PÚBLICAS ====================

async function parroquia(c) {
  return { ok: true, parroquia: parroquiaPublica(await laParroquia(c)) };
}

export async function parroquiasActivas(c) {
  const guardada = cache.get('*lista');
  if (guardada && guardada.vence > Date.now()) return guardada.p;
  const { results } = await c.db.prepare('SELECT slug, datos FROM parroquias ORDER BY slug').all();
  // Las ocultas (de prueba) se abren con su dirección, pero no aparecen en «Elegí tu parroquia»
  const lista = results.map((r) => ({ ...parsear(r.datos, {}), slug: r.slug, comunidades: [] }))
    .filter((p) => p.activa !== false && !p.oculta)
    .map((p) => ({ slug: p.slug, nombre: p.nombre || p.slug, nombreCorto: p.nombreCorto || p.nombre || p.slug, icono: iconoDe(p, '192') }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  cache.set('*lista', { p: lista, vence: Date.now() + CACHE_MS });
  return lista;
}

async function parroquias(c) {
  return { ok: true, parroquias: await parroquiasActivas(c) };
}

// ==================== DATOS DE LA PARROQUIA (responsables) ====================

async function guardarDatos(c, slug, datos) {
  await c.db.prepare('UPDATE parroquias SET datos = ? WHERE slug = ?').bind(JSON.stringify(datos), slug).run();
  olvidarParroquia(slug);
  if (c.parroquia && c.parroquia.slug === slug) c.parroquia = null;
}

async function datosGuardados(c, slug) {
  const fila = await c.db.prepare('SELECT datos FROM parroquias WHERE slug = ?').bind(slug).first();
  if (!fila) throw new ErrorApi('No existe la parroquia «' + slug + '».');
  return parsear(fila.datos, {});
}

const portadaValida = (s) => {
  s = String(s || '').trim();
  return /^\/[\w%./-]{1,300}$/.test(s) || /^https:\/\/[^\s"'<>]{1,500}$/.test(s) ? s : '';
};

// Un responsable cambia la suya; el administrador general puede cambiar cualquiera (d.slug) y activarla o no
async function guardarParroquia(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const slug = d.slug && d.slug !== c.slug ? String(d.slug) : c.slug;
  if (slug !== c.slug && yo.rol !== 'admin_general') throw new ErrorApi('Solo el administrador general puede cambiar otra parroquia.');
  const actual = await datosGuardados(c, slug);
  const x = d.parroquia || {};
  const nombre = texto(x.nombre ?? actual.nombre, 120);
  if (!nombre) throw new ErrorApi('Escribí el nombre de la parroquia.');
  const correo = normEmail(x.correo ?? actual.correo);
  if (correo && !emailValido(correo)) throw new ErrorApi('El correo de contacto no es válido.');
  const nuevos = {
    ...actual,
    nombre,
    nombreCorto: texto(x.nombreCorto ?? actual.nombreCorto, 40) || nombre.replace(/^Parroquia\s+/i, '').slice(0, 40),
    lema: texto(x.lema ?? actual.lema, 200),
    descripcion: texto(x.descripcion ?? actual.descripcion, 4000),
    correo,
    portada: x.portada === undefined ? actual.portada || '' : portadaValida(x.portada),
    actualizado: ahora(),
    modificadoPor: yo.email
  };
  if (yo.rol === 'admin_general' && typeof x.activa === 'boolean') {
    if (!x.activa && slug === PARROQUIA_DEFECTO) throw new ErrorApi('La parroquia principal no se puede desactivar.');
    nuevos.activa = x.activa;
  }
  if (yo.rol === 'admin_general' && typeof x.oculta === 'boolean') {
    if (x.oculta && slug === PARROQUIA_DEFECTO) throw new ErrorApi('La parroquia principal no se puede ocultar.');
    nuevos.oculta = x.oculta;
  }
  await guardarDatos(c, slug, nuevos);
  await auditar(c, { tipo: 'parroquia_guardada', email: yo.email, nombre: yo.nombre, parroquia: slug });
  const p = await leerParroquia(c, slug);
  return { parroquia: parroquiaPublica(p) };
}

// ==================== COMUNIDADES ====================

async function guardarComunidad(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const p = await laParroquia(c);
  const x = d.comunidad || {};
  const nombre = texto(x.nombre, 100);
  if (!nombre) throw new ErrorApi('Escribí el nombre de la comunidad.');
  let slug = String(x.slug || '');
  const previa = slug ? p.comunidades.find((y) => y.slug === slug) : null;
  if (slug && !previa) throw new ErrorApi('Esa comunidad ya no está.');
  if (!previa) {
    const base = slugDe(nombre).slice(0, 50);
    slug = base;
    for (let i = 2; slug === 'parroquia' || p.comunidades.some((y) => y.slug === slug); i++) slug = base + '-' + i;
  }
  const datos = { nombre, carpetaCancioneros: texto(x.carpetaCancioneros, 100) || (previa && previa.carpetaCancioneros) || nombre };
  const orden = previa ? previa.orden : p.comunidades.reduce((m, y) => Math.max(m, y.orden || 0), 0) + 1;
  await c.db.prepare('INSERT OR REPLACE INTO comunidades (parroquia, slug, orden, datos) VALUES (?, ?, ?, ?)')
    .bind(p.slug, slug, orden, JSON.stringify(datos)).run();
  olvidarParroquia(p.slug);
  c.parroquia = null;
  await auditar(c, { tipo: previa ? 'comunidad_renombrada' : 'comunidad_creada', email: yo.email, nombre: yo.nombre, titulo: nombre, comunidad: slug });
  return { parroquia: parroquiaPublica(await laParroquia(c)) };
}

async function ordenarComunidades(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const p = await laParroquia(c);
  const orden = (Array.isArray(d.orden) ? d.orden : []).map(String);
  const stmt = c.db.prepare('UPDATE comunidades SET orden = ? WHERE parroquia = ? AND slug = ?');
  const lista = p.comunidades.slice().sort((a, b) => {
    const ia = orden.indexOf(a.slug), ib = orden.indexOf(b.slug);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  if (lista.length) await c.db.batch(lista.map((x, i) => stmt.bind(i + 1, p.slug, x.slug)));
  olvidarParroquia(p.slug);
  c.parroquia = null;
  return { parroquia: parroquiaPublica(await laParroquia(c)) };
}

// Solo si no tiene cancioneros, misas ni coros: si los tiene, mejor renombrarla
async function borrarComunidad(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const p = await laParroquia(c);
  const slug = String(d.slug || '');
  if (!p.comunidades.some((y) => y.slug === slug)) throw new ErrorApi('Esa comunidad ya no está.');
  const cuenta = async (tabla) => (await c.db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE parroquia = ? AND comunidad = ?`).bind(p.slug, slug).first()).n;
  const [misas, cancioneros, coros] = await Promise.all([cuenta('misas'), cuenta('cancioneros'), cuenta('coros')]);
  if (misas + cancioneros + coros) {
    throw new ErrorApi('Esta comunidad tiene ' + [misas && misas + ' cancioneros de misa', cancioneros && cancioneros + ' cancioneros del editor', coros && coros + ' coros']
      .filter(Boolean).join(', ') + '. Cambiale el nombre en vez de quitarla.');
  }
  await c.db.prepare('DELETE FROM comunidades WHERE parroquia = ? AND slug = ?').bind(p.slug, slug).run();
  olvidarParroquia(p.slug);
  c.parroquia = null;
  await auditar(c, { tipo: 'comunidad_quitada', email: yo.email, nombre: yo.nombre, comunidad: slug });
  return { parroquia: parroquiaPublica(await laParroquia(c)) };
}

// ==================== PLATAFORMA (solo el administrador general) ====================

function soloGeneral(u) {
  if (u.rol !== 'admin_general') throw new ErrorApi('Solo el administrador general puede administrar las parroquias.');
}

async function listarParroquias(c, d) {
  soloGeneral(await usuarioDeToken(c, d.token));
  const { results } = await c.db.prepare('SELECT slug, datos FROM parroquias ORDER BY slug').all();
  const { results: resp } = await c.db.prepare(
    "SELECT parroquia, email FROM miembros WHERE json_extract(datos, '$.rol') = 'admin_segundo'"
  ).all();
  return {
    parroquias: results.map((r) => {
      const p = { ...parsear(r.datos, {}), slug: r.slug, comunidades: [] };
      return {
        slug: p.slug, nombre: p.nombre || p.slug, nombreCorto: p.nombreCorto || '', activa: p.activa !== false, oculta: !!p.oculta,
        creado: p.creado || '', icono: iconoDe(p, '192'), url: urlParroquia(c, p.slug),
        responsables: resp.filter((x) => x.parroquia === p.slug).map((x) => x.email)
      };
    })
  };
}

async function crearParroquia(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  soloGeneral(yo);
  const slug = String(d.slug || '').trim().toLowerCase();
  if (!slugValido(slug)) {
    throw new ErrorApi('La dirección tiene que tener entre 3 y 40 letras minúsculas, números o guiones (sin tildes ni espacios), y no puede ser una palabra reservada del sitio.');
  }
  if (await c.db.prepare('SELECT 1 FROM parroquias WHERE slug = ?').bind(slug).first()) throw new ErrorApi('Ya existe una parroquia con la dirección «' + slug + '».');
  const nombre = texto(d.nombre, 120);
  if (!nombre) throw new ErrorApi('Escribí el nombre de la parroquia.');
  const correo = normEmail(d.correo);
  if (correo && !emailValido(correo)) throw new ErrorApi('El correo del responsable no es válido.');
  const datos = {
    nombre, nombreCorto: texto(d.nombreCorto, 40) || nombre.replace(/^Parroquia\s+/i, '').slice(0, 40),
    lema: '', descripcion: '', correo, portada: '', iconos: {}, activa: true, oculta: !!d.oculta, creado: ahora(), creadoPor: yo.email
  };
  await c.db.prepare('INSERT INTO parroquias (slug, datos) VALUES (?, ?)').bind(slug, JSON.stringify(datos)).run();
  olvidarParroquia(slug);
  let invitacion = '';
  if (correo) {
    // El responsable queda como miembro de la parroquia nueva (no de la actual)
    const enNueva = { ...c, slug, parroquia: null };
    const x = (await buscarUsuario(enNueva, correo)) || { id: 'u-' + Date.now(), email: correo, nombre: correo, creado: ahora() };
    Object.assign(x, { rol: 'admin_segundo', comunidad: 'parroquia', activo: true, invitado: true, invitadoPor: yo.email, modificadoPor: yo.email });
    await guardarUsuario(enNueva, x);
    invitacion = 'Hola, ' + (yo.nombre || 'el administrador del Cancionero Litúrgico') + ' te invita a ser Responsable de la ' + nombre +
      ' en el Cancionero Litúrgico.\n\nPara entrar abrí ' + urlParroquia(c, slug) + 'login y tocá «Entrar con Google» con la cuenta ' +
      correo + '. No necesitás clave. Desde ahí podés cargar el logo y las comunidades, e invitar a quienes administran cada comunidad.';
  }
  await auditar(c, { tipo: 'parroquia_creada', email: yo.email, nombre: yo.nombre, titulo: nombre, parroquia: slug, responsable: correo });
  return { parroquia: parroquiaPublica(await leerParroquia(c, slug)), url: urlParroquia(c, slug), texto: invitacion };
}

// ==================== LOGO Y PORTADA ====================
// PUT /api/subir?tipo=logo&tam=180|192|512 (PNG cuadrado, ya recortado en el navegador)
// PUT /api/subir?tipo=portada (JPEG, PNG o WebP)

async function reemplazarImagen(c, ruta, tipo, nombre, mime, bytes) {
  const { results: previos } = await c.db.prepare('SELECT * FROM archivos WHERE tipo = ? AND carpeta = ? AND ruta = ?')
    .bind(tipo, c.slug, ruta).all();
  const fila = await guardarArchivo(c, {
    tipo, r2: 'parroquias/' + c.slug + '/' + ruta + '-' + Date.now(), nombre, mime, bytes, carpeta: c.slug, ruta
  });
  await borrarArchivos(c, previos);
  return fila;
}

export async function subirLogo(c, request, p, token) {
  const yo = await usuarioDeToken(c, token);
  exigirResponsable(yo);
  const tam = String(p.tam || '');
  if (!TAMANOS_ICONO.includes(tam)) throw new ErrorApi('Tamaño de logo desconocido');
  const bytes = await leerCuerpo(request, 1024 * 1024, 'El logo supera 1 MB');
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) throw new ErrorApi('El logo tiene que ser PNG');
  const fila = await reemplazarImagen(c, 'logo-' + tam, 'logo', 'logo-' + tam + '.png', 'image/png', bytes);
  const datos = await datosGuardados(c, c.slug);
  datos.iconos = { ...(datos.iconos || {}), [tam]: fila.id };
  await guardarDatos(c, c.slug, datos);
  if (tam === '512') await auditar(c, { tipo: 'logo', email: yo.email, nombre: yo.nombre, parroquia: c.slug });
  return { parroquia: parroquiaPublica(await laParroquia(c)) };
}

const MIMES_PORTADA = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function subirPortada(c, request, p, token) {
  const yo = await usuarioDeToken(c, token);
  exigirResponsable(yo);
  const mime = String(p.mime || '');
  if (!MIMES_PORTADA[mime]) throw new ErrorApi('La foto tiene que ser JPG, PNG o WebP');
  const bytes = await leerCuerpo(request, Math.min(MAX_ARCHIVO_BYTES, 4 * 1024 * 1024), 'La foto supera 4 MB');
  const fila = await reemplazarImagen(c, 'portada', 'portada', 'portada.' + MIMES_PORTADA[mime], mime, bytes);
  const datos = await datosGuardados(c, c.slug);
  datos.portada = '/api/archivo/' + fila.id;
  await guardarDatos(c, c.slug, datos);
  await auditar(c, { tipo: 'portada', email: yo.email, nombre: yo.nombre, parroquia: c.slug });
  return { parroquia: parroquiaPublica(await laParroquia(c)) };
}

// El ícono de la app instalada y de la pestaña: el logo de la parroquia o, si no tiene, el del Cancionero
export async function respuestaIcono(c, slug, tam, assets, url) {
  const p = await leerParroquia(c, slug);
  const id = p && p.iconos && p.iconos[tam];
  const fila = id ? await c.db.prepare('SELECT r2 FROM archivos WHERE id = ?').bind(id).first() : null;
  const obj = fila ? await c.r2.get(fila.r2) : null;
  if (!obj) return assets.fetch(new URL('/icons/reproductor-' + tam + '.png', url).toString());
  return new Response(obj.body, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=' + (url.searchParams.has('v') ? 2592000 : 3600) }
  });
}

// ==================== NOTICIAS ====================

async function noticias(c, p) {
  const comunidad = p && p.comunidad ? String(p.comunidad) : '';
  const consulta = comunidad
    ? c.db.prepare('SELECT datos FROM noticias WHERE parroquia = ? AND comunidad = ? ORDER BY fecha DESC, id DESC LIMIT 200').bind(c.slug, comunidad)
    : c.db.prepare('SELECT datos FROM noticias WHERE parroquia = ? ORDER BY fecha DESC, id DESC LIMIT 200').bind(c.slug);
  const { results } = await consulta.all();
  return { ok: true, noticias: results.map((r) => parsear(r.datos)).filter(Boolean) };
}

async function guardarNoticia(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const x = d.noticia || {};
  const fila = x.id ? await c.db.prepare('SELECT datos FROM noticias WHERE id = ? AND parroquia = ?').bind(String(x.id), c.slug).first() : null;
  const previa = fila && parsear(fila.datos, {});
  if (x.id && !previa) throw new ErrorApi('Esa noticia ya no está.');
  const comunidad = previa ? previa.comunidad : String(x.comunidad || '');
  if (!comunidadValida(c, comunidad)) throw new ErrorApi('Elegí la comunidad de la noticia.');
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('No tenés permiso para publicar noticias de ' + nombreComunidad(c, comunidad) + '.');
  const n = {
    id: previa ? previa.id : 'n-' + Date.now(),
    titulo: texto(x.titulo, 160),
    fecha: fechaValida(x.fecha) || ahora().slice(0, 10),
    etiquetas: (Array.isArray(x.etiquetas) ? x.etiquetas : []).map((t) => texto(t, 30)).filter(Boolean).slice(0, 10),
    cuerpo: texto(x.cuerpo, 10000),
    comunidad,
    autor: previa ? previa.autor : u.nombre || u.email,
    autorEmail: previa ? previa.autorEmail : u.email,
    creado: previa ? previa.creado : ahora(),
    actualizado: ahora()
  };
  if (!n.titulo) throw new ErrorApi('Falta el título.');
  await c.db.prepare('INSERT OR REPLACE INTO noticias (id, parroquia, comunidad, fecha, datos) VALUES (?, ?, ?, ?, ?)')
    .bind(n.id, c.slug, comunidad, n.fecha, JSON.stringify(n)).run();
  await auditar(c, { tipo: 'noticia', email: u.email, nombre: u.nombre, titulo: n.titulo, comunidad });
  return { noticia: n };
}

async function borrarNoticia(c, d) {
  const u = conPrivilegios(await usuarioDeToken(c, d.token));
  const fila = await c.db.prepare('SELECT datos FROM noticias WHERE id = ? AND parroquia = ?').bind(String(d.id || ''), c.slug).first();
  if (!fila) throw new ErrorApi('Esa noticia ya no está.');
  const n = parsear(fila.datos, {});
  if (!puedeEditar(u, n.comunidad)) throw new ErrorApi('No tenés permiso para quitar esa noticia.');
  await c.db.prepare('DELETE FROM noticias WHERE id = ? AND parroquia = ?').bind(n.id, c.slug).run();
  await auditar(c, { tipo: 'noticia_quitada', email: u.email, nombre: u.nombre, titulo: n.titulo, comunidad: n.comunidad });
  return {};
}

export const accionesParroquias = {
  guardarParroquia, guardarComunidad, ordenarComunidades, borrarComunidad, listarParroquias, crearParroquia,
  guardarNoticia, borrarNoticia
};
export const lecturasParroquias = { parroquia, parroquias, noticias };
