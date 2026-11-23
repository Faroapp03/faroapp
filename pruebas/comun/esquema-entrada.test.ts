// Entrada interna y contrato público comprobados con ejemplos autónomos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESQUEMA_INFORME } from '../../src/api/esquemas.ts';
import { cumple } from '../../src/comun/esquema.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { esEntrada } from '../../src/dominio/esquema-entrada.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';

function conCampo(original: unknown, ruta: string[], valor: unknown): unknown {
  const copia: unknown = structuredClone(original);
  let objeto: unknown = copia;
  assert.ok(ruta.length > 0);
  for (const clave of ruta.slice(0, -1)) {
    assert.ok(esObjeto(objeto) || Array.isArray(objeto));
    assert.ok(Object.hasOwn(objeto, clave));
    objeto = Array.isArray(objeto) ? objeto[Number(clave)] : objeto[clave];
  }
  const ultima = ruta.at(-1);
  assert.ok(ultima);
  assert.ok(esObjeto(objeto) || Array.isArray(objeto));
  assert.ok(Object.hasOwn(objeto, ultima));
  if (Array.isArray(objeto)) {
    objeto[Number(ultima)] = valor;
  } else {
    objeto[ultima] = valor;
  }
  return copia;
}

/** El margen de la estimación de ejemplo, alrededor de su valor. */
const MARGEN_DE_EJEMPLO = Object.freeze({ desde: 0.2, hasta: 0.6 });
const completa: Entrada = {
  ocupacionEsco: '4226.1',
  isco08: '4226',
  isco08Secundario: '4311',
  ocupacionPersona: 'recepcionista',
  grupoPropuestoPorIa: true,
  sinIa: false,
  fecha: '2026-10-10',
  tareas: [
    {
      id: 'tarea',
      texto: 'Dar citas',
      tiempo: 'algo',
      referencia: { tareaOit: '4311-4', relacion: 'equivalente' },
      estimacion: {
        valor: 0.4,
        margen: [MARGEN_DE_EJEMPLO.desde, MARGEN_DE_EJEMPLO.hasta],
        origen: 'ejemplo',
        referenciaCercana: '4226-1',
        competencias: ['una'],
        iaPodria: 'Preparar citas',
        loTuyo: 'Revisarlas',
        firma: 'firma',
        referencias: 'oit',
        incierta: true,
      },
    },
  ],
};

test('la entrada interna comprueba todos los campos raíz y admite campos extra', () => {
  assert.ok(esEntrada(completa));
  assert.ok(esEntrada({ ...completa, extra: true }));
  assert.ok(esEntrada({ tareas: [], fecha: 'fecha' }));
  for (const campo of ['ocupacionEsco', 'isco08', 'isco08Secundario', 'ocupacionPersona', 'fecha']) {
    assert.equal(esEntrada(conCampo(completa, [campo], 1)), false, campo);
  }
  for (const campo of ['grupoPropuestoPorIa', 'sinIa']) {
    assert.equal(esEntrada(conCampo(completa, [campo], 'sí')), false, campo);
  }
  for (const tareas of [null, {}, [null], [{ id: 'tarea' }], [...completa.tareas, { id: 'otra' }]]) {
    assert.equal(esEntrada({ ...completa, tareas }), false);
  }
  assert.equal(esEntrada({ tareas: [] }), false);
  assert.equal(esEntrada(null), false);
});

test('tareas, referencias y estimaciones comprueban cada campo y la tupla exacta del margen', () => {
  const tarea: [string, unknown][] = [
    ['id', 1],
    ['texto', null],
    ['tiempo', 'muchísimo'],
    ['referencia', []],
    ['estimacion', []],
  ];
  for (const [campo, valor] of tarea) {
    assert.equal(esEntrada(conCampo(completa, ['tareas', '0', campo], valor)), false, campo);
  }
  const referencia: [string, unknown][] = [
    ['tareaOit', 1],
    ['relacion', 'ajena'],
  ];
  for (const [campo, valor] of referencia) {
    assert.equal(esEntrada(conCampo(completa, ['tareas', '0', 'referencia', campo], valor)), false, campo);
  }
  const campos = ['referenciaCercana', 'iaPodria', 'loTuyo', 'firma'];
  for (const campo of campos) {
    assert.equal(esEntrada(conCampo(completa, ['tareas', '0', 'estimacion', campo], 1)), false, campo);
  }
  const invalidos: [string, unknown][] = [
    ['valor', '0.4'],
    ['origen', 'otro'],
    ['competencias', ['una', 2]],
    ['referencias', 'otra'],
    ['incierta', 'sí'],
  ];
  for (const [campo, valor] of invalidos) {
    assert.equal(esEntrada(conCampo(completa, ['tareas', '0', 'estimacion', campo], valor)), false, campo);
  }
  // Un margen son dos números: ni menos, ni más, ni un texto, ni un objeto con forma de lista.
  for (const margen of [[], [1], [1, 2, 2], [1, '2'], null, { 0: 1, 1: 2 }]) {
    assert.equal(esEntrada(conCampo(completa, ['tareas', '0', 'estimacion', 'margen'], margen)), false);
  }
});

test('los campos internos se distinguen del contrato de la API con un control positivo', () => {
  assert.equal(cumple(completa, ESQUEMA_INFORME), false);
  const publicable = {
    ...completa,
    tareas: completa.tareas.map(({ estimacion: _estimacion, referencia: _referencia, ...tarea }) => ({
      ...tarea,
      referencia: { tareaOit: '4226-1', relacion: 'propia' },
    })),
  };
  assert.ok(cumple(publicable, ESQUEMA_INFORME));
  const equivalente = conCampo(publicable, ['tareas', '0', 'referencia', 'relacion'], 'equivalente');
  assert.ok(esEntrada(equivalente));
  assert.equal(cumple(equivalente, ESQUEMA_INFORME), false);
});

test('los opcionales admiten undefined explícito sin modificar ni añadir campos', () => {
  const entrada: Entrada = {
    ocupacionEsco: undefined,
    fecha: '2026-10-13',
    tareas: [{ id: 'propia', texto: 'Mi tarea', tiempo: 'algo', referencia: undefined, estimacion: undefined }],
  };
  const antes = structuredClone(entrada);
  assert.ok(esEntrada(entrada));
  assert.deepEqual(entrada, antes);
  assert.equal(
    JSON.stringify(entrada),
    '{"fecha":"2026-10-13","tareas":[{"id":"propia","texto":"Mi tarea","tiempo":"algo"}]}',
  );
  assert.equal(esEntrada(Object.create({ tareas: [], fecha: '2026-10-13' })), false);
});
