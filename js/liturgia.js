/**
 * liturgia.js — Calendario litúrgico y cantos sugeridos, comunes a Misas (misas.html) e Inicio (inicio.html).
 *
 * Usa TAG_FAMILIES y tagNorm de editor/js/etiquetas.js, que la página carga antes como script clásico.
 */

const grupoCatolico = (nombre) => TAG_FAMILIES.catolico.groups.find((g) => g.name === nombre).tags;
export const MOMENTOS_MISA = grupoCatolico("Momentos de la misa");
export const TIEMPOS = grupoCatolico("Tiempos litúrgicos");
export const MOMENTOS_BASE = ["Entrada", "Acto penitencial", "Gloria", "Salmo responsorial", "Aleluya", "Post evangelio",
  "Ofertorio", "Santo", "Cordero de Dios", "Comunión", "Acción de gracias", "Salida", "Canto a María"];

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
  "Canto a María": ["ave maria", "maria", "virgen"]
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

// ============ CELEBRACIONES Y MOMENTOS PROPIOS ============
// Misas que no son la del día: cada una con las etiquetas de sus cantos, si lleva Gloria (true / false; sin el campo,
// según el día) y sus momentos propios. Cada momento propio va «despues» o «antes» de otro, o «reemplaza» uno; se le
// sugieren los cantos con sus etiquetas o sus palabras en el título o la letra, y si no hay, los del momento «como».
export const CELEBRACIONES = [
  { id: "bautizo", nombre: "Bautizo", etiquetas: ["Bautismo"], momentos: [
    { nombre: "Rito del Bautismo", despues: "Post evangelio", palabras: ["bautismo", "agua viva", "hijos de dios", "fuente", "renacer"] },
    { nombre: "Luz bautismal", despues: "Rito del Bautismo", palabras: ["luz", "ilumina", "lampara"] }] },
  { id: "matrimonio", nombre: "Matrimonio", gloria: true, etiquetas: ["Matrimonio"], momentos: [
    { nombre: "Entrada de los novios", reemplaza: "Entrada", como: "Entrada", palabras: ["novios", "esposos", "boda"] },
    { nombre: "Consentimiento y anillos", despues: "Post evangelio", palabras: ["anillo", "para siempre", "esposos", "uno solo", "fiel"] },
    { nombre: "Firma del acta", despues: "Acción de gracias", palabras: ["familia", "hogar", "amor"] },
    { nombre: "Salida de los novios", reemplaza: "Salida", como: "Salida", palabras: ["alegria", "fiesta"] }] },
  { id: "confirmacion", nombre: "Confirmación", gloria: true, etiquetas: ["Confirmación", "Espíritu Santo"], momentos: [
    { nombre: "Ven, Espíritu Santo (Crismación)", despues: "Post evangelio", etiquetas: ["Espíritu Santo", "Pentecostés"],
      palabras: ["ven espiritu", "espiritu santo", "fuego", "uncion"] }] },
  { id: "funeral", nombre: "Funeral", gloria: false, etiquetas: ["Exequias", "Fieles difuntos"], momentos: [
    { nombre: "Último adiós", antes: "Salida", palabras: ["reciban su alma", "descanso eterno", "descansa en paz", "resurreccion", "vida eterna", "casa del padre", "no tengas miedo"] }] },
  { id: "difunto", nombre: "Misa por un difunto", gloria: false, etiquetas: ["Fieles difuntos", "Exequias"], momentos: [
    { nombre: "Recuerdo del difunto", antes: "Salida", palabras: ["descanso eterno", "descansa en paz", "resurreccion", "vida eterna", "casa del padre"] }] },
  { id: "corpus", nombre: "Corpus Christi", gloria: true, etiquetas: ["Corpus Christi", "Eucarístico", "Adoración eucarística"], momentos: [
    { nombre: "Secuencia", antes: "Aleluya", etiquetas: ["Secuencia"], palabras: ["lauda sion", "alaba sion", "pan de los angeles", "corpus christi"] },
    { nombre: "Procesión eucarística", despues: "Acción de gracias", etiquetas: ["Adoración eucarística", "Procesión", "Eucarístico"],
      palabras: ["amor de los amores", "pange lingua", "tantum ergo", "adoremos"] }] },
  { id: "cristo-rey", nombre: "Cristo Rey", gloria: true, etiquetas: ["Cristo Rey"], momentos: [
    { nombre: "Consagración a Cristo Rey", despues: "Acción de gracias", palabras: ["cristo rey", "rey de reyes", "reinara", "rey del universo"] }] },
  { id: "sagrado-corazon", nombre: "Sagrado Corazón", gloria: true, etiquetas: ["Sagrado Corazón"], momentos: [
    { nombre: "Consagración al Sagrado Corazón", despues: "Acción de gracias", palabras: ["corazon de jesus", "sagrado corazon"] }] },
  { id: "mariana", nombre: "Fiesta mariana", gloria: true, etiquetas: ["Mariano", "Virgen del Carmen", "Inmaculada Concepción", "Asunción", "Virgen de Guadalupe", "Mes de María"], momentos: [
    { nombre: "Ofrenda floral a María", antes: "Canto a María", etiquetas: ["Mariano", "Mes de María"], palabras: ["flores", "venid y vamos todos"] }] },
  { id: "patronal", nombre: "Fiesta patronal", gloria: true, etiquetas: ["Santos patronos", "Procesión"], momentos: [
    { nombre: "Himno al patrono", antes: "Salida", etiquetas: ["Santos patronos"], palabras: ["patrono", "patrona", "protector", "intercede"] },
    { nombre: "Procesión", despues: "Salida", etiquetas: ["Procesión", "Peregrinación"], palabras: ["caminamos", "peregrino", "caminando"] }] },
  { id: "aniversario-sacerdotal", nombre: "Aniversario sacerdotal", gloria: true, etiquetas: ["Aniversario sacerdotal", "Ordenación", "Vocacional"], momentos: [
    { nombre: "Renovación de las promesas", despues: "Post evangelio", etiquetas: ["Vocacional", "Ordenación"], palabras: ["aqui estoy", "heme aqui", "me has seducido", "sacerdote"] },
    { nombre: "Acción de gracias por el sacerdote", antes: "Salida", palabras: ["sacerdote", "pastor", "gracias"] }] },
  { id: "renovacion-votos", nombre: "Renovación de votos", gloria: true, etiquetas: ["Renovación de votos", "Matrimonio"], momentos: [
    { nombre: "Renovación de los votos", despues: "Post evangelio", palabras: ["para siempre", "esposos", "uno solo", "fiel"] },
    { nombre: "Bendición de los esposos", antes: "Salida", palabras: ["bendice", "bendicion", "familia", "hogar"] }] },
  { id: "consagracion", nombre: "Consagración", etiquetas: ["Consagración"], momentos: [
    { nombre: "Rito de consagración", despues: "Post evangelio", palabras: ["me consagro", "consagro", "todo tuyo", "totus tuus"] }] },
  { id: "bendicion", nombre: "Bendición", etiquetas: ["Bendición"], momentos: [
    { nombre: "Bendición", despues: "Acción de gracias", palabras: ["bendice", "bendicion", "bendiga", "bendito"] }] }
];
export const celebracionPorId = (id) => CELEBRACIONES.find((c) => c.id === id) || null;

