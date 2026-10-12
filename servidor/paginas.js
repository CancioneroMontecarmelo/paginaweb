// Páginas de cada parroquia: /<parroquia>/<página> sirve la página base (inicio.html, misas.html…) con el
// nombre y el logo de esa parroquia. El reproductor es la página principal (/), con la parroquia de este equipo
// (cookie mc-parroquia), y la única app instalable (/app.webmanifest, /sw.js). CSS, JS, íconos comunes y el editor
// no pasan por acá (_routes.json): las páginas los piden con rutas absolutas (/css/…, /js/…).
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
const VIEJAS = /^\/(inicio|login|misas|noticias|tv|ver|comunidad)(\.html)?$/;
const COOKIE = 'mc-parroquia';
const UN_ANO = 31536000;
// La dirección principal es www: la otra lleva ahí (con lo guardado en el navegador, ver paginaMigrar)
const PRINCIPAL = 'www.cancioneroliturgico.cl';
const SECUNDARIA = 'cancioneroliturgico.cl';

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
  if (p && p.activa) return p.slug;
  const lista = await parroquiasActivas(c);
  return lista.length === 1 ? lista[0].slug : PARROQUIA_DEFECTO;
}

// Cada dirección tiene su propio almacenamiento: la página lleva la sesión, las listas y las preferencias a www
// en la dirección (#mc-migrar=, lo recibe js/config.js), primero lo chico, hasta ~1,5 MB
function paginaMigrar(url) {
  const destino = JSON.stringify('https://' + PRINCIPAL + url.pathname + url.search).replace(/</g, '\\u003c');
  return new Response(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cancionero Litúrgico</title><meta name="theme-color" content="#030303">
<script>(function () {
  var destino = ${destino}, guardado = {}, total = 0, todo = [], hay = false;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i), v = localStorage.getItem(k);
      if (v != null) todo.push([k, v, encodeURIComponent(JSON.stringify(k) + JSON.stringify(v)).length]);
    }
  } catch (_) {}
  todo.sort(function (a, b) { return a[2] - b[2]; }).forEach(function (e) {
    if (total + e[2] < 1500000) { guardado[e[0]] = e[1]; total += e[2]; hay = true; }
  });
  if (hay || location.hash) destino += '#mc-migrar=' + encodeURIComponent(JSON.stringify({ ls: guardado, h: location.hash }));
  location.replace(destino);
})();</script>
</head><body style="background:#030303;color:#ddd;font-family:sans-serif">
<noscript><p><a href=${destino} style="color:#fff">Abrir el Cancionero Litúrgico</a></p></noscript>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Las apps instaladas antes (/reproductor y /<parroquia>/reproductor) tenían su service worker: este lo da de baja
// y borra su copia; la app nueva es una sola, en la raíz (/sw.js)
const SW_RETIRO = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys()
  .then((k) => Promise.all(k.filter((n) => n.startsWith('mc-reproductor-')).map((n) => caches.delete(n))))
  .then(() => self.registration.unregister())));`;
const swRetiro = () => new Response(SW_RETIRO, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } });

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

function enlaceDeParroquia(slug, href) {
  const m = href.match(/^\.\/([a-z]+)(?:\.html)?([?#].*)?$/);
  if (!m) return href;
  if (m[1] === 'reproductor' || m[1] === 'index') return '/' + (m[2] || '');
  return '/' + slug + '/' + m[1] + (m[2] || '');
}

const IMAGEN_COMPARTIR = 'https://' + PRINCIPAL + '/Imagenes/compartir.png';

function descripcionDe(pub, pagina, propia) {
  if (propia) return propia.titulo + ' · ' + pub.nombre + ' · Cancionero Litúrgico.';
  if (pagina === 'inicio' && pub.descripcion) {
    const d = pub.descripcion.replace(/\s+/g, ' ').trim();
    return d.length > 300 ? d.slice(0, d.lastIndexOf(' ', 297)) + '…' : d;
  }
  if (pagina === 'misas') return 'Cancioneros de misa de las comunidades de la ' + pub.nombre + ': las canciones de cada momento con su letra, acordes y audio.';
  if (pagina === 'noticias') return 'Noticias y avisos de la ' + pub.nombre + '.';
  if (pagina === 'comunidad') return 'Comunidades de la ' + pub.nombre + ': sus noticias y sus cancioneros de misa.';
  return 'Cancionero Litúrgico de la ' + pub.nombre + ': canciones para la misa con su letra, acordes y audio, noticias y cancioneros de sus comunidades.';
}

// Para los buscadores y la vista previa al compartir: dirección canónica, Open Graph y datos estructurados
function etiquetasBuscadores(pub, pagina, titulo, descripcion, canonica) {
  const absoluta = (u) => (u.startsWith('/') ? 'https://' + PRINCIPAL + u : u);
  const parroquia = {
    '@type': 'Church', name: pub.nombre, url: 'https://' + PRINCIPAL + '/' + pub.slug + '/inicio', logo: absoluta(pub.iconos['512']),
    ...(pub.correo ? { email: pub.correo } : {})
  };
  const ld = pagina === 'reproductor' ? {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Cancionero Litúrgico', url: 'https://' + PRINCIPAL + '/',
    description: descripcion, inLanguage: 'es', applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web, Android, iOS, Windows, macOS, Linux', isAccessibleForFree: true, image: IMAGEN_COMPARTIR,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CLP' }, provider: parroquia
  } : pagina === 'inicio' ? { '@context': 'https://schema.org', ...parroquia, description: descripcion } : null;
  const meta = (k, v, atr = 'property') => `<meta ${atr}="${k}" content="${escapar(v)}">`;
  return `<link rel="canonical" href="${escapar(canonica)}">` + meta('description', descripcion, 'name') +
    meta('og:type', 'website') + meta('og:site_name', 'Cancionero Litúrgico') + meta('og:locale', 'es_CL') +
    meta('og:title', titulo) + meta('og:description', descripcion) + meta('og:url', canonica) +
    meta('og:image', IMAGEN_COMPARTIR) + meta('og:image:width', '1200') + meta('og:image:height', '630') +
    meta('twitter:card', 'summary_large_image', 'name') +
    (ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : '');
}

// El nombre, el logo y el manifest de la parroquia en la página base; propia: {slug, titulo, html} en pagina.html.
// canonica: la dirección de la página en www, para los buscadores
function conParroquia(res, p, pagina, propia, canonica) {
  const pub = parroquiaPublica(p);
  const datos = JSON.stringify(pub).replace(/</g, '\\u003c');
  const titulo = (propia ? propia.titulo : pagina === 'reproductor' || pagina === 'inicio' ? 'Cancionero Litúrgico' : PAGINAS[pagina]) + ' · ' + pub.nombre;
  const descripcion = descripcionDe(pub, pagina, propia);
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
      el.append(etiquetasBuscadores(pub, pagina, titulo, descripcion, canonica), { html: true });
    } })
    .on('title', { element: (el) => el.setInnerContent(titulo) })
    .on('link[rel="icon"]', quitar)
    .on('link[rel="apple-touch-icon"]', quitar)
    .on('link[rel="manifest"]', { element: (el) => el.setAttribute('href', '/app.webmanifest') })
    // El reproductor se sirve también en la raíz: los enlaces relativos (./inicio.html…) van a la parroquia
    .on('a[href^="./"]', { element: (el) => el.setAttribute('href', enlaceDeParroquia(pub.slug, el.getAttribute('href'))) })
    // Las de la página base se cambian por las de esta parroquia y esta dirección
    .on('meta[name="description"]', quitar)
    .on('link[rel="canonical"]', quitar)
    .on('meta[property^="og:"]', quitar)
    .on('meta[name^="twitter:"]', quitar)
    .on('script[type="application/ld+json"]', quitar)
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

async function pagina(ctx, c, p, nombre, propia = null) {
  const url = new URL(ctx.request.url);
  const res = await ctx.env.ASSETS.fetch(new URL('/' + nombre, url.origin).toString());
  if (!res.ok) return res;
  const limpia = new Response(res.body, res);
  for (const h of ['etag', 'last-modified', 'content-length']) limpia.headers.delete(h);
  limpia.headers.set('Cache-Control', 'no-cache');
  limpia.headers.append('Set-Cookie', conCookie(p.slug)['Set-Cookie']);
  const canonica = 'https://' + PRINCIPAL + (nombre === 'reproductor' ? '/' : url.pathname.replace(/\.html$/, '') + (nombre === 'comunidad' ? url.search : ''));
  return conParroquia(limpia, p, nombre, propia, canonica);
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

// Para los buscadores: las páginas públicas de todas las parroquias activas (las ocultas, de prueba, no)
async function sitemap(c) {
  const base = 'https://' + PRINCIPAL;
  const rutas = [['/', '1.0'], ['/acerca', '0.9'], ['/editor/', '0.5']];
  for (const { slug } of await parroquiasActivas(c)) {
    const p = await leerParroquia(c, slug);
    if (!p || !p.activa) continue;
    rutas.push(['/' + slug + '/inicio', '0.8'], ['/' + slug + '/misas', '0.7'], ['/' + slug + '/noticias', '0.6']);
    for (const x of p.comunidades) rutas.push(['/' + slug + '/comunidad?c=' + encodeURIComponent(x.slug), '0.5']);
    for (const x of p.paginas || []) rutas.push(['/' + slug + '/p/' + encodeURIComponent(x.slug), '0.5']);
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rutas.map(([r, prioridad]) => `  <url><loc>${escapar(base + r)}</loc><priority>${prioridad}</priority></url>`).join('\n') + '\n</urlset>\n';
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=21600' } });
}

export async function atenderPagina(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const ruta = url.pathname;
  if (url.hostname === SECUNDARIA) {
    if (/^\/([a-z0-9-]+\/)?sw-reproductor\.js$/.test(ruta)) return swRetiro();
    const navega = request.method === 'GET' && (request.headers.get('Sec-Fetch-Mode') === 'navigate' ||
      (request.headers.get('Accept') || '').includes('text/html'));
    if (navega) return paginaMigrar(url);
    return new Response(null, { status: 308, headers: {
      Location: 'https://' + PRINCIPAL + ruta + url.search, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'
    } });
  }
  if (ruta === '/api' || ruta.startsWith('/api/')) return ctx.next();
  if (request.method !== 'GET' && request.method !== 'HEAD' && !/^\/[a-z0-9-]+\/api(\/|$)/.test(ruta)) return ctx.next();
  let c;
  try {
    c = contexto(ctx);
  } catch (_) {
    return ctx.next();
  }

  if (ruta === '/sitemap.xml') return sitemap(c);

  // El reproductor es la página principal (y la app instalable, con alcance /), con la parroquia de este equipo
  if (ruta === '/') {
    const p = await leerParroquia(c, await parroquiaDelEquipo(c, request));
    if (p) return pagina(ctx, c, p, 'reproductor');
    return elegirParroquia(c);
  }
  if (/^\/(index|reproductor)(\.html)?$/.test(ruta)) return redirigir('/' + url.search);
  if (ruta === '/sw-reproductor.js') return swRetiro();
  const iconoRaiz = ruta.match(/^\/icono-(180|192|512)\.png$/);
  if (iconoRaiz) return respuestaIcono(c, await parroquiaDelEquipo(c, request), iconoRaiz[1], env.ASSETS, url);
  if (ruta === '/elegir') return elegirParroquia(c);
  // Direcciones de antes: a la misma página de la parroquia del equipo (o la principal)
  const vieja = ruta.match(VIEJAS);
  if (vieja) return redirigir('/' + await parroquiaDelEquipo(c, request) + '/' + vieja[1] + url.search);
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

  // El reproductor de la parroquia es la página principal con esta parroquia elegida
  if (resto === '' || resto === '/' || /^\/(index|reproductor)(\.html)?$/.test(resto)) return redirigir('/' + url.search, conCookie(slug));
  const pag = resto.match(/^\/([a-z]+)(\.html)?$/);
  if (pag && PAGINAS[pag[1]]) return pagina(ctx, c, p, pag[1]);
  const propia = resto.match(/^\/p\/([a-z0-9-]+)\/?$/);
  if (propia) return paginaPropia(ctx, c, p, propia[1]);
  if (resto === '/reproductor.webmanifest') return manifest(p);
  if (resto === '/editor.webmanifest') return manifestEditor(p);
  if (resto === '/sw-reproductor.js') return swRetiro();
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
