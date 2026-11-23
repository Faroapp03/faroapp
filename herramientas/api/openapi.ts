// Describe la API desde los metadatos compartidos con sus lectores; publica OpenAPI y el protocolo del navegador.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTACTO_PUBLICO } from '../../compartido/contacto-publico.js';
import { FUENTES_DE_CURSOS, OPCIONES_DE_CURSOS } from '../../compartido/contratos/filtros-de-cursos.ts';
import {
  ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES,
  ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES,
} from '../../src/api/esquemas-datos-globales.ts';
import {
  ESQUEMA_CONSULTA_FORMACION,
  ESQUEMA_ESPECIALIDAD_RELACIONADA,
  ESQUEMA_FORMACION_RELACIONADA,
} from '../../src/api/esquemas-formacion.ts';
import { RUTA_ESTADO_CONECTIVIDAD } from '../../src/api/estado-conectividad.ts';
import {
  CABECERA_CONTRATO,
  CABECERA_PETICION,
  CONTRATO_API,
  CONTRATO_SIN_CABECERA,
} from '../../src/api/metadatos-http.ts';
import { PROBLEMAS, RAIZ_DE_LOS_PROBLEMAS, TIPO_PROBLEMA } from '../../src/api/problemas.ts';
import type { Esquema } from '../../src/comun/esquema.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDIOMAS } from '../../src/comun/idioma.ts';
import { VERSION_FARO } from '../../src/comun/version.ts';
import { formatearTextoConBiome } from '../comun/archivos.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import { ESTADO_CONECTIVIDAD } from './openapi-conectividad.ts';
import { ESQUEMA_ERROR_DE_OAUTH, rutasDeSocios, SEGURIDAD_DE_SOCIOS } from './openapi-socios.ts';

export { OPERACIONES_ESPECIALES } from './openapi-conectividad.ts';

/** Último código de la clase de errores del servidor. */
const MAX_ESTADO_DE_ERROR = 599;
const SANGRIA_JSON = 2;

const USO = 'node herramientas/api/openapi.ts [--comprobar]';
/** Dónde se publica el documento, desde la raíz del repositorio. */
export const ARCHIVO_OPENAPI = new URL('../../web/openapi.json', import.meta.url);

type Objeto = Record<string, unknown>;
/** Anotaciones de OpenAPI que acompañan al subconjunto validable de JSON Schema. */
type EsquemaOpenApi = Esquema & { const?: unknown; description?: string };

/** El contenido publicado no coincide con la fuente vigente. */
class PublicacionDesactualizada extends Error {}

/** Una operación de la API: su método, su ruta (con sus parámetros entre llaves) y lo que responde. */
export interface Operacion {
  metodo: 'GET';
  ruta: string;
  resumen: string;
  /** Un camino concreto de la ruta, para comprobarlo contra el patrón del motor (api/api.ts, RUTAS_API). */
  ejemplo: string;
  parametros?: Objeto[];
  respuesta: Esquema;
  errores: readonly number[];
}

/** El parámetro «idioma» de las fichas: el de los textos que devuelve la API. */
const IDIOMA_DE_LA_CONSULTA = {
  name: 'idioma',
  in: 'query',
  required: false,
  description: 'Idioma de los textos. Sin él, castellano; otro que no sea uno de estos, 400.',
  schema: { type: 'string', enum: [...IDIOMAS] },
};
const AVISOS = { type: 'array', items: { type: 'object' }, description: 'Avisos para la persona (dominio/avisos).' };
/** Los errores de las consultas. */
const LECTURA: readonly number[] = [
  ESTADO_HTTP.solicitudIncorrecta,
  ESTADO_HTTP.noEncontrado,
  ESTADO_HTTP.conflicto,
  ESTADO_HTTP.demasiadasPeticiones,
];

/** Un esquema de objeto con sus propiedades y, si las hay, las requeridas. */
function objeto(propiedades: Record<string, EsquemaOpenApi>, requeridas: string[] = []): Esquema {
  return {
    type: 'object',
    ...(requeridas.length ? { required: requeridas } : {}),
    properties: propiedades,
  };
}

