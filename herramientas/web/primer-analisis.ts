// La lista ARCHIVOS_DEL_PRIMER_ANALISIS del service worker (src/service-worker/primer-analisis.js), los archivos del
// paquete que la copia guarda antes que el resto, tiene que ser la de su única fuente
// (src/plataforma/archivos-del-paquete.ts). El service worker no la importa de allí porque esa fuente arrastra la
// preparación de los datos del motor; npm run web:comprobar exige que las dos digan lo mismo, en el mismo orden.

import { isDeepStrictEqual } from 'node:util';
import { ARCHIVOS_DEL_PRIMER_ANALISIS } from '../../src/plataforma/archivos-del-paquete.ts';
import { ARCHIVOS_DEL_PRIMER_ANALISIS as DEL_SERVICE_WORKER } from '../../src/service-worker/primer-analisis.js';

/**
 * Si la lista del service worker es la de su fuente.
 *
 * @param delServiceWorker - La lista del service worker; por defecto, la de src/service-worker/primer-analisis.js.
 * @returns Un problema si no lo es; vacío si sí.
 */
export function comprobarPrimerAnalisis(delServiceWorker: readonly string[] = DEL_SERVICE_WORKER): string[] {
  return isDeepStrictEqual([...delServiceWorker], [...ARCHIVOS_DEL_PRIMER_ANALISIS])
    ? []
    : [
        `src/service-worker/primer-analisis.js: ARCHIVOS_DEL_PRIMER_ANALISIS no es la de src/plataforma/archivos-del-paquete.ts (${JSON.stringify(ARCHIVOS_DEL_PRIMER_ANALISIS)})`,
      ];
}
