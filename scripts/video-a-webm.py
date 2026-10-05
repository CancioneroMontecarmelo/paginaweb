#!/usr/bin/env python3
"""
video-a-webm.py — Saca el audio de videos (archivos o enlaces de YouTube, Vimeo, TikTok…), lo deja en
WebM (Opus, 48 kHz, como los audios de la Biblioteca) y lo sube a la Biblioteca de la parroquia con su
título, etiquetas, letra y voz.

    scripts/video-a-webm.py VIDEO_O_ENLACE [...] --cancion "Santo Fones" \
        --etiquetas "Santo, Tiempo ordinario" --letra santo.txt --voz soprano \
        --comunidad monte-carmelo [--sin-subir] [--salida carpeta/]

Con --cancion, todos los videos son audios de esa canción (por ejemplo, una voz por archivo). Sin
--cancion, cada video es una canción con el título del video o del archivo.

Si la canción ya está en la Biblioteca, el audio se le suma; su letra solo se reemplaza si se da --letra
(y se pregunta antes). Las etiquetas nuevas se agregan a las que tenía.

Necesita ffmpeg y, para los enlaces, yt-dlp. La clave se copia en el sitio: Identificarse → «Copiar clave
para el script». Se guarda en ~/.config/montecarmelo/sesion.json.
"""

import argparse
import base64
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SITIO_URL = "https://cancioneromontecarmelo.github.io/paginaweb/"
API_POR_DEFECTO = ("https://script.google.com/macros/s/AKfycbypubIfWZ2gsFaSnCEBj7Cy5Rcp3SPCloukVlz7bFF2ZzLB2rv_jg0_oSGe_raQ897X/exec")
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "montecarmelo" / "sesion.json"
MAX_BYTES = 30 * 1024 * 1024  # MAX_ARCHIVO_BYTES en backend/Code.gs
COMUNIDADES = {
    "maria-de-nazaret": "Capilla María de Nazaret",
    "san-pablo-apostol": "San Pablo Apóstol",
    "sagrada-familia": "Sagrada Familia",
    "monte-carmelo": "Nuestra Señora del Monte Carmelo",
}
VOCES = {"todas": "Todas", "unica": "Única", "tenor": "Tenor", "soprano": "Soprano", "bajo": "Bajo",
         "mezzosoprano": "Mezzosoprano", "castrati": "Castrati"}  # VOICES en editor/js/acordes.js
EXT_VIDEO_AUDIO = re.compile(r"\.(mp4|m4v|mkv|webm|mov|avi|3gp|flv|wmv|mpg|mpeg|ts|mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|amr|wma|aiff?)$", re.I)


class Error(Exception):
    pass


def aviso(*partes):
    print(*partes, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- textos

def slug(s):
    """El mismo que slug_ en backend/Code.gs: el id de la canción es «c-» + slug(título)."""
    s = unicodedata.normalize("NFD", str(s or ""))
    s = re.sub(r"[\u0300-\u036f]", "", s).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60]
    return s or "cancionero"


def tag_norm(s):
    s = unicodedata.normalize("NFD", str(s))
    return re.sub(r"[^a-z0-9]+", " ", re.sub(r"[\u0300-\u036f]", "", s).lower()).strip()


def limpiar_tag(s):
    return re.sub(r"\s+", " ", re.sub(r"[,\n\r]+", " ", str(s))).strip()


def vocabulario_etiquetas():
    """Etiquetas canónicas del sitio (editor/js/etiquetas.js), para escribirlas igual que el editor."""
    try:
        js = (RAIZ / "editor" / "js" / "etiquetas.js").read_text(encoding="utf-8")
    except OSError:
        return {}
    canon = {}
    for bloque in re.findall(r"(?:tags|label):\s*(\[[^\]]*\]|'[^']*')", js):
        for t in re.findall(r"'([^']*)'", bloque):
            canon.setdefault(tag_norm(t), t)
    return canon


