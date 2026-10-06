/**
 * voces.js — «Aprender las voces»: mezclador de los audios por voz de una canción (Misas y el reproductor).
 *
 *  - pistasDeVoces(audios) elige un audio por voz (soprano, contralto, tenor…); el mezclador aparece cuando
 *    hay dos o más voces distintas.
 *  - crearMezclador({ contenedor, pistas, leerAudio }) baja cada voz con leerAudio(fileId) → ArrayBuffer
 *    (el respaldo accion=audio del Apps Script, sin problemas de permisos entre sitios), las decodifica con
 *    Web Audio y las hace sonar juntas desde el mismo instante. Cada voz pasa por su propio GainNode:
 *    volumen, silencio y «solo»; «Mi voz» deja esa voz al 100 % y las demás bajas, como guía (se recuerda en
 *    el equipo). Devuelve { cerrar }, que corta el sonido y libera el AudioContext.
 *
 * Las voces quedan alineadas solo si sus audios empiezan en el mismo compás (pistas de un mismo arreglo).
 * Usa VOICES y VOICE_ORDER de editor/js/acordes.js (const globales de un script clásico cargado antes).
 */

const GUIA = 0.25;
const CLAVE_MI_VOZ = "mc-mi-voz";

const voces = () => (typeof VOICES === "object" ? VOICES : {});
const orden = () => (typeof VOICE_ORDER === "object" ? VOICE_ORDER : []);
const nombreVoz = (v) => voces()[v]?.label || v;
const reloj = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

export function pistasDeVoces(audios) {
  const porVoz = new Map();
  for (const a of audios || []) {
    const voz = a.voz && a.voz !== "todas" && a.voz !== "unica" ? a.voz : "";
    if (voz && a.fileId && !porVoz.has(voz)) porVoz.set(voz, a);
  }
  const pos = (v) => (orden().indexOf(v) + 1) || 99;
  return [...porVoz.values()].sort((a, b) => pos(a.voz) - pos(b.voz));
}

