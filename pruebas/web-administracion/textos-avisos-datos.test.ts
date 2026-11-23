/** Guardia: cada valor de las listas cerradas del contrato del estado de los datos tiene su texto en los dos idiomas. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVISOS_EDICION,
  ESTADOS_EDICION_NUEVA,
  MOTIVOS_DETENCION,
  PARTES_ENUNCIADO,
} from '../../src/administracion/edicion-nueva-datos.js';
import { MOTIVOS_ALMACEN, MOTIVOS_SALIDA_PARCIAL } from '../../src/administracion/estado-datos.js';
import {
  MOTIVOS_INFORMATIVOS,
  MOTIVOS_PREVISTOS_EN_ENLACES,
  MOTIVOS_QUE_PIDEN_ATENCION,
} from '../../src/administracion/salud-datos.js';
import { TEXTOS_AVISOS_DATOS as TEXTOS_CA } from '../../web/idiomas/ca/panel-datos.js';
import { TEXTOS_AVISOS_DATOS as TEXTOS_ES } from '../../web/idiomas/es/panel-datos.js';

const LISTAS: readonly (readonly [string, readonly string[]])[] = [
  ['panel.datos.almacen', MOTIVOS_ALMACEN],
  ['panel.datos.edicion-nueva', ESTADOS_EDICION_NUEVA],
  ['panel.datos.edicion-nueva.motivo', MOTIVOS_DETENCION],
  ['panel.datos.edicion-nueva.parte', PARTES_ENUNCIADO],
  ['panel.datos.aviso-edicion', AVISOS_EDICION],
  ['panel.datos.salida-parcial.motivo', MOTIVOS_SALIDA_PARCIAL],
];
const DICCIONARIOS = [
  ['es', TEXTOS_ES],
  ['ca', TEXTOS_CA],
] as const;

test('cada valor de las listas cerradas tiene un texto no vacío en castellano y en catalán', () => {
  for (const [prefijo, valores] of LISTAS) {
    assert.ok(valores.length > 0, prefijo);
    for (const valor of valores) {
      for (const [idioma, diccionario] of DICCIONARIOS) {
        const texto = diccionario[`${prefijo}.${valor}`];
        assert.ok(
          typeof texto === 'string' && texto.trim().length > 0,
          `falta el texto «${prefijo}.${valor}» en ${idioma}`,
        );
      }
    }
  }
});

test('el catalán usa el apóstrofo tipográfico y cada texto tiene su pareja en el otro idioma', () => {
  assert.deepEqual(Object.keys(TEXTOS_CA).sort(), Object.keys(TEXTOS_ES).sort());
  for (const [clave, texto] of Object.entries(TEXTOS_CA)) {
    assert.ok(texto.trim().length > 0, clave);
    assert.ok(!texto.includes("'"), `apóstrofo recto en ${clave}`);
  }
});

test('la explicación de «Necesita atención» por un aviso tiene su texto en los dos idiomas', () => {
  assert.equal(
    TEXTOS_ES['panel.datos.atencion-por-aviso'],
    'Esta fuente necesita que una persona la revise: el aviso de abajo dice qué hacer.',
  );
  assert.equal(
    TEXTOS_CA['panel.datos.atencion-por-aviso'],
    'Aquesta font necessita que una persona la revisi: l’avís de sota diu què cal fer.',
  );
});

test('cada motivo de salida parcial tiene una sola gravedad y las listas de gravedad son motivos del contrato', () => {
  const listas = [MOTIVOS_INFORMATIVOS, MOTIVOS_QUE_PIDEN_ATENCION, MOTIVOS_PREVISTOS_EN_ENLACES];
  for (const lista of listas) {
    for (const motivo of lista) {
      assert.ok(MOTIVOS_SALIDA_PARCIAL.includes(motivo), motivo);
    }
  }
  const repetidos = listas.flat().filter((motivo, i, todos) => todos.indexOf(motivo) !== i);
  assert.deepEqual(repetidos, [], 'un motivo no puede estar en dos listas de gravedad');
});

test('las familias con plural tienen su pareja y los dos idiomas usan los mismos marcadores', () => {
  for (const [idioma, diccionario] of DICCIONARIOS) {
    for (const clave of Object.keys(diccionario)) {
      const otra = clave.endsWith('.uno') ? clave.replace(/\.uno$/, '.otros') : clave.replace(/\.otros$/, '.uno');
      if (/\.(uno|otros)$/.test(clave)) {
        assert.ok(otra in diccionario, `falta la pareja de ${clave} en ${idioma}`);
      }
    }
  }
  const marcadores = (texto: string) => (texto.match(/\{v\d\}/g) ?? []).sort().join(',');
  for (const [clave, texto] of Object.entries(TEXTOS_ES)) {
    assert.equal(marcadores(TEXTOS_CA[clave] ?? ''), marcadores(texto), clave);
  }
});

test('ningún texto del panel de datos lleva un código HTTP ni un número suelto de tres cifras', () => {
  for (const [idioma, diccionario] of DICCIONARIOS) {
    for (const [clave, texto] of Object.entries(diccionario)) {
      assert.doesNotMatch(texto, /(?<![\d{])\d{3}(?![\d}])/, `${clave} en ${idioma}`);
    }
  }
});

/** Expresiones que no se dicen en el panel; las palabras sueltas se buscan con límites de letra Unicode, porque `\b`
 * no trata como letra la «í» de «índice». */
