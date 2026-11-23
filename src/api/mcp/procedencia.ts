// De dónde sale cada respuesta del servidor MCP, como en el informe: la cita de cada fuente tal como la publica (con su
// fecha), su licencia o condiciones de reutilización, y qué es dato oficial y qué ha hecho Faro. Las citas salen de los
// mismos datos y funciones que el informe (dominio/fuentes-y-avisos.ts); las licencias se resumen de datos/README.md.

import { VERSION_FARO } from '../../comun/version.ts';
import { citaOit } from '../../dominio/fuentes-y-avisos.ts';
import type { Lengua } from '../../dominio/lengua.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';

/** Quién responde de un dato: la fuente oficial, una fuente complementaria o Faro, que lo elabora. */
type Nivel = 'oficial' | 'complementaria' | 'faro';

/** Una fuente citada: su cita literal, su nivel y su licencia o condiciones. */
export interface Fuente {
  cita: string;
  nivel: Nivel;
  licencia: string;
}

/** Lo que acompaña a toda respuesta: las fuentes, qué es oficial, qué es de Faro y para qué sirve. */
export interface Procedencia {
  fuentes: Fuente[];
  oficial: string;
  deFaro: string;
  /** La versión de Faro que responde. */
  faro: string;
}

/** Licencias y condiciones de cada fuente, resumidas de datos/README.md. */
export const LICENCIAS = {
  oit: 'CC BY 4.0, con la cita de la OIT y sus avisos de adaptación y de traducción.',
  notasPorTarea: 'Política de acceso abierto de la OIT: reutilizable citando a la OIT.',
  esco: '© Unión Europea; reutilización según el aviso legal de la Comisión Europea (Decisión 2011/833/UE), citando la fuente.',
  ine: 'CC BY 4.0, con la cita del INE.',
  idescat: 'Idescat: citar «elaboración propia a partir de datos del Idescat» con la fecha de actualización.',
  observatori: "Llicència oberta d'ús d'informació – Catalunya: citar la fuente y la fecha de actualización.",
  sepe: 'Aviso legal del SEPE (Ley 37/2007 y Real Decreto 1495/2011): «Origen de los datos: SEPE» y fecha.',
  soc: "ODC-BY 1.0 y Llicència oberta d'ús d'informació – Catalunya (SOC); © Unión Europea (EURES).",
  consorci: "Llicència oberta d'ús d'informació – Catalunya: citar la fuente y la fecha de la última actualización.",
  acreditacion:
    "Condiciones de reutilización del BOE («Basado en datos de la Agencia Estatal Boletín Oficial del Estado») y Llicència oberta d'ús d'informació – Catalunya (Agència FP.CAT).",
  faro: 'Elaboración de Faro, con licencia del proyecto.',
} as const;

/** Alcance de las consultas: se añade al texto que describe la elaboración de Faro. */
export const ALCANCE =
  'Orientación, no decisión: los datos describen grupos de ocupaciones, no a una persona concreta, y no predicen qué le pasará a nadie.';

/**
 * Una fuente oficial con su licencia.
 *
 * @param cita - El texto de la cita.
 * @param licencia - La licencia de reutilización.
 * @returns La fuente, con nivel oficial.
 */
export function oficial(cita: string, licencia: string): Fuente {
  return { cita, nivel: 'oficial', licencia };
}

/**
 * La cita de la OIT (WP140) con sus dos avisos, la misma del informe.
 *
 * @param datos - El paquete de datos.
 * @param lengua - La lengua de los textos.
 * @returns La fuente de la OIT.
 */
export function fuenteOit(datos: Datos, lengua: Lengua): Fuente {
  return oficial(citaOit(datos, lengua), LICENCIAS.oit);
}

/**
 * La cita de ESCO, la misma del informe.
 *
 * @param lengua - La lengua de los textos.
 * @returns La fuente de ESCO.
 */
export function fuenteEsco(lengua: Lengua): Fuente {
  return oficial(lengua.textos.fuentes.esco, LICENCIAS.esco);
}

/**
 * La cita de la correspondencia CNO-11 / CIUO-08 del INE, la misma del informe.
 *
 * @param lengua - La lengua de los textos.
 * @returns La fuente del INE.
 */
export function fuenteIne(lengua: Lengua): Fuente {
  return oficial(lengua.textos.fuentes.ine, LICENCIAS.ine);
}

/**
 * Las notas por tarea, complementarias, con la frase del informe.
 *
 * @param lengua - La lengua de los textos.
 * @returns La fuente de las notas por tarea, de nivel complementario.
 */
export function fuenteNotasPorTarea(lengua: Lengua): Fuente {
  return {
    cita: lengua.textos.fuentes.notasPorTarea,
    nivel: 'complementaria',
    licencia: LICENCIAS.notasPorTarea,
  };
}

/**
 * La procedencia de una respuesta: sus fuentes y las dos frases de qué es oficial y qué ha hecho Faro.
 *
 * @param fuentes - Las fuentes de la respuesta.
 * @param queEsOficial - Qué hay en ella de oficial.
 * @param deFaro - Qué ha puesto Faro; se le añade el alcance.
 * @returns La procedencia completa.
 */
export function procedencia(fuentes: Fuente[], queEsOficial: string, deFaro: string): Procedencia {
  return {
    fuentes,
    oficial: queEsOficial,
    deFaro: `${deFaro} ${ALCANCE}`,
    faro: VERSION_FARO,
  };
}
