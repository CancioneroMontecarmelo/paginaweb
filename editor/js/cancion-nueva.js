'use strict';
// Canción nueva para la Biblioteca, pensada para el teléfono: el título, el momento de la misa, el audio (grabarlo
// ahí mismo, un archivo o un enlace) y la letra con los acordes en notación latina en la línea de arriba, con una
// barra de acordes que los pone sobre la sílaba donde está el cursor, el cambio de tono, los comentarios y las
// partituras y tablaturas. En el PC también recibe lo que se arrastra o se pega: un audio, la letra (.md, .txt,
// ChordPro) o una partitura del equipo, o un enlace o un texto de otra página.
// Al terminar queda en una pestaña y, si se pide, se guarda en la Biblioteca de la parroquia.

const CN_NOTAS = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const CN_TEXTO = /\.(md|markdown|txt|cho|crd|chopro|chordpro|pro)$/i;
const CN_MOMENTOS = TAG_FAMILIES.catolico.groups[0].tags;

// Las líneas de acordes en notación latina, cada acorde en su columna (la letra no cambia)
const cnLatino = text => text.split('\n').map(l => isChordLine(l)
  ? layoutChordLine(l, t => convertTokenNotation(t, true)).map(p => ' '.repeat(p.pad) + p.text).join('') : l).join('\n');

// Texto traído de un archivo o de otra página: ChordPro ([Sol]Noche…) pasa a la línea de acordes de arriba
function cnTextoDe(raw, nombre = '') {
  raw = String(raw || '').replace(/\r\n?/g, '\n');
  const data = nombre ? parseDocument(raw, nombre) : looksLikeChordPro(raw) ? chordProToText(raw) : { title: '', text: raw };
  return { titulo: data.title || '', texto: cnLatino(data.text || '') };
}

// Pone el acorde en la columna «col» de una línea de acordes: reemplaza el que ya está ahí y no mueve los
// siguientes salvo que queden pegados. Devuelve la línea y dónde termina el acorde.
function cnPonerEn(linea, col, acorde) {
  const s = linea.padEnd(col, ' ');
  const re = /\S+/g;
  let m, inicio = col, fin = col;
  while ((m = re.exec(s))) {
    if (m.index <= col && col < m.index + m[0].length) { inicio = m.index; fin = m.index + m[0].length; break; }
  }
  let antes = s.slice(0, inicio);
  if (antes && !/\s$/.test(antes)) antes += ' ';
  const resto = s.slice(fin), sig = resto.search(/\S/);
  const hasta = antes.length + acorde.length;
  let out = antes + acorde;
  if (sig >= 0) out += ' '.repeat(Math.max(1, fin + sig - hasta)) + resto.slice(sig);
  return { linea: out.trimEnd(), fin: hasta };
}

// El acorde va en la línea de acordes de la línea donde está el cursor (si no hay, se crea encima de la letra)
function cnPonerAcorde(ta, acorde) {
  const v = ta.value, p = ta.selectionStart;
  const ini = v.lastIndexOf('\n', p - 1) + 1;
  let finL = v.indexOf('\n', p);
  if (finL < 0) finL = v.length;
  const linea = v.slice(ini, finL), col = p - ini;
  let nuevo, cursor;
  if (!linea.trim() || isChordLine(linea)) {
    const r = cnPonerEn(linea, col, acorde);
    nuevo = v.slice(0, ini) + r.linea + v.slice(finL);
    cursor = ini + r.fin;
  } else {
    const pIni = ini > 0 ? v.lastIndexOf('\n', ini - 2) + 1 : -1;
    const previa = ini > 0 ? v.slice(pIni, ini - 1) : '';
    if (ini > 0 && isChordLine(previa)) {
      const r = cnPonerEn(previa, col, acorde);
      nuevo = v.slice(0, pIni) + r.linea + v.slice(ini - 1);
      cursor = p + r.linea.length - previa.length;
    } else {
      const r = cnPonerEn('', col, acorde);
      nuevo = v.slice(0, ini) + r.linea + '\n' + v.slice(ini);
      cursor = p + r.linea.length + 1;
    }
  }
  ta.value = nuevo;
  ta.setSelectionRange(cursor, cursor);
  ta.dispatchEvent(new Event('input'));
}

