// Construye el mismo plan para mostrar horarios y guardar las elecciones.
import { idiomaActual, texto } from '../../textos.js';
import { estado } from '../estado.js';
import { crearPlanValidado } from './preferencias-plan.js';
/** @import { SeleccionFormacion, OpcionPlan, PreferenciasSeleccion, Etapa } from '../../../../src/seleccion-formacion/contrato.ts' */
/** @param {{actual:SeleccionFormacion,ia:OpcionPlan|null,digital:OpcionPlan|null,preferencias:PreferenciasSeleccion,nivelDigital:Etapa|null,disponibilidad:{dias:number[],minutosPorDia:number,inicio:string}|null,tarea:string}} datos */
export function formarPlan({ actual, ia, digital, preferencias, nivelDigital, disponibilidad, tarea }) {
  if (!disponibilidad) {
    throw new TypeError('Falta la disponibilidad');
  }
  const propia = estado.tareas.find((x) => String(x.id) === tarea);
  const objetivo = propia?.texto ?? texto(`formacion.objetivo.${actual.etapa}`);
  return crearPlanValidado({
    actual,
    ia,
    digital,
    preferencias,
    nivelDigital,
    disponibilidad,
    objetivo,
    idioma: idiomaActual(),
    perfil: estado.ocupacion?.titulo ?? null,
  });
}

/** Conserva las elecciones solo si siguen siendo exactamente las mismas en la consulta nueva. Un bloque sin elección
 * (null) se queda sin curso; no elegir nada también es una respuesta válida.
 * @param {SeleccionFormacion} anterior @param {SeleccionFormacion} actual @param {string|null} ia @param {string|null} digital
 * @returns {{ia:OpcionPlan|null,digital:OpcionPlan|null} | null} */
export function eleccionesVigentes(anterior, actual, ia, digital) {
  const elegidas = (/** @type {SeleccionFormacion} */ s) => ({
    ia: ia === null ? null : (s.opciones.ia.find((o) => o.oferta.unidad.id === ia) ?? undefined),
    digital: digital === null ? null : (s.opciones.digital.find((o) => o.oferta.unidad.id === digital) ?? undefined),
  });
  const antes = elegidas(anterior);
  const despues = elegidas(actual);
  if (
    antes.ia === undefined ||
    antes.digital === undefined ||
    despues.ia === undefined ||
    despues.digital === undefined ||
    (ia !== null && ia === digital) ||
    JSON.stringify(antes) !== JSON.stringify(despues)
  ) {
    return null;
  }
  return { ia: despues.ia, digital: despues.digital };
}
