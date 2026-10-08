"""
mc_biblioteca.py — Lo común a scripts/video-a-webm.py y scripts/subir-canciones.py: el servidor de la
parroquia (/api en Cloudflare Pages), la clave guardada, el formato de las canciones .md y la conversión a AAC (.m4a).
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
SITIO_URL = "https://montecarmelo-kxg.pages.dev/"  # SITIO en js/config.js
API_POR_DEFECTO = SITIO_URL + "api"
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "montecarmelo" / "sesion.json"
MAX_BYTES = 30 * 1024 * 1024  # MAX_ARCHIVO_BYTES en servidor/util.js
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
    """El servidor del sitio publicado; MC_API lo cambia (por ejemplo, http://127.0.0.1:8788/api para probar)."""
    return os.environ.get("MC_API") or API_POR_DEFECTO


# Cloudflare frena a los programas que se presentan como «Python-urllib»
AGENTE = {"User-Agent": "MonteCarmelo-escritorio/2 (+" + SITIO_URL + ")"}


class Api:
    def __init__(self, url, token):
        self.url, self.token = url.rstrip("/"), token

    def _abrir(self, pedido):
        for k, v in AGENTE.items():
            pedido.add_header(k, v)
        try:
            with urllib.request.urlopen(pedido, timeout=600) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            cuerpo = e.read()
            if cuerpo.startswith(b"{"):
                return cuerpo
            raise Error(f"El servidor de la parroquia respondió con un error ({e.code}).")
        except urllib.error.URLError as e:
            raise Error(f"No se pudo conectar con el servidor de la parroquia: {e.reason}")

    def _leer(self, pedido):
        try:
            r = json.loads(self._abrir(pedido).decode("utf-8"))
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
        return self._leer(urllib.request.Request(self.url, data=cuerpo, headers={"Content-Type": "text/plain;charset=utf-8"}))

    def subir(self, tipo, ruta, contenido, **params):
        """PUT /api/subir?tipo=…: el archivo va tal cual (sin base64) y la clave en la cabecera."""
        pedido = urllib.request.Request(self.url + "/subir?" + urllib.parse.urlencode({"tipo": tipo, **params}),
                                        data=Path(ruta).read_bytes(), method="PUT",
                                        headers={"Content-Type": contenido, "Authorization": "Bearer " + self.token})
        return self._leer(pedido)

    def bajar_audio(self, file_id):
        return self._abrir(urllib.request.Request(self.url + "/audio/" + urllib.parse.quote(file_id)))


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
URL_AUDIO = SITIO_URL + "api/audio/"
# Audio ya subido a la Biblioteca: «…/api/audio/<id>» o el enlace del Drive de antes de la mudanza (mismo id)
ID_DE_AUDIO = re.compile(r"/api/audio/([\w-]+)|drive\.google\.com/(?:uc\?(?:[^\s\"]*&)?id=|file/d/)([\w-]+)")


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
        if id_de_audio(src):
            a["tipo"], a["fileId"] = "biblioteca", id_de_audio(src)
        elif es_enlace(src):
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


def id_de_audio(src):
    m = ID_DE_AUDIO.search(src or "")
    return (m.group(1) or m.group(2)) if m else ""


def etiqueta_audio(a):
    voz = f' data-voz="{escapar_atributo(a["voz"])}"' if a.get("voz") and a["voz"] != "todas" else ""
    return f'<audio controls src="{escapar_atributo(URL_AUDIO + a["fileId"])}" title="{escapar_atributo(a["nombre"])}"{voz}></audio>'


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
    n = {"local": 0, "video": 0, "enlace": 0, "biblioteca": 0}
    for a in c["audios"]:
        n[a["tipo"]] += 1
    partes = [f"{n['local']} de la compu" if n["local"] else "", f"{n['video']} video" + ("s" if n["video"] > 1 else "") if n["video"] else "",
              f"{n['enlace']} enlace" + ("s" if n["enlace"] > 1 else "") if n["enlace"] else "",
              f"{n['biblioteca']} ya subido" + ("s" if n["biblioteca"] > 1 else "") if n["biblioteca"] else ""]
    return ", ".join(p for p in partes if p) or "sin audios"


def subir_cancion_local(api, c, previa, comunidad="", convertir_videos=False, avance=aviso):
    """Sube la canción con sus audios: los de la computadora van a AAC (.m4a) y a la Biblioteca; los enlaces y
    los videos quedan como enlace (los de YouTube suenan en el sitio con el reproductor de YouTube insertado).
    Conserva los audios y las etiquetas que la canción ya tenía."""
    ya = {a.get("nombre"): a for a in (previa or {}).get("audios") or [] if a.get("fileId")}
    conocidos = {a["fileId"] for a in ya.values()}
    cambios, nuevos, srcs_locales = [], [], []
    with tempfile.TemporaryDirectory(prefix="subir-canciones-") as tmp:
        for i, a in enumerate(c["audios"], 1):
            etiqueta = f"audio {i} de {len(c['audios'])} («{a['nombre']}»)"
            if a["tipo"] == "biblioteca" and "/api/audio/" not in a["src"] and a["fileId"] not in conocidos:
                nuevos.append({"nombre": a["nombre"], "voz": a["voz"], "url": a["src"]})
                continue
            if a["tipo"] == "biblioteca":
                hecho = {"nombre": a["nombre"], "voz": a["voz"], "fileId": a["fileId"]}
                nuevos.append(hecho)
                if a["etiqueta"]:
                    cambios.append((a["etiqueta"], etiqueta_audio(hecho) + "\n"))
                continue
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
                cambios.append((a["etiqueta"], etiqueta_audio(hecho) + "\n"))
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
            r = api.subir("audio", destino, "audio/mp4", nombre=destino.name, mime="audio/mp4",
                          cancion=(previa or {}).get("titulo") or c["titulo"], voz=a["voz"])
            hecho = {"nombre": a["nombre"], "voz": a["voz"], "fileId": r["fileId"]}
            nuevos.append(hecho)
            cambios.append((a["etiqueta"], etiqueta_audio(hecho) + "\n"))

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


# ---------------------------------------------------------------- audios que todavía no son .m4a

def convertir_pendientes(api, avance=aviso, detener=None):
    """Los audios de la Biblioteca que no están en .m4a ni .mp3 (los .webm que no suenan en iPhone) se bajan,
    se convierten a AAC (.m4a) y reemplazan al original con el mismo id: los enlaces no cambian."""
    res = {"convertidos": 0, "fallas": [], "detenido": False, "pendientes": 0}
    pendientes = api.post("audiosAConvertir").get("pendientes") or []
    res["pendientes"] = len(pendientes)
    if not pendientes:
        return res
    avance(f"Convirtiendo {len(pendientes)} audios a AAC (.m4a)…")
    with tempfile.TemporaryDirectory(prefix="convertir-") as tmp:
        for i, a in enumerate(pendientes, 1):
            if detener and detener.is_set():
                res["detenido"] = True
                return res
            donde = f"{a.get('cancion') or ''}: {a['nombre']}"
            try:
                origen = Path(tmp) / ("original" + Path(a["nombre"]).suffix)
                origen.write_bytes(api.bajar_audio(a["fileId"]))
                destino = Path(tmp) / "convertido.m4a"
                tam, _ = a_m4a(origen, destino, a.get("cancion") or Path(a["nombre"]).stem)
                api.subir("reemplazo", destino, "audio/mp4", fileId=a["fileId"])
                res["convertidos"] += 1
                avance(f"  {i}/{len(pendientes)} {donde} → .m4a ({tam / 1048576:.1f} MB)")
            except (Error, subprocess.CalledProcessError, OSError, ValueError) as e:
                res["fallas"].append(f"{donde}: {e}")
                avance(f"  {i}/{len(pendientes)} {donde}: no se pudo convertir ({e})")
    return res


def momentos_en_misas(api, cid):
    try:
        misas = api.get(accion="misas").get("misas") or []
    except Error:
        return []
    return [f"{m.get('nombre') or 'Cancionero'} ({m.get('fechaUso') or 'sin fecha'}): {mo.get('momento')}"
            for m in misas for mo in m.get("momentos") or []
            if any(c.get("cancionId") == cid for c in mo.get("canciones") or [])]
