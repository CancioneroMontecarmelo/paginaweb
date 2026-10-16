/**
 * Catálogo inicial: Arquidiócesis de Santiago + movimientos conocidos.
 * Coordenadas aproximadas por comuna (no son la puerta del templo).
 * Se importa con importarCatalogo (solo admin_general); no pisa slugs existentes.
 */

// Centro aproximado de cada comuna (RM)
const C = {
  Santiago: [-33.4372, -70.6506],
  Providencia: [-33.4263, -70.6103],
  'Las Condes': [-33.4089, -70.5671],
  Ñuñoa: [-33.4569, -70.5975],
  'La Florida': [-33.5225, -70.5983],
  Maipú: [-33.5112, -70.7581],
  'Puente Alto': [-33.6113, -70.5756],
  'San Bernardo': [-33.5922, -70.6996],
  'La Reina': [-33.4500, -70.5350],
  Vitacura: [-33.3900, -70.5750],
  Recoleta: [-33.4080, -70.6400],
  Independencia: [-33.4150, -70.6650],
  'Estación Central': [-33.4550, -70.6900],
  Quilicura: [-33.3610, -70.7290],
  'Huechuraba': [-33.3680, -70.6350],
  'Peñalolén': [-33.4800, -70.5450],
  Macul: [-33.4850, -70.6000],
  'San Miguel': [-33.4980, -70.6500],
  'La Cisterna': [-33.5300, -70.6630],
  'El Bosque': [-33.5600, -70.6750],
  'La Pintana': [-33.5830, -70.6340],
  'San Joaquín': [-33.4900, -70.6300],
  'Pedro Aguirre Cerda': [-33.4920, -70.6750],
  Loespejo: [-33.5200, -70.6900],
  Cerrillos: [-33.5000, -70.7150],
  Pudahuel: [-33.4450, -70.7650],
  'Cerro Navia': [-33.4250, -70.7350],
  Renca: [-33.4000, -70.7250],
  Conchalí: [-33.3850, -70.6750],
  Colina: [-33.2000, -70.6750],
  Buin: [-33.7320, -70.7420],
  Melipilla: [-33.6850, -71.2150],
  Talagante: [-33.6650, -70.9280],
  'Lo Barnechea': [-33.3500, -70.5150],
  'San Ramón': [-33.5350, -70.6450],
  'La Granja': [-33.5400, -70.6250],
  'Quinta Normal': [-33.4400, -70.7000]
};

function punto(comuna, i) {
  const c = C[comuna] || C.Santiago;
  // Pequeño desplazamiento para que no se apilen todos en el mismo pixel
  const d = ((i % 7) - 3) * 0.004;
  return { lat: Math.round((c[0] + d) * 1e4) / 1e4, lng: Math.round((c[1] + d * 0.7) * 1e4) / 1e4 };
}

const DIO = 'Arquidiócesis de Santiago';
const REG = 'Región Metropolitana';

function p(nombre, comuna, i, extra = {}) {
  const { lat, lng } = punto(comuna, i);
  return {
    tipo: 'parroquia', diocesis: DIO, region: REG, nombre, comuna, lat, lng, ...extra
  };
}

