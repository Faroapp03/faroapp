import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENTOS_ACTIVIDAD, escucharActividad } from '../../web/administracion/actividad-panel.js';

test('pulsar, escribir y desplazarse con rueda o dedo cuentan como actividad; scroll no, y la escucha es pasiva', () => {
  const objetivo = new EventTarget();
  const opciones: unknown[] = [];
  const anadir = objetivo.addEventListener.bind(objetivo);
  objetivo.addEventListener = (tipo, oyente, opcion) => {
    opciones.push(opcion);
    anadir(tipo, oyente, opcion);
  };
  const recibidos: string[] = [];
  escucharActividad(objetivo, (evento) => recibidos.push(evento.type));
  for (const tipo of ['wheel', 'touchstart', 'touchmove', 'scroll', 'pointerdown', 'keydown', 'mousemove']) {
    objetivo.dispatchEvent(new Event(tipo));
  }
  // El scroll también lo provocan los repintados y el anclaje del navegador: no prueba que haya alguien delante.
  assert.deepEqual(recibidos, ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']);
  assert.deepEqual([...EVENTOS_ACTIVIDAD].sort(), ['keydown', 'pointerdown', 'touchmove', 'touchstart', 'wheel']);
  assert.ok(opciones.every((opcion) => JSON.stringify(opcion) === '{"passive":true}'));
});
