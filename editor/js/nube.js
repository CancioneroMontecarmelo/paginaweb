'use strict';
// Drive de la parroquia: guarda el cancionero abierto en la cuenta de la parroquia (por el Apps Script
// de backend/Code.gs) y lo vuelve a abrir desde ahí. Cada cancionero queda en su carpeta:
//   cancionero.m3u8 · canciones/*.md · audios/* · <Título>.html (página con los audios adentro)
// Sin apiUrl en js/config.js solo funcionan las carpetas del equipo.

const MC_API = (window.MONTECARMELO_CONFIG || {}).apiUrl || '';
const MC_SALT = 'montecarmelo-v1';
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
function mcTokenVigente(token) {
  try {
    const p = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4))).exp > Date.now() + 60000;
  } catch (_) {
    return false;
  }
}

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

async function mcHash(clave) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(MC_SALT + clave));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function mcApi(accion, datos = {}) {
  let r;
  try {
    const res = await fetch(MC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, ...datos })
    });
    r = await res.json();
  } catch (_) {
    throw new Error('No se pudo conectar con el Drive de la parroquia. Revisa tu conexión a internet.');
  }
  if (!r.ok) {
    if (/sesi[oó]n (inv[aá]lida|venci[oó])/i.test(r.error || '')) { localStorage.removeItem(MC_SESION); mcPintarSesion(); }
    throw new Error(r.error || 'El Drive de la parroquia no respondió.');
  }
  return r;
}

function mcConfigurado() {
  if (MC_API) return true;
  showModal({
    title: 'Drive de la parroquia',
    body: `<p>El Drive de la parroquia todavía no está conectado: falta la dirección del Apps Script en <code>js/config.js</code>.</p>
      <p class="hint">Mientras tanto puedes guardar el cancionero en tu equipo con <b>Archivo → Guardar cancionero</b>.</p>`
  });
  return false;
}

function mcError(titulo, e) {
  toast('');
  showModal({ title: titulo, body: `<p>${escapeHtml(e.message || String(e))}</p>` });
}

// Devuelve la sesión con token, pidiendo correo y clave si hace falta (null si se canceló)
async function mcEntrar() {
  const vigente = mcSesion();
  if (vigente) return vigente;
  let sesion = null;
  await showModal({
    title: 'Identificarse',
    body: `<p>Para usar el Drive de la parroquia entra con tu cuenta del sitio.</p>
      <div class="mc-campos">
        <label for="mcEmail">Correo electrónico</label><input type="email" id="mcEmail" autocomplete="email">
        <label for="mcClave">Clave</label><input type="password" id="mcClave" autocomplete="current-password">
      </div>
      <p class="hint">¿No tienes cuenta? <a href="../login.html" target="_blank" rel="noopener">Solicita acceso</a>.</p>`,
    onOpen: d => d.querySelector('#mcEmail').focus(),
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Entrar', primary: true,
        onClick: d => {
          const email = d.querySelector('#mcEmail').value.trim();
          const clave = d.querySelector('#mcClave').value;
          if (!email || !clave) return modalFail(d, 'Escribe tu correo y tu clave.');
          modalFail(d, 'Entrando…');
          mcHash(clave).then(hash => mcApi('login', { email, hash })).then(r => {
            sesion = { ...r.sesion, token: r.token, desde: Date.now() };
            localStorage.setItem(MC_SESION, JSON.stringify(sesion));
            mcPintarSesion();
            d.close();
          }, e => modalFail(d, e.message));
          return false;
        }
      }
    ]
  });
  if (sesion?.debeCambiarClave) toast('Recuerda crear tu clave definitiva en la página Identificarse del sitio.', 6000);
  return sesion;
}

// ============ GUARDAR ============
const mcBase64 = blob => blobDataUrl(blob).then(u => u.slice(u.indexOf(',') + 1));
const mcFecha = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

