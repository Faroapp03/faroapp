// Contratos de comparación con el conjunto de Cataluña y de información adicional del informe.
// Incluyen los indicadores del Observatori y los salarios por antigüedad que usan esas vistas.

/** Claves de las preguntas de «Frente al conjunto»; la unión no impone un orden de presentación. */
export type PreguntaComparada = 'quien' | 'estudios' | 'contrato' | 'crece';

/** Cada dato comparado: el texto de su rótulo sale de esta clave en la presentación. */
export type DatoComparado =
  | 'mujeres'
  | 'menores30'
  | 'mayores55'
  | 'obligatoria'
  | 'bachillerato'
  | 'fpGradoMedio'
  | 'fpGradoSuperior'
  | 'universitarios'
  | 'indefinido'
  | 'cuentaPropia'
  | 'indefinidosFirmados'
  | 'ocupadosCrece'
  | 'contratadasCrece';

/**
 * Cuándo es un dato: un año (a 1 de enero, en el censo), dos años comparados o los 12 meses del Observatori, ya en el
 * idioma del informe.
 */
export type CuandoDelDato = { anio: string } | { desde: string; hasta: string } | { periodo: string };

/**
 * Un dato del grupo y el mismo de todas las ocupaciones de Cataluña, en %. Las variaciones (`crece`) pueden ser
 * negativas; el resto va de 0 a 100.
 */
export interface FilaComparada {
  dato: DatoComparado;
  cuando: CuandoDelDato;
  grupo: number;
  conjunto: number;
  /**
   * Nombre oficial del grupo del que es la cifra, en el idioma del informe si hay traducción, cuando no es el que
   * nombra el bloque: los contratos del Observatori son de la ocupación CNO-11 de 4 cifras, más estrecha que el grupo
   * del censo, y el Idescat puede publicar otro nivel. La fila lo dice para que cada cifra vaya con su grupo.
   */
  otroGrupo?: string;
}

/** Una pregunta de «Frente al conjunto» con sus filas; solo se enseña si tiene alguna. */
export interface BloqueComparado {
  pregunta: PreguntaComparada;
  filas: FilaComparada[];
}

/** El grupo del censo frente al conjunto de Cataluña; solo con un único grupo (nunca se elige uno por la persona). */
export interface FrenteAlConjunto {
  cno11: string;
  /** Nombre oficial del grupo, en el idioma del informe si hay traducción. */
  grupo: string;
  /** El grupo es el de 2 cifras, más amplio que el de la ocupación, porque del de 3 no hay datos suficientes. */
  amplio: boolean;
  bloques: BloqueComparado[];
}

/** Indicadores de 12 meses de una ocupación CNO-11 de 4 cifras (o de toda Cataluña) en el paquete del Observatori. */
export interface IndicadoresObservatori {
  contratos: number;
  personas_contratadas: number;
  contratos_por_persona: number | null;
  pct_parcial: number | null;
  duracion_media_temporales_dias: number | null;
  demandantes_no_ocupados_12m: number | null;
  demandantes_no_ocupados_media: number | null;
  contratadas_por_demandante: number | null;
}

/** «¿Cuánta gente busca este trabajo?»: personas inscritas sin empleo que buscan un trabajo de la ocupación. */
export interface Demandantes {
  enLos12Meses: number;
  mediaMensual: number;
  contratadasPorDemandante: number | null;
}

/** «¿Qué contratos se firman?»: contratos, jornada parcial y duración de los temporales, con los de Cataluña. */
export interface ContratosFirmados {
  contratos: number;
  personas: number;
  porPersona: number | null;
  porPersonaConjunto: number | null;
  pctParcial: number | null;
  pctParcialConjunto: number | null;
  diasTemporales: number | null;
  diasTemporalesConjunto: number | null;
}

/** Los tramos de antigüedad en la empresa que da la Encuesta de Estructura Salarial, de menos a más años. */
export type TramoDeAntiguedad = 'menosDe1' | 'de1a3' | 'de4a10' | 'de11a20' | 'de21a29' | 'de30oMas';

/** El salario medio bruto anual (€) de un tramo de antigüedad. */
interface TramoConSalario {
  tramo: TramoDeAntiguedad;
  euros: number;
}

/** «¿Y con los años?»: salario medio bruto anual del gran grupo según los años en la misma empresa. */
export interface SalarioPorAntiguedad {
  anio: number;
  granGrupo: string;
  titulo: string;
  tramos: TramoConSalario[];
}

/** Lo que responde «Información adicional»; cada parte es null si no se enseña. */
export interface InformacionAdicional {
  /** La ocupación CNO-11 de 4 cifras de los datos del Observatori (null si no hay ninguna parte del Observatori). */
  cno11: string | null;
  grupo: string | null;
  /** Los 12 meses de los datos del Observatori, en el idioma del informe. */
  periodo: string | null;
  demandantes: Demandantes | null;
  contratos: ContratosFirmados | null;
  antiguedad: SalarioPorAntiguedad | null;
}
