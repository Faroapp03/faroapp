import './ayudas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { almacen, navegador } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-local-doble.ts';

/** El informe mínimo que el transporte admite como respuesta correcta de /informe. */
const HTML = '<p>Informe</p>';

test('sin configuración ni copia conocida todo texto usa transporte local; no consulta salud ni servidor con texto', async (t) => {
  const rutas: string[] = [],
    locales: string[] = [];
  navegador(t, {
    localStorage: almacen(),
    fetch: async (url: string | URL) => {
      const ruta = String(url);
      rutas.push(ruta);
      assert.fail(`El recorrido local no consulta configuración: ${ruta}`);
      return new Response('', { status: 404 });
    },
  });
  fijarMotor(async (_ruta, opciones) => {
    locales.push(String(opciones.body));
    return Response.json({ html: HTML });
  });
  const { pedir } = await import('../../web/scripts/recorrido/api/transporte.js');
  await pedir('/informe', { tareas: [{ texto: 'Texto que debe permanecer aquí' }] });
  assert.equal(rutas.length, 0);
  assert.deepEqual(locales, ['{"tareas":[{"texto":"Texto que debe permanecer aquí"}]}']);
});
