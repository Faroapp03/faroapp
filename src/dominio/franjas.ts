// Franjas de cambio de una nota de exposición, con los umbrales de la OIT, y reparto del tiempo de la semana entre las
// tareas, con los pesos aproximados que da la persona.

import type { Guarda } from '../comun/json.ts';
import type { Tiempo } from './tipos-entrada.ts';
import type { Franja } from './tipos-informe.ts';

/** Umbrales de las franjas: los mismos que usa la OIT para sus gradientes de exposición (0,4 y 0,6). */
export const UMBRALES = { media: 0.4, alta: 0.6 } as const;

/** Peso aproximado del tiempo que la persona dice dedicar a cada tarea. */
export const PESOS: Readonly<Record<Tiempo, number>> = Object.freeze({ mucho: 3, algo: 2, poco: 1 });

/** Orden de las franjas en el informe: primero lo que más cambia. */
const ORDEN_FRANJA: Readonly<Record<Franja, number>> = { alta: 0, media: 1, baja: 2 };
/** Las tareas sin datos van detrás de todas las franjas. */
const ORDEN_SIN_DATOS = 3;

/** El reparto del tiempo va en pasos de 5 puntos porcentuales, porque los pesos del tiempo son aproximados. */
const PASO_PORCENTAJE = 5;
/** El reparto suma 100 puntos porcentuales. */
const PORCENTAJE_TOTAL = 100;
/** Pasos que se reparten entre las tareas: los que caben en 100. */
const PASOS = PORCENTAJE_TOTAL / PASO_PORCENTAJE;

/**
 * Una de las tres franjas del contrato, sin volver a decidir sus umbrales.
 *
 * @param valor - Cualquier valor que llegue de fuera.
 * @returns Si es una franja.
 */
export const esFranja: Guarda<Franja> = (valor: unknown): valor is Franja =>
  typeof valor === 'string' && Object.hasOwn(ORDEN_FRANJA, valor);

/**
 * Posición de una franja al ordenar el informe: primero lo que más cambia; al final, lo que no tiene datos.
 *
 * @param valorFranja - La franja, o null si no tiene datos.
 * @returns La posición al ordenar.
 */
export function ordenFranja(valorFranja: Franja | null): number {
  return valorFranja === null ? ORDEN_SIN_DATOS : ORDEN_FRANJA[valorFranja];
}

/**
 * Franja de cambio de una nota de exposición (0–1).
 *
 * @param valor - La nota de exposición, de 0 a 1.
 * @returns La franja.
 */
export function franja(valor: number): Franja {
  if (valor >= UMBRALES.alta) {
    return 'alta';
  }
  if (valor >= UMBRALES.media) {
    return 'media';
  }
  return 'baja';
}

/**
 * Franjas que intersecta un rango descriptivo cerrado; no representan probabilidades de pertenencia.
 *
 * @param margen - Los extremos del rango, o null.
 * @returns Las franjas que cruza, de menor a mayor cambio (al revés que ORDEN_FRANJA, que pone primero la que más cambia).
 */
export function franjasDelMargen(margen: readonly [number, number] | null): Franja[] {
  if (!margen) {
    return [];
  }
  const [inferior, superior] = margen;
  const posibles: Franja[] = [];
  if (inferior < UMBRALES.media) {
    posibles.push('baja');
  }
  if (superior >= UMBRALES.media && inferior < UMBRALES.alta) {
    posibles.push('media');
  }
  if (superior >= UMBRALES.alta) {
    posibles.push('alta');
  }
  return posibles;
}

/**
 * Reparte 100 en pasos de 5 por el método de los mayores restos, entre las claves que se le pasen y en su orden.
 *
 * @param pesos - Pesos finitos no negativos, con suma finita.
 * @returns El reparto, que suma 100 si hay algún peso positivo; con todos a cero o sin claves, devuelve ceros.
 */
export function reparto5<Clave extends string>(pesos: Readonly<Record<Clave, number>>): Record<Clave, number> {
  // Object.keys y Object.fromEntries no conservan el tipo de las claves; aquí son las de `pesos`, todas de Clave.
  const claves = Object.keys(pesos) as Clave[];
  const total = claves.reduce((suma, clave) => suma + pesos[clave], 0);
  const reparto = Object.fromEntries(claves.map((clave) => [clave, 0])) as Record<Clave, number>;
  if (total === 0) {
    return reparto;
  }
  // Los pesos enteros permiten comparar restos exactos, sin romper empates por errores de coma flotante.
  // Las otras magnitudes conservan el cálculo en escala relativa para no desbordar al multiplicarlas por PASOS.
  const restosEnteros =
    Number.isSafeInteger(total) &&
    claves.every((clave) => Number.isSafeInteger(pesos[clave]) && Number.isSafeInteger(pesos[clave] * PASOS));
  const cuotas = claves.map((clave) => {
    const exacto = restosEnteros ? (pesos[clave] * PASOS) / total : (pesos[clave] / total) * PASOS;
    const pasos = Math.floor(exacto);
    const resto = restosEnteros ? (pesos[clave] * PASOS) % total : exacto - pasos;
    return { clave, pasos, resto };
  });
  let pasosSinRepartir = PASOS - cuotas.reduce((suma, cuota) => suma + cuota.pasos, 0);
  // La ordenación es estable: a igual resto, el paso va a la primera clave recibida.
  const porResto = [...cuotas].sort((a, b) => b.resto - a.resto);
  for (const cuota of porResto) {
    if (pasosSinRepartir <= 0) {
      break;
    }
    cuota.pasos += 1;
    pasosSinRepartir -= 1;
  }
  for (const { clave, pasos } of cuotas) {
    reparto[clave] = pasos * PASO_PORCENTAJE;
  }
  return reparto;
}
