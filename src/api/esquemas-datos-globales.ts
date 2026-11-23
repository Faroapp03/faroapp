// Entradas compartidas y salidas JSON Schema 2020-12 de las consultas de datos globales.
// Las condiciones entre campos (metas frente a series territoriales) las comprueba la consulta, no el validador parcial.

import type { Esquema } from '../comun/esquema.ts';
import type { EsquemaDeSalida } from './esquemas-formacion.ts';

/** Familias de fichas del paquete global; las metas se consultan sin territorio. */
export const SECCIONES_GLOBALES = ['indicadores', 'recuentos', 'metas', 'encuestas', 'calculados'] as const;
/** El catálogo incluye además los descriptores de territorios. */
export const SECCIONES_CATALOGO_GLOBAL = ['territorios', ...SECCIONES_GLOBALES] as const;
/** Fichas completas por página, sin sus listas de cifras. */
export const MAX_CATALOGO_GLOBAL = 5;
/** Cifras por página de una serie territorial. */
export const MAX_SERIE_GLOBAL = 20;

const DESPLAZAMIENTO: Esquema = { type: 'integer', minimum: 0 };
/** Catálogo en el orden del paquete; ausencia de máximo significa cinco y de desplazamiento, cero. */
export const ESQUEMA_CATALOGO_DATOS_GLOBALES: Esquema = {
  type: 'object',
  required: ['seccion'],
  properties: {
    seccion: { type: 'string', enum: SECCIONES_CATALOGO_GLOBAL },
    desplazamiento: DESPLAZAMIENTO,
    maximo: { type: 'integer', minimum: 1, maximum: MAX_CATALOGO_GLOBAL },
  },
  additionalProperties: false,
};

/** Las metas reciben solo sección e id; las estadísticas exigen territorio y admiten año y paginación. */
export const ESQUEMA_CONSULTAR_DATOS_GLOBALES: Esquema = {
  type: 'object',
  required: ['seccion', 'id'],
  properties: {
    seccion: { type: 'string', enum: SECCIONES_GLOBALES },
    id: { type: 'string', minLength: 1 },
    territorio: { type: 'string', minLength: 1 },
    anio: { type: 'integer' },
    desplazamiento: DESPLAZAMIENTO,
    maximo: { type: 'integer', minimum: 1, maximum: MAX_SERIE_GLOBAL },
  },
  additionalProperties: false,
};

