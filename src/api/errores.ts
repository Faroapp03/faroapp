// Los errores de una petición a la API y lo que se responde a cada uno: un código HTTP (RFC 9110) y un cuerpo Problem
// Details (RFC 9457, application/problem+json). Los fallos de procesamiento y los inesperados llevan textos fijos; los
// errores de entrada, su mensaje. Un error interno (500) deja rastro con método reconocido, estado, tipo e identificador
// (registrarErrorInterno), sin copiar ruta, cuerpo, consulta, mensaje ni pila.

import { type CodigoErrorDeProcesamiento, ErrorDeProcesamiento } from '../comun/error-de-procesamiento.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { RAIZ_DE_LOS_PROBLEMAS } from '../comun/protocolo-web.ts';
import { RelojAtrasado } from '../comun/reloj-atrasado.ts';
import { MS_POR_SEGUNDO } from '../comun/tiempo.ts';
import { EntradaInvalida } from '../dominio/errores.ts';
import { VENTANA_LIMITADOR_MS } from '../seguridad/limitador.ts';
import { CONTENIDO_NO_ADMITIDO } from '../seguridad/moderacion.ts';
import { PROBLEMAS as PROBLEMAS_DEL_CONTRATO } from './problemas.ts';

/** El único tipo de cuerpo que aceptan las rutas POST: con otro, la petición se responde con un 415. */
export const TIPO_JSON = 'application/json';
/**
 * Raíz del `type` de cada problema: un URI tag (RFC 4151), que identifica sin pretender ser una dirección que se pueda
 * abrir (RFC 9457 lo admite; lo que significa cada uno está en docs/api/README.md). Se lee siempre entero: la web
 * distingue los problemas por su `type` (web/scripts/recorrido/api/errores.js).
 */
export { RAIZ_DE_LOS_PROBLEMAS } from '../comun/protocolo-web.ts';
/** El tipo de toda respuesta de error de la API REST: Problem Details (RFC 9457, docs/api/README.md). */
export { PROBLEMAS, TIPO_PROBLEMA } from './problemas.ts';

/** Forma del identificador de petición de Cloudflare (cf-ray): lo demás no se copia al registro. */
const IDENTIFICADOR_DE_CLOUDFLARE = /^[0-9a-f]{16}(?:-[A-Z]{3})?$/;
/** Los constructores de error nativos que el registro distingue por nombre; cualquier otro se registra como «Error». */
const TIPOS_NATIVOS = [TypeError, RangeError, SyntaxError, ReferenceError, URIError, EvalError] as const;
/** Métodos HTTP reconocidos en el diagnóstico; cualquier otro texto recibido se representa con «otro». */
const METODOS_HTTP: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'CONNECT',
]);
/** Espera indicada por Retry-After para un 503; no impone la frecuencia de las peticiones del cliente. */
const REINTENTO_SERVICIO_S = 3600;

/**
 * Cada problema que puede responder la API REST, con su título fijo (el `title` de RFC 9457: igual en todas las
 * respuestas del mismo `type`). El `detail` cambia con el caso; el título, no.
 */
const PROBLEMAS = PROBLEMAS_DEL_CONTRATO satisfies Record<CodigoErrorDeProcesamiento, string>;
/** Los fallos de procesamiento y configuración llevan textos fijos, nunca sus mensajes internos. */
const RESPUESTAS_DE_PROCESAMIENTO: Readonly<
  Record<CodigoErrorDeProcesamiento, { readonly estado: number; readonly detalle: string }>
> = {
  no_configurado: { estado: 503, detalle: 'La configuración necesaria no está disponible en este servidor.' },
  salida_invalida: { estado: 502, detalle: 'Faro no ha podido procesar el texto. Vuelve a intentarlo.' },
};

/** El nombre corto de un problema: el final de su `type`. */
export type MotivoDelProblema = keyof typeof PROBLEMAS;

