import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { idiomasDeLaEntrega } from '../../src/seleccion-formacion/idioma-del-plan.ts';
import { seleccionarFormacion } from '../../src/seleccion-formacion/seleccionar.ts';
import { APRENDIZAJE, REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';

const catalogo = JSON.parse(readFileSync(new URL(`../../web/${REFERENCIA.ruta}`, import.meta.url), 'utf8'));
const companero = JSON.parse(readFileSync(new URL(`../../web/${APRENDIZAJE.ruta}`, import.meta.url), 'utf8'));
const MILISEGUNDOS_POR_SEGUNDO = 1_000;
const ahora = Date.parse(catalogo.corte_proyeccion_utc) + MILISEGUNDOS_POR_SEGUNDO;
const p = {
  etapa: 'inicial',
  idiomas: ['es', 'ca'],
  modalidad: 'cualquiera',
  aceptaRegistro: true,
  requisitosConfirmados: [],
  excluidos: [],
} as const;
test('el catálogo acreditado ofrece opciones reales separadas y no fabrica fichas digitales', () => {
  const s = seleccionarFormacion(catalogo, companero, p, ahora);
  assert.ok(s.opciones.ia.length > 0);
  assert.ok(s.opciones.digital.length > 0);
  for (const [bloque, opciones] of Object.entries(s.opciones)) {
    for (const o of opciones) {
      assert.equal(o.bloque, bloque);
      assert.ok(catalogo.ofertas.some((v: { unidad: { id: string } }) => v.unidad.id === o.oferta.unidad.id));
      assert.equal(
        o.aprendizaje,
        o.oferta.unidad.tipo === 'recurso'
          ? (companero.fichas.find((f: { programa_id: string }) => f.programa_id === o.oferta.unidad.programa_id) ??
              null)
          : null,
      );
      assert.ok(o.proveedor);
    }
  }
});
// Un idioma que no consta no descarta: la oferta sin idioma indicado vale para cualquier preferencia. Que la entrega
// del día traiga alguna o ninguna no cambia lo que se comprueba: una oferta con otro idioma conocido nunca entra.
test('con un idioma que ninguna oferta declara solo entran las que no indican idioma, sin rellenar con otras', () => {
  const idiomaDe = idiomasDeLaEntrega(catalogo);
  const ofertas: readonly OfertaCatalogo[] = catalogo.ofertas;
  assert.ok(
    ofertas.some((oferta) => idiomaDe(oferta).origen !== null),
    'Hay ofertas con un idioma que consta',
  );
  const s = seleccionarFormacion(catalogo, companero, { ...p, idiomas: ['zz'] }, ahora);
  for (const o of [...s.opciones.ia, ...s.opciones.digital]) {
    assert.equal(idiomaDe(o.oferta).origen, null, o.oferta.unidad.id);
  }
});
