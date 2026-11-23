// Carga las fichas de los grupos elegidos y retira las referencias y estimaciones que pertenecían a otros grupos.
// Las tareas libres conservan su literal: la elección de una referencia oficial corresponde a la persona.

import { fichaDeGrupo } from './api.js';
import { anularEmparejamiento, estado, oficialesDeLosGrupos } from './estado.js';

/** @import { Eleccion } from './flujo-ocupacion.js' */
/** @import { FichaDeGrupo } from './traduccion-api.js' */
/**
 * Lo que queda de cargar los grupos elegidos: cuántas tareas oficiales marcadas se han retirado porque no son de
 * ninguno de ellos, y el título de la ocupación para la que se marcaron (`de`).
 * @typedef {{ retiradas: { cuantas: number, de: string } }} GruposCargados
 */

/** Si la elección tiene los mismos grupos que la ocupación ya elegida. @param {Eleccion} eleccion */
function mismosGrupos(eleccion) {
  return (
    estado.ocupacion?.isco08 === eleccion.isco08 && estado.ocupacion?.isco08Secundario === eleccion.isco08Secundario
  );
}

/** Si la elección es la misma: los mismos grupos y la misma ocupación ESCO. @param {Eleccion} eleccion */
function mismaEleccion(eleccion) {
  return mismosGrupos(eleccion) && estado.ocupacion?.esco === eleccion.esco;
}

/**
 * El nombre que ve la persona: el título oficial de su ocupación ESCO o, si no eligió ninguna, el de su grupo. Se
 * guarda tal como es, en castellano; se pinta en el idioma de la página (paso-tareas.js).
 * @param {Eleccion} eleccion @param {FichaDeGrupo} principal
 */
function tituloDeLaOcupacion(eleccion, principal) {
  const ocupacion = principal.ocupaciones.find((candidata) => candidata.esco === eleccion.esco);
  return ocupacion?.titulo || principal.titulo;
}

/** Las estimaciones se firman para una ocupación: con otra, ninguna vale. */
function olvidarEstimaciones() {
  for (const tarea of estado.tareas) {
    tarea.estimacion = null;
    tarea.estimadaPara = null;
  }
}

/**
 * Con otros grupos, las tareas oficiales marcadas que no son de ninguno de los nuevos se retiran (las que sí, se
 * quedan, con su tiempo), y las de la persona pierden su emparejamiento para volver a buscarlo. Devuelve cuántas
 * marcadas se han retirado.
 * @returns {number}
 */
function olvidarLoDeOtrosGrupos() {
  const vigentes = new Set(oficialesDeLosGrupos().map((tareaOficial) => tareaOficial.id));
  const antes = estado.tareas.length;
  estado.tareas = estado.tareas.filter(
    (tarea) => !tarea.marcada || (tarea.oficial !== null && vigentes.has(tarea.oficial)),
  );
  for (const tarea of estado.tareas) {
    if (!tarea.marcada) {
      anularEmparejamiento(tarea);
    }
  }
  return antes - estado.tareas.length;
}

/**
 * Carga los grupos de `eleccion` ({ isco08, esco, isco08Secundario }) y los deja en el estado con la ocupación, que
 * guarda también `palabra`, cómo nombra la persona su trabajo. Con la misma elección, no repite nada. La cancelación
 * de la persona (volver atrás, borrar) hace lanzar a `fichaDeGrupo` (api.js): si lanza, no se escribe nada en el estado.
 * @param {Eleccion} eleccion @param {string} palabra @returns {Promise<GruposCargados>}
 */
export async function cargarGruposElegidos(eleccion, palabra) {
  const [principal, secundario] = await Promise.all([
    fichaDeGrupo(eleccion.isco08),
    eleccion.isco08Secundario ? fichaDeGrupo(eleccion.isco08Secundario) : null,
  ]);
  const cambianLosGrupos = !mismosGrupos(eleccion);
  const anterior = estado.ocupacion?.titulo ?? '';
  if (!mismaEleccion(eleccion)) {
    olvidarEstimaciones();
  }
  estado.ocupacion = { ...eleccion, palabra, titulo: tituloDeLaOcupacion(eleccion, principal) };
  estado.grupos = { principal, secundario };
  if (!cambianLosGrupos) {
    return { retiradas: { cuantas: 0, de: anterior } };
  }
  const cuantas = olvidarLoDeOtrosGrupos();
  return { retiradas: { cuantas, de: anterior } };
}
