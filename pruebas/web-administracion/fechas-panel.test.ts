import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diaPanel, diaUtc, fechaConUtc, fechaPanel, fechaTecnica } from '../../web/administracion/fechas-panel.js';
import { activarIdiomaPanel } from './idiomas.ts';

const ms = (iso: string) => Date.parse(iso);

test('marzo: la hora de Cataluña pasa de UTC+1 a UTC+2 el 29/03/2026 y el día se cuenta en hora local', () => {
  activarIdiomaPanel('es');
  const ahora = ms('2026-03-29T10:00:00Z');
  // 23:30 UTC del sábado ya es domingo en Cataluña (UTC+1).
  assert.equal(fechaPanel('2026-03-28T23:30:00Z', ahora), 'hoy a las 0:30');
  // Justo antes del cambio, la una se dice en singular.
  assert.equal(fechaPanel('2026-03-29T00:59:00Z', ahora), 'hoy a la 1:59');
  // Justo después del cambio, UTC+2: las 03:30.
  assert.equal(fechaPanel('2026-03-29T01:30:00Z', ahora), 'hoy a las 3:30');
  assert.equal(fechaPanel('2026-03-26T12:00:00Z', ahora), 'hace 3 días, el 26 mar. 2026 a las 13:00');
  // Un día de 23 horas sigue contando como un día de calendario.
  assert.equal(fechaPanel('2026-03-28T23:30:00Z', ms('2026-03-30T00:30:00Z')), 'ayer a las 0:30');
});

test('octubre: la hora de Cataluña vuelve de UTC+2 a UTC+1 el 25/10/2026, también en catalán', () => {
  activarIdiomaPanel('es');
  const ahora = ms('2026-10-25T10:00:00Z');
  assert.equal(fechaPanel('2026-10-24T22:30:00Z', ahora), 'hoy a las 0:30');
  // Las 02:30 se repiten: antes del cambio (UTC+2) y después (UTC+1).
  assert.equal(fechaPanel('2026-10-25T00:30:00Z', ahora), 'hoy a las 2:30');
  assert.equal(fechaPanel('2026-10-25T01:30:00Z', ahora), 'hoy a las 2:30');
  assert.equal(fechaPanel('2026-10-25T23:30:00Z', ahora), 'mañana a las 0:30');
  assert.equal(fechaPanel('2026-10-20T12:00:00Z', ahora), 'hace 5 días, el 20 oct. 2026 a las 14:00');
  assert.equal(fechaPanel('2026-10-30T12:00:00Z', ahora), 'dentro de 5 días, el 30 oct. 2026 a las 13:00');
  activarIdiomaPanel('ca');
  assert.equal(fechaPanel('2026-10-24T22:30:00Z', ahora), 'avui a les 0:30');
  assert.equal(fechaPanel('2026-10-24T23:10:00Z', ms('2026-10-26T10:00:00Z')), 'ahir a la 1:10');
  assert.equal(fechaPanel('2026-10-25T00:10:00Z', ms('2026-10-26T10:00:00Z')), 'ahir a les 2:10');
  assert.equal(fechaPanel('2026-10-20T12:00:00Z', ahora), 'fa 5 dies, el 20 d’oct. del 2026 a les 14:00');
  assert.equal(fechaPanel('2026-10-30T12:00:00Z', ahora), 'd’aquí a 5 dies, el 30 d’oct. del 2026 a les 13:00');
  activarIdiomaPanel('es');
});

test('un día sin hora se compara con hoy en Cataluña sin aplicarle zona', () => {
  activarIdiomaPanel('es');
  // A las 23:30 UTC del 24/10 ya es 25/10 en Cataluña.
  const ahora = ms('2026-10-24T23:30:00Z');
  assert.equal(diaPanel('2026-10-25', ahora), 'hoy');
  assert.equal(diaPanel('2026-10-24', ahora), 'ayer');
  assert.equal(diaPanel('2026-10-26', ahora), 'mañana');
  assert.equal(diaPanel('2026-09-30', ahora), 'hace 25 días, el 30 sept. 2026');
  activarIdiomaPanel('ca');
  assert.equal(diaPanel('2027-01-05', ahora), 'd’aquí a 72 dies, el 5 de gen. del 2027');
  activarIdiomaPanel('es');
});

test('la UTC solo acompaña al detalle técnico, sin redondear el registro, y lo no representable se dice', () => {
  activarIdiomaPanel('es');
  const ahora = ms('2026-10-17T15:00:00Z');
  assert.equal(
    fechaConUtc('2026-10-17T12:00:00.123456Z', ahora),
    'hoy a las 14:00 (registro en UTC: 2026-10-17T12:00:00.123456Z)',
  );
  assert.equal(
    fechaConUtc(ms('2026-10-17T12:00:00Z'), ahora),
    'hoy a las 14:00 (registro en UTC: 2026-10-17T12:00:00.000Z)',
  );
  assert.doesNotMatch(fechaPanel('2026-10-17T12:00:00Z', ahora), /UTC|T12/u);
  for (const valor of [Number.MAX_SAFE_INTEGER, 'no es una fecha']) {
    assert.equal(fechaPanel(valor, ahora), 'Fecha no representable');
    assert.equal(fechaConUtc(valor, ahora), 'Fecha no representable');
  }
  assert.equal(diaPanel('2026-13-40', ahora), 'Fecha no representable');
  // Un día que no existe no se normaliza al mes siguiente.
  assert.equal(diaPanel('2026-02-30', ahora), 'Fecha no representable');
  assert.equal(diaUtc('2026-02-30'), 'Fecha no representable');
  assert.equal(diaUtc('2026-11-14'), '14/11/2026');
  assert.equal(fechaTecnica('2026-10-17', 'panel.sin-registro', ahora), 'hoy (día registrado: 2026-10-17)');
  assert.equal(fechaTecnica(null, 'panel.sin-registro', ahora), 'Sin registro');
});

test('en las frases, el día lleva su nombre y su artículo: el 1, el 11 y el 25, en castellano y en catalán', () => {
  const ahora = ms('2026-12-30T12:00:00Z');
  const casos = [
    ['2026-12-01', 'hace 29 días, el 1 dic. 2026', 'fa 29 dies, l’1 de des. del 2026'],
    ['2026-12-11', 'hace 19 días, el 11 dic. 2026', 'fa 19 dies, l’11 de des. del 2026'],
    ['2026-12-25', 'hace 5 días, el 25 dic. 2026', 'fa 5 dies, el 25 de des. del 2026'],
  ] as const;
  for (const [dia, es, ca] of casos) {
    activarIdiomaPanel('es');
    assert.equal(diaPanel(dia, ahora), es);
    activarIdiomaPanel('ca');
    assert.equal(diaPanel(dia, ahora), ca);
  }
  activarIdiomaPanel('es');
});
