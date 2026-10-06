/**
 * audio-aac.js — Audios de la Biblioteca en AAC (.m4a), convertidos en el propio navegador.
 *
 *   aM4a(archivo, alAvanzar, opciones)  mp3, wav, ogg, webm, el audio de un video… → .m4a (AAC, 48 kHz)
 *   grabador()                          graba con el micrófono; la toma se pasa luego por aM4a
 *
 * AAC en .m4a suena en todos los equipos (iPhone y Mac de cualquier versión, Android, Windows, Linux) y pesa
 * lo mismo que el WebM que se usaba antes: 96 kbps en estéreo y 64 kbps en mono. El índice va al comienzo del
 * archivo («faststart»): en el celular empieza a sonar sin bajarse entero.
 *
 * Donde el navegador sabe codificar AAC (Chrome en Windows, Mac y Android) se usa WebCodecs con mp4-muxer.
 * Donde no (Chrome en Linux, navegadores viejos) se usa ffmpeg.wasm: el núcleo (32 MB) se baja de jsDelivr
 * solo la primera vez que hace falta. Cada resultado se vuelve a decodificar para comprobar que quedó bien.
 */
import { Muxer, ArrayBufferTarget } from "./vendor/mp4-muxer.mjs";

export const MAX_ORIGINAL = 150 * 1024 * 1024;
const TASA = 48000;
const BLOQUE = 1024 * 47; // ~1 s de audio por AudioData, múltiplo del cuadro AAC
const kbps = (canales) => (canales > 1 ? 96000 : 64000);
const ARTISTA = "Parroquia Monte Carmelo";
const FFMPEG_CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

export const esAudio = (f) => /^(audio|video)\//i.test(f.type || "") ||
  /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|3gp|amr|wma|aiff?)$/i.test(f.name || "");
/** Ya es AAC en .m4a: se sube tal cual. */
export const esM4a = (f) => /^audio\/(mp4|x-m4a|aac)$/i.test(f.type || "") || /\.(m4a|aac)$/i.test(f.name || "");
const esMp3 = (f) => /^audio\/(mpeg|mp3)$/i.test(f.type || "") || /\.mp3$/i.test(f.name || "");
export const nombreM4a = (n) => String(n || "audio").replace(/\.[^./\\]+$/, "") + ".m4a";

const esMovil = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const pausa = () => new Promise((ok) => setTimeout(ok, 0));

let soporteNativo = null;
/** ¿El navegador codifica AAC por sí mismo? (en Linux, Chrome no) */
export function aacNativo() {
  soporteNativo ||= (async () => {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: TASA, numberOfChannels: 2, bitrate: kbps(2) });
      return !!r.supported;
    } catch (_) {
      return false;
    }
  })();
  return soporteNativo;
}

async function decodificar(buffer) {
  return new OfflineAudioContext(1, 1, TASA).decodeAudioData(buffer);
}

// Lo convertido tiene que ser un MP4 que el navegador decodifique, con sonido y la misma duración
async function comprobar(bytes, duracion) {
  const u8 = new Uint8Array(bytes);
  if (String.fromCharCode(...u8.subarray(4, 8)) !== "ftyp") throw new Error("el resultado no es un .m4a");
  let s;
  try {
    s = await decodificar(u8.slice().buffer);
  } catch (_) {
    // Chromium sin códecs propietarios no decodifica AAC: ahí basta con que sea un MP4 con datos
    if (!document.createElement("audio").canPlayType('audio/mp4; codecs="mp4a.40.2"') && u8.length > 1024) return;
    throw new Error("el .m4a convertido no se puede reproducir");
  }
  if (!s.numberOfChannels || (duracion && Math.abs(s.duration - duracion) > Math.max(1, duracion * 0.02))) {
    throw new Error("el .m4a convertido quedó incompleto");
  }
}

async function conWebCodecs(sonido, alAvanzar) {
  const canales = Math.min(2, sonido.numberOfChannels);
  const destino = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: destino,
    audio: { codec: "aac", sampleRate: TASA, numberOfChannels: canales },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });
  let fallo = null;
  const codificador = new AudioEncoder({
    output: (trozo, meta) => muxer.addAudioChunk(trozo, meta),
    error: (e) => { fallo = e; }
  });
  codificador.configure({ codec: "mp4a.40.2", sampleRate: TASA, numberOfChannels: canales, bitrate: kbps(canales) });
  const total = sonido.length;
  const planos = Array.from({ length: canales }, (_, c) => sonido.getChannelData(c));
  for (let i = 0, vuelta = 0; i < total && !fallo; i += BLOQUE, vuelta++) {
    const n = Math.min(BLOQUE, total - i);
    const datos = new Float32Array(n * canales);
    for (let c = 0; c < canales; c++) datos.set(planos[c].subarray(i, i + n), c * n);
    const trozo = new AudioData({
      format: "f32-planar", sampleRate: TASA, numberOfFrames: n, numberOfChannels: canales,
      timestamp: Math.round((i / TASA) * 1e6), data: datos
    });
    codificador.encode(trozo);
    trozo.close();
    if (vuelta % 10 === 9) {
      alAvanzar(Math.min(0.95, (i + n) / total));
      await pausa();
    }
  }
  if (!fallo) await codificador.flush().catch((e) => { fallo = e; });
  codificador.close();
  if (fallo) throw fallo;
  muxer.finalize();
  return destino.buffer;
}