def etiquetas_de(texto, canon):
    vistas, salida = set(), []
    for t in str(texto or "").split(","):
        t = limpiar_tag(t)
        k = tag_norm(t)
        if k and k not in vistas:
            vistas.add(k)
            salida.append(canon.get(k, t))
    return salida


def unir_etiquetas(*listas):
    vistas, salida = set(), []
    for lista in listas:
        for t in lista or []:
            k = tag_norm(t)
            if k and k not in vistas:
                vistas.add(k)
                salida.append(t)
    return salida


ACORDE_CP = re.compile(r"\[(?:[A-G]|Do|Re|Mi|Fa|Sol|La|Si)[^\]\s]{0,10}\]")


def chordpro_a_texto(texto):
    """[Do]Noche de [Sol]paz → acordes en una línea sobre la letra, como los escribe el editor."""
    salida = []
    for linea in texto.split("\n"):
        if re.match(r"^\s*\{.*\}\s*$", linea):
            continue
        if not ACORDE_CP.search(linea):
            salida.append(linea)
            continue
        acordes, letra = "", ""
        for parte in re.split(r"(\[[^\]]+\])", linea):
            if ACORDE_CP.fullmatch(parte):
                pos = len(letra)
                if acordes and len(acordes) + 1 > pos:
                    letra += " " * (len(acordes) + 1 - pos)
                    pos = len(letra)
                acordes = acordes.ljust(pos) + parte[1:-1]
            else:
                letra += parte
        salida += [acordes.rstrip(), letra.rstrip()]
    return "\n".join(salida)


def leer_letra(ruta):
    texto = Path(ruta).read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    if Path(ruta).suffix.lower() in (".md", ".markdown"):
        m = re.search(r"(`{3,}|~{3,})cancion[^\n]*\n([\s\S]*?)\n\1", texto)
        if m:
            texto = m.group(2)
        else:
            texto = re.sub(r"^---\n[\s\S]*?\n---\n?", "", texto)
            texto = re.sub(r"^#\s+.*$", "", texto, count=1, flags=re.M)
            texto = re.sub(r"<audio\b[^>]*>(\s*</audio>)?", "", texto)
    elif ACORDE_CP.search(texto) or re.search(r"^\s*\{(title|t|start_of_chorus|soc)\b", texto, re.M):
        texto = chordpro_a_texto(texto)
    return texto.strip("\n")


def escapar_atributo(s):
    return str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def armar_md(titulo, etiquetas, letra, tono="", autor="", audios=()):
    """El .md de una canción, con el formato del editor (editor/js/markdown.js) y de mdDeAudio en js/misas.js."""
    salida = ["---", f"titulo: {json.dumps(titulo, ensure_ascii=False)}"]
    if tono:
        salida.append(f"tono: {json.dumps(tono, ensure_ascii=False)}")
    if etiquetas:
        salida.append("etiquetas: " + ", ".join(etiquetas))
    if autor:
        salida.append(f"autor: {json.dumps(autor, ensure_ascii=False)}")
    salida += [f"exportado: {time.strftime('%Y-%m-%d')}", "generador: \"video-a-webm\"", "---", "", f"# {titulo}", ""]
    if tono:
        salida += [f"**Tono:** {tono}", ""]
    tildes = max([2] + [len(x) for x in re.findall(r"`+", letra or "")])
    valla = "`" * (tildes + 1)
    salida += [valla + "cancion", letra or "", valla]
    for a in audios:
        voz = f' data-voz="{escapar_atributo(a["voz"])}"' if a.get("voz") else ""
        origen = f' data-origen="{escapar_atributo(a["origen"])}"' if a.get("origen") else ""
        salida += ["", f'<audio controls src="{escapar_atributo(a["src"])}" title="{escapar_atributo(a["nombre"])}"{voz}{origen}></audio>']
    return "\n".join(salida) + "\n"


