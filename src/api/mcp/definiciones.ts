// Definiciones públicas MCP y socios, sin los ejecutores de sus consultas.

import type { Esquema } from '../../comun/esquema.ts';
import { MAX_BUSQUEDA } from '../../seguridad/limites.ts';
import { PATRON_OCUPACION_ESCO } from '../esquemas.ts';
import {
  ESQUEMA_CATALOGO_DATOS_GLOBALES,
  ESQUEMA_CONSULTAR_DATOS_GLOBALES,
  ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES,
  ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES,
} from '../esquemas-datos-globales.ts';
import { ESQUEMA_CONSULTA_FORMACION, type EsquemaDeSalida } from '../esquemas-formacion.ts';

/** Un esquema con la descripción que lee el asistente (MCP la publica en `inputSchema`). */
type EsquemaDescrito = Esquema & { description: string };

/** El nombre de la herramienta de búsqueda por palabras: la que usa A2A para un mensaje de solo texto. */
export const HERRAMIENTA_DE_BUSQUEDA = 'buscar_ocupacion';
/** Candidatas que da buscar_ocupacion por defecto y como mucho. */
export const LIMITES_DE_CANDIDATAS = { porDefecto: 6, maximo: 10 } as const;

/** Un grupo de 4 cifras de la CIUO-08 (ISCO-08). */
const ISCO: EsquemaDescrito = {
  type: 'string',
  pattern: '^\\d{4}$',
  description: 'Código de 4 cifras del grupo de la CIUO-08 (ISCO-08), por ejemplo «4224».',
};
/** Una ocupación ESCO de ese grupo, opcional: afina la formación, la acreditación y el contexto. */
const ESCO: EsquemaDescrito = {
  type: 'string',
  pattern: PATRON_OCUPACION_ESCO,
  description: 'Código opcional de una ocupación ESCO del mismo grupo, por ejemplo «4224.1».',
};
/** El texto que busca buscar_ocupacion. */
const TEXTO_DE_BUSQUEDA: EsquemaDescrito = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_BUSQUEDA,
  description: 'Nombre del trabajo en castellano o catalán, por ejemplo «recepcionista de hotel».',
};
/** Cuántas candidatas devuelve buscar_ocupacion. */
const MAXIMO_DE_CANDIDATAS: EsquemaDescrito = {
  type: 'integer',
  minimum: 1,
  maximum: LIMITES_DE_CANDIDATAS.maximo,
  description: `Cuántas candidatas devolver (por defecto, ${LIMITES_DE_CANDIDATAS.porDefecto}).`,
};
/** El grupo padre que recorre explorar_grupos. */
const PADRE: EsquemaDescrito = {
  type: 'string',
  pattern: '^\\d{0,3}$',
  description: 'Código del grupo padre, de 0 a 3 cifras, por ejemplo «42».',
};
/** Esquema de las herramientas que reciben un grupo y, si se quiere, una ocupación ESCO. */
const GRUPO_Y_OCUPACION: Esquema = {
  type: 'object',
  properties: { isco: ISCO, esco: ESCO },
  required: ['isco'],
  additionalProperties: false,
};

/** Anotaciones de todas: solo leen, no cambian nada, repetir da lo mismo y no salen a internet. */
const SOLO_LECTURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Una herramienta tal como se lista en `tools/list`, con sus anotaciones de solo lectura. */
export interface DefinicionDeHerramienta {
  name: string;
  title: string;
  description: string;
  inputSchema: Esquema;
  outputSchema?: EsquemaDeSalida;
  annotations: { title: string } & typeof SOLO_LECTURA;
}

/** Lecturas del mismo paquete global para MCP, A2A y socios, sin llamadas a modelos ni nuevas cifras. */
export const HERRAMIENTAS_DATOS_GLOBALES: readonly Omit<DefinicionDeHerramienta, 'annotations'>[] = [
  {
    name: 'catalogo_datos_globales',
    title: 'Catálogo de datos globales',
    description:
      'Lista territorios o fichas completas de una familia del paquete de Cataluña, la UE y países, sin sus listas de cifras. Conserva el orden, los nombres y metadatos originales, incluidos definición, naturaleza, fuente y licencia cuando existen. Sección obligatoria; desplazamiento por defecto 0 y máximo por defecto 5, hasta 5. Usa los identificadores publicados para consultar una ficha.',
    inputSchema: ESQUEMA_CATALOGO_DATOS_GLOBALES,
    outputSchema: ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES,
  },
  {
    name: 'consultar_datos_globales',
    title: 'Consultar una ficha de datos globales',
    description:
      'Devuelve los metadatos íntegros de una ficha del paquete global y sus cifras de un territorio, con año y notas, sin inventar datos. Para indicadores, recuentos, encuestas y calculados exige territorio y admite año, desplazamiento (por defecto 0) y máximo (por defecto 20, hasta 20). Para metas recibe solo sección e id: devuelve la norma completa, territorio null y valores vacíos; la meta no es una cifra observada. Mantén la distinción entre medidas, opiniones y cálculos de Faro, incluidas licencias, intervalos y cotas. Una combinación válida sin cifra devuelve valores vacíos, nunca cero inventado.',
    inputSchema: ESQUEMA_CONSULTAR_DATOS_GLOBALES,
    outputSchema: ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES,
  },
];

