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

// Muchas canciones no tienen etiquetas: se reconocen por el título (que empieza con el nombre del momento
// o un sinónimo: «Santo Fones», «Cordero Solemne») o por frases típicas en su letra (Biblioteca: «inicio»).
// Usa buscarPlano, buscarClaves y fraseEnCancion de editor/js/buscar.js (script clásico, cargado antes).
const PALABRAS_MOMENTO = {
  "Entrada": ["venimos", "reunidos", "nos reunimos", "casa del señor", "vamos a la casa", "a tu casa", "entrada", "bienvenidos"],
  "Acto penitencial": ["ten piedad", "kyrie", "perdoname", "hemos pecado", "piedad", "perdon", "misericordia"],
  "Gloria": ["gloria a dios", "gloria en el cielo", "gloria gloria"],
  "Salmo responsorial": ["salmo"],
  "Aleluya": ["aleluya"],
  "Post evangelio": ["tu palabra", "palabra de dios", "tu palabra es", "palabra de vida"],
  "Ofertorio": ["pan y vino", "ofrenda", "ofrendas", "te ofrecemos", "ofrecemos", "te ofrezco", "ofrecer", "frutos de la tierra", "altar", "dones"],
  "Santo": ["santo santo", "santo es el señor", "hosanna", "sanctus"],
  "Padre Nuestro": ["padre nuestro", "santificado sea"],
  "Paz": ["saludo de la paz", "la paz", "paz"],
  "Cordero de Dios": ["cordero de dios", "cordero"],
  "Comunión": ["pan de vida", "cuerpo", "sangre", "cena", "comunion", "pan del cielo", "banquete", "mesa del señor", "caliz", "comulgar"],
  "Acción de gracias": ["te damos gracias", "gracias", "alabanza", "alabare", "te alabo", "bendecid"],
  "Salida": ["id por el mundo", "enviados", "envio", "misioneros", "mision", "anunciar", "anunciad", "id"],
  "Canto a María": ["ave maria", "maria", "virgen", "madre", "señora"]
};
const PALABRAS_POR_CLAVE = new Map(Object.entries(PALABRAS_MOMENTO).map(([m, l]) => [claveMomento(m), l]));
const nombresMomento = (k) => [...(SINONIMOS.find((g) => tagNorm(g[0]) === k) || []), ...MOMENTOS_MISA.filter((x) => claveMomento(x) === k)];
// Posición del nombre (palabras seguidas) en el título: 0 = al comienzo, -1 = no está
const posicionEnTitulo = (titulo, nombre) => {
  const t = buscarClaves(buscarPlano(titulo)), n = buscarClaves(buscarPlano(nombre));
  if (!n.length) return -1;
  for (let i = 0; i + n.length <= t.length; i++) if (n.every((w, k) => t[i + k] === w)) return i;
  return -1;
};
const empiezaCon = (titulo, nombre) => posicionEnTitulo(titulo, nombre) === 0;

const TODOS_LOS_NOMBRES = [...new Set([...MOMENTOS_MISA, ...SINONIMOS.flat()])];

// Sin etiqueta del momento: { como: "titulo" | "letra", palabra, orden } si el título o la letra lo
// sugieren, o null. Un título que ya nombra otro momento («Salmo…», «Aleluya…») no se busca por la letra.
// orden: 0 por el título; después, la posición de la frase en la lista (las primeras son las más seguras).
export function momentoPorLetra(cancion, momento) {
  const k = claveMomento(momento);
  const nombre = [momento, ...nombresMomento(k)].find((n) => empiezaCon(cancion.titulo, n));
  if (nombre) return { como: "titulo", palabra: nombre, orden: 0 };
  if (TODOS_LOS_NOMBRES.some((n) => claveMomento(n) !== k && empiezaCon(cancion.titulo, n))) return null;
  const enTitulo = [momento, ...nombresMomento(k)].find((n) => posicionEnTitulo(cancion.titulo, n) > 0);
  if (enTitulo) return { como: "titulo", palabra: enTitulo, orden: 0 };
  const frases = PALABRAS_POR_CLAVE.get(k) || [];
  const i = frases.findIndex((f) => fraseEnCancion(cancion, f));
  return i < 0 ? null : { como: "letra", palabra: frases[i], orden: i + 1 };
}

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

// ============ FECHAS ESCRITAS Y CALENDARIO PARA ELEGIR LA FECHA ============

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const isoDe = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");

