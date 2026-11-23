// El presupuesto de JavaScript de cada escenario de descargas-js.mjs, en sus dos cifras: direcciones distintas y
// peticiones totales, contadas en el servidor con el criterio del servidor (presupuesto-criterios.mjs). Un escenario
// está dentro si ninguna de las dos cifras supera su valor; uno sin presupuesto es un error de la prueba.

/** El máximo medido en Chromium, Firefox y WebKit, por nombre de escenario. */
export const PRESUPUESTO_DESCARGAS = Object.freeze({
  portada: Object.freeze({ direcciones: 0, peticiones: 0 }),
  acceso: Object.freeze({ direcciones: 0, peticiones: 0 }),
  inicio: Object.freeze({ direcciones: 70, peticiones: 82 }),
  'recorrido real': Object.freeze({ direcciones: 70, peticiones: 99 }),
  informe: Object.freeze({ direcciones: 70, peticiones: 82 }),
});

/**
 * El presupuesto de un escenario.
 *
 * @param {string} escenario - El nombre del escenario en descargas-js.mjs.
 * @returns {{ direcciones: number, peticiones: number }} Sus dos cifras máximas.
 * @throws {Error} Si el escenario no tiene presupuesto.
 */
export function presupuestoDe(escenario) {
  if (!Object.hasOwn(PRESUPUESTO_DESCARGAS, escenario)) {
    throw new Error(`El escenario «${escenario}» no tiene presupuesto de descargas (presupuesto-descargas.mjs)`);
  }
  return PRESUPUESTO_DESCARGAS[escenario];
}

/**
 * Compara las dos cifras medidas de un escenario con su presupuesto: está dentro si ninguna lo supera.
 *
 * @param {string} escenario - El nombre del escenario en descargas-js.mjs.
 * @param {{ direcciones: number, peticiones: number }} medida - Las dos cifras medidas.
 * @returns {{ dentro: boolean, motivo: string }} Si está dentro y, en texto, las cifras frente al presupuesto.
 * @throws {Error} Si el escenario no tiene presupuesto.
 */
export function comprobarPresupuesto(escenario, { direcciones, peticiones }) {
  const presupuesto = presupuestoDe(escenario);
  const dentro = direcciones <= presupuesto.direcciones && peticiones <= presupuesto.peticiones;
  const motivo =
    `${direcciones} direcciones y ${peticiones} peticiones (presupuesto: hasta ${presupuesto.direcciones} ` +
    `direcciones y ${presupuesto.peticiones} peticiones)`;
  return { dentro, motivo };
}
