import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { comprobarRegistroDeExtensiones } from '../../herramientas/web/registro-de-extensiones.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { VARIANTES_RECORRIDO, varianteInstalada } from '../../src/plataforma/variantes-recorrido.ts';
import { SECCIONES_WEB } from '../../web/scripts/secciones-contrato.js';
import { VARIANTES_INSTALADAS } from '../../web/scripts/variantes-disponibles.js';

test('la instalación y las entradas de construcción solo contienen el recorrido real', () => {
  assert.deepEqual(EXTENSIONES, []);
  assert.equal(existsSync(fileURLToPath(new URL('../../web/demo', import.meta.url))), false);
  assert.deepEqual(
    comprobarRegistroDeExtensiones(fileURLToPath(new URL('../../web', import.meta.url)), EXTENSIONES),
    [],
  );
  assert.deepEqual(
    VARIANTES_RECORRIDO.map(({ id }) => id),
    ['real'],
  );
  assert.equal(varianteInstalada('demo'), false);
  assert.deepEqual(Object.keys(VARIANTES_INSTALADAS), []);
  assert.deepEqual(SECCIONES_WEB.find(({ id }) => id === 'recorrido')?.rutas, [
    '/recorrido.html',
    '/informe-ejemplo.html',
  ]);
});
