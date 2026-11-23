// La VERSION sale del CATALOGO (version-copia.ts, huellaDeLaCopia): cambia con la huella o la clase de una entrada,
// no con el orden de las entradas ni con lo publicado que la copia no sirve; web:comprobar la rehace desde el CATALOGO
// escrito.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Catalogo } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { huellaDeLaCopia } from '../../herramientas/web/version-copia.ts';
import { copiaAislada, entradaDePrueba } from './aislada.ts';

const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const CATALOGO: Catalogo = [
  ['inicio.html', huella('inicio'), 'instalar'],
  ['imagenes/faro.webp', huella('faro'), 'adorno'],
  ['imagenes/foto.webp', huella('foto'), 'demanda'],
  ['motor/motor.js', huella('motor'), 'comprobado'],
];
const version = (catalogo: Catalogo) =>
  huellaDeLaCopia({ catalogo, paginasConVersion: [], codigo: { 'service-worker.js': 'a;' }, cabeceras: {} }, () => {
    throw new Error('sin páginas con versión no se leen bytes');
  });
const inicial = version(CATALOGO);

test('cambiar la huella de una entrada del CATALOGO cambia la VERSION', () => {
  const otra: Catalogo = CATALOGO.map(([ruta, sha, clase]) => [
    ruta,
    ruta === 'motor/motor.js' ? huella('x') : sha,
    clase,
  ]);
  assert.notEqual(version(otra), inicial);
});

test('cambiar la clase de una entrada (adorno frente a instalar) cambia la VERSION', () => {
  const otra: Catalogo = CATALOGO.map(([ruta, sha, clase]) => [ruta, sha, clase === 'adorno' ? 'instalar' : clase]);
  assert.notEqual(version(otra), inicial);
  const alReves: Catalogo = CATALOGO.map(([ruta, sha, clase]) => [ruta, sha, clase === 'instalar' ? 'adorno' : clase]);
  assert.notEqual(version(alReves), inicial);
});

test('reordenar el CATALOGO sin cambiar nada deja la VERSION igual, y es determinista', () => {
  assert.equal(version([...CATALOGO].reverse()), inicial);
  assert.equal(version([CATALOGO[2], CATALOGO[0], CATALOGO[3], CATALOGO[1]] as unknown as Catalogo), inicial);
  assert.equal(version(CATALOGO), inicial);
  assert.match(inicial, /^[0-9a-f]{16}$/u);
});

const FUERA = `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobarServiceWorker, generarCatalogos } from './copia-sin-conexion.ts';
import { contexto, HUELLA } from './contexto-de-prueba.ts';
import { WEB } from './publicados.ts';
import { valoresDelServicio } from './servicio/servicio-publicado.ts';
const publicados = ${JSON.stringify([...Object.keys(entradaDePrueba()), 'llms.txt'])};
const version = () => valoresDelServicio(readFileSync(join(WEB, 'service-worker.js'), 'utf8')).VERSION;
await generarCatalogos(publicados, HUELLA, contexto());
const antes = version();
writeFileSync(join(WEB, 'llms.txt'), 'otro texto que la copia no sirve');
const fuera = await comprobarServiceWorker(publicados, HUELLA, contexto());
assert.deepEqual(fuera, [], 'lo publicado fuera de la copia no invalida la VERSION');
await generarCatalogos(publicados, HUELLA, contexto());
assert.equal(version(), antes, 'lo publicado fuera de la copia no cambia la VERSION');
writeFileSync(join(WEB, 'p.html'), '<p>Público nuevo</p>');
await generarCatalogos(publicados, HUELLA, contexto());
assert.notEqual(version(), antes, 'lo que la copia sirve, sí');
process.stdout.write('fuera de la copia');
`;

test('un archivo publicado que no entra en la copia no cambia la VERSION; uno de la copia, sí', () => {
  const archivos = {
    ...entradaDePrueba(),
    'llms.txt': 'publicado, pero no entra en la copia',
    'motor/src/plataforma/navegador/motor.js': 'export const motor = true;\n',
  };
  assert.equal(copiaAislada(archivos, FUERA), 'fuera de la copia');
});

const ESCRITO = `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobarServiceWorker, generarCatalogos } from './copia-sin-conexion.ts';
import { contexto, HUELLA } from './contexto-de-prueba.ts';
import { WEB } from './publicados.ts';
import { valoresDelServicio } from './servicio/servicio-publicado.ts';
const publicados = ${JSON.stringify(Object.keys(entradaDePrueba()))};
const ruta = join(WEB, 'service-worker.js');
await generarCatalogos(publicados, HUELLA, contexto());
const generado = readFileSync(ruta, 'utf8');
const { VERSION, CATALOGO } = valoresDelServicio(generado);
const entrada = CATALOGO.find(([archivo]) => archivo === 'p.html');
assert.ok(entrada);
const otra = entrada[1].replace(/^./u, (letra) => (letra === '0' ? '1' : '0'));
writeFileSync(ruta, generado.replace('["p.html", "' + entrada[1] + '"', '["p.html", "' + otra + '"'));
assert.equal(valoresDelServicio(readFileSync(ruta, 'utf8')).VERSION, VERSION, 'la VERSION escrita no se toca');
const problemas = await comprobarServiceWorker(publicados, HUELLA, contexto());
const aviso = problemas.find((problema) => problema.startsWith('service-worker.js: VERSION es «' + VERSION + '» y su CATALOGO da «'));
assert.ok(aviso, problemas.join('; '));
assert.ok(!aviso.includes('da «' + VERSION + '»'), aviso);
process.stdout.write('catalogo escrito');
`;

test('web:comprobar cuenta el CATALOGO escrito: otra huella con la misma VERSION da el aviso', () => {
  const archivos = { ...entradaDePrueba(), 'motor/src/plataforma/navegador/motor.js': 'export const motor = true;\n' };
  assert.equal(copiaAislada(archivos, ESCRITO), 'catalogo escrito');
});

const PROGRAMA = `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobarServiceWorker, generarCatalogos } from './copia-sin-conexion.ts';
import { contexto, HUELLA } from './contexto-de-prueba.ts';
import { WEB } from './publicados.ts';
import { valoresDelServicio } from './servicio/servicio-publicado.ts';
const publicados = ${JSON.stringify(Object.keys(entradaDePrueba()))};
const ruta = join(WEB, 'service-worker.js');
await generarCatalogos(publicados, HUELLA, contexto());
const generado = readFileSync(ruta, 'utf8');
const { VERSION } = valoresDelServicio(generado);
assert.deepEqual(await comprobarServiceWorker(publicados, HUELLA, contexto()), []);
writeFileSync(ruta, generado.replace('var VERSION = "' + VERSION + '";', 'var VERSION = "0123456789abcdef";'));
const problemas = await comprobarServiceWorker(publicados, HUELLA, contexto());
const esperado = 'service-worker.js: VERSION es «0123456789abcdef» y su CATALOGO da «' + VERSION + '» (corrígelo con npm run web:preparar)';
assert.ok(problemas.includes(esperado), problemas.join('; '));
process.stdout.write('version del catalogo');
`;

test('web:comprobar rehace la VERSION desde el CATALOGO escrito y dice cuál debería ser', () => {
  const archivos = { ...entradaDePrueba(), 'motor/src/plataforma/navegador/motor.js': 'export const motor = true;\n' };
  assert.equal(copiaAislada(archivos, PROGRAMA), 'version del catalogo');
});