/** Las operaciones de la API REST, en el orden de RUTAS_API (api/api.ts). */
export const OPERACIONES: readonly Operacion[] = [
  {
    metodo: 'GET',
    ruta: '/api/salud',
    ejemplo: '/api/salud',
    resumen: 'Estado del servicio: versión e interruptores',
    respuesta: objeto(
      {
        estado: { const: 'ok' },
        version: { type: 'string' },
        interruptores: objeto(
          { formacionAbierta: { type: 'string' }, citilabPago: { type: 'boolean' }, sinConexion: { type: 'boolean' } },
          ['formacionAbierta', 'citilabPago', 'sinConexion'],
        ),
      },
      ['estado', 'version', 'interruptores'],
    ),
    errores: [ESTADO_HTTP.conflicto, ESTADO_HTTP.demasiadasPeticiones],
  },
  {
    metodo: 'GET',
    ruta: '/api/ocupaciones',
    ejemplo: '/api/ocupaciones',
    resumen: 'Busca ocupaciones ESCO por palabras',
    parametros: [
      { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Palabras que buscar.' },
      {
        name: 'todas',
        in: 'query',
        required: false,
        schema: { enum: ['1'] },
        description: 'Todas las coincidencias, con su total y sus grupos. Otro valor: 400.',
      },
    ],
    // Con `todas=1`, también el total y los grupos ISCO-08 de las coincidencias, por código con su título.
    respuesta: objeto(
      {
        total: { type: 'integer', minimum: 0 },
        candidatas: { type: 'array', items: { type: 'object' } },
        grupos: { type: 'object', description: 'El título de cada grupo ISCO-08, una cadena, por su código.' },
      },
      ['candidatas'],
    ),
    errores: LECTURA,
  },
  {
    metodo: 'GET',
    ruta: '/api/ocupaciones/{esco}',
    ejemplo: '/api/ocupaciones/2512.4',
    resumen: 'Ficha de una ocupación ESCO',
    parametros: [
      { name: 'esco', in: 'path', required: true, schema: { type: 'string', pattern: '^[\\d.]+$' } },
      IDIOMA_DE_LA_CONSULTA,
    ],
    respuesta: { type: 'object' },
    errores: LECTURA,
  },
  {
    metodo: 'GET',
    ruta: '/api/grupos',
    ejemplo: '/api/grupos',
    resumen: 'Los grupos de la CIUO-08 que cuelgan de un padre, para explorar',
    parametros: [
      { name: 'padre', in: 'query', required: false, schema: { type: 'string', pattern: '^\\d{0,3}$' } },
      IDIOMA_DE_LA_CONSULTA,
    ],
    respuesta: objeto({ hijos: { type: 'array', items: { type: 'object' } } }),
    errores: LECTURA,
  },
  {
    metodo: 'GET',
    ruta: '/api/grupos/{isco08}',
    ejemplo: '/api/grupos/2512',
    resumen: 'Ficha de un grupo de la CIUO-08',
    parametros: [
      { name: 'isco08', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d+$' } },
      IDIOMA_DE_LA_CONSULTA,
    ],
    respuesta: { type: 'object' },
    errores: LECTURA,
  },
  {
    metodo: 'GET',
    ruta: '/api/cursos',
    ejemplo: '/api/cursos?tema=ia&modalidad=a-distancia',
    resumen: 'Los cursos públicos y gratuitos del día, filtrados, por páginas y con sus recuentos',
    parametros: [
      {
        name: 'q',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Palabras del nombre, la entidad o la familia profesional.',
      },
      { name: 'cuando', in: 'query', required: false, schema: { enum: [...OPCIONES_DE_CURSOS.cuando] } },
      { name: 'modalidad', in: 'query', required: false, schema: { enum: [...OPCIONES_DE_CURSOS.modalidad] } },
      {
        name: 'tema',
        in: 'query',
        required: false,
        schema: { type: 'string', maxLength: 120 },
        description: '«ia» o el nombre de una familia profesional del catálogo del SEPE.',
      },
      { name: 'nivel', in: 'query', required: false, schema: { enum: [...OPCIONES_DE_CURSOS.nivel] } },
      { name: 'quien', in: 'query', required: false, schema: { enum: [...OPCIONES_DE_CURSOS.quien] } },
      { name: 'fuente', in: 'query', required: false, schema: { enum: [...FUENTES_DE_CURSOS] } },
      { name: 'pagina', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
      {
        name: 'fecha',
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date' },
        description: 'El día de la bolsa (AAAA-MM-DD); por defecto, hoy en UTC.',
      },
    ],
    respuesta: objeto(
      {
        fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        enLaBolsa: { type: 'integer', minimum: 0 },
        total: { type: 'integer', minimum: 0 },
        pagina: { type: 'integer', minimum: 1 },
        paginas: { type: 'integer', minimum: 1 },
        fichas: {
          type: 'array',
          items: { type: 'object' },
          description:
            'Los cursos, en el orden de la bolsa. `momento` sale del calendario publicado (por-iniciar, iniciado, sin-fecha) e `inscripcion` de la evidencia de la fuente (confirmada o sin-verificar). Un curso ya iniciado con la inscripción sin verificar va al final, no cuenta como «con fecha» y trae `aviso` con `es` y `ca`.',
        },
        recuentos: { type: 'object', description: 'Por filtro, cuántos cursos quedarían con cada opción.' },
      },
      ['fecha', 'enLaBolsa', 'total', 'pagina', 'paginas', 'fichas', 'recuentos'],
    ),
    errores: LECTURA,
  },
];

/** Las respuestas de error de una operación: todas en Problem Details; 429 y 503, con Retry-After. */
function respuestasDeError(errores: readonly number[]): Objeto {
  const conReintento = (estado: number) =>
    estado === ESTADO_HTTP.demasiadasPeticiones || estado === ESTADO_HTTP.noDisponible;
  return Object.fromEntries(
    errores.map((estado) => [
      String(estado),
      {
        $ref: conReintento(estado) ? '#/components/responses/ProblemaConReintento' : '#/components/responses/Problema',
      },
    ]),
  );
}

/**
 * Los parámetros de una operación; los de la ruta, con el valor que tienen en su ejemplo (`example`): un código que
 * existe en el paquete, para que quien prueba la API desde el contrato llegue a una ficha y no solo a un 404.
 */
function parametrosConEjemplo(operacion: Operacion): Objeto[] {
  const plantilla = operacion.ruta.split('/');
  const ejemplo = operacion.ejemplo.split('/');
  return (operacion.parametros ?? []).map((parametro) =>
    parametro.in === 'path' ? { ...parametro, example: ejemplo[plantilla.indexOf(`{${parametro.name}}`)] } : parametro,
  );
}

/** Una operación en la forma de OpenAPI. */
function operacionOpenApi(operacion: Operacion): Objeto {
  const contrato = { $ref: '#/components/parameters/Contrato' };
  return {
    summary: operacion.resumen,
    parameters: [contrato, ...parametrosConEjemplo(operacion)],
    responses: {
      200: {
        description: 'Correcto',
        headers: { [CABECERA_CONTRATO]: { $ref: '#/components/headers/Contrato' } },
        content: { 'application/json': { schema: operacion.respuesta } },
      },
      ...respuestasDeError(operacion.errores),
      405: { $ref: '#/components/responses/MetodoNoAdmitido' },
      500: { $ref: '#/components/responses/ErrorInterno' },
    },
  };
}

/** Los componentes del contrato y del acceso: el parámetro y las cabeceras, y los esquemas de seguridad. */
function cabecerasYSeguridad(): Objeto {
  return {
    parameters: {
      Contrato: {
        name: CABECERA_CONTRATO,
        in: 'header',
        required: true,
        description: `Versión del contrato entre la web y la API (CONTRATO_API). Sin ella se interpreta la ${CONTRATO_SIN_CABECERA}; solo se acepta la ${CONTRATO_API}. Una versión distinta o ausente responde 409.`,
        schema: { type: 'string', enum: [String(CONTRATO_API)] },
      },
    },
    headers: {
      Contrato: { description: 'Versión del contrato que habla la API.', schema: { type: 'string' } },
      RetryAfter: {
        description: 'Segundos tras los que tiene sentido volver a pedir (RFC 9110, 10.2.3).',
        schema: { type: 'integer', minimum: 1 },
      },
      Allow: { description: 'Los métodos que admite la ruta (RFC 9110, 10.2.1).', schema: { type: 'string' } },
      Peticion: {
        description: 'Identificador de un error interno (500), para encontrarlo en el registro.',
        schema: { type: 'string' },
      },
    },
    securitySchemes: {
      ...SEGURIDAD_DE_SOCIOS,
    },
  };
}

/** Los componentes de los errores: el esquema de Problem Details y sus respuestas. */
function problemas(): Objeto {
  return {
    schemas: {
      Problema: {
        type: 'object',
        description: 'Problem Details (RFC 9457). La extensión `error` repite el motivo de antes, por compatibilidad.',
        required: ['type', 'title', 'status', 'detail'],
        properties: {
          type: {
            type: 'string',
            format: 'uri',
            enum: Object.keys(PROBLEMAS).map((motivo) => `${RAIZ_DE_LOS_PROBLEMAS}${motivo}`),
          },
          title: { type: 'string' },
          status: { type: 'integer', minimum: ESTADO_HTTP.solicitudIncorrecta, maximum: MAX_ESTADO_DE_ERROR },
          detail: { type: 'string' },
          error: { type: 'string', deprecated: true },
          avisos: AVISOS,
        },
      },
      ErrorDeOAuth: ESQUEMA_ERROR_DE_OAUTH,
      EspecialidadRelacionada: ESQUEMA_ESPECIALIDAD_RELACIONADA,
      FormacionRelacionada: ESQUEMA_FORMACION_RELACIONADA,
      ConsultaFormacion: ESQUEMA_CONSULTA_FORMACION,
      CatalogoDatosGlobales: ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES,
      ConsultaDatosGlobales: ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES,
    },
    responses: {
      Problema: {
        description: 'Error, en Problem Details',
        content: { [TIPO_PROBLEMA]: { schema: { $ref: '#/components/schemas/Problema' } } },
      },
      ProblemaConReintento: {
        description: 'Límite o servicio no disponible: Retry-After dice cuándo volver a pedir',
        headers: { 'retry-after': { $ref: '#/components/headers/RetryAfter' } },
        content: { [TIPO_PROBLEMA]: { schema: { $ref: '#/components/schemas/Problema' } } },
      },
      ErrorInterno: {
        description: `Fallo interno: ${CABECERA_PETICION} lo identifica en el registro, sin nada de la persona`,
        headers: { [CABECERA_PETICION]: { $ref: '#/components/headers/Peticion' } },
        content: { [TIPO_PROBLEMA]: { schema: { $ref: '#/components/schemas/Problema' } } },
      },
      MetodoNoAdmitido: {
        description: 'Método que la ruta no admite',
        headers: { allow: { $ref: '#/components/headers/Allow' } },
        content: { [TIPO_PROBLEMA]: { schema: { $ref: '#/components/schemas/Problema' } } },
      },
    },
  };
}

/**
 * El documento OpenAPI 3.1 entero, determinista: generarlo dos veces da el mismo texto.
 *
 * @returns El documento, como objeto.
 */
export function documentoOpenApi(): Objeto {
  const paths: Record<string, Objeto> = {};
  for (const operacion of OPERACIONES) {
    paths[operacion.ruta] = { ...paths[operacion.ruta], [operacion.metodo.toLowerCase()]: operacionOpenApi(operacion) };
  }
  Object.assign(paths, rutasDeSocios(), { [RUTA_ESTADO_CONECTIVIDAD]: ESTADO_CONECTIVIDAD });
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'API de Faro',
      version: VERSION_FARO,
      description:
        'Consultas factuales de Faro. Las respuestas conservan su procedencia y sus límites. ' +
        'Los errores siguen Problem Details (RFC 9457), salvo los cuerpos específicos de OAuth y activación. ' +
        `La cabecera ${CABECERA_CONTRATO} declara la versión del contrato; una versión distinta responde 409.`,
      license: { name: 'Todos los derechos reservados.' },
      ...(CONTACTO_PUBLICO.responsable || CONTACTO_PUBLICO.correo
        ? {
            contact: {
              ...(CONTACTO_PUBLICO.responsable ? { name: CONTACTO_PUBLICO.responsable } : {}),
              ...(CONTACTO_PUBLICO.correo ? { email: CONTACTO_PUBLICO.correo } : {}),
            },
          }
        : {}),
    },
    paths,
    components: { ...cabecerasYSeguridad(), ...problemas() },
  };
}

/**
 * El texto del documento, como se guarda: JSON con dos espacios y salto de línea final.
 *
 * @returns El texto del documento.
 */
export function textoOpenApi(): string {
  return `${JSON.stringify(documentoOpenApi(), null, SANGRIA_JSON)}\n`;
}

/** Contenido generado de cada publicación; se calcula antes de escribir ningún archivo. */
export function artefactosDeContrato(): ReadonlyMap<URL, string> {
  const protocolo = readFileSync(new URL('../../src/comun/protocolo-web.ts', import.meta.url), 'utf8');
  const openapi = formatearTextoConBiome(textoOpenApi(), 'openapi.json');
  const javascript = formatearTextoConBiome(stripTypeScriptTypes(protocolo), 'protocolo-web.js');
  return new Map([
    [ARCHIVO_OPENAPI, openapi],
    [new URL('../../web/scripts/protocolo-web.js', import.meta.url), javascript],
  ]);
}

/** Genera las publicaciones o comprueba que coinciden sin reescribirlas. */
function principal(): void {
  const { values } = orden(USO).leer({ options: { comprobar: { type: 'boolean' } } });
  for (const [archivo, contenido] of artefactosDeContrato()) {
    if (values.comprobar) {
      if (readFileSync(archivo, 'utf8') !== contenido) {
        throw new PublicacionDesactualizada(`Publicación desactualizada: ${fileURLToPath(archivo)}`);
      }
    } else {
      mkdirSync(dirname(fileURLToPath(archivo)), { recursive: true });
      writeFileSync(archivo, contenido);
    }
  }
  console.log(values.comprobar ? 'Contrato publicado al día' : 'Publicaciones del contrato generadas');
}

if (import.meta.main) {
  await ejecutar(principal, 'OpenAPI');
}