const PARROQUIAS_SANTIAGO = [
  p('Parroquia Catedral Metropolitana de Santiago', 'Santiago', 0),
  p('Parroquia San Francisco de Asís', 'Santiago', 1),
  p('Parroquia de la Recoleta Dominica', 'Recoleta', 2),
  p('Parroquia San Ramón', 'Recoleta', 3),
  p('Basílica de Lourdes', 'Quinta Normal', 4),
  p('Parroquia Nuestra Señora de Lourdes', 'Quilicura', 5),
  p('Parroquia San Alberto Hurtado', 'Peñalolén', 6),
  p('Parroquia Jesús Obrero', 'Peñalolén', 7),
  p('Parroquia Nuestra Señora del Carmen', 'Maipú', 8),
  p('Parroquia Cristo Rey', 'Maipú', 9),
  p('Parroquia San José de Maipú', 'Maipú', 10),
  p('Templo Votivo de Maipú', 'Maipú', 11),
  p('Parroquia Santo Domingo de Guzmán', 'Las Condes', 12),
  p('Parroquia San Vicente de Paul', 'Las Condes', 13),
  p('Parroquia Nuestra Señora de Fátima', 'Las Condes', 14),
  p('Parroquia Santa Rosa de Lima', 'Providencia', 15),
  p('Parroquia San Ramón Nonato', 'Providencia', 16),
  p('Parroquia Los Ángeles Custodios', 'Providencia', 17),
  p('Parroquia San Juan Evangelista', 'Ñuñoa', 18),
  p('Parroquia Santa Rosa', 'Ñuñoa', 19),
  p('Parroquia San José', 'Ñuñoa', 20),
  p('Parroquia Nuestra Señora de la Victoria', 'La Florida', 21),
  p('Parroquia San Francisco de Asís de La Florida', 'La Florida', 22),
  p('Parroquia Cristo Redentor', 'La Florida', 23),
  p('Parroquia San Pedro', 'Puente Alto', 24),
  p('Parroquia Nuestra Señora de la Merced', 'Puente Alto', 25),
  p('Parroquia San Bernardo', 'San Bernardo', 26),
  p('Parroquia El Salvador', 'San Bernardo', 27),
  p('Parroquia San Juan de Dios', 'La Reina', 28),
  p('Parroquia Nuestra Señora de Fátima de La Reina', 'La Reina', 29),
  p('Parroquia Santa María de la Esperanza', 'Vitacura', 30),
  p('Parroquia San Marcos', 'Vitacura', 31),
  p('Parroquia San Miguel Arcángel', 'San Miguel', 32),
  p('Parroquia Nuestra Señora de Lourdes', 'La Cisterna', 33),
  p('Parroquia Santa Teresa de Los Andes', 'Independencia', 34),
  p('Parroquia San Pablo', 'Estación Central', 35),
  p('Parroquia Corazón de María', 'Huechuraba', 36),
  p('Parroquia San José Obrero', 'Pudahuel', 37),
  p('Parroquia Cristo Liberador', 'Cerro Navia', 38),
  p('Parroquia San Cayetano', 'Renca', 39),
  p('Parroquia Nuestra Señora de la Merced', 'Recoleta', 40),
  p('Parroquia San Ignacio', 'Santiago', 41),
  p('Parroquia Santa Ana', 'Santiago', 42),
  p('Parroquia San Lázaro', 'Santiago', 43),
  p('Parroquia Los Santos Ángeles Custodios', 'Providencia', 44),
  p('Parroquia Jesús de Nazareth', 'Macul', 45),
  p('Parroquia San Luis Beltrán', 'Pudahuel', 46),
  p('Parroquia San José de la Montaña', 'Lo Barnechea', 47),
  p('Parroquia Santa Teresa de Jesús', 'Lo Barnechea', 48),
  p('Parroquia San Francisco de Sales', 'Colina', 49),
  p('Parroquia Nuestra Señora del Rosario', 'Buin', 50),
  p('Parroquia San José de Melipilla', 'Melipilla', 51),
  p('Parroquia Nuestra Señora de la Merced de Talagante', 'Talagante', 52),
  p('Parroquia San Ramón Nonato de San Ramón', 'San Ramón', 53),
  p('Parroquia Espíritu Santo', 'La Granja', 54),
  p('Parroquia San Alfonso', 'El Bosque', 55),
  p('Parroquia Nuestra Señora de la Paz', 'La Pintana', 56),
  p('Parroquia San José de San Joaquín', 'San Joaquín', 57),
  p('Parroquia Cristo de Mayo', 'Pedro Aguirre Cerda', 58),
  p('Parroquia San Sebastián', 'Cerrillos', 59),
  p('Parroquia San Antonio de Padua', 'Conchalí', 60)
];

const MOVIMIENTOS = [
  {
    tipo: 'movimiento', nombre: 'Movimiento de Schoenstatt', comuna: 'La Florida', region: REG,
    diocesis: DIO, ...punto('La Florida', 70)
  },
  {
    tipo: 'movimiento', nombre: 'Renovación Carismática Católica', comuna: 'Santiago', region: REG,
    diocesis: DIO, ...punto('Santiago', 71)
  },
  {
    tipo: 'movimiento', nombre: 'Comunidad de Vida Cristiana (CVX)', comuna: 'Providencia', region: REG,
    diocesis: DIO, ...punto('Providencia', 72)
  },
  {
    tipo: 'movimiento', nombre: 'Focolares', comuna: 'Ñuñoa', region: REG,
    diocesis: DIO, ...punto('Ñuñoa', 73)
  },
  {
    tipo: 'movimiento', nombre: 'Cursillos de Cristiandad', comuna: 'Santiago', region: REG,
    diocesis: DIO, ...punto('Santiago', 74)
  },
  {
    tipo: 'movimiento', nombre: 'Encuentro Matrimonial Mundial', comuna: 'Las Condes', region: REG,
    diocesis: DIO, ...punto('Las Condes', 75)
  },
  {
    tipo: 'movimiento', nombre: 'Legión de María', comuna: 'Santiago', region: REG,
    diocesis: DIO, ...punto('Santiago', 76)
  },
  {
    tipo: 'movimiento', nombre: 'Jóvenes de San José', comuna: 'Providencia', region: REG,
    diocesis: DIO, ...punto('Providencia', 77)
  }
];

export const CATALOGO_CHILE = [...PARROQUIAS_SANTIAGO, ...MOVIMIENTOS];
