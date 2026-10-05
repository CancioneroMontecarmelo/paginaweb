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
  sus momentos (Entrada, Gloria, Santo…). **+ Agregar nuevo** crea uno con los momentos habituales.
- **Panel izquierdo — Biblioteca**: al tocar un momento, lista todas las canciones del sitio con esa
  etiqueta; al marcarla queda en el cancionero y se muestra en el centro.
- **Guardar**: nombre, fecha de uso, tiempo litúrgico, coro, fechas posibles de ensayo y ensayos
  realizados con quiénes asistieron.
- **Coro**: nombre del coro e integrantes (comunidad, fecha de incorporación, voz, instrumentos,
  lectura de partitura, nivel).
- **Subir canción**: agrega una canción `.md` (y su audio) a la Biblioteca. También se agregan solas las
  canciones de cada cancionero guardado desde el editor.

En el Drive: `MonteCarmelo/Biblioteca/` (canciones y audios + `biblioteca.json`), `MonteCarmelo/misas.json`
(público) y en `MonteCarmelo/sistema/` los archivos privados `coros.json` y `ensayos.json`.
