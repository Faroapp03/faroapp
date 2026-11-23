import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { comprobarFuentesDeLaWeb, prepararWeb } from '../../herramientas/web/preparar.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';

test('el paquete, el motor, el service worker y el manifiesto del dispositivo no pueden quedar en las fuentes', (t) => {
  const web = mkdtempSync(join(tmpdir(), 'faro-fuentes-web-'));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  writeFileSync(join(web, '.assetsignore'), '');
  const generados = ['paquete/b1a5ce9ca7a9077c/a.json', 'motor/m.js', 'service-worker.js', 'firmas/manifiesto.json'];
  const sinGenerados = comprobarFuentesDeLaWeb(web);
  for (const ruta of generados) {
    mkdirSync(join(web, ruta, '..'), { recursive: true });
    writeFileSync(join(web, ruta), '{}');
  }
  const problemas = comprobarFuentesDeLaWeb(web).filter((problema) => !sinGenerados.includes(problema));
  assert.deepEqual(
    problemas.map((problema) => problema.split(':')[0]),
    ['service-worker.js', 'motor', 'paquete', 'firmas/manifiesto.json'],
  );
});

test('la preparación no escribe nunca en las fuentes de web/', async () => {
  await assert.rejects(
    prepararWeb({ web: RUTAS.web, paquete: RUTAS.paquete, motor: new Map() }),
    /nunca en las fuentes de web\//,
  );
});
