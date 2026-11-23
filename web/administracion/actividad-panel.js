// Gestos que cuentan como actividad del Panel de Control: pulsar, escribir y desplazarse con la rueda o con el dedo.
// Quien los recibe decide si cuentan (página visible, gesto real) y con qué frecuencia renuevan la sesión.

/** Solo gestos de una persona: `scroll` no cuenta, porque también lo provocan los repintados y el anclaje del
 * navegador, y alargaría la sesión sin nadie delante. */
export const EVENTOS_ACTIVIDAD = Object.freeze(['pointerdown', 'keydown', 'wheel', 'touchstart', 'touchmove']);

/** Escucha pasiva: nunca retrasa el desplazamiento. @param {EventTarget} objetivo @param {(evento: Event) => void} alActividad */
export function escucharActividad(objetivo, alActividad) {
  for (const tipo of EVENTOS_ACTIVIDAD) {
    objetivo.addEventListener(tipo, alActividad, { passive: true });
  }
}
