// Explicaciones de las tareas que van sin nota en el informe, sin citar textos sensibles.
import { traducible } from '../textos.js';
import { MOTIVOS_DE_FALLO } from './api/errores.js';
import { estado } from './estado.js';
import { formatearNumero } from './formato.js';

/** @import { Parte, Traducible } from '../textos.js' */
/** @import { MotivoDeFallo } from './api/errores.js' */
/** @import { Tarea } from './estado.js' */

/**
 * Las tareas sin estimación, agrupadas por su motivo, en el orden en que están.
 * @param {Tarea[]} tareas
 */
function porMotivo(tareas) {
  /** @type {Map<MotivoDeFallo, Tarea[]>} */
  const grupos = new Map();
  for (const tarea of tareas) {
    const motivo = tarea.sinEstimacion?.motivo;
    if (motivo) {
      const delGrupo = grupos.get(motivo) ?? [];
      delGrupo.push(tarea);
      grupos.set(motivo, delGrupo);
    }
  }
  return grupos;
}

/**
 * El número de una tarea en la lista de las que contó la persona («Tarea 2»), contando desde 1: así se nombra sin
 * citar lo que escribió.
 * @param {Tarea} tarea @returns {number}
 */
function numeroEnLaLista(tarea) {
  return estado.tareas.filter((otra) => !otra.marcada).indexOf(tarea) + 1;
}

/**
 * Los números de unas tareas en su lista, para una frase: «2», «2 y 4», «2, 3 y 5».
 * @param {Tarea[]} tareas @returns {Parte}
 */
export function numerosEnLaLista(tareas) {
  const numeros = tareas.map((tarea) => formatearNumero(numeroEnLaLista(tarea)));
  if (numeros.length === 1) {
    return numeros[0];
  }
  return traducible('recorrido.lista.y', { inicio: numeros.slice(0, -1).join(', '), ultimo: numeros.at(-1) });
}

/**
 * Lo que dice Faro de las tareas que se quedaron sin estimación por un mismo motivo: cuáles son y por qué. Un texto
 * que el motor no admite (puede ser una frase de riesgo) no se cita: se nombra por su número en la lista.
 * @param {MotivoDeFallo} motivo @param {Tarea[]} tareas @returns {Traducible}
 */
function explicacion(motivo, tareas) {
  const { clave, delTexto } = MOTIVOS_DE_FALLO[motivo];
  const porque = traducible(clave);
  const una = tareas.length === 1;
  if (delTexto) {
    const frase = una ? 'recorrido.informe.sin-citar-una' : 'recorrido.informe.sin-citar-varias';
    return traducible(frase, { numeros: numerosEnLaLista(tareas), motivo: porque });
  }
  const primera = tareas[0];
  if (una && primera) {
    return traducible('recorrido.informe.sin-estimar-una', { tarea: primera.texto.trim(), motivo: porque });
  }
  return traducible('recorrido.informe.sin-estimar-varias', {
    numero: formatearNumero(tareas.length),
    tareas: tareas.map((tarea) => `«${tarea.texto.trim()}»`).join(', '),
    motivo: porque,
  });
}

/**
 * Las explicaciones de las tareas sin estimación, una por motivo (entregar).
 * @param {Tarea[]} tareas @returns {Traducible[]}
 */
export function explicacionesDeLasSinEstimacion(tareas) {
  return [...porMotivo(tareas)].map(([motivo, deEseMotivo]) => explicacion(motivo, deEseMotivo));
}
