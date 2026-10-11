// Páginas de cada parroquia: /<parroquia>/<página> sirve la página base (inicio.html, reproductor.html…) con el
// nombre, el logo y el manifest de esa parroquia. CSS, JS, íconos comunes y el editor no pasan por acá
// (_routes.json): las páginas los piden con rutas absolutas (/css/…, /js/…).
import { entrada, contexto } from './api.js';
import { PARROQUIA_DEFECTO, leerParroquia, parroquiaPublica, parroquiasActivas, respuestaIcono, slugValido } from './parroquias.js';
import { leerPaginaPropia, limpiarHtml } from './paginas-propias.js';

const PAGINAS = {
  reproductor: 'Cancionero Litúrgico',
  inicio: 'Parroquia',
  misas: 'Misas',
  noticias: 'Noticias',
  comunidad: 'Comunidad',
  login: 'Identificarse',
  tv: 'Pantalla',
  ver: 'Cancionero'
};
// Las direcciones de antes, sin parroquia
const VIEJAS = /^\/(index|inicio|login|misas|noticias|reproductor|tv|ver|comunidad)(\.html)?$/;
const COOKIE = 'mc-parroquia';
const UN_ANO = 31536000;

const escapar = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const redirigir = (destino, extra = {}) => new Response(null, { status: 302, headers: { Location: destino, 'Cache-Control': 'no-store', ...extra } });
const conCookie = (slug) => ({ 'Set-Cookie': `${COOKIE}=${slug}; Path=/; Max-Age=${UN_ANO}; SameSite=Lax; Secure` });

function cookieParroquia(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)mc-parroquia=([a-z0-9-]{3,40})/);
  return m ? m[1] : '';
}

async function parroquiaDelEquipo(c, request) {
  const s = cookieParroquia(request);
  const p = s ? await leerParroquia(c, s) : null;
  return p && p.activa ? p.slug : PARROQUIA_DEFECTO;
}

// ==================== HTML ====================

function htmlBasico(titulo, cuerpo, status = 200) {
  return new Response(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title><link rel="icon" href="/icons/reproductor-192.png"><link rel="stylesheet" href="/css/site.css">
</head><body class="pagina-elegir"><main class="pagina">${cuerpo}</main></body></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }
  });
}

async function elegirParroquia(c) {
  const lista = await parroquiasActivas(c);
  const items = lista.map((p) => `<li><a class="elegir-parroquia" href="/${escapar(p.slug)}/reproductor">
    <img src="${escapar(p.icono)}" alt="" width="56" height="56"><span><strong>${escapar(p.nombre)}</strong></span></a></li>`).join('');
  return htmlBasico('Cancionero Litúrgico · Elegí tu parroquia', `<h1>Cancionero Litúrgico</h1>
    <p class="subtitulo">Elegí tu parroquia. El equipo la recuerda para la próxima vez.</p>
    <ul class="lista-elegir">${items || '<li>Todavía no hay parroquias.</li>'}</ul>`);
}

function noDisponible(p) {
  return htmlBasico('Parroquia no disponible', `<h1>${escapar(p ? p.nombre : 'Parroquia no encontrada')}</h1>
    <p class="subtitulo">${p ? 'Esta parroquia no está disponible por ahora.' : 'No existe esa parroquia en el Cancionero Litúrgico.'}</p>
    <p><a class="btn btn-primario" href="/elegir">Elegir otra parroquia</a></p>`, 404);
}

