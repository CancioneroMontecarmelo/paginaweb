/**
 * Catálogo diocesano. Fase actual: Arquidiócesis de Santiago por zona/decanato (sin fotos).
 * Zonas: Centro, Norte, Cordillera, Oriente, Maipo, Sur, Oeste (vicarías territoriales).
 * Otras diócesis quedan en CATALOGO_CHILE para fases siguientes.
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

export const DECANATOS_SANTIAGO = ['Centro', 'Norte', 'Cordillera', 'Oriente', 'Maipo', 'Sur', 'Oeste'];

const DECANATO_POR_COMUNA = {
  Santiago: 'Centro',
  Recoleta: 'Norte', Independencia: 'Norte', Conchalí: 'Norte', Huechuraba: 'Norte',
  Quilicura: 'Norte', Renca: 'Norte', Colina: 'Norte', Lampa: 'Norte', Tiltil: 'Norte',
  Providencia: 'Cordillera', 'Las Condes': 'Cordillera', Vitacura: 'Cordillera',
  'La Reina': 'Cordillera', 'Lo Barnechea': 'Cordillera',
  Ñuñoa: 'Oriente', Macul: 'Oriente', Peñalolén: 'Oriente', 'La Florida': 'Oriente',
  'Puente Alto': 'Maipo', Pirque: 'Maipo', 'San José de Maipo': 'Maipo',
  'San Miguel': 'Sur', 'San Joaquín': 'Sur', 'La Cisterna': 'Sur', 'El Bosque': 'Sur',
  'Pedro Aguirre Cerda': 'Sur', 'Lo Espejo': 'Sur', 'La Pintana': 'Sur', 'San Ramón': 'Sur', 'La Granja': 'Sur',
  'Quinta Normal': 'Oeste', 'Estación Central': 'Oeste', Pudahuel: 'Oeste',
  'Cerro Navia': 'Oeste', 'Lo Prado': 'Oeste', Cerrillos: 'Oeste', Maipú: 'Oeste'
};

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

/** Listado Santiago: [decanato, comuna, nombre] según vicarías territoriales. */
const FILAS_SANTIAGO = [
  [
    "Centro",
    "Santiago",
    "Parroquia Catedral Metropolitana de Santiago"
  ],
  [
    "Centro",
    "Santiago",
    "Basílica Nuestra Señora de la Merced"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia El Sagrario"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Inmaculado Corazón de María"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia La Asunción"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia La Vera Cruz"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Nuestra Señora del Asilo del Carmen"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Nuestra Señora del Perpetuo Socorro"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Nuestra Señora del Rosario de Andacollo"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Patronato San Antonio de Padua"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Sagrado Corazón de Jesús Alameda"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Andrés"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Francisco de Asís"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Gerardo"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Isidro Labrador"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Juan Evangelista"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Lázaro"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Pablo Apóstol"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Pío X"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Rafael Arcángel"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Saturnino"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Santa Ana"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Santa Lucrecia"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Santa Sofía"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia Santísima Trinidad"
  ],
  [
    "Centro",
    "Santiago",
    "Parroquia San Ignacio"
  ],
  [
    "Norte",
    "Recoleta",
    "Parroquia de la Recoleta Dominica"
  ],
  [
    "Norte",
    "Recoleta",
    "Parroquia de los Santos Apóstoles"
  ],
  [
    "Norte",
    "Recoleta",
    "Parroquia Nuestra Señora de La Merced El Salto"
  ],
  [
    "Norte",
    "Recoleta",
    "Parroquia Nuestra Señora del Carmen El Salto"
  ],
  [
    "Norte",
    "Recoleta",
    "Parroquia San Alberto de Sicilia"
  ],
  [
    "Norte",
    "Recoleta",
    "Parroquia Santa Filomena"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Cristo Crucificado"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Milagroso Niño Jesús de Praga"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Nuestra Señora de Fátima"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Nuestra Señora de la Estampa"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Nuestra Señora del Rosario Norte"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Nuestra Señora del Sagrado Corazón"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Santa Teresa del Niño Jesús Norte"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia Santo Tomás de Aquino"
  ],
  [
    "Norte",
    "Independencia",
    "Parroquia San José"
  ],
  [
    "Norte",
    "Conchalí",
    "Parroquia Nuestra Señora de Las Américas"
  ],
  [
    "Norte",
    "Conchalí",
    "Parroquia Nuestra Señora del Olivo"
  ],
  [
    "Norte",
    "Conchalí",
    "Parroquia San Diego de Alcalá"
  ],
  [
    "Norte",
    "Conchalí",
    "Parroquia San Luis Rey"
  ],
  [
    "Norte",
    "Conchalí",
    "Parroquia San Antonio de Padua"
  ],
  [
    "Norte",
    "Huechuraba",
    "Parroquia Nuestra Señora de los Pobres"
  ],
  [
    "Norte",
    "Huechuraba",
    "Parroquia Santa Inés"
  ],
  [
    "Norte",
    "Huechuraba",
    "Parroquia Corazón de María"
  ],
  [
    "Norte",
    "Quilicura",
    "Parroquia Nuestra Señora de Lourdes"
  ],
  [
    "Norte",
    "Quilicura",
    "Parroquia Nuestra Señora del Carmen Quilicura"
  ],
  [
    "Norte",
    "Quilicura",
    "Parroquia Sagrada Familia de Quilicura"
  ],
  [
    "Norte",
    "Quilicura",
    "Parroquia San Alberto Hurtado Quilicura"
  ],
  [
    "Norte",
    "Quilicura",
    "Parroquia San Juan Pablo II"
  ],
  [
    "Norte",
    "Renca",
    "Parroquia El Señor de Renca"
  ],
  [
    "Norte",
    "Renca",
    "Parroquia El Tránsito de San José"
  ],
  [
    "Norte",
    "Renca",
    "Parroquia Jesús Carpintero"
  ],
  [
    "Norte",
    "Renca",
    "Parroquia María Misionera Renca"
  ],
  [
    "Norte",
    "Renca",
    "Parroquia San Joaquín"
  ],
  [
    "Norte",
    "Renca",
    "Parroquia Santa María Madre"
  ],
  [
    "Norte",
    "Renca",
    "Parroquia San Cayetano"
  ],
  [
    "Norte",
    "Colina",
    "Parroquia San Francisco de Sales"
  ],
  [
    "Norte",
    "Colina",
    "Parroquia Jesús María y José"
  ],
  [
    "Norte",
    "Colina",
    "Parroquia Sagrado Corazón de Jesús de Esmeralda"
  ],
  [
    "Norte",
    "Colina",
    "Parroquia Santa Faustina"
  ],
  [
    "Norte",
    "Lampa",
    "Parroquia San José"
  ],
  [
    "Norte",
    "Lampa",
    "Parroquia Nuestra Señora del Carmen Lampa"
  ],
  [
    "Norte",
    "Lampa",
    "Parroquia Santa Teresa del Niño Jesús Batuco"
  ],
  [
    "Norte",
    "Tiltil",
    "Parroquia Nuestra Señora del Carmen"
  ],
  [
    "Norte",
    "Tiltil",
    "Parroquia Nuestra Señora del Huerto Tiltil"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Los Ángeles Custodios"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Santa Rosa de Lima"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia San Ramón Nonato"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Cristo Rey"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia La Epifanía de Nuestro Señor Jesucristo"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Nuestra Señora de Pompeya"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia San Crescente"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Santos Ángeles Custodios"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia La Anunciación del Señor"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Nuestra Señora de la Divina Providencia"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Sagrada Familia Providencia"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Sagrado Corazón de Jesús Providencia"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia San Francisco de Sales Providencia"
  ],
  [
    "Cordillera",
    "Providencia",
    "Parroquia Santa Bernardita"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Santo Domingo de Guzmán"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia San Vicente de Paul"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Nuestra Señora de Fátima"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia San Juan Apóstol"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia La Transfiguración del Señor"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Nuestra Señora de Apoquindo"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Nuestra Señora de Las Nieves"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Nuestra Señora de los Ángeles"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Nuestra Señora del Rosario Las Condes"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia San Alberto Hurtado Las Condes"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia San Patricio"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia San Pedro de Las Condes"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Santa Elena"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Santa María de Las Condes"
  ],
  [
    "Cordillera",
    "Las Condes",
    "Parroquia Santo Toribio de Mogrovejo"
  ],
  [
    "Cordillera",
    "Vitacura",
    "Parroquia Santa María de la Esperanza"
  ],
  [
    "Cordillera",
    "Vitacura",
    "Parroquia San Marcos"
  ],
  [
    "Cordillera",
    "Vitacura",
    "Parroquia Inmaculada Concepción Vitacura"
  ],
  [
    "Cordillera",
    "Vitacura",
    "Parroquia Nuestra Señora de Las Mercedes Vitacura"
  ],
  [
    "Cordillera",
    "Vitacura",
    "Parroquia San Francisco de Sales Vitacura"
  ],
  [
    "Cordillera",
    "La Reina",
    "Parroquia San Juan de Dios"
  ],
  [
    "Cordillera",
    "La Reina",
    "Parroquia Nuestra Señora de Fátima"
  ],
  [
    "Cordillera",
    "La Reina",
    "Parroquia La Natividad del Señor"
  ],
  [
    "Cordillera",
    "La Reina",
    "Parroquia San Carlos Borromeo La Reina"
  ],
  [
    "Cordillera",
    "La Reina",
    "Parroquia San José Patrono de la Iglesia"
  ],
  [
    "Cordillera",
    "La Reina",
    "Parroquia Santa Rita"
  ],
  [
    "Cordillera",
    "La Reina",
    "Parroquia San Juan Bautista La Reina"
  ],
  [
    "Cordillera",
    "Lo Barnechea",
    "Parroquia San José de la Montaña"
  ],
  [
    "Cordillera",
    "Lo Barnechea",
    "Parroquia Santa Teresa de Jesús"
  ],
  [
    "Cordillera",
    "Lo Barnechea",
    "Parroquia María Madre de Misericordia"
  ],
  [
    "Cordillera",
    "Lo Barnechea",
    "Parroquia Santa Rosa Lo Barnechea"
  ],
  [
    "Cordillera",
    "Lo Barnechea",
    "Parroquia Santa Teresa de Los Andes La Dehesa"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia San Juan Evangelista"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Santa Rosa"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia San José"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Nuestra Señora del Carmen"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Nuestra Señora de Luján"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia De la Santa Cruz Ñuñoa"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Nuestra Señora de la Paz"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Santa Gema Galgani"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Santa Marta"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia San Bruno"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Santa Catalina de Siena"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Santo Domingo de Guzmán"
  ],
  [
    "Oriente",
    "Ñuñoa",
    "Parroquia Santo Tomás Moro"
  ],
  [
    "Oriente",
    "Macul",
    "Parroquia Jesús de Nazareth"
  ],
  [
    "Oriente",
    "Macul",
    "Parroquia El Buen Pastor"
  ],
  [
    "Oriente",
    "Macul",
    "Parroquia Sagrada Familia Macul"
  ],
  [
    "Oriente",
    "Macul",
    "Parroquia San Luis Gonzaga"
  ],
  [
    "Oriente",
    "Macul",
    "Parroquia San Norberto"
  ],
  [
    "Oriente",
    "Macul",
    "Parroquia Santa María Reina del Mundo"
  ],
  [
    "Oriente",
    "Peñalolén",
    "Parroquia San Alberto Hurtado"
  ],
  [
    "Oriente",
    "Peñalolén",
    "Parroquia Jesús Obrero"
  ],
  [
    "Oriente",
    "Peñalolén",
    "Parroquia Cristo Nuestro Redentor"
  ],
  [
    "Oriente",
    "Peñalolén",
    "Parroquia Jesús Servidor"
  ],
  [
    "Oriente",
    "Peñalolén",
    "Parroquia Niño Jesús"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Nuestra Señora de la Victoria"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia San Francisco de Asís"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Cristo Redentor"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Santa María de La Florida"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Divino Redentor"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Jesús Maestro La Florida"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Jesús El Señor"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia María Madre de la Iglesia"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia San Francisco de Borja"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia San Francisco Solano"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia San José de Las Mercedes"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia San Vicente de Paul"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Santa Cruz de Mayo"
  ],
  [
    "Oriente",
    "La Florida",
    "Parroquia Santa Margarita de Escocia"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia San Pedro"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia Nuestra Señora de la Merced"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia San Luis"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia Beato Pedro Bonilli"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia La Natividad del Señor Puente Alto"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia La Transfiguración del Señor Puente Alto"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia Madre de la Divina Providencia"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia Nuestra Señora de Las Mercedes Puente Alto"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia Nuestra Señora de Montserrat"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia San Carlos Borromeo Puente Alto"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia San Esteban Puente Alto"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia San Gaspar Bertoni"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia San Matías"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia San Pedro Nolasco"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia Santa María Magdalena"
  ],
  [
    "Maipo",
    "Puente Alto",
    "Parroquia Santa Teresa de Los Andes Puente Alto"
  ],
  [
    "Maipo",
    "San José de Maipo",
    "Parroquia Nuestra Señora del Carmen"
  ],
  [
    "Maipo",
    "San José de Maipo",
    "Parroquia Inmaculada Concepción"
  ],
  [
    "Maipo",
    "Pirque",
    "Parroquia San José"
  ],
  [
    "Sur",
    "San Miguel",
    "Parroquia San Miguel Arcángel"
  ],
  [
    "Sur",
    "San Miguel",
    "Parroquia La Resurrección del Señor"
  ],
  [
    "Sur",
    "San Miguel",
    "Parroquia San Antonio María Claret"
  ],
  [
    "Sur",
    "San Miguel",
    "Parroquia Santa María de la Esperanza Sur"
  ],
  [
    "Sur",
    "San Miguel",
    "Parroquia Santo Cura de Ars"
  ],
  [
    "Sur",
    "San Joaquín",
    "Parroquia San José"
  ],
  [
    "Sur",
    "San Joaquín",
    "Parroquia Cristo Rey"
  ],
  [
    "Sur",
    "San Joaquín",
    "Parroquia Espíritu Santo"
  ],
  [
    "Sur",
    "San Joaquín",
    "Parroquia San Cayetano"
  ],
  [
    "Sur",
    "San Joaquín",
    "Parroquia San Damián de Molokai"
  ],
  [
    "Sur",
    "San Joaquín",
    "Parroquia San Nicolás de Tolentino"
  ],
  [
    "Sur",
    "San Joaquín",
    "Parroquia Santa Cristina"
  ],
  [
    "Sur",
    "La Cisterna",
    "Parroquia Nuestra Señora de Lourdes"
  ],
  [
    "Sur",
    "La Cisterna",
    "Parroquia San Francisco de Asís La Cisterna"
  ],
  [
    "Sur",
    "La Cisterna",
    "Parroquia San Juan Bosco"
  ],
  [
    "Sur",
    "La Cisterna",
    "Parroquia Santa Clara"
  ],
  [
    "Sur",
    "El Bosque",
    "Parroquia San Alfonso"
  ],
  [
    "Sur",
    "El Bosque",
    "Parroquia Ascensión del Señor Sur"
  ],
  [
    "Sur",
    "El Bosque",
    "Parroquia San Columbano"
  ],
  [
    "Sur",
    "La Granja",
    "Parroquia Espíritu Santo"
  ],
  [
    "Sur",
    "La Granja",
    "Parroquia Los Doce Apóstoles"
  ],
  [
    "Sur",
    "La Granja",
    "Parroquia San Gregorio"
  ],
  [
    "Sur",
    "La Granja",
    "Parroquia San Pedro y San Pablo"
  ],
  [
    "Sur",
    "La Pintana",
    "Parroquia Nuestra Señora de la Paz"
  ],
  [
    "Sur",
    "La Pintana",
    "Parroquia San Esteban Mártir Sur"
  ],
  [
    "Sur",
    "La Pintana",
    "Parroquia Santo Tomás Apóstol"
  ],
  [
    "Sur",
    "Lo Espejo",
    "Parroquia San Francisco"
  ],
  [
    "Sur",
    "Lo Espejo",
    "Parroquia La Madre de Dios"
  ],
  [
    "Sur",
    "Lo Espejo",
    "Parroquia Sagrado Corazón de Jesús Lo Espejo"
  ],
  [
    "Sur",
    "Lo Espejo",
    "Parroquia San José Obrero"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia Cristo de Mayo"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia María Mediadora"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia Nuestra Señora de La Victoria"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia Nuestra Señora del Monte Carmelo"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia Nuestra Señora Reina de los Apóstoles"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia San Juan Bautista Sur"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia San Lucas"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia San Martín de Porres"
  ],
  [
    "Sur",
    "Pedro Aguirre Cerda",
    "Parroquia San Mateo"
  ],
  [
    "Sur",
    "San Ramón",
    "Parroquia San Ramón Nonato"
  ],
  [
    "Sur",
    "San Ramón",
    "Parroquia Inmaculada Concepción San Ramón"
  ],
  [
    "Sur",
    "San Ramón",
    "Parroquia Jesús Señor de la Vida"
  ],
  [
    "Sur",
    "San Ramón",
    "Parroquia Nuestra Señora de los Parrales"
  ],
  [
    "Sur",
    "San Ramón",
    "Parroquia San Antonio de Padua Sur"
  ],
  [
    "Sur",
    "San Ramón",
    "Parroquia Santo Domingo Savio"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Basílica de Lourdes"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Parroquia San Vicente de Paul"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Parroquia Nuestra Señora de Guadalupe"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Parroquia Nuestra Señora de la Medalla Milagrosa"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Parroquia Nuestra Señora de los Dolores"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Parroquia Nuestra Señora de Lourdes Oeste"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Parroquia Nuestra Señora del Buen Consejo"
  ],
  [
    "Oeste",
    "Quinta Normal",
    "Parroquia San José Plaza Garín"
  ],
  [
    "Oeste",
    "Estación Central",
    "Parroquia San Pablo"
  ],
  [
    "Oeste",
    "Estación Central",
    "Parroquia Apóstol Santiago"
  ],
  [
    "Oeste",
    "Estación Central",
    "Parroquia Jesús de Nazareth"
  ],
  [
    "Oeste",
    "Estación Central",
    "Parroquia Jesús Maestro Oeste"
  ],
  [
    "Oeste",
    "Estación Central",
    "Parroquia Jesús Obrero"
  ],
  [
    "Oeste",
    "Estación Central",
    "Parroquia Santa Cruz Los Nogales"
  ],
  [
    "Oeste",
    "Estación Central",
    "Parroquia Santa Isabel de Hungría"
  ],
  [
    "Oeste",
    "Maipú",
    "Templo Votivo de Maipú"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia Nuestra Señora del Carmen"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia Cristo Rey"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia San José de Maipú"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia El Señor de Maipú"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia Cristo Resucitado Maipú"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia Inmaculada Concepción Maipú"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia Inmaculado Corazón de María Maipú"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia María Madre de los Apóstoles"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia María Misionera Maipú"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia Nuestra Señora de la Visitación"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia San Francisco de Los Pajaritos"
  ],
  [
    "Oeste",
    "Maipú",
    "Parroquia Santa María de la Esperanza Maipú"
  ],
  [
    "Oeste",
    "Pudahuel",
    "Parroquia San José Obrero"
  ],
  [
    "Oeste",
    "Pudahuel",
    "Parroquia San Luis Beltrán"
  ],
  [
    "Oeste",
    "Pudahuel",
    "Parroquia Ascensión del Señor Oeste"
  ],
  [
    "Oeste",
    "Pudahuel",
    "Parroquia El Salvador"
  ],
  [
    "Oeste",
    "Pudahuel",
    "Parroquia Santa María del Sur"
  ],
  [
    "Oeste",
    "Cerro Navia",
    "Parroquia Cristo Liberador"
  ],
  [
    "Oeste",
    "Cerro Navia",
    "Parroquia Cristo Evangelizador y Solidario"
  ],
  [
    "Oeste",
    "Cerro Navia",
    "Parroquia María Reina de la Paz"
  ],
  [
    "Oeste",
    "Cerro Navia",
    "Parroquia Nuestra Señora de La Preciosa Sangre"
  ],
  [
    "Oeste",
    "Lo Prado",
    "Parroquia San José"
  ],
  [
    "Oeste",
    "Lo Prado",
    "Parroquia Cristo de Emaús"
  ],
  [
    "Oeste",
    "Lo Prado",
    "Parroquia San Gabriel"
  ],
  [
    "Oeste",
    "Cerrillos",
    "Parroquia San Sebastián"
  ],
  [
    "Oeste",
    "Cerrillos",
    "Parroquia Nuestra Señora de la Reconciliación"
  ],
  [
    "Oeste",
    "Cerrillos",
    "Parroquia San Francisco Javier"
  ],
  [
    "Oeste",
    "Cerrillos",
    "Parroquia San Juan de Dios"
  ],
  [
    "Oeste",
    "Cerrillos",
    "Parroquia San Luis Orione"
  ]
];

