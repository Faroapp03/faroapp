/** La salida común sin redirecciones con dobles de `fetch`: las formas en que llega una redirección. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pedirSinRedirecciones, RedireccionRechazada } from '../../src/comun/salida-sin-redirecciones.ts';

const DESTINO = 'https://salida.example/';
const MOVIDO_PERMANENTEMENTE = 301;
const ENCONTRADO = 302;
const VER_OTRO = 303;
const REDIRECCION_TEMPORAL = 307;
const REDIRECCION_PERMANENTE = 308;
const ESTADOS_REDIRECCION = [
  MOVIDO_PERMANENTEMENTE,
  ENCONTRADO,
  VER_OTRO,
  REDIRECCION_TEMPORAL,
  REDIRECCION_PERMANENTE,
];

test('pide en modo manual, conserva las opciones y devuelve una respuesta normal', async () => {
  const pedidos: RequestInit[] = [];
  const pedir: typeof fetch = async (_entrada, opciones) => {
    pedidos.push(opciones ?? {});
    return new Response('correcto', { status: 200 });
  };
  const respuesta = await pedirSinRedirecciones(DESTINO, { method: 'POST', redirect: 'follow' }, pedir);
  assert.equal(await respuesta.text(), 'correcto');
  assert.deepEqual(pedidos, [{ method: 'POST', redirect: 'manual' }]);
});

test('un 3xx, una respuesta opaqueredirect o una ya redirigida se rechazan sin leer el cuerpo', async () => {
  const opaca = { type: 'opaqueredirect', status: 0, redirected: false, body: null } as unknown as Response;
  const redirigida = Object.defineProperty(new Response('otro'), 'redirected', { value: true });
  const respuestas = [
    ...ESTADOS_REDIRECCION.map((status) => new Response(null, { status, headers: { location: DESTINO } })),
    opaca,
    redirigida,
  ];
  for (const respuesta of respuestas) {
    await assert.rejects(
      pedirSinRedirecciones(DESTINO, undefined, async () => respuesta),
      (error) => error instanceof RedireccionRechazada && error instanceof TypeError,
    );
  }
});

test('una redirección con cuerpo se rechaza sin leerlo y su cuerpo queda cancelado', async () => {
  const cuerpo = { leido: false, cancelado: false };
  // Sin reserva previa (highWaterMark 0), `pull` solo corre si alguien lee el cuerpo.
  const flujo = new ReadableStream(
    {
      pull: () => {
        cuerpo.leido = true;
      },
      cancel: () => {
        cuerpo.cancelado = true;
      },
    },
    { highWaterMark: 0 },
  );
  const redirige = new Response(flujo, { status: ENCONTRADO, headers: { location: DESTINO } });
  // Sin leer: antes de la llamada, el cuerpo está intacto.
  assert.equal(redirige.bodyUsed, false);
  await assert.rejects(
    pedirSinRedirecciones(DESTINO, undefined, async () => redirige),
    (error) => error instanceof RedireccionRechazada,
  );
  await new Promise<void>((resolver) => setImmediate(resolver));
  assert.deepEqual(cuerpo, { leido: false, cancelado: true });
  // Cancelar cuenta como «usado» para Fetch: ya no se puede leer, y nadie lo ha leído.
  assert.equal(redirige.bodyUsed, true);
});

test('un rechazo de la red llega tal cual al llamador', async () => {
  const caida = new TypeError('sin conexión');
  await assert.rejects(
    pedirSinRedirecciones(DESTINO, undefined, async () => Promise.reject(caida)),
    (error) => error === caida,
  );
});
