# Sitio Parroquia Nuestra Señora del Monte Carmelo

Sitio en **Cloudflare Pages** (cuenta `cancionerolitugico@gmail.com`): noticias por comunidad, la pantalla
Misas, el reproductor y los cancioneros litúrgicos hechos con el editor **Cancionero Universal** (`editor/`).
El servidor de la parroquia es `/api` en el mismo sitio (Pages Functions, código en `servidor/`): los datos
viven en una base **D1** y los archivos (audios, partituras, cancioneros publicados) en **R2**.

- Página publicada: <https://cancioneroliturgico.cl/> (`www.` lleva a la dirección sin www).
- Las direcciones anteriores (<https://montecarmelo-kxg.pages.dev/> y
  <https://cancioneromontecarmelo.github.io/paginaweb/>) llevan solas a la misma página del dominio, con lo
  que el navegador tenía guardado (sesión, listas, preferencias). `/api` sigue respondiendo también en
  pages.dev: hay canciones con enlaces de audio a esa dirección. Las vistas previas no se redirigen.
- Dominio registrado en NIC Chile; sus servidores DNS son los de Cloudflare (`rosalyn` y `zac`
  `.ns.cloudflare.com`). En Pages, el proyecto tiene como dominios propios `cancioneroliturgico.cl` y
  `www.cancioneroliturgico.cl`.
- Cada `git push` a `main` vuelve a publicar el sitio en 1–2 minutos.

## Autenticación (Identificarse)

Sin claves:

- **Entrar con Google:** el servidor verifica la cuenta con Google. `cancionerolitugico@gmail.com` es
  siempre el **administrador general**; cualquier otra cuenta entra como visitante hasta que le den permisos.
- **Visitante:** también se puede entrar escribiendo solo el correo (sin verificar): nunca da privilegios.
- **Administradores y permisos** (panel de Identificarse): lista de quienes entraron, con un check para darles
  privilegios (responsable del sitio, sacerdote, administrador de comunidad, editor o colaborador) y la
  comunidad; desde ahí también se invita: **WhatsApp** o **Copiar invitación** (el sitio no manda correos).
- La sesión se renueva sola mientras se usa el sitio (también al volver del reposo) y solo vence tras
  90 días sin usarlo. Si vence mientras se guarda algo, aparece «Entrar con Google» encima y el guardado
  se completa sin perder nada. Cada entrada queda en el registro del panel.
- La sesión es un token firmado con el secreto `SECRETO` (el mismo que tenía el Apps Script, así las
  sesiones y las claves de los scripts siguieron valiendo después de la mudanza).

Los usuarios viven en la tabla `usuarios` de D1 (privada).

### ID de cliente de Google (una sola vez)

En <https://console.cloud.google.com/auth/clients> (proyecto de la cuenta de la parroquia), el cliente
«Aplicación web» tiene que tener en **Orígenes autorizados de JavaScript**: `https://cancioneroliturgico.cl`,
`https://www.cancioneroliturgico.cl`, `https://montecarmelo-kxg.pages.dev`, `http://localhost:8788` y `http://127.0.0.1:8788` (y la dirección de una vista previa, como
`https://cloudflare.montecarmelo-kxg.pages.dev`, si se quiere entrar con Google en ella). El ID
(`….apps.googleusercontent.com`) va en `GOOGLE_CLIENT_ID` (`wrangler.toml`) y en `googleClientId`
(`js/config.js`). En «Público», la app tiene que estar **publicada** (en producción) para que entre
cualquier cuenta de Google.

## Cómo probar en local

```bash
npm install                 # wrangler, una vez
npm run base:local          # crea las tablas en la base local (.wrangler/)
npm run local               # arma dist/ y abre http://127.0.0.1:8788
```

`.dev.vars` (no se sube a git) tiene los secretos locales: `SECRETO=<cualquier texto>` y `SITIO_URL=` (vacía:
los enlaces usan la dirección local). La base y el R2 locales quedan en `.wrangler/`; para llenarlos con una
copia de los datos reales: `scripts/migrar-a-cloudflare.py --sitio http://127.0.0.1:8788/ --local`.
Los scripts de escritorio usan el servidor local con `MC_API=http://127.0.0.1:8788/api`.

## Cloudflare

| Pieza | Dónde |
|-------|-------|
| Sitio estático | `scripts/armar-sitio.sh` copia a `dist/` solo lo que se publica |
| API | `functions/api/[[ruta]].js` → `servidor/api.js` (`_routes.json`: solo `/api*` pasa por Functions) |
| Base de datos | D1 `montecarmelo` (variable `DB`), tablas en `migrations/` |
| Archivos | R2 `montecarmelo-archivos` (variable `ARCHIVOS`) |
| Configuración | `wrangler.toml` (variables y enlaces), secreto `SECRETO` en el panel de Cloudflare |
| Caché del navegador | `_headers` |

La API mantiene el contrato del Apps Script (`GET /api?accion=…`, `POST /api` con JSON en text/plain,
respuesta `{ok, error, token}`) y suma rutas para archivos, sin base64:

- `GET /api/audio/<id>` y `GET /api/archivo/<id>[?descargar=1]`: el archivo desde R2, con `Range` (el
  audio empieza a sonar enseguida y se puede adelantar).
- `PUT /api/subir?tipo=audio|partitura|cancionero|reemplazo&…` con `Authorization: Bearer <token>`: el
  archivo va tal cual en el cuerpo.

### Preparar la cuenta (una vez)

Con la cuenta **cancionerolitugico@gmail.com**, desde la raíz del sitio:

1. `npx wrangler login`
2. `npx wrangler d1 create montecarmelo` → copiá el `database_id` que muestra en `wrangler.toml`.
3. `npx wrangler r2 bucket create montecarmelo-archivos`
4. `npm run base:remota` (crea las tablas en D1).
5. En el panel de Cloudflare: **Workers y Pages → Crear → Pages → Conectar a Git** → el repositorio
   `CancioneroMontecarmelo/paginaweb`, nombre del proyecto **montecarmelo**, rama de producción `main`,
   comando de compilación `bash scripts/armar-sitio.sh`, directorio de salida `dist`. Los enlaces `DB` y
   `ARCHIVOS` y las variables salen de `wrangler.toml`.
6. En el proyecto: **Configuración → Variables y secretos → Agregar → Secreto** `SECRETO` (para producción
   y vista previa). Su valor sale del Apps Script: en el editor de Apps Script ejecutá
   `verSecretoParaCloudflare` y copiá lo que muestra el registro.
7. Cloudflare dio `montecarmelo-kxg.pages.dev` (`montecarmelo` ya estaba usado); la dirección pública es el
   dominio `cancioneroliturgico.cl`. Si alguna vez cambia, está en `SITIO_URL` (`wrangler.toml`), `SITIO` y
   las redirecciones (`js/config.js`) y `SITIO_URL` (`scripts/mc_biblioteca.py`).
8. Sumá la dirección a los orígenes del cliente de Google (ver arriba).

Cada rama distinta de `main` se publica como **vista previa** en `https://<rama>.montecarmelo-kxg.pages.dev`,
con la misma base y los mismos archivos que el sitio publicado.

### Plan gratuito

Alcanza para la parroquia: 100 000 pedidos por día a `/api` (las páginas, el CSS y el JavaScript no
cuentan), 5 GB en D1 y 10 GB en R2, sin cobro por bajar archivos. Lo que más pide es **En vivo**: cada
celular del coro consulta cada 4–5 segundos, unas 800 consultas por celular y por hora; 50 celulares
durante una misa son unas 40 000. Si un día se pasa del límite, la API responde con error hasta la
medianoche (hora UTC) y el resto del sitio sigue andando; en ese caso conviene el plan **Workers Paid**
(USD 5 al mes). El uso se ve en el panel de Cloudflare → Workers y Pages → montecarmelo → Métricas.

## Mudanza desde el Drive (una sola vez)

`scripts/migrar-a-cloudflare.py` copia todo lo del Apps Script y el Drive: usuarios, registro, visitas,
libro, coros, ensayos, Biblioteca (canciones, audios y partituras), cancioneros publicados, misas con sus
lecturas propias y actividades. Los archivos conservan su id del Drive, y los enlaces del Drive y del Apps
Script dentro de los `.md`, `.html` y `.m3u8` pasan a `https://montecarmelo-kxg.pages.dev/api/…`. Se puede
cortar y volver a correr: lo ya bajado o subido no se repite (queda en `migracion/`, que no va a git).

1. **Ensayo**: con el sitio viejo funcionando, `scripts/migrar-a-cloudflare.py --sitio https://montecarmelo-kxg.pages.dev/`
   (o primero `--local` contra `npm run local`). Pide la clave de administrador general del sitio viejo
   (Identificarse → «Copiar clave para el script»). Revisá el sitio nuevo (o la vista previa de la rama).
2. **Pegar `backend/Code.gs` en el Apps Script** y publicar una versión nueva (tiene `exportarTodo`,
   `exportarArchivo` y el modo «solo lectura»).
3. **Corte**: en el editor de Apps Script ejecutá `congelarCambios` (el sitio viejo sigue mostrando todo
   pero no deja guardar); corré de nuevo el script (copia lo que cambió desde el ensayo); uní la rama
   `cloudflare` en `main` y hacé `git push`. GitHub Pages publica el `js/config.js` nuevo, que lleva a
   cada visitante al sitio nuevo.
4. Si hubo que volver atrás: `descongelarCambios` en el Apps Script y revertir el `git push`.

Después de la mudanza, el Drive queda como respaldo: el sitio ya no lo usa.

### Lo que se dejó de usar

- El Apps Script (`backend/Code.gs` queda solo para la mudanza) y las carpetas `MonteCarmelo/` del Drive.
- Los correos: las invitaciones van por WhatsApp o se copian; los mensajes del libro de visitas se ven en
  Identificarse.
- **Vincular los audios sueltos del Drive** (Identificarse) y **Procesar las carpetas del Drive**
  (aplicación de escritorio): eran para ordenar el Drive; la mudanza deja todo vinculado.
- El respaldo `accion=audio` en base64 y el truco del silencio para iPhone (`js/silencio.js`): los audios
  llegan directo de `/api/audio/<id>`.

## Carpetas

| Carpeta / archivo | Uso |
|---------|-----|
| `editor/` | Cancionero Universal: editor, atril, Guardar/Abrir en la nube (`editor/js/nube.js`) |
| `servidor/`, `functions/` | API en Cloudflare: entrada con Google, permisos, auditoría, Biblioteca, cancioneros, misas… |
| `migrations/` | Tablas de la base D1 |
| `backend/` | Apps Script viejo (solo para la mudanza) |
| `comunidades/` | Página de cada comunidad: noticias y cancioneros publicados |
| `noticias/` | Blog estático por comunidad (JSON) |
| `misas.html` | Pantalla Misas: cancioneros de misa de todas las comunidades, Biblioteca de canciones, coros y ensayos |
| `reproductor.html` + `js/reproductor.js` | Reproductor: canciones con su letra, listas, cancioneros de misa y En vivo para el coro |
| `js/youtube-embed.js` | Reproductor de YouTube insertado (IFrame API) para los enlaces de video (Misas y reproductor) |
| `js/posturas.js`, `js/partituras.js`, `js/voces.js` | Posturas al tocar un acorde, partituras y el mezclador «Aprender las voces» (Misas y reproductor) |
| `inicio.html` + `js/inicio.js` | Inicio: actividades, calendario litúrgico, próximo domingo, libro de visitas y Colaborar |
| `js/liturgia.js` | Calendario litúrgico y cantos sugeridos (común a Misas e Inicio) |
| `ver.html` | Muestra un cancionero publicado (`ver.html?id=…`) |
| `js/config.js` | Dirección del sitio y de la API, ID de cliente de Google y la redirección desde github.io |
| `scripts/video-a-webm.py` | Comando: audio de videos o enlaces a AAC (.m4a) y subida a la Biblioteca |
| `scripts/subir-canciones.py` | Aplicación de escritorio: sube las canciones `.md` locales a la Biblioteca (`scripts/instalar-escritorio.sh` la pone en el menú) |
| `scripts/migrar-a-cloudflare.py` | La mudanza desde el Drive (ver arriba) |
| `respaldo-antes-drive/` | Copia de los audios y cancioneros anteriores al Drive |

## Inicio (`inicio.html`)

- **Marquesina de actividades** debajo de los botones: fecha, hora, comunidad, título y una descripción
  breve, pasando como un teleprompter (se detiene con el mouse encima; con «reducir movimiento» queda
  quieta y se desliza a mano). Quien puede editar en una comunidad ve **+ Actividad** para publicar,
  cambiar o quitar las suyas (las de toda la parroquia, los responsables y sacerdotes). Se guardan en
  la tabla `actividades`.
- **Calendario litúrgico**: el día de hoy con su celebración, tiempo, semana, color y santoral (la
  memoria o fiesta que nombra el título de las lecturas; si no hay, «Feria»), y los próximos 7 días
  (tocar uno lo muestra arriba). Sale de las lecturas de eucaristiadiaria.cl (GET `calendario`, con la
  misma caché que las lecturas); si un día todavía no está publicado, el tiempo y el color se calculan.
- **Próximo domingo**, para las cuatro comunidades: si ya hay cancionero para esa fecha se muestran sus
  cantos y el enlace; si no, la **sugerencia automática** (las mismas reglas de Misas) y **Armarlo en
  Misas**, que abre `misas.html?comunidad=…&nuevo=<fecha>` con el cancionero nuevo ya preparado.
- **Libro de visitas**: otras parroquias y personas dejan nombre, parroquia o comunidad, ciudad y país,
  un mensaje y si quieren **colaborar con temas nuevos** (con correo opcional, que no se publica; los
  mensajes se ven en Identificarse). Sin cuenta: lo protegen un campo trampa, largos máximos y un máximo de
  firmas por minuto. Los responsables pueden ocultar mensajes (en Inicio o en Identificarse).
- **Colaborar**: el mismo formulario del editor («Ayúdanos a seguir trabajando»), que llega al correo
  de la parroquia por FormSubmit.
- **Visitantes externos**: las cuentas sin privilegios que entran (con Google o solo con el correo)
  quedan anotadas con su primera y última visita y cuántas veces entraron; se ven en Identificarse, en
  el panel de responsables, junto con todos los mensajes del libro.

En D1: tablas `actividades` (pública), `libro` y `visitantes` (privadas).

## Editor: pantallas (estilo YouTube Music)

El editor es oscuro y se parece a YouTube Music, con la música de la parroquia:

- **Menú lateral** (abajo en el celular): **Inicio**, **Explorar**, **Biblioteca**, **Cancionero** y **Atril**,
  más enlaces a Misas y al Reproductor. Arriba, el buscador lleva a la Biblioteca.
- **Inicio**: el próximo domingo (con el color de su tiempo litúrgico, que tiñe toda la app), los cantos
  sugeridos para cada momento, los cancioneros de misa, estanterías por tiempo, por momento, marianos,
  recién agregadas y los cancioneros guardados en la nube. ▶ en una tarjeta abre la canción para escucharla y
  ver su letra (vista previa: no entra al cancionero hasta tocar **Agregar**); **+** la agrega al cancionero.
- **Explorar**: chips por momento, tiempo litúrgico, comunidad y etiqueta. **Biblioteca**: las 970 canciones
  del sitio con buscador (título, etiqueta o una frase de la letra), comunidad y «solo con audio».
- **Cancionero** (la cola, a la derecha): sus canciones en orden, cada una con su carátula, momento, tono y
  cejilla; se reordenan arrastrando. Al abrir el editor por primera vez está vacío (ya no se abre el ejemplo:
  queda en **Archivo → Abrir ejemplo**); la colección de archivos del equipo está en **Abrir → Colección de este equipo**.
- **Centro**: la canción con su carátula, tono, **Cejilla**, **Velocidad** del audio y **Desplazar** (velocidad
  del desplazamiento automático), y debajo la letra con los acordes. Mientras suena una canción siempre se ve
  su letra con sus acordes (al darle ▶ desde otra pantalla vuelve aquí).
- **Barra de reproducción**: anterior, ▶, siguiente, tiempo, la **carátula** (la imagen del audio, la de su
  video de YouTube o una con las iniciales y el color del momento), velocidad, volumen y el botón de la cola.
  Al terminar una canción sigue la siguiente con audio (salvo en el atril). Los videos de YouTube suenan en la
  mini ventana también en el PC. Tecla **k**: reproducir o pausar.
- **Atril** (Ctrl+Alt+D): pantalla completa en negro con los acordes en amarillo, pestañas **Letra y acordes**
  y **Partituras** (las de la Biblioteca y las vinculadas en la canción). Solo tiene la velocidad del audio, la
  del desplazamiento y un ▶ pequeño; ambas velocidades vienen de la canción. Tocar la letra (o la barra
  espaciadora) la hace avanzar sola; deslizar el dedo a los lados o ← → cambia de canción; un pedal (Av Pág)
  baja una pantalla y al final pasa a la siguiente. Esc o «atrás» lo cierra. La pantalla no se apaga.

### Cancioneros de misa en el editor

- En Misas, **✎ Editar en el editor** (`editor/?misa=<id>&foco=<momento>.<canción>`) abre el cancionero
  completo en el editor, en la canción que se estaba mirando. También desde Inicio o **Archivo → Abrir →
  Cancionero de misa…**.
- Ahí se cambia el tono, la **cejilla** (por ejemplo de 1 a 3), la velocidad del audio y la del desplazamiento.
  Las canciones cambiadas se marcan ● y **Guardar en la misa** (Ctrl+S) los guarda **solo en ese cancionero de
  misa** (`guardarMisa`, campos `desplazamiento`, `capo`, `velocidad` y `scroll` de cada canción): la canción
  de la Biblioteca no cambia. Misas se actualiza sola si está abierta en el mismo navegador
  (`localStorage` `mc-misa-guardada`) y muestra «Capo N · 0,9×» en cada canción; el reproductor usa esa velocidad.
- **▶ Atril** de Misas (`&atril=1`) abre el atril directo, sin guardar nada en el editor.

## Editor: menú Archivo

- **Nuevo** ▸ Canción · Cancionero.
- **Abrir** ▸ Canción de la Biblioteca de la parroquia (buscador por título, etiqueta o frase de la letra,
  igual que en Misas; marca las que tienen **solo audio** para escribirles la letra) o de este equipo · Cancionero de la nube, de este
  equipo o de la colección.
- **Guardar** es siempre en la nube de la parroquia: **Guardar canción en la Biblioteca** (Ctrl+S) sube
  sus audios del equipo convertidos a AAC (.m4a) y la deja en la Biblioteca; si ya había una canción con el
  mismo título subida solo con su audio, quedan unidas. **Guardar cancionero en la nube…** (Ctrl+Alt+S).
- **Guardar como (en este equipo)** ▸ Canción `.md` (Ctrl+Mayús+S) · Cancionero `.m3u8`.
- **Compartir** ▸ por WhatsApp o por correo con el vínculo a su página (`ver.html`); si el cancionero
  todavía no está en la nube, ofrece guardarlo o enviar el archivo.
- **Exportar** ▸ PowerPoint, Word, ODT, HTML, Markdown y texto. **Imprimir** ▸ canción, cancionero o tríptico.

### Tríptico

Hoja apaisada en tres paneles, en orden de lectura: **cara 1 = paneles 1-2-3** y, al dar vuelta la hoja,
**cara 2 = 4-5-6** (impresión a doble cara girando por el borde corto). Va **una canción por panel**, todas
con la misma letra: la más grande con la que la canción más larga cabe en su panel. Si una no cabe ni con
la letra mínima, sigue en el panel siguiente y se avisa. Seis canciones por hoja: la séptima abre la hoja 2.
**Hojas**: 1, 2 o «Las necesarias». La portada (título, subtítulo e índice) es opcional y ocupa el panel 1.

## Flujo del coro

1. Abrí el **Editor**, escribí o abrí las canciones (una por pestaña) y vinculá sus audios.
2. **Archivo → Guardar cancionero en la nube** → identificate, elegí comunidad y fecha.
3. Se guarda como una carpeta del cancionero en R2 (canciones `.md`, lista `.m3u8`, audios y una página
   `.html` con los audios adentro) y aparece en la página de la comunidad.
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
- **Cancionero activo**: el que está abierto en Misas. En el editor, **Atril** con el cancionero vacío
  ofrece abrirlo; si después cambia en Misas, el editor avisa con **Actualizar**. Se comunica por `localStorage` (`mc-activo`), en el mismo navegador.
- **Panel izquierdo — Biblioteca**, con dos pestañas:
  - **Canciones**: al tocar un momento, lista primero las canciones con esa etiqueta y después, en otro
    grupo, las que no la tienen pero cuyo título o letra la sugieren (el nombre del momento, sus sinónimos
    o palabras típicas: «santo santo», «hosanna», «pan de vida», «cordero de dios»…), con el motivo
    («Por el título» / «Su letra dice …»). Al marcarla queda en el cancionero (reemplaza a la sugerida) y
    se muestra en el centro.
  - **Buscar**: por título, etiqueta o cualquier frase de la letra (la primera estrofa y el comienzo de
    las demás), sin distinguir mayúsculas ni tildes y tolerando faltas comunes («habre tu corason»,
    «kordero de dioz», «resusito»); en frases largas perdona una palabra de cada cuatro. Muestra la línea
    donde coincidió, marcada. Lo hace `editor/js/buscar.js`, con el campo `inicio` que el servidor
    guarda con cada canción (después de la mudanza lo completa `rehacerBiblioteca`).
  - **Lecturas**: las lecturas del día de la misa (antífona, lecturas, salmo, evangelio y oraciones),
    tomadas de [eucaristiadiaria.cl](https://www.eucaristiadiaria.cl/) (Área de Liturgia del Arzobispado
    de Santiago). Se publican mes a mes: para fechas más lejanas la pestaña avisa que todavía no están.
    Quien puede editar el cancionero puede **tomarlas de otro día** (no cambia la fecha de la misa) o
    **corregir el texto** (o escribirlo si todavía no está publicado); se guardan con el cancionero (tabla
    `misas`), y también se usan para los cantos sugeridos. **Volver a las
    del día de la misa** deshace las dos cosas.
- **Publicar** (al final del cancionero): lo guarda de inmediato en la web y arma su página `.html` en la
  nube, como **Guardar en la nube** del editor: aparece en la página de la comunidad y quedan los enlaces
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

En D1: `canciones` (cada `.md` con sus datos; la lista pública se arma una vez y queda guardada), `misas`
(pública), `lecturas` (las ya leídas de eucaristiadiaria.cl) y las privadas `coros` y `ensayos`. Los
audios y partituras, en R2.

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

- Quedan en R2, con nombres ordenados `<canción>-<voz>-<fecha>.m4a`, y se suben tal cual (`PUT
  /api/subir?tipo=audio`, sin base64).
- Formato: **AAC-LC en .m4a** (48 kHz, 96 kbps estéreo o 64 kbps mono, índice al principio para que
  empiece a sonar enseguida, con título y artista). Es el único formato compacto que suena en todos los
  equipos: iPhone y Mac (también los viejos), Android, PC y cualquier reproductor externo. Una canción de
  4 minutos queda en unos 3 MB.
- Todo se convierte **antes de subir**: en Misas y en el editor, en el propio navegador; en la
  aplicación de escritorio y en `video-a-webm.py`, con `ffmpeg`. Sirven mp3, m4a, wav, ogg, webm y el
  audio de un video. Los `.m4a` se suben tal cual; si el equipo no puede convertir, un MP3 se sube
  original y se avisa. Máximo 30 MB por audio ya convertido.
- **Grabar con el micrófono**: la toma se escucha antes de subirla y también queda en .m4a.
- Cada audio queda **vinculado al `.md`** de su canción: se agrega a la canción y se escribe en el `.md`
  la misma etiqueta que usa el editor,
  `<audio controls src="https://montecarmelo-kxg.pages.dev/api/audio/<id>" title="…" data-voz="…"></audio>`.
  Al quitar un audio se borra la etiqueta, y si ninguna otra canción lo usa se borra el archivo.
- **Arrastrar y soltar**: en la computadora se sueltan los archivos en el diálogo (o en cualquier parte
  de la pantalla Misas, que lo abre). En el celular se toca la zona y se eligen desde Archivos, Drive o
  la grabadora; en Android y iPad también se puede arrastrar desde la pantalla dividida.
- `js/audio-aac.js` hace la conversión: con WebCodecs y `js/vendor/mp4-muxer.mjs` (MIT) donde el
  navegador codifica AAC (Safari, Chrome en Mac/Windows/Android) y, si no, con ffmpeg.wasm
  (`js/vendor/ffmpeg/`, MIT; el núcleo de 32 MB se baja de jsDelivr solo la primera vez). Cada resultado
  se comprueba (cabecera MP4, canales y duración) antes de subirlo.
- Suenan directo desde `/api/audio/<id>` (con `Range`: empiezan enseguida y se pueden adelantar), en
  Misas, el reproductor, el editor y las páginas `.html` publicadas.
- **Pasar a .m4a los audios viejos** (solo el **administrador general**, en **Identificarse → Audios de
  la Biblioteca**; los demás no lo ven): cuenta los archivos vinculados, los MP3 externos y los videos de
  YouTube, y los audios que siguen en WebM u otro formato, y los convierte uno por uno en ese navegador,
  reemplazando el contenido del **mismo archivo** (el enlace no cambia, así que los `.md` y los
  cancioneros publicados siguen funcionando). Se puede **Pausar** y **Seguir**, o cerrar y continuar otro
  día; los que fallan quedan listados con **Reintentar**. Conviene dejarlo en una computadora enchufada:
  con ffmpeg.wasm tarda unos segundos por audio. Lo hace `js/convertir-audios.js` con la acción
  `audiosAConvertir` y `PUT /api/subir?tipo=reemplazo`. La aplicación de escritorio hace lo mismo con
  ffmpeg (**Convertir audios a .m4a**), más rápido.

### Créditos (letra y música)

- Cada canción puede decir quién escribió la letra y quién la música: en el `.md` son `letra-de:` y
  `musica-de:` en la cabecera. En el editor se cargan con el botón **Créditos** junto al título (o el
  menú del título → **Créditos (letra y música)…**).
- Se muestran bajo el título como «Letra: … · Música: …» (o «Letra y música: …» si es la misma persona)
  en el atril, en Misas, en las páginas `.html` exportadas y en el reproductor.
- El servidor los guarda también con la canción (`letraDe`, `musicaDe`), así el **buscador**
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
  página (los PDF los dibuja pdf.js, `editor/vendor/pdfjs/`; el celular no pregunta con qué app
  abrirlos), y **Descargar**.
- Quien puede editar la canción tiene **+ Partitura**: sube un PDF o una foto PNG o JPG (hasta 15 MB),
  elige la voz, y desde el mismo diálogo puede **Quitar** las que ya tiene.
- Quedan en R2 (`GET /api/archivo/<id>`) y en la canción (`partituras: [{fileId, nombre, voz, mime}]`);
  volver a guardar la canción desde el editor las conserva. Se suben con `PUT /api/subir?tipo=partitura`
  y se quitan con la acción `quitarPartitura`.
- Las páginas `.html` de los cancioneros y el reproductor tienen el enlace **Partitura**.

### Aprender las voces

- En canciones con audios de dos o más voces distintas (soprano, contralto, tenor, bajo…), el botón
  **🎚 Aprender las voces** abre un mezclador: todas las voces suenan juntas, exactamente sincronizadas,
  con reproducir/pausa y barra de avance comunes.
- Por voz: volumen, **Silenciar** y **Solo**. Los botones **Mi voz: …** dejan esa voz al 100 % y las demás
  bajas, como guía; la elección queda recordada en el equipo (y el reproductor elige esa voz primero).
- Baja cada voz de `/api/audio/<id>` y las mezcla con Web Audio (`js/voces.js`).
- Las voces quedan alineadas solo si sus audios **empiezan en el mismo compás**, como las pistas de un
  mismo arreglo. Grabaciones sueltas, cada una con su propia entrada, se desfasan.
- La voz **Contralto** (también se escribe `[Voz: Alto]`) se suma a las del editor.

### Aplicación de escritorio: subir canciones a la Biblioteca (`scripts/subir-canciones.py`)

Ventana para Linux Mint que busca las canciones `.md` que el editor guardó en la computadora (por
defecto `~/Música/desde Cancionero on line`, con sus subcarpetas) y orienta para subirlas a la Biblioteca
de la parroquia:

- Cada canción muestra su estado frente a la Biblioteca y qué conviene hacer: **Nueva** (subirla),
  **Está solo con audio** (se le agrega la letra), **Cambiada aquí** (modificada después de la última
  subida: se reemplaza, conservando sus audios) o **Título repetido** (dos archivos con el mismo título;
  hay que cambiar uno en el editor). Las nuevas y cambiadas vienen marcadas; **Seleccionar todas** y
  **Desmarcar todas** cambian la selección. Las que ya están en la Biblioteca no se muestran (el resumen
  las cuenta) y cada canción sale de la lista apenas termina de subirse.
- Al subir, los audios de la computadora se convierten a AAC (.m4a) y se suben; los videos (YouTube…) y los
  enlaces a mp3 quedan como enlace (los de YouTube suenan en el sitio con el video insertado). Un audio
  que ya estaba en la canción no se vuelve a subir. Usa la misma clave que `video-a-webm.py`
  (**Pegar la clave…**, con la guía para conseguirla en Identificarse).
- Reconoce también los audios enlazados como `[Escuchar](<Abandónate.webm>)` o `audio: "Abandónate.webm"`
  en la cabecera (así vienen las canciones del Copiador de canciones): el enlace se reemplaza, en el mismo
  lugar, por el `<audio>` de la Biblioteca. Los `<audio>` que ya apuntan a la Biblioteca (o al
  Drive de antes de la mudanza, con el mismo id) no se vuelven a subir. Si la canción ya está en la Biblioteca sin ese audio aparece como
  **Le falta el audio**.
- **Guardar en carpetas, igual que en esta computadora** (marcada por defecto): el `.md` y su audio quedan
  juntos en la carpeta `<carpeta elegida>/<subcarpetas>` de la Biblioteca (por ejemplo
  `cancionero/Momentos litúrgicos/Comunión/Abandónate.md` y `Abandónate.m4a`), y la carpeta es
  la primera etiqueta (después las de en medio, como «Navidad», y el momento y tiempo litúrgico de la
  cabecera). Las canciones que ya estaban en la Biblioteca fuera de su carpeta aparecen como **Suelta en
  la Biblioteca**: al subirlas se **mueve** el mismo `.md` (no cambia su id, así que Misas y los cancioneros
  siguen igual) y se sube su audio. Si el mismo título está en varias carpetas, se sube una vez (la que
  tiene audio) y en las otras carpetas queda un **acceso directo** al `.md` y al audio. Recorre
  hasta 4 niveles de subcarpetas. **Detener** para después de la canción en curso; al volver a abrir,
  la lista muestra solo lo que falta. En la Biblioteca, cada canción guarda su carpeta (`carpeta`), y los
  audios de esas carpetas cuentan como de la Biblioteca (reproductor y conversión a .m4a).
- **Convertir audios a .m4a** (solo el administrador general): baja los audios de la Biblioteca que no
  están en .m4a ni .mp3, los convierte con ffmpeg y reemplaza el contenido del mismo archivo (el enlace no
  cambia). **Detener** y seguir otro día.
- Los cancioneros (`.m3u8`) se siguen subiendo desde el editor (Archivo → Guardar cancionero en la nube).
- Usa el sitio publicado; para probar contra el servidor local: `MC_API=http://127.0.0.1:8788/api`.

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
sesión. Oscuro por defecto (**Colores** cambia el tema). Lo hace `js/reproductor.js` con los mismos scripts
del editor que usa Misas; todo son lecturas públicas de `/api`.

Tiene el aspecto del editor («YouTube Music»): el menú a la izquierda (abajo en el celular), carátulas
(`editor/js/caratula.js`: la imagen del audio, la miniatura del video o una con el color del momento), la
cola a la derecha (en el celular sube desde el botón ≡♪ de la barra, con aleatorio y repetir) y la barra
de reproducción abajo con la carátula. El acento del tema **Noche** es el color litúrgico del próximo domingo.

- **Inicio**: el próximo domingo (con **Escuchar** su cancionero de misa, si ya hay uno) y estanterías:
  cancioneros de misa, tus listas, sugeridas para el domingo, las del tiempo litúrgico y las de cada
  momento. Tocar una tarjeta hace sonar esa estantería desde esa canción.
- **Canciones**: el buscador de la Biblioteca (título, frase de la letra, autor o etiqueta) y **Solo con
  audio o video**. Tocar una canción la hace sonar; la cola es la lista que se está viendo. **+** la agrega a una
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
  un selector de voz. **+ Lista** agrega la canción que suena a una lista. Abajo, una barra mínima:
  aleatorio, anterior, reproducir/pausa, siguiente, repetir, **+** (agregar a una lista) y avance.
- Al refrescar o volver a abrir, sigue en la misma cola y canción, en pausa y en el mismo segundo
  (`localStorage` `mc-rp-sonando`, por 7 días; con aviso «Seguís en…»). La cola cambia solo al elegir otra
  canción, lista o cancionero, o al abrir un enlace `#l=` / `#misa=` distinto; escribir en el buscador no la cambia.
- **Agregar a una lista**: el diálogo sugiere primero **Lista de {nombre}** (el nombre de la sesión, o el
  que se pide una sola vez y queda en el equipo, `mc-mi-nombre`); si todavía no existe, la crea al tocarla.
  **+ Nueva lista** propone ese mismo nombre.
- **Aleatorio** (⇄) recorre la cola en un orden mezclado que empieza por la canción que suena.
  **Repetir** (↻) cambia entre no, **toda la lista** (al terminar vuelve a empezar; en aleatorio, con otra
  mezcla) y **esta canción** (↻1, vuelve a sonar). Quedan guardados en el equipo (`mc-rp-aleatorio`, `mc-rp-repetir`).
- Si un video o un audio no se puede reproducir (YouTube no lo permite, el archivo o el enlace fallan),
  avisa **No disponible: pasando a la siguiente** y sigue; se detiene si ya probó toda la cola sin éxito.
- **Colores**: seis temas (Noche, Día, Carmelo, Mariano, Litúrgico y Penitencial) y un **color de acento**
  propio para botones y acordes, con **Restablecer**. Quedan en el equipo (`mc-rp-tema`, `mc-rp-acento`).
- Los audios suenan directo desde `/api/audio/<id>`, asignados en el mismo toque (así también suenan en
  iPhone); el navegador los guarda en su caché. Precarga la letra de la canción siguiente; las canciones
  sin audio no se saltan solas, para poder cantarlas. Si un audio sigue
  en WebM y el equipo no lo reproduce, lo dice.
- **Videos de YouTube** (modelo «Smart Embed», como Chordify): no se bajan. La canción que tiene un enlace
  de YouTube (`youtube:` en la cabecera del `.md` o un `<audio>` con la dirección del video) lo suma a sus
  audios como **Video de YouTube**, y suena con el reproductor oficial de YouTube insertado arriba de la
  letra (`js/youtube-embed.js`, IFrame API), manejado con la misma barra: reproducir/pausa y avance. El
  audio de la Biblioteca va primero; el video queda en el selector. Al terminar un video se detiene, salvo
  con aleatorio o repetir activados. YouTube pide que el video se vea (mínimo 200×200 px); si el dueño no permite
  insertarlo, aparece **Abrir en YouTube** y pasa a la siguiente. En el celular, YouTube pausa el video al
  salir de la página o bloquear la pantalla (es una regla de YouTube); los audios de la Biblioteca siguen sonando.
  En Misas, esos audios tienen **▶ Ver y escuchar**, que abre el video debajo de los audios (uno a la vez).
- En el celular: controles en la pantalla bloqueada y en los auriculares (Media Session, también con
  video) y la pantalla no se apaga mientras se lee la letra (Wake Lock, donde exista). La música sigue
  sonando al cambiar de pestaña o de app; al volver, la barra se pone al día.

### App del reproductor (instalable)

- El reproductor se instala en el celular como una app (PWA) que muestra solo el reproductor: sin el menú
  del sitio, y con **Monte Carmelo** arriba como enlace a la página de la parroquia (se abre en el navegador).
- Android y computadora: botón **Instalar app** junto a las pestañas (aparece cuando el navegador lo
  permite). iPhone: el botón explica **Compartir → Agregar a inicio** en Safari.
- Archivos: `reproductor.webmanifest` (abre `reproductor?app=1`, alcance solo el reproductor; Cloudflare
  sirve las páginas sin `.html`),
  `sw-reproductor.js` (con internet carga siempre lo más nuevo y guarda una copia para abrir sin conexión;
  no guarda `/api`, YouTube ni los audios) e `icons/reproductor-*.png` (la parroquia con ▶).
- Al cambiar los archivos del reproductor, subir el número de `CACHE` en `sw-reproductor.js`.

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
- El estado vive en la tabla `vivo` de D1 y dura 6 horas; tocar **En vivo** de nuevo reutiliza el mismo
  código. Acciones: `iniciarVivo`, `moverVivo`, `terminarVivo` y el GET público `accion=vivo&codigo=…`.
  Con 40 a 60 celulares son unas 10–15 consultas por segundo durante la misa: ver **Plan gratuito**.
