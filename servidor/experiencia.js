// Lo que hace la app más cercana: Agradecimientos (autores, fuentes de los audios, parroquias y colaboradores),
// lo más cantado en Chile, este domingo en otras parroquias, «¿Qué canto te gustó más?», quienes colaboran en cada
// parroquia y el aviso del sábado (Web Push: las suscripciones y lo que dice el aviso; lo manda trabajadores/avisos).
import { ErrorApi, ahora, texto, parsear, hoyChile } from './util.js';
import { usuarioDeToken, guardarUsuario } from './auth.js';
import { parroquiasActivas } from './parroquias.js';
import { contar } from './comunidad.js';

// ==================== CACHÉ ====================
// En memoria (por instancia) y en la caché de Cloudflare (compartida), para no recalcular en cada visita

const memoria = new Map();
async function enCache(clave, seg, calcular) {
  const m = memoria.get(clave);
  if (m && m.vence > Date.now()) return m.valor;
  const url = 'https://cache.cancioneroliturgico.cl/' + encodeURIComponent(clave);
  const cache = typeof caches !== 'undefined' && caches.default;
  if (cache) {
    try {
      const r = await cache.match(url);
      if (r) {
        const valor = await r.json();
        memoria.set(clave, { valor, vence: Date.now() + Math.min(seg, 600) * 1000 });
        return valor;
      }
    } catch (_) { /* sin caché: se calcula */ }
  }
  const valor = await calcular();
  memoria.set(clave, { valor, vence: Date.now() + seg * 1000 });
  if (cache) {
    try {
      await cache.put(url, new Response(JSON.stringify(valor), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + seg } }));
    } catch (_) { /* queda en memoria */ }
  }
  return valor;
}

const sumarDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// El domingo que viene (hoy, si es domingo)
export const proximoDomingo = (hoy = hoyChile()) => sumarDias(hoy, (7 - new Date(hoy + 'T12:00:00Z').getUTCDay()) % 7);

