// Fichas que la API muestra a la persona para elegir y confirmar su ocupación: la de una ocupación ESCO y la de un
// grupo ISCO-08 de 4 cifras, que es donde la OIT publica tareas y notas. Sin IA.

import type { Candidata } from '../../motores/ocupaciones/src/index.ts';
import { franja } from '../dominio/franjas.ts';
import { type MarcasDelGrupo, marcasDelGrupo, type OcupacionDelGrupo, ocupacionesDelGrupo } from '../dominio/grupos.ts';
import type { Franja } from '../dominio/tipos-informe.ts';
import type { Datos, DatosOit, PoliticaReferencias } from '../dominio/tipos-paquete.ts';

/** Tareas oficiales que acompañan a cada candidata para distinguirlas («jefe de bomberos» frente a «bombero»). */
export const TAREAS_TIPICAS = 3;

/** Una tarea oficial tal como viene en los datos de la OIT. */
type TareaOit = DatosOit['tareas'][string];

/** Una tarea oficial de la ocupación, con su nota de la OIT y sus textos en castellano si ya están traducidos. */
export interface TareaFicha {
  id: string;
  indice: number;
  corto: string | null;
  texto_es: string | null;
  texto_en: string;
  traduccionPendiente: boolean;
  nota: number;
  margen: [number, number] | null;
  franja: Franja;
}

/** Lo que la persona ve de una ocupación para confirmarla: títulos, nota media de la OIT y tareas oficiales. */
export interface FichaOcupacion {
  esco: string;
  titulo: string;
  descripcion: string;
  isco08: string;
  tituloIsco: string;
  oit: { media: number | null; gradiente: string | null } | null;
  tareas: TareaFicha[];
}

/**
 * Lo que la persona ve de un grupo para confirmarlo: título, nota media, tareas oficiales, ocupaciones ESCO y marcas.
 */
export interface FichaGrupo extends MarcasDelGrupo {
  isco08: string;
  titulo: string;
  oit: { media: number | null; gradiente: string | null } | null;
  tareas: TareaFicha[];
  ocupaciones: readonly OcupacionDelGrupo[];
}

/** Una tarea oficial con nota: su identificador, la tarea de la OIT y su nota, ya sin null. */
interface TareaConNota {
  id: string;
  tarea: TareaOit;
  nota: number;
}

/** Tareas oficiales con nota de cada grupo ISCO-08, en el orden de la clasificación. */
type TareasPorGrupo = Map<string, TareaConNota[]>;

/**
 * El índice por grupo se construye una vez por paquete de datos, no una vez por candidata: si no, una búsqueda amplia
 * recorrería el catálogo OIT por cada ocupación encontrada. La caché va en un WeakMap por `Datos`, como en
 * dominio/referencias.ts: dos paquetes distintos en el mismo proceso no comparten nada. Supone que `Datos` es
 * inmutable tras cargarse.
 */
const tareasPorDatos = new WeakMap<Datos, TareasPorGrupo>();

/** El índice de las tareas con nota de cada grupo para un paquete de datos, que se construye la primera vez. */
function indiceDeTareas(datos: Datos): TareasPorGrupo {
  const guardado = tareasPorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const porGrupo: TareasPorGrupo = new Map();
  for (const [id, tarea] of Object.entries(datos.oit.tareas)) {
    const { nota } = tarea;
    if (nota === null) {
      continue;
    }
    const delGrupo = porGrupo.get(tarea.isco08);
    if (delGrupo) {
      delGrupo.push({ id, tarea, nota });
    } else {
      porGrupo.set(tarea.isco08, [{ id, tarea, nota }]);
    }
  }
  // Las tareas de cada grupo van por su índice en la clasificación y, a igualdad, en el orden en que vienen en los
  // datos (la ordenación de JavaScript es estable).
  for (const delGrupo of porGrupo.values()) {
    delGrupo.sort((a, b) => a.tarea.indice - b.tarea.indice);
  }
  tareasPorDatos.set(datos, porGrupo);
  return porGrupo;
}

