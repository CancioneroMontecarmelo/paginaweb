/**
 * youtube-embed.js — Los enlaces de YouTube suenan con el reproductor oficial insertado en la página (IFrame API),
 * manejado desde los controles propios del sitio, sin bajar el audio. Las reglas de YouTube piden que el video
 * se vea, con al menos 200x200 px: el contenedor no puede quedar oculto mientras suena.
 *
 *   youtubeId(url)                        id de 11 caracteres o null
 *   crearReproductorYT(contenedor, { alCambiar, alTerminar, alError })
 *     → { activo, paused, currentTime, duration, cargar(url, tocar), play(), pause(), destruir() }
 *     con la misma forma que un <audio> para que la barra lo maneje igual.
 */

export function youtubeId(url) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  const host = u.hostname.toLowerCase();
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get("v") || u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1];
  }
  return /^[\w-]{11}$/.test(id || "") ? id : null;
}

export const esYoutube = (url) => !!youtubeId(url || "");

let promesaApi = null;
function cargarApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!promesaApi) {
    promesaApi = new Promise((resolve, reject) => {
      const previo = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previo?.(); resolve(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = () => { promesaApi = null; s.remove(); reject(new Error("No se pudo cargar YouTube. ¿Hay internet?")); };
      document.head.append(s);
    });
  }
  return promesaApi;
}

// 101/150: el dueño no permite verlo fuera de YouTube; 2/5/100: video inválido, privado o borrado
const textoError = (codigo) => codigo === 101 || codigo === 150
  ? "El dueño de este video no permite verlo fuera de YouTube."
  : "YouTube no pudo reproducir este video aquí.";

export function crearReproductorYT(contenedor, { alCambiar, alTerminar, alError } = {}) {
  let player = null, listo = false, url = "", id = null, estado = -1, reloj = 0, turno = 0, esperaToque = 0, tocarAlListo = false;
  const cambiar = () => alCambiar?.();

  const marco = document.createElement("div");
  marco.className = "yt-marco";
  const aviso = document.createElement("p");
  aviso.className = "yt-aviso";
  aviso.hidden = true;
  contenedor.replaceChildren(marco, aviso);

  const avisar = (html) => {
    aviso.innerHTML = html;
    aviso.hidden = !html;
  };
  const enlace = () => `<a href="${url.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">Abrir en YouTube</a>`;

  function seguirTiempo(si) {
    clearInterval(reloj);
    reloj = si ? setInterval(cambiar, 250) : 0;
  }

  function alEstado(e) {
    estado = e.data;
    seguirTiempo(estado === 1);
    if (estado === 1 || estado === 3) { clearTimeout(esperaToque); avisar(""); }
    cambiar();
    if (estado === 0) alTerminar?.();
  }

  function alFallar(e) {
    clearTimeout(esperaToque);
    seguirTiempo(false);
    estado = -1;
    avisar(textoError(e.data) + " " + enlace());
    cambiar();
    alError?.(e.data, textoError(e.data));
  }

  // Si el navegador bloquea que empiece solo (iPhone, primera vez), queda esperando un toque en el video
  function vigilarArranque() {
    clearTimeout(esperaToque);
    esperaToque = setTimeout(() => {
      if (estado !== 1 && estado !== 3) avisar("Si no empieza, tocá ▶ en el video.");
    }, 3000);
  }

  const obj = {
    get activo() { return !!id; },
    get paused() { return estado !== 1 && estado !== 3; },
    get currentTime() { return (listo && player?.getCurrentTime?.()) || 0; },
    set currentTime(s) {
      if (listo) player.seekTo(s, true);
      cambiar();
    },
    get duration() { return (listo && player?.getDuration?.()) || 0; },

    async cargar(nuevaUrl, tocar = true) {
      const nuevoId = youtubeId(nuevaUrl);
      if (!nuevoId) return;
      const t = ++turno;
      url = nuevaUrl;
      tocarAlListo = tocar;
      avisar("");
      if (player && listo && nuevoId === id) {
        if (tocar) { player.playVideo(); vigilarArranque(); }
        return;
      }
      id = nuevoId;
      estado = -1;
      cambiar();
      if (player && listo) {
        if (tocar) { player.loadVideoById(id); vigilarArranque(); } else player.cueVideoById(id);
        return;
      }
      try {
        await cargarApi();
      } catch (e) {
        if (t === turno) { avisar(e.message + " " + enlace()); alError?.(0, e.message); }
        return;
      }
      if (t !== turno || player) return;
      const lugar = document.createElement("div");
      marco.replaceChildren(lugar);
      player = new window.YT.Player(lugar, {
        videoId: id,
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: tocar ? 1 : 0, origin: location.origin },
        events: {
          onReady: () => {
            listo = true;
            if (player.getVideoData?.().video_id !== id) {
              if (tocarAlListo) player.loadVideoById(id); else player.cueVideoById(id);
            } else if (tocarAlListo) player.playVideo();
            cambiar();
          },
          onStateChange: alEstado,
          onError: alFallar
        }
      });
      if (tocar) vigilarArranque();
    },
    play() {
      if (!listo) return;
      player.playVideo();
      vigilarArranque();
    },
    pause() {
      if (listo) player.pauseVideo();
    },
    destruir() {
      turno++;
      clearTimeout(esperaToque);
      seguirTiempo(false);
      try { player?.destroy?.(); } catch (_) { /* ya no estaba */ }
      player = null;
      listo = false;
      id = null;
      url = "";
      estado = -1;
      marco.replaceChildren();
      avisar("");
      cambiar();
    }
  };
  return obj;
}
