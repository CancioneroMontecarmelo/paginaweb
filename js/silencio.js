/**
 * silencio.js — Una décima de segundo de silencio (WAV de 8 bits a 8 kHz). Los audios del Drive llegan por el
 * Apps Script unos segundos después del toque; en iPhone un <audio> solo puede sonar sin toque si ya sonó antes
 * dentro de uno. Por eso, al tocar, el <audio> suena primero este silencio y después recibe el archivo.
 */
export const SILENCIO = (() => {
  const n = 800, v = new DataView(new ArrayBuffer(44 + n));
  const texto = (pos, s) => [...s].forEach((c, i) => v.setUint8(pos + i, c.charCodeAt(0)));
  texto(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  texto(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  texto(36, "data");
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([v.buffer], { type: "audio/wav" }));
})();

/** Hace sonar el silencio dentro del toque, para que el <audio> pueda sonar después sin toque. */
export function desbloquear(audio) {
  audio.src = SILENCIO;
  audio.play().catch(() => {});
}
