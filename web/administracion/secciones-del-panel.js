// Qué secciones se encienden y apagan en cada apartado del Panel de Control. El catálogo público (secciones-contrato.js)
// no lo sabe: lo comparten la web, el service worker y la copia sin conexión, y solo dice qué secciones hay.
import { SECCIONES_WEB } from '../scripts/secciones-contrato.js';

/**
 * Las secciones del apartado «Secciones»: las que tienen páginas, salvo la Encuesta, cuyo interruptor está en su propio
 * apartado (vista-encuesta-visibilidad.js). «Cómo funciona» y «Guías» no tienen páginas ni interruptor.
 */
export const SECCIONES_DEL_APARTADO = Object.freeze(
  SECCIONES_WEB.filter(({ id, rutas }) => rutas.length > 0 && id !== 'encuesta'),
);
