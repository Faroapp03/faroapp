// Composición del contexto, correspondencias oficiales y registro de los datos en su idioma.

import assert from 'node:assert/strict';
import test from 'node:test';
import { codigosCno, contextoCataluna, MAX_GRUPOS } from '../../src/dominio/contexto.ts';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { datosParaContexto, euresConCorrespondencias } from '../fixtures/datos-contexto.ts';

const GRUPOS_SOBRE_EL_LIMITE = MAX_GRUPOS + 1;
const VARIACION_PUBLICADA = 5;
const VARIACION_SUMA_OCUPACIONES = 4;

test('los códigos INE se deduplican y ordenan sin elegir una ocupación por el grupo', () => {
  const datos = datosParaContexto();
  datos.clasificaciones.isco08_a_cno11['2222']?.push({ cno11: '2211', tipo: '1:n' });
  assert.deepEqual(codigosCno(datos, null, '2222'), ['2111', '2211']);
  assert.deepEqual(codigosCno(datos, 'sin-correspondencia', '2222'), ['2111', '2211']);
  assert.deepEqual(codigosCno(datos, null, 'inexistente'), []);
});

test('EURES desempata sin datos de Cursos, con una coincidencia exacta del INE, y recorta sus códigos largos', () => {
  const datos = datosParaContexto();
  datos.eures = euresConCorrespondencias({
    oficio: [
      ['2211.99', 'exacta', 'Ocupación'],
      ['2111', 'cercana', 'Otra'],
    ],
  });
  assert.equal(datos.formacion, undefined);
  assert.deepEqual(codigosCno(datos, 'oficio', '2222'), ['2211']);
  assert.deepEqual(codigosCno(datos, null, '2222'), ['2111', '2211']);
});

test('EURES usa la cercana si las exactas no desempatan y nunca introduce un código ajeno al INE', () => {
  const datos = datosParaContexto();
  datos.eures = euresConCorrespondencias({
    oficio: [
      ['9999', 'exacta', 'Fuera'],
      ['2111', 'cercana', 'Dentro'],
    ],
  });
  assert.deepEqual(codigosCno(datos, 'oficio', '2222'), ['2111']);
  datos.eures.ocupaciones.oficio = [['9999', 'exacta', 'Fuera']];
  assert.deepEqual(codigosCno(datos, 'oficio', '2222'), ['2111', '2211']);
});

test('varias coincidencias exactas permiten desempatar en el nivel cercano', () => {
  const datos = datosParaContexto();
  datos.eures = euresConCorrespondencias({
    oficio: [
      ['2111', 'exacta', 'Primera'],
      ['2211', 'exacta', 'Segunda'],
      ['2211', 'cercana', 'Única'],
    ],
  });
  assert.deepEqual(codigosCno(datos, 'oficio', '2222'), ['2211']);
});

test('sin Cataluña conserva el género y devuelve todos los campos de contexto sin cifras', () => {
  const datos = datosParaContexto();
  delete datos.cataluna;
  const lengua = crearLengua(datos);
  assert.deepEqual(contextoCataluna(datos, null, '1111', lengua), {
    ocupados: [],
    contratacion: [],
    periodo: null,
    variacionConjunto: null,
    genero: { mujeres: 0, hombres: 0, fuente: lengua.textos.contexto.fuenteGenero(0) },
    pendiente: lengua.textos.contexto.sinDatosCataluna,
    zona: [],
    perfil: [],
    salario: null,
    avisoCenso: null,
    provincias: null,
    frente: null,
    adicional: null,
  });
});

