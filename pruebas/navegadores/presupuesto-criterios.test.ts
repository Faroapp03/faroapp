/** Los dos criterios de JavaScript de los ensayos de descargas y del presupuesto, con casos fijos. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esJavaScriptDelContexto, esJavaScriptDelServidor } from './presupuesto-criterios.mjs';

/** El texto del criterio que guardan los documentos ya medidos (`criterioJavaScript`). */
const CRITERIO_GUARDADO = "({ ruta, destino }) => DESTINOS_JS.has(destino ?? '') || /\\.m?js$/u.test(ruta)";

test('el criterio del servidor cuenta por destino o por ruta', () => {
  const casos: [string, { ruta: string; destino?: string | null }, boolean][] = [
    ['el propio service worker, sin extensión', { ruta: '/service-worker', destino: 'serviceworker' }, true],
    ['un módulo .mjs pedido por fetch', { ruta: '/motor/trozos/comun.mjs', destino: 'empty' }, true],
    ['un .json pedido por fetch', { ruta: '/datos/catalogo.json', destino: 'empty' }, false],
    ['el script de un Worker', { ruta: '/motor/trabajador', destino: 'worker' }, true],
    ['el script de un Worker compartido', { ruta: '/motor/compartido', destino: 'sharedworker' }, true],
    ['un script de la página sin extensión', { ruta: '/entrada', destino: 'script' }, true],
    ['un JSON servido con nombre .js', { ruta: '/datos/catalogo.js', destino: 'empty' }, true],
    ['un mapa de fuentes', { ruta: '/scripts/inicio.js.map', destino: 'empty' }, false],
    ['una hoja de estilos', { ruta: '/estilos/base.css', destino: 'style' }, false],
    ['el documento', { ruta: '/inicio.html', destino: 'document' }, false],
    ['sin destino declarado', { ruta: '/', destino: null }, false],
    ['sin destino, con ruta .js', { ruta: '/scripts/inicio.js' }, true],
  ];
  for (const [caso, peticion, esperado] of casos) {
    assert.equal(esJavaScriptDelServidor(peticion), esperado, caso);
  }
});

test('el criterio del contexto cuenta por tipo de recurso o por ruta', () => {
  const casos: [string, { ruta: string; tipo: string }, boolean][] = [
    ['un script sin extensión', { ruta: '/entrada', tipo: 'script' }, true],
    ['un módulo .mjs pedido por fetch', { ruta: '/motor/trozos/comun.mjs', tipo: 'fetch' }, true],
    ['un .json pedido por fetch', { ruta: '/datos/catalogo.json', tipo: 'fetch' }, false],
    ['otro tipo de recurso sin extensión', { ruta: '/motor/trabajador', tipo: 'other' }, false],
    ['un JSON servido con nombre .js', { ruta: '/datos/catalogo.js', tipo: 'fetch' }, true],
    ['una hoja de estilos', { ruta: '/estilos/base.css', tipo: 'stylesheet' }, false],
  ];
  for (const [caso, vista, esperado] of casos) {
    assert.equal(esJavaScriptDelContexto(vista), esperado, caso);
  }
});

test('el criterio del servidor es el mismo que guardan los documentos ya medidos', () => {
  assert.equal(String(esJavaScriptDelServidor), CRITERIO_GUARDADO);
});
