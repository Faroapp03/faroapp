// Grafo de importaciones relativas de un módulo de la web, leído con acorn sin ejecutar ninguno de sus módulos.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'acorn';

function rutaImportada(archivo: string, pieza: Record<string, unknown>): string | null {
  if (
    !['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(
      String(pieza.type),
    )
  ) {
    return null;
  }
  const fuente = pieza.source as { value?: unknown } | undefined;
  if (typeof fuente?.value !== 'string' || !fuente.value.startsWith('.')) {
    return null;
  }
  const destino = resolve(dirname(archivo), fuente.value.split('#')[0] ?? '');
  return destino.endsWith('.js') ? destino : null;
}

function dependencias(archivo: string): string[] {
  const destinos: string[] = [];
  const arbol = parse(readFileSync(archivo, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const nodos: unknown[] = [arbol];
  while (nodos.length) {
    const nodo = nodos.pop();
    if (!nodo || typeof nodo !== 'object') {
      continue;
    }
    const pieza = nodo as Record<string, unknown>;
    const destino = rutaImportada(archivo, pieza);
    if (destino) {
      destinos.push(destino);
    }
    nodos.push(...Object.values(pieza).flatMap((v) => (Array.isArray(v) ? v : [v])));
  }
  return destinos;
}

/** Las rutas absolutas de todos los módulos que alcanza `entrada`, relativa a `web`; falla si falta alguno. */
export function grafoDeModulos(web: string, entrada: string): Set<string> {
  const vistos = new Set<string>();
  const pendientes = [resolve(web, entrada)];
  while (pendientes.length) {
    const archivo = pendientes.pop();
    if (!archivo || vistos.has(archivo)) {
      continue;
    }
    assert.ok(existsSync(archivo), `Falta módulo ${archivo}`);
    vistos.add(archivo);
    pendientes.push(...dependencias(archivo));
  }
  return vistos;
}
