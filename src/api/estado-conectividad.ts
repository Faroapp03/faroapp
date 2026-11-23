/** Estado público confirmado desde la misma captura de controles usada por las consultas. */

import { ESTADO_HTTP } from '../comun/estados-http.ts';
import type { DisponibilidadConectividad } from './controles-administrativos.ts';
import { cabecerasApi, comprobarContrato } from './http.ts';

export const RUTA_ESTADO_CONECTIVIDAD = '/api/conectividad/estado';
export function responderEstadoConectividad(
  origenesPermitidos: readonly string[],
  peticion: Request,
  controles: DisponibilidadConectividad,
): Response {
  comprobarContrato(peticion);
  if (peticion.method !== 'GET') {
    const respuesta = responder(peticion, origenesPermitidos, ESTADO_HTTP.metodoNoAdmitido, {
      error: 'metodo_no_admitido',
    });
    respuesta.headers.set('allow', 'GET');
    return respuesta;
  }
  if (new URL(peticion.url).search) {
    return responder(peticion, origenesPermitidos, ESTADO_HTTP.solicitudIncorrecta, { error: 'solicitud_invalida' });
  }
  if (!controles) {
    return responder(peticion, origenesPermitidos, ESTADO_HTTP.noDisponible, { error: 'controles_no_disponibles' });
  }
  return responder(peticion, origenesPermitidos, ESTADO_HTTP.correcto, {
    version: 1,
    comprobadoEn: new Date().toISOString(),
    servicios:
      controles === 'apagado-sin-administracion'
        ? { api: false, mcp: false, a2a: false }
        : { api: controles.api === 'habilitada', mcp: controles.mcp, a2a: controles.a2a },
  });
}

function responder(peticion: Request, origenes: readonly string[], estado: number, cuerpo: unknown): Response {
  return Response.json(cuerpo, { status: estado, headers: cabecerasApi(peticion, origenes) });
}