// El nombre, el logo y el manifest de la parroquia en la página base; propia: {slug, titulo, html} en pagina.html
function conParroquia(res, p, pagina, propia = null) {
  const pub = parroquiaPublica(p);
  const datos = JSON.stringify(pub).replace(/</g, '\\u003c');
  const titulo = (propia ? propia.titulo : pagina === 'reproductor' || pagina === 'inicio' ? 'Cancionero Litúrgico' : PAGINAS[pagina]) + ' · ' + pub.nombre;
  const menu = pub.paginas.filter((x) => x.enMenu).map((x) => `<li><a href="/${escapar(pub.slug)}/p/${escapar(x.slug)}"` +
    (propia && propia.slug === x.slug ? ' aria-current="page"' : '') + `>${escapar(x.titulo)}</a></li>`).join('');
  const marca = `<span class="nav-marca-textos"><span class="nav-marca-app">Cancionero Litúrgico</span>` +
    `<span class="nav-marca-parroquia">${escapar(pub.nombre)}</span></span>`;
  const iconos = `<link rel="icon" type="image/png" sizes="192x192" href="${escapar(pub.iconos['192'])}">` +
    `<link rel="apple-touch-icon" href="${escapar(pub.iconos['180'])}">`;
  const quitar = { element: (el) => el.remove() };
  return new HTMLRewriter()
    .on('head', { element: (el) => {
      el.prepend(`<meta name="parroquia" content="${escapar(pub.slug)}"><script>window.MC_PARROQUIA=${datos};</script>`, { html: true });
      el.append(iconos, { html: true });
    } })
    .on('title', { element: (el) => el.setInnerContent(titulo) })
    .on('link[rel="icon"]', quitar)
    .on('link[rel="apple-touch-icon"]', quitar)
    .on('link[rel="manifest"]', { element: (el) => el.setAttribute('href', '/' + pub.slug + '/reproductor.webmanifest') })
    .on('meta[name="description"]', { element: (el) => el.setAttribute('content', 'Cancionero Litúrgico de la ' + pub.nombre + ': canciones para la misa con su letra, acordes y audio, noticias y cancioneros de sus comunidades.') })
    .on('.nav-marca', { element: (el) => el.setInnerContent(marca, { html: true }) })
    .on('.nav-links', { element: (el) => { if (menu) el.append(menu, { html: true }); } })
    .on('[data-pagina-titulo]', { element: (el) => { if (propia) el.setInnerContent(propia.titulo); } })
    .on('[data-pagina-propia]', { element: (el) => { if (propia) el.setInnerContent(propia.html, { html: true }); } })
    .on('[data-parroquia="nombre"]', { element: (el) => el.setInnerContent(pub.nombre) })
    .on('[data-parroquia="corto"]', { element: (el) => el.setInnerContent(pub.nombreCorto) })
    .on('[data-parroquia="portada"]', { element: (el) => {
      const url = pub.portada.replace(/['"\\()\s]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
      if (url) el.setAttribute('style', `--portada:url('${url}')`);
    } })
    .transform(res);
}

function manifest(p) {
  const pub = parroquiaPublica(p);
  const icono = (t, purpose) => ({ src: pub.iconos[t].replace('/' + pub.slug + '/', ''), sizes: t + 'x' + t, type: 'image/png', purpose });
  return new Response(JSON.stringify({
    id: './reproductor?app=1',
    name: 'Cancionero Litúrgico · ' + pub.nombreCorto,
    short_name: pub.nombreCorto.length <= 14 ? pub.nombreCorto : 'Cancionero',
    description: 'Canciones para la misa de la ' + pub.nombre + ', con su letra, acordes y audio.',
    lang: 'es',
    start_url: './reproductor?app=1',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: '#030303',
    theme_color: '#030303',
    categories: ['music', 'lifestyle'],
    icons: [icono('192', 'any'), icono('512', 'any'), icono('512', 'maskable')]
  }, null, 2), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' } });
}

// El editor (/editor/) es común: su página pide este manifest para instalarse con el nombre y el logo de la parroquia
function manifestEditor(p) {
  const pub = parroquiaPublica(p);
  const icono = (t, purpose) => ({ src: pub.iconos[t], sizes: t + 'x' + t, type: 'image/png', purpose });
  return new Response(JSON.stringify({
    id: '/editor/?parroquia=' + pub.slug,
    name: 'Editor de cancioneros · ' + pub.nombreCorto,
    short_name: ('Editor ' + pub.nombreCorto).length <= 14 ? 'Editor ' + pub.nombreCorto : 'Editor',
    description: 'Editor y atril de cancioneros de la ' + pub.nombre + ', con acordes, transposición y audios.',
    lang: 'es',
    start_url: '/editor/',
    scope: '/editor/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f9fbfd',
    theme_color: '#f9fbfd',
    categories: ['music', 'productivity', 'education'],
    icons: [icono('192', 'any'), icono('512', 'any'), icono('512', 'maskable')]
  }, null, 2), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' } });
}

// El service worker del reproductor: el mismo archivo en /<parroquia>/sw-reproductor.js y en /sw-reproductor.js
// (este último, el de la app instalada antes de que hubiera parroquias)
async function swReproductor(env, url) {
  const sw = await env.ASSETS.fetch(new URL('/sw-reproductor.js', url.origin).toString());
  const r = new Response(sw.body, sw);
  r.headers.set('Cache-Control', 'no-cache');
  return r;
}

async function pagina(ctx, c, p, nombre, propia = null) {
  const url = new URL(ctx.request.url);
  const res = await ctx.env.ASSETS.fetch(new URL('/' + nombre, url.origin).toString());
  if (!res.ok) return res;
  const limpia = new Response(res.body, res);
  for (const h of ['etag', 'last-modified', 'content-length']) limpia.headers.delete(h);
  limpia.headers.set('Cache-Control', 'no-cache');
  limpia.headers.append('Set-Cookie', conCookie(p.slug)['Set-Cookie']);
  return conParroquia(limpia, p, nombre, propia);
}

async function paginaPropia(ctx, c, p, slug) {
  const x = await leerPaginaPropia(c, p.slug, slug);
  if (!x) {
    return htmlBasico('Página no encontrada · ' + p.nombre, `<h1>${escapar(p.nombre)}</h1>
      <p class="subtitulo">Esa página no existe o ya no está publicada.</p>
      <p><a class="btn btn-primario" href="/${escapar(p.slug)}/inicio">Ir al inicio de la parroquia</a></p>`, 404);
  }
  // Se guarda limpio; se vuelve a limpiar por si alguien lo cambió directo en la base
  return pagina(ctx, c, p, 'pagina', { slug: x.slug, titulo: x.titulo || x.slug, html: await limpiarHtml(x.html) });
}

export async function atenderPagina(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const ruta = url.pathname;
  if (ruta === '/api' || ruta.startsWith('/api/')) return ctx.next();
  if (request.method !== 'GET' && request.method !== 'HEAD' && !/^\/[a-z0-9-]+\/api(\/|$)/.test(ruta)) return ctx.next();
  let c;
  try {
    c = contexto(ctx);
  } catch (_) {
    return ctx.next();
  }

  if (ruta === '/sw-reproductor.js') return swReproductor(env, url);
  // La app instalada antes de que hubiera parroquias abre /reproductor (su «scope» es /reproductor): se le sirve
  // ahí mismo el de la parroquia del equipo. Redirigida a /<parroquia>/ quedaría fuera de su scope y el teléfono la
  // mostraría como pestaña del navegador, con barra de dirección, en vez de como app.
  if (ruta === '/reproductor') {
    const p = await leerParroquia(c, await parroquiaDelEquipo(c, request));
    if (p) return pagina(ctx, c, p, 'reproductor');
  }
  const iconoRaiz = ruta.match(/^\/icono-(180|192|512)\.png$/);
  if (iconoRaiz) return respuestaIcono(c, await parroquiaDelEquipo(c, request), iconoRaiz[1], env.ASSETS, url);
  if (ruta === '/elegir') return elegirParroquia(c);
  if (ruta === '/') {
    const s = cookieParroquia(request);
    const p = s ? await leerParroquia(c, s) : null;
    if (p && p.activa) return redirigir('/' + p.slug + '/reproductor' + url.search);
    const lista = await parroquiasActivas(c);
    if (lista.length === 1) return redirigir('/' + lista[0].slug + '/reproductor' + url.search);
    return elegirParroquia(c);
  }
  // Direcciones de antes: a la misma página de la parroquia del equipo (o la principal)
  const vieja = ruta.match(VIEJAS);
  if (vieja) {
    const nombre = vieja[1] === 'index' ? 'reproductor' : vieja[1];
    return redirigir('/' + await parroquiaDelEquipo(c, request) + '/' + nombre + url.search);
  }
  const comunidadVieja = ruta.match(/^\/comunidades\/([a-z0-9-]+?)(\.html)?$/);
  if (comunidadVieja) return redirigir('/' + await parroquiaDelEquipo(c, request) + '/comunidad?c=' + comunidadVieja[1]);

  const m = ruta.match(/^\/([a-z0-9-]{3,40})(\/.*)?$/);
  if (!m || !slugValido(m[1])) return ctx.next();
  const slug = m[1];
  const resto = m[2] || '';
  const api = resto.match(/^\/api(\/.*)?$/);
  if (api) {
    const destino = new URL('/api' + (api[1] || '') + url.search, url.origin);
    return entrada({ ...ctx, request: new Request(destino, request) }, slug);
  }
  const p = await leerParroquia(c, slug);
  if (!p) return ctx.next();
  if (!p.activa) return noDisponible(p);

  if (resto === '' || resto === '/' || /^\/index(\.html)?$/.test(resto)) return redirigir('/' + slug + '/reproductor' + url.search);
  const pag = resto.match(/^\/([a-z]+)(\.html)?$/);
  if (pag && PAGINAS[pag[1]]) return pagina(ctx, c, p, pag[1]);
  const propia = resto.match(/^\/p\/([a-z0-9-]+)\/?$/);
  if (propia) return paginaPropia(ctx, c, p, propia[1]);
  if (resto === '/reproductor.webmanifest') return manifest(p);
  if (resto === '/editor.webmanifest') return manifestEditor(p);
  if (resto === '/sw-reproductor.js') return swReproductor(env, url);
  const icono = resto.match(/^\/icono-(180|192|512)\.png$/);
  if (icono) return respuestaIcono(c, slug, icono[1], env.ASSETS, url);
  if (resto === '/editor' || resto.startsWith('/editor/')) {
    return redirigir('/editor/' + resto.slice('/editor/'.length) + url.search, conCookie(slug));
  }
  const comunidadVieja2 = resto.match(/^\/comunidades\/([a-z0-9-]+?)(\.html)?$/);
  if (comunidadVieja2) return redirigir('/' + slug + '/comunidad?c=' + comunidadVieja2[1]);
  // Cualquier otro archivo pedido con ruta relativa desde una página de la parroquia: el archivo común
  return env.ASSETS.fetch(new URL(resto + url.search, url.origin).toString());
}