const SANTIAGO = FILAS_SANTIAGO.map(([decanato, comuna, nombre]) =>
  entrada(nombre, comuna, AS, RM, { decanato }));

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
  { tipo: 'movimiento', nombre: 'Movimiento de Schoenstatt', comuna: 'La Florida', region: RM, diocesis: AS, decanato: 'Oriente', ...punto('La Florida', 900) },
  { tipo: 'movimiento', nombre: 'Renovación Carismática Católica', comuna: 'Santiago', region: RM, diocesis: AS, decanato: 'Centro', ...punto('Santiago', 901) },
  { tipo: 'movimiento', nombre: 'Comunidad de Vida Cristiana (CVX)', comuna: 'Providencia', region: RM, diocesis: AS, decanato: 'Cordillera', ...punto('Providencia', 902) },
  { tipo: 'movimiento', nombre: 'Focolares', comuna: 'Ñuñoa', region: RM, diocesis: AS, decanato: 'Oriente', ...punto('Ñuñoa', 903) },
  { tipo: 'movimiento', nombre: 'Cursillos de Cristiandad', comuna: 'Santiago', region: RM, diocesis: AS, decanato: 'Centro', ...punto('Santiago', 904) },
  { tipo: 'movimiento', nombre: 'Encuentro Matrimonial Mundial', comuna: 'Las Condes', region: RM, diocesis: AS, decanato: 'Cordillera', ...punto('Las Condes', 905) },
  { tipo: 'movimiento', nombre: 'Legión de María', comuna: 'Santiago', region: RM, diocesis: AS, decanato: 'Centro', ...punto('Santiago', 906) },
  { tipo: 'movimiento', nombre: 'Jóvenes de San José', comuna: 'Providencia', region: RM, diocesis: AS, decanato: 'Cordillera', ...punto('Providencia', 907) },
  { tipo: 'movimiento', nombre: 'Schoenstatt Valparaíso', comuna: 'Viña del Mar', region: RV, diocesis: DV, ...punto('Viña del Mar', 908) }
];

/** Fase actual: solo Arquidiócesis de Santiago, sin fotos. */
export const CATALOGO_SANTIAGO = SANTIAGO;

/** Catálogo completo (otras diócesis para fases siguientes). */
export const CATALOGO_CHILE = [...SANTIAGO, ...SAN_BERNARDO, ...MELIPILLA, ...VALPARAISO, ...MOVIMIENTOS];
