// Caminos que propone el informe: usar la IA en lo que más cambia y reforzar lo que más depende de la persona.
// Cada camino se apoya en las tareas y las competencias ESCO de esas tareas; sin competencias, no se propone. Los
// textos, en el idioma del informe, están en textos-informe.ts.

import { frase, lista } from '../comun/formato.ts';
import type { Idioma } from '../comun/idioma.ts';
import type { TextosInforme } from './textos-informe.ts';
import type { Camino, Competencia, TareaInforme } from './tipos-informe.ts';

/** Tareas en las que se apoya cada camino, como mucho. */
const MAX_TAREAS_POR_CAMINO = 2;

/** Con qué se escriben los caminos: sus textos y el idioma de las listas. */
interface EscrituraCaminos {
  textos: TextosInforme['caminos'];
  idioma: Idioma;
}

/** Competencias por URI: conserva su primera posición y los datos de la última tarea que la incluye. */
function competenciasDe(tareas: readonly TareaInforme[]): Competencia[] {
  const porUri = new Map(
    tareas.flatMap((tarea) => tarea.competencias).map((competencia) => [competencia.uri, competencia]),
  );
  return [...porUri.values()];
}

/**
 * Las tareas de más cambio: primero las que ocupan más tiempo y, a igual tiempo, las de nota más alta.
 * tareas.ts asigna franja null a las tareas sin nota, que este filtro excluye antes de ordenar.
 */
function tareasQueMasCambian(tareas: readonly TareaInforme[]): TareaInforme[] {
  return tareas
    .filter((tarea) => tarea.franja === 'alta')
    .sort((a, b) => b.peso - a.peso || (b.valor ?? 0) - (a.valor ?? 0))
    .slice(0, MAX_TAREAS_POR_CAMINO);
}

/**
 * Las tareas de menos cambio: primero las que ocupan más tiempo y, a igual tiempo, las de nota más baja.
 * tareas.ts asigna franja null a las tareas sin nota, que este filtro excluye antes de ordenar.
 */
function tareasQueMenosCambian(tareas: readonly TareaInforme[]): TareaInforme[] {
  return tareas
    .filter((tarea) => tarea.franja === 'baja')
    .sort((a, b) => b.peso - a.peso || (a.valor ?? 0) - (b.valor ?? 0))
    .slice(0, MAX_TAREAS_POR_CAMINO);
}

/** El camino de usar la IA en lo que más cambia: su título lista las tareas en minúsculas. */
function caminoMasCambia(altas: readonly TareaInforme[], { textos, idioma }: EscrituraCaminos): Camino {
  const dedicaMucho = altas.every((tarea) => tarea.tiempo === 'mucho');
  const nombres = altas.map((tarea) => tarea.nombre);
  return {
    tipo: 'mas-cambia',
    titulo: textos.usarLaIa(
      lista(
        nombres.map((nombre) => nombre.toLowerCase()),
        idioma,
      ),
    ),
    porque: textos.porqueMasCambia(frase(nombres, idioma), altas.length > 1, dedicaMucho),
    tareas: altas.map((tarea) => tarea.id),
    competencias: competenciasDe(altas),
  };
}

/** El camino de reforzar lo que menos cambia y más depende de la persona. */
function caminoSigueSiendoTuyo(bajas: readonly TareaInforme[], { textos, idioma }: EscrituraCaminos): Camino {
  return {
    tipo: 'sigue-siendo-tuyo',
    titulo: textos.reforzar,
    porque: textos.porqueSigueSiendoTuyo(
      frase(
        bajas.map((tarea) => tarea.nombre),
        idioma,
      ),
      bajas.length > 1,
    ),
    tareas: bajas.map((tarea) => tarea.id),
    competencias: competenciasDe(bajas),
  };
}

/**
 * Hasta dos caminos: usar la IA en lo que más cambia y reforzar lo que menos. Solo los que tienen competencias. Se
 * escriben con `escritura`: los textos y el idioma del informe.
 *
 * @param tareas - Las tareas del informe, con su franja.
 * @param escritura - Los textos y el idioma del informe.
 * @returns Los caminos propuestos, como mucho dos.
 */
export function caminos(tareas: readonly TareaInforme[], escritura: EscrituraCaminos): Camino[] {
  const propuestos: Camino[] = [];
  const altas = tareasQueMasCambian(tareas);
  if (altas.length) {
    propuestos.push(caminoMasCambia(altas, escritura));
  }
  const bajas = tareasQueMenosCambian(tareas);
  if (bajas.length) {
    propuestos.push(caminoSigueSiendoTuyo(bajas, escritura));
  }
  return propuestos.filter((camino) => camino.competencias.length > 0);
}
