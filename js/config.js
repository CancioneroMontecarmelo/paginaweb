// Configuración del sitio. El servidor de la parroquia es /api en el mismo sitio (Cloudflare Pages); desde
// otra dirección (o abriendo el archivo) se usa el del sitio publicado.
// googleClientId: «ID de cliente» OAuth para el botón «Entrar con Google» (el mismo que GOOGLE_CLIENT_ID en
// wrangler.toml).
(function () {
  var SITIO = 'https://montecarmelo-kxg.pages.dev/';
  var VIEJO = { host: 'cancioneromontecarmelo.github.io', base: '/paginaweb/' };
  var MIGRAR = '#mc-migrar=';

  // El sitio viejo (GitHub Pages) lleva a la misma página del nuevo, con lo que el navegador tenía guardado
  // (sesión, listas, preferencias): cada dirección tiene su propio almacenamiento
  if (location.hostname === VIEJO.host && !window.MONTECARMELO_CONFIG) {
    var ruta = location.pathname.indexOf(VIEJO.base) === 0 ? location.pathname.slice(VIEJO.base.length) : '';
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

  var propio = /^https?:$/.test(location.protocol) && location.hostname !== VIEJO.host;
  window.MONTECARMELO_CONFIG = {
    apiUrl: (propio ? location.origin + '/' : SITIO) + 'api',
    sitio: propio ? location.origin + '/' : SITIO,
    googleClientId: '446127505219-pei616euh78muqr6ak500br0ac41t2mk.apps.googleusercontent.com',
    correoParroquia: 'cancionerolitugico@gmail.com'
  };

  // Un Smart TV (o el equipo que ya se usó como pantalla) va directo al QR y el código para conectar el teléfono.
  // «mc-equipo»: "tv" lo recuerda; "normal" lo eligió quien no quiere el modo pantalla en este equipo.
  var equipo = '';
  try { equipo = localStorage.getItem('mc-equipo') || ''; } catch (_) { /* sin almacenamiento */ }
  var esTv = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Android TV|GoogleTV|AFT[A-Z]|VIDAA|PhilipsTV|Opera TV|AppleTV|Large Screen/i.test(navigator.userAgent);
  var portada = /\/(index\.html|inicio(\.html)?|reproductor(\.html)?)?$/.test(location.pathname) && !location.hash;
  if (portada && (equipo === 'tv' || (esTv && equipo !== 'normal'))) {
    location.replace(location.pathname.replace(/[^/]*$/, '') + 'reproductor#pantalla');
  }
})();
