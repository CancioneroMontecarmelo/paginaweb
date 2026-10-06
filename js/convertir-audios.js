/**
 * convertir-audios.js — Panel del administrador general (login.html): pasa a AAC (.m4a) los audios de la
 * Biblioteca que siguen en otro formato (los WebM de antes). Cada audio se baja, se convierte en este
 * navegador (js/audio-aac.js) y se reemplaza el contenido del mismo archivo de Drive: el enlace no cambia.
 * La lista de pendientes sale siempre del servidor, así que se puede pausar, cerrar y seguir otro día.
 */
import { aM4a } from "./audio-aac.js";

const mb = (n) => (n / 1048576).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + " MB";
const duracionTexto = (seg) => {
  if (!isFinite(seg) || seg <= 0) return "";
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : "menos de un minuto";
};

function aBase64(blob) {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => mal(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function iniciarConversionAudios({ caja, llamarApi, token }) {
  const $ = (sel) => caja.querySelector(sel);
  const st = { pendientes: [], cola: [], errores: [], corriendo: false, pausado: false, hechos: 0, segundos: 0, wake: null };

  const estado = (t) => { $("#aac-estado").textContent = t; };

  function pintarResumen(r) {
    const n = st.pendientes.length;
    $("#aac-resumen").textContent = n
      ? `${n} ${n === 1 ? "audio está" : "audios están"} en el formato anterior (${mb(r.bytesPendientes)}) · ${r.convertidos} ya en .m4a o MP3.`
      : `Todos los audios de la Biblioteca ya están en .m4a o MP3 (${r.convertidos}, ${mb(r.bytesTotal)}).`;
    $("#aac-iniciar").hidden = !n || st.corriendo;
    $("#aac-iniciar").textContent = st.hechos ? "Seguir convirtiendo" : "Convertir todo a AAC (.m4a)";
  }

  async function contar() {
    $("#aac-resumen").textContent = "Contando los audios de la Biblioteca…";
    $("#aac-iniciar").hidden = true;
    try {
      const r = await llamarApi("audiosAConvertir", { token: token() });
      st.pendientes = r.pendientes;
      pintarResumen(r);
    } catch (e) {
      $("#aac-resumen").textContent = "No se pudo contar los audios: " + e.message;
    }
  }

  function pintarErrores() {
    const ul = $("#aac-errores");
    ul.replaceChildren(...st.errores.map((x) => {
      const li = document.createElement("li");
      li.textContent = `${x.item.cancion}${x.item.voz ? " (" + x.item.voz + ")" : ""}: ${x.error} `;
      const b = Object.assign(document.createElement("button"), { type: "button", className: "btn-chico", textContent: "Reintentar" });
      b.addEventListener("click", () => {
        st.errores = st.errores.filter((y) => y !== x);
        pintarErrores();
        st.cola.push(x.item);
        if (!st.corriendo) correr();
      });
      li.append(b);
      return li;
    }));
    ul.hidden = !st.errores.length;
  }

  async function bajar(item) {
    const r = await llamarApi("leerAudioAConvertir", { token: token(), fileId: item.fileId });
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
    return new File([bytes], r.nombre || item.nombre, { type: r.mime || item.mime || "audio/webm" });
  }

  const avisarAlSalir = (e) => { e.preventDefault(); e.returnValue = ""; };

  async function correr() {
    st.corriendo = true;
    st.pausado = false;
    $("#aac-iniciar").hidden = true;
    $("#aac-pausar").hidden = false;
    $("#aac-pausar").textContent = "Pausar";
    $("#aac-progreso").hidden = false;
    window.addEventListener("beforeunload", avisarAlSalir);
    try { st.wake = await navigator.wakeLock?.request("screen"); } catch (_) { st.wake = null; }
    const total = st.hechos + st.cola.length;
    let siguiente = st.cola.length ? bajar(st.cola[0]).catch((e) => e) : null;
    while (st.cola.length && !st.pausado) {
      const item = st.cola.shift();
      const inicio = performance.now();
      const nombre = item.cancion + (item.voz ? " · " + item.voz : "");
      const prefijo = `${st.hechos + 1} de ${total}: «${nombre}»`;
      try {
        estado(`${prefijo} · bajando…`);
        const archivo = await siguiente;
        if (archivo instanceof Error) throw archivo;
        siguiente = st.cola.length ? bajar(st.cola[0]).catch((e) => e) : null;
        const r = await aM4a(archivo, (x) => estado(`${prefijo} · convirtiendo ${Math.round(x * 100)} %`), {
          forzar: true,
          titulo: item.cancion + (item.voz ? " - " + item.voz : ""),
          alEstado: (t) => estado(`${prefijo} · ${t}`)
        });
        if (!r.convertido) throw new Error(r.aviso || "no se pudo convertir");
        estado(`${prefijo} · guardando ${mb(r.archivo.size)}…`);
        await llamarApi("reemplazarAudio", { token: token(), fileId: item.fileId, base64: await aBase64(r.archivo) });
        st.hechos++;
        st.pendientes = st.pendientes.filter((x) => x.fileId !== item.fileId);
      } catch (e) {
        st.errores.push({ item, error: e.message || String(e) });
        pintarErrores();
        if (!siguiente && st.cola.length) siguiente = bajar(st.cola[0]).catch((err) => err);
      }
      st.segundos += (performance.now() - inicio) / 1000;
      const listos = st.hechos + st.errores.length;
      $("#aac-progreso").value = total ? listos / total : 1;
      const falta = duracionTexto((st.segundos / Math.max(1, listos)) * st.cola.length);
      $("#aac-cuenta").textContent = `${st.hechos} convertidos${st.errores.length ? ` · ${st.errores.length} con error` : ""}` +
        (st.cola.length ? ` · faltan ${st.cola.length}${falta ? " (unos " + falta + ")" : ""}` : "");
    }
    st.corriendo = false;
    window.removeEventListener("beforeunload", avisarAlSalir);
    st.wake?.release().catch(() => {});
    $("#aac-pausar").hidden = !st.cola.length;
    $("#aac-pausar").textContent = "Seguir";
    estado(st.cola.length ? "En pausa. Podés seguir ahora o cerrar la página y continuar otro día."
      : st.errores.length ? "Terminó, con algunos audios que no se pudieron convertir (abajo podés reintentarlos)."
      : "Listo: todos los audios quedaron en .m4a.");
    if (!st.cola.length) contar();
  }

  $("#aac-iniciar").addEventListener("click", () => {
    if (!st.pendientes.length) return;
    if (!st.hechos && !confirm(`Se van a convertir ${st.pendientes.length} audios a .m4a en este navegador. ` +
      "Cada archivo conserva su enlace y Drive guarda la versión anterior 30 días. Dejá esta pestaña abierta mientras trabaja. ¿Empezar?")) return;
    st.cola = st.pendientes.filter((x) => !st.errores.some((y) => y.item.fileId === x.fileId));
    correr();
  });
  $("#aac-pausar").addEventListener("click", () => {
    if (st.corriendo) {
      st.pausado = true;
      $("#aac-pausar").textContent = "Pausando al terminar este audio…";
    } else if (st.cola.length) {
      correr();
    }
  });
  $("#aac-contar").addEventListener("click", () => { if (!st.corriendo) contar(); });

  caja.hidden = false;
  contar();
}
