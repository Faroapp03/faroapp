// El service worker se publica en un solo guion clásico, construido desde src/service-worker/: no referencia otras
// piezas, pasa la CSP de los guiones y sus valores generados solo admiten literales, escritos como los escriba esbuild.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarCspScript } from '../../herramientas/web/csp.ts';
import { referenciasJs } from '../../herramientas/web/referencias.ts';
import {
  lineaDelValor,
  ServicioIlegible,
  servicioConValores,
  valoresDelServicio,
} from '../../herramientas/web/servicio/servicio-publicado.ts';
import { servicioPublicado } from '../ayudas/web-construida.ts';

const ENTRADA = 'service-worker.js';
const DERIVADO = servicioPublicado();

test('el service worker publicado es un solo guion sin piezas que cargar y pasa la CSP', () => {
  assert.deepEqual(
    referenciasJs(DERIVADO).filter((referencia) => /service-worker|\.js$/.test(referencia)),
    [],
  );
  assert.deepEqual(comprobarCspScript(ENTRADA, DERIVADO), []);
});

test('una carga añadida, código en un valor generado o una política alterada se rechazan', async () => {
  assert.match(comprobarCspScript(ENTRADA, `${DERIVADO}\nimportScripts('otro.js');`).join('\n'), /carga guiones/);
  assert.match(comprobarCspScript(ENTRADA, `${DERIVADO}\neval('x');`).join('\n'), /evalúa código/);
  const linea = DERIVADO.match(lineaDelValor('CATALOGO'))?.[0] ?? '';
  assert.ok(linea);
  for (const valor of ["[eval('x')]", '[["p.html", VERSION, "instalar"]]', '[...CATALOGO]']) {
    assert.throws(() => valoresDelServicio(DERIVADO.replace(linea, `var CATALOGO = ${valor};`)), ServicioIlegible);
  }
  assert.throws(() => valoresDelServicio(''), ServicioIlegible, 'sin el service worker no hay valores');
  const reconstruido = await servicioConValores(valoresDelServicio(DERIVADO));
  assert.equal(reconstruido, DERIVADO);
  const alterado = DERIVADO.replace('function rutaFueraDeLaCopia(ruta) {', 'function rutaFueraDeLaCopia(ruta) {\n  ;');
  assert.notEqual(alterado, DERIVADO);
  assert.notEqual(await servicioConValores(valoresDelServicio(alterado)), alterado, 'la política es la de su fuente');
});

const CIFRAS_SHA256 = 64;

test('los valores se leen igual con cualquier comilla, espacio o coma final del literal', () => {
  const linea = DERIVADO.match(lineaDelValor('CATALOGO'))?.[0] ?? '';
  const h = 'a'.repeat(CIFRAS_SHA256);
  const esperado = valoresDelServicio(
    DERIVADO.replace(linea, `var CATALOGO = [["p.html", "${h}", "instalar"]];`),
  ).CATALOGO;
  assert.deepEqual(esperado, [['p.html', h, 'instalar']]);
  for (const forma of [
    `[['p.html', '${h}', 'instalar']]`,
    `[ [ 'p.html', '${h}', 'instalar', ], ]`,
    `[["p.html" , "${h}" , "instalar" ]]`,
    `[['p\\x2ehtml', '${h}', 'instal\\x61r']]`,
  ]) {
    assert.deepEqual(valoresDelServicio(DERIVADO.replace(linea, `var CATALOGO = ${forma};`)).CATALOGO, esperado, forma);
  }
});
