/** Identidad y huella de la versión que atiende la petición; son lecturas sin efectos. */

import { configuracionAdministrativaDelEntorno } from '../../administracion/configuracion.ts';
import { configuracionActualizacionDelEntorno } from '../../administracion/configuracion-actualizacion.ts';
import { type ConfianzaOidcGitHub, crearVerificadorOidcGitHub } from '../../administracion/oidc-github.ts';
import {
  PLAZO_PRUEBA_MANIFIESTO_MS,
  PLAZO_RECEPTOR_MANTENIMIENTO_MS,
} from '../../administracion/plazos-mantenimiento.ts';
import { PlazoAgotado } from '../../api/errores.ts';
import { dentroDelPlazo } from '../../api/plazo.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { esObjeto } from '../../comun/json.ts';
import { cabecerasDeDesafio } from '../../seguridad/desafio-http.ts';
import type { AlmacenDeArchivos } from './activos-publicos.ts';

export const RUTA_CONSTRUCCION_SERVIDA = '/mantenimiento/construccion';
const CONSULTA_MANIFIESTO = '?prueba=manifiesto';
const RUTA_MANIFIESTO = '/firmas/manifiesto.json';
const MAX_MANIFIESTO_BYTES = 8_388_608; // 8 MiB, igual que el cotejo público del cliente.
const BASE_HEXADECIMAL = 16;
const CIFRAS_POR_BYTE = 2;
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
  if (!configuracion) {
    throw new RechazoLectura(ESTADO_HTTP.noEncontrado, 'ruta_no_encontrada');
  }
  const url = `${configuracion.origen}${RUTA_CONSTRUCCION_SERVIDA}`;
  const pideManifiesto = peticion.url === url + CONSULTA_MANIFIESTO;
  if (peticion.url !== url && !pideManifiesto) {
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
  return { origen: configuracion.origen, confianza: actualizacion.confianza, token, pideManifiesto };
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
function validarArchivo(archivo: Response): { cuerpo: ReadableStream<Uint8Array>; longitud: number | null } {
  const longitud = archivo.headers.get('content-length');
  const esperados = longitud === null ? null : Number(longitud);
  const codificacion = archivo.headers.get('content-encoding')?.toLowerCase() ?? 'identity';
  if (
    archivo.status !== ESTADO_HTTP.correcto ||
    archivo.redirected ||
    !archivo.body ||
    codificacion !== 'identity' ||
    (longitud !== null && (!/^[1-9][0-9]{0,6}$/.test(longitud) || Number(longitud) > MAX_MANIFIESTO_BYTES))
  ) {
    void archivo.body?.cancel().catch(() => undefined);
    throw new RechazoLectura(ESTADO_HTTP.noDisponible, 'no_disponible');
  }
  return { cuerpo: archivo.body, longitud: esperados };
}

/** Lee los bytes exactos, tanto con longitud declarada como en un flujo sin ella. */
async function bytesDelManifiesto(archivo: Response, senal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const { cuerpo, longitud } = validarArchivo(archivo);
  const bytes = new Uint8Array(longitud ?? MAX_MANIFIESTO_BYTES);
  const lector = cuerpo.getReader();
  const cancelar = () => {
    void lector.cancel().catch(() => undefined);
  };
  senal.addEventListener('abort', cancelar, { once: true });
  let total = 0;
  try {
    senal.throwIfAborted();
    for (;;) {
      const parte = await lector.read();
      senal.throwIfAborted();
      if (parte.done) {
        break;
      }
      const siguiente = total + parte.value.byteLength;
      if (siguiente > bytes.byteLength) {
        throw new RechazoLectura(ESTADO_HTTP.noDisponible, 'no_disponible');
      }
      bytes.set(parte.value, total);
      total = siguiente;
    }
  } finally {
    senal.removeEventListener('abort', cancelar);
    cancelar();
    lector.releaseLock();
  }
  if (total === 0 || (longitud !== null && total !== longitud)) {
    throw new RechazoLectura(ESTADO_HTTP.noDisponible, 'no_disponible');
  }
  return bytes.subarray(0, total);
}

async function huellaDelManifiesto(origen: string, assets: AlmacenDeArchivos, senal: AbortSignal): Promise<string> {
  const archivo = await assets.fetch(
    new Request(origen + RUTA_MANIFIESTO, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      headers: { 'accept-encoding': 'identity' },
      signal: senal,
    }),
  );
  const bytes = await bytesDelManifiesto(archivo, senal);
  const huella = await crypto.subtle.digest('SHA-256', bytes);
  senal.throwIfAborted();
  return Array.from(new Uint8Array(huella), (byte) =>
    byte.toString(BASE_HEXADECIMAL).padStart(CIFRAS_POR_BYTE, '0'),
  ).join('');
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
  { metadata, assets }: { metadata: unknown; assets: AlmacenDeArchivos | undefined },
  verificadorDe: VerificadorDe,
): Promise<Response> {
  try {
    const { origen, confianza, token, pideManifiesto } = frontera(peticion, variables);
    const verificar = verificadorDe(origen, confianza);
    return await dentroDelPlazo(
      async (senal) => {
        const identidad = await verificar(token);
        senal.throwIfAborted();
        if (!identidad) {
          throw new RechazoLectura(ESTADO_HTTP.noAutenticado, 'no_autorizado');
        }
        const construccion = { version: 1, versionId: versionId(metadata) };
        if (!pideManifiesto) {
          return respuesta(ESTADO_HTTP.correcto, construccion);
        }
        if (!assets) {
          throw new RechazoLectura(ESTADO_HTTP.noDisponible, 'no_disponible');
        }
        const sha256ManifiestoWeb = await huellaDelManifiesto(origen, assets, senal);
        return respuesta(ESTADO_HTTP.correcto, { ...construccion, sha256ManifiestoWeb });
      },
      pideManifiesto ? PLAZO_PRUEBA_MANIFIESTO_MS : PLAZO_RECEPTOR_MANTENIMIENTO_MS,
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
  assets?: AlmacenDeArchivos,
) => Promise<Response> {
  let cache: { clave: string; verificar: Verificador } | undefined;
  const verificadorDe: VerificadorDe = (origen, confianza) => {
    const clave = JSON.stringify({ origen, confianza });
    if (cache?.clave !== clave) {
      cache = { clave, verificar: crearVerificadorOidcGitHub(confianza, pedir, ahora) };
    }
    return cache.verificar;
  };
  return (peticion, variables, metadata, assets) =>
    responderLectura(peticion, variables, { metadata, assets }, verificadorDe);
}
