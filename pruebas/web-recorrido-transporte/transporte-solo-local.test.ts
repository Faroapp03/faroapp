import './ayudas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limpiarDatosPersonales } from '../../src/seguridad/privacidad.ts';
import { ERROR_DE_PLAZO } from '../../web/scripts/recorrido/api/errores.js';
import { almacen, navegador } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-local-doble.ts';

/** El informe mínimo que el transporte admite como respuesta correcta de /informe. */
const HTML = '<p>Informe</p>';

const PLAZO_DEL_RECORRIDO_MS = 60_000;

test('la configuración y elección antiguas no permiten enviar texto fuera del dispositivo', async (t) => {
  const red: string[] = [];
  const cuerpos: unknown[] = [];
  navegador(t, {
    document: { documentElement: { lang: 'es' } },
    navigator: { onLine: false },
    localStorage: almacen({
      'faro-modos': '["ia-on","ia-off"]',
      'faro-modo-inicial': 'ia-on',
      'faro-modo-elegido': 'ia-on',
    }),
    fetch: async (url: string | URL) => {
      red.push(String(url));
      return Response.json({ modos: ['ia-on', 'ia-off'], modoInicial: 'ia-on' });
    },
  });
  fijarMotor(async (ruta, opciones) => {
    assert.equal(ruta, '/api/informe');
    cuerpos.push(JSON.parse(String(opciones.body)));
    return Response.json({ html: HTML });
  });
  const { pedir } = await import('../../web/scripts/recorrido/api/transporte.js');
  const texto = 'Me llamo Rocío Benítez y mi móvil es 654 321 098; soy cajera.';
  const respuesta = await pedir('/informe', { tareas: [{ texto }] });
  assert.equal(respuesta.html, HTML);
  assert.deepEqual(red, []);
  assert.deepEqual(cuerpos, [{ tareas: [{ texto: limpiarDatosPersonales(texto).texto }] }]);
  assert.ok(Array.isArray(respuesta.avisos));
  assert.equal(respuesta.avisos[0]?.tipo, 'datos-personales');
});

test('la cancelación local no entrega una respuesta tardía y la petición siguiente es independiente', async () => {
  const { pedir, cancelarPeticiones } = await import('../../web/scripts/recorrido/api/transporte.js');
  let terminar: (valor: Response) => void = () => {};
  let entrada: () => void = () => {};
  const iniciada = new Promise<void>((ok) => {
    entrada = ok;
  });
  fijarMotor(async (_ruta, opciones) => {
    assert.equal(opciones.signal?.aborted, false);
    entrada();
    return new Promise<Response>((ok) => {
      terminar = ok;
    });
  });
  const pendiente = pedir('/grupos');
  await iniciada;
  cancelarPeticiones();
  terminar(Response.json({ hijos: [] }));
  await assert.rejects(pendiente, (e: unknown) => e instanceof Error && 'codigo' in e && e.codigo === 'cancelada');
  fijarMotor(async () => Response.json({ hijos: [] }));
  assert.deepEqual(await pedir('/grupos'), { hijos: [] });
});

test('el plazo local mantiene su causa temporal y no se confunde con cancelar el recorrido', async (t) => {
  const vencido = new AbortController();
  vencido.abort(new DOMException('Plazo controlado', 'TimeoutError'));
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, PLAZO_DEL_RECORRIDO_MS);
    return vencido.signal;
  });
  fijarMotor(async () => assert.fail('Un plazo vencido no inicia el Worker'));
  const { pedir } = await import('../../web/scripts/recorrido/api/transporte.js');
  await assert.rejects(
    pedir('/grupos'),
    (error: unknown) =>
      error instanceof Error &&
      'explicacion' in error &&
      typeof error.explicacion === 'object' &&
      error.explicacion !== null &&
      'clave' in error.explicacion &&
      error.explicacion.clave === ERROR_DE_PLAZO,
  );
});