const cnLineaHtml = l => isChordLine(l) ? `<div class="line chord-line">${chordLineHtml(l, true)}</div>` : renderLine(l);

// Traspone las líneas de acordes del texto (quedan en notación latina y en sus columnas)
function cnTrasponer(texto, semis) {
  const key = detectKey(texto);
  if (!key || !semis) return texto;
  const idx = mod12(key.idx + semis);
  return cnLatino(transposeText(texto, semis, keyPrefersFlats(idx, key.minor)));
}

// 💬 Comentario: pone o quita «> » en las líneas donde está el cursor (o la selección)
function cnComentario(ta) {
  const v = ta.value;
  const ini = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let fin = v.indexOf('\n', Math.max(ta.selectionEnd - (ta.selectionEnd > ta.selectionStart ? 1 : 0), ta.selectionStart));
  if (fin < 0) fin = v.length;
  const lineas = v.slice(ini, fin).split('\n');
  const llenas = lineas.filter(l => l.trim());
  const re = /^\s*>\s?/;
  const quitar = llenas.length && llenas.every(l => re.test(l));
  const out = lineas.length === 1 && !lineas[0].trim() ? '> '
    : lineas.map(l => !l.trim() ? l : quitar ? l.replace(re, '') : '> ' + l).join('\n');
  ta.setRangeText(out, ini, fin, 'end');
  ta.dispatchEvent(new Event('input'));
}

// Una partitura o tablatura que llega a la hoja: archivo del equipo, imagen pegada o enlace
function cnHoja({ file = null, url = '', tipo = null }) {
  const formato = file ? sheetFormat(file.name, file.type) : sheetFormat(urlPath(url)) || 'imagen';
  if (formato === 'mscz') throw new Error(MSCZ_MSG);
  if (!formato) throw new Error(`«${file.name}» no es una partitura que se pueda mostrar.`);
  tipo ||= formato === 'gp' || formato === 'alphatex' ? 'tablatura' : 'partitura';
  return file
    ? { tipo, formato, kind: 'local', src: file.name || `Imagen ${tipo}.png`, name: fileBase(file.name || '') || sheetLabel(tipo), blob: file }
    : { tipo, formato, kind: 'url', src: url, name: fileBase(urlPath(url)) || sheetLabel(tipo) };
}

