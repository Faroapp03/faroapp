// Generado desde src/comun/marcas-de-tiempo.ts; no editar esta copia.
// Las marcas de tiempo del camino del análisis en el dispositivo, con la API User Timing del navegador
// (https://www.w3.org/TR/user-timing/): cada tramo queda en la línea temporal de su hilo como una medida con un nombre
// estable de MEDIDAS, que leen las herramientas de medición (pruebas/navegadores/README.md, «Desglose del análisis»).
// Una medida no cambia ningún resultado ni ningún orden: solo se anota. No escribe en la consola ni se guarda con los
// datos de la persona, y su detalle nunca lleva lo que ha escrito: solo nombres de archivos, rutas de la pantalla y
// cifras. La línea temporal vive lo que la página o el Worker que la anota.

/**
 * Los nombres de las medidas, por hilo. Son un contrato con las herramientas de medición: no se cambian sin
 * cambiarlas a ellas.
 */
export const MEDIDAS = Object.freeze({
  /** Página: la espera a que el service worker confirme la copia del paquete (motor-local/cliente.js). */
  esperaDeLaCopia: 'faro:pagina:espera-de-la-copia',
  /** Página: de enviar una petición al Worker del motor a recibir su respuesta; detalle `ruta`. */
  idaYVuelta: 'faro:pagina:ida-y-vuelta',
  /** Página: un paso del recorrido entero, con la espera de la copia y los títulos de sus opciones. */
  paso: 'faro:pagina:paso',
  /** Página: el pensamiento de Faro, de empezar a enseñarlo a dejar ver la respuesta; detalle `pasos`. */
  pensamiento: 'faro:pagina:pensamiento',
  /** Worker: la sonda del service worker. */
  sonda: 'faro:worker:sonda',
  /** Worker: el manifiesto firmado y los archivos del motor, cuando la web lleva firmas. */
  firmas: 'faro:worker:firmas',
  /** Worker: importar el motor compilado y leer el secreto de firma del dispositivo. */
  importarMotor: 'faro:worker:importar-motor',
  /** Worker: crear el motor, con la lectura de sus datos. */
  crearMotor: 'faro:worker:crear-motor',
  /** Worker: comparar con el manifiesto firmado una lectura del paquete; detalle `archivo`. */
  comprobarLectura: 'faro:worker:comprobar-lectura',
  /** Worker: el cálculo de una petición, de entrarle al motor a tener su respuesta; detalle `ruta`. */
  calculo: 'faro:worker:calculo',
  /** Worker: leer el cuerpo de la respuesta y mandarlo a la página; detalle `ruta`. */
  entrega: 'faro:worker:entrega',
  /** Motor: el paquete entero, de pedir el manifiesto a tener todas sus partes preparadas. */
  paquete: 'faro:datos:paquete',
  /** Motor: recibir los bytes de un archivo del paquete; detalle `archivo` y `bytes`. */
  lectura: 'faro:datos:lectura',
  /** Motor: la huella SHA-256 de un archivo del paquete; detalle `archivo`. */
  huella: 'faro:datos:huella',
  /** Motor: descodificar y leer el JSON de un archivo del paquete; detalle `archivo`. */
  json: 'faro:datos:json',
  /** Motor: dejar una parte de los datos como queda en memoria; detalle `archivo`. */
  preparacion: 'faro:datos:preparacion',
  /** Motor: crear la API local sobre los datos ya preparados (índices de la búsqueda, entre otros). */
  inicializacion: 'faro:motor:inicializacion',
  /** Motor: preparar un archivo extra ya leído (la tabla de vectores o el clasificador); detalle `archivo`. */
  prepararExtra: 'faro:motor:preparar-extra',
  /** Motor: lo que un paso del recorrido espera a los archivos extra. */
  esperaDeLosExtras: 'faro:motor:espera-de-los-extras',
});

/** El nombre de una medida. @typedef {(typeof MEDIDAS)[keyof typeof MEDIDAS]} Medida */

/**
 * Lo que puede llevar el detalle de una medida: nombres y cifras, nunca lo escrito por la persona.
 * @typedef {Readonly<Record<string, string | number>>} DetalleDeLaMedida
 */

/**
 * El instante de ahora en la línea temporal de este hilo, para empezar un tramo.
 *
 * @returns {number} Milisegundos desde el origen de la línea temporal.
 */
export function inicioDelTramo() {
  return performance.now();
}

/**
 * Anota en la línea temporal un tramo de `inicio` (inicioDelTramo) a ahora.
 *
 * @param {Medida} nombre - El nombre estable de la medida.
 * @param {number} inicio - Cuándo empezó el tramo.
 * @param {DetalleDeLaMedida} [detalle] - Nombres y cifras del tramo.
 * @returns {void}
 */
export function medirTramo(nombre, inicio, detalle) {
  performance.measure(nombre, { start: inicio, end: performance.now(), ...(detalle ? { detail: detalle } : {}) });
}
