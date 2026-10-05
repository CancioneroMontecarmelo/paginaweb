/**
 * audio-webm.js — Audios de la Biblioteca en WebM (Opus), convertidos en el propio navegador.
 *
 *   aWebm(archivo, alAvanzar)  mp3, m4a, wav, ogg, el audio de un video… → .webm (Opus, 48 kHz)
 *   grabador()                 graba con el micrófono; la toma se pasa luego por aWebm
 *
 * Se decodifica con la Web Audio API (que ya lleva el sonido a 48 kHz), se codifica con WebCodecs
 * (AudioEncoder) y se empaqueta con webm-muxer. Sin WebCodecs (Safari viejo) se devuelve el original.
 */
import { Muxer, ArrayBufferTarget } from "./vendor/webm-muxer.mjs";

export const MAX_ORIGINAL = 150 * 1024 * 1024;
const TASA = 48000;
const BLOQUE = TASA; // un segundo de audio por AudioData
const kbps = (canales) => (canales > 1 ? 96000 : 64000);

/** Ya es un audio WebM: se sube tal cual (un .webm con video se convierte para quedarse solo con el audio). */
export const esAudioWebm = (f) => /^audio\/webm/i.test(f.type || "") || /\.weba$/i.test(f.name || "");

export const esAudio = (f) => /^(audio|video)\//i.test(f.type || "") ||
  /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|3gp|amr|wma|aiff?)$/i.test(f.name || "");

export const nombreWebm = (n) => String(n || "audio").replace(/\.[^./\\]+$/, "") + ".webm";

let soporte = null;
export function puedeConvertir() {
  soporte ||= (async () => {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined" || typeof OfflineAudioContext === "undefined") return false;
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: TASA, numberOfChannels: 2, bitrate: kbps(2) });
      return !!r.supported;
    } catch (_) {
      return false;
    }
  })();
  return soporte;
}

const pausa = () => new Promise((ok) => setTimeout(ok, 0));

/**
 * Devuelve { archivo, convertido, aviso? }. `forzar` vuelve a codificar aunque ya sea WebM
 * (las grabaciones del navegador salen sin duración y así quedan con duración y se pueden adelantar).
 */
export async function aWebm(archivo, alAvanzar = () => {}, { forzar = false } = {}) {
  if (esAudioWebm(archivo) && !forzar) return { archivo, convertido: false };
  if (archivo.size > MAX_ORIGINAL) throw new Error(`«${archivo.name}» pesa más de 150 MB: recortalo antes de subirlo.`);
  if (!(await puedeConvertir())) {
    return { archivo, convertido: false, aviso: "Este equipo no pudo convertir a WebM: se sube el archivo original." };
  }
  alAvanzar(0);
  let sonido;
  try {
    sonido = await new OfflineAudioContext(1, 1, TASA).decodeAudioData(await archivo.arrayBuffer());
  } catch (_) {
    throw new Error(`No se pudo leer el audio de «${archivo.name}». Probá con otro formato (mp3, m4a, wav).`);
  }
  const canales = Math.min(2, sonido.numberOfChannels);
  const destino = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: destino,
    audio: { codec: "A_OPUS", sampleRate: TASA, numberOfChannels: canales },
    firstTimestampBehavior: "offset"
  });
  let fallo = null;
  const codificador = new AudioEncoder({
    output: (trozo, meta) => muxer.addAudioChunk(trozo, meta),
    error: (e) => { fallo = e; }
  });
  codificador.configure({ codec: "opus", sampleRate: TASA, numberOfChannels: canales, bitrate: kbps(canales) });
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
      alAvanzar(Math.min(0.99, (i + n) / total));
      await pausa();
    }
  }
  if (!fallo) await codificador.flush().catch((e) => { fallo = e; });
  codificador.close();
  if (fallo) throw new Error(`No se pudo convertir «${archivo.name}» a WebM: ${fallo.message || fallo}`);
  muxer.finalize();
  alAvanzar(1);
  return {
    archivo: new File([destino.buffer], nombreWebm(archivo.name), { type: "audio/webm" }),
    convertido: true,
    duracion: sonido.duration
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
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
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
