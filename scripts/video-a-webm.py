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
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mc_biblioteca import (  # noqa: E402
    COMUNIDADES, CONFIG, EXT_VIDEO_AUDIO, SITIO_URL, VOCES, Api, Error, a_webm, api_de_config, armar_md, aviso,
    bajar_enlace, cambiar_etiquetas_md, clave_guardada, clave_vigente, datos_clave, es_enlace, etiquetas_de,
    guardar_clave, leer_letra, momentos_en_misas, nombre_archivo, slug, unir_etiquetas, vocabulario_etiquetas)


def obtener_clave(dada):
    if dada:
        if not clave_vigente(dada):
            raise Error("La clave dada no sirve o venció. Copiá una nueva en el sitio: Identificarse → «Copiar clave para el script».")
        guardar_clave(dada)
        return dada
    token = clave_guardada()
    if token:
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
