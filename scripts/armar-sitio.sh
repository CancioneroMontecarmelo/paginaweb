#!/usr/bin/env bash
# Arma dist/: solo lo que se publica en Cloudflare Pages (sin backend/, scripts/, respaldos ni README).
# Es el «comando de build» del proyecto de Pages; también lo usa `npm run local`.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist

cp index.html inicio.html login.html misas.html noticias.html reproductor.html tv.html ver.html dist/
cp reproductor.webmanifest sw-reproductor.js _headers _redirects _routes.json dist/
cp -r css js icons Imagenes comunidades noticias editor dist/

echo "dist/ listo: $(find dist -type f | wc -l) archivos"
