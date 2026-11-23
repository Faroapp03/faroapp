// Los fallos de las peticiones al motor del dispositivo, en un solo sitio: qué ve la persona y qué decide quien llamó.
//
// Cada fallo llega como ErrorFaro, con un mensaje claro del diccionario. La persona nunca ve un error técnico. El motor
// responde como la API de Faro, con un código y un cuerpo Problem Details (RFC 9457: src/api/errores.ts), y su
// respuesta de error se clasifica una sola vez, en RESPUESTAS_DE_ERROR, que recoge solo las que el motor del
// dispositivo puede dar: de ahí salen su explicación, su motivo y lo que los pasos necesitan saber (la posibilidad de
// reintentar, la parada de la moderación…), así que ningún paso vuelve a mirar códigos. Quien cuenta un fallo dentro de una frase suya («No he podido…: …») usa
// su motivo (`motivoDelFallo`), que dice también si tiene sentido volver a intentarlo.

import { RAIZ_DE_LOS_PROBLEMAS } from '../../protocolo-web.js';
import { esTraducible, resolver, traducible } from '../../textos.js';

/** @import { Parte } from '../../textos.js' */
/** @import { Aviso, CuerpoDeLaApi } from '../traduccion-api.js' */

/**
 * El `codigo` de un ErrorFaro cuando la persona anuló la petición (volvió atrás o borró todo). No es un error que haya
 * que enseñarle: quien llama lo pregunta con `esCancelacion`.
 */
const CANCELADA = 'cancelada';
/**
 * Lo que ve la persona de un fallo sin explicación propia: que algo ha fallado, sin tecnicismos. Es un traducible
 * listo para un ErrorFaro; las demás explicaciones de este bloque son claves del diccionario (se envuelven con
 * `traducible`).
 */
export const ERROR_GENERICO = traducible('recorrido.error.generico');
/** El filtro de datos personales no se ha podido preparar en el dispositivo (minimizar.js). */
export const ERROR_SIN_LIMPIEZA = 'recorrido.error.sin-limpieza';
// Las claves del diccionario de los fallos sin respuesta (código 0). Quien crea el fallo (api/transporte.js) las toma
// de aquí, y MOTIVO_SIN_RESPUESTA reconoce las que tienen motivo propio.
/** Pasó el plazo de la petición; es también la clave del 504 del motor. */
export const ERROR_DE_PLAZO = 'recorrido.error.tarda';
/** Falló el motor del dispositivo (motor-local/cliente.js). */
export const ERROR_DEL_MOTOR_LOCAL = 'recorrido.error.motor-local';
/**
 * El motor del dispositivo no se puede usar porque alguno de sus archivos no es el de esta versión
 * (motor-local/cliente.js, MotorQueNoCoincide): volver a pedirlo daría lo mismo. Lo cuentan las dos vías que le piden
 * algo, el transporte (api/transporte.js) y las peticiones del paso de ocupación (motor.js).
 */
export const ERROR_MOTOR_QUE_NO_COINCIDE = 'recorrido.error.motor-no-coincide';
/**
 * La instalación del service worker ha fallado porque uno de los archivos del motor no es el de esta versión, sin
 * ningún service worker activo (recorrido/instalacion-que-no-coincide.js): la primera visita. Tampoco se arregla
 * reintentando ahora, pero no hay nada guardado que borrar: su explicación propia no ofrece «Tus datos».
 */
export const ERROR_INSTALACION_QUE_NO_COINCIDE = 'recorrido.error.instalacion-no-coincide';
/**
 * El motor del dispositivo no ha arrancado con la copia ya lista (motor-local/cliente.js, MotorBloqueado): no ha
 * respondido a tiempo, o el almacenamiento no ha contestado o ha fallado, también al abrir la base. Lo cuentan las
 * peticiones del paso de ocupación (motor.js).
 */
export const ERROR_DE_ARRANQUE = 'recorrido.error.bloqueo';
/** No hay ningún service worker que pueda preparar el paquete en esta página. */
export const ERROR_SIN_SERVICE_WORKER = 'recorrido.error.sin-service-worker';
/** El navegador no ofrece la API necesaria para preparar el paquete. */
export const ERROR_SERVICE_WORKER_NO_DISPONIBLE = 'recorrido.error.service-worker-no-disponible';
/**
 * Los datos del motor del dispositivo no se han terminado de preparar a tiempo (recorrido/espera-del-motor.js): el
 * service worker ha dejado de avisar, se han acabado los intentos o ha pasado uno de los dos límites de la petición, el
 * de las esperas de la copia (LIMITE_DE_LA_COPIA_MS) o el del resto (LIMITE_TOTAL_MS).
 */
export const ERROR_SIN_DATOS = 'recorrido.error.sin-datos';

