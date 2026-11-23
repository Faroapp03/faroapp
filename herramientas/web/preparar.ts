// La preparación de la web construida: guiones con huella, mapas de integridad, catálogos PWA y el service worker
// publicado (construido desde src/service-worker/ con esos catálogos), sobre la candidata de una construcción
// (construir.ts), con el paquete del navegador y el motor empaquetado de su contexto; y su comprobación. Las fuentes de
// web/ no llevan nada de eso: npm run web:preparar construye la web local (.web-local/, construir --local) y npm run
// web:comprobar comprueba que las fuentes no llevan generados (el service worker, los guiones con su huella, el
// marcador de versión fijado, el motor ni el manifiesto del dispositivo) y que el lector del catálogo está al día.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUELLA_DEL_MAPA_DE_MODULOS } from '../../src/plataforma/mapa-de-modulos.ts';
import { CARPETA_DEL_PAQUETE } from '../../src/plataforma/paquete-publicado.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import { CARPETA_DEL_MOTOR } from './carpeta-del-motor.ts';
import { artefactosCatalogo } from './catalogo-cursos.ts';
import type { ContextoWeb } from './contexto.ts';
import { comprobarServiceWorker, generarCatalogos } from './copia-sin-conexion.ts';
import { comprobarCspHtml, comprobarCspScripts } from './csp.ts';
import { sinComentariosHtml } from './etiquetas.ts';
import {
  comprobarGuionesConHuella,
  guionesConHuellaEnLasFuentes,
  prepararGuionesConHuella,
} from './guiones-con-huella.ts';
import { comprobarIntegridad, corregirIntegridad, problemasDeLaFuente } from './integridad.ts';
import { MANIFIESTO_PUBLICADO } from './manifiesto-del-dispositivo.ts';
import { comprobarPagina } from './paginas.ts';
import { comprobarPrimerAnalisis } from './primer-analisis.ts';
import { archivosPublicados, leer, SERVICE_WORKER, WEB } from './publicados.ts';
import { marcadorNormalizado, PAGINAS_CON_VERSION, VERSION_VACIA } from './version-copia.ts';

/** Los únicos destinos generados del lector; los scripts manuscritos no pasan por este compilador. */
function lectorDelCatalogo(web: string): ReadonlyMap<string, string> {
  const origen = fileURLToPath(new URL('../../web/', import.meta.url));
  return new Map(
    [...artefactosCatalogo()].map(([ruta, texto]) => [join(web, fileURLToPath(ruta).slice(origen.length)), texto]),
  );
}
function comprobarLector(web: string): string[] {
  return [...lectorDelCatalogo(web)].flatMap(([ruta, esperado]) =>
    !existsSync(ruta) || readFileSync(ruta, 'utf8') !== esperado ? [`Lector de Cursos desactualizado: ${ruta}`] : [],
  );
}

/** Lo que solo genera la construcción y no puede quedar en las fuentes de web/. */
const SOLO_EN_LA_CONSTRUCCION = [SERVICE_WORKER, CARPETA_DEL_MOTOR, CARPETA_DEL_PAQUETE, MANIFIESTO_PUBLICADO] as const;

/**
 * Las fuentes de web/ sin nada generado y con el lector del catálogo al día: lo generado vive en la web construida.
 *
 * @param web - Las fuentes de la web; por omisión, web/ de la instalación.
 * @returns Un problema por cada generado presente o desactualizado; vacío si las fuentes están limpias.
 */
export function comprobarFuentesDeLaWeb(web: string = WEB): string[] {
  return [
    ...comprobarLector(web),
    ...SOLO_EN_LA_CONSTRUCCION.filter((ruta) => existsSync(join(web, ruta))).map(
      (ruta) => `${ruta}: lo genera la construcción en la web construida; no va en las fuentes de web/`,
    ),
    ...guionesConHuellaEnLasFuentes(web),
    ...(HUELLA_DEL_MAPA_DE_MODULOS === ''
      ? []
      : ['src/plataforma/mapa-de-modulos.ts: es una plantilla neutra; en las fuentes, su huella es la cadena vacía']),
    ...archivosPublicados(web)
      .filter((pagina) => pagina.endsWith('.html'))
      .flatMap((pagina) => problemasDeLaFuente(pagina, leer(pagina, web))),
    ...[...PAGINAS_CON_VERSION]
      .filter((pagina) => existsSync(join(web, pagina)))
      .filter((pagina) => {
        const bytes = readFileSync(join(web, pagina));
        return !Buffer.from(marcadorNormalizado(pagina, bytes)).equals(bytes);
      })
      .map((pagina) => `${pagina}: en las fuentes, el marcador de versión es ${VERSION_VACIA}`),
  ];
}

/** Estructura básica, CSP, integridad y copia sin conexión; los flujos completos se comprueban en navegador. */
export async function comprobarWeb(huellaDelMapa: string, contexto: ContextoWeb): Promise<string[]> {
  const { web } = contexto;
  const publicados = archivosPublicados(web);
  const paginas = new Map(
    publicados.filter((archivo) => archivo.endsWith('.html')).map((archivo) => [archivo, leer(archivo, web)]),
  );
  return [
    ...comprobarGuionesConHuella(web),
    ...[...paginas].flatMap(([archivo, html]) => [
      ...comprobarPagina(archivo, sinComentariosHtml(html)),
      ...comprobarCspHtml(archivo, sinComentariosHtml(html), web),
    ]),
    ...comprobarCspScripts(publicados, web, contexto.paqueteNavegador),
    ...comprobarIntegridad(publicados, paginas, huellaDelMapa, contexto),
    ...comprobarPrimerAnalisis(),
    ...(await comprobarServiceWorker(publicados, huellaDelMapa, contexto)),
  ];
}

/** Genera en la candidata de la construcción, sin firmar ni desplegar; las fuentes de web/ no se escriben. */
export async function prepararWeb(contexto: ContextoWeb): Promise<string> {
  const { web } = contexto;
  if (realpathSync(web) === realpathSync(WEB)) {
    throw new Error('La preparación escribe en la candidata de una construcción, nunca en las fuentes de web/');
  }
  prepararGuionesConHuella(web);
  const publicados = archivosPublicados(web);
  const huella = corregirIntegridad(publicados, contexto);
  await generarCatalogos(publicados, huella, contexto);
  return huella;
}

/** La comprobación de las fuentes de web/; la web se prepara construyéndola (npm run web:preparar). */
function principal(): void {
  const { values } = orden('node herramientas/web/preparar.ts --comprobar').leer({
    options: { comprobar: { type: 'boolean' } },
  });
  if (!values.comprobar) {
    throw new Error('La web se prepara al construirla: npm run web:preparar (construir --local)');
  }
  const problemas = comprobarFuentesDeLaWeb();
  if (problemas.length) {
    throw new Error(problemas.join('\n'));
  }
  console.log('Fuentes de la web sin generados y lector del catálogo al día');
}

if (import.meta.main) {
  await ejecutar(principal, 'Fuentes de la web');
}
