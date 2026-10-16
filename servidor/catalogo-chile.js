/**
 * Catálogo diocesano. Fase actual: Arquidiócesis de Santiago por decanato (sin fotos).
 * Otras diócesis quedan exportadas en CATALOGO_CHILE para fases siguientes.
 * Coords = centro aproximado de la comuna (no la puerta del templo).
 */

const C = {
  Santiago: [-33.4372, -70.6506], Providencia: [-33.4263, -70.6103], 'Las Condes': [-33.4089, -70.5671],
  Ñuñoa: [-33.4569, -70.5975], 'La Florida': [-33.5225, -70.5983], Maipú: [-33.5112, -70.7581],
  'Puente Alto': [-33.6113, -70.5756], 'San Bernardo': [-33.5922, -70.6996], 'La Reina': [-33.4500, -70.5350],
  Vitacura: [-33.3900, -70.5750], Recoleta: [-33.4080, -70.6400], Independencia: [-33.4150, -70.6650],
  'Estación Central': [-33.4550, -70.6900], Quilicura: [-33.3610, -70.7290], Huechuraba: [-33.3680, -70.6350],
  Peñalolén: [-33.4800, -70.5450], Macul: [-33.4850, -70.6000], 'San Miguel': [-33.4980, -70.6500],
  'La Cisterna': [-33.5300, -70.6630], 'El Bosque': [-33.5600, -70.6750], 'La Pintana': [-33.5830, -70.6340],
  'San Joaquín': [-33.4900, -70.6300], 'Pedro Aguirre Cerda': [-33.4920, -70.6750], 'Lo Espejo': [-33.5200, -70.6900],
  Cerrillos: [-33.5000, -70.7150], Pudahuel: [-33.4450, -70.7650], 'Cerro Navia': [-33.4250, -70.7350],
  Renca: [-33.4000, -70.7250], Conchalí: [-33.3850, -70.6750], Colina: [-33.2000, -70.6750],
  Buin: [-33.7320, -70.7420], Melipilla: [-33.6850, -71.2150], Talagante: [-33.6650, -70.9280],
  'Lo Barnechea': [-33.3500, -70.5150], 'San Ramón': [-33.5350, -70.6450], 'La Granja': [-33.5400, -70.6250],
  'Quinta Normal': [-33.4400, -70.7000], 'Lo Prado': [-33.4440, -70.7250], 'Padre Hurtado': [-33.5660, -70.8000],
  Peñaflor: [-33.6060, -70.8760], Curacaví: [-33.4000, -71.1330], 'El Monte': [-33.6800, -71.0000],
  'Isla de Maipo': [-33.7500, -70.9000], 'Calera de Tango': [-33.6300, -70.7800], Paine: [-33.8100, -70.7500],
  Lampa: [-33.2830, -70.8750], Tiltil: [-33.0850, -70.9280], Pirque: [-33.6330, -70.5500],
  'San José de Maipo': [-33.6400, -70.3500], Valparaíso: [-33.0458, -71.6197], 'Viña del Mar': [-33.0245, -71.5518],
  Quilpué: [-33.0490, -71.4420], 'Villa Alemana': [-33.0420, -71.3730], Concón: [-32.9300, -71.5200],
  Quillota: [-32.8830, -71.2500], Limache: [-32.9830, -71.2670], Olmué: [-32.9950, -71.1750],
  Casablanca: [-33.3200, -71.4100], 'San Antonio': [-33.5950, -71.6120], Cartagena: [-33.5500, -71.6000],
  'El Quisco': [-33.4000, -71.7000], Algarrobo: [-33.3700, -71.6700], 'La Cruz': [-32.8250, -71.2250],
  Hijuelas: [-32.8000, -71.1500], Nogales: [-32.7300, -71.2000], 'La Calera': [-32.7850, -71.2050]
};

