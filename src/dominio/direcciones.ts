// Hacia dónde ha ido un dato del informe breve que es un recuento, por su variación anual.
//
// Criterio. Solo los recuentos llevan dirección: la contratación (contratos registrados por el Observatori del Treball,
// todos los de Cataluña) y el censo anual (registros administrativos del INE y el Idescat, no una muestra). Su cambio
// no tiene error de muestreo: es un cambio real de lo contado. El umbral del 1 % es un criterio de redacción, no de
// incertidumbre: por debajo, el informe dice que se mantiene en lugar de llamar «subida» a un cambio menor que 1 de
// cada 100. Las encuestas por muestreo (la EPA) no llevan dirección, porque nadie publica el error de la comparación
// que hace Faro.

import type { Direccion } from './tipos-informe-breve.ts';

/** Variación anual (en %) a partir de la cual un dato sube o baja; por debajo, se mantiene. */
const UMBRAL_DIRECCION = 1;

/**
 * Hacia dónde ha ido un dato con su variación anual en %: sube o baja a partir de UMBRAL_DIRECCION; si no, se mantiene.
 *
 * @param variacion - La variación en %, o null si no hay con qué comparar.
 * @returns La dirección.
 */
export function direccionDe(variacion: number | null): Direccion {
  if (variacion === null) {
    return 'sin-dato';
  }
  if (variacion >= UMBRAL_DIRECCION) {
    return 'sube';
  }
  return variacion <= -UMBRAL_DIRECCION ? 'baja' : 'estable';
}
