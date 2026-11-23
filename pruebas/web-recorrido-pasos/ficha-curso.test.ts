import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpcionPlan } from '../../src/seleccion-formacion/contrato.ts';
import { detalleDeFicha } from '../../web/scripts/recorrido/formacion/ficha-curso.js';
import { fijarIdioma } from '../../web/scripts/textos.js';

test('la ficha solo muestra resultados oficiales disponibles y conserva su idioma', () => {
  fijarIdioma('es');
  const ficha = {
    idioma_ficha: 'ca',
    aprendizaje: {
      afirmaciones: [
        { dimension: 'resultado_previsto', origen: 'extraccion_oficial', descripcion: 'Crear documents' },
        { dimension: 'resultado_previsto', origen: 'inferencia', descripcion: 'No acreditado' },
        { dimension: 'requisito_entrada', origen: 'extraccion_oficial', descripcion: 'Requisito' },
      ],
    },
  } as unknown as OpcionPlan['aprendizaje'];
  const detalle = detalleDeFicha(ficha);
  assert.ok(detalle);
  assert.match(detalle.textContent ?? '', /Crear documents/u);
  assert.doesNotMatch(detalle.textContent ?? '', /No acreditado|Requisito/u);
  assert.equal(detalle.querySelector('ul')?.lang, 'ca');
  assert.equal(detalleDeFicha(null), null);
});