/** Decanato pastoral aproximado por comuna (Arquidiócesis de Santiago). */
const DECANATO_POR_COMUNA = {
  Santiago: 'Centro',
  Recoleta: 'Norte', Independencia: 'Norte', Conchalí: 'Norte', Huechuraba: 'Norte',
  Quilicura: 'Norte', Renca: 'Norte', Colina: 'Norte', Lampa: 'Norte', Tiltil: 'Norte',
  Providencia: 'Oriente', 'Las Condes': 'Oriente', Vitacura: 'Oriente', 'La Reina': 'Oriente',
  'Lo Barnechea': 'Oriente', Ñuñoa: 'Oriente', Macul: 'Oriente', Peñalolén: 'Oriente',
  'La Florida': 'Suroriente', 'Puente Alto': 'Suroriente', Pirque: 'Suroriente',
  'San José de Maipo': 'Suroriente', 'La Pintana': 'Suroriente', 'San Ramón': 'Suroriente', 'La Granja': 'Suroriente',
  'San Miguel': 'Sur', 'San Joaquín': 'Sur', 'La Cisterna': 'Sur', 'El Bosque': 'Sur',
  'Pedro Aguirre Cerda': 'Sur', 'Lo Espejo': 'Sur',
  'Quinta Normal': 'Poniente', 'Estación Central': 'Poniente', Pudahuel: 'Poniente',
  'Cerro Navia': 'Poniente', 'Lo Prado': 'Poniente', Cerrillos: 'Poniente', Maipú: 'Poniente'
};

export const DECANATOS_SANTIAGO = ['Centro', 'Norte', 'Oriente', 'Suroriente', 'Sur', 'Poniente'];

function punto(comuna, i) {
  const c = C[comuna] || C.Santiago;
  const d = ((i % 7) - 3) * 0.004;
  return { lat: Math.round((c[0] + d) * 1e4) / 1e4, lng: Math.round((c[1] + d * 0.7) * 1e4) / 1e4 };
}

let seq = 0;
function entrada(nombre, comuna, diocesis, region, extra = {}) {
  const i = seq++;
  const decanato = extra.decanato || DECANATO_POR_COMUNA[comuna] || '';
  const { fotoUrl: _foto, ...resto } = extra;
  return {
    tipo: 'parroquia', diocesis, region, nombre, comuna,
    ...(decanato ? { decanato } : {}),
    ...punto(comuna, i),
    ...resto
  };
}

const AS = 'Arquidiócesis de Santiago';
const RM = 'Región Metropolitana';
const DSB = 'Diócesis de San Bernardo';
const DM = 'Diócesis de Melipilla';
const DV = 'Diócesis de Valparaíso';
const RV = 'Región de Valparaíso';

