-- Páginas propias de cada parroquia (/<parroquia>/p/<pagina>): historia, horarios, contacto…
-- datos: titulo, html (ya limpio: sin scripts ni atributos on*), enMenu, creado, actualizado, modificadoPor
CREATE TABLE paginas (
  parroquia TEXT NOT NULL,
  slug TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  datos TEXT NOT NULL,
  PRIMARY KEY (parroquia, slug)
);