def cambiar_etiquetas_md(texto, etiquetas):
    """Reescribe la línea «etiquetas:» de la cabecera de un .md de la Biblioteca."""
    linea = "etiquetas: " + ", ".join(etiquetas)
    m = re.match(r"^---\n([\s\S]*?)\n---", texto)
    if not m:
        return f"---\n{linea}\n---\n\n" + texto
    cab = m.group(1)
    if re.search(r"^(etiquetas|tags):.*$", cab, re.M):
        cab = re.sub(r"^(etiquetas|tags):.*$", linea, cab, count=1, flags=re.M)
    else:
        cab += "\n" + linea
    return "---\n" + cab + "\n---" + texto[m.end():]


def nombre_archivo(s):
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(s)).strip(" .")
    return re.sub(r"\s+", " ", s)[:120] or "audio"


# ---------------------------------------------------------------- audio

def exigir(programa, ayuda):
    if not shutil.which(programa):
        raise Error(f"Falta {programa}. {ayuda}")


def es_enlace(s):
    return bool(re.match(r"^https?://", s, re.I))


# YouTube cambia seguido y el yt-dlp de la distribución queda viejo: si falla, se usa una copia propia al día
YTDLP_PROPIO = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "montecarmelo" / "yt-dlp"
YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"


def ytdlp_propio(actualizar=False):
    if YTDLP_PROPIO.exists() and not actualizar:
        return str(YTDLP_PROPIO)
    if YTDLP_PROPIO.exists():
        aviso("  Actualizando yt-dlp…")
        subprocess.run([str(YTDLP_PROPIO), "-U"], capture_output=True)
        return str(YTDLP_PROPIO)
    aviso(f"  Bajando la última versión de yt-dlp a {YTDLP_PROPIO} …")
    YTDLP_PROPIO.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(YTDLP_URL, timeout=120) as res:
            YTDLP_PROPIO.write_bytes(res.read())
    except urllib.error.URLError as e:
        raise Error(f"No se pudo bajar yt-dlp: {e}")
    YTDLP_PROPIO.chmod(0o755)
    return str(YTDLP_PROPIO)


def correr_ytdlp(programa, url, carpeta):
    r = subprocess.run(
        [programa, "--no-playlist", "--no-warnings", "-f", "bestaudio/best", "-o", str(Path(carpeta) / "%(id)s.%(ext)s"),
         "--print", "%(title)s", "--print", "after_move:filepath", "--no-simulate", url],
        capture_output=True, text=True)
    lineas = [x for x in r.stdout.splitlines() if x.strip()]
    if r.returncode or len(lineas) < 2 or not Path(lineas[-1]).exists():
        return None, (r.stderr.strip().splitlines() or ["sin detalle"])[-1]
    return (Path(lineas[-1]), lineas[0].strip()), ""


def bajar_enlace(url, carpeta):
    """Baja el mejor audio del enlace con yt-dlp. Devuelve (archivo, título)."""
    aviso(f"  Bajando el audio de {url} …")
    intentos = [os.environ["YTDLP"]] if os.environ.get("YTDLP") else []
    intentos += [str(YTDLP_PROPIO)] if YTDLP_PROPIO.exists() else [p for p in [shutil.which("yt-dlp")] if p]
    detalle = "no está instalado"
    for programa in intentos:
        hecho, detalle = correr_ytdlp(programa, url, carpeta)
        if hecho:
            return hecho
    if not os.environ.get("YTDLP"):
        hecho, detalle = correr_ytdlp(ytdlp_propio(actualizar=YTDLP_PROPIO.exists()), url, carpeta)
        if hecho:
            return hecho
    raise Error(f"yt-dlp no pudo bajar {url}: {detalle}")


def canales_y_duracion(archivo):
    exigir("ffprobe", "Viene con ffmpeg: sudo apt install ffmpeg")
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels:format=duration",
                        "-of", "json", str(archivo)], capture_output=True, text=True)
    try:
        datos = json.loads(r.stdout or "{}")
    except ValueError:
        datos = {}
    if r.returncode or not datos.get("streams"):
        raise Error(f"«{Path(archivo).name}» no tiene sonido (o ffmpeg no lo sabe leer).")
    return int(datos["streams"][0].get("channels") or 2), float(datos.get("format", {}).get("duration") or 0)


