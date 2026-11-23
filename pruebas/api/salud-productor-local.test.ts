/** Un productor local visible no se disfraza de candidata ni de consulta remota comprobada. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';

test('productor local conserva identidad, carece de plazos remotos y no mejora el resumen operativo', () => {
  const base = instantaneaSalud();
  const datos = leerEstadoDatosPanel({
    ...base,
    catalogoFuentes: [
      ...base.catalogoFuentes,
      { id: 'hoja_de_ruta', nombre: 'Hoja de ruta local', tema: 'cursos', modalidad: 'productor-local' },
    ],
  });
  const salud = resumirSaludDatos(datos);
  const local = salud.otras.find((f) => f.id === 'hoja_de_ruta');
  assert.equal(local?.estado, 'productor-local');
  assert.equal(local?.modalidad, 'productor-local');
  assert.equal(local?.ultimaConsulta, null);
  assert.equal(local?.resultadoConsulta, null);
  assert.equal(local?.proximoReintento, null);
  assert.deepEqual(local?.comprobaciones, []);
  assert.deepEqual(local?.proximasConsultas, []);
  assert.equal(salud.global, resumirSaludDatos(base).global);
  assert.equal(
    salud.operativas.some((f) => f.id === 'hoja_de_ruta'),
    false,
  );
  assert.match(local?.mensaje ?? '', /No acredita.*remota/);
});
