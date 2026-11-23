// Grupos de la clasificación ISCO-08 de la OIT en los datos de Faro: la jerarquía oficial (de 1 a 4 cifras), las
// ocupaciones ESCO de cada grupo y las marcas que dicen con qué tareas oficiales cuenta un grupo. Sin IA.
// La ocupación se ancla en el grupo de 4 cifras: las tareas oficiales de la OIT y sus notas son del
// grupo, y la ocupación ESCO solo afina.

import { compararTexto } from '../comun/orden-alfabetico.ts';
import { baseDeLaEstimacion, referenciasPara } from './referencias.ts';
import type { Datos, PoliticaReferencias } from './tipos-paquete.ts';

/** Cifras de un grupo de ocupación completo: el nivel al que la OIT publica tareas y notas. */
const CIFRAS_GRUPO = 4;

/** Una ocupación ESCO de un grupo, con su título tal como lo publica ESCO. */
export interface OcupacionDelGrupo {
  readonly esco: string;
  readonly titulo: string;
}

/**
 * Marcas de un grupo, coherentes con el estimador y con la política con que estima la API: `sinTareasOit` si la OIT no publica tareas con nota para el grupo; `referenciasSubgrupo` si, sin
 * tareas propias, sus estimaciones se calibran con las de su subgrupo de 3 cifras (margen siempre provisional);
 * `sinReferencias` si no hay ninguna tarea oficial con que estimarlas, y sus tareas quedarán como información
 * insuficiente.
 */
export interface MarcasDelGrupo {
  sinTareasOit: boolean;
  referenciasSubgrupo: boolean;
  sinReferencias: boolean;
}

/** Un grupo hijo en la jerarquía oficial, con cuántas ocupaciones ESCO caen dentro de él. */
export interface HijoDeGrupo {
  isco08: string;
  titulo: string;
  ocupaciones: number;
}

/** Lo que se calcula una vez por paquete de datos: las ocupaciones de cada grupo y los recuentos por prefijo. */
interface IndiceGrupos {
  ocupacionesPorGrupo: Map<string, OcupacionDelGrupo[]>;
  ocupacionesPorPrefijo: Map<string, number>;
}

/** Un índice por paquete de datos. Dueño: este archivo; vive lo que vive el objeto Datos, y dos paquetes no comparten nada. */
const indicesPorDatos = new WeakMap<Datos, IndiceGrupos>();

/** Orden alfabético por título, en castellano. */
function porTitulo(a: { titulo: string }, b: { titulo: string }): number {
  return compararTexto(a.titulo, b.titulo, 'es');
}

/** El índice de grupos del paquete, calculado la primera vez y guardado en `indicesPorDatos`. */
function indiceDe(datos: Datos): IndiceGrupos {
  const guardado = indicesPorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const ocupacionesPorGrupo = new Map<string, OcupacionDelGrupo[]>();
  const ocupacionesPorPrefijo = new Map<string, number>();
  for (const [esco, ocupacion] of Object.entries(datos.esco.ocupaciones)) {
    const lista = ocupacionesPorGrupo.get(ocupacion.isco08) ?? [];
    lista.push({ esco, titulo: ocupacion.titulo });
    ocupacionesPorGrupo.set(ocupacion.isco08, lista);
    for (let cifras = 1; cifras <= ocupacion.isco08.length; cifras++) {
      const prefijo = ocupacion.isco08.slice(0, cifras);
      ocupacionesPorPrefijo.set(prefijo, (ocupacionesPorPrefijo.get(prefijo) ?? 0) + 1);
    }
  }
  for (const lista of ocupacionesPorGrupo.values()) {
    lista.sort(porTitulo);
  }
  const nuevo = { ocupacionesPorGrupo, ocupacionesPorPrefijo };
  indicesPorDatos.set(datos, nuevo);
  return nuevo;
}

/**
 * El grupo que se enseña en lugar de `hijo` al explorar: si tiene un solo hijo con su mismo título, ese hijo (y así
 * hasta que cambie): la OIT repite el nombre al bajar de nivel («Otro personal de apoyo administrativo», 44 → 441), y
 * la persona lo vería dos veces seguidas como única opción. Mismas ocupaciones dentro y mismo título; solo se salta
 * el nivel repetido. La recursión baja una cifra en cada paso y hijosDe para en el grupo de CIFRAS_GRUPO cifras: como
 * mucho, cuatro niveles.
 */
