// El adaptador de las preguntas (web/scripts/recorrido/contrato-preguntas.js): «No lo sé» como opción neutra y las
// escalas de sí o no de 3 o 5 niveles, en su orden, preparadas para la conversación.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vistaDePregunta } from '../../web/scripts/recorrido/contrato-preguntas.js';

const o = (id: string) => ({ id, texto: id });
const TRES = 3;
const CINCO = 5;

test('una pregunta de opciones no es escala y marca «No lo sé» como neutra', () => {
  const vista = vistaDePregunta({
    id: 'tarea:1',
    texto: '¿Cuál?',
    opciones: [o('2423-1'), o('ninguna'), o('no_lo_se')],
  });
  assert.equal(vista.escala, null);
  assert.deepEqual(
    vista.opciones.map((x) => x.neutra),
    [false, false, true],
  );
});

test('las escalas de sí o no de 3 y 5 niveles se reconocen y se ordenan de «Sí» a «No»', () => {
  assert.equal(
    vistaDePregunta({ id: 'escala', texto: '¿Sí?', opciones: [o('si'), o('no'), o('no_lo_se')] }).escala,
    TRES,
  );
  const cinco = vistaDePregunta({
    id: 'universidad',
    texto: '¿Universidad?',
    opciones: [o('no'), o('mas_bien_no'), o('no_lo_se'), o('mas_bien_si'), o('si')],
  });
  assert.equal(cinco.escala, CINCO);
  assert.deepEqual(
    cinco.opciones.map((x) => x.id),
    ['si', 'mas_bien_si', 'no_lo_se', 'mas_bien_no', 'no'],
  );
  assert.equal(vistaDePregunta({ id: 'escala', texto: '¿Sí?', opciones: [o('si'), o('no')] }).escala, null);
  assert.equal(
    vistaDePregunta({ id: 'escala', texto: '¿Sí?', opciones: [o('si'), o('si'), o('no_lo_se')] }).escala,
    null,
  );
});

test('«Un trabajo técnico o de apoyo especializado» se dice con ejemplos, en los dos idiomas', () => {
  const pregunta = {
    id: 'nivel1:2,3,5',
    texto: '¿Qué?',
    opciones: [o('2'), { id: '3', texto: 'Un trabajo técnico o de apoyo especializado' }],
  };
  assert.match(vistaDePregunta(pregunta, 'es').opciones[1]?.texto ?? '', /^Técnico o técnica: laboratorio/);
  assert.match(vistaDePregunta(pregunta, 'ca').opciones[1]?.texto ?? '', /^Tècnic o tècnica: laboratori/);
  assert.equal(
    vistaDePregunta({ ...pregunta, id: 'tarea:3' }, 'es').opciones[1]?.texto,
    'Un trabajo técnico o de apoyo especializado',
  );
});
