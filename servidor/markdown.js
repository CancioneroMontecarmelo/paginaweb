// Lectura y escritura de las canciones .md del editor (mismo formato que editor/js/markdown.js).

export function desescapar(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function escaparAtributo(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Id de un archivo a partir de sus enlaces: los de este sitio (…/api/audio/<id>, …/api/archivo/<id>) y los
// que había antes en el Drive (uc?id=…, open?id=…, /file/d/…), que conservan el mismo id
export function idDeEnlace(url) {
  const u = String(url || '');
  let m = u.match(/^https?:\/\/(?:drive|docs)\.google\.com\/(?:.*[?&]id=|file\/d\/)([\w-]{20,})/i);
  if (m) return m[1];
  m = u.match(/^(?:https?:\/\/[^/]+)?\/api\/(?:audio|archivo)\/([\w-]{10,})(?:[?#]|$)/i);
  return m ? m[1] : '';
}

export const urlAudio = (c, fileId) => c.sitio + 'api/audio/' + fileId;

// El video de la cabecera («youtube: …») también es un audio de la canción
const YOUTUBE_RE = /^https?:\/\/([^/]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i;
export function videoDeCabecera(texto) {
  const url = String(metaMd(texto).youtube || '').trim();
  return YOUTUBE_RE.test(url) ? url : '';
}
export function conVideoDeCabecera(audios, texto) {
  const url = videoDeCabecera(texto);
  if (!url || audios.some((a) => a.url === url)) return audios;
  return audios.concat([{ nombre: 'Video de YouTube', voz: '', url }]).slice(0, 20);
}

// Etiqueta <audio> con el mismo formato que escribe el editor
export function etiquetaAudio(c, a) {
  const src = a.fileId ? urlAudio(c, a.fileId) : a.url;
  const voz = a.voz && a.voz !== 'todas' ? ' data-voz="' + escaparAtributo(a.voz) + '"' : '';
  return '<audio controls src="' + escaparAtributo(src) + '" title="' + escaparAtributo(a.nombre || 'Audio') + '"' + voz + '></audio>';
}

export function metaMd(texto) {
  const meta = {};
  const m = String(texto || '').replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (m) m[1].split('\n').forEach((l) => {
    const i = l.indexOf(':');
    if (i < 1) return;
    let v = l.slice(i + 1).trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch (_) { v = v.slice(1, -1); } }
    meta[l.slice(0, i).trim().toLowerCase()] = v;
  });
  return meta;
}

// Título, tono, etiquetas, audios y créditos de una canción .md
export function cabeceraMd(texto, nombreArchivo) {
  const t = String(texto || '').replace(/\r\n?/g, '\n');
  const meta = metaMd(t);
  const h = t.match(/^#\s+(.+)$/m);
  const titulo = String(meta.titulo || meta.title || (h && h[1]) || String(nombreArchivo || '').replace(/\.md$/i, '') || 'Sin título').trim();
  const etiquetas = String(meta.etiquetas || meta.tags || '').split(',').map((x) => x.trim()).filter(Boolean);
  const audios = (t.match(/<audio\b[^>]*>/gi) || []).map((tag) => {
    const at = (n) => { const r = tag.match(new RegExp('\\s' + n + '="([^"]*)"', 'i')); return r ? desescapar(r[1]) : ''; };
    return { src: at('src'), nombre: at('title'), voz: at('data-voz') };
  }).filter((a) => a.src);
  return {
    titulo: titulo.slice(0, 150), tono: String(meta.tono || '').slice(0, 40), etiquetas: etiquetas.slice(0, 40), audios,
    letraDe: String(meta['letra-de'] || '').trim().slice(0, 120), musicaDe: String(meta['musica-de'] || '').trim().slice(0, 120)
  };
}

// true si el .md no tiene letra (solo título, cabecera y audios): canción subida solo con su audio
export function soloAudioMd(texto) {
  const t = String(texto || '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---/, '');
  const bloque = t.match(/(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1/);
  const cuerpo = bloque ? bloque[2] : t.replace(/^#\s+.*$/m, '').replace(/^\*\*[^*\n]+:\*\*.*$/gm, '')
    .replace(/<audio\b[^>]*>(\s*<\/audio>)?/gi, '').replace(/!?\[[^\]]*\]\([^)]*\)/g, '');
  return !cuerpo.trim();
}

// Línea de acordes (como isChordLine de editor/js/acordes.js): casi todas sus palabras son acordes
const ACORDE_RE = /^\(?(do|re|mi|fa|sol|la|si|[a-g])(#|b|♯|♭)?(maj|min|dim|aug|sus|add|alt|m|º|°|ø|\+|-|'|\*|\d|#|b|♯|♭|\(|\)|,|\/(?=[0-9#b♯♭]))*(\/(do|re|mi|fa|sol|la|si|[a-g])(#|b|♯|♭)?)?\)?[.,;]?$/i;
const NEUTRO_RE = /^(\|+:?|:?\|+|-+|\/+|\.{2,}|%|x\d+|\(x?\d+x?\)|\(?bis\)?|.+:)$/i;
function lineaDeAcordes(l) {
  let a = 0, o = 0;
  l.trim().split(/\s+/).forEach((t) => {
    const partes = t.split(/-(?=.)/).filter(Boolean);
    if (ACORDE_RE.test(t) || (partes.length > 1 && partes.every((p) => ACORDE_RE.test(p)))) a++;
    else if (!NEUTRO_RE.test(t)) o++;
  });
  return a > 0 && a / (a + o) >= 0.7 && !/(?:^|\s)(do|re|mi|fa|sol|la|si|[a-g])[,.;!?]* \1(?=[\s,.;!?]|$)/.test(l);
}

// Letra para buscar: la primera estrofa entera y las dos primeras líneas de las demás, sin acordes,
// separadas por « / » (la Biblioteca pública la usa para buscar canciones por su letra)
export function letraInicio(texto) {
  const t = String(texto || '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---/, '');
  const bloque = t.match(/(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1/);
  const cuerpo = bloque ? bloque[2] : t.replace(/^#\s+.*$/gm, '').replace(/^\*\*[^*\n]+:\*\*.*$/gm, '');
  const estrofas = [];
  let actual = [];
  cuerpo.replace(/<audio\b[^>]*>(\s*<\/audio>)?/gi, '').split('\n').forEach((cruda) => {
    let l = cruda.replace(/\*\*|__/g, '').replace(/!?\[[^\]]*\]\([^)]*\)/g, '').trim();
    if (!l) {
      if (actual.length) estrofas.push(actual);
      actual = [];
      return;
    }
    if (/^(>|#)/.test(l) || /^\[[^\]]*\]$/.test(l) || /^[^\s]{1,20}:$/.test(l) || lineaDeAcordes(l)) return;
    l = l.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    if (l) actual.push(l);
  });
  if (actual.length) estrofas.push(actual);
  let lineas = [];
  estrofas.forEach((e, i) => { lineas = lineas.concat(i ? e.slice(0, 2) : e); });
  let r = '';
  for (const linea of lineas) {
    const mas = (r ? ' / ' : '') + linea;
    if (r.length + mas.length > 900) break;
    r += mas;
  }
  return r;
}

// Agrega las etiquetas <audio> de `nuevos` y quita las de `quitados`
export function textoConAudios(c, texto, nuevos, quitados) {
  texto = String(texto || '').replace(/\r\n?/g, '\n');
  (quitados || []).forEach((a) => {
    texto = texto.replace(/[ \t]*<audio\b[^>]*>(?:\s*<\/audio>)?[ \t]*\n?/gi, (tag) => {
      const src = desescapar((tag.match(/\ssrc="([^"]*)"/i) || [])[1] || '');
      const titulo = desescapar((tag.match(/\stitle="([^"]*)"/i) || [])[1] || '');
      const es = a.fileId ? (idDeEnlace(src) === a.fileId || (!/^https?:/i.test(src) && titulo && titulo === a.nombre)) : src === a.url;
      return es ? '' : tag;
    });
  });
  if (nuevos && nuevos.length) {
    texto = texto.replace(/\s*$/, '\n\n') + nuevos.map((a) => etiquetaAudio(c, a)).join('\n\n') + '\n';
  }
  return texto.replace(/\n{3,}/g, '\n\n');
}

// Reescribe la línea «etiquetas:» de la cabecera
export function textoConEtiquetas(texto, etiquetas) {
  const linea = 'etiquetas: ' + etiquetas.join(', ');
  const m = texto.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return '---\n' + linea + '\n---\n\n' + texto;
  const cab = /^(etiquetas|tags):.*$/m.test(m[1]) ? m[1].replace(/^(etiquetas|tags):.*$/m, () => linea) : m[1] + '\n' + linea;
  return '---\n' + cab + '\n---' + texto.slice(m[0].length);
}
