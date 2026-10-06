/**
 * etiquetas-audio.js — Lee del ID3 de un MP3 lo que escribe Editag (Mp3editag/js/id3.js):
 * título (TIT2), artista (TPE1), etiquetas (TCON), letra con acordes (TXXX «MP3EDITAG», antes «CIC»),
 * letra simple (USLT) y momentos y tiempos litúrgicos (TXXX «LITURGICAL_MOMENTS» / «LITURGICAL_SEASONS»).
 * Los audios se convierten a .m4a al subirlos y la conversión no conserva estas etiquetas: se leen antes.
 */

const MARCAS_LETRA = ["mp3editag_meta_v1", "cic_meta_v1"];
const DESC_LETRA = ["MP3EDITAG", "CIC"];
const MAX_TAG = 8 * 1024 * 1024;

// Ids de Editag (Mp3editag/js/liturgia.js) → etiquetas del sitio (editor/js/etiquetas.js)
const MOMENTOS_EDITAG = {
  entrada: "Entrada", penitencial: "Acto penitencial", gloria: "Gloria", salmo: "Salmo responsorial",
  aleluya: "Aleluya", postevangelio: "Post evangelio", ofrendas: "Ofertorio", santo: "Santo",
  padrenuestro: "Padre Nuestro", paz: "Paz", cordero: "Cordero de Dios", comunion: "Comunión",
  meditacion: "Meditación", acciongracias: "Acción de gracias", despedida: "Salida"
};
const TIEMPOS_EDITAG = {
  adviento: "Adviento", navidad: "Navidad", cuaresma: "Cuaresma", triduo: "Semana Santa", pascua: "Pascua",
  ordinario: "Tiempo ordinario", solemnidades: "Solemnidades", marianos: "Mariano", santos: "Santos patronos",
  difuntos: "Exequias", sacramentos: "Sacramentos"
};

const synchsafe = (u, i) => ((u[i] & 0x7f) << 21) | ((u[i + 1] & 0x7f) << 14) | ((u[i + 2] & 0x7f) << 7) | (u[i + 3] & 0x7f);
const be32 = (u, i) => ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0;

function decodificar(u, enc) {
  if (!u.length) return "";
  if (enc === 1 && u[0] === 0xfe && u[1] === 0xff) {
    enc = 2;
    u = u.subarray(2);
  }
  const nombre = enc === 0 ? "latin1" : enc === 3 ? "utf-8" : enc === 2 ? "utf-16be" : "utf-16le";
  try {
    return new TextDecoder(nombre).decode(u);
  } catch (_) {
    return new TextDecoder("latin1").decode(u);
  }
}

// Posición del fin del texto terminado en nulo (1 byte en latin1/utf-8, 2 alineados en utf-16)
function finDeTexto(u, desde, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = desde; i + 1 < u.length; i += 2) if (u[i] === 0 && u[i + 1] === 0) return i;
  } else {
    for (let i = desde; i < u.length; i++) if (u[i] === 0) return i;
  }
  return u.length;
}

const largoNulo = (enc) => (enc === 1 || enc === 2 ? 2 : 1);
const sinNulos = (s) => s.replace(/\u0000+$/g, "").replace(/^\uFEFF/, "");

// ID3v2 con «unsynchronisation»: cada FF 00 vuelve a ser FF
function quitarDesincronizacion(u) {
  const out = new Uint8Array(u.length);
  let n = 0;
  for (let i = 0; i < u.length; i++) {
    out[n++] = u[i];
    if (u[i] === 0xff && u[i + 1] === 0) i++;
  }
  return out.subarray(0, n);
}

function framesId3(u) {
  if (u.length < 10 || u[0] !== 0x49 || u[1] !== 0x44 || u[2] !== 0x33) return null;
  const ver = u[3], flags = u[5];
  if (ver < 2 || ver > 4) return null;
  let tag = u.subarray(10, Math.min(u.length, 10 + synchsafe(u, 6)));
  if (flags & 0x80 && ver < 4) tag = quitarDesincronizacion(tag);
  let pos = 0;
  if (flags & 0x40 && ver > 2) pos = ver === 4 ? synchsafe(tag, 0) : 4 + be32(tag, 0);
  const frames = [];
  const cab = ver === 2 ? 6 : 10;
  while (pos + cab <= tag.length) {
    const id = String.fromCharCode(...tag.subarray(pos, pos + (ver === 2 ? 3 : 4)));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const tam = ver === 2 ? (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5]
      : ver === 4 ? synchsafe(tag, pos + 4) : be32(tag, pos + 4);
    if (!tam || pos + cab + tam > tag.length) break;
    let datos = tag.subarray(pos + cab, pos + cab + tam);
    const f2 = ver === 2 ? 0 : tag[pos + 9];
    const comprimido = ver === 4 ? f2 & 0x08 || f2 & 0x04 : f2 & 0x80 || f2 & 0x40;
    if (ver === 4 && f2 & 0x02) datos = quitarDesincronizacion(datos);
    if (ver === 4 && f2 & 0x01) datos = datos.subarray(4);
    if (!comprimido) frames.push({ id: ver === 2 ? { TT2: "TIT2", TP1: "TPE1", TCO: "TCON", TXX: "TXXX", ULT: "USLT" }[id] || id : id, datos });
    pos += cab + tam;
  }
  return { frames, tag };
}

