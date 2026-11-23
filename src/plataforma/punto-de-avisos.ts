// El punto que recibe los avisos técnicos del navegador en RUTA_DE_AVISOS (cabeceras-web.ts): solo POST con
// application/reports+json (Reporting API, 2.2), con tope de bytes (el de la API), de informes por envío y de envíos
// por minuto en cada instancia, sin mirar quién los manda. El tope de envíos es de cada instancia, no del despliegue
// entero: cada instancia del Worker lleva su propia cuenta. Las dos entradas de Cloudflare lo atienden sin sesión ni
// credencial (cloudflare/canales-portal.ts). No hay almacén: de cada envío aceptado que no venga vacío escribe una sola
// línea en la consola de la instancia (console.log en el Worker, con la observabilidad desactivada) con los avisos
// mínimos (avisos-del-navegador.ts) y cuántos informes se descartaron y por qué. pruebas/plataforma/plataforma-avisos.test.ts
// comprueba los campos de esa línea, los descartes y los topes; no se copian las rutas ni los textos libres de los
// informes.

import { leerTextoLimitado } from '../api/cuerpo.ts';
import {
  type Problema,
  problema,
  registrarErrorInterno,
  respuestaConProblema,
  respuestaDeError,
  respuestaDeProblema,
  SolicitudInvalida,
} from '../api/http.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../comun/tiempo.ts';
import { avisosDelEnvio } from './avisos-del-navegador.ts';

/** El tipo con que el navegador envía los informes (Reporting API, 2.2): con otro, 415. */
export const TIPO_DE_LOS_INFORMES = 'application/reports+json';
/**
 * Informes que se leen de un envío: el navegador agrupa los de un mismo origen (Reporting API, 3.5.1) y una página sin
 * fallos no genera ninguno; más allá, solo se cuentan.
 */
export const MAX_INFORMES_POR_ENVIO = 20;
/**
 * Envíos que atiende cada instancia por minuto, vengan de quien vengan: el tope protege la consola, que es donde se
 * escriben los avisos, de quien la llene a propósito. Es de cada instancia, no un tope global del despliegue. No se
 * cuenta por IP para no tener que leerla.
 */
export const MAX_ENVIOS_POR_MINUTO = 30;
/** El único método que admite el punto. */
const METODO = 'POST';
/** El suceso de cada línea del registro, para buscarlas. */
const SUCESO = 'avisos del navegador';

/** Lo que se puede cambiar en las pruebas: dónde se registra cada línea y el reloj. */
export interface OpcionesDelPunto {
  registrar?: (linea: string) => void;
  ahora?: () => number;
}

/** El punto de avisos: atiende cada petición que llega a RUTA_DE_AVISOS. */
export type PuntoDeAvisos = (peticion: Request) => Promise<Response>;

/** La ventana de un minuto de una instancia: cuándo empezó y cuántos envíos lleva. */
interface Ventana {
  inicio: number;
  envios: number;
}

/** Un problema de este punto, en Problem Details como los de la API, con las cabeceras que se añadan. */
function respuestaDeProblemaDelPunto(
  peticion: Request,
  cuerpo: Problema,
  cabeceras: Record<string, string> = {},
): Response {
  const respuesta = respuestaDeProblema(cuerpo);
  return respuestaConProblema(peticion, [], { ...respuesta, cabeceras: { ...respuesta.cabeceras, ...cabeceras } });
}

/** El tipo declarado del cuerpo, sin parámetros y en minúsculas. */
function tipoDeclarado(peticion: Request): string {
  const [tipo = ''] = (peticion.headers.get('content-type') ?? '').split(';');
  return tipo.trim().toLowerCase();
}