async function driveSaveDialog() {
  if (!mcConfigurado()) return;
  syncFromEditor();
  const songs = bookSongs();
  if (!songs.length) { toast('No hay canciones abiertas para guardar'); return; }
  const s = await mcEntrar();
  if (!s) return;
  const prev = state.mcDrive;
  const todas = MC_ROLES_TODAS.includes(s.rol) || !MC_COMUNIDADES[s.comunidad];
  const opciones = Object.entries(MC_COMUNIDADES).filter(([slug]) => todas || slug === s.comunidad);
  const elegida = prev?.comunidad && opciones.some(([slug]) => slug === prev.comunidad) ? prev.comunidad
    : MC_COMUNIDADES[s.comunidad] ? s.comunidad : opciones[0][0];
  const conAudios = songs.some(d => d.audios.some(canEmbed));
  const res = await showModal({
    title: 'Guardar en el Drive de la parroquia',
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
        label: 'Guardar en Drive', primary: true,
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
  let html = new Blob([buildAtrilHtml(songs, { titulo: opts.titulo, embedded, share })], { type: 'text/html' });
  if (html.size > MC_MAX_ARCHIVO && embedded.size) {
    html = new Blob([buildAtrilHtml(songs, { titulo: opts.titulo, share })], { type: 'text/html' });
    pesada = true;
  }
  const htmlRuta = unico('', safeFileName(opts.titulo), '.html');
  files.push({ ruta: htmlRuta, blob: html, mime: 'text/html' });
  return { files, htmlRuta, audios: audioRuta.size, faltan, grandes, sinIncluir, pesada };
}

async function mcGuardar(songs, opts, s) {
  let terminado = false;
  showModal({
    title: 'Guardando en el Drive de la parroquia',
    body: `<p class="mc-paso">Preparando el cancionero…</p><progress class="mc-progreso" max="1" value="0"></progress>
      <p class="hint">No cierres esta página hasta que termine.</p>`,
    buttons: [{ label: 'Cancelar' }]
  });
  const dlg = $('#modal');
  const avance = (texto, hecho = 0, total = 1) => {
    if (!dlg.open) return;
    dlg.querySelector('.mc-paso').textContent = texto;
    dlg.querySelector('.mc-progreso').value = total ? hecho / total : 0;
  };
  const seguir = () => { if (!terminado && !dlg.open) throw new Error('cancelado'); };

  try {
    const armado = await mcArmarArchivos(songs, opts, avance);
    seguir();
    avance('Conectando con el Drive…');
    const base = { token: s.token, comunidad: opts.comunidad, titulo: opts.titulo, fecha: opts.fecha };
    let ini;
    if (opts.actualizar && state.mcDrive?.folderId) {
      ini = await mcApi('iniciarCancionero', { ...base, folderId: state.mcDrive.folderId }).catch(() => null);
    }
    ini ||= await mcApi('iniciarCancionero', base);
    const existentes = new Map((ini.existentes || []).map(f => [f.ruta, f.size]));
    const total = armado.files.reduce((n, f) => n + f.blob.size, 0) || 1;
    let hecho = 0;
    for (const [i, f] of armado.files.entries()) {
      seguir();
      avance(`Subiendo ${i + 1} de ${armado.files.length}: ${f.ruta}`, hecho, total);
      if (!(f.audio && existentes.get(f.ruta) === f.blob.size)) {
        await mcApi('subirArchivo', { token: s.token, folderId: ini.folderId, ruta: f.ruta, mime: f.mime, base64: await mcBase64(f.blob) });
      }
      hecho += f.blob.size;
    }
    seguir();
    avance('Publicando en la lista de la comunidad…', 1, 1);
    const fin = await mcApi('cerrarCancionero', {
      token: s.token, folderId: ini.folderId, conservar: armado.files.map(f => f.ruta), htmlRuta: armado.htmlRuta,
      canciones: songs.length, audios: armado.audios, comentario: opts.comentario
    });
    terminado = true;
    state.mcDrive = { folderId: ini.folderId, titulo: opts.titulo, comunidad: opts.comunidad, fecha: opts.fecha, comentario: opts.comentario, htmlId: fin.cancionero.htmlId };
    songs.forEach(d => markClean(d));
    setActiveBook(opts.titulo, null, `Drive · ${MC_COMUNIDADES[opts.comunidad]}`);
    refresh();
    dlg.close();
    mcGuardado(opts, songs.length, armado, fin.cancionero.htmlId);
  } catch (e) {
    terminado = true;
    if (dlg.open) dlg.close();
    if (e.message === 'cancelado') toast('Guardado en Drive cancelado', 3000);
    else mcError('No se pudo guardar en el Drive', e);
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
    title: 'Guardado en el Drive ✓',
    body: `<p>«${escapeHtml(opts.titulo)}» quedó en el Drive de la parroquia, en <b>${escapeHtml(MC_COMUNIDADES[opts.comunidad])}</b>:
        ${nCanciones} ${nCanciones === 1 ? 'canción' : 'canciones'} y ${armado.audios} ${armado.audios === 1 ? 'audio' : 'audios'}.</p>
      ${notas.length ? `<ul class="book-list">${notas.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${url ? `<p>Ya aparece en la página de la comunidad. Enlace para verlo:<br><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>` : ''}`,
    buttons: [
      { label: 'Cerrar' },
      ...(url ? [
        { label: 'Copiar enlace', onClick: d => { navigator.clipboard?.writeText(url).then(() => modalFail(d, 'Enlace copiado ✓'), () => modalFail(d, url)); return false; } },
        { label: 'Enviar por WhatsApp', primary: true, onClick: () => { window.open('https://wa.me/?text=' + encodeURIComponent(mensaje), '_blank', 'noopener'); } }
      ] : [])
    ]
  });
}

// ============ ABRIR ============
async function mcListar() {
  let r;
  try {
    r = await fetch(MC_API + '?accion=listar').then(res => res.json());
  } catch (_) {
    throw new Error('No se pudo conectar con el Drive de la parroquia. Revisa tu conexión a internet.');
  }
  if (!r.ok) throw new Error(r.error || 'El Drive de la parroquia no respondió.');
  return r.cancioneros || [];
}

async function driveOpenDialog() {
  if (!mcConfigurado()) return;
  toast('Buscando cancioneros en el Drive…', 30000);
  let lista;
  try { lista = await mcListar(); } catch (e) { mcError('No se pudo abrir el Drive', e); return; }
  toast('');
  if (!lista.length) {
    showModal({ title: 'Abrir desde el Drive', body: '<p>Todavía no hay cancioneros guardados en el Drive de la parroquia.</p>' });
    return;
  }
  let elegido = null;
  await showModal({
    title: 'Abrir desde el Drive de la parroquia',
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

function mcBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Carpeta "virtual" con la forma de las del navegador (getDirectoryHandle / getFileHandle / getFile):
// así loadM3u8 abre el cancionero del Drive igual que uno de la carpeta de canciones. Cada archivo se
// descarga solo cuando se pide.
function mcCarpetaVirtual(archivos, token) {
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
          toast(`Descargando «${nombre}» del Drive…`, 120000);
          const r = await mcApi('archivo', { token, id: f.id });
          archivo = new File([mcBytes(r.base64)], nombre, { type: r.mime || f.mime || '' });
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
  toast('Abriendo el cancionero desde el Drive…', 60000);
  try {
    const r = await mcApi('abrir', { token: s.token, folderId });
    const lista = r.archivos.find(f => /\.m3u8$/i.test(f.ruta) && !f.ruta.includes('/'));
    if (!lista) throw new Error('La carpeta del cancionero no tiene su lista cancionero.m3u8.');
    const raiz = mcCarpetaVirtual(r.archivos, s.token);
    const texto = await (await (await raiz.getFileHandle(lista.ruta)).getFile()).text();
    toast('');
    const antes = docs;
    const c = r.cancionero;
    await loadM3u8(parseM3u8(texto), raiz, [], null, { handle: null, path: `Drive · ${c.comunidadNombre || MC_COMUNIDADES[c.comunidad] || ''}` });
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
  window.addEventListener('storage', e => { if (e.key === MC_SESION) mcPintarSesion(); });
}
