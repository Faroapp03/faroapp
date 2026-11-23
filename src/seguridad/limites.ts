// Límites de lo que Faro acepta y procesa. Los compartidos con el cliente web se importan de protocolo-web.ts.

/** Caracteres del relato que se leen; el resto se descarta con aviso. */
export { MAX_RELATO } from '../comun/protocolo-web.ts';
/** Tareas que se recogen de un relato como máximo. */
export const MAX_TAREAS = 12;
/** Caracteres de una tarea que admite el informe. */
export { MAX_TAREA } from '../comun/protocolo-web.ts';
/** Caracteres mínimos de una tarea: con menos no describe nada que se pueda enlazar, estimar o poner en un informe. */
export const MIN_TAREA = 3;
/**
 * Bytes del cuerpo de una petición a la API. El más grande que se envía de verdad es el del informe: hasta 30 tareas
 * (MAX_TAREAS_INFORME, comun/protocolo-web.ts), cada una con su texto (MAX_TAREA) y, si Faro la estimó, sus dos frases de la
 * IA (MAX_FRASE, 220 caracteres, comun/limites-frases.ts) y su firma. Con letras de hasta tres bytes (€, …, comillas
 * tipográficas) y los campos, son unos 75 KB: en 20 KB no cabría un informe de unas veinte tareas estimadas. Lo
 * justifica el límite compartido del esquema de entrada.
 */
export const MAX_CUERPO_BYTES = 80_000;
/** Caracteres de la búsqueda de ocupaciones. */
export const MAX_BUSQUEDA = 120;
