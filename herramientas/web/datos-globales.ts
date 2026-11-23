// Publicación local de los datos globales y de su lector compartido. Conserva los bytes del JSON validado;
// el JavaScript se obtiene borrando tipos y resolviendo las rutas declaradas, sin compilar en el navegador.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerDatosGlobales } from '../../src/datos-globales/datos.ts';
import { formatearTextoConBiome } from '../comun/archivos.ts';
import { ejecutar, orden } from '../comun/opciones.ts';

const RAIZ = new URL('../../', import.meta.url);
const USO = 'node herramientas/web/datos-globales.ts [--comprobar]';
/** Fuentes únicas y sus artefactos locales. El JSON no pertenece al manifiesto del paquete ocupacional. */
export const PUBLICACIONES_GLOBALES = {
  'src/comun/json.ts': 'web/scripts/json.js',
  'src/datos-globales/contrato.ts': 'web/scripts/datos-globales/contrato.js',
  'src/datos-globales/calculados.ts': 'web/scripts/datos-globales/calculados.js',
  'src/datos-globales/datos.ts': 'web/scripts/datos-globales/datos.js',
  'datos/globales/datos-globales.json': 'web/datos/datos-globales.json',
} as const;
/** Los imports y los @import de JSDoc usan las mismas rutas del artefacto. */
const RUTAS_PUBLICADAS = {
  '../comun/json.ts': '../json.js',
  './contrato.ts': './contrato.js',
  './calculados.ts': './calculados.js',
} as const;

/** Una fuente válida antes de generar cualquier destino: no publica muestras ni reserializa las cifras. */
function datosPublicables(texto: string): string {
  const valor: unknown = JSON.parse(texto);
  if (leerDatosGlobales(valor).muestra) {
    throw new Error('Los datos globales de muestra no se publican');
  }
  return texto;
}

/** Resuelve únicamente los especificadores declarados, también en los tipos conservados como JSDoc. */
function javascriptPublicado(texto: string, destino: string): string {
  let javascript = stripTypeScriptTypes(texto);
  for (const [origen, publicado] of Object.entries(RUTAS_PUBLICADAS)) {
    javascript = javascript.replaceAll(`'${origen}'`, `'${publicado}'`);
  }
  return formatearTextoConBiome(javascript, destino);
}

/** Prepara todos los artefactos antes de escribir: si una fuente falla, ningún destino se modifica. */
export function artefactosGlobales(raiz: URL = RAIZ): ReadonlyMap<URL, string> {
  const artefactos = new Map<URL, string>();
  for (const [origen, destino] of Object.entries(PUBLICACIONES_GLOBALES)) {
    const texto = readFileSync(new URL(origen, raiz), 'utf8');
    const contenido = origen.endsWith('.json') ? datosPublicables(texto) : javascriptPublicado(texto, destino);
    artefactos.set(new URL(destino, raiz), contenido);
  }
  return artefactos;
}

/** Comprobar nunca escribe; generar prepara el artefacto local, sin subirlo ni desplegarlo. */
function principal(): void {
  const { values } = orden(USO).leer({ options: { comprobar: { type: 'boolean' } } });
  for (const [archivo, contenido] of artefactosGlobales()) {
    if (values.comprobar) {
      if (readFileSync(archivo, 'utf8') !== contenido) {
        throw new Error(`Publicación desactualizada: ${fileURLToPath(archivo)}`);
      }
    } else {
      mkdirSync(dirname(fileURLToPath(archivo)), { recursive: true });
      writeFileSync(archivo, contenido);
    }
  }
  console.log(values.comprobar ? 'Datos globales publicados al día' : 'Artefactos locales de datos globales generados');
}

if (import.meta.main) {
  await ejecutar(principal, 'Datos globales');
}
