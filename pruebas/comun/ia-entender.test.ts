// Reglas compartidas del infinitivo y aviso de privacidad vigentes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { empiezaPorInfinitivo } from '../../src/ia/frases.ts';
import { AVISO_DATOS } from '../../src/seguridad/avisos.ts';

test('una tarea conserva el filtro morfológico de infinitivo', () => {
  assert.ok(empiezaPorInfinitivo('Atender a los clientes'));
  assert.ok(empiezaPorInfinitivo('Encargarse del inventario'));
  assert.ok(!empiezaPorInfinitivo('La capital de Francia es París'));
});

test('el aviso de datos eliminados describe la minimización y pide evitar datos personales', () => {
  assert.equal(
    AVISO_DATOS,
    'Faro ha quitado del texto procesado los datos personales que ha reconocido. Evita incluir datos personales.',
  );
});

test('«Ir a…» y las formas catalanas conservan las reglas compartidas de infinitivo', () => {
  assert.ok(empiezaPorInfinitivo('Ir a casa de los usuarios para asearlos'));
  for (const noEsTarea of ['La capital de França és París', 'Un poema sobre el mar', 'El informe de incidencias']) {
    assert.ok(!empiezaPorInfinitivo(noEsTarea) && !empiezaPorInfinitivo(noEsTarea, 'ca'), noEsTarea);
  }
});
