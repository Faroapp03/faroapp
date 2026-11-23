// Lo que la API comprueba y responde en toda petición, antes de que la atienda su ruta: las cabeceras de la respuesta,
// la versión del contrato con la web, de dónde viene una petición POST y de qué tipo es su cuerpo, y el idioma que pide
// una consulta GET.
// Los errores de la petición y su traducción a respuesta (errores.ts) y la lectura del cuerpo (cuerpo.ts) van en su
// archivo, y se exportan también desde aquí: las rutas toman de un mismo sitio todo lo que es HTTP.

import { esIdioma, IDIOMA_POR_DEFECTO, IDIOMAS, type Idioma } from '../comun/idioma.ts';
import {
  ContratoIncompatible,
  OrigenNoPermitido,
  type RespuestaDeError,
  SolicitudInvalida,
  TIPO_JSON,
  TIPO_PROBLEMA,
  TipoNoAdmitido,
} from './errores.ts';
import { CABECERA_CONTRATO, CABECERA_PETICION, CONTRATO_API, CONTRATO_SIN_CABECERA } from './metadatos-http.ts';

export { leerCuerpoJson } from './cuerpo.ts';
export {
  contenidoNoAdmitido,
  DemasiadasPeticiones,
  PeticionCancelada,
  PlazoAgotado,
  type Problema,
  problema,
  type RespuestaDeError,
  registrarErrorInterno,
  respuestaDeError,
  respuestaDeProblema,
  SolicitudInvalida,
  TIPO_PROBLEMA,
} from './errores.ts';
/** La fachada HTTP conserva las importaciones de sus consumidores; el contrato vive en el módulo común. */
export { CABECERA_CONTRATO, CABECERA_PETICION, CONTRATO_API, CONTRATO_SIN_CABECERA } from './metadatos-http.ts';

/** Segundos que el navegador recuerda la respuesta previa de CORS. */
const PREFLIGHT_S = '600';

/** El origen («https://sitio:puerto») de la propia API, sacado de la dirección de la petición. */
function origenPropio(peticion: Request): string {
  return new URL(peticion.url).origin;
}

/**
 * Si la petición puede venir de donde dice. Un origen de la lista se admite aunque sea de otro sitio: para eso está la
 * lista (CORS). Si no, se rechaza lo que el navegador marca como de otro sitio (Sec-Fetch-Site: cross-site) y lo que
 * declara un origen distinto del de la API. Sin Origin se admite salvo la marca cross-site; estas cabeceras no
 * autentican al cliente. WebKit (Safari), con Referrer-Policy: no-referrer (la de la web), manda `Origin: null` en las
 * peticiones POST de la propia página: se admite solo si el navegador la marca del mismo origen (Sec-Fetch-Site:
 * same-origin).
 * Ni Origin ni Sec-Fetch-Site se pueden cambiar desde una página web.
 */
function origenAdmitido(peticion: Request, origenesPermitidos: readonly string[]): boolean {
  const origen = peticion.headers.get('origin');
  if (origen !== null && origenesPermitidos.includes(origen)) {
    return true;
  }
  const sitio = peticion.headers.get('sec-fetch-site');
  if (sitio === 'cross-site') {
    return false;
  }
  if (origen === 'null') {
    return sitio === 'same-origin';
  }
  return origen === null || origen === origenPropio(peticion);
}

/**
 * Cabeceras de toda respuesta de la API, con la versión del contrato. `vary: origin` siempre, porque la respuesta
 * depende del origen. A un origen de la lista se le deja leer la versión y el identificador de petición.
 *
 * @param peticion - La petición que se responde.
 * @param origenesPermitidos - Los orígenes web a los que se deja leer la respuesta.
 * @returns Las cabeceras de la respuesta.
 */
export function cabecerasApi(peticion: Request, origenesPermitidos: readonly string[]): Record<string, string> {
  const origen = peticion.headers.get('origin') ?? '';
  const permitido = origenesPermitidos.includes(origen);
  return {
    'content-type': `${TIPO_JSON}; charset=utf-8`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'origin',
    [CABECERA_CONTRATO]: String(CONTRATO_API),
    ...(permitido
      ? {
          'access-control-allow-origin': origen,
          // Retry-After no es una cabecera que el navegador deje leer sin más (CORS): se expone para los 429 y 503.
          'access-control-expose-headers': `${CABECERA_CONTRATO}, ${CABECERA_PETICION}, retry-after`,
        }
      : {}),
  };
}