function textoDeFrame(datos) {
  if (datos.length < 2) return "";
  return sinNulos(decodificar(datos.subarray(1), datos[0])).split("\u0000").filter(Boolean).join(", ").trim();
}

function txxx(datos) {
  const enc = datos[0];
  const fin = finDeTexto(datos, 1, enc);
  return {
    desc: sinNulos(decodificar(datos.subarray(1, fin), enc)).trim(),
    valor: sinNulos(decodificar(datos.subarray(Math.min(datos.length, fin + largoNulo(enc))), enc))
  };
}

function uslt(datos) {
  const enc = datos[0];
  const fin = finDeTexto(datos, 4, enc);
  return sinNulos(decodificar(datos.subarray(Math.min(datos.length, fin + largoNulo(enc))), enc));
}

// Valor del TXXX de letra: «mp3editag_meta_v1\n<letra>» o un JSON { contenido: { texto_crudo | letra } }
function letraPrivada(valor) {
  let t = String(valor || "").replace(/^\uFEFF/, "");
  for (const m of MARCAS_LETRA) if (t.startsWith(m)) t = t.slice(m.length).replace(/^\r?\n/, "");
  if (t.trim().startsWith("{")) {
    try {
      const d = JSON.parse(t.trim());
      const c = d.contenido;
      const letra = typeof c === "string" ? c : c?.texto_crudo || c?.letra || d.letra || "";
      if (String(letra).trim()) return String(letra);
    } catch (_) { /* no era JSON */ }
  }
  return t;
}

// Respaldo de Editag: busca la marca de la letra en los bytes del tag aunque los frames no se lean bien
function letraPorMarca(tag) {
  const texto = new TextDecoder("utf-8", { fatal: false }).decode(tag);
  for (const m of MARCAS_LETRA) {
    const i = texto.indexOf(m);
    if (i < 0) continue;
    let cuerpo = texto.slice(i + m.length).replace(/^[\n\u0000]/, "");
    const corte = cuerpo.slice(8).search(/[A-Z]{4}[\u0000-\u0010]/);
    if (corte >= 0) cuerpo = cuerpo.slice(0, corte + 8);
    cuerpo = cuerpo.replace(/\u0000/g, "");
    if (cuerpo.trim()) return cuerpo;
  }
  return "";
}

const listaIds = (s) => String(s || "").split(/[,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * @param {File|Blob} archivo
 * @returns {Promise<null|{ titulo: string, artista: string, letra: string, conAcordes: boolean, etiquetas: string[] }>}
 *   null si el archivo no tiene ID3v2. «letra» es la del tag privado (con acordes) o, si no está, la USLT.
 */
export async function leerEtiquetasAudio(archivo) {
  let cabeza;
  try {
    cabeza = new Uint8Array(await archivo.slice(0, 10).arrayBuffer());
  } catch (_) {
    return null;
  }
  if (cabeza.length < 10 || cabeza[0] !== 0x49 || cabeza[1] !== 0x44 || cabeza[2] !== 0x33) return null;
  const tam = Math.min(10 + synchsafe(cabeza, 6), MAX_TAG);
  const r = framesId3(new Uint8Array(await archivo.slice(0, tam).arrayBuffer()));
  if (!r) return null;
  const out = { titulo: "", artista: "", letra: "", conAcordes: false, etiquetas: [] };
  let simple = "", momentos = [], tiempos = [];
  for (const { id, datos } of r.frames) {
    if (datos.length < 2) continue;
    if (id === "TIT2" && !out.titulo) out.titulo = textoDeFrame(datos);
    else if (id === "TPE1" && !out.artista) out.artista = textoDeFrame(datos);
    else if (id === "TCON") {
      out.etiquetas.push(...textoDeFrame(datos).replace(/^\(\d+\)/, "").split(/[,;/|]+/).map((x) => x.trim()).filter(Boolean));
    } else if (id === "USLT" && !simple) simple = uslt(datos);
    else if (id === "TXXX") {
      const { desc, valor } = txxx(datos);
      const d = desc.toUpperCase();
      if (DESC_LETRA.includes(d) || (!out.letra && MARCAS_LETRA.some((m) => valor.startsWith(m)))) {
        if (!out.letra) out.letra = letraPrivada(valor);
      } else if (d === "LITURGICAL_MOMENTS") momentos = listaIds(valor);
      else if (d === "LITURGICAL_SEASONS") tiempos = listaIds(valor);
    }
  }
  if (!out.letra.trim()) out.letra = letraPrivada(letraPorMarca(r.tag));
  out.conAcordes = !!out.letra.trim();
  if (!out.conAcordes) out.letra = simple;
  out.letra = out.letra.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
  out.etiquetas.push(...momentos.map((m) => MOMENTOS_EDITAG[m]).filter(Boolean),
    ...tiempos.map((t) => TIEMPOS_EDITAG[t]).filter(Boolean));
  const vistas = new Set();
  out.etiquetas = out.etiquetas.filter((t) => {
    const k = t.toLowerCase();
    if (vistas.has(k) || /^(other|otro|blues|\d+)$/.test(k)) return false;
    vistas.add(k);
    return true;
  });
  return out;
}
