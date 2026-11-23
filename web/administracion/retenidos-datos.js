// Generado desde src/administracion/retenidos-datos.js; no editar esta copia.
/**
 * @typedef {'entradas'|'cursos-soc'} MedidaRetenidaDatos
 * @typedef {Readonly<{medida:MedidaRetenidaDatos,antes:number,despues:number}>} PerdidaRetenidaDatos
 * @typedef {Readonly<{archivo:string,grupo:readonly string[],perdidas:readonly PerdidaRetenidaDatos[],desdeUtc:string,ultimaUtc:string,vigenteSha256:string,exportadoSha256:string,aceptadaUtc:string|null}>} CambioRetenidoDatos
 * @typedef {Readonly<{lectura:'leida',cambios:readonly CambioRetenidoDatos[]}>|Readonly<{lectura:'ilegible',cambios:null}>} CuarentenaDatos
 * @typedef {Readonly<{cursosOferta:number,cursosCopia:number,huella:string,consultadoEn:string}>} CensoSocPendienteDatos
 * @typedef {Readonly<{lectura:'leida',pendiente:CensoSocPendienteDatos|null}>|Readonly<{lectura:'ilegible',pendiente:null}>} CensoSocDatos
 * @typedef {Readonly<{cuarentena:CuarentenaDatos,censoSoc:CensoSocDatos}>} RetenidosDatos
 */
// Los cambios retenidos del estado v6: lo que una actualización no publicó porque perdía demasiado frente a lo
// publicado y espera a una persona. Es el mismo contrato cerrado que escribe la plataforma de datos
// (plataforma_datos/orquestacion/cuarentena_panel.py): cifras, códigos, huellas e instantes, sin rutas ni texto libre.

import {
  claveInstante,
  entero,
  exigir,
  huella,
  instantePreciso,
  lista,
  objeto,
  opcional,
  unoDe,
} from './lectura-estricta.js';

/** @type {readonly MedidaRetenidaDatos[]} */
export const MEDIDAS_RETENIDAS = ['entradas', 'cursos-soc'];
/** @type {readonly ('leida'|'ilegible')[]} */
const LECTURAS = ['leida', 'ilegible'];
const ARCHIVO_DEL_PAQUETE = /^[a-z0-9][a-z0-9_-]{0,94}\.json$/;
const CAMPOS_CAMBIO = [
  'archivo',
  'grupo',
  'perdidas',
  'desdeUtc',
  'ultimaUtc',
  'vigenteSha256',
  'exportadoSha256',
  'aceptadaUtc',
];

/** @param {unknown} entrada @returns {string} */
function archivo(entrada) {
  exigir(typeof entrada === 'string' && ARCHIVO_DEL_PAQUETE.test(entrada));
  return entrada;
}
/** Ordenada y sin repetidos, como la escribe la plataforma: otro orden no es el de su registro.
 * @param {readonly string[]} valores */
function exigirOrdenEstricto(valores) {
  exigir(valores.every((valor, i) => i === 0 || /** @type {string} */ (valores[i - 1]) < valor));
}
/** @param {unknown} entrada @returns {PerdidaRetenidaDatos} */
function perdida(entrada) {
  const valor = objeto(entrada, ['medida', 'antes', 'despues']);
  return Object.freeze({
    medida: unoDe(valor.medida, MEDIDAS_RETENIDAS),
    antes: entero(valor.antes),
    despues: entero(valor.despues),
  });
}
/** Un archivo del paquete retenido: el grupo que se conserva con él, lo que perdería, desde cuándo y sus huellas.
 * @param {unknown} entrada @returns {CambioRetenidoDatos} */
function cambio(entrada) {
  const valor = objeto(entrada, CAMPOS_CAMBIO);
  const nombre = archivo(valor.archivo);
  const grupo = lista(valor.grupo).map(archivo);
  exigirOrdenEstricto(grupo);
  exigir(grupo.includes(nombre));
  const perdidas = lista(valor.perdidas).map(perdida);
  exigir(
    perdidas.length <= MEDIDAS_RETENIDAS.length && new Set(perdidas.map((p) => p.medida)).size === perdidas.length,
  );
  const desde = instantePreciso(valor.desdeUtc);
  const ultima = instantePreciso(valor.ultimaUtc);
  const aceptada = opcional(valor.aceptadaUtc, instantePreciso);
  exigir(claveInstante(desde) <= claveInstante(ultima));
  // Solo se acepta lo que ya estaba retenido: la aceptación no puede ser anterior a la retención.
  exigir(aceptada === null || claveInstante(desde) <= claveInstante(aceptada));
  return Object.freeze({
    archivo: nombre,
    grupo: Object.freeze(grupo),
    perdidas: Object.freeze(perdidas),
    desdeUtc: desde,
    ultimaUtc: ultima,
    vigenteSha256: huella(valor.vigenteSha256),
    exportadoSha256: huella(valor.exportadoSha256),
    aceptadaUtc: aceptada,
  });
}
/** Una parte que no se pudo leer llega sin datos: nunca se confunde con «nada retenido».
 * @param {unknown} entrada @returns {CuarentenaDatos} */
function cuarentena(entrada) {
  const valor = objeto(entrada, ['lectura', 'cambios']);
  if (unoDe(valor.lectura, LECTURAS) === 'ilegible') {
    exigir(valor.cambios === null);
    return Object.freeze({ lectura: 'ilegible', cambios: null });
  }
  const cambios = lista(valor.cambios, true).map(cambio);
  exigirOrdenEstricto(cambios.map((fila) => fila.archivo));
  return Object.freeze({ lectura: 'leida', cambios: Object.freeze(cambios) });
}
/** @param {unknown} entrada @returns {CensoSocPendienteDatos} */
function censoPendiente(entrada) {
  const valor = objeto(entrada, ['cursosOferta', 'cursosCopia', 'huella', 'consultadoEn']);
  const fila = Object.freeze({
    cursosOferta: entero(valor.cursosOferta),
    cursosCopia: entero(valor.cursosCopia),
    huella: huella(valor.huella),
    consultadoEn: instantePreciso(valor.consultadoEn),
  });
  // Solo queda pendiente una oferta que pierde cursos frente a la copia: con tantos o más se habría admitido.
  exigir(fila.cursosOferta < fila.cursosCopia);
  return fila;
}
/** @param {unknown} entrada @returns {CensoSocDatos} */
function censoSoc(entrada) {
  const valor = objeto(entrada, ['lectura', 'pendiente']);
  if (unoDe(valor.lectura, LECTURAS) === 'ilegible') {
    exigir(valor.pendiente === null);
    return Object.freeze({ lectura: 'ilegible', pendiente: null });
  }
  return Object.freeze({ lectura: 'leida', pendiente: opcional(valor.pendiente, censoPendiente) });
}

/** Devuelve una copia inmutable del bloque; un campo de más o de menos, o un valor fuera del contrato, lo rechaza.
 * @param {unknown} entrada @returns {RetenidosDatos} */
export function leerRetenidos(entrada) {
  const valor = objeto(entrada, ['cuarentena', 'censoSoc']);
  return Object.freeze({ cuarentena: cuarentena(valor.cuarentena), censoSoc: censoSoc(valor.censoSoc) });
}
