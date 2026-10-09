'use strict';
// Nube de la parroquia: guarda el cancionero abierto en el servidor de la parroquia (/api, servidor/) y lo
// vuelve a abrir desde ahí. Cada cancionero queda en su carpeta:
//   cancionero.m3u8 · canciones/*.md · audios/* · <Título>.html (página con los audios adentro)
// Sin apiUrl en js/config.js solo funcionan las carpetas del equipo.

const MC_API = (window.MONTECARMELO_CONFIG || {}).apiUrl || '';
const MC_SESION = 'montecarmelo.sesion';
const MC_MAX_ARCHIVO = 30 * 1024 * 1024;
const MC_COMUNIDADES = {
  'maria-de-nazaret': 'Capilla María de Nazaret',
  'san-pablo-apostol': 'San Pablo Apóstol',
  'sagrada-familia': 'Sagrada Familia',
  'monte-carmelo': 'Nuestra Señora del Monte Carmelo'
};
const MC_ROLES_TODAS = ['admin_general', 'admin_segundo', 'sacerdote'];
const mcVerUrl = htmlId => new URL('../ver.html?id=' + encodeURIComponent(htmlId), location.href).href;

// ============ SESIÓN (la misma del sitio: js/auth.js) ============
function mcDatosToken(token) {
  try {
    const p = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)));
  } catch (_) {
    return null;
  }
}

const mcTokenVigente = token => (mcDatosToken(token)?.exp || 0) > Date.now() + 60000;

function mcRenovarToken(nuevo) {
  try {
    const s = JSON.parse(localStorage.getItem(MC_SESION));
    if (!s?.token || s.email !== mcDatosToken(nuevo)?.email) return;
    localStorage.setItem(MC_SESION, JSON.stringify({ ...s, token: nuevo, renovada: Date.now() }));
  } catch (_) { /* sin almacenamiento: queda la sesión anterior */ }
}

// Token rechazado por el servidor: se olvida solo el token (la sesión del sitio sigue) y se pide entrar de nuevo
function mcOlvidarToken(rechazado) {
  try {
    const s = JSON.parse(localStorage.getItem(MC_SESION));
    if (s?.token && s.token === (rechazado || s.token)) localStorage.setItem(MC_SESION, JSON.stringify({ ...s, token: '' }));
  } catch (_) { /* sin almacenamiento */ }
}

// Mantiene viva la sesión mientras el editor está abierto, también al volver del reposo
const MC_RENOVAR_CADA = 30 * 60 * 1000;
let mcRenovando = false;
function mcRenovarSesion() {
  const s = mcSesion();
  if (!MC_API || !s || mcRenovando || Date.now() - (s.renovada || s.desde || 0) < MC_RENOVAR_CADA) return;
  mcRenovando = true;
  mcApi('sesion', { token: s.token }, false).catch(() => {}).finally(() => { mcRenovando = false; });
}
mcRenovarSesion();
setInterval(mcRenovarSesion, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) mcRenovarSesion(); });
addEventListener('focus', mcRenovarSesion);
addEventListener('online', mcRenovarSesion);

function mcSesion() {
  try {
    const s = JSON.parse(localStorage.getItem(MC_SESION));
    return s?.token && mcTokenVigente(s.token) ? s : null;
  } catch (_) {
    return null;
  }
}

function mcPintarSesion() {
  const s = mcSesion();
  const box = $('#mcSesion');
  box.textContent = s ? '👤 ' + (s.nombres || s.nombre || s.email) : '';
  box.title = s ? `${s.nombre || ''} · ${s.email}` : '';
}

// Si la sesión venció a mitad de un guardado, pide entrar con Google y repite el pedido sin perder nada
async function mcApi(accion, datos = {}, reingreso = true) {
  let r;
  try {
    const res = await fetch(MC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, ...datos })
    });
    r = await res.json();
  } catch (_) {
    throw new Error('No se pudo conectar con el servidor de la parroquia. Revisa tu conexión a internet.');
  }
  if (!r.ok) {
    if (/sesi[oó]n (inv[aá]lida|venci[oó])/i.test(r.error || '')) {
      mcOlvidarToken(datos.token);
      mcPintarSesion();
      if (reingreso && 'token' in datos) {
        const s = await mcEntrar('Tu sesión se cerró. No se perdió nada: al entrar se completa lo que estabas guardando.');
        if (s?.token) return mcApi(accion, { ...datos, token: s.token }, false);
      }
    }
    throw new Error(r.error || 'El servidor de la parroquia no respondió.');
  }
  if (r.token && datos.token) mcRenovarToken(r.token);
  return r;
}

// Sube un archivo tal cual (PUT /api/subir?tipo=…, sin base64); como mcApi, si la sesión venció pide entrar y repite
async function mcSubir(tipo, params, blob, token, reingreso = true) {
  let r;
  try {
    const res = await fetch(MC_API + '/subir?' + new URLSearchParams({ tipo, ...params }), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob
    });
    r = await res.json();
  } catch (_) {
    throw new Error('No se pudo conectar con el servidor de la parroquia. Revisa tu conexión a internet.');
  }
  if (!r.ok) {
    if (/sesi[oó]n (inv[aá]lida|venci[oó])/i.test(r.error || '')) {
      mcOlvidarToken(token);
      mcPintarSesion();
      if (reingreso) {
        const s = await mcEntrar('Tu sesión se cerró. No se perdió nada: al entrar se completa lo que estabas guardando.');
        if (s?.token) return mcSubir(tipo, params, blob, s.token, false);
      }
    }
    throw new Error(r.error || 'El servidor de la parroquia no respondió.');
  }
  if (r.token) mcRenovarToken(r.token);
  return r;
}

function mcConfigurado() {
  if (MC_API) return true;
  showModal({
    title: 'Nube de la parroquia',
    body: `<p>El servidor de la parroquia todavía no está conectado: falta su dirección en <code>js/config.js</code>.</p>
      <p class="hint">Mientras tanto puedes guardar el cancionero en tu equipo con <b>Archivo → Guardar como (en este equipo) → Cancionero</b>.</p>`
  });
  return false;
}

function mcError(titulo, e) {
  toast('');
  showModal({ title: titulo, body: `<p>${escapeHtml(e.message || String(e))}</p>` });
}

// Devuelve la sesión con token, pidiendo entrar con Google si hace falta (null si se canceló)
async function mcEntrar(motivo) {
  const vigente = mcSesion();
  if (vigente) return vigente;
  let sesion = null;
  if ($('#modal').open) $('#modal').close();
  await showModal({
    title: 'Identificarse',
    body: `<p>${escapeHtml(motivo || 'Para usar la nube de la parroquia entra con tu cuenta de Google (no hace falta clave).')}</p>
      <div id="mcGoogle" style="min-height:44px;margin:.75rem 0"></div>
      <p class="hint">Si tu cuenta todavía no tiene permisos, pídeselos al administrador de la parroquia.</p>`,
    onOpen: d => {
      import(new URL('../js/auth.js', document.baseURI).href)
        .then(auth => auth.botonGoogle(d.querySelector('#mcGoogle'), s => {
          sesion = s;
          mcPintarSesion();
          d.close();
        }, e => modalFail(d, e.message)))
        .catch(e => modalFail(d, e.message));
    },
    buttons: [{ label: 'Cancelar' }]
  });
  return sesion;
}

