-- Base de datos del sitio (Cloudflare D1). Cada tabla reemplaza a un JSON que estaba en el Drive
-- (MonteCarmelo/…). En `datos` va el mismo objeto que antes tenía el JSON, para que la API devuelva lo mismo;
-- las demás columnas sirven para buscar y ordenar.

-- sistema/usuarios.json
CREATE TABLE usuarios (
  email TEXT PRIMARY KEY,
  datos TEXT NOT NULL
);

-- sistema/auditoria.json (se guardan las últimas 1000)
CREATE TABLE auditoria (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  datos TEXT NOT NULL
);

-- sistema/visitantes.json
CREATE TABLE visitantes (
  email TEXT PRIMARY KEY,
  ultima TEXT NOT NULL DEFAULT '',
  datos TEXT NOT NULL
);

-- sistema/libro.json (se guardan los últimos 2000)
CREATE TABLE libro (
  id TEXT PRIMARY KEY,
  cuando TEXT NOT NULL,
  oculto INTEGER NOT NULL DEFAULT 0,
  datos TEXT NOT NULL
);
CREATE INDEX libro_cuando ON libro (cuando DESC);

-- biblioteca.json + el texto de cada .md (antes Biblioteca/canciones/*.md)
CREATE TABLE canciones (
  id TEXT PRIMARY KEY,
  orden TEXT NOT NULL,
  datos TEXT NOT NULL,
  md TEXT NOT NULL DEFAULT ''
);
CREATE INDEX canciones_orden ON canciones (orden);

-- Archivos guardados en R2: audios y partituras de la Biblioteca y archivos de los cancioneros.
-- id: el mismo fileId que tenían en el Drive (los nuevos, r-…). carpeta: la carpeta de la Biblioteca
-- (audios) o el folderId del cancionero; ruta: dentro del cancionero (canciones/x.md).
CREATE TABLE archivos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  r2 TEXT NOT NULL,
  nombre TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  tamano INTEGER NOT NULL DEFAULT 0,
  carpeta TEXT NOT NULL DEFAULT '',
  ruta TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL
);
CREATE INDEX archivos_carpeta ON archivos (tipo, carpeta, nombre);

-- indice.json (cancioneros guardados desde el editor). pendiente = 1 mientras se sube uno nuevo; meta:
-- comunidad, título, fecha y autor de la subida en curso (antes la propiedad «pendiente:<folderId>»).
CREATE TABLE cancioneros (
  folder_id TEXT PRIMARY KEY,
  html_id TEXT NOT NULL DEFAULT '',
  comunidad TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT '',
  pendiente INTEGER NOT NULL DEFAULT 0,
  actualizado TEXT NOT NULL DEFAULT '',
  datos TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX cancioneros_html ON cancioneros (html_id);

-- misas.json + Lecturas/misa-<id>.json (lecturas propias) + sistema/ensayos.json
CREATE TABLE misas (
  id TEXT PRIMARY KEY,
  comunidad TEXT NOT NULL,
  orden TEXT NOT NULL,
  datos TEXT NOT NULL,
  lecturas TEXT,
  ensayos TEXT
);

-- sistema/coros.json
CREATE TABLE coros (
  id TEXT PRIMARY KEY,
  comunidad TEXT NOT NULL,
  datos TEXT NOT NULL
);

-- actividades.json
CREATE TABLE actividades (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  orden TEXT NOT NULL,
  datos TEXT NOT NULL
);
CREATE INDEX actividades_orden ON actividades (orden);

-- Lecturas/<fecha>.json. vence = 0: definitiva; si no, hasta cuándo vale (ms) la respuesta «todavía no está».
CREATE TABLE lecturas (
  fecha TEXT PRIMARY KEY,
  vence INTEGER NOT NULL DEFAULT 0,
  datos TEXT NOT NULL
);

-- En vivo (antes CacheService): dura 6 horas
CREATE TABLE vivo (
  codigo TEXT PRIMARY KEY,
  misa_id TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  vence INTEGER NOT NULL,
  datos TEXT NOT NULL
);
CREATE INDEX vivo_misa ON vivo (misa_id);

-- Contadores con vencimiento (firmas por minuto y mensajes repetidos del libro de visitas)
CREATE TABLE limites (
  clave TEXT PRIMARY KEY,
  valor INTEGER NOT NULL DEFAULT 0,
  vence INTEGER NOT NULL
);
