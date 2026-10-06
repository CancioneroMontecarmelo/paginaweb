# Sitio Parroquia Nuestra Señora del Monte Carmelo

Sitio estático (GitHub Pages): noticias por comunidad y cancioneros litúrgicos hechos con el editor
**Cancionero Universal** (`editor/`). Los cancioneros, los usuarios y el registro de entradas se guardan
en el Google Drive de `cancionerolitugico@gmail.com` a través de un Apps Script (`backend/Code.gs`).

- Página publicada: <https://cancioneromontecarmelo.github.io/paginaweb/>
- Cada `git push` a `main` vuelve a publicar la página en 1–2 minutos.

## Autenticación (Identificarse)

Sin claves:

- **Entrar con Google:** el Apps Script verifica la cuenta con Google. `cancionerolitugico@gmail.com` es
  siempre el **administrador general**; cualquier otra cuenta entra como visitante hasta que le den permisos.
- **Visitante:** también se puede entrar escribiendo solo el correo (sin verificar): nunca da privilegios.
- **Administradores y permisos** (panel de Identificarse): lista de quienes entraron, con un check para darles
  privilegios (responsable del sitio, sacerdote, administrador de comunidad, editor o colaborador) y la
  comunidad; desde ahí también se invita por correo o WhatsApp.
- La sesión se renueva sola mientras se usa el sitio (también al volver del reposo) y solo vence tras
  90 días sin usarlo. Si vence mientras se guarda algo, aparece «Entrar con Google» encima y el guardado
  se completa sin perder nada. Cada entrada queda en el registro del panel.

Los usuarios viven en `MonteCarmelo/sistema/usuarios.json` del Drive (privado).

### ID de cliente de Google (una sola vez)

En <https://console.cloud.google.com/auth/clients> (proyecto de la cuenta de la parroquia): **Crear cliente** →
«Aplicación web» → Orígenes autorizados de JavaScript: `https://cancioneromontecarmelo.github.io` y
`http://localhost:8080`. El ID (`….apps.googleusercontent.com`) va en `GOOGLE_CLIENT_ID` (`backend/Code.gs`) y
en `googleClientId` (`js/config.js`). En «Público», la app tiene que estar **publicada** (en producción) para que
entre cualquier cuenta de Google.

## Cómo probar en local

```bash
python3 -m http.server 8080
```

