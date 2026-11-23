// «Pasar a otro dispositivo», en el dispositivo que lo recibe: recorrido.html abierto con #pasar=<código>. El código
// ya ha salido de la barra y del historial al cargar (fragmento.js); aquí se comprueba entero (formato.js) y, con el
// motor y el paquete de datos de este dispositivo, se comprueba que el grupo, la ocupación y cada tarea existen y se
// rehace el informe. Todo va al motor del dispositivo (motor-local/cliente.js), en cualquier modo:
// ninguna petición de red lleva el resultado. Si este dispositivo aún no tiene el paquete de datos, el motor lo pide
// como siempre, y eso no lleva nada del resultado. Rehacerlo no necesita IA: el resultado ya está calculado.
// Un código que no supera la validación de formato, fecha o referencias del paquete se rechaza con una línea de
// Faro, y la conversación sigue como siempre. Nada del resultado se guarda.

import { esObjeto } from '../json.js';
import { MotorQueNoCoincide, pedirAlMotorLocal } from '../motor-local/cliente.js';
import {
  ERROR_MOTOR_QUE_NO_COINCIDE,
  ERRORES_DEL_MOTOR,
  ErrorFaro,
  errorDeCancelacion,
  errorDeLaRespuesta,
  problemaDe,
} from '../recorrido/api/errores.js';
// Las cabeceras y la versión del contrato del recorrido se importan de su transporte, sin repetirlas aquí.
import { API, CABECERAS, senalDeCancelacion } from '../recorrido/api/transporte.js';
import { antesDeQueNoCoincida } from '../recorrido/instalacion-que-no-coincide.js';
import { traducible } from '../textos.js';
import { CodigoNoValido, comprobarFecha, decodificar } from './formato.js';

/** @import { Resultado } from './formato.js' */
/** @import { Entrada, TareaEntrada } from '../../../src/dominio/tipos-entrada.ts' */

/** 400 Bad Request y 404 Not Found: el motor no entiende o no tiene lo que nombra el código. */
const PETICION_INCORRECTA = 400;
const NO_ENCONTRADO = 404;
/** Las cifras del grupo ISCO-08 al principio del código de una tarea oficial (`2511.1` → `2511`). */
const CIFRAS_DEL_GRUPO = 4;

/**
 * Una respuesta JSON del motor del dispositivo, sin leer aún (unknown): quien la usa mira su forma. Un 404 o un 400 es
 * un código que nombra algo que este paquete no tiene; cualquier otro fallo, un fallo del motor. El estado se mira
 * antes de leer el cuerpo: un fallo sin JSON se cuenta por su estado. Si la instalación del service worker no coincide,
 * no espera al motor: falla con su explicación (recorrido/instalacion-que-no-coincide.js); si la copia del motor no es
 * la de esta versión, también con la suya (falloDelMotor).
 * @param {string} ruta @param {unknown} cuerpo @param {AbortSignal} signal @returns {Promise<unknown>}
 */
async function alMotor(ruta, cuerpo, signal) {
  signal.throwIfAborted();
  const opciones = cuerpo === undefined ? {} : { method: 'POST', body: JSON.stringify(cuerpo) };
  const peticion = pedirAlMotorLocal(`${API}${ruta}`, { headers: CABECERAS, ...opciones, signal });
  const respuesta = await antesDeQueNoCoincida(peticion).catch(falloDelMotor);
  signal.throwIfAborted();
  if (respuesta.status === PETICION_INCORRECTA) {
    await falloDelRelojAtrasado(respuesta);
  }
  if (respuesta.status === NO_ENCONTRADO || respuesta.status === PETICION_INCORRECTA) {
    throw new CodigoNoValido(`${ruta}: ${respuesta.status}`);
  }
  if (!respuesta.ok) {
    throw new Error(`${ruta}: ${respuesta.status}`);
  }
  return respuesta.json();
}

