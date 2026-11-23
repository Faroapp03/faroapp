// La consulta MCP de formación oficial sin el motor de cursos: dice que no está disponible, con su motivo, y deja el
// motivo acotado en el registro, como /api/cursos, sin copiar el detalle interno.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as motor from '../../motores/cursos/src/index.ts';
import { type AmbitoConsulta, formacionOficial } from '../../src/api/mcp/consultas.ts';
import type { MotorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const BASE: AmbitoConsulta = { datos, politica: 'oit', hoy: '2026-10-07' };
const ISCO = '2511';

test('sin el motor por su puerta, la consulta y el registro conservan el motivo sin detalle', (t) => {
  const registro = t.mock.method(console, 'warn', () => {});
  const consulta = formacionOficial(
    {
      ...BASE,
      formacionDeCursos: {
        disponible: false,
        motivo: 'bloqueado',
        detalle: 'la operación no ha terminado en 10000 ms',
      },
    },
    ISCO,
  );
  assert.equal(consulta.formacion, null);
  assert.match(String(consulta.aviso), /\(bloqueado\)\.$/u);
  assert.deepEqual(
    registro.mock.calls.map((llamada) => llamada.arguments),
    [['Faro: el motor de cursos no está disponible (bloqueado).']],
  );
  assert.doesNotMatch(JSON.stringify(registro.mock.calls), /la operación no ha terminado/u);
});

test('si el motor cargado lanza, la consulta y el registro dicen «averiado» sin el error', (t) => {
  const registro = t.mock.method(console, 'warn', () => {});
  const roto = {
    ...motor,
    formacionDeLaOcupacion: () => {
      throw new RangeError('fallo sintético del motor');
    },
  } as MotorDeCursos;
  const consulta = formacionOficial({ ...BASE, motorDeCursos: { disponible: true, motor: roto } }, ISCO);
  assert.equal(consulta.formacion, null);
  assert.match(String(consulta.aviso), /\(averiado\)\.$/u);
  assert.deepEqual(
    registro.mock.calls.map((llamada) => llamada.arguments),
    [['Faro: el motor de cursos no está disponible (averiado).']],
  );
  assert.doesNotMatch(JSON.stringify(registro.mock.calls), /fallo sintético del motor/u);
});
