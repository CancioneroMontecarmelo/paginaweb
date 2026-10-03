# Sitio Parroquia Nuestra Señora del Monte Carmelo

Sitio estático: noticias por comunidad, cancioneros litúrgicos y editor MP3editag.

## Autenticación (Identificarse)

- **Admin general:** Marcos Mora Vitta · `cancionerolitugico@gmail.com`
- Solicitudes de admin/editor/sacerdote con código de 6 dígitos
- Solo Marcos (o el segundo responsable que él nombre) acepta o da de baja
- Claves guardadas como hash SHA-256 (nunca en claro)
- Cada entrada queda en el registro de auditoría del panel
- Los correos se abren con el cliente de correo hacia `cancionerolitugico@gmail.com` (y al usuario). Opcional: configurar EmailJS en `window.MONTECARMELO_EMAILJS`

## Cómo probar en local

Desde la raíz del proyecto:

```bash
python3 -m http.server 8080
```

Abrí [http://localhost:8080/inicio.html](http://localhost:8080/inicio.html).

## Credenciales de prueba

Ver `usuarios.json` (campo `ayuda`). Ejemplo:

- Admin parroquial: `admin.parroquia` / `parroquia2024`
- Editores: `editor.nazaret1` / `editor2024` (y análogos por comunidad)

**Cambiá las contraseñas antes de publicar en internet.**

## Carpetas importantes

| Carpeta | Uso |
|---------|-----|
| `audios/` | Biblioteca de canciones (MP3 preferido; M4A se reproduce) |
| `Cancioneros/` | JSON por comunidad + `indice.json` |
| `noticias/` | Blog estático por comunidad |
| `Mp3editag/` | Editor, atril y subida de audios |

## Flujo del coro

1. En Mp3editag: **Grabar nuevo tema** → abre `Grabadora.html`
2. Grabá / recortá → **Guardar MP3** (convierte WebM/OGG a MP3 en silencio)
3. Elegí la carpeta `audios/` del proyecto
4. El MP3 vuelve a Mp3editag y se abre en **Editar tags** para letra, acordes y guardar en el mismo archivo
5. Armá el cancionero y publicá el JSON en `Cancioneros/<Comunidad>/`
