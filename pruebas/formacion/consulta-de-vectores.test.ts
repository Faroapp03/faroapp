import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VectoresGuardados } from '../../src/comun/vectores.ts';
import { consultaGrupo, consultaOcupacion } from '../../src/dominio/consulta-de-vectores.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';

const MAXIMO_INT8 = 127;

function vectores(ids: string[], filas: number[][], modelo = 'prueba'): VectoresGuardados {
  return {
    modelo,
    dimensiones: filas[0]?.length ?? 2,
    ids,
    escalas: filas.map(() => 1),
    datos: Buffer.from(Int8Array.from(filas.flat()).buffer).toString('base64'),
  };
}

function datosCon(partes: Partial<Datos> = {}): Datos {
  return {
    esco: {
      competencias: [],
      ocupaciones: { ocupacion: { uri: '', titulo: '', isco08: '4311', competencias: [] } },
    },
    oit: {
      fuente: { cita: '', aviso_adaptacion: '' },
      ocupaciones: {},
      tareas: {
        tarea: { isco08: '4311', indice: 0, texto_en: '', nota: null, margen: null, metodo: null },
      },
    },
    clasificaciones: { cno11: {}, isco08_es: {}, isco08_a_cno11: {} },
    cambra: {
      fuente: '',
      genero: { mujeres_exposicion_media_o_alta: 0, hombres_exposicion_media_o_alta: 0, pagina_impresa: 0 },
    },
    textos: { tareas: {}, competencias_por_ocupacion: {}, aviso_traduccion: '' },
    vectores: vectores(['tarea'], [[0, MAXIMO_INT8]]),
    vectoresFormacion: {
      ocupaciones: vectores(['ocupacion'], [[MAXIMO_INT8, 0]]),
      especialidades: vectores(['especialidad'], [[MAXIMO_INT8, 0]]),
    },
    ...partes,
  };
}

test('la consulta suma nombre y tareas, mientras el grupo utiliza solo sus tareas', () => {
  const datos = datosCon();
  assert.deepEqual(consultaOcupacion(datos, 'ocupacion'), Float32Array.from([Math.SQRT1_2, Math.SQRT1_2]));
  assert.deepEqual(consultaGrupo(datos, '4311'), Float32Array.from([0, 1]));
  assert.equal(consultaOcupacion(datos, 'ausente'), null);
  assert.equal(consultaGrupo(datos, 'ausente'), null);
});

test('sin tareas o sin su vector, la ocupación conserva el nombre y el grupo no inventa una medida', () => {
  const sinVectores = datosCon();
  delete sinVectores.vectores;
  for (const datos of [sinVectores, datosCon({ vectores: vectores([], []) })]) {
    assert.deepEqual(consultaOcupacion(datos, 'ocupacion'), Float32Array.from([1, 0]));
    assert.equal(consultaGrupo(datos, '4311'), null);
  }
  const datos = datosCon();
  datos.esco.ocupaciones = {};
  assert.deepEqual(consultaOcupacion(datos, 'ocupacion'), Float32Array.from([1, 0]));
});

test('sin formación, no hay consulta de ocupación pero se conserva la consulta autónoma del grupo', () => {
  const datos = datosCon();
  delete datos.vectoresFormacion;
  assert.equal(consultaOcupacion(datos, 'ocupacion'), null);
  assert.deepEqual(consultaGrupo(datos, '4311'), Float32Array.from([0, 1]));
});

test('no mezcla modelos ni dimensiones entre tareas y formación', () => {
  for (const incompatibles of [
    vectores(['tarea'], [[0, MAXIMO_INT8]], 'otro'),
    vectores(['tarea'], [[0, MAXIMO_INT8, 0]]),
  ]) {
    const datos = datosCon({ vectores: incompatibles });
    assert.equal(consultaOcupacion(datos, 'ocupacion'), null);
    assert.equal(consultaGrupo(datos, '4311'), null);
  }
  for (const incompatibles of [
    vectores(['ocupacion'], [[MAXIMO_INT8, 0]], 'otro'),
    vectores(['ocupacion'], [[MAXIMO_INT8, 0, 0]]),
  ]) {
    const datos = datosCon({ vectoresFormacion: { ocupaciones: incompatibles, especialidades: vectores([], []) } });
    assert.equal(consultaOcupacion(datos, 'ocupacion'), null);
  }
});

test('solo promedia las tareas del grupo con vector disponible', () => {
  const datos = datosCon({
    vectores: vectores(
      ['tarea', 'otra'],
      [
        [0, MAXIMO_INT8],
        [-MAXIMO_INT8, 0],
      ],
    ),
  });
  const tarea = datos.oit.tareas.tarea;
  assert.ok(tarea);
  datos.oit.tareas.sinVector = { ...tarea, indice: 1 };
  datos.oit.tareas.otra = { ...tarea, isco08: '9999', indice: 2 };
  assert.deepEqual(consultaGrupo(datos, '4311'), Float32Array.from([0, 1]));
  assert.deepEqual(consultaOcupacion(datos, 'ocupacion'), Float32Array.from([Math.SQRT1_2, Math.SQRT1_2]));
});

test('los vectores nulos y la cancelación conservan cero sin NaN', () => {
  const nulos = datosCon({ vectores: vectores(['tarea'], [[0, 0]]) });
  assert.deepEqual(consultaGrupo(nulos, '4311'), new Float32Array(2));
  const opuestos = datosCon({ vectores: vectores(['tarea'], [[-MAXIMO_INT8, 0]]) });
  assert.deepEqual(consultaOcupacion(opuestos, 'ocupacion'), new Float32Array(2));
});

test('cada consulta devuelve un vector propio y conserva los datos de entrada', () => {
  const datos = datosCon();
  const antes = structuredClone(datos);
  const primera = consultaOcupacion(datos, 'ocupacion');
  const segunda = consultaOcupacion(datos, 'ocupacion');
  assert.ok(primera);
  assert.deepEqual(primera, segunda);
  assert.notEqual(primera, segunda);
  primera.fill(0);
  assert.deepEqual(consultaOcupacion(datos, 'ocupacion'), segunda);
  assert.deepEqual(datos, antes);
});

test('propaga el rechazo de un índice corrupto en vez de producir una consulta no numérica', () => {
  const datos = datosCon();
  assert.ok(datos.vectores);
  datos.vectores.datos = '';
  assert.throws(() => consultaGrupo(datos, '4311'), /0 bytes para 1 × 2/u);
  assert.throws(() => consultaOcupacion(datos, 'ocupacion'), /0 bytes para 1 × 2/u);
});

test('el peso de las tareas es su media y no aumenta con el número de tareas del grupo', () => {
  const datos = datosCon({
    vectores: vectores(
      ['tarea', 'segunda'],
      [
        [0, MAXIMO_INT8],
        [0, MAXIMO_INT8],
      ],
    ),
  });
  const tarea = datos.oit.tareas.tarea;
  assert.ok(tarea);
  datos.oit.tareas.segunda = { ...tarea, indice: 1 };
  assert.deepEqual(consultaOcupacion(datos, 'ocupacion'), Float32Array.from([Math.SQRT1_2, Math.SQRT1_2]));
  assert.deepEqual(consultaGrupo(datos, '4311'), Float32Array.from([0, 1]));
});
