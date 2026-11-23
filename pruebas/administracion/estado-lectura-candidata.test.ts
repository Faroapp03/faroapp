import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { instantaneaSaludV4 } from '../ayudas/salud-datos.ts';

test('los estados v4 y v5 conservan una lectura candidata histórica sin activarla', () => {
  const base = instantaneaSaludV4();
  const catalogoFuentes = [
    ...base.catalogoFuentes,
    { id: 'pasada', nombre: 'Lectura anterior', tema: 'cursos', modalidad: 'lectura-candidata' },
  ];
  const { formacionAbiertaCaduca, ...sinFechaAnterior } = base;
  for (const estado of [
    { ...base, catalogoFuentes },
    { ...sinFechaAnterior, version: 5, formacionAbiertaRevisionPendiente: formacionAbiertaCaduca, catalogoFuentes },
  ]) {
    assert.deepEqual(leerEstadoDatosPanel(estado), estado);
    assert.throws(() => leerEstadoDatosPanel({ ...estado, catalogoFuentes: [...catalogoFuentes, catalogoFuentes[2]] }));
  }
});
