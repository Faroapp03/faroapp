// Las conclusiones usan el mismo periodo y las mismas exclusiones que las figuras.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  cifraDe,
  INDICADORES as ID,
  posicionDeCataluna,
  variantesDelTitular,
} from '../../web/scripts/datos-globales/capitulos.js';
import { type DatosGlobales, leerDatosGlobales, type Valor } from '../../web/scripts/datos-globales/datos.js';

const ANIO_ACTUAL = 2025;
const ANIO_ANTERIOR = 2024;
const VALOR_PROPIO = 20;
const VALOR_INFERIOR = 5;
const VALOR_SUPERIOR = 30;
const VALOR_PAREJA = 90;

const DATOS = leerDatosGlobales(
  JSON.parse(readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8')),
);

function sustituir(datos: DatosGlobales, codigo: string, id: string, valores: Valor[]): DatosGlobales {
  return leerDatosGlobales({
    ...datos,
    territorios: datos.territorios.map((t) =>
      t.codigo !== codigo ? t : { ...t, valores: [...t.valores.filter((v) => v.indicador !== id), ...valores] },
    ),
  });
}
function formacion(
  codigo: string,
  valor: number,
  opciones: { anio?: number; nota?: string | null; datos?: DatosGlobales } = {},
): DatosGlobales {
  const { anio = ANIO_ACTUAL, nota = null, datos = DATOS } = opciones;
  return sustituir(datos, codigo, ID.formacion, [{ indicador: ID.formacion, valor, anio, nota }]);
}

test('un año distinto sin contraparte no acredita primer puesto', () => {
  let datos = formacion('ES51', VALOR_PROPIO, { anio: ANIO_ANTERIOR });
  for (const codigo of ['ESP', 'DEU', 'FRA', 'ITA']) {
    datos = formacion(codigo, VALOR_INFERIOR, { datos });
  }
  assert.equal(posicionDeCataluna(datos, ID.formacion), null);
  assert.equal(variantesDelTitular(datos).formacion, 'cifra');
});
test('el ranking usa las cifras del año de Cataluña aunque los países ya publiquen otro', () => {
  let datos = formacion('ES51', VALOR_PROPIO, { anio: ANIO_ANTERIOR });
  for (const codigo of ['ESP', 'DEU', 'FRA', 'ITA']) {
    datos = sustituir(datos, codigo, ID.formacion, [
      { indicador: ID.formacion, valor: VALOR_INFERIOR, anio: ANIO_ACTUAL, nota: null },
      { indicador: ID.formacion, valor: VALOR_SUPERIOR, anio: ANIO_ANTERIOR, nota: null },
    ]);
  }
  assert.deepEqual(
    posicionDeCataluna(datos, ID.formacion)?.delante.map((v) => v.codigo),
    ['ESP', 'DEU', 'FRA', 'ITA'],
  );
  assert.equal(variantesDelTitular(datos).formacion, 'cifra');
});
test('una ruptura de serie no entra en el ranking ni en el titular comparativo', () => {
  const datos = formacion('ESP', VALOR_PROPIO, { nota: 'ruptura_de_serie' });
  assert.equal(posicionDeCataluna(datos, ID.formacion), null);
  assert.equal(variantesDelTitular(datos).formacion, 'cifra');
});
test('un territorio sin cifra comparable no acredita un primer puesto entre cinco', () => {
  const datos = sustituir(formacion('ES51', VALOR_SUPERIOR), 'FRA', ID.formacion, []);
  assert.equal(posicionDeCataluna(datos, ID.formacion), null);
  assert.equal(variantesDelTitular(datos).formacion, 'cifra');
});
test('las parejas con periodos distintos o nota excluida no producen comparación', () => {
  for (const [anio, nota] of [
    [ANIO_ANTERIOR, null],
    [ANIO_ACTUAL, 'ruptura_de_serie'],
  ] as const) {
    const datos = sustituir(DATOS, 'ES51', ID.hombres, [{ indicador: ID.hombres, valor: VALOR_PAREJA, anio, nota }]);
    assert.equal(variantesDelTitular(datos).genero, 'neutro');
  }
});
test('las cifras actuales y una ventaja comprobada en los cinco conservan su interpretación', () => {
  assert.equal(variantesDelTitular(DATOS).formacion, 'cifra');
  assert.equal(variantesDelTitular(formacion('ES51', VALOR_SUPERIOR)).formacion, 'primera');
});

test('una ruptura conserva el hecho histórico de su periodo sin habilitar un ranking', () => {
  const datos = formacion('ES51', VALOR_PROPIO, { nota: 'ruptura_de_serie' });
  assert.equal(cifraDe(datos, 'ES51', ID.formacion), VALOR_PROPIO);
  assert.equal(posicionDeCataluna(datos, ID.formacion), null);
  assert.equal(variantesDelTitular(datos).formacion, 'cifra');
});
