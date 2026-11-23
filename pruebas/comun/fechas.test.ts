// Las fechas del sitio en Node: el mismo texto, escrito a mano, que la prueba de los tres navegadores
// (pruebas/navegadores/fechas.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as cifras from '../../web/scripts/cifras.js';
import * as fechas from '../../web/scripts/fechas.js';
import * as formato from '../../web/scripts/recorrido/formato.js';
import * as documento from '../../web/scripts/recorrido/plan-formacion/textos-documento.js';
import { ESPERADO, escribirCasos } from './fechas-esperadas.ts';

test('cada formato escribe en Node el texto esperado en castellano y en catalán', () => {
  assert.deepEqual(escribirCasos({ fechas, formato, documento, cifras }, ESPERADO), ESPERADO);
});

test('la hora de Barcelona no depende de la zona del equipo', () => {
  const instante = '2026-10-25T01:30:00Z';
  assert.deepEqual(fechas.partesEnZona(instante, 'Europe/Madrid'), fechas.partesEnZona(instante));
  assert.equal(fechas.fechaIso(fechas.partesEnZona(instante, 'Pacific/Auckland')), '2026-10-25');
  assert.equal(fechas.horaEscrita(fechas.partesEnZona(instante, 'Pacific/Auckland')), '14:30');
});

test('la hora del dispositivo y la universal salen de los números del propio Date', () => {
  const instante = Date.parse('2026-01-05T08:05:09Z');
  const local = new Date(instante);
  assert.equal(fechas.partesLocales(instante).hora, local.getHours());
  assert.equal(fechas.partesLocales(instante).dia, local.getDate());
  assert.deepEqual(fechas.partesUtc(instante), {
    anio: 2026,
    mes: 1,
    dia: 5,
    hora: 8,
    minuto: 5,
    segundo: 9,
    diaSemana: 1,
  });
  assert.equal(fechas.fechaNumerica(fechas.partesUtc(instante)), '05/01/2026');
});

test('una fecha que no existe se rechaza en lugar de escribirse', () => {
  assert.throws(() => fechas.partesDelDia('2026-02-30'), TypeError);
  assert.throws(() => fechas.partesDelDia('2026-1-5'), TypeError);
  assert.throws(() => fechas.partesEnZona('mañana'), TypeError);
  assert.throws(() => fechas.partesUtc(Number.NaN), TypeError);
});

test('el informe escribe con las mismas tablas que la web', () => {
  const dia = fechas.partesDelDia('2026-08-03');
  assert.equal(fechas.fechaLarga(dia, 'ca'), '3 d’agost del 2026');
  assert.equal(fechas.mesYAnioEnFrase(dia, 'ca'), 'l’agost del 2026');
  assert.equal(fechas.mesYAnioEnFrase(fechas.partesDelDia('2026-06-03'), 'ca'), 'el juny del 2026');
  assert.equal(fechas.mesYAnioEnFrase(dia, 'es'), 'agosto de 2026');
  assert.equal(fechas.alMesCatalan('octubre'), 'a l’octubre');
  assert.equal(fechas.alMesCatalan('juny'), 'al juny');
  const miercoles = fechas.partesDelDia('2026-11-18').diaSemana;
  const domingo = fechas.partesDelDia('2026-11-22').diaSemana;
  assert.equal(fechas.nombreDelDia(miercoles, 'es'), 'miércoles');
  assert.equal(fechas.nombreDelDia(domingo, 'ca'), 'diumenge');
  assert.equal(fechas.fechaCorta(fechas.partesDelDia('0001-09-01'), 'es'), '1 sept. 1');
});

test('en catalán, el 1 y el 11 llevan el artículo apostrofado con cada preposición', () => {
  const casos = [
    ['el', 'l’1 d’oct. del 2026', 'el 25 d’oct. del 2026'],
    ['al', 'a l’1 d’oct. del 2026', 'al 25 d’oct. del 2026'],
    ['hasta', 'fins a l’1 d’oct. del 2026', 'fins al 25 d’oct. del 2026'],
    ['desde', 'des de l’1 d’oct. del 2026', 'des del 25 d’oct. del 2026'],
    ['de', 'de l’1 d’oct. del 2026', 'del 25 d’oct. del 2026'],
  ] as const;
  for (const [forma, conU, conVeinticinco] of casos) {
    const u = fechas.partesDelDia('2026-10-01');
    const veinticinco = fechas.partesDelDia('2026-10-25');
    assert.equal(fechas.conArticulo(fechas.fechaCorta(u, 'ca'), u.dia, 'ca', forma), conU);
    assert.equal(
      fechas.conArticulo(fechas.fechaCorta(veinticinco, 'ca'), veinticinco.dia, 'ca', forma),
      conVeinticinco,
    );
  }
  const once = fechas.partesDelDia('2026-11-11');
  assert.equal(
    fechas.conArticulo(fechas.fechaCorta(once, 'ca'), once.dia, 'ca', 'desde'),
    'des de l’11 de nov. del 2026',
  );
  assert.equal(fechas.conArticulo('1 oct. 2026', 1, 'es', 'hasta'), 'hasta el 1 oct. 2026');
  assert.equal(fechas.conArticulo('11 nov. 2026', once.dia, 'es', 'de'), 'del 11 nov. 2026');
});

test('la hora va sin cero dentro de una frase y con dos cifras en las cifras', () => {
  const temprano = fechas.partesEnZona('2026-11-16T05:10:00Z');
  const una = fechas.partesEnZona('2026-11-16T00:05:00Z');
  assert.equal(fechas.aLaHora(temprano, 'es'), 'a las 6:10');
  assert.equal(fechas.aLaHora(temprano, 'ca'), 'a les 6:10');
  assert.equal(fechas.aLaHora(una, 'es'), 'a la 1:05');
  assert.equal(fechas.aLaHora(una, 'ca'), 'a la 1:05');
  assert.equal(fechas.horaEscrita(temprano), '06:10');
  assert.equal(fechas.fechaNumericaConHora(temprano), '16/11/2026, 06:10');
});