// ffmpeg.wasm: una sola instancia por página, cargada la primera vez que hace falta
let ffmpegListo = null;
async function blobUrl(url, tipo) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`no se pudo bajar ${url.split("/").pop()} (${r.status})`);
  return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: tipo }));
}
function cargarFfmpeg(alEstado) {
  ffmpegListo ||= (async () => {
    alEstado("Preparando el convertidor (32 MB, solo la primera vez)…");
    const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    const ff = new FFmpeg();
    await ff.load({
      coreURL: await blobUrl(`${FFMPEG_CORE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await blobUrl(`${FFMPEG_CORE}/ffmpeg-core.wasm`, "application/wasm")
    });
    return ff;
  })();
  ffmpegListo.catch(() => { ffmpegListo = null; });
  return ffmpegListo;
}

async function conFfmpeg(archivo, canales, titulo, alAvanzar, alEstado) {
  const ff = await cargarFfmpeg(alEstado);
  const entrada = "entrada" + ((archivo.name || "").match(/\.[a-z0-9]{2,5}$/i)?.[0] || ".bin");
  const salida = "salida.m4a";
  const avance = ({ progress }) => { if (progress > 0 && progress <= 1) alAvanzar(Math.min(0.95, progress)); };
  ff.on("progress", avance);
  try {
    await ff.writeFile(entrada, new Uint8Array(await archivo.arrayBuffer()));
    const codigo = await ff.exec(["-i", entrada, "-vn", "-sn", "-dn", "-map", "0:a:0", "-map_metadata", "-1",
      "-c:a", "aac", "-b:a", String(kbps(canales)), "-ac", String(canales), "-ar", String(TASA), "-movflags", "+faststart",
      "-metadata", `title=${titulo}`, "-metadata", `artist=${ARTISTA}`, "-y", salida]);
    if (codigo !== 0) throw new Error("ffmpeg no pudo convertirlo");
    return (await ff.readFile(salida)).buffer;
  } finally {
    ff.off("progress", avance);
    await ff.deleteFile(entrada).catch(() => {});
    await ff.deleteFile(salida).catch(() => {});
  }
}

/**
 * Devuelve { archivo, convertido, duracion?, aviso? }.
 * opciones.forzar: vuelve a codificar aunque ya sea .m4a (las grabaciones salen sin duración).
 * opciones.titulo: va en los datos del archivo, para que los reproductores del celular lo muestren.
 * opciones.alEstado(texto): mensajes largos (bajar el convertidor).
 */
export async function aM4a(archivo, alAvanzar = () => {}, { forzar = false, titulo = "", alEstado = () => {} } = {}) {
  if (!forzar && esM4a(archivo)) return { archivo, convertido: false };
  if (archivo.size > MAX_ORIGINAL) throw new Error(`«${archivo.name}» pesa más de 150 MB: recortalo antes de subirlo.`);
  const nativo = await aacNativo();
  // Un MP3 ya suena en todos lados: en un celular sin AAC propio no vale la pena bajar 32 MB para achicarlo
  if (!forzar && esMp3(archivo) && !nativo && esMovil()) return { archivo, convertido: false };
  alAvanzar(0);
  const original = await archivo.arrayBuffer();
  let sonido = null;
  try { sonido = await decodificar(original.slice(0)); } catch (_) { /* ffmpeg quizá sí lo lee */ }
  const canales = sonido ? Math.min(2, sonido.numberOfChannels) : 2;
  const duracion = sonido?.duration || 0;
  const nombre = titulo || String(archivo.name || "audio").replace(/\.[^.]+$/, "");
  let bytes = null, error = null;
  if (nativo && sonido) {
    try {
      bytes = await conWebCodecs(sonido, alAvanzar);
      await comprobar(bytes, duracion);
    } catch (e) { bytes = null; error = e; }
  }
  if (!bytes) {
    try {
      bytes = await conFfmpeg(archivo, canales, nombre, alAvanzar, alEstado);
      await comprobar(bytes, duracion);
    } catch (e) { bytes = null; error = e; }
  }
  if (!bytes) {
    const motivo = error?.message || String(error || "");
    if (esMp3(archivo) || esM4a(archivo)) {
      return { archivo, convertido: false, aviso: `No se pudo convertir (${motivo}): se sube el original, que igual suena en todos los equipos.` };
    }
    throw new Error(`No se pudo convertir «${archivo.name}» a .m4a: ${motivo}`);
  }
  alAvanzar(1);
  return {
    archivo: new File([bytes], nombreM4a(archivo.name), { type: "audio/mp4" }),
    convertido: true,
    duracion
  };
}

const fechaHora = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString();
  return d.slice(0, 10) + "-" + d.slice(11, 16).replace(":", "");
};

/** Empieza a grabar. Devuelve { segundos, detener(): Promise<File>, cancelar() }. */
export async function grabador() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Este navegador no permite grabar. Probá con Chrome o Firefox.");
  }
  let flujo;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
    });
  } catch (e) {
    throw new Error(e && e.name === "NotAllowedError"
      ? "No hay permiso para usar el micrófono: permitilo en el candado de la barra de direcciones."
      : "No se encontró un micrófono.");
  }
  const mime = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  const rec = new MediaRecorder(flujo, { ...(mime && { mimeType: mime }), audioBitsPerSecond: 128000 });
  const partes = [];
  rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
  const soltar = () => flujo.getTracks().forEach((t) => t.stop());
  const inicio = Date.now();
  rec.start(1000);
  return {
    get segundos() { return (Date.now() - inicio) / 1000; },
    detener() {
      return new Promise((ok) => {
        rec.onstop = () => {
          soltar();
          const tipo = (rec.mimeType || mime || "audio/webm").split(";")[0];
          ok(new File(partes, `grabacion-${fechaHora()}.${tipo.includes("mp4") ? "m4a" : "webm"}`, { type: tipo }));
        };
        rec.stop();
      });
    },
    cancelar() {
      rec.onstop = null;
      try { rec.stop(); } catch (_) { /* ya estaba detenido */ }
      soltar();
    }
  };
}
