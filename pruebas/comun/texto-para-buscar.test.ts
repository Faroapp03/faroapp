// Contrato de minimización común para búsquedas, sin proveedor ni almacenamiento.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buscarOcupaciones } from '../../motores/ocupaciones/src/index.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { limpiarDatosPersonales } from '../../src/seguridad/privacidad.ts';
import { textoParaBuscar } from '../../src/seguridad/texto-para-buscar.ts';

const REPETICIONES_CONSULTA_LARGA = 100;
const MAXIMO_CANDIDATAS = 6;
const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));

test('retira identificadores y sus marcas conservando las palabras del trabajo', () => {
  const consulta = 'Me llamo Laura. recepcionista de hotel; laura@example.test; +34 612 345 678';
  const resultado = textoParaBuscar(consulta);
  assert.ok(resultado.includes('recepcionista de hotel'));
  assert.doesNotMatch(resultado, /Laura|laura|example|612|345|678|\[|\]/u);
  assert.equal(textoParaBuscar(resultado), resultado);
});

test('conserva consultas profesionales y retira solo marcas exactas del limpiador', () => {
  assert.equal(textoParaBuscar('recepcionista de hotel'), 'recepcionista de hotel');
  assert.equal(textoParaBuscar('  auxiliar\n de\t enfermería  '), 'auxiliar de enfermería');
  assert.equal(textoParaBuscar('recepcionista [correo eliminado] de hotel'), 'recepcionista de hotel');
  assert.equal(
    textoParaBuscar('recepcionista [texto entre corchetes] de hotel'),
    'recepcionista [texto entre corchetes] de hotel',
  );
  assert.equal(textoParaBuscar('[nombre] [correo] [teléfono]'), '[nombre] [correo] [teléfono]');
  assert.equal(textoParaBuscar('laura@example.test'), '');
});

test('las doce marcas corresponden a emisiones reales de la limpieza vigente', () => {
  const emisiones: readonly [string, string][] = [
    ['Me llamo Laura', '[nombre eliminado]'],
    ['calle Mayor 12', '[dirección eliminada]'],
    ['612 345 678', '[teléfono eliminado]'],
    ['4111 1111 1111 1111', '[tarjeta eliminada]'],
    ['canario@example.invalid', '[correo eliminado]'],
    ['ES58 1234 5678 0101 2345 6789', '[cuenta eliminada]'],
    ['12345678Z', '[documento eliminado]'],
    ['https://example.invalid/perfil/canario', '[enlace eliminado]'],
    ['@canario', '[usuario eliminado]'],
    ['28/12345678/40', '[número de la Seguridad Social eliminado]'],
    ['IBAN ES58 1234, luego 5678-0101 y 2345-6789.', '[cifras eliminadas]'],
    ['Camareros S.L.', '[empresa]'],
  ];
  for (const [consulta, marca] of emisiones) {
    const limpia = limpiarDatosPersonales(consulta);
    assert.ok(limpia.eliminados > 0, consulta);
    assert.ok(limpia.texto.includes(marca), `${consulta} emite ${marca}`);
    assert.equal(textoParaBuscar(marca), '', marca);
    assert.equal(textoParaBuscar(consulta).includes(marca), false, consulta);
  }
});

test('los corchetes legítimos conservan la lista, orden y puntuación con el paquete real', () => {
  for (const consulta of ['guía [turístico]', 'técnico [mecánico]']) {
    assert.equal(limpiarDatosPersonales(consulta).eliminados, 0);
    assert.equal(textoParaBuscar(consulta), consulta);
    assert.deepEqual(
      buscarOcupaciones(datos, textoParaBuscar(consulta), MAXIMO_CANDIDATAS),
      buscarOcupaciones(datos, consulta, MAXIMO_CANDIDATAS),
    );
  }
});

test('la opción del POST conserva la exclusión histórica de todos los tramos entre corchetes', () => {
  assert.equal(textoParaBuscar('guía [turístico]', { omitirCorchetes: true }), 'guía');
  assert.equal(textoParaBuscar('técnico [mecánico]', { omitirCorchetes: true }), 'técnico');
  const consulta = ' Me llamo Laura; recepcionista [texto entre corchetes] [correo eliminado] de hotel ';
  const anterior = limpiarDatosPersonales(consulta)
    .texto.replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  assert.equal(textoParaBuscar(consulta, { omitirCorchetes: true }), anterior);
});

test('no decide el límite de la búsqueda ni guarda la consulta anterior', () => {
  const larga = 'recepcionista de hotel '.repeat(REPETICIONES_CONSULTA_LARGA).trim();
  assert.equal(textoParaBuscar(larga), larga);
  assert.equal(textoParaBuscar(''), '');
  assert.equal(textoParaBuscar('electricista'), 'electricista');
});
