/** Política pública v4: revisión local a cada autoridad, con decisión y escritura bajo el mismo lock. */
import { leerDocumentoSecciones, VERSION_SECCIONES_PUBLICAS } from './secciones-contrato.js';

const UUID_AUTORIDAD = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAXIMO_POLITICA = 8192;
/** La política pública v3, sin la Encuesta, que guardan los navegadores y las copias sin conexión ya instaladas. */
const VERSION_PUBLICA_ANTERIOR = 3;
/** La versión del contrato de secciones que lleva la política pública vigente. */
const VERSION_CONTRATO = 3;
const HTTP_OK = 200;
class AlmacenNoDisponible extends Error {}
/** @typedef {import('./secciones-contrato.js').DocumentoSecciones & {autoridad:string}} PoliticaAutoridad */
/** @typedef {{documento:PoliticaAutoridad|null, fallo:boolean}} ResultadoAutoridad */
/** @typedef {{match:(clave:string)=>Promise<Response|undefined>,put:(clave:string,respuesta:Response)=>Promise<void>}} CopiaAutoridad */
/** @typedef {{actual:PoliticaAutoridad|null,porAutoridad:Map<string,PoliticaAutoridad>,soloMemoria:boolean}} MemoriaAutoridad */
/** @typedef {{url:string,abrir:()=>Promise<CopiaAutoridad>,solicitar:()=>Promise<Response>,bloquear:((accion:()=>Promise<ResultadoAutoridad>)=>Promise<ResultadoAutoridad>)|null,memoria:MemoriaAutoridad}} OpcionesAutoridad */

/** @param {unknown} entrada @returns {PoliticaAutoridad} */
export function leerSeccionesPublicas(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new Error('Política inválida');
  }
  const dato = /** @type {Record<string,unknown>} */ (entrada);
  if (
    Object.keys(dato).sort().join(',') !== 'autoridad,revision,secciones,version' ||
    (dato.version !== VERSION_SECCIONES_PUBLICAS && dato.version !== VERSION_PUBLICA_ANTERIOR) ||
    typeof dato.autoridad !== 'string' ||
    !UUID_AUTORIDAD.test(dato.autoridad)
  ) {
    throw new Error('Autoridad inválida');
  }
  // Cada versión pública lleva la política de su contrato: la v3, la del contrato v2; la v4, la del v3.
  const leida = leerDocumentoSecciones({
    version: dato.version === VERSION_SECCIONES_PUBLICAS ? VERSION_CONTRATO : 2,
    revision: dato.revision,
    secciones: dato.secciones,
  });
  return { ...leida, autoridad: dato.autoridad };
}
/** @param {PoliticaAutoridad} documento */
function serializarAutoridad(documento) {
  return {
    version: VERSION_SECCIONES_PUBLICAS,
    autoridad: documento.autoridad,
    revision: documento.revision,
    secciones: documento.secciones,
  };
}
/** @param {CopiaAutoridad} copia @param {string} clave */
async function leerGuardada(copia, clave) {
  let respuesta;
  try {
    respuesta = await copia.match(clave);
  } catch {
    throw new AlmacenNoDisponible();
  }
  return respuesta ? leerSeccionesPublicas(JSON.parse(await respuesta.text())) : null;
}
/** @param {PoliticaAutoridad} a @param {PoliticaAutoridad} b */
function mismaPolitica(a, b) {
  return JSON.stringify(serializarAutoridad(a)) === JSON.stringify(serializarAutoridad(b));
}
/** @param {CopiaAutoridad} copia @param {string} url @returns {Promise<ResultadoAutoridad>} */
async function sinRed(copia, url) {
  const actual = await leerGuardada(copia, `${url}?actual=1`);
  if (!actual) {
    return { documento: null, fallo: false };
  }
  const historial = await leerGuardada(copia, `${url}?autoridad=${actual.autoridad}`);
  if (
    !historial ||
    historial.autoridad !== actual.autoridad ||
    historial.revision < actual.revision ||
    (historial.revision === actual.revision && !mismaPolitica(historial, actual))
  ) {
    return { documento: null, fallo: true };
  }
  return { documento: historial, fallo: false };
}
/** @param {PoliticaAutoridad} recibido @param {PoliticaAutoridad|null|undefined} anterior */
function elegirPolitica(recibido, anterior) {
  if (
    anterior &&
    (anterior.autoridad !== recibido.autoridad ||
      (anterior.revision === recibido.revision && !mismaPolitica(anterior, recibido)))
  ) {
    throw new Error('Política incoherente');
  }
  return anterior && anterior.revision > recibido.revision ? anterior : recibido;
}
/**
 * Lee y cierra el cuerpo de una respuesta que no se usa, hasta el tamaño máximo de una política: así la petición
 * termina en lugar de quedar abortada al descartarla. La respuesta ya está descartada, de modo que un fallo al leerla
 * no cambia el resultado.
 * @param {Response} respuesta
 */
