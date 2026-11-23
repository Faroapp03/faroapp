// Esquemas de los cuerpos POST: rechazan campos desconocidos y acotan textos y listas. Son metadatos compartidos
// por el contrato y sus consumidores; no atienden peticiones. GET, MCP y A2A tienen sus propios esquemas.

import type { EsquemaDe } from '../comun/esquema.ts';
import { IDIOMAS, type Idioma } from '../comun/idioma.ts';
import { MAX_FRASE } from '../comun/limites-frases.ts';
import { MAX_OCUPACION_PERSONA, MAX_TAREAS_INFORME } from '../comun/protocolo-web.ts';
import type { Entrada, TareaEntrada, Tiempo } from '../dominio/tipos-entrada.ts';
import { MAX_RELATO, MAX_TAREA, MIN_TAREA } from '../seguridad/limites.ts';

/**
 * Los valores de una unión de textos `T`, todos y ni uno más: si el tipo del dominio gana o pierde un valor y la lista
 * no, el compilador falla. Así el `enum` de un esquema no se queda atrás del tipo que describe.
 *
 * @returns Una función que devuelve la lista que recibe, comprobada.
 */
function valoresDe<T extends string>(): <const L extends readonly T[]>(
  valores: L & ([Exclude<T, L[number]>] extends [never] ? unknown : { faltan: Exclude<T, L[number]> }),
) => L {
  return (valores) => valores;
}

/** Cuánto tiempo dedica la persona a una tarea: los valores de Tiempo. */
const TIEMPOS = valoresDe<Tiempo>()(['mucho', 'algo', 'poco']);
/** En qué referencias se basa una estimación: todos los valores que admite la entrada. */
const BASES = valoresDe<BaseDeLaEstimacion>()(['ocupacion', 'subgrupo', 'oit']);
/** El origen de una estimación que admite la API: solo las de Faro, nunca «ejemplo». */
const ORIGENES_ADMITIDOS = ['faro', 'faro-sin-validar'] as const satisfies readonly OrigenDeEstimacion[];
/** La relación con la tarea oficial que admite la API: solo «propia» (ver ESQUEMA_INFORME). */
const RELACIONES_ADMITIDAS = ['propia'] as const satisfies readonly RelacionConLaOficial[];

/**
 * Un código de ocupación ESCO: el grupo ISCO-08 de 4 cifras y de 1 a 4 tramos de 1 a 3 cifras («4226.1», «2654.1.7»).
 * Un grupo sin tramo no es una ocupación ESCO. La API REST y el servidor MCP validan con este mismo patrón.
 */
export const PATRON_OCUPACION_ESCO = '^\\d{4}(\\.\\d{1,3}){1,4}$';

/** Un código de ocupación ESCO con la forma de PATRON_OCUPACION_ESCO. */
const OCUPACION_ESCO = { type: 'string', pattern: PATRON_OCUPACION_ESCO };
/**
 * Grupo ISCO-08 de 4 cifras. El esquema solo mira la forma: que exista y que cuadre con la ocupación
 * ESCO requiere una comprobación del dominio además de este esquema de forma.
 */
const GRUPO_ISCO = { type: 'string', pattern: '^\\d{4}$' };
/** El identificador de una tarea oficial: el grupo ISCO-08 y su número («2654-3»). */
const TAREA_OIT = { type: 'string', pattern: '^\\d{4}-\\d{1,2}$' };
/** El texto de una tarea escrito por la persona, entre MIN_TAREA y MAX_TAREA caracteres. */
const TEXTO_TAREA = { type: 'string', minLength: MIN_TAREA, maxLength: MAX_TAREA };
/** «La IA podría» o «Lo tuyo»: una frase corta, con el máximo compartido del informe. */
const FRASE = { type: 'string', minLength: 1, maxLength: MAX_FRASE };
/** Una nota o un extremo de margen: un número de 0 a 1. */
const NOTA = { type: 'number', minimum: 0, maximum: 1 };

/** El origen de una estimación en el dominio. */
type OrigenDeEstimacion = NonNullable<TareaEntrada['estimacion']>['origen'];
/** En qué referencias se basa una estimación, en la entrada del dominio. */
type BaseDeLaEstimacion = NonNullable<NonNullable<TareaEntrada['estimacion']>['referencias']>;
/** La relación de una tarea con su referencia oficial en el dominio. */
type RelacionConLaOficial = NonNullable<TareaEntrada['referencia']>['relacion'];