/**
 * Los problemas del motor (el final de su `type`: src/api/errores.ts, PROBLEMAS) que la web distingue. Lo
 * contrasta con el contrato actual en pruebas/web-recorrido-transporte/.
 */
export const ERRORES_DEL_MOTOR = Object.freeze({
  /** 502: el procesamiento del dispositivo no ha podido producir un resultado válido. */
  SALIDA_INVALIDA: 'salida_invalida',
  /** 400: la fecha del dispositivo es anterior a la de los datos de Faro. */
  RELOJ_ATRASADO: 'reloj_atrasado',
});
/**
 * La explicación de que el reloj del dispositivo está atrasado. La comparten el informe, el paso de formación del
 * recorrido y la página de Cursos: quien la recibe la dice entera, sin añadir otro aviso.
 */
export const ERROR_RELOJ_ATRASADO = 'recorrido.error.reloj-atrasado';

/**
 * Por qué no ha salido una petición, dicho como el final de una frase de Faro («No he podido estimar la nota de «…»:
 * {motivo}»), con la clave de su frase (recorrido.motivo.*) y lo que dice de volver a pedirla:
 * - `reintentable`: pedirla otra vez ahora puede salir bien. No lo es ante una tarea sin estimación acreditada, un texto
 *   que no se admite ni sin la limpieza de datos personales (el navegador puede guardar el fallo de su módulo hasta
 *   recargar la página, y lo dice la frase), y entonces no se ofrece;
 * - `delTexto`: lo ha causado el texto (la moderación no lo admite): con el mismo texto saldría lo mismo;
 * - `sinAporteInferido`: el fallo permite acreditar que esta tarea no incorpora una inferencia de Faro
 *   (traduccion-api.js, hechoSinAporteInferido); no describe la disponibilidad de la IA local.
 * @typedef {Object} DatosDelMotivo
 * @property {string} clave
 * @property {boolean} reintentable
 * @property {boolean} delTexto
 * @property {boolean} sinAporteInferido
 */
export const MOTIVOS_DE_FALLO = Object.freeze(
  /** @satisfies {Record<string, DatosDelMotivo>} */ ({
    salida: {
      clave: 'recorrido.motivo.salida',
      reintentable: true,
      delTexto: false,
      sinAporteInferido: false,
    },
    contenido: {
      clave: 'recorrido.motivo.contenido',
      reintentable: false,
      delTexto: true,
      sinAporteInferido: false,
    },
    sinReferencias: {
      clave: 'recorrido.motivo.sin-referencias',
      reintentable: false,
      delTexto: false,
      sinAporteInferido: false,
    },
    sinEstimacionAcreditada: {
      clave: 'recorrido.motivo.sin-estimacion-acreditada',
      reintentable: false,
      delTexto: false,
      sinAporteInferido: true,
    },
    tarda: {
      clave: 'recorrido.motivo.tarda',
      reintentable: true,
      delTexto: false,
      sinAporteInferido: false,
    },
    sinLimpieza: {
      clave: 'recorrido.motivo.sin-limpieza',
      reintentable: false,
      delTexto: false,
      sinAporteInferido: false,
    },
    sinServiceWorker: {
      clave: 'recorrido.motivo.otro',
      reintentable: false,
      delTexto: false,
      sinAporteInferido: false,
    },
    // El motor del dispositivo no es el de esta versión: no se reintenta, y nada que lo use funciona, tampoco la
    // clasificación oficial (esMotorQueNoCoincide). Su explicación propia es ERROR_MOTOR_QUE_NO_COINCIDE; la frase,
    // la general.
    motorQueNoCoincide: {
      clave: 'recorrido.motivo.otro',
      reintentable: false,
      delTexto: false,
      sinAporteInferido: false,
    },
    otro: {
      clave: 'recorrido.motivo.otro',
      reintentable: true,
      delTexto: false,
      sinAporteInferido: false,
    },
  }),
);

/** @typedef {keyof typeof MOTIVOS_DE_FALLO} MotivoDeFallo */

/**
 * Lo que significa una respuesta de error: la clave de lo que ve la persona y su motivo.
 * @typedef {Object} SignificadoDelError
 * @property {string} clave
 * @property {MotivoDeFallo} motivo
 */
/**
 * Una respuesta de error que la web distingue: su código y su problema (el final de su `type`), si hace falta para
 * distinguirla.
 * @typedef {SignificadoDelError & { codigo: number, problema?: string }} RespuestaDeError
 */

/**
 * Lo que significa cada respuesta de error que puede dar el motor del dispositivo (src/plataforma/navegador/api-local.ts
 * y src/api/errores.ts), la misma en todas las rutas: una fecha del dispositivo atrasada y unas tareas que no se
 * pueden leer (400), una página de otra versión que el motor (409), un texto que la moderación no admite (422), un
 * resultado que el procesamiento no ha podido dar (502) y el plazo del motor (504). Se lee de arriba abajo: la
 * primera fila de su código cuyo problema coincide (o que no lo pide). Un código que no está aquí, como el fallo
 * interno (500), es un fallo genérico.
 * @type {readonly RespuestaDeError[]}
 */
