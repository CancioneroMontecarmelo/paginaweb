'use strict';
// La app del Cancionero Litúrgico (alcance /): con internet siempre se carga la versión más nueva (y se guarda una
// copia); sin internet, o si la red tarda, se usa la copia guardada. Solo pasan por acá el reproductor (/ y
// /<parroquia>/) y los archivos comunes (/css, /js, /editor/js, /icons): ni el servidor (/api), ni las demás páginas,
// ni YouTube. Los audios bajados con «Bajar audios» (caché «mc-audios») se sirven desde el equipo.
// El aviso del sábado (Web Push) llega sin contenido: se pide el texto a la parroquia y se guardan las letras del
// cancionero del domingo (caché «mc-datos», con la misma dirección que pide el reproductor).

const CACHE = 'mc-app-8';
const DATOS = 'mc-datos';
const AUDIOS = 'mc-audios';
const AVISO = '/__aviso';
const NET_TIMEOUT = 3000;
const SHELL = [
  '/', '/app.webmanifest', '/js/config.js?v=2',
  '/icons/reproductor-180.png', '/icons/reproductor-192.png', '/icons/reproductor-512.png',
  ...['site', 'posturas', 'partituras', 'voces', 'dialogos', 'reproductor'].map((n) => `/css/${n}.css`),
  ...['reproductor', 'auth', 'comunidades', 'liturgia', 'posturas', 'partituras', 'voces', 'youtube-embed', 'misas-shim', 'sala', 'lector-qr',
    'cambiar-cancion', 'momento-nuevo', 'aviso', 'tarjeta'].map((n) => `/js/${n}.js`),
  '/js/vendor/qrcode.mjs',
  ...['acordes', 'markdown', 'etiquetas', 'buscar', 'instrumentos', 'rasgueos', 'render', 'caratula'].map((n) => `/editor/js/${n}.js`)
];
const COMUN = /^\/(css|js|editor\/js|icons)\//;
const REPRODUCTOR = /^\/([a-z0-9-]{3,40}\/)?$/;
const AUDIO = /^\/[a-z0-9-]{3,40}\/api\/audio\//;

// Sin cache.add: en Chrome, un archivo que falla (404) hace fallar la instalación entera aunque se atrape el error.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'reload' })
      .then((res) => (res.ok && !res.redirected && res.headers.get('X-Mc-Pagina') !== 'portada' ? c.put(u, res) : undefined))
      .catch(() => {}))))
    .catch(() => {})
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('mc-app-') && k !== CACHE) || k.startsWith('mc-reproductor-')).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (AUDIO.test(url.pathname)) {
    e.respondWith(audioGuardado(req));
    return;
  }
  if (req.headers.has('range')) return;
  const principal = req.mode === 'navigate' && REPRODUCTOR.test(url.pathname);
  if (!principal && !COMUN.test(url.pathname) && url.pathname !== '/app.webmanifest') return;
  const clave = principal ? url.pathname : req;
  const net = fetch(req, { cache: 'no-cache' });
  e.waitUntil(net.then((res) => {
    // La portada nacional (/ sin parroquia elegida) no reemplaza la copia del reproductor
    if (!res.ok || res.type !== 'basic' || res.redirected || res.headers.get('X-Mc-Pagina') === 'portada') return;
    const copy = res.clone();
    return caches.open(CACHE).then((c) => c.put(clave, copy));
  }).catch(() => {}));
  e.respondWith(networkFirst(req, net, principal ? url.pathname : ''));
});

async function networkFirst(req, net, ruta) {
  const cache = await caches.open(CACHE);
  const cached = async () => (ruta ? (await cache.match(ruta)) || (await cache.match('/')) : cache.match(req, { ignoreSearch: true }));
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, NET_TIMEOUT); }).then(cached);
  try {
    const first = await Promise.race([net, slow.then((r) => r || net)]);
    clearTimeout(timer);
    return first;
  } catch (err) {
    clearTimeout(timer);
    const r = await cached();
    if (r) return r;
    throw err;
  }
}

// Un audio bajado se sirve desde el equipo, también por partes (el <audio> pide «Range» para adelantar)
async function audioGuardado(req) {
  const guardado = await caches.open(AUDIOS).then((c) => c.match(req.url)).catch(() => null);
  if (!guardado) return fetch(req);
  const rango = req.headers.get('range');
  if (!rango) return guardado;
  const datos = await guardado.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(rango) || [];
  const total = datos.byteLength;
  let desde = m[1] ? Number(m[1]) : 0;
  let hasta = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
  if (!m[1] && m[2]) { desde = Math.max(0, total - Number(m[2])); hasta = total - 1; }
  if (desde >= total || desde > hasta) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  return new Response(datos.slice(desde, hasta + 1), {
    status: 206,
    headers: {
      'Content-Type': guardado.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${desde}-${hasta}/${total}`,
      'Content-Length': String(hasta - desde + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

// ==================== AVISO DEL SÁBADO ====================

async function datosAviso() {
  try {
    const r = await (await caches.open(DATOS)).match(AVISO);
    return r ? await r.json() : null;
  } catch (_) {
    return null;
  }
}

async function guardarLetras(api, ids) {
  const cache = await caches.open(DATOS);
  await Promise.all(ids.slice(0, 40).map(async (id) => {
    const url = api + '?' + new URLSearchParams({ accion: 'cancion', id });
    try {
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    } catch (_) { /* sin conexión: queda la que había */ }
  }));
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const a = await datosAviso();
    let aviso = { titulo: 'Mañana es domingo 🎶', cuerpo: 'Prepara los cantos de la misa.', url: '/?app=1', canciones: [] };
    if (a && a.parroquia) {
      const api = location.origin + '/' + a.parroquia + '/api';
      try {
        const r = await (await fetch(api + '?' + new URLSearchParams({ accion: 'avisoDomingo', comunidad: a.comunidad || '' }))).json();
        if (r.ok) aviso = r;
      } catch (_) { /* sin conexión: el aviso genérico */ }
      if (aviso.canciones && aviso.canciones.length) await guardarLetras(api, aviso.canciones);
    }
    await self.registration.showNotification(aviso.titulo, {
      body: aviso.cuerpo, icon: '/icons/reproductor-192.png', badge: '/icons/reproductor-192.png',
      tag: 'aviso-sabado', data: { url: aviso.url || '/?app=1' }
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || '/?app=1', location.origin).href;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of abiertas) {
      if (new URL(w.url).origin === location.origin && 'navigate' in w) {
        await w.focus();
        return w.navigate(destino).catch(() => {});
      }
    }
    return self.clients.openWindow(destino);
  })());
});
