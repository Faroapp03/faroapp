import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { tamanosDelPaquete } from '../../herramientas/web/copia-sin-conexion.ts';
import { valoresDelServicio } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { servicioPublicado } from '../ayudas/web-construida.ts';

const GRANDE = 2048;

test('los tamaños llevan lo que pesa cada archivo del manifiesto, en orden, sin nombres raros ni ausentes', (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-tamanos-'));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  writeFileSync(join(carpeta, 'b-grande.json'), 'x'.repeat(GRANDE));
  writeFileSync(join(carpeta, 'a.json'), '{}');
  const manifiesto = { 'b-grande.json': {}, 'a.json': {}, 'falta.json': {}, '../../api': {} };
  writeFileSync(join(carpeta, 'manifiesto.json'), JSON.stringify(manifiesto));
  assert.equal(tamanosDelPaquete(carpeta), '{"a.json":2,"b-grande.json":2048}');
});

test('el service worker publicado lleva los tamaños del paquete de datos/ vigente', () => {
  const servicio = servicioPublicado();
  const escritos = valoresDelServicio(servicio).TAMANOS_DEL_PAQUETE;
  assert.equal(escritos, tamanosDelPaquete(), 'TAMANOS_DEL_PAQUETE está al día (npm run web:preparar)');
  const tamanos: Record<string, number> = JSON.parse(escritos);
  const manifiesto = JSON.parse(readFileSync(join(RUTAS.paquete, 'manifiesto.json'), 'utf8'));
  assert.deepEqual(Object.keys(tamanos).sort(), Object.keys(manifiesto).sort());
  for (const [archivo, tamano] of Object.entries(tamanos)) {
    assert.equal(tamano, statSync(join(RUTAS.paquete, archivo)).size, archivo);
  }
});