def a_webm(origen, destino, titulo, letra=""):
    """Opus a 48 kHz: 96 kbps en estéreo y 64 kbps en mono, igual que aWebm en js/audio-webm.js."""
    exigir("ffmpeg", "Instalalo con: sudo apt install ffmpeg")
    canales, duracion = canales_y_duracion(origen)
    canales = 1 if canales == 1 else 2
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(origen), "-vn", "-sn", "-dn", "-map", "0:a:0",
           "-map_metadata", "-1", "-c:a", "libopus", "-b:a", "96k" if canales == 2 else "64k", "-ac", str(canales), "-ar", "48000",
           "-metadata", f"title={titulo}"]
    if letra:
        cmd += ["-metadata", f"LYRICS={letra}"]
    subprocess.run(cmd + [str(destino)], check=True)
    tam = Path(destino).stat().st_size
    if tam > MAX_BYTES:
        raise Error(f"«{Path(destino).name}» pesa {tam / 1048576:.1f} MB y la Biblioteca acepta hasta 30 MB: recortá el video "
                    f"(por ejemplo: ffmpeg -ss 0:30 -to 5:00 -i entrada salida) y probá de nuevo.")
    return tam, duracion


# ---------------------------------------------------------------- servidor de la parroquia

def api_de_config():
    try:
        m = re.search(r"apiUrl:\s*'([^']+)'", (RAIZ / "js" / "config.js").read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    except OSError:
        pass
    return API_POR_DEFECTO


class Api:
    def __init__(self, url, token):
        self.url, self.token = url, token

    def _leer(self, pedido):
        try:
            with urllib.request.urlopen(pedido, timeout=600) as res:
                r = json.loads(res.read().decode("utf-8"))
        except urllib.error.URLError as e:
            raise Error(f"No se pudo conectar con el servidor de la parroquia: {e}")
        except ValueError:
            raise Error("El servidor de la parroquia respondió algo que no se entiende.")
        if not r.get("ok"):
            raise Error(r.get("error") or "El servidor de la parroquia no respondió.")
        if r.get("token") and r["token"] != self.token:
            self.token = r["token"]
            guardar_clave(self.token)
        return r

    def get(self, **params):
        return self._leer(urllib.request.Request(self.url + "?" + urllib.parse.urlencode(params)))

    def post(self, accion, **datos):
        cuerpo = json.dumps({"accion": accion, "token": self.token, **datos}).encode("utf-8")
        # Apps Script responde con una redirección a la respuesta: urllib la sigue con GET, que es lo que pide
        return self._leer(urllib.request.Request(self.url, data=cuerpo, headers={"Content-Type": "text/plain;charset=utf-8"}))


def datos_clave(token):
    try:
        carga = token.split(".")[0]
        return json.loads(base64.urlsafe_b64decode(carga + "=" * (-len(carga) % 4)))
    except Exception:
        return None


def clave_vigente(token):
    d = datos_clave(token or "")
    return bool(d and d.get("email") and d.get("exp", 0) > time.time() * 1000 + 60000)


def guardar_clave(token):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps({"token": token}), encoding="utf-8")
    os.chmod(CONFIG, 0o600)


