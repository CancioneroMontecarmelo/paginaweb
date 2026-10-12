#!/usr/bin/env bash
# Arma dist/: solo lo que se publica en Cloudflare Pages (sin backend/, scripts/, respaldos ni README).
# Es el «comando de build» del proyecto de Pages; también lo usa `npm run local`.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist

# Las páginas son comunes a todas las parroquias: functions/_middleware.js las sirve en /<parroquia>/<página>
cp index.html 404.html inicio.html login.html misas.html noticias.html comunidad.html reproductor.html tv.html ver.html pagina.html dist/
# /acerca es común a todas las parroquias (no pasa por el middleware: «acerca» es un nombre reservado)
cp acerca.html robots.txt dist/
cp app.webmanifest sw.js reproductor.webmanifest _headers _redirects _routes.json dist/
cp -r css js icons Imagenes editor dist/

echo "dist/ listo: $(find dist -type f | wc -l) archivos"