// Costumbres de las comunidades (ideas para «Crear un momento»): dónde suelen ir y qué cantos les calzan
export const MOMENTOS_COMUNIDAD = [
  { nombre: "Saludo a los cumpleañeros", antes: "Salida", etiquetas: ["Cumpleaños"], palabras: ["cumpleaños", "que dios te bendiga", "las mañanitas", "bendiga"] },
  { nombre: "Bienvenida a los nuevos", antes: "Salida", etiquetas: ["Bienvenida"], palabras: ["bienvenido", "bienvenidos", "acogida", "hermano"] },
  { nombre: "Aniversarios de matrimonio", antes: "Salida", etiquetas: ["Matrimonio"], palabras: ["esposos", "para siempre", "fiel"] },
  { nombre: "Bendición de las mamás", antes: "Salida", etiquetas: ["Bendición"], palabras: ["madre", "mama", "bendice"] },
  { nombre: "Bendición de los papás", antes: "Salida", etiquetas: ["Bendición"], palabras: ["padre bueno", "papa", "bendice"] },
  { nombre: "Envío de misioneros", antes: "Salida", etiquetas: ["Misionero"], palabras: ["id por el mundo", "enviados", "mision"] },
  { nombre: "Ofrenda de la comunidad", despues: "Ofertorio", etiquetas: [], palabras: ["ofrenda", "te ofrecemos", "compartir"] }
];

// Las etiquetas de las canciones con otros nombres: «Bautizo» es Bautismo, «Boda» es Matrimonio…
const ALIAS_ETIQUETA = new Map([["bautizo", "bautismo"], ["bautizos", "bautismo"], ["casamiento", "matrimonio"], ["boda", "matrimonio"],
  ["bodas", "matrimonio"], ["funeral", "exequias"], ["funerales", "exequias"], ["difuntos", "fieles difuntos"],
  ["confirmaciones", "confirmacion"], ["cumpleanos", "cumpleaños"], ["villancicos", "villancico"], ["marianos", "mariano"], ["maria", "mariano"],
  ["corpus cristi", "corpus christi"], ["secuencias", "secuencia"]].map(([a, b]) => [tagNorm(a), tagNorm(b)]));
const normEtiqueta = (t) => ALIAS_ETIQUETA.get(tagNorm(t)) || tagNorm(t);
export const tieneEtiqueta = (c, lista) => {
  if (!lista?.length) return false;
  const quiero = new Set(lista.map(normEtiqueta));
  return (c.etiquetas || []).some((t) => quiero.has(normEtiqueta(t)));
};

// Nombres escritos a mano que se parecen a una costumbre conocida («Cumpleaños del mes» → Saludo a los cumpleañeros)
const PISTAS_COMUNIDAD = [[/cumple/, 0], [/bienvenid|nuevos|acogida/, 1], [/aniversario.*(matrimonio|boda|esposos)|bodas de/, 2],
  [/mama|madre/, 3], [/papa|padre/, 4], [/mision|envio/, 5], [/ofrenda|colecta/, 6]];

// Momento propio por su nombre (de la celebración, de cualquier celebración o de las costumbres de las comunidades)
export function momentoPropio(nombre, celebracion = null) {
  const k = claveMomento(nombre);
  const de = (lista) => lista.find((m) => claveMomento(m.nombre) === k);
  const exacto = (celebracion && de(celebracion.momentos)) || de(CELEBRACIONES.flatMap((c) => c.momentos)) || de(MOMENTOS_COMUNIDAD);
  if (exacto || ordenMomento(nombre) < 999) return exacto || null;
  const t = sinTildes(nombre).toLowerCase();
  const pista = PISTAS_COMUNIDAD.find(([re]) => re.test(t));
  if (pista) return MOMENTOS_COMUNIDAD[pista[1]];
  // Uno nuevo del todo: se buscan cantos con su nombre como etiqueta o sus palabras largas en el título o la letra
  const palabras = t.split(/[^a-zñ]+/).filter((w) => w.length >= 5 && !/^(saludo|momento|canto|antes|despues|durante)$/.test(w));
  return palabras.length ? { nombre, ...lugarPorNombre(nombre), etiquetas: [nombre], palabras } : null;
}

// Dónde va un momento nuevo que no se conoce, según su nombre
function lugarPorNombre(nombre) {
  const t = sinTildes(nombre).toLowerCase();
  if (/ofrenda|colecta|ofrec/.test(t)) return { despues: "Ofertorio" };
  if (/entrada|bienvenida inicial|procesion de entrada/.test(t)) return { despues: "Entrada" };
  return { antes: "Salida" };
}

