// El grafo de módulos de las páginas: qué módulos carga cada una, al abrirse y con lo que pide después con import().
// Lo da el grafo emitido del paquete (empaquetado.ts). Lo usa el mapa de integridad de cada página (integridad.ts).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextoWeb } from './contexto.ts';

/** Una etiqueta <script> o <link>, con la plantilla de carga que la envuelve si la hay. */
export const BLOQUE_DE_GUION =
  /(?:<template data-faro-carga\s*>\s*)?(<script\b[^>]*>\s*<\/script\s*>|<link\b[^>]*>)(?:\s*<\/template\s*>)?/g;

/** El valor de un atributo escrito entre comillas dobles en una etiqueta, si lo tiene. */
export function atributo(etiqueta: string, nombre: string): string | undefined {
  return new RegExp(`\\s${nombre}="([^"]*)"`).exec(etiqueta)?.[1];
}

/** La ruta desde web/ de una dirección escrita en una página. */
function desdeLaWeb(pagina: string, direccion: string): string {
  return decodeURIComponent(new URL(direccion, new URL(pagina, 'https://faro.invalid/')).pathname.slice(1));
}

/** Los módulos que carga una página, desde web/ y en su orden. */
export function modulosDeLaPagina(ruta: string, html: string): string[] {
  return [...html.matchAll(BLOQUE_DE_GUION)].flatMap(([, etiqueta = '']) => {
    const src = etiqueta.startsWith('<script') ? atributo(etiqueta, 'src') : undefined;
    return src !== undefined && atributo(etiqueta, 'type') === 'module' ? [desdeLaWeb(ruta, src)] : [];
  });
}

/** Los bytes de un archivo de la web: los del paquete si es suyo; si no, los de la carpeta. Null si no existe. */
export function bytesDeLaWeb(archivo: string, contexto: ContextoWeb): Uint8Array | null {
  const delPaquete = contexto.paqueteNavegador?.get(archivo);
  if (delPaquete) {
    return delPaquete;
  }
  const ruta = join(contexto.web, archivo.replace(/^\.\//, ''));
  return existsSync(ruta) ? readFileSync(ruta) : null;
}

/**
 * Los módulos que puede cargar una página, desde web/, al abrirse y con import(): su entrada y sus trozos según el grafo
 * emitido por el empaquetado (ContextoWeb.grafoEmitido).
 *
 * @throws {Error} Si el contexto no trae el grafo emitido.
 */
export function modulosQueCarga(pagina: string, contexto: ContextoWeb): string[] {
  if (!contexto.grafoEmitido) {
    throw new Error('Falta el grafo emitido de la construcción: los módulos de una página salen del empaquetado');
  }
  const grafo = contexto.grafoEmitido.paginas[pagina];
  return grafo ? [grafo.entrada, ...grafo.estaticos, ...grafo.dinamicos] : [];
}
