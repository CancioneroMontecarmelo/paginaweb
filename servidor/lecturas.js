// Lecturas del día. Fuente: eucaristiadiaria.cl (Área de Liturgia, Arzobispado de Santiago). Publican mes a
// mes: un día que todavía no está devuelve la página sin secciones. Los días encontrados quedan en la tabla
// `lecturas` para siempre; los que todavía no están se vuelven a consultar a la media hora.
import { ErrorApi, fecha as fechaValida, hoyChile, parsear } from './util.js';

const LECTURAS_URL = 'https://www.eucaristiadiaria.cl/dia_cal.php?fecha=';
const LECTURAS_SECCIONES = { inicio: 'Ritos iniciales', liturgia: 'Liturgia de la Palabra', evangelio: 'Evangelio', eucaristia: 'Liturgia eucarística' };
const ESPERA_NO_PUBLICADA = 30 * 60 * 1000;

async function guardadas(c, fechas) {
  if (!fechas.length) return new Map();
  const { results } = await c.db.prepare(`SELECT fecha, vence, datos FROM lecturas WHERE fecha IN (${fechas.map(() => '?').join(',')})`)
    .bind(...fechas).all();
  const ahora = Date.now();
  return new Map(results.filter((r) => !r.vence || r.vence > ahora).map((r) => [r.fecha, parsear(r.datos)]));
}

async function bajar(c, fecha) {
  const res = await fetch(LECTURAS_URL + fecha, { redirect: 'follow' });
  if (res.status !== 200) throw new ErrorApi('No se pudo leer eucaristiadiaria.cl (' + res.status + ')');
  const l = parsearLecturas(await res.text());
  l.fecha = fecha;
  l.fuente = LECTURAS_URL + fecha;
  await c.db.prepare('INSERT OR REPLACE INTO lecturas (fecha, vence, datos) VALUES (?, ?, ?)')
    .bind(fecha, l.disponible ? 0 : Date.now() + ESPERA_NO_PUBLICADA, JSON.stringify(l)).run();
  return l;
}

export async function lecturas(c, fecha) {
  fecha = fechaValida(fecha);
  if (!fecha) throw new ErrorApi('Fecha inválida');
  const l = (await guardadas(c, [fecha])).get(fecha) || await bajar(c, fecha);
  return { ok: true, lecturas: l };
}

// Resumen de varios días seguidos para el calendario de Inicio
export async function calendario(c, p) {
  const desde = fechaValida(p.desde) || hoyChile();
  const dias = Math.max(1, Math.min(14, Math.round(Number(p.dias) || 7)));
  const base = new Date(desde + 'T12:00:00Z').getTime();
  const fechas = Array.from({ length: dias }, (_, i) => new Date(base + i * 86400000).toISOString().slice(0, 10));
  const hay = await guardadas(c, fechas);
  const lista = await Promise.all(fechas.map(async (f) => {
    try {
      const l = hay.get(f) || await bajar(c, f);
      return { fecha: f, disponible: l.disponible, dia: l.dia, titulo: l.titulo, color: l.color, tiempo: l.tiempo };
    } catch (err) {
      return { fecha: f, disponible: false, error: String(err.message || err) };
    }
  }));
  return { ok: true, desde, dias: lista };
}