// Índice donde va «nombre» en la lista de momentos de una misa
export function posicionMomento(momentos, nombre) {
  const claves = momentos.map((m) => claveMomento(m.momento));
  const en = (x) => claves.indexOf(claveMomento(x));
  if (ordenMomento(nombre) < 999) {
    const o = ordenMomento(nombre);
    const i = momentos.findIndex((m) => ordenMomento(m.momento) > o && ordenMomento(m.momento) < 999);
    return i < 0 ? momentos.length : i;
  }
  const def = momentoPropio(nombre) || lugarPorNombre(nombre);
  if (def.despues && en(def.despues) >= 0) return en(def.despues) + 1;
  if (def.antes && en(def.antes) >= 0) return en(def.antes);
  if (def.reemplaza && en(def.reemplaza) >= 0) return en(def.reemplaza);
  const salida = en("Salida");
  return salida >= 0 ? salida : momentos.length;
}

// Pone los momentos propios de la celebración en la lista (agrega o reemplaza)
export function aplicarCelebracion(momentos, celebracion) {
  const cel = typeof celebracion === "string" ? celebracionPorId(celebracion) : celebracion;
  const lista = momentos.slice();
  for (const p of cel?.momentos || []) {
    if (lista.some((m) => claveMomento(m.momento) === claveMomento(p.nombre))) continue;
    const i = p.reemplaza ? lista.findIndex((m) => claveMomento(m.momento) === claveMomento(p.reemplaza)) : -1;
    if (i >= 0) lista[i] = { momento: p.nombre, canciones: [] };
    else lista.splice(posicionMomento(lista, p.nombre), 0, { momento: p.nombre, canciones: [] });
  }
  return lista;
}

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
  "Santísima Trinidad": ["TRINIDAD"], "Corpus Christi": ["CUERPO Y LA SANGRE", "CUERPO Y SANGRE", "CORPUS CHRISTI"],
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

// La celebración que propone el día (Corpus, Cristo Rey, Sagrado Corazón o una fiesta de la Virgen), o ""
// Sin lecturas publicadas vale el nombre del día según el calendario
export function celebracionDelDia(lecturas, fecha = "") {
  const d = etiquetasDelDia(lecturas?.titulo || (fecha ? nombreDelDia(fecha) : ""));
  if (d.fiestas.includes("Corpus Christi")) return "corpus";
  if (d.fiestas.includes("Cristo Rey")) return "cristo-rey";
  if (d.fiestas.includes("Sagrado Corazón")) return "sagrado-corazon";
  return d.mariano ? "mariana" : "";
}

