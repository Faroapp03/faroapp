/** Rutas institucionales: invitación de un uso, OAuth y consultas factuales, gobernadas por controles durables. */
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { ContextoApi } from '../contexto-api.ts';
import { problema } from '../errores.ts';
import { atenderConsulta } from './consultas-de-socios.ts';
import { atenderInvitacion } from './invitaciones.ts';
import { RUTA_ACTIVAR_INVITACION, RUTA_CONSULTAR_INVITACION } from './metadatos.ts';
import { atenderIntrospeccion, atenderRevocacion, atenderToken } from './oauth.ts';
import {
  RUTA_CONSULTAS,
  RUTA_INTROSPECCION,
  RUTA_REVOCAR,
  RUTA_SOCIOS,
  RUTA_TOKEN,
  respuestaDeUnProblema,
  type ServidorDeSocios,
} from './servidor-socios.ts';

type Punto = (contexto: ContextoApi, servidor: ServidorDeSocios, peticion: Request) => Promise<Response>;
const PUNTOS_DE_OAUTH = new Map<string, Punto>([
  [RUTA_TOKEN, atenderToken],
  [RUTA_REVOCAR, atenderRevocacion],
  [RUTA_INTROSPECCION, atenderIntrospeccion],
]);
function metodoNoAdmitido(admitido: 'GET' | 'POST'): Response {
  return respuestaDeUnProblema(
    problema(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido', `Esta ruta admite ${admitido}.`),
    { allow: admitido },
  );
}
export function esDeLaApiDeSocios(camino: string): boolean {
  return camino === RUTA_SOCIOS || camino.startsWith(`${RUTA_SOCIOS}/`);
}
export async function atenderApiDeSocios(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  peticion: Request,
  camino: string,
): Promise<Response> {
  if (camino === RUTA_ACTIVAR_INVITACION || camino === RUTA_CONSULTAR_INVITACION) {
    return atenderInvitacion(contexto, servidor, peticion, camino);
  }
  const deOAuth = PUNTOS_DE_OAUTH.get(camino);
  if (deOAuth) {
    return peticion.method === 'POST' ? deOAuth(contexto, servidor, peticion) : metodoNoAdmitido('POST');
  }
  if (camino.startsWith(`${RUTA_CONSULTAS}/`)) {
    return peticion.method === 'GET'
      ? atenderConsulta(contexto, servidor, peticion, camino.slice(RUTA_CONSULTAS.length + 1))
      : metodoNoAdmitido('GET');
  }
  return respuestaDeUnProblema(
    problema(ESTADO_HTTP.noEncontrado, 'ruta_desconocida', 'La API institucional no tiene esta ruta.'),
  );
}
