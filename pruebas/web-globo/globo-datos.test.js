// Lo que el globo saca de los datos globales (scripts/globo/datos.js), leídos con el único lector del contrato
// (scripts/datos-globales/datos.js, generado desde src/datos-globales/datos.ts, que prueba
// pruebas/conectividad/datos-globales-lector.test.ts) sobre una muestra (pruebas/fixtures/datos-globales-muestra.json: un recorte
// del archivo publicado) y sobre el archivo publicado: el selector
// lista solo países, de la A a la Z en el idioma de la página; la ficha da sus bloques de la IA en orden, solo con
// cifras medidas y completas; y cada territorio está en el mapa por su código. Lógica pura. Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import {
  bloquesDeIa,
  codigoEnElMapa,
  idNacional,
  idNacionalDePersonas,
  paisesConIa,
  paisesDeLaLista,
} from '../../web/scripts/globo/datos.js';
import { conMedidasNacionales } from './globo-nacionales.js';

/** Último punto de la serie de empresas (valor en porcentaje y año) y territorios que abren el mapa. */
const ULTIMO_VALOR_DE_EMPRESAS = 20.27;
const ULTIMO_ANIO_DE_EMPRESAS = 2025;
const TERRITORIOS_DEL_INICIO = 4;

const TEXTO_DE_LA_MUESTRA = readFileSync(new URL('../fixtures/datos-globales-muestra.json', import.meta.url), 'utf8');
/** La muestra como llega del JSON, para cambiarle un campo en una prueba. @returns {{indicadores:{id:string,naturaleza:string}[],territorios:{codigo:string,valores:{indicador:string}[]}[]}} */
function muestra() {
  return JSON.parse(TEXTO_DE_LA_MUESTRA);
}
const DATOS = leerDatosGlobales(muestra());
/** Un territorio de unos datos, por su código. */
/** @param {import('../../web/scripts/datos-globales/datos.js').DatosGlobales} datos @param {string} codigo */
function territorio(datos, codigo) {
  const encontrado = datos.territorios.find((uno) => uno.codigo === codigo);
  assert.ok(encontrado);
  return encontrado;
}

const TEXTO_PUBLICADO = readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8');
const PUBLICADOS = leerDatosGlobales(JSON.parse(TEXTO_PUBLICADO));

test('el selector lista los países con datos y Cataluña, de la A a la Z en el idioma de la página', () => {
  const nombres = (/** @type {'es'|'ca'} */ idioma) =>
    paisesDeLaLista(paisesConIa(DATOS), idioma).map(({ nombre }) => nombre[idioma]);
  assert.deepEqual(nombres('es'), ['Alemania', 'Cataluña', 'España', 'Francia', 'Italia']);
  assert.deepEqual(nombres('ca'), ['Alemanya', 'Catalunya', 'Espanya', 'França', 'Itàlia']);
});

test('Cataluña sale solo con lo que mide con la definición de los países: las empresas, sin las cifras de España', () => {
  const cataluna = territorio(PUBLICADOS, 'ES51');
  const bloques = bloquesDeIa(PUBLICADOS, cataluna);
  assert.deepEqual(
    bloques.map(({ clave }) => clave),
    ['empresas'],
    'personas, género y trabajo los trae con otra base (usuarios de internet); exposición y empleo, no los trae',
  );
  const [empresas] = bloques;
  assert.ok(empresas?.clave === 'empresas');
  const deCataluna = cataluna.valores.filter(({ indicador }) => indicador === 'empresas-ia');
  assert.deepEqual(empresas.serie.map(({ valor }) => valor).sort(), deCataluna.map(({ valor }) => valor).sort());
  assert.ok(paisesConIa(PUBLICADOS).some(({ codigo }) => codigo === 'ES51'));
  assert.equal(
    paisesConIa(PUBLICADOS).some(({ codigo }) => codigo === 'EU27_2020'),
    false,
    'la UE no tiene contorno',
  );
});