const TEXTO: EsquemaDeSalida = { type: 'string' };
const TEXTO_O_NULO: EsquemaDeSalida = { type: ['string', 'null'] };
const EN_DOS_IDIOMAS: EsquemaDeSalida = {
  type: 'object',
  required: ['es', 'ca'],
  properties: { es: TEXTO, ca: TEXTO },
  additionalProperties: false,
};
const TERRITORIO: EsquemaDeSalida = {
  type: 'object',
  required: ['codigo', 'iso3', 'tipo', 'nombre'],
  properties: {
    codigo: TEXTO,
    iso3: TEXTO_O_NULO,
    tipo: { type: 'string', enum: ['region', 'pais', 'agregado'] },
    nombre: EN_DOS_IDIOMAS,
  },
  additionalProperties: false,
};
const METADATOS = {
  id: TEXTO,
  nombre: EN_DOS_IDIOMAS,
  definicion: EN_DOS_IDIOMAS,
  unidad: TEXTO,
  fuente: TEXTO,
  tabla: TEXTO_O_NULO,
  licencia: TEXTO,
  url: TEXTO,
  comparable: { type: 'boolean' },
  cobertura: { type: 'string', enum: ['ue', 'mundo', 'cataluna'] },
} satisfies Record<string, EsquemaDeSalida>;
const CABECERA_REQUERIDA = ['id', 'nombre', 'unidad', 'naturaleza', 'fuente', 'tabla', 'url'];
const METADATOS_REQUERIDOS = [...CABECERA_REQUERIDA, 'definicion', 'licencia', 'comparable', 'cobertura'];
const INDICADOR: EsquemaDeSalida = {
  type: 'object',
  required: METADATOS_REQUERIDOS,
  properties: { ...METADATOS, unidad: { enum: ['porcentaje'] }, naturaleza: { enum: ['medido', 'estimado'] } },
  additionalProperties: false,
};
const RECUENTO: EsquemaDeSalida = {
  type: 'object',
  required: CABECERA_REQUERIDA,
  properties: { ...METADATOS, unidad: { enum: ['miles de personas'] }, naturaleza: { enum: ['medido', 'estimado'] } },
  additionalProperties: false,
};
const ENCUESTA: EsquemaDeSalida = {
  type: 'object',
  required: [...CABECERA_REQUERIDA, 'pregunta'],
  properties: {
    ...METADATOS,
    unidad: { enum: ['porcentaje'] },
    naturaleza: { enum: ['opinion'] },
    pregunta: TEXTO,
    respuesta: TEXTO,
    base: TEXTO,
    campo: TEXTO,
  },
  additionalProperties: false,
};
const CALCULADO: EsquemaDeSalida = {
  type: 'object',
  required: METADATOS_REQUERIDOS,
  properties: {
    ...METADATOS,
    unidad: { enum: ['porcentaje'] },
    naturaleza: { enum: ['calculado'] },
    cobertura: { enum: ['mundo'] },
  },
  additionalProperties: false,
};
const META: EsquemaDeSalida = {
  type: 'object',
  required: ['id', 'nombre', 'norma', 'articulo', 'texto', 'valor', 'unidad', 'anio', 'indicador', 'nota', 'url'],
  properties: {
    id: TEXTO,
    nombre: EN_DOS_IDIOMAS,
    norma: TEXTO,
    articulo: TEXTO,
    texto: TEXTO,
    valor: { type: 'number' },
    unidad: TEXTO,
    anio: { type: 'integer' },
    indicador: TEXTO,
    nota: { oneOf: [EN_DOS_IDIOMAS, { type: 'null' }] },
    url: TEXTO,
  },
  additionalProperties: false,
  description: 'Objetivo normativo: valor y año son la meta, no una observación estadística.',
};
const CIFRA: EsquemaDeSalida = {
  type: 'object',
  required: ['territorio', 'valor', 'anio', 'nota'],
  properties: { territorio: TEXTO, valor: { type: 'number' }, anio: { type: 'integer' }, nota: TEXTO_O_NULO },
  additionalProperties: false,
};
const VALOR: EsquemaDeSalida = {
  type: 'object',
  required: ['indicador', 'valor', 'anio', 'nota'],
  properties: { indicador: TEXTO, valor: { type: 'number' }, anio: { type: 'integer' }, nota: TEXTO_O_NULO },
  additionalProperties: false,
};
const INTERVALO: EsquemaDeSalida = {
  type: 'object',
  required: ['desde', 'hasta', 'metodo'],
  properties: {
    desde: { type: 'number' },
    hasta: { type: 'number' },
    metodo: { enum: ['replicas_bootstrap', 'linealizacion_taylor', 'linealizacion_taylor_aproximada'] },
  },
  additionalProperties: false,
};
const COTAS: EsquemaDeSalida = {
  type: 'object',
  required: ['inferior', 'superior', 'motivo', 'parte_sin_correspondencia'],
  properties: {
    inferior: { type: 'number' },
    superior: { type: 'number' },
    motivo: { enum: ['sin_correspondencia_4_digitos'] },
    parte_sin_correspondencia: { type: 'number' },
  },
  additionalProperties: false,
};
const CIFRA_CALCULADA: EsquemaDeSalida = {
  type: 'object',
  required: ['territorio', 'nombre', 'valor', 'intervalo', 'cotas', 'anio', 'encuesta', 'licencia', 'cita', 'url'],
  properties: {
    territorio: TEXTO,
    nombre: EN_DOS_IDIOMAS,
    valor: { type: ['number', 'null'] },
    intervalo: INTERVALO,
    cotas: { oneOf: [COTAS, { type: 'null' }] },
    anio: { type: 'integer' },
    encuesta: TEXTO,
    licencia: TEXTO,
    cita: TEXTO,
    url: TEXTO,
  },
  additionalProperties: false,
};
const PROCEDENCIA: EsquemaDeSalida = {
  type: 'object',
  required: ['fuentes', 'oficial', 'deFaro', 'faro'],
  properties: {
    fuentes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['cita', 'nivel', 'licencia'],
        properties: { cita: TEXTO, nivel: { enum: ['oficial', 'complementaria', 'faro'] }, licencia: TEXTO },
        additionalProperties: false,
      },
    },
    oficial: TEXTO,
    deFaro: TEXTO,
    faro: TEXTO,
  },
  additionalProperties: false,
};
const PAGINA = {
  version: TEXTO,
  generado: TEXTO,
  total: { type: 'integer', minimum: 0 },
  desplazamiento: DESPLAZAMIENTO,
  siguiente: { type: ['integer', 'null'], minimum: 0 },
  procedencia: PROCEDENCIA,
} satisfies Record<string, EsquemaDeSalida>;

