import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reescribirTextos } from '../../web/scripts/idioma.js';
import { crearCalendario } from '../../web/scripts/recorrido/formacion/calendario-selector.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { prepararDom } from './dom.ts';

test('el calendario actualiza sus rótulos y fechas al cambiar de idioma', () => {
  prepararDom();
  fijarIdioma('es');
  const campo = document.createElement('input');
  campo.type = 'date';
  campo.value = '2026-02-10';
  const vida = new AbortController();
  const calendario = crearCalendario(campo, { signal: vida.signal, vigente: () => true });
  document.body.append(calendario.elemento);
  assert.match(calendario.elemento.textContent ?? '', /febrero de 2026/u);
  assert.match(calendario.elemento.textContent ?? '', /Fecha elegida/u);
  fijarIdioma('ca');
  reescribirTextos();
  assert.match(calendario.elemento.textContent ?? '', /febrer del 2026/u);
  assert.match(calendario.elemento.textContent ?? '', /Data escollida/u);
  const siguiente = calendario.elemento.querySelectorAll('button')[1];
  assert.equal(siguiente?.getAttribute('aria-label'), 'Mes següent');
  assert.equal(campo.value, '2026-02-10');
  vida.abort();
});