// --- Santiago (muestra amplia por comuna; no es el listado canónico completo de las ~200) ---
const SANTIAGO = [
  entrada('Parroquia Catedral Metropolitana de Santiago', 'Santiago', AS, RM),
  entrada('Parroquia San Francisco de Asís', 'Santiago', AS, RM),
  entrada('Parroquia Santa Ana', 'Santiago', AS, RM),
  entrada('Parroquia San Ignacio', 'Santiago', AS, RM),
  entrada('Parroquia San Lázaro', 'Santiago', AS, RM),
  entrada('Basílica de la Merced', 'Santiago', AS, RM),
  entrada('Parroquia El Sagrario', 'Santiago', AS, RM),
  entrada('Parroquia San Saturnino', 'Santiago', AS, RM),
  entrada('Parroquia de la Recoleta Dominica', 'Recoleta', AS, RM),
  entrada('Parroquia San Ramón', 'Recoleta', AS, RM),
  entrada('Parroquia Nuestra Señora de la Merced', 'Recoleta', AS, RM),
  entrada('Basílica de Lourdes', 'Quinta Normal', AS, RM),
  entrada('Parroquia San Vicente de Paul', 'Quinta Normal', AS, RM),
  entrada('Parroquia San José', 'Independencia', AS, RM),
  entrada('Parroquia Santa Teresa de Los Andes', 'Independencia', AS, RM),
  entrada('Parroquia San Pablo', 'Estación Central', AS, RM),
  entrada('Parroquia Los Ángeles Custodios', 'Providencia', AS, RM),
  entrada('Parroquia Santa Rosa de Lima', 'Providencia', AS, RM),
  entrada('Parroquia San Ramón Nonato', 'Providencia', AS, RM),
  entrada('Parroquia Cristo Rey', 'Providencia', AS, RM),
  entrada('Parroquia Santo Domingo de Guzmán', 'Las Condes', AS, RM),
  entrada('Parroquia San Vicente de Paul', 'Las Condes', AS, RM),
  entrada('Parroquia Nuestra Señora de Fátima', 'Las Condes', AS, RM),
  entrada('Parroquia San Juan Apostol', 'Las Condes', AS, RM),
  entrada('Parroquia Santa María de la Esperanza', 'Vitacura', AS, RM),
  entrada('Parroquia San Marcos', 'Vitacura', AS, RM),
  entrada('Parroquia San Juan de Dios', 'La Reina', AS, RM),
  entrada('Parroquia Nuestra Señora de Fátima', 'La Reina', AS, RM),
  entrada('Parroquia San José de la Montaña', 'Lo Barnechea', AS, RM),
  entrada('Parroquia Santa Teresa de Jesús', 'Lo Barnechea', AS, RM),
  entrada('Parroquia San Juan Evangelista', 'Ñuñoa', AS, RM),
  entrada('Parroquia Santa Rosa', 'Ñuñoa', AS, RM),
  entrada('Parroquia San José', 'Ñuñoa', AS, RM),
  entrada('Parroquia Nuestra Señora del Carmen', 'Ñuñoa', AS, RM),
  entrada('Parroquia Jesús de Nazareth', 'Macul', AS, RM),
  entrada('Parroquia San Alberto Hurtado', 'Peñalolén', AS, RM),
  entrada('Parroquia Jesús Obrero', 'Peñalolén', AS, RM),
  entrada('Parroquia Nuestra Señora de la Victoria', 'La Florida', AS, RM),
  entrada('Parroquia San Francisco de Asís', 'La Florida', AS, RM),
  entrada('Parroquia Cristo Redentor', 'La Florida', AS, RM),
  entrada('Parroquia Santa María de La Florida', 'La Florida', AS, RM),
  entrada('Templo Votivo de Maipú', 'Maipú', AS, RM),
  entrada('Parroquia Nuestra Señora del Carmen', 'Maipú', AS, RM),
  entrada('Parroquia Cristo Rey', 'Maipú', AS, RM),
  entrada('Parroquia San José de Maipú', 'Maipú', AS, RM),
  entrada('Parroquia El Señor de Maipú', 'Maipú', AS, RM),
  entrada('Parroquia San Pedro', 'Puente Alto', AS, RM),
  entrada('Parroquia Nuestra Señora de la Merced', 'Puente Alto', AS, RM),
  entrada('Parroquia San Luis', 'Puente Alto', AS, RM),
  entrada('Parroquia San Miguel Arcángel', 'San Miguel', AS, RM),
  entrada('Parroquia Nuestra Señora de Lourdes', 'La Cisterna', AS, RM),
  entrada('Parroquia San Alfonso', 'El Bosque', AS, RM),
  entrada('Parroquia Espíritu Santo', 'La Granja', AS, RM),
  entrada('Parroquia Nuestra Señora de la Paz', 'La Pintana', AS, RM),
  entrada('Parroquia San Ramón Nonato', 'San Ramón', AS, RM),
  entrada('Parroquia San José', 'San Joaquín', AS, RM),
  entrada('Parroquia Cristo de Mayo', 'Pedro Aguirre Cerda', AS, RM),
  entrada('Parroquia San Sebastián', 'Cerrillos', AS, RM),
  entrada('Parroquia San José Obrero', 'Pudahuel', AS, RM),
  entrada('Parroquia San Luis Beltrán', 'Pudahuel', AS, RM),
  entrada('Parroquia Cristo Liberador', 'Cerro Navia', AS, RM),
  entrada('Parroquia San Cayetano', 'Renca', AS, RM),
  entrada('Parroquia San Antonio de Padua', 'Conchalí', AS, RM),
  entrada('Parroquia Corazón de María', 'Huechuraba', AS, RM),
  entrada('Parroquia Nuestra Señora de Lourdes', 'Quilicura', AS, RM),
  entrada('Parroquia San Francisco de Sales', 'Colina', AS, RM),
  entrada('Parroquia San José', 'Lampa', AS, RM),
  entrada('Parroquia Nuestra Señora del Carmen', 'Tiltil', AS, RM),
  entrada('Parroquia San José', 'Pirque', AS, RM),
  entrada('Parroquia Nuestra Señora del Carmen', 'San José de Maipo', AS, RM),
  entrada('Parroquia San José', 'Lo Prado', AS, RM),
  entrada('Parroquia San Francisco', 'Lo Espejo', AS, RM)
];

