// Procedencia MCP: citas literales, nivel, alcance y versión, con el paquete real y sin API ni red.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALCANCE,
  fuenteEsco,
  fuenteIne,
  fuenteNotasPorTarea,
  fuenteOit,
  LICENCIAS,
  oficial,
  procedencia,
} from '../../src/api/mcp/procedencia.ts';
import { VERSION_FARO } from '../../src/comun/version.ts';
import { citaOit } from '../../src/dominio/fuentes-y-avisos.ts';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const lengua = crearLengua(datos);

test('la procedencia conserva citas, orden e identidad de fuentes y añade alcance y versión', () => {
  const fuentes = [oficial('Cita literal: año 2026; «α»', 'Condiciones literales')];
  const salida = procedencia(fuentes, 'Datos oficiales', 'Elaboración de Faro');
  assert.deepEqual(salida, {
    fuentes,
    oficial: 'Datos oficiales',
    deFaro: `Elaboración de Faro ${ALCANCE}`,
    faro: VERSION_FARO,
  });
  assert.equal(salida.fuentes, fuentes);
  assert.deepEqual(fuentes, [
    { cita: 'Cita literal: año 2026; «α»', nivel: 'oficial', licencia: 'Condiciones literales' },
  ]);
});

test('OIT, ESCO e INE conservan las citas del informe con su licencia oficial', () => {
  assert.deepEqual(fuenteOit(datos, lengua), {
    cita: citaOit(datos, lengua),
    nivel: 'oficial',
    licencia: LICENCIAS.oit,
  });
  assert.deepEqual(fuenteEsco(lengua), {
    cita: lengua.textos.fuentes.esco,
    nivel: 'oficial',
    licencia: LICENCIAS.esco,
  });
  assert.deepEqual(fuenteIne(lengua), {
    cita: lengua.textos.fuentes.ine,
    nivel: 'oficial',
    licencia: LICENCIAS.ine,
  });
});

test('las notas por tarea son complementarias y conservan su cita y licencia propia', () => {
  assert.deepEqual(fuenteNotasPorTarea(lengua), {
    cita: lengua.textos.fuentes.notasPorTarea,
    nivel: 'complementaria',
    licencia: LICENCIAS.notasPorTarea,
  });
});

test('el alcance, la licencia Idescat y la ausencia de fuentes conservan el contrato público', () => {
  assert.equal(
    ALCANCE,
    'Orientación, no decisión: los datos describen grupos de ocupaciones, no a una persona concreta, y no predicen qué le pasará a nadie.',
  );
  assert.equal(
    LICENCIAS.idescat,
    'Idescat: citar «elaboración propia a partir de datos del Idescat» con la fecha de actualización.',
  );
  assert.deepEqual(procedencia([], '', 'Sin bloque'), {
    fuentes: [],
    oficial: '',
    deFaro: `Sin bloque ${ALCANCE}`,
    faro: VERSION_FARO,
  });
});
