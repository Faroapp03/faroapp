/**
 * La guardia de navegador mide la hoja 2 con los casos peores sacados de los datos (casos-peores-de-los-datos.mjs): la
 * selección devuelve, en cada idioma, un caso por criterio, con ocupaciones que existen en los datos, con una medida
 * real y distintos entre sí, para que un cambio de datos que alargue un texto se mida solo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { casosPeoresDeLosDatos, ocupacionesDeLosDatos } from '../navegadores/casos-peores-de-los-datos.mjs';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const CRITERIOS = ['peorTitulo', 'peorGrupo', 'peorMercado', 'peorSellos'];

for (const idioma of ['es', 'ca'] as const) {
  test(`${idioma}: los casos peores de la hoja 2 son reales, medidos y distintos`, () => {
    const casos = casosPeoresDeLosDatos(DATOS, idioma);
    assert.deepEqual(Object.keys(casos).toSorted(), [...CRITERIOS].toSorted());
    const existentes = new Set(ocupacionesDeLosDatos(DATOS).map((o) => `${o.ocupacionEsco ?? ''}|${o.isco08}`));
    for (const criterio of CRITERIOS) {
      const caso = casos[criterio];
      assert.ok(caso, criterio);
      assert.ok(caso.medida > 0, `${criterio}: tiene una medida`);
      assert.ok(
        existentes.has(`${caso.ocupacionEsco ?? ''}|${caso.isco08}`),
        `${criterio}: la ocupación está en los datos`,
      );
      if (caso.ocupacionEsco) {
        assert.equal(DATOS.esco.ocupaciones[caso.ocupacionEsco]?.isco08, caso.isco08, `${criterio}: su grupo coincide`);
      }
    }
    const distintos = new Set(
      CRITERIOS.map((criterio) => `${casos[criterio]?.ocupacionEsco ?? ''}|${casos[criterio]?.isco08}`),
    );
    assert.equal(distintos.size, CRITERIOS.length, 'cada criterio elige una ocupación distinta');
  });
}
