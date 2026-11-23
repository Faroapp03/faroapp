// Las fuentes del repositorio que alcanza un módulo de Node por sus importaciones relativas, leídas con acorn tras
// quitar los tipos (node:module, stripTypeScriptTypes) y sin ejecutar nada. Las instalaciones aisladas de las pruebas
// copian este cierre en lugar de una lista escrita a mano, que se queda corta en cuanto una herramienta importa otra.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, posix, relative, sep } from 'node:path';
import { parse } from 'acorn';

/** Los nodos que importan otro módulo: los estáticos e import() con una cadena literal. */
const IMPORTACIONES = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
]);

/** Las direcciones relativas que importa un módulo, tal como están escritas. */
function importacionesRelativas(codigo: string): string[] {
  const encontradas: string[] = [];
  const nodos: unknown[] = [parse(codigo, { ecmaVersion: 'latest', sourceType: 'module' })];
  for (let nodo = nodos.pop(); nodo !== undefined; nodo = nodos.pop()) {
    if (nodo === null || typeof nodo !== 'object') {
      continue;
    }
    const pieza = nodo as { type?: unknown; source?: { type?: unknown; value?: unknown } };
    const valor = pieza.source?.type === 'Literal' ? pieza.source.value : undefined;
    if (IMPORTACIONES.has(String(pieza.type)) && typeof valor === 'string' && valor.startsWith('.')) {
      encontradas.push(valor);
    }
    nodos.push(...Object.values(nodo).flatMap((valor) => (Array.isArray(valor) ? valor : [valor])));
  }
  return encontradas;
}

/**
 * El cierre de importaciones relativas de unos módulos del repositorio.
 *
 * @param raiz - La raíz del repositorio.
 * @param entradas - Los módulos de partida, desde la raíz.
 * @param sinRecorrer - Rutas, desde la raíz, que la instalación pone por su cuenta (enlaza o escribe): no se incluyen
 *   ni se recorren sus importaciones.
 * @returns Las rutas de los módulos alcanzados, desde la raíz y separadas por «/», en orden.
 * @throws {AssertionError} Si un módulo importado no existe.
 */
export function fuentesQueImporta(
  raiz: string,
  entradas: readonly string[],
  sinRecorrer: ReadonlySet<string> = new Set(),
): string[] {
  const vistas = new Set<string>();
  const pendientes = [...entradas];
  for (let ruta = pendientes.pop(); ruta !== undefined; ruta = pendientes.pop()) {
    if (vistas.has(ruta) || sinRecorrer.has(ruta)) {
      continue;
    }
    const archivo = join(raiz, ruta);
    assert.ok(existsSync(archivo), `Falta el módulo ${ruta}`);
    vistas.add(ruta);
    const fuente = readFileSync(archivo, 'utf8');
    const codigo = ruta.endsWith('.ts') ? stripTypeScriptTypes(fuente) : fuente;
    for (const importada of importacionesRelativas(codigo)) {
      const destino = posix.normalize(posix.join(posix.dirname(ruta), importada.split(/[?#]/)[0] ?? ''));
      pendientes.push(relative(raiz, join(raiz, destino)).split(sep).join('/'));
    }
  }
  return [...vistas].sort();
}
