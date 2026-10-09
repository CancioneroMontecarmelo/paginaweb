/**
 * lector-qr.js — Lee un código QR con la cámara trasera dentro de la misma página: no hace falta la cámara del
 * teléfono ni que el enlace se abra en otro navegador.
 *
 *   leerQr({ texto })  → Promise<string | null>   (null si se canceló; error si no hay cámara o permiso)
 *   crearDetector()    → Promise<(fuente) => Promise<string>>   (fuente: <video>, <img> o <canvas>)
 *
 * Usa BarcodeDetector cuando el navegador lo trae (Chrome de Android); si no (iPhone, Firefox), jsQR
 * (js/vendor/jsqr.js, Apache 2.0), que se descarga solo la primera vez que se abre el lector.
 */

let promesaJsqr = null;
function cargarJsqr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return promesaJsqr ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("./vendor/jsqr.js", import.meta.url).href;
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error("No se pudo cargar el lector de QR.")));
    s.onerror = () => {
      promesaJsqr = null;
      s.remove();
      reject(new Error("No se pudo cargar el lector de QR. ¿Hay internet?"));
    };
    document.head.append(s);
  });
}

export async function crearDetector() {
  if ("BarcodeDetector" in window) {
    try {
      if ((await BarcodeDetector.getSupportedFormats()).includes("qr_code")) {
        const d = new BarcodeDetector({ formats: ["qr_code"] });
        return async (fuente) => (await d.detect(fuente))[0]?.rawValue || "";
      }
    } catch (_) { /* sin detector nativo: jsQR */ }
  }
  const jsQR = await cargarJsqr();
  const lienzo = document.createElement("canvas");
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  return async (fuente) => {
    const w = fuente.videoWidth || fuente.naturalWidth || fuente.width, h = fuente.videoHeight || fuente.naturalHeight || fuente.height;
    if (!w || !h) return "";
    // Con 640 px de lado alcanza para un QR que ocupa el marco, y en un celular modesto va rápido
    const escala = Math.min(1, 640 / Math.max(w, h));
    lienzo.width = Math.round(w * escala);
    lienzo.height = Math.round(h * escala);
    ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" })?.data || "";
  };
}

function mensajeDeError(e) {
  if (e?.name === "NotAllowedError" || e?.name === "SecurityError") return "No se dio permiso para usar la cámara. Podés escribir el código a mano.";
  if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") return "Este equipo no tiene cámara. Podés escribir el código a mano.";
  if (e?.name === "NotReadableError") return "La cámara la está usando otra aplicación. Cerrala y probá de nuevo.";
  return e?.message || "No se pudo abrir la cámara.";
}

export function leerQr({ texto = "Apuntá la cámara al código QR" } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("Este navegador no permite usar la cámara. Podés escribir el código a mano."));
  }
  const dlg = document.createElement("dialog");
  dlg.className = "lector-qr";
  dlg.innerHTML = `<div class="lector-qr-caja"><video playsinline muted autoplay></video><span class="lector-qr-marco"></span></div>
    <p class="lector-qr-texto"></p>
    <button type="button" class="rp-btn">Cancelar</button>`;
  dlg.querySelector(".lector-qr-texto").textContent = texto;
  document.body.append(dlg);
  dlg.showModal();

  let flujo = null, activo = true;
  const terminar = () => {
    activo = false;
    flujo?.getTracks().forEach((t) => t.stop());
    if (dlg.open) dlg.close();
    dlg.remove();
  };

  return new Promise((resolve, reject) => {
    const cancelar = () => {
      terminar();
      resolve(null);
    };
    dlg.querySelector("button").addEventListener("click", cancelar);
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      cancelar();
    });
    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!activo) return flujo.getTracks().forEach((t) => t.stop());
        const video = dlg.querySelector("video");
        video.srcObject = flujo;
        await video.play().catch(() => {});
        const detectar = await crearDetector();
        const paso = async () => {
          if (!activo) return;
          let leido = "";
          try { leido = video.readyState >= 2 ? await detectar(video) : ""; } catch (_) { /* cuadro ilegible */ }
          if (!activo) return;
          if (leido) {
            navigator.vibrate?.(80);
            terminar();
            return resolve(leido);
          }
          setTimeout(paso, 120);
        };
        paso();
      } catch (e) {
        if (!activo) return;
        terminar();
        reject(new Error(mensajeDeError(e)));
      }
    })();
  });
}