/** Tareas oficiales con nota de un grupo ISCO-08, en el orden de la clasificación. La lista es de solo lectura. */
function tareasConNota(datos: Datos, isco08: string): readonly TareaConNota[] {
  return indiceDeTareas(datos).get(isco08) ?? [];
}

/** Una tarea oficial como la ve la persona: sus textos en castellano si ya están traducidos, su nota y su franja. */
function tareaFicha(datos: Datos, { id, tarea, nota }: TareaConNota): TareaFicha {
  const traduccion = datos.textos.tareas[id];
  return {
    id,
    indice: tarea.indice,
    corto: traduccion?.corto ?? null,
    texto_es: traduccion?.texto_es ?? null,
    texto_en: tarea.texto_en,
    traduccionPendiente: !traduccion,
    nota,
    margen: tarea.margen,
    franja: franja(nota),
  };
}

/**
 * Añade a cada candidata el nombre corto de sus primeras tareas oficiales, para que la persona las distinga.
 *
 * @param datos - El paquete de datos.
 * @param candidatas - Las candidatas del buscador.
 * @returns Las mismas candidatas, cada una con `tareasTipicas`.
 */
export function conTareasTipicas(
  datos: Datos,
  candidatas: readonly Candidata[],
): (Candidata & { tareasTipicas: string[] })[] {
  return candidatas.map((candidata) => ({
    ...candidata,
    tareasTipicas: tareasConNota(datos, candidata.isco08)
      .map(({ id }) => datos.textos.tareas[id]?.corto)
      .filter((corto): corto is string => !!corto)
      .slice(0, TAREAS_TIPICAS),
  }));
}

/**
 * Las tareas oficiales con nota de un grupo, como las ve la persona: texto en castellano, nota, margen y franja.
 *
 * @param datos - El paquete de datos.
 * @param isco08 - El código del grupo ISCO-08.
 * @returns Sus tareas, ya con nota, margen y franja.
 */
export function tareasOficiales(datos: Datos, isco08: string): TareaFicha[] {
  return tareasConNota(datos, isco08).map((conNota) => tareaFicha(datos, conNota));
}

/**
 * La ficha de una ocupación ESCO, o null si el código no existe.
 *
 * @param datos - El paquete de datos.
 * @param esco - El código ESCO (cifras y puntos), con el formato que admite la ruta de la API.
 * @returns La ficha, o null si el código no existe.
 */
export function fichaOcupacion(datos: Datos, esco: string): FichaOcupacion | null {
  const ocupacion = datos.esco.ocupaciones[esco];
  if (!ocupacion) {
    return null;
  }
  const oit = datos.oit.ocupaciones[ocupacion.isco08];
  const tareas = tareasOficiales(datos, ocupacion.isco08);
  return {
    esco,
    titulo: ocupacion.titulo,
    descripcion: ocupacion.descripcion ?? '',
    isco08: ocupacion.isco08,
    tituloIsco: datos.clasificaciones.isco08_es[ocupacion.isco08] ?? ocupacion.isco08,
    oit: oit ? { media: oit.media, gradiente: oit.gradiente } : null,
    tareas,
  };
}

/**
 * La ficha de un grupo ISCO-08 de 4 cifras, con sus marcas para la política `politica` con que estima la API.
 * `isco08` ya viene comprobado (dominio/grupos.ts, esGrupoValido).
 *
 * @param datos - El paquete de datos.
 * @param isco08 - El código del grupo, ya comprobado.
 * @param politica - La política de referencias con que estima la API.
 * @returns La ficha del grupo.
 */
export function fichaGrupo(datos: Datos, isco08: string, politica: PoliticaReferencias): FichaGrupo {
  const oit = datos.oit.ocupaciones[isco08];
  return {
    isco08,
    // esGrupoValido, exigido por el contrato, garantiza un título propio en el catálogo validado.
    titulo: datos.clasificaciones.isco08_es[isco08] as string,
    oit: oit ? { media: oit.media, gradiente: oit.gradiente } : null,
    tareas: tareasOficiales(datos, isco08),
    ocupaciones: ocupacionesDelGrupo(datos, isco08),
    ...marcasDelGrupo(datos, isco08, politica),
  };
}