/**
 * Un 400 con el problema `reloj_atrasado` (la fecha del dispositivo es anterior a la de los datos, y se contrastó porque
 * se pidió con `reloj=dispositivo`) no es un código que no vale: falla con la explicación del reloj, la misma del
 * recorrido. Cualquier otro 400 sigue su camino.
 * @param {Response} respuesta @returns {Promise<void>}
 */
async function falloDelRelojAtrasado(respuesta) {
  const cuerpo = await respuesta.json().catch(() => null);
  if (esObjeto(cuerpo) && problemaDe(cuerpo) === ERRORES_DEL_MOTOR.RELOJ_ATRASADO) {
    throw errorDeLaRespuesta(respuesta.status, cuerpo);
  }
}

/**
 * El motor del dispositivo no se puede usar porque su copia no es la de esta versión (MotorQueNoCoincide): falla con la
 * explicación del recorrido (ERROR_MOTOR_QUE_NO_COINCIDE), la que ofrece «Reparar Faro», como en el transporte
 * (recorrido/api/transporte.js). Cualquier otro fallo sigue tal cual.
 * @param {unknown} error @returns {never}
 */
function falloDelMotor(error) {
  if (error instanceof MotorQueNoCoincide) {
    throw new ErrorFaro(traducible(ERROR_MOTOR_QUE_NO_COINCIDE), 0, {});
  }
  throw error;
}

/** La ficha de un grupo en el idioma del informe. @param {string} isco08 @param {'es' | 'ca'} idioma @param {AbortSignal} signal */
function fichaDe(isco08, idioma, signal) {
  return alMotor(
    `/grupos/${encodeURIComponent(isco08)}${idioma === 'es' ? '' : `?idioma=${idioma}`}`,
    undefined,
    signal,
  );
}

/** Un objeto leído de una respuesta del motor, o null si no lo es. @param {unknown} valor */
function objeto(valor) {
  return typeof valor === 'object' && valor !== null ? /** @type {Record<string, unknown>} */ (valor) : null;
}

/** Los elementos de una lista leída que son objetos; nada si no es una lista. @param {unknown} valor */
function objetos(valor) {
  return Array.isArray(valor) ? valor.map(objeto).filter((elemento) => elemento !== null) : [];
}

/**
 * El nombre de una tarea oficial en `idioma`, el mismo que le da el recorrido (paso-tareas.js y datos-traducidos.js):
 * el corto o, sin él, el texto entero, en su traducción si la ficha la trae.
 * @param {Record<string, unknown> | undefined} oficial @param {'es' | 'ca'} idioma @returns {unknown}
 */
function nombreOficial(oficial, idioma) {
  if (oficial?.corto) {
    return oficial[`corto_${idioma}`] ?? oficial.corto;
  }
  return oficial?.[`texto_${idioma}`] ?? oficial?.texto_es ?? oficial?.texto_en;
}

/**
 * Comprueba el resultado con el paquete de este dispositivo y devuelve el cuerpo de /api/informe que lo rehace.
 * @param {Resultado} resultado @param {AbortSignal} signal @returns {Promise<Entrada & { idioma: 'es' | 'ca' }>}
 */
async function cuerpoComprobado(resultado, signal) {
  signal.throwIfAborted();
  const grupos = [resultado.isco08, resultado.isco08Secundario].filter((grupo) => typeof grupo === 'string');
  /** @type {Map<string, unknown>} */
  const fichas = new Map();
  for (const grupo of grupos) {
    fichas.set(grupo, await fichaDe(grupo, resultado.idioma, signal));
  }
  return cuerpoDelResultado(resultado, fichas);
}

/**
 * Las tareas del informe, con su texto oficial en el idioma del informe, comprobadas con las fichas de este paquete:
 * cada una es de uno de los dos grupos y existe en su ficha. Si no, el código no vale.
 * @param {Resultado} resultado @param {Map<string, unknown>} fichas @returns {TareaEntrada[]}
 */
