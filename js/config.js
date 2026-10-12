// Configuración del sitio. El servidor es /<parroquia>/api en el mismo sitio (Cloudflare Pages); desde
// otra dirección (o abriendo el archivo) se usa el del sitio publicado.
// googleClientId: «ID de cliente» OAuth para el botón «Entrar con Google» (el mismo que GOOGLE_CLIENT_ID en
// wrangler.toml).
(function () {
  var SITIO = 'https://www.cancioneroliturgico.cl/';
  var VIEJO = { host: 'cancioneromontecarmelo.github.io', base: '/paginaweb/' };
  // Solo la dirección principal de Pages: las vistas previas (<rama>.montecarmelo-kxg.pages.dev) quedan para pruebas
  var PAGES = 'montecarmelo-kxg.pages.dev';
  var MIGRAR = '#mc-migrar=';

  // Las direcciones anteriores (GitHub Pages, pages.dev y cancioneroliturgico.cl sin www) llevan a la misma página
  // de www, con lo que el navegador tenía guardado (sesión, listas, preferencias): cada dirección tiene su propio
  // almacenamiento. Sin internet no se mueve: la copia guardada para usar sin conexión es la de esta dirección.
  // (Con internet, la dirección sin www ya la resuelve el servidor antes de llegar acá.)
  var desdeGithub = location.hostname === VIEJO.host;
  var desdePages = (location.hostname === PAGES || location.hostname === 'cancioneroliturgico.cl') && navigator.onLine !== false;
  if ((desdeGithub || desdePages) && !window.MONTECARMELO_CONFIG) {
    var ruta = desdePages ? location.pathname.slice(1)
      : location.pathname.indexOf(VIEJO.base) === 0 ? location.pathname.slice(VIEJO.base.length) : '';
    // Va en la dirección (Chrome acepta ~2 MB): primero lo chico (sesión, listas, preferencias)
    var guardado = {}, total = 0, todo = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i), v = localStorage.getItem(k);
        if (v != null) todo.push([k, v, encodeURIComponent(JSON.stringify(k) + JSON.stringify(v)).length]);
      }
    } catch (_) { /* sin almacenamiento */ }
    todo.sort(function (a, b) { return a[2] - b[2]; }).forEach(function (e) {
      if (total + e[2] < 1500000) { guardado[e[0]] = e[1]; total += e[2]; }
    });
    var datos = encodeURIComponent(JSON.stringify({ ls: guardado, h: location.hash }));
    location.replace(SITIO + ruta + location.search + MIGRAR + datos);
    window.MONTECARMELO_CONFIG = {};
    return;
  }

  if (location.hash.indexOf(MIGRAR) === 0) {
    try {
      var m = JSON.parse(decodeURIComponent(location.hash.slice(MIGRAR.length)));
      Object.keys(m.ls || {}).forEach(function (k) {
        if (localStorage.getItem(k) == null) localStorage.setItem(k, m.ls[k]);
      });
      history.replaceState(history.state, '', location.pathname + location.search + (m.h || ''));
    } catch (_) {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
  }

  // La parroquia: la página la trae puesta (functions/_middleware.js, en /<parroquia>/…); el editor (/editor/)
  // usa la última que se abrió en este equipo
  var datosParroquia = window.MC_PARROQUIA || null;
  var parroquia = datosParroquia && datosParroquia.slug;
  try {
    if (parroquia) localStorage.setItem('mc-parroquia', parroquia);
    else parroquia = localStorage.getItem('mc-parroquia') || '';
  } catch (_) { /* sin almacenamiento */ }
  if (!/^[a-z0-9-]{3,40}$/.test(parroquia || '')) parroquia = 'montecarmelo';

  var propio = /^https?:$/.test(location.protocol) && location.hostname !== VIEJO.host;
  var sitio = propio ? location.origin + '/' : SITIO;
  window.MONTECARMELO_CONFIG = {
    apiUrl: sitio + parroquia + '/api',
    sitio: sitio,
    parroquia: parroquia,
    // Las páginas de la parroquia: sitio + parroquia + '/'
    base: sitio + parroquia + '/',
    googleClientId: '446127505219-pei616euh78muqr6ak500br0ac41t2mk.apps.googleusercontent.com',
    correoParroquia: 'cancionerolitugico@gmail.com'
  };

  // Un Smart TV (o el equipo que ya se usó como pantalla) va directo al QR y el código para conectar el teléfono.
  // «mc-equipo»: "tv" lo recuerda; "normal" lo eligió quien no quiere el modo pantalla en este equipo.
  // Un computador con mouse nunca se desvía (ahí se editan las misas y los audios): si quedó marcado como
  // pantalla por una prueba, se olvida. Para usarlo como pantalla está la dirección /tv.
  var equipo = '';
  try { equipo = localStorage.getItem('mc-equipo') || ''; } catch (_) { /* sin almacenamiento */ }
  var esTv = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Android TV|GoogleTV|AFT[A-Z]|VIDAA|PhilipsTV|Opera TV|AppleTV|Large Screen/i.test(navigator.userAgent);
  var conMouse = !esTv && !!(window.matchMedia && matchMedia('(pointer: fine)').matches);
  if (conMouse && equipo === 'tv') {
    try { localStorage.removeItem('mc-equipo'); } catch (_) { /* sin almacenamiento */ }
    equipo = '';
  }
  var portada = /^\/([a-z0-9-]+\/)?(index\.html|reproductor(\.html)?)?$/.test(location.pathname) && !location.hash;
  if (portada && !conMouse && (equipo === 'tv' || (esTv && equipo !== 'normal'))) {
    location.replace(location.pathname === '/' ? '/#pantalla' : location.pathname.replace(/[^/]*$/, '') + 'reproductor#pantalla');
  }
})();
