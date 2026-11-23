/**
 * El cuestionario del piloto: sus preguntas cerradas, los valores que admite cada una y la meta del piloto que mide
 * cada pregunta. Es la única fuente de las celdas del almacén y de los indicadores que recibe el
 * panel, así que el panel no tiene que adivinar qué respuestas cuentan ni sobre qué base. docs/encuesta.md
 * explica cada fórmula.
 */

/** El cuestionario vigente. Las celdas del almacén son de un solo cuestionario: nunca se suman respuestas de dos. */
export const CUESTIONARIO = 'faro-piloto-2';
export const TIPOS_DE_CODIGO = ['participante', 'profesional'] as const;
export type TipoDeCodigo = (typeof TIPOS_DE_CODIGO)[number];

/** La escala común de cinco puntos, de «Nada» a «Mucho». Sus puntos llegan como número y se guardan como texto. */
export const ESCALA = ['1', '2', '3', '4', '5'] as const;
/** La pregunta que abre el formulario de las personas: solo quien ha visto su informe contesta las demás. */
export const FILTRO = 'informe';
/** «No he podido llegar a verlo» en el filtro y «No he llegado a ver la propuesta» en la pregunta de formación. */
export const SIN_VER = 'sin_ver';
const VISTO = 'visto';

/**
 * Las preguntas de cada tipo y sus valores admitidos, en el orden en que se presentan y se exportan. Las escalas se
 * guardan como texto («1» a «5») porque cada valor es una celda de recuento; las medias se calculan sobre las celdas.
 */
export const PREGUNTAS = Object.freeze({
  participante: Object.freeze({
    [FILTRO]: [VISTO, SIN_VER],
    ocupacion: ['si', 'en_parte', 'no'],
    comprension: ESCALA,
    formacion: [...ESCALA, SIN_VER],
    dificultad: ['describir_trabajo', 'elegir_tareas', 'entender_informe', 'encontrar_formacion', 'nada'],
  }),
  profesional: Object.freeze({
    ayudaOrientacion: ESCALA,
    explicarCambio: ESCALA,
    encajeFormacion: ESCALA,
    fiabilidad: ESCALA,
    mejora: ['explicacion_informe', 'ocupacion', 'datos_fuentes', 'formacion', 'uso_sesion', 'accesibilidad', 'nada'],
  }),
} as const satisfies Record<TipoDeCodigo, Record<string, readonly string[]>>);

/** El porcentaje de respuestas favorables que fijan las metas del piloto en cada pregunta de las personas. */
const OBJETIVO_PORCENTAJE = 90;
/** La media sobre 5 que fijan las metas del piloto para la utilidad en los servicios de orientación. */
const OBJETIVO_MEDIA = 4;
/** «Bastante» y «Mucho»: los puntos de la escala que las metas del piloto cuentan como favorables. */
const BASTANTE_O_MUCHO: readonly string[] = ['4', '5'];

/**
 * Cómo se mide una meta: la proporción de valores favorables sobre las respuestas de la pregunta, sin contar las que
 * quedan fuera de la base, o la media de la escala.
 */
type DefinicionMeta =
  | { readonly criterio: 'proporcion'; readonly favorables: readonly string[]; readonly fuera: readonly string[] }
  | { readonly criterio: 'media' };
const METAS: { readonly [T in TipoDeCodigo]: Partial<Record<keyof (typeof PREGUNTAS)[T], DefinicionMeta>> } = {
  participante: {
    ocupacion: { criterio: 'proporcion', favorables: ['si'], fuera: [] },
    comprension: { criterio: 'proporcion', favorables: BASTANTE_O_MUCHO, fuera: [] },
    // Quien no llegó a ver la propuesta de formación no puede valorarla: se informa aparte y sale de la base.
    formacion: { criterio: 'proporcion', favorables: BASTANTE_O_MUCHO, fuera: [SIN_VER] },
  },
  profesional: {
    ayudaOrientacion: { criterio: 'media' },
  },
};

/** Las respuestas de una pregunta que caen en la escala y la suma de sus puntos: la media es suma / respuestas. */
export interface EscalaPregunta {
  readonly respuestas: number;
  readonly suma: number;
}
/**
 * La meta de una pregunta con todo lo que hace falta para medirla. En una proporción, el porcentaje es favorables / base
 * y fueraDeLaBase se informa aparte; en una media, se mide sobre la escala de la pregunta. El objetivo va en porcentaje
 * en las proporciones y sobre 5 en las medias.
 */
export type MetaPregunta =
  | {
      readonly criterio: 'proporcion';
      readonly favorables: number;
      readonly base: number;
      readonly fueraDeLaBase: number;
      readonly objetivo: number;
    }
  | { readonly criterio: 'media'; readonly objetivo: number };
export interface ResumenPregunta {
  readonly escala: EscalaPregunta | null;
  readonly meta: MetaPregunta | null;
}

/** Si un valor es un punto de la escala: esos llegan como número; todos los demás, como texto. */
export function esPuntoDeEscala(valor: string): boolean {
  return (ESCALA as readonly string[]).includes(valor);
}
/** Cuántas respuestas de la pregunta llevan alguno de estos valores. */
function sumaDe(valores: Readonly<Record<string, number>>, elegidos: readonly string[]): number {
  return elegidos.reduce((suma, valor) => suma + (valores[valor] ?? 0), 0);
}
function escalaDe(admitidos: readonly string[], valores: Readonly<Record<string, number>>): EscalaPregunta | null {
  if (!ESCALA.every((punto) => admitidos.includes(punto))) {
    return null;
  }
  return {
    respuestas: sumaDe(valores, ESCALA),
    suma: ESCALA.reduce((suma, punto) => suma + Number(punto) * (valores[punto] ?? 0), 0),
  };
}
function metaDe(
  definicion: DefinicionMeta | undefined,
  valores: Readonly<Record<string, number>>,
): MetaPregunta | null {
  if (definicion === undefined) {
    return null;
  }
  if (definicion.criterio === 'media') {
    return { criterio: 'media', objetivo: OBJETIVO_MEDIA };
  }
  const respondidas = sumaDe(valores, Object.keys(valores));
  const fueraDeLaBase = sumaDe(valores, definicion.fuera);
  return {
    criterio: 'proporcion',
    favorables: sumaDe(valores, definicion.favorables),
    base: respondidas - fueraDeLaBase,
    fueraDeLaBase,
    objetivo: OBJETIVO_PORCENTAJE,
  };
}
/** La escala y la meta de una pregunta, calculadas solo con los recuentos de sus celdas. */
export function resumenDe(
  tipo: TipoDeCodigo,
  pregunta: string,
  valores: Readonly<Record<string, number>>,
): ResumenPregunta {
  const admitidos: readonly string[] = (PREGUNTAS[tipo] as Readonly<Record<string, readonly string[]>>)[pregunta] ?? [];
  const metas: Readonly<Record<string, DefinicionMeta | undefined>> = METAS[tipo];
  return { escala: escalaDe(admitidos, valores), meta: metaDe(metas[pregunta], valores) };
}
