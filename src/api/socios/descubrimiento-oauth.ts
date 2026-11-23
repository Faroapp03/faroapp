// Descubrimiento OAuth para clientes de integración prerregistrados; no ofrece inicio de sesión de personas.

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { ContextoApi } from '../contexto-api.ts';
import { AMBITO_DE_LECTURA, RUTA_INTROSPECCION, RUTA_REVOCAR, RUTA_SOCIOS, RUTA_TOKEN } from './metadatos.ts';
import { respuestaJson } from './servidor-socios.ts';

const RUTA_AUTORIZADOR = `/.well-known/oauth-authorization-server${RUTA_SOCIOS}`;

/** Rutas exactas de los metadatos; no captura otros archivos del directorio well-known. */
export function esDescubrimientoOAuth(camino: string): boolean {
  return camino === RUTA_AUTORIZADOR;
}

/** RFC 8414 y RFC 9728: publica solo capacidades configuradas y direcciones propias, sin secretos ni perfil privado. */
export function responderDescubrimientoOAuth(
  contexto: ContextoApi,
  peticion: Request,
  camino: string,
): Response | null {
  if (!esDescubrimientoOAuth(camino) || !contexto.socios) {
    return null;
  }
  const origen = new URL(peticion.url).origin;
  if (peticion.method !== 'GET') {
    return respuestaJson(ESTADO_HTTP.metodoNoAdmitido, { error: 'metodo_no_admitido' }, { allow: 'GET' });
  }
  return respuestaJson(ESTADO_HTTP.correcto, {
    issuer: `${origen}${RUTA_SOCIOS}`,
    token_endpoint: `${origen}${RUTA_TOKEN}`,
    revocation_endpoint: `${origen}${RUTA_REVOCAR}`,
    introspection_endpoint: `${origen}${RUTA_INTROSPECCION}`,
    response_types_supported: [],
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    scopes_supported: [AMBITO_DE_LECTURA],
  });
}
