#!/usr/bin/env python3
"""
subir-canciones.py — Aplicación de escritorio: encuentra las canciones .md que el editor guardó en esta
computadora, muestra cuáles faltan o cambiaron frente a la Biblioteca de la parroquia (el Drive de
cancionerolitugico@gmail.com) y las sube con sus audios convertidos a WebM.

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
COLORES = {"nueva": "#1a7f37", "solo-audio": "#0969da", "cambiada": "#b35900", "igual": "#6e7781",
           "repetida": "#cf222e", "sin-conexion": "#6e7781"}
ORDEN = {"nueva": 0, "solo-audio": 1, "cambiada": 2, "repetida": 3, "sin-conexion": 4, "igual": 5}
RESUMEN = {"nueva": ("nueva", "nuevas"), "solo-audio": ("solo con audio", "solo con audio"), "cambiada": ("cambiada", "cambiadas"),
           "repetida": ("con título repetido", "con título repetido"), "sin-conexion": ("sin comparar", "sin comparar"),
           "igual": ("ya está", "ya están")}
# Columnas de la lista
C_MARCA, C_TITULO, C_ESTADO, C_COLOR, C_AUDIOS, C_CONSEJO, C_RUTA, C_ACTIVA = range(8)


def carpeta_inicial():
    try:
        guardada = json.loads(PREFS.read_text(encoding="utf-8")).get("carpeta", "")
        if guardada and Path(guardada).is_dir():
            return Path(guardada)
    except (OSError, ValueError):
        pass
    musica = Path(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_MUSIC) or Path.home() / "Música")
    for p in (musica / "desde Cancionero on line", musica, Path.home()):
        if p.is_dir():
            return p
    return Path.home()


def guardar_carpeta(carpeta):
    try:
        PREFS.parent.mkdir(parents=True, exist_ok=True)
        PREFS.write_text(json.dumps({"carpeta": str(carpeta)}), encoding="utf-8")
    except OSError:
        pass


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
            "<span foreground='#b35900'><b>cambiadas</b></span> ya vienen marcadas.   "
            "<b>3.</b> Tocá <b>Subir las marcadas</b>: quedan en la Biblioteca de la parroquia "
            "(Drive de cancionerolitugico@gmail.com) con sus audios en WebM.")
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
        self.chk_videos = Gtk.CheckButton(label="Convertir los videos (YouTube…) a WebM y subirlos", active=True)
        self.chk_videos.set_tooltip_text("Si no, quedan como enlace al video. En WebM suenan en el sitio sin depender de YouTube.")
        fila.pack_start(self.chk_videos, False, False, 0)
        fila.pack_start(Gtk.Label(label="Comunidad de las nuevas:"), False, False, 0)
        self.cmb_comunidad = Gtk.ComboBoxText()
        self.cmb_comunidad.append("", "La de mi cuenta")
        for slug_, nombre in mc.COMUNIDADES.items():
            self.cmb_comunidad.append(slug_, nombre)
        self.cmb_comunidad.set_active(0)
        fila.pack_start(self.cmb_comunidad, False, False, 0)
        caja.pack_start(fila, False, False, 0)

        fila = Gtk.Box(spacing=8)
        recomendadas = Gtk.Button(label="Marcar las recomendadas")
        recomendadas.connect("clicked", lambda *_: self.marcar_todas(None))
        fila.pack_start(recomendadas, False, False, 0)
        ninguna = Gtk.Button(label="Desmarcar todas")
        ninguna.connect("clicked", lambda *_: self.marcar_todas(False))
        fila.pack_start(ninguna, False, False, 0)
        self.progreso = Gtk.ProgressBar(show_text=True, valign=Gtk.Align.CENTER)
        fila.pack_start(self.progreso, True, True, 0)
        self.btn_subir = Gtk.Button(label="Subir las marcadas")
        self.btn_subir.get_style_context().add_class("suggested-action")
        self.btn_subir.connect("clicked", lambda *_: self.subir())
        fila.pack_start(self.btn_subir, False, False, 0)
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
            c["codigo"], c["recomendada"] = codigo, marcar
            if self.elegidos:
                marcar = c["ruta"].resolve() in self.elegidos and codigo not in ("repetida", "sin-conexion")
            cuenta[codigo] = cuenta.get(codigo, 0) + 1
            self.lista.append([marcar, c["titulo"], estado, COLORES[codigo], mc.resumen_audios(c), consejo, str(c["ruta"]),
                               codigo not in ("repetida", "sin-conexion")])
        if not canciones:
            texto = f"No hay canciones .md del editor en «{carpeta}». Elegí la carpeta donde el editor guarda tus canciones."
        else:
            texto = f"<b>{len(canciones)} canciones</b> en {GLib.markup_escape_text(carpeta.name or str(carpeta))}: " + \
                ", ".join(f"{n} {RESUMEN[cod][n > 1]}" for cod, n in sorted(cuenta.items(), key=lambda x: ORDEN[x[0]]))
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
                c = self.canciones.get(fila[C_RUTA], {})
                fila[C_MARCA] = c.get("recomendada", False) if valor is None else valor
        self.contar_marcadas()

    def contar_marcadas(self):
        n = sum(1 for f in self.lista if f[C_MARCA])
        self.btn_subir.set_label(f"Subir las marcadas ({n})")
        self.btn_subir.set_sensitive(n > 0 and not self.trabajando)

    def al_activar_fila(self, _vista, camino, _columna):
        Gtk.show_uri_on_window(self, Path(self.lista[camino][C_RUTA]).parent.as_uri(), Gdk.CURRENT_TIME)

    # ------------------------------------------------------------ subir

    def ocupado(self, si, texto=""):
        self.trabajando = si
        self.btn_revisar.set_sensitive(not si)
        self.selector.set_sensitive(not si)
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
            dlg.format_secondary_text("Estas canciones ya están en la Biblioteca y se van a reemplazar por la versión de esta "
                                      "computadora (los audios que ya tienen se conservan):\n\n• " + "\n• ".join(hay_letra))
            seguir = dlg.run() == Gtk.ResponseType.OK
            dlg.destroy()
            if not seguir:
                return
        self.detalle.set_expanded(True)
        self.ocupado(True, "Subiendo…")
        api = mc.Api(mc.api_de_config(), token)
        comunidad = self.cmb_comunidad.get_active_id() or ""
        videos = self.chk_videos.get_active()
        biblioteca = dict(self.biblioteca or {})

        def tarea():
            hechas, fallas = [], []
            for i, c in enumerate(marcadas):
                GLib.idle_add(self.avanzar, i, len(marcadas), c["titulo"])
                GLib.idle_add(self.anotar, f"\n«{c['titulo']}»")
                try:
                    e = mc.subir_cancion_local(api, c, biblioteca.get(c["id"]), comunidad, videos,
                                               lambda t: GLib.idle_add(self.anotar, t))
                    biblioteca[e["id"]] = e
                    hechas.append(e["titulo"])
                    GLib.idle_add(self.anotar, f"  ✓ En la Biblioteca, con {len(e.get('audios') or [])} audio(s).")
                except Exception as err:  # una canción con problemas no frena a las demás
                    fallas.append((c["titulo"], str(err)))
                    GLib.idle_add(self.anotar, f"  ✗ No se pudo subir: {err}")
            GLib.idle_add(self.terminar, hechas, fallas)

        threading.Thread(target=tarea, daemon=True).start()

    def avanzar(self, i, total, titulo):
        self.progreso.set_fraction(i / total)
        self.progreso.set_text(f"Canción {i + 1} de {total}: {titulo}")
        return False

    def terminar(self, hechas, fallas):
        self.ocupado(False)
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
