// Las banderas de «El mundo» (scripts/datos-globales/banderas.js y web/imagenes/banderas/): cada país que sale con el
// archivo publicado tiene la suya; cada archivo del juego es el registrado en procedencia.json (huella SHA-256 y
// tamaño), en 3:2 y sin guiones, enlaces ni imágenes dentro; y las otras dos páginas siguen solo con las banderas
// propias de Faro. Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { direccionDeLaBandera } from '../../web/scripts/datos-globales/banderas.js';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import { paisesConIa } from '../../web/scripts/globo/datos.js';

/** Proporción de las banderas (3:2) y la tolerancia con que el juego escribe sus cajas (512 × 341,33). */
const PROPORCION_DE_UNA_BANDERA = 1.5;
const TOLERANCIA_DE_LA_PROPORCION = 0.001;

const WEB = new URL('../../web/', import.meta.url);
const CARPETA = new URL('imagenes/banderas/', WEB);
const PROCEDENCIA = JSON.parse(readFileSync(new URL('procedencia.json', CARPETA), 'utf8'));
const PUBLICADOS = leerDatosGlobales(JSON.parse(readFileSync(new URL('datos/datos-globales.json', WEB), 'utf8')));

test('cada país que sale en «El mundo» tiene su bandera, y el archivo existe', () => {
  for (const { codigo } of paisesConIa(PUBLICADOS)) {
    const direccion = direccionDeLaBandera(codigo, { delJuego: true });
    assert.ok(direccion, `${codigo} sin bandera`);
    assert.ok(readFileSync(new URL(direccion, WEB)).length > 0, direccion);
  }
});

test('cada bandera del juego es la registrada en su procedencia, en 3:2 y sin nada activo dentro', () => {
  assert.equal(PROCEDENCIA.licencia, 'MIT');
  assert.match(PROCEDENCIA.texto_de_la_licencia, /^\(The MIT License\)\r?\n\r?\nCopyright \(c\) 2020 @catamphetamine/);
  assert.equal(readFileSync(new URL('LICENSE', CARPETA), 'utf8'), PROCEDENCIA.texto_de_la_licencia);
  const svgs = readdirSync(CARPETA).filter((nombre) => nombre.endsWith('.svg'));
  assert.deepEqual(svgs.sort(), Object.keys(PROCEDENCIA.archivos).sort());
  for (const nombre of svgs) {
    const bytes = readFileSync(new URL(nombre, CARPETA));
    const { sha256, bytes: tamano } = PROCEDENCIA.archivos[nombre];
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, nombre);
    assert.equal(bytes.length, tamano, nombre);
    const texto = bytes.toString('utf8');
    const caja = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)">/.exec(
      texto,
    );
    assert.ok(caja, `${nombre}: empieza por su svg con viewBox`);
    // 3:2, con la precisión con que el juego escribe sus cajas (512 × 341,33).
    assert.ok(
      Math.abs(Number(caja[1]) / Number(caja[2]) - PROPORCION_DE_UNA_BANDERA) < TOLERANCIA_DE_LA_PROPORCION,
      `${nombre}: 3:2`,
    );
    assert.doesNotMatch(texto, /<script|href|<image|<foreignObject|url\(/i, nombre);
  }
});

test('las otras páginas siguen con las banderas propias de Faro: sin `delJuego`, un país del juego no lleva', () => {
  assert.equal(direccionDeLaBandera('ESP'), 'imagenes/identidad/bandera-espana.svg');
  assert.equal(direccionDeLaBandera('AUT'), null);
  assert.equal(direccionDeLaBandera('AUT', { delJuego: true }), 'imagenes/banderas/aut.svg');
  assert.equal(direccionDeLaBandera('ESP', { delJuego: true }), 'imagenes/identidad/bandera-espana.svg');
  assert.equal(direccionDeLaBandera(null, { delJuego: true }), null);
});
