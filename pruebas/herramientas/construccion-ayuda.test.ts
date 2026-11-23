// La ayuda de construcción muestra la opción que selecciona la entrada Cloudflare sin construir ni tocar salida.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('la ayuda de construcción incluye los dos destinos Cloudflare', () => {
  const orden = fileURLToPath(new URL('../../herramientas/web/construir.ts', import.meta.url));
  const resultado = spawnSync(process.execPath, [orden, '--ayuda'], { encoding: 'utf8' });
  assert.equal(resultado.status, 0);
  assert.equal(resultado.stderr, '');
  assert.match(resultado.stdout, /--destino-cloudflare privado\|oficial/u);
});
