// Calendario UTC, conversiones y reloj sustituible, sin depender del huso local ni de esperas reales.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diaUtc, hoyUtc, MS_POR_DIA, MS_POR_MINUTO, MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';

const CAMBIOS_DE_DIA = [
  ['2026-10-12T23:59:59.999Z', '2026-10-12'],
  ['2026-10-13T00:00:00.000Z', '2026-10-13'],
  ['2026-12-31T23:59:59.999Z', '2026-12-31'],
  ['2027-01-01T00:00:00.000Z', '2027-01-01'],
] as const;
const CALENDARIO = [
  ['2024-02-29T12:00:00Z', '2024-02-29'],
  ['2000-02-29T12:00:00Z', '2000-02-29'],
  ['1900-03-01T00:00:00Z', '1900-03-01'],
  ['0000-01-01T00:00:00Z', '0000-01-01'],
  ['9999-12-31T23:59:59.999Z', '9999-12-31'],
] as const;
const FUERA_DEL_RANGO_DATE = 8_640_000_000_000_001;
const INSTANTES_INVALIDOS = [NaN, Infinity, -Infinity, FUERA_DEL_RANGO_DATE, -FUERA_DEL_RANGO_DATE];

test('diaUtc cambia de día y de año a medianoche UTC', () => {
  for (const [instante, esperado] of CAMBIOS_DE_DIA) {
    assert.equal(diaUtc(Date.parse(instante)), esperado);
  }
});

test('diaUtc conserva días bisiestos y los extremos del intervalo de años admitido', () => {
  for (const [instante, esperado] of CALENDARIO) {
    assert.equal(diaUtc(Date.parse(instante)), esperado);
  }
});

test('el offset del instante puede situar el día UTC antes o después de su fecha escrita', () => {
  assert.equal(diaUtc(Date.parse('2026-01-01T00:30:00+02:00')), '2025-12-31');
  assert.equal(diaUtc(Date.parse('2025-12-31T23:30:00-02:00')), '2026-01-01');
  assert.equal(diaUtc(Date.parse('2026-01-01T02:00:00+02:00')), '2026-01-01');
});

test('las unidades convierten diferencias de instantes sin depender del horario de verano', () => {
  const comienzo = Date.parse('2024-03-31T00:00:00Z');
  assert.equal(MS_POR_SEGUNDO, Date.parse('2024-03-31T00:00:01Z') - comienzo);
  assert.equal(MS_POR_MINUTO, Date.parse('2024-03-31T00:01:00Z') - comienzo);
  assert.equal(MS_POR_DIA, Date.parse('2024-04-01T00:00:00Z') - comienzo);
  assert.equal(diaUtc(comienzo + MS_POR_DIA), '2024-04-01');
});

test('hoyUtc acepta un instante fijo sin consultar el reloj y por defecto consulta Date.now', (contexto) => {
  const instanteDelReloj = Date.parse('2026-12-31T23:30:00-02:00');
  const reloj = contexto.mock.method(Date, 'now', () => instanteDelReloj);
  assert.equal(hoyUtc(Date.parse('2000-02-29T12:00:00Z')), '2000-02-29');
  assert.equal(reloj.mock.callCount(), 0);
  assert.equal(hoyUtc(), '2027-01-01');
  assert.equal(reloj.mock.callCount(), 1);
});

test('diaUtc y hoyUtc propagan RangeError para instantes no finitos o fuera del rango de Date', () => {
  for (const instante of INSTANTES_INVALIDOS) {
    assert.throws(() => diaUtc(instante), RangeError);
    assert.throws(() => hoyUtc(instante), RangeError);
  }
});
