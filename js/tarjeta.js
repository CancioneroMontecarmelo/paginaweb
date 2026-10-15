// Tarjeta para compartir (1080×1350, el formato vertical de Instagram y WhatsApp): los cantos de un cancionero de
// misa, o una canción con sus primeras líneas. Se comparte con el menú del celular (Web Share) o se descarga.

const ANCHO = 1080, ALTO = 1350, MARGEN = 84;

function partir(ctx, texto, ancho) {
  const palabras = String(texto || "").split(/\s+/).filter(Boolean);
  const lineas = [];
  let linea = "";
  for (const p of palabras) {
    const prueba = linea ? linea + " " + p : p;
    if (ctx.measureText(prueba).width > ancho && linea) {
      lineas.push(linea);
      linea = p;
    } else linea = prueba;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

function recortar(ctx, texto, ancho) {
  let t = String(texto || "");
  if (ctx.measureText(t).width <= ancho) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > ancho) t = t.slice(0, -1);
  return t + "…";
}

const oscurecer = (hex, f) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#1f2937";
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.round(x * f));
  return `rgb(${c.join(",")})`;
};

// datos: { titulo, subtitulo, items: [{ momento, titulo }], lineas: [texto], pie, direccion, color }
export function dibujarTarjeta(datos) {
  const cv = document.createElement("canvas");
  cv.width = ANCHO;
  cv.height = ALTO;
  const ctx = cv.getContext("2d");
  const color = datos.color || "#7c3aed";
  const fondo = ctx.createLinearGradient(0, 0, ANCHO, ALTO);
  fondo.addColorStop(0, oscurecer(color, 0.55));
  fondo.addColorStop(1, oscurecer(color, 0.18));
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ANCHO, ALTO);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.arc(ANCHO - 120, 160, 300, 0, Math.PI * 2);
  ctx.fill();

  const fuente = (peso, tam) => `${peso} ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const util = ANCHO - MARGEN * 2;
  let y = MARGEN + 30;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = fuente(600, 30);
  ctx.fillText("♪  CANCIONERO LITÚRGICO", MARGEN, y);
  y += 90;

  ctx.fillStyle = "#fff";
  ctx.font = fuente(800, 64);
  for (const l of partir(ctx, datos.titulo, util).slice(0, 3)) {
    ctx.fillText(l, MARGEN, y);
    y += 76;
  }
  if (datos.subtitulo) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = fuente(500, 34);
    for (const l of partir(ctx, datos.subtitulo, util).slice(0, 2)) {
      ctx.fillText(l, MARGEN, y);
      y += 46;
    }
  }
  y += 30;
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(MARGEN, y, util, 3);
  y += 60;

  const fin = ALTO - 190;
  const items = datos.items || [];
  if (items.length) {
    const paso = Math.min(110, Math.max(56, Math.floor((fin - y + 30) / items.length)));
    const tam = Math.min(42, Math.round(paso * 0.44));
    y += Math.round(tam * 0.4);
    const caben = Math.max(1, Math.floor((fin - y + paso) / paso));
    const lista = items.slice(0, caben < items.length ? Math.max(1, caben - 1) : caben);
    for (const it of lista) {
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = fuente(600, Math.round(tam * 0.7));
      ctx.fillText(recortar(ctx, (it.momento || "").toUpperCase(), util), MARGEN, y - Math.round(tam * 0.95));
      ctx.fillStyle = "#fff";
      ctx.font = fuente(700, tam);
      ctx.fillText(recortar(ctx, it.titulo, util), MARGEN, y);
      y += paso;
    }
    if (lista.length < items.length) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = fuente(500, 28);
      ctx.fillText(`y ${items.length - lista.length} cantos más`, MARGEN, y - 20);
    }
  } else if (datos.lineas && datos.lineas.length) {
    ctx.fillStyle = "#fff";
    ctx.font = fuente(500, 44);
    for (const t of datos.lineas) {
      for (const l of partir(ctx, t, util)) {
        if (y > fin) break;
        ctx.fillText(l, MARGEN, y);
        y += 62;
      }
      if (y > fin) break;
    }
  }

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, ALTO - 150, ANCHO, 150);
  ctx.fillStyle = "#fff";
  ctx.font = fuente(700, 32);
  ctx.fillText(recortar(ctx, datos.pie || "", util), MARGEN, ALTO - 88);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = fuente(500, 28);
  ctx.fillText(recortar(ctx, datos.direccion || "cancioneroliturgico.cl", util), MARGEN, ALTO - 45);
  return cv;
}

const nombreArchivo = (t) => (String(t || "cancionero").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "cancionero") + ".png";

// Comparte la tarjeta (o la descarga si el navegador no comparte archivos). Devuelve "compartida" | "descargada" | ""
export async function compartirTarjeta(datos) {
  const cv = dibujarTarjeta(datos);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  if (!blob) throw new Error("No se pudo dibujar la tarjeta.");
  const archivo = new File([blob], nombreArchivo(datos.titulo), { type: "image/png" });
  const texto = [datos.titulo, datos.url].filter(Boolean).join("\n");
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: datos.titulo, text: texto });
      return "compartida";
    } catch (e) {
      if (e && e.name === "AbortError") return "";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = archivo.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "descargada";
}
