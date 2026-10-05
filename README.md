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
| `ver.html` | Muestra un cancionero guardado en el Drive (`ver.html?id=…`) |
| `js/config.js` | Dirección del Apps Script (`apiUrl`) e ID de cliente de Google (`googleClientId`) |
| `respaldo-antes-drive/` | Copia de los audios y cancioneros anteriores al Drive |

## Flujo del coro

1. Abrí el **Editor**, escribí o abrí las canciones (una por pestaña) y vinculá sus audios.
2. **☁ Guardar en Drive** → identificate, elegí comunidad y fecha.
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
  de la misa; entonces se despliegan los momentos (Entrada, Acto penitencial, Gloria, Salmo, Aleluya,
  **Post evangelio**, Ofertorio, Santo, Cordero, Comunión, Acción de gracias y Salida), cada uno con un
  **canto sugerido** (marcado «sugerida») que se cambia tocando el momento. Los momentos se **reordenan
  arrastrando** su asa ⠿ (con el mouse o el dedo; con el teclado, flechas ↑ ↓), por si el sacerdote o la
  liturgia piden otro orden.
- **▶ Atril**: abre las canciones del cancionero, en orden y en el tono elegido, en el atril del editor
  (pestaña nueva, `editor/?atril=1&misa=<id>`), incluso con cambios todavía sin guardar. No toca las
  pestañas que cada uno tenga abiertas en el editor.
- **Panel izquierdo — Biblioteca**, con dos pestañas:
  - **Canciones**: al tocar un momento, lista todas las canciones del sitio con esa etiqueta; al marcarla
    queda en el cancionero (reemplaza a la sugerida) y se muestra en el centro.
  - **Lecturas**: las lecturas del día de la misa (antífona, lecturas, salmo, evangelio y oraciones),
    tomadas de [eucaristiadiaria.cl](https://www.eucaristiadiaria.cl/) (Área de Liturgia del Arzobispado
    de Santiago). Se publican mes a mes: para fechas más lejanas la pestaña avisa que todavía no están.
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
    completa después en el editor: al guardar en el Drive una canción con el mismo título, queda unida a
    sus audios.

En el Drive: `MonteCarmelo/Biblioteca/` (canciones y audios + `biblioteca.json`), `MonteCarmelo/misas.json`
(público), `MonteCarmelo/Lecturas/<fecha>.json` (lecturas ya leídas) y en `MonteCarmelo/sistema/` los
archivos privados `coros.json` y `ensayos.json`.

### Cantos sugeridos

Para cada momento se elige, entre las canciones de la Biblioteca con esa etiqueta, la de mayor puntaje:

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
  `<canción>-<voz>-<fecha>.webm`.
- Se convierten a **WebM (Opus)** en el propio navegador antes de subirse (una canción de 4 minutos queda
  en unos 3 MB). Sirven mp3, m4a, wav, ogg y el audio de un video. Si el equipo no puede convertir
  (Safari viejo), se sube el archivo original y se avisa. Máximo 30 MB por audio ya convertido.
- **Grabar con el micrófono**: la toma se escucha antes de subirla y también queda en WebM.
- Cada audio queda **vinculado al `.md`** de su canción: se agrega al índice (`biblioteca.json`) y se
  escribe en el `.md` la misma etiqueta que usa el editor,
  `<audio controls src="https://drive.google.com/uc?export=download&id=…" title="…" data-voz="…"></audio>`.
  Al quitar un audio se borra la etiqueta, y si ninguna otra canción lo usa el archivo va a la papelera.
- **Arrastrar y soltar**: en la computadora se sueltan los archivos en el diálogo (o en cualquier parte
  de la pantalla Misas, que lo abre). En el celular se toca la zona y se eligen desde Archivos, Drive o
  la grabadora; en Android y iPad también se puede arrastrar desde la pantalla dividida.
- `js/audio-webm.js` hace la conversión con WebCodecs y `js/vendor/webm-muxer.mjs` (MIT) arma el WebM.
