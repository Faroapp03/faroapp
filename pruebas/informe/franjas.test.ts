// Cortes de la OIT, rangos cerrados y reparto por mayores restos; oráculos independientes del cálculo.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  esFranja,
  franja,
  franjasDelMargen,
  ordenFranja,
  PESOS,
  reparto5,
  UMBRALES,
} from '../../src/dominio/franjas.ts';

const ORACULO = { media: 0.4, alta: 0.6, mucho: 3, primerEmpate: 35, ultimoEmpate: 30 } as const;
const TOTAL = 100;
const PASO = 5;
const CASOS_POR_LADO = 4;
const NUM_BANDAS = 4;
const DENOMINADOR_NOTAS = 1000;
const MAX_TAREAS_DE_PRUEBA = 30;

test('las franjas respetan los cortes de 0,4 y 0,6, incluidos sus extremos', () => {
  assert.deepEqual(UMBRALES, { media: 0.4, alta: 0.6 });
  for (const [nota, esperada] of [
    [0, 'baja'],
    [ORACULO.media - Number.EPSILON, 'baja'],
    [ORACULO.media, 'media'],
    [ORACULO.alta - Number.EPSILON, 'media'],
    [ORACULO.alta, 'alta'],
    [1, 'alta'],
  ] as const) {
    assert.equal(franja(nota), esperada);
  }
});

test('la guarda acepta las tres franjas y rechaza nombres heredados y otros valores', () => {
  for (const valor of ['alta', 'media', 'baja']) {
    assert.equal(esFranja(valor), true);
  }
  for (const valor of ['ALTA', '', 'toString', 'constructor', '__proto__', null, undefined, 0, {}, ['alta']]) {
    assert.equal(esFranja(valor), false);
  }
});

test('el informe ordena primero alta, luego media, baja y sin datos', () => {
  const franjas = [null, 'baja', 'alta', 'media'] as const;
  assert.deepEqual(
    [...franjas].sort((a, b) => ordenFranja(a) - ordenFranja(b)),
    ['alta', 'media', 'baja', null],
  );
});

test('un rango cerrado incluye los cortes y enumera de menor a mayor cambio', () => {
  for (const [margen, esperadas] of [
    [null, []],
    [[0, 0], ['baja']],
    [
      [0, ORACULO.media],
      ['baja', 'media'],
    ],
    [[ORACULO.media, ORACULO.media], ['media']],
    [
      [ORACULO.media, ORACULO.alta],
      ['media', 'alta'],
    ],
    [[ORACULO.alta, ORACULO.alta], ['alta']],
    [
      [0, 1],
      ['baja', 'media', 'alta'],
    ],
    [[1, 1], ['alta']],
  ] as const) {
    assert.deepEqual(franjasDelMargen(margen), esperadas);
  }
});

test('la franja de cada nota de la escala queda incluida en su rango puntual y en los rangos que la contienen', () => {
  for (let indice = 0; indice <= DENOMINADOR_NOTAS; indice += 1) {
    const nota = indice / DENOMINADOR_NOTAS;
    const esperada = (['alta', 'media', 'baja'] as const).find(
      (_, posicion) => nota >= ([ORACULO.alta, ORACULO.media, 0][posicion] ?? 0),
    );
    assert.ok(esperada);
    assert.equal(franja(nota), esperada);
    assert.deepEqual(franjasDelMargen([nota, nota]), [esperada]);
    assert.ok(franjasDelMargen([0, nota]).includes(esperada));
    assert.ok(franjasDelMargen([nota, 1]).includes(esperada));
  }
});

test('los pesos declarados son 3, 2 y 1 y permanecen congelados', () => {
  assert.deepEqual(PESOS, { mucho: 3, algo: 2, poco: 1 });
  assert.equal(Object.isFrozen(PESOS), true);
  assert.equal(Reflect.set(PESOS, 'mucho', TOTAL), false);
  assert.equal(PESOS.mucho, ORACULO.mucho);
});

test('el reparto conserva ceros, claves y empates en el orden de enumeración recibido', () => {
  assert.deepEqual(reparto5({}), {});
  assert.deepEqual(reparto5({ alta: 0, media: 0, baja: 0 }), { alta: 0, media: 0, baja: 0 });
  assert.deepEqual(reparto5({ alta: 1, media: 1, baja: 1, sinDatos: 0 }), {
    alta: 35,
    media: 35,
    baja: 30,
    sinDatos: 0,
  });
  assert.deepEqual(reparto5({ baja: 1, alta: 1, media: 1 }), { baja: 35, alta: 35, media: 30 });
  assert.deepEqual(reparto5({ una: 1, otra: 2 }), { una: 35, otra: 65 });
  assert.deepEqual(reparto5({ una: 1, otra: 3 }), { una: 25, otra: 75 });
});

