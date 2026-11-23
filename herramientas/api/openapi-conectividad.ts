/** La comprobación pública existe también con los tres canales apagados. No concede acceso a ellos. */
import { RUTA_ESTADO_CONECTIVIDAD } from '../../src/api/estado-conectividad.ts';

const NO_CACHE = { 'cache-control': { schema: { const: 'no-store' } } };
function error(codigo: string) {
  return {
    description: 'La comprobación no se ha completado',
    headers: NO_CACHE,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['error'],
          properties: { error: { const: codigo } },
        },
      },
    },
  };
}
export const OPERACIONES_ESPECIALES = [{ metodo: 'GET', ruta: RUTA_ESTADO_CONECTIVIDAD }] as const;
export const ESTADO_CONECTIVIDAD = {
  get: {
    summary: 'Comprueba el estado confirmado de los tres servicios',
    description:
      'Disponible aunque los canales estén apagados. Un fallo de lectura devuelve 503; nunca tres valores false por suposición. No admite parámetros URL.',
    security: [],
    parameters: [{ $ref: '#/components/parameters/Contrato' }],
    responses: {
      200: {
        description: 'Estado confirmado',
        headers: NO_CACHE,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['version', 'comprobadoEn', 'servicios'],
              properties: {
                version: { const: 1 },
                comprobadoEn: { type: 'string', format: 'date-time' },
                servicios: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['api', 'mcp', 'a2a'],
                  properties: { api: { type: 'boolean' }, mcp: { type: 'boolean' }, a2a: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
      400: error('solicitud_invalida'),
      405: { ...error('metodo_no_admitido'), headers: { ...NO_CACHE, allow: { schema: { const: 'GET' } } } },
      409: { $ref: '#/components/responses/Problema' },
      503: error('controles_no_disponibles'),
    },
  },
};