def obtener_clave(dada):
    if dada:
        if not clave_vigente(dada):
            raise Error("La clave dada no sirve o venció. Copiá una nueva en el sitio: Identificarse → «Copiar clave para el script».")
        guardar_clave(dada)
        return dada
    try:
        token = json.loads(CONFIG.read_text(encoding="utf-8")).get("token", "")
    except (OSError, ValueError):
        token = ""
    if clave_vigente(token):
        return token
    aviso("\nPara subir a la Biblioteca hace falta tu clave del sitio (dura 90 días).")
    aviso(f"Entrá a {SITIO_URL}login.html con tu cuenta y tocá «Copiar clave para el script».")
    if not sys.stdin.isatty():
        raise Error("No hay clave guardada: corré el script en una terminal para pegarla, o usá --clave.")
    token = getpass.getpass("Pegá la clave aquí (no se ve al pegar) y apretá Enter: ").strip()
    if not clave_vigente(token):
        raise Error("Esa clave no sirve o venció. Copiá una nueva en el sitio.")
    guardar_clave(token)
    aviso(f"Clave guardada en {CONFIG}")
    return token


def confirmar(pregunta, si):
    if si:
        return True
    if not sys.stdin.isatty():
        return False
    return input(pregunta + " [s/N] ").strip().lower() in ("s", "si", "sí", "y", "yes")


def subir_cancion(api, cancion, biblioteca, comunidad, si):
    """Sube los audios de una canción y la crea o la completa en la Biblioteca. Devuelve la entrada del índice."""
    cid = "c-" + slug(cancion["titulo"])
    previa = next((c for c in biblioteca if c.get("id") == cid), None)
    if previa:
        aviso(f"  «{previa['titulo']}» ya está en la Biblioteca: el audio se le suma.")
    reemplazar_letra = bool(cancion["letra"])
    if previa and reemplazar_letra and not previa.get("soloAudio"):
        reemplazar_letra = confirmar(f"  «{previa['titulo']}» ya tiene letra. ¿Reemplazarla por la de {cancion['letra_de']}?", si)
        if not reemplazar_letra:
            aviso("  Se deja la letra que tenía.")

    nuevos = []
    for i, a in enumerate(cancion["audios"], 1):
        aviso(f"  Subiendo el audio {i} de {len(cancion['audios'])} ({a['bytes'] / 1048576:.1f} MB)…")
        r = api.post("subirAudioBiblioteca", nombre=a["archivo"].name, mime="audio/webm",
                     base64=base64.b64encode(a["archivo"].read_bytes()).decode("ascii"),
                     cancion=previa["titulo"] if previa else cancion["titulo"], voz=a["voz"])
        nuevos.append({"nombre": a["nombre"], "voz": a["voz"], "fileId": r["fileId"]})

    etiquetas = unir_etiquetas(previa.get("etiquetas") if previa else [], cancion["etiquetas"])
    etiquetas_nuevas = previa is not None and len(etiquetas) > len(previa.get("etiquetas") or [])
    if previa and not reemplazar_letra and not etiquetas_nuevas:
        return api.post("vincularAudio", cancionId=cid, audios=nuevos)["cancion"]

    if previa and not reemplazar_letra:
        texto = cambiar_etiquetas_md(api.get(accion="cancion", id=cid)["texto"], etiquetas)
    else:
        texto = armar_md(previa["titulo"] if previa else cancion["titulo"], etiquetas, cancion["letra"],
                         cancion["tono"] or (previa or {}).get("tono", ""), cancion["autor"])
    anteriores = []
    if previa:
        for a in previa.get("audios") or []:
            if a.get("fileId"):
                anteriores.append({"nombre": a.get("nombre", ""), "voz": a.get("voz", ""), "fileId": a["fileId"]})
            elif a.get("url"):
                anteriores.append({"nombre": a.get("nombre", ""), "voz": a.get("voz", ""), "url": a["url"]})
    r = api.post("subirCancion", md=texto, nombre=slug(cancion["titulo"]) + ".md", comunidad=comunidad or "",
                 audios=anteriores + nuevos)
    return r["cancion"]


def momentos_en_misas(api, cid):
    try:
        misas = api.get(accion="misas").get("misas") or []
    except Error:
        return []
    return [f"{m.get('nombre') or 'Cancionero'} ({m.get('fechaUso') or 'sin fecha'}): {mo.get('momento')}"
            for m in misas for mo in m.get("momentos") or []
            if any(c.get("cancionId") == cid for c in mo.get("canciones") or [])]