/** Catálogo de fichas completas, sin listas de valores, en el orden del paquete. */
export const ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES: EsquemaDeSalida = {
  type: 'object',
  required: ['version', 'generado', 'seccion', 'total', 'desplazamiento', 'siguiente', 'elementos', 'procedencia'],
  properties: {
    ...PAGINA,
    seccion: { enum: SECCIONES_CATALOGO_GLOBAL },
    elementos: {
      type: 'array',
      maxItems: MAX_CATALOGO_GLOBAL,
      items: { oneOf: [TERRITORIO, INDICADOR, RECUENTO, META, ENCUESTA, CALCULADO] },
    },
  },
  additionalProperties: false,
};

/** La ficha conserva metadatos; las cifras territoriales se paginan aparte. Una meta nunca inventa una serie. */
export const ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES: EsquemaDeSalida = {
  type: 'object',
  required: [
    'version',
    'generado',
    'seccion',
    'ficha',
    'territorio',
    'valores',
    'total',
    'desplazamiento',
    'siguiente',
    'procedencia',
  ],
  properties: {
    ...PAGINA,
    seccion: { enum: SECCIONES_GLOBALES },
    ficha: { oneOf: [INDICADOR, RECUENTO, META, ENCUESTA, CALCULADO] },
    territorio: { oneOf: [TERRITORIO, { type: 'null' }] },
    valores: { type: 'array', maxItems: MAX_SERIE_GLOBAL, items: { oneOf: [VALOR, CIFRA, CIFRA_CALCULADA] } },
  },
  additionalProperties: false,
  oneOf: [
    {
      properties: {
        seccion: { enum: ['metas'] },
        ficha: META,
        territorio: { type: 'null' },
        valores: { maxItems: 0 },
        total: { enum: [0] },
        desplazamiento: { enum: [0] },
        siguiente: { type: 'null' },
      },
    },
    {
      properties: {
        seccion: { enum: ['indicadores'] },
        ficha: INDICADOR,
        territorio: TERRITORIO,
        valores: { items: VALOR },
      },
    },
    {
      properties: {
        seccion: { enum: ['recuentos'] },
        ficha: RECUENTO,
        territorio: TERRITORIO,
        valores: { items: CIFRA },
      },
    },
    {
      properties: {
        seccion: { enum: ['encuestas'] },
        ficha: ENCUESTA,
        territorio: TERRITORIO,
        valores: { items: CIFRA },
      },
    },
    {
      properties: {
        seccion: { enum: ['calculados'] },
        ficha: CALCULADO,
        territorio: TERRITORIO,
        valores: { items: CIFRA_CALCULADA },
      },
    },
  ],
};
