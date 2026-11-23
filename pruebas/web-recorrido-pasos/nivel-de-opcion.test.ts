// El nivel de una opción del plan: si el catálogo no lo conoce, se dice que está por confirmar en lugar de presentarlo
// como una coincidencia.
import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpcionPlan } from '../../web/scripts/recorrido/plan-formacion/contrato.js';
import { nivelDeOpcion } from '../../web/scripts/recorrido/plan-formacion/metadatos.js';
import { opcionSintetica } from './opcion-sintetica.ts';

test('la exploración no presenta un nivel desconocido como coincidencia', () => {
  const opcion = opcionSintetica('ia', 'sin-revision', {}) as unknown as OpcionPlan;
  assert.equal(
    nivelDeOpcion(opcion, 'es'),
    'El nivel está por confirmar. Consulta los requisitos antes de elegir este curso.',
  );
  assert.equal(
    nivelDeOpcion(opcion, 'ca'),
    'El nivell està per confirmar. Consulta els requisits abans de triar aquest curs.',
  );
});
