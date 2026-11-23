// Salidas de formación compartidas por OpenAPI y las definiciones MCP. JSON Schema 2020-12: el validador de entradas
// (comun/esquema.ts) solo entiende su subconjunto y no debe validar estas salidas con oneOf.

import type { Correspondencia, EspecialidadRelacionada } from '../../motores/cursos/src/index.ts';
import type { Esquema } from '../comun/esquema.ts';

/** JSON Schema de salida, con alternativas que el contrato de entrada no necesita. */
export interface EsquemaDeSalida extends Omit<Esquema, 'properties' | 'items'> {
  description?: string;
  properties?: Record<string, EsquemaDeSalida>;
  items?: EsquemaDeSalida;
  oneOf?: readonly EsquemaDeSalida[];
  not?: EsquemaDeSalida;
}

/** Enum completo de una unión de textos: si cambia el tipo, debe cambiar su descripción pública. */
function valoresDe<T extends string>(): <const L extends readonly T[]>(
  valores: L & ([Exclude<T, L[number]>] extends [never] ? unknown : { faltan: Exclude<T, L[number]> }),
) => L {
  return (valores) => valores;
}

const CORRESPONDENCIAS = valoresDe<Correspondencia>()(['exacta', 'cercana', 'amplia', 'estrecha']);
const RELACIONES_OFICIALES = valoresDe<Exclude<EspecialidadRelacionada['relacion'], 'sugerencia'>>()([
  'ocupacion',
  'incluye',
  'grupo',
  'variante',
]);
const PROGRAMA: EsquemaDeSalida = {
  type: ['object', 'null'],
  required: ['enlace', 'comprobado'],
  properties: { enlace: { type: 'string' }, comprobado: { type: 'string' } },
};

/** Especialidad SEPE: una sugerencia de Faro no declara una correspondencia oficial EURES. */
export const ESQUEMA_ESPECIALIDAD_RELACIONADA: EsquemaDeSalida = {
  type: 'object',
  required: ['codigo', 'nombre', 'nivel', 'horas', 'familia', 'modalidad', 'programa', 'relacion', 'correspondencia'],
  properties: {
    codigo: { type: 'string' },
    nombre: { type: 'string' },
    nivel: { type: 'string' },
    horas: { type: 'string' },
    familia: { type: 'string' },
    modalidad: { type: 'string' },
    programa: PROGRAMA,
    relacion: { type: 'string', enum: [...RELACIONES_OFICIALES, 'sugerencia'] },
    ocupacionOficial: { type: 'string' },
    parecido: { type: 'number' },
    correspondencia: {
      type: ['string', 'null'],
      enum: [...CORRESPONDENCIAS, null],
      description: 'Correspondencia EURES de una relación oficial; null cuando Faro propone una sugerencia.',
    },
  },
  oneOf: [
    { properties: { relacion: { enum: ['sugerencia'] }, correspondencia: { type: 'null' } } },
    { properties: { relacion: { enum: RELACIONES_OFICIALES }, correspondencia: { enum: CORRESPONDENCIAS } } },
  ],
};

/** Bloque de formación del informe; null cuando el paquete no trae la formación oficial. */
export const ESQUEMA_FORMACION_RELACIONADA: EsquemaDeSalida = {
  type: ['object', 'null'],
  required: ['especialidades', 'totalEspecialidades', 'cursos', 'fechaCursos', 'copiaAntigua', 'fuentes'],
  properties: {
    especialidades: { type: 'array', items: ESQUEMA_ESPECIALIDAD_RELACIONADA },
    totalEspecialidades: { type: 'integer', minimum: 0 },
    cursos: { type: 'array', items: { type: 'object' } },
    fechaCursos: { type: 'string' },
    copiaAntigua: { type: 'boolean' },
    fuentes: { type: 'array', items: { type: 'string' } },
    nivel: { type: 'string', enum: ['grupo'] },
    consorci: { type: 'object' },
  },
};

/** Datos de formacion_oficial en MCP, A2A y socios: listas acotadas o la ausencia explícita de formación. */
export const ESQUEMA_CONSULTA_FORMACION: EsquemaDeSalida = {
  type: 'object',
  required: ['procedencia'],
  properties: {
    formacion: { type: 'null' },
    aviso: { type: 'string' },
    nivel: { type: 'string', enum: ['ocupacion', 'grupo'] },
    especialidades: {
      type: 'object',
      required: ['total', 'mostradas'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        mostradas: { type: 'array', items: ESQUEMA_ESPECIALIDAD_RELACIONADA },
      },
    },
    cursos: { type: 'object' },
    consorci: { type: ['object', 'null'] },
    procedencia: { type: 'object' },
  },
  oneOf: [
    { required: ['formacion', 'aviso'], not: { required: ['especialidades'] } },
    { required: ['nivel', 'especialidades', 'cursos', 'consorci'], not: { required: ['formacion'] } },
  ],
};