test('la ficha de España da sus bloques de Eurostat en orden, con la cifra más reciente', () => {
  const bloques = bloquesDeIa(PUBLICADOS, territorio(PUBLICADOS, 'ESP'));
  assert.deepEqual(
    bloques.map(({ clave }) => clave),
    ['empresas', 'personas', 'genero', 'trabajo'],
  );
  const [empresas] = bloques;
  assert.ok(empresas?.clave === 'empresas');
  assert.deepEqual(
    empresas.serie.map(({ anio }) => anio),
    [...empresas.serie.map(({ anio }) => anio)].sort((a, b) => a - b),
  );
  assert.deepEqual(
    [empresas.serie.at(-1)?.valor, empresas.serie.at(-1)?.anio],
    [ULTIMO_VALOR_DE_EMPRESAS, ULTIMO_ANIO_DE_EMPRESAS],
  );
});

test('un país con medida nacional la da en su bloque; uno sin cifras de la IA no da ninguno', () => {
  const canada = bloquesDeIa(PUBLICADOS, territorio(PUBLICADOS, 'CAN'));
  assert.deepEqual(
    canada.map(({ clave, indicador }) => [clave, indicador.id]),
    [['nacional', idNacional('CAN')]],
  );
  assert.deepEqual(bloquesDeIa(PUBLICADOS, territorio(PUBLICADOS, 'ARG')), []);
  assert.deepEqual(bloquesDeIa(PUBLICADOS, territorio(PUBLICADOS, 'AFG')), [], 'cifras que no son de la IA no cuentan');
});

test('la frase de la medida nacional de las personas («han usado alguna vez») es cierta en cada una publicada', () => {
  const personas = PUBLICADOS.indicadores.filter(({ id }) => id.startsWith(idNacionalDePersonas('')));
  assert.ok(personas.length > 0);
  for (const { id, definicion } of personas) {
    assert.match(definicion.es, /alguna vez/, id);
    assert.match(definicion.ca, /alguna vegada/, id);
  }
});

test('las medidas nacionales salen del contrato, sin lista de países: cada una en su bloque', () => {
  const datos = leerDatosGlobales(conMedidasNacionales());
  const codigos = paisesConIa(datos).map(({ codigo }) => codigo);
  assert.ok(codigos.includes('ISL') && codigos.includes('KOR'), codigos.join());
  const bloques = (/** @type {string} */ codigo) =>
    bloquesDeIa(datos, territorio(datos, codigo)).map(({ clave, indicador }) => [clave, indicador.id]);
  assert.deepEqual(bloques('ISL'), [['nacional', idNacional('ISL')]]);
  assert.deepEqual(bloques('KOR'), [['nacional-personas', idNacionalDePersonas('KOR')]]);
});

test('un indicador que no es medido no da bloque: la ficha no enseña estimaciones', () => {
  const datos = muestra();
  Object.assign(datos.indicadores.find(({ id }) => id === 'empresas-ia') ?? assert.fail('falta el indicador'), {
    naturaleza: 'estimado',
  });
  const leidos = leerDatosGlobales(datos);
  const claves = bloquesDeIa(leidos, territorio(leidos, 'ESP')).map(({ clave }) => clave);
  assert.equal(claves.includes('empresas'), false);
});

test('mujeres y hombres solo salen en pareja: sin las cifras de los hombres, no hay bloque', () => {
  /** @type {ReturnType<typeof muestra>} */
  const datos = JSON.parse(TEXTO_PUBLICADO);
  const espana = datos.territorios.find(({ codigo }) => codigo === 'ESP');
  assert.ok(espana);
  espana.valores = espana.valores.filter(({ indicador }) => !indicador.startsWith('hombres-ia-generativa'));
  const leidos = leerDatosGlobales(datos);
  const claves = bloquesDeIa(leidos, territorio(leidos, 'ESP')).map(({ clave }) => clave);
  assert.deepEqual(claves, ['empresas', 'personas', 'trabajo']);
});

test('un país está en el mapa por su ISO 3166-1 alfa-3 y Cataluña por su código NUTS 2', () => {
  const codigos = DATOS.territorios.map(codigoEnElMapa);
  assert.deepEqual(codigos.slice(0, TERRITORIOS_DEL_INICIO), ['ES51', 'EU27_2020', 'DEU', 'ESP']);
});
