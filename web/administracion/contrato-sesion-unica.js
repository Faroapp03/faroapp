// Lectores cerrados de la bienvenida y del registro de la sesión única, con el mismo contrato que el servidor
// (src/administracion/sesion-unica.ts): cualquier campo de más, de menos o fuera de forma invalida la respuesta.
import { objetoAdministrativo, respuestaAdministrativaInvalida } from './contrato-comun.js';

/** @typedef {import('../../src/administracion/sesion-unica.ts').BienvenidaPanel} BienvenidaPanel */
/** @typedef {import('../../src/administracion/sesion-unica.ts').OcupacionPanel} OcupacionPanel */
/** @typedef {import('../../src/administracion/sesion-unica.ts').FilaRegistroPanel} FilaRegistroPanel */

const ID_ENTRADA = /^E-[0-9A-HJKMNP-TV-Z]{8}$/;
const ID_SESION = /^S-[0-9A-HJKMNP-TV-Z]{8}$/;
const CORREO = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+$/u;
const CORREO_MAX = 254;
const MAX_FILAS = 100;
const TIPOS = new Set([
  'entrada',
  'sesion-abierta',
  'sesion-cerrada',
  'sesion-caducada',
  'sesion-retomada',
  'apertura-rechazada',
]);

/** @param {boolean} condicion */
function exigir(condicion) {
  if (!condicion) {
    respuestaAdministrativaInvalida();
  }
}
/** @param {unknown} valor @returns {valor is number} */
const instante = (valor) => typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
/** @param {unknown} valor @returns {valor is string} */
const correo = (valor) => typeof valor === 'string' && valor.length <= CORREO_MAX && CORREO.test(valor);
/** @param {unknown} valor @param {RegExp} forma */
const nuloO = (valor, forma) => valor === null || (typeof valor === 'string' && forma.test(valor));

/** @param {unknown} entrada @returns {OcupacionPanel} */
function leerOcupacion(entrada) {
  const o = objetoAdministrativo(entrada, [
    'correo',
    'desde',
    'cierrePorInactividadEn',
    'limiteEn',
    'idSesion',
    'idEntrada',
    'propia',
  ]);
  exigir(typeof o.propia === 'boolean' && (o.correo === null || correo(o.correo)));
  exigir(instante(o.desde) && instante(o.cierrePorInactividadEn) && instante(o.limiteEn));
  // Solo la sesión propia lleva sus identificadores: los de otra persona nunca llegan al navegador.
  exigir(nuloO(o.idSesion, ID_SESION) && nuloO(o.idEntrada, ID_ENTRADA));
  exigir(o.propia === true || (o.idSesion === null && o.idEntrada === null));
  return /** @type {OcupacionPanel} */ (/** @type {unknown} */ (Object.freeze(o)));
}
/** Un 409 de apertura con el panel ocupado: trae quién lo tiene, con la misma forma que la bienvenida.
 * @param {unknown} entrada @returns {boolean} */
export function esPanelOcupado(entrada) {
  if (entrada === null || typeof entrada !== 'object' || !('ocupacion' in entrada)) {
    return false;
  }
  const rechazo = objetoAdministrativo(entrada, ['error', 'ocupacion']);
  exigir(rechazo.error === 'panel_ocupado');
  leerOcupacion(rechazo.ocupacion);
  return true;
}
/** @param {unknown} entrada @returns {BienvenidaPanel} */
export function leerBienvenida(entrada) {
  const b = objetoAdministrativo(entrada, ['correo', 'idEntrada', 'entradaEn', 'ocupacion']);
  exigir(correo(b.correo) && typeof b.idEntrada === 'string' && ID_ENTRADA.test(b.idEntrada) && instante(b.entradaEn));
  return Object.freeze({
    correo: /** @type {string} */ (b.correo),
    idEntrada: /** @type {string} */ (b.idEntrada),
    entradaEn: /** @type {number} */ (b.entradaEn),
    ocupacion: b.ocupacion === null ? null : leerOcupacion(b.ocupacion),
  });
}
/** @param {unknown} entrada @returns {FilaRegistroPanel} */
function leerFila(entrada) {
  const f = objetoAdministrativo(entrada, ['instante', 'tipo', 'correo', 'idEntrada', 'idSesion', 'motivo', 'titular']);
  exigir(instante(f.instante) && TIPOS.has(String(f.tipo)) && correo(f.correo));
  exigir(nuloO(f.idEntrada, ID_ENTRADA) && nuloO(f.idSesion, ID_SESION));
  exigir(f.motivo === null || f.motivo === 'inactividad' || f.motivo === 'duracion');
  exigir(f.titular === null || correo(f.titular));
  return /** @type {FilaRegistroPanel} */ (/** @type {unknown} */ (Object.freeze(f)));
}
/** @param {unknown} entrada @returns {readonly FilaRegistroPanel[]} */
export function leerRegistro(entrada) {
  const { registro } = objetoAdministrativo(entrada, ['registro']);
  exigir(Array.isArray(registro) && registro.length <= MAX_FILAS);
  return Object.freeze(/** @type {unknown[]} */ (registro).map(leerFila));
}