export function crearMezclador({ contenedor, pistas, leerAudio, alCerrar }) {
  const el = document.createElement("div");
  el.className = "mezclador";
  el.innerHTML = `
    <div class="mz-cabeza">
      <b>Aprender las voces</b>
      <button type="button" class="btn-chico mz-cerrar">Cerrar</button>
    </div>
    <p class="mz-estado" role="status">Cargando voces 0 de ${pistas.length}…</p>
    <div class="mz-mivoz" hidden></div>
    <div class="mz-transporte" hidden>
      <button type="button" class="mz-play" aria-label="Reproducir">▶</button>
      <input type="range" class="mz-avance" min="0" max="1" step="0.1" value="0" aria-label="Avance">
      <span class="mz-tiempo">0:00 / 0:00</span>
    </div>
    <ul class="mz-pistas"></ul>`;
  contenedor.append(el);

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const maestro = ctx.createGain();
  maestro.connect(ctx.destination);
  const s = { pistas: [], duracion: 0, tocando: false, inicio: 0, offset: 0, fuentes: [], inicios: [], cuadro: 0, cerrado: false };
  const $ = (q) => el.querySelector(q);

  const ganancia = (p) => {
    const solo = s.pistas.some((x) => x.solo);
    return solo ? (p.solo ? p.vol : 0) : p.silencio ? 0 : p.vol;
  };
  function aplicar() {
    for (const p of s.pistas) {
      const g = ganancia(p);
      p.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.015);
      p.li.dataset.ganancia = g.toFixed(2);
      p.li.querySelector(".mz-vol").value = Math.round(p.vol * 100);
      p.li.querySelector(".mz-silencio").setAttribute("aria-pressed", p.silencio);
      p.li.querySelector(".mz-solo").setAttribute("aria-pressed", p.solo);
      p.li.classList.toggle("callada", g === 0);
    }
    const mia = localStorage.getItem(CLAVE_MI_VOZ);
    el.querySelectorAll(".mz-mivoz [data-voz]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.voz === mia));
  }

  const posicion = () => Math.min(s.duracion, s.tocando ? ctx.currentTime - s.inicio : s.offset);

  function pintarAvance() {
    const t = posicion();
    $(".mz-avance").value = t;
    $(".mz-tiempo").textContent = reloj(t) + " / " + reloj(s.duracion);
    if (s.tocando) {
      if (t >= s.duracion) return detener(0);
      s.cuadro = requestAnimationFrame(pintarAvance);
    }
  }

  function cortarFuentes() {
    for (const f of s.fuentes) {
      f.onended = null;
      try { f.stop(); } catch (_) { /* ya terminó */ }
      f.disconnect();
    }
    s.fuentes = [];
  }

  function tocar(desde = s.offset) {
    if (!s.pistas.length || s.cerrado) return;
    ctx.resume();
    cortarFuentes();
    if (desde >= s.duracion) desde = 0;
    const cuando = ctx.currentTime + 0.08;
    s.inicios = [];
    for (const p of s.pistas) {
      const f = ctx.createBufferSource();
      f.buffer = p.buffer;
      f.connect(p.gain);
      if (desde < p.buffer.duration) f.start(cuando, desde);
      s.inicios.push(cuando);
      s.fuentes.push(f);
    }
    s.inicio = cuando - desde;
    s.tocando = true;
    $(".mz-play").textContent = "⏸";
    $(".mz-play").setAttribute("aria-label", "Pausa");
    cancelAnimationFrame(s.cuadro);
    pintarAvance();
  }

  function detener(en) {
    s.offset = en ?? posicion();
    s.tocando = false;
    cortarFuentes();
    cancelAnimationFrame(s.cuadro);
    $(".mz-play").textContent = "▶";
    $(".mz-play").setAttribute("aria-label", "Reproducir");
    pintarAvance();
  }

  function miVoz(voz) {
    if (voz) localStorage.setItem(CLAVE_MI_VOZ, voz);
    else localStorage.removeItem(CLAVE_MI_VOZ);
    for (const p of s.pistas) {
      p.vol = !voz || p.voz === voz ? 1 : GUIA;
      p.silencio = p.solo = false;
    }
    aplicar();
  }

  function cerrar() {
    if (s.cerrado) return;
    s.cerrado = true;
    cortarFuentes();
    cancelAnimationFrame(s.cuadro);
    ctx.close().catch(() => {});
    el.remove();
    alCerrar?.();
  }

  $(".mz-cerrar").addEventListener("click", cerrar);
  $(".mz-play").addEventListener("click", () => (s.tocando ? detener() : tocar()));
  $(".mz-avance").addEventListener("input", (e) => {
    const t = +e.target.value;
    if (s.tocando) tocar(t);
    else {
      s.offset = t;
      pintarAvance();
    }
  });
  $(".mz-pistas").addEventListener("input", (e) => {
    const p = s.pistas.find((x) => x.li.contains(e.target));
    if (p && e.target.matches(".mz-vol")) {
      p.vol = e.target.value / 100;
      aplicar();
    }
  });
  $(".mz-pistas").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    const p = b && s.pistas.find((x) => x.li.contains(b));
    if (!p) return;
    if (b.matches(".mz-silencio")) p.silencio = !p.silencio;
    if (b.matches(".mz-solo")) p.solo = !p.solo;
    aplicar();
  });
  $(".mz-mivoz").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) miVoz(b.dataset.voz || "");
  });

  (async () => {
    const fallas = [];
    let n = 0;
    for (const pista of pistas) {
      if (s.cerrado) return;
      $(".mz-estado").textContent = `Cargando voces ${++n} de ${pistas.length}…`;
      try {
        const datos = await leerAudio(pista.fileId);
        const buffer = await ctx.decodeAudioData(datos);
        s.pistas.push({ ...pista, buffer, vol: 1, silencio: false, solo: false, gain: ctx.createGain() });
      } catch (err) {
        fallas.push(`${nombreVoz(pista.voz)}: ${err.message || "no se pudo cargar"}`);
      }
    }
    if (s.cerrado) return;
    if (!s.pistas.length) {
      $(".mz-estado").textContent = "No se pudieron cargar las voces. " + fallas.join(" · ");
      return;
    }
    s.duracion = Math.max(...s.pistas.map((p) => p.buffer.duration));
    $(".mz-avance").max = s.duracion;
    for (const p of s.pistas) {
      p.gain.connect(maestro);
      p.li = document.createElement("li");
      p.li.dataset.voz = p.voz;
      p.li.style.setProperty("--vc", voces()[p.voz]?.color || "#607d8b");
      p.li.innerHTML = `<span class="mz-voz"></span>
        <input type="range" class="mz-vol" min="0" max="100" value="100">
        <button type="button" class="btn-chico mz-silencio" aria-pressed="false">Silenciar</button>
        <button type="button" class="btn-chico mz-solo" aria-pressed="false">Solo</button>`;
      p.li.querySelector(".mz-voz").textContent = nombreVoz(p.voz);
      p.li.querySelector(".mz-vol").setAttribute("aria-label", "Volumen de " + nombreVoz(p.voz));
      $(".mz-pistas").append(p.li);
    }
    const mivoz = $(".mz-mivoz");
    mivoz.append("Mi voz:");
    for (const p of s.pistas) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-chico";
      b.dataset.voz = p.voz;
      b.textContent = nombreVoz(p.voz);
      mivoz.append(b);
    }
    const todas = document.createElement("button");
    todas.type = "button";
    todas.className = "btn-chico";
    todas.dataset.voz = "";
    todas.textContent = "Todas iguales";
    mivoz.append(todas);
    mivoz.hidden = $(".mz-transporte").hidden = false;
    const guardada = localStorage.getItem(CLAVE_MI_VOZ);
    if (s.pistas.some((p) => p.voz === guardada)) miVoz(guardada);
    else aplicar();
    $(".mz-estado").textContent = fallas.length ? "Algunas voces no se cargaron: " + fallas.join(" · ") : "";
    $(".mz-estado").hidden = !fallas.length;
    pintarAvance();
  })();

  el.mezclador = { cerrar, tocar, detener, estado: () => ({ tocando: s.tocando, posicion: posicion(), inicios: s.inicios.slice(), listo: s.pistas.length }) };
  return el.mezclador;
}
