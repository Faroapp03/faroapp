import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SeleccionFormacion } from '../../src/seleccion-formacion/contrato.ts';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { reescribirTextos } from '../../web/scripts/idioma.js';
import { crearPropuesta } from '../../web/scripts/recorrido/propuesta-hoja.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { type Nodo, prepararDom } from './dom.ts';
import { opcionSintetica } from './opcion-sintetica.ts';

await cargarDiccionario('es');
const TOTAL = 7;
function opcion(bloque: string, id: string) {
  const base = opcionSintetica(bloque, id);
  return { ...base, oferta: { ...base.oferta, titulo_programa: id } };
}
test('la elección sigue activa al cambiar de página y se confirma con la otra categoría', () => {
  prepararDom();
  fijarIdioma('es');
  const elecciones: (string | null)[][] = [];
  const opciones = Array.from({ length: TOTAL }, (_, i) => opcion('ia', String(i)));
  const vista = crearPropuesta(
    { opciones: { ia: opciones, digital: [opcion('digital', 'd')] } } as unknown as SeleccionFormacion,
    { alConfirmar: (a, b) => elecciones.push([a, b]), alRevisar: () => {}, alExcluir: () => {} },
  );
  document.body.append(vista);
  const filas = vista.querySelectorAll<HTMLElement>('.rc-hoja-curso');
  const nav = vista.querySelector('.rc-plan-paginas');
  assert.ok(nav && filas[0] && filas[6]);
  assert.equal(filas[0].hidden, false);
  assert.equal(filas[6].hidden, true);
  const radios = vista.querySelectorAll('input');
  const digital = [...radios].find((radio) => radio.value === 'd');
  assert.ok(radios[6] && digital);
  const botones = nav.querySelectorAll('button');
  assert.ok(botones[0] && botones[1]);
  (botones[1] as unknown as Nodo).dispatchEvent(new Event('click'));
  assert.equal(filas[0].hidden, true);
  assert.equal(filas[6].hidden, false);
  radios[6].checked = true;
  radios[6].dispatchEvent(new Event('change'));
  assert.match(nav.textContent ?? '', /Curso elegido: 6/u);
  fijarIdioma('ca');
  reescribirTextos();
  assert.match(nav.textContent ?? '', /Curs escollit: 6/u);
  assert.equal(botones[0].getAttribute('aria-label'), 'Pàgina anterior');
  digital.checked = true;
  (botones[0] as unknown as Nodo).dispatchEvent(new Event('click'));
  (vista.querySelector('.rc-boton-principal') as unknown as Nodo).dispatchEvent(new Event('click'));
  assert.deepEqual(elecciones, [['6', 'd']]);
});