// Momentos de una misa nueva según el día: sin Gloria en Adviento y Cuaresma (salvo fiestas). Con una celebración,
// sus momentos propios y su Gloria (sí en un matrimonio, no en un funeral).
export function momentosDeMisa(fecha, lecturas, celebracion = "") {
  const tiempo = lecturas?.tiempo || tiempoPorFecha(fecha);
  const cel = celebracionPorId(celebracion);
  const sinGloria = cel?.gloria === false || (cel?.gloria !== true && TIEMPOS_SIN_GLORIA.includes(tiempo) && !etiquetasDelDia(lecturas?.titulo).fiestas.length);
  const momentos = MOMENTOS_BASE.filter((m) => !(sinGloria && m === "Gloria")).map((momento) => ({ momento, canciones: [] }));
  return { tiempo, momentos: cel ? aplicarCelebracion(momentos, cel) : momentos };
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

// ============ EL EVANGELIO DEL DÍA ============

// El primer Evangelio de las lecturas (no el «O bien más breve»): { cita: «Juan 10, 11-18», resumen, texto }
export function evangelioDe(lecturas) {
  const bloques = (lecturas?.secciones || []).filter((s) => s.id === "liturgia" || s.id === "evangelio").flatMap((s) => s.bloques);
  const k = bloques.findIndex((b) => /evangelio de nuestro se[ñn]or jesucristo/i.test(b.x));
  if (k < 0) return null;
  const fin = bloques.findIndex((b, j) => j > k && /^palabra del se[ñn]or/i.test(b.x));
  const antes = bloques[k - 1];
  return {
    cita: (bloques[k].x.match(/seg[uú]n\s+(?:san\s+)?(.+)$/i)?.[1] || bloques[k].x.replace(/^\+\s*/, "")).trim(),
    resumen: antes && antes.t !== "p" && !/aclamaci/i.test(antes.x) ? antes.x : "",
    texto: bloques.slice(k + 1, fin < 0 ? undefined : fin).map((b) => b.x).join(" ")
  };
}

// Temas frecuentes del Evangelio. lectura: palabras sin tildes que lo reconocen en el Evangelio (con «*», también
// las que empiezan así); canto: frases que lo reconocen en el título o la letra de un canto (palabras enteras)
const TEMAS_EVANGELIO = [
  { nombre: "el Buen Pastor", lectura: ["pastor*", "oveja*", "rebano*", "redil", "aprisco"],
    canto: ["el señor es mi pastor", "buen pastor", "pastor", "pastores", "oveja", "ovejas", "rebaño", "nada me falta"] },
  { nombre: "el banquete del Reino", lectura: ["banquete*", "boda*", "invitado*", "convidado*", "nupcial"],
    canto: ["banquete", "bodas", "invitados", "invitas", "mesa", "cena", "fiesta"] },
  { nombre: "el pan de vida", lectura: ["pan", "panes", "pan de vida", "multiplic*", "mana", "mi carne"],
    canto: ["pan de vida", "pan del cielo", "partir el pan", "pan", "multiplicar"] },
  { nombre: "la luz", lectura: ["luz", "ciego*", "tiniebla*", "ilumin*"], canto: ["tu luz", "luz", "ilumina", "ciego", "ver"] },
  { nombre: "el agua viva", lectura: ["agua viva", "samaritana", "sed", "pozo", "manantial"], canto: ["agua viva", "sed", "fuente", "manantial", "agua"] },
  { nombre: "la tormenta y la barca", lectura: ["tempestad", "tormenta", "viento*", "barca", "olas", "mar", "agua*", "hundi*"],
    canto: ["tormenta", "tempestad", "barca", "mar", "olas", "no temas", "no tengas miedo"] },
  { nombre: "el sembrador y la semilla", lectura: ["sembrador", "semilla*", "sembr*", "mostaza", "cizana", "trigo", "cosecha*", "grano*"],
    canto: ["semilla", "sembrar", "sembrador", "trigo", "grano", "cosecha"] },
  { nombre: "la vid y los sarmientos", lectura: ["vid", "sarmiento*", "vinador", "permanezc*", "fruto*"],
    canto: ["vid", "sarmiento", "sarmientos", "fruto", "frutos", "permaneced"] },
  { nombre: "el perdón y la misericordia", lectura: ["perdon*", "misericordi*", "prodigo", "pecador*", "setenta veces", "deuda*"],
    canto: ["perdón", "perdona", "perdóname", "misericordia", "padre bueno", "volver", "vuelvo"] },
  { nombre: "el amor al prójimo", lectura: ["amense", "amar*", "amor", "projimo", "mandamiento*", "samaritano", "amaos"],
    canto: ["amor", "amar", "ámense", "amaos", "hermano", "hermanos", "prójimo"] },
  { nombre: "el llamado a seguir a Jesús", lectura: ["sigueme", "siganme", "pescador*", "redes", "seguir*", "lo siguieron"],
    canto: ["sígueme", "pescador", "pescadores", "redes", "me has mirado", "seguirte", "te seguiré"] },
  { nombre: "la resurrección", lectura: ["resucit*", "resurreccion", "sepulcro", "tumba", "vivo"],
    canto: ["resucitó", "resucitado", "resurrección", "está vivo", "vive"] },
  { nombre: "el Espíritu Santo", lectura: ["espiritu santo", "paraclito", "defensor", "soplo"], canto: ["espíritu santo", "ven espíritu", "espíritu"] },
  { nombre: "la misión", lectura: ["vayan", "envio", "enviado*", "anuncien", "proclamen", "bauticen", "mies"],
    canto: ["id por el mundo", "enviados", "anunciar", "anunciad", "misión", "misioneros", "mies"] },
  { nombre: "el servicio", lectura: ["servidor*", "servir", "sirve", "lavar los pies", "esclavo", "ultimo*", "humild*"],
    canto: ["servir", "servidor", "lavar los pies", "humilde"] },
  { nombre: "las bienaventuranzas", lectura: ["felices", "bienaventurado*", "dichoso*"], canto: ["bienaventurados", "felices", "dichosos"] },
  { nombre: "la vigilancia y la espera", lectura: ["velen", "vigil*", "lampara*", "virgenes", "preparados", "la hora"],
    canto: ["velad", "vigilantes", "lámpara", "esperamos", "ven señor", "maranatha", "despierta"] },
  { nombre: "la cruz", lectura: ["cruz", "crucific*"], canto: ["cruz", "crucificado"] },
  { nombre: "la oración", lectura: ["oren", "orar", "oracion", "pidan", "padre nuestro"], canto: ["oración", "orar", "padre nuestro", "escúchame"] },
  { nombre: "la fe y la confianza", lectura: ["fe", "no teman", "no temas", "confianza", "crean", "creer", "cree"],
    canto: ["fe", "confianza", "confío", "creo", "no temas"] },
  { nombre: "el Reino de Dios", lectura: ["reino de los cielos", "reino de dios", "tesoro", "perla", "levadura"], canto: ["reino", "tesoro", "perla"] },
  { nombre: "los pobres y la riqueza", lectura: ["rico*", "riqueza*", "pobre*", "dinero", "graneros"], canto: ["pobres", "pobre", "compartir", "justicia"] },
  { nombre: "el bautismo", lectura: ["bautiz*", "jordan", "bautismo"], canto: ["bautismo", "jordán"] },
  { nombre: "los talentos", lectura: ["talento*"], canto: ["talentos", "dones"] }
];

const reLectura = (w) => new RegExp("\\b" + w.replace("*", "") + (w.endsWith("*") ? "" : "\\b"), "g");

// Los temas que trata el Evangelio, del más nombrado al menos (hasta 3); la frase resumen vale doble
export function temasDelEvangelio(lecturas) {
  const ev = evangelioDe(lecturas);
  if (!ev) return [];
  const texto = sinTildes([ev.resumen, ev.resumen, ev.texto].join(" ")).toLowerCase();
  return TEMAS_EVANGELIO.map((t) => ({ t, n: t.lectura.reduce((s, w) => s + (texto.match(reLectura(w)) || []).length, 0) }))
    .filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.t);
}

// El primer tema (en ese orden) que nombra el canto: { tema, frase } o null
function temaDelCanto(c, temas) {
  for (const tema of temas) {
    const frase = tema.canto.find((f) => fraseEnCancion(c, f));
    if (frase) return { tema, frase };
  }
  return null;
}

// Las partes fijas de la misa no van en otro momento aunque nombren el tema
const PARTES_FIJAS = ["Gloria", "Salmo responsorial", "Aleluya", "Santo", "Cordero de Dios", "Acto penitencial", "Padre Nuestro"];
const esParteFija = (c) => PARTES_FIJAS.some((x) => esDelMomento(c, x) || momentoPorLetra(c, x)?.como === "titulo");

// ============ EL SALMO DEL DÍA ============
// La Biblioteca tiene un salmo por domingo y ciclo («Salmo domingo 29 ciclo A», «Salmo cuarto domingo de
// pascua, ciclo A») y por fiesta («Salmo Todos los santos», «Salmo Corpus Christi ciclo A»).

const ORDINALES = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7 };
const TIEMPOS_SALMO = ["adviento", "cuaresma", "pascua"];
const PALABRAS_FIESTA_COMUNES = new Set(["domingo", "senor", "ciclo", "nuestro", "nuestra", "solemnidad", "fiesta", "memoria",
  "tiempo", "ordinario", "salmo", "misa", "santa", "santo", "virgen", "maria", "jesus", "cristo", "jesucristo", "semana",
  "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"]);
