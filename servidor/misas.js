// Cancioneros de misa (antes misas.json), sus lecturas propias (Lecturas/misa-<id>.json), los ensayos
// (sistema/ensayos.json) y En vivo (antes en CacheService).
import { ErrorApi, COMUNIDADES, ahora, fecha as fechaValida, texto, parsear } from './util.js';
import { usuarioDeToken, puedeEditar, auditar } from './auth.js';
import { lecturas, tiempoDeTitulo } from './lecturas.js';

async function leerMisa(c, id) {
  const fila = await c.db.prepare('SELECT * FROM misas WHERE id = ?').bind(String(id || '')).first();
  return fila ? { m: parsear(fila.datos), fila } : null;
}

export async function buscarMisa(c, id) {
  const r = await leerMisa(c, id);
  if (!r) throw new ErrorApi('Cancionero no encontrado');
  return r;
}

async function listarMisas(c, p) {
  const consulta = p && p.comunidad
    ? c.db.prepare('SELECT datos FROM misas WHERE comunidad = ? ORDER BY orden DESC').bind(String(p.comunidad))
    : c.db.prepare('SELECT datos FROM misas ORDER BY orden DESC');
  const { results } = await consulta.all();
  return { ok: true, misas: results.map((r) => parsear(r.datos)).filter(Boolean) };
}

function limpiarMomentos(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, 40).map((m) => ({
    momento: texto(m.momento, 60) || 'Momento',
    canciones: (Array.isArray(m.canciones) ? m.canciones : []).slice(0, 10).map((x) => {
      const r = { cancionId: texto(x.cancionId, 120), desplazamiento: Math.max(-11, Math.min(11, Math.round(Number(x.desplazamiento) || 0))) };
      if (x.sugerida === true) r.sugerida = true;
      // Ajustes de esta misa (el editor y el atril): cejilla, velocidad del audio y nivel del desplazamiento
      const capo = Math.round(Number(x.capo));
      if (capo >= 1 && capo <= 11) r.capo = capo;
      const velocidad = Math.round(Number(x.velocidad) * 100) / 100;
      if (velocidad >= 0.25 && velocidad <= 1.5 && velocidad !== 1) r.velocidad = velocidad;
      const scroll = Math.round(Number(x.scroll));
      if (scroll >= 1 && scroll <= 20) r.scroll = scroll;
      return r;
    }).filter((x) => x.cancionId)
  }));
}

function limpiarLecturas(l) {
  const tipos = { h: 1, c: 1, e: 1, p: 1 };
  const r = {
    titulo: texto(l.titulo, 200), dia: texto(l.dia, 120), color: texto(l.color, 40),
    secciones: (Array.isArray(l.secciones) ? l.secciones : []).slice(0, 12).map((s) => ({
      id: texto(s && s.id, 20).replace(/[^\w-]/g, '') || 'propia', nombre: texto(s && s.nombre, 80) || 'Lectura',
      bloques: (Array.isArray(s && s.bloques) ? s.bloques : []).slice(0, 120)
        .map((b) => ({ t: tipos[b && b.t] ? b.t : 'p', x: texto(b && b.x, 10000) })).filter((b) => b.x)
    })).filter((s) => s.bloques.length)
  };
  if (JSON.stringify(r).length > 120000) throw new ErrorApi('Las lecturas son demasiado largas para guardarlas');
  return r;
}

function limpiarEnsayos(e) {
  e = e || {};
  const vistas = new Set();
  return {
    fechasPosibles: (Array.isArray(e.fechasPosibles) ? e.fechasPosibles : []).map(fechaValida)
      .filter((f) => f && !vistas.has(f) && vistas.add(f)).sort().slice(0, 60),
    realizados: (Array.isArray(e.realizados) ? e.realizados : []).slice(0, 60).map((r) => ({
      fecha: fechaValida(r.fecha),
      presentes: (Array.isArray(r.presentes) ? r.presentes : []).slice(0, 200).map((p) => texto(p, 60)).filter(Boolean),
      nota: texto(r.nota, 500)
    })).filter((r) => r.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha))
  };
}

const ordenMisa = (m) => String(m.fechaUso || m.creado || '');