/** Las herramientas, en el orden fijo en que se listan (la especificación pide un orden estable). */
export const HERRAMIENTAS: readonly Omit<DefinicionDeHerramienta, 'annotations'>[] = [
  {
    name: HERRAMIENTA_DE_BUSQUEDA,
    title: 'Buscar una ocupación',
    description:
      'Busca ocupaciones oficiales (ESCO) parecidas a un texto, por palabras y sin llamadas a modelos durante la consulta, con su grupo de la CIUO-08 y tres tareas oficiales para distinguirlas. Antes de buscar, Faro retira los datos personales que reconoce su filtro. No envíes datos personales en las consultas. Úsala para encontrar el código del grupo; luego confirma el grupo con la persona.',
    inputSchema: {
      type: 'object',
      properties: { texto: TEXTO_DE_BUSQUEDA, maximo: MAXIMO_DE_CANDIDATAS },
      required: ['texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'explorar_grupos',
    title: 'Explorar la clasificación de ocupaciones',
    description:
      'Recorre la jerarquía oficial de la CIUO-08 (ISCO-08): sin «padre», los diez grandes grupos; con un código de 1 a 3 cifras, sus grupos hijos, con cuántas ocupaciones ESCO tiene cada uno.',
    inputSchema: {
      type: 'object',
      properties: { padre: PADRE },
      additionalProperties: false,
    },
  },
  {
    name: 'ficha_grupo',
    title: 'Tareas oficiales y exposición a la IA de un grupo',
    description:
      'La ficha de un grupo de 4 cifras de la CIUO-08: sus tareas oficiales con la nota de exposición a la IA generativa de cada una según la OIT (0 a 1), la media del grupo y sus ocupaciones ESCO.',
    inputSchema: { type: 'object', properties: { isco: ISCO }, required: ['isco'], additionalProperties: false },
  },
  {
    name: 'formacion_oficial',
    outputSchema: ESQUEMA_CONSULTA_FORMACION,
    title: 'Formación oficial en Cataluña',
    description:
      'La formación oficial relacionada con un grupo (o una ocupación ESCO del grupo): especialidades del SEPE, cursos abiertos del SOC y ediciones del Consorci para personas que trabajan, con sus fechas.',
    inputSchema: GRUPO_Y_OCUPACION,
  },
  {
    name: 'acreditacion_competencias',
    title: 'Acreditar lo que ya se sabe hacer',
    description:
      'Los certificados de profesionalidad relacionados con un grupo (o una ocupación ESCO del grupo) y cómo se pide en Cataluña la acreditación de la experiencia laboral, con su fuente y la fecha de comprobación.',
    inputSchema: GRUPO_Y_OCUPACION,
  },
  {
    name: 'contexto_del_grupo',
    title: 'El grupo en Cataluña: personas, contratos y salarios',
    description:
      'Cifras oficiales del grupo en Cataluña: personas ocupadas, contratos, perfil (estudios y situación), salario medio por estudios y uso declarado de la IA generativa en el trabajo, cada una con su fuente y su año.',
    inputSchema: GRUPO_Y_OCUPACION,
  },
  ...HERRAMIENTAS_DATOS_GLOBALES,
];

/** La lista pública de las herramientas, sin cómo se atienden: solo depende de constantes del módulo. */
const DEFINICIONES: readonly DefinicionDeHerramienta[] = HERRAMIENTAS.map(
  ({ name, title, description, inputSchema, outputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    annotations: { title, ...SOLO_LECTURA },
  }),
);

/**
 * La lista pública de las herramientas, sin cómo se atienden. La lista es la misma en cada llamada: quien la recibe no
 * la modifica.
 *
 * @returns Cada herramienta con su nombre, título, descripción, esquema de entrada y anotaciones de solo lectura.
 */
export function definiciones(): readonly DefinicionDeHerramienta[] {
  return DEFINICIONES;
}
