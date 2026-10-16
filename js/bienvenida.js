/**
 * bienvenida.js — Compatibilidad: la primera visita usa el onboarding (js/entrada.js).
 */
export { mostrarOnboardingSiCorresponde as mostrarBienvenidaSiCorresponde } from "./entrada.js";

/** Tras login de visitante ya no se abre el diálogo viejo. */
export function preguntarPertenenciaTrasEntrar() {
  /* no-op */
}
