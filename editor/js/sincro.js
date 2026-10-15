'use strict';
// Herramientas → Marcar los tiempos: mientras suena el audio elegido, se toca «Marcar» (o la barra espaciadora) al
// empezar cada línea de la letra. Los tiempos quedan en la cabecera del .md («sincro», ver markdown.js) y en el
// reproductor la línea que se canta se ilumina y la letra avanza sola.

function sincroTiempoActual() {
  if (enModoYt()) return yt.player?.getCurrentTime?.() || 0;
  return player.currentTime || 0;
}

function marcarTiemposDialog() {
  syncFromEditor();
  const d = cur();
  const a = currentAudio(d);
  if (!a) { toast('Primero vincula un audio o video a la canción (Herramientas → Vincular con audio o video).', 4000); return; }
  const lineas = lyricLines(d.text);
  if (!lineas.length) { toast('La canción todavía no tiene letra.', 3000); return; }
  const clave = sincroKey(a.src);
  const tiempos = lineas.map((_, i) => d.sincro?.[clave]?.[i] ?? null);
  let k = Math.max(0, tiempos.findIndex(t => t == null));
  if (tiempos.every(t => t != null)) k = 0;

  const pintar = dlg => {
    const lista = dlg.querySelector('#sincroLista');
    lista.innerHTML = lineas.map((l, i) => `<li class="${i === k ? 'actual' : ''}${tiempos[i] != null ? ' marcada' : ''}" data-i="${i}">
      <span class="sincro-t">${tiempos[i] != null ? fmtTiempo(tiempos[i]) + '.' + String(Math.floor((tiempos[i] % 1) * 10)) : '–'}</span>
      <span>${escapeHtml(l)}</span></li>`).join('');
    lista.querySelector('.actual')?.scrollIntoView({ block: 'center' });
    dlg.querySelector('#sincroCuenta').textContent = `${tiempos.filter(t => t != null).length} de ${lineas.length} líneas marcadas`;
  };
  const marcar = dlg => {
    if (k >= lineas.length) return;
    tiempos[k] = Math.max(0, Math.round((sincroTiempoActual() - 0.15) * 100) / 100);
    k++;
    pintar(dlg);
  };

  return showModal({
    title: 'Marcar los tiempos de la letra',
    wide: true,
    body: `<p class="hint">Audio: <b>${escapeHtml(a.name || 'Audio')}</b>. Toca ▶, y cada vez que empiece una línea toca <b>Marcar</b>
        (o la barra espaciadora). Para corregir una, tócala en la lista y vuelve a marcar desde ahí.</p>
      <div class="sincro-controles">
        <button type="button" class="btn" id="sincroPlay">▶ / ❚❚</button>
        <button type="button" class="btn" id="sincroAtras" title="Volver 5 segundos">−5 s</button>
        <button type="button" class="btn primary sincro-marcar" id="sincroMarcar">Marcar</button>
        <button type="button" class="btn" id="sincroDeshacer">Deshacer</button>
        <span class="hint" id="sincroCuenta"></span>
      </div>
      <ol class="sincro-lista" id="sincroLista"></ol>`,
    onOpen: dlg => {
      pintar(dlg);
      dlg.querySelector('#sincroPlay').onclick = () => ytmPlayPausa();
      dlg.querySelector('#sincroAtras').onclick = () => {
        if (enModoYt()) yt.player?.seekTo?.(Math.max(0, sincroTiempoActual() - 5), true);
        else player.currentTime = Math.max(0, player.currentTime - 5);
      };
      dlg.querySelector('#sincroMarcar').onclick = () => marcar(dlg);
      dlg.querySelector('#sincroDeshacer').onclick = () => {
        if (k > 0) k--;
        tiempos[k] = null;
        pintar(dlg);
      };
      dlg.querySelector('#sincroLista').onclick = e => {
        const li = e.target.closest('li[data-i]');
        if (!li) return;
        k = +li.dataset.i;
        // Tocar una línea marcada lleva el audio a ese punto, para revisar
        if (tiempos[k] != null) {
          const t = Math.max(0, tiempos[k] - 1);
          if (enModoYt()) yt.player?.seekTo?.(t, true); else player.currentTime = t;
        }
        pintar(dlg);
      };
      dlg.addEventListener('keydown', e => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        if (e.target.closest?.('.modal-actions')) return;
        e.preventDefault();
        e.stopPropagation();
        marcar(dlg);
      }, true);
    },
    buttons: [
      { label: 'Cancelar' },
      { label: 'Quitar los tiempos', onClick: () => 'quitar' },
      { label: 'Guardar', primary: true, onClick: () => 'guardar' }
    ]
  }).then(res => {
    if (!res) return;
    const s = { ...(d.sincro || {}) };
    if (res === 'quitar' || !tiempos.some(t => t != null)) delete s[clave];
    else {
      while (tiempos.length && tiempos[tiempos.length - 1] == null) tiempos.pop();
      s[clave] = tiempos;
    }
    d.sincro = s;
    refresh();
    scheduleSave();
    toast(s[clave] ? 'Tiempos guardados en la canción: guárdala (en la Biblioteca o en el archivo) para que se usen en el reproductor.' : 'Se quitaron los tiempos de este audio.', 4500);
  });
}
