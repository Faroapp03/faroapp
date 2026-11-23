// El estado del recorrido y sus tareas. Todo vive en la memoria de esta página: no se guarda nada, ni en el
// navegador ni en el servidor. Cómo se llega a la ocupación lo lleva aparte la máquina de flujo-ocupacion.js; aquí
// queda lo que se decide: la ocupación, las fichas de sus grupos y las tareas.

import { MOTIVOS_DE_FALLO } from './api/errores.js';
import { comparable } from './formato.js';

/** @import { Idioma } from '../textos.js' */
/** @import { MotivoDeFallo } from './api/errores.js' */
/** @import { Eleccion } from './flujo-ocupacion.js' */
/** @import { FichaDeGrupo, TareaOficial } from './traduccion-api.js' */
/** @import { PreferenciasSeleccion, SeleccionFormacion } from '../../../src/seleccion-formacion/contrato.ts' */
/** @import { PlanElegido } from './plan-formacion/contrato.js' */
/**
 * La selección acreditada confirmada en este dispositivo, con preferencias y objetivo propios.
 * @typedef {{ seleccion: SeleccionFormacion, plan: PlanElegido, preferencias: PreferenciasSeleccion, objetivo: string,
 *   idioma: Idioma, fecha: string }} HojaConfirmada
 */
/** @import { TareaEntrada, Tiempo } from '../../../src/dominio/tipos-entrada.ts' */

/** Una tarea necesita al menos estas letras (contarLetras, formato.js) para buscar su tarea oficial o ir al informe. */
export const MIN_LETRAS_TAREA = 3;

/**
 * La ocupación elegida: la elección de la persona (el grupo, la ocupación ESCO o null, el grupo secundario o null y su
 * origen), con `palabra`, cómo nombra ella su trabajo, y `titulo`, el título oficial que ve, en castellano.
 * @typedef {Eleccion & { palabra: string, titulo: string }} Ocupacion
 */
/**
 * Una estimación firmada para una tarea sin tarea oficial; se conserva en la entrada del informe.
 * @typedef {NonNullable<TareaEntrada['estimacion']>} Estimacion
 */
/**
 * Una tarea del recorrido (nuevaTarea explica cada campo).
 * @typedef {Object} Tarea
 * @property {number} id
 * @property {boolean} marcada
 * @property {string} texto
 * @property {Tiempo | null} tiempo
 * @property {string | null} oficial
 * @property {string | null} propuesta
 * @property {string | null} emparejadaPara
 * @property {Estimacion | null} estimacion
 * @property {string | null} estimadaPara
 * @property {{ para: string, motivo: MotivoDeFallo } | null} [sinEstimacion]
 */
/**
 * Una tarea oficial de un grupo elegido, con el título de su grupo (oficialesDe).
 * @typedef {TareaOficial & { grupo: string }} TareaOficialDelGrupo
 */
/**
 * El recorrido en curso.
 * @typedef {Object} EstadoDelRecorrido
 * @property {Ocupacion | null} ocupacion la elegida, o null mientras no se ha elegido
 * @property {{ principal: FichaDeGrupo | null, secundario: FichaDeGrupo | null }} grupos las fichas de sus grupos
 *   (/api/grupos/:isco): la del principal y, si lo hay, la del secundario
 * @property {Tarea[]} tareas las de la persona, marcadas en la lista oficial de su grupo o contadas con sus palabras
 * @property {number} siguienteId el identificador de la próxima tarea (nuevaTarea lo consume)
 * @property {string | null} textoSinLeer lo que la persona escribió en «¿Haces algo más?» y no se llegó a leer porque
 *   volvió atrás mientras Faro lo leía: vuelve a la barra cuando vuelve a las tareas (paso-tareas.js)
 * @property {HojaConfirmada | null} hojaDeRuta la hoja de ruta de formación que la persona ha confirmado en el chat
 *   (hoja-de-ruta.js), con lo que respondió y los cursos que quitó; null mientras no ha confirmado ninguna
 */

/** Un recorrido vacío, al abrir la página o al volver a empezar. @returns {EstadoDelRecorrido} */
function nuevoEstado() {
  return {
    ocupacion: null,
    grupos: { principal: null, secundario: null },
    tareas: [],
    siguienteId: 1,
    textoSinLeer: null,
    hojaDeRuta: null,
  };
}

/**
 * El recorrido en curso. Se cambia en su sitio, para que todos los módulos que lo importan vean el mismo.
 *
 * Dueño y ciclo de vida: este módulo lo crea al cargar la página, lo vacía al volver a empezar (reiniciarEstado, que
 * llama recorrido.js al borrar) y muere con la página. Fuera de aquí solo escriben, cada uno en lo suyo:
 * - grupos-elegidos.js: `ocupacion` y `grupos` al elegir, y las tareas que dejan de valer con otros grupos;
 * - paso-tareas.js: las tareas que se marcan, se añaden o se quitan, y `textoSinLeer`;
 * - fila-tarea.js: el texto, el tiempo y la tarea oficial que elige la persona en cada fila;
 * - paso-informe.js: la retirada de las tareas que la moderación no admite;
 * - hoja-de-ruta.js: la hoja de ruta confirmada (`hojaDeRuta`).
 * Este módulo puede anular emparejamientos y olvidar o marcar fallos de estimaciones; grupos-elegidos.js también
 * olvida las estimaciones al cambiar de grupos.
 * @type {EstadoDelRecorrido}
 */
export const estado = nuevoEstado();

/**
 * Vuelve a empezar: sin relato, sin ocupación y sin tareas.
 * @returns {void}
 */
