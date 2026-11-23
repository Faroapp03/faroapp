/** Calcula, comprueba o regenera las huellas CSP de la pantalla de acceso desde su HTML final, sin publicar. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAGINA_ACCESO_WEB } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import {
  contenidoDeEtiqueta,
  type HuellasCsp,
  huellaCsp,
  huellasDesactualizadas,
  sustituirHuellas,
} from './actualizar-portada.ts';

const ARCHIVO = new URL('../../src/plataforma/cloudflare/acceso-web-pagina.ts', import.meta.url);
const USO = 'node herramientas/cloudflare/actualizar-acceso-web.ts [--comprobar]';

/** Huellas del estilo y del guion de la pantalla de acceso, calculadas desde su HTML final. */
export function huellasDeAccesoWeb(html: string): HuellasCsp {
  return {
    CSP_ESTILO_ACCESO_WEB: huellaCsp(contenidoDeEtiqueta(html, 'style')),
    CSP_GUION_ACCESO_WEB: huellaCsp(contenidoDeEtiqueta(html, 'script')),
  };
}

/** Comprueba sin escribir, o sustituye en el módulo las huellas que no coinciden con su HTML. */
function principal(): void {
  const { values } = orden(USO).leer({ options: { comprobar: { type: 'boolean' } } });
  const fuente = readFileSync(ARCHIVO, 'utf8');
  const huellas = huellasDeAccesoWeb(PAGINA_ACCESO_WEB);
  const desactualizadas = huellasDesactualizadas(fuente, huellas);
  if (values.comprobar) {
    if (desactualizadas.length > 0) {
      throw new Error(
        `huellas que no coinciden con su HTML en ${fileURLToPath(ARCHIVO)}: ${desactualizadas.join(', ')}; ` +
          'se recalculan con npm run cloudflare:actualizar-acceso-web',
      );
    }
    console.log('Huellas CSP de la pantalla de acceso al día');
    return;
  }
  if (desactualizadas.length === 0) {
    console.log('Huellas CSP de la pantalla de acceso ya al día; no se escribe el módulo');
    return;
  }
  writeFileSync(ARCHIVO, sustituirHuellas(fuente, huellas));
  console.log(`Huellas CSP de la pantalla de acceso actualizadas: ${desactualizadas.join(', ')}`);
}

if (import.meta.main) {
  await ejecutar(principal, 'Huellas CSP de la pantalla de acceso');
}