async function descartarCuerpo(respuesta) {
  const lector = respuesta.body?.getReader();
  if (!lector) {
    return;
  }
  let leidos = 0;
  try {
    for (let trozo = await lector.read(); !trozo.done; trozo = await lector.read()) {
      leidos += trozo.value.byteLength;
      if (leidos > MAXIMO_POLITICA) {
        await lector.cancel();
        return;
      }
    }
  } catch {
    // Sin efecto en el resultado: la respuesta ya se ha dado por no válida.
  }
}
/** @param {OpcionesAutoridad} opciones @param {CopiaAutoridad|null} copia @returns {Promise<ResultadoAutoridad>} */
async function consultarConCopia(opciones, copia) {
  let respuesta;
  try {
    respuesta = await opciones.solicitar();
  } catch {
    const resultado = copia ? await sinRed(copia, opciones.url) : { documento: opciones.memoria.actual, fallo: false };
    if (resultado.documento) {
      opciones.memoria.actual = resultado.documento;
      opciones.memoria.porAutoridad.set(resultado.documento.autoridad, resultado.documento);
    }
    return resultado;
  }
  if (
    respuesta.status !== HTTP_OK ||
    respuesta.redirected ||
    respuesta.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    await descartarCuerpo(respuesta);
    return { documento: null, fallo: true };
  }
  const texto = await respuesta.text();
  if (texto.length > MAXIMO_POLITICA) {
    return { documento: null, fallo: true };
  }
  const recibido = leerSeccionesPublicas(JSON.parse(texto));
  const clave = `${opciones.url}?autoridad=${recibido.autoridad}`;
  const almacenado = copia ? await leerGuardada(copia, clave) : null;
  const elegido = elegirPolitica(recibido, almacenado);
  const vigente = elegirPolitica(elegido, opciones.memoria.porAutoridad.get(recibido.autoridad));
  if (copia) {
    try {
      await copia.put(clave, Response.json(serializarAutoridad(vigente)));
      await copia.put(`${opciones.url}?actual=1`, Response.json(serializarAutoridad(vigente)));
    } catch {
      opciones.memoria.soloMemoria = true;
    }
  }
  opciones.memoria.actual = vigente;
  opciones.memoria.porAutoridad.set(vigente.autoridad, vigente);
  return { documento: vigente, fallo: false };
}
/** @param {OpcionesAutoridad} opciones @returns {Promise<ResultadoAutoridad>} */
export async function consultarAutoridadSecciones(opciones) {
  try {
    if (!opciones.bloquear || opciones.memoria.soloMemoria) {
      return await consultarConCopia(opciones, null);
    }
    return await opciones.bloquear(async () => {
      let copia;
      try {
        copia = await opciones.abrir();
      } catch {
        copia = null;
        opciones.memoria.soloMemoria = true;
      }
      try {
        return await consultarConCopia(opciones, copia);
      } catch (error) {
        if (!(error instanceof AlmacenNoDisponible)) {
          throw error;
        }
        opciones.memoria.soloMemoria = true;
        return consultarConCopia(opciones, null);
      }
    });
  } catch {
    return { documento: null, fallo: true };
  }
}