// ============ GUARDAR ============
const mcFecha = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

async function driveSaveDialog() {
  if (!mcConfigurado()) return;
  syncFromEditor();
  const songs = bookSongs();
  if (!songs.length) { toast('No hay canciones abiertas para guardar'); return; }
  const s = await mcEntrar();
  if (!s) return;
  if (s.rol === 'visitante') {
    showModal({
      title: 'Nube de la parroquia',
      body: `<p>Entraste como <b>${escapeHtml(s.email)}</b>, que todavía no tiene permisos para guardar cancioneros.</p>
        <p class="hint">Pídele al administrador de la parroquia que te los asigne en <b>Identificarse → Administradores y permisos</b>.</p>`
    });
    return;
  }
  const prev = state.mcDrive;
  const todas = MC_ROLES_TODAS.includes(s.rol) || !MC_COMUNIDADES[s.comunidad];
  const opciones = Object.entries(MC_COMUNIDADES).filter(([slug]) => todas || slug === s.comunidad);
  const elegida = prev?.comunidad && opciones.some(([slug]) => slug === prev.comunidad) ? prev.comunidad
    : MC_COMUNIDADES[s.comunidad] ? s.comunidad : opciones[0][0];
  const conAudios = songs.some(d => d.audios.some(canEmbed));
  const res = await showModal({
    title: 'Guardar en la nube de la parroquia',
    wide: true,
    body: `<p>Se guardan las <b>${songs.length}</b> canciones abiertas, en el orden de las pestañas, con sus audios.</p>
      <ol class="book-list">${songs.map(d => `<li>${escapeHtml(d.title.trim() || 'Sin título')}</li>`).join('')}</ol>
      <div class="mc-campos">
        <label for="mcTitulo">Nombre del cancionero</label>
        <input type="text" id="mcTitulo" value="${escapeHtml(prev?.titulo || state.cancioneroName || 'Cancionero')}">
        <label for="mcComunidad">Comunidad</label>
        <select id="mcComunidad">${opciones.map(([slug, nombre]) =>
          `<option value="${slug}"${slug === elegida ? ' selected' : ''}>${escapeHtml(nombre)}</option>`).join('')}</select>
        <label for="mcFechaCel">Fecha de la celebración</label>
        <input type="date" id="mcFechaCel" value="${escapeHtml(prev?.fecha || mcFecha())}">
        <label for="mcComentario">Comentario (opcional)</label>
        <input type="text" id="mcComentario" value="${escapeHtml(prev?.comentario || '')}" placeholder="Misa de las 11, ensayo el sábado…">
      </div>
      ${conAudios ? `<label class="export-embed"><input type="checkbox" id="mcEmbed" checked>
        Incluir los audios dentro de la página para compartir (suenan sin internet, pero el archivo pesa más)</label>` : ''}
      ${prev?.folderId ? `<label class="support-check"><input type="checkbox" id="mcActualizar" checked>
        Reemplazar el guardado anterior «${escapeHtml(prev.titulo)}» (${escapeHtml(MC_COMUNIDADES[prev.comunidad] || '')})</label>` : ''}`,
    onOpen: d => d.querySelector('#mcTitulo').select(),
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Guardar en la nube', primary: true,
        onClick: d => {
          const titulo = d.querySelector('#mcTitulo').value.trim();
          if (!titulo) return modalFail(d, 'Escribe un nombre para el cancionero.');
          return {
            titulo,
            comunidad: d.querySelector('#mcComunidad').value,
            fecha: d.querySelector('#mcFechaCel').value || mcFecha(),
            comentario: d.querySelector('#mcComentario').value.trim(),
            embed: !!d.querySelector('#mcEmbed')?.checked,
            actualizar: !!d.querySelector('#mcActualizar')?.checked
          };
        }
      }
    ]
  });
  if (res) await mcGuardar(songs, res, s);
}

// Audios dentro de la página: comprimidos si el reproductor del PC está activo; si no, solo los
// archivos del equipo tal cual (sin preguntar a 127.0.0.1 en la web pública). YouTube queda como enlace.
async function mcIncrustar(songs) {
  if ((await extractorStatus())?.liviano) return collectEmbedded(songs);
  const embedded = new Map();
  let failed = 0;
  for (const d of songs) {
    for (const a of d.audios.filter(canEmbed)) {
      const blob = a.objectUrl ? await fetch(a.objectUrl).then(r => r.blob()).catch(() => null) : null;
      if (blob && blob.size <= EMBED_MAX_BYTES) embedded.set(a.id, await blobDataUrl(blob));
      else failed++;
    }
  }
  return { embedded, failed };
}

