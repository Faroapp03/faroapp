// Fichas SEPE seleccionadas por ocupación, cifras originales y registro de idioma.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { necesidadesDe } from '../../src/dominio/necesidades-formativas.ts';
import type { FichaSepe } from '../../src/dominio/tipos-necesidades.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { datosMinimos } from '../fixtures/datos-referencias-grupos.ts';

const ISCO = '2511';
const GRUPOS_ADMITIDOS = 4;
const PORCENTAJE_IDIOMA = 25;
const PORCENTAJE_LECTURA = 50;

function ficha(ocupacion: string): FichaSepe {
  return {
    ocupacion,
    anio: 2025,
    url: 'https://www.sepe.es/ficha',
    competencias: {
      tecnicas: [{ competencia: 'Datos', porcentaje: 0 }],
      idiomas: [
        {
          competencia: 'INGLÉS',
          porcentaje: PORCENTAJE_IDIOMA,
          destrezas: [{ destreza: 'LEER', porcentaje: PORCENTAJE_LECTURA }],
        },
      ],
    },
    competencias_ia: ['Datos'],
  };
}

function paquete(codigos: string[] = ['2111']): Datos {
  const datos = datosMinimos();
  datos.clasificaciones.isco08_a_cno11[ISCO] = codigos.map((cno11) => ({ cno11, tipo: 'directa' }));
  datos.necesidades = {
    fuente: 'SEPE',
    cita: 'Cita de prueba',
    consulta: '2026-10-13',
    todo_a_cero: [],
    ocupaciones: Object.fromEntries(codigos.map((codigo) => [codigo, ficha(`Ocupación ${codigo}`)])),
  };
  return datos;
}

test('sin paquete o correspondencia no inventa fichas; cuatro grupos se admiten y cinco se omiten', () => {
  const sinPaquete = datosMinimos();
  assert.deepEqual(necesidadesDe(sinPaquete, null, ISCO, crearLengua(sinPaquete)), []);
  const cuatro = paquete(['2111', '2112', '2113', '2114']);
  assert.equal(necesidadesDe(cuatro, null, ISCO, crearLengua(cuatro)).length, GRUPOS_ADMITIDOS);
  assert.deepEqual(necesidadesDe(cuatro, null, '9999', crearLengua(cuatro)), []);
  const cinco = paquete(['2111', '2112', '2113', '2114', '2115']);
  const lengua = crearLengua(cinco, 'ca');
  assert.deepEqual(necesidadesDe(cinco, null, ISCO, lengua), []);
  assert.deepEqual(lengua.sinTraducir(), []);
});

test('deduplica y ordena códigos, omite fichas vacías y conserva las competencias con cero', () => {
  const datos = paquete(['2113', '2112', '2111', '2113']);
  assert.ok(datos.necesidades);
  datos.necesidades.ocupaciones['2112'] = { ...ficha('Sin contenido'), competencias: { tecnicas: [] } };
  const antes = structuredClone(datos);
  const salida = necesidadesDe(datos, null, ISCO, crearLengua(datos));
  assert.deepEqual(
    salida.map(({ cno11 }) => cno11),
    ['2111', '2113'],
  );
  assert.equal(salida[0]?.competencias.tecnicas?.[0]?.porcentaje, 0);
  assert.equal(salida[0]?.conCifras, true);
  assert.deepEqual(datos, antes);
});

test('una ficha histórica marcada sin cifras conserva sus valores y no oculta las demás', () => {
  const datos = paquete(['2111', '2112']);
  assert.ok(datos.necesidades);
  datos.necesidades.todo_a_cero = ['2111'];
  const salida = necesidadesDe(datos, null, ISCO, crearLengua(datos));
  assert.deepEqual(
    salida.map(({ cno11, conCifras }) => ({ cno11, conCifras })),
    [
      { cno11: '2111', conCifras: false },
      { cno11: '2112', conCifras: true },
    ],
  );
  assert.equal(salida[0]?.competencias.idiomas?.[0]?.porcentaje, PORCENTAJE_IDIOMA);
});

test('la ficha del informe selecciona campos y copia competencias y destrezas sin arrastrar extras', () => {
  const datos = paquete();
  assert.ok(datos.necesidades);
  const original = ficha('Oficio');
  Object.assign(original, { respaldoInterno: 'no publicar' });
  const idioma = original.competencias.idiomas?.[0];
  assert.ok(idioma?.destrezas?.[0]);
  Object.assign(idioma, { idDeExtraccion: 'no publicar' });
  Object.assign(idioma.destrezas[0], { nodoOriginal: 'no publicar' });
  datos.necesidades.ocupaciones['2111'] = original;
  const [salida] = necesidadesDe(datos, null, ISCO, crearLengua(datos));
  assert.ok(salida);
  assert.deepEqual(salida, { ...ficha('Oficio'), cno11: '2111', conCifras: true });
  assert.notEqual(salida.competencias, original.competencias);
  const destreza = salida.competencias.idiomas?.[0]?.destrezas?.[0];
  assert.ok(destreza);
  destreza.porcentaje = 0;
  assert.equal(idioma.destrezas[0].porcentaje, PORCENTAJE_LECTURA);
});

test('el registro catalán conserva textos oficiales, orden de bloques y una entrada por texto', () => {
  const datos = paquete(['2112', '2111']);
  const lengua = crearLengua(datos, 'ca');
  const catalan = necesidadesDe(datos, null, ISCO, lengua);
  assert.deepEqual(catalan, necesidadesDe(datos, null, ISCO, crearLengua(datos, 'es')));
  assert.deepEqual(lengua.sinTraducir(), [
    { texto: 'Ocupación 2111', idioma: 'es' },
    { texto: 'Datos', idioma: 'es' },
    { texto: 'INGLÉS', idioma: 'es' },
    { texto: 'Ocupación 2112', idioma: 'es' },
  ]);
  assert.equal(lengua.hayTraducciones(), false);
});
