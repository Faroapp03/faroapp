// Las cifras de Faro con punto de miles siempre y coma decimal, sin depender de Intl (src/comun/cifras.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cifra, cifraHasta, importe } from '../../src/comun/cifras.js';

/** Valores al azar de menos a más un millón, con tres decimales, siempre los mismos: la semilla es fija. */
const VALORES_AL_AZAR = 5000;
const MILESIMAS = 1000;
const DE_MENOS_A_MAS_UN_MILLON_EN_MILESIMAS = 2e9;
const SEMILLA = 20_261_115;
/** De 0 a 3 decimales. */
const CUANTOS_DECIMALES = 4;
const DECIMALES_PROBADOS = Array.from({ length: CUANTOS_DECIMALES }, (_, decimales) => decimales);
const MULTIPLICADOR = 1_103_515_245;
const INCREMENTO = 12_345;
const MODULO = 2_147_483_648;

/** Un generador congruencial lineal con semilla fija: los valores «al azar» se repiten en cada ejecución. */
function* alAzar(cuantos: number): Generator<number> {
  let estado = SEMILLA;
  for (let i = 0; i < cuantos; i++) {
    estado = (MULTIPLICADOR * estado + INCREMENTO) % MODULO;
    yield estado / MODULO;
  }
}

const CASOS: readonly (readonly [string, number, string])[] = [
  ['7', 0, '7'],
  ['4000', 0, '4.000'],
  ['1234567.891', 0, '1.234.568'],
  ['1234567.891', 2, '1.234.567,89'],
  ['0.745', 2, '0,75'],
  ['2.675', 2, '2,68'],
  ['0.5', 2, '0,50'],
  ['-1234.5', 1, '-1.234,5'],
  ['-0.004', 2, '-0,00'],
  ['1e21', 0, '1.000.000.000.000.000.000.000'],
  ['1e-7', 2, '0,00'],
];

test('cada cifra lleva punto de miles, coma decimal y los decimales pedidos', () => {
  for (const [valor, decimales, esperado] of CASOS) {
    assert.equal(cifra(Number(valor), decimales), esperado, valor);
  }
});

test('coincide con Intl (es-ES, useGrouping always) en miles de valores al azar, también negativos', () => {
  for (const azar of alAzar(VALORES_AL_AZAR)) {
    const valor =
      Math.round(azar * DE_MENOS_A_MAS_UN_MILLON_EN_MILESIMAS - DE_MENOS_A_MAS_UN_MILLON_EN_MILESIMAS / 2) / MILESIMAS;
    for (const decimales of DECIMALES_PROBADOS) {
      const intl = valor.toLocaleString('es-ES', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
        useGrouping: 'always',
      });
      assert.equal(cifra(valor, decimales), intl, String(valor));
    }
  }
});

test('lo que no es una cifra escribible se rechaza', () => {
  assert.throws(() => cifra(Number.NaN), RangeError);
  assert.throws(() => cifra(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => cifra(1, -1), RangeError);
  assert.throws(() => cifra(1, Number('0.5')), RangeError);
});

/** Valor, decimales máximos y lo que se escribe. */
const CASOS_HASTA: readonly (readonly [string, string, string])[] = [
  ['1500', '3', '1.500'],
  ['40000', '0', '40.000'],
  ['1.5', '3', '1,5'],
  ['2.25', '1', '2,3'],
  ['-1500', '2', '-1.500'],
];

test('cifraHasta recorta solo los ceros decimales, nunca los de los millares', () => {
  for (const [valor, maximo, esperado] of CASOS_HASTA) {
    assert.equal(cifraHasta(Number(valor), Number(maximo)), esperado, valor);
  }
});

/** Importe, moneda y lo que se escribe: el euro con su signo, las demás con su código; antes, un espacio fijo. */
const IMPORTES: readonly (readonly [string, string | null, string])[] = [
  ['1500', 'EUR', '1.500\u00a0€'],
  ['1500.5', 'EUR', '1.500,50\u00a0€'],
  ['12.05', 'EUR', '12,05\u00a0€'],
  ['40000', 'EUR', '40.000\u00a0€'],
  ['20', 'USD', '20\u00a0USD'],
  ['12.5', 'GBP', '12,50\u00a0GBP'],
  ['9.999', 'EUR', '10\u00a0€'],
  ['1500.456', 'JPY', '1.500,46\u00a0JPY'],
  ['20.004', 'USD', '20\u00a0USD'],
  ['1500', null, '1.500'],
];

test('el importe es el mismo en la tarjeta y en la ficha: enteros, céntimos, miles y otras monedas', () => {
  for (const [valor, moneda, esperado] of IMPORTES) {
    assert.equal(importe(Number(valor), moneda), esperado, `${valor} ${moneda}`);
  }
});
