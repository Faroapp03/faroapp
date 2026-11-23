// Procedencia de los campos de una salida: aportes generados, traducciones del paquete y datos oficiales o reglas.
// Comprueba las marcas sin ejecutar proveedores de IA ni cargar datos personales.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conIaDe, conIaDelPaquete, ESCRITO_CON_IA, MEZCLA_CON_IA, marcaIa } from '../../src/dominio/marca-ia.ts';

test('la nota estimada y las frases conservan su acción sin inventar modo ni modelo', () => {
  const marca = marcaIa(
    [
      conIaDe('/estimacion/valor', 'estimado'),
      conIaDe('/estimacion/iaPodria', 'redactado'),
      conIaDe('/estimacion/loTuyo', 'redactado'),
      conIaDe('/justificacion', 'redactado'),
    ],
    { '/estimacion/margen': 'reglas-de-faro' },
  );
  assert.equal(marca.fuenteDigital, MEZCLA_CON_IA);
  assert.deepEqual([marca.modo, marca.modelo], ['sin-ia', null]);
  assert.deepEqual(
    marca.conIa.map(({ campo, accion, modo, modelo, fuenteDigital }) => [campo, accion, modo, modelo, fuenteDigital]),
    [
      ['/estimacion/valor', 'estimado', null, null, ESCRITO_CON_IA],
      ['/estimacion/iaPodria', 'redactado', null, null, ESCRITO_CON_IA],
      ['/estimacion/loTuyo', 'redactado', null, null, ESCRITO_CON_IA],
      ['/justificacion', 'redactado', null, null, ESCRITO_CON_IA],
    ],
  );
  assert.deepEqual(marca.sinIa, [{ campo: '/estimacion/margen', origen: 'reglas-de-faro' }]);
});

test('sin campos escritos con IA conserva los orígenes oficiales, de reglas y de la persona', () => {
  const marca = marcaIa([], {
    '/ocupacion/titulo': 'datos-oficiales',
    '/tareas/*/franja': 'reglas-de-faro',
    '/tareas/*/tiempo': 'persona',
  });
  assert.deepEqual(marca.conIa, []);
  assert.deepEqual([marca.fuenteDigital, marca.modo, marca.modelo], [null, 'sin-ia', null]);
  assert.deepEqual(marca.sinIa, [
    { campo: '/ocupacion/titulo', origen: 'datos-oficiales' },
    { campo: '/tareas/*/franja', origen: 'reglas-de-faro' },
    { campo: '/tareas/*/tiempo', origen: 'persona' },
  ]);
});

test('las traducciones del paquete distinguen su autoría de una traducción de autor desconocido', () => {
  const marca = marcaIa(
    [conIaDelPaquete('/tareas/0/iaPodria', 'traducido'), conIaDe('/tareas/1/iaPodria', 'traducido')],
    {},
  );
  assert.deepEqual(
    marca.conIa.map(({ campo, accion, modo, modelo }) => [campo, accion, modo, modelo]),
    [
      ['/tareas/0/iaPodria', 'traducido', 'paquete', null],
      ['/tareas/1/iaPodria', 'traducido', null, null],
    ],
  );
  assert.ok(marca.conIa.every((fragmento) => fragmento.fuenteDigital === ESCRITO_CON_IA));
});

test('la falta de autor en vivo no borra la procedencia de campos generados con IA', () => {
  const marca = marcaIa([conIaDe('/tareas/0/valor', 'estimado'), conIaDelPaquete('/tareas/0/loTuyo', 'redactado')], {});
  assert.equal(marca.fuenteDigital, MEZCLA_CON_IA);
  assert.deepEqual([marca.modo, marca.modelo], ['sin-ia', null]);
  assert.deepEqual(
    marca.conIa.map(({ modo, modelo }) => [modo, modelo]),
    [
      [null, null],
      ['paquete', null],
    ],
  );
});
