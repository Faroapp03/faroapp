// Formato en castellano: números, porcentajes, listas y fechas. En catalán los números se escriben
// igual (coma decimal, punto de miles y espacio de no separación antes de «%»); cambian la «y» de las listas y los
// meses de las fechas.

import { cifra } from './cifras.js';
import { fechaLarga as fechaLargaComun, nombresDeLosMeses, partesDelDia } from './fechas.js';
import type { Idioma } from './idioma.ts';

/** La conjunción antes del último elemento de una lista. */
const CONJUNCION: Readonly<Record<Idioma, string>> = { es: 'y', ca: 'i' };
/** La forma de la «y» castellana ante el sonido /i/ (RAE): «física e informática», «madre e hija». */
const CONJUNCION_ANTE_I = 'e';
/** Empieza por el sonido /i/: «i», «í» o «hi», con o sin mayúscula. */
const EMPIEZA_POR_I = /^h?[ií]/iu;
/** «hi» seguida de vocal forma diptongo y no suena /i/: «agua y hielo», «cobre y hierro». */
const DIPTONGO_CON_HACHE = /^h[ií][aeouáéóú]/iu;
/**
 * El espacio entre una cifra y «%»: de no separación (U+00A0), como pide la RAE, para que «7,9» y «%» nunca queden en
 * líneas distintas.
 */
const ESPACIO_ANTES_DEL_PORCENTAJE = '\u00a0';

/**
 * La conjunción que va delante de `siguiente`: en castellano, «e» ante el sonido /i/ y «y» en los demás casos; en
 * catalán, siempre «i».
 *
 * @param siguiente - Elemento que sigue a la conjunción, tal como se escribe.
 * @param idioma - Idioma de la lista.
 * @returns «y», «e» o «i».
 */
function conjuncion(siguiente: string, idioma: Idioma): string {
  const suenaI = EMPIEZA_POR_I.test(siguiente) && !DIPTONGO_CON_HACHE.test(siguiente);
  return idioma === 'es' && suenaI ? CONJUNCION_ANTE_I : CONJUNCION[idioma];
}

/**
 * Escribe un número con coma decimal y punto de miles, siempre con `decimales` cifras: «1.234,5».
 *
 * @param valor - Número que se escribe; finito.
 * @param decimales - Cifras decimales, entero entre 0 y 20.
 * @returns El número escrito en la forma española.
 */
export function numero(valor: number, decimales = 0): string {
  return cifra(valor, decimales);
}

/**
 * Escribe un porcentaje con un espacio de no separación antes del signo: «12,5 %».
 *
 * @param valor - Porcentaje en puntos (12,5 para el 12,5 %), no en tanto por uno.
 * @param decimales - Cifras decimales, entero entre 0 y 20.
 * @returns La cifra con su signo «%».
 */
export function porcentaje(valor: number, decimales = 1): string {
  return `${numero(valor, decimales)}${ESPACIO_ANTES_DEL_PORCENTAJE}%`;
}

/**
 * Escribe una enumeración con comas y la conjunción antes del último elemento: «a, b y c», «física e informática» (en
 * catalán, «a, b i c»).
 *
 * @param partes - Lista de elementos definidos, sin huecos, en el orden en que se escriben.
 * @param idioma - Idioma de la lista.
 * @returns La enumeración; vacía si no hay elementos.
 */
export function lista(partes: readonly string[], idioma: Idioma = 'es'): string {
  if (partes.length <= 1) {
    return partes.join('');
  }
  // La lista contiene elementos definidos y esta rama tiene al menos dos.
  const ultima = partes[partes.length - 1] as string;
  return `${partes.slice(0, -1).join(', ')} ${conjuncion(ultima, idioma)} ${ultima}`;
}

/**
 * Escribe una lista en minúsculas con la primera letra en mayúscula: «Concertar citas y atender llamadas».
 *
 * @param partes - Lista de elementos definidos, sin huecos, en el orden en que se escriben.
 * @param idioma - Idioma de la lista.
 * @returns La lista como frase.
 */
export function frase(partes: readonly string[], idioma: Idioma = 'es'): string {
  const texto = lista(
    partes.map((parte) => parte.toLowerCase()),
    idioma,
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Escribe una fecha AAAA-MM-DD como DD/MM/AAAA, la forma de las citas: «2026-10-07» → «07/10/2026».
 *
 * @param iso - Fecha en la forma AAAA-MM-DD.
 * @returns La misma fecha en la forma DD/MM/AAAA.
 */
export function fechaConBarras(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/**
 * Escribe una fecha AAAA-MM-DD en palabras: «27 de septiembre de 2026» (en catalán, «27 de setembre del 2026»), con
 * las tablas del módulo de fechas (fechas.js), las mismas de la web.
 *
 * @param iso - Fecha en la forma AAAA-MM-DD de un día que existe.
 * @param idioma - Idioma del texto.
 * @returns La fecha en palabras.
 */
export function fechaLarga(iso: string, idioma: Idioma = 'es'): string {
  return fechaLargaComun(partesDelDia(iso), idioma);
}

/**
 * Traduce un mes escrito en castellano («junio») a `idioma`; si no se reconoce, lo deja tal cual.
 *
 * @param mes - Nombre del mes en castellano, con cualquier mayúscula.
 * @param idioma - Idioma de destino.
 * @returns El mes en `idioma`, o `mes` si no es un mes castellano.
 */
export function mesEnIdioma(mes: string, idioma: Idioma): string {
  const posicion = nombresDeLosMeses('es').indexOf(mes.toLowerCase());
  if (idioma === 'es' || posicion < 0) {
    return mes;
  }
  // indexOf encontró un mes; las dos listas tienen doce elementos en el mismo orden.
  return nombresDeLosMeses(idioma)[posicion] as string;
}
