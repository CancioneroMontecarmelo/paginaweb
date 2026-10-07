#!/usr/bin/env python3
"""
subir-canciones.py — Aplicación de escritorio: encuentra las canciones .md que el editor guardó en esta
computadora, muestra cuáles faltan o cambiaron frente a la Biblioteca de la parroquia (el Drive de
cancionerolitugico@gmail.com) y las sube con sus audios convertidos a AAC (.m4a), que suenan en todos los equipos.

    scripts/subir-canciones.py [CARPETA_O_ARCHIVO.md ...]

El lanzador del menú lo instala scripts/instalar-escritorio.sh.
"""

import json
import sys
import threading
import webbrowser
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gio, GLib, Gtk, Pango  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mc_biblioteca as mc  # noqa: E402

NOMBRE = "Subir canciones a la Biblioteca"
PREFS = mc.CONFIG.parent / "subir-canciones.json"
ICONO = mc.RAIZ / "editor" / "icons" / "icono-192.png"
COLORES = {"nueva": "#1a7f37", "solo-audio": "#0969da", "cambiada": "#b35900", "sin-audio": "#0969da",
           "igual": "#6e7781", "repetida": "#cf222e", "sin-conexion": "#6e7781"}
ORDEN = {"nueva": 0, "solo-audio": 1, "cambiada": 2, "sin-audio": 3, "repetida": 4, "sin-conexion": 5, "igual": 6}
RESUMEN = {"nueva": ("nueva", "nuevas"), "solo-audio": ("solo con audio", "solo con audio"), "cambiada": ("cambiada", "cambiadas"),
           "sin-audio": ("sin su audio", "sin su audio"),
           "repetida": ("con título repetido", "con título repetido"), "sin-conexion": ("sin comparar", "sin comparar"),
           "igual": ("ya está", "ya están")}
# Columnas de la lista
C_MARCA, C_TITULO, C_ESTADO, C_COLOR, C_AUDIOS, C_CONSEJO, C_RUTA, C_ACTIVA = range(8)


def leer_prefs():
    try:
        return json.loads(PREFS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def carpeta_inicial():
    guardada = leer_prefs().get("carpeta", "")
    if guardada and Path(guardada).is_dir():
        return Path(guardada)
    musica = Path(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_MUSIC) or Path.home() / "Música")
    for p in (musica / "desde Cancionero on line", musica, Path.home()):
        if p.is_dir():
            return p
    return Path.home()


def guardar_prefs(**cambios):
    try:
        PREFS.parent.mkdir(parents=True, exist_ok=True)
        PREFS.write_text(json.dumps({**leer_prefs(), **cambios}), encoding="utf-8")
    except OSError:
        pass


def guardar_carpeta(carpeta):
    guardar_prefs(carpeta=str(carpeta))


