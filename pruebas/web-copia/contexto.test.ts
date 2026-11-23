// Dos candidatas independientes usan la captura final del motor sin modificar la instalación fuente.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copiaAislada, entradaDePrueba } from './aislada.ts';

const ENTRADAS = {
  ...entradaDePrueba(),
  'scripts/json.js': 'export const publico = true;',
  'administracion/panel.html': '<p>Administración</p>',
  'scripts/administracion/cliente.js': 'export const privado = true;',
  'activar-acceso.html': '<p>Credenciales</p>',
};
const PROGRAMA = `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const { generarCatalogos, comprobarServiceWorker, versionDeLaWeb } = await import('./copia-sin-conexion.ts');
const { WEB, leer } = await import('./publicados.ts');
const { valoresDelServicio } = await import('./servicio/servicio-publicado.ts');
const entradas = ${JSON.stringify(ENTRADAS)};
const publicados = Object.keys(entradas);
const huellaDelMapa = "'sha256-candidata'";
const rutaMotor = 'motor/src/plataforma/navegador/motor.js';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fuente = new Map(publicados.map((ruta) => [ruta, readFileSync(join(WEB, ruta))]));

function candidata(nombre) {
  const base = join(WEB, '..', nombre);
  const web = join(base, 'web');
  const paquete = join(base, 'datos');
  for (const [ruta, contenido] of Object.entries(entradas)) {
    mkdirSync(dirname(join(web, ruta)), { recursive: true });
    writeFileSync(join(web, ruta), contenido);
  }
  writeFileSync(join(web, 'p.html'), '<p>' + nombre + '</p>');
  mkdirSync(paquete);
  const dato = JSON.stringify({ candidata: nombre });
  writeFileSync(join(paquete, 'uno.json'), dato);
  writeFileSync(join(paquete, 'manifiesto.json'), JSON.stringify({ 'uno.json': { sha256: sha(dato) } }));
  const motor = new Map([[rutaMotor, new TextEncoder().encode('export const candidata = ' + JSON.stringify(nombre) + ';')]]);
  return { web, paquete, motor };
}

const una = candidata('Candidata una');
const otra = candidata('Candidata dos');
await generarCatalogos(publicados, huellaDelMapa, una);
assert.deepEqual(await comprobarServiceWorker(publicados, huellaDelMapa, una), []);
const catalogosUna = ['service-worker.js', 'p.html'];
const antesDeOtra = new Map(catalogosUna.map((ruta) => [ruta, leer(ruta, una.web)]));
await generarCatalogos(publicados, huellaDelMapa, otra);
assert.deepEqual(await comprobarServiceWorker(publicados, huellaDelMapa, otra), []);
assert.deepEqual(await comprobarServiceWorker(publicados, huellaDelMapa, una), []);
for (const [ruta, antes] of antesDeOtra) assert.equal(leer(ruta, una.web), antes);
assert.notEqual(leer('service-worker.js', una.web), leer('service-worker.js', otra.web));

for (const contexto of [una, otra]) {
  const listas = { archivos: ['p.html'], bajoDemanda: [], comprobados: ['scripts/json.js'], secciones: [] };
  const version = await versionDeLaWeb(listas, {}, contexto);
  assert.equal(version.comprobados.get(rutaMotor), sha(contexto.motor.get(rutaMotor)));
  assert.equal(version.comprobados.get('scripts/json.js'), sha(readFileSync(join(contexto.web, 'scripts/json.js'))));
  const valores = valoresDelServicio(leer('service-worker.js', contexto.web));
  const catalogos = JSON.stringify(valores.CATALOGO);
  assert.ok(valores.CATALOGO.length > 0, "el catálogo de la candidata no está vacío");
  assert.doesNotMatch(catalogos, /administracion|activar-acceso/);
  const manifiesto = readFileSync(join(contexto.paquete, 'manifiesto.json'));
  assert.equal(valores.PAQUETE, sha(manifiesto).slice(0, 16));
}

writeFileSync(join(una.web, 'scripts/json.js'), 'export const cambiado = true;');
const problemas = await comprobarServiceWorker(publicados, huellaDelMapa, una);
assert.ok(problemas.some((problema) => problema.includes('huella de «scripts/json.js»')));
assert.ok(problemas.some((problema) => problema.includes('VERSION es')));
assert.deepEqual(await comprobarServiceWorker(publicados, huellaDelMapa, otra), []);
for (const [ruta, antes] of fuente) assert.deepEqual(readFileSync(join(WEB, ruta)), antes);
assert.equal(readFileSync(join(WEB, '..', 'datos/manifiesto.json'), 'utf8'), '{}');
process.stdout.write('candidatas aisladas sin compilación');
`;

test('contexto explícito aísla dos candidatas, usa sus bytes y detecta alteración sin compilar ni tocar fuentes', () => {
  const fuente = { ...ENTRADAS, 'service-worker.js': '// La fuente no debe leerse ni modificarse.' };
  assert.equal(copiaAislada(fuente, PROGRAMA), 'candidatas aisladas sin compilación');
});