test('toda combinación de pesos declarados suma 100 en pasos de 5 sin modificar la entrada', () => {
  const combinaciones = CASOS_POR_LADO ** NUM_BANDAS;
  for (let caso = 0; caso < combinaciones; caso += 1) {
    const valores = Array.from(
      { length: NUM_BANDAS },
      (_, posicion) => Math.floor(caso / CASOS_POR_LADO ** posicion) % CASOS_POR_LADO,
    );
    const pesos = Object.freeze(
      Object.fromEntries(
        ['alta', 'media', 'baja', 'sinDatos'].map((clave, posicion) => [clave, valores[posicion] ?? 0]),
      ),
    );
    const reparto = reparto5(pesos);
    assert.deepEqual(Object.keys(reparto), Object.keys(pesos));
    const totalEsperado = valores.some((peso) => peso > 0) ? TOTAL : 0;
    assert.equal(
      Object.values(reparto).reduce((suma, parte) => suma + parte, 0),
      totalEsperado,
    );
    for (const [clave, parte] of Object.entries(reparto)) {
      assert.ok(parte >= 0 && parte <= TOTAL && parte % PASO === 0, clave);
    }
  }
});

test('los restos se reparten una vez por clave aunque haya más tareas que pasos', () => {
  const pesos = Object.fromEntries(Array.from({ length: MAX_TAREAS_DE_PRUEBA }, (_, indice) => [`t${indice}`, 1]));
  const reparto = reparto5(pesos);
  const partes = Object.values(reparto);
  assert.deepEqual(partes, [...Array(TOTAL / PASO).fill(PASO), ...Array(MAX_TAREAS_DE_PRUEBA - TOTAL / PASO).fill(0)]);
  assert.deepEqual(Object.keys(reparto), Object.keys(pesos));
});

test('claves especiales y numéricas siguen siendo propiedades propias con su orden de enumeración', () => {
  const pesos = Object.fromEntries([
    ['__proto__', 1],
    ['constructor', 1],
    ['toString', 1],
  ]);
  const reparto = reparto5(pesos);
  assert.deepEqual(Object.keys(reparto), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual(Object.values(reparto), [ORACULO.primerEmpate, ORACULO.primerEmpate, ORACULO.ultimoEmpate]);
  assert.equal(Object.getPrototypeOf(reparto), Object.prototype);
  assert.deepEqual(reparto5({ '10': 1, '2': 1, '1': 1 }), { '1': 35, '2': 35, '10': 30 });
});

const PASOS_DEL_ORACULO = 20n;
const LIMITE_PESO_DEL_ORACULO = 12;

/** Oráculo racional independiente: cociente y resto BigInt, con desempate por posición explícita. */
function repartoRacional(pesos: Readonly<Record<string, number>>): Record<string, number> {
  const entradas = Object.entries(pesos);
  const total = entradas.reduce((suma, [, peso]) => suma + BigInt(peso), 0n);
  if (total === 0n) {
    return Object.fromEntries(entradas.map(([clave]) => [clave, 0]));
  }
  const cuotas = entradas.map(([clave, peso], posicion) => {
    const numerador = BigInt(peso) * PASOS_DEL_ORACULO;
    return { clave, posicion, pasos: numerador / total, resto: numerador % total };
  });
  const pendientes = Number(PASOS_DEL_ORACULO - cuotas.reduce((suma, cuota) => suma + cuota.pasos, 0n));
  const ordenadas = [...cuotas].sort((a, b) => {
    if (a.resto === b.resto) {
      return a.posicion - b.posicion;
    }
    return a.resto > b.resto ? -1 : 1;
  });
  for (const cuota of ordenadas.slice(0, pendientes)) {
    cuota.pasos += 1n;
  }
  return Object.fromEntries(cuotas.map(({ clave, pasos }) => [clave, Number(pasos) * PASO]));
}

test('restos racionalmente iguales conservan el orden aunque las cuotas tengan distinta parte entera', () => {
  const casos = [
    { pesos: { alta: 1, media: 1, baja: 10 }, esperado: { alta: 10, media: 10, baja: 80 } },
    { pesos: { alta: 10, media: 1, baja: 1 }, esperado: { alta: 85, media: 10, baja: 5 } },
    { pesos: { alta: 1, media: 10, baja: 1 }, esperado: { alta: 10, media: 85, baja: 5 } },
    { pesos: { alta: 3, media: 3, baja: 30 }, esperado: { alta: 10, media: 10, baja: 80 } },
  ];
  for (const { pesos, esperado } of casos) {
    assert.deepEqual(reparto5(pesos), esperado);
    assert.deepEqual(reparto5(pesos), repartoRacional(pesos));
  }
});

test('el reparto entero coincide con un oráculo racional independiente en cuatro bandas pequeñas', () => {
  const valores = Array.from({ length: LIMITE_PESO_DEL_ORACULO + 1 }, (_, indice) => indice);
  for (const alta of valores) {
    for (const media of valores) {
      for (const baja of valores) {
        for (const sinDatos of valores) {
          const pesos = { alta, media, baja, sinDatos };
          assert.deepEqual(reparto5(pesos), repartoRacional(pesos), JSON.stringify(pesos));
        }
      }
    }
  }
});

test('los pesos fraccionarios y magnitudes grandes conservan su cálculo sin desbordamiento', () => {
  const cuarto = 0.25;
  const tresCuartos = 0.75;
  const grande = Number.MAX_VALUE / CASOS_POR_LADO;
  assert.deepEqual(reparto5({ una: cuarto, otra: tresCuartos }), { una: 25, otra: 75 });
  assert.deepEqual(reparto5({ una: grande, otra: grande }), { una: 50, otra: 50 });
});
