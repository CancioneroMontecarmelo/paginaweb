// Constantes y utilidades comunes de la API (antes al principio de backend/Code.gs).

export const COMUNIDADES = {
  'maria-de-nazaret': 'Capilla María de Nazaret',
  'san-pablo-apostol': 'San Pablo Apóstol',
  'sagrada-familia': 'Sagrada Familia',
  'monte-carmelo': 'Nuestra Señora del Monte Carmelo'
};

// Roles con privilegios. Cualquier otra cuenta es «visitante».
export const ROLES = {
  admin_general: 'Administrador general',
  admin_segundo: 'Responsable del sitio',
  sacerdote: 'Sacerdote',
  admin: 'Administrador de comunidad',
  editor: 'Editor',
  colaborador: 'Colaborador'
};

export const TOKEN_DIAS = 90;
export const MAX_ARCHIVO_BYTES = 30 * 1024 * 1024;

export class ErrorApi extends Error {}

export const normEmail = (s) => String(s || '').trim().toLowerCase();
export const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const ahora = () => new Date().toISOString();
export const fecha = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
export const texto = (s, max) => String(s == null ? '' : s).trim().slice(0, max);

export function slug(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cancionero';
}

// Como slug, sin cortar ni valor por defecto
export function claveTitulo(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Clave para ordenar por título como lo hacía localeCompare (sin tildes ni mayúsculas)
export const ordenTitulo = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function fechaEn(zona, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const hoyChile = () => fechaEn('America/Santiago');

// 2026-10-08-2215 (para nombres de archivo ordenados)
export const sello = () => ahora().slice(0, 16).replace('T', '-').replace(':', '');

const LETRAS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// Id de los archivos y carpetas nuevos («r-» + 24 letras): como los de Drive, imposible de adivinar
export function idNuevo(prefijo = 'r-', largo = 24) {
  const b = crypto.getRandomValues(new Uint8Array(largo));
  let s = '';
  for (const x of b) s += LETRAS[x % LETRAS.length];
  return prefijo + s;
}

export function comunidadValida(c) {
  return c === 'parroquia' || !!COMUNIDADES[c];
}

export function parsear(t, defecto = null) {
  try { return t == null ? defecto : JSON.parse(t); } catch (_) { return defecto; }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

export function respuestaJson(obj, extra = {}) {
  return new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra }
  });
}

export function respuestaTexto(t, extra = {}) {
  return new Response(t, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra } });
}

export const encabezadosCors = CORS;
