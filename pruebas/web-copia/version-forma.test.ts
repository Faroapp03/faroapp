// La VERSION cubre el CATALOGO de la copia (la clase de cada ruta) y el código del service worker, construido con los
// valores neutros de su plantilla, y regenerar sin cambios la deja igual (version-copia.ts, huellaDeLaCopia).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { versionDeLaWeb } from '../../herramientas/web/copia-sin-conexion.ts';
import { servicioConValores } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { codigoNormalizado, huellaDeLaCopia } from '../../herramientas/web/version-copia.ts';
import { copiaAislada, entradaDePrueba } from './aislada.ts';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('pasar una ruta de ARCHIVOS a BAJO_DEMANDA cambia la VERSION aunque los bytes sean los mismos', async () => {
  const web = mkdtempSync(join(tmpdir(), 'faro-version-forma-'));
  try {
    writeFileSync(join(web, 'inicio.html'), '<p>Inicio</p>');
    writeFileSync(join(web, 'guion.js'), 'export const guion = true;\n');
    const contexto = { web, paquete: join(web, 'paquete'), motor: new Map<string, Uint8Array>() };
    const version = async (archivos: string[], bajoDemanda: string[]) =>
      (await versionDeLaWeb({ archivos, bajoDemanda, comprobados: [], secciones: [] }, {}, contexto)).version;
    const precargado = await version(['guion.js', 'inicio.html'], []);
    assert.equal(await version(['inicio.html', 'guion.js'], []), precargado, 'el orden de una lista no es su forma');
    assert.notEqual(await version(['inicio.html'], ['guion.js']), precargado);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('solo comentarios o formato no renuevan la VERSION; el código de la política o del portal, sí', async () => {
  const neutro = await servicioConValores();
  const bytes = new TextEncoder().encode('<p>Inicio</p>');
  const version = (codigo: string) =>
    huellaDeLaCopia(
      {
        catalogo: [['inicio.html', sha256(bytes), 'instalar']],
        paginasConVersion: [],
        codigo: { 'service-worker.js': codigo },
        cabeceras: {},
      },
      () => bytes,
    );
  const inicial = version(neutro);
  const politica = 'var RUTAS_OPERATIVAS = /^(?:api|';
  const portal = '=== "publico"';
  assert.ok(neutro.includes(politica) && neutro.includes(portal), 'el service worker lleva la política y el portal');
  const conComentarios = `// Cabecera nueva.\n${neutro.replace(politica, `/** La política. */\n${politica}`)}  // fin\n`;
  assert.equal(version(conComentarios), inicial, 'un cambio solo de comentarios o de formato no renueva la copia');
  assert.notEqual(version(neutro.replace(politica, politica.replace('api|', 'apx|'))), inicial, 'otra política');
  assert.notEqual(version(neutro.replace(portal, '=== "privado"')), inicial, 'otro código del portal es otra VERSION');
});

test('en el código cuenta un salto de línea entre dos piezas, no el resto de espacios ni comentarios', () => {
  const distintos: readonly (readonly [string, string])[] = [
    ['return\n1', 'return 1'],
    ['a\n++b', 'a++\nb'],
    ['a; b', 'a;\nb'],
    ['a; b', 'a; // c\nb'],
    ['a; b', 'a; /* c\n */ b'],
  ];
  for (const [uno, otro] of distintos) {
    assert.notEqual(
      codigoNormalizado(uno),
      codigoNormalizado(otro),
      `${JSON.stringify(uno)} y ${JSON.stringify(otro)}`,
    );
  }
  const iguales: readonly (readonly [string, string])[] = [
    ['a;\nb', 'a; // c\nb'],
    ['a; b', 'a; /* c */ b'],
    ['a;   b', 'a; b'],
    ['a;\n\n\nb', 'a;\nb'],
    ['// cabecera\na;', 'a;'],
    ["f( 'x' ,1 )", "f('x', 1)"],
  ];
  for (const [uno, otro] of iguales) {
    assert.equal(codigoNormalizado(uno), codigoNormalizado(otro), `${JSON.stringify(uno)} y ${JSON.stringify(otro)}`);
  }
  assert.notEqual(codigoNormalizado("f('x y')"), codigoNormalizado("f('x  y')"), 'el interior de una cadena es código');
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
const leer = (ruta) => readFileSync(join(WEB, ruta), 'utf8');
const version = () => valoresDelServicio(leer('service-worker.js')).VERSION;
await generarCatalogos(publicados, HUELLA, contexto());
const primera = version();
const generado = leer('service-worker.js');
assert.match(primera, /^[0-9a-f]{16}$/);
await generarCatalogos(publicados, HUELLA, contexto());
assert.equal(version(), primera, 'regenerar sin cambios deja la VERSION igual');
assert.equal(leer('service-worker.js'), generado, 'regenerar sin cambios deja el service worker igual');
const otraVez = await comprobarServiceWorker(publicados, HUELLA, contexto());
assert.deepEqual(otraVez, [], 'la comprobación vuelve a calcular la misma VERSION');
const modulo = join(WEB, '..', 'src/service-worker/no-coincide.js');
const fuente = readFileSync(modulo, 'utf8');
assert.ok(fuente.includes('faro-estado:'));
writeFileSync(modulo, fuente.replace('faro-estado:', 'faro-estado-nuevo:'));
const problemas = await comprobarServiceWorker(publicados, HUELLA, contexto());
assert.ok(problemas.some((problema) => problema.includes('VERSION es')), problemas.join('; '));
await generarCatalogos(publicados, HUELLA, contexto());
assert.notEqual(version(), primera, 'otro código del service worker es otra VERSION');
assert.deepEqual(await comprobarServiceWorker(publicados, HUELLA, contexto()), []);
process.stdout.write('version del codigo');
`;

test('un cambio del código del service worker cambia la VERSION; regenerar sin cambios la deja igual', () => {
  const archivos = { ...entradaDePrueba(), 'motor/src/plataforma/navegador/motor.js': 'export const motor = true;\n' };
  assert.equal(copiaAislada(archivos, PROGRAMA), 'version del codigo');
});
