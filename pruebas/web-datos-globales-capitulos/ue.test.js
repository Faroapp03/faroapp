// Las piezas de la página «Unión Europea» de «Datos globales» llamadas una a una, con el DOM de prueba y los datos
// publicados (datos/datos-globales.json) o cambiados en un campo: las metas (scripts/datos-globales/
// union-europea-metas.js) con su escala real; las filas de un gráfico cuando son de años distintos
// (union-europea-piezas.js); y «Lo esencial» de la UE (union-europea.js), con sus cifras y sin la que pierde su meta. Se ejecutan con node --test pruebas/web-datos-globales-capitulos/*.test.js.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import {
  almacenEnMemoria,
  CLASES_DE_NODO,
  definido,
  elemento,
  navegadorDePrueba,
  paginaDePrueba,
  sinRedDeVerdad,
} from './dom.ts';

sinRedDeVerdad();

const PUBLICADOS = readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8');
const UE = 'EU27_2020';
/** Las metas de la muestra, una fila cada una: capacidades, especialistas, empresas y pymes. */
const METAS_DE_LA_MUESTRA = 4;
/** Una meta de capacidades digitales por debajo de la cifra de la UE: ya alcanzada. */
const META_ALCANZADA = 40;
/** Las cifras de «Lo esencial» de la UE con todos sus datos: empresas, personas, capacidades y especialistas. */
const CLAVES_DE_LA_UE = 4;

/**
 * Los datos publicados con un cambio en su JSON, leídos con el lector de la página.
 * @param {(datos: import('./fixture-tipos.js').Crudos) => void} [cambiar] @returns {import('../../web/scripts/datos-globales/datos.js').DatosGlobales}
 */
function datosCon(cambiar = () => {}) {
  /** @type {import('./fixture-tipos.js').Crudos} */
  const crudos = JSON.parse(PUBLICADOS);
  cambiar(crudos);
  return leerDatosGlobales(crudos);
}

/** Los valores de la UE de un JSON crudo. @param {import('./fixture-tipos.js').Crudos} crudos @returns {import('./fixture-tipos.js').ValorCrudo[]} */
function valoresDeLaUe(crudos) {
  return definido(crudos.territorios.find((/** @type {{ codigo: string }} */ { codigo }) => codigo === UE)).valores;
}

/**
 * Pone el DOM de prueba y el idioma, e importa los módulos de la UE.
 * @param {import('node:test').TestContext} contexto
 */
async function piezasDeLaUe(contexto) {
  const { documento } = paginaDePrueba();
  navegadorDePrueba(contexto, {
    ...CLASES_DE_NODO,
    document: documento,
    localStorage: almacenEnMemoria(),
    location: { href: 'https://faroapp.org/datos-globales-ue.html' },
  });
  const { iniciarIdioma } = await import('../../web/scripts/idioma.js');
  await iniciarIdioma();
  return {
    ...(await import('../../web/scripts/datos-globales/union-europea-metas.js')),
    ...(await import('../../web/scripts/datos-globales/union-europea-piezas.js')),
    ...(await import('../../web/scripts/datos-globales/union-europea.js')),
  };
}

test('las metas: una fila por meta, con su escala real (0–100 % o en millones) y la raya de la meta', async (contexto) => {
  const { metas } = await piezasDeLaUe(contexto);
  const capitulo = elemento(metas(datosCon())[0]);
  const filas = capitulo.querySelectorAll('div.dg-meta-fila');
  assert.equal(filas.length, METAS_DE_LA_MUESTRA);
  const [capacidades, especialistas] = filas;
  assert.ok(capacidades && especialistas);
  const marcas = (/** @type {import('./dom.ts').Nodo} */ fila) =>
    fila.querySelectorAll('text.eje').map((n) => n.textContent);
  assert.deepEqual(marcas(capacidades), ['0 %', '20 %', '40 %', '60 %', '80 %', '100 %']);
  assert.deepEqual(marcas(especialistas), ['0 M', '5 M', '10 M', '15 M', '20 M', '25 M']);
  assert.equal(capacidades.querySelectorAll('line.raya-meta').length, 1);
  assert.equal(capacidades.querySelectorAll('line.marca-anterior').length, 2, '2021 y 2023, dentro de la barra');
  assert.equal(capacidades.querySelector('p.dg-meta-nota')?.dataset.texto, 'datos-globales.ue.metas.anteriores');
});

test('con la meta alcanzada no hay «faltan», y la barra no se sale de su escala', async (contexto) => {
  const { metas } = await piezasDeLaUe(contexto);
  const datos = datosCon((crudos) => {
    const meta = definido(
      crudos.metas.find((/** @type {{ id: string }} */ { id }) => id === 'meta-capacidades-digitales'),
    );
    meta.valor = META_ALCANZADA;
  });
  const [primera] = elemento(metas(datos)[0]).querySelectorAll('div.dg-meta-fila');
  assert.equal(primera?.querySelector('p.dg-meta-falta')?.dataset.texto, 'datos-globales.ue.metas.alcanzada');
});

test('un gráfico de barras de la UE solo junta filas del mismo año, el de la primera con cifra', async (contexto) => {
  const { filasUe } = await piezasDeLaUe(contexto);
  const filas = /** @type {[string, string, boolean?][]} */ ([
    ['empresas-ia', 'datos-globales.ue.empresas.todas', true],
    ['capacidades-digitales-basicas', 'datos-globales.ue.capacidades.al-menos'],
  ]);
  assert.equal(filasUe(datosCon(), filas, true).filas.length, 2, 'del mismo año, las dos');
  const otroAnio = datosCon((crudos) => {
    for (const valor of valoresDeLaUe(crudos).filter((v) => v.indicador === 'capacidades-digitales-basicas')) {
      valor.anio -= 1;
    }
  });
  assert.equal(filasUe(otroAnio, filas, true).filas.length, 1, 'de otro año, fuera');
  const [total] = filasUe(datosCon(), filas, true).filas;
  assert.equal(total?.papel, 'ue', 'el total, en el color de la UE');
});

test('«Lo esencial» de la UE: cuatro cifras con su frase, y sin la meta de una se queda sin ella', async (contexto) => {
  const { clavesDeLaUe } = await piezasDeLaUe(contexto);
  const temas = (/** @type {HTMLLIElement[]} */ lista) =>
    lista.map((li) => elemento(li).querySelector('p.dg-esencial-significado')?.dataset.texto);
  assert.deepEqual(temas(clavesDeLaUe(datosCon())), [
    'datos-globales.ue.esencial.empresas',
    'datos-globales.ue.esencial.personas',
    'datos-globales.ue.esencial.capacidades',
    'datos-globales.ue.esencial.especialistas',
  ]);
  const sinMeta = temas(
    clavesDeLaUe(
      datosCon((crudos) => {
        crudos.metas = crudos.metas.filter((/** @type {{ id: string }} */ { id }) => id !== 'meta-especialistas-tic');
      }),
    ),
  );
  assert.ok(!sinMeta.includes('datos-globales.ue.esencial.especialistas'));
  assert.equal(sinMeta.length, CLAVES_DE_LA_UE - 1);
});