/**
 * El cuerpo de una respuesta de error (RFC 9457): `type`, `title`, `status` y `detail`, más las extensiones de cada
 * ruta (sus avisos, las candidatas por palabras…). La extensión `error` lleva el valor de compatibilidad, un motivo o un
 * mensaje; la web de este contrato lee `type`. Quitarla es un cambio de contrato (CONTRATO_API, api/http.ts).
 */
export interface Problema {
  type: string;
  title: string;
  status: number;
  detail: string;
  error: string;
  [extension: string]: unknown;
}

/** Lo que responde la API a un error: su código HTTP, su cuerpo y las cabeceras que el código pide (Retry-After). */
export interface RespuestaDeError {
  estado: number;
  cuerpo: Problema;
  cabeceras: Record<string, string>;
}

/** La petición no tiene el formato esperado: se responde 400 con un mensaje para la persona. */
export class SolicitudInvalida extends Error {}
/** La red del cliente ha agotado el límite de consultas (seguridad/limitador.ts): 429. */
export class DemasiadasPeticiones extends Error {}
/** La petición viene de otro sitio web que no está entre los permitidos: se responde 403. */
export class OrigenNoPermitido extends Error {}
/** El cuerpo no se declara como JSON: se responde 415. */
export class TipoNoAdmitido extends Error {}
/** La petición no ha terminado en su plazo (api/plazo.ts): se responde 504. */
export class PlazoAgotado extends Error {}
/**
 * El cliente retiró su petición. La API recibe su señal de cancelación; el servidor local comprueba si la conexión
 * está destruida antes de escribir la respuesta (plataforma/node/servidor.ts). A quien sigue escuchando (las pruebas,
 * el motor del dispositivo) se le responde 400 con el problema «cancelada»: RFC 9110 no tiene un código
 * para «el cliente se fue» (el 499 de nginx no es estándar), y la retirada es del cliente, no un fallo del servidor.
 */
export class PeticionCancelada extends Error {}
/** La web habla otra versión del contrato (CONTRATO_API, api/http.ts): se responde 409, para que recargue. */
export class ContratoIncompatible extends Error {}

/**
 * Los errores de la petición que siempre se responden igual. La web elige el texto por el `type`
 * (web/scripts/recorrido/api/errores.js); el detalle describe el problema a los consumidores de la API.
 * El campo `error` conserva el valor definido por el contrato.
 */
const RESPUESTAS_FIJAS: readonly (readonly [new (...argumentos: never[]) => Error, Problema])[] = [
  [
    DemasiadasPeticiones,
    problema(
      ESTADO_HTTP.demasiadasPeticiones,
      'demasiadas_peticiones',
      'Faro está recibiendo muchas consultas desde esta red. Vuelve a intentarlo más tarde.',
      { error: 'demasiadas peticiones' },
    ),
  ],
  [
    OrigenNoPermitido,
    problema(ESTADO_HTTP.prohibido, 'origen_no_permitido', 'Esta API no admite peticiones desde ese sitio web.', {
      error: 'origen no permitido',
    }),
  ],
  [
    TipoNoAdmitido,
    problema(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido', `El cuerpo debe enviarse como ${TIPO_JSON}.`, {
      error: `el cuerpo debe enviarse como ${TIPO_JSON}`,
    }),
  ],
  [PeticionCancelada, problema(ESTADO_HTTP.solicitudIncorrecta, 'cancelada', 'La petición se ha cancelado.')],
  [
    PlazoAgotado,
    problema(
      ESTADO_HTTP.tiempoAgotado,
      'tiempo',
      'Faro está tardando demasiado en responder. Vuelve a intentarlo en unos minutos.',
    ),
  ],
  [
    ContratoIncompatible,
    problema(
      ESTADO_HTTP.conflicto,
      'contrato',
      'Esta página de Faro es de una versión anterior: recárgala para seguir.',
    ),
  ],
  [
    RelojAtrasado,
    problema(
      ESTADO_HTTP.solicitudIncorrecta,
      'reloj_atrasado',
      'La fecha de este dispositivo es anterior a la de los datos de Faro. Corrige la fecha y la hora del dispositivo y vuelve a intentarlo.',
      { error: 'fecha del dispositivo atrasada' },
    ),
  ],
];

