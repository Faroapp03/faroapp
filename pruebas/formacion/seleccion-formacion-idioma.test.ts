/** El plan decide el idioma con la misma pieza que Cursos, sobre el catálogo publicado del árbol. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import type { FichaListado } from '../../src/catalogo-cursos/listado.ts';
import { proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { idiomasDeLaEntrega } from '../../src/seleccion-formacion/idioma-del-plan.ts';
import {
  CATALOGO_PUBLICADO,
  opcionConOrigen,
  opcionesDelPlan,
  PREFERENCIAS,
} from '../fixtures/plan-del-catalogo-publicado.ts';

// Valen para cualquier catálogo que cumpla su contrato; cuántas ofertas tienen el idioma orientado por Faro en el
// catálogo de una fecha, en la foto seleccion-formacion-idioma-foto.test.ts.

function clave(oferta: OfertaCatalogo): string {
  return JSON.stringify([oferta.unidad.tipo, oferta.unidad.id]);
}
const fichas = new Map<string, FichaListado>(proyectarListado(CATALOGO_PUBLICADO).ofertas.map((f) => [f.identidad, f]));
const opciones = opcionesDelPlan();

test('un curso con idioma del programa entra en el plan con su origen', () => {
  assert.deepEqual(opcionConOrigen('programa').idioma, { idiomas: ['es'], origen: 'programa' });
});

test('un curso con idioma de la norma general del centro entra en el plan con su origen', () => {
  assert.deepEqual(opcionConOrigen('norma-general').idioma, { idiomas: ['ca', 'es'], origen: 'norma-general' });
});

test('un curso sin idioma conocido entra en el plan con el idioma por confirmar', () => {
  // Cibervoluntarios no tiene norma general, historial ni idioma de programa: sin su declaración no queda ningún idioma.
  const base = opciones.find((o) => o.oferta.proveedor_id === 'cibervoluntarios')?.oferta;
  assert.ok(base);
  const sinIdioma: OfertaCatalogo = {
    ...base,
    hechos: {
      ...base.hechos,
      idiomas_declarados: { ...base.hechos.idiomas_declarados, motivo: 'no_consta_en_evidencia', valor: null },
    },
  };
  const entrega = { ...CATALOGO_PUBLICADO, ofertas: [sinIdioma] };
  assert.deepEqual(idiomasDeLaEntrega(entrega)(sinIdioma), { idiomas: ['no-indicado'], origen: null });
  const [propuesta, ...resto] = opcionesDelPlan(entrega, { ...PREFERENCIAS, idiomas: ['ca'] });
  assert.deepEqual(resto, []);
  assert.equal(propuesta?.oferta, sinIdioma);
  assert.deepEqual(propuesta?.porConfirmar, ['idioma']);
});

test('una orientación de Faro que coincide con la persona entra en el plan con su origen y por confirmar', () => {
  const orientadas = CATALOGO_PUBLICADO.ofertas.filter((o) => {
    const origen = fichas.get(clave(o))?.origenIdioma;
    return origen === 'faro' || origen === 'historial-cibernarium';
  });
  const enCatalan = new Map(
    opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, idiomas: ['ca'] }).map((o) => [clave(o.oferta), o]),
  );
  const propuestas = orientadas.flatMap((o) => enCatalan.get(clave(o)) ?? []);
  // La que no entra en catalán tampoco entra con los tres idiomas: queda fuera por su materia, no por el idioma.
  const conTodos = new Set(opciones.map((o) => clave(o.oferta)));
  assert.deepEqual(orientadas.filter((o) => !enCatalan.has(clave(o)) && conTodos.has(clave(o))).map(clave), []);
  for (const opcion of propuestas) {
    assert.deepEqual(opcion.idioma.idiomas, ['ca']);
    assert.ok(opcion.porConfirmar.includes('idioma'));
  }
});

test('una orientación de Faro que no coincide con la persona no entra en el plan', () => {
  const enCastellano = new Set(
    opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, idiomas: ['es'] }).map((o) => clave(o.oferta)),
  );
  const orientadas = CATALOGO_PUBLICADO.ofertas.filter((o) => {
    const origen = fichas.get(clave(o))?.origenIdioma;
    return origen === 'faro' || origen === 'historial-cibernarium';
  });
  assert.equal(orientadas.filter((o) => enCastellano.has(clave(o))).length, 0);
});

test('Cursos y el plan dan el mismo idioma y el mismo origen para todas las ofertas del catálogo publicado', () => {
  const idiomaDe = idiomasDeLaEntrega(CATALOGO_PUBLICADO);
  let comparadas = 0;
  for (const oferta of CATALOGO_PUBLICADO.ofertas) {
    const ficha = fichas.get(clave(oferta));
    if (!ficha) {
      continue;
    }
    assert.deepEqual(idiomaDe(oferta), { idiomas: ficha.idiomas, origen: ficha.origenIdioma }, clave(oferta));
    comparadas += 1;
  }
  assert.equal(comparadas, fichas.size);
  for (const opcion of opciones) {
    const ficha = fichas.get(clave(opcion.oferta));
    assert.ok(ficha);
    assert.deepEqual(opcion.idioma, { idiomas: ficha.idiomas, origen: ficha.origenIdioma });
  }
});
