/**
 * liturgia.js — Calendario litúrgico y cantos sugeridos, comunes a Misas (misas.html) e Inicio (inicio.html).
 *
 * Usa TAG_FAMILIES y tagNorm de editor/js/etiquetas.js, que la página carga antes como script clásico.
 */

const grupoCatolico = (nombre) => TAG_FAMILIES.catolico.groups.find((g) => g.name === nombre).tags;
export const MOMENTOS_MISA = grupoCatolico("Momentos de la misa");
export const TIEMPOS = grupoCatolico("Tiempos litúrgicos");
export const MOMENTOS_BASE = ["Entrada", "Acto penitencial", "Gloria", "Salmo responsorial", "Aleluya", "Post evangelio",
  "Ofertorio", "Santo", "Cordero de Dios", "Comunión", "Acción de gracias", "Salida"];

// Etiquetas que valen para el mismo momento (la primera es la que se muestra)
export const SINONIMOS = [
  ["Acto penitencial", "Señor ten piedad (Kyrie)", "Señor ten piedad", "Perdón", "Piedad", "Kyrie"],
  ["Aleluya", "Aclamación al Evangelio", "Aclamación"],
  ["Post evangelio", "Postevangelio", "Después del Evangelio"],
  ["Ofertorio", "Presentación de los dones", "Ofrenda", "Ofrendas"],
  ["Santo", "Sanctus"],
  ["Cordero de Dios", "Cordero", "Agnus", "Agnus Dei"],
  ["Salida", "Envío", "Despedida"],
  ["Salmo responsorial", "Salmo"],
  ["Padre Nuestro", "Padrenuestro"],
  ["Paz", "Saludo de la paz"],
  ["Canto a María", "María", "Virgen"]
];
export const claveMomento = (t) => {
  const k = tagNorm(t);
  const g = SINONIMOS.find((lista) => lista.some((x) => tagNorm(x) === k));
  return g ? tagNorm(g[0]) : k;
};
export const esDelMomento = (cancion, momento) => {
  const k = claveMomento(momento);
  return (cancion.etiquetas || []).some((t) => claveMomento(t) === k);
};
export const ordenMomento = (nombre) => {
  const i = MOMENTOS_MISA.findIndex((x) => claveMomento(x) === claveMomento(nombre));
  return i < 0 ? 999 : i;
};

// ============ FECHAS ============

export function hoyIso(desplazarDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desplazarDias);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

export const proximoDomingo = () => hoyIso((7 - new Date().getDay()) % 7);

