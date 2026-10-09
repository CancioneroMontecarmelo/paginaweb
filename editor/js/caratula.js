'use strict';
// Carátulas de las canciones: la imagen que trae el audio (ID3 o m4a), la miniatura de su video de YouTube
// o, si no hay, una generada con el color del momento o del tiempo litúrgico y las iniciales del título.

const CARA_COLORES = [
  [/adviento|cuaresma|ceniza|penitencial|perd[oó]n|piedad|kyrie|reconciliaci|morado/i, '#6a3d9a'],
  [/pentecost|esp[ií]ritu|m[aá]rtir|ramos|viernes santo|cruz|rojo/i, '#b3261e'],
  [/navidad|villancico|pascua|resurrecci|epifan|ascensi|gloria|aleluya|blanco/i, '#a87b05'],
  [/marian|mar[ií]a|virgen|rosario|carmen/i, '#1e5aa8'],
  [/comuni[oó]n|eucarist|adoraci|corpus|santo|cordero|padre ?nuestro/i, '#8d5524'],
  [/entrada|salida|env[ií]o|ofertorio|ofrenda|dones|gracias/i, '#00796b'],
  [/salmo|leccional|palabra|evangelio/i, '#455a64'],
  [/ordinario|verde/i, '#2e7d32']
];

function caraColor(etiquetas, titulo) {
  for (const t of etiquetas) {
    const c = CARA_COLORES.find(([re]) => re.test(t));
    if (c) return c[1];
  }
  let h = 0;
  for (const ch of String(titulo || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${h % 360} 42% 34%)`;
}

const caraIniciales = titulo => {
  const p = String(titulo || '').replace(/^\d+\s*[-.)]\s*/, '').split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(w => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w)).slice(0, 2);
  return p.map(w => w[0]).join('').toUpperCase() || '♪';
};

function caraYoutube(audios) {
  for (const a of audios || []) {
    const id = youtubeId(a.src || a.url || '');
    if (id) return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  }
  return '';
}

// info: { titulo, etiquetas, audios: [{ src | url }], momento, imagen }
function caraHtml(info, clase = '') {
  const color = caraColor([info.momento, ...(info.etiquetas || [])].filter(Boolean), info.titulo);
  const img = info.imagen || caraYoutube(info.audios);
  return `<span class="cara ${clase}" style="--cara:${color}" aria-hidden="true"><span class="cara-ini">${escapeHtml(caraIniciales(info.titulo))}</span>${
    img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span>`;
}

const caraInfoDoc = d => ({
  titulo: d.title, etiquetas: d.tags, audios: d.audios, momento: d.mc?.momento, imagen: d.caraEmbebida || ''
});

// ============ IMAGEN DENTRO DEL AUDIO ============
// Se leen solo los primeros 256 KB (pedido parcial): ahí van las etiquetas ID3 del mp3 y, en los m4a
// preparados para escucharse mientras bajan, el átomo «covr».
const caraEmbebidas = new Map();

function caraDelAudio(src) {
  if (!src || !/\/api\/audio\//.test(src)) return Promise.resolve(null);
  if (!caraEmbebidas.has(src)) caraEmbebidas.set(src, caraLeerEmbebida(src).catch(() => null));
  return caraEmbebidas.get(src);
}

async function caraLeerEmbebida(src) {
  const res = await fetch(src, { headers: { Range: 'bytes=0-262143' } });
  if (!res.ok) return null;
  const b = new Uint8Array(await res.arrayBuffer());
  const img = caraId3(b) || caraMp4(b);
  return img ? URL.createObjectURL(new Blob([img.datos], { type: img.mime })) : null;
}

const caraSyncsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
const caraBe32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

function caraId3(b) {
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
  const ver = b[3];
  const fin = Math.min(caraSyncsafe(b, 6) + 10, b.length);
  let p = 10;
  if (b[5] & 0x40) p += ver === 4 ? caraSyncsafe(b, 10) : caraBe32(b, 10) + 4;
  while (p + 10 < fin) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const n = ver === 4 ? caraSyncsafe(b, p + 4) : caraBe32(b, p + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || n <= 0) return null;
    if (id === 'APIC') {
      if (p + 10 + n > b.length) return null;
      const f = b.subarray(p + 10, p + 10 + n);
      const enc = f[0];
      const finMime = f.indexOf(0, 1);
      let mime = String.fromCharCode(...f.subarray(1, finMime)).toLowerCase() || 'image/jpeg';
      if (!mime.includes('/')) mime = 'image/' + (mime === 'jpg' ? 'jpeg' : mime);
      let i = finMime + 2;
      if (enc === 1 || enc === 2) {
        while (i + 1 < f.length && (f[i] || f[i + 1])) i += 2;
        i += 2;
      } else {
        while (i < f.length && f[i]) i++;
        i++;
      }
      return { mime, datos: f.subarray(i) };
    }
    p += 10 + n;
  }
  return null;
}

function caraMp4(b) {
  for (let i = 4; i + 24 < b.length; i++) {
    if (b[i] !== 0x63 || b[i + 1] !== 0x6f || b[i + 2] !== 0x76 || b[i + 3] !== 0x72) continue; // «covr»
    if (String.fromCharCode(b[i + 8], b[i + 9], b[i + 10], b[i + 11]) !== 'data') continue;
    const n = caraBe32(b, i + 4) - 16;
    const tipo = caraBe32(b, i + 12);
    if (n <= 0 || i + 20 + n > b.length) return null;
    return { mime: tipo === 14 ? 'image/png' : 'image/jpeg', datos: b.subarray(i + 20, i + 20 + n) };
  }
  return null;
}
