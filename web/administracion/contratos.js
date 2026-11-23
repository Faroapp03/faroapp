/** Contratos cerrados del panel servido como módulos web, sin depender de TypeScript en el navegador. */

import { leerDocumentoSecciones } from '../scripts/secciones-contrato.js';
import { respuestaAdministrativaInvalida as invalido, objetoAdministrativo as objeto } from './contrato-comun.js';
import { leerEstadoActivacion } from './estado-activacion.js';
import { leerEstadoDatosPanel } from './estado-datos.js';
import { leerEstadoTrabajos } from './estado-trabajos.js';

/** @typedef {import('../../src/administracion/controles.ts').PoliticaControles} PoliticaControles */
/** @typedef {import('../../src/administracion/controles.ts').DocumentoControles} DocumentoControles */
/** @typedef {import('../../src/administracion/sesion.ts').SesionPanelActiva} SesionPanelActiva */
const INACTIVIDAD_MS = 900_000;
const ABSOLUTA_MS = 28_800_000;
const CLAVES_POLITICA = ['version', 'api', 'mcp', 'a2a'];

/** @param {unknown} entrada @returns {entrada is number} */
function instante(entrada) {
  return typeof entrada === 'number' && Number.isSafeInteger(entrada) && entrada >= 0;
}
/** @param {Record<string, unknown>} copia @returns {PoliticaControles} */
function politicaDe(copia) {
  if (
    copia.version !== 2 ||
    typeof copia.mcp !== 'boolean' ||
    typeof copia.a2a !== 'boolean' ||
    (copia.api !== 'deshabilitada' && copia.api !== 'habilitada')
  ) {
    return invalido();
  }
  return { version: 2, api: copia.api, mcp: copia.mcp, a2a: copia.a2a };
}
/** @param {unknown} entrada @returns {PoliticaControles} */
export function leerPoliticaControles(entrada) {
  return politicaDe(objeto(entrada, CLAVES_POLITICA));
}
/** @param {unknown} entrada @returns {DocumentoControles} */
export function leerDocumentoControles(entrada) {
  const copia = objeto(entrada, [...CLAVES_POLITICA, 'revision']);
  if (!instante(copia.revision)) {
    return invalido();
  }
  return { ...politicaDe(copia), revision: copia.revision };
}
/** @param {unknown} entrada @returns {SesionPanelActiva} */
export function leerSesionActiva(entrada) {
  const copia = objeto(entrada, [
    'estado',
    'iniciadaEn',
    'ultimaActividadEn',
    'caducaPorInactividadEn',
    'caducaAbsolutaEn',
  ]);
  if (
    copia.estado !== 'activa' ||
    !instante(copia.iniciadaEn) ||
    !instante(copia.ultimaActividadEn) ||
    !instante(copia.caducaPorInactividadEn) ||
    !instante(copia.caducaAbsolutaEn) ||
    copia.ultimaActividadEn < copia.iniciadaEn ||
    copia.ultimaActividadEn >= copia.caducaAbsolutaEn ||
    copia.caducaPorInactividadEn !== copia.ultimaActividadEn + INACTIVIDAD_MS ||
    copia.caducaAbsolutaEn !== copia.iniciadaEn + ABSOLUTA_MS
  ) {
    return invalido();
  }
  return {
    estado: 'activa',
    iniciadaEn: copia.iniciadaEn,
    ultimaActividadEn: copia.ultimaActividadEn,
    caducaPorInactividadEn: copia.caducaPorInactividadEn,
    caducaAbsolutaEn: copia.caducaAbsolutaEn,
  };
}
/** @param {unknown} entrada @returns {{token: string, sesion: SesionPanelActiva}} */
export function leerApertura(entrada) {
  const copia = objeto(entrada, ['token', 'sesion']);
  // 32 bytes en base64url canónico: los dos bits inferiores de la última cifra son cero.
  if (typeof copia.token !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(copia.token)) {
    return invalido();
  }
  return { token: copia.token, sesion: leerSesionActiva(copia.sesion) };
}
/** @param {unknown} entrada @returns {SesionPanelActiva} */
export function leerActividad(entrada) {
  return leerSesionActiva(objeto(entrada, ['sesion']).sesion);
}
/** @param {unknown} entrada @returns {{estado:'activa', sesion:SesionPanelActiva, controles:DocumentoControles}} */
export function leerLectura(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'controles']);
  if (copia.estado !== 'activa') {
    return invalido();
  }
  return {
    estado: 'activa',
    sesion: leerSesionActiva(copia.sesion),
    controles: leerDocumentoControles(copia.controles),
  };
}
/** @param {unknown} entrada */
export function leerLecturaDatos(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'datos', 'deLaActualizacionAnterior']);
  if (copia.estado !== 'activa' || typeof copia.deLaActualizacionAnterior !== 'boolean') {
    return invalido();
  }
  return {
    sesion: leerSesionActiva(copia.sesion),
    datos: leerEstadoDatosPanel(copia.datos),
    deLaActualizacionAnterior: copia.deLaActualizacionAnterior,
  };
}
/** @param {unknown} entrada @returns {{estado:'cambiado'|'conflicto', sesion:SesionPanelActiva, controles:DocumentoControles}} */
export function leerCambio(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'controles']);
  if (copia.estado !== 'cambiado' && copia.estado !== 'conflicto') {
    return invalido();
  }
  return {
    estado: copia.estado,
    sesion: leerSesionActiva(copia.sesion),
    controles: leerDocumentoControles(copia.controles),
  };
}
/** @param {unknown} entrada */
export function leerLecturaSecciones(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'secciones']);
  if (copia.estado !== 'activa') {
    return invalido();
  }
  return {
    estado: copia.estado,
    sesion: leerSesionActiva(copia.sesion),
    secciones: leerDocumentoSecciones(copia.secciones),
  };
}
/** @param {unknown} entrada */
export function leerCambioSecciones(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'secciones']);
  if (copia.estado !== 'cambiado' && copia.estado !== 'conflicto') {
    return invalido();
  }
  return {
    estado: copia.estado,
    sesion: leerSesionActiva(copia.sesion),
    secciones: leerDocumentoSecciones(copia.secciones),
  };
}
/** @param {unknown} entrada */
export function leerCierre(entrada) {
  if (objeto(entrada, ['estado']).estado !== 'cerrada') {
    return invalido();
  }
}
/** @param {unknown} entrada @returns {string} */
export function leerError(entrada) {
  const copia = objeto(entrada, ['error']);
  if (typeof copia.error !== 'string') {
    return invalido();
  }
  return copia.error;
}