export function parsearLecturas(html) {
  const fin = html.indexOf('id="pie"');
  if (fin > 0) html = html.slice(0, fin);
  const t = /class="titulos"[^>]*>([\s\S]*?)<br/i.exec(html);
  const l = { disponible: false, dia: t ? textoHtml(t[1]) : '', titulo: '', color: '', tiempo: '', secciones: [] };
  const re = /<a name="(\w+)" class="subtitulos">([\s\S]*?)<\/a>/gi;
  const marcas = [];
  let m;
  while ((m = re.exec(html))) marcas.push({ id: m[1], nombre: textoHtml(m[2]), desde: re.lastIndex });
  marcas.forEach((s, i) => {
    const cuerpo = html.slice(s.desde, i + 1 < marcas.length ? marcas[i + 1].desde : html.length);
    const bloques = [];
    const rp = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = rp.exec(cuerpo))) {
      const b = bloqueLectura(pm[1], pm[2]);
      if (b) bloques.push(b);
    }
    if (bloques.length) l.secciones.push({ id: s.id, nombre: LECTURAS_SECCIONES[s.id] || s.nombre, bloques });
  });
  l.disponible = l.secciones.some((s) => s.id === 'liturgia' || s.id === 'evangelio');
  // Al comienzo de los ritos iniciales van, centrados y en rojo: la fecha, la celebración y el color litúrgico
  const ini = l.secciones.find((s) => s.id === 'inicio');
  if (ini) {
    const centrados = [];
    while (ini.bloques.length && ini.bloques[0].centro) centrados.push(ini.bloques.shift().x);
    if (centrados.length > 1) l.titulo = centrados[1];
    if (centrados.length > 2 && /^(verde|blanco|rojo|morado|rosado|negro|azul)/i.test(centrados[2])) l.color = centrados[2];
    if (!l.titulo && centrados.length) l.titulo = centrados[0];
    if (!ini.bloques.length) l.secciones = l.secciones.filter((s) => s !== ini);
  }
  l.tiempo = tiempoDeTitulo(l.titulo);
  l.secciones.forEach((s) => s.bloques.forEach((b) => { delete b.centro; }));
  return l;
}

// Bloque de una lectura: h = título (todo en rojo), c = de dónde se lee (con la cita en rojo),
// e = frase que resume la lectura (cursiva), p = texto
function bloqueLectura(atributos, interior) {
  const x = textoHtml(interior);
  if (!x || x === '+++') return null;
  const rojo = /<span style="color:\s*rgb\((?:238|255), 0, 0\)">([\s\S]*?)<\/span>/gi;
  let m, enRojo = '';
  while ((m = rojo.exec(interior))) enRojo += textoHtml(m[1]);
  const b = { t: 'p', x };
  if (enRojo && enRojo.replace(/\s+/g, '') === x.replace(/\s+/g, '')) b.t = 'h';
  else if (/^\s*(<span[^>]*>\s*)*<em>/i.test(interior)) b.t = 'e';
  else if (/\d/.test(enRojo) && x.length < 220) b.t = 'c';
  if (/text-align:\s*center/i.test(atributos) && b.t === 'h') b.centro = true;
  return b;
}

const ACENTOS_HTML = { acute: '\u0301', grave: '\u0300', circ: '\u0302', uml: '\u0308', tilde: '\u0303', cedil: '\u0327' };
const ENTIDADES_HTML = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', sbquo: '‚', bdquo: '„', hellip: '…', ndash: '–', mdash: '—', iexcl: '¡', iquest: '¿',
  ordf: 'ª', ordm: 'º', deg: '°', middot: '·', bull: '•', szlig: 'ß', aelig: 'æ', oelig: 'œ', copy: '©', dagger: '†'
};

function textoHtml(h) {
  return String(h || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&([a-zA-Z])(acute|grave|circ|uml|tilde|cedil);/g, (_, l, a) => (l + ACENTOS_HTML[a]).normalize('NFC'))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (e, n) => (Object.prototype.hasOwnProperty.call(ENTIDADES_HTML, n) ? ENTIDADES_HTML[n] : e))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// Tiempo litúrgico según el título del día (los nombres son las etiquetas del grupo «Tiempos litúrgicos»)
export function tiempoDeTitulo(titulo) {
  const t = String(titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const reglas = [
    [/MIERCOLES DE CENIZA/, 'Miércoles de Ceniza'], [/DOMINGO DE RAMOS/, 'Domingo de Ramos'],
    [/JUEVES SANTO/, 'Jueves Santo'], [/VIERNES SANTO/, 'Viernes Santo'], [/VIGILIA PASCUAL/, 'Vigilia Pascual'],
    [/SEMANA SANTA/, 'Semana Santa'], [/PENTECOSTES/, 'Pentecostés'], [/ASCENSION DEL SENOR/, 'Ascensión'],
    [/EPIFANIA/, 'Epifanía'], [/ADVIENTO/, 'Adviento'], [/CUARESMA/, 'Cuaresma'], [/PASCUA/, 'Pascua'],
    [/NAVIDAD|NATIVIDAD DEL SENOR/, 'Navidad'], [/TIEMPO ORDINARIO/, 'Tiempo ordinario']
  ];
  for (const [re, nombre] of reglas) if (re.test(t)) return nombre;
  return '';
}
