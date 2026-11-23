// Una lectura pública confirmada nunca se sustituye por booleanos cuando falla la red o el contrato.
import { esObjeto } from '../json.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../protocolo-web.js';
import { CuerpoDeConectividadInvalido, leerCuerpoDeConectividad } from './cuerpo.js';

const PLAZO_MS = 6000;
const RUTA = new URL('../../api/conectividad/estado', import.meta.url);

/** @typedef {'sin-conexion'|'no-disponible'} Motivo */
export class ConectividadNoComprobada extends Error {
  /** @param {Motivo} motivo */
  constructor(motivo) {
    super('No se ha podido comprobar la conectividad');
    this.motivo = motivo;
  }
}
/** @param {unknown} valor @param {readonly string[]} claves */
function forma(valor, claves) {
  if (
    !esObjeto(valor) ||
    Object.keys(valor).length !== claves.length ||
    !claves.every((c) => Object.hasOwn(valor, c))
  ) {
    throw new ConectividadNoComprobada('no-disponible');
  }
  return valor;
}

/** Solo los tres estados que ha confirmado el servidor; no convierte valores ni deduce un apagado.
 * @param {unknown} entrada */
export function leerEstadoConectividad(entrada) {
  const dato = forma(entrada, ['version', 'comprobadoEn', 'servicios']);
  const servicios = forma(dato.servicios, ['mcp', 'api', 'a2a']);
  if (
    dato.version !== 1 ||
    typeof dato.comprobadoEn !== 'string' ||
    !Number.isFinite(Date.parse(dato.comprobadoEn)) ||
    new Date(dato.comprobadoEn).toISOString() !== dato.comprobadoEn ||
    typeof servicios.mcp !== 'boolean' ||
    typeof servicios.api !== 'boolean' ||
    typeof servicios.a2a !== 'boolean'
  ) {
    throw new ConectividadNoComprobada('no-disponible');
  }
  return Object.freeze({
    version: /** @type {const} */ (1),
    comprobadoEn: dato.comprobadoEn,
    servicios: Object.freeze({ mcp: servicios.mcp, api: servicios.api, a2a: servicios.a2a }),
  });
}

/** @param {unknown} error */
function falloDeTransporte(error) {
  return (
    error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
  );
}

/** @param {Response} respuesta */
async function leerRespuesta(respuesta) {
  if (
    !respuesta.ok ||
    !respuesta.headers
      .get('cache-control')
      ?.split(',')
      .some((c) => c.trim().toLowerCase() === 'no-store')
  ) {
    throw new ConectividadNoComprobada('no-disponible');
  }
  let cuerpo;
  try {
    cuerpo = await leerCuerpoDeConectividad(respuesta);
  } catch (error) {
    if (!(error instanceof CuerpoDeConectividadInvalido)) {
      throw error;
    }
    throw new ConectividadNoComprobada('no-disponible');
  }
  let dato;
  try {
    dato = JSON.parse(cuerpo);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new ConectividadNoComprobada('no-disponible');
  }
  return leerEstadoConectividad(dato);
}

/** El plazo incluye el cuerpo; no-store y el contrato del servidor impiden usar una copia antigua como comprobación.
 * @param {{pedir?:typeof fetch,signal?:AbortSignal,enLinea?:()=>boolean}} [opciones] */
export async function consultarConectividad({ pedir = fetch, signal, enLinea = () => navigator.onLine } = {}) {
  const corte = new AbortController();
  const cancelar = () => corte.abort();
  signal?.addEventListener('abort', cancelar, { once: true });
  if (signal?.aborted) {
    cancelar();
  }
  const temporizador = setTimeout(cancelar, PLAZO_MS);
  try {
    const respuesta = await pedir(RUTA.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal: corte.signal,
      headers: { Accept: 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
    });
    return await leerRespuesta(respuesta);
  } catch (error) {
    if (falloDeTransporte(error)) {
      throw new ConectividadNoComprobada(enLinea() ? 'no-disponible' : 'sin-conexion');
    }
    throw error;
  } finally {
    clearTimeout(temporizador);
    signal?.removeEventListener('abort', cancelar);
  }
}

/** @typedef {ReturnType<typeof leerEstadoConectividad>} LecturaConectividad */
/** @typedef {{estado:'consultando'}|{estado:'confirmado',lectura:LecturaConectividad}|{estado:Motivo}} EstadoConsulta */
/** Última petición vigente; retirar la página invalida cualquier respuesta pendiente.
 * @param {{alCambiar:(estado:EstadoConsulta)=>void,pedir?:typeof fetch,enLinea?:()=>boolean}} opciones */
export function crearConsultaConectividad({ alCambiar, pedir, enLinea }) {
  /** @type {AbortController|null} */
  let actual = null;
  let generacion = 0;
  let retirada = false;
  const opciones = { ...(pedir ? { pedir } : {}), ...(enLinea ? { enLinea } : {}) };
  /** @param {number} propia @param {EstadoConsulta} estado */
  const publicar = (propia, estado) => {
    if (!retirada && propia === generacion) {
      alCambiar(estado);
    }
  };
  return Object.freeze({
    comprobar: async () => {
      if (retirada) {
        return;
      }
      const propia = ++generacion;
      actual?.abort();
      actual = new AbortController();
      alCambiar({ estado: 'consultando' });
      try {
        const lectura = await consultarConectividad({ ...opciones, signal: actual.signal });
        publicar(propia, { estado: 'confirmado', lectura });
      } catch (error) {
        publicar(propia, { estado: error instanceof ConectividadNoComprobada ? error.motivo : 'no-disponible' });
        if (!(error instanceof ConectividadNoComprobada)) {
          throw error;
        }
      }
    },
    retirar: () => {
      retirada = true;
      generacion++;
      actual?.abort();
      actual = null;
    },
  });
}