const esYoutube = (u) => /(^|\.)(youtube\.com|youtu\.be)$/i.test(hostDe(u));
function hostDe(u) {
  try {
    return new URL(u).hostname.replace(/^(www|m)\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

// ==================== AGRADECIMIENTOS ====================

const separarNombres = (s) => String(s || '').split(/\s*(?:,|;|\/|&|\s+y\s+)\s*/i).map((x) => x.trim()).filter((x) => x.length > 1);

// El canal de YouTube de cada video (oEmbed): de a poco, unos pocos por cálculo, y quedan guardados
async function canalesDeYoutube(c, urls) {
  const { results } = await c.db.prepare('SELECT url, canal, canal_url FROM fuentes').all().catch(() => ({ results: [] }));
  const conocidas = new Map(results.map((r) => [r.url, r]));
  const faltan = [...new Set(urls)].filter((u) => !conocidas.has(u)).slice(0, 25);
  await Promise.all(faltan.map(async (u) => {
    let canal = '', canalUrl = '';
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u), { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        canal = texto(j.author_name, 120);
        canalUrl = /^https:\/\/(www\.)?youtube\.com\//.test(j.author_url || '') ? String(j.author_url).slice(0, 300) : '';
      } else if (r.status >= 500 || r.status === 429) return;
    } catch (_) {
      return;
    }
    conocidas.set(u, { url: u, canal, canal_url: canalUrl });
    await c.db.prepare('INSERT OR REPLACE INTO fuentes (url, canal, canal_url, revisado) VALUES (?, ?, ?, ?)').bind(u, canal, canalUrl, ahora()).run().catch(() => {});
  }));
  return conocidas;
}

async function calcularAgradecimientos(c) {
  const { results } = await c.db.prepare(
    "SELECT json_extract(datos, '$.letraDe') AS l, json_extract(datos, '$.musicaDe') AS m, json_extract(datos, '$.audios') AS a FROM canciones"
  ).all();
  const autores = new Map();
  const yt = [];
  const sitios = new Map();
  let propios = 0;
  for (const r of results) {
    const papeles = new Map();
    for (const n of separarNombres(r.l)) papeles.set(n, { ...(papeles.get(n) || {}), letra: true });
    for (const n of separarNombres(r.m)) papeles.set(n, { ...(papeles.get(n) || {}), musica: true });
    for (const [n, p] of papeles) {
      const clave = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const a = autores.get(clave) || { nombre: n, canciones: 0, letra: 0, musica: 0 };
      a.canciones++;
      if (p.letra) a.letra++;
      if (p.musica) a.musica++;
      autores.set(clave, a);
    }
    for (const a of parsear(r.a, []) || []) {
      if (a.fileId) propios++;
      else if (a.url && esYoutube(a.url)) yt.push(a.url);
      else if (a.url) {
        const h = hostDe(a.url);
        if (h) sitios.set(h, (sitios.get(h) || 0) + 1);
      }
    }
  }
  const fuentes = await canalesDeYoutube(c, yt);
  const canales = new Map();
  let sinCanal = 0;
  for (const u of yt) {
    const f = fuentes.get(u);
    if (!f || !f.canal) { sinCanal++; continue; }
    const x = canales.get(f.canal) || { nombre: f.canal, url: f.canal_url, videos: 0 };
    x.videos++;
    canales.set(f.canal, x);
  }
  const parroquias = (await parroquiasActivas(c)).map((p) => ({ slug: p.slug, nombre: p.nombre, comuna: p.comuna, tipo: p.tipo }));
  const { results: us } = await c.db.prepare("SELECT datos FROM usuarios WHERE json_extract(datos, '$.mostrarNombre') = 1").all();
  const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');
  return {
    autores: [...autores.values()].sort((a, b) => b.canciones - a.canciones || porNombre(a, b)),
    canales: [...canales.values()].sort((a, b) => b.videos - a.videos || porNombre(a, b)),
    videosSinCanal: sinCanal, videos: yt.length,
    sitios: [...sitios].map(([sitio, audios]) => ({ sitio, audios })).sort((a, b) => b.audios - a.audios),
    audiosPropios: propios,
    parroquias,
    colaboradores: us.map((r) => parsear(r.datos, {}).nombre).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')),
    canciones: results.length,
    calculado: ahora()
  };
}

export const agradecimientos = (c) => enCache('agradecimientos-v1', 86400, () => calcularAgradecimientos(c));

// De dónde viene cada audio enlazado (para «Audio: …» en los créditos)
async function fuentesAudios(c) {
  const lista = await enCache('fuentes-v1', 21600, async () => {
    const { results } = await c.db.prepare("SELECT url, canal FROM fuentes WHERE canal != ''").all().catch(() => ({ results: [] }));
    return results.map((r) => [r.url, r.canal]);
  });
  return { ok: true, fuentes: Object.fromEntries(lista) };
}

// ==================== LO MÁS CANTADO E INSPIRACIÓN ====================

async function visibles(c) {
  return new Map((await parroquiasActivas(c)).map((p) => [p.slug, p]));
}

async function masCantados(c) {
  const hoy = hoyChile();
  const valor = await enCache('mas-cantados-' + hoy, 21600, async () => {
    const pub = await visibles(c);
    const { results } = await c.db.prepare(
      "SELECT parroquia, json_extract(datos, '$.momentos') AS momentos FROM misas WHERE json_extract(datos, '$.fechaUso') BETWEEN ? AND ?"
    ).bind(sumarDias(hoy, -30), sumarDias(hoy, 7)).all();
    const cuenta = new Map();
    for (const r of results) {
      if (!pub.has(r.parroquia)) continue;
      const ids = new Set();
      for (const m of parsear(r.momentos, []) || []) for (const x of m.canciones || []) if (x.cancionId) ids.add(x.cancionId);
      for (const id of ids) {
        const x = cuenta.get(id) || { id, veces: 0, parroquias: new Set() };
        x.veces++;
        x.parroquias.add(r.parroquia);
        cuenta.set(id, x);
      }
    }
    return [...cuenta.values()].sort((a, b) => b.parroquias.size - a.parroquias.size || b.veces - a.veces).slice(0, 24)
      .map((x) => ({ id: x.id, veces: x.veces, parroquias: x.parroquias.size }));
  });
  return { ok: true, canciones: valor };
}

// Los cancioneros del próximo domingo de las otras parroquias (para escucharlos e inspirarse)
async function domingoEnOtras(c, p) {
  const domingo = proximoDomingo();
  const lista = await enCache('domingo-otras-' + domingo, 3600, async () => {
    const pub = await visibles(c);
    const { results } = await c.db.prepare(
      "SELECT parroquia, datos FROM misas WHERE json_extract(datos, '$.fechaUso') = ? ORDER BY orden DESC LIMIT 200"
    ).bind(domingo).all();
    return results.filter((r) => pub.has(r.parroquia)).map((r) => {
      const m = parsear(r.datos, {});
      const x = pub.get(r.parroquia);
      return {
        id: m.id, nombre: m.nombre, comunidadNombre: m.comunidadNombre || '', celebracion: m.celebracion || '', fechaUso: m.fechaUso,
        parroquia: { slug: x.slug, nombre: x.nombre, nombreCorto: x.nombreCorto, comuna: x.comuna, region: x.region, lat: x.lat, lng: x.lng },
        items: (m.momentos || []).flatMap((mo) => (mo.canciones || []).map((y) => ({ cancionId: y.cancionId, desplazamiento: y.desplazamiento || 0, momento: mo.momento })))
      };
    }).filter((m) => m.items.length);
  });
  const fuera = String((p && p.excluir) || '');
  return { ok: true, domingo, misas: lista.filter((m) => m.parroquia.slug !== fuera).slice(0, 16) };
}

// ==================== ¿QUÉ CANTO TE GUSTÓ MÁS? ====================

async function reaccionar(c, d) {
  const misa = texto(d.misa, 60), cancion = texto(d.cancion, 120), equipo = texto(d.equipo, 60);
  if (!/^[a-z0-9-]{8,60}$/i.test(equipo)) throw new ErrorApi('Falta el equipo.');
  const fila = await c.db.prepare('SELECT parroquia, datos FROM misas WHERE id = ?').bind(misa).first();
  if (!fila) throw new ErrorApi('Ese cancionero ya no está.');
  const m = parsear(fila.datos, {});
  if (!(m.momentos || []).some((mo) => (mo.canciones || []).some((x) => x.cancionId === cancion))) throw new ErrorApi('Esa canción no está en el cancionero.');
  await c.db.prepare('DELETE FROM limites WHERE vence < ?').bind(Date.now()).run();
  if (await contar(c, 'reac-' + (c.ip || 'x') + '-' + Math.floor(Date.now() / 3600000), 3600) > 60) {
    throw new ErrorApi('Demasiados votos desde esta conexión. Probá más tarde.');
  }
  await c.db.prepare('INSERT OR REPLACE INTO reacciones (misa_id, equipo, parroquia, cancion, cuando) VALUES (?, ?, ?, ?, ?)')
    .bind(misa, equipo, fila.parroquia, cancion, ahora()).run();
  return {};
}

async function reacciones(c, p) {
  const misa = texto(p.misa, 60);
  const { results } = await c.db.prepare(
    'SELECT cancion, COUNT(*) AS votos FROM reacciones WHERE misa_id = ? AND parroquia = ? GROUP BY cancion ORDER BY votos DESC'
  ).bind(misa, c.slug).all();
  return { ok: true, votos: results, total: results.reduce((s, r) => s + r.votos, 0) };
}

// ==================== QUIENES COLABORAN ====================

const APORTES = {
  cancion_subida: 'canciones', audio: 'audios', audio_vinculado: 'audios', partitura: 'partituras', partitura_subida: 'partituras',
  misa_guardada: 'cancioneros', cancionero: 'cancioneros', cancionero_guardado: 'cancioneros'
};

async function colaboradores(c) {
  const valor = await enCache('colaboradores-' + c.slug, 3600, async () => {
    const tipos = Object.keys(APORTES);
    const { results } = await c.db.prepare(
      `SELECT json_extract(datos, '$.email') AS email, json_extract(datos, '$.tipo') AS tipo, COUNT(*) AS n FROM auditoria
       WHERE parroquia = ? AND json_extract(datos, '$.tipo') IN (${tipos.map(() => '?').join(',')}) GROUP BY email, tipo`
    ).bind(c.slug, ...tipos).all();
    const totales = { canciones: 0, audios: 0, partituras: 0, cancioneros: 0 };
    const personas = new Map();
    for (const r of results) {
      if (!r.email) continue;
      const k = APORTES[r.tipo];
      totales[k] += r.n;
      const x = personas.get(r.email) || { aportes: 0 };
      x.aportes += r.n;
      personas.set(r.email, x);
    }
    const emails = [...personas.keys()];
    const nombres = [];
    for (let i = 0; i < emails.length; i += 90) {
      const parte = emails.slice(i, i + 90);
      const { results: us } = await c.db.prepare(`SELECT email, datos FROM usuarios WHERE email IN (${parte.map(() => '?').join(',')})`).bind(...parte).all();
      for (const u of us) {
        const d = parsear(u.datos, {});
        if (d.mostrarNombre && d.nombre && d.nombre !== u.email) nombres.push({ nombre: d.nombre, aportes: personas.get(u.email).aportes });
      }
    }
    nombres.sort((a, b) => b.aportes - a.aportes || a.nombre.localeCompare(b.nombre, 'es'));
    return { totales, nombres: nombres.map((x) => x.nombre), otros: personas.size - nombres.length };
  });
  return { ok: true, ...valor };
}

async function preferenciaColaborador(c, d) {
  const u = await usuarioDeToken(c, d.token);
  u.mostrarNombre = d.mostrar === true;
  await guardarUsuario(c, u);
  memoria.delete('colaboradores-' + c.slug);
  return { mostrarNombre: u.mostrarNombre };
}

// ==================== AVISO DEL SÁBADO ====================

const avisoClave = (c) => ({ ok: true, clave: c.env.VAPID_PUBLICA || '' });

async function suscribirAviso(c, d) {
  const s = d.suscripcion || {};
  const endpoint = String(s.endpoint || '');
  if (!/^https:\/\/[^\s]{10,900}$/.test(endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) throw new ErrorApi('La suscripción no es válida.');
  if (await contar(c, 'susc-' + (c.ip || 'x') + '-' + Math.floor(Date.now() / 3600000), 3600) > 20) throw new ErrorApi('Probá más tarde.');
  const datos = { keys: { p256dh: texto(s.keys.p256dh, 200), auth: texto(s.keys.auth, 100) }, comunidad: texto(d.comunidad, 60) };
  await c.db.prepare('INSERT OR REPLACE INTO suscripciones (endpoint, parroquia, datos, creado) VALUES (?, ?, ?, ?)')
    .bind(endpoint, c.slug, JSON.stringify(datos), ahora()).run();
  return {};
}

async function desuscribirAviso(c, d) {
  await c.db.prepare('DELETE FROM suscripciones WHERE endpoint = ?').bind(String(d.endpoint || '')).run();
  return {};
}

// Lo que dice el aviso (el service worker lo pide al recibirlo): el cancionero del domingo, si ya está
async function avisoDomingo(c, p) {
  const domingo = proximoDomingo();
  const { results } = await c.db.prepare(
    "SELECT datos FROM misas WHERE parroquia = ? AND json_extract(datos, '$.fechaUso') = ? ORDER BY orden DESC"
  ).bind(c.slug, domingo).all();
  const misas = results.map((r) => parsear(r.datos, {}));
  const comunidad = texto(p && p.comunidad, 60);
  const m = misas.find((x) => comunidad && x.comunidad === comunidad) || misas[0];
  const nombre = (c.parroquia && c.parroquia.nombreCorto) || 'tu parroquia';
  if (!m) {
    return {
      ok: true, domingo, titulo: 'Mañana es domingo 🎶',
      cuerpo: 'Prepara los cantos de la misa de ' + nombre + ': mira los sugeridos para este domingo.', url: '/' + c.slug + '/', canciones: []
    };
  }
  const canciones = (m.momentos || []).flatMap((mo) => (mo.canciones || []).map((x) => x.cancionId)).filter(Boolean);
  return {
    ok: true, domingo, titulo: 'Mañana: ' + m.nombre,
    cuerpo: 'Ya está el cancionero de ' + (m.comunidadNombre || nombre) + ' (' + canciones.length + ' cantos). Tócalo para ensayar; las letras quedan guardadas para la misa.',
    url: '/' + c.slug + '/#misa=' + encodeURIComponent(m.id), misa: m.id, canciones
  };
}

export const accionesExperiencia = { reaccionar, preferenciaColaborador, suscribirAviso, desuscribirAviso };
export const lecturasExperiencia = {
  agradecimientos: async (c) => ({ ok: true, ...(await agradecimientos(c)) }),
  fuentesAudios, masCantados, domingoEnOtras, reacciones, colaboradores, avisoClave, avisoDomingo
};
// Las que no dependen de la parroquia
export const GET_COMUNES_EXPERIENCIA = ['agradecimientos', 'fuentesAudios', 'masCantados', 'domingoEnOtras', 'avisoClave'];
