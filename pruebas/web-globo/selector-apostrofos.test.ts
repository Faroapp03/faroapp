import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contieneBusqueda, palabrasBuscadas } from '../../src/catalogo-cursos/busqueda.ts';
import type { Territorio } from '../../web/scripts/datos-globales/datos.js';
import { contienePalabra } from '../../web/scripts/recorrido/formato.js';
import { ElementoDePrueba, navegadorDePrueba } from './dom-globo.ts';

for (const [nombre, consulta] of [
  ['Costa d’Ivori', "Costa d'Ivori"],
  ["Costa d'Ivori", 'Costa d’Ivori'],
] as const) {
  test(`el selector encuentra ${consulta} aunque el nombre use otro apóstrofo`, async (t) => {
    const crear = (etiqueta: string) => new ElementoDePrueba(etiqueta);
    navegadorDePrueba(t, {
      HTMLElement: ElementoDePrueba,
      document: {
        documentElement: Object.assign(crear('html'), { lang: 'es', dataset: { idioma: 'es' } }),
        createElement: crear,
        createElementNS: (_espacio: string, etiqueta: string) => crear(etiqueta),
        createTextNode: (texto: string) => Object.assign(crear('#text'), { texto }),
      },
    });
    const { crearSelector, escucharSelector, pintarOpciones } = await import('../../web/scripts/globo/selector.js');
    const territorio = { codigo: 'TST', tipo: 'pais', nombre: { es: nombre, ca: nombre } } as Territorio;
    const selector = crearSelector();
    pintarOpciones(selector, [territorio], null);
    const controlador = new AbortController();
    t.after(() => controlador.abort());
    escucharSelector(selector, { alElegir: () => {}, alNoHaber: () => {} }, controlador.signal);
    selector.campo.value = consulta;
    selector.campo.dispatchEvent(new Event('input'));
    assert.equal(selector.campo.getAttribute('aria-activedescendant'), 'globo-pais-TST');
    assert.equal(selector.ninguno.hidden, true);
    assert.equal(selector.lista.children.length, 1);
  });
}

test('Cursos y el filtro de títulos del recorrido conservan la equivalencia en ambos sentidos', () => {
  for (const [nombre, consulta] of [
    ['Gestió d’informació', "gestio d'informacio"],
    ["Gestió d'informació", 'gestio d’informacio'],
  ] as const) {
    assert.equal(contieneBusqueda(nombre, palabrasBuscadas(consulta)), true);
    assert.equal(contienePalabra(nombre, consulta), true);
  }
});
