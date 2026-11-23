// Metadatos del contrato HTTP, sin lectura de peticiones ni construcción de respuestas.

export { CABECERA_CONTRATO, CONTRATO_API } from '../comun/protocolo-web.ts';

/** Versión histórica de las peticiones que no declaran contrato; no sigue la versión vigente. */
export const CONTRATO_SIN_CABECERA = 1;
/** Identificador que acompaña una respuesta y su registro técnico. */
export const CABECERA_PETICION = 'x-faro-peticion';
