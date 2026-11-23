// Conserva solo la última respuesta del informe mientras siga vigente su ocupación e idioma.
import { idiomaActual } from '../../textos.js';
import { estado } from '../estado.js';
import { leerAcreditaciones } from './acreditacion-datos.js';

/** @import { Idioma } from '../../textos.js' */
/** @type {{informe:unknown, ocupacion:import('../estado.js').Ocupacion, idioma:Idioma} | null} */
let ultimo = null;
/** @param {unknown} informe @param {import('../estado.js').Ocupacion|null} ocupacion @param {Idioma} idioma */
export function registrarAcreditacion(informe, ocupacion, idioma) {
  ultimo = ocupacion && estado.ocupacion === ocupacion && informe ? { informe, ocupacion, idioma } : null;
}
export function olvidarAcreditacion() {
  ultimo = null;
}
/** @param {Promise<boolean>|null} pendiente @param {AbortSignal} signal */
export async function obtenerAcreditaciones(pendiente, signal) {
  if (pendiente && !signal.aborted) {
    /** @type {() => void} */
    let cancelar = () => {};
    const cancelada = new Promise((resolver) => {
      cancelar = () => resolver(undefined);
      signal.addEventListener('abort', cancelar, { once: true });
    });
    try {
      await Promise.race([pendiente, cancelada]);
    } finally {
      signal.removeEventListener('abort', cancelar);
    }
  }
  const resultado = ultimo;
  if (signal.aborted || !resultado || estado.ocupacion !== resultado.ocupacion || idiomaActual() !== resultado.idioma) {
    return [];
  }
  return leerAcreditaciones(resultado.informe, {
    esco: resultado.ocupacion.esco,
    isco08: resultado.ocupacion.isco08,
    idioma: resultado.idioma,
  });
}