/** Tareas que admite un informe como máximo. La web toma la misma definición de comun/protocolo-web.ts. */
export { MAX_TAREAS_INFORME } from '../comun/protocolo-web.ts';

/** Máximo de caracteres de una firma: ella mide 66 («kid.caducidad.hmac», seguridad/firma.ts); el resto es holgura. */
const MAX_FIRMA_CARACTERES = 80;
/** Una firma de estimación; su forma la comprueba seguridad/firma.ts al verificarla. */
const FIRMA = { type: 'string', maxLength: MAX_FIRMA_CARACTERES };
/** Máximo de caracteres del identificador de una tarea del informe. */
const MAX_ID_TAREA_CARACTERES = 40;
/** Forma de la fecha del informe: AAAA-MM-DD del siglo XXI; no valida el calendario (mes 13 pasa). */
const FECHA_DEL_INFORME = '^20\\d{2}-\\d{2}-\\d{2}$';
/**
 * El idioma de la respuesta: «es» o «ca». Opcional: sin él, la respuesta va en castellano. Cualquier otro valor es un
 * 400.
 */
const IDIOMA = { type: 'string', enum: [...IDIOMAS] };

/** Solo estimaciones emitidas y firmadas por Faro: con su firma, sin «ejemplo» ni competencias añadidas. */
const ESTIMACION_FIRMADA = {
  type: 'object',
  additionalProperties: false,
  required: ['valor', 'margen', 'origen', 'firma'],
  properties: {
    valor: NOTA,
    margen: { type: 'array', minItems: 2, maxItems: 2, items: NOTA },
    origen: { type: 'string', enum: [...ORIGENES_ADMITIDOS] },
    referencias: { type: 'string', enum: [...BASES] },
    incierta: { type: 'boolean' },
    referenciaCercana: TAREA_OIT,
    iaPodria: FRASE,
    loTuyo: FRASE,
    firma: FIRMA,
  },
};

/**
 * POST /api/informe, en el motor del dispositivo: la ocupación (el grupo, la ocupación ESCO o los dos), la fecha y
 * las tareas confirmadas por la persona; opcionalmente, un segundo grupo, la palabra con que nombró su trabajo
 * (también con ocupación ESCO), si el grupo lo propuso la IA y el idioma del informe.
 */
export const ESQUEMA_INFORME: EsquemaDe<Entrada & { idioma?: Idioma }> = {
  type: 'object',
  additionalProperties: false,
  required: ['tareas', 'fecha'],
  properties: {
    ocupacionEsco: OCUPACION_ESCO,
    isco08: GRUPO_ISCO,
    isco08Secundario: GRUPO_ISCO,
    ocupacionPersona: { type: 'string', minLength: 1, maxLength: MAX_OCUPACION_PERSONA },
    grupoPropuestoPorIa: { type: 'boolean' },
    sinIa: { type: 'boolean' },
    idioma: IDIOMA,
    fecha: { type: 'string', pattern: FECHA_DEL_INFORME },
    tareas: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_TAREAS_INFORME,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'texto', 'tiempo'],
        properties: {
          id: { type: 'string', pattern: `^[A-Za-z0-9_-]{1,${MAX_ID_TAREA_CARACTERES}}$` },
          texto: TEXTO_TAREA,
          tiempo: { type: 'string', enum: [...TIEMPOS] },
          // Solo «propia»: la tarea oficial de su ocupación, cuya pertenencia comprueba el dominio. El dominio admite
          // también «equivalente» (de otra ocupación) para casos internos, pero por la API permitiría poner en un
          // informe la nota oficial de otra ocupación sin ninguna firma que lo respalde.
          referencia: {
            type: 'object',
            additionalProperties: false,
            required: ['tareaOit', 'relacion'],
            properties: { tareaOit: TAREA_OIT, relacion: { type: 'string', enum: [...RELACIONES_ADMITIDAS] } },
          },
          estimacion: ESTIMACION_FIRMADA,
        },
      },
    },
  },
};

/**
 * POST /api/clasificar, en el motor del dispositivo: lo que la persona dice de su trabajo, con el máximo de un relato
 * sin recortar (MAX_RELATO), y el idioma en que se quiere la pregunta.
 */
export const ESQUEMA_CLASIFICAR: EsquemaDe<{ texto: string; idioma?: Idioma }> = {
  type: 'object',
  additionalProperties: false,
  required: ['texto'],
  properties: { texto: { type: 'string', maxLength: MAX_RELATO }, idioma: IDIOMA },
};