test('el tope permite cuatro códigos y omite cifras con cinco antes de agrupar el censo', () => {
  const datos = datosParaContexto();
  const lengua = crearLengua(datos);
  const codigos = ['2111', '2112', '2113', '2114', '2115'];
  datos.clasificaciones.isco08_a_cno11['1111'] = codigos.slice(0, MAX_GRUPOS).map((cno11) => ({ cno11, tipo: '1:n' }));
  assert.equal(contextoCataluna(datos, null, '1111', lengua).ocupados.length, 1);
  datos.clasificaciones.isco08_a_cno11['1111'] = codigos.map((cno11) => ({ cno11, tipo: '1:n' }));
  const sinCifras = contextoCataluna(datos, null, '1111', lengua);
  assert.deepEqual(sinCifras.ocupados, []);
  assert.equal(sinCifras.periodo, null);
  assert.match(sinCifras.pendiente ?? '', new RegExp(String(GRUPOS_SOBRE_EL_LIMITE)));
});

test('ordena ocupados por tamaño y conserva el orden de código en empates de contratación', () => {
  const datos = datosParaContexto();
  const contexto = contextoCataluna(datos, null, '2222', crearLengua(datos));
  assert.deepEqual(
    contexto.ocupados.map(({ cno11 }) => cno11),
    ['221', '211'],
  );
  assert.deepEqual(
    contexto.contratacion.map(({ cno11 }) => cno11),
    ['2111', '2211'],
  );
});

test('la variación conjunta usa el total publicado del mismo periodo y conserva la alternativa', () => {
  const datos = datosParaContexto();
  assert.ok(datos.observatori);
  const lengua = crearLengua(datos);
  assert.equal(contextoCataluna(datos, null, '1111', lengua).variacionConjunto, VARIACION_PUBLICADA);
  datos.observatori.periodo = 'Periodo diferente';
  assert.equal(contextoCataluna(datos, null, '1111', lengua).variacionConjunto, VARIACION_SUMA_OCUPACIONES);
  datos.observatori.periodo = 'Periodo general';
  datos.observatori.cataluna.total.variacion_personas_contratadas = null;
  assert.equal(contextoCataluna(datos, null, '1111', lengua).variacionConjunto, VARIACION_SUMA_OCUPACIONES);
  delete datos.observatori;
  assert.equal(contextoCataluna(datos, null, '1111', lengua).variacionConjunto, VARIACION_SUMA_OCUPACIONES);
});

test('sin correspondencia conserva periodo y variación pero explica que no hay datos de la ocupación', () => {
  const datos = datosParaContexto();
  const lengua = crearLengua(datos);
  const contexto = contextoCataluna(datos, null, 'inexistente', lengua);
  assert.deepEqual(contexto.ocupados, []);
  assert.deepEqual(contexto.contratacion, []);
  assert.equal(contexto.periodo, 'Periodo general');
  assert.equal(contexto.pendiente, lengua.textos.contexto.sinDatosOcupacion);
  assert.equal(contexto.avisoCenso, null);
});

test('la contratación omite cero y null sin ocultar cifras del censo', () => {
  const datos = datosParaContexto();
  assert.ok(datos.cataluna);
  const primera = datos.cataluna.contratacion_cno4['2111'];
  const segunda = datos.cataluna.contratacion_cno4['2211'];
  assert.ok(primera && segunda);
  primera.personas_contratadas = 0;
  segunda.personas_contratadas = null;
  const contexto = contextoCataluna(datos, null, '2222', crearLengua(datos));
  assert.deepEqual(contexto.contratacion, []);
  assert.equal(contexto.ocupados.length, 2);
  assert.equal(contexto.pendiente, null);
  assert.ok(contexto.avisoCenso);
});

test('el contexto conserva los datos y registra nombres originales en el orden de uso del informe catalán', () => {
  const datos = datosParaContexto();
  const antes = structuredClone(datos);
  const lengua = crearLengua(datos, 'ca');
  contextoCataluna(datos, null, '1111', lengua);
  assert.deepEqual(lengua.sinTraducir(), [
    { texto: 'Primer grupo', idioma: 'es' },
    { texto: 'Ocupación primaria', idioma: 'es' },
    { texto: 'Periodo general', idioma: 'es' },
    { texto: 'Grupo amplio', idioma: 'es' },
    { texto: 'Gran grupo', idioma: 'es' },
  ]);
  assert.equal(lengua.hayTraducciones(), false);
  assert.deepEqual(datos, antes);
});
