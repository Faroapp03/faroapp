// Contrato observable de las consultas: catálogo, series y procedencia, con la captura publicada real.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { artefactosGlobales } from '../../herramientas/web/datos-globales.ts';
import { SECCIONES_CATALOGO_GLOBAL, SECCIONES_GLOBALES } from '../../src/api/esquemas-datos-globales.ts';
import type { AmbitoConsulta } from '../../src/api/mcp/consultas.ts';
import { llamarHerramienta, MAX_RESPUESTA_BYTES } from '../../src/api/mcp/herramientas.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { leerDatosGlobales } from '../../src/datos-globales/datos.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { leerDatosGlobales as leerPublicado } from '../../web/scripts/datos-globales/datos.js';

const texto = readFileSync(new URL('../../datos/globales/datos-globales.json', import.meta.url), 'utf8');
const original: unknown = JSON.parse(texto);
const datosGlobales = leerDatosGlobales(original);
const ambito: AmbitoConsulta = {
  datos: cargarDatos(fileURLToPath(new URL('../../datos', import.meta.url))),
  datosGlobales,
  politica: 'ocupacion',
  hoy: '2026-10-13',
};
const CATALOGO = 'catalogo_datos_globales';
const CONSULTAR = 'consultar_datos_globales';

/** Además del contenido estructurado se comprueba el texto que recibe un cliente MCP. */
function consultar(nombre: string, argumentos: Record<string, unknown>) {
  const resultado = llamarHerramienta(ambito, { name: nombre, arguments: argumentos });
  assert.equal(resultado.isError, false, JSON.stringify(resultado));
  assert.ok(resultado.structuredContent);
  assert.deepEqual(JSON.parse(resultado.content[0]?.text ?? ''), resultado.structuredContent);
  assert.ok(Buffer.byteLength(JSON.stringify(resultado.structuredContent)) <= MAX_RESPUESTA_BYTES);
  return resultado.structuredContent;
}

/** Proyección esperada del archivo de datos: retira exclusivamente las observaciones. */
function sinValores(valor: unknown): Record<string, unknown> {
  assert.ok(esObjeto(valor));
  const { valores: _valores, ...descriptor } = valor;
  return descriptor;
}

test('el catálogo pagina todas las fichas y territorios sin omitir metadatos ni alterar su orden', () => {
  assert.ok(esObjeto(original));
  for (const seccion of SECCIONES_CATALOGO_GLOBAL) {
    const esperados: unknown = original[seccion];
    assert.ok(Array.isArray(esperados));
    const recibidos: unknown[] = [];
    let desplazamiento: number | null = 0;
    while (desplazamiento !== null) {
      const pagina = consultar(CATALOGO, { seccion, desplazamiento });
      assert.equal(pagina.total, esperados.length);
      assert.equal(pagina.desplazamiento, desplazamiento);
      assert.ok(Array.isArray(pagina.elementos));
      recibidos.push(...pagina.elementos);
      assert.ok(
        pagina.siguiente === null || (typeof pagina.siguiente === 'number' && pagina.siguiente > desplazamiento),
      );
      desplazamiento = pagina.siguiente;
    }
    assert.deepEqual(recibidos, esperados.map(sinValores), seccion);
  }
});

test('cada indicador devuelve sus observaciones exactas para cada territorio que las contiene', () => {
  for (const territorio of datosGlobales.territorios) {
    for (const id of new Set(territorio.valores.map((cifra) => cifra.indicador))) {
      const esperado = territorio.valores.filter((cifra) => cifra.indicador === id);
      const recibido = consultar(CONSULTAR, { seccion: 'indicadores', id, territorio: territorio.codigo });
      assert.equal(recibido.total, esperado.length);
      assert.deepEqual(recibido.valores, esperado);
      assert.deepEqual(recibido.territorio, sinValores(territorio));
      assert.equal(recibido.siguiente, null);
    }
  }
});

for (const seccion of ['recuentos', 'encuestas', 'calculados'] as const) {
  test(`${seccion}: cada cifra, nota, intervalo y cota coincide exactamente con el archivo`, () => {
    for (const ficha of datosGlobales[seccion]) {
      for (const cifra of ficha.valores) {
        const recibido = consultar(CONSULTAR, { seccion, id: ficha.id, territorio: cifra.territorio });
        assert.deepEqual(recibido.valores, [cifra]);
        assert.deepEqual(recibido.ficha, sinValores(ficha));
        assert.equal(recibido.total, 1);
        assert.equal(recibido.siguiente, null);
      }
    }
  });
}

