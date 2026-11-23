/** Identidad de la versión que ejecuta esta petición; no concede permisos ni modifica ningún trabajo. */

import { configuracionAdministrativaDelEntorno } from '../../administracion/configuracion.ts';
import { configuracionActualizacionDelEntorno } from '../../administracion/configuracion-actualizacion.ts';
import { type ConfianzaOidcGitHub, crearVerificadorOidcGitHub } from '../../administracion/oidc-github.ts';
import { PlazoAgotado } from '../../api/errores.ts';
import { dentroDelPlazo } from '../../api/plazo.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { esObjeto } from '../../comun/json.ts';
import { cabecerasDeDesafio } from '../../seguridad/desafio-http.ts';

export const RUTA_CONSTRUCCION_SERVIDA = '/mantenimiento/construccion';
const PLAZO_MS = 5000;
const MAX_TOKEN = 16_384;
const LONGITUD_UUID = 36;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
interface OpcionesLectorConstruccion {
  readonly pedir?: typeof fetch;
  readonly ahora?: () => number;
}
function respuesta(estado: number, contenido: object): Response {
  return Response.json(contenido, {
    status: estado,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(estado === ESTADO_HTTP.metodoNoAdmitido ? { allow: 'GET' } : {}),
      ...cabecerasDeDesafio(estado),
    },
  });
}
function error(estado: number, codigo: string): Response {
  return respuesta(estado, { error: codigo });
}

class RechazoLectura extends Error {
  readonly estado: number;
  constructor(estado: number, codigo: string) {
    super(codigo);
    this.estado = estado;
  }
}
function frontera(peticion: Request, variables: VariablesDelEntorno) {
  if (variables.FARO_ADMINISTRACION === undefined || variables.FARO_ADMINISTRACION === 'no') {
    throw new RechazoLectura(ESTADO_HTTP.noEncontrado, 'ruta_no_encontrada');
  }
  const configuracion = configuracionAdministrativaDelEntorno(variables);
  if (!configuracion || peticion.url !== `${configuracion.origen}${RUTA_CONSTRUCCION_SERVIDA}`) {
    throw new RechazoLectura(ESTADO_HTTP.noEncontrado, 'ruta_no_encontrada');
  }
  if (peticion.method !== 'GET') {
    throw new RechazoLectura(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido');
  }
  if (peticion.body !== null || ![null, '0'].includes(peticion.headers.get('content-length'))) {
    throw new RechazoLectura(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  const autorizacion = peticion.headers.get('authorization') ?? '';
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(autorizacion)?.[1];
  if (!token || token.length > MAX_TOKEN) {
    throw new RechazoLectura(ESTADO_HTTP.noAutenticado, 'no_autorizado');
  }
  const actualizacion = configuracionActualizacionDelEntorno(variables, configuracion.origen);
  if (!actualizacion) {
    throw new RechazoLectura(ESTADO_HTTP.noDisponible, 'no_disponible');
  }
  return { origen: configuracion.origen, confianza: actualizacion.confianza, token };
}
function versionId(metadata: unknown): string {
  if (
    !esObjeto(metadata) ||
    typeof metadata.id !== 'string' ||
    metadata.id.length !== LONGITUD_UUID ||
    !UUID.test(metadata.id)
  ) {
    throw new RechazoLectura(ESTADO_HTTP.noDisponible, 'no_disponible');
  }
  return metadata.id;
}
function respuestaDelError(causa: unknown, peticion: Request): Response {
  if (peticion.signal.aborted) {
    throw peticion.signal.reason;
  }
  if (causa instanceof RechazoLectura) {
    return error(causa.estado, causa.message);
  }
  return causa instanceof PlazoAgotado
    ? error(ESTADO_HTTP.tiempoAgotado, 'plazo_agotado')
    : error(ESTADO_HTTP.noDisponible, 'no_disponible');
}
type Verificador = ReturnType<typeof crearVerificadorOidcGitHub>;
type VerificadorDe = (origen: string, confianza: ConfianzaOidcGitHub) => Verificador;
async function responderLectura(
  peticion: Request,
  variables: VariablesDelEntorno,
  metadata: unknown,
  verificadorDe: VerificadorDe,
): Promise<Response> {
  try {
    const { origen, confianza, token } = frontera(peticion, variables);
    const verificar = verificadorDe(origen, confianza);
    return await dentroDelPlazo(
      async (senal) => {
        const identidad = await verificar(token);
        senal.throwIfAborted();
        if (!identidad) {
          throw new RechazoLectura(ESTADO_HTTP.noAutenticado, 'no_autorizado');
        }
        return respuesta(ESTADO_HTTP.correcto, { version: 1, versionId: versionId(metadata) });
      },
      PLAZO_MS,
      peticion.signal,
    );
  } catch (causa) {
    return respuestaDelError(causa, peticion);
  } finally {
    if (!peticion.bodyUsed) {
      void peticion.body?.cancel().catch(() => undefined);
    }
  }
}
/**
 * Conserva un único verificador por origen/confianza, nunca el resultado de una autorización. La configuración
 * completa del actualizador sigue siendo requisito; su token de despacho no se usa ni se conserva en esta caché.
 * Un reintento firmado conserva este permiso de solo lectura: observar el UUID no autoriza una activación.
 * El enlace del entorno (binding) de los metadatos de la versión se comprueba tras autenticar cada petición, sin
 * inferirlo de etiquetas, variables o trabajos.
 */
export function crearLectorConstruccionServida({
  pedir = (entrada, opciones) => fetch(entrada, opciones),
  ahora = Date.now,
}: OpcionesLectorConstruccion = {}): (
  peticion: Request,
  variables: VariablesDelEntorno,
  metadata: unknown,
) => Promise<Response> {
  let cache: { clave: string; verificar: Verificador } | undefined;
  const verificadorDe: VerificadorDe = (origen, confianza) => {
    const clave = JSON.stringify({ origen, confianza });
    if (cache?.clave !== clave) {
      cache = { clave, verificar: crearVerificadorOidcGitHub(confianza, pedir, ahora) };
    }
    return cache.verificar;
  };
  return (peticion, variables, metadata) => responderLectura(peticion, variables, metadata, verificadorDe);
}
