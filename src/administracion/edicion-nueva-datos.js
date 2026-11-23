/**
 * @typedef {'publicada-sin-microdatos'|'pendiente-de-incorporar'|'detenida-por-controles'} EstadoEdicionNuevaDatos
 * @typedef {'enunciado-distinto'|'tablas'|'controles'} MotivoDetencionDatos
 * @typedef {'pregunta'|'periodo'|'opciones'|'codigos'} ParteEnunciadoDatos
 * @typedef {Readonly<{estado:EstadoEdicionNuevaDatos,anio:string,observadoEn:string,huellaCatalogo:string,motivo?:MotivoDetencionDatos,partes?:readonly ParteEnunciadoDatos[]}>} EdicionNuevaDatos
 * @typedef {'edicion-no-verificable'|'observacion-anterior-descartada'|'sin-contraste-con-la-tich'|'sin-contraste-del-motivo'|'edicion-no-coincide'} AvisoEdicionDatos
 */
/**
 * La edición nueva que una fuente por ediciones ha observado en su catálogo (hoy, la TIC-H): un hecho con fecha y
 * huella, no un fallo. Viaja en la fila de la fuente solo cuando la hay; su forma es cerrada. Si se descargó y no pasó
 * sus controles, su estado es «detenida-por-controles» y trae su motivo de la lista cerrada y, si el enunciado cambió,
 * las partes que cambian, en su orden. En su lugar, la fila puede traer un aviso propio (`avisoEdicion`): no se pudo
 * comprobar qué edición anuncia, el año admitido no es el del conjunto validado, o la fuente se validó sin contraste
 * con la TIC-H por ser de otra edición. Juntos solo van la observación y el aviso de que la última consulta descartó
 * una observación anterior mal formada.
 */

/** @type {readonly EstadoEdicionNuevaDatos[]} */
export const ESTADOS_EDICION_NUEVA = ['publicada-sin-microdatos', 'pendiente-de-incorporar', 'detenida-por-controles'];
const CLAVES = ['estado', 'anio', 'observadoEn', 'huellaCatalogo'];
/** @type {readonly MotivoDetencionDatos[]} */
export const MOTIVOS_DETENCION = ['enunciado-distinto', 'tablas', 'controles'];
/** @type {readonly ParteEnunciadoDatos[]} */
export const PARTES_ENUNCIADO = ['pregunta', 'periodo', 'opciones', 'codigos'];
/** El único aviso que acompaña a la edición nueva: la última consulta descartó una observación anterior. */
const DESCARTADA = 'observacion-anterior-descartada';
/** @type {readonly AvisoEdicionDatos[]} */
export const AVISOS_EDICION = [
  'edicion-no-verificable',
  DESCARTADA,
  'sin-contraste-con-la-tich',
  'sin-contraste-del-motivo',
  'edicion-no-coincide',
];
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** @param {boolean} condicion @returns {asserts condicion} */
function exigir(condicion) {
  if (!condicion) {
    throw new Error('Estado de datos del panel no válido');
  }
}

const CLAVES_FUENTE_V2 = ['id', 'politica', 'fecha', 'plazoDias', 'ultimaOperacion'];

/** Los campos de edición que puede traer una fila de fuente, cada uno solo cuando tiene valor. */
const CAMPOS_DE_EDICION = ['edicionNueva', 'avisoEdicion', 'gruposEnSuGranGrupo', 'gruposSinClase'];
/** Los recuentos de grupos de la encuesta: cada uno, un entero positivo que solo viaja con valor. */
const RECUENTOS = ['gruposEnSuGranGrupo', 'gruposSinClase'];

/** Las claves de una fila de fuente v2 o posterior: con los campos de edición solo si los trae.
 * @param {unknown} entrada @returns {readonly string[]} */
export function clavesDeFuenteV2(entrada) {
  const objeto = entrada !== null && typeof entrada === 'object';
  return [...CLAVES_FUENTE_V2, ...CAMPOS_DE_EDICION.filter((clave) => objeto && Object.hasOwn(entrada, clave))];
}

/** Los campos de la fila sin los de edición.
 * @param {Record<string, unknown>} campos @returns {Record<string, unknown>} */
export function sinEdicion(campos) {
  return Object.fromEntries(Object.entries(campos).filter(([clave]) => !CAMPOS_DE_EDICION.includes(clave)));
}