export function fechaLarga(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// «XXVIII DOMINGO DEL TIEMPO ORDINARIO» → «XXVIII Domingo del Tiempo Ordinario»
export function tituloLiturgico(t) {
  return String(t || "").toLowerCase().split(" ").map((w, i) =>
    /^[ivxlc]+$|^\(\w\)$/.test(w) ? w.toUpperCase()
      : i && /^(de|del|la|las|los|el|y|en|a)$/.test(w) ? w
        : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ============ CALENDARIO LITÚRGICO ============

const fechaMedioDia = (iso) => new Date(iso + "T12:00:00");
const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

function domingoDePascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1, 12);
}

// Tiempo litúrgico de una fecha (para cuando todavía no están las lecturas). En Chile la Epifanía
// y la Ascensión se celebran en domingo.
export function tiempoPorFecha(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const f = fechaMedioDia(iso), y = f.getFullYear();
  const dif = Math.round((f - domingoDePascua(y)) / 86400000);
  if (dif === -46) return "Miércoles de Ceniza";
  if (dif === -7) return "Domingo de Ramos";
  if (dif === -3) return "Jueves Santo";
  if (dif === -2) return "Viernes Santo";
  if (dif === -1) return "Vigilia Pascual";
  if (dif > -7 && dif < -3) return "Semana Santa";
  if (dif > -46 && dif < -7) return "Cuaresma";
  if (dif === 39 || dif === 42) return "Ascensión";
  if (dif === 49) return "Pentecostés";
  if (dif >= 0 && dif < 49) return "Pascua";
  const navidad = new Date(y, 11, 25, 12);
  const adviento = sumarDias(navidad, -(navidad.getDay() || 7) - 21);
  if (f >= adviento && f < navidad) return "Adviento";
  if (f >= navidad) return "Navidad";
  const enero2 = new Date(y, 0, 2, 12);
  const epifania = sumarDias(enero2, (7 - enero2.getDay()) % 7);
  if (+f === +epifania) return "Epifanía";
  return f < sumarDias(epifania, 7) ? "Navidad" : "Tiempo ordinario";
}

// Color propio del tiempo, para cuando las lecturas del día todavía no están publicadas
export function colorPorTiempo(tiempo) {
  if (["Adviento", "Cuaresma", "Miércoles de Ceniza"].includes(tiempo)) return "Morado";
  if (["Domingo de Ramos", "Viernes Santo", "Pentecostés"].includes(tiempo)) return "Rojo";
  if (["Navidad", "Epifanía", "Pascua", "Ascensión", "Jueves Santo", "Vigilia Pascual"].includes(tiempo)) return "Blanco";
  if (tiempo === "Semana Santa") return "Morado";
  return tiempo ? "Verde" : "";
}

export const TIEMPOS_SIN_GLORIA = ["Adviento", "Cuaresma", "Miércoles de Ceniza", "Domingo de Ramos", "Semana Santa"];
export const TIEMPOS_SIN_ALELUYA = ["Cuaresma", "Miércoles de Ceniza", "Domingo de Ramos", "Semana Santa", "Viernes Santo"];
// Tiempos cercanos: un canto de Cuaresma sirve en Semana Santa, uno de Pascua en Pentecostés…
const TIEMPO_FAMILIA = {
  "Miércoles de Ceniza": ["Cuaresma"], "Domingo de Ramos": ["Semana Santa", "Cuaresma"], "Semana Santa": ["Cuaresma"],
  "Jueves Santo": ["Semana Santa"], "Viernes Santo": ["Semana Santa", "Cuaresma"], "Vigilia Pascual": ["Pascua"],
  "Ascensión": ["Pascua"], "Pentecostés": ["Pascua", "Espíritu Santo"], "Epifanía": ["Navidad"], "Navidad": ["Epifanía"]
};

const FIESTAS = grupoCatolico("Solemnidades y fiestas");
const FIESTA_CLAVES = {
  "Santísima Trinidad": ["TRINIDAD"], "Corpus Christi": ["CUERPO Y LA SANGRE", "CORPUS CHRISTI"],
  "Sagrado Corazón": ["SAGRADO CORAZON"], "Cristo Rey": ["REY DEL UNIVERSO", "CRISTO REY"],
  "Todos los Santos": ["TODOS LOS SANTOS"], "Fieles difuntos": ["DIFUNTOS"], "Inmaculada Concepción": ["INMACULADA"],
  "Asunción": ["ASUNCION"], "Virgen del Carmen": ["CARMEN"], "Virgen de Guadalupe": ["GUADALUPE"],
  "San José": ["SAN JOSE"], "San Pedro y San Pablo": ["PEDRO Y PABLO", "PEDRO Y SAN PABLO"],
  "Presentación del Señor": ["PRESENTACION DEL SENOR"], "Bautismo del Señor": ["BAUTISMO DEL SENOR"],
  "Transfiguración": ["TRANSFIGURACION"], "Exaltación de la Cruz": ["EXALTACION DE LA SANTA CRUZ", "EXALTACION DE LA CRUZ"]
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

// Fiestas (etiquetas de «Solemnidades y fiestas») y si el día es mariano, según el título de las lecturas
export function etiquetasDelDia(titulo) {
  const t = sinTildes(titulo);
  return {
    fiestas: t ? FIESTAS.filter((f) => (FIESTA_CLAVES[f] || [sinTildes(f)]).some((k) => t.includes(k))) : [],
    mariano: /VIRGEN|NUESTRA SENORA|SANTA MARIA|MADRE DE DIOS|INMACULADA|ASUNCION/.test(t)
  };
}

// Santoral del día según el título de las lecturas: la memoria o fiesta que nombra («San Francisco
// de Asís», «Nuestra Señora del Rosario»…). Los días sin santo son «Feria».
export function santoDelDia(titulo) {
  const t = tituloLiturgico(titulo);
  const m = t.match(/\b(?:San|Santa|Santo|Santos|Santas|Beato|Beata|Nuestra Señora|Virgen)\b.*$/);
  if (m && !/^Santa Misa|^Santo Domingo de Ramos/i.test(m[0])) {
    return m[0].replace(/\s*\((M|F|S|ML|MO)\)\s*$/i, "")
      .replace(/[,(]?\s*\b(memoria|fiesta|solemnidad)\b.*$/i, "").replace(/[.,;)\s]+$/, "").trim();
  }
  if (/Domingo/i.test(t)) return "Domingo";
  return t ? "Feria" : "";
}

// «Lunes de la XXVII semana del tiempo ordinario» o «XXVIII DOMINGO DEL TIEMPO ORDINARIO» → «Semana XXVII»
export function semanaDelTitulo(titulo) {
  const t = sinTildes(titulo);
  const m = t.match(/\b([IVXLC]+)\s+(?:SEMANA|DOMINGO)\b/) || t.match(/\bSEMANA\s+([IVXLC]+|\d+)\b/);
  return m ? "Semana " + m[1] : "";
}

// Momentos de una misa nueva según el día: sin Gloria en Adviento y Cuaresma (salvo fiestas)
export function momentosDeMisa(fecha, lecturas) {
  const tiempo = lecturas?.tiempo || tiempoPorFecha(fecha);
  const sinGloria = TIEMPOS_SIN_GLORIA.includes(tiempo) && !etiquetasDelDia(lecturas?.titulo).fiestas.length;
  return {
    tiempo,
    momentos: MOMENTOS_BASE.filter((m) => !(sinGloria && m === "Gloria")).map((momento) => ({ momento, canciones: [] }))
  };
}

// ============ CANTOS SUGERIDOS ============

const PALABRAS_COMUNES = new Set(("ahora antes aquel aquella aquellos cuando desde donde ellos entre estaba estas estos " +
  "hasta hemos mismo mucho nosotros nuestra nuestro nuestros otros para pero porque puede sobre tambien tiene todos " +
  "usted ustedes vuestra vuestro senor palabra lectura evangelio salmo jesus cristo dijo decir").split(" "));

const palabrasDe = (texto) => new Set(sinTildes(texto).toLowerCase().split(/[^a-z]+/)
  .filter((w) => w.length >= 5 && !PALABRAS_COMUNES.has(w)));

const textoLecturas = (l) => (l?.secciones || []).filter((s) => s.id === "liturgia" || s.id === "evangelio")
  .flatMap((s) => s.bloques.map((b) => b.x)).join(" ");

function hashTexto(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

// Cantos de las últimas 3 misas de la comunidad: se evitan para no repetir siempre los mismos
function recientesDeComunidad(misa, misas) {
  return new Set((misas || []).filter((m) => m.id !== misa.id && m.comunidad === misa.comunidad)
    .sort((a, b) => String(b.fechaUso || "").localeCompare(String(a.fechaUso || ""))).slice(0, 3)
    .flatMap((m) => m.momentos.flatMap((x) => x.canciones.map((c) => c.cancionId))));
}

export function puntajeCanto(c, ctx) {
  const tags = (c.etiquetas || []).map(tagNorm);
  let p = 0;
  const tiempos = tags.filter((t) => ctx.todosLosTiempos.has(t));
  if (ctx.tiempo && tiempos.includes(ctx.tiempo)) p += 5;
  else if (tags.some((t) => ctx.familia.has(t))) p += 3;
  else if (tiempos.length) p -= 4;
  if (tags.some((t) => ctx.fiestas.has(t))) p += 6;
  if (ctx.mariano && tags.some((t) => ctx.marianas.has(t))) p += 4;
  // En Cuaresma no se canta el aleluya (la aclamación al Evangelio es otra)
  if (ctx.sinAleluya && /aleluya/i.test(c.titulo)) p -= 10;
  if (ctx.recientes.has(c.id)) p -= 3;
  if (ctx.palabras.size) {
    let n = 0;
    for (const w of palabrasDe(c.titulo + " " + (c.etiquetas || []).join(" "))) if (ctx.palabras.has(w)) n++;
    p += Math.min(3, n);
  }
  return p;
}

// Pone un canto sugerido en cada momento sin cantos elegidos a mano. Con reemplazar, también cambia
// los que ya eran sugerencias. `biblioteca`: canciones donde elegir; `misas`: cancioneros ya hechos
// (para no repetir los de las últimas misas de la comunidad). Devuelve cuántos momentos quedaron con canto.
export function sugerirCantos(misa, lecturas, { reemplazar = false, biblioteca = [], misas = [] } = {}) {
  const tiempo = misa.tiempoLiturgico || tiempoPorFecha(misa.fechaUso);
  const dia = etiquetasDelDia(lecturas?.titulo);
  const ctx = {
    tiempo: tagNorm(tiempo),
    familia: new Set((TIEMPO_FAMILIA[tiempo] || []).map(tagNorm)),
    todosLosTiempos: new Set(TIEMPOS.map(tagNorm)),
    fiestas: new Set(dia.fiestas.map(tagNorm)),
    mariano: dia.mariano,
    marianas: new Set(["Mariano", "Canto a María", "Mes de María"].map(tagNorm)),
    sinAleluya: TIEMPOS_SIN_ALELUYA.includes(tiempo),
    recientes: recientesDeComunidad(misa, misas),
    palabras: palabrasDe(textoLecturas(lecturas))
  };
  const usadas = new Set(misa.momentos.flatMap((m) => m.canciones.filter((c) => !c.sugerida).map((c) => c.cancionId)));
  let sugeridos = 0;
  for (const m of misa.momentos) {
    if (m.canciones.some((c) => !c.sugerida) || (m.canciones.length && !reemplazar)) continue;
    let mejor = null, mejorP = -Infinity, mejorH = 0;
    for (const c of biblioteca) {
      if (usadas.has(c.id) || !esDelMomento(c, m.momento)) continue;
      const p = puntajeCanto(c, ctx);
      const h = hashTexto((misa.fechaUso || "") + "|" + (misa.comunidad || "") + "|" + c.id);
      if (p > mejorP || (p === mejorP && h < mejorH)) [mejor, mejorP, mejorH] = [c, p, h];
    }
    m.canciones = mejor ? [{ cancionId: mejor.id, desplazamiento: 0, sugerida: true }] : [];
    if (mejor) {
      usadas.add(mejor.id);
      sugeridos++;
    }
  }
  return sugeridos;
}