/**
 * Retry-After (RFC 9110, 10.2.3), en segundos: la ventana de consultas para un 429 y el intervalo de servicio
 * para un 503. No garantiza que al esperar desaparezca la causa.
 */
function cabecerasDeReintento(estado: number): Record<string, string> {
  if (estado === ESTADO_HTTP.demasiadasPeticiones) {
    return { 'retry-after': String(Math.ceil(VENTANA_LIMITADOR_MS / MS_POR_SEGUNDO)) };
  }
  if (estado === ESTADO_HTTP.noDisponible) {
    return { 'retry-after': String(REINTENTO_SERVICIO_S) };
  }
  return {};
}

/**
 * Un problema con su `type` y su título. Las extensiones se incorporan antes de los miembros de RFC 9457 y de `error`,
 * y no pueden pisarlos.
 *
 * @param estado - El código HTTP (ESTADO_HTTP).
 * @param motivo - El final del `type`, que fija también el título.
 * @param detalle - El `detail`, escrito para la persona.
 * @param extensiones - Los miembros de extensión; `error` es el valor de compatibilidad (por defecto, el motivo).
 * @returns El cuerpo Problem Details.
 */
export function problema(
  estado: number,
  motivo: MotivoDelProblema,
  detalle: string,
  { error = motivo, ...extensiones }: { error?: string; [extension: string]: unknown } = {},
): Problema {
  return {
    ...extensiones,
    type: `${RAIZ_DE_LOS_PROBLEMAS}${motivo}`,
    title: PROBLEMAS[motivo],
    status: estado,
    detail: detalle,
    error,
  };
}

/**
 * El 422 de la moderación (seguridad/moderacion.ts), con sus avisos y lo que añada la ruta.
 *
 * @param extensiones - Los avisos y lo que añada la ruta; una extensión `error` no pisa el valor de compatibilidad.
 * @returns El problema «contenido_no_admitido».
 */
export function contenidoNoAdmitido(extensiones: Record<string, unknown>): Problema {
  return problema(
    ESTADO_HTTP.contenidoNoProcesable,
    'contenido_no_admitido',
    'Faro no puede tratar este texto: revisa los avisos.',
    {
      ...extensiones,
      error: CONTENIDO_NO_ADMITIDO,
    },
  );
}

/**
 * La respuesta de error de un problema, con las cabeceras que pide su código.
 *
 * @param cuerpo - El problema.
 * @returns Su estado, su cuerpo y su Retry-After si lo lleva.
 */
export function respuestaDeProblema(cuerpo: Problema): RespuestaDeError {
  return {
    estado: cuerpo.status,
    cuerpo,
    cabeceras: cabecerasDeReintento(cuerpo.status),
  };
}

/**
 * Traduce cada error a su respuesta. Los fallos de procesamiento y los inesperados nunca devuelven su mensaje interno: el
 * procesamiento responde su código con un texto fijo. Solo los errores de la petición (SolicitudInvalida y EntradaInvalida)
 * llevan su mensaje, que está escrito para la persona.
 *
 * @param error - Lo que se ha lanzado.
 * @returns La respuesta: un 500 «error_interno» si no es un error conocido.
 */
