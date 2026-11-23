/** El reloj de vigilancia no rejuvenece la observación ni una comprobación hermana. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { resumirSaludDatos } from '../../src/administracion/salud-datos.js';
import { CONSULTA_SALUD, instantaneaSalud } from '../ayudas/salud-datos.ts';

test('evalúa el vencimiento con reloj explícito sin cambiar observadoEn ni el periodo del dato', () => {
  const datos = leerEstadoDatosPanel(instantaneaSalud());
  const antes = JSON.stringify(datos);
  const salud = resumirSaludDatos(datos, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(salud.operativas[0]?.estado, 'pendiente');
  assert.equal(JSON.stringify(datos), antes);
  assert.equal(datos.fuentes[0]?.fecha, '2026-01-01');
  assert.throws(() => resumirSaludDatos(datos, NaN));
  assert.throws(() => resumirSaludDatos(datos, Date.parse(CONSULTA_SALUD)));
});

test('una consulta global reciente no rejuvenece otro conjunto sin comprobación', () => {
  const base = instantaneaSalud();
  const conjunto = base.comprobaciones.conjuntos[0];
  assert.ok(conjunto);
  const datos = leerEstadoDatosPanel(
    instantaneaSalud({
      comprobaciones: {
        ...base.comprobaciones,
        conjuntos: [...base.comprobaciones.conjuntos, { ...conjunto, id: 'otro-conjunto', ultimaComprobacion: null }],
      },
    }),
  );
  const otra = resumirSaludDatos(datos).operativas[0]?.proximasConsultas.find((c) => c.id === 'otro-conjunto');
  assert.equal(otra?.fecha, null);
});