// Arma los archivos del cancionero: audios del equipo, una .md por canción, la lista y la página
async function mcArmarArchivos(songs, opts, avance) {
  const files = [], usados = new Set(), audioRuta = new Map();
  const unico = (carpeta, base, ext) => {
    let n = base + ext;
    for (let i = 2; usados.has((carpeta + n).toLowerCase()); i++) n = `${base} (${i})${ext}`;
    usados.add((carpeta + n).toLowerCase());
    return carpeta + n;
  };
  let faltan = 0, grandes = 0;
  for (const d of songs) {
    for (const a of d.audios) {
      if (a.kind !== 'local') continue;
      const blob = a.objectUrl ? await fetch(a.objectUrl).then(r => r.blob()).catch(() => null) : null;
      if (!blob) { faltan++; continue; }
      if (blob.size > MC_MAX_ARCHIVO) { grandes++; continue; }
      const ext = mediaExt(a.src) || mediaExt(a.name) || (blob.type.split('/')[1] || 'bin').replace(/[;+].*/, '');
      const ruta = unico('audios/', safeFileName(fileBase(a.src) || a.name || 'audio'), '.' + ext);
      audioRuta.set(a.id, ruta);
      files.push({ ruta, blob, mime: blob.type || 'application/octet-stream', audio: true });
    }
  }

  const mdRuta = new Map();
  for (const d of songs) {
    const ruta = unico('canciones/', safeFileName(d.title.trim() || 'Sin título'), '.md');
    mdRuta.set(d, ruta);
    const audios = d.audios.map(a => ({
      name: a.name, src: audioRuta.has(a.id) ? encodePath('../' + audioRuta.get(a.id)) : audioExportSrc(a),
      voice: a.voice, extractor: a.extractor, speed: a.speed, origin: a.origin
    }));
    files.push({ ruta, blob: new Blob([buildMarkdown(d, audios)], { type: 'text/markdown' }), mime: 'text/markdown' });
  }

  for (const d of docs) for (const a of d.audios) a.path = m3uAudioPath(a, audioRuta.get(a.id) || a.src.replace(/^\.\//, ''));
  try {
    const m3u = await buildM3u8(opts.titulo, async d => mdRuta.get(d));
    files.push({ ruta: 'cancionero.m3u8', blob: new Blob([m3u], { type: 'audio/x-mpegurl' }), mime: 'audio/x-mpegurl' });
  } finally {
    for (const d of docs) for (const a of d.audios) delete a.path;
  }

  avance(opts.embed ? 'Preparando la página con los audios adentro…' : 'Preparando la página del cancionero…');
  let embedded = new Map(), sinIncluir = 0, pesada = false;
  if (opts.embed) ({ embedded, failed: sinIncluir } = await mcIncrustar(songs));
  const { pkg } = buildSharePackage(songs, opts.titulo);
  const share = { pkg, link: await packToLink(pkg) };
  await preloadGuitarDb();
  let html = new Blob([buildAtrilHtml(songs, { titulo: opts.titulo, embedded, share })], { type: 'text/html' });
  if (html.size > MC_MAX_ARCHIVO && embedded.size) {
    html = new Blob([buildAtrilHtml(songs, { titulo: opts.titulo, share })], { type: 'text/html' });
    pesada = true;
  }
  const htmlRuta = unico('', safeFileName(opts.titulo), '.html');
  files.push({ ruta: htmlRuta, blob: html, mime: 'text/html' });
  return { files, htmlRuta, audios: audioRuta.size, faltan, grandes, sinIncluir, pesada };
}

// Arma y sube la carpeta del cancionero (opts.folderId: la reemplaza si todavía existe) y lo publica
// en la lista de la comunidad. Sin reingreso, una sesión vencida corta con error en vez de pedir entrar.
async function mcSubirCancionero(songs, opts, s, avance, seguir = () => {}, reingreso = true) {
  const armado = await mcArmarArchivos(songs, opts, avance);
  seguir();
  avance('Conectando con la nube…');
  const base = { token: s.token, comunidad: opts.comunidad, titulo: opts.titulo, fecha: opts.fecha };
  let ini;
  if (opts.folderId) ini = await mcApi('iniciarCancionero', { ...base, folderId: opts.folderId }, reingreso).catch(() => null);
  ini ||= await mcApi('iniciarCancionero', base, reingreso);
  const existentes = new Map((ini.existentes || []).map(f => [f.ruta, f.size]));
  const total = armado.files.reduce((n, f) => n + f.blob.size, 0) || 1;
  let hecho = 0;
  for (const [i, f] of armado.files.entries()) {
    seguir();
    avance(`Subiendo ${i + 1} de ${armado.files.length}: ${f.ruta}`, hecho, total);
    if (!(f.audio && existentes.get(f.ruta) === f.blob.size)) {
      await mcSubir('cancionero', { folderId: ini.folderId, ruta: f.ruta, mime: f.mime }, f.blob, s.token, reingreso);
    }
    hecho += f.blob.size;
  }
  seguir();
  avance('Publicando en la lista de la comunidad…', 1, 1);
  const fin = await mcApi('cerrarCancionero', {
    token: s.token, folderId: ini.folderId, conservar: armado.files.map(f => f.ruta), htmlRuta: armado.htmlRuta,
    canciones: songs.length, audios: armado.audios, comentario: opts.comentario
  }, reingreso);
  return { armado, folderId: ini.folderId, htmlId: fin.cancionero.htmlId };
}

async function mcGuardar(songs, opts, s) {
  let terminado = false;
  let cancelado = false;
  // Solo cancela el botón o Escape: si hay que volver a entrar, ese diálogo reemplaza a este y el guardado sigue
  showModal({
    title: 'Guardando en la nube de la parroquia',
    body: `<p class="mc-paso">Preparando el cancionero…</p><progress class="mc-progreso" max="1" value="0"></progress>
      <p class="hint">No cierres esta página hasta que termine.</p>`,
    buttons: [{ label: 'Cancelar' }]
  }).then(() => { if (!terminado) cancelado = true; });
  const dlg = $('#modal');
  const avance = (texto, hecho = 0, total = 1) => {
    if (!dlg.querySelector('.mc-progreso')) return;
    dlg.querySelector('.mc-paso').textContent = texto;
    dlg.querySelector('.mc-progreso').value = total ? hecho / total : 0;
  };
  const seguir = () => { if (cancelado) throw new Error('cancelado'); };

  try {
    const folderId = opts.actualizar ? state.mcDrive?.folderId : '';
    const { armado, folderId: nuevaCarpeta, htmlId } = await mcSubirCancionero(songs, { ...opts, folderId }, s, avance, seguir);
    terminado = true;
    state.mcDrive = { folderId: nuevaCarpeta, titulo: opts.titulo, comunidad: opts.comunidad, fecha: opts.fecha, comentario: opts.comentario, htmlId };
    songs.forEach(d => markClean(d));
    setActiveBook(opts.titulo, null, `Nube · ${MC_COMUNIDADES[opts.comunidad]}`);
    refresh();
    dlg.close();
    mcGuardado(opts, songs.length, armado, htmlId);
  } catch (e) {
    terminado = true;
    if (dlg.open) dlg.close();
    if (e.message === 'cancelado') toast('Guardado en la nube cancelado', 3000);
    else mcError('No se pudo guardar en la nube', e);
  }
}

function mcGuardado(opts, nCanciones, armado, htmlId) {
  const url = htmlId ? mcVerUrl(htmlId) : '';
  const notas = [
    armado.faltan && `${armado.faltan} audio(s) de este equipo no se encontraron (pulsa «Activar audios de la carpeta» y vuelve a guardar).`,
    armado.grandes && `${armado.grandes} audio(s) pesan más de 30 MB y no se subieron.`,
    armado.sinIncluir && `${armado.sinIncluir} audio(s) quedaron como enlace en la página.`,
    armado.pesada && 'La página quedó sin audios adentro porque pesaba más de 30 MB (los audios sí están en la carpeta).'
  ].filter(Boolean);
  const mensaje = `Cancionero «${opts.titulo}» (${MC_COMUNIDADES[opts.comunidad]}, ${opts.fecha}): ${url}`;
  showModal({
    title: 'Guardado en la nube ✓',
    body: `<p>«${escapeHtml(opts.titulo)}» quedó en la nube de la parroquia, en <b>${escapeHtml(MC_COMUNIDADES[opts.comunidad])}</b>:
        ${nCanciones} ${nCanciones === 1 ? 'canción' : 'canciones'} y ${armado.audios} ${armado.audios === 1 ? 'audio' : 'audios'}.</p>
      ${notas.length ? `<ul class="book-list">${notas.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${url ? `<p>Ya aparece en la página de la comunidad. Enlace para verlo:<br><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>` : ''}`,
    buttons: [
      { label: 'Cerrar' },
      ...(url ? [
        { label: 'Copiar enlace', onClick: d => { navigator.clipboard?.writeText(url).then(() => modalFail(d, 'Enlace copiado ✓'), () => modalFail(d, url)); return false; } },
        { label: 'Por correo', onClick: () => { location.href = mcCorreoCancionero(opts.titulo, MC_COMUNIDADES[opts.comunidad], url); } },
        { label: 'Enviar por WhatsApp', primary: true, onClick: () => { window.open('https://wa.me/?text=' + encodeURIComponent(mensaje), '_blank', 'noopener'); } }
      ] : [])
    ]
  });
}

// ============ BIBLIOTECA DE LA PARROQUIA (canciones sueltas) ============
// Archivo → Abrir → Canción de la Biblioteca y Archivo → Guardar canción en la Biblioteca. Es la misma
// Biblioteca de la pantalla Misas: una canción subida ahí solo con su audio se abre aquí, se le escribe
// la letra y al guardarla queda completa y unida a sus audios (el servidor la reconoce por el título).
const mcAudioUrl = fileId => MC_API + '/audio/' + encodeURIComponent(fileId);
const mcIdCancion = titulo => 'c-' + (String(titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cancionero');

// Abrir → Canción de la Biblioteca: la vista Biblioteca del editor (ytm.js)
function mcAbrirCancionBib() {
  ytmIrA('biblioteca');
  setTimeout(() => $('#bibBuscar')?.focus(), 50);
}

// Una canción de la Biblioteca lista para una pestaña (con sus partituras)
async function mcDocDeBiblioteca(id) {
  const r = await mcLeerPublico({ accion: 'cancion', id });
  const data = parseMarkdown(r.texto, (r.cancion?.titulo || 'cancion') + '.md');
  if (!data.tags?.length && r.cancion?.etiquetas) data.tags = r.cancion.etiquetas;
  const d = makeDoc({ ...data, title: data.title || r.cancion?.titulo || 'Sin título' });
  if (r.cancion?.partituras?.length) d.partituras = r.cancion.partituras;
  d.bibId = id;
  markClean(d);
  return d;
}

async function mcGuardarCancion() {
  if (!mcConfigurado()) return;
  syncFromEditor();
  const d = cur();
  if (isBlank(d)) { toast('La canción está vacía'); return; }
  const titulo = d.title.trim();
  if (!titulo) { toast('Escribe el título de la canción antes de guardarla', 4000); titleEl.focus(); return; }
  const s = await mcEntrar('Para guardar la canción en la Biblioteca de la parroquia entra con tu cuenta de Google.');
  if (!s) return;
  if (s.rol === 'visitante') {
    showModal({
      title: 'Biblioteca de la parroquia',
      body: `<p>Entraste como <b>${escapeHtml(s.email)}</b>, que todavía no tiene permisos para guardar canciones.</p>
        <p class="hint">Pídeselos al administrador de la parroquia. Mientras tanto puedes guardarla en este equipo.</p>`,
      buttons: [{ label: 'Cerrar' }, { label: 'Guardar en este equipo…', primary: true, onClick: () => { setTimeout(() => saveSong(true)); } }]
    });
    return;
  }
  let previa = null;
  try {
    previa = ((await mcLeerPublico({ accion: 'biblioteca' })).canciones || []).find(c => c.id === mcIdCancion(titulo)) || null;
  } catch (e) { mcError('No se pudo guardar en la Biblioteca', e); return; }
  if (previa && !previa.soloAudio) {
    const seguir = await showModal({
      title: 'Ya está en la Biblioteca',
      body: `<p>Ya hay una canción <b>«${escapeHtml(previa.titulo)}»</b> en la Biblioteca. ¿Reemplazar su letra y acordes con los de esta pestaña?</p>
        <p class="hint">Sus audios se conservan. Si es otra canción, cancela y cámbiale el título.</p>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Reemplazar', primary: true, value: true }]
    });
    if (!seguir) return;
  }

  showModal({
    title: 'Guardando en la Biblioteca',
    body: `<p class="mc-paso">Preparando «${escapeHtml(titulo)}»…</p><progress class="mc-progreso" max="1" value="0"></progress>
      <p class="hint">No cierres esta página hasta que termine.</p>`,
    buttons: []
  });
  const dlg = $('#modal');
  const avance = (texto, valor = 0) => {
    if (!dlg.querySelector('.mc-progreso')) return;
    dlg.querySelector('.mc-paso').textContent = texto;
    dlg.querySelector('.mc-progreso').value = valor;
  };
  try {
    const voz = a => (a.voice && a.voice !== 'todas' ? a.voice : '');
    const enviados = [], enMd = [];
    let faltan = 0;
    const locales = d.audios.filter(a => a.kind === 'local');
    let conv = null;
    for (const a of d.audios) {
      if (a.kind !== 'local') {
        enviados.push({ nombre: a.name, voz: voz(a), url: a.src });
        enMd.push({ name: a.name, src: a.src, voice: a.voice });
        continue;
      }
      const n = locales.indexOf(a) + 1;
      const blob = a.objectUrl ? await fetch(a.objectUrl).then(r => r.blob()).catch(() => null) : null;
      if (!blob) { faltan++; continue; }
      conv ||= await import(new URL('../js/audio-aac.js', document.baseURI).href);
      const archivo = new File([blob], fileBase(a.src, true) || (a.name || 'audio') + '.' + (mediaExt(a.src) || 'mp3'), { type: blob.type });
      const r = await conv.aM4a(archivo, x => avance(`Audio ${n} de ${locales.length}: convirtiendo a .m4a ${Math.round(x * 100)} %`, (n - 1 + x * 0.7) / (locales.length + 1)),
        { titulo, alEstado: t => avance(t, (n - 1) / (locales.length + 1)) });
      if (r.archivo.size > MC_MAX_ARCHIVO) throw new Error(`El audio «${a.name}» pesa más de 30 MB.`);
      avance(`Audio ${n} de ${locales.length}: subiendo…`, (n - 0.3) / (locales.length + 1));
      const sub = await mcSubir('audio', { nombre: r.archivo.name, mime: r.archivo.type || 'audio/mp4', cancion: titulo, voz: voz(a) },
        r.archivo, s.token);
      enviados.push({ nombre: a.name, voz: voz(a), fileId: sub.fileId });
      enMd.push({ name: a.name, src: mcAudioUrl(sub.fileId), voice: a.voice });
    }
    // Los audios que la canción ya tenía en la Biblioteca siguen siendo suyos
    for (const a of previa?.audios || []) {
      if (enviados.some(x => (a.fileId && (x.fileId === a.fileId || String(x.url || '').includes(a.fileId))) || (a.url && x.url === a.url))) continue;
      enviados.push(a.fileId ? { nombre: a.nombre, voz: a.voz, fileId: a.fileId } : { nombre: a.nombre, voz: a.voz, url: a.url });
      enMd.push({ name: a.nombre || 'Audio', src: a.fileId ? mcAudioUrl(a.fileId) : a.url, voice: a.voz || 'todas' });
    }
    avance('Guardando la canción en la Biblioteca…', locales.length / (locales.length + 1));
    const r = await mcApi('subirCancion', {
      token: s.token, md: buildMarkdown(d, enMd), nombre: titulo + '.md', comunidad: previa?.comunidad || s.comunidad || '', audios: enviados
    });
    markClean(d);
    refresh();
    dlg.close();
    const c = r.cancion;
    const momentos = (c.etiquetas || []).filter(t => typeof TAG_FAMILIES !== 'undefined' &&
      TAG_FAMILIES.catolico.groups[0].tags.some(m => tagNorm(m) === tagNorm(t)));
    showModal({
      title: 'Guardada en la Biblioteca ✓',
      body: `<p>«${escapeHtml(c.titulo)}» quedó en la Biblioteca de la parroquia con ${(c.audios || []).length} ${(c.audios || []).length === 1 ? 'audio' : 'audios'}${previa?.soloAudio ? ', ya unida a los audios que se habían subido solos' : ''}.</p>
        <p>${momentos.length ? `En la pantalla Misas aparece en: <b>${escapeHtml(momentos.join(', '))}</b>.`
          : 'Para que aparezca en los momentos de la pantalla Misas, ponle sus etiquetas (Editar → Tags: Entrada, Comunión…) y vuelve a guardarla.'}</p>
        ${faltan ? `<p class="hint">${faltan} audio(s) de este equipo no se encontraron (pulsa «Activar audios de la carpeta» y vuelve a guardar).</p>` : ''}`
    });
  } catch (e) {
    if (dlg.open) dlg.close();
    mcError('No se pudo guardar en la Biblioteca', e);
  }
}

// ============ COMPARTIR (WhatsApp o correo) ============
const mcCorreoCancionero = (titulo, comunidad, url) => `mailto:?subject=${encodeURIComponent('Cancionero: ' + titulo)}&body=${encodeURIComponent(
  `Hola:\n\nTe comparto el cancionero «${titulo}»${comunidad ? ` de ${comunidad}` : ''}, con la letra, los acordes y los audios:\n\n${url}\n\nSe abre en el navegador, sin instalar nada.`)}`;

// Con el cancionero guardado en la nube se comparte el vínculo a su página; si no, se ofrece guardarlo
// primero o enviar el archivo .html (Compartir → Enviar el archivo).
async function mcCompartir(medio) {
  syncFromEditor();
  const songs = docs.filter(d => !isBlank(d));
  if (!songs.length) { toast('No hay canciones abiertas para compartir'); return; }
  const drive = state.mcDrive;
  const sinCambios = drive?.htmlId && songs.every(d => !isDirty(d));
  if (!drive?.htmlId || !sinCambios) {
    const eleccion = await showModal({
      title: medio === 'correo' ? 'Compartir por correo' : 'Compartir por WhatsApp',
      body: drive?.htmlId
        ? `<p>El cancionero tiene cambios que todavía no están en la nube. ¿Guardarlo antes de compartir el vínculo?</p>`
        : `<p>Para compartir un vínculo web, el cancionero tiene que estar guardado en la nube de la parroquia.</p>
          <p class="hint">También puedes enviar el archivo .html con las canciones (se abre sin internet).</p>`,
      buttons: [
        { label: 'Cancelar' },
        ...(drive?.htmlId ? [{ label: 'Compartir el vínculo igual', value: 'igual' }] : []),
        { label: 'Enviar el archivo', value: 'archivo' },
        { label: 'Guardar en la nube', primary: true, value: 'guardar' }
      ]
    });
    if (!eleccion) return;
    if (eleccion === 'archivo') return shareBookDialog();
    // Al terminar de guardar, el aviso «Guardado en la nube» trae los botones para enviarlo: abrir WhatsApp
    // o el correo desde aquí, después de esperar al servidor, el navegador ya no lo permite
    if (eleccion === 'guardar') return driveSaveDialog();
  }
  const d = state.mcDrive;
  const url = mcVerUrl(d.htmlId);
  const titulo = d.titulo || state.cancioneroName || 'Cancionero';
  const comunidad = MC_COMUNIDADES[d.comunidad] || '';
  const texto = `Cancionero «${titulo}»${comunidad ? ` (${comunidad}${d.fecha ? ', ' + d.fecha : ''})` : ''}: ${url}`;
  if (medio === 'correo') {
    location.href = mcCorreoCancionero(titulo, comunidad, url);
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
  }
}

// ============ PUBLICAR DESDE LA PANTALLA MISAS ============
// misas.html abre oculto editor/?misa=<id>&publicar=1: se arman las canciones del cancionero de misa (en el
// orden de sus momentos y en el tono elegido) y se suben como «Guardar en la nube». El avance va a la página
// de Misas por postMessage.
async function mcLeerPublico(params) {
  let r;
  try {
    r = await fetch(MC_API + '?' + new URLSearchParams(params)).then(res => res.json());
  } catch (_) {
    throw new Error('No se pudo conectar con el servidor de la parroquia. Revisa tu conexión a internet.');
  }
  if (!r.ok) throw new Error(r.error || 'El servidor de la parroquia no respondió.');
  return r;
}

// Canciones de un cancionero de misa, en el orden de sus momentos, en el tono elegido y con la cejilla y las
// velocidades que se guardaron para esa misa. d.mc recuerda de dónde vino cada una para volver a guardarlas.
async function mcCancionesDeMisa(misa, avance) {
  const elegidas = misa.momentos.flatMap((m, mi) => m.canciones.map((c, ci) => ({ ...c, momento: m.momento, mi, ci })));
  const leidas = new Array(elegidas.length);
  let hechas = 0, sig = 0;
  // De a cuatro a la vez: un cancionero de quince canciones se abre en un par de segundos
  await Promise.all(Array.from({ length: Math.min(4, elegidas.length) }, async () => {
    while (sig < elegidas.length) {
      const i = sig++;
      try { leidas[i] = await mcLeerPublico({ accion: 'cancion', id: elegidas[i].cancionId }); } catch (_) { leidas[i] = null; }
      avance(hechas++, elegidas.length);
    }
  }));
  const songs = [];
  for (const [i, c] of elegidas.entries()) {
    const r = leidas[i];
    if (!r) continue;
    const data = parseMarkdown(r.texto, (r.cancion?.titulo || 'cancion') + '.md');
    const orig = detectKey(data.text);
    if (orig && c.desplazamiento) {
      const idx = mod12(orig.idx + c.desplazamiento);
      data.text = transposeText(data.text, c.desplazamiento, keyPrefersFlats(idx, orig.minor));
    }
    if (!data.tags?.length && r.cancion?.etiquetas) data.tags = r.cancion.etiquetas;
    if (c.capo) data.capos = { ...(data.capos || {}), [(data.instruments?.[0] || DEFAULT_INSTRUMENT).id]: c.capo };
    const d = makeDoc({ ...data, title: data.title || r.cancion?.titulo || 'Sin título', clean: true });
    if (c.velocidad && c.velocidad !== 1) d.audios.forEach(a => { a.speed = clampSpeed(c.velocidad); });
    if (c.scroll) d.scrollSpeed = clampLevel(c.scroll);
    if (r.cancion?.partituras?.length) d.partituras = r.cancion.partituras;
    d.mc = {
      cancionId: c.cancionId, momento: c.momento, mi: c.mi, ci: c.ci, tonoOriginal: orig ? orig.idx : null,
      base: { desplazamiento: c.desplazamiento || 0, capo: c.capo || 0, velocidad: c.velocidad || 1, scroll: c.scroll || 0 }
    };
    songs.push(d);
  }
  return { songs, faltantes: elegidas.length - songs.length };
}

// Ajustes actuales de una canción de misa: el tono se mide contra el de la Biblioteca
function mcValores(d) {
  const key = detectKey(d.text);
  const a = currentAudio(d) || d.audios[0];
  return {
    desplazamiento: d.mc.tonoOriginal != null && key ? signedSemis(key.idx - d.mc.tonoOriginal) : d.mc.base.desplazamiento,
    capo: capoPrincipal(d),
    velocidad: a?.speed || 1,
    scroll: d.scrollSpeed || 0
  };
}
const mcCambio = d => {
  if (!d.mc) return false;
  const v = mcValores(d), b = d.mc.base;
  return v.desplazamiento !== b.desplazamiento || v.capo !== b.capo || v.velocidad !== b.velocidad || (v.scroll || 0) !== (b.scroll || 0);
};
const mcCambiosMisa = () => (state.mcMisa ? docs.filter(mcCambio) : []);

async function mcPublicarMisa(id) {
  const avisar = (tipo, datos = {}) => {
    if (parent !== window) parent.postMessage({ mcPublicar: tipo, misa: id, ...datos }, location.origin);
  };
  const avance = (texto, hecho = 0, total = 1) => avisar('avance', { texto, valor: total ? hecho / total : 0 });
  try {
    if (!MC_API) throw new Error('El servidor de la parroquia todavía no está conectado.');
    const s = mcSesion();
    if (!s) throw new Error('Tu sesión se cerró: vuelve a identificarte y publica de nuevo.');
    avance('Leyendo el cancionero…');
    const misa = ((await mcLeerPublico({ accion: 'misas' })).misas || []).find(m => m.id === id);
    if (!misa) throw new Error('No se encontró el cancionero.');
    const { songs, faltantes } = await mcCancionesDeMisa(misa, (i, n) =>
      avance(`Preparando la canción ${i + 1} de ${n}…`, i, n * 4));
    if (!songs.length) throw new Error('Ninguna canción del cancionero está en la Biblioteca.');
    docs = songs;
    activate(songs[0].id);
    const opts = {
      titulo: misa.nombre, comunidad: misa.comunidad, fecha: misa.fechaUso || mcFecha(),
      comentario: misa.tiempoLiturgico || '', embed: false, folderId: misa.drive?.folderId || ''
    };
    const fin = await mcSubirCancionero(songs, opts, s, (texto, hecho, total) =>
      avance(texto, 1 + 3 * (total ? hecho / total : 0), 4), () => {}, false);
    avisar('listo', { folderId: fin.folderId, htmlId: fin.htmlId, faltantes });
  } catch (e) {
    avisar('error', { mensaje: e.message || String(e) });
  }
}

// Botones «Atril» y «Editar en el editor» de la pantalla Misas: editor/?misa=<id>&foco=<momento>.<canción>[&atril=1].
// Usan la copia que la pantalla Misas deja en este navegador (con los cambios todavía sin guardar) o, si se
// abre desde otro lado, la guardada en la nube. Con atril=1 el editor es efímero: no guarda nada.
const MC_ATRIL_KEY = 'mc-atril';
const MC_GUARDADA_KEY = 'mc-misa-guardada';

function mcCopiaDeMisas(id) {
  try {
    const copia = JSON.parse(localStorage.getItem(MC_ATRIL_KEY));
    if (copia?.id === id && Date.now() - copia.t < 12 * 3600e3) return copia;
  } catch (_) {}
  return null;
}

const mcLeerFoco = f => {
  const m = /^(\d+)\.(\d+)$/.exec(String(f || ''));
  return m ? { momento: +m[1], indice: +m[2] } : null;
};

// Antes de cambiar de cancionero: los ajustes de la misa sin guardar o las canciones propias sin guardar
async function mcAntesDeReemplazar(titulo) {
  const cambios = mcCambiosMisa();
  if (cambios.length) {
    const eleccion = await showModal({
      title: titulo,
      body: `<p>En «${escapeHtml(state.cancioneroName || 'el cancionero de misa')}» cambiaste el tono, la cejilla o las velocidades de
        ${cambios.length === 1 ? 'una canción' : cambios.length + ' canciones'} y todavía no está guardado en la misa.</p>`,
      buttons: [
        { label: 'Cancelar' },
        { label: 'Descartar los cambios', value: 'descartar' },
        { label: 'Guardar en la misa', primary: true, value: 'guardar' }
      ]
    });
    if (!eleccion) return false;
    if (eleccion === 'guardar' && !await mcGuardarEnMisa()) return false;
    if (eleccion === 'descartar') cambios.forEach(markClean);
  }
  // En un cancionero de misa solo preguntan las canciones propias que se le agregaron
  if (state.mcMisa && !docs.some(d => !d.mc && !isBlank(d) && isDirty(d))) return true;
  return saveBeforeClosing(titulo);
}

// Abre un cancionero de misa en el editor, en la canción con foco (la que se estaba mirando en Misas)
async function mcAbrirMisa(id, foco = null, { atril = false, misa = null } = {}) {
  try {
    if (!MC_API) throw new Error('El servidor de la parroquia todavía no está conectado.');
    misa ||= mcCopiaDeMisas(id);
    if (!misa) {
      toast('Buscando el cancionero…', 60000);
      misa = ((await mcLeerPublico({ accion: 'misas' })).misas || []).find(m => m.id === id);
    }
    if (!misa) throw new Error('No se encontró el cancionero: puede que lo hayan borrado.');
    foco ||= misa.foco || null;
    if (!EFIMERO && !await mcAntesDeReemplazar(`Abrir «${misa.nombre || 'Cancionero de misa'}»`)) { toast(''); return false; }
    const { songs, faltantes } = await mcCancionesDeMisa(misa, (i, n) =>
      toast(`Abriendo «${misa.nombre}»: canción ${i + 1} de ${n}…`, 60000));
    if (!songs.length) throw new Error('Ninguna canción del cancionero está en la Biblioteca.');
    mcQuitarAvisoActivo();
    previa = null;
    if (EFIMERO) { docs = songs; activate(songs[0].id); } else replaceOrAddTabs(songs, true);
    setActiveBook(misa.nombre || 'Cancionero de misa', null, `Misas · ${MC_COMUNIDADES[misa.comunidad] || 'Parroquia'}`);
    // Lo que se guarde en la nube desde aquí es un cancionero nuevo, no el que estaba abierto antes
    state.mcDrive = null;
    state.mcMisa = { id: misa.id, t: misa.t || Date.now(), comunidad: misa.comunidad || '', fechaUso: misa.fechaUso || '',
      tiempoLiturgico: misa.tiempoLiturgico || '' };
    state.cancioneroClean = bookSignature();
    const enfocada = foco && songs.find(d => d.mc.mi === foco.momento && d.mc.ci === foco.indice);
    switchTab((enfocada || songs[0]).id);
    setMode('atril');
    ytmIrA('cancionero');
    refresh();
    toast(faltantes ? `${faltantes} ${faltantes === 1 ? 'canción ya no está' : 'canciones ya no están'} en la Biblioteca.`
      : `«${misa.nombre}» abierto${enfocada ? ` en «${enfocada.title}»` : ''}`, faltantes ? 5000 : 2500);
    if (atril) abrirAtril();
    return true;
  } catch (e) {
    toast('');
    mcError(atril ? 'No se pudo abrir el atril' : 'No se pudo abrir el cancionero de Misas', e);
    return false;
  }
}

function mcAtrilMisa(id, foco) {
  return mcAbrirMisa(id, mcLeerFoco(foco), { atril: true });
}

// editor/?misa=<id>&foco=…: se abre una sola vez (recargar la página no lo vuelve a pedir)
function mcAbrirMisaDeUrl(id, foco) {
  history.replaceState(null, '', location.pathname + location.hash);
  if (state.mcMisa?.id === id && !mcCopiaDeMisas(id)) {
    const f = mcLeerFoco(foco);
    const d = f && docs.find(x => x.mc?.mi === f.momento && x.mc?.ci === f.indice);
    if (d) switchTab(d.id);
    ytmIrA('cancionero');
    return;
  }
  return mcAbrirMisa(id, mcLeerFoco(foco));
}

// Guarda en el cancionero de misa (no en la Biblioteca) el tono, la cejilla y las velocidades de sus canciones
async function mcGuardarEnMisa() {
  if (!state.mcMisa) { mcGuardarCancion(); return false; }
  if (EFIMERO) { toast('Este atril no guarda cambios: ábrelo con «Editar en el editor» desde Misas.', 5000); return false; }
  if (!mcConfigurado()) return false;
  syncFromEditor();
  const s = await mcEntrar('Para guardar el tono, la cejilla y las velocidades en el cancionero de misa entra con tu cuenta de Google.');
  if (!s) return false;
  toast('Guardando en el cancionero de misa…', 60000);
  try {
    const misa = ((await mcLeerPublico({ accion: 'misas' })).misas || []).find(m => m.id === state.mcMisa.id);
    if (!misa) throw new Error('El cancionero ya no está en la parroquia: puede que lo hayan borrado.');
    const guardadas = [];
    let perdidas = 0;
    for (const d of docs.filter(x => x.mc)) {
      const v = mcValores(d);
      let c = misa.momentos[d.mc.mi]?.canciones[d.mc.ci];
      if (c?.cancionId !== d.mc.cancionId) {
        c = misa.momentos.find(m => m.momento === d.mc.momento)?.canciones.find(x => x.cancionId === d.mc.cancionId) ||
          misa.momentos.flatMap(m => m.canciones).find(x => x.cancionId === d.mc.cancionId);
      }
      if (!c) { perdidas++; continue; }
      c.desplazamiento = v.desplazamiento;
      if (v.capo) c.capo = v.capo; else delete c.capo;
      if (v.velocidad !== 1) c.velocidad = v.velocidad; else delete c.velocidad;
      if (v.scroll) c.scroll = v.scroll; else delete c.scroll;
      guardadas.push([d, v]);
    }
    // Sin «drive» ni «lecturas»: el servidor conserva la página publicada y las lecturas como estaban
    const { drive, lecturas, ...datos } = misa;
    await mcApi('guardarMisa', { token: s.token, misa: datos });
    for (const [d, v] of guardadas) { d.mc.base = v; markClean(d); }
    state.mcMisa.t = Date.now();
    try { localStorage.setItem(MC_GUARDADA_KEY, JSON.stringify({ id: misa.id, t: state.mcMisa.t })); } catch (_) {}
    colaFirma = '';
    refresh();
    toast(`Guardado en «${misa.nombre}»${perdidas ? `. ${perdidas} ${perdidas === 1 ? 'canción ya no está' : 'canciones ya no están'} en la misa.` : ''}`, perdidas ? 6000 : 3000);
    return true;
  } catch (e) {
    mcError('No se pudo guardar en el cancionero de misa', e);
    return false;
  }
}

// Atril del editor con el cancionero vacío: ofrece el cancionero abierto en la pantalla Misas, que lo deja
// en «mc-activo» (js/misas.js, guardarActivo). «t» es su versión: cambia solo cuando cambia el contenido.
const MC_ACTIVO_KEY = 'mc-activo';
const MC_ACTIVO_VISTO = 'mc-activo-visto';

function mcLeerActivo() {
  try {
    const a = JSON.parse(localStorage.getItem(MC_ACTIVO_KEY));
    return a?.id && Array.isArray(a.momentos) && Date.now() - a.t < 12 * 3600e3 ? a : null;
  } catch (_) {
    return null;
  }
}

const mcActivoCargado = a => state.mcMisa?.id === a.id && state.mcMisa.t >= a.t;

// Devuelve true si se ocupó de abrir el atril (con el cancionero de Misas)
async function mcAtrilActivo() {
  const a = EFIMERO ? null : mcLeerActivo();
  if (!a || mcActivoCargado(a) || bookSongs().length || sessionStorage.getItem(MC_ACTIVO_VISTO) === a.id + '@' + a.t) return false;
  const eleccion = await showModal({
    title: 'Cancionero activo en Misas',
    body: `<p>En la pantalla Misas está abierto <b>«${escapeHtml(a.nombre || 'Cancionero')}»</b>${a.fechaUso ? ` (${escapeHtml(a.fechaUso)})` : ''}.</p>
      <p class="hint">¿Lo abrimos en el atril?</p>`,
    buttons: [
      { label: 'No, gracias', value: 'seguir' },
      { label: `Abrir «${a.nombre || 'Cancionero'}»`, primary: true, value: 'abrir' }
    ]
  });
  if (eleccion === 'abrir') { await mcAbrirMisa(a.id, null, { atril: true, misa: a }); return true; }
  if (eleccion === 'seguir') sessionStorage.setItem(MC_ACTIVO_VISTO, a.id + '@' + a.t);
  return false;
}

async function mcCargarActivo(a) {
  mcQuitarAvisoActivo();
  const d = cur();
  const foco = d?.mc ? { momento: d.mc.mi, indice: d.mc.ci } : null;
  await mcAbrirMisa(a.id, foco, { misa: a });
}

// Si el cancionero cargado cambia en Misas con el editor abierto, se avisa para actualizarlo
function mcQuitarAvisoActivo() {
  $('#mcAvisoActivo')?.remove();
}

function mcAvisarActivo() {
  if (EFIMERO) return;
  const a = mcLeerActivo();
  if (!a || state.mcMisa?.id !== a.id || mcActivoCargado(a)) return;
  mcQuitarAvisoActivo();
  const aviso = el('div', 'install-hint');
  aviso.id = 'mcAvisoActivo';
  aviso.innerHTML = `<span>«${escapeHtml(a.nombre || 'Cancionero')}» cambió en Misas</span>
    <button type="button" class="btn primary">Actualizar</button>
    <button type="button" class="panel-close" aria-label="Cerrar">×</button>`;
  aviso.querySelector('.btn').onclick = () => mcCargarActivo(mcLeerActivo() || a);
  aviso.querySelector('.panel-close').onclick = mcQuitarAvisoActivo;
  document.body.appendChild(aviso);
}

// ============ ABRIR ============
async function mcListar() {
  let r;
  try {
    r = await fetch(MC_API + '?accion=listar').then(res => res.json());
  } catch (_) {
    throw new Error('No se pudo conectar con el servidor de la parroquia. Revisa tu conexión a internet.');
  }
  if (!r.ok) throw new Error(r.error || 'El servidor de la parroquia no respondió.');
  return r.cancioneros || [];
}

async function driveOpenDialog() {
  if (!mcConfigurado()) return;
  toast('Buscando cancioneros en la nube…', 30000);
  let lista;
  try { lista = await mcListar(); } catch (e) { mcError('No se pudo abrir la nube', e); return; }
  toast('');
  if (!lista.length) {
    showModal({ title: 'Abrir desde la nube', body: '<p>Todavía no hay cancioneros guardados en la nube de la parroquia.</p>' });
    return;
  }
  let elegido = null;
  await showModal({
    title: 'Abrir desde la nube de la parroquia',
    wide: true,
    body: `<div class="mc-campos"><label for="mcFiltro">Comunidad</label>
        <select id="mcFiltro"><option value="">Todas</option>${Object.entries(MC_COMUNIDADES).map(([slug, nombre]) =>
          `<option value="${slug}">${escapeHtml(nombre)}</option>`).join('')}</select></div>
      <ul class="mc-lista">${lista.map(c => `<li data-c="${escapeHtml(c.comunidad)}">
        <span>${escapeHtml(c.titulo || 'Cancionero')}
          <small>${escapeHtml([c.fecha, c.comunidadNombre, `${c.canciones || 0} canciones`, c.comentario].filter(Boolean).join(' · '))}</small></span>
        <button type="button" class="btn primary" data-folder="${escapeHtml(c.folderId)}">Abrir</button></li>`).join('')}</ul>`,
    onOpen: d => {
      d.querySelector('#mcFiltro').onchange = e => d.querySelectorAll('.mc-lista li').forEach(li => {
        li.hidden = !!e.target.value && li.dataset.c !== e.target.value;
      });
      d.querySelectorAll('[data-folder]').forEach(b => { b.onclick = () => { elegido = b.dataset.folder; d.close(); }; });
    },
    buttons: [{ label: 'Cancelar' }]
  });
  if (elegido) await driveOpenFolder(elegido);
}

// Carpeta "virtual" con la forma de las del navegador (getDirectoryHandle / getFileHandle / getFile):
// así loadM3u8 abre el cancionero de la nube igual que uno de la carpeta de canciones. Cada archivo se
// descarga solo cuando se pide.
function mcCarpetaVirtual(archivos) {
  const noExiste = n => new DOMException(`No existe «${n}»`, 'NotFoundError');
  const carpeta = name => ({
    kind: 'directory', name, dirs: new Map(), files: new Map(),
    async getDirectoryHandle(n) { if (!this.dirs.has(n)) throw noExiste(n); return this.dirs.get(n); },
    async getFileHandle(n) { if (!this.files.has(n)) throw noExiste(n); return this.files.get(n); }
  });
  const raiz = carpeta('');
  for (const f of archivos) {
    const partes = f.ruta.split('/');
    let dir = raiz;
    for (const p of partes.slice(0, -1)) {
      if (!dir.dirs.has(p)) dir.dirs.set(p, carpeta(p));
      dir = dir.dirs.get(p);
    }
    const nombre = partes.at(-1);
    let archivo = null;
    dir.files.set(nombre, {
      kind: 'file', name: nombre,
      async getFile() {
        if (!archivo) {
          toast(`Descargando «${nombre}» de la nube…`, 120000);
          const res = await fetch(MC_API + '/archivo/' + encodeURIComponent(f.id));
          if (!res.ok) throw new Error(`No se pudo descargar «${nombre}»`);
          archivo = new File([await res.blob()], nombre, { type: f.mime || res.headers.get('Content-Type') || '' });
        }
        return archivo;
      }
    });
  }
  return raiz;
}

async function driveOpenFolder(folderId) {
  if (new URLSearchParams(location.search).has('drive')) history.replaceState(null, '', location.pathname + location.hash);
  if (!mcConfigurado()) return;
  const s = await mcEntrar();
  if (!s) return;
  toast('Abriendo el cancionero desde la nube…', 60000);
  try {
    const r = await mcApi('abrir', { token: s.token, folderId });
    const lista = r.archivos.find(f => /\.m3u8$/i.test(f.ruta) && !f.ruta.includes('/'));
    if (!lista) throw new Error('La carpeta del cancionero no tiene su lista cancionero.m3u8.');
    const raiz = mcCarpetaVirtual(r.archivos);
    const texto = await (await (await raiz.getFileHandle(lista.ruta)).getFile()).text();
    toast('');
    const antes = docs;
    const c = r.cancionero;
    await loadM3u8(parseM3u8(texto), raiz, [], null, { handle: null, path: `Nube · ${c.comunidadNombre || MC_COMUNIDADES[c.comunidad] || ''}` });
    if (docs !== antes) {
      state.mcDrive = { folderId, titulo: c.titulo, comunidad: c.comunidad, fecha: c.fecha, comentario: c.comentario || '', htmlId: c.htmlId };
      scheduleSave();
    }
  } catch (e) {
    mcError('No se pudo abrir el cancionero', e);
  }
}

// ============ INICIO ============
function driveInit() {
  mcPintarSesion();
  window.addEventListener('storage', e => {
    if (e.key === MC_SESION) mcPintarSesion();
    if (e.key === MC_ACTIVO_KEY) mcAvisarActivo();
  });
}
