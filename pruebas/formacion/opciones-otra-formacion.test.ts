// Opciones externas: modalidad desconocida, fechas, costes, niveles, lenguas y orden sin paquete ni red.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CitilabDelInforme, CursoCitilab, DatosCitilab } from '../../motores/cursos/src/index.ts';
import { citilabDelInforme } from '../../motores/cursos/src/index.ts';
import { opcionesDeOtraFormacion } from '../../src/dominio/opciones-otra-formacion.ts';
import type { OtraFormacion } from '../../src/dominio/tipos-informe.ts';
import { abiertaAprendizaje, citilabAprendizaje, FECHA_APRENDIZAJE } from '../fixtures/datos-aprendizaje.ts';

const HORAS_FRACCIONADAS = 18.75;
const PRECIO_PUBLICADO = 42;

function citilab(cursos: CursoCitilab[]): CitilabDelInforme {
  return { cursos, consultado: FECHA_APRENDIZAJE, copiaAntigua: false, listado: '', fuente: 'Citilab' };
}

function abierta(otra: Partial<OtraFormacion['formacionAbierta']> = {}): OtraFormacion {
  return {
    formacionAbierta: {
      publica: [],
      noPublica: [],
      fuente: 'Formación abierta',
      criterio: 'Prueba',
      ...otra,
    },
  };
}

test('sin formación externa no se inventan opciones ni fechas', () => {
  assert.deepEqual(opcionesDeOtraFormacion({}), []);
});

test('una modalidad desconocida de Citilab permanece desconocida en todos sus campos', () => {
  const [opcion] = opcionesDeOtraFormacion({ citilab: citilab([citilabAprendizaje(1)]) });
  assert.ok(opcion);
  assert.deepEqual(opcion, {
    id: 'transversal:citilab:1',
    grupo: 'transversal',
    tipo: 'curso',
    fuente: 'citilab',
    nombre: 'Curs 1',
    idioma: 'ca',
    enlace: 'https://example.test/citilab/1',
    modalidad: '',
    horas: '',
    municipio: null,
    centro: 'Citilab',
    inicio: '2026-10-20',
    fin: '2026-11-20',
    coste: null,
    relacion: 'transversal',
    adecuacion: 'sin-verificar',
    inscripcion: 'sin-verificar',
    momento: 'por-iniciar',
    destinatarios: null,
    comprobado: FECHA_APRENDIZAJE,
    aDistancia: null,
    web: null,
    correo: null,
    telefono: null,
    entidadesQueLaOfrecen: null,
    edicionesSinFecha: null,
  });
});

test('modalidades conocidas, horas decimales y coste publicado se trasladan sin deducciones', () => {
  const cursos = [
    citilabAprendizaje(1, { modalidad: 'en-linea', horas: HORAS_FRACCIONADAS }),
    citilabAprendizaje(2, {
      modalidad: 'presencial',
      coste: { gratuito: false, precio_eur: PRECIO_PUBLICADO, carnet_citilaber: false, descuento_paro_pct: null },
    }),
  ];
  const opciones = opcionesDeOtraFormacion({ citilab: citilab(cursos) });
  assert.deepEqual(
    opciones.map(({ modalidad, aDistancia, horas, coste }) => ({ modalidad, aDistancia, horas, coste })),
    [
      { modalidad: 'En línia', aDistancia: true, horas: '18,75', coste: null },
      { modalidad: 'Presencial', aDistancia: false, horas: '', coste: PRECIO_PUBLICADO },
    ],
  );
});

test('Citilab precede a la oferta pública y no pública con relaciones por tramo y nivel', () => {
  const otra = abierta({
    publica: [abiertaAprendizaje('publica')],
    noPublica: [abiertaAprendizaje('otra', { titular: 'no-publico', nivel: 'B1' })],
  });
  otra.citilab = citilab([citilabAprendizaje(2, { tramo: 'para-ir-mas-alla' }), citilabAprendizaje(1)]);
  assert.deepEqual(
    opcionesDeOtraFormacion(otra).map(({ id, relacion }) => [id, relacion]),
    [
      ['transversal:citilab:1', 'transversal'],
      ['transversal:citilab:2', 'transversal-mas-alla'],
      ['transversal:abierta:publica', 'transversal'],
      ['transversal:abierta:otra', 'transversal-mas-alla'],
    ],
  );
});

test('la formación abierta conserva lengua y modalidad de cada ficha, y gratuidad como oyente', () => {
  const otra = abierta({ publica: [abiertaAprendizaje('ca'), abiertaAprendizaje('es', { idioma: 'es', horas: 0 })] });
  assert.deepEqual(
    opcionesDeOtraFormacion(otra).map(({ idioma, modalidad, horas, coste, aDistancia }) => ({
      idioma,
      modalidad,
      horas,
      coste,
      aDistancia,
    })),
    [
      { idioma: 'ca', modalidad: 'En línia', horas: '', coste: 0, aDistancia: true },
      { idioma: 'es', modalidad: 'En línea', horas: '0', coste: 0, aDistancia: true },
    ],
  );
});

test('el productor de Citilab excluye momentos periódicos o de consulta del itinerario', () => {
  const { momento: _momento, tramo: _tramo, ...curso } = citilabAprendizaje(1);
  const datos: DatosCitilab = {
    fuente: 'Citilab',
    copia: FECHA_APRENDIZAJE,
    listado: '',
    cursos: [
      { ...curso, modificado: FECHA_APRENDIZAJE, temas: ['competencies-digitals'], trata_ia: false, periodico: false },
      {
        ...curso,
        id: 2,
        inicio: null,
        fin: null,
        modificado: FECHA_APRENDIZAJE,
        temas: ['competencies-digitals'],
        trata_ia: true,
        periodico: true,
      },
    ],
  };
  const resultado = citilabDelInforme(datos, FECHA_APRENDIZAJE, { citilabDePago: true });
  assert.ok(resultado);
  assert.deepEqual(
    opcionesDeOtraFormacion({ citilab: resultado }).map(({ id, momento }) => [id, momento]),
    [['transversal:citilab:1', 'por-iniciar']],
  );
});

test('transformar opciones no cambia ni reordena las fichas recibidas', () => {
  const otra = {
    ...abierta({ publica: [abiertaAprendizaje('publica')] }),
    citilab: citilab([citilabAprendizaje(2), citilabAprendizaje(1)]),
  };
  const antes = structuredClone(otra);
  Object.freeze(otra.citilab.cursos);
  Object.freeze(otra.formacionAbierta?.publica);
  opcionesDeOtraFormacion(otra);
  assert.deepEqual(otra, antes);
});
