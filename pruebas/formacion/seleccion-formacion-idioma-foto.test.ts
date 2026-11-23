/**
 * Foto del idioma en el plan sobre el catálogo publicado del 18/11: cuántas ofertas tienen el idioma orientado por Faro
 * y cuántas entran en el plan en catalán. Las reglas que valen con cualquier catálogo están en
 * seleccion-formacion-idioma.test.ts.
 */
import assert from 'node:assert/strict';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { fotoDelPaquete } from '../ayudas/foto-del-paquete.ts';
import { CATALOGO_PUBLICADO, opcionesDelPlan, PREFERENCIAS } from '../fixtures/plan-del-catalogo-publicado.ts';

const foto = fotoDelPaquete({
  catalogo: '7bc6f1d393a90aca7dd3f46156c533e32a47a46c8f216041c3e0a5a97bc8a018',
  regenerar:
    'ejecuta esta prueba con el paquete nuevo, comprueba que cada diferencia la explica el cambio de datos y escribe aquí las cifras nuevas',
});

// 50 ofertas del Cibernàrium tienen el idioma orientado por Faro; 45 son de inteligencia artificial o de competencias
// digitales y entran en el plan, y 5 quedan fuera por su materia.
const ORIENTADAS_EN_EL_CATALOGO = 50;
const ORIENTADAS_PROPUESTAS = 45;

function clave(oferta: OfertaCatalogo): string {
  return JSON.stringify([oferta.unidad.tipo, oferta.unidad.id]);
}

foto('50 ofertas tienen el idioma orientado por Faro y 45 entran en el plan de quien pide catalán', () => {
  const origenes = new Map(proyectarListado(CATALOGO_PUBLICADO).ofertas.map((f) => [f.identidad, f.origenIdioma]));
  const orientadas = CATALOGO_PUBLICADO.ofertas.filter((o) =>
    ['faro', 'historial-cibernarium'].includes(String(origenes.get(clave(o)))),
  );
  assert.equal(orientadas.length, ORIENTADAS_EN_EL_CATALOGO);
  const enCatalan = new Set(
    opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, idiomas: ['ca'] }).map((o) => clave(o.oferta)),
  );
  assert.equal(orientadas.filter((o) => enCatalan.has(clave(o))).length, ORIENTADAS_PROPUESTAS);
});