/** Lo que admite quien responde a la comprobación previa de CORS, ya escrito para sus cabeceras. */
export interface PreflightAdmitido {
  readonly metodos: string;
  readonly cabeceras: string;
}

/**
 * Respuesta a la comprobación previa de CORS (OPTIONS) que hace el navegador antes de una petición de otro origen,
 * la misma para la API, el servidor MCP y el agente A2A: las cabeceras de la API, los métodos y las cabeceras de la
 * petición que admite cada uno, y cuánto puede recordarla el navegador.
 *
 * @param peticion - La petición OPTIONS.
 * @param origenesPermitidos - Los orígenes web permitidos.
 * @param admitidos - Los métodos y las cabeceras de petición que admite quien responde, ya escritos para sus cabeceras.
 * @returns La respuesta 204 con las cabeceras de CORS.
 */
export function respuestaPreflight(
  peticion: Request,
  origenesPermitidos: readonly string[],
  admitidos: PreflightAdmitido,
): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...cabecerasApi(peticion, origenesPermitidos),
      'access-control-allow-methods': admitidos.metodos,
      'access-control-allow-headers': admitidos.cabeceras,
      'access-control-max-age': PREFLIGHT_S,
    },
  });
}

/**
 * Respuesta de error en Problem Details (RFC 9457): el cuerpo como application/problem+json, con las cabeceras de la
 * API y las que pide su código (Retry-After en un 429 o un 503, Allow en un 405).
 *
 * @param peticion - La petición que se responde.
 * @param origenesPermitidos - Los orígenes web permitidos.
 * @param error - El error ya traducido: estado, cuerpo y cabeceras propias.
 * @returns La respuesta de error.
 */
export function respuestaConProblema(
  peticion: Request,
  origenesPermitidos: readonly string[],
  { estado, cuerpo, cabeceras }: RespuestaDeError,
): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      ...cabecerasApi(peticion, origenesPermitidos),
      ...cabeceras,
      'content-type': `${TIPO_PROBLEMA}; charset=utf-8`,
    },
  });
}

/**
 * Falla con 409 si la web habla otra versión del contrato. Sin cabecera, la de las webs que aún no la enviaban.
 *
 * @param peticion - La petición, con o sin la cabecera del contrato.
 * @throws {Error} ContratoIncompatible si la versión declarada no es la de CONTRATO_API.
 */
export function comprobarContrato(peticion: Request): void {
  const declarado = peticion.headers.get(CABECERA_CONTRATO) ?? String(CONTRATO_SIN_CABECERA);
  if (declarado.trim() !== String(CONTRATO_API)) {
    throw new ContratoIncompatible();
  }
}

/**
 * Falla si una petición POST puede venir de la página de otro sitio (403) o si su cuerpo no se declara JSON (415).
 * Sin esto, una página de otro sitio podría enviar texto plano sin comprobación previa de CORS (una «petición
 * simple») desde el navegador de quien la visita y consumir recursos del servicio. Declarar el cuerpo como
 * JSON obliga al navegador a pedir permiso antes, y ese permiso solo se da a los orígenes de la lista.
 *
 * @param peticion - La petición POST.
 * @param origenesPermitidos - Los orígenes web permitidos.
 * @throws {Error} OrigenNoPermitido si viene de otro sitio; TipoNoAdmitido si su cuerpo no se declara JSON.
 */
export function comprobarPeticionPost(peticion: Request, origenesPermitidos: readonly string[]): void {
  if (!origenAdmitido(peticion, origenesPermitidos)) {
    throw new OrigenNoPermitido();
  }
  // split conserva un primer elemento, también cuando falta la cabecera.
  const principal = (peticion.headers.get('content-type') ?? '').split(';')[0] as string;
  const tipo = principal.trim().toLowerCase();
  if (tipo !== TIPO_JSON) {
    throw new TipoNoAdmitido();
  }
}

/**
 * El idioma que pide una consulta GET con `?idioma=`: sin él, el castellano; un idioma que Faro no
 * tiene es una petición mal hecha (400), no un castellano en silencio.
 *
 * @param url - La dirección de la consulta.
 * @returns El idioma pedido, o el castellano si no se pide ninguno.
 * @throws {Error} SolicitudInvalida si pide un idioma que Faro no tiene.
 */
export function idiomaDeLaConsulta(url: URL): Idioma {
  const pedido = url.searchParams.get('idioma');
  if (pedido === null) {
    return IDIOMA_POR_DEFECTO;
  }
  if (!esIdioma(pedido)) {
    throw new SolicitudInvalida(`el idioma tiene que ser ${IDIOMAS.join(' o ')}`);
  }
  return pedido;
}
