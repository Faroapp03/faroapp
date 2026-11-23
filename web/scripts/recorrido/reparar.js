// «Reparar Faro»: cuando la copia de la aplicación guardada en este dispositivo no es la de esta versión (el service
// worker ha rechazado un archivo del motor que tenía guardado, o le falta: recorrido.error.motor-no-coincide), se
// vuelve a descargar sin tocar lo que Faro guarda de la persona. La página pide al service worker activo que rehaga su
// copia (src/service-worker/reparar.js, «Reparar la copia»: si falla la descarga, la copia no cambia; si falla al
// copiar, lo copiado es de esta versión y lo comprobado que siga estropeado se vuelve a detectar; la copia del paquete
// de datos no se toca) y, mientras tanto, Faro dice que se está reparando. Con éxito, lo dice y recarga la página, que
// vuelve a empezar la conversación; el navegador no pregunta antes de salir, porque la persona ya sabe que la
// conversación vuelve a empezar (data-actualizando, como al actualizar Faro). Cada petición lleva su número y solo
// cuenta la respuesta con ese número: la de un intento anterior que llega tarde no se toma por la del actual. La página
// sigue la reparación como la copia del paquete (paquete-sin-conexion.js, seguirAlServiceWorker): desde su primer aviso
// de progreso le repite la petición, con el mismo número, para que el navegador no lo detenga a mitad (Firefox lo para
// tras un minuto sin eventos), y solo deja de esperar tras un rato sin avisos, no tras un plazo fijo: por una red
// lenta, la reparación dura lo que tarde en bajar. Si el navegador lo había detenido, la petición lo vuelve a poner en
// marcha y la reparación sigue con lo que ya había bajado (src/service-worker/reparar.js). Si falla (la red se ha
// cortado, o lo que llega del servidor tampoco es de esta versión), Faro lo cuenta y ofrece volver a intentarlo, sin
// recargar ni dar de baja nada. Sin service worker que controle la página no hay copia que reparar: se recarga, y la
// página vuelve a quedar controlada. Se conservan siempre localStorage, sessionStorage e IndexedDB. «Borrar todo», en
// «Tus datos», queda como último recurso.

import { seguirAlServiceWorker } from '../paquete-sin-conexion.js';
import { traducible } from '../textos.js';
import {
  ErrorFaro,
  esInstalacionQueNoCoincide,
  esMotorQueNoCoincide,
  esServiceWorkerNoDisponible,
  esSinServiceWorker,
} from './api/errores.js';
import { actualizarEspera, mostrarEspera, ofrecerSugerencias, quitarEspera } from './conversacion.js';
import { avisarDelFallo, enfocar } from './pagina.js';

/** @import { Sugerencia } from './conversacion.js' */

/** El botón de la reparación, el de volver a intentarla y lo que dice Faro mientras tanto y al terminar. */
const REPARAR = traducible('recorrido.reparar');
const REINTENTAR = traducible('recorrido.reintentar');
const RECARGAR = traducible('recorrido.sin-textos.recargar');
const REPARANDO = traducible('recorrido.reparando');
const REPARADO = traducible('recorrido.reparado');
/** Lo que dice Faro si la reparación no sale: por la red o sin respuesta, o porque lo que llega no es de la versión. */
export const ERROR_REPARAR_SIN_COMPLETAR = 'recorrido.error.reparar-sin-completar';
export const ERROR_REPARAR_NO_COINCIDE = 'recorrido.error.reparar-no-coincide';
/**
 * El mensaje con que se pide la reparación al service worker, sus avisos de progreso y su respuesta
 * (src/service-worker/reparar.js, mismos valores).
 */
const REPARAR_COPIA = 'REPARAR_COPIA';
const PROGRESO_DE_LA_REPARACION = 'PROGRESO_DE_LA_REPARACION';
const COPIA_REPARADA = 'COPIA_REPARADA';
/** El número de la última petición de reparación de esta página (pedirLaReparacion). */
let ultimaPeticion = 0;

/**
 * @typedef {{ ok: boolean, motivo?: string }} Resultado
 * @typedef {{ controller: { postMessage: (mensaje: unknown) => void } | null,
 *   addEventListener: (tipo: 'message', oyente: (evento: MessageEvent) => void) => void,
 *   removeEventListener: (tipo: 'message', oyente: (evento: MessageEvent) => void) => void }} Contenedor
 * @typedef {{ reparando: () => void, reparado: () => void, fallo: (error: ErrorFaro, reintentar: () => void) => void }}
 *   Conversacion
 * @typedef {{ contenedor?: Contenedor, recargar?: () => void, conversacion?: Conversacion,
 *   raiz?: { dataset: DOMStringMap } }} Entorno
 */

