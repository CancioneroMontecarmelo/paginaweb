// Parroquias: cada una tiene su dirección (/<slug>/…), su nombre, su logo, sus comunidades y sus noticias.
// La Biblioteca de canciones y las lecturas son comunes a todas.
import { ErrorApi, ahora, texto, fecha as fechaValida, normEmail, emailValido, parsear, slug as slugDe, MAX_ARCHIVO_BYTES } from './util.js';
import {
  usuarioDeToken, exigirResponsable, conPrivilegios, puedeEditar, auditar, buscarUsuario, guardarUsuario,
  verificarGoogle, crearToken, sesionPublica, registrarVisitante
} from './auth.js';
import { guardarArchivo, borrarArchivos, leerCuerpo } from './archivos.js';
import { CATALOGO_CHILE } from './catalogo-chile.js';

export const PARROQUIA_DEFECTO = 'montecarmelo';

// Nombres que no pueden ser parroquias: carpetas y páginas del sitio
const RESERVADOS = new Set([
  'api', 'js', 'css', 'icons', 'imagenes', 'editor', 'comunidades', 'comunidad', 'noticias', 'scripts', 'functions',
  'servidor', 'migrations', 'trabajadores', 'dist', 'admin', 'www', 'static', 'assets', 'parroquia', 'parroquias',
  'inicio', 'login', 'misas', 'reproductor', 'tv', 'ver', 'index', 'sala', 'audio', 'archivo', 'nueva', 'elegir',
  'sw-reproductor', 'favicon', 'robots', 'sitemap', '404', 'acerca', 'sumar', 'agradecimientos', 'portada', 'embebido',
  'mapa', 'buscar', 'vendor', 'avisos', 'privacidad', 'ayuda', 'contacto', 'solicitudes'
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

// ==================== UBICACIÓN Y FOTOS ====================
// Parroquias, capillas y grupos tienen dirección y coordenadas (para el mapa); los movimientos, sus grupos locales.

export const TIPOS = ['parroquia', 'movimiento'];
export const CLASES = ['capilla', 'comunidad', 'grupo'];
const MAX_FOTOS = 12;

const coordenada = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max && v !== '' && v !== null ? Math.round(n * 1e6) / 1e6 : null;
};

export function limpiarUbicacion(x, previa = {}) {
  x = x || {};
  const tiene = (k) => x[k] !== undefined;
  const lat = tiene('lat') ? coordenada(x.lat, -90, 90) : previa.lat ?? null;
  const lng = tiene('lng') ? coordenada(x.lng, -180, 180) : previa.lng ?? null;
  return {
    direccion: tiene('direccion') ? texto(x.direccion, 200) : previa.direccion || '',
    comuna: tiene('comuna') ? texto(x.comuna, 80) : previa.comuna || '',
    region: tiene('region') ? texto(x.region, 80) : previa.region || '',
    lat: lat != null && lng != null ? lat : null,
    lng: lat != null && lng != null ? lng : null
  };
}

const urlWeb = (s) => {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return /^https?:\/\/[^\s"'<>]{3,300}$/i.test(s) ? s : '';
};

const fotosPublicas = (fotos) => (Array.isArray(fotos) ? fotos : []).filter((f) => f && f.id)
  .map((f) => ({ id: f.id, url: '/api/archivo/' + f.id, pie: f.pie || '' }));

const ubicacionPublica = (x) => ({
  direccion: x.direccion || '', comuna: x.comuna || '', region: x.region || '',
  lat: typeof x.lat === 'number' ? x.lat : null, lng: typeof x.lng === 'number' ? x.lng : null
});

const comunidadPublica = (x) => ({
  slug: x.slug, nombre: x.nombre, carpetaCancioneros: x.carpetaCancioneros || x.nombre,
  clase: CLASES.includes(x.clase) ? x.clase : 'comunidad', ...ubicacionPublica(x), foto: x.foto ? '/api/archivo/' + x.foto : ''
});

// La foto que representa a la parroquia: la portada o la primera de su galería
const fotoPrincipal = (p) => p.portada || (fotosPublicas(p.fotos)[0] || {}).url || '';

// Catálogo / feligrés: aún sin ficha armada. Las ya existentes (sin origen) se consideran configuradas.
export function esConfigurada(p) {
  if (typeof p.configurada === 'boolean') return p.configurada;
  return p.origen !== 'catalogo' && p.origen !== 'feligres';
}

// Lo que ven todos (páginas, manifest, app instalada)
export function parroquiaPublica(p) {
  return {
    slug: p.slug, nombre: p.nombre || '', nombreCorto: p.nombreCorto || p.nombre || '', lema: p.lema || '',
    descripcion: p.descripcion || '', correo: p.correo || '', portada: p.portada || '',
    tipo: TIPOS.includes(p.tipo) ? p.tipo : 'parroquia', diocesis: p.diocesis || '', sitioWeb: p.sitioWeb || '',
    sacerdoteNombre: p.sacerdoteNombre || '',
    ...ubicacionPublica(p), fotos: fotosPublicas(p.fotos), foto: fotoPrincipal(p),
    estado: p.estado || 'aprobada', oculta: !!p.oculta,
    origen: p.origen || '', configurada: esConfigurada(p),
    iconos: Object.fromEntries(TAMANOS_ICONO.map((t) => [t, iconoDe(p, t)])),
    logoPropio: !!(p.iconos && p.iconos['192']),
    activa: p.activa !== false,
    comunidades: p.comunidades.map(comunidadPublica),
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
  const [{ results }, { results: coms }] = await Promise.all([
    c.db.prepare('SELECT slug, datos FROM parroquias ORDER BY slug').all(),
    c.db.prepare('SELECT parroquia, slug, datos FROM comunidades ORDER BY parroquia, orden, slug').all()
  ]);
  // Las ocultas se abren con su dirección, pero no aparecen en la portada ni en el mapa
  const lista = results.map((r) => ({ ...parsear(r.datos, {}), slug: r.slug, comunidades: [] }))
    .filter((p) => p.activa !== false && !p.oculta)
    .map((p) => ({
      slug: p.slug, nombre: p.nombre || p.slug, nombreCorto: p.nombreCorto || p.nombre || p.slug, icono: iconoDe(p, '192'),
      tipo: TIPOS.includes(p.tipo) ? p.tipo : 'parroquia', diocesis: p.diocesis || '', ...ubicacionPublica(p), foto: fotoPrincipal(p),
      lema: p.lema || '', origen: p.origen || '', configurada: esConfigurada(p),
      lugares: coms.filter((x) => x.parroquia === p.slug).map((x) => comunidadPublica({ ...parsear(x.datos, {}), slug: x.slug }))
        .filter((x) => x.lat != null).map(({ slug, nombre, clase, direccion, comuna, lat, lng, foto }) => ({ slug, nombre, clase, direccion, comuna, lat, lng, foto }))
    }))
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

// Un responsable cambia nombre, presentación, logo y galería de la suya.
// Tipo, mapa, diócesis, sacerdote y activar/ocultar: solo el administrador general (panel Parroquias).
async function guardarParroquia(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const slug = d.slug && d.slug !== c.slug ? String(d.slug) : c.slug;
  if (slug !== c.slug && yo.rol !== 'admin_general') throw new ErrorApi('Solo el administrador general puede cambiar otra parroquia.');
  const actual = await datosGuardados(c, slug);
  const x = d.parroquia || {};
  const general = yo.rol === 'admin_general';
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
  if (general) {
    nuevos.tipo = TIPOS.includes(x.tipo) ? x.tipo : actual.tipo || 'parroquia';
    nuevos.diocesis = x.diocesis === undefined ? actual.diocesis || '' : texto(x.diocesis, 100);
    nuevos.sitioWeb = x.sitioWeb === undefined ? actual.sitioWeb || '' : urlWeb(x.sitioWeb);
    nuevos.sacerdoteNombre = x.sacerdoteNombre === undefined ? actual.sacerdoteNombre || '' : texto(x.sacerdoteNombre, 120);
    Object.assign(nuevos, limpiarUbicacion(x, actual));
    if (typeof x.configurada === 'boolean') nuevos.configurada = x.configurada;
    else if (nuevos.lat != null || nuevos.sacerdoteNombre || (nuevos.comuna && nuevos.diocesis)) nuevos.configurada = true;
  } else {
    // El responsable no cambia la ficha de configuración (mapa, tipo, sacerdote…)
    nuevos.tipo = actual.tipo || 'parroquia';
    nuevos.diocesis = actual.diocesis || '';
    nuevos.sitioWeb = actual.sitioWeb || '';
    nuevos.sacerdoteNombre = actual.sacerdoteNombre || '';
    Object.assign(nuevos, limpiarUbicacion({}, actual));
  }
  // La galería: se reordena o se cambian los pies; las que se quitan se borran del almacenamiento
  let quitadas = [];
  if (Array.isArray(x.fotos)) {
    const previas = Array.isArray(actual.fotos) ? actual.fotos : [];
    const ids = new Set(previas.map((f) => f.id));
    nuevos.fotos = x.fotos.filter((f) => f && ids.has(f.id)).slice(0, MAX_FOTOS).map((f) => ({ id: f.id, pie: texto(f.pie, 200) }));
    const quedan = new Set(nuevos.fotos.map((f) => f.id));
    quitadas = previas.filter((f) => !quedan.has(f.id)).map((f) => f.id);
    if (quitadas.some((id) => '/api/archivo/' + id === nuevos.portada)) nuevos.portada = '';
  }
  if (general && typeof x.activa === 'boolean') {
    if (!x.activa && slug === PARROQUIA_DEFECTO) throw new ErrorApi('La parroquia principal no se puede desactivar.');
    nuevos.activa = x.activa;
  }
  if (general && typeof x.oculta === 'boolean') {
    if (x.oculta && slug === PARROQUIA_DEFECTO) throw new ErrorApi('La parroquia principal no se puede ocultar.');
    nuevos.oculta = x.oculta;
  }
  await guardarDatos(c, slug, nuevos);
  await borrarFotos(c, slug, quitadas);
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
  const datos = {
    nombre, carpetaCancioneros: texto(x.carpetaCancioneros, 100) || (previa && previa.carpetaCancioneros) || nombre,
    clase: CLASES.includes(x.clase) ? x.clase : (previa && previa.clase) || 'comunidad',
    ...limpiarUbicacion(x, previa || {}),
    foto: (previa && previa.foto) || ''
  };
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
  await borrarFotos(c, p.slug, [p.comunidades.find((y) => y.slug === slug).foto]);
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
        responsables: resp.filter((x) => x.parroquia === p.slug).map((x) => x.email),
        estado: p.estado || 'aprobada', tipo: TIPOS.includes(p.tipo) ? p.tipo : 'parroquia', diocesis: p.diocesis || '',
        comuna: p.comuna || '', region: p.region || '', direccion: p.direccion || '', sitioWeb: p.sitioWeb || '',
        lat: typeof p.lat === 'number' ? p.lat : null, lng: typeof p.lng === 'number' ? p.lng : null,
        sacerdoteNombre: p.sacerdoteNombre || '', origen: p.origen || '', configurada: esConfigurada(p),
        solicitud: p.solicitud || null, creadoPor: p.creadoPor || ''
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
    lema: '', descripcion: '', correo, portada: '', iconos: {}, activa: true, oculta: !!d.oculta,
    origen: 'admin', configurada: false, creado: ahora(), creadoPor: yo.email
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
const MAX_PORTADA = Math.min(MAX_ARCHIVO_BYTES, 4 * 1024 * 1024);

/** Detecta jpg/png/webp por cabecera (no confiar solo en Content-Type). */
function mimeDeBytes(bytes, contentType) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  return MIMES_PORTADA[ct] ? ct : '';
}

/** Baja una imagen https y la guarda como portada de `slug`. No pisa si ya hay portada salvo `forzar`. */
async function aplicarPortadaDesdeUrl(c, slug, url, { forzar = false } = {}) {
  url = String(url || '').trim();
  if (!/^https:\/\/[^\s"'<>]{8,800}$/i.test(url)) throw new ErrorApi('La URL de la foto tiene que ser https y válida.');
  const datos = await datosGuardados(c, slug);
  if (!forzar && datos.portada) return { ok: true, omitida: true, parroquia: parroquiaPublica(await leerParroquia(c, slug)) };
  const res = await fetch(url, {
    headers: { Accept: 'image/jpeg,image/png,image/webp,image/*', 'User-Agent': 'CancioneroLiturgico/1.0' },
    redirect: 'follow'
  });
  if (!res.ok) throw new ErrorApi('No se pudo bajar la foto (HTTP ' + res.status + ').');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 100) throw new ErrorApi('La foto está vacía o dañada.');
  if (buf.byteLength > MAX_PORTADA) throw new ErrorApi('La foto supera 4 MB.');
  const mime = mimeDeBytes(buf, res.headers.get('content-type'));
  if (!mime) throw new ErrorApi('La foto tiene que ser JPG, PNG o WebP.');
  const en = { ...c, slug };
  const { results: previos } = await c.db.prepare('SELECT * FROM archivos WHERE tipo = ? AND carpeta = ? AND ruta = ?')
    .bind('portada', slug, 'portada').all();
  const fila = await guardarArchivo(en, {
    tipo: 'portada', r2: 'parroquias/' + slug + '/portada-' + Date.now(),
    nombre: 'portada.' + MIMES_PORTADA[mime], mime, bytes: buf, carpeta: slug, ruta: 'portada'
  });
  await borrarArchivos(c, previos);
  datos.portada = '/api/archivo/' + fila.id;
  datos.fotoUrlOrigen = url.slice(0, 500);
  await guardarDatos(c, slug, datos);
  return { ok: true, parroquia: parroquiaPublica(await leerParroquia(c, slug)) };
}

export async function subirPortada(c, request, p, token) {
  const yo = await usuarioDeToken(c, token);
  exigirResponsable(yo);
  const mime = String(p.mime || '');
  if (!MIMES_PORTADA[mime]) throw new ErrorApi('La foto tiene que ser JPG, PNG o WebP');
  const bytes = await leerCuerpo(request, MAX_PORTADA, 'La foto supera 4 MB');
  const fila = await reemplazarImagen(c, 'portada', 'portada', 'portada.' + MIMES_PORTADA[mime], mime, bytes);
  const datos = await datosGuardados(c, c.slug);
  datos.portada = '/api/archivo/' + fila.id;
  await guardarDatos(c, c.slug, datos);
  await auditar(c, { tipo: 'portada', email: yo.email, nombre: yo.nombre, parroquia: c.slug });
  return { parroquia: parroquiaPublica(await laParroquia(c)) };
}

/** Admin general: pegar URL de la red y guardarla como portada (reemplaza la actual). */
async function guardarPortadaUrl(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  soloGeneral(yo);
  const slug = String(d.slug || c.slug || '').trim().toLowerCase();
  if (!slugValido(slug) && slug !== PARROQUIA_DEFECTO) throw new ErrorApi('Parroquia desconocida.');
  const r = await aplicarPortadaDesdeUrl(c, slug, d.url, { forzar: true });
  await auditar(c, { tipo: 'portada_url', email: yo.email, nombre: yo.nombre, parroquia: slug });
  return r;
}

// ==================== FOTOS ====================
// PUT /api/subir?tipo=foto&mime=…[&comunidad=<slug>][&reemplaza=<id>][&pie=…]: la galería de la parroquia (hasta 12)
// o la foto de una capilla o grupo. Llegan ya achicadas en el navegador (1600 px).

async function borrarFotos(c, slug, ids) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return;
  const { results } = await c.db.prepare(`SELECT * FROM archivos WHERE carpeta = ? AND tipo = 'foto' AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(slug, ...ids).all();
  await borrarArchivos(c, results);
}

export async function subirFoto(c, request, p, token) {
  const yo = await usuarioDeToken(c, token);
  exigirResponsable(yo);
  const mime = String(p.mime || '');
  if (!MIMES_PORTADA[mime]) throw new ErrorApi('La foto tiene que ser JPG, PNG o WebP');
  const par = await laParroquia(c);
  const com = p.comunidad ? par.comunidades.find((x) => x.slug === String(p.comunidad)) : null;
  if (p.comunidad && !com) throw new ErrorApi('Esa comunidad ya no está.');
  const datos = await datosGuardados(c, c.slug);
  const fotos = Array.isArray(datos.fotos) ? datos.fotos : [];
  const reemplaza = p.reemplaza ? fotos.find((f) => f.id === String(p.reemplaza)) : null;
  if (!com && !reemplaza && fotos.length >= MAX_FOTOS) throw new ErrorApi('Ya hay ' + MAX_FOTOS + ' fotos: quitá una para subir otra.');
  const bytes = await leerCuerpo(request, Math.min(MAX_ARCHIVO_BYTES, 4 * 1024 * 1024), 'La foto supera 4 MB');
  const ext = MIMES_PORTADA[mime];
  const fila = await guardarArchivo(c, {
    tipo: 'foto', r2: 'parroquias/' + c.slug + '/fotos/' + Date.now() + '.' + ext, nombre: 'foto.' + ext, mime, bytes,
    carpeta: c.slug, ruta: com ? 'comunidad-' + com.slug : 'galeria'
  });
  if (com) {
    const { slug: _s, orden, ...resto } = com;
    await c.db.prepare('UPDATE comunidades SET datos = ? WHERE parroquia = ? AND slug = ?')
      .bind(JSON.stringify({ ...resto, foto: fila.id }), c.slug, com.slug).run();
    await borrarFotos(c, c.slug, [com.foto]);
    olvidarParroquia(c.slug);
    c.parroquia = null;
  } else {
    const nueva = { id: fila.id, pie: texto(p.pie, 200) };
    datos.fotos = reemplaza ? fotos.map((f) => (f === reemplaza ? { ...nueva, pie: nueva.pie || f.pie } : f)) : [...fotos, nueva];
    if (reemplaza && datos.portada === '/api/archivo/' + reemplaza.id) datos.portada = '/api/archivo/' + fila.id;
    await guardarDatos(c, c.slug, datos);
    if (reemplaza) await borrarFotos(c, c.slug, [reemplaza.id]);
  }
  await auditar(c, { tipo: 'foto', email: yo.email, nombre: yo.nombre, parroquia: c.slug, comunidad: com ? com.slug : '' });
  return { foto: { id: fila.id, url: '/api/archivo/' + fila.id }, parroquia: parroquiaPublica(await laParroquia(c)) };
}

// Quita la foto de una capilla o grupo (las de la galería se quitan guardando la lista sin ella)
async function quitarFotoComunidad(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const p = await laParroquia(c);
  const com = p.comunidades.find((x) => x.slug === String(d.comunidad || ''));
  if (!com) throw new ErrorApi('Esa comunidad ya no está.');
  if (com.foto) {
    const { slug: _s, orden, ...resto } = com;
    await c.db.prepare('UPDATE comunidades SET datos = ? WHERE parroquia = ? AND slug = ?')
      .bind(JSON.stringify({ ...resto, foto: '' }), p.slug, com.slug).run();
    await borrarFotos(c, p.slug, [com.foto]);
    olvidarParroquia(p.slug);
    c.parroquia = null;
  }
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

// ==================== ALTA (/sumar) ====================
// Nombre + Google: se publica al tiro; quien entra queda como Responsable (admin_segundo).
// El mapa, el sacerdote y el resto los completa después el administrador general.

const MAX_ALTAS_DIA = 20;

async function slugDisponible(c, p) {
  const s = String(p.slug || '').trim().toLowerCase();
  if (!slugValido(s)) return { ok: true, disponible: false, motivo: 'Usá entre 3 y 40 letras minúsculas, números o guiones, sin tildes ni espacios.' };
  const existe = await c.db.prepare('SELECT 1 FROM parroquias WHERE slug = ?').bind(s).first();
  return { ok: true, disponible: !existe, motivo: existe ? 'Esa dirección ya está ocupada.' : '' };
}

/**
 * Propone un slug libre a partir del nombre (o del slug pedido), con sufijo -2, -3… si hace falta.
 * `reservados` evita colisiones dentro del mismo lote (antes del batch a D1).
 */
async function slugLibre(c, preferido, nombre, reservados = null) {
  let base = String(preferido || '').trim().toLowerCase();
  if (!slugValido(base)) {
    base = slugDe(nombre || '').replace(/^(parroquia|movimiento)-/, '').slice(0, 40);
  }
  if (!slugValido(base)) base = ('p-' + Date.now().toString(36)).slice(0, 40);
  let s = base;
  const ocupado = async (cand) => {
    if (reservados && reservados.has(cand)) return true;
    return !!(await c.db.prepare('SELECT 1 FROM parroquias WHERE slug = ?').bind(cand).first());
  };
  for (let i = 2; !slugValido(s) || await ocupado(s); i++) {
    const suf = '-' + i;
    s = (base.slice(0, 40 - suf.length) + suf).replace(/-+$/, '');
    if (i > 50) throw new ErrorApi('No se pudo inventar una dirección libre. Probá con otro nombre.');
  }
  return s;
}

async function solicitarParroquia(c, d) {
  const g = await verificarGoogle(c, d.credential);
  const s = d.solicitud || {};
  const nombre = texto(s.nombre, 120);
  if (!nombre) throw new ErrorApi('Escribí el nombre de la parroquia o del movimiento.');
  const { results: altas } = await c.db.prepare(
    "SELECT json_extract(datos, '$.creado') AS creado FROM parroquias " +
    "WHERE json_extract(datos, '$.creadoPor') IS NOT NULL OR json_extract(datos, '$.solicitud') IS NOT NULL").all();
  const desde = new Date(Date.now() - 86400000).toISOString();
  if (altas.filter((x) => (x.creado || '') > desde).length >= MAX_ALTAS_DIA) {
    throw new ErrorApi('Hoy se sumaron muchas parroquias. Probá mañana o escribinos a cancionerolitugico@gmail.com.');
  }
  const slug = await slugLibre(c, s.slug, nombre);
  const solicitud = {
    nombre: texto((s.responsable || {}).nombre, 100) || g.nombre || g.email,
    email: g.email, fecha: ahora()
  };
  const datos = {
    nombre, nombreCorto: texto(s.nombreCorto, 40) || nombre.replace(/^(Parroquia|Movimiento)\s+/i, '').slice(0, 40),
    tipo: 'parroquia', diocesis: '', sitioWeb: '', sacerdoteNombre: '',
    direccion: '', comuna: '', region: '', lat: null, lng: null,
    lema: '', descripcion: '', correo: g.email, portada: '', iconos: {}, fotos: [],
    activa: true, oculta: false, estado: 'aprobada', origen: 'sumar', configurada: false,
    solicitud, creado: ahora(), creadoPor: g.email
  };
  await c.db.prepare('INSERT INTO parroquias (slug, datos) VALUES (?, ?)').bind(slug, JSON.stringify(datos)).run();
  olvidarParroquia(slug);
  const enNueva = { ...c, slug, parroquia: null };
  const yo = (await buscarUsuario(enNueva, g.email)) || { id: 'u-' + Date.now(), email: g.email, creado: ahora() };
  if (!yo.nombre || yo.nombre === yo.email) yo.nombre = solicitud.nombre;
  if (g.foto) yo.foto = g.foto;
  if (yo.rol !== 'admin_general') Object.assign(yo, { rol: 'admin_segundo', comunidad: 'parroquia', activo: true });
  Object.assign(yo, { verificado: true, ultimaEntrada: ahora() });
  await guardarUsuario(enNueva, yo);
  await auditar(enNueva, { tipo: 'parroquia_creada', email: g.email, nombre: yo.nombre, titulo: nombre, parroquia: slug });
  return {
    slug, url: urlParroquia(c, slug), parroquia: parroquiaPublica(await leerParroquia(c, slug)),
    token: await crearToken(enNueva, yo), sesion: sesionPublica(await buscarUsuario(enNueva, g.email))
  };
}

const normBusca = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function buscarPorNombre(c, nombre, comuna) {
  const q = normBusca(nombre);
  if (!q) return null;
  const com = normBusca(comuna);
  const { results } = await c.db.prepare('SELECT slug, datos FROM parroquias').all();
  let mejor = null, mejorPuntos = 0;
  for (const r of results) {
    const p = { ...parsear(r.datos, {}), slug: r.slug };
    if (p.activa === false) continue;
    const n = normBusca(p.nombre);
    const nc = normBusca(p.nombreCorto);
    let pts = 0;
    if (n === q || nc === q) pts = 100;
    else if (n.includes(q) || q.includes(n) || nc.includes(q)) pts = 50;
    else continue;
    if (com && normBusca(p.comuna) === com) pts += 20;
    if (pts > mejorPuntos) { mejor = p; mejorPuntos = pts; }
  }
  return mejor;
}

async function crearMinima(c, { nombre, comuna, region, diocesis, tipo, lat, lng, origen, creadoPor }) {
  const slug = await slugLibre(c, '', nombre);
  const datos = {
    nombre, nombreCorto: nombre.replace(/^(Parroquia|Movimiento)\s+/i, '').slice(0, 40),
    tipo: TIPOS.includes(tipo) ? tipo : 'parroquia',
    diocesis: texto(diocesis, 100), sitioWeb: '', sacerdoteNombre: '',
    direccion: '', comuna: texto(comuna, 80), region: texto(region, 80) || 'Región Metropolitana',
    lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null,
    lema: '', descripcion: '', correo: '', portada: '', iconos: {}, fotos: [],
    activa: true, oculta: false, estado: 'aprobada',
    origen: origen || 'feligres', configurada: false,
    creado: ahora(), creadoPor: creadoPor || ''
  };
  await c.db.prepare('INSERT INTO parroquias (slug, datos) VALUES (?, ?)').bind(slug, JSON.stringify(datos)).run();
  olvidarParroquia(slug);
  return { slug, ...datos };
}

const MAX_FELIGRES_DIA = 40;

/** Feligrés: correo o Google. Usa slug existente, busca por nombre, o crea un espacio mínimo. */
async function unirseComoFeligres(c, d) {
  let email = '', nombre = '', via = 'correo';
  if (d.credential) {
    const g = await verificarGoogle(c, d.credential);
    email = g.email; nombre = g.nombre || ''; via = 'google';
  } else {
    email = normEmail(d.email);
    if (!emailValido(email)) throw new ErrorApi('Escribí un correo electrónico válido (Gmail u otro).');
    nombre = texto(d.nombre, 80);
  }
  let slug = String(d.slug || '').trim().toLowerCase();
  let p = slugValido(slug) ? await leerParroquia(c, slug) : null;
  let creada = false;
  if (!p || !p.activa) {
    const hallada = await buscarPorNombre(c, d.nombre || '', d.comuna || '');
    if (hallada && hallada.activa !== false) {
      p = hallada;
      slug = hallada.slug;
    } else {
      const nom = texto(d.nombre, 120);
      if (!nom) throw new ErrorApi('Escribí el nombre de tu parroquia o movimiento.');
      const { results: altas } = await c.db.prepare(
        "SELECT json_extract(datos, '$.creado') AS creado FROM parroquias WHERE json_extract(datos, '$.origen') IN ('feligres','catalogo','sumar')"
      ).all();
      const desde = new Date(Date.now() - 86400000).toISOString();
      if (altas.filter((x) => (x.creado || '') > desde).length >= MAX_FELIGRES_DIA) {
        throw new ErrorApi('Hoy se crearon muchas parroquias nuevas. Probá mañana o escribinos a cancionerolitugico@gmail.com.');
      }
      p = await crearMinima(c, {
        nombre: nom, comuna: d.comuna || '', region: d.region || '', diocesis: d.diocesis || '',
        tipo: d.tipo || 'parroquia', origen: 'feligres', creadoPor: email
      });
      slug = p.slug;
      creada = true;
    }
  }
  if (!p.activa) throw new ErrorApi('Esa parroquia no está disponible por ahora.');
  const en = { ...c, slug, parroquia: null };
  let yo = await buscarUsuario(en, email);
  if (!yo) yo = { id: 'u-' + Date.now(), email, nombre: nombre || email, rol: 'visitante', comunidad: '', activo: true, creado: ahora() };
  else if (nombre && (!yo.nombre || yo.nombre === yo.email)) yo.nombre = nombre;
  if (via === 'google') yo.verificado = true;
  yo.ultimaEntrada = ahora();
  await guardarUsuario(en, yo);
  await registrarVisitante(en, email, yo.nombre, via);
  await auditar(en, { tipo: 'entrada_feligres', email, nombre: yo.nombre, parroquia: slug });
  const sesion = {
    email, nombre: yo.nombre || email, rol: ROLES_SAFE(yo), comunidad: yo.comunidad || '',
    activo: true, parroquia: slug, foto: yo.foto || ''
  };
  return { slug, url: urlParroquia(c, slug), sesion, creada };
}

function ROLES_SAFE(yo) {
  // Sin importar ROLES acá: visitante salvo que ya sea miembro con privilegios
  const r = yo.rol || 'visitante';
  return ['admin_general', 'admin_segundo', 'sacerdote', 'admin', 'editor', 'colaborador'].includes(r) ? r : 'visitante';
}

const MAX_FOTOS_POR_IMPORT = 20;

const claveNombreComuna = (nombre, comuna) => normBusca(nombre) + '|' + normBusca(comuna);

const tieneSufijoNumero = (slug) => /-\d+$/.test(String(slug || ''));

/** Índice en memoria: clave nombre|comuna → { slug, datos }. */
async function indicePorNombreComuna(c) {
  const { results } = await c.db.prepare('SELECT slug, datos FROM parroquias').all();
  const map = new Map();
  for (const r of results) {
    const p = parsear(r.datos, {});
    const k = claveNombreComuna(p.nombre, p.comuna);
    if (!k.startsWith('|')) map.set(k, { slug: r.slug, ...p });
  }
  return { map, results };
}

/** Borra una parroquia de catálogo/vacía y sus filas asociadas (no usar con montecarmelo). */
async function borrarParroquiaSlug(c, slug) {
  if (slug === PARROQUIA_DEFECTO) throw new ErrorApi('La parroquia principal no se puede borrar.');
  const { results: archivos } = await c.db.prepare('SELECT * FROM archivos WHERE carpeta = ?').bind(slug).all();
  await borrarArchivos(c, archivos);
  await c.db.batch([
    c.db.prepare('DELETE FROM comunidades WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM miembros WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM visitantes WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM noticias WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM cancioneros WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM misas WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM coros WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM actividades WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM libro WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM auditoria WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM vivo WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM paginas WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM suscripciones WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM reacciones WHERE parroquia = ?').bind(slug),
    c.db.prepare('DELETE FROM parroquias WHERE slug = ?').bind(slug)
  ]);
  olvidarParroquia(slug);
}

function puntuacionConservar(p) {
  let pts = 0;
  if (p.slug === PARROQUIA_DEFECTO) pts += 10000;
  if (esConfigurada(p)) pts += 1000;
  if (p.portada) pts += 200;
  if (!tieneSufijoNumero(p.slug)) pts += 100;
  if (p.origen === 'sumar' || p.origen === 'admin') pts += 50;
  if (p.origen === 'catalogo' || p.origen === 'feligres') pts += 10;
  // Más antigua gana un poco (ISO strings)
  const t = Date.parse(p.creado || '') || 0;
  pts += Math.max(0, 50 - Math.floor((Date.now() - t) / 86400000));
  return pts;
}

/** Núcleo de unificación (sin auth). Conserva la mejor; borra el resto. Nunca borra montecarmelo. */
async function ejecutarUnificarDuplicados(c) {
  const { results } = await c.db.prepare('SELECT slug, datos FROM parroquias').all();
  const grupos = new Map();
  for (const r of results) {
    const p = { ...parsear(r.datos, {}), slug: r.slug };
    const k = claveNombreComuna(p.nombre, p.comuna);
    if (!normBusca(p.nombre)) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  let gruposUnidos = 0, borradas = 0;
  const detalle = [];
  for (const [, lista] of grupos) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => puntuacionConservar(b) - puntuacionConservar(a));
    const keep = lista[0];
    const quitar = lista.slice(1).filter((p) => p.slug !== PARROQUIA_DEFECTO);
    if (!quitar.length) continue;
    for (const p of quitar) {
      await borrarParroquiaSlug(c, p.slug);
      borradas++;
    }
    gruposUnidos++;
    detalle.push({ nombre: keep.nombre, comuna: keep.comuna || '', conservada: keep.slug, borradas: quitar.map((x) => x.slug) });
  }
  cache.delete('*lista');
  return { gruposUnidos, borradas, detalle: detalle.slice(0, 40) };
}

async function unificarDuplicados(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  soloGeneral(yo);
  const r = await ejecutarUnificarDuplicados(c);
  await auditar(c, { tipo: 'parroquias_unificadas', email: yo.email, nombre: yo.nombre, titulo: r.borradas + ' borradas' });
  return r;
}

/** Núcleo del import (yo ya autenticado como admin_general). */
async function ejecutarImportarCatalogo(c, yo, entradas) {
  const lote = Array.isArray(entradas) && entradas.length ? entradas : CATALOGO_CHILE;
  let creadas = 0, omitidas = 0, fotosOk = 0, fotosFallidas = 0;
  const pendientesFoto = [];
  const stmts = [];
  const { map: porNombre } = await indicePorNombreComuna(c);
  const reservados = new Set();
  for (const e of lote) {
    const nombre = texto(e.nombre, 120);
    if (!nombre) continue;
    const comuna = texto(e.comuna, 80);
    const clave = claveNombreComuna(nombre, comuna);
    const porClave = porNombre.get(clave);
    if (porClave || reservados.has('clave:' + clave)) {
      omitidas++;
      if (porClave && !porClave.portada && e.fotoUrl) pendientesFoto.push({ slug: porClave.slug, url: e.fotoUrl });
      continue;
    }
    let slug = String(e.slug || '').trim().toLowerCase();
    if (!slugValido(slug) || reservados.has(slug) || await c.db.prepare('SELECT 1 FROM parroquias WHERE slug = ?').bind(slug).first()) {
      slug = await slugLibre(c, slugValido(slug) ? slug : '', nombre + (comuna ? ' ' + comuna : ''), reservados);
    }
    const porSlug = await c.db.prepare('SELECT slug, datos FROM parroquias WHERE slug = ?').bind(slug).first();
    if (porSlug) {
      omitidas++;
      const prev = parsear(porSlug.datos, {});
      if (!prev.portada && e.fotoUrl) pendientesFoto.push({ slug: porSlug.slug, url: e.fotoUrl });
      continue;
    }
    const datos = {
      nombre, nombreCorto: texto(e.nombreCorto, 40) || nombre.replace(/^(Parroquia|Movimiento)\s+/i, '').slice(0, 40),
      tipo: TIPOS.includes(e.tipo) ? e.tipo : 'parroquia',
      diocesis: texto(e.diocesis, 100) || 'Arquidiócesis de Santiago',
      sitioWeb: '', sacerdoteNombre: '',
      direccion: texto(e.direccion, 200), comuna,
      region: texto(e.region, 80) || (String(e.diocesis || '').includes('Valparaíso') ? 'Región de Valparaíso' : 'Región Metropolitana'),
      lat: typeof e.lat === 'number' ? e.lat : null, lng: typeof e.lng === 'number' ? e.lng : null,
      lema: '', descripcion: '', correo: '', portada: '', iconos: {}, fotos: [],
      activa: true, oculta: false, estado: 'aprobada',
      origen: 'catalogo', configurada: false,
      creado: ahora(), creadoPor: yo.email
    };
    stmts.push(c.db.prepare('INSERT INTO parroquias (slug, datos) VALUES (?, ?)').bind(slug, JSON.stringify(datos)));
    creadas++;
    reservados.add(slug);
    reservados.add('clave:' + clave);
    porNombre.set(clave, { slug, ...datos });
    if (e.fotoUrl) pendientesFoto.push({ slug, url: e.fotoUrl });
  }
  if (stmts.length) {
    for (let i = 0; i < stmts.length; i += 40) await c.db.batch(stmts.slice(i, i + 40));
  }
  for (const f of pendientesFoto.slice(0, MAX_FOTOS_POR_IMPORT)) {
    try {
      const r = await aplicarPortadaDesdeUrl(c, f.slug, f.url, { forzar: false });
      if (!r.omitida) fotosOk++;
    } catch (_) {
      fotosFallidas++;
    }
  }
  const fotosPendientes = Math.max(0, pendientesFoto.length - MAX_FOTOS_POR_IMPORT);
  const uni = await ejecutarUnificarDuplicados(c);
  olvidarParroquia('*lista');
  cache.delete('*lista');
  await auditar(c, { tipo: 'catalogo_importado', email: yo.email, nombre: yo.nombre, titulo: creadas + ' nuevas' });
  const avisos = [];
  if (fotosPendientes) avisos.push('Quedan ' + fotosPendientes + ' fotos por bajar: volvé a Importar catálogo.');
  if (uni.borradas) avisos.push('Se unificaron ' + uni.gruposUnidos + ' grupos (' + uni.borradas + ' duplicadas borradas).');
  return {
    creadas, omitidas, totalCatalogo: lote.length, fotosOk, fotosFallidas, fotosPendientes,
    unificadas: uni.borradas, gruposUnidos: uni.gruposUnidos,
    aviso: avisos.join(' ')
  };
}

async function importarCatalogo(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  soloGeneral(yo);
  return ejecutarImportarCatalogo(c, yo, d.entradas);
}

/**
 * Mantenimiento sin panel: unifica duplicadas e importa catálogo (fotos pendientes).
 * Autenticación: d.clave === env.SECRETO (mismo secreto de sesión; solo scripts).
 */
async function mantenerCatalogo(c, d) {
  if (!c.env.SECRETO || String(d.clave || '') !== String(c.env.SECRETO)) {
    throw new ErrorApi('No autorizado.', 403);
  }
  const uni = await ejecutarUnificarDuplicados(c);
  const yo = {
    email: String(c.env.CORREO_PARROQUIA || 'mantenimiento@local').toLowerCase(),
    nombre: 'Mantenimiento',
    rol: 'admin_general'
  };
  // Varias pasadas para bajar fotos (tope por corrida)
  let imp = await ejecutarImportarCatalogo(c, yo, d.entradas);
  let vueltas = 1;
  while (imp.fotosPendientes > 0 && vueltas < 8) {
    imp = await ejecutarImportarCatalogo(c, yo, d.entradas);
    vueltas++;
  }
  return { unificacion: uni, importacion: imp, vueltasFoto: vueltas };
}

export const accionesParroquias = {
  guardarParroquia, guardarComunidad, ordenarComunidades, borrarComunidad, listarParroquias, crearParroquia,
  guardarNoticia, borrarNoticia, quitarFotoComunidad, solicitarParroquia, unirseComoFeligres, importarCatalogo,
  guardarPortadaUrl, unificarDuplicados, mantenerCatalogo
};
export const lecturasParroquias = { parroquia, parroquias, noticias, slugDisponible };
