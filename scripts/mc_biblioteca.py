"""
mc_biblioteca.py — Lo común a scripts/video-a-webm.py y scripts/subir-canciones.py: el servidor de la
parroquia (Apps Script), la clave guardada, el formato de las canciones .md y la conversión a AAC (.m4a).
"""

import base64
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
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SITIO_URL = "https://cancioneromontecarmelo.github.io/paginaweb/"
API_POR_DEFECTO = ("https://script.google.com/macros/s/AKfycbypubIfWZ2gsFaSnCEBj7Cy5Rcp3SPCloukVlz7bFF2ZzLB2rv_jg0_oSGe_raQ897X/exec")
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "montecarmelo" / "sesion.json"
MAX_BYTES = 30 * 1024 * 1024  # MAX_ARCHIVO_BYTES en backend/Code.gs
ARTISTA = "Parroquia Monte Carmelo"
COMUNIDADES = {
    "maria-de-nazaret": "Capilla María de Nazaret",
    "san-pablo-apostol": "San Pablo Apóstol",
    "sagrada-familia": "Sagrada Familia",
    "monte-carmelo": "Nuestra Señora del Monte Carmelo",
}
VOCES = {"todas": "Todas", "unica": "Única", "tenor": "Tenor", "soprano": "Soprano", "bajo": "Bajo",
         "mezzosoprano": "Mezzosoprano", "contralto": "Contralto", "castrati": "Castrati"}  # VOICES en editor/js/acordes.js
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


def a_m4a(origen, destino, titulo, letra=""):
    """AAC (.m4a) a 48 kHz: 96 kbps en estéreo y 64 kbps en mono, igual que aM4a en js/audio-aac.js. Suena en
    todos los equipos (iPhone, Mac, Android, PC) y con el índice al comienzo empieza a sonar sin bajarse entero."""
    exigir("ffmpeg", "Instalalo con: sudo apt install ffmpeg")
    canales, duracion = canales_y_duracion(origen)
    canales = 1 if canales == 1 else 2
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(origen), "-vn", "-sn", "-dn", "-map", "0:a:0",
           "-map_metadata", "-1", "-c:a", "aac", "-b:a", "96k" if canales == 2 else "64k", "-ac", str(canales), "-ar", "48000",
           "-movflags", "+faststart", "-metadata", f"title={titulo}", "-metadata", f"artist={ARTISTA}"]
    if letra:
        cmd += ["-metadata", f"lyrics={letra}"]
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


def clave_guardada():
    """La clave guardada si sigue vigente; si no, cadena vacía."""
    try:
        token = json.loads(CONFIG.read_text(encoding="utf-8")).get("token", "")
    except (OSError, ValueError):
        return ""
    return token if clave_vigente(token) else ""


# ---------------------------------------------------------------- canciones .md del editor en esta computadora

ETIQUETA_AUDIO = re.compile(r"[ \t]*<audio\b[^>]*>(?:\s*</audio>)?[ \t]*\n?", re.I)
PAGINA_DE_VIDEO = re.compile(r"^https?://([^/]+\.)?(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|soundcloud\.com|facebook\.com|instagram\.com)/", re.I)
CARPETAS_IGNORADAS = {"node_modules", "htmls", "pdfs imprimibles", "partituras", "audios", "__pycache__"}
# «[Escuchar](<Abandónate.webm>)»: así enlazan su audio las canciones del Copiador de canciones
ENLACE_MD = re.compile(r"^[ \t]*(?:[-*][ \t]+)?\[[^\]\n]*\]\((?:<([^>\n]+)>|([^)\s]+))\)[ \t]*(?:\n|$)", re.M)
EXT_AUDIO_LOCAL = re.compile(r"\.(webm|weba|m4a|mp3|ogg|oga|opus|wav|aac|flac|amr|wma|aiff?|mp4|m4v|mkv|mov)$", re.I)
URL_AUDIO_DRIVE = "https://drive.google.com/uc?export=download&id="


