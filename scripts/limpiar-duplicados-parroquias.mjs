#!/usr/bin/env node
/**
 * Limpieza remota sin panel admin:
 * 1) Unifica parroquias duplicadas (mismo nombre+comuna) en D1.
 * 2) Llama mantenerCatalogo en el sitio (import + fotos) si hay SECRETO.
 *
 * Uso:
 *   node scripts/limpiar-duplicados-parroquias.mjs
 *   SECRETO=… SITIO_URL=https://www.cancioneroliturgico.cl/ node scripts/limpiar-duplicados-parroquias.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PARROQUIA_DEFECTO = 'montecarmelo';
const SITIO = (process.env.SITIO_URL || 'https://www.cancioneroliturgico.cl/').replace(/\/?$/, '/');

function cargarSecreto() {
  if (process.env.SECRETO) return process.env.SECRETO;
  const p = join(ROOT, '.dev.vars');
  if (!existsSync(p)) return '';
  const m = readFileSync(p, 'utf8').match(/^SECRETO=(.*)$/m);
  return m ? m[1].trim() : '';
}

function wranglerJson(args) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, shell: false
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error('wrangler falló: ' + args.join(' '));
  }
  const out = (r.stdout || '').trim();
  const start = out.indexOf('[');
  const startObj = out.indexOf('{');
  const i = start >= 0 && (startObj < 0 || start < startObj) ? start : startObj;
  if (i < 0) throw new Error('Sin JSON en salida wrangler:\n' + out.slice(0, 500));
  return JSON.parse(out.slice(i));
}

function d1Select(sql) {
  const raw = wranglerJson(['d1', 'execute', 'montecarmelo', '--remote', '--json', '--command', sql]);
  // wrangler --json: [{ results: [...], success }] o anidado
  const block = Array.isArray(raw) ? raw[0] : raw;
  return block.results || block.result?.[0]?.results || [];
}

function d1Run(sql) {
  wranglerJson(['d1', 'execute', 'montecarmelo', '--remote', '--json', '--command', sql]);
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const clave = (n, c) => norm(n) + '|' + norm(c);
const sufijoN = (slug) => /-\d+$/.test(String(slug || ''));

function esConfigurada(p) {
  if (p.configurada === true) return true;
  if (p.portada) return true;
  if (p.sacerdoteNombre || (p.lat != null && p.lng != null && p.direccion)) return true;
  return false;
}

function puntos(p) {
  let pts = 0;
  if (p.slug === PARROQUIA_DEFECTO) pts += 10000;
  if (esConfigurada(p)) pts += 1000;
  if (p.portada) pts += 200;
  if (!sufijoN(p.slug)) pts += 100;
  if (p.origen === 'sumar' || p.origen === 'admin') pts += 50;
  if (p.origen === 'catalogo' || p.origen === 'feligres') pts += 10;
  const t = Date.parse(p.creado || '') || 0;
  pts += Math.max(0, 50 - Math.floor((Date.now() - t) / 86400000));
  return pts;
}

function escSql(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function borrarSlug(slug) {
  if (slug === PARROQUIA_DEFECTO) throw new Error('No se puede borrar montecarmelo');
  const s = escSql(slug);
  const tablas = [
    'comunidades', 'miembros', 'visitantes', 'noticias', 'cancioneros', 'misas', 'coros',
    'actividades', 'libro', 'auditoria', 'vivo', 'paginas', 'suscripciones', 'reacciones'
  ];
  for (const t of tablas) {
    try { d1Run(`DELETE FROM ${t} WHERE parroquia = ${s}`); } catch (e) {
      console.warn('  (ok si no existe) ' + t + ':', e.message);
    }
  }
  d1Run(`DELETE FROM archivos WHERE carpeta = ${s}`);
  d1Run(`DELETE FROM parroquias WHERE slug = ${s}`);
}

async function unificarEnD1() {
  console.log('Leyendo parroquias remotas…');
  const rows = d1Select('SELECT slug, datos FROM parroquias');
  const grupos = new Map();
  for (const r of rows) {
    let datos = {};
    try { datos = typeof r.datos === 'string' ? JSON.parse(r.datos) : (r.datos || {}); } catch (_) {}
    const p = { ...datos, slug: r.slug };
    const k = clave(p.nombre, p.comuna);
    if (!norm(p.nombre)) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  let gruposUnidos = 0, borradas = 0;
  for (const [, lista] of grupos) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => puntos(b) - puntos(a));
    const keep = lista[0];
    const quitar = lista.slice(1).filter((p) => p.slug !== PARROQUIA_DEFECTO);
    if (!quitar.length) continue;
    console.log('Grupo:', keep.nombre, '/', keep.comuna || '—', '→ conserva', keep.slug, '; borra', quitar.map((x) => x.slug).join(', '));
    for (const p of quitar) {
      borrarSlug(p.slug);
      borradas++;
    }
    gruposUnidos++;
  }
  console.log('D1: ' + gruposUnidos + ' grupos, ' + borradas + ' borradas (de ' + rows.length + ' filas).');
  return { gruposUnidos, borradas, total: rows.length };
}

async function mantenerViaApi(secreto) {
  console.log('Llamando mantenerCatalogo en', SITIO);
  const res = await fetch(SITIO + 'api', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ accion: 'mantenerCatalogo', clave: secreto })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'mantenerCatalogo falló');
  console.log('API:', JSON.stringify({
    unificacion: j.unificacion,
    creadas: j.importacion?.creadas,
    omitidas: j.importacion?.omitidas,
    fotosOk: j.importacion?.fotosOk,
    fotosPendientes: j.importacion?.fotosPendientes,
    vueltasFoto: j.vueltasFoto
  }, null, 2));
  return j;
}

const uni = await unificarEnD1();
const secreto = cargarSecreto();
if (secreto && secreto !== 'secreto-solo-para-probar-en-local') {
  try {
    await mantenerViaApi(secreto);
  } catch (e) {
    console.warn('API mantenimiento (puede faltar el deploy):', e.message);
  }
} else {
  console.log('Sin SECRETO de producción: solo se limpió D1. Tras el deploy, corré de nuevo con SECRETO=…');
}
console.log('Listo.', uni);
