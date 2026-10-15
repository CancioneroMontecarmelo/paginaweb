-- Experiencia: aviso del sábado (Web Push), «¿Qué canto te gustó más?» y los nombres de los canales de YouTube
-- de los audios (para Agradecimientos y «Audio: …» en los créditos).

-- Una suscripción por navegador. datos: { keys: { p256dh, auth }, comunidad }. avisado: el sábado (AAAA-MM-DD)
-- del último aviso (el trabajador trabajadores/avisos los manda por tandas)
CREATE TABLE suscripciones (
  endpoint TEXT PRIMARY KEY,
  parroquia TEXT NOT NULL,
  datos TEXT NOT NULL,
  creado TEXT NOT NULL,
  avisado TEXT NOT NULL DEFAULT ''
);
CREATE INDEX suscripciones_parroquia ON suscripciones (parroquia);
CREATE INDEX suscripciones_avisado ON suscripciones (avisado);

-- Un voto por equipo y misa (equipo: un id al azar guardado en el navegador)
CREATE TABLE reacciones (
  misa_id TEXT NOT NULL,
  equipo TEXT NOT NULL,
  parroquia TEXT NOT NULL,
  cancion TEXT NOT NULL,
  cuando TEXT NOT NULL,
  PRIMARY KEY (misa_id, equipo)
);
CREATE INDEX reacciones_parroquia ON reacciones (parroquia, cuando);

-- De dónde viene cada audio enlazado: el canal de YouTube (oEmbed) o el sitio
CREATE TABLE fuentes (
  url TEXT PRIMARY KEY,
  canal TEXT NOT NULL DEFAULT '',
  canal_url TEXT NOT NULL DEFAULT '',
  revisado TEXT NOT NULL
);
