// Contratos del paquete y del informe de formación abierta: fichas de cursos gratuitos en línea.
// Solo describen la forma de los datos; no los validan ni ejecutan las reglas de selección u orden del informe.
// La referencia al Cibernàrium es de tipo y se elimina al ejecutar este módulo.

import type { Idioma } from './idioma.ts';
import type { CibernariumDelInforme } from './tipos-barcelona-activa.ts';

/**
 * Nivel de un curso: el de DigComp que publica la entidad («A1» a «C2») o «iniciacion» si solo dice que no pide
 * requisitos. El tipo no establece el orden de los cursos.
 */
export type NivelAbierto = 'iniciacion' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** Quién es el titular del curso: un organismo público (como la UNED) u otra entidad. */
type TitularAbierto = 'publico' | 'no-publico';

/** De qué trata: competencias digitales generales o el uso de la inteligencia artificial. */
type TemaAbierto = 'digital' | 'ia';

/** El certificado opcional: quién lo emite, cuánto cuesta (lo que publica la entidad) y sus créditos, si los da. */
interface CertificadoAbierto {
  emisor: string;
  precio_eur: number;
  ects: number | null;
}

/** Una ficha del paquete, redactada por Faro: solo hechos y el enlace a la página pública del curso. */
export interface FichaAbiertaOficial {
  id: string;
  /** El título tal como lo publica la entidad. */
  titulo: string;
  entidad: string;
  titular: TitularAbierto;
  enlace: string;
  idioma: Idioma;
  /** El contenido en castellano o catalán es una traducción automática de la entidad. */
  traduccion_automatica: boolean;
  tema: TemaAbierto;
  /** Área de DigComp (1 a 5), si el curso la declara. */
  area_digcomp: number | null;
  nivel: NivelAbierto;
  horas: number | null;
  a_tu_ritmo: boolean;
  /** Desde cuándo se puede empezar (AAAA-MM-DD). */
  inicio: string;
  /** Hasta cuándo se puede seguir (AAAA-MM-DD); null si la entidad no publica un final. */
  fin: string | null;
  /** A quién se dirige, si la entidad lo restringe (por ejemplo, «mujeres»). */
  dirigido_a: string | null;
  certificado: CertificadoAbierto | null;
  /** Fecha (AAAA-MM-DD) en que Faro abrió la página y comprobó la ficha. */
  comprobado: string;
}

/** La formación abierta del paquete: las fichas que cumplen el criterio, con su cita y su revisión. */
export interface DatosFormacionAbierta {
  fuente: string;
  criterio: string;
  /** Fecha (AAAA-MM-DD) de la ficha comprobada más recientemente. */
  revision: string;
  fichas: FichaAbiertaOficial[];
}

/** Un curso abierto en el informe: los hechos de su ficha, con los nombres del motor. */
export interface CursoAbierto {
  id: string;
  titulo: string;
  entidad: string;
  titular: TitularAbierto;
  enlace: string;
  idioma: Idioma;
  traduccionAutomatica: boolean;
  tema: TemaAbierto;
  nivel: NivelAbierto;
  horas: number | null;
  aTuRitmo: boolean;
  /** Hasta cuándo se puede seguir (AAAA-MM-DD); null si la entidad no publica un final. El informe no da el inicio. */
  fin: string | null;
  dirigidoA: string | null;
  certificado: CertificadoAbierto | null;
  comprobado: string;
}

/**
 * La formación abierta del informe, en dos bloques que van siempre detrás de la oferta oficial: la de titular público
 * y, solo si la configuración lo permite, la de otras entidades. Cada bloque, de iniciación a avanzado y, a igual
 * nivel, de más corto a más largo. Este contrato describe el resultado; no impone ese orden.
 */
export interface FormacionAbierta {
  publica: CursoAbierto[];
  noPublica: CursoAbierto[];
  fuente: string;
  criterio: string;
  /**
   * Las formaciones de IA del Cibernàrium (Barcelona Activa) próximas o en línea ya iniciadas con el fin por delante,
   * si queda alguna según la selección por fechas del informe.
   */
  cibernarium?: CibernariumDelInforme;
}
