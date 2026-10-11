// Páginas propias de cada parroquia (/<parroquia>/p/<pagina>): las escribe el responsable de la parroquia o el
// administrador general (desde Administrar o desde scripts/parroquias.py). El HTML se guarda ya limpio.
import { ErrorApi, ahora, texto, parsear, slug as slugDe } from './util.js';
import { usuarioDeToken, exigirResponsable, auditar } from './auth.js';
import { laParroquia, olvidarParroquia, parroquiaPublica, urlParroquia } from './parroquias.js';

const MAX_HTML = 200000;
export const slugPaginaValido = (s) => /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(String(s || ''));

// Lo que no puede quedar en una página propia: código, formularios y cosas que cambien la página base
const QUITAR = 'script, object, embed, applet, base, meta, link, frame, frameset, form, head, title, noscript, template';
const IFRAME_PERMITIDO = /^https:\/\/((www\.)?youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/|www\.google\.com\/maps\/embed)/;
const ATRIBUTOS_URL = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'background', 'srcset', 'data']);

function urlPeligrosa(nombre, valor) {
  const v = String(valor || '').replace(/[\u0000-\u0020]/g, '').toLowerCase();
  if (nombre === 'src' && v.startsWith('data:image/')) return false;
  return /^(javascript|vbscript|data):/.test(v);
}

export async function limpiarHtml(html) {
  const sinDoctype = String(html || '').replace(/<!doctype[^>]*>/gi, '');
  const res = new HTMLRewriter()
    .on(QUITAR, { element: (el) => el.remove() })
    .on('html, body', { element: (el) => el.removeAndKeepContent() })
    .on('iframe', { element: (el) => { if (!IFRAME_PERMITIDO.test(el.getAttribute('src') || '')) el.remove(); } })
    .on('*', { element: (el) => {
      for (const [nombre, valor] of [...el.attributes]) {
        const n = nombre.toLowerCase();
        const estiloPeligroso = n === 'style' && /expression\s*\(|javascript:/i.test(valor);
        if (n.startsWith('on') || n === 'srcdoc' || estiloPeligroso || (ATRIBUTOS_URL.has(n) && urlPeligrosa(n, valor))) el.removeAttribute(nombre);
      }
    } })
    .onDocument({ comments: (c) => c.remove() })
    .transform(new Response(sinDoctype, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  return (await res.text()).trim();
}

export async function leerPaginaPropia(c, parroquia, slug) {
  if (!slugPaginaValido(slug)) return null;
  const fila = await c.db.prepare('SELECT orden, datos FROM paginas WHERE parroquia = ? AND slug = ?').bind(parroquia, slug).first()
    .catch(() => null);
  return fila ? { ...parsear(fila.datos, {}), slug, orden: fila.orden } : null;
}

const conUrl = (c, x) => ({ ...x, url: urlParroquia(c) + 'p/' + x.slug });

// ==================== LECTURA PÚBLICA ====================

async function paginas(c) {
  return { ok: true, paginas: parroquiaPublica(await laParroquia(c)).paginas };
}

// ==================== RESPONSABLES ====================

async function listarPaginas(c, d) {
  exigirResponsable(await usuarioDeToken(c, d.token));
  const p = await laParroquia(c);
  const { results } = await c.db.prepare('SELECT slug, orden, datos FROM paginas WHERE parroquia = ? ORDER BY orden, slug').bind(p.slug).all();
  return { paginas: results.map((r) => conUrl(c, { ...parsear(r.datos, {}), slug: r.slug, orden: r.orden })) };
}

// d.pagina: {slug (vacío = sale del título), titulo, html, enMenu, orden, nueva (true: no pisar una existente)}
async function guardarPagina(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const p = await laParroquia(c);
  const x = d.pagina || {};
  const titulo = texto(x.titulo, 120);
  if (!titulo) throw new ErrorApi('Escribí el título de la página.');
  const slug = String(x.slug || '').trim().toLowerCase() || slugDe(titulo).slice(0, 60);
  if (!slugPaginaValido(slug)) {
    throw new ErrorApi('La dirección de la página tiene que tener entre 2 y 60 letras minúsculas, números o guiones (sin tildes ni espacios).');
  }
  const html = String(x.html || '');
  if (html.length > MAX_HTML) throw new ErrorApi('La página es demasiado larga (más de 200 KB). Las fotos van como enlaces, no pegadas.');
  const previa = await leerPaginaPropia(c, p.slug, slug);
  if (x.nueva && previa) throw new ErrorApi('Ya hay una página con la dirección «' + slug + '».');
  const ordenPedido = x.orden === '' || x.orden == null ? NaN : Number(x.orden);
  const orden = Number.isFinite(ordenPedido) ? Math.round(ordenPedido)
    : previa ? previa.orden : (p.paginas || []).reduce((m, y) => Math.max(m, y.orden || 0), 0) + 1;
  const datos = {
    titulo, html: await limpiarHtml(html), enMenu: x.enMenu !== false,
    creado: (previa && previa.creado) || ahora(), actualizado: ahora(), modificadoPor: yo.email
  };
  await c.db.prepare('INSERT OR REPLACE INTO paginas (parroquia, slug, orden, datos) VALUES (?, ?, ?, ?)')
    .bind(p.slug, slug, orden, JSON.stringify(datos)).run();
  olvidarParroquia(p.slug);
  c.parroquia = null;
  await auditar(c, { tipo: previa ? 'pagina_guardada' : 'pagina_creada', email: yo.email, nombre: yo.nombre, titulo, parroquia: p.slug });
  return { pagina: conUrl(c, { ...datos, slug, orden }), parroquia: parroquiaPublica(await laParroquia(c)) };
}

async function borrarPagina(c, d) {
  const yo = await usuarioDeToken(c, d.token);
  exigirResponsable(yo);
  const p = await laParroquia(c);
  const previa = await leerPaginaPropia(c, p.slug, String(d.slug || ''));
  if (!previa) throw new ErrorApi('Esa página ya no está.');
  await c.db.prepare('DELETE FROM paginas WHERE parroquia = ? AND slug = ?').bind(p.slug, previa.slug).run();
  olvidarParroquia(p.slug);
  c.parroquia = null;
  await auditar(c, { tipo: 'pagina_quitada', email: yo.email, nombre: yo.nombre, titulo: previa.titulo, parroquia: p.slug });
  return { parroquia: parroquiaPublica(await laParroquia(c)) };
}

export const accionesPaginas = { listarPaginas, guardarPagina, borrarPagina };
export const lecturasPaginas = { paginas };