// Diócesis reservadas para fases siguientes
const SAN_BERNARDO = [
  entrada('Parroquia Catedral de San Bernardo', 'San Bernardo', DSB, RM),
  entrada('Parroquia El Salvador', 'San Bernardo', DSB, RM),
  entrada('Parroquia San Juan Evangelista', 'San Bernardo', DSB, RM),
  entrada('Parroquia Nuestra Señora de Lourdes', 'San Bernardo', DSB, RM),
  entrada('Parroquia San Francisco de Asís', 'San Bernardo', DSB, RM),
  entrada('Parroquia Cristo Rey', 'San Bernardo', DSB, RM),
  entrada('Parroquia Nuestra Señora del Rosario', 'Buin', DSB, RM),
  entrada('Parroquia San Martín de Tours', 'Buin', DSB, RM),
  entrada('Parroquia San José', 'Paine', DSB, RM),
  entrada('Parroquia Nuestra Señora del Carmen', 'Calera de Tango', DSB, RM),
  entrada('Parroquia Santa Teresa de Los Andes', 'Puente Alto', DSB, RM)
];

const MELIPILLA = [
  entrada('Parroquia San José de Melipilla', 'Melipilla', DM, RM),
  entrada('Parroquia Nuestra Señora de la Merced', 'Melipilla', DM, RM),
  entrada('Parroquia Nuestra Señora de la Merced', 'Talagante', DM, RM),
  entrada('Parroquia San José', 'Talagante', DM, RM),
  entrada('Parroquia San Antonio', 'Peñaflor', DM, RM),
  entrada('Parroquia Nuestra Señora del Carmen', 'Padre Hurtado', DM, RM),
  entrada('Parroquia San Francisco', 'El Monte', DM, RM),
  entrada('Parroquia Nuestra Señora del Rosario', 'Isla de Maipo', DM, RM),
  entrada('Parroquia San José', 'Curacaví', DM, RM)
];

