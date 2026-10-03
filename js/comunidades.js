/** Catálogo de comunidades de la parroquia. */

export const COMUNIDADES = [
  {
    slug: "maria-de-nazaret",
    nombre: "Capilla María de Nazaret",
    carpetaCancioneros: "Capilla Maria de Nazaret",
    noticias: "maria-de-nazaret.json"
  },
  {
    slug: "san-pablo-apostol",
    nombre: "San Pablo Apóstol",
    carpetaCancioneros: "San Pablo Apostol",
    noticias: "san-pablo-apostol.json"
  },
  {
    slug: "sagrada-familia",
    nombre: "Sagrada Familia",
    carpetaCancioneros: "Sagrada Familia",
    noticias: "sagrada-familia.json"
  },
  {
    slug: "monte-carmelo",
    nombre: "Nuestra Señora del Monte Carmelo",
    carpetaCancioneros: "Nuestra Señora del Monte Carmelo",
    noticias: "monte-carmelo.json"
  }
];

export const PARROQUIA = {
  slug: "parroquia",
  nombre: "Parroquia Nuestra Señora del Monte Carmelo",
  noticias: "parroquia.json"
};

export function comunidadPorSlug(slug) {
  return COMUNIDADES.find((c) => c.slug === slug) || null;
}

export function rutaBase() {
  const path = location.pathname.replace(/\\/g, "/");
  if (path.includes("/comunidades/")) return "../";
  return "./";
}
