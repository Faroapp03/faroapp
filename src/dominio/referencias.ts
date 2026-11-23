// Referencias oficiales por ocupación y subgrupo, con notas y procedencia conservadas.

import { compararPorCodigo } from '../comun/orden.js';
import type { Datos, PoliticaReferencias, Referencia } from './tipos-paquete.ts';

/** Tope de las tareas de apoyo: la selección que añade «ampliada» y el recurso al subgrupo; las propias con nota se conservan todas. */
export const MAX_REFERENCIAS = 40;

/** Cifras del código ISCO-08 que identifican el subgrupo. */
const CIFRAS_DEL_SUBGRUPO = 3;

/** Con qué se calibra una estimación de Faro: las tareas de su ocupación, las de su subgrupo o el método de la OIT. */
export type BaseDeLaEstimacion = 'ocupacion' | 'subgrupo' | 'oit';

/** Las referencias de una ocupación y de dónde vienen: de ella misma o de su subgrupo. */
interface ReferenciasDeLaOcupacion {
  refs: Referencia[];
  base: Exclude<BaseDeLaEstimacion, 'oit'>;
}

/** Tarea oficial con nota, en la forma en que sirve de referencia. */
interface TareaConNota {
  readonly id: string;
  readonly texto: string;
  readonly nota: number;
  readonly isco08: string;
}

// La lista de tareas con nota se construye una vez por paquete de datos, no en cada estimación.
const tareasPorDatos = new WeakMap<Datos, readonly TareaConNota[]>();

function tareasConNota(datos: Datos): readonly TareaConNota[] {
  const guardadas = tareasPorDatos.get(datos);
  if (guardadas) {
    return guardadas;
  }
  const tareas = Object.entries(datos.oit.tareas).flatMap(([id, tarea]): TareaConNota[] =>
    tarea.nota === null ? [] : [{ id, texto: tarea.texto_en, nota: tarea.nota, isco08: tarea.isco08 }],
  );
  tareasPorDatos.set(datos, tareas);
  return tareas;
}

/** Hasta `cuantas` tareas repartidas por nota (de la más baja a la más alta), para que la escala quede cubierta. */
function repartidas(tareas: readonly TareaConNota[], cuantas: number): TareaConNota[] {
  const orden = [...tareas].sort((a, b) => a.nota - b.nota || compararPorCodigo(a.id, b.id));
  if (cuantas >= orden.length) {
    return orden;
  }
  if (cuantas <= 0) {
    return [];
  }
  if (cuantas === 1) {
    // cuantas < orden.length y cuantas === 1: la posición central existe.
    return [orden[Math.floor(orden.length / 2)] as TareaConNota];
  }
  // Posiciones equidistantes de la primera a la última, las dos incluidas.
  // 1 < cuantas < orden.length: las posiciones redondeadas están dentro de la lista.
  return Array.from(
    { length: cuantas },
    (_, i) => orden[Math.round((i * (orden.length - 1)) / (cuantas - 1))] as TareaConNota,
  );
}

function comoReferencia(tarea: TareaConNota): Referencia {
  return { id: tarea.id, texto: tarea.texto, nota: tarea.nota };
}

// Para reconocer copias del mismo texto oficial en inglés: sin mayúsculas ni signos.
function textoComparable(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Criterio para dejar fuera una tarea y todas las que repiten su texto oficial. */
function descarteDe(datos: Datos, excluir?: string): (id: string) => boolean {
  const textoExcluido = excluir ? textoComparable(datos.oit.tareas[excluir]?.texto_en ?? '') : null;
  return (id) =>
    id === excluir ||
    (textoExcluido !== null && textoComparable(datos.oit.tareas[id]?.texto_en ?? '') === textoExcluido);
}

/**
 * Referencias para estimar una tarea de una persona del grupo ISCO-08 `isco08`.
 * Si su grupo no tiene tareas en la OIT, se usan las de su subgrupo (base «subgrupo», margen siempre provisional).
 * `excluir` deja fuera una tarea y todas las que tienen su mismo texto (método «deja una fuera» al medir).
 * Sin ninguna referencia devuelve null.
 *
 * @param datos - El paquete de datos.
 * @param isco08 - El grupo ISCO-08 de la persona.
 * @param politica - La política de referencias.
 * @param excluir - La tarea que se deja fuera, si se mide.
 * @returns Las referencias y su base, o null si no hay ninguna.
 */
export function referenciasPara(
  datos: Datos,
  isco08: string,
  politica: PoliticaReferencias,
  excluir?: string,
): ReferenciasDeLaOcupacion | null {
  const descartada = descarteDe(datos, excluir);
  const todas = excluir ? tareasConNota(datos).filter((tarea) => !descartada(tarea.id)) : tareasConNota(datos);
  const subgrupo = isco08.slice(0, CIFRAS_DEL_SUBGRUPO);
  const propias = todas.filter((tarea) => tarea.isco08 === isco08);
  const hermanas = todas.filter(
    (tarea) => tarea.isco08 !== isco08 && tarea.isco08.slice(0, CIFRAS_DEL_SUBGRUPO) === subgrupo,
  );
  if (propias.length === 0) {
    if (hermanas.length === 0) {
      return null;
    }
    return { refs: repartidas(hermanas, MAX_REFERENCIAS).map(comoReferencia), base: 'subgrupo' };
  }
  const extra = politica === 'ampliada' ? repartidas(hermanas, MAX_REFERENCIAS - propias.length) : [];
  return { refs: [...propias, ...extra].map(comoReferencia), base: 'ocupacion' };
}

/**
 * La política con que se estima de verdad: la «oit» necesita los vectores de las tareas oficiales y, sin ellos, se
 * estima con la ampliada.
 *
 * @param datos - El paquete de datos.
 * @param politica - La política pedida.
 * @returns La política con que se estima.
 */
export function politicaEnVigor(datos: Datos, politica: PoliticaReferencias): PoliticaReferencias {
  return politica === 'oit' && !datos.vectores ? 'ampliada' : politica;
}

/**
 * Con qué se calibrará la estimación de una tarea del grupo `isco08` con la política `politica`: las tareas de su
 * ocupación, las de su subgrupo o el método de la OIT, que elige entre todas las tareas oficiales y siempre tiene con
 * qué. Sin ninguna referencia, devuelve null. Esta selección también determina las marcas de cada grupo
 * (dominio/grupos.ts).
 *
 * @param datos - El paquete de datos.
 * @param isco08 - El grupo ISCO-08 de la persona.
 * @param politica - La política de referencias.
 * @returns La base de la estimación, o null si no hay referencias.
 */
export function baseDeLaEstimacion(
  datos: Datos,
  isco08: string,
  politica: PoliticaReferencias,
): BaseDeLaEstimacion | null {
  const enVigor = politicaEnVigor(datos, politica);
  if (enVigor === 'oit') {
    return 'oit';
  }
  return referenciasPara(datos, isco08, enVigor)?.base ?? null;
}
