/** Registro observado de activación; no acredita qué versión está sirviendo ahora el alojamiento. */
import { esEnteroTrabajo, exigirTrabajo, leerReferenciaTrabajo, objetoTrabajo } from './estado-trabajos.js';

/**
 * @typedef {'reservada'|'preparada'|'subiendo-cursos'|'cursos-subida'|'promoviendo-cursos'|'cursos-confirmado'|'subiendo'|'subida'|'promoviendo'|'confirmada'|'rechazada'|'abandonada'} FaseActivacion
 * @typedef {'a-mano'|'rechazo-previo'|'rechazo-proveedor'} MotivoAbandono
 * @typedef {'subiendo'|'subida'|'promoviendo'} FasePrincipalEnCurso
 * @typedef {'rechazo-previo'|'rechazo-proveedor'} MotivoDetenida
 * @typedef {'cursos-nuevo'|'cambiado'|'desconocido'} ServidoDetenida
 * @typedef {'previsto'|'es-reintento'|'sin-artefacto'|null} ReintentoObservado
 * @typedef {Readonly<{estado:'en-curso'|'no-cumplido'|'sin-constancia'|'web-cambiada',caducaEn:number}>} CierreObservado
 * @typedef {'candidato_no_verificable'|'despliegue_no_admitido'|'servido_distinto'|null} ErrorActivacionObservada
 * @typedef {Readonly<{solicitudId:string,revisionReserva:number,fase:FaseActivacion,dosServicios:boolean,motivoAbandono:MotivoAbandono|null,reintento:ReintentoObservado,datosSinPublicarDesde:number|null,cierre:CierreObservado|null,motivoDetenida:MotivoDetenida|null,servidoDetenida:ServidoDetenida|null,creadoEn:number,actualizadoEn:number,versionId:string|null,deploymentId:string|null,error:ErrorActivacionObservada}>} ActivacionObservada
 * @typedef {Readonly<{version:1,revision:number,ultimaActivacion:ActivacionObservada|null}>} EstadoActivacion
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Las cuatro fases de Cursos solo aparecen en una activación que publica los dos Workers, antes de las del principal.
/** @type {readonly FaseActivacion[]} */
export const FASES_ACTIVACION = Object.freeze([
  'reservada',
  'preparada',
  'subiendo-cursos',
  'cursos-subida',
  'promoviendo-cursos',
  'cursos-confirmado',
  'subiendo',
  'subida',
  'promoviendo',
  'confirmada',
  'rechazada',
  'abandonada',
]);
/** @type {readonly FasePrincipalEnCurso[]} */
const FASES_PRINCIPAL_EN_CURSO = Object.freeze(['subiendo', 'subida', 'promoviendo']);
/**
 * Fases del principal en curso: en una activación de dos servicios, la formación figura como no disponible en ellas.
 * @param {FaseActivacion} fase @returns {fase is FasePrincipalEnCurso}
 */
export function esFasePrincipalEnCurso(fase) {
  return /** @type {readonly string[]} */ (FASES_PRINCIPAL_EN_CURSO).includes(fase);
}
/** @type {readonly MotivoDetenida[]} */
export const MOTIVOS_DETENIDA = Object.freeze(['rechazo-previo', 'rechazo-proveedor']);
/** @type {readonly FaseActivacion[]} */
const FASES_CON_EFECTO = Object.freeze(['subiendo-cursos', 'promoviendo-cursos', 'subiendo', 'promoviendo']);
/** @type {readonly MotivoAbandono[]} */
export const MOTIVOS_ABANDONO = Object.freeze(['a-mano', 'rechazo-previo', 'rechazo-proveedor']);
/** @type {readonly FaseActivacion[]} */
export const FASES_CURSOS = Object.freeze([
  'subiendo-cursos',
  'cursos-subida',
  'promoviendo-cursos',
  'cursos-confirmado',
]);
/** @type {readonly ErrorActivacionObservada[]} */
const ERRORES = Object.freeze([null, 'candidato_no_verificable', 'despliegue_no_admitido', 'servido_distinto']);
/** @param {unknown} entrada @returns {string|null} */
function idVersion(entrada) {
  exigirTrabajo(entrada === null || (typeof entrada === 'string' && UUID.test(entrada)));
  return entrada;
}
/**
 * Desde cuándo hay datos validados sin publicar: desde que su intención se cerró sin publicar, también mientras se
 * reintenta; una confirmada los ha publicado.
 * @param {Record<string, unknown>} o @param {FaseActivacion} fase @returns {number|null}
 */
function leerSinPublicar(o, fase) {
  const desde = o.datosSinPublicarDesde;
  // Un rechazo porque el paquete no se pudo comprobar no deja datos validados.
  const rechazoDelPaquete = fase === 'rechazada' && o.error === 'candidato_no_verificable';
  const sinPublicar =
    fase === 'abandonada' ||
    (fase === 'rechazada' && !rechazoDelPaquete) ||
    (o.reintento === 'es-reintento' && fase !== 'confirmada' && !rechazoDelPaquete);
  exigirTrabajo(sinPublicar ? esEnteroTrabajo(desde) && desde <= Number(o.actualizadoEn) : desde === null);
  return /** @type {number|null} */ (desde);
}
/**
 * Previsto: una abandonada por `rechazo-previo` que la actualización siguiente puede volver a intentar sola. Un
 * reintento no se vuelve a reintentar.
 * @param {unknown} valor @param {FaseActivacion} fase @param {MotivoAbandono|null} motivo @returns {ReintentoObservado}
 */