async function guardarMisa(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const m = d.misa || {};
  const comunidad = String(m.comunidad || '');
  if (!COMUNIDADES[comunidad]) throw new ErrorApi('Elegí la comunidad');
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('No tenés permiso para guardar cancioneros de ' + COMUNIDADES[comunidad]);
  const nombre = texto(m.nombre, 120);
  if (!nombre) throw new ErrorApi('Escribí el nombre del cancionero');
  // lecturas: objeto = texto propio del cancionero; null = volver a las del día; sin el campo = no cambian
  const nuevasLecturas = m.lecturas ? limpiarLecturas(m.lecturas) : m.lecturas;
  const anterior = m.id ? await leerMisa(c, m.id) : null;
  const previa = anterior && anterior.m;
  if (previa && !puedeEditar(u, previa.comunidad)) throw new ErrorApi('No tenés permiso para modificar este cancionero');
  const misa = {
    id: previa ? previa.id : 'm-' + Date.now(),
    nombre, comunidad, comunidadNombre: COMUNIDADES[comunidad],
    fechaUso: fechaValida(m.fechaUso), fechaLecturas: fechaValida(m.fechaLecturas),
    lecturasPropias: nuevasLecturas === undefined ? !!(previa && previa.lecturasPropias) : !!nuevasLecturas,
    tiempoLiturgico: texto(m.tiempoLiturgico, 60), coroId: texto(m.coroId, 40),
    momentos: limpiarMomentos(m.momentos),
    autor: previa ? previa.autor : u.email, autorNombre: previa ? previa.autorNombre : u.nombre,
    creado: previa ? previa.creado : ahora(), actualizado: ahora()
  };
  // La carpeta y la página publicadas solo cambian al publicar; un guardado común las conserva
  const publicada = m.drive && /^[\w-]{10,}$/.test(String(m.drive.folderId || '')) ? {
    folderId: String(m.drive.folderId), htmlId: /^[\w-]{10,}$/.test(String(m.drive.htmlId || '')) ? String(m.drive.htmlId) : ''
  } : null;
  const drive = publicada || (previa && previa.drive) || null;
  if (drive) misa.drive = drive;
  if (publicada) misa.publicada = ahora();
  else if (previa && previa.publicada) misa.publicada = previa.publicada;
  const lecturasCol = nuevasLecturas === undefined ? (anterior ? anterior.fila.lecturas : null) : (nuevasLecturas ? JSON.stringify(nuevasLecturas) : null);
  const ensayosCol = d.ensayos ? JSON.stringify(limpiarEnsayos(d.ensayos)) : (anterior ? anterior.fila.ensayos : null);
  await c.db.prepare('INSERT OR REPLACE INTO misas (id, comunidad, orden, datos, lecturas, ensayos) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(misa.id, comunidad, ordenMisa(misa), JSON.stringify(misa), lecturasCol, ensayosCol).run();
  await auditar(c, { tipo: 'misa_guardada', email: u.email, nombre: u.nombre, titulo: misa.nombre, comunidad });
  return { misa };
}

async function borrarMisa(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const { m } = await buscarMisa(c, d.id);
  if (!puedeEditar(u, m.comunidad)) throw new ErrorApi('No tenés permiso para borrar este cancionero');
  await c.db.prepare('DELETE FROM misas WHERE id = ?').bind(m.id).run();
  await auditar(c, { tipo: 'misa_borrada', email: u.email, nombre: u.nombre, titulo: m.nombre });
  return {};
}

export async function lecturasDeMisa(c, id) {
  const { m, fila } = await buscarMisa(c, id);
  const fecha = m.fechaLecturas || m.fechaUso;
  if (!m.lecturasPropias) return fecha ? lecturas(c, fecha) : { ok: true, lecturas: { disponible: false, secciones: [] } };
  const l = parsear(fila.lecturas, null);
  if (!l) return lecturas(c, fecha);
  l.disponible = true;
  l.propias = true;
  l.fecha = fecha;
  l.tiempo = tiempoDeTitulo(l.titulo) || (fecha ? (await lecturas(c, fecha)).lecturas.tiempo : '');
  return { ok: true, lecturas: l };
}

function exigirComunidad(u, comunidad) {
  if (!puedeEditar(u, comunidad)) throw new ErrorApi('Solo quienes tienen permisos en esta comunidad pueden ver estos datos.');
}

async function leerEnsayos(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const { m, fila } = await buscarMisa(c, d.id);
  exigirComunidad(u, m.comunidad);
  return { ensayos: parsear(fila.ensayos, null) || { fechasPosibles: [], realizados: [] } };
}

async function guardarEnsayos(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const { m } = await buscarMisa(c, d.id);
  exigirComunidad(u, m.comunidad);
  const ensayos = limpiarEnsayos(d.ensayos);
  await c.db.prepare('UPDATE misas SET ensayos = ? WHERE id = ?').bind(JSON.stringify(ensayos), m.id).run();
  return { ensayos };
}

// ==================== EN VIVO ====================
// Quien dirige el canto (Misas) va marcando la canción; el coro la sigue desde reproductor.html#vivo=<código>
// consultando cada ~4 s. Dura 6 horas.
const VIVO_MS = 6 * 3600 * 1000;

async function vivoLeer(c, codigo) {
  const fila = await c.db.prepare('SELECT datos FROM vivo WHERE codigo = ? AND vence > ?').bind(String(codigo || ''), Date.now()).first();
  return fila ? parsear(fila.datos) : null;
}

async function vivoGuardar(c, v) {
  await c.db.prepare('INSERT OR REPLACE INTO vivo (codigo, misa_id, activo, vence, datos) VALUES (?, ?, ?, ?, ?)')
    .bind(v.codigo, v.misaId, v.activo ? 1 : 0, Date.now() + VIVO_MS, JSON.stringify(v)).run();
}

const vivoPublico = (v) => ({
  codigo: v.codigo, nombre: v.nombre, momento: v.momento, cancionId: v.cancionId,
  desplazamiento: v.desplazamiento, rev: v.rev, activo: v.activo
});

async function vivoDeQuienDirige(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const v = await vivoLeer(c, d.codigo);
  if (!v) throw new ErrorApi('La transmisión ya no existe (duran 6 horas): volvé a iniciarla');
  if (!puedeEditar(u, v.comunidad)) throw new ErrorApi('No tenés permiso para dirigir este cancionero');
  return v;
}

async function iniciarVivo(c, d) {
  const u = await usuarioDeToken(c, d.token);
  const r = await leerMisa(c, String(d.misaId || ''));
  if (!r) throw new ErrorApi('Guardá el cancionero antes de transmitirlo en vivo');
  const misa = r.m;
  if (!puedeEditar(u, misa.comunidad)) throw new ErrorApi('No tenés permiso para dirigir este cancionero');
  const ahoraMs = Date.now();
  await c.db.prepare('DELETE FROM vivo WHERE vence < ?').bind(ahoraMs).run();
  const activa = await c.db.prepare('SELECT datos FROM vivo WHERE misa_id = ? AND activo = 1 AND vence > ?').bind(misa.id, ahoraMs).first();
  let v = activa && parsear(activa.datos);
  if (!v) {
    let codigo = '';
    for (let i = 0; i < 40; i++) {
      codigo = String(1000 + Math.floor(Math.random() * 9000));
      if (!await vivoLeer(c, codigo)) break;
    }
    v = {
      codigo, misaId: misa.id, comunidad: misa.comunidad, nombre: misa.nombre || 'Cancionero', momento: '', cancionId: '',
      desplazamiento: 0, rev: 0, activo: true, email: u.email, inicio: ahora()
    };
    await vivoGuardar(c, v);
  }
  return { codigo: v.codigo, vivo: vivoPublico(v) };
}

async function moverVivo(c, d) {
  const v = await vivoDeQuienDirige(c, d);
  if (!v.activo) throw new ErrorApi('La transmisión ya terminó');
  v.cancionId = texto(d.cancionId, 120);
  v.momento = texto(d.momento, 60);
  v.desplazamiento = Math.max(-11, Math.min(11, Math.round(Number(d.desplazamiento) || 0)));
  v.rev++;
  await vivoGuardar(c, v);
  return { vivo: vivoPublico(v) };
}

async function terminarVivo(c, d) {
  const v = await vivoDeQuienDirige(c, d);
  v.activo = false;
  v.rev++;
  await vivoGuardar(c, v);
  return { vivo: vivoPublico(v) };
}

export async function verVivo(c, codigo) {
  const v = await vivoLeer(c, codigo);
  if (!v) throw new ErrorApi('No hay ninguna transmisión con ese código. Revisalo con quien dirige el canto.');
  return { ok: true, vivo: vivoPublico(v) };
}

export const accionesMisas = {
  guardarMisa, borrarMisa, leerEnsayos, guardarEnsayos, iniciarVivo, moverVivo, terminarVivo
};
export const lecturasMisas = { misas: listarMisas };