class Ventana(Gtk.ApplicationWindow):
    def __init__(self, app, carpeta, elegidos):
        super().__init__(application=app, title=NOMBRE)
        self.set_default_size(1100, 720)
        if ICONO.exists():
            self.set_icon_from_file(str(ICONO))
        self.carpeta = carpeta
        self.elegidos = {Path(p).resolve() for p in elegidos}
        self.canciones = {}
        self.biblioteca = None
        self.trabajando = False
        mc.aviso = lambda *p: GLib.idle_add(self.anotar, " ".join(str(x) for x in p))

        cab = Gtk.HeaderBar(show_close_button=True, title=NOMBRE, subtitle="Parroquia Nuestra Señora del Monte Carmelo")
        self.set_titlebar(cab)
        sitio = Gtk.Button(label="Ver la Biblioteca en el sitio")
        sitio.connect("clicked", lambda *_: webbrowser.open(mc.SITIO_URL + "misas.html"))
        cab.pack_end(sitio)

        caja = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, margin=14)
        self.add(caja)

        guia = Gtk.Label(xalign=0, wrap=True)
        guia.set_markup(
            "<b>1.</b> Elegí la carpeta donde el editor guarda tus canciones (.md).   "
            "<b>2.</b> Mirá qué pasa con cada una: las <span foreground='#1a7f37'><b>nuevas</b></span> y las "
            "<span foreground='#b35900'><b>cambiadas</b></span> ya vienen marcadas; las que ya están en la Biblioteca no aparecen.   "
            "<b>3.</b> Tocá <b>Subir las marcadas</b>: quedan en la Biblioteca de la parroquia "
            "(Drive de cancionerolitugico@gmail.com) con sus audios en AAC (.m4a), que suenan en iPhone, Mac, Android y PC. "
            "<b>Procesar las carpetas del Drive</b> completa «Momentos litúrgicos» y «Tiempos litúrgicos» de la Biblioteca: "
            "vincula cada canción con su audio, le pone la etiqueta de su carpeta y pasa los audios a .m4a. Las que solo "
            "tienen YouTube suenan en el sitio con el video insertado.")
        caja.pack_start(guia, False, False, 0)

        fila = Gtk.Box(spacing=8)
        fila.pack_start(Gtk.Label(label="Carpeta:"), False, False, 0)
        self.selector = Gtk.FileChooserButton(title="Carpeta de las canciones", action=Gtk.FileChooserAction.SELECT_FOLDER)
        self.selector.set_filename(str(carpeta))
        self.selector.connect("file-set", self.al_cambiar_carpeta)
        fila.pack_start(self.selector, True, True, 0)
        self.btn_revisar = Gtk.Button(label="↻ Revisar de nuevo")
        self.btn_revisar.connect("clicked", lambda *_: self.revisar())
        fila.pack_start(self.btn_revisar, False, False, 0)
        self.btn_procesar = Gtk.Button(label="Procesar las carpetas del Drive")
        self.btn_procesar.set_tooltip_text("Biblioteca/Momentos litúrgicos y Biblioteca/Tiempos litúrgicos: vincula cada .md con su "
                                           "audio, agrega la etiqueta de su carpeta, convierte los .webm a .m4a (desde las copias "
                                           "de la carpeta elegida aquí). Las que solo tienen YouTube usan el video insertado.")
        self.btn_procesar.connect("clicked", lambda *_: self.procesar_carpetas())
        fila.pack_start(self.btn_procesar, False, False, 0)
        caja.pack_start(fila, False, False, 0)

        fila = Gtk.Box(spacing=8)
        self.lbl_sesion = Gtk.Label(xalign=0)
        fila.pack_start(self.lbl_sesion, True, True, 0)
        conseguir = Gtk.Button(label="Conseguir la clave en el sitio")
        conseguir.set_tooltip_text("Abre Identificarse: entrá con tu cuenta y tocá «Copiar clave para el script»")
        conseguir.connect("clicked", lambda *_: webbrowser.open(mc.SITIO_URL + "login.html"))
        fila.pack_start(conseguir, False, False, 0)
        pegar = Gtk.Button(label="Pegar la clave…")
        pegar.connect("clicked", lambda *_: self.pedir_clave())
        fila.pack_start(pegar, False, False, 0)
        caja.pack_start(fila, False, False, 0)

        self.lbl_resumen = Gtk.Label(xalign=0)
        caja.pack_start(self.lbl_resumen, False, False, 0)

        self.lista = Gtk.ListStore(bool, str, str, str, str, str, str, bool)
        self.lista.set_sort_func(0, self.comparar)
        self.lista.set_sort_column_id(0, Gtk.SortType.ASCENDING)
        vista = Gtk.TreeView(model=self.lista, tooltip_column=C_RUTA)
        marca = Gtk.CellRendererToggle()
        marca.connect("toggled", self.al_marcar)
        vista.append_column(Gtk.TreeViewColumn("Subir", marca, active=C_MARCA, activatable=C_ACTIVA, sensitive=C_ACTIVA))
        for titulo, col, ancho, extra in (("Canción", C_TITULO, 240, {}), ("Estado", C_ESTADO, 150, {"foreground": C_COLOR}),
                                          ("Audios", C_AUDIOS, 170, {}), ("Qué conviene", C_CONSEJO, 380, {})):
            celda = Gtk.CellRendererText(ellipsize=Pango.EllipsizeMode.END if col != C_CONSEJO else Pango.EllipsizeMode.NONE)
            if col == C_CONSEJO:
                celda.set_property("wrap-mode", Pango.WrapMode.WORD)
                celda.set_property("wrap-width", ancho)
            if col == C_ESTADO:
                celda.set_property("weight", Pango.Weight.BOLD)
            columna = Gtk.TreeViewColumn(titulo, celda, text=col, **extra)
            columna.set_resizable(True)
            columna.set_min_width(ancho if col != C_CONSEJO else 200)
            columna.set_expand(col == C_CONSEJO)
            vista.append_column(columna)
        vista.connect("row-activated", self.al_activar_fila)
        desliz = Gtk.ScrolledWindow(vexpand=True)
        desliz.add(vista)
        caja.pack_start(desliz, True, True, 0)

        fila = Gtk.Box(spacing=12)
        fila.pack_start(Gtk.Label(label="Comunidad de las nuevas:"), False, False, 0)
        self.cmb_comunidad = Gtk.ComboBoxText()
        self.cmb_comunidad.append("", "La de mi cuenta")
        for slug_, nombre in mc.COMUNIDADES.items():
            self.cmb_comunidad.append(slug_, nombre)
        self.cmb_comunidad.set_active(0)
        fila.pack_start(self.cmb_comunidad, False, False, 0)
        caja.pack_start(fila, False, False, 0)

        fila = Gtk.Box(spacing=8)
        todas = Gtk.Button(label="Seleccionar todas")
        todas.connect("clicked", lambda *_: self.marcar_todas(True))
        fila.pack_start(todas, False, False, 0)
        ninguna = Gtk.Button(label="Desmarcar todas")
        ninguna.connect("clicked", lambda *_: self.marcar_todas(False))
        fila.pack_start(ninguna, False, False, 0)
        self.progreso = Gtk.ProgressBar(show_text=True, valign=Gtk.Align.CENTER)
        fila.pack_start(self.progreso, True, True, 0)
        self.btn_subir = Gtk.Button(label="Subir las marcadas")
        self.btn_subir.get_style_context().add_class("suggested-action")
        self.btn_subir.connect("clicked", lambda *_: self.subir())
        fila.pack_start(self.btn_subir, False, False, 0)
        self.detener = threading.Event()
        self.btn_detener = Gtk.Button(label="Detener", sensitive=False)
        self.btn_detener.set_tooltip_text("Termina la canción que está subiendo y para. Después podés seguir donde quedó.")
        self.btn_detener.connect("clicked", lambda *_: self.al_detener())
        fila.pack_start(self.btn_detener, False, False, 0)
        caja.pack_start(fila, False, False, 0)

        detalle = Gtk.Expander(label="Detalle de lo que se va haciendo")
        self.registro = Gtk.TextView(editable=False, monospace=True, wrap_mode=Gtk.WrapMode.WORD_CHAR, cursor_visible=False)
        desliz = Gtk.ScrolledWindow(min_content_height=150)
        desliz.add(self.registro)
        detalle.add(desliz)
        caja.pack_start(detalle, False, False, 0)
        self.detalle = detalle

        self.pintar_sesion()
        self.revisar()

    # ------------------------------------------------------------ sesión

    def pintar_sesion(self):
        token = mc.clave_guardada()
        d = mc.datos_clave(token) if token else None
        if d:
            vence = GLib.DateTime.new_from_unix_local(int(d["exp"] / 1000)).format("%d/%m/%Y")
            self.lbl_sesion.set_markup(f"Sesión: <b>{GLib.markup_escape_text(d['email'])}</b> · la clave vence el {vence}")
        else:
            self.lbl_sesion.set_markup("<b>Sin clave:</b> podés revisar, pero para subir hace falta tu clave del sitio "
                                       "(Identificarse → «Copiar clave para el script»).")
        return token

    def pedir_clave(self):
        dlg = Gtk.Dialog(title="Pegar la clave", transient_for=self, modal=True)
        dlg.add_buttons("Cancelar", Gtk.ResponseType.CANCEL, "Guardar", Gtk.ResponseType.OK)
        dlg.set_default_response(Gtk.ResponseType.OK)
        area = dlg.get_content_area()
        area.set_spacing(8)
        area.set_border_width(14)
        texto = Gtk.Label(xalign=0, wrap=True, max_width_chars=60)
        texto.set_markup("1. Tocá <b>Conseguir la clave en el sitio</b> y entrá con tu cuenta de Google.\n"
                         "2. En Identificarse tocá <b>Copiar clave para el script</b>.\n"
                         "3. Pegala aquí. Dura 90 días y da tus mismos permisos: no la compartas.")
        area.add(texto)
        entrada = Gtk.Entry(visibility=False, activates_default=True, placeholder_text="Pegá la clave aquí")
        portapapeles = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or ""
        if mc.clave_vigente(portapapeles.strip()):
            entrada.set_text(portapapeles.strip())
        area.add(entrada)
        error = Gtk.Label(xalign=0)
        area.add(error)
        dlg.show_all()
        while dlg.run() == Gtk.ResponseType.OK:
            clave = entrada.get_text().strip()
            if mc.clave_vigente(clave):
                mc.guardar_clave(clave)
                dlg.destroy()
                self.pintar_sesion()
                return clave
            error.set_markup("<span foreground='#cf222e'>Esa clave no sirve o venció. Copiá una nueva en el sitio.</span>")
        dlg.destroy()
        return ""

    # ------------------------------------------------------------ revisar

    def al_cambiar_carpeta(self, selector):
        self.carpeta = Path(selector.get_filename())
        self.elegidos = set()
        guardar_carpeta(self.carpeta)
        self.revisar()

    def revisar(self):
        if self.trabajando:
            return
        self.ocupado(True, "Buscando canciones y comparando con la Biblioteca…")
        carpeta = self.carpeta

        def tarea():
            canciones, ilegibles = mc.escanear(carpeta)
            biblioteca, error = None, ""
            try:
                biblioteca = {c["id"]: c for c in mc.Api(mc.api_de_config(), "").get(accion="biblioteca").get("canciones") or []}
            except mc.Error as e:
                error = str(e)
            GLib.idle_add(self.mostrar, carpeta, canciones, ilegibles, biblioteca, error)

        threading.Thread(target=tarea, daemon=True).start()

    def mostrar(self, carpeta, canciones, ilegibles, biblioteca, error):
        self.ocupado(False)
        self.biblioteca = biblioteca
        self.canciones = {str(c["ruta"]): c for c in canciones}
        self.lista.clear()
        cuenta = {}
        vistos = {}
        for c in canciones:
            repetida = vistos.get(c["id"])
            vistos.setdefault(c["id"], c["titulo"])
            if biblioteca is None:
                codigo, estado, consejo, marcar = ("sin-conexion", "Sin comparar",
                                                   "No se pudo leer la Biblioteca (¿hay internet?). Tocá «Revisar de nuevo».", False)
            else:
                codigo, estado, consejo, marcar = mc.estado_cancion(c, biblioteca.get(c["id"]), repetida)
            c["codigo"] = codigo
            if self.elegidos:
                marcar = c["ruta"].resolve() in self.elegidos and codigo not in ("repetida", "sin-conexion")
            cuenta[codigo] = cuenta.get(codigo, 0) + 1
            if codigo == "igual":
                continue
            self.lista.append([marcar, c["titulo"], estado, COLORES[codigo], mc.resumen_audios(c), consejo, str(c["ruta"]),
                               codigo not in ("repetida", "sin-conexion")])
        if not canciones:
            texto = f"No hay canciones .md del editor en «{carpeta}». Elegí la carpeta donde el editor guarda tus canciones."
        else:
            texto = f"<b>{len(canciones)} canciones</b> en {GLib.markup_escape_text(carpeta.name or str(carpeta))}: " + \
                ", ".join(f"{n} {RESUMEN[cod][n > 1]}" for cod, n in sorted(cuenta.items(), key=lambda x: ORDEN[x[0]]))
            if cuenta.get("igual") == len(canciones):
                texto += ". Ya están todas en la Biblioteca: no queda nada por subir"
            elif cuenta.get("igual"):
                texto += " (esas no se muestran)"
            texto += ". Los cancioneros (.m3u8) se suben desde el editor: Archivo → Guardar cancionero en el Drive."
        self.lbl_resumen.set_markup(texto if canciones else GLib.markup_escape_text(texto))
        if error:
            self.anotar("No se pudo leer la Biblioteca: " + error)
        for ruta, motivo in ilegibles:
            self.anotar(f"No se pudo leer {ruta}: {motivo}")
        self.contar_marcadas()

    def comparar(self, modelo, a, b, _):
        ca, cb = self.canciones.get(modelo[a][C_RUTA], {}), self.canciones.get(modelo[b][C_RUTA], {})
        clave = lambda c, fila: (ORDEN.get(c.get("codigo"), 9), fila[C_TITULO].lower())  # noqa: E731
        ka, kb = clave(ca, modelo[a]), clave(cb, modelo[b])
        return (ka > kb) - (ka < kb)

    def al_marcar(self, _celda, camino):
        fila = self.lista[camino]
        fila[C_MARCA] = not fila[C_MARCA]
        self.contar_marcadas()

    def marcar_todas(self, valor):
        for fila in self.lista:
            if fila[C_ACTIVA]:
                fila[C_MARCA] = valor
        self.contar_marcadas()

    def contar_marcadas(self):
        n = sum(1 for f in self.lista if f[C_MARCA])
        self.btn_subir.set_label(f"Subir las marcadas ({n})")
        self.btn_subir.set_sensitive(n > 0 and not self.trabajando)

    def al_activar_fila(self, _vista, camino, _columna):
        Gtk.show_uri_on_window(self, Path(self.lista[camino][C_RUTA]).parent.as_uri(), Gdk.CURRENT_TIME)

    # ------------------------------------------------------------ subir

    def al_detener(self):
        self.detener.set()
        self.btn_detener.set_sensitive(False)
        self.anotar("\nSe detiene al terminar la canción que está subiendo…")

    def ocupado(self, si, texto=""):
        self.trabajando = si
        self.btn_revisar.set_sensitive(not si)
        self.selector.set_sensitive(not si)
        self.btn_procesar.set_sensitive(not si)
        self.progreso.set_text(texto)
        self.progreso.set_fraction(0)
        if si:
            self.btn_subir.set_sensitive(False)
        else:
            self.contar_marcadas()

    def anotar(self, texto):
        buf = self.registro.get_buffer()
        buf.insert(buf.get_end_iter(), texto + "\n")
        self.registro.scroll_to_iter(buf.get_end_iter(), 0, False, 0, 0)
        return False

    def subir(self):
        marcadas = [self.canciones[f[C_RUTA]] for f in self.lista if f[C_MARCA]]
        if not marcadas or self.trabajando:
            return
        token = mc.clave_guardada() or self.pedir_clave()
        if not token:
            return
        hay_letra = [c["titulo"] for c in marcadas if c.get("codigo") == "cambiada"]
        if hay_letra:
            dlg = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.QUESTION,
                                    buttons=Gtk.ButtonsType.OK_CANCEL, text="¿Reemplazar la letra en la Biblioteca?")
            lista = "\n• ".join(hay_letra[:15]) + (f"\n… y {len(hay_letra) - 15} más" if len(hay_letra) > 15 else "")
            dlg.format_secondary_text(f"Estas {len(hay_letra)} canciones ya están en la Biblioteca y se van a reemplazar por la versión "
                                      "de esta computadora (los audios que ya tienen se conservan):\n\n• " + lista)
            seguir = dlg.run() == Gtk.ResponseType.OK
            dlg.destroy()
            if not seguir:
                return
        self.detalle.set_expanded(True)
        self.ocupado(True, "Subiendo…")
        self.detener.clear()
        self.btn_detener.set_sensitive(True)
        api = mc.Api(mc.api_de_config(), token)
        comunidad = self.cmb_comunidad.get_active_id() or ""
        biblioteca = dict(self.biblioteca or {})

        def tarea():
            hechas, fallas = [], []
            for i, c in enumerate(marcadas):
                if self.detener.is_set():
                    GLib.idle_add(self.anotar, f"Detenido: quedan {len(marcadas) - i} por subir. Tocá «Subir las marcadas» para seguir.")
                    break
                GLib.idle_add(self.avanzar, i, len(marcadas), c["titulo"])
                GLib.idle_add(self.anotar, f"\n«{c['titulo']}»")
                try:
                    e = mc.subir_cancion_local(api, c, biblioteca.get(c["id"]), comunidad,
                                               avance=lambda t: GLib.idle_add(self.anotar, t))
                    biblioteca[e["id"]] = e
                    hechas.append(e["titulo"])
                    GLib.idle_add(self.anotar, f"  ✓ En la Biblioteca, con {len(e.get('audios') or [])} audio(s).")
                    GLib.idle_add(self.quitar_fila, str(c["ruta"]))
                except Exception as err:  # una canción con problemas no frena a las demás
                    fallas.append((c["titulo"], str(err)))
                    GLib.idle_add(self.anotar, f"  ✗ No se pudo subir: {err}")
            GLib.idle_add(self.terminar, hechas, fallas)

        threading.Thread(target=tarea, daemon=True).start()

    # ------------------------------------------------------------ carpetas litúrgicas del Drive

    def procesar_carpetas(self):
        if self.trabajando:
            return
        token = mc.clave_guardada() or self.pedir_clave()
        if not token:
            return
        dlg = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.QUESTION,
                                buttons=Gtk.ButtonsType.OK_CANCEL, text="¿Procesar las carpetas del Drive?")
        dlg.format_secondary_text(
            "En MonteCarmelo/Biblioteca/Momentos litúrgicos y Tiempos litúrgicos:\n\n"
            "1. Cada canción (.md) queda vinculada con el audio de su carpeta y con la carpeta como etiqueta (las que ya "
            "tenía se conservan). En Misas y en el Reproductor se usa esa versión. En su cabecera, «fuente_url» se "
            "reemplaza por «fecha_subida» (la fecha en que el .md se subió al Drive).\n"
            f"2. Los audios .webm se convierten a .m4a, que suena en iPhone, usando las copias de «{self.carpeta}».\n"
            "Las canciones que solo tienen YouTube no se bajan: en Misas y en el Reproductor suenan con el video insertado.\n\n"
            "Puede tardar horas: podés tocar Detener y seguir otro día, se retoma donde quedó.")
        seguir = dlg.run() == Gtk.ResponseType.OK
        dlg.destroy()
        if not seguir:
            return
        self.detalle.set_expanded(True)
        self.ocupado(True, "Procesando las carpetas del Drive…")
        self.detener.clear()
        self.btn_detener.set_sensitive(True)
        api = mc.Api(mc.api_de_config(), token)
        carpeta = self.carpeta

        def avance(texto):
            GLib.idle_add(self.anotar, texto)
            GLib.idle_add(self.progreso.set_text, texto.strip()[:120])
            GLib.idle_add(self.progreso.pulse)

        def buscar_bajados():
            try:
                bajados, _ = mc.audios_de_youtube(api, simular=True, detener=self.detener)
            except Exception as e:  # el servidor o la red: se informa y se puede reintentar
                GLib.idle_add(self.terminar_carpetas, None, str(e))
                return
            GLib.idle_add(self.confirmar_bajados, api, carpeta, avance, bajados)

        avance("Buscando audios que se habían bajado de YouTube…")
        threading.Thread(target=buscar_bajados, daemon=True).start()

    def confirmar_bajados(self, api, carpeta, avance, bajados):
        """Los audios bajados antes de YouTube se quitan (papelera del Drive) solo si se confirma."""
        quitar = False
        if bajados:
            self.anotar("\nAudios bajados de YouTube:\n" + "\n".join(f"  {b['ruta']}/{b['audio']}" for b in bajados))
            dlg = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.QUESTION,
                                    buttons=Gtk.ButtonsType.NONE, text=f"¿Quitar {len(bajados)} audios bajados de YouTube?")
            dlg.format_secondary_text(
                "Antes se bajaba el audio de YouTube de las canciones que no tenían otro. Ahora esas canciones suenan con el "
                "video insertado, así que esos audios sobran:\n\n"
                + "\n".join(f"• {b['ruta']}/{b['audio']}" for b in bajados[:12])
                + (f"\n… y {len(bajados) - 12} más (en el detalle)" if len(bajados) > 12 else "")
                + "\n\nVan a la papelera del Drive (se pueden recuperar durante 30 días) y cada canción queda con su video.")
            dlg.add_buttons("Dejarlos", Gtk.ResponseType.CANCEL, "Quitarlos y usar el video", Gtk.ResponseType.OK)
            quitar = dlg.run() == Gtk.ResponseType.OK
            dlg.destroy()

        def tarea():
            try:
                res, error = mc.procesar_carpetas(api, carpeta, avance, self.detener, quitar_youtube=quitar), ""
            except Exception as e:  # el servidor o la red: se informa y se puede reintentar
                res, error = None, str(e)
            GLib.idle_add(self.terminar_carpetas, res, error)

        threading.Thread(target=tarea, daemon=True).start()
        return False

    def terminar_carpetas(self, res, error):
        self.ocupado(False)
        self.btn_detener.set_sensitive(False)
        if error:
            self.progreso.set_text("No se pudo terminar")
            self.anotar("✗ " + error)
            dlg = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.WARNING,
                                    buttons=Gtk.ButtonsType.CLOSE, text="No se pudieron procesar las carpetas")
            dlg.format_secondary_text(error + "\n\nPodés volver a intentarlo: lo que ya quedó hecho no se repite.")
            dlg.run()
            dlg.destroy()
            return False
        self.progreso.set_fraction(1)
        self.progreso.set_text("Detenido" if res["detenido"] else "Carpetas del Drive listas")
        partes = [f"{res['md']} canciones revisadas en {res['carpetas']} carpetas: {res['vinculados']} audios vinculados, "
                  f"{res['cambiados']} .md actualizados, {res['nuevas']} canciones nuevas en la Biblioteca.",
                  f"{res['convertidos']} audios convertidos a .m4a. {res['con_video']} canciones sin audio propio suenan con su "
                  "video de YouTube insertado."]
        if res["quitados_youtube"]:
            partes.append(f"{res['quitados_youtube']} audios bajados de YouTube quitados (están en la papelera del Drive).")
        if res["sin_audio"]:
            partes.append(f"{len(res['sin_audio'])} canciones no tienen audio ni YouTube (quedan solo con la letra).")
            self.anotar("\nSin audio ni YouTube:\n" + "\n".join(f"  {s['ruta']}/{s['nombre']}" for s in res["sin_audio"]))
        if res["otros_audios"]:
            partes.append(f"{len(res['otros_audios'])} canciones tenían otros audios que ahora quedan solo de respaldo "
                          "(Biblioteca/audios): están en el detalle, por si alguno era una grabación del coro.")
            self.anotar("\nAudios que quedan de respaldo:\n" + "\n".join(
                f"  {o['titulo']}: {', '.join(o['audios'])}" for o in res["otros_audios"]))
        if res["fallas"]:
            partes.append(f"Con problemas ({len(res['fallas'])}):\n" + "\n".join("• " + f for f in res["fallas"][:15])
                          + (f"\n… y {len(res['fallas']) - 15} más (en el detalle)" if len(res["fallas"]) > 15 else ""))
            self.anotar("\nCon problemas:\n" + "\n".join("  " + f for f in res["fallas"]))
        if res["detenido"]:
            partes.append("Se detuvo antes de terminar: tocá «Procesar las carpetas del Drive» para seguir.")
        dlg = Gtk.MessageDialog(transient_for=self, modal=True,
                                message_type=Gtk.MessageType.WARNING if res["fallas"] else Gtk.MessageType.INFO,
                                buttons=Gtk.ButtonsType.NONE, text="Carpetas del Drive procesadas" if not res["detenido"] else "Proceso detenido")
        dlg.format_secondary_text("\n\n".join(partes))
        dlg.add_buttons("Ver en el sitio", 1, "Cerrar", Gtk.ResponseType.CLOSE)
        if dlg.run() == 1:
            webbrowser.open(mc.SITIO_URL + "misas.html")
        dlg.destroy()
        return False

    def quitar_fila(self, ruta):
        for fila in self.lista:
            if fila[C_RUTA] == ruta:
                self.lista.remove(fila.iter)
                break
        return False

    def avanzar(self, i, total, titulo):
        self.progreso.set_fraction(i / total)
        self.progreso.set_text(f"Canción {i + 1} de {total}: {titulo}")
        return False

    def terminar(self, hechas, fallas):
        self.ocupado(False)
        self.btn_detener.set_sensitive(False)
        self.progreso.set_fraction(1)
        self.progreso.set_text(f"Listo: {len(hechas)} subida(s)" + (f", {len(fallas)} con problemas" if fallas else ""))
        tipo = Gtk.MessageType.WARNING if fallas else Gtk.MessageType.INFO
        dlg = Gtk.MessageDialog(transient_for=self, modal=True, message_type=tipo, buttons=Gtk.ButtonsType.NONE,
                                text=f"Se subieron {len(hechas)} canción(es) a la Biblioteca" if hechas else "No se subió ninguna canción")
        partes = []
        if hechas:
            partes.append("Ya se pueden elegir en Misas y abrir en el editor (Archivo → Abrir → Canción de la Biblioteca).")
        if fallas:
            partes.append("Con problemas:\n" + "\n".join(f"• {t}: {e}" for t, e in fallas))
        dlg.format_secondary_text("\n\n".join(partes))
        dlg.add_buttons("Ver en el sitio", 1, "Cerrar", Gtk.ResponseType.CLOSE)
        if dlg.run() == 1:
            webbrowser.open(mc.SITIO_URL + "misas.html")
        dlg.destroy()
        self.elegidos = set()
        self.revisar()
        return False


class Aplicacion(Gtk.Application):
    def __init__(self):
        # Cada lanzamiento con su propia ventana: así «Abrir con» siempre muestra la carpeta del archivo elegido
        super().__init__(application_id="cl.montecarmelo.SubirCanciones", flags=Gio.ApplicationFlags.NON_UNIQUE)
        self.args = []

    def do_activate(self):
        rutas = [Path(a).expanduser() for a in self.args]
        carpetas = [p for p in rutas if p.is_dir()]
        archivos = [p for p in rutas if p.is_file()]
        carpeta = carpetas[0] if carpetas else archivos[0].parent if archivos else carpeta_inicial()
        if rutas:
            guardar_carpeta(carpeta)
        ventana = self.get_active_window() or Ventana(self, carpeta, archivos)
        ventana.show_all()
        ventana.present()


def main():
    GLib.set_prgname("montecarmelo-subir")  # = StartupWMClass del lanzador: el menú agrupa bien la ventana
    GLib.set_application_name(NOMBRE)
    app = Aplicacion()
    app.args = [a for a in sys.argv[1:] if not a.startswith("-")]
    return app.run([sys.argv[0]])


if __name__ == "__main__":
    sys.exit(main())