# ---------------------------------------------------------------- principal

def argumentos():
    p = argparse.ArgumentParser(
        prog="video-a-webm.py",
        description="Saca el audio de videos o enlaces, lo deja en WebM (Opus) y lo sube a la Biblioteca de la parroquia.",
        epilog="Ejemplos:\n"
               "  scripts/video-a-webm.py https://youtu.be/XXXX --cancion \"Santo Fones\" --etiquetas \"Santo\"\n"
               "  scripts/video-a-webm.py coro-soprano.mp4 coro-tenor.mp4 --cancion \"Gloria\" --voz soprano --voz tenor\n"
               "  scripts/video-a-webm.py ensayo.mov --letra letra.txt --sin-subir --salida ~/Música/webm",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("entradas", nargs="+", metavar="VIDEO_O_ENLACE", help="archivos de video o audio, o enlaces (YouTube, Vimeo, TikTok…)")
    p.add_argument("-c", "--cancion", help="título de la canción (todos los videos van a esta canción)")
    p.add_argument("-e", "--etiquetas", default="", help='etiquetas separadas por coma, por ejemplo "Entrada, Tiempo ordinario"')
    p.add_argument("-l", "--letra", help="archivo con la letra y acordes (.txt, ChordPro o un .md del editor)")
    p.add_argument("-v", "--voz", action="append", choices=list(VOCES), help="voz del audio; repetila para dar una por video, en orden")
    p.add_argument("-n", "--nombre", action="append", help="nombre del audio (por defecto, el título del video); repetible")
    p.add_argument("--comunidad", choices=list(COMUNIDADES), help="comunidad dueña de la canción nueva (por defecto, la tuya)")
    p.add_argument("--tono", default="", help='tono de la canción, por ejemplo "Sol mayor" (el editor lo calcula solo si falta)')
    p.add_argument("--autor", default="", help="autor o intérprete")
    p.add_argument("-o", "--salida", default=".", help="carpeta donde quedan el .webm y el .md (por defecto, la actual)")
    p.add_argument("--sin-subir", action="store_true", help="solo convertir y armar el .md, sin subir nada")
    p.add_argument("--si", action="store_true", help="responder que sí a las preguntas (reemplazar la letra de una canción existente)")
    p.add_argument("--clave", help="clave del sitio (Identificarse → «Copiar clave para el script»); queda guardada")
    p.add_argument("--olvidar-clave", action="store_true", help="borra la clave guardada en esta computadora")
    p.add_argument("--api", default=None, help="dirección del servidor (por defecto, apiUrl de js/config.js)")
    return p.parse_args()


def por_indice(lista, i, total):
    if not lista:
        return None
    if len(lista) == 1:
        return lista[0]
    if len(lista) != total:
        raise Error(f"Diste {len(lista)} valores pero hay {total} videos: da uno solo (para todos) o uno por video.")
    return lista[i]


def main():
    args = argumentos()
    if args.olvidar_clave and CONFIG.exists():
        CONFIG.unlink()
        aviso(f"Clave borrada de {CONFIG}")
    for e in args.entradas:
        if not es_enlace(e) and not Path(e).is_file():
            raise Error(f"No existe el archivo «{e}».")
        if not es_enlace(e) and not EXT_VIDEO_AUDIO.search(e):
            aviso(f"Ojo: «{e}» no parece un video ni un audio; se intenta igual.")
    canon = vocabulario_etiquetas()
    etiquetas = etiquetas_de(args.etiquetas, canon)
    letra = leer_letra(args.letra) if args.letra else ""
    salida = Path(args.salida).expanduser()
    salida.mkdir(parents=True, exist_ok=True)

    api = None
    if not args.sin_subir:
        api = Api(args.api or api_de_config(), obtener_clave(args.clave))
        d = datos_clave(api.token)
        aviso(f"Sesión: {d['email']} (la clave vence el {time.strftime('%d/%m/%Y', time.localtime(d['exp'] / 1000))})")

    canciones = {}
    total = len(args.entradas)
    with tempfile.TemporaryDirectory(prefix="video-a-webm-") as tmp:
        for i, e in enumerate(args.entradas):
            aviso(f"\n[{i + 1}/{total}] {e}")
            if es_enlace(e):
                origen, titulo_fuente = bajar_enlace(e, tmp)
            else:
                origen, titulo_fuente = Path(e), Path(e).stem
            titulo = (args.cancion or titulo_fuente).strip()[:150] or "Sin título"
            voz = por_indice(args.voz, i, total) or "todas"
            voz = "" if voz == "todas" else voz
            nombre = (por_indice(args.nombre, i, total) or titulo_fuente).strip()[:150]
            base = nombre_archivo(titulo + (" - " + VOCES[voz] if voz else ""))
            destino = salida / f"{base}.webm"
            n = 2
            while destino.exists() or any(destino == a["archivo"] for c in canciones.values() for a in c["audios"]):
                destino = salida / f"{base} ({n}).webm"
                n += 1
            aviso(f"  Convirtiendo a WebM (Opus, 48 kHz)…")
            tam, duracion = a_webm(origen, destino, titulo, letra)
            aviso(f"  Listo: {destino} · {tam / 1048576:.1f} MB · {int(duracion // 60)}:{int(duracion % 60):02d}")
            c = canciones.setdefault(slug(titulo), {
                "titulo": titulo, "etiquetas": etiquetas, "letra": letra, "letra_de": args.letra or "",
                "tono": args.tono, "autor": args.autor, "audios": []})
            c["audios"].append({"archivo": destino, "nombre": nombre, "voz": voz, "bytes": tam,
                                "origen": e if es_enlace(e) else ""})

    for c in canciones.values():
        md = salida / f"{nombre_archivo(c['titulo'])}.md"
        md.write_text(armar_md(c["titulo"], c["etiquetas"], c["letra"], c["tono"], c["autor"],
                               [{"src": a["archivo"].name, "nombre": a["nombre"], "voz": a["voz"], "origen": a["origen"]}
                                for a in c["audios"]]), encoding="utf-8")
        aviso(f"\nCanción «{c['titulo']}»: {md}")

    if args.sin_subir:
        aviso("\nNo se subió nada (--sin-subir). Para subirlo después: Misas → Subir, o corré el script sin --sin-subir.")
        return

    biblioteca = api.get(accion="biblioteca").get("canciones") or []
    for c in canciones.values():
        aviso(f"\nSubiendo «{c['titulo']}» a la Biblioteca…")
        e = subir_cancion(api, c, biblioteca, args.comunidad, args.si)
        biblioteca = [x for x in biblioteca if x.get("id") != e["id"]] + [e]
        audios = e.get("audios") or []
        aviso(f"  ✓ «{e['titulo']}» en la Biblioteca: {len(audios)} {'audio' if len(audios) == 1 else 'audios'}"
              + (f" · etiquetas: {', '.join(e.get('etiquetas') or [])}" if e.get("etiquetas") else ""))
        for a in audios[-len(c["audios"]):]:
            if a.get("fileId"):
                aviso(f"    {a.get('nombre')}: https://drive.google.com/file/d/{a['fileId']}/view")
        momentos = momentos_en_misas(api, e["id"])
        if momentos:
            aviso("  Aparece en Misas: " + "; ".join(momentos))
        aviso(f"  Para completar la letra y los acordes: {SITIO_URL}editor/ → Archivo → Abrir → Canción de la Biblioteca")


if __name__ == "__main__":
    try:
        main()
    except Error as e:
        aviso(f"\nError: {e}")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        aviso(f"\nError: falló {e.cmd[0]} (código {e.returncode}).")
        sys.exit(1)
    except KeyboardInterrupt:
        aviso("\nCancelado.")
        sys.exit(130)