Abrí [http://localhost:8080/](http://localhost:8080/).

## Conectar el Drive de la parroquia (Apps Script)

Todo se hace con la cuenta **cancionerolitugico@gmail.com**.

### Opción A — desde la terminal con clasp (recomendada)

1. Activá la API de Apps Script: <https://script.google.com/home/usersettings> → «API de Google Apps Script» → Activada.
2. Iniciá sesión (abre el navegador; elegí cancionerolitugico@gmail.com):
   ```bash
   clasp login
   ```
3. Creá el proyecto y subí el código (desde la raíz del sitio):
   ```bash
   clasp create-script --type standalone --title "Monte Carmelo API" --rootDir backend
   git checkout backend/appsscript.json   # clasp puede reemplazarlo por el de Google
   clasp push -f
   ```
4. Autorizá Drive, correo y la verificación de Google (una vez, y otra si cambian los permisos de `appsscript.json`): `clasp open-script` → elegí la función `prepararPrimeraVez` → **Ejecutar** → aceptá los permisos
   (si dice «Google no verificó esta app»: Configuración avanzada → Ir a Monte Carmelo API).
5. Publicá la aplicación web:
   ```bash
   clasp create-deployment -d "v1"
   ```
   La dirección es `https://script.google.com/macros/s/<ID de la implementación>/exec`.
6. Pegala en `js/config.js` (`apiUrl`), hacé commit y `git push`.

Para subir cambios de `Code.gs` más tarde sin cambiar la dirección:

```bash
clasp push -f
clasp update-deployment <ID de la implementación> -d "descripción"
```

### Opción B — a mano en script.google.com

1. <https://script.google.com> → Nuevo proyecto → pegá el contenido de `backend/Code.gs`.
2. Configuración del proyecto → «Mostrar el archivo de manifiesto appsscript.json» → pegá `backend/appsscript.json`.
3. Ejecutá `prepararPrimeraVez` y aceptá los permisos.
4. Implementar → Nueva implementación → Aplicación web · Ejecutar como: **Yo** · Acceso: **Cualquier usuario**.
5. Copiá la URL `/exec` en `js/config.js` (`apiUrl`), commit y `git push`.

## Carpetas

| Carpeta / archivo | Uso |
|---------|-----|
| `editor/` | Cancionero Universal: editor, atril, Guardar/Abrir en el Drive (`editor/js/nube.js`) |
| `backend/` | Apps Script: entrada con Google, permisos, auditoría y cancioneros en Drive |
| `comunidades/` | Página de cada comunidad: noticias y cancioneros publicados |
| `noticias/` | Blog estático por comunidad (JSON) |
| `misas.html` | Pantalla Misas: cancioneros de misa de todas las comunidades, Biblioteca de canciones, coros y ensayos |
| `reproductor.html` + `js/reproductor.js` | Reproductor: canciones con su letra, listas, cancioneros de misa y En vivo para el coro |
| `js/posturas.js`, `js/partituras.js`, `js/voces.js` | Posturas al tocar un acorde, partituras y el mezclador «Aprender las voces» (Misas y reproductor) |
| `inicio.html` + `js/inicio.js` | Inicio: actividades, calendario litúrgico, próximo domingo, libro de visitas y Colaborar |
| `js/liturgia.js` | Calendario litúrgico y cantos sugeridos (común a Misas e Inicio) |
| `ver.html` | Muestra un cancionero guardado en el Drive (`ver.html?id=…`) |
| `js/config.js` | Dirección del Apps Script (`apiUrl`) e ID de cliente de Google (`googleClientId`) |
| `scripts/video-a-webm.py` | Comando: audio de videos o enlaces a AAC (.m4a) y subida a la Biblioteca |
| `scripts/subir-canciones.py` | Aplicación de escritorio: sube las canciones `.md` locales a la Biblioteca (`scripts/instalar-escritorio.sh` la pone en el menú) |
| `respaldo-antes-drive/` | Copia de los audios y cancioneros anteriores al Drive |

## Inicio (`inicio.html`)

- **Marquesina de actividades** debajo de los botones: fecha, hora, comunidad, título y una descripción
  breve, pasando como un teleprompter (se detiene con el mouse encima; con «reducir movimiento» queda
  quieta y se desliza a mano). Quien puede editar en una comunidad ve **+ Actividad** para publicar,
  cambiar o quitar las suyas (las de toda la parroquia, los responsables y sacerdotes). Se guardan en
  `MonteCarmelo/actividades.json`.
- **Calendario litúrgico**: el día de hoy con su celebración, tiempo, semana, color y santoral (la
  memoria o fiesta que nombra el título de las lecturas; si no hay, «Feria»), y los próximos 7 días
  (tocar uno lo muestra arriba). Sale de las lecturas de eucaristiadiaria.cl (GET `calendario`, con la
  misma caché que las lecturas); si un día todavía no está publicado, el tiempo y el color se calculan.
- **Próximo domingo**, para las cuatro comunidades: si ya hay cancionero para esa fecha se muestran sus
  cantos y el enlace; si no, la **sugerencia automática** (las mismas reglas de Misas) y **Armarlo en
  Misas**, que abre `misas.html?comunidad=…&nuevo=<fecha>` con el cancionero nuevo ya preparado.
- **Libro de visitas**: otras parroquias y personas dejan nombre, parroquia o comunidad, ciudad y país,
  un mensaje y si quieren **colaborar con temas nuevos** (con correo opcional, que no se publica; a la
  parroquia le llega un aviso). Sin cuenta: lo protegen un campo trampa, largos máximos y un máximo de
  firmas por minuto. Los responsables pueden ocultar mensajes (en Inicio o en Identificarse).
- **Colaborar**: el mismo formulario del editor («Ayúdanos a seguir trabajando»), que llega al correo
  de la parroquia por FormSubmit.
- **Visitantes externos**: las cuentas sin privilegios que entran (con Google o solo con el correo)
  quedan anotadas con su primera y última visita y cuántas veces entraron; se ven en Identificarse, en
  el panel de responsables, junto con todos los mensajes del libro.

En el Drive: `MonteCarmelo/actividades.json` (público), `MonteCarmelo/sistema/libro.json` y
`MonteCarmelo/sistema/visitantes.json` (privados).

## Editor: menú Archivo

- **Nuevo** ▸ Canción · Cancionero.
- **Abrir** ▸ Canción de la Biblioteca de la parroquia (buscador por título, etiqueta o frase de la letra,
  igual que en Misas; marca las que tienen **solo audio** para escribirles la letra) o de este equipo · Cancionero del Drive, de este
  equipo o de la colección.
- **Guardar** es siempre en el Drive de la parroquia: **Guardar canción en la Biblioteca** (Ctrl+S) sube
  sus audios del equipo convertidos a AAC (.m4a) y la deja en la Biblioteca; si ya había una canción con el
  mismo título subida solo con su audio, quedan unidas. **Guardar cancionero en el Drive…** (Ctrl+Alt+S).
- **Guardar como (en este equipo)** ▸ Canción `.md` (Ctrl+Mayús+S) · Cancionero `.m3u8`.
- **Compartir** ▸ por WhatsApp o por correo con el vínculo a su página (`ver.html`); si el cancionero
  todavía no está en el Drive, ofrece guardarlo o enviar el archivo.
- **Exportar** ▸ PowerPoint, Word, ODT, HTML, Markdown y texto. **Imprimir** ▸ canción, cancionero o tríptico.

### Tríptico

Hoja apaisada en tres paneles, en orden de lectura: **cara 1 = paneles 1-2-3** y, al dar vuelta la hoja,
**cara 2 = 4-5-6** (impresión a doble cara girando por el borde corto). Va **una canción por panel**, todas
con la misma letra: la más grande con la que la canción más larga cabe en su panel. Si una no cabe ni con
la letra mínima, sigue en el panel siguiente y se avisa. Seis canciones por hoja: la séptima abre la hoja 2.
**Hojas**: 1, 2 o «Las necesarias». La portada (título, subtítulo e índice) es opcional y ocupa el panel 1.

## Flujo del coro

1. Abrí el **Editor**, escribí o abrí las canciones (una por pestaña) y vinculá sus audios.
2. **Archivo → Guardar cancionero en el Drive** → identificate, elegí comunidad y fecha.
3. Se guarda en `MonteCarmelo/Cancioneros/<Comunidad>/<fecha>_<nombre>/` (canciones `.md`, lista `.m3u8`,
   audios y una página `.html` con los audios adentro) y aparece en la página de la comunidad.
4. Desde la página de la comunidad: **Ver** (para todos) o **Editar** (para quien tenga permiso).

## Pantalla Misas (`misas.html`)

Una sola pantalla para todas las comunidades (se elige arriba). Cualquiera puede mirar; para crear o
modificar hace falta entrar con Google con permiso de editor o superior en esa comunidad.

- **Centro**: la canción elegida con sus acordes y audios. Arriba, el **trasponedor** (el tono queda
  guardado en el cancionero).
- **Panel derecho — Cancioneros**: los cancioneros de misa ya creados (nombre, fecha, tiempo litúrgico) y
  sus momentos (Entrada, Gloria, Santo…). **+ Agregar nuevo** pide primero el nombre y después la fecha
  de la misa. Si el nombre trae una fecha («Misa 18 de octubre», «18/10», «2026-10-18»), se usa esa; si
  después se elige otra, avisa con un botón para volver a la del nombre. Debajo, un **buscador de fechas**:
  la lista de los próximos domingos y fiestas (con su ciclo) y, al escribir, busca la celebración
  («cristo rey», «ramos», «XXIX domingo») o la fecha («18 de octubre») en el próximo año. Entonces se despliegan los momentos (Entrada, Acto penitencial, Gloria, Salmo, Aleluya,
  **Post evangelio**, Ofertorio, Santo, Cordero, Comunión, Acción de gracias y Salida), cada uno con un
  **canto sugerido** (marcado «sugerida») que se cambia tocando el momento. Los momentos se **reordenan
  arrastrando** su asa ⠿ (con el mouse o el dedo; con el teclado, flechas ↑ ↓), por si el sacerdote o la
  liturgia piden otro orden.
- **▶ Atril**: abre las canciones del cancionero, en orden y en el tono elegido, en el atril del editor
  (pestaña nueva, `editor/?atril=1&misa=<id>`), incluso con cambios todavía sin guardar. No toca las
  pestañas que cada uno tenga abiertas en el editor.
- **Cancionero activo**: el que está abierto en Misas. En el editor, el botón **🎼 Atril** ofrece abrirlo
  («Abrir … (activo en Misas)» o «Seguir con las pestañas abiertas»); si después cambia en Misas, el
  editor avisa con **Actualizar**. Se comunica por `localStorage` (`mc-activo`), en el mismo navegador.
- **Panel izquierdo — Biblioteca**, con dos pestañas:
  - **Canciones**: al tocar un momento, lista primero las canciones con esa etiqueta y después, en otro
    grupo, las que no la tienen pero cuyo título o letra la sugieren (el nombre del momento, sus sinónimos
    o palabras típicas: «santo santo», «hosanna», «pan de vida», «cordero de dios»…), con el motivo
    («Por el título» / «Su letra dice …»). Al marcarla queda en el cancionero (reemplaza a la sugerida) y
    se muestra en el centro.
  - **Buscar**: por título, etiqueta o cualquier frase de la letra (la primera estrofa y el comienzo de
    las demás), sin distinguir mayúsculas ni tildes y tolerando faltas comunes («habre tu corason»,
    «kordero de dioz», «resusito»); en frases largas perdona una palabra de cada cuatro. Muestra la línea
    donde coincidió, marcada. Lo hace `editor/js/buscar.js`, con el campo `inicio` que el Apps Script
    guarda en `biblioteca.json` (lo completa solo para las canciones que no lo tienen).
  - **Lecturas**: las lecturas del día de la misa (antífona, lecturas, salmo, evangelio y oraciones),
    tomadas de [eucaristiadiaria.cl](https://www.eucaristiadiaria.cl/) (Área de Liturgia del Arzobispado
    de Santiago). Se publican mes a mes: para fechas más lejanas la pestaña avisa que todavía no están.
    Quien puede editar el cancionero puede **tomarlas de otro día** (no cambia la fecha de la misa) o
    **corregir el texto** (o escribirlo si todavía no está publicado); se guardan con el cancionero, en
    `MonteCarmelo/Lecturas/misa-<id>.json`, y también se usan para los cantos sugeridos. **Volver a las
    del día de la misa** deshace las dos cosas.
- **Publicar** (al final del cancionero): lo guarda de inmediato en la web y arma su página `.html` en el
  Drive, como **Guardar en Drive** del editor: aparece en la página de la comunidad y quedan los enlaces
  para verla, compartirla y **editarla en el editor**. Publicar de nuevo reemplaza la misma página.
- **Guardar** («Fechas y ensayos…»): nombre, fecha de uso, tiempo litúrgico, coro, fechas posibles de
  ensayo y ensayos realizados con quiénes asistieron.
- **Coro**: nombre del coro e integrantes (comunidad, fecha de incorporación, voz, instrumentos,
  lectura de partitura, nivel).
- **Canciones y audios**: agrega canciones `.md` nuevas con sus audios, o audios a una canción que ya
  está en la Biblioteca (también con el botón **+ Audio** debajo de la canción del centro). También se
  agregan solas las canciones de cada cancionero guardado desde el editor.
  - **Solo audios** (sin `.md`): cada audio dice a qué canción va (se propone el título de sus etiquetas
    o del nombre del archivo; los de igual título van juntos). Si esa canción ya está en la Biblioteca, el
    audio se le suma sin tocar su letra; si no, se crea. Los MP3 trabajados en **Editag** traen la letra
    con acordes (`TXXX` «MP3EDITAG», antes «CIC»), el título, el artista y los momentos y tiempos
    litúrgicos (`TXXX` «LITURGICAL_MOMENTS» / «LITURGICAL_SEASONS», y `TCON`): todo eso pasa al `.md`
    (`js/etiquetas-audio.js`). Sin etiquetas, la canción queda solo con su título y audio; la letra se
    completa después en el editor (**Archivo → Abrir → De la Biblioteca** y **Guardar canción en la Biblioteca**): queda unida a
    sus audios.

En el Drive: `MonteCarmelo/Biblioteca/` (canciones y audios + `biblioteca.json`), `MonteCarmelo/misas.json`
(público), `MonteCarmelo/Lecturas/<fecha>.json` (lecturas ya leídas) y en `MonteCarmelo/sistema/` los
archivos privados `coros.json` y `ensayos.json`.

### Cantos sugeridos

Para cada momento se elige, entre las canciones de la Biblioteca con esa etiqueta (si no hay ninguna,
entre las que lo sugieren por el título o la letra), la de mayor puntaje:

- +5 si tiene la etiqueta del tiempo litúrgico de la fecha (+3 si es de un tiempo cercano: Cuaresma en
  Semana Santa, Pascua en Pentecostés…) y −4 si es de otro tiempo (un canto de Adviento en Tiempo ordinario).
- +6 si coincide con la solemnidad o fiesta del día (Cristo Rey, Asunción, Virgen del Carmen…) y +4 a los
  cantos marianos en las fiestas de la Virgen.
- −3 si la comunidad lo usó en sus últimos 3 cancioneros, para no repetir siempre los mismos.
- Hasta +3 por palabras del título o las etiquetas que aparecen en las lecturas del día.
- En Cuaresma no se sugieren cantos con «aleluya», y en Adviento y Cuaresma el cancionero se arma sin Gloria (salvo en las solemnidades).

El tiempo litúrgico sale del título de las lecturas o, si todavía no están, de la fecha (calculada desde
la Pascua; en Chile la Epifanía y la Ascensión van en domingo). **Volver a sugerir** cambia solo los
momentos que siguen con la sugerencia o vacíos; lo elegido a mano no se toca. Al publicar, las sugeridas
quedan como elegidas.

### Audios de la Biblioteca

- Quedan en el Drive de la parroquia, en `MonteCarmelo/Biblioteca/audios`, con nombres ordenados
  `<canción>-<voz>-<fecha>.m4a`.
- Formato: **AAC-LC en .m4a** (48 kHz, 96 kbps estéreo o 64 kbps mono, índice al principio para que
  empiece a sonar enseguida, con título y artista). Es el único formato compacto que suena en todos los
  equipos: iPhone y Mac (también los viejos), Android, PC y cualquier reproductor externo. Una canción de
  4 minutos queda en unos 3 MB.
- Todo se convierte **antes de subir**: en Misas y en el editor, en el propio navegador; en la
  aplicación de escritorio y en `video-a-webm.py`, con `ffmpeg`. Sirven mp3, m4a, wav, ogg, webm y el
  audio de un video. Los `.m4a` se suben tal cual; si el equipo no puede convertir, un MP3 se sube
  original y se avisa. Máximo 30 MB por audio ya convertido.
- **Grabar con el micrófono**: la toma se escucha antes de subirla y también queda en .m4a.
- Cada audio queda **vinculado al `.md`** de su canción: se agrega al índice (`biblioteca.json`) y se
  escribe en el `.md` la misma etiqueta que usa el editor,
  `<audio controls src="https://drive.google.com/uc?export=download&id=…" title="…" data-voz="…"></audio>`.
  Al quitar un audio se borra la etiqueta, y si ninguna otra canción lo usa el archivo va a la papelera.
- **Arrastrar y soltar**: en la computadora se sueltan los archivos en el diálogo (o en cualquier parte
  de la pantalla Misas, que lo abre). En el celular se toca la zona y se eligen desde Archivos, Drive o
  la grabadora; en Android y iPad también se puede arrastrar desde la pantalla dividida.
- `js/audio-aac.js` hace la conversión: con WebCodecs y `js/vendor/mp4-muxer.mjs` (MIT) donde el
  navegador codifica AAC (Safari, Chrome en Mac/Windows/Android) y, si no, con ffmpeg.wasm
  (`js/vendor/ffmpeg/`, MIT; el núcleo de 32 MB se baja de jsDelivr solo la primera vez). Cada resultado
  se comprueba (cabecera MP4, canales y duración) antes de subirlo.
- Si el Drive no entrega el audio directo, Misas y las páginas `.html` exportadas lo piden al servidor de
  la parroquia y lo reproducen dentro de la página: el celular ya no pregunta con qué app abrirlo.
- **Pasar a .m4a los audios viejos** (solo el **administrador general**, en **Identificarse → Audios de
  la Biblioteca**; los demás no lo ven): cuenta los audios que siguen en WebM u otro formato y los
  convierte uno por uno en ese navegador, reemplazando el contenido del **mismo archivo** de Drive (el
  enlace no cambia, así que `biblioteca.json`, los `.md` y los cancioneros publicados siguen funcionando;
  Drive guarda la versión anterior 30 días). Se puede **Pausar** y **Seguir**, o cerrar y continuar otro
  día; los que fallan quedan listados con **Reintentar**. Conviene dejarlo en una computadora enchufada:
  con ffmpeg.wasm tarda unos segundos por audio. Lo hace `js/convertir-audios.js` con las acciones
  `audiosAConvertir`, `leerAudioAConvertir` y `reemplazarAudio` del Apps Script (usa el servicio avanzado
  de Drive).

### Créditos (letra y música)

- Cada canción puede decir quién escribió la letra y quién la música: en el `.md` son `letra-de:` y
  `musica-de:` en la cabecera. En el editor se cargan con el botón **Créditos** junto al título (o el
  menú del título → **Créditos (letra y música)…**).
- Se muestran bajo el título como «Letra: … · Música: …» (o «Letra y música: …» si es la misma persona)
  en el atril, en Misas, en las páginas `.html` exportadas y en el reproductor.
- El Apps Script los guarda también en `biblioteca.json` (`letraDe`, `musicaDe`), así el **buscador**
  encuentra las canciones por autor («gumucio»).
- Los MP3 de Editag con compositor (`TCOM`) y letrista (`TEXT`) los traen solos al subirlos como audio.

### Posturas al tocar un acorde

- En Misas y en el reproductor, tocar un acorde de la canción abre una ventanita con cómo se toca:
  el diagrama, las flechas ◀ ▶ para ver otras posturas y el instrumento (guitarra, ukelele, charango o
  mandolina; se recuerda en el equipo). Usa las mismas posturas que el editor (`js/posturas.js`).
- Las páginas `.html` exportadas o publicadas también lo hacen, sin internet: al exportar se calcula la
  postura de guitarra de cada acorde en los 12 tonos y en las dos notaciones, y se guarda solo como
  trastes y dedos (unos 20 bytes por acorde). Siguen el tono que se elija en la página.

### Partituras

- Debajo de la canción, en Misas, los botones **𝄞 Partitura · Soprano**… abren la partitura dentro de la
  página, con la vista previa de Drive (el celular no pregunta con qué app abrirla), y **Descargar**.
- Quien puede editar la canción tiene **+ Partitura**: sube un PDF o una foto PNG o JPG (hasta 15 MB),
  elige la voz, y desde el mismo diálogo puede **Quitar** las que ya tiene.
- Quedan en `MonteCarmelo/Biblioteca/partituras`, visibles con el enlace, y en `biblioteca.json`
  (`partituras: [{fileId, nombre, voz, mime}]`); volver a guardar la canción desde el editor las conserva.
  Acciones del Apps Script: `subirPartitura` y `quitarPartitura`.
- Las páginas `.html` de los cancioneros y el reproductor tienen el enlace **Partitura**.

### Aprender las voces

- En canciones con audios de dos o más voces distintas (soprano, contralto, tenor, bajo…), el botón
  **🎚 Aprender las voces** abre un mezclador: todas las voces suenan juntas, exactamente sincronizadas,
  con reproducir/pausa y barra de avance comunes.
- Por voz: volumen, **Silenciar** y **Solo**. Los botones **Mi voz: …** dejan esa voz al 100 % y las demás
  bajas, como guía; la elección queda recordada en el equipo (y el reproductor elige esa voz primero).
- Baja cada voz por el respaldo del servidor (`accion=audio`) y las mezcla con Web Audio (`js/voces.js`).
- Las voces quedan alineadas solo si sus audios **empiezan en el mismo compás**, como las pistas de un
  mismo arreglo. Grabaciones sueltas, cada una con su propia entrada, se desfasan.
- La voz **Contralto** (también se escribe `[Voz: Alto]`) se suma a las del editor.

### Aplicación de escritorio: subir canciones a la Biblioteca (`scripts/subir-canciones.py`)

Ventana para Linux Mint que busca las canciones `.md` que el editor guardó en la computadora (por
defecto `~/Música/desde Cancionero on line`, con sus subcarpetas) y orienta para subirlas a la Biblioteca
de la parroquia (Drive de cancionerolitugico@gmail.com):

- Cada canción muestra su estado frente a la Biblioteca y qué conviene hacer: **Nueva** (subirla),
  **Está solo con audio** (se le agrega la letra), **Cambiada aquí** (modificada después de la última
  subida: se reemplaza, conservando sus audios) o **Título repetido** (dos archivos con el mismo título;
  hay que cambiar uno en el editor). Las nuevas y cambiadas vienen marcadas; **Seleccionar todas** y
  **Desmarcar todas** cambian la selección. Las que ya están en la Biblioteca no se muestran (el resumen
  las cuenta) y cada canción sale de la lista apenas termina de subirse.
- Al subir, los audios de la computadora se convierten a AAC (.m4a) y se suben; los videos (YouTube…) también,
  si se deja marcada la opción (si no, quedan como enlace); los enlaces a mp3 quedan como enlace. Un audio
  que ya estaba en la canción no se vuelve a subir. Usa la misma clave que `video-a-webm.py`
  (**Pegar la clave…**, con la guía para conseguirla en Identificarse).
- Los cancioneros (`.m3u8`) se siguen subiendo desde el editor (Archivo → Guardar cancionero en el Drive).

**Instalar en el menú** (una vez, sin sudo): `scripts/instalar-escritorio.sh`. Queda en **Sonido y video**
y en **Abrir con** al hacer clic derecho en un `.md` (abre su carpeta con esa canción marcada).
`--quitar` lo saca. Necesita `python3-gi`, `gir1.2-gtk-3.0` y `ffmpeg` (el instalador avisa si faltan).
La lógica común con `video-a-webm.py` está en `scripts/mc_biblioteca.py`.

### Convertir videos a .m4a (`scripts/video-a-webm.py`)

Comando para la computadora (conserva el nombre de antes): saca el audio de **archivos de video** (mp4,
mkv, mov…) o de **enlaces** (YouTube, Vimeo, TikTok…), lo deja en AAC .m4a (48 kHz, 96 kbps estéreo o
64 kbps mono, como el navegador) y lo **sube a la Biblioteca** con título, etiquetas, letra y voz.

```bash
scripts/video-a-webm.py https://youtu.be/XXXX --cancion "Santo Fones" --etiquetas "Santo, Tiempo ordinario"
scripts/video-a-webm.py soprano.mp4 tenor.mp4 --cancion "Gloria" --voz soprano --voz tenor --letra gloria.txt
scripts/video-a-webm.py ensayo.mov --sin-subir --salida ~/Música/m4a      # solo convertir
```

- **Necesita** Python 3 y `ffmpeg` (`sudo apt install ffmpeg`). Para los enlaces usa `yt-dlp`; si el de
  la distribución está viejo y YouTube lo rechaza, el script baja y usa su propia copia al día
  (`~/.local/share/montecarmelo/yt-dlp`).
- **Clave**: la primera vez la pide. Se copia en el sitio, **Identificarse → Copiar clave para el script**
  (la misma sesión, dura 90 días y da tus mismos permisos), y queda en `~/.config/montecarmelo/sesion.json`.
  `--olvidar-clave` la borra.
- Con `--cancion`, todos los videos son audios de esa canción (`--voz` y `--nombre` se repiten, uno por
  video y en orden). Sin `--cancion`, cada video es una canción con el título del video o del archivo.
- `--letra`: `.txt` con acordes sobre la letra, ChordPro (`[Do]Noche de [Sol]paz`) o un `.md` del editor.
  `--etiquetas` se escriben como en el editor (`entrada` → «Entrada»). También `--tono`, `--autor` y
  `--comunidad` (dueña de la canción nueva; por defecto la tuya).
- Si la canción **ya está en la Biblioteca** (mismo título), el audio se le suma y las etiquetas nuevas se
  agregan a las que tenía. Su letra solo se reemplaza con `--letra`, y si ya tenía letra pregunta antes
  (`--si` responde que sí).
- Siempre deja en `--salida` (por defecto, la carpeta actual) el `.m4a` y el `.md` de la canción, que se
  pueden abrir en el editor o subir después desde **Misas → Canciones y audios**. Máximo 30 MB por audio.

## Reproductor (`reproductor.html`)

Escuchar las canciones de la Biblioteca con su letra, en el celular o en la computadora, sin iniciar
sesión. Oscuro por defecto (☀︎ lo pasa a modo día). Lo hace `js/reproductor.js` con los mismos scripts
del editor que usa Misas; todo son lecturas públicas del Apps Script.

- **Canciones**: el buscador de la Biblioteca (título, frase de la letra, autor o etiqueta) y **Solo con
  audio**. Tocar una canción la hace sonar; la cola es la lista que se está viendo. **+** la agrega a una
  lista.
- **Listas**:
  - **Mis listas**, guardadas en el equipo (`localStorage` `mc-listas`): crear, renombrar, ordenar con
    ↑ ↓, quitar canciones y borrar. **WhatsApp** y **Copiar enlace** las comparten con un enlace
    `reproductor.html#l=…` que lleva la lista adentro; quien lo abre la escucha enseguida y puede
    **Guardar en mis listas**.
  - **Cancioneros de misa**, por comunidad y del más reciente al más antiguo:
    `reproductor.html#misa=<id>` los reproduce con sus momentos y en el tono elegido. En Misas, el botón
    **♪ Reproducir** del cancionero abre esa dirección (incluso con cambios todavía sin guardar).
- **Reproduciendo**: el momento, la letra con acordes (o **Solo letra**), **A− / A+**, los créditos, las
  posturas al tocar un acorde, **Partitura** y **Aprender las voces**. Si la canción tiene varios audios,
  un selector de voz. Abajo, una barra mínima: anterior, reproducir/pausa, siguiente y avance.
- Primero prueba el enlace directo de Drive y, si falla, el respaldo `accion=audio`. Precarga la canción
  siguiente; las canciones sin audio no se saltan solas, para poder cantarlas.
- En el celular: controles en la pantalla bloqueada y en los auriculares (Media Session) y la pantalla no
  se apaga mientras se lee la letra (Wake Lock, donde exista).

### En vivo (para el coro)

- Quien dirige el canto abre el cancionero en Misas y toca **📡 En vivo**. Aparece una franja con un
  **código de 4 cifras**, **WhatsApp**, **Copiar enlace** y **Terminar**.
- El coro abre `reproductor.html#vivo=<código>` (o **En vivo** en el reproductor, escribiendo el código):
  la pantalla muestra la canción que quien dirige va eligiendo, en su tono, y vuelve arriba al cambiar
  de canción. Cada uno elige **Solo letra** o **Letra y acordes**.
- Cada vez que se elige una canción o se cambia el tono en Misas se envía `moverVivo` (si se cambia
  varias veces seguidas, solo lo último). Los celulares consultan cada 4 segundos, con un pequeño desfase
  al azar, y dejan de consultar con la pantalla apagada o en otra app. Al **Terminar**, les aparece
  «Terminó».
- El estado vive en el `CacheService` del Apps Script (sin tocar el Drive) y dura 6 horas; tocar
  **En vivo** de nuevo reutiliza el mismo código. Acciones: `iniciarVivo`, `moverVivo`, `terminarVivo` y
  el GET público `accion=vivo&codigo=…`. Con 40 a 60 celulares son unas 15 consultas por segundo, dentro
  de lo que aguanta el Apps Script gratuito.
