import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const programa = fileURLToPath(new URL('../../herramientas/web/comprobar-hechos-informe.ts', import.meta.url));
const registro = fileURLToPath(
  new URL('../../plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json', import.meta.url),
);
const ejecutar = (...argumentos: string[]) =>
  spawnSync(process.execPath, [programa, ...argumentos], { encoding: 'utf8' });

test('la orden admite solo una ruta opcional y nunca modifica el registro', () => {
  const antes = readFileSync(registro);
  const normal = ejecutar();
  const explicita = ejecutar(registro);
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(explicita.status, 0, explicita.stderr);
  assert.deepEqual(JSON.parse(explicita.stdout), JSON.parse(normal.stdout));
  for (const args of [[registro, registro], ['--desconocida']]) {
    const salida = ejecutar(...args);
    assert.equal(salida.status, 2);
    assert.match(salida.stderr, /Uso:/u);
    assert.equal(salida.stdout, '');
  }
  assert.notEqual(ejecutar(`${registro}.ausente`).status, 0);
  assert.deepEqual(readFileSync(registro), antes);
});
