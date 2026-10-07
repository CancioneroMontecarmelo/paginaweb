/**
 * vincular-audios.js — Panel del administrador general (login.html): recorre todo el Drive de la parroquia por
 * tandas (vincularAudiosSueltos en backend/Code.gs), vincula por título cada audio suelto con su canción y pone el
 * nombre de su carpeta como primera etiqueta. Al terminar muestra qué se vinculó y qué quedó sin canción.
 */

const el = (tag, clase, texto) => Object.assign(document.createElement(tag), clase ? { className: clase } : {}, texto != null ? { textContent: texto } : {});
const VOCES = { soprano: "Soprano", contralto: "Contralto", tenor: "Tenor", bajo: "Bajo", mezzosoprano: "Mezzosoprano" };

export function iniciarVinculoAudios({ caja, llamarApi, token }) {
  const $ = (sel) => caja.querySelector(sel);
  const st = { corriendo: false, detener: false };

  const estado = (t) => { $("#sueltos-estado").textContent = t; };

  function lista(titulo, items, pintar) {
    if (!items.length) return null;
    const det = el("details", "sueltos-grupo");
    det.append(el("summary", "", `${titulo} (${items.length})`));
    const ul = el("ul", "aac-errores");
    ul.append(...items.map((x) => { const li = el("li"); pintar(li, x); return li; }));
    det.append(ul);
    return det;
  }

  function pintarResultado(t) {
    const box = $("#sueltos-resultado");
    const porCarpeta = {};
    t.vinculados.forEach((v) => { if (v.etiqueta) porCarpeta[v.etiqueta] = (porCarpeta[v.etiqueta] || 0) + 1; });
    const carpetas = Object.entries(porCarpeta).sort((a, b) => b[1] - a[1]);
    const ordenado = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(" · ");
    box.replaceChildren(
      el("p", "", `Archivos del Drive revisados: ${t.archivos} · audios: ${t.revisados} · vinculados ahora: ${t.vinculados.length} en ` +
        `${[...t.canciones.values()].filter((c) => c.audios).length} canciones · sin canción: ${t.sinCancion.length}` +
        (t.repetidos.length ? ` · copias de un audio que la canción ya tenía: ${t.repetidos.length}` : "")),
      ...(Object.keys(t.audiosPorCarpeta).length ? [el("p", "", "Audios encontrados por carpeta: " + ordenado(t.audiosPorCarpeta))] : []),
      ...(carpetas.length ? [el("p", "", "Vinculados ahora por carpeta (etiqueta): " + carpetas.map(([k, n]) => `${k}: ${n}`).join(" · "))] : []),
      ...(Object.keys(t.otros).length ? [el("p", "aviso", "Otros archivos, que no son audio: " + ordenado(t.otros))] : []),
      ...[
        lista("Videos (no se vinculan; si son grabaciones de canto, avisá)", t.videos, (li, v) => li.append(v)),
        lista("Vinculados", t.vinculados, (li, v) => {
          li.append(`«${v.nombre}» → ${v.canciones.join(", ")}`);
          const extra = [v.voz && VOCES[v.voz], v.etiqueta && "etiqueta " + v.etiqueta, v.puntaje < 1 && `parecido ${Math.round(v.puntaje * 100)} %`].filter(Boolean);
          if (extra.length) li.append(el("small", "", " · " + extra.join(" · ")));
        }),
        lista("Sin canción con ese título", t.sinCancion, (li, v) => {
          li.append(`«${v.nombre}»` + (v.carpeta ? ` (carpeta ${v.carpeta})` : ""));
          if (v.empate) li.append(el("small", "", ` · se parece por igual a ${v.empate} canciones`));
        }),
        lista("Canciones con etiquetas nuevas", [...t.canciones.values()].filter((c) => c.etiquetasCambiaron), (li, c) => {
          li.append(`${c.titulo}: ${c.etiquetas.join(", ")}`);
        })
      ].filter(Boolean)
    );
    box.hidden = false;
  }

  async function correr() {
    st.corriendo = true;
    st.detener = false;
    $("#sueltos-iniciar").hidden = true;
    $("#sueltos-detener").hidden = false;
    const t = { revisados: 0, archivos: 0, vinculados: [], sinCancion: [], repetidos: [], canciones: new Map(), otros: {}, audiosPorCarpeta: {}, videos: [] };
    const sumar = (destino, origen) => Object.entries(origen || {}).forEach(([k, n]) => { destino[k] = (destino[k] || 0) + n; });
    let cursor = "", tanda = 0, error = null;
    do {
      tanda++;
      estado(`Tanda ${tanda}: revisando el Drive… (${t.archivos} archivos, ${t.revisados} audios, ${t.vinculados.length} vinculados)`);
      try {
        const r = await llamarApi("vincularAudiosSueltos", { token: token(), cursor });
        t.revisados += r.revisados;
        t.archivos += r.archivos || 0;
        sumar(t.otros, r.otros);
        sumar(t.audiosPorCarpeta, r.porCarpeta);
        t.videos.push(...(r.videos || []).slice(0, Math.max(0, 200 - t.videos.length)));
        t.vinculados.push(...r.vinculados);
        t.sinCancion.push(...r.sinCancion);
        t.repetidos.push(...r.repetidos);
        r.canciones.forEach((c) => {
          const antes = t.canciones.get(c.id);
          t.canciones.set(c.id, { ...c, audios: (antes?.audios || 0) + c.audios, etiquetasCambiaron: c.etiquetasCambiaron || !!antes?.etiquetasCambiaron });
        });
        cursor = r.cursor;
      } catch (e) {
        error = e;
        break;
      }
      pintarResultado(t);
    } while (cursor && !st.detener);
    st.corriendo = false;
    $("#sueltos-iniciar").hidden = false;
    $("#sueltos-detener").hidden = true;
    $("#sueltos-iniciar").textContent = "Volver a buscar";
    pintarResultado(t);
    estado(error ? `Se detuvo por un error: ${error.message} Lo vinculado hasta acá quedó guardado; podés volver a buscar.`
      : cursor ? "Detenido. Lo vinculado hasta acá quedó guardado; «Volver a buscar» recorre el Drive de nuevo."
      : `Listo: se recorrió todo el Drive.${t.vinculados.length ? " Los audios nuevos ya aparecen abajo para pasarlos a .m4a." : ""}`);
    if (t.vinculados.length) document.dispatchEvent(new CustomEvent("mc-audios-vinculados"));
  }

  $("#sueltos-iniciar").addEventListener("click", () => {
    if (st.corriendo) return;
    if (!confirm("Se va a recorrer todo el Drive y vincular por título cada audio suelto con su canción, poniendo el nombre " +
      "de su carpeta como primera etiqueta. Puede tardar varios minutos: dejá esta pestaña abierta. ¿Empezar?")) return;
    correr();
  });
  $("#sueltos-detener").addEventListener("click", () => {
    st.detener = true;
    $("#sueltos-detener").hidden = true;
    estado("Deteniendo al terminar esta tanda…");
  });

  caja.hidden = false;
}