def atributo(etiqueta, nombre):
    m = re.search(r"\s" + nombre + r'="([^"]*)"', etiqueta, re.I)
    if not m:
        return ""
    return (m.group(1).replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'").replace("&amp;", "&"))


def leer_cancion_local(ruta):
    """Una canción .md del editor (cabecera con título o bloque ```cancion); None si es otro tipo de .md."""
    ruta = Path(ruta)
    texto = ruta.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    bloque = re.search(r"(`{3,}|~{3,})cancion[^\n]*\n([\s\S]*?)\n\1", texto)
    cab = re.match(r"^---\n([\s\S]*?)\n---", texto)
    meta = {}
    for linea in (cab.group(1).split("\n") if cab else []):
        k, _, v = linea.partition(":")
        v = v.strip()
        if re.fullmatch(r'".*"', v):
            try:
                v = json.loads(v)
            except ValueError:
                v = v[1:-1]
        meta[k.strip().lower()] = v
    if not bloque and not meta.get("titulo"):
        return None
    h = re.search(r"^#\s+(.+)$", texto, re.M)
    titulo = (meta.get("titulo") or meta.get("title") or (h.group(1) if h else "") or ruta.stem).strip()[:150]
    audios = []
    for m in ETIQUETA_AUDIO.finditer(texto):
        etiqueta = m.group(0)
        src = atributo(etiqueta, "src")
        if not src:
            continue
        a = {"etiqueta": etiqueta, "src": src, "nombre": atributo(etiqueta, "title") or Path(urllib.parse.unquote(src)).stem,
             "voz": "" if atributo(etiqueta, "data-voz") in ("", "todas") else atributo(etiqueta, "data-voz")}
        if es_enlace(src):
            a["tipo"] = "video" if atributo(etiqueta, "data-extraer") or PAGINA_DE_VIDEO.match(src) else "enlace"
        else:
            a["tipo"] = "local"
            a["ruta"] = (ruta.parent / urllib.parse.unquote(src.replace("file://", ""))).resolve()
            a["existe"] = a["ruta"].is_file()
        audios.append(a)
    locales = {str(a.get("ruta")) for a in audios}
    enlaces = [(m.group(0), m.group(1) or m.group(2)) for m in ENLACE_MD.finditer(texto)]
    if meta.get("audio"):
        enlaces.append(("", meta["audio"]))
    for etiqueta, src in enlaces:
        if es_enlace(src) or not EXT_AUDIO_LOCAL.search(src):
            continue
        destino = (ruta.parent / urllib.parse.unquote(src.replace("file://", ""))).resolve()
        if str(destino) in locales:
            continue
        locales.add(str(destino))
        audios.append({"etiqueta": etiqueta, "src": src, "nombre": destino.stem, "voz": "", "tipo": "local",
                       "ruta": destino, "existe": destino.is_file()})
    letra = bloque or re.search(r"(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1", texto)
    return {
        "ruta": ruta, "titulo": titulo, "id": "c-" + slug(titulo), "texto": texto, "meta": meta,
        "etiquetas": [t.strip() for t in str(meta.get("etiquetas") or meta.get("tags") or "").split(",") if t.strip()],
        "tiene_letra": bool(letra and letra.group(2).strip()), "audios": audios, "modificada": ruta.stat().st_mtime,
    }


def poner_en_cabecera(texto, clave, valor):
    """Agrega o reemplaza «clave: valor» en la cabecera --- de un .md."""
    linea = f"{clave}: {valor}"
    m = re.match(r"^---\n([\s\S]*?)\n---", texto)
    if not m:
        return f"---\n{linea}\n---\n\n" + texto
    cab = m.group(1)
    patron = re.compile(r"^" + re.escape(clave) + r":.*$", re.M)
    cab = patron.sub(lambda _: linea, cab, count=1) if patron.search(cab) else cab + "\n" + linea
    return "---\n" + cab + "\n---" + texto[m.end():]


def quitar_de_cabecera(texto, clave, valor):
    m = re.match(r"^---\n([\s\S]*?)\n---", texto)
    if not m:
        return texto
    lineas = [x for x in m.group(1).split("\n")
              if not (x.partition(":")[0].strip().lower() == clave and x.partition(":")[2].strip().strip('"') == valor)]
    return "---\n" + "\n".join(lineas) + "\n---" + texto[m.end():]


def etiqueta_audio_drive(a):
    voz = f' data-voz="{escapar_atributo(a["voz"])}"' if a.get("voz") and a["voz"] != "todas" else ""
    return f'<audio controls src="{escapar_atributo(URL_AUDIO_DRIVE + a["fileId"])}" title="{escapar_atributo(a["nombre"])}"{voz}></audio>'


def escanear(carpeta, profundidad=4):
    """Canciones .md de la carpeta y sus subcarpetas (hasta `profundidad`). Devuelve (canciones, ilegibles)."""
    canciones, ilegibles = [], []
    raiz = Path(carpeta)

    def recorrer(dir_, nivel):
        try:
            hijos = sorted(dir_.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return
        for p in hijos:
            if p.name.startswith("."):
                continue
            if p.is_dir():
                if nivel < profundidad and p.name.lower() not in CARPETAS_IGNORADAS:
                    recorrer(p, nivel + 1)
            elif p.suffix.lower() in (".md", ".markdown"):
                try:
                    c = leer_cancion_local(p)
                except (OSError, UnicodeDecodeError) as e:
                    ilegibles.append((p, str(e)))
                    continue
                if c:
                    canciones.append(c)

    recorrer(raiz, 0)
    return canciones, ilegibles


def _fecha_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def estado_cancion(c, previa, repetida_con=None):
    """Qué pasa con una canción local frente a la Biblioteca: (código, estado, qué conviene, marcar)."""
    faltan = [a["nombre"] for a in c["audios"] if a["tipo"] == "local" and not a["existe"]]
    nota = (" Falta el audio «" + "», «".join(faltan) + "» en esta computadora: se sube sin él.") if faltan else ""
    if repetida_con:
        return ("repetida", "Título repetido",
                f"Tiene el mismo título que «{repetida_con}»: en la Biblioteca una pisaría a la otra. Cambiale el título en el editor.", False)
    if not previa:
        return ("nueva", "Nueva", "No está en la Biblioteca: conviene subirla." + nota, True)
    if previa.get("soloAudio") and c["tiene_letra"]:
        return ("solo-audio", "Está solo con audio",
                "En la Biblioteca está sin letra: al subirla se le agrega la letra y conserva sus audios." + nota, True)
    if c["modificada"] > _fecha_iso(previa.get("actualizado")) + 60:
        return ("cambiada", "Cambiada aquí",
                "La cambiaste en esta computadora después de la última subida: subila para actualizarla (conserva los audios que ya tiene)." + nota, True)
    tiene = {a.get("nombre") for a in previa.get("audios") or [] if a.get("fileId")}
    sin_subir = [a["nombre"] for a in c["audios"] if a["tipo"] == "local" and a["existe"] and a["nombre"] not in tiene]
    if sin_subir:
        return ("sin-audio", "Le falta el audio",
                f"Está en la Biblioteca sin su audio «{'», «'.join(sin_subir)}»: se convierte a AAC (.m4a) y se sube." + nota, True)
    return ("igual", "Ya está", "Ya está en la Biblioteca y no la cambiaste desde entonces: no hace falta subirla.", False)


def resumen_audios(c):
    n = {"local": 0, "video": 0, "enlace": 0}
    for a in c["audios"]:
        n[a["tipo"]] += 1
    partes = [f"{n['local']} de la compu" if n["local"] else "", f"{n['video']} video" + ("s" if n["video"] > 1 else "") if n["video"] else "",
              f"{n['enlace']} enlace" + ("s" if n["enlace"] > 1 else "") if n["enlace"] else ""]
    return ", ".join(p for p in partes if p) or "sin audios"


def subir_cancion_local(api, c, previa, comunidad="", convertir_videos=False, avance=aviso):
    """Sube la canción con sus audios: los de la computadora van a AAC (.m4a) y a la Biblioteca; los enlaces y
    los videos quedan como enlace (los de YouTube suenan en el sitio con el reproductor de YouTube insertado).
    Conserva los audios y las etiquetas que la canción ya tenía."""
    ya = {a.get("nombre"): a for a in (previa or {}).get("audios") or [] if a.get("fileId")}
    cambios, nuevos, srcs_locales = [], [], []
    with tempfile.TemporaryDirectory(prefix="subir-canciones-") as tmp:
        for i, a in enumerate(c["audios"], 1):
            etiqueta = f"audio {i} de {len(c['audios'])} («{a['nombre']}»)"
            if a["tipo"] == "enlace" or (a["tipo"] == "video" and not convertir_videos):
                nuevos.append({"nombre": a["nombre"], "voz": a["voz"], "url": a["src"]})
                continue
            if a["tipo"] == "local":
                srcs_locales.append(a["src"])
            if a["tipo"] == "local" and not a["existe"]:
                avance(f"  {etiqueta}: no está en la computadora, se quita de la canción.")
                cambios.append((a["etiqueta"], ""))
                continue
            if a["nombre"] in ya:
                avance(f"  {etiqueta}: ya estaba en la Biblioteca.")
                hecho = {"nombre": a["nombre"], "voz": a["voz"], "fileId": ya[a["nombre"]]["fileId"]}
                nuevos.append(hecho)
                cambios.append((a["etiqueta"], etiqueta_audio_drive(hecho) + "\n"))
                continue
            try:
                if a["tipo"] == "video":
                    origen, _ = bajar_enlace(a["src"], tmp)
                else:
                    origen = a["ruta"]
                avance(f"  {etiqueta}: convirtiendo a AAC (.m4a)…")
                destino = Path(tmp) / (nombre_archivo(c["titulo"] + (" - " + VOCES.get(a["voz"], a["voz"]) if a["voz"] else "")) + f" {i}.m4a")
                tam, _ = a_m4a(origen, destino, c["titulo"])
            except (Error, subprocess.CalledProcessError) as e:
                if a["tipo"] == "video":
                    avance(f"  {etiqueta}: no se pudo convertir ({e}); queda como enlace.")
                    nuevos.append({"nombre": a["nombre"], "voz": a["voz"], "url": a["src"]})
                else:
                    avance(f"  {etiqueta}: no se pudo convertir ({e}); se sube la canción sin él.")
                    cambios.append((a["etiqueta"], ""))
                continue
            avance(f"  {etiqueta}: subiendo {tam / 1048576:.1f} MB…")
            r = api.post("subirAudioBiblioteca", nombre=destino.name, mime="audio/mp4",
                         base64=base64.b64encode(destino.read_bytes()).decode("ascii"),
                         cancion=(previa or {}).get("titulo") or c["titulo"], voz=a["voz"])
            hecho = {"nombre": a["nombre"], "voz": a["voz"], "fileId": r["fileId"]}
            nuevos.append(hecho)
            cambios.append((a["etiqueta"], etiqueta_audio_drive(hecho) + "\n"))

    texto = c["texto"]
    for etiqueta, reemplazo in cambios:
        if etiqueta:
            texto = texto.replace(etiqueta, reemplazo, 1)
    for src in srcs_locales:
        texto = quitar_de_cabecera(texto, "audio", src)
    etiquetas = unir_etiquetas(c["etiquetas"], (previa or {}).get("etiquetas"))[:40]
    if len(etiquetas) > len(c["etiquetas"]):
        texto = poner_en_cabecera(texto, "etiquetas", ", ".join(etiquetas))
    meta = c.get("meta") or {}
    if meta.get("tonalidad") and not meta.get("tono"):
        texto = poner_en_cabecera(texto, "tono", json.dumps(meta["tonalidad"], ensure_ascii=False))
    texto = re.sub(r"\n{3,}", "\n\n", texto).rstrip() + "\n"
    audios, vistos = [], set()
    anteriores = [{k: a[k] for k in ("nombre", "voz", "fileId", "url") if a.get(k)} for a in (previa or {}).get("audios") or []]
    for a in anteriores + nuevos:
        clave = a.get("fileId") or a.get("url")
        if clave and clave not in vistos:
            vistos.add(clave)
            audios.append({"nombre": a.get("nombre", ""), "voz": a.get("voz", ""), **({"fileId": a["fileId"]} if a.get("fileId") else {"url": a["url"]})})
    avance("  Guardando la canción en la Biblioteca…")
    return api.post("subirCancion", md=texto, nombre=c["ruta"].name, comunidad=comunidad or "", audios=audios[:20])["cancion"]


# ---------------------------------------------------------------- carpetas litúrgicas del Drive

def clave_ruta(partes, nombre):
    """«Momentos liturgícos/Comunión» + «Abandónate.webm» → «momentos-liturgicos/comunion/abandónate.webm»."""
    return "/".join(slug(p) for p in partes) + "/" + unicodedata.normalize("NFC", nombre).lower()


def indice_local(raiz):
    """Audios de la carpeta de la computadora por su ruta sin tildes (también por cada final de la ruta, por si
    se eligió una carpeta de más arriba), para encontrar la copia de un audio del Drive."""
    indice, raiz = {}, Path(raiz)
    for p in raiz.rglob("*"):
        if p.is_file() and EXT_AUDIO_LOCAL.search(p.name):
            partes = p.parent.relative_to(raiz).parts
            for i in range(len(partes) + 1):
                indice.setdefault(clave_ruta(partes[i:], p.name), p)
    return indice


def audios_de_youtube(api, simular=True, avance=aviso, detener=None):
    """Los audios que antes se bajaban de YouTube para los .md de las carpetas (quitarAudiosDeYoutube, por
    tandas). Con simular=False van a la papelera del Drive y esas canciones quedan con el video insertado.
    Devuelve (audios, detenido): [{ruta, md, audio, fileId}]."""
    audios, cursor = [], ""
    while True:
        r = api.post("quitarAudiosDeYoutube", simular="1" if simular else "", **({"cursor": cursor} if cursor else {}))
        audios += r.get("audios") or []
        if not simular and r.get("quitados"):
            avance(f"  {len(audios)} audios bajados de YouTube quitados…")
        cursor = r.get("cursor") or ""
        if not cursor:
            return audios, False
        if detener and detener.is_set():
            return audios, True


def procesar_carpetas(api, carpeta_local=None, avance=aviso, detener=None, quitar_youtube=False):
    """Biblioteca/Momentos litúrgicos y Biblioteca/Tiempos litúrgicos del Drive: 0) si se pide, quita los audios
    que antes se bajaban de YouTube (ver audios_de_youtube); 1) el servidor vincula cada .md con su audio y le pone
    la etiqueta de su carpeta (indexarCarpetas, por tandas); 2) cada .webm se convierte a AAC (.m4a) desde la copia
    de esta computadora (o bajándolo del Drive) y reemplaza al del Drive con el mismo enlace. Los .md con YouTube y
    sin audio no se completan: en el sitio suenan con el reproductor de YouTube insertado."""
    parar = lambda: bool(detener and detener.is_set())  # noqa: E731
    res = {"md": 0, "vinculados": 0, "cambiados": 0, "nuevas": 0, "actualizadas": 0, "convertidos": 0, "con_video": 0,
           "quitados_youtube": 0, "fallas": [], "sin_audio": [], "otros_audios": [], "detenido": False, "carpetas": 0}
    if quitar_youtube:
        avance("Quitando los audios que se habían bajado de YouTube (esas canciones usan el video)…")
        quitados, detenido = audios_de_youtube(api, simular=False, avance=avance, detener=detener)
        res["quitados_youtube"] = len(quitados)
        if detenido:
            res["detenido"] = True
            return res
    a_convertir, cursor, tanda = {}, "", 0
    avance("Revisando las carpetas del Drive (vincular audios y poner etiquetas)…")
    while True:
        tanda += 1
        r = api.post("indexarCarpetas", **({"cursor": cursor} if cursor else {}))
        if r.get("aviso"):
            raise Error(r["aviso"])
        if not r.get("carpetas"):
            raise Error("El servidor no devolvió las carpetas (falla pasajera de Apps Script): probá de nuevo en un rato.")
        for k in ("md", "vinculados", "cambiados", "nuevas", "actualizadas"):
            res[k] += r.get(k) or 0
        res["carpetas"] = r.get("carpetas") or 0
        for a in r.get("aConvertir") or []:
            a_convertir[a["fileId"]] = a
        res["con_video"] += r.get("conVideo") or 0
        res["sin_audio"] += r.get("sinAudio") or []
        res["otros_audios"] += r.get("otrosAudios") or []
        avance(f"  Tanda {tanda}: {res['md']} canciones revisadas, {res['vinculados']} audios vinculados, "
               f"{res['cambiados']} .md actualizados ({res['carpetas']} carpetas).")
        cursor = r.get("cursor") or ""
        if not cursor:
            break
        if parar():
            res["detenido"] = True
            return res

    if a_convertir:
        locales = indice_local(carpeta_local) if carpeta_local and Path(carpeta_local).is_dir() else {}
        avance(f"\nConvirtiendo {len(a_convertir)} audios .webm a AAC (.m4a)…")
        with tempfile.TemporaryDirectory(prefix="carpetas-") as tmp:
            for i, a in enumerate(a_convertir.values(), 1):
                if parar():
                    res["detenido"] = True
                    return res
                donde = f"{a['ruta']}/{a['nombre']}"
                try:
                    origen = locales.get(clave_ruta(a["ruta"].split("/"), a["nombre"]))
                    del_drive = not origen
                    if del_drive:
                        d = api.post("leerAudioAConvertir", fileId=a["fileId"])
                        origen = Path(tmp) / ("original" + Path(a["nombre"]).suffix)
                        origen.write_bytes(base64.b64decode(d["base64"]))
                    destino = Path(tmp) / "convertido.m4a"
                    tam, _ = a_m4a(origen, destino, Path(a["nombre"]).stem)
                    api.post("reemplazarAudio", fileId=a["fileId"], base64=base64.b64encode(destino.read_bytes()).decode("ascii"))
                    res["convertidos"] += 1
                    avance(f"  {i}/{len(a_convertir)} {donde} → .m4a ({tam / 1048576:.1f} MB" + (", bajado del Drive)" if del_drive else ")"))
                except (Error, subprocess.CalledProcessError, OSError, ValueError) as e:
                    res["fallas"].append(f"{donde}: {e}")
                    avance(f"  {i}/{len(a_convertir)} {donde}: no se pudo convertir ({e})")

    return res


def momentos_en_misas(api, cid):
    try:
        misas = api.get(accion="misas").get("misas") or []
    except Error:
        return []
    return [f"{m.get('nombre') or 'Cancionero'} ({m.get('fechaUso') or 'sin fecha'}): {mo.get('momento')}"
            for m in misas for mo in m.get("momentos") or []
            if any(c.get("cancionId") == cid for c in mo.get("canciones") or [])]
