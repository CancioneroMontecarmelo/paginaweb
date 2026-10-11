'use strict';
// App del reproductor: con internet siempre se carga la versión más nueva (y se guarda una copia);
// sin internet, o si la red tarda, se usa la copia guardada. Ni el servidor (/api), ni YouTube, ni los audios pasan por acá.
// Cloudflare Pages sirve las páginas sin «.html» (reproductor.html redirige a reproductor): se guarda esa dirección.
// Cada parroquia tiene el suyo en /<parroquia>/sw-reproductor.js (lo sirve functions/_middleware.js desde este
// archivo): lo relativo (la página, el manifest y el logo) es de la parroquia; CSS y JS son comunes (/css, /js).
// La app instalada antes de que hubiera parroquias usa este mismo archivo en /sw-reproductor.js, para /reproductor.

const CACHE = 'mc-reproductor-18';
const NET_TIMEOUT = 3000;
const SHELL = [
  'reproductor', 'reproductor.webmanifest', '/js/config.js?v=2',
  'icono-180.png', 'icono-192.png', 'icono-512.png',
  ...['site', 'posturas', 'partituras', 'voces', 'reproductor'].map((n) => `/css/${n}.css`),
  ...['reproductor', 'auth', 'comunidades', 'liturgia', 'posturas', 'partituras', 'voces', 'youtube-embed', 'misas-shim', 'sala', 'lector-qr'].map((n) => `/js/${n}.js`),
  '/js/vendor/qrcode.mjs',
  ...['acordes', 'markdown', 'etiquetas', 'buscar', 'instrumentos', 'rasgueos', 'render', 'caratula'].map((n) => `/editor/js/${n}.js`)
];

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
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mc-reproductor-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || /^\/([a-z0-9-]+\/)?api(\/|$)/.test(url.pathname) || req.headers.has('range') ||
      /\.(m4a|mp3|webm|ogg|opus|wav|aac)$/i.test(url.pathname)) return;
  const net = fetch(req, { cache: 'no-cache' });
  e.waitUntil(net.then((res) => {
    if (!res.ok || res.type !== 'basic' || res.redirected) return;
    const copy = res.clone();
    return caches.open(CACHE).then((c) => c.put(req, copy));
  }).catch(() => {}));
  e.respondWith(networkFirst(req, net));
});

async function networkFirst(req, net) {
  const cache = await caches.open(CACHE);
  const cached = () => cache.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? cache.match('reproductor') : undefined));
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
