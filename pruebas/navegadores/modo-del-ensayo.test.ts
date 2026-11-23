import assert from 'node:assert/strict';
import test from 'node:test';
import { MOTIVO_OFICIAL, MOTIVO_SIN_DESTINO, modoDelEnsayo } from './modo-del-ensayo.ts';
import { CLAVE_SINTETICA, USUARIO_SINTETICO } from './privado.ts';

test('una construcción privada se ensaya con la clave de pruebas que el fixture da a su Worker', () => {
  assert.deepEqual(modoDelEnsayo('privado'), {
    destino: 'privado',
    credenciales: { username: USUARIO_SINTETICO, password: CLAVE_SINTETICA },
  });
});

test('una construcción oficial se rechaza y se remite a su ensayo con el portal', () => {
  assert.throws(() => modoDelEnsayo('oficial'), { message: MOTIVO_OFICIAL });
  assert.match(MOTIVO_OFICIAL, /portal-oficial-miniflare\.mjs/);
});

test('una construcción sin destino declarado es un error', () => {
  for (const destino of [undefined, null, '', 'Privado']) {
    assert.throws(() => modoDelEnsayo(destino), { message: MOTIVO_SIN_DESTINO });
  }
});
