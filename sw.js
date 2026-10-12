'use strict';
// La app del Cancionero Litúrgico (alcance /): con internet siempre se carga la versión más nueva (y se guarda una
// copia); sin internet, o si la red tarda, se usa la copia guardada. Solo pasan por acá la página principal (el
// reproductor) y los archivos comunes (/css, /js, /editor/js, /icons): ni el servidor (/api), ni las demás páginas,
// ni YouTube, ni los audios.

const CACHE = 'mc-app-3';
const NET_TIMEOUT = 3000;
const SHELL = [
  '/', '/app.webmanifest', '/js/config.js?v=2',
  '/icons/reproductor-180.png', '/icons/reproductor-192.png', '/icons/reproductor-512.png',
  ...['site', 'posturas', 'partituras', 'voces', 'reproductor'].map((n) => `/css/${n}.css`),
  ...['reproductor', 'auth', 'comunidades', 'liturgia', 'posturas', 'partituras', 'voces', 'youtube-embed', 'misas-shim', 'sala', 'lector-qr'].map((n) => `/js/${n}.js`),
  '/js/vendor/qrcode.mjs',
  ...['acordes', 'markdown', 'etiquetas', 'buscar', 'instrumentos', 'rasgueos', 'render', 'caratula'].map((n) => `/editor/js/${n}.js`)
];
const COMUN = /^\/(css|js|editor\/js|icons)\//;

// Sin cache.add: en Chrome, un archivo que falla (404) hace fallar la instalación entera aunque se atrape el error.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'reload' })
      .then((res) => (res.ok && !res.redirected ? c.put(u, res) : undefined))
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
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  const principal = req.mode === 'navigate' && url.pathname === '/';
  if (!principal && !COMUN.test(url.pathname) && url.pathname !== '/app.webmanifest') return;
  const net = fetch(req, { cache: 'no-cache' });
  e.waitUntil(net.then((res) => {
    if (!res.ok || res.type !== 'basic' || res.redirected) return;
    const copy = res.clone();
    return caches.open(CACHE).then((c) => c.put(principal ? '/' : req, copy));
  }).catch(() => {}));
  e.respondWith(networkFirst(req, net, principal));
});

async function networkFirst(req, net, principal) {
  const cache = await caches.open(CACHE);
  const cached = () => (principal ? cache.match('/') : cache.match(req, { ignoreSearch: true }));
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
