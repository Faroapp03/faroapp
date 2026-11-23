// Adaptador del reportero de Node: conserva resúmenes estructurados y diagnósticos de fallos.
// Node requiere una exportación default para cargar un reportero propio por --test-reporter.

import type { TestEvent } from 'node:test/reporters';

/** La causa se conserva hasta cuatro niveles; un ciclo de Error queda también acotado. */
const MAX_NIVELES_CAUSA = 4;

/** Describe una causa sin recorrer objetos arbitrarios ni cadenas de Error ilimitadas. */
function describirCausa(causa: unknown, nivel: number): unknown {
  if (causa === undefined) {
    return undefined;
  }
  if (nivel >= MAX_NIVELES_CAUSA) {
    return '[límite de causas]';
  }
  return causa instanceof Error ? describirError(causa, nivel + 1) : String(causa);
}

/** JSON no conserva por defecto el mensaje, la pila ni la causa no enumerables de Error. */
function describirError(error: Error, nivel: number): unknown {
  return {
    nombre: error.name,
    mensaje: error.message,
    pila: error.stack,
    causa: describirCausa(error.cause, nivel),
  };
}

/** Adapta solo Error; los demás valores mantienen la serialización JSON de Node. */
function serializarError(_clave: string, valor: unknown): unknown {
  return valor instanceof Error ? describirError(valor, 0) : valor;
}

/**
 * Publica resúmenes por archivo y global y conserva salida y diagnósticos de la suite.
 *
 * @param eventos - Eventos estructurados entregados por Node.
 * @returns Líneas JSON, sin interpretar títulos de casos como nombres de archivo.
 */
export default async function* registrarPruebas(eventos: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const admitidos = new Set(['test:summary', 'test:fail', 'test:stderr', 'test:stdout', 'test:diagnostic']);
  for await (const evento of eventos) {
    if (admitidos.has(evento.type)) {
      yield `${JSON.stringify(evento, serializarError)}\n`;
    }
  }
}
