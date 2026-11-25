// Generado desde src/administracion/avisos-catalogo-datos.js; no editar esta copia.
import { claveInstante, entero, exigir, instantePreciso, objeto, unoDe } from './lectura-estricta.js';

/** Los enlaces de la formación que la comprobación dice haber comprobado, ocultado y dejado sin comprobar: solo viaja con valor.
 * @param {unknown} entrada @returns {import('./estado-datos.js').EnlacesDatos}
 */
export function leerEnlaces(entrada) {
  const valor = objeto(entrada, ['comprobados', 'ocultos', 'sinComprobar']);
  const comprobados = entero(valor.comprobados);
  const ocultos = entero(valor.ocultos);
  const sinComprobar = entero(valor.sinComprobar);
  exigir(ocultos <= comprobados + sinComprobar);
  return Object.freeze({ comprobados, ocultos, sinComprobar });
}
/** @param {unknown} entrada @returns {import('./estado-datos.js').RetencionComposicionDatos} */
export function leerRetencionComposicion(entrada) {
  const { motivo, desde, versionEn } = objeto(entrada, ['motivo', 'desde', 'versionEn']);
  const aviso = {
    motivo: unoDe(motivo, ['documento-excesivo']),
    desde: instantePreciso(desde),
    versionEn: instantePreciso(versionEn),
  };
  exigir(claveInstante(aviso.versionEn) <= claveInstante(aviso.desde));
  return Object.freeze(aviso);
}
