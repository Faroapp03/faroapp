/** Escala de lectura del selector con un catálogo sintético; no depende del reloj de ejecución. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { seleccionarFormacion } from '../../src/seleccion-formacion/seleccionar.ts';
import { AHORA_FORMACION, casoDeFormacion } from '../fixtures/seleccion-formacion.ts';

// Una cifra fija por oferta: el plan decide el idioma una sola vez por oferta, con la misma pieza que Cursos.
const MAX_LECTURAS_POR_OFERTA = 8;
const CATALOGO_PEQUENO = 64;
const CATALOGO_GRANDE = 512;
const MAX_COMPLEMENTARIOS = 3;

function casoAmplio(cantidad: number) {
  const caso = casoDeFormacion();
  const oferta = caso.catalogo.ofertas[0];
  const ficha = caso.companero.fichas[0];
  const camino = caso.companero.caminos[0];
  assert.ok(oferta && ficha && camino);
  const ids = Array.from({ length: cantidad }, (_, i) => `sintetico:${i}`);
  let lecturas = 0;
  const ofertas: OfertaCatalogo[] = ids.map((id) => ({
    ...oferta,
    get unidad(): OfertaCatalogo['unidad'] {
      lecturas++;
      return { tipo: 'recurso', id, programa_id: id };
    },
  }));
  const catalogo = { ...caso.catalogo, ofertas };
  const companero = {
    ...caso.companero,
    fichas: ids.map((programa_id) => ({ ...ficha, programa_id })),
    caminos: [{ ...camino, programas: [ids[0] as string] }],
  };
  return { catalogo, companero, preferencias: caso.preferencias, lecturas: () => lecturas, ids };
}

for (const cantidad of [CATALOGO_PEQUENO, CATALOGO_GRANDE]) {
  test(`La selección de ${cantidad} fichas no vuelve a recorrer todas las ofertas por cada ficha`, () => {
    const caso = casoAmplio(cantidad);
    const resultado = seleccionarFormacion(caso.catalogo, caso.companero, caso.preferencias, AHORA_FORMACION);
    const lecturas = caso.lecturas();
    assert.ok(
      lecturas <= cantidad * MAX_LECTURAS_POR_OFERTA,
      `${lecturas} lecturas de identidad para ${cantidad} ofertas: el coste no debe multiplicarse por las fichas`,
    );
    assert.deepEqual(
      resultado.camino?.recursos.map((r) => r.ficha.programa_id),
      [caso.ids[0]],
    );
    assert.deepEqual(
      resultado.complementarios.map((r) => r.ficha.programa_id),
      caso.ids.slice(1, 1 + MAX_COMPLEMENTARIOS),
    );
    assert.deepEqual(resultado.huecos, ['tarea_sencilla', 'contraste']);
    assert.equal(resultado.estado, 'parcial');
    assert.equal(resultado.descartes.length, 0);
  });
}
