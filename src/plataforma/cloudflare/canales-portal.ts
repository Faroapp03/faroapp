import { HERRAMIENTAS } from '../../api/mcp/definiciones.ts';
import { RUTA_DE_AVISOS } from '../cabeceras-web.ts';

/** Solo canales con controles propios; sus interruptores y credenciales se comprueban al delegar. */
const rutas = new Map<string, ReadonlySet<string>>([
  ['/api/socios/v1/invitacion/consultar', new Set(['POST'])],
  ['/api/socios/v1/invitacion/activar', new Set(['POST'])],
  ['/api/socios/v1/token', new Set(['POST'])],
  ['/api/socios/v1/revocar', new Set(['POST'])],
  ['/api/socios/v1/introspeccion', new Set(['POST'])],
  ['/.well-known/oauth-authorization-server/api/socios/v1', new Set(['GET'])],
  ['/mantenimiento/inicio', new Set(['POST'])],
  ['/mantenimiento/reserva', new Set(['POST'])],
  ['/mantenimiento/resultado', new Set(['POST'])],
  ['/mantenimiento/activacion', new Set(['POST'])],
  ['/mantenimiento/construccion', new Set(['GET'])],
  ['/mcp', new Set(['POST', 'OPTIONS'])],
  ['/a2a', new Set(['POST', 'OPTIONS'])],
  ['/.well-known/agent-card.json', new Set(['GET', 'HEAD'])],
  ...HERRAMIENTAS.map((herramienta): [string, ReadonlySet<string>] => [
    `/api/socios/v1/consultas/${herramienta.name}`,
    new Set(['GET']),
  ]),
]);

export function esCanalDeMaquina(peticion: Request): boolean {
  return rutas.get(new URL(peticion.url).pathname)?.has(peticion.method) ?? false;
}

/**
 * Si la petición es un envío de avisos del navegador: POST a RUTA_DE_AVISOS, comparada tal cual llega, sin descodificar.
 * Aparte de los canales de máquina de la oficial (esCanalDeMaquina), que llevan sus propios controles, es lo único que
 * pasa la puerta de las dos entradas hacia la aplicación sin sesión ni credencial. El navegador envía los informes de
 * NEL sin credenciales y los de la CSP sin ellas cuando la sesión ya no vale; el punto de avisos (punto-de-avisos.ts)
 * los trata como datos no fiables, con sus topes. Cualquier otro método en esa ruta sigue tras la puerta.
 */
export function esEnvioDeAvisos(peticion: Request): boolean {
  return peticion.method === 'POST' && new URL(peticion.url).pathname === RUTA_DE_AVISOS;
}