/**
 * La fila con sus campos de edición leídos, si los trae; solo una fuente por ediciones puede traerlos. La edición nueva
 * y el aviso no van juntos salvo el del descarte de una observación anterior; el número de grupos que la encuesta da
 * en su gran grupo porque la EPA no los confirma, y el de los grupos sin clase manual o no manual en la edición, son
 * enteros positivos.
 * @template {{politica: string}} T @param {T} fila @param {Record<string, unknown>} campos Los campos de la fila.
 * @returns {T & {edicionNueva?: EdicionNuevaDatos, avisoEdicion?: AvisoEdicionDatos, gruposEnSuGranGrupo?: number, gruposSinClase?: number}}
 */
export function conEdicionNueva(fila, campos) {
  const tiene = (/** @type {string} */ clave) => Object.hasOwn(campos, clave);
  if (!CAMPOS_DE_EDICION.some(tiene)) {
    return fila;
  }
  exigir(fila.politica === 'edición');
  const elegido = tiene('avisoEdicion') ? AVISOS_EDICION.find((posible) => posible === campos.avisoEdicion) : undefined;
  exigir(!tiene('avisoEdicion') || (elegido !== undefined && tiene('edicionNueva') === (elegido === DESCARTADA)));
  for (const clave of RECUENTOS) {
    const valor = campos[clave];
    exigir(!tiene(clave) || (typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0));
  }
  return {
    ...fila,
    ...(elegido === undefined ? {} : { avisoEdicion: elegido }),
    ...(tiene('edicionNueva') ? { edicionNueva: leerEdicionNueva(campos.edicionNueva) } : {}),
    ...Object.fromEntries(RECUENTOS.filter(tiene).map((clave) => [clave, /** @type {number} */ (campos[clave])])),
  };
}

/** Si la fila trae una edición nueva, que se observara no después de la instantánea.
 * @param {object} fila @param {string} observadoEn @returns {boolean} */
export function observadaAntesDe(fila, observadoEn) {
  const nueva = 'edicionNueva' in fila ? /** @type {EdicionNuevaDatos} */ (fila.edicionNueva) : null;
  return nueva === null || Date.parse(nueva.observadoEn) <= Date.parse(observadoEn);
}

/** El motivo y las partes de una edición detenida: las partes, en su orden, solo con «enunciado-distinto».
 * @param {Record<string, unknown>} valor @returns {{motivo: MotivoDetencionDatos, partes?: readonly ParteEnunciadoDatos[]}} */
function leerDetencion(valor) {
  const motivo = MOTIVOS_DETENCION.find((posible) => posible === valor.motivo);
  exigir(motivo !== undefined);
  if (!Object.hasOwn(valor, 'partes')) {
    exigir(motivo !== 'enunciado-distinto');
    return { motivo };
  }
  const partes = valor.partes;
  exigir(Array.isArray(partes) && partes.length > 0 && motivo === 'enunciado-distinto');
  const enOrden = PARTES_ENUNCIADO.filter((parte) => partes.includes(parte));
  exigir(enOrden.length === partes.length && enOrden.every((parte, i) => parte === partes[i]));
  return { motivo, partes: Object.freeze(enOrden) };
}

/** Lee la edición nueva de una fila de fuente; no corrige ni completa nada.
 * @param {unknown} entrada @returns {EdicionNuevaDatos} */
function leerEdicionNueva(entrada) {
  exigir(entrada !== null && typeof entrada === 'object' && Object.getPrototypeOf(entrada) === Object.prototype);
  const valor = /** @type {Record<string, unknown>} */ (entrada);
  const { estado, anio, observadoEn: observado, huellaCatalogo } = valor;
  const elegido = ESTADOS_EDICION_NUEVA.find((posible) => posible === estado);
  const claves =
    elegido === 'detenida-por-controles'
      ? [...CLAVES, 'motivo', ...(Object.hasOwn(valor, 'partes') ? ['partes'] : [])]
      : CLAVES;
  exigir(Object.keys(entrada).length === claves.length && Object.getOwnPropertySymbols(entrada).length === 0);
  exigir(elegido !== undefined && claves.every((clave) => Object.hasOwn(valor, clave)));
  exigir(typeof anio === 'string' && /^\d{4}$/.test(anio));
  exigir(typeof observado === 'string' && INSTANTE.test(observado) && Number.isFinite(Date.parse(observado)));
  exigir(new Date(observado).toISOString().slice(0, -'.000Z'.length) === observado.slice(0, -1));
  exigir(typeof huellaCatalogo === 'string' && /^[0-9a-f]{64}$/.test(huellaCatalogo));
  const detencion = elegido === 'detenida-por-controles' ? leerDetencion(valor) : {};
  return Object.freeze({ estado: elegido, anio, observadoEn: observado, huellaCatalogo, ...detencion });
}
