import { readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { parse } from 'acorn';
import type { ContextoWeb } from '../../herramientas/web/contexto.ts';
import type { ResumenDelGrafo } from '../../herramientas/web/empaquetado/grafo.ts';
import { bytesDeLaWeb, modulosDeLaPagina } from '../../herramientas/web/grafo-de-paginas.ts';

/** Los nodos que importan un módulo por una dirección escrita en su fuente: los estáticos e import() literal. */
const IMPORTACIONES = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
]);

/** La dirección literal que importa un nodo, si es una importación (IMPORTACIONES). */
function direccionLiteral(nodo: object): string | undefined {
  const { type, source } = nodo as { type?: string; source?: { type?: string; value?: unknown } };
  const valor = source?.type === 'Literal' ? source.value : undefined;
  return type !== undefined && IMPORTACIONES.has(type) && typeof valor === 'string' ? valor : undefined;
}

/** Las importaciones estáticas, las reexportaciones e import() con cadena literal. */
function especificadores(codigo: string): string[] {
  const encontrados: string[] = [];
  const recorrer = (nodo: unknown): void => {
    if (nodo === null || typeof nodo !== 'object') {
      return;
    }
    const direccion = Array.isArray(nodo) ? undefined : direccionLiteral(nodo);
    if (direccion !== undefined) {
      encontrados.push(direccion);
    }
    const hijos = Array.isArray(nodo)
      ? nodo
      : Object.entries(nodo).flatMap(([clave, valor]) => (clave === 'loc' ? [] : [valor]));
    hijos.forEach(recorrer);
  };
  recorrer(parse(codigo, { ecmaVersion: 'latest', sourceType: 'module' }));
  return encontrados;
}

/** Un módulo importado desde `desde`, como ruta desde web/; null si no es un módulo propio de la web. */
function importadoDesde(desde: string, especificador: string): string | null {
  const sinMarca = especificador.replace(/[?#].*$/, '');
  if (!sinMarca.endsWith('.js')) {
    return null;
  }
  if (sinMarca.startsWith('/')) {
    return sinMarca.slice(1);
  }
  return sinMarca.startsWith('./') || sinMarca.startsWith('../') ? posix.join(posix.dirname(desde), sinMarca) : null;
}

/** El cierre de importaciones de unos módulos de la web local, con los que existen. */
export function cierreDeFuentes(raices: readonly string[], contexto: ContextoWeb): string[] {
  const vistos = new Set<string>();
  const pendientes = [...raices];
  for (let actual = pendientes.pop(); actual !== undefined; actual = pendientes.pop()) {
    const bytes = vistos.has(actual) ? null : bytesDeLaWeb(actual, contexto);
    if (!bytes) {
      continue;
    }
    vistos.add(actual);
    for (const especificador of especificadores(new TextDecoder().decode(bytes))) {
      const importado = importadoDesde(actual, especificador);
      if (importado) {
        pendientes.push(importado);
      }
    }
  }
  return [...vistos].sort();
}

export function conGrafoDeFuentes<T extends ContextoWeb>(contexto: T): T {
  const conGrafo = { ...contexto };
  Object.defineProperty(conGrafo, 'grafoEmitido', {
    enumerable: true,
    get: () => grafoDeFuentes(conGrafo),
  });
  return conGrafo;
}

function grafoDeFuentes(contexto: ContextoWeb): ResumenDelGrafo {
  const paginas = Object.fromEntries(
    readdirSync(contexto.web, { recursive: true, encoding: 'utf8' })
      .filter((ruta) => ruta.endsWith('.html'))
      .map((pagina) => {
        const html = bytesDeLaWeb(pagina, contexto);
        const raices = html ? modulosDeLaPagina(pagina, new TextDecoder().decode(html)) : [];
        const [entrada = '', ...estaticos] = cierreDeFuentes(raices, contexto);
        return [pagina, { entrada, estaticos, dinamicos: [], bytesEstaticos: 0, bytesTotales: 0 }] as const;
      })
      .filter(([, grafo]) => grafo.entrada !== ''),
  );
  return { paginas } as unknown as ResumenDelGrafo;
}
