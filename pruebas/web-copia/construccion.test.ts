// Una instalación mínima real comprueba catálogo/huellas/versiones; no acredita navegación offline completa. El motor
// de COMPROBADOS es el que declara su contexto (contexto-de-prueba.ts, de aislada.ts): la comprobación no lo compila.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { copiaAislada, entradaDePrueba } from './aislada.ts';

const PROGRAMA = `
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobarServiceWorker, generarCatalogos } from './copia-sin-conexion.ts';
import { contexto, HUELLA } from './contexto-de-prueba.ts';
import { leer, WEB } from './publicados.ts';
import { listasDelCatalogo, valoresDelServicio } from './servicio/servicio-publicado.ts';
const publicados = Object.keys(${JSON.stringify(entradaDePrueba())}).concat('scripts/json.js', 'activar-acceso.html');
await generarCatalogos(publicados, HUELLA, contexto());
assert.deepEqual(await comprobarServiceWorker(publicados, HUELLA, contexto()), []);
const { ARCHIVOS, BAJO_DEMANDA, COMPROBADOS } = listasDelCatalogo(valoresDelServicio(leer('service-worker.js')).CATALOGO);
assert.ok(![...ARCHIVOS, ...BAJO_DEMANDA].some((ruta) => ruta.includes('activar-acceso')));
const comprobados = COMPROBADOS.map(([ruta]) => ruta);
assert.ok(!comprobados.some((ruta) => ruta.includes('activar-acceso')));
assert.ok(comprobados.some((ruta) => ruta.startsWith('motor/src/')));
assert.ok(!comprobados.some((ruta) => ruta.startsWith('motor/motor/')));
writeFileSync(join(WEB, 'scripts/json.js'), 'export const cambiado = true;');
const problemas = await comprobarServiceWorker(publicados, HUELLA, contexto());
assert.ok(problemas.some((problema) => problema.includes('huella de «scripts/json.js»')));
assert.ok(problemas.some((problema) => problema.includes('VERSION es')));
process.stdout.write(JSON.stringify({ correcto: true, detectaCambioProtegido: true }));
`;

test('catálogos de una web aislada pasan y un cambio protegido rompe SHA y VERSION', () => {
  const archivos = {
    ...entradaDePrueba(),
    'scripts/json.js': readFileSync(new URL('../../web/scripts/json.js', import.meta.url), 'utf8'),
    'activar-acceso.html': '<p>Operativo</p>',
    'motor/src/plataforma/navegador/motor.js': 'export const motor = true;\n',
  };
  assert.deepEqual(JSON.parse(copiaAislada(archivos, PROGRAMA)), { correcto: true, detectaCambioProtegido: true });
});