const ROMANO_VALOR = { i: 1, v: 5, x: 10, l: 50, c: 100 };
const deRomano = (r) => [...r].reduce((s, ch, i, a) => s + (ROMANO_VALOR[ch] < (ROMANO_VALOR[a[i + 1]] || 0) ? -1 : 1) * ROMANO_VALOR[ch], 0);
const textoSalmo = (s) => sinTildes(s).toLowerCase().replace(/cueresma/g, "cuaresma")
  .replace(/\b(primero?|segundo|tercero?|cuarto|quinto|sexto|septimo)\b/g, (w) => String(ORDINALES[w]));
const palabrasFiesta = (t) => new Set(t.split(/[^a-z]+/).filter((w) => w.length >= 4 && !/^[ivxlc]+$/.test(w) && !PALABRAS_FIESTA_COMUNES.has(w)));
const esSalmo = (c) => esDelMomento(c, "Salmo responsorial") || /^salmo\b/.test(textoSalmo(c.titulo));
// Un salmo propio de otro día (domingo o ciclo) solo va si no hay otro
const salmoPropio = (c) => /\b(domingo|ciclo)\b/.test(textoSalmo(c.titulo));

// Los salmos de la Biblioteca que corresponden al día: { ids, nombre } (ids vacío si no hay)
export function salmosDelDia(fecha, lecturas, biblioteca) {
  const calculado = calendarioLiturgico(fecha, 1)[0]?.nombre || "";
  const nombre = (lecturas?.titulo ? tituloLiturgico(lecturas.titulo) : calculado.replace(/\s*·\s*ciclo \w$/, "")) || "";
  const t = textoSalmo(nombre + " " + calculado);
  const ciclo = /^\d{4}-\d{2}-\d{2}$/.test(fecha || "") ? cicloDe(fechaMedioDia(fecha)).toLowerCase() : "";
  const nro = t.match(/\b([ivxl]+) domingo\b/);
  let numero = nro ? deRomano(nro[1]) : 0, tiempo = TIEMPOS_SALMO.find((x) => t.includes(x)) || "";
  if (/rey del universo|cristo rey/.test(t)) [numero, tiempo] = [34, ""];
  const fiesta = palabrasFiesta(t);
  let mejor = 0, ids = new Set();
  for (const c of biblioteca) {
    if (!esSalmo(c)) continue;
    const s = textoSalmo(c.titulo), cicloS = s.match(/\bciclo ([abc])\b/)?.[1];
    if (cicloS && cicloS !== ciclo) continue;
    let p = 0;
    if (numero && /\bdomingo\b/.test(s) && !/navidad|ramos/.test(s)) {
      const n = +(s.match(/\b(\d+)\b/)?.[1] || 0), tiempoS = TIEMPOS_SALMO.find((x) => s.includes(x)) || "";
      if (n === numero && tiempoS === tiempo) p = 10;
    } else if (!numero) {
      const propias = palabrasFiesta(s), comunes = [...propias].filter((w) => fiesta.has(w)).length;
      if (comunes && comunes >= Math.min(2, fiesta.size, propias.size)) p = comunes;
    }
    if (p > mejor) [mejor, ids] = [p, new Set([c.id])];
    else if (p && p === mejor) ids.add(c.id);
  }
  return { ids, nombre: nombre + (ciclo && numero ? ", ciclo " + ciclo.toUpperCase() : "") };
}

// La misma canción puede estar dos veces en la Biblioteca, con el momento delante («Entrada: Aclaró»)
const NOMBRES_MOMENTO = new Set(TODOS_LOS_NOMBRES.map(claveMomento));
function tituloClave(c) {
  const prefijo = String(c.titulo || "").match(/^([^:]{2,30}):\s*(.+)$/);
  const t = prefijo && NOMBRES_MOMENTO.has(claveMomento(prefijo[1])) ? prefijo[2] : c.titulo;
  return buscarClaves(buscarPlano(t || "")).join(" ");
}
// cancionId → los id de la misma canción (ella incluida)
function gemelasDe(biblioteca) {
  const porTitulo = new Map();
  const claves = new Map(biblioteca.map((c) => [c.id, tituloClave(c) || c.id]));
  for (const [id, k] of claves) {
    if (!porTitulo.has(k)) porTitulo.set(k, []);
    porTitulo.get(k).push(id);
  }
  return new Map([...claves].map(([id, k]) => [id, porTitulo.get(k)]));
}

// Cantos de las últimas 3 misas de la comunidad: se evitan para no repetir siempre los mismos
function recientesDeComunidad(misa, misas) {
  return new Set((misas || []).filter((m) => m.id !== misa.id && m.comunidad === misa.comunidad)
    .sort((a, b) => String(b.fechaUso || "").localeCompare(String(a.fechaUso || ""))).slice(0, 3)
    .flatMap((m) => m.momentos.flatMap((x) => x.canciones.map((c) => c.cancionId))));
}

