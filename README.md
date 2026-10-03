# Sitio Parroquia Nuestra Señora del Monte Carmelo

Sitio estático (GitHub Pages): noticias por comunidad y cancioneros litúrgicos hechos con el editor
**Cancionero Universal** (`editor/`). Los cancioneros, los usuarios y el registro de entradas se guardan
en el Google Drive de `cancionerolitugico@gmail.com` a través de un Apps Script (`backend/Code.gs`).

- Página publicada: <https://cancioneromontecarmelo.github.io/paginaweb/>
- Cada `git push` a `main` vuelve a publicar la página en 1–2 minutos.

## Autenticación (Identificarse)

- **Admin general:** Marcos Mora Vitta · `cancionerolitugico@gmail.com`
- Solicitudes de admin/editor/sacerdote con código de 6 dígitos (llega por correo a la parroquia)
- Solo Marcos (o el segundo responsable que él nombre) acepta o da de baja
- Claves guardadas como hash SHA-256 (nunca en claro); la sesión dura 12 horas
- Cada entrada queda en el registro de auditoría del panel

Con el Apps Script conectado, los usuarios viven en `MonteCarmelo/sistema/usuarios.json` del Drive (privado).
Sin conectar (`apiUrl` vacío en `js/config.js`) el sitio funciona en **modo local de prueba**: usuarios en
`usuarios.json` + el navegador.

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
4. Autorizá Drive y correo **una sola vez**: `clasp open-script` → elegí la función `prepararPrimeraVez` → **Ejecutar** → aceptá los permisos
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
| `backend/` | Apps Script: usuarios, solicitudes, auditoría y cancioneros en Drive |
| `comunidades/` | Página de cada comunidad: noticias y cancioneros publicados |
| `noticias/` | Blog estático por comunidad (JSON) |
| `ver.html` | Muestra un cancionero guardado en el Drive (`ver.html?id=…`) |
| `js/config.js` | Dirección del Apps Script (`apiUrl`) |
| `respaldo-antes-drive/` | Copia de los audios y cancioneros anteriores al Drive |

## Flujo del coro

1. Abrí el **Editor**, escribí o abrí las canciones (una por pestaña) y vinculá sus audios.
2. **☁ Guardar en Drive** → identificate, elegí comunidad y fecha.
3. Se guarda en `MonteCarmelo/Cancioneros/<Comunidad>/<fecha>_<nombre>/` (canciones `.md`, lista `.m3u8`,
   audios y una página `.html` con los audios adentro) y aparece en la página de la comunidad.
4. Desde la página de la comunidad: **Ver** (para todos) o **Editar** (para quien tenga permiso).
