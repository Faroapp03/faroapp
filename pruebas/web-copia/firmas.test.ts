import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copiaAislada, entradaDePrueba } from './aislada.ts';

const CIFRAS_SHA256 = 64;
test('FIRMAS ausente, mal formada o no vacía no pasa la comprobación, y la generación la deja vacía sin arrastrarla', () => {
  for (const declaracion of [
    '',
    'var FIRMAS = [["x", "rota"]];',
    `var FIRMAS = [["x", "${'a'.repeat(CIFRAS_SHA256)}"]];`,
  ]) {
    const archivos: Record<string, string> = {
      ...entradaDePrueba(),
      'motor/src/plataforma/navegador/motor.js': 'export const motor = true;\n',
    };
    archivos['service-worker.js'] = archivos['service-worker.js']?.replace('var FIRMAS = [];', declaracion) ?? '';
    const salida = copiaAislada(
      archivos,
      `
import assert from 'node:assert/strict';
const { generarCatalogos, comprobarServiceWorker } = await import('./copia-sin-conexion.ts');
const { contexto, HUELLA } = await import('./contexto-de-prueba.ts');
const { valoresDelServicio } = await import('./servicio/servicio-publicado.ts');
import { leer } from './publicados.ts';
const publicados = ${JSON.stringify(Object.keys(archivos).filter((archivo) => !archivo.startsWith('motor/')))};
assert.ok((await comprobarServiceWorker(publicados, HUELLA, contexto())).some((problema) => /FIRMAS/.test(problema)));
await generarCatalogos(publicados, HUELLA, contexto());
assert.deepEqual(valoresDelServicio(leer('service-worker.js')).FIRMAS, []);
assert.deepEqual(await comprobarServiceWorker(publicados, HUELLA, contexto()), []);
process.stdout.write('rechazada');
`,
    );
    assert.equal(salida, 'rechazada');
  }
});
