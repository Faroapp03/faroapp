import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorSinSecretos } from './remoto-ayudas.mjs';

test('el diagnóstico conserva el tipo y oculta credenciales y direcciones', () => {
  const usuario = 'usuario-sintetico';
  const clave = 'clave/sintetica';
  const base64 = Buffer.from(`${usuario}:${clave}`).toString('base64');
  const error = new Error(
    `Fallo ${usuario} ${clave} ${encodeURIComponent(clave)} Basic ${base64} https://ejemplo.invalid/ruta\nDetalle oculto`,
  );
  const visto = errorSinSecretos(error, [usuario, clave, base64]);
  assert.equal(visto.nombre, 'Error');
  assert.match(visto.mensaje, /Fallo/);
  for (const secreto of [usuario, clave, encodeURIComponent(clave), base64, 'ejemplo.invalid', 'Detalle oculto']) {
    assert.ok(!visto.mensaje.includes(secreto));
  }
});
