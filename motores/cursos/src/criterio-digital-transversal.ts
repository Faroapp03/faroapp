// Criterio del bloque de formación digital transversal: qué especialidades del catálogo del SEPE ofrece el plan al
// objetivo «Uso crítico de IA» de cualquier ocupación, sin relación con ninguna. Es una regla fija, sin IA, sobre los
// datos oficiales del catálogo, y es la misma para todas las ocupaciones: la formación de ese objetivo no depende así
// solo del ámbito de la tarea, que reproduce la brecha de género del catálogo.
// El criterio publicado no se reescribe: se corrige con una adenda fechada. La medición publicada se hizo con el
// criterio original y se sigue reproduciendo con él; la de la adenda va en su propio archivo.

import type { DatosFormacion, NivelActic } from '../../../compartido/contratos/tipos-formacion.ts';

/**
 * Criterio original: las especialidades del área «Competencias digitales» (las cuatro primeras letras del código, CTRD:
 * transversales, sin familia profesional ni ocupación relacionada) cuyo nombre oficial trata la inteligencia
 * artificial, de nivel 1 o 2 (las de nivel 3 son de desarrollo y programación).
 */
export const CRITERIO_DIGITAL_TRANSVERSAL = {
  area: 'CTRD',
  nombre: 'INTELIGENCIA ARTIFICIAL',
  niveles: ['1', '2'],
} as const;

/**
 * La adenda al criterio, con su fecha en `fecha`. El criterio original deja el bloque en cuatro especialidades, que
 * casi nunca tienen una edición abierta en la oferta pública de Cataluña; con la adenda, la regla es:
 * - **Qué trata:** el uso de la IA. El nombre oficial dice «inteligencia artificial» o «IA», o nombra una herramienta
 *   de IA generativa de las que aparecen en el catálogo (ChatGPT, Copilot). Los cursos de una herramienta entran con
 *   su nombre a la vista, el de su título oficial; el orden no depende de la marca, y Faro no recomienda una marca
 *   sobre otra.
 * - **Para quién:** cualquier ocupación. Solo el área transversal de competencias digitales (CTRD) y el área de
 *   sistemas y uso de la informática (IFCT); no las de desarrollo y programación (IFCD) ni las de un sector, que ya
 *   llegan a sus ocupaciones por la relación oficial.
 * - **Nivel:** «para empezar», los niveles 1 y 2; «para ir más allá», aparte, el nivel 3, y solo las especialidades
 *   que el SOC o el Consorci ofrecen en Cataluña (con fecha o previstas), para no llenar el plan de programas sin
 *   convocatoria.
 */
export const ADENDA_DIGITAL_TRANSVERSAL = {
  fecha: '2026-10-06',
  areas: ['CTRD', 'IFCT'],
  nombres: ['INTELIGENCIA ARTIFICIAL', 'IA', 'CHATGPT', 'COPILOT'],
  niveles: ['1', '2'],
  nivelesParaIrMasAlla: ['3'],
} as const;

/** El criterio con que trabaja el producto. */
export const CRITERIO_VIGENTE: CriterioDigitalTransversal = ADENDA_DIGITAL_TRANSVERSAL;

/**
 * Qué niveles de la ACTIC encajan en cada tramo, al lado de la formación: «para empezar», el básico; «para ir más
 * allá», el medio y el avanzado (que pide tener antes el medio). Es la certificación oficial de la Generalitat y se
 * ofrece como posibilidad, la misma para todas las ocupaciones; no cambia qué especialidades entran en el bloque.
 */
export const NIVELES_ACTIC_DEL_TRAMO: Readonly<Record<TramoDelBloque, readonly NivelActic[]>> = {
  'para-empezar': ['basico'],
  'para-ir-mas-alla': ['medio', 'avanzado'],
};

/** Letras del principio del código de una especialidad que dicen su área (CTRD, IFCT…). */
const LETRAS_AREA = 4;

/** Las marcas diacríticas que quedan sueltas al descomponer un texto (NFD). */
const MARCAS_DIACRITICAS = /\p{M}/gu;

/** Un texto como literal dentro de una expresión regular. */
function comoLiteral(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Alguna de las palabras de la adenda, entera. Se prueba con un nombre oficial ya en mayúsculas y sin tildes (lo
 * deja así nombraAlguna).
 */
const NOMBRA_ALGUNA = new RegExp(
  `(^|[^\\p{L}\\d])(${ADENDA_DIGITAL_TRANSVERSAL.nombres.map(comoLiteral).join('|')})(?=$|[^\\p{L}\\d])`,
  'u',
);

/** Un criterio del bloque: el original o el de la adenda. */
export type CriterioDigitalTransversal = typeof CRITERIO_DIGITAL_TRANSVERSAL | typeof ADENDA_DIGITAL_TRANSVERSAL;
/** El tramo del bloque en que entra una especialidad. */
export type TramoDelBloque = 'para-empezar' | 'para-ir-mas-alla';

type EspecialidadOficial = DatosFormacion['especialidades'][string];

/**
 * Si `valor` está en `lista`. Recibe la lista como `readonly string[]` para preguntar por un texto cualquiera en las
 * listas `as const` de los criterios, sin aserción: su `includes` solo admite sus literales.
 */
function incluye(lista: readonly string[], valor: string): boolean {
  return lista.includes(valor);
}

/** Si un nombre oficial (en mayúsculas en el SEPE) contiene alguna de las palabras de la adenda, enteras. */
function nombraAlguna(nombre: string): boolean {
  return NOMBRA_ALGUNA.test(nombre.toUpperCase().normalize('NFD').replace(MARCAS_DIACRITICAS, ''));
}

/** El tramo de una especialidad con el criterio original: solo hay uno. */
function tramoOriginal(codigo: string, especialidad: EspecialidadOficial): TramoDelBloque | null {
  const { area, nombre, niveles } = CRITERIO_DIGITAL_TRANSVERSAL;
  const entra =
    codigo.slice(0, LETRAS_AREA) === area &&
    especialidad.nombre.toUpperCase().includes(nombre) &&
    incluye(niveles, especialidad.nivel);
  return entra ? 'para-empezar' : null;
}

/** El tramo de una especialidad con la adenda, sin mirar todavía si tiene oferta en Cataluña. */
function tramoDeLaAdenda(codigo: string, especialidad: EspecialidadOficial): TramoDelBloque | null {
  const { areas, niveles, nivelesParaIrMasAlla } = ADENDA_DIGITAL_TRANSVERSAL;
  if (!incluye(areas, codigo.slice(0, LETRAS_AREA))) {
    return null;
  }
  if (!nombraAlguna(especialidad.nombre)) {
    return null;
  }
  if (incluye(niveles, especialidad.nivel)) {
    return 'para-empezar';
  }
  return incluye(nivelesParaIrMasAlla, especialidad.nivel) ? 'para-ir-mas-alla' : null;
}

/**
 * En qué tramo del bloque entra una especialidad del catálogo con un criterio; null si no entra.
 *
 * @param codigo - El código de la especialidad.
 * @param especialidad - La especialidad del catálogo oficial.
 * @param criterio - El criterio de selección.
 * @returns El tramo, o null si no entra.
 */
export function tramoDelBloque(
  codigo: string,
  especialidad: EspecialidadOficial,
  criterio: CriterioDigitalTransversal,
): TramoDelBloque | null {
  return 'fecha' in criterio ? tramoDeLaAdenda(codigo, especialidad) : tramoOriginal(codigo, especialidad);
}