// ============ LA HOJA ============
// audio: { kind: 'local', blob, fileName, name, url, info } | { kind: 'url', src, name, info }
async function abrirCancionNueva({ toma = null } = {}) {
  if (EFIMERO) { toast('Este atril no guarda cambios: ábrelo con «Editar en el editor» desde Misas.', 5000); return; }
  let audio = null, propio = false, reloj = 0, interno = false;
  const momentoActual = cur()?.mc?.momento || '';
  const fechaHoy = () => new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });

  const r = await showModal({
    title: 'Canción nueva',
    wide: true,
    body: `
      <div class="cn-datos">
        <label class="field"><span>Título</span><input type="text" id="cnTitulo" autocomplete="off" placeholder="Título de la canción"></label>
        <label class="field"><span>Momento de la misa</span><select id="cnMomento"><option value="">Ninguno</option>
          ${CN_MOMENTOS.map(m => `<option${tagNorm(m) === tagNorm(momentoActual) ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select></label>
      </div>
      <div class="field cn-audio"><span>Audio</span>
        <div class="cn-grabar">
          <button type="button" class="rc-rec" id="cnRec" title="Grabar" aria-label="Grabar"><span></span></button>
          <span class="rc-time" id="cnTiempo">0:00</span>
          <div class="cn-nivel" aria-hidden="true"><i id="cnNivel"></i></div>
        </div>
        <div class="cn-tiene" id="cnTiene" hidden></div>
        <div class="cn-audio-fila">
          <button type="button" class="btn" id="cnArchivo">Elegir archivo…</button>
          <input type="file" id="cnFile" accept="${MEDIA_ACCEPT}" hidden>
          <input type="text" id="cnUrl" inputmode="url" autocomplete="off" placeholder="o pega un enlace (YouTube, mp3…)">
        </div>
      </div>
      <div class="cn-escribir">
        <div class="field"><span>Letra y acordes <small>(los acordes en la línea de arriba, en notación latina)</small></span>
          <div class="cn-tono" id="cnTono" role="toolbar" aria-label="Cambiar de tono">
            <span class="cn-tono-lbl">🎼 Tono <b id="cnTonoActual">—</b></span>
            <button type="button" data-semi="-1" title="Bajar medio tono">−½</button>
            <span class="cn-tonos" id="cnTonos"></span>
            <button type="button" data-semi="1" title="Subir medio tono">+½</button>
            <button type="button" data-original title="Volver al tono en que se escribió">Original</button>
          </div>
          <div class="cn-acordes" id="cnAcordes" role="toolbar" aria-label="Poner un acorde donde está el cursor">
            ${CN_NOTAS.map(n => `<button type="button" data-nota="${n}">${n}</button>`).join('')}
            <span class="cn-mods">${['#', 'b', 'm', '7'].map(x => `<button type="button" data-mod="${x}" aria-pressed="false">${x}</button>`).join('')}</span>
            <button type="button" class="cn-cmt" data-cmt title="Comentario: la línea del cursor queda como nota (no se canta)">💬</button>
          </div>
          <textarea id="cnLetra" class="cn-letra" wrap="off" spellcheck="false" autocapitalize="sentences"
            placeholder="Sol              Re7        Sol&#10;Noche de paz, noche de amor"></textarea>
          <small class="cn-ayuda">Escribe la letra, deja el cursor en la sílaba y toca el acorde: se pone en la línea de arriba.</small>
        </div>
        <div class="field cn-previa-caja"><span>Así se verá</span><div class="song-render cn-previa" id="cnPrevia"></div></div>
      </div>
      <div class="field cn-hojas"><span>Partituras y tablaturas</span>
        <div class="cn-audio-fila">
          <button type="button" class="btn" data-hoja="partitura">🎼 Partitura…</button>
          <button type="button" class="btn" data-hoja="tablatura">🎸 Tablatura…</button>
          <input type="file" id="cnHojaFile" accept="${SHEET_ACCEPT}" hidden>
          <input type="text" id="cnHojaUrl" inputmode="url" autocomplete="off" placeholder="o pega el enlace (PDF, imagen, MusicXML, Guitar Pro)">
        </div>
        <div class="cn-fichas" id="cnFichas"></div>
      </div>
      <p class="hint cn-pc">También puedes arrastrar aquí (o pegar con Ctrl+V) un audio, la letra (.md, .txt, ChordPro), una partitura
        o una tablatura de tu equipo, o un enlace o un texto desde otra página.</p>`,
    onOpen: dlg => {
      dlg.classList.add('cn-hoja');
      const q = s => dlg.querySelector(s);
      const ta = q('#cnLetra'), titulo = q('#cnTitulo');
      const aviso = msg => { q('.modal-error').textContent = msg || ''; };

      // ---- Vista previa: los acordes de otro color, sobre la letra ----
      let espera = 0;
      const previa = () => {
        clearTimeout(espera);
        espera = setTimeout(() => {
          q('#cnPrevia').innerHTML = ta.value.trim() ? ta.value.split('\n').map(cnLineaHtml).join('')
            : '<div class="hint">Aquí aparece la canción con los acordes sobre la letra.</div>';
          pintarTono();
        }, 120);
      };

      // ---- Tono: los 12 tonos, medio tono arriba o abajo y volver al original ----
      let corrido = 0;
      const pintarTono = () => {
        const key = detectKey(ta.value);
        q('#cnTonoActual').textContent = key ? keyName(key.idx, key.minor, true) : '—';
        q('#cnTonos').innerHTML = Array.from({ length: 12 }, (_, i) =>
          `<button type="button" data-tono="${i}"${key?.idx === i ? ' class="on"' : ''}${key ? '' : ' disabled'}>${keyName(i, !!key?.minor, true)}</button>`).join('');
        q('#cnTono').querySelectorAll('[data-semi]').forEach(b => { b.disabled = !key; });
        q('#cnTono [data-original]').hidden = !corrido;
      };
      const mover = semis => {
        if (!semis) return;
        ta.value = cnTrasponer(ta.value, semis);
        corrido = mod12(corrido + semis);
        ta.dispatchEvent(new Event('input'));
      };
      q('#cnTono').addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
      q('#cnTono').addEventListener('click', e => {
        const b = e.target.closest('button');
        const key = detectKey(ta.value);
        if (!b || b.disabled || !key) return;
        if (b.dataset.semi) mover(+b.dataset.semi);
        else if (b.dataset.tono) mover(signedSemis(+b.dataset.tono - key.idx));
        else if ('original' in b.dataset) mover(signedSemis(-corrido));
      });
      ta.addEventListener('input', previa);
      previa();

      // ---- Barra de acordes (no le quita el foco a la letra: el teclado del teléfono sigue abierto) ----
      const mods = new Set();
      q('#cnAcordes').addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
      q('#cnAcordes').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if ('cmt' in b.dataset) {
          if (document.activeElement !== ta) ta.focus();
          cnComentario(ta);
          return;
        }
        if (b.dataset.mod) {
          const x = b.dataset.mod;
          if (mods.has(x)) mods.delete(x);
          else {
            mods.add(x);
            if (x === '#') mods.delete('b');
            if (x === 'b') mods.delete('#');
          }
          q('#cnAcordes').querySelectorAll('[data-mod]').forEach(m => m.setAttribute('aria-pressed', mods.has(m.dataset.mod)));
          return;
        }
        if (document.activeElement !== ta) ta.focus();
        cnPonerAcorde(ta, b.dataset.nota + (mods.has('#') ? '#' : mods.has('b') ? 'b' : '') + (mods.has('m') ? 'm' : '') + (mods.has('7') ? '7' : ''));
        mods.clear();
        q('#cnAcordes').querySelectorAll('[data-mod]').forEach(m => m.setAttribute('aria-pressed', 'false'));
      });

      // ---- Audio ----
      const pintarAudio = () => {
        const box = q('#cnTiene');
        box.hidden = !audio;
        if (!audio) { box.innerHTML = ''; return; }
        box.innerHTML = (audio.kind === 'local'
          ? `<audio controls src="${audio.url}"></audio>`
          : `<a href="${escapeHtml(audio.src)}" target="_blank" rel="noopener">🔗 ${escapeHtml(audio.name)}</a>`)
          + `<span class="hint">${escapeHtml(audio.info || '')}</span><button type="button" class="btn small" id="cnQuitar">Quitar</button>`;
        q('#cnQuitar').onclick = () => { if (audio?.url) URL.revokeObjectURL(audio.url); audio = null; pintarAudio(); };
      };
      const reemplazar = () => !audio || confirm(`¿Reemplazar el audio que ya tiene («${audio.name}»)?`);
      const ponerArchivo = (blob, fileName, info) => {
        if (!reemplazar()) return;
        if (audio?.url) URL.revokeObjectURL(audio.url);
        audio = { kind: 'local', blob, fileName, name: fileBase(fileName), url: URL.createObjectURL(blob), info };
        q('#cnUrl').value = '';
        pintarAudio();
        aviso('');
      };
      const tamano = b => (b.size / 1048576).toFixed(1).replace('.', ',') + ' MB';
      const ponerUrl = raw => {
        const url = String(raw || '').trim();
        if (!url) return true;
        try { new URL(url); } catch (_) { aviso('Ese enlace no es válido.'); return false; }
        const n = normalizeMediaUrl(url);
        if (DRM_SITES.includes(n.streaming)) { aviso(`${n.streaming} no deja escuchar su música fuera de su app. Busca la misma canción en YouTube.`); return false; }
        if (audio?.kind === 'url' && audio.src === n.url) return true;
        if (!reemplazar()) return false;
        if (audio?.url) URL.revokeObjectURL(audio.url);
        audio = { kind: 'url', src: n.url, name: n.streaming ? `Video de ${n.streaming}` : fileBase(n.url) || 'Audio', info: n.note || '' };
        q('#cnUrl').value = '';
        pintarAudio();
        aviso('');
        return true;
      };
      dlg._cnPonerUrl = () => ponerUrl(q('#cnUrl').value);
      q('#cnUrl').addEventListener('change', () => ponerUrl(q('#cnUrl').value));
      q('#cnUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ponerUrl(q('#cnUrl').value); } });
      q('#cnArchivo').onclick = () => q('#cnFile').click();
      q('#cnFile').onchange = e => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) ponerArchivo(f, f.name, tamano(f));
      };
      if (toma) ponerArchivo(toma.blob, `Grabación ${fechaHoy()}.${toma.ext}`, `Toma del panel Grabar · ${tamano(toma.blob)}`);

      // ---- Grabar aquí mismo, con la misma cadena del panel Grabar (nivel automático y limitador) ----
      const pintarRec = () => {
        const on = rec.status === 'recording';
        q('#cnRec').classList.toggle('on', on);
        q('#cnRec').title = on ? 'Detener' : 'Grabar';
        q('#cnRec').setAttribute('aria-label', q('#cnRec').title);
        q('#cnRec').disabled = rec.status === 'starting';
        dlg.classList.toggle('cn-grabando', on);
      };
      const terminarToma = () => {
        clearInterval(reloj);
        const blob = rec.blob, ext = rec.ext, ms = rec.elapsed;
        discardTake();
        if (propio) { stopInput(); rec.status = 'off'; propio = false; }
        pintarRec();
        q('#cnNivel').style.width = '0';
        if (blob) {
          const t = titulo.value.trim();
          audio = null;
          ponerArchivo(blob, `${t ? t + ' - grabación' : 'Grabación ' + fechaHoy()}.${ext}`, `Grabación de ${fmtRecTime(ms)} · ${tamano(blob)}`);
        }
      };
      q('#cnRec').onclick = async () => {
        if (rec.status === 'recording' || rec.status === 'paused') { stopRecording(); return; }
        if (recorderBusy()) { aviso('Hay una toma sin guardar en el panel Grabar: guárdala o descártala primero.'); return; }
        if (!reemplazar()) return;
        if (audio?.url) URL.revokeObjectURL(audio.url);
        audio = null;
        pintarAudio();
        aviso('');
        if (!rec.n) {
          propio = true;
          rec.status = 'starting';
          pintarRec();
          await startInput();
          if (!rec.n) { aviso(rec.error || 'No se pudo abrir el micrófono.'); rec.status = 'off'; propio = false; pintarRec(); return; }
        }
        startRecording();
        pintarRec();
        clearInterval(reloj);
        reloj = setInterval(() => {
          if (rec.status === 'done') { terminarToma(); return; }
          q('#cnTiempo').textContent = fmtRecTime(recElapsed());
          const db = 10 * Math.log10(rec.outPow + 1e-12);
          q('#cnNivel').style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
        }, 100);
      };
      dlg._cnCerrar = () => {
        clearInterval(reloj);
        if (rec.recorder && rec.recorder.state !== 'inactive' && (rec.status === 'recording' || rec.status === 'paused')) {
          rec.recorder.onstop = null;
          rec.recorder.stop();
          Object.assign(rec, { status: rec.n ? 'ready' : 'off', blob: null, elapsed: 0 });
        }
        if (propio) { stopInput(); rec.status = 'off'; }
        if (audio?.url && !dlg._cnUsado) URL.revokeObjectURL(audio.url);
      };
      dlg._cnAudio = () => audio;

      // ---- Partituras y tablaturas (pasan a la pestaña y se suben a la Biblioteca con la canción) ----
      const hojas = [];
      let tipoHoja = 'partitura';
      const pintarHojas = () => {
        q('#cnFichas').innerHTML = hojas.map((h, i) => `<span class="cn-ficha">
          <button type="button" data-hoja-tipo="${i}" title="${h.tipo === 'tablatura' ? 'Es tablatura: tocar para que sea partitura' : 'Es partitura: tocar para que sea tablatura'}">${h.tipo === 'tablatura' ? '🎸' : '🎼'}</button>
          <span>${escapeHtml(h.name)}</span><button type="button" data-hoja-quitar="${i}" aria-label="Quitar ${escapeHtml(h.name)}">×</button></span>`).join('');
      };
      const ponerHoja = datos => {
        try {
          hojas.push(cnHoja(datos));
        } catch (e) {
          aviso(e.message);
          return false;
        }
        pintarHojas();
        aviso('');
        return true;
      };
      q('.cn-hojas').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.hoja) { tipoHoja = b.dataset.hoja; q('#cnHojaFile').click(); }
        else if (b.dataset.hojaTipo) {
          const h = hojas[+b.dataset.hojaTipo];
          h.tipo = h.tipo === 'tablatura' ? 'partitura' : 'tablatura';
          pintarHojas();
        } else if (b.dataset.hojaQuitar) { hojas.splice(+b.dataset.hojaQuitar, 1); pintarHojas(); }
      });
      q('#cnHojaFile').onchange = e => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) ponerHoja({ file: f, tipo: tipoHoja });
      };
      const ponerHojaUrl = () => {
        const url = q('#cnHojaUrl').value.trim();
        if (!url) return true;
        if (!/^https?:\/\//i.test(url)) { aviso('El enlace de la partitura debe empezar por http:// o https://'); return false; }
        if (!ponerHoja({ url })) return false;
        q('#cnHojaUrl').value = '';
        return true;
      };
      q('#cnHojaUrl').addEventListener('change', ponerHojaUrl);
      q('#cnHojaUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ponerHojaUrl(); } });
      dlg._cnHojas = () => (ponerHojaUrl() ? hojas : null);

      // ---- Lo que llega de afuera: archivos del equipo, enlaces o texto de otra página ----
      const ponerLetra = ({ titulo: t, texto }) => {
        if (!texto.trim()) return;
        if (ta.value.trim() && ta.value.trim() !== texto.trim() && !confirm('¿Reemplazar la letra que ya está escrita?')) return;
        ta.value = texto;
        if (t && !titulo.value.trim()) titulo.value = t;
        previa();
        aviso('');
      };
      const recibir = async (files, uriList, html, plano) => {
        if (files.length) {
          const media = files.find(isMediaFile), texto = files.find(f => CN_TEXTO.test(f.name));
          const deHoja = files.filter(f => !CN_TEXTO.test(f.name) && (isSheetFile(f) || sheetFormat(f.name) === 'mscz'));
          if (!media && !texto && !deHoja.length) {
            aviso('Eso no sirve aquí: trae un audio o video, la letra (.md, .txt, ChordPro) o una partitura o tablatura.');
            return;
          }
          if (texto) ponerLetra(cnTextoDe(await texto.text(), texto.name));
          if (media) ponerArchivo(media, media.name, tamano(media));
          deHoja.forEach(f => ponerHoja({ file: f }));
          return;
        }
        const url = (uriList || '').split('\n').map(s => s.trim()).find(l => /^https?:\/\//i.test(l))
          || (/^https?:\/\/\S+$/i.test((plano || '').trim()) ? plano.trim() : '');
        // Un enlace arrastrado (o pegado) es el audio, o la partitura si apunta a una; un texto de otra página es la letra
        if (url && (!plano?.trim() || plano.trim() === url)) {
          if (isSheetUrl(url)) ponerHoja({ url }); else ponerUrl(url);
          return;
        }
        const t = clipboardToText(html, plano, false);
        if (t.trim()) ponerLetra(cnTextoDe(t));
      };
      const sirve = dt => [...(dt?.types || [])].some(t => ['Files', 'text/uri-list', 'text/plain', 'text/html'].includes(t));
      ta.addEventListener('dragstart', () => { interno = true; });
      ta.addEventListener('dragend', () => { interno = false; });
      dlg.ondragover = e => {
        if (interno || !sirve(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        dlg.classList.add('cn-encima');
      };
      dlg.ondragleave = e => { if (!e.relatedTarget || !dlg.contains(e.relatedTarget)) dlg.classList.remove('cn-encima'); };
      dlg.ondrop = e => {
        dlg.classList.remove('cn-encima');
        if (interno) return;
        e.preventDefault();
        e.stopPropagation();
        const dt = e.dataTransfer;
        recibir([...(dt.files || [])], dt.getData('text/uri-list'), dt.getData('text/html'), dt.getData('text/plain'));
      };
      // Ctrl+V: en la letra se pega en el cursor (con los acordes en notación latina); fuera de los campos, como al arrastrar
      dlg.onpaste = e => {
        const cd = e.clipboardData, files = [...(cd?.files || [])];
        const enCampo = e.target.matches?.('input');
        if (enCampo && !files.length) return;
        const html = cd.getData('text/html'), plano = cd.getData('text/plain');
        if (e.target === ta && !files.length && !/^https?:\/\/\S+$/i.test(plano.trim())) {
          e.preventDefault();
          const t = cnTextoDe(clipboardToText(html, plano, false)).texto;
          ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
          ta.dispatchEvent(new Event('input'));
          return;
        }
        e.preventDefault();
        recibir(files, '', html, plano);
      };

      titulo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } });
      if (!isMobileDevice()) titulo.focus();
    },
    buttons: [
      { label: 'Cancelar' },
      { label: 'Solo en una pestaña', onClick: d => cnListo(d, false) },
      { label: 'Guardar en la Biblioteca', primary: true, onClick: d => cnListo(d, true) }
    ]
  });

  const dlg = $('#modal');
  dlg._cnCerrar?.();
  dlg.ondragover = dlg.ondragleave = dlg.ondrop = dlg.onpaste = null;
  delete dlg._cnCerrar; delete dlg._cnAudio; delete dlg._cnPonerUrl; delete dlg._cnUsado; delete dlg._cnHojas;
  if (!r) return;

  const a = r.audio;
  const audios = !a ? [] : a.kind === 'url' ? [{ kind: 'url', src: a.src, name: a.name }]
    : [{ kind: 'local', src: './' + a.fileName, name: a.name, objectUrl: a.url }];
  openInTab({ title: r.titulo, text: r.texto, audios, tags: r.momento ? withFamilyTag([r.momento], 'catolico') : [], clean: false }, true);
  const d = cur();
  for (const h of r.hojas) pushSheet(d, h.blob ? { ...h, objectUrl: URL.createObjectURL(h.blob) } : h);
  if (r.hojas.length && r.texto.trim()) d.view = 'letra';
  setMode(r.texto.trim() || r.hojas.length ? 'atril' : 'edit');
  if (typeof ytmIrA === 'function') ytmIrA('cancionero');
  scheduleSave();
  if (r.biblioteca) await mcGuardarCancion();
  else toast(`«${r.titulo}» quedó en una pestaña. Para que la vean todos: Archivo → Guardar canción en la Biblioteca.`, 5000);
}

// Botones «Solo en una pestaña» y «Guardar en la Biblioteca»
function cnListo(dlg, biblioteca) {
  const titulo = dlg.querySelector('#cnTitulo').value.trim();
  if (!titulo) { dlg.querySelector('#cnTitulo').focus(); return modalFail(dlg, 'Escribe el título de la canción.'); }
  if (rec.status === 'recording' || rec.status === 'paused') return modalFail(dlg, 'Detén la grabación antes de terminar.');
  if (!dlg._cnPonerUrl()) return false;
  const texto = cnLatino(dlg.querySelector('#cnLetra').value.replace(/\s+$/, ''));
  const audio = dlg._cnAudio();
  const hojas = dlg._cnHojas();
  if (!hojas) return false;
  if (!texto.trim() && !audio && !hojas.length) return modalFail(dlg, 'Graba o elige un audio, escribe la letra o agrega una partitura.');
  if (biblioteca && !MC_API) return modalFail(dlg, 'El servidor de la parroquia no está conectado: usa «Solo en una pestaña».');
  dlg._cnUsado = true;
  return { titulo, momento: dlg.querySelector('#cnMomento').value, texto, audio, hojas, biblioteca };
}