test('metas son objetivos completos, sin fingir cifras territoriales ni aceptar filtros estadísticos', () => {
  for (const ficha of datosGlobales.metas) {
    const pedido = { seccion: 'metas', id: ficha.id };
    const recibido = consultar(CONSULTAR, pedido);
    assert.deepEqual(recibido.ficha, ficha);
    assert.deepEqual(recibido.valores, []);
    assert.equal(recibido.territorio, null);
    assert.equal(recibido.total, 0);
    for (const extra of [{ territorio: 'ES51' }, { anio: ficha.anio }, { maximo: 1 }, { desplazamiento: 0 }]) {
      assert.equal(llamarHerramienta(ambito, { name: CONSULTAR, arguments: { ...pedido, ...extra } }).isError, true);
    }
  }
});

test('los filtros y páginas distinguen una serie vacía de un territorio o identificador inexistente', () => {
  const pedido = { seccion: 'indicadores', id: 'empresas-ia', territorio: 'ES51' };
  const primera = consultar(CONSULTAR, { ...pedido, maximo: 1 });
  assert.equal(primera.siguiente, 1);
  const segunda = consultar(CONSULTAR, { ...pedido, maximo: 1, desplazamiento: 1 });
  const completo = consultar(CONSULTAR, pedido);
  assert.ok(Array.isArray(completo.valores));
  assert.deepEqual(primera.valores, completo.valores.slice(0, 1));
  assert.deepEqual(segunda.valores, completo.valores.slice(1, 2));
  for (const filtros of [{ anio: 1900 }, { desplazamiento: Number.MAX_SAFE_INTEGER }]) {
    const vacia = consultar(CONSULTAR, { ...pedido, ...filtros });
    assert.deepEqual(vacia.valores, []);
    assert.equal(vacia.siguiente, null);
  }
  for (const cambio of [{ id: 'inexistente' }, { territorio: 'WLD' }, { territorio: undefined }]) {
    assert.equal(llamarHerramienta(ambito, { name: CONSULTAR, arguments: { ...pedido, ...cambio } }).isError, true);
  }
});

test('límites, parámetros extra y errores no reflejan el texto recibido', () => {
  const canario = 'canario@example.invalid';
  for (const arguments_ of [
    {},
    { seccion: 'territorios', maximo: 0 },
    { seccion: 'territorios', maximo: 6 },
    { seccion: 'territorios', desplazamiento: -1 },
    { seccion: 'territorios', desplazamiento: 0.5 },
    { seccion: 'territorios', [canario]: true },
    { seccion: canario },
  ]) {
    const resultado = llamarHerramienta(ambito, { name: CATALOGO, arguments: arguments_ });
    assert.equal(resultado.isError, true);
    assert.equal(JSON.stringify(resultado).includes(canario), false);
  }
  for (const seccion of SECCIONES_GLOBALES) {
    const resultado = llamarHerramienta(ambito, {
      name: CONSULTAR,
      arguments: { seccion, id: canario, territorio: canario },
    });
    assert.equal(resultado.isError, true);
    assert.equal(JSON.stringify(resultado).includes(canario), false);
  }
});

test('datos ausentes o de muestra solo inhabilitan las consultas globales', () => {
  for (const captura of [null, { ...datosGlobales, muestra: true }]) {
    const alcance = { ...ambito, datosGlobales: captura };
    const resultado = llamarHerramienta(alcance, { name: CATALOGO, arguments: { seccion: 'indicadores' } });
    assert.equal(resultado.isError, true);
    const pedido = { name: 'explorar_grupos', arguments: { padre: '4' } };
    assert.deepEqual(llamarHerramienta(alcance, pedido), llamarHerramienta(ambito, pedido));
  }
});

test('las publicaciones se regeneran desde las fuentes y el lector web conserva los mismos datos', () => {
  for (const [archivo, contenido] of artefactosGlobales()) {
    assert.equal(readFileSync(archivo, 'utf8'), contenido, fileURLToPath(archivo));
  }
  assert.equal(readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8'), texto);
  assert.deepEqual(leerPublicado(original), datosGlobales);
});
