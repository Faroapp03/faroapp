// Contratos de las necesidades formativas publicadas por el SEPE: fichas del paquete y de la ocupación en el informe.
// Describen competencias de una ocupación, sin evaluar carencias de la persona.

/** Una competencia de la ficha y el porcentaje que publica el SEPE, tal cual. */
export interface CompetenciaPedida {
  competencia: string;
  /** null si la ficha no publica un porcentaje numérico. */
  porcentaje: number | null;
  /** Solo en los idiomas: cada destreza (entender, leer, conversar, escribir) con su porcentaje. */
  destrezas?: { destreza: string; porcentaje: number | null }[];
}

/** Los cuatro bloques de la ficha: el oficio, lo digital, el trato con la gente y los idiomas. */
export type BloqueDeLaFicha = 'tecnicas' | 'digitales' | 'personales' | 'idiomas';

/** Una ficha de necesidades formativas del paquete. */
export interface FichaSepe {
  /** El nombre de la ocupación, como lo publica la ficha del SEPE. */
  ocupacion: string;
  /** Año de la ficha («AAAA»). */
  anio: number;
  /** La dirección oficial de la ficha. */
  url: string;
  competencias: Partial<Record<BloqueDeLaFicha, CompetenciaPedida[]>>;
  /** Las competencias técnicas de la ficha que nombran la inteligencia artificial, tal como las escribe. */
  competencias_ia: string[];
}

/** Las necesidades formativas del SEPE, como las trae el paquete. */
export interface DatosNecesidades {
  /** La fuente de las fichas (nombre del servicio). */
  fuente: string;
  /** La cita que pide la fuente. */
  cita: string;
  /** Fecha (AAAA-MM-DD) de la consulta de las fichas. */
  consulta: string;
  /** Fichas anteriores a 2025 que publican 0 % en todo el oficio: en ellas la cifra no se usa como medida. */
  todo_a_cero: string[];
  ocupaciones: Record<string, FichaSepe>;
}

/** Una ficha en el informe: su código CNO-11 y si sus cifras se enseñan. */
export interface NecesidadesDeLaOcupacion extends FichaSepe {
  cno11: string;
  /** false si el SEPE publica 0 % en todo el oficio: entonces se enseña solo la lista, sin ninguna cifra. */
  conCifras: boolean;
}