const RESPUESTAS_DE_ERROR = Object.freeze([
  { codigo: 400, problema: ERRORES_DEL_MOTOR.RELOJ_ATRASADO, clave: ERROR_RELOJ_ATRASADO, motivo: 'otro' },
  { codigo: 400, clave: 'recorrido.error.formato', motivo: 'otro' },
  { codigo: 409, clave: 'recorrido.error.actualizar', motivo: 'otro' },
  { codigo: 422, clave: 'recorrido.error.contenido', motivo: 'contenido' },
  {
    codigo: 502,
    problema: ERRORES_DEL_MOTOR.SALIDA_INVALIDA,
    clave: 'recorrido.error.sin-resultado',
    motivo: 'salida',
  },
  { codigo: 504, clave: ERROR_DE_PLAZO, motivo: 'tarda' },
]);

/**
 * Un aviso de la API con su forma: un tipo y un texto. Se comprueba aquí, y no con traduccion-api.js (leerAvisos), que
 * importa este módulo.
 * @param {unknown} valor @returns {valor is Aviso}
 */
function esAviso(valor) {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'tipo' in valor &&
    typeof valor.tipo === 'string' &&
    'texto' in valor &&
    typeof valor.texto === 'string'
  );
}

/** @type {SignificadoDelError} */
const ERROR_SIN_CLASIFICAR = { clave: 'recorrido.error.generico', motivo: 'otro' };

/**
 * Lo que significa una respuesta con `codigo` y cuerpo `datos`: su fila de RESPUESTAS_DE_ERROR, si la tiene.
 * @param {number} codigo @param {CuerpoDeLaApi} datos @returns {SignificadoDelError}
 */
function respuestaDeError(codigo, datos) {
  const problema = problemaDe(datos);
  const fila = RESPUESTAS_DE_ERROR.find(
    (candidata) => candidata.codigo === codigo && (!candidata.problema || candidata.problema === problema),
  );
  return fila ?? ERROR_SIN_CLASIFICAR;
}

/**
 * Lo que significa un fallo que llegó con una respuesta del motor, o null.
 * @param {unknown} error @returns {SignificadoDelError | null}
 */
function respuestaDelFallo(error) {
  if (!(error instanceof ErrorFaro) || typeof error.codigo !== 'number' || error.codigo === 0) {
    return null;
  }
  return respuestaDeError(error.codigo, error.datos);
}

/**
 * El problema de una respuesta de error: el final de su `type` si es uno del motor; si no (una respuesta sin `type` o
 * con uno ajeno), cadena vacía, que solo encaja con las filas que no piden problema.
 * @param {CuerpoDeLaApi} datos @returns {string}
 */
export function problemaDe(datos) {
  const tipo = datos.type;
  return typeof tipo === 'string' && tipo.startsWith(RAIZ_DE_LOS_PROBLEMAS)
    ? tipo.slice(RAIZ_DE_LOS_PROBLEMAS.length)
    : '';
}

/**
 * Un fallo de una petición al motor, con lo que ve la persona y lo que necesita quien llamó para decidir qué hacer:
 * - `explicacion`: un traducible del diccionario; `message` es esa explicación en el idioma en que se produjo;
 * - `codigo`: el código de la respuesta del motor; 0 si no llegó ninguna (pasado el plazo, sin limpiar el texto o con
 *   el motor del dispositivo sin responder), o CANCELADA si la persona anuló la petición (`esCancelacion`);
 * - `datos`: el cuerpo de la respuesta de error, con lo que añade cada ruta (sus avisos, las candidatas por palabras…).
 */
export class ErrorFaro extends Error {
  /** @param {Parte} explicacion @param {number | typeof CANCELADA} codigo @param {CuerpoDeLaApi} [datos] */
  constructor(explicacion, codigo, datos = {}) {
    super(resolver(explicacion));
    /** @readonly @type {Parte} */
    this.explicacion = explicacion;
    /** @readonly @type {number | typeof CANCELADA} */
    this.codigo = codigo;
    /** @readonly @type {CuerpoDeLaApi} */
    this.datos = datos;
  }
}

/**
 * Conserva el código y los datos del fallo local con una explicación traducida.
 * @param {number} codigo @param {CuerpoDeLaApi} datos @returns {ErrorFaro}
 */
export function errorDeLaRespuesta(codigo, datos) {
  const { clave } = respuestaDeError(codigo, datos);
  return new ErrorFaro(traducible(clave), codigo, datos);
}

