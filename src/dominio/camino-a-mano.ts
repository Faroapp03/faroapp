// FARO_CAMINO_A_MANO controla la selección manual de ocupación en la API factual.
// Encendido permite elegir candidatas por palabras y atender la marca sinIa del informe.
// Apagado, clasificar responde indisponibilidad y el informe no atiende esa marca.

/** Por defecto, el camino a mano está encendido. */
export const CAMINO_A_MANO_POR_DEFECTO = true;

/**
 * El camino a mano en una frase, para el registro de arranque.
 *
 * @param encendido - Si el camino a mano está encendido.
 * @returns La frase para el registro de arranque.
 */
export function descripcionDelCaminoAMano(encendido: boolean): string {
  return encendido ? 'selección manual disponible' : 'selección manual deshabilitada';
}
