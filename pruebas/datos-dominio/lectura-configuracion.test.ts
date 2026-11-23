// Lectores compartidos de configuración local: mantienen límites, rechazo de enlaces y errores sin contenido.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { leerTextoConfiguracion } from '../../src/plataforma/node/lectura-configuracion.ts';

const BYTES_EXCESIVOS = 65_537;
const PLAZO_HIJO_MS = 1000;
function espacio(prueba: TestContext) {
  const raiz = mkdtempSync(join(tmpdir(), 'Faro configuración Año #1 % '));
  prueba.after(() => rmSync(raiz, { recursive: true, force: true }));
  const perfil = join(raiz, 'candidato.json');
  writeFileSync(perfil, 'FARO_MCP=si\n');
  const red = prueba.mock.method(globalThis, 'fetch', () => {
    throw new Error('Red prohibida en esta prueba');
  });
  return { raiz, perfil, red };
}
test('el lector limita el tamaño de configuración y rechaza directorios', (prueba) => {
  const caso = espacio(prueba);
  const enorme = join(caso.raiz, 'enorme.json');
  writeFileSync(enorme, ' '.repeat(BYTES_EXCESIVOS));
  assert.throws(() => leerTextoConfiguracion(enorme));
  assert.throws(() => leerTextoConfiguracion(caso.raiz));
});

test('UTF-8 inválido se rechaza sin sustituir caracteres de la configuración', (prueba) => {
  const caso = espacio(prueba);
  const comillaJson = 0x22;
  const byteInvalidoUtf8 = 0xff;
  writeFileSync(caso.perfil, Buffer.from([comillaJson, byteInvalidoUtf8, comillaJson]));
  assert.throws(() => leerTextoConfiguracion(caso.perfil), /UTF-8 válido/u);
});

test('una tubería no bloquea el lector antes de comprobar que no es un archivo regular', (prueba) => {
  const caso = espacio(prueba);
  const fifo = join(caso.raiz, 'no-es-configuracion');
  execFileSync('mkfifo', [fifo], { timeout: PLAZO_HIJO_MS });
  const modulo = new URL('../../src/plataforma/node/lectura-configuracion.ts', import.meta.url).href;
  const codigo = `import {leerTextoConfiguracion} from ${JSON.stringify(modulo)}; try { leerTextoConfiguracion(process.argv[1]); process.exitCode=1; } catch { process.exitCode=0; }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', codigo, fifo], { timeout: PLAZO_HIJO_MS });
});

test('la interfaz de mantenimiento no anuncia una orden para configurar proveedores de inferencia', () => {
  const paquete: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.ok(typeof paquete === 'object' && paquete !== null && 'scripts' in paquete);
  const scripts = paquete.scripts;
  assert.ok(typeof scripts === 'object' && scripts !== null);
  assert.equal(Reflect.has(scripts, 'ia'), false);
});
