#!/usr/bin/env bash
# Pone «Subir canciones a la Biblioteca» (scripts/subir-canciones.py) en el menú de Linux Mint y en
# «Abrir con» de los archivos .md. Se instala solo para este usuario, sin sudo.
#   scripts/instalar-escritorio.sh          instala o actualiza
#   scripts/instalar-escritorio.sh --quitar lo saca del menú
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(dirname "$DIR")"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONOS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
LANZADOR="$APPS/montecarmelo-subir-canciones.desktop"

if [[ "${1:-}" == "--quitar" ]]; then
  rm -f "$LANZADOR" "$ICONOS/192x192/apps/montecarmelo-subir.png" "$ICONOS/512x512/apps/montecarmelo-subir.png"
  update-desktop-database "$APPS" 2>/dev/null || true
  echo "Listo: se quitó del menú."
  exit 0
fi

faltan=()
python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' 2>/dev/null || faltan+=(python3-gi gir1.2-gtk-3.0)
command -v ffmpeg >/dev/null || faltan+=(ffmpeg)
if (( ${#faltan[@]} )); then
  echo "Faltan programas. Instalalos con:"
  echo "  sudo apt install ${faltan[*]}"
  exit 1
fi

mkdir -p "$APPS" "$ICONOS/192x192/apps" "$ICONOS/512x512/apps"
cp "$RAIZ/editor/icons/icono-192.png" "$ICONOS/192x192/apps/montecarmelo-subir.png"
cp "$RAIZ/editor/icons/icono-512.png" "$ICONOS/512x512/apps/montecarmelo-subir.png"
chmod +x "$DIR/subir-canciones.py" "$DIR/video-a-webm.py"

cat > "$LANZADOR" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Subir canciones a la Biblioteca
GenericName=Canciones de la parroquia
Comment=Sube las canciones .md del editor a la Biblioteca de la parroquia Monte Carmelo, con sus audios en AAC (.m4a)
Exec=python3 "$DIR/subir-canciones.py" %F
Icon=montecarmelo-subir
Terminal=false
Categories=AudioVideo;Audio;Music;
MimeType=text/markdown;text/x-markdown;
Keywords=cancionero;canciones;misa;biblioteca;monte carmelo;m4a;
StartupWMClass=montecarmelo-subir
EOF
chmod +x "$LANZADOR"
update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -f -t "$ICONOS" 2>/dev/null || true
echo "Listo: «Subir canciones a la Biblioteca» está en el menú (Sonido y video)."
echo "También aparece en «Abrir con» al hacer clic derecho en un archivo .md."
