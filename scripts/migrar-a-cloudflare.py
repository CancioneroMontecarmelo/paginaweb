#!/usr/bin/env python3
"""
migrar-a-cloudflare.py — Copia todo lo del Drive de la parroquia (Apps Script) al sitio nuevo en Cloudflare:
los datos van a la base D1 y los archivos (audios, partituras y cancioneros) al almacenamiento R2.

Se puede correr las veces que haga falta: guarda lo bajado en migracion/ y no vuelve a subir lo que ya subió.
La base del sitio nuevo se reemplaza entera en cada corrida (lo que se haya probado en el sitio nuevo se borra).

Antes:
  1. Pegar backend/Code.gs en el editor de Apps Script y publicar una versión nueva (trae exportarTodo).
  2. npx wrangler login, y la base y el almacenamiento creados (ver README).
  3. Una clave de administrador general: login.html → «Copiar clave para el script».

Uso:
  python3 scripts/migrar-a-cloudflare.py --sitio https://montecarmelo.pages.dev/
  python3 scripts/migrar-a-cloudflare.py --sitio http://127.0.0.1:8788/ --local     (prueba con wrangler pages dev)

Para la mudanza definitiva: en el editor de Apps Script ejecutar congelarCambios(), correr este script otra vez
y recién después publicar el sitio nuevo.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mc_biblioteca as mc  # noqa: E402

RAIZ = mc.RAIZ
CARPETA = RAIZ / "migracion"
ARCHIVOS = CARPETA / "archivos"
REESCRITOS = CARPETA / "reescritos"
EXPORT = CARPETA / "export.json"
SUBIDOS = CARPETA / "r2-subidos.json"
SQL = CARPETA / "datos.sql"
BASE = "montecarmelo"
BUCKET = "montecarmelo-archivos"
AGENTE = "MonteCarmelo-migracion/1.0"

DRIVE_URL = re.compile(r"https?://(?:drive\.google\.com|drive\.usercontent\.google\.com|docs\.google\.com)/[^\s)<>\"'\\]+")
ID_DRIVE = re.compile(r"(?:[?&;]id=|/d/)([\w-]{10,})")
API_VIEJA = re.compile(r"https://script\.google\.com/macros/s/[\w-]+/exec")
TEXTO = re.compile(r"\.(md|m3u8?|html?|txt|json|css|js)$", re.I)


def leer_json(ruta, defecto):
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return defecto


def escribir_json(ruta, obj):
    tmp = Path(str(ruta) + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    tmp.replace(ruta)


def pedido(url, datos=None, cabeceras=None, tiempo=600):
    h = {"User-Agent": AGENTE}
    h.update(cabeceras or {})
    return urllib.request.urlopen(urllib.request.Request(url, data=datos, headers=h), timeout=tiempo)


def post(url, token, accion, **datos):
    cuerpo = json.dumps({"accion": accion, "token": token, **datos}).encode("utf-8")
    for intento in range(4):
        try:
            with pedido(url, cuerpo, {"Content-Type": "text/plain;charset=utf-8"}) as res:
                r = json.loads(res.read().decode("utf-8"))
            break
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            if intento == 3:
                raise mc.Error(f"{accion}: {e}")
            time.sleep(5 * (intento + 1))
    if not r.get("ok"):
        raise mc.Error(f"{accion}: {r.get('error') or 'sin respuesta'}")
    return r


def wrangler(*args, entrada=None):
    cmd = ["npx", "--no-install", "wrangler", *args]
    r = subprocess.run(cmd, cwd=RAIZ, env={**os.environ, "CI": "1"}, capture_output=True, text=True, input=entrada)
    if r.returncode != 0:
        raise mc.Error("wrangler " + " ".join(args[:3]) + " falló:\n" + (r.stderr or r.stdout)[-2000:])
    return r.stdout


# ---------------------------------------------------------------- 1. exportar del Apps Script

def exportar(api_vieja, token):
    mc.aviso("1/5 Exportando los datos del Drive…")
    todo = {"datos": None, "md": {}, "audios": [], "partituras": [], "cancioneros": {}, "lecturas": {}}
    cursor = None
    while True:
        r = post(api_vieja, token, "exportarTodo", cursor=cursor)
        if r.get("datos"):
            todo["datos"] = r["datos"]
        todo["md"].update(r.get("md") or {})
        if r.get("etapa") in ("audios", "partituras"):
            todo[r["etapa"]].extend(r.get("archivos") or [])
        todo["cancioneros"].update(r.get("cancioneros") or {})
        todo["lecturas"].update(r.get("lecturas") or {})
        cursor = r.get("cursor")
        if not cursor:
            break
        mc.aviso(f"   … {cursor['etapa']} desde {cursor.get('i', 0)}")
    d = todo["datos"]
    mc.aviso(f"   {len(d['biblioteca'].get('canciones', []))} canciones, {len(todo['audios'])} audios, "
             f"{len(todo['partituras'])} partituras, {len(todo['cancioneros'])} cancioneros, "
             f"{len((d.get('misas') or {}).get('misas', []))} cancioneros de misa")
    escribir_json(EXPORT, todo)
    return todo


# ---------------------------------------------------------------- 2. bajar los archivos

def lista_de_archivos(todo):
    """[{id, tipo, r2, nombre, mime, tamano, carpeta, ruta, creado}] de todo lo que va a R2."""
    salida, vistos = [], set()
    for tipo, lista in (("audio", todo["audios"]), ("partitura", todo["partituras"])):
        for f in lista:
            if f.get("falta") or f["id"] in vistos:
                continue
            vistos.add(f["id"])
            nombre = f.get("nombre") or f["id"]
            mime = mime_audio(nombre, f.get("mime")) if tipo == "audio" else (f.get("mime") or "application/octet-stream")
            salida.append({"id": f["id"], "tipo": tipo, "r2": ("audios/" if tipo == "audio" else "partituras/") + f["id"],
                           "nombre": nombre, "mime": mime, "tamano": f.get("tamano") or 0,
                           "carpeta": f.get("carpeta") or "", "ruta": "", "creado": f.get("creado") or ""})
    for folder, lista in todo["cancioneros"].items():
        for f in lista or []:
            if f["id"] in vistos:
                continue
            vistos.add(f["id"])
            salida.append({"id": f["id"], "tipo": "cancionero", "r2": f"cancioneros/{folder}/{f['id']}",
                           "nombre": f["ruta"].split("/")[-1], "mime": f.get("mime") or "application/octet-stream",
                           "tamano": f.get("size") or 0, "carpeta": folder, "ruta": f["ruta"], "creado": ""})
    return salida


MIMES_AUDIO = {"m4a": "audio/mp4", "mp4": "audio/mp4", "aac": "audio/aac", "mp3": "audio/mpeg", "webm": "audio/webm",
               "weba": "audio/webm", "ogg": "audio/ogg", "opus": "audio/ogg", "wav": "audio/wav"}


def mime_audio(nombre, mime):
    m = re.search(r"\.([a-z0-9]{2,5})$", nombre or "", re.I)
    return MIMES_AUDIO.get(m.group(1).lower() if m else "", mime or "application/octet-stream")


def bajar_directo(fid):
    url = "https://drive.usercontent.google.com/download?" + urllib.parse.urlencode({"id": fid, "export": "download", "confirm": "t"})
    with pedido(url, tiempo=300) as res:
        if "text/html" in (res.headers.get("Content-Type") or ""):
            return None
        return res.read()


def bajar_uno(f, api_vieja, token):
    destino = ARCHIVOS / f["id"]
    if destino.exists() and (not f["tamano"] or destino.stat().st_size == f["tamano"]):
        return False
    datos = None
    if f["tipo"] != "cancionero":
        try:
            datos = bajar_directo(f["id"])
        except (urllib.error.URLError, TimeoutError):
            datos = None
    if datos is None or (f["tamano"] and len(datos) != f["tamano"]):
        r = post(api_vieja, token, "exportarArchivo", id=f["id"])
        datos = base64.b64decode(r["base64"])
    tmp = destino.with_suffix(".tmp")
    tmp.write_bytes(datos)
    tmp.replace(destino)
    return True


def bajar(archivos, api_vieja, token, hilos):
    ARCHIVOS.mkdir(parents=True, exist_ok=True)
    total = sum(f["tamano"] for f in archivos)
    mc.aviso(f"2/5 Bajando {len(archivos)} archivos ({total / 1048576:.0f} MB; lo ya bajado no se repite)…")
    errores, hechos = [], 0
    with ThreadPoolExecutor(hilos) as ex:
        futuros = {ex.submit(bajar_uno, f, api_vieja, token): f for f in archivos}
        for n, fut in enumerate(as_completed(futuros), 1):
            f = futuros[fut]
            try:
                hechos += fut.result()
            except Exception as e:  # noqa: BLE001
                errores.append(f)
                mc.aviso(f"   ✗ {f['nombre']} ({f['id']}): {e}")
            if n % 25 == 0:
                mc.aviso(f"   … {n}/{len(archivos)}")
    mc.aviso(f"   {hechos} bajados ahora, {len(errores)} con error")
    return errores


# ---------------------------------------------------------------- 3. reescribir enlaces y subir a R2

def reescribir(texto, sitio, audios, partituras):
    def cambio(m):
        url = m.group(0)
        i = ID_DRIVE.search(url)
        if i and i.group(1) in audios:
            return sitio + "api/audio/" + i.group(1)
        if i and i.group(1) in partituras:
            return sitio + "api/archivo/" + i.group(1)
        return url
    return API_VIEJA.sub(sitio + "api", DRIVE_URL.sub(cambio, texto))


def preparar_textos(archivos, sitio, audios, partituras):
    """Los .md/.html/.m3u8 de los cancioneros con los enlaces nuevos (en migracion/reescritos/)."""
    REESCRITOS.mkdir(parents=True, exist_ok=True)
    for f in archivos:
        origen = ARCHIVOS / f["id"]
        if f["tipo"] != "cancionero" or not TEXTO.search(f["ruta"]) or not origen.exists():
            continue
        try:
            texto = origen.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        nuevo = reescribir(texto, sitio, audios, partituras)
        destino = REESCRITOS / f["id"]
        if nuevo != texto:
            destino.write_text(nuevo, encoding="utf-8")
        elif destino.exists():
            destino.unlink()


def archivo_final(f):
    r = REESCRITOS / f["id"]
    return r if r.exists() else ARCHIVOS / f["id"]


def huella(ruta):
    h = hashlib.md5()
    with open(ruta, "rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def subir_r2(archivos, local, hilos):
    subidos = leer_json(SUBIDOS, {}) if not local else leer_json(CARPETA / "r2-subidos-local.json", {})
    pendientes = []
    for f in archivos:
        ruta = archivo_final(f)
        if not ruta.exists():
            continue
        f["_ruta"], f["_huella"] = ruta, huella(ruta)
        f["tamano"] = ruta.stat().st_size
        if subidos.get(f["r2"]) != f["_huella"]:
            pendientes.append(f)
    mc.aviso(f"3/5 Subiendo {len(pendientes)} archivos a R2 ({len(archivos) - len(pendientes)} ya estaban)…")

    def uno(f):
        wrangler("r2", "object", "put", f"{BUCKET}/{f['r2']}", "--file", str(f["_ruta"]),
                 "--content-type", f["mime"], "--local" if local else "--remote")
        return f

    errores = []
    with ThreadPoolExecutor(hilos) as ex:
        futuros = [ex.submit(uno, f) for f in pendientes]
        for n, fut in enumerate(as_completed(futuros), 1):
            try:
                f = fut.result()
                subidos[f["r2"]] = f["_huella"]
            except mc.Error as e:
                errores.append(e)
                mc.aviso(f"   ✗ {e}")
            if n % 25 == 0:
                escribir_json(CARPETA / ("r2-subidos-local.json" if local else "r2-subidos.json"), subidos)
                mc.aviso(f"   … {n}/{len(pendientes)}")
    escribir_json(CARPETA / ("r2-subidos-local.json" if local else "r2-subidos.json"), subidos)
    return errores


# ---------------------------------------------------------------- 4. la base de datos (D1)

def orden_titulo(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return re.sub(r"[\u0300-\u036f]", "", s).lower()


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


TROZO = 25000  # caracteres: D1 no acepta sentencias de más de 100 KB


def fila_sql(tabla, valores, clave):
    """INSERT de una fila; los textos largos se cargan en trozos con UPDATE … SET col = col || '…'."""
    largos = {c: v for c, v in valores.items() if isinstance(v, str) and len(v) > TROZO}
    cols = list(valores)
    primera = {c: ("" if c in largos else v) for c, v in valores.items()}
    out = [f"INSERT OR REPLACE INTO {tabla} ({', '.join(cols)}) VALUES ({', '.join(lit(primera[c]) for c in cols)});"]
    for c, v in largos.items():
        for i in range(0, len(v), TROZO):
            out.append(f"UPDATE {tabla} SET {c} = {c} || {lit(v[i:i + TROZO])} WHERE {clave} = {lit(valores[clave])};")
    return out


def armar_sql(todo, archivos, sitio, audios, partituras):
    d = todo["datos"]
    js = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
    sql = [f"DELETE FROM {t};" for t in ("usuarios", "auditoria", "visitantes", "libro", "canciones", "archivos",
                                         "cancioneros", "misas", "coros", "actividades", "vivo", "limites")]
    sql.append("DELETE FROM sqlite_sequence WHERE name = 'auditoria';")

    for u in d.get("usuarios") or []:
        if u.get("email"):
            sql += fila_sql("usuarios", {"email": u["email"].strip().lower(), "datos": js(u)}, "email")
    for ev in reversed(d.get("auditoria") or []):
        sql.append(f"INSERT INTO auditoria (datos) VALUES ({lit(js(ev))});")
    for v in d.get("visitantes") or []:
        if v.get("email"):
            sql += fila_sql("visitantes", {"email": v["email"].strip().lower(), "ultima": v.get("ultima") or "", "datos": js(v)}, "email")
    for m in ((d.get("libro") or {}).get("mensajes") or []):
        if m.get("id"):
            sql += fila_sql("libro", {"id": m["id"], "cuando": m.get("cuando") or "", "oculto": bool(m.get("oculto")), "datos": js(m)}, "id")

    canciones = (d.get("biblioteca") or {}).get("canciones") or []
    for e in canciones:
        md = todo["md"].get(e["id"]) or ""
        e = dict(e, mdId=e["id"])
        sql += fila_sql("canciones", {"id": e["id"], "orden": orden_titulo(e.get("titulo")), "datos": js(e),
                                      "md": reescribir(md, sitio, audios, partituras)}, "id")

    for f in archivos:
        if not archivo_final(f).exists():
            continue
        sql += fila_sql("archivos", {k: f[k] for k in ("id", "tipo", "r2", "nombre", "mime", "tamano", "carpeta", "ruta")}
                        | {"creado": f["creado"] or time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}, "id")

    for e in (d.get("indice") or {}).get("cancioneros") or []:
        if todo["cancioneros"].get(e["folderId"]) is None:
            mc.aviso(f"   ! El cancionero «{e.get('titulo')}» ya no tiene carpeta en el Drive: no se copia")
            continue
        sql += fila_sql("cancioneros", {"folder_id": e["folderId"], "html_id": e.get("htmlId") or "", "comunidad": e.get("comunidad") or "",
                                        "fecha": e.get("fecha") or "", "pendiente": 0, "actualizado": e.get("actualizado") or "",
                                        "datos": js(e)}, "folder_id")

    ensayos = d.get("ensayos") or {}
    for m in ((d.get("misas") or {}).get("misas") or []):
        lect = todo["lecturas"].get(m["id"]) if m.get("lecturasPropias") else None
        sql += fila_sql("misas", {"id": m["id"], "comunidad": m.get("comunidad") or "", "orden": m.get("fechaUso") or m.get("creado") or "",
                                  "datos": js(m), "lecturas": js(lect) if lect else None,
                                  "ensayos": js(ensayos[m["id"]]) if m["id"] in ensayos else None}, "id")

    for c in d.get("coros") or []:
        sql += fila_sql("coros", {"id": c["id"], "comunidad": c.get("comunidad") or "", "datos": js(c)}, "id")
    for a in ((d.get("actividades") or {}).get("actividades") or []):
        sql += fila_sql("actividades", {"id": a["id"], "fecha": a.get("fecha") or "", "orden": (a.get("fecha") or "") + (a.get("hora") or ""),
                                        "datos": js(a)}, "id")
    SQL.write_text("\n".join(sql) + "\n", encoding="utf-8")
    return len(sql)


def cargar_d1(local):
    mc.aviso(f"4/5 Cargando la base ({'local' if local else 'Cloudflare'})…")
    wrangler("d1", "execute", BASE, "--local" if local else "--remote", "--file", str(SQL))


def rehacer_biblioteca(sitio, token):
    mc.aviso("5/5 Completando la Biblioteca en el sitio nuevo…")
    while True:
        r = post(sitio + "api", token, "rehacerBiblioteca")
        if not r.get("faltan"):
            break
        mc.aviso(f"   … faltan {r['faltan']}")


# ---------------------------------------------------------------- principal

def obtener_clave(dada):
    token = dada or mc.clave_guardada()
    if not token:
        mc.aviso(f"Entrá a {mc.SITIO_URL}login.html como administrador general y tocá «Copiar clave para el script».")
        token = input("Pegá la clave: ").strip()
    if not mc.clave_vigente(token):
        raise mc.Error("Esa clave no sirve o ya venció.")
    return token


def main():
    ap = argparse.ArgumentParser(description="Copia el Drive de la parroquia al sitio en Cloudflare.")
    ap.add_argument("--sitio", required=True, help="dirección del sitio nuevo, p. ej. https://montecarmelo.pages.dev/")
    ap.add_argument("--api-vieja", default=mc.API_POR_DEFECTO, help="dirección del Apps Script")
    ap.add_argument("--clave", help="clave de administrador general (si no, la guardada)")
    ap.add_argument("--local", action="store_true", help="cargar en la base y el R2 locales de wrangler pages dev")
    ap.add_argument("--sin-exportar", action="store_true", help="usar migracion/export.json sin volver a pedirlo")
    ap.add_argument("--hilos", type=int, default=4)
    a = ap.parse_args()
    sitio = a.sitio.rstrip("/") + "/"
    CARPETA.mkdir(exist_ok=True)
    token = obtener_clave(a.clave)

    todo = leer_json(EXPORT, None) if a.sin_exportar else None
    if not todo:
        todo = exportar(a.api_vieja, token)
    archivos = lista_de_archivos(todo)
    errores = bajar(archivos, a.api_vieja, token, a.hilos)
    audios = {f["id"] for f in archivos if f["tipo"] == "audio" and (ARCHIVOS / f["id"]).exists()}
    partituras = {f["id"] for f in archivos if f["tipo"] == "partitura" and (ARCHIVOS / f["id"]).exists()}
    preparar_textos(archivos, sitio, audios, partituras)
    errores += subir_r2(archivos, a.local, a.hilos)
    n = armar_sql(todo, archivos, sitio, audios, partituras)
    mc.aviso(f"   {n} sentencias en {SQL.relative_to(RAIZ)}")
    cargar_d1(a.local)
    rehacer_biblioteca(sitio, token)
    if errores:
        mc.aviso(f"Listo, pero {len(errores)} archivos fallaron: volvé a correr el script para reintentarlos.")
        sys.exit(1)
    mc.aviso("Listo: el sitio nuevo tiene todo lo del Drive.")


if __name__ == "__main__":
    try:
        main()
    except mc.Error as e:
        mc.aviso(f"Error: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
