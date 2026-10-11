-- Varias parroquias. Solo agrega: todo lo que ya existe queda en la parroquia 'montecarmelo'.
-- La Biblioteca (canciones, archivos de audio y partituras) y las lecturas siguen siendo comunes.

-- datos: nombre, nombreCorto, descripcion, correo, iconos {"180","192","512": id en archivos}, portada, activa, creado
CREATE TABLE parroquias (
  slug TEXT PRIMARY KEY,
  datos TEXT NOT NULL
);

-- datos: nombre, carpetaCancioneros (nombre de carpeta para los scripts de escritorio)
CREATE TABLE comunidades (
  parroquia TEXT NOT NULL,
  slug TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  datos TEXT NOT NULL,
  PRIMARY KEY (parroquia, slug)
);

-- El rol y la comunidad de cada persona en cada parroquia. usuarios queda para la identidad (nombre, foto).
-- datos: rol, comunidad, activo, invitado, invitadoPor, modificadoPor, creado
CREATE TABLE miembros (
  parroquia TEXT NOT NULL,
  email TEXT NOT NULL,
  datos TEXT NOT NULL,
  PRIMARY KEY (parroquia, email)
);
CREATE INDEX miembros_email ON miembros (email);

-- Antes noticias/<comunidad>.json. comunidad = 'parroquia' para las de toda la parroquia.
CREATE TABLE noticias (
  id TEXT PRIMARY KEY,
  parroquia TEXT NOT NULL,
  comunidad TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT '',
  datos TEXT NOT NULL
);
CREATE INDEX noticias_parroquia ON noticias (parroquia, comunidad, fecha DESC);

ALTER TABLE cancioneros ADD COLUMN parroquia TEXT NOT NULL DEFAULT 'montecarmelo';
CREATE INDEX cancioneros_parroquia ON cancioneros (parroquia, comunidad, fecha);

ALTER TABLE misas ADD COLUMN parroquia TEXT NOT NULL DEFAULT 'montecarmelo';
CREATE INDEX misas_parroquia ON misas (parroquia, orden);

ALTER TABLE coros ADD COLUMN parroquia TEXT NOT NULL DEFAULT 'montecarmelo';
CREATE INDEX coros_parroquia ON coros (parroquia, comunidad);

ALTER TABLE actividades ADD COLUMN parroquia TEXT NOT NULL DEFAULT 'montecarmelo';
CREATE INDEX actividades_parroquia ON actividades (parroquia, orden);

ALTER TABLE libro ADD COLUMN parroquia TEXT NOT NULL DEFAULT 'montecarmelo';
CREATE INDEX libro_parroquia ON libro (parroquia, cuando DESC);

ALTER TABLE auditoria ADD COLUMN parroquia TEXT NOT NULL DEFAULT 'montecarmelo';
CREATE INDEX auditoria_parroquia ON auditoria (parroquia, n DESC);

ALTER TABLE vivo ADD COLUMN parroquia TEXT NOT NULL DEFAULT 'montecarmelo';

-- visitantes: la misma persona puede ser invitada en varias parroquias, así que la clave pasa a (parroquia, email)
CREATE TABLE visitantes_nueva (
  parroquia TEXT NOT NULL DEFAULT 'montecarmelo',
  email TEXT NOT NULL,
  ultima TEXT NOT NULL DEFAULT '',
  datos TEXT NOT NULL,
  PRIMARY KEY (parroquia, email)
);
INSERT INTO visitantes_nueva (parroquia, email, ultima, datos) SELECT 'montecarmelo', email, ultima, datos FROM visitantes;
DROP TABLE visitantes;
ALTER TABLE visitantes_nueva RENAME TO visitantes;
CREATE INDEX visitantes_ultima ON visitantes (parroquia, ultima DESC);

-- ==================== CARGA INICIAL: MONTE CARMELO ====================

INSERT INTO parroquias (slug, datos) VALUES ('montecarmelo', json_object(
  'nombre', 'Parroquia Nuestra Señora del Monte Carmelo',
  'nombreCorto', 'Monte Carmelo',
  'lema', 'Una comunidad viva en el barrio, con cuatro capillas unidas en la fe y en el canto.',
  'descripcion', 'La Parroquia Nuestra Señora del Monte Carmelo acompaña a las familias de nuestras comunidades en la liturgia, la catequesis y la vida cotidiana. Desde este sitio los coros y directores pueden preparar y compartir lo que se cantará en las próximas misas.' || char(10) || char(10) ||
    'Aquí editamos y creamos cancioneros para los distintos momentos litúrgicos: entradas, salmos, ofertorios, comuniones y cantos propios de cada fiesta. Los audios viven en la carpeta compartida; la letra y los acordes se cuidan en el editor.',
  'correo', 'cancionerolitugico@gmail.com',
  'portada', '/Imagenes/Parroquia%20MonteCarmelo.jpeg',
  'iconos', json('{}'),
  'activa', json('true'),
  'creado', '2026-10-11T00:00:00.000Z'
));