const EXPRESIONES_VETADAS = [
  'informe de validación',
  'ciclo',
  'salida publicada',
  'con integridad',
  'sembrar',
  'quien mantiene Faro',
  'qui manté Faro',
];
const PALABRAS_VETADAS = [
  'hemos',
  'seguimos',
  'mantenemos',
  'tenemos',
  'podemos',
  'vemos',
  'censo',
  'índice',
  'cicle',
  'hem',
  'seguim',
  'mantenim',
  'tenim',
  'podem',
  'cens',
  'índex',
];
const VETADAS = new RegExp(
  `${EXPRESIONES_VETADAS.join('|')}|(?<!\\p{L})(?:${PALABRAS_VETADAS.join('|')})(?!\\p{L})`,
  'iu',
);

test('la guardia de palabras vetadas casa con letras acentuadas y con la primera persona', () => {
  for (const texto of ['el índice de cursos', 'Índex del catàleg', 'mantenemos la oferta', 'ho tenim tot']) {
    assert.match(texto, VETADAS, texto);
  }
  for (const texto of ['Faro mantiene la oferta', 'el equipo técnico', 'indicadores', 'Faro manté la oferta']) {
    assert.doesNotMatch(texto, VETADAS, texto);
  }
});

test('el panel habla de Faro en tercera persona y sin remitir a lo que no enseña', () => {
  for (const [idioma, diccionario] of DICCIONARIOS) {
    for (const [clave, texto] of Object.entries(diccionario)) {
      assert.doesNotMatch(texto, VETADAS, `${clave} en ${idioma}`);
    }
  }
});

const QUE_HACER = { es: 'Qué hacer:', ca: 'Què cal fer:' } as const;

test('un texto lleva «Qué hacer» si y solo si su motivo necesita atención', () => {
  const pideAtencion = (clave: string) => {
    const [, motivo = ''] = clave.split('.motivo.');
    return clave.startsWith('panel.datos.salida-parcial.motivo.')
      ? MOTIVOS_QUE_PIDEN_ATENCION.includes(motivo as (typeof MOTIVOS_QUE_PIDEN_ATENCION)[number])
      : clave.startsWith('panel.datos.edicion-nueva.motivo.');
  };
  const claves = Object.keys(TEXTOS_ES).filter(
    (clave) =>
      clave.startsWith('panel.datos.salida-parcial.') ||
      clave.startsWith('panel.datos.edicion-nueva.') ||
      clave.startsWith('panel.datos.atencion-por-aviso'),
  );
  assert.ok(claves.length > 0);
  for (const [idioma, diccionario] of DICCIONARIOS) {
    for (const clave of claves) {
      assert.equal(
        (diccionario[clave] ?? '').includes(QUE_HACER[idioma]),
        pideAtencion(clave),
        `${clave} en ${idioma}`,
      );
    }
  }
});