function sinNivelRepetido(datos: Datos, hijo: HijoDeGrupo): HijoDeGrupo {
  const nietos = hijosDe(datos, hijo.isco08);
  const unico = nietos?.length === 1 ? nietos[0] : undefined;
  return unico?.titulo === hijo.titulo ? sinNivelRepetido(datos, unico) : hijo;
}

/**
 * Título oficial en castellano de un código ISCO-08 de 1 a 4 cifras, o null si no existe.
 *
 * @param datos - El paquete de datos.
 * @param codigo - El código ISCO-08.
 * @returns El título, o null.
 */
export function tituloIsco(datos: Datos, codigo: string): string | null {
  // El catálogo validado es un Record de títulos: una clave propia tiene un texto.
  return Object.hasOwn(datos.clasificaciones.isco08_es, codigo)
    ? (datos.clasificaciones.isco08_es[codigo] as string)
    : null;
}

/**
 * Un grupo de 4 cifras que existe en la clasificación oficial.
 *
 * @param datos - El paquete de datos.
 * @param codigo - El código a comprobar.
 * @returns Si es un grupo de 4 cifras oficial.
 */
export function esGrupoValido(datos: Datos, codigo: string): boolean {
  return /^\d+$/.test(codigo) && codigo.length === CIFRAS_GRUPO && tituloIsco(datos, codigo) !== null;
}

/**
 * Ocupaciones ESCO del grupo, en orden alfabético; ninguna si el grupo no tiene (ESCO no las cubre todas).
 *
 * @param datos - El paquete de datos.
 * @param isco08 - El código del grupo.
 * @returns Las ocupaciones, en orden alfabético.
 */
export function ocupacionesDelGrupo(datos: Datos, isco08: string): readonly OcupacionDelGrupo[] {
  return indiceDe(datos).ocupacionesPorGrupo.get(isco08) ?? [];
}

/**
 * Las marcas del grupo con la selección de referencias de `baseDeLaEstimacion` (dominio/referencias.ts).
 * Sin política, se usa la predeterminada: la de su ocupación.
 *
 * @param datos - El paquete de datos.
 * @param isco08 - El código del grupo.
 * @param politica - La política de referencias.
 * @returns Las marcas del grupo.
 */
export function marcasDelGrupo(
  datos: Datos,
  isco08: string,
  politica: PoliticaReferencias = 'ocupacion',
): MarcasDelGrupo {
  const conTareasOit = referenciasPara(datos, isco08, 'ocupacion')?.base === 'ocupacion';
  const base = baseDeLaEstimacion(datos, isco08, politica);
  return { sinTareasOit: !conTareasOit, referenciasSubgrupo: base === 'subgrupo', sinReferencias: base === null };
}

/**
 * Los hijos de un código en la jerarquía oficial, en orden alfabético: con `padre` vacío, los 10 grandes grupos; con
 * un código de 1 a 3 cifras, los de una cifra más. Devuelve null si el padre no existe o ya es un grupo completo.
 *
 * @param datos - El paquete de datos.
 * @param padre - El código del padre, o vacío.
 * @returns Los hijos, o null.
 */
export function hijosDe(datos: Datos, padre: string): HijoDeGrupo[] | null {
  if (padre.length >= CIFRAS_GRUPO || (padre !== '' && tituloIsco(datos, padre) === null)) {
    return null;
  }
  const { ocupacionesPorPrefijo } = indiceDe(datos);
  return Object.entries(datos.clasificaciones.isco08_es)
    .filter(([codigo]) => codigo.length === padre.length + 1 && codigo.startsWith(padre))
    .map(([codigo, titulo]) => ({ isco08: codigo, titulo, ocupaciones: ocupacionesPorPrefijo.get(codigo) ?? 0 }))
    .sort(porTitulo);
}

/**
 * Los hijos de un código para explorar la jerarquía (GET /api/grupos): los de hijosDe, pero un hijo que solo repite
 * su nombre un nivel más abajo se enseña ya en ese nivel (sinNivelRepetido). Su código empieza igual por `padre`.
 *
 * @param datos - El paquete de datos.
 * @param padre - El código del padre, o vacío.
 * @returns Los hijos, o null.
 */
export function hijosParaExplorar(datos: Datos, padre: string): HijoDeGrupo[] | null {
  return hijosDe(datos, padre)?.map((hijo) => sinNivelRepetido(datos, hijo)) ?? null;
}