// ============ CANTO A MARÍA SEGÚN EL TIEMPO ============
// En Navidad un villancico del nacimiento, en Cuaresma la Madre dolorosa… «fuertes»: palabras que dicen que el canto
// es de ese tiempo (en otro tiempo resta). abre: en ese tiempo también valen cantos que no son marianos (villancicos).
export const MARIA_POR_TIEMPO = [
  { tiempos: ["Adviento"], nombre: "la Virgen de la espera", corto: "María en Adviento", etiquetas: ["Adviento"],
    palabras: ["virgen de la espera", "magnificat", "proclama mi alma", "anunciacion", "hagase", "llena de gracia", "espera"], fuertes: ["virgen de la espera"] },
  { tiempos: ["Navidad", "Epifanía"], nombre: "un villancico del nacimiento", corto: "villancico", etiquetas: ["Navidad", "Villancico", "Epifanía"], abre: true,
    palabras: ["villancico", "pesebre", "belen", "noche de paz", "ha nacido", "nacio", "niño dios", "portal", "arrorro"], fuertes: ["villancico", "pesebre", "belen", "noche de paz"] },
  { tiempos: ["Cuaresma", "Miércoles de Ceniza", "Domingo de Ramos", "Semana Santa", "Jueves Santo", "Viernes Santo"], nombre: "la Madre dolorosa",
    corto: "la Dolorosa", etiquetas: ["Dolorosa", "Cuaresma", "Semana Santa", "Viernes Santo"],
    palabras: ["dolorosa", "stabat", "al pie de la cruz", "junto a la cruz", "traspasada", "espada", "llanto", "lagrimas", "dolor"], fuertes: ["dolorosa", "stabat", "al pie de la cruz"] },
  { tiempos: ["Vigilia Pascual", "Pascua", "Ascensión"], nombre: "la Reina del cielo, alegre por la Resurrección", corto: "Regina caeli",
    etiquetas: ["Pascua"], palabras: ["regina", "reina del cielo", "alegrate", "resucito"], fuertes: ["regina caeli", "regina coeli", "reina del cielo alegrate"] },
  { tiempos: ["Pentecostés"], nombre: "María en el cenáculo", corto: "Pentecostés", etiquetas: ["Pentecostés", "Espíritu Santo"], palabras: ["cenaculo", "espiritu"], fuertes: ["cenaculo"] }
];
const MES_DE_MARIA = { nombre: "el Mes de María", corto: "Mes de María", etiquetas: ["Mes de María"],
  palabras: ["mes de maria", "venid y vamos todos", "flores"], fuertes: ["mes de maria"] };
// En Chile el Mes de María va del 8 de noviembre al 8 de diciembre
export const esMesDeMaria = (iso) => { const md = String(iso || "").slice(5, 10); return md >= "11-08" && md <= "12-08"; };
export const temaMarianoDe = (tiempo, fecha) => (esMesDeMaria(fecha) ? MES_DE_MARIA : MARIA_POR_TIEMPO.find((g) => g.tiempos.includes(tiempo)) || null);

const MARIANAS = ["Mariano", "Canto a María", "Mes de María", "Dolorosa", "Virgen del Carmen", "Inmaculada Concepción", "Asunción", "Virgen de Guadalupe"];
// «María» en la letra de un canto que ya es de otro momento («por Madre diste a María» en un canto de perdón) no lo hace mariano
const deOtroMomento = (c) => MOMENTOS_MISA.some((m) => claveMomento(m) !== claveMomento("Canto a María") && esDelMomento(c, m))
  || tieneEtiqueta(c, ["Secuencia", "Pregón Pascual"]);
const esMariano = (c) => {
  if (esDelMomento(c, "Canto a María") || tieneEtiqueta(c, MARIANAS)) return true;
  if (/\b(mar[ií]a|virgen|madre|se[ñn]ora|reina)\b/i.test(c.titulo || "")) return true;
  const p = momentoPorLetra(c, "Canto a María");
  return !!p && (p.como === "titulo" || !deOtroMomento(c));
};
const ETIQUETAS_FUERTES = ["Dolorosa", "Villancico", "Mes de María"];
const coincideMaria = (c, g) => tieneEtiqueta(c, g.etiquetas) || g.palabras.some((f) => fraseEnCancion(c, f));
// En Navidad también valen los villancicos que no son marianos, pero no un aleluya o un gloria con etiqueta Navidad
const abreMaria = (c, g) => !!g?.abre && !deOtroMomento(c) && (tieneEtiqueta(c, ["Villancico"]) || coincideMaria(c, g));
function puntajeMariano(c, g) {
  if (!g) return 0;
  if (g.fuertes.some((f) => fraseEnCancion(c, f)) || tieneEtiqueta(c, g.etiquetas.filter((t) => ETIQUETAS_FUERTES.includes(t)))) return 14;
  if (coincideMaria(c, g)) return 8;
  return [...MARIA_POR_TIEMPO, MES_DE_MARIA].some((x) => x !== g && (tieneEtiqueta(c, x.etiquetas.slice(0, 2)) || x.fuertes.some((f) => fraseEnCancion(c, f)))) ? -8 : 0;
}

const coincidePropio = (c, p) => tieneEtiqueta(c, p.etiquetas) || (p.palabras || []).some((f) => fraseEnCancion(c, f));
// La etiqueta del momento pesa más que una frase, y una frase más que una palabra suelta
const puntajePropio = (c, p) => {
  if (tieneEtiqueta(c, p.etiquetas)) return 10;
  const fr = (p.palabras || []).filter((f) => fraseEnCancion(c, f));
  const frases = fr.filter((f) => f.includes(" ")).length;
  return frases ? Math.min(3 + frases * 2, 9) : fr.length ? 2 : 0;
};

// Qué cantos sirven para un momento y cuánto suman además de puntajeCanto
function criterioMomento(momento, ctx) {
  if (claveMomento(momento) === claveMomento("Canto a María")) {
    return { filtro: (c) => esMariano(c) || abreMaria(c, ctx.maria), extra: (c) => puntajeMariano(c, ctx.maria) };
  }
  const p = momentoPropio(momento, ctx.cel);
  if (p) {
    // Los cantos de la celebración (Exequias, Matrimonio…) sirven para sus momentos; los salmos, santos… no
    const deCel = ctx.cel?.momentos?.includes(p) && !p.etiquetas?.length ? ctx.cel.etiquetas : [];
    const enTitulo = (c) => posicionEnTitulo(c.titulo, p.nombre) >= 0;
    return {
      filtro: (c) => (!esParteFija(c) && (coincidePropio(c, p) || enTitulo(c) || tieneEtiqueta(c, deCel))) || (!!p.como && esDelMomento(c, p.como)),
      extra: (c) => puntajePropio(c, p) + (enTitulo(c) ? 4 : 0) + (tieneEtiqueta(c, deCel) ? 2 : 0)
    };
  }
  return { filtro: (c) => esDelMomento(c, momento) || !!momentoPorLetra(c, momento), extra: (c) => (esDelMomento(c, momento) ? 2 : 0) };
}

