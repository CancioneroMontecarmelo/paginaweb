-- Créditos de los cantos propios de la parroquia: «Gloria pal Monte» y «Cordero Solemne» (letra y música de
-- Marcos Mora Vitta), en las copias de Monte Carmelo y de María de Nazaret. Solo la cabecera del .md: la letra no
-- se toca. Después hay que borrar cache/biblioteca.json en R2 para que la Biblioteca se vuelva a armar.
UPDATE canciones SET
  datos = json_set(datos, '$.letraDe', 'Marcos Mora Vitta', '$.musicaDe', 'Marcos Mora Vitta'),
  md = CASE
    WHEN instr(md, 'letra-de:') > 0 THEN md
    WHEN substr(md, 1, 4) = '---' || char(10)
      THEN '---' || char(10) || 'letra-de: "Marcos Mora Vitta"' || char(10) || 'musica-de: "Marcos Mora Vitta"' || char(10) || substr(md, 5)
    WHEN substr(md, 1, 5) = '---' || char(13) || char(10)
      THEN '---' || char(13) || char(10) || 'letra-de: "Marcos Mora Vitta"' || char(13) || char(10) || 'musica-de: "Marcos Mora Vitta"' || char(13) || char(10) || substr(md, 6)
    ELSE '---' || char(10) || 'letra-de: "Marcos Mora Vitta"' || char(10) || 'musica-de: "Marcos Mora Vitta"' || char(10) || '---' || char(10) || md
  END
WHERE id IN ('c-gloria-pal-monte', 'c-gloria-gloria-pal-monte', 'c-cordero-solemne', 'c-cordero-de-dios-cordero-solemne');
