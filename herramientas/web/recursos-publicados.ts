// Comentarios de los recursos de salida: los analizadores se usan solo durante la construcción.
import { parse as analizarJavascript, type Comment } from 'acorn';
import { transformSync } from 'esbuild';
import { parse as analizarHtml, type DefaultTreeAdapterTypes, defaultTreeAdapter, serialize } from 'parse5';

interface Recorte {
  readonly inicio: number;
  readonly fin: number;
  readonly reemplazo: string;
}

/** Los avisos legales se conservan íntegros, incluida su posición entre los demás bytes. */
function avisoLegal(comentario: string): boolean {
  return /^(?:\/\*!|\/\/!|<!--!)|@(?:license|preserve)\b|\bcopyright\b|\bSPDX\b/i.test(comentario);
}

/** Aplica únicamente intervalos del analizador; el resto de los bytes no se vuelve a serializar. */
function sinRangos(texto: string, recortes: Recorte[]): string {
  let desde = 0;
  const partes: string[] = [];
  for (const { inicio, fin, reemplazo } of recortes.sort((a, b) => a.inicio - b.inicio)) {
    partes.push(texto.slice(desde, inicio), reemplazo);
    desde = fin;
  }
  partes.push(texto.slice(desde));
  return partes.join('');
}

/** Retira comentarios ordinarios de JavaScript válido sin reescribir tokens ni perder terminadores de línea. */
export function javascriptPublicado(texto: string, tipo: 'script' | 'module'): string {
  const comentarios: Comment[] = [];
  analizarJavascript(texto, { ecmaVersion: 'latest', sourceType: tipo, allowHashBang: true, onComment: comentarios });
  const recortes = comentarios.flatMap(({ start: inicio, end: fin }): Recorte[] => {
    const original = texto.slice(inicio, fin);
    if (original.startsWith('#!') || avisoLegal(original)) {
      return [];
    }
    const saltos = original.match(/[\r\n\u2028\u2029]/g) ?? [];
    return [{ inicio, fin, reemplazo: ` ${saltos.join('')}` }];
  });
  return sinRangos(texto, recortes);
}

/** Conserva también los comentarios condicionales completos y las dos marcas de los condicionales revelados. */
function condicionalHtml(comentario: string): boolean {
  return /^\s*(?:\[if\b|(?:<!?)?\[endif\])/i.test(comentario);
}

/** Retira nodos de comentario reales, sin añadir espacios ni reserializar HTML, atributos o contenido de texto. */
export function htmlPublicado(texto: string): string {
  const documento = analizarHtml(texto, { sourceCodeLocationInfo: true });
  const pendientes: DefaultTreeAdapterTypes.Node[] = [documento];
  const recortes: Recorte[] = [];
  for (let nodo = pendientes.pop(); nodo; nodo = pendientes.pop()) {
    if (defaultTreeAdapter.isCommentNode(nodo)) {
      const lugar = nodo.sourceCodeLocation;
      if (lugar && !avisoLegal(texto.slice(lugar.startOffset, lugar.endOffset)) && !condicionalHtml(nodo.data)) {
        recortes.push({ inicio: lugar.startOffset, fin: lugar.endOffset, reemplazo: '' });
        defaultTreeAdapter.detachNode(nodo);
      }
    }
    if ('childNodes' in nodo) {
      pendientes.push(...nodo.childNodes);
    }
    if ('content' in nodo) {
      pendientes.push(nodo.content);
    }
  }
  const publicado = sinRangos(texto, recortes);
  if (serialize(documento) !== serialize(analizarHtml(publicado))) {
    throw new Error('Retirar los comentarios cambia el árbol HTML; no se publica');
  }
  return publicado;
}

/** Compacta solo el espacio CSS; conserva avisos legales marcados, nombres y opciones de sintaxis de esbuild. */
export function cssPublicado(texto: string): string {
  const resultado = transformSync(texto, {
    loader: 'css',
    legalComments: 'inline',
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false,
    charset: 'utf8',
  });
  if (resultado.warnings.length) {
    throw new Error(`CSS no publicable sin avisos: ${resultado.warnings.map((aviso) => aviso.text).join('; ')}`);
  }
  // Esbuild no reconoce como legales todos los avisos Copyright/SPDX sin marca. Ante cualquiera de esas palabras,
  // incluso dentro de una cadena, se conserva la entrada completa: no se intenta localizar comentarios con regex.
  const minusculas = texto.toLowerCase();
  if (minusculas.includes('copyright') || minusculas.includes('spdx')) {
    return texto;
  }
  return resultado.code;
}
