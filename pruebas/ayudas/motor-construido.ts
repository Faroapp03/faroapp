/**
 * Precarga de la batería Node: los guiones de web/ importan el motor por su dirección fija (motor/src/…), que solo
 * existe en la web construida. Las importaciones que caen en web/motor/ se resuelven al motor empaquetado de la web
 * local vigente (.web-local/web/motor/, npm run web:preparar), el mismo que se publica.
 */
import { createRequire, registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EN_LAS_FUENTES = new URL('../../web/motor/', import.meta.url).href;
const requerir = createRequire(import.meta.url);
let construido: string | undefined;

/**
 * El motor de la web local vigente, comprobada una sola vez, en la primera importación que lo pide. web-local.ts se
 * carga aquí y no al arrancar: importa rutas.ts, y cargarlo en la precarga fijaría RUTAS antes de que una prueba lo
 * sustituya (plataforma-composicion.test.ts).
 */
function motorConstruido(): string {
  if (construido === undefined) {
    const { WEB_LOCAL, webLocalVigente } = requerir(
      '../../herramientas/web/web-local.ts',
    ) as typeof import('../../herramientas/web/web-local.ts');
    construido = webLocalVigente(process.env.FARO_WEB_LOCAL_DE_PRUEBA || WEB_LOCAL)?.web;
  }
  if (construido === undefined) {
    throw new Error('Falta la web local de estas fuentes (.web-local/): ejecuta antes npm run web:preparar');
  }
  return pathToFileURL(join(construido, 'motor/')).href;
}

/** La dirección que nombra un especificador relativo o de archivo, si se puede saber sin resolverlo. */
function direccion(especificador: string, padre: string | undefined): string | undefined {
  if (!(especificador.startsWith('.') || especificador.startsWith('/') || especificador.startsWith('file:'))) {
    return undefined;
  }
  try {
    return new URL(especificador, padre).href;
  } catch {
    return undefined;
  }
}

registerHooks({
  resolve(especificador, contexto, siguiente) {
    const url = direccion(especificador, contexto.parentURL);
    if (url === undefined || !url.startsWith(EN_LAS_FUENTES)) {
      return siguiente(especificador, contexto);
    }
    return siguiente(motorConstruido() + url.slice(EN_LAS_FUENTES.length), contexto);
  },
});