const VILLANCICO = tagNorm("Villancico"), NAVIDAD = tagNorm("Navidad");

export function puntajeCanto(c, ctx) {
  const tags = (c.etiquetas || []).map(normEtiqueta);
  let p = 0;
  // Un villancico es de Navidad aunque no lo diga
  const tiempos = tags.filter((t) => ctx.todosLosTiempos.has(t)).concat(tags.includes(VILLANCICO) && !tags.includes(NAVIDAD) ? [NAVIDAD] : []);
  if (ctx.tiempo && tiempos.includes(ctx.tiempo)) p += 5;
  else if (tags.some((t) => ctx.familia.has(t)) || tiempos.some((t) => ctx.familia.has(t))) p += 3;
  else if (tiempos.length) p -= 4;
  if (tags.some((t) => ctx.fiestas.has(t))) p += 6;
  if (ctx.celebracion?.size && (c.etiquetas || []).some((t) => ctx.celebracion.has(normEtiqueta(t)))) p += 6;
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
// En Post evangelio y Comunión va primero un canto del tema del Evangelio, y en el Salmo el del día; con
// `motivos` (un Map), anota momento → { texto, corto } (aparte, para no guardar nada nuevo en el cancionero).
// `evitar`: cancionId que no se sugieren (los de los domingos anteriores del mes).
function contexto(misa, lecturas, misas) {
  const tiempo = misa.tiempoLiturgico || tiempoPorFecha(misa.fechaUso);
  const dia = etiquetasDelDia(lecturas?.titulo);
  const cel = celebracionPorId(misa.celebracion);
  return {
    nombreTiempo: tiempo,
    tiempo: tagNorm(tiempo),
    familia: new Set((TIEMPO_FAMILIA[tiempo] || []).map(tagNorm)),
    todosLosTiempos: new Set(TIEMPOS.map(tagNorm)),
    fiestas: new Set(dia.fiestas.map(tagNorm)),
    mariano: dia.mariano || cel?.id === "mariana",
    marianas: new Set(MARIANAS.map(tagNorm)),
    cel,
    celebracion: new Set((cel?.etiquetas || []).map(normEtiqueta)),
    maria: temaMarianoDe(tiempo, misa.fechaUso),
    sinAleluya: TIEMPOS_SIN_ALELUYA.includes(tiempo),
    recientes: recientesDeComunidad(misa, misas),
    palabras: palabrasDe(textoLecturas(lecturas)),
    temas: temasDelEvangelio(lecturas)
  };
}

// Las canciones de la Biblioteca que sirven para un momento, de la mejor a la peor (para cambiar una canción
// en una emergencia). Con pocas del momento, completa con el resto ordenado por el tiempo.
export function candidatosMomento(biblioteca, momento, { fechaUso = "", tiempoLiturgico = "", celebracion = "", comunidad = "", lecturas = null, misas = [], limite = 0 } = {}) {
  const ctx = contexto({ fechaUso, tiempoLiturgico, celebracion, comunidad, id: "" }, lecturas, misas);
  const { filtro, extra } = criterioMomento(momento, ctx);
  const lista = biblioteca.map((c) => ({ c, del: filtro(c), p: puntajeCanto(c, ctx) + extra(c) }));
  lista.sort((a, b) => b.del - a.del || b.p - a.p || String(a.c.titulo).localeCompare(String(b.c.titulo), "es"));
  const r = lista.map((x) => ({ cancion: x.c, delMomento: x.del, puntaje: x.p }));
  return limite ? r.slice(0, limite) : r;
}

export function sugerirCantos(misa, lecturas, { reemplazar = false, biblioteca = [], misas = [], motivos = null, evitar = null } = {}) {
  const ctx = contexto(misa, lecturas, misas);
  const gemelas = gemelasDe(biblioteca), usadas = new Set();
  const usar = (id) => (gemelas.get(id) || [id]).forEach((x) => usadas.add(x));
  [...(evitar || []), ...misa.momentos.flatMap((m) => m.canciones.filter((c) => !c.sugerida).map((c) => c.cancionId))].forEach(usar);
  const temaDe = new Map();
  const temaDeCanto = (c) => {
    if (!temaDe.has(c.id)) temaDe.set(c.id, temaDelCanto(c, ctx.temas));
    return temaDe.get(c.id);
  };
  const pesoTema = (c) => 12 * (ctx.temas.length - ctx.temas.indexOf(temaDeCanto(c).tema));
  const elegir = (filtro, extra = () => 0) => {
    let mejor = null, mejorP = -Infinity, mejorH = 0;
    for (const c of biblioteca) {
      if (usadas.has(c.id) || !filtro(c)) continue;
      const p = puntajeCanto(c, ctx) + extra(c);
      const h = hashTexto((misa.fechaUso || "") + "|" + (misa.comunidad || "") + "|" + c.id);
      if (p > mejorP || (p === mejorP && h < mejorH)) [mejor, mejorP, mejorH] = [c, p, h];
    }
    return mejor;
  };
  const motivoTema = (c) => {
    const { tema, frase } = temaDeCanto(c);
    return { texto: `Tema: ${tema.nombre} · el canto dice «${frase}»`, corto: tema.nombre };
  };
  const claveComunion = claveMomento("Comunión"), clavePost = claveMomento("Post evangelio"), claveSalmo = claveMomento("Salmo responsorial");
  const claveMaria = claveMomento("Canto a María");
  let sugeridos = 0;
  for (const m of misa.momentos) {
    if (m.canciones.some((c) => !c.sugerida) || (m.canciones.length && !reemplazar)) continue;
    const k = claveMomento(m.momento), delMomento = (c) => esDelMomento(c, m.momento) || !!momentoPorLetra(c, m.momento);
    const propio = k === claveMaria ? null : momentoPropio(m.momento, ctx.cel);
    let mejor = null, motivo = null;
    if (k === claveMaria) {
      const { filtro, extra } = criterioMomento(m.momento, ctx);
      mejor = elegir(filtro, extra);
      if (mejor && ctx.maria && coincideMaria(mejor, ctx.maria)) motivo = { texto: esMesDeMaria(misa.fechaUso) ? "Para el Mes de María" : `En ${ctx.nombreTiempo}: ${ctx.maria.nombre}`, corto: ctx.maria.corto };
    } else if (propio) {
      const { filtro, extra } = criterioMomento(m.momento, ctx);
      mejor = elegir((c) => filtro(c) && !(propio.como && esDelMomento(c, propio.como) && !coincidePropio(c, propio)), (c) => extra(c) + (esDelMomento(c, m.momento) ? 2 : 0))
        || (propio.como ? elegir((c) => esDelMomento(c, propio.como)) : null);
      if (mejor) motivo = { texto: ctx.cel ? `Para ${ctx.cel.nombre.toLowerCase()}: ${m.momento}` : m.momento, corto: ctx.cel?.nombre || m.momento };
    } else if (ctx.temas.length && k === clavePost) {
      mejor = elegir((c) => temaDeCanto(c) && !esParteFija(c), (c) => pesoTema(c) + (esDelMomento(c, m.momento) ? 2 : 0));
      if (mejor) motivo = motivoTema(mejor);
    } else if (ctx.temas.length && k === claveComunion) {
      mejor = elegir((c) => temaDeCanto(c) && delMomento(c), pesoTema) || elegir((c) => temaDeCanto(c) && !esParteFija(c), pesoTema);
      if (mejor) motivo = motivoTema(mejor);
    } else if (k === claveSalmo) {
      const delDia = salmosDelDia(misa.fechaUso, lecturas, biblioteca);
      mejor = delDia.ids.size ? elegir((c) => delDia.ids.has(c.id)) : null;
      if (mejor) motivo = { texto: `El salmo del día (${delDia.nombre})`, corto: "del día" };
      // Si no está el del día, mejor uno que no sea propio de otro domingo
      else mejor = elegir((c) => esDelMomento(c, m.momento) || esSalmo(c), (c) => salmoPropio(c) ? -20 : 0);
    }
    if (motivo) motivos?.set(m.momento, motivo);
    else if (!mejor) {
      // Primero las que tienen la etiqueta del momento; si no hay, las que lo sugieren por el título o la letra
      mejor = elegir((c) => esDelMomento(c, m.momento)) || elegir((c) => !!momentoPorLetra(c, m.momento));
    }
    m.canciones = mejor ? [{ cancionId: mejor.id, desplazamiento: 0, sugerida: true }] : [];
    if (mejor) {
      usar(mejor.id);
      sugeridos++;
    }
  }
  return sugeridos;
}

// ============ LOS DOMINGOS DEL MES ============
// Los domingos se sugieren en cadena desde el primero del mes: ninguna canción se repite en el mes. La cadena
// no depende de la comunidad, así el reproductor, Inicio y Misas sugieren lo mismo para cada domingo.

const primerDomingoDelMes = (iso) => {
  const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, 1, 12);
  return sumarDias(d, (7 - d.getDay()) % 7);
};

