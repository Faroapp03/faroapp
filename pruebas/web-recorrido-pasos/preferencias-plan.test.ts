import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inicioDeAgendaVigente } from '../../web/scripts/recorrido/formacion/agenda.js';
import { esEtapa, esModalidad, preferenciasDelPlan } from '../../web/scripts/recorrido/formacion/preferencias-plan.js';
import { casoDeFormacion } from '../fixtures/seleccion-formacion.ts';

test('la fecha se compara con el día de Madrid también al cambiar la medianoche', () => {
  const agenda = { inicio: '2026-11-09' };
  assert.equal(inicioDeAgendaVigente(agenda, '2026-11-09T22:59:59Z'), true);
  assert.equal(inicioDeAgendaVigente(agenda, '2026-11-09T23:00:00Z'), false);
  assert.equal(inicioDeAgendaVigente({ inicio: '2026-11-10' }, '2026-11-09T23:00:00Z'), true);
});
test('niveles, modalidad y registro inválidos no se convierten silenciosamente', () => {
  assert.equal(esEtapa('inicial'), true);
  assert.equal(esEtapa('otro'), false);
  assert.equal(esModalidad('en-linea'), true);
  assert.equal(esModalidad('otra'), false);
  const preferencias = casoDeFormacion().preferencias;
  assert.equal(
    preferenciasDelPlan({ ...preferencias, aceptaRegistro: null }, 'inicial', '2026-11-09').aceptaRegistro,
    null,
  );
  assert.throws(() =>
    preferenciasDelPlan({ ...preferencias, aceptaRegistro: 'si' as unknown as boolean }, 'inicial', '2026-11-09'),
  );
  assert.throws(() => preferenciasDelPlan(preferencias, null, '2026-11-09'));
  assert.throws(() =>
    preferenciasDelPlan({ ...preferencias, etapa: 'incorrecto' as typeof preferencias.etapa }, 'inicial', '2026-11-09'),
  );
  assert.throws(() =>
    preferenciasDelPlan(
      { ...preferencias, modalidad: 'incorrecto' as typeof preferencias.modalidad },
      'inicial',
      '2026-11-09',
    ),
  );
});
