import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ESQUEMA_CATALOGO_DATOS_GLOBALES,
  ESQUEMA_CONSULTAR_DATOS_GLOBALES,
  ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES,
  ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES,
  MAX_CATALOGO_GLOBAL,
  MAX_SERIE_GLOBAL,
  SECCIONES_CATALOGO_GLOBAL,
  SECCIONES_GLOBALES,
} from '../../src/api/esquemas-datos-globales.ts';
import { validar } from '../../src/comun/esquema.ts';
import { leerDatosGlobales } from '../../src/datos-globales/datos.ts';

const datos = leerDatosGlobales(
  JSON.parse(readFileSync(new URL('../../datos/globales/datos-globales.json', import.meta.url), 'utf8')),
);

test('el catálogo exige sección y conserva sus topes sin aceptar propiedades desconocidas', () => {
  for (const seccion of SECCIONES_CATALOGO_GLOBAL) {
    assert.deepEqual(
      validar({ seccion, maximo: MAX_CATALOGO_GLOBAL, desplazamiento: 0 }, ESQUEMA_CATALOGO_DATOS_GLOBALES),
      [],
    );
  }
  for (const entrada of [
    {},
    { seccion: 'desconocida' },
    { seccion: 'metas', maximo: MAX_CATALOGO_GLOBAL + 1 },
    { seccion: 'metas', desplazamiento: -1 },
    { seccion: 'metas', texto: 'extra' },
  ]) {
    assert.ok(validar(entrada, ESQUEMA_CATALOGO_DATOS_GLOBALES).length);
  }
});

test('la consulta comparte familias, límites y campos simples; las condiciones entre campos son de la consulta', () => {
  for (const seccion of SECCIONES_GLOBALES) {
    assert.deepEqual(validar({ seccion, id: 'empresas-ia' }, ESQUEMA_CONSULTAR_DATOS_GLOBALES), []);
  }
  const entrada = {
    seccion: 'indicadores',
    id: 'empresas-ia',
    territorio: 'ES51',
    anio: 2025,
    maximo: MAX_SERIE_GLOBAL,
  };
  assert.deepEqual(validar(entrada, ESQUEMA_CONSULTAR_DATOS_GLOBALES), []);
  for (const otra of [
    { ...entrada, id: '' },
    { ...entrada, maximo: MAX_SERIE_GLOBAL + 1 },
    { ...entrada, anio: '2025' },
    { ...entrada, seccion: 'territorios' },
    { ...entrada, desconocido: true },
  ]) {
    assert.ok(validar(otra, ESQUEMA_CONSULTAR_DATOS_GLOBALES).length);
  }
});

test('las cabeceras publicadas conservan todos los metadatos reales sin mezclar las listas de valores', () => {
  const alternativas = ESQUEMA_SALIDA_CATALOGO_DATOS_GLOBALES.properties?.elementos?.items?.oneOf;
  assert.ok(alternativas);
  for (const seccion of SECCIONES_CATALOGO_GLOBAL) {
    for (const ficha of datos[seccion]) {
      const { valores: _valores, ...cabecera } = 'valores' in ficha ? ficha : { ...ficha, valores: undefined };
      assert.equal(alternativas.filter((esquema) => validar(cabecera, esquema).length === 0).length, 1);
    }
  }
});

test('las cifras calculadas conservan null, intervalos, cotas y licencias individuales', () => {
  const alternativas = ESQUEMA_SALIDA_CONSULTAR_DATOS_GLOBALES.properties?.valores?.items?.oneOf;
  const calculada = alternativas?.find((esquema) => esquema.required?.includes('intervalo'));
  assert.ok(calculada);
  const bloque = datos.calculados[0];
  assert.ok(bloque);
  const chile = bloque.valores.find(({ territorio }) => territorio === 'CHL');
  assert.ok(chile);
  assert.equal(chile.valor, null);
  assert.ok(chile.cotas);
  assert.deepEqual(validar(chile, calculada), []);
  assert.ok(validar({ ...chile, licencia: undefined }, calculada).length);
  assert.ok(validar({ ...chile, intervalo: undefined }, calculada).length);
});