const VALPARAISO = [
  entrada('Parroquia Catedral de Valparaíso', 'Valparaíso', DV, RV),
  entrada('Parroquia Los Doce Apóstoles', 'Valparaíso', DV, RV),
  entrada('Parroquia Espíritu Santo', 'Valparaíso', DV, RV),
  entrada('Parroquia San Francisco', 'Valparaíso', DV, RV),
  entrada('Parroquia La Matriz', 'Valparaíso', DV, RV),
  entrada('Parroquia Nuestra Señora de Lourdes', 'Valparaíso', DV, RV),
  entrada('Parroquia San José', 'Valparaíso', DV, RV),
  entrada('Parroquia Nuestra Señora de los Dolores', 'Viña del Mar', DV, RV),
  entrada('Parroquia Presbítero Francisco Javier Ballester', 'Viña del Mar', DV, RV),
  entrada('Parroquia Inmaculada Concepción', 'Viña del Mar', DV, RV),
  entrada('Parroquia San Vicente de Paul', 'Viña del Mar', DV, RV),
  entrada('Parroquia Nuestra Señora de Fátima', 'Viña del Mar', DV, RV),
  entrada('Parroquia Santa María de los Ángeles', 'Viña del Mar', DV, RV),
  entrada('Parroquia San José', 'Quilpué', DV, RV),
  entrada('Parroquia Nuestra Señora del Carmen', 'Quilpué', DV, RV),
  entrada('Parroquia Cristo Rey', 'Villa Alemana', DV, RV),
  entrada('Parroquia San Antonio', 'Villa Alemana', DV, RV),
  entrada('Parroquia Nuestra Señora de Lourdes', 'Concón', DV, RV),
  entrada('Parroquia San José', 'Quillota', DV, RV),
  entrada('Parroquia Santo Domingo', 'Quillota', DV, RV),
  entrada('Parroquia Nuestra Señora del Carmen', 'Limache', DV, RV),
  entrada('Parroquia San José', 'Olmué', DV, RV),
  entrada('Parroquia San Sebastián', 'Casablanca', DV, RV),
  entrada('Parroquia San Antonio de Padua', 'San Antonio', DV, RV),
  entrada('Parroquia Santa Teresa de Los Andes', 'San Antonio', DV, RV),
  entrada('Parroquia San José', 'Cartagena', DV, RV),
  entrada('Parroquia Nuestra Señora del Carmen', 'El Quisco', DV, RV),
  entrada('Parroquia San José', 'Algarrobo', DV, RV),
  entrada('Parroquia Nuestra Señora de Lourdes', 'La Calera', DV, RV),
  entrada('Parroquia San Francisco', 'La Cruz', DV, RV)
];

const MOVIMIENTOS = [
  { tipo: 'movimiento', nombre: 'Movimiento de Schoenstatt', comuna: 'La Florida', region: RM, diocesis: AS, decanato: 'Suroriente', ...punto('La Florida', 200) },
  { tipo: 'movimiento', nombre: 'Renovación Carismática Católica', comuna: 'Santiago', region: RM, diocesis: AS, decanato: 'Centro', ...punto('Santiago', 201) },
  { tipo: 'movimiento', nombre: 'Comunidad de Vida Cristiana (CVX)', comuna: 'Providencia', region: RM, diocesis: AS, decanato: 'Oriente', ...punto('Providencia', 202) },
  { tipo: 'movimiento', nombre: 'Focolares', comuna: 'Ñuñoa', region: RM, diocesis: AS, decanato: 'Oriente', ...punto('Ñuñoa', 203) },
  { tipo: 'movimiento', nombre: 'Cursillos de Cristiandad', comuna: 'Santiago', region: RM, diocesis: AS, decanato: 'Centro', ...punto('Santiago', 204) },
  { tipo: 'movimiento', nombre: 'Encuentro Matrimonial Mundial', comuna: 'Las Condes', region: RM, diocesis: AS, decanato: 'Oriente', ...punto('Las Condes', 205) },
  { tipo: 'movimiento', nombre: 'Legión de María', comuna: 'Santiago', region: RM, diocesis: AS, decanato: 'Centro', ...punto('Santiago', 206) },
  { tipo: 'movimiento', nombre: 'Jóvenes de San José', comuna: 'Providencia', region: RM, diocesis: AS, decanato: 'Oriente', ...punto('Providencia', 207) },
  { tipo: 'movimiento', nombre: 'Schoenstatt Valparaíso', comuna: 'Viña del Mar', region: RV, diocesis: DV, ...punto('Viña del Mar', 208) }
];

/** Fase actual: solo Arquidiócesis de Santiago, sin fotos. */
export const CATALOGO_SANTIAGO = SANTIAGO;

/** Catálogo completo (otras diócesis para fases siguientes). */
export const CATALOGO_CHILE = [...SANTIAGO, ...SAN_BERNARDO, ...MELIPILLA, ...VALPARAISO, ...MOVIMIENTOS];