function leerReintento(valor, fase, motivo) {
  exigirTrabajo(valor === null || valor === 'es-reintento' || valor === 'previsto' || valor === 'sin-artefacto');
  exigirTrabajo(valor === null || valor === 'es-reintento' || (fase === 'abandonada' && motivo === 'rechazo-previo'));
  return valor;
}
/**
 * El cierre pedido desde el panel, solo mientras la intención no ha terminado.
 * @param {unknown} entrada @param {FaseActivacion} fase @returns {CierreObservado|null}
 */
function leerCierreObservado(entrada, fase) {
  if (entrada === null) {
    return null;
  }
  const o = objetoTrabajo(entrada, 'caducaEn,estado');
  exigirTrabajo(!['confirmada', 'rechazada', 'abandonada'].includes(fase) && esEnteroTrabajo(o.caducaEn));
  /** @type {readonly CierreObservado['estado'][]} */
  const estados = ['en-curso', 'no-cumplido', 'sin-constancia', 'web-cambiada'];
  const estado = estados.find((e) => e === o.estado);
  exigirTrabajo(estado !== undefined);
  return Object.freeze({ estado, caducaEn: o.caducaEn });
}
/**
 * Detenida solo en una fase con efecto en curso: el rechazo que la paró sin hacer el efecto, y qué se servía.
 * @param {Record<string, unknown>} o @param {FaseActivacion} fase
 * @returns {{motivoDetenida:MotivoDetenida|null,servidoDetenida:ServidoDetenida|null}}
 */
function leerDetenidaObservada(o, fase) {
  const motivoDetenida = o.motivoDetenida === null ? null : MOTIVOS_DETENIDA.find((m) => m === o.motivoDetenida);
  exigirTrabajo(motivoDetenida !== undefined && (motivoDetenida === null || FASES_CON_EFECTO.includes(fase)));
  const servidoDetenida =
    o.servidoDetenida === null
      ? null
      : ['cursos-nuevo', 'cambiado', 'desconocido'].find((v) => v === o.servidoDetenida);
  exigirTrabajo(servidoDetenida !== undefined && (servidoDetenida === null) === (motivoDetenida === null));
  return { motivoDetenida, servidoDetenida: /** @type {ServidoDetenida|null} */ (servidoDetenida) };
}
/** @param {unknown} entrada @returns {ActivacionObservada} */
function leerActivacion(entrada) {
  const o = objetoTrabajo(
    entrada,
    'actualizadoEn,cierre,creadoEn,datosSinPublicarDesde,deploymentId,dosServicios,error,fase,motivoAbandono,motivoDetenida,reintento,revisionReserva,servidoDetenida,solicitudId,versionId',
  );
  const referencia = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(esEnteroTrabajo(o.creadoEn) && esEnteroTrabajo(o.actualizadoEn) && o.actualizadoEn >= o.creadoEn);
  const fase = FASES_ACTIVACION.find((valor) => valor === o.fase);
  exigirTrabajo(fase !== undefined);
  // Si publica también Cursos: con esa forma, la formación figura como no disponible hasta confirmar.
  exigirTrabajo(typeof o.dosServicios === 'boolean' && (o.dosServicios || !FASES_CURSOS.includes(fase)));
  const versionId = idVersion(o.versionId),
    deploymentId = idVersion(o.deploymentId);
  const error = ERRORES.find((e) => e === o.error);
  exigirTrabajo(error !== undefined);
  exigirTrabajo((versionId !== null) === (fase === 'subida' || fase === 'promoviendo' || fase === 'confirmada'));
  exigirTrabajo((deploymentId !== null) === (fase === 'confirmada'));
  exigirTrabajo((o.error !== null) === (fase === 'rechazada'));
  const motivoAbandono = o.motivoAbandono === null ? null : MOTIVOS_ABANDONO.find((m) => m === o.motivoAbandono);
  exigirTrabajo(motivoAbandono !== undefined && (motivoAbandono !== null) === (fase === 'abandonada'));
  const { motivoDetenida, servidoDetenida } = leerDetenidaObservada(o, fase);
  const datosSinPublicarDesde = leerSinPublicar(o, fase);
  return Object.freeze({
    ...referencia,
    fase,
    dosServicios: o.dosServicios,
    motivoAbandono,
    reintento: leerReintento(o.reintento, fase, motivoAbandono),
    datosSinPublicarDesde,
    cierre: leerCierreObservado(o.cierre, fase),
    motivoDetenida,
    servidoDetenida: /** @type {ServidoDetenida|null} */ (servidoDetenida),
    creadoEn: o.creadoEn,
    actualizadoEn: o.actualizadoEn,
    versionId,
    deploymentId,
    error,
  });
}
/** Copia cerrada e inmutable; las revisiones de trabajo y activación pertenecen a registros distintos. */
/** @param {unknown} entrada @returns {EstadoActivacion} */
export function leerEstadoActivacion(entrada) {
  const o = objetoTrabajo(entrada, 'revision,ultimaActivacion,version');
  exigirTrabajo(o.version === 1 && esEnteroTrabajo(o.revision));
  exigirTrabajo(o.ultimaActivacion === null ? o.revision === 0 : o.revision > 0);
  return Object.freeze({
    version: 1,
    revision: o.revision,
    ultimaActivacion: o.ultimaActivacion === null ? null : leerActivacion(o.ultimaActivacion),
  });
}