// «18 de octubre», «domingo 18 octubre 2026», «18/10», «18-10-2026», «2026-10-18» → «2026-10-18» ("" si no hay
// fecha). Sin año: el de la próxima vez que llega ese día (hasta 30 días atrás cuenta como este año).
export function fechaEscrita(texto, hoy = hoyIso()) {
  const t = String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace("setiembre", "septiembre");
  let d, m, y;
  const iso = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const larga = t.match(new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MESES.join("|")})(?:\\s*(?:de|del)?\\s*(\\d{4}))?`));
  const corta = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?\b/);
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (larga) [d, m, y] = [+larga[1], MESES.indexOf(larga[2]) + 1, larga[3] ? +larga[3] : 0];
  else if (corta) [d, m, y] = [+corta[1], +corta[2], corta[3] ? +corta[3] : 0];
  else return "";
  if (y && y < 100) y += 2000;
  const h = fechaMedioDia(hoy);
  if (!y) {
    y = h.getFullYear();
    if (new Date(y, m - 1, d, 12) < sumarDias(h, -30)) y++;
  }
  const f = new Date(y, m - 1, d, 12);
  return f.getMonth() === m - 1 && f.getDate() === d ? isoDe(f) : "";
}

const ROMANOS = [["M", 1000], ["CM", 900], ["D", 500], ["CD", 400], ["C", 100], ["XC", 90], ["L", 50], ["XL", 40], ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
const romano = (n) => ROMANOS.reduce((s, [r, v]) => { while (n >= v) { s += r; n -= v; } return s; }, "");

function inicioAdviento(y) {
  const navidad = new Date(y, 11, 25, 12);
  return sumarDias(navidad, -(navidad.getDay() || 7) - 21);
}

// Ciclo de lecturas dominicales: el año litúrgico que empieza en el Adviento de 2025 es el A
function cicloDe(f) {
  const fin = f >= inicioAdviento(f.getFullYear()) ? f.getFullYear() + 1 : f.getFullYear();
  return ["C", "A", "B"][fin % 3];
}

// Domingos (con su número) y fiestas principales del año litúrgico en Chile, calculados sin internet:
// [{ fecha, nombre, numero, domingo }] desde «desde» durante «dias» días
export function calendarioLiturgico(desde = hoyIso(), dias = 84) {
  const ini = fechaMedioDia(desde), fin = sumarDias(ini, dias);
  const lista = [];
  for (let y = ini.getFullYear() - 1; y <= fin.getFullYear(); y++) lista.push(...anioLiturgico(y));
  return lista.filter((x) => { const f = fechaMedioDia(x.fecha); return f >= ini && f < fin; })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Año litúrgico que termina en noviembre del año «y» + el comienzo del siguiente hasta fin de diciembre
function anioLiturgico(y) {
  const dias = new Map();
  const poner = (f, nombre, extra = {}) => dias.set(isoDe(f), { fecha: isoDe(f), nombre, domingo: f.getDay() === 0, ...extra });
  const pascua = domingoDePascua(y), p = (n) => sumarDias(pascua, n);
  const enero2 = new Date(y, 0, 2, 12);
  const epifania = sumarDias(enero2, (7 - enero2.getDay()) % 7);
  const bautismo = epifania.getDate() >= 7 ? sumarDias(epifania, 1) : sumarDias(epifania, 7);
  const ceniza = p(-46), adviento = inicioAdviento(y), cristoRey = sumarDias(adviento, -7);
  // Tiempo ordinario antes de Cuaresma: el domingo después del Bautismo es el II
  for (let f = sumarDias(bautismo, 7 - bautismo.getDay() || 7), n = 2; f < ceniza; f = sumarDias(f, 7), n++) {
    poner(f, `${romano(n)} Domingo del Tiempo Ordinario`, { numero: n });
  }
  // Después de Pentecostés se cuenta hacia atrás desde Cristo Rey (XXXIV)
  for (let f = cristoRey, n = 34; f > p(49); f = sumarDias(f, -7), n--) {
    poner(f, `${romano(n)} Domingo del Tiempo Ordinario`, { numero: n });
  }
  poner(cristoRey, "Cristo Rey: Jesucristo, Rey del Universo (XXXIV Domingo del Tiempo Ordinario)", { numero: 34 });
  poner(new Date(y, 0, 1, 12), "Santa María, Madre de Dios");
  poner(epifania, "Epifanía del Señor");
  poner(bautismo, "Bautismo del Señor");
  poner(ceniza, "Miércoles de Ceniza");
  for (let n = 1; n <= 5; n++) poner(p(-49 + 7 * n), `${romano(n)} Domingo de Cuaresma`, { numero: n });
  poner(p(-7), "Domingo de Ramos en la Pasión del Señor");
  poner(p(-3), "Jueves Santo, Cena del Señor");
  poner(p(-2), "Viernes Santo, Pasión del Señor");
  poner(p(-1), "Vigilia Pascual");
  poner(pascua, "Domingo de Pascua de Resurrección");
  for (let n = 2; n <= 6; n++) poner(p(7 * (n - 1)), `${romano(n)} Domingo de Pascua`, { numero: n });
  poner(p(42), "Ascensión del Señor");
  poner(p(49), "Pentecostés");
  poner(p(56), "Santísima Trinidad");
  poner(p(63), "Santísimo Cuerpo y Sangre de Cristo (Corpus Christi)");
  poner(p(68), "Sagrado Corazón de Jesús");
  // Fiestas de fecha fija (si caen en un domingo de Adviento, Cuaresma o Pascua, pasan al lunes)
  const fuerte = (f) => ["Adviento", "Cuaresma", "Semana Santa", "Domingo de Ramos", "Pascua"].includes(tiempoPorFecha(isoDe(f)));
  [[1, 2, "Presentación del Señor"], [2, 19, "San José, esposo de la Virgen María"], [2, 25, "Anunciación del Señor"],
    [5, 29, "San Pedro y San Pablo, apóstoles"], [6, 16, "Nuestra Señora del Carmen, Reina y Patrona de Chile"],
    [7, 6, "Transfiguración del Señor"], [7, 15, "Asunción de la Virgen María"], [8, 14, "Exaltación de la Santa Cruz"],
    [10, 1, "Todos los Santos"], [10, 2, "Conmemoración de todos los fieles difuntos"], [11, 8, "Inmaculada Concepción de la Virgen María"],
    [11, 12, "Nuestra Señora de Guadalupe"], [11, 25, "Natividad del Señor (Navidad)"]
  ].forEach(([mes, dia, nombre]) => {
    let f = new Date(y, mes, dia, 12);
    if (mes >= 1 && mes <= 3 && (f >= p(-7) && f <= p(7))) return; // Semana Santa y octava de Pascua: otro año litúrgico
    if (f.getDay() === 0 && fuerte(f) && mes !== 11 || (mes === 11 && dia === 8 && f.getDay() === 0)) f = sumarDias(f, 1);
    poner(f, nombre);
  });
  // Adviento y la Sagrada Familia (domingo entre Navidad y Año Nuevo; si no hay, el 30 de diciembre)
  for (let n = 1; n <= 4; n++) poner(sumarDias(adviento, 7 * (n - 1)), `${romano(n)} Domingo de Adviento`, { numero: n });
  const navidad = new Date(y, 11, 25, 12);
  poner(navidad.getDay() === 0 ? new Date(y, 11, 30, 12) : sumarDias(navidad, 7 - navidad.getDay()), "Sagrada Familia de Jesús, María y José");
  return [...dias.values()].map((x) => x.domingo && !/Ceniza|Jueves|Viernes|Vigilia/.test(x.nombre)
    ? { ...x, nombre: `${x.nombre} · ciclo ${cicloDe(fechaMedioDia(x.fecha))}` } : x);
}

// Nombre litúrgico calculado de un día («XXVIII Domingo del Tiempo Ordinario · ciclo A»), o su tiempo
export function nombreDelDia(iso) {
  return calendarioLiturgico(iso, 1)[0]?.nombre || tiempoPorFecha(iso);
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
    // Primero las que tienen la etiqueta del momento; si no hay, las que lo sugieren por el título o la letra
    for (const delMomento of [(c) => esDelMomento(c, m.momento), (c) => !!momentoPorLetra(c, m.momento)]) {
      for (const c of biblioteca) {
        if (usadas.has(c.id) || !delMomento(c)) continue;
        const p = puntajeCanto(c, ctx);
        const h = hashTexto((misa.fechaUso || "") + "|" + (misa.comunidad || "") + "|" + c.id);
        if (p > mejorP || (p === mejorP && h < mejorH)) [mejor, mejorP, mejorH] = [c, p, h];
      }
      if (mejor) break;
    }
    m.canciones = mejor ? [{ cancionId: mejor.id, desplazamiento: 0, sugerida: true }] : [];
    if (mejor) {
      usadas.add(mejor.id);
      sugeridos++;
    }
  }
  return sugeridos;
}