INSERT INTO comunidades (parroquia, slug, orden, datos) VALUES
  ('montecarmelo', 'maria-de-nazaret', 1, json_object('nombre', 'Capilla María de Nazaret', 'carpetaCancioneros', 'Capilla Maria de Nazaret')),
  ('montecarmelo', 'san-pablo-apostol', 2, json_object('nombre', 'San Pablo Apóstol', 'carpetaCancioneros', 'San Pablo Apostol')),
  ('montecarmelo', 'sagrada-familia', 3, json_object('nombre', 'Sagrada Familia', 'carpetaCancioneros', 'Sagrada Familia')),
  ('montecarmelo', 'monte-carmelo', 4, json_object('nombre', 'Nuestra Señora del Monte Carmelo', 'carpetaCancioneros', 'Nuestra Señora del Monte Carmelo'));

-- Quienes tenían permisos (o estaban bloqueados) pasan a ser miembros de Monte Carmelo
INSERT INTO miembros (parroquia, email, datos)
SELECT 'montecarmelo', email, json_object(
  'rol', json_extract(datos, '$.rol'),
  'comunidad', ifnull(json_extract(datos, '$.comunidad'), ''),
  'activo', CASE WHEN json_extract(datos, '$.activo') = 0 THEN json('false') ELSE json('true') END,
  'invitado', CASE WHEN json_extract(datos, '$.invitado') = 1 THEN json('true') ELSE json('false') END,
  'invitadoPor', ifnull(json_extract(datos, '$.invitadoPor'), ''),
  'modificadoPor', ifnull(json_extract(datos, '$.modificadoPor'), ''),
  'creado', ifnull(json_extract(datos, '$.creado'), '')
)
FROM usuarios
WHERE json_extract(datos, '$.rol') IN ('admin_segundo', 'sacerdote', 'admin', 'editor', 'colaborador')
   OR json_extract(datos, '$.activo') = 0;

INSERT INTO noticias (id, parroquia, comunidad, fecha, datos) VALUES ('n-nazaret-1', 'montecarmelo', 'maria-de-nazaret', '2026-08-18', '{"id":"n-nazaret-1","titulo":"Coro María de Nazaret — integrantes","fecha":"2026-08-18","etiquetas":["coro","integrantes"],"cuerpo":"Director: por confirmar.\nIntegrantes: se irán publicando aquí.\n\nPróximo ensayo: anunciar en este espacio.","autor":"Admin Nazaret","comunidad":"maria-de-nazaret"}');
INSERT INTO noticias (id, parroquia, comunidad, fecha, datos) VALUES ('n-carmelo-1', 'montecarmelo', 'monte-carmelo', '2026-07-16', '{"id":"n-carmelo-1","titulo":"Fiesta de Nuestra Señora del Monte Carmelo","fecha":"2026-07-16","etiquetas":["fiesta","procesion"],"cuerpo":"Comunidad sede de la parroquia. Aquí publicamos el cancionero de la fiesta patronal y los encargos del coro principal.","autor":"Admin Monte Carmelo","comunidad":"monte-carmelo"}');
INSERT INTO noticias (id, parroquia, comunidad, fecha, datos) VALUES ('n-inicio', 'montecarmelo', 'parroquia', '2026-08-20', '{"id":"n-inicio","titulo":"Bienvenidos al sitio parroquial","fecha":"2026-08-20","etiquetas":["aviso"],"cuerpo":"Desde aquí compartimos noticias de la parroquia y de cada comunidad, y los cancioneros de las próximas celebraciones.\n\nLos directores de coro publican lo que se cantará; los editores actualizan avisos, cumpleaños e encargos litúrgicos.","autor":"Admin parroquial","comunidad":"parroquia"}');
INSERT INTO noticias (id, parroquia, comunidad, fecha, datos) VALUES ('n-sagrada-1', 'montecarmelo', 'sagrada-familia', '2026-08-18', '{"id":"n-sagrada-1","titulo":"Cumpleaños del coro — Sagrada Familia","fecha":"2026-08-18","etiquetas":["cumpleaños","coro"],"cuerpo":"Lista de cumpleaños de integrantes: se irá completando con los datos que envíen los editores.","autor":"Admin Sagrada Familia","comunidad":"sagrada-familia"}');
INSERT INTO noticias (id, parroquia, comunidad, fecha, datos) VALUES ('n-sanpablo-1', 'montecarmelo', 'san-pablo-apostol', '2026-08-18', '{"id":"n-sanpablo-1","titulo":"Encargos litúrgicos — San Pablo Apóstol","fecha":"2026-08-18","etiquetas":["fiesta","misa"],"cuerpo":"Publicaremos aquí las misas, procesiones y fiestas a cargo del coro de San Pablo Apóstol.","autor":"Admin San Pablo","comunidad":"san-pablo-apostol"}');