/** Si el envío cabe en la ventana del minuto, y la cuenta; si no, los segundos hasta que se abra la siguiente. */
function cabeEnLaVentana(ventana: Ventana, ahora: number): true | number {
  if (ahora - ventana.inicio >= MS_POR_MINUTO) {
    ventana.inicio = ahora;
    ventana.envios = 0;
  }
  if (ventana.envios >= MAX_ENVIOS_POR_MINUTO) {
    return Math.max(1, Math.ceil((ventana.inicio + MS_POR_MINUTO - ahora) / MS_POR_SEGUNDO));
  }
  ventana.envios += 1;
  return true;
}

/** Lee el envío, se queda con los avisos mínimos y deja su línea en el registro; 400 si no es una lista de informes. */
async function registrarEnvio(peticion: Request, opciones: Required<OpcionesDelPunto>): Promise<Response> {
  let datos: unknown;
  try {
    datos = JSON.parse(await leerTextoLimitado(peticion));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SolicitudInvalida('el cuerpo no es JSON');
    }
    throw error;
  }
  const origenPropio = new URL(peticion.url).origin;
  const envio = avisosDelEnvio(datos, origenPropio, opciones.ahora(), MAX_INFORMES_POR_ENVIO);
  if (envio === null) {
    throw new SolicitudInvalida('el cuerpo no es una lista de informes');
  }
  // Un envío vacío no deja línea: no hay nada que contar.
  if (envio.avisos.length > 0 || Object.keys(envio.descartados).length > 0) {
    opciones.registrar(JSON.stringify({ suceso: SUCESO, ...envio }));
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/**
 * El punto de avisos de una instancia (el Worker o el servidor local), con su propia ventana de envíos por minuto.
 * Responde 204 a lo que acepta, aunque descarte informes: el navegador lo da por entregado y no lo repite (Reporting
 * API, 3.5.2). 405 a otro método, 415 a otro tipo, 429 con Retry-After pasado el tope y 400 a un cuerpo que no es una
 * lista de informes o pasa del tope de bytes.
 *
 * @param opciones - El destino del registro y el reloj; por defecto, console.log y Date.now.
 * @returns La función que atiende cada petición al punto de avisos.
 */
export function crearPuntoDeAvisos(opciones: OpcionesDelPunto = {}): PuntoDeAvisos {
  const completas: Required<OpcionesDelPunto> = {
    registrar: opciones.registrar ?? ((linea) => console.log(linea)),
    ahora: opciones.ahora ?? Date.now,
  };
  // El dueño de este estado es el punto: una ventana por instancia, que vive lo que viva la instancia.
  const ventana: Ventana = { inicio: Number.NEGATIVE_INFINITY, envios: 0 };
  return async (peticion) => {
    if (peticion.method !== METODO) {
      const detalle = `El punto de avisos solo admite ${METODO}.`;
      return respuestaDeProblemaDelPunto(
        peticion,
        problema(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido', detalle),
        { allow: METODO },
      );
    }
    if (tipoDeclarado(peticion) !== TIPO_DE_LOS_INFORMES) {
      const detalle = `El cuerpo debe enviarse como ${TIPO_DE_LOS_INFORMES}.`;
      return respuestaDeProblemaDelPunto(peticion, problema(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido', detalle));
    }
    const cabe = cabeEnLaVentana(ventana, completas.ahora());
    if (cabe !== true) {
      const detalle = 'El punto de avisos ha recibido muchos envíos. Vuelve a intentarlo más tarde.';
      const demasiados = problema(ESTADO_HTTP.demasiadasPeticiones, 'demasiadas_peticiones', detalle);
      return respuestaDeProblemaDelPunto(peticion, demasiados, { 'retry-after': String(cabe) });
    }
    try {
      return await registrarEnvio(peticion, completas);
    } catch (error) {
      // Como en la API: un 400 lleva su motivo; un fallo inesperado, un 500 con su rastro sin nada de quien envía.
      const respuesta = respuestaDeError(error);
      if (respuesta.estado === ESTADO_HTTP.errorInterno) {
        registrarErrorInterno(peticion, error);
      }
      return respuestaConProblema(peticion, [], respuesta);
    }
  };
}
