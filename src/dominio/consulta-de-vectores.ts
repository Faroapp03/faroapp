// El vector de consulta con que se ordena la formación por parecido: el de una ocupación ESCO (su nombre más el
// significado medio de las tareas oficiales de su grupo) o el de un grupo ISCO-08 sin ocupación (solo sus tareas). Se
// compara con los vectores de los nombres de las especialidades (formacion.ts), así que solo se suman o se comparan
// vectores del mismo modelo y de las mismas dimensiones: si no lo son, no hay parecido que medir, no hay consulta y la
// formación conserva sus prioridades oficiales y desempates sin una medida de parecido.

import { cargarIndice, normalizarVector, type VectoresGuardados, vectorDe } from '../comun/vectores.ts';
import type { Datos } from './tipos-paquete.ts';

/**
 * Si dos conjuntos de vectores son del mismo espacio (modelo y dimensiones): sumar o comparar vectores de espacios
 * distintos daría un parecido sin sentido, o NaN.
 *
 * @param uno - Un conjunto de vectores del paquete.
 * @param otro - El otro conjunto.
 * @returns Si coinciden el modelo y las dimensiones.
 */
function mismoEspacio(uno: VectoresGuardados, otro: VectoresGuardados): boolean {
  return uno.modelo === otro.modelo && uno.dimensiones === otro.dimensiones;
}

/**
 * Vectores de las tareas oficiales de un grupo ISCO-08; ninguno si faltan los vectores o el grupo.
 *
 * @param datos - El paquete de datos.
 * @param isco - El grupo ISCO-08 (4 cifras), o undefined si no se conoce.
 * @returns Los vectores de sus tareas, en el orden de las tareas del paquete.
 */
function vectoresDeSusTareas(datos: Datos, isco: string | undefined): Float32Array[] {
  const vectoresOit = datos.vectores;
  if (!vectoresOit || !isco) {
    return [];
  }
  const indice = cargarIndice(vectoresOit);
  return Object.entries(datos.oit.tareas)
    .filter(([, tarea]) => tarea.isco08 === isco)
    .map(([id]) => vectorDe(indice, id))
    .filter((vector): vector is Float32Array => vector !== null);
}

/**
 * Suma a `base` la media de unos vectores, componente a componente. Cada componente se divide por su número antes de
 * sumarla (y no se multiplica por su inverso, que añadiría un redondeo). La asignación a Float32 redondea tras cada suma.
 *
 * @param base - El vector al que se suma; se modifica.
 * @param vectores - Vectores de las mismas dimensiones que `base`; si no hay ninguno, `base` no cambia.
 * @returns La misma `base`, con la media sumada.
 */
function sumarMedia(base: Float32Array, vectores: readonly Float32Array[]): Float32Array {
  const cuantos = vectores.length;
  for (const vector of vectores) {
    for (let j = 0; j < base.length; j++) {
      // cargarIndice valida las dimensiones y los llamadores comprueban el espacio común; j está dentro de ambos.
      base[j] = (base[j] as number) + (vector[j] as number) / cuantos;
    }
  }
  return base;
}

/**
 * Vector de una ocupación para compararla con especialidades: su nombre más el significado medio de sus tareas
 * oficiales. Solo con el nombre, «bombero» se parece más a «vigilante de explosivos» que a «prevención y extinción de
 * incendios».
 *
 * @param datos - El paquete de datos.
 * @param esco - El identificador de la ocupación ESCO.
 * @returns El vector normalizado; null si el paquete no trae vectores de formación, no tiene el de la ocupación o sus
 *   vectores de ocupaciones, especialidades y tareas no son de un mismo espacio.
 */
export function consultaOcupacion(datos: Datos, esco: string): Float32Array | null {
  if (!datos.vectoresFormacion) {
    return null;
  }
  const { ocupaciones, especialidades } = datos.vectoresFormacion;
  if (!mismoEspacio(ocupaciones, especialidades) || (datos.vectores && !mismoEspacio(ocupaciones, datos.vectores))) {
    return null;
  }
  const vectorNombre = vectorDe(cargarIndice(ocupaciones), esco);
  if (!vectorNombre) {
    return null;
  }
  const vectoresTareas = vectoresDeSusTareas(datos, datos.esco.ocupaciones[esco]?.isco08);
  return normalizarVector(sumarMedia(Float32Array.from(vectorNombre), vectoresTareas));
}

/**
 * Vector de un grupo ISCO-08 para compararlo con especialidades cuando no hay ocupación ESCO: el significado medio de
 * sus tareas oficiales, sin nombre.
 *
 * @param datos - El paquete de datos.
 * @param isco - El grupo ISCO-08 (4 cifras).
 * @returns El vector normalizado; null si no hay vectores, si el grupo no tiene tareas o si los vectores de las tareas
 *   y los de las especialidades no son de un mismo espacio.
 */
export function consultaGrupo(datos: Datos, isco: string): Float32Array | null {
  if (
    datos.vectores &&
    datos.vectoresFormacion &&
    !mismoEspacio(datos.vectores, datos.vectoresFormacion.especialidades)
  ) {
    return null;
  }
  const vectoresTareas = vectoresDeSusTareas(datos, isco);
  const primero = vectoresTareas[0];
  if (!primero) {
    return null;
  }
  return normalizarVector(sumarMedia(new Float32Array(primero.length), vectoresTareas));
}
