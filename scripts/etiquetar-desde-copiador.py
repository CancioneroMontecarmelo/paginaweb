#!/usr/bin/env python3
"""Agrega a cada canción de la Biblioteca las etiquetas de las carpetas del Copiador.

Uso:
  scripts/etiquetar-desde-copiador.py --dry-run
  scripts/etiquetar-desde-copiador.py

Raíz por defecto: ../Copiador de canciones/cancionero (junto a este proyecto).
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import mc_biblioteca as mc

RAIZ_COPIADOR = Path(__file__).resolve().parent.parent.parent / "Copiador de canciones" / "cancionero"
OMITIR = {"Momentos litúrgicos", "Tiempos litúrgicos"}


def norm_titulo(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def etiquetas_de_ruta(rel: Path) -> list[str]:
    return [p for p in rel.parts[:-1] if p not in OMITIR]


def escanear_copiador(raiz: Path) -> dict[str, set[str]]:
    """título normalizado → unión de etiquetas de carpeta."""
    por: dict[str, set[str]] = defaultdict(set)
    for md in sorted(raiz.rglob("*.md")):
        rel = md.relative_to(raiz)
        titulo = re.sub(r"\s*\(\d+\)$", "", md.stem)
        for t in etiquetas_de_ruta(rel):
            t = mc.limpiar_tag(t)
            if t:
                por[norm_titulo(titulo)].add(t)
    return por


def audios_para_api(cancion: dict) -> list[dict]:
    out = []
    for a in cancion.get("audios") or []:
        item = {"nombre": a.get("nombre") or "", "voz": a.get("voz") or ""}
        if a.get("fileId"):
            item["fileId"] = a["fileId"]
        elif a.get("url"):
            item["url"] = a["url"]
        else:
            continue
        out.append(item)
    return out[:20]


def main() -> int:
    p = argparse.ArgumentParser(description="Etiqueta canciones de la Biblioteca según carpetas del Copiador.")
    p.add_argument("--copiador", type=Path, default=RAIZ_COPIADOR, help="carpeta cancionero del Copiador")
    p.add_argument("--dry-run", action="store_true", help="solo muestra cambios, no guarda")
    p.add_argument("--limite", type=int, default=0, help="máximo de canciones a actualizar (0 = todas)")
    args = p.parse_args()

    raiz = args.copiador.resolve()
    if not raiz.is_dir():
        mc.aviso(f"No está la carpeta del Copiador: {raiz}")
        return 1

    token = mc.clave_guardada()
    if not token and not args.dry_run:
        mc.aviso("No hay clave de administrador. Identificate en el sitio o usá --dry-run.")
        return 1

    local = escanear_copiador(raiz)
    mc.aviso(f"Copiador: {len(local)} títulos en {raiz}")

    api = mc.Api(mc.api_de_config(), token or "")
    bib = api.get(accion="biblioteca").get("canciones") or []
    mc.aviso(f"Biblioteca: {len(bib)} canciones")

    actualizadas = sin_match = sin_cambio = 0
    pendientes = []
    for c in bib:
        clave = norm_titulo(c.get("titulo") or "")
        nuevas = local.get(clave)
        if not nuevas:
            # probar sin prefijo «Momento: »
            if ":" in (c.get("titulo") or ""):
                nuevas = local.get(norm_titulo(c["titulo"].split(":", 1)[1].strip()))
        if not nuevas:
            sin_match += 1
            continue
        actuales = list(c.get("etiquetas") or [])
        unidos = mc.unir_etiquetas(actuales, sorted(nuevas))[:40]
        if unidos == actuales or set(unidos) == set(actuales):
            sin_cambio += 1
            continue
        agregadas = [t for t in unidos if t not in actuales]
        pendientes.append((c, unidos, agregadas))

    mc.aviso(f"A actualizar: {len(pendientes)} · sin cambios: {sin_cambio} · sin match en Copiador: {sin_match}")
    for c, unidos, agregadas in pendientes[:30]:
        mc.aviso(f"  · {c['titulo']}: + {', '.join(agregadas)}")
    if len(pendientes) > 30:
        mc.aviso(f"  … y {len(pendientes) - 30} más")

    if args.dry_run:
        mc.aviso("Dry-run: no se guardó nada.")
        return 0

    tope = args.limite or len(pendientes)
    for i, (c, unidos, agregadas) in enumerate(pendientes[:tope], 1):
        try:
            texto = api.get(accion="cancion", id=c["id"])["texto"]
            texto = mc.cambiar_etiquetas_md(texto, unidos)
            api.post(
                "subirCancion",
                md=texto,
                nombre=mc.slug(c["titulo"]) + ".md",
                comunidad=c.get("comunidad") or "",
                audios=audios_para_api(c),
                carpeta=c.get("carpeta") or "",
            )
            actualizadas += 1
            mc.aviso(f"  [{i}/{tope}] {c['titulo']} ← {', '.join(agregadas)}")
        except mc.Error as e:
            mc.aviso(f"  [{i}/{tope}] {c['titulo']}: {e}")

    mc.aviso(f"Listo: {actualizadas} canciones actualizadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