export function tareasComprobadas(resultado, fichas) {
  return resultado.tareas.map(({ tareaOit, tiempo }, i) => {
    const oficial = objetos(objeto(fichas.get(tareaOit.slice(0, CIFRAS_DEL_GRUPO)))?.tareas).find(
      (tarea) => tarea.id === tareaOit,
    );
    const texto = nombreOficial(oficial, resultado.idioma);
    if (typeof texto !== 'string' || !texto.trim()) {
      throw new CodigoNoValido(`tarea ${tareaOit}`);
    }
    return { id: `t${i + 1}`, texto: texto.trim(), tiempo, referencia: { tareaOit, relacion: 'propia' } };
  });
}

/**
 * El cuerpo de /api/informe que rehace el resultado, comprobado con las fichas de sus grupos en este paquete: la
 * ocupación ESCO es del grupo principal y cada tarea existe. Si no, el código no vale.
 * @param {Resultado} resultado @param {Map<string, unknown>} fichas @returns {Entrada & { idioma: 'es' | 'ca' }}
 * @throws {CodigoNoValido} Si la ocupación ESCO no es del grupo principal o una tarea no existe en su ficha.
 */
export function cuerpoDelResultado(resultado, fichas) {
  const ocupaciones = objetos(objeto(fichas.get(resultado.isco08))?.ocupaciones);
  if (resultado.ocupacionEsco && !ocupaciones.some((ocupacion) => ocupacion.esco === resultado.ocupacionEsco)) {
    throw new CodigoNoValido('ocupación ESCO');
  }
  return {
    isco08: resultado.isco08,
    ...(resultado.ocupacionEsco ? { ocupacionEsco: resultado.ocupacionEsco } : {}),
    ...(resultado.isco08Secundario ? { isco08Secundario: resultado.isco08Secundario } : {}),
    ...(resultado.grupoPropuestoPorIa ? { grupoPropuestoPorIa: true } : {}),
    ...(resultado.sinIa ? { sinIa: true } : {}),
    fecha: resultado.fecha,
    tareas: tareasComprobadas(resultado, fichas),
    idioma: resultado.idioma,
  };
}

/**
 * El informe del resultado de un código: su HTML, escrito por el motor de este dispositivo, y el resultado leído. Lanza
 * CodigoNoValido si el código no se puede leer o nombra algo que este paquete no tiene; otro error, si el motor falla.
 * Un resultado recibido o guardado trae la fecha del día en que se hizo, que puede ser anterior a los datos con el reloj
 * bien puesto: no se contrasta. Con `relojDelDispositivo` (un informe nuevo, con la fecha de hoy de este dispositivo)
 * el motor la contrasta con sus datos y, si el reloj está atrasado, falla con la explicación del reloj.
 * @param {string} codigo @param {{ signal?: AbortSignal, relojDelDispositivo?: boolean }} [opciones]
 * @returns {Promise<{ html: string, resultado: Resultado }>}
 * @throws {CodigoNoValido} Si el código no se puede leer, está fuera de fecha o nombra algo que el paquete no tiene.
 * @throws {Error} Si el motor del dispositivo falla o no devuelve el HTML del informe.
 */
export async function informeDelCodigo(codigo, { signal = senalDeCancelacion(), relojDelDispositivo = false } = {}) {
  try {
    signal.throwIfAborted();
    const resultado = decodificar(codigo);
    comprobarFecha(resultado);
    const cuerpo = await cuerpoComprobado(resultado, signal);
    const ruta = relojDelDispositivo ? '/informe?formato=breve&reloj=dispositivo' : '/informe?formato=breve';
    const html = objeto(await alMotor(ruta, cuerpo, signal))?.html;
    signal.throwIfAborted();
    if (typeof html !== 'string' || !html) {
      throw new Error('/informe: sin HTML');
    }
    return { html, resultado };
  } catch (error) {
    if (signal.aborted) {
      throw errorDeCancelacion();
    }
    throw error;
  }
}
