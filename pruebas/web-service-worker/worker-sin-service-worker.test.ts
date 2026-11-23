// El Worker real del motor sin service worker que responda su sonda (scripts/motor-local/worker.js): el fallo es de
// paso, sin `noCoincide`, y el Worker no lee la constancia del service worker (service-worker.js, «Instalación que no
// coincide»), aunque la haya: su único lector es la página (scripts/instalacion.js), que solo la mira cuando ve
// descartarse una instalación que ha seguido. Así una constancia vieja no puede dar el aviso desde aquí.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const RAIZ = new URL('../../web/', import.meta.url).href;
const NO_ENCONTRADO = 404;
type Responder = (evento: { data: Record<string, unknown> }) => Promise<void>;

/** Lo que el Worker ve de su ámbito: la sonda que llega al servidor (404) y la constancia que fija la prueba. */
const ambito = {
  responder: undefined as Responder | undefined,
  enviados: [] as unknown[],
  pedidas: [] as string[],
  buscadas: [] as unknown[],
  constancia: null as unknown,
};

/** Pone el ámbito del Worker en globalThis y devuelve cómo dejarlo como estaba. */
function prepararElAmbito(): () => void {
  const nombres = ['addEventListener', 'postMessage', 'fetch', 'caches'];
  const anteriores = nombres.map((nombre) => Object.getOwnPropertyDescriptor(globalThis, nombre));
  const warn = console.warn;
  Object.assign(globalThis, {
    addEventListener: (_tipo: string, oyente: Responder) => {
      ambito.responder = oyente;
    },
    postMessage: (mensaje: unknown) => ambito.enviados.push(mensaje),
    // Sin service worker, la sonda llega al servidor, que no la tiene.
    fetch: async (direccion: unknown) => {
      ambito.pedidas.push(String(direccion));
      return new Response(null, { status: NO_ENCONTRADO });
    },
    caches: {
      match: async (clave: string, opciones: unknown) => {
        ambito.buscadas.push([clave, opciones]);
        return ambito.constancia === null ? undefined : Response.json(ambito.constancia);
      },
    },
  });
  console.warn = () => {};
  return () => {
    console.warn = warn;
    for (const [indice, nombre] of nombres.entries()) {
      const descriptor = anteriores[indice];
      if (descriptor) {
        Object.defineProperty(globalThis, nombre, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, nombre);
      }
    }
  };
}

test('sin sonda, el fallo es de paso y el Worker no lee la constancia', async () => {
  const restaurar = prepararElAmbito();
  try {
    await import('../../web/scripts/motor-local/worker.js');
    const casos: unknown[] = [
      null,
      { motivo: 'no-coincide', archivo: 'motor/src/plataforma/navegador/motor.js', version: 'v1', cuando: 1 },
    ];
    for (const [indice, guardada] of casos.entries()) {
      ambito.constancia = guardada;
      ambito.enviados.length = 0;
      const id = indice + 1;
      assert.ok(ambito.responder);
      await ambito.responder({
        data: { id, paquete: `${RAIZ}paquete/p1/`, url: `${RAIZ}api/salud`, method: 'GET', headers: [], body: null },
      });
      const respuestas = ambito.enviados.filter((m) => typeof m === 'object' && m !== null && 'id' in m);
      assert.deepEqual(respuestas, [{ id, fallo: true }]);
    }
    assert.deepEqual(ambito.buscadas, [], 'no lee CacheStorage');
    assert.ok(
      ambito.pedidas.every((direccion) => direccion.endsWith('motor/copia-comprobada.json')),
      'sin el motor',
    );
  } finally {
    restaurar();
  }
});
