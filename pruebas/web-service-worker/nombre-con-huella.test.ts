// La regla de «nombre con huella» del service worker (service-worker.js, conHuellaEnElNombre), que decide qué se pide
// con la caché HTTP, es la misma que la del servidor que sirve esos guiones inmutables
// (src/plataforma/cabeceras-web.ts): mismas carpetas, misma expresión y el mismo veredicto para cada ruta. El service
// worker es un guion clásico y no puede importar la del servidor; esta guardia impide que se separen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CARPETAS_PUBLICAS_CON_HUELLA, cabecerasParaRuta } from '../../src/plataforma/cabeceras-web.ts';
import { servicio } from './ayudas.ts';

const INMUTABLE = /immutable/u;
const SERVIDOR = readFileSync(new URL('../../src/plataforma/cabeceras-web.ts', import.meta.url), 'utf8');
/** Rutas como las que emite la construcción, con y sin huella, dentro y fuera de las carpetas públicas. */
const RUTAS = [
  'js/pagina-inicio-34d05dad5dabef57.js',
  'js/paginas-scripts-sitio-33962d17f2c50edb.js',
  'js/chunk-RZSIKJMV.js',
  'js/etapas-KMJLTM7O.js',
  'motor/trozos/chunk-3TUIWKYH.js',
  'js/scripts-recorrido-paso-informe.js',
  'js/chunk-rzsikjmv.js',
  'js/sub/chunk-RZSIKJMV.js',
  'demo/js/pagina-demo-recorrido-129a5d93689cd532.js',
  'demo/panel-js/chunk-C7IYRFA6.js',
  'administracion/js/chunk-AQD4BVIF.js',
  'motor/src/plataforma/navegador/motor.js',
  'scripts/motor-local/worker.js',
  'scripts/barrera-eef4db72059ab1846523ed117cbe66dc24b463af445c89a21c3a66fd4b7dc1a3.js',
  'idiomas/es.js',
  'inicio.html',
];

test('el service worker y el servidor tienen la misma regla de nombre con huella', () => {
  const sw = servicio('https://ejemplo.invalid/');
  assert.deepEqual(JSON.parse(JSON.stringify(sw.evaluar('CARPETAS_CON_HUELLA'))), [...CARPETAS_PUBLICAS_CON_HUELLA]);
  const expresion = /const NOMBRE_CON_HUELLA = (\/.+\/);/u.exec(SERVIDOR)?.[1];
  assert.ok(expresion, 'cabeceras-web.ts declara NOMBRE_CON_HUELLA');
  assert.equal(String(sw.evaluar('NOMBRE_CON_HUELLA')), expresion);
  for (const ruta of RUTAS) {
    const inmutable = INMUTABLE.test(cabecerasParaRuta(`/${ruta}`)['cache-control'] ?? '');
    assert.equal(sw.evaluar(`modoDeLaCopia(${JSON.stringify(ruta)})`), inmutable ? 'default' : 'reload', ruta);
  }
});