/** Lo que dice Faro en la conversación del recorrido mientras repara, al terminar y si falla. @type {Conversacion} */
const EN_LA_CONVERSACION = {
  reparando: () => mostrarEspera(REPARANDO),
  reparado: () => actualizarEspera(REPARADO),
  fallo: (error, reintentar) => {
    quitarEspera();
    avisarDelFallo(error);
    enfocar(ofrecerSugerencias([{ texto: REINTENTAR, accion: reintentar }]));
  },
};

/**
 * Si `datos` es un mensaje del service worker de tipo `tipo` sobre la petición `id`.
 * @param {unknown} datos @param {string} tipo @param {number} id
 * @returns {datos is { type: string, id: number, ok?: unknown, motivo?: unknown }}
 */
function esDeLaPeticion(datos, tipo, id) {
  return typeof datos === 'object' && datos !== null && 'type' in datos && datos.type === tipo && 'id' in datos
    ? datos.id === id
    : false;
}

/**
 * Pide la reparación al service worker que controla la página y la sigue (seguirAlServiceWorker) hasta la respuesta a
 * esta petición. Si deja de avisar, es una reparación sin completar.
 * @param {Contenedor} contenedor @param {{ postMessage: (mensaje: unknown) => void }} controlador
 * @returns {Promise<Resultado>}
 */
async function pedirLaReparacion(contenedor, controlador) {
  ultimaPeticion += 1;
  const id = ultimaPeticion;
  try {
    const datos = await seguirAlServiceWorker(contenedor, () => controlador.postMessage({ type: REPARAR_COPIA, id }), {
      esAviso: (aviso) => esDeLaPeticion(aviso, PROGRESO_DE_LA_REPARACION, id),
      esFinal: (respuesta) => esDeLaPeticion(respuesta, COPIA_REPARADA, id),
    });
    const { ok, motivo } = /** @type {{ ok?: unknown, motivo?: unknown }} */ (datos);
    return { ok: ok === true, ...(typeof motivo === 'string' ? { motivo } : {}) };
  } catch {
    return { ok: false, motivo: 'sin-respuesta' };
  }
}

/**
 * Repara la copia de la aplicación (ver la cabecera): Faro dice que se está reparando; con éxito, que ya está, y
 * recarga; si falla, lo cuenta y ofrece volver a intentarlo.
 * @param {Entorno} [entorno] Lo que usa del navegador y de la conversación; las pruebas lo sustituyen.
 * @returns {Promise<void>}
 */
export async function repararLaCopia({
  contenedor = globalThis.navigator?.serviceWorker,
  recargar = () => location.reload(),
  conversacion = EN_LA_CONVERSACION,
  raiz = document.documentElement,
} = {}) {
  const controlador = contenedor?.controller;
  if (!contenedor || !controlador) {
    recargar();
    return;
  }
  conversacion.reparando();
  const { ok, motivo } = await pedirLaReparacion(contenedor, controlador);
  if (ok) {
    conversacion.reparado();
    // Sin la marca, si la persona cancelara la pregunta del navegador, se quedaría con «Faro ya está reparado.» en
    // espera y sin nada que hacer (recorrido.js, avisarAlSalir).
    raiz.dataset.actualizando = '';
    recargar();
    return;
  }
  const clave = motivo === 'no-coincide' ? ERROR_REPARAR_NO_COINCIDE : ERROR_REPARAR_SIN_COMPLETAR;
  conversacion.fallo(new ErrorFaro(traducible(clave), 0, {}), () => {
    void repararLaCopia({ contenedor, recargar, conversacion, raiz });
  });
}

/**
 * Lo que se ofrece tras el fallo `error`: `salidas`, salvo si el motor del dispositivo no es el de esta versión.
 * Entonces nada que lo use funciona (tampoco la clasificación oficial): con la copia guardada que no coincide, se
 * ofrece repararla (al terminar, la página se recarga sin preguntar: el aviso ya dice que la conversación vuelve a
 * empezar); en una primera visita, nada: no hay nada guardado que reparar, y la explicación dice que se vuelva a
 * intentar más tarde. `entorno` es lo que usa la reparación (repararLaCopia): con `recargar`, cómo vuelve a abrirse la
 * página al terminar.
 * @param {unknown} error @param {Sugerencia[]} salidas @param {Entorno} [entorno] @returns {Sugerencia[]}
 */
export function salidasTrasElFallo(error, salidas, entorno = {}) {
  if (esSinServiceWorker(error)) {
    return [{ texto: RECARGAR, accion: entorno.recargar ?? (() => location.reload()) }];
  }
  if (esInstalacionQueNoCoincide(error) || esServiceWorkerNoDisponible(error)) {
    return [];
  }
  return esMotorQueNoCoincide(error) ? [{ texto: REPARAR, accion: () => void repararLaCopia(entorno) }] : salidas;
}
