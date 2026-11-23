// Lengua del informe y selección de datos ES/CA con un paquete mínimo, sin archivos externos ni IA.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CampoDeTarea,
  textoDeTareaEn,
  tituloCnoEn,
  tituloEscoEn,
  tituloIscoEn,
} from '../../src/dominio/datos-en-idioma.ts';
import { crearLengua, textosDelInforme } from '../../src/dominio/lengua.ts';
import { TEXTOS_INFORME_ES } from '../../src/dominio/textos-informe.ts';
import { TEXTOS_INFORME_CA } from '../../src/dominio/textos-informe-ca.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';

function datosDePrueba(): Datos {
  return {
    esco: {
      competencias: [],
      ocupaciones: { oficio: { uri: 'oficio', titulo: 'Oficio', isco08: '1234', competencias: [] } },
    },
    oit: { fuente: { cita: '', aviso_adaptacion: '' }, ocupaciones: {}, tareas: {} },
    clasificaciones: {
      cno11: { '4321': { titulo: 'Grupo CNO', nivel: '4', padre: '432' } },
      isco08_es: { '1234': 'Grupo ISCO' },
      isco08_a_cno11: {},
    },
    cambra: {
      fuente: '',
      genero: { mujeres_exposicion_media_o_alta: 0, hombres_exposicion_media_o_alta: 0, pagina_impresa: 0 },
    },
    textos: {
      tareas: { tarea: { corto: 'Corto', texto_es: 'Texto', ia_podria: 'IA', lo_tuyo: 'Lo tuyo' } },
      competencias_por_ocupacion: {},
      aviso_traduccion: '',
    },
    catalan: {
      idioma: 'ca',
      marca: '',
      estado: '',
      aviso_traduccion: '',
      tareas: { tarea: { corto: 'Curt', texto: 'Text', ia_podria: 'IA catalana', lo_tuyo: 'El que és teu' } },
      grupos: { '1234': 'Grup ISCO' },
      ocupaciones: { oficio: 'Ofici' },
      grupos_cno11: { '4321': 'Grup CNO' },
      fuente_grupos: { cita: '', licencia: '', consultado: '' },
    },
  };
}

test('los grupos usan nombres oficiales catalanes y conservan el castellano si falta el nombre', () => {
  const datos = datosDePrueba();
  const { catalan: _catalan, ...sinCatalan } = datos;
  const casos = [
    { seleccionar: tituloIscoEn, codigo: '1234', castellano: 'Grupo ISCO', catalan: 'Grup ISCO' },
    { seleccionar: tituloCnoEn, codigo: '4321', castellano: 'Grupo CNO', catalan: 'Grup CNO' },
  ];
  for (const { seleccionar, codigo, castellano, catalan } of casos) {
    assert.deepEqual(seleccionar(datos, codigo, 'es'), { texto: castellano, idioma: 'es' });
    assert.deepEqual(seleccionar(datos, codigo, 'ca'), { texto: catalan, idioma: 'ca', oficial: true });
    assert.equal(seleccionar(datos, 'inexistente', 'ca'), null);
    assert.deepEqual(seleccionar(sinCatalan, codigo, 'ca'), {
      texto: castellano,
      idioma: 'es',
    });
  }
});

test('ESCO usa la traducción de Faro y exige una ocupación existente', () => {
  const datos = datosDePrueba();
  assert.deepEqual(tituloEscoEn(datos, 'oficio', 'es'), { texto: 'Oficio', idioma: 'es' });
  assert.deepEqual(tituloEscoEn(datos, 'oficio', 'ca'), { texto: 'Ofici', idioma: 'ca' });
  assert.throws(() => tituloEscoEn(datos, 'inexistente', 'ca'), TypeError);
});

test('los cuatro campos de tarea conservan su correspondencia y el origen español', () => {
  const datos = datosDePrueba();
  const casos: readonly [CampoDeTarea, string, string][] = [
    ['corto', 'Corto', 'Curt'],
    ['texto', 'Texto', 'Text'],
    ['ia_podria', 'IA', 'IA catalana'],
    ['lo_tuyo', 'Lo tuyo', 'El que és teu'],
  ];
  for (const [campo, castellano, catalan] of casos) {
    assert.deepEqual(textoDeTareaEn(datos, 'tarea', campo, 'es'), { texto: castellano, idioma: 'es' });
    assert.deepEqual(textoDeTareaEn(datos, 'tarea', campo, 'ca'), { texto: catalan, idioma: 'ca' });
    assert.equal(textoDeTareaEn(datos, 'inexistente', campo, 'ca'), null);
  }
});

test('una traducción vacía conserva el original y una tarea sin original no usa la traducción', () => {
  const datos = datosDePrueba();
  assert.ok(datos.catalan);
  datos.catalan.ocupaciones.oficio = '';
  datos.catalan.grupos['1234'] = '';
  datos.catalan.grupos_cno11['4321'] = '';
  datos.catalan.tareas.tarea = { corto: '', ia_podria: 'Solo traducción' };
  datos.textos.tareas.tarea = { corto: '', texto_es: 'Texto' };
  assert.deepEqual(tituloEscoEn(datos, 'oficio', 'ca'), { texto: 'Oficio', idioma: 'es' });
  assert.deepEqual(tituloIscoEn(datos, '1234', 'ca'), { texto: 'Grupo ISCO', idioma: 'es' });
  assert.deepEqual(tituloCnoEn(datos, '4321', 'ca'), { texto: 'Grupo CNO', idioma: 'es' });
  assert.deepEqual(textoDeTareaEn(datos, 'tarea', 'corto', 'ca'), { texto: '', idioma: 'es' });
  assert.equal(textoDeTareaEn(datos, 'tarea', 'ia_podria', 'ca'), null);
});