/**
 * Si el fallo es que la persona anuló la petición: no se le cuenta, y lo que la esperaba se deja sin más.
 * @param {unknown} error @returns {error is ErrorFaro}
 */
export function esCancelacion(error) {
  return error instanceof ErrorFaro && error.codigo === CANCELADA;
}

/**
 * El fallo con que se anula una petición cuando la persona vuelve atrás o lo borra todo (esCancelacion lo reconoce).
 * @returns {ErrorFaro}
 */
export function errorDeCancelacion() {
  return new ErrorFaro(traducible('recorrido.error.cancelada'), CANCELADA);
}

/**
 * Sin ninguna respuesta (código 0), el motivo lo dice la explicación con que se creó el fallo (errorSinRespuesta de
 * transporte.js) si tiene uno propio: pasó el plazo, no se pudo limpiar el texto, el motor no es el de esta versión o
 * no hay service worker. Las demás (el motor del dispositivo que no responde, el arranque que no termina, los datos
 * que no se han acabado de preparar y el fallo general) son «otro», que se puede reintentar: ninguna pasa por la red.
 * @type {ReadonlyMap<string, MotivoDeFallo>}
 */
const MOTIVO_SIN_RESPUESTA = new Map([
  [ERROR_DE_PLAZO, 'tarda'],
  [ERROR_SIN_LIMPIEZA, 'sinLimpieza'],
  [ERROR_MOTOR_QUE_NO_COINCIDE, 'motorQueNoCoincide'],
  [ERROR_INSTALACION_QUE_NO_COINCIDE, 'motorQueNoCoincide'],
  [ERROR_SIN_SERVICE_WORKER, 'sinServiceWorker'],
  [ERROR_SERVICE_WORKER_NO_DISPONIBLE, 'sinServiceWorker'],
]);

/**
 * El motivo de un fallo. Un fallo que no es de Faro (un error de programa) o una cancelación es «otro».
 * @param {unknown} error @returns {MotivoDeFallo}
 */
export function motivoDelFallo(error) {
  if (!(error instanceof ErrorFaro) || error.codigo === CANCELADA) {
    return 'otro';
  }
  const { explicacion } = error;
  if (error.codigo === 0) {
    return MOTIVO_SIN_RESPUESTA.get(esTraducible(explicacion) ? explicacion.clave : '') ?? 'otro';
  }
  return respuestaDeError(error.codigo, error.datos).motivo;
}

/**
 * Si volver a pedir lo que ha fallado puede salir bien ahora: si no, no se ofrece «Volver a intentarlo».
 * @param {unknown} error @returns {boolean}
 */
export function sePuedeReintentar(error) {
  return MOTIVOS_DE_FALLO[motivoDelFallo(error)].reintentable;
}

/**
 * Si el fallo es que el motor del dispositivo no es el de esta versión: no hay que ofrecer nada que lo use (volver a
 * intentarlo ni la clasificación oficial), solo lo que dice su explicación.
 * @param {unknown} error @returns {boolean}
 */
export function esMotorQueNoCoincide(error) {
  return motivoDelFallo(error) === 'motorQueNoCoincide';
}

/** Si ha fallado el registro, la página se puede volver a cargar. @param {unknown} error */
export function esSinServiceWorker(error) {
  return (
    error instanceof ErrorFaro &&
    esTraducible(error.explicacion) &&
    error.explicacion.clave === ERROR_SIN_SERVICE_WORKER
  );
}

/** Si el navegador no ofrece la API, no hay copia que preparar. @param {unknown} error @returns {boolean} */
export function esServiceWorkerNoDisponible(error) {
  return (
    error instanceof ErrorFaro &&
    esTraducible(error.explicacion) &&
    error.explicacion.clave === ERROR_SERVICE_WORKER_NO_DISPONIBLE
  );
}

/**
 * Si el fallo es la instalación que no coincide de una primera visita, sin nada guardado que borrar.
 * @param {unknown} error @returns {boolean}
 */
export function esInstalacionQueNoCoincide(error) {
  return (
    error instanceof ErrorFaro &&
    esTraducible(error.explicacion) &&
    error.explicacion.clave === ERROR_INSTALACION_QUE_NO_COINCIDE
  );
}

/**
 * La moderación no ha admitido lo que se ha enviado (422).
 * @param {unknown} error @returns {boolean}
 */
export function esParadaDeModeracion(error) {
  return respuestaDelFallo(error)?.motivo === 'contenido';
}

/**
 * Los avisos con que la moderación no ha admitido un texto, o una lista vacía si el fallo es otro.
 * @param {unknown} error @returns {Aviso[]}
 */
export function avisosDeModeracion(error) {
  if (!(error instanceof ErrorFaro) || !esParadaDeModeracion(error)) {
    return [];
  }
  const { avisos } = error.datos;
  return Array.isArray(avisos) ? avisos.filter(esAviso) : [];
}
