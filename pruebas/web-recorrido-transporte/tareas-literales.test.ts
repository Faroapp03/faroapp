import './ayudas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limpiarDatosPersonales } from '../../src/seguridad/privacidad.ts';
import { navegador } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-local-doble.ts';

test('una tarea escrita se conserva como literal limpio, sin separar, emparejar o atribuir una nota', async (t) => {
  navegador(t, { document: { documentElement: { lang: 'es' } } });
  const peticiones: string[] = [];
  fijarMotor(async (ruta) => {
    peticiones.push(ruta);
    throw new Error('No se debe pedir inferencia para registrar una tarea literal');
  });
  const { tareasDeLoQueEscribe } = await import('../../web/scripts/recorrido/tareas-libres.js');
  const texto = 'Cobro y ordeno; mi teléfono es 654 321 098.';
  const resultado = await tareasDeLoQueEscribe(texto, 2);
  assert.equal(resultado.tareas.length, 1);
  assert.equal(resultado.tareas[0]?.texto, limpiarDatosPersonales(texto).texto);
  assert.equal(resultado.tareas[0]?.oficial, null);
  assert.equal(resultado.tareas[0]?.estimacion, null);
  assert.deepEqual(peticiones, []);
  assert.equal(resultado.avisos[0]?.tipo, 'datos-personales');
  assert.deepEqual(await tareasDeLoQueEscribe('Otra tarea', 0), { tareas: [], avisos: [] });
});