// Los domingos del mes de «fecha» hasta esa fecha (inclusive)
export function domingosDelMes(fecha) {
  const fin = fechaMedioDia(fecha), lista = [];
  for (let d = primerDomingoDelMes(fecha); d <= fin; d = sumarDias(d, 7)) lista.push(isoDe(d));
  return lista;
}

// domingos: [{ fecha, lecturas }] en orden → [{ fecha, lecturas, misa, motivos, evitados }]
export function sugerirDomingos(domingos, { biblioteca = [], misas = [] } = {}) {
  const porMes = new Map();
  return domingos.map(({ fecha, lecturas }) => {
    const mes = fecha.slice(0, 7);
    if (!porMes.has(mes)) porMes.set(mes, new Set());
    const usadas = porMes.get(mes), evitados = new Set(usadas);
    const { tiempo, momentos } = momentosDeMisa(fecha, lecturas);
    const misa = { id: "domingo-" + fecha, comunidad: "", fechaUso: fecha, tiempoLiturgico: tiempo, momentos };
    const motivos = new Map();
    sugerirCantos(misa, lecturas, { biblioteca, misas, motivos, evitar: evitados });
    for (const m of momentos) for (const c of m.canciones) usadas.add(c.cancionId);
    return { fecha, lecturas, misa, motivos, evitados };
  });
}

// Los cantos sugeridos para los domingos anteriores del mes de «fecha» (para no repetirlos en esa misa).
// leerLecturas(fecha) → lecturas publicadas o null.
const conLecturas = (fechas, leerLecturas) => Promise.all(fechas.map((f) =>
  Promise.resolve().then(() => leerLecturas(f)).catch(() => null).then((lecturas) => ({ fecha: f, lecturas: lecturas || null }))));

export async function evitadosDelMes(fecha, leerLecturas, opciones) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "") || fechaMedioDia(fecha).getDay() !== 0) return new Set();
  return sugerirDomingos(await conLecturas(domingosDelMes(fecha), leerLecturas), opciones).at(-1).evitados;
}

// Para el Inicio del reproductor: desde el primer domingo del mes del próximo domingo, ese domingo (aunque no
// tenga lecturas) y los siguientes que ya están publicados en eucaristiadiaria.cl, hasta «semanas» más adelante
export async function domingosPublicados(leerLecturas, semanas = 8) {
  const proximo = proximoDomingo(), fin = sumarDias(fechaMedioDia(proximo), 7 * semanas), fechas = [];
  for (let d = primerDomingoDelMes(proximo); d <= fin; d = sumarDias(d, 7)) fechas.push(isoDe(d));
  const todas = await conLecturas(fechas, leerLecturas);
  const corte = todas.findIndex((d) => d.fecha > proximo && !d.lecturas);
  return corte < 0 ? todas : todas.slice(0, corte);
}