export function reiniciarEstado() {
  Object.assign(estado, nuevoEstado());
}

/**
 * Si salir de la página (recargar, cerrarla o irse) perdería algo. No se guarda nada, ni en el navegador ni en el
 * servidor, así que se pierde lo que la persona ha contado y elegido y lo que ha escrito sin enviar. No depende del
 * paso en que está: «No, es otra cosa» vuelve al primero con las tareas y su tiempo, y el relato libre se cuenta en él.
 * `haHablado` dice si la persona ya ha dicho algo en la conversación; `escrito`, lo que hay en la barra.
 * @param {{ haHablado: boolean, escrito: string }} pagina @returns {boolean}
 */
export function hayAlgoQuePerder({ haHablado, escrito }) {
  return haHablado || escrito.trim() !== '' || estado.ocupacion !== null || estado.tareas.length > 0;
}

/**
 * Una tarea: { id, texto, tiempo, oficial (id de la tarea OIT elegida o null), propuesta (la que propuso Faro),
 * emparejadaPara (el texto para el que se hizo el emparejamiento), estimacion, estimadaPara, marcada,
 * sinEstimacion ({ para, motivo } cuando una tarea se queda sin nota) }. `marcada` dice que la persona la marcó en la
 * lista oficial de su grupo; las demás las contó con sus palabras. Consume un identificador del estado (`siguienteId`).
 * @param {string} texto @param {string | null} [oficial] @returns {Tarea}
 */
export function nuevaTarea(texto, oficial = null) {
  const id = estado.siguienteId++;
  return {
    id,
    marcada: false,
    texto,
    tiempo: null,
    oficial,
    propuesta: oficial,
    emparejadaPara: oficial ? texto : null,
    estimacion: null,
    estimadaPara: null,
  };
}

/**
 * La persona ha cambiado el texto de una tarea emparejada y la tarea oficial ya no le corresponde. Un emparejamiento
 * vale para el texto con el que se hizo: si comparable (formato.js) produce un resultado distinto, se anula y hay que
 * volver a elegir. Se compara escritura normalizada, no significado.
 * @param {Tarea} tarea @returns {boolean}
 */
export function emparejamientoCaducado(tarea) {
  return Boolean(tarea.oficial) && comparable(tarea.texto) !== comparable(tarea.emparejadaPara);
}

/**
 * La estimación de la tarea ya no vale (su firma caducó): se olvida, y la tarea vuelve a estar pendiente.
 * @param {Tarea} tarea @returns {void}
 */
export function olvidarEstimacion(tarea) {
  tarea.estimacion = null;
  tarea.estimadaPara = null;
  tarea.sinEstimacion = null;
}

/**
 * La tarea queda sin estimación para `texto`, con su motivo. Si el motivo depende del texto, se conserva en
 * `estimadaPara`; en otro caso se deja a null.
 * @param {Tarea} tarea @param {string} texto @param {MotivoDeFallo} motivo @returns {void}
 */
export function anotarFallo(tarea, texto, motivo) {
  tarea.estimacion = null;
  tarea.estimadaPara = MOTIVOS_DE_FALLO[motivo].delTexto ? texto : null;
  tarea.sinEstimacion = { para: texto, motivo };
}

/**
 * Deja la tarea sin tarea oficial, sin propuesta y sin el texto para el que se emparejó.
 * @param {Tarea} tarea @returns {void}
 */
export function anularEmparejamiento(tarea) {
  tarea.oficial = null;
  tarea.propuesta = null;
  tarea.emparejadaPara = null;
}

/**
 * La ocupación elegida. Los pasos de las tareas y del informe solo se abren con ella (navegacion.js), así que pedirla
 * sin elegir es un error del programa, no de la persona.
 * @returns {Ocupacion}
 * @throws {Error} si el recorrido aún no tiene ocupación elegida
 */
export function ocupacionElegida() {
  if (!estado.ocupacion) {
    throw new Error('El recorrido no tiene ocupación elegida');
  }
  return estado.ocupacion;
}

/**
 * La tarea de la persona que cuenta ya la tarea oficial `id`, sin mirar `salvo`; o undefined si no la cuenta ninguna.
 * Una tarea oficial la cuenta como mucho una tarea de la persona, marcada en la lista o contada con sus palabras: si la
 * contaran dos, el informe la pondría dos veces, cada una con su tiempo, y repartiría mal la semana. Nadie puede elegir
 * una tarea oficial que ya cuenta otra: lo impiden lista-oficial.js y fila-tarea.js.
 * @param {string} id @param {Tarea} [salvo] @returns {Tarea | undefined}
 */
export function quienCuenta(id, salvo) {
  return estado.tareas.find((tarea) => tarea !== salvo && tarea.oficial === id);
}

/**
 * Las fichas de los grupos elegidos, la principal primero.
 * @returns {FichaDeGrupo[]}
 */
function fichasDeLosGrupos() {
  return [estado.grupos.principal, estado.grupos.secundario].filter((ficha) => ficha !== null);
}

/**
 * Las tareas oficiales de un grupo, cada una con el título de su grupo (`grupo`), para decir de cuál es.
 * @param {FichaDeGrupo | null} ficha @returns {TareaOficialDelGrupo[]}
 */
export function oficialesDe(ficha) {
  return ficha ? ficha.tareas.map((tarea) => ({ ...tarea, grupo: ficha.titulo })) : [];
}

/**
 * Las tareas oficiales de los grupos elegidos: primero las del principal.
 * @returns {TareaOficialDelGrupo[]}
 */
export function oficialesDeLosGrupos() {
  return fichasDeLosGrupos().flatMap(oficialesDe);
}
