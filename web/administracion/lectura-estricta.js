// Generado desde src/administracion/lectura-estricta.js; no editar esta copia.
// Lectura estricta de los documentos del panel: solo datos propios, sin getters, prototipos ni claves de más. Cada
// lector del panel (estado-datos.js y retenidos-datos.js) compone sus formas con estas piezas.

/** Cuántas filas admite como mucho una lista del panel. */
export const MAX_REGISTROS = 64;
/** Fin de la parte de segundos y de la de fecha en un instante ISO. */
export const FIN_SEGUNDOS_ISO = 19;
export const FIN_FECHA_ISO = 10;
/** @param {boolean} condicion @returns {asserts condicion} */
export function exigir(condicion) {
  if (!condicion) {
    throw new Error('Estado de datos del panel no válido');
  }
}
/** @param {unknown} entrada @param {readonly string[]} claves @returns {Record<string,unknown>} */
export function objeto(entrada, claves) {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const prototipo = Object.getPrototypeOf(entrada);
  exigir((prototipo === Object.prototype || prototipo === null) && Object.getOwnPropertySymbols(entrada).length === 0);
  exigir(Object.getOwnPropertyNames(entrada).length === claves.length);
  /** @type {Record<string,unknown>} */
  const copia = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigir(descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true);
    copia[clave] = descriptor.value;
  }
  return copia;
}
/** @param {unknown} entrada @param {boolean} [vacia] @returns {unknown[]} */
export function lista(entrada, vacia = false) {
  exigir(Array.isArray(entrada) && Object.getPrototypeOf(entrada) === Array.prototype);
  exigir(
    (vacia || entrada.length > 0) &&
      entrada.length <= MAX_REGISTROS &&
      Object.getOwnPropertySymbols(entrada).length === 0,
  );
  exigir(Object.getOwnPropertyNames(entrada).length === entrada.length + 1);
  /** @type {unknown[]} */
  const copia = [];
  for (let i = 0; i < entrada.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, String(i));
    exigir(descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true);
    copia.push(descriptor.value);
  }
  return copia;
}
/** @param {unknown} entrada @returns {string} */
export function fecha(entrada) {
  exigir(typeof entrada === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entrada));
  const dia = new Date(`${entrada}T00:00:00Z`);
  exigir(
    Number.isFinite(dia.getTime()) && dia.getUTCFullYear() > 0 && dia.toISOString().slice(0, FIN_FECHA_ISO) === entrada,
  );
  return entrada;
}
/** @param {unknown} entrada @returns {string} */
export function instante(entrada) {
  exigir(typeof entrada === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(entrada));
  const valor = new Date(entrada);
  exigir(
    Number.isFinite(valor.getTime()) &&
      valor.getUTCFullYear() > 0 &&
      valor.toISOString().slice(0, FIN_SEGUNDOS_ISO) === entrada.slice(0, FIN_SEGUNDOS_ISO),
  );
  return entrada;
}
/** @template T @param {unknown} entrada @param {(dato:unknown)=>T} leer @returns {T|null} */
export function opcional(entrada, leer) {
  return entrada === null ? null : leer(entrada);
}
/** @param {unknown} entrada @returns {number} */
export function entero(entrada) {
  exigir(typeof entrada === 'number' && Number.isSafeInteger(entrada) && entrada >= 0);
  return entrada;
}
/** @param {unknown} entrada @returns {string} */
export function id(entrada) {
  exigir(typeof entrada === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(entrada));
  return entrada;
}
/** @template {string} T @param {unknown} entrada @param {readonly T[]} valores @returns {T} */
export function unoDe(entrada, valores) {
  const elegido = valores.find((valor) => valor === entrada);
  exigir(elegido !== undefined);
  return elegido;
}
/** UTC con precisión explícita: Date valida el segundo civil y la comparación conserva los seis decimales. */
/** @param {unknown} entrada @returns {string} */
export function instantePreciso(entrada) {
  exigir(typeof entrada === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{6})?Z$/.test(entrada));
  instante(`${entrada.slice(0, FIN_SEGUNDOS_ISO)}Z`);
  return entrada;
}
/** Clave solo para ordenar instantes ya validados; nunca sustituye el valor de entrada. */
/** @param {string} valor @returns {string} */
export function claveInstante(valor) {
  return valor.length === FIN_SEGUNDOS_ISO + 1 ? `${valor.slice(0, FIN_SEGUNDOS_ISO)}.000000Z` : valor;
}
/** @param {unknown} entrada @returns {string} */
export function huella(entrada) {
  exigir(typeof entrada === 'string' && /^[0-9a-f]{64}$/.test(entrada));
  return entrada;
}