test('cada informe conserva su diccionario compartido y el castellano es el idioma por defecto', () => {
  assert.equal(textosDelInforme('es'), TEXTOS_INFORME_ES);
  assert.equal(textosDelInforme('ca'), TEXTOS_INFORME_CA);
  const lengua = crearLengua(datosDePrueba());
  assert.equal(lengua.idioma, 'es');
  assert.equal(lengua.textos, TEXTOS_INFORME_ES);
});

test('los nombres oficiales y los originales catalanes no cuentan como traducciones de Faro', () => {
  const lengua = crearLengua(datosDePrueba(), 'ca');
  assert.equal(lengua.tituloIsco('1234'), 'Grup ISCO');
  assert.equal(lengua.tituloCno('4321'), 'Grup CNO');
  assert.equal(lengua.original('Curs del SOC', 'ca'), 'Curs del SOC');
  assert.equal(lengua.hayTraducciones(), false);
  assert.deepEqual(lengua.sinTraducir(), []);
});

test('las traducciones de Faro se registran al usarlas y los códigos sin título conservan su código', () => {
  const lengua = crearLengua(datosDePrueba(), 'ca');
  assert.equal(lengua.tituloEsco('oficio'), 'Ofici');
  assert.equal(lengua.textoDeTarea('tarea', 'texto'), 'Text');
  assert.equal(lengua.hayTraducciones(), true);
  assert.equal(lengua.tituloIsco('inexistente'), 'inexistente');
  assert.equal(lengua.tituloCno('inexistente'), 'inexistente');
  assert.equal(lengua.textoDeTarea('inexistente', 'texto'), null);
});

test('los originales en otra lengua se registran también en informes castellanos', () => {
  const lengua = crearLengua(datosDePrueba());
  assert.equal(lengua.original('Official task', 'en'), 'Official task');
  assert.equal(lengua.original('Curs del SOC', 'ca'), 'Curs del SOC');
  assert.deepEqual(lengua.sinTraducir(), [
    { texto: 'Official task', idioma: 'en' },
    { texto: 'Curs del SOC', idioma: 'ca' },
  ]);
  assert.equal(lengua.hayTraducciones(), false);
});

test('los textos repetidos conservan la primera posición y el último idioma apuntado', () => {
  const lengua = crearLengua(datosDePrueba(), 'ca');
  lengua.original('Compartido', 'es');
  lengua.original('Segundo', 'en');
  lengua.original('Compartido', 'en');
  lengua.original('Compartido', 'ca');
  assert.deepEqual(lengua.sinTraducir(), [
    { texto: 'Compartido', idioma: 'en' },
    { texto: 'Segundo', idioma: 'en' },
  ]);
});

test('cada lengua tiene su registro y sinTraducir devuelve entradas independientes', () => {
  const datos = datosDePrueba();
  const primera = crearLengua(datos, 'ca');
  const segunda = crearLengua(datos, 'ca');
  primera.original('Original', 'es');
  const salida = primera.sinTraducir();
  assert.ok(salida[0]);
  salida[0].texto = 'Modificado';
  salida.length = 0;
  assert.deepEqual(primera.sinTraducir(), [{ texto: 'Original', idioma: 'es' }]);
  assert.deepEqual(segunda.sinTraducir(), []);
});

test('fraseDeIa conserva el objeto sin traducción y no registra una frase hasta usarla', () => {
  const traducciones = new Map([
    ['Frase', 'Frase catalana'],
    ['Vacía', ''],
  ]);
  const lengua = crearLengua(datosDePrueba(), 'ca', traducciones);
  const sinTraduccion = { texto: 'Sin traducción', idioma: 'es' } as const;
  const yaCatalana = { texto: 'Frase', idioma: 'ca' } as const;
  assert.equal(lengua.fraseDeIa(sinTraduccion), sinTraduccion);
  assert.equal(lengua.fraseDeIa(yaCatalana), yaCatalana);
  const traducida = lengua.fraseDeIa({ texto: 'Frase', idioma: 'es' });
  assert.deepEqual(traducida, { texto: 'Frase catalana', idioma: 'ca' });
  assert.deepEqual(lengua.fraseDeIa({ texto: 'Vacía', idioma: 'es' }), { texto: '', idioma: 'ca' });
  assert.equal(lengua.hayTraducciones(), false);
  assert.deepEqual(lengua.sinTraducir(), []);
  lengua.usar(traducida);
  assert.equal(lengua.hayTraducciones(), true);
});

test('el mapa de frases conserva su identidad y las lecturas de datos no los modifican', () => {
  const datos = datosDePrueba();
  const antes = structuredClone(datos);
  const traducciones = new Map<string, string>();
  const lengua = crearLengua(datos, 'ca', traducciones);
  traducciones.set('Frase', 'Traducció');
  assert.deepEqual(lengua.fraseDeIa({ texto: 'Frase', idioma: 'es' }), { texto: 'Traducció', idioma: 'ca' });
  lengua.tituloIsco('1234');
  lengua.tituloCno('4321');
  lengua.tituloEsco('oficio');
  lengua.textoDeTarea('tarea', 'corto');
  assert.deepEqual(datos, antes);
});