export function respuestaDeError(error: unknown): RespuestaDeError {
  const fija = RESPUESTAS_FIJAS.find(([clase]) => error instanceof clase);
  if (fija) {
    return respuestaDeProblema(fija[1]);
  }
  if (error instanceof ErrorDeProcesamiento) {
    const { estado, detalle } = RESPUESTAS_DE_PROCESAMIENTO[error.codigo];
    return respuestaDeProblema(problema(estado, error.codigo, detalle));
  }
  if (error instanceof SolicitudInvalida || error instanceof EntradaInvalida) {
    return respuestaDeProblema(
      problema(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida', error.message, { error: error.message }),
    );
  }
  return respuestaDeProblema(
    problema(ESTADO_HTTP.errorInterno, 'error_interno', 'Faro ha tenido un fallo interno. Vuelve a intentarlo.', {
      error: 'error interno',
    }),
  );
}

/**
 * Deja rastro de un error interno (500): método reconocido, código, tipo de error e identificador de petición.
 * No copia ruta, cuerpo, consulta, mensaje ni pila. Un método ajeno al conjunto HTTP se representa con «otro».
 * En Cloudflare el identificador es el de la petición (cf-ray), para cruzarlo con su registro. Se
 * devuelve y viaja en la respuesta (CABECERA_PETICION, api/http.ts). De la petición solo lee sus cabeceras y su método.
 * El contrato admite también la dirección que el servidor local entrega sin una Request cuando el fallo es anterior
 * a ella
 * (plataforma/node/servidor.ts).
 *
 * @param peticion - Las cabeceras, el método y la dirección de la petición.
 * @param error - El error interno.
 * @returns El identificador de la petición.
 */
export function registrarErrorInterno(peticion: Pick<Request, 'headers' | 'method' | 'url'>, error: unknown): string {
  const ray = peticion.headers.get('cf-ray') ?? '';
  const id = IDENTIFICADOR_DE_CLOUDFLARE.test(ray) ? ray : crypto.randomUUID();
  const tipo =
    TIPOS_NATIVOS.find((clase) => error instanceof clase)?.name ?? (error instanceof Error ? 'Error' : typeof error);
  console.error(
    JSON.stringify({
      suceso: 'error interno',
      metodo: METODOS_HTTP.has(peticion.method) ? peticion.method : 'otro',
      estado: 500,
      tipo,
      peticion: id,
    }),
  );
  return id;
}

/** Causas técnicas acotadas de una capacidad operativa fallida. Ningún campo copia mensajes ni nombres recibidos. */
const CODIGOS_OPERATIVOS: ReadonlySet<string> = new Set([
  'ERR_SQLITE_ERROR',
  'SQLITE_BUSY',
  'SQLITE_CORRUPT',
  'SQLITE_NOTADB',
  'SQLITE_FULL',
  'no_configurado',
]);
/** Una capacidad operativa fallida al atender una petición, que responde 503. */
export function registrarErrorOperativo(
  operacion: 'controles' | 'registro-conectividad' | 'descripcion-conectividad' | 'montaje-conectividad',
  error: unknown,
): void {
  registrarFallo(operacion, ESTADO_HTTP.noDisponible, error);
}
/** Una tarea de mantenimiento fallida (del objeto durable o del servidor Node); no responde a ninguna petición, así que no lleva estado HTTP. */
export function registrarFalloMantenimiento(
  operacion: 'registro-conectividad' | 'retirada-sesiones' | 'retirada-intentos',
  error: unknown,
): void {
  registrarFallo(operacion, null, error);
}
function registrarFallo(operacion: string, estado: number | null, error: unknown): void {
  const tipo =
    TIPOS_NATIVOS.find((clase) => error instanceof clase)?.name ?? (error instanceof Error ? 'Error' : typeof error);
  const descriptor =
    error !== null && typeof error === 'object'
      ? (Object.getOwnPropertyDescriptor(error, 'code') ?? Object.getOwnPropertyDescriptor(error, 'codigo'))
      : undefined;
  const codigo =
    descriptor &&
    'value' in descriptor &&
    typeof descriptor.value === 'string' &&
    CODIGOS_OPERATIVOS.has(descriptor.value)
      ? descriptor.value
      : null;
  console.error(
    JSON.stringify({ suceso: 'fallo operativo', operacion, estado, tipo, codigo, peticion: crypto.randomUUID() }),
  );
}
