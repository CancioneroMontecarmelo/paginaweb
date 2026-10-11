#!/usr/bin/env python3
"""
parroquias.py — Aplicación local para ver cómo está armado cancioneroliturgico.cl y crear o completar parroquias
(datos, logo, portada, comunidades, responsable, administradores y páginas propias).

    scripts/parroquias.py [--sitio https://cancioneroliturgico.cl/] [--puerto 8790] [--sin-navegador]

Se abre en el navegador (http://127.0.0.1:8790). No toca la base de datos: todo pasa por la API del sitio con la
clave del administrador general (la de cancioneroliturgico.cl/montecarmelo/login#clave, la misma de «Subir
canciones»). Para probar contra el sitio local: --sitio http://localhost:8788/ (después de `npm run local`).

El lanzador del menú lo instala scripts/instalar-escritorio.sh.
"""

import argparse
import json
import re
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mc_biblioteca as mc  # noqa: E402

APP = Path(__file__).resolve().parent / "parroquias_app"
CLAVES = mc.CONFIG.parent / "parroquias-app.json"
TIPOS = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".png": "image/png", ".svg": "image/svg+xml"}
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$")
MAX_SUBIDA = 5 * 1024 * 1024


class Sitio:
    """El sitio con el que habla la app y la clave para ese sitio."""

    def __init__(self, url):
        self.url = url if url.endswith("/") else url + "/"
        self.produccion = self.url == mc.SITIO_URL
        self.token = self._clave_guardada()

    # La de producción es la misma de «Subir canciones»; las de otros sitios (el local) van aparte
    def _clave_guardada(self):
        if self.produccion:
            return mc.clave_guardada()
        try:
            token = json.loads(CLAVES.read_text(encoding="utf-8")).get(self.url, "")
        except (OSError, ValueError):
            return ""
        return token if mc.clave_vigente(token) else ""

    def guardar_clave(self, token):
        self.token = token
        if self.produccion:
            mc.guardar_clave(token)
            return
        try:
            claves = json.loads(CLAVES.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            claves = {}
        claves[self.url] = token
        CLAVES.parent.mkdir(parents=True, exist_ok=True)
        CLAVES.write_text(json.dumps(claves), encoding="utf-8")
        CLAVES.chmod(0o600)

    def estado(self):
        d = mc.datos_clave(self.token) or {}
        return {"sitio": self.url, "produccion": self.produccion, "email": d.get("email", ""),
                "claveVigente": mc.clave_vigente(self.token), "enlaceClave": self.url + "montecarmelo/login#clave"}

    def _abrir(self, pedido):
        for k, v in mc.AGENTE.items():
            pedido.add_header(k, v)
        try:
            with urllib.request.urlopen(pedido, timeout=120) as res:
                cuerpo = res.read()
        except urllib.error.HTTPError as e:
            cuerpo = e.read()
            if not cuerpo.startswith(b"{"):
                return {"ok": False, "error": f"El sitio respondió con un error ({e.code})."}
        except urllib.error.URLError as e:
            return {"ok": False, "error": f"No se pudo conectar con {self.url}: {e.reason}"}
        try:
            r = json.loads(cuerpo.decode("utf-8"))
        except ValueError:
            return {"ok": False, "error": "El sitio respondió algo que no se entiende."}
        # Cada respuesta con sesión trae la clave renovada: se guarda y no viaja a la página
        nuevo = r.pop("token", None) if isinstance(r, dict) else None
        if nuevo and nuevo != self.token and mc.clave_vigente(nuevo):
            self.guardar_clave(nuevo)
        return r

    def api(self, parroquia):
        return self.url + parroquia + "/api"

    def post(self, parroquia, datos):
        cuerpo = json.dumps({**datos, "token": self.token}).encode("utf-8")
        return self._abrir(urllib.request.Request(self.api(parroquia), data=cuerpo,
                                                  headers={"Content-Type": "text/plain;charset=utf-8"}))

    def get(self, parroquia, params):
        return self._abrir(urllib.request.Request(self.api(parroquia) + "?" + urllib.parse.urlencode(params)))

    def subir(self, parroquia, params, contenido, bytes_):
        pedido = urllib.request.Request(self.api(parroquia) + "/subir?" + urllib.parse.urlencode(params), data=bytes_,
                                        method="PUT", headers={"Content-Type": contenido, "Authorization": "Bearer " + self.token})
        return self._abrir(pedido)


def estructura():
    """Lo que el sitio tiene en común para todas las parroquias, leído del propio proyecto."""
    paginas_js = (mc.RAIZ / "servidor" / "paginas.js").read_text(encoding="utf-8")
    bloque = re.search(r"const PAGINAS = \{(.*?)\};", paginas_js, re.S)
    comunes = [{"slug": m.group(1), "titulo": m.group(2)}
               for m in re.finditer(r"(\w+):\s*'([^']*)'", bloque.group(1) if bloque else "")]
    return {
        "paginasComunes": comunes,
        "migraciones": sorted(p.name for p in (mc.RAIZ / "migrations").glob("*.sql")),
        "htmlBase": sorted(p.name for p in mc.RAIZ.glob("*.html")),
    }


class Manejador(BaseHTTPRequestHandler):
    sitio: Sitio = None
    clave_app = ""
    puerto = 0

    def log_message(self, formato, *args):
        pass

    def _responder(self, codigo, cuerpo, tipo="application/json; charset=utf-8"):
        if isinstance(cuerpo, (dict, list)):
            cuerpo = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    # Solo esta página puede usar la app: otra página abierta en el navegador no conoce la clave de la app
    # (y la cabecera propia obliga al navegador a preguntar antes, cosa que acá no se responde)
    def _autorizado(self):
        host_ok = self.headers.get("Host", "") in (f"127.0.0.1:{self.puerto}", f"localhost:{self.puerto}")
        return host_ok and secrets.compare_digest(self.headers.get("X-App-Clave", ""), self.clave_app)

    def _json(self):
        largo = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(largo).decode("utf-8") or "{}")
        except ValueError:
            return {}

    def _parroquia(self, valor):
        p = str(valor or "montecarmelo").strip().lower()
        return p if SLUG.match(p) else None

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith("/local/"):
            if not self._autorizado():
                return self._responder(403, {"ok": False, "error": "No autorizado"})
            params = dict(urllib.parse.parse_qsl(url.query))
            if url.path == "/local/estado":
                return self._responder(200, {"ok": True, **self.sitio.estado()})
            if url.path == "/local/estructura":
                return self._responder(200, {"ok": True, **estructura()})
            if url.path == "/local/leer":
                parroquia = self._parroquia(params.pop("destino", ""))
                if not parroquia:
                    return self._responder(200, {"ok": False, "error": "Parroquia inválida"})
                return self._responder(200, self.sitio.get(parroquia, params))
            return self._responder(404, {"ok": False, "error": "No encontrado"})
        nombre = "index.html" if url.path in ("/", "/index.html") else url.path.lstrip("/")
        archivo = (APP / nombre).resolve()
        if APP not in archivo.parents or not archivo.is_file():
            return self._responder(404, b"No encontrado", "text/plain; charset=utf-8")
        cuerpo = archivo.read_bytes()
        if archivo.name == "index.html":
            cuerpo = cuerpo.replace(b"__CLAVE_APP__", self.clave_app.encode("ascii"))
        self._responder(200, cuerpo, TIPOS.get(archivo.suffix, "application/octet-stream"))

    def do_POST(self):
        if not self._autorizado():
            return self._responder(403, {"ok": False, "error": "No autorizado"})
        url = urllib.parse.urlsplit(self.path)
        datos = self._json()
        if url.path == "/local/clave":
            token = str(datos.get("token") or "").strip()
            if not mc.clave_vigente(token):
                return self._responder(200, {"ok": False, "error": "Esa clave no es válida o ya venció. Copiala de nuevo desde la página."})
            self.sitio.guardar_clave(token)
            return self._responder(200, {"ok": True, **self.sitio.estado()})
        # {destino: la parroquia de la dirección /<destino>/api, datos: {accion, …}} (datos puede traer su propio «parroquia»)
        if url.path == "/local/api":
            parroquia = self._parroquia(datos.get("destino"))
            if not parroquia:
                return self._responder(200, {"ok": False, "error": "Parroquia inválida"})
            if not self.sitio.token:
                return self._responder(200, {"ok": False, "error": "Falta la clave del administrador general."})
            return self._responder(200, self.sitio.post(parroquia, datos.get("datos") or {}))
        if url.path == "/local/salir":
            self._responder(200, {"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return None
        return self._responder(404, {"ok": False, "error": "No encontrado"})

    def do_PUT(self):
        if not self._autorizado():
            return self._responder(403, {"ok": False, "error": "No autorizado"})
        url = urllib.parse.urlsplit(self.path)
        if url.path != "/local/subir":
            return self._responder(404, {"ok": False, "error": "No encontrado"})
        params = dict(urllib.parse.parse_qsl(url.query))
        parroquia = self._parroquia(params.pop("destino", ""))
        largo = int(self.headers.get("Content-Length") or 0)
        if not parroquia or not largo or largo > MAX_SUBIDA:
            return self._responder(200, {"ok": False, "error": "Archivo vacío, demasiado grande o parroquia inválida"})
        cuerpo = self.rfile.read(largo)
        tipo = self.headers.get("Content-Type") or "application/octet-stream"
        return self._responder(200, self.sitio.subir(parroquia, params, tipo, cuerpo))


def main():
    ap = argparse.ArgumentParser(description="Ver el sitio y crear parroquias del Cancionero Litúrgico")
    ap.add_argument("--sitio", default=mc.SITIO_URL, help="dirección del sitio (por defecto %(default)s)")
    ap.add_argument("--puerto", type=int, default=8790)
    ap.add_argument("--sin-navegador", action="store_true", help="no abrir el navegador")
    args = ap.parse_args()

    Manejador.sitio = Sitio(args.sitio)
    Manejador.clave_app = secrets.token_urlsafe(24)
    Manejador.puerto = args.puerto
    direccion = f"http://127.0.0.1:{args.puerto}/"
    try:
        servidor = ThreadingHTTPServer(("127.0.0.1", args.puerto), Manejador)
    except OSError:
        # Ya está abierta (o el puerto está ocupado): se abre esa
        print(f"El puerto {args.puerto} está ocupado; si la app ya estaba abierta, sigue en {direccion}")
        if not args.sin_navegador:
            webbrowser.open(direccion)
        return
    print(f"Parroquias del Cancionero: {direccion}  (sitio: {Manejador.sitio.url}). Ctrl+C para cerrar.")
    if not args.sin_navegador:
        threading.Timer(0.4, lambda: webbrowser.open(direccion)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    servidor.server_close()


if __name__ == "__main__":
    main()
