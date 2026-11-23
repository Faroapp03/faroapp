import assert from 'node:assert/strict';
import test from 'node:test';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { identidadAlArrancar } from './identidad-al-arrancar.ts';

const AGENTE_MOVIL = IDENTIDAD_WEB['User-Agent'].replace('(Windows NT 10.0; Win64; x64)', '(Linux; Android 10; K)');

test('sin agente, cada motor arranca con la identidad web del proyecto', () => {
  assert.deepEqual(identidadAlArrancar('chromium'), { args: [`--user-agent=${IDENTIDAD_WEB['User-Agent']}`] });
  assert.deepEqual(identidadAlArrancar('firefox'), {
    firefoxUserPrefs: { 'general.useragent.override': IDENTIDAD_WEB['User-Agent'] },
  });
  assert.deepEqual(identidadAlArrancar('webkit'), {});
});

test('con agente, Chromium y Firefox lo presentan y Chromium conserva sus otros argumentos', () => {
  assert.notEqual(AGENTE_MOVIL, IDENTIDAD_WEB['User-Agent']);
  assert.deepEqual(identidadAlArrancar('chromium', ['--ignore-certificate-errors'], AGENTE_MOVIL), {
    args: [`--user-agent=${AGENTE_MOVIL}`, '--ignore-certificate-errors'],
  });
  assert.deepEqual(identidadAlArrancar('firefox', [], AGENTE_MOVIL), {
    firefoxUserPrefs: { 'general.useragent.override': AGENTE_MOVIL },
  });
  assert.deepEqual(identidadAlArrancar('webkit', [], AGENTE_MOVIL), {});
});
