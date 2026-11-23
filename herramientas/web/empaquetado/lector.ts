// El lector del catálogo de cursos dentro del paquete. La web local lo publica construido aparte
// (catalogo-cursos.ts); la construcción lo empaqueta desde su fuente con las páginas que lo usan, minificado y con SRI
// en el mapa de cada página. Con trozos compartidos, esbuild reparte por archivos: a través del barril del lector,
// quien solo usa una función se llevaría el trozo con todo el lector, también la tabla de clasificación. Por eso cada
// importación con nombre del lector se cambia por la del módulo que define ese nombre. En la copia sin conexión, lo
// del lector se guarda como el resto del JavaScript de las páginas (ARCHIVOS, que el SRI comprueba al ejecutarse) y no
// en COMPROBADOS, con su huella al guardarse, como cuando se publicaba aparte.

import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { type ImportDeclaration, parse } from 'acorn';
import { transformSync } from 'esbuild';
import { RUTAS } from '../../../src/plataforma/node/rutas.ts';
import { FUENTE_DEL_LECTOR, LECTOR_PUBLICADO, PUBLICACIONES_CATALOGO } from '../catalogo-cursos.ts';

/** El lector del catálogo publicado en la web local, desde web/: el paquete lo sustituye por su fuente. */
export const LECTOR_EN_LA_WEB = LECTOR_PUBLICADO.slice('web/'.length);
/** Lo que la web local publica del lector y la construcción no: el paquete aparte, sus tipos y su huella. */
export const PUBLICACIONES_DEL_LECTOR: readonly string[] = Object.values(PUBLICACIONES_CATALOGO).map((ruta) =>
  ruta.slice('web/'.length),
);
/** La fuente del lector, en el disco. */
export const FUENTE = join(RUTAS.raiz, FUENTE_DEL_LECTOR);

/** De dónde viene un nombre del barril: el módulo de src/ que lo define y su nombre allí. */
interface Origen {
  readonly modulo: string;
  readonly nombre: string;
}

function nombreDe(nodo: { type: string; name?: string; value?: unknown }): string {
  return nodo.type === 'Identifier' ? (nodo.name ?? '') : String(nodo.value);
}

function sentencias(codigo: string) {
  return parse(codigo, { ecmaVersion: 'latest', sourceType: 'module' }).body;
}

/** Los nombres que importa cada sentencia del barril, con su módulo. */
function importadosDelBarril(codigo: string): Map<string, Origen> {
  const importados = new Map<string, Origen>();
  for (const sentencia of sentencias(codigo)) {
    if (sentencia.type !== 'ImportDeclaration') {
      continue;
    }
    const modulo = join(dirname(FUENTE), String(sentencia.source.value));
    for (const especificador of sentencia.specifiers) {
      if (especificador.type === 'ImportSpecifier') {
        importados.set(especificador.local.name, { modulo, nombre: nombreDe(especificador.imported) });
      }
    }
  }
  return importados;
}

/** El módulo que define cada nombre que exporta el barril. Sin tipos, el barril importa cada nombre y lo exporta. */
export function origenesDelLector(): ReadonlyMap<string, Origen> {
  const { code } = transformSync(readFileSync(FUENTE, 'utf8'), { loader: 'ts', format: 'esm' });
  const importados = importadosDelBarril(code);
  const exportados = sentencias(code).flatMap((sentencia) =>
    sentencia.type === 'ExportNamedDeclaration' && !sentencia.source ? sentencia.specifiers : [],
  );
  return new Map(
    exportados.flatMap(({ local, exported }) => {
      const origen = importados.get(nombreDe(local));
      return origen ? [[nombreDe(exported), origen] as const] : [];
    }),
  );
}

/** Las importaciones directas que sustituyen a una del lector, agrupadas por módulo. */
function directas(sentencia: ImportDeclaration, origenes: ReadonlyMap<string, Origen>, archivo: string): string {
  const porModulo = new Map<string, string[]>();
  for (const especificador of sentencia.specifiers) {
    const origen =
      especificador.type === 'ImportSpecifier' ? origenes.get(nombreDe(especificador.imported)) : undefined;
    if (!origen) {
      throw new Error(`${archivo}: el lector se importa solo por sus nombres`);
    }
    const nombres = porModulo.get(origen.modulo) ?? [];
    nombres.push(`${origen.nombre} as ${especificador.local.name}`);
    porModulo.set(origen.modulo, nombres);
  }
  return [...porModulo]
    .map(([modulo, nombres]) => `import { ${nombres.join(', ')} } from ${JSON.stringify(modulo)};`)
    .join(' ');
}

/**
 * El código de un módulo de la web con sus importaciones del lector cambiadas por las de los módulos que definen cada
 * nombre.
 *
 * @param archivo - El módulo, desde web/.
 * @param codigo - Su código.
 * @param origenes - De dónde viene cada nombre del lector (origenesDelLector).
 * @returns El código, igual si no importa el lector.
 */
export function sinBarrilDelLector(archivo: string, codigo: string, origenes: ReadonlyMap<string, Origen>): string {
  if (!codigo.includes(posix.basename(LECTOR_EN_LA_WEB))) {
    return codigo;
  }
  const delLector = sentencias(codigo).filter(
    (sentencia): sentencia is ImportDeclaration =>
      sentencia.type === 'ImportDeclaration' &&
      posix.normalize(posix.join(posix.dirname(archivo), String(sentencia.source.value))) === LECTOR_EN_LA_WEB,
  );
  return delLector.reduceRight(
    (resultado, sentencia) =>
      resultado.slice(0, sentencia.start) + directas(sentencia, origenes, archivo) + resultado.slice(sentencia.end),
    codigo,
  );
}