/** @param {unknown} entrada */
export function leerLecturaTrabajo(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'trabajos']);
  if (copia.estado !== 'activa') {
    return invalido();
  }
  return { sesion: leerSesionActiva(copia.sesion), trabajos: leerEstadoTrabajos(copia.trabajos) };
}
/** @param {unknown} entrada */
export function leerActualizacion(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'trabajos', 'decision']);
  if (
    copia.decision !== 'nueva' &&
    copia.decision !== 'repetida' &&
    copia.decision !== 'ocupado' &&
    copia.decision !== 'conflicto'
  ) {
    return invalido();
  }
  return {
    ...leerLecturaTrabajo({ estado: copia.estado, sesion: copia.sesion, trabajos: copia.trabajos }),
    decision: copia.decision,
  };
}

/** @param {unknown} entrada */
export function leerRetirada(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'trabajos']);
  if (copia.estado !== 'retirado' && copia.estado !== 'conflicto') {
    return invalido();
  }
  const trabajos = leerEstadoTrabajos(copia.trabajos);
  if (copia.estado === 'retirado' && trabajos.ultimoTrabajo?.resultado?.resultado !== 'retirado') {
    return invalido();
  }
  return { sesion: leerSesionActiva(copia.sesion), trabajos, decision: copia.estado };
}
/** @param {unknown} entrada */
export function leerReconciliacion(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'trabajos', 'decision']);
  const decisiones = /** @type {const} */ (['completada', 'en-curso', 'sin-ejecucion', 'terminado', 'conflicto']);
  const decision = decisiones.find((valor) => valor === copia.decision);
  if (!decision) {
    return invalido();
  }
  return {
    ...leerLecturaTrabajo({ estado: copia.estado, sesion: copia.sesion, trabajos: copia.trabajos }),
    decision,
  };
}
/** @param {unknown} entrada */
export function leerLecturaActivacion(entrada) {
  const copia = objeto(entrada, ['estado', 'sesion', 'activacion']);
  if (copia.estado !== 'activa') {
    return invalido();
  }
  return { sesion: leerSesionActiva(copia.sesion), activacion: leerEstadoActivacion(copia.activacion) };
}
