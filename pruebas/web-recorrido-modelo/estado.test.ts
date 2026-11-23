import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { MOTIVOS_DE_FALLO } from '../../web/scripts/recorrido/api/errores.js';
import {
  anotarFallo,
  anularEmparejamiento,
  emparejamientoCaducado,
  estado,
  hayAlgoQuePerder,
  nuevaTarea,
  ocupacionElegida,
  oficialesDe,
  oficialesDeLosGrupos,
  olvidarEstimacion,
  quienCuenta,
  reiniciarEstado,
} from '../../web/scripts/recorrido/estado.js';
import { estimacion, ficha, ocupacion } from './datos.ts';

beforeEach(reiniciarEstado);

test('reiniciar mantiene el singleton y retira tareas, grupos y pendientes sin referencias compartidas', () => {
  const identidad = estado;
  const grupos = estado.grupos;
  const tareas = estado.tareas;
  estado.ocupacion = ocupacion();
  estado.tareas.push(nuevaTarea('Conducir'));
  estado.textoSinLeer = 'Pendiente';
  reiniciarEstado();
  assert.equal(estado, identidad);
  assert.notEqual(estado.grupos, grupos);
  assert.notEqual(estado.tareas, tareas);
  assert.deepEqual(Object.keys(estado).sort(), [
    'grupos',
    'hojaDeRuta',
    'ocupacion',
    'siguienteId',
    'tareas',
    'textoSinLeer',
  ]);
  assert.equal(estado.ocupacion, null);
  assert.equal(estado.textoSinLeer, null);
  assert.equal(nuevaTarea('Primera').id, 1);
});

test('avisa de pérdida por conversación, escritura, ocupación o tarea, incluso fuera del paso de tareas', () => {
  assert.equal(hayAlgoQuePerder({ haHablado: false, escrito: '  ' }), false);
  assert.equal(hayAlgoQuePerder({ haHablado: true, escrito: '' }), true);
  assert.equal(hayAlgoQuePerder({ haHablado: false, escrito: 'Texto' }), true);
  estado.ocupacion = ocupacion();
  assert.equal(hayAlgoQuePerder({ haHablado: false, escrito: '' }), true);
  estado.ocupacion = null;
  estado.tareas.push(nuevaTarea('Conducir'));
  assert.equal(hayAlgoQuePerder({ haHablado: false, escrito: '' }), true);
});

test('edición significativa caduca la referencia; mayúsculas, tildes y signos conservan la comparación vigente', () => {
  const tarea = nuevaTarea('Diseñar nóminas', '8331-1');
  tarea.texto = 'DISEÑAR, NOMINAS';
  assert.equal(emparejamientoCaducado(tarea), false);
  tarea.texto = 'Conducir autobuses';
  assert.equal(emparejamientoCaducado(tarea), true);
  anularEmparejamiento(tarea);
  assert.equal(emparejamientoCaducado(tarea), false);
  assert.deepEqual([tarea.oficial, tarea.propuesta, tarea.emparejadaPara], [null, null, null]);
});

test('la propuesta y la tarea oficial se distinguen; el consumidor puede excluir la propia tarea al buscar duplicados', () => {
  const primera = nuevaTarea('Conducir');
  const segunda = nuevaTarea('Llevar el autobús');
  estado.tareas.push(primera, segunda);
  Object.assign(primera, { propuesta: '8331-1', oficial: '8331-1', emparejadaPara: primera.texto });
  Object.assign(segunda, { propuesta: null, oficial: null, emparejadaPara: null });
  assert.equal(quienCuenta('8331-1'), primera);
  assert.equal(quienCuenta('8331-1', primera), undefined);
  assert.equal(primera.emparejadaPara, primera.texto);
  assert.equal(segunda.oficial, null);
});

test('olvidar una estimación recibida retira firma y texto de petición', () => {
  const tarea = nuevaTarea('Conducir');
  const firmada = estimacion();
  tarea.texto = 'Otro texto';
  Object.assign(tarea, { estimacion: firmada, estimadaPara: 'Conducir', sinEstimacion: null });
  assert.equal(tarea.estimacion, firmada);
  assert.equal(tarea.estimadaPara, 'Conducir');
  assert.equal(tarea.sinEstimacion, null);
  olvidarEstimacion(tarea);
  assert.deepEqual([tarea.estimacion, tarea.estimadaPara, tarea.sinEstimacion], [null, null, null]);
});

test('solo el rechazo del texto impide repetirlo; los demás motivos dejan la tarea pendiente', () => {
  for (const motivo of Object.keys(MOTIVOS_DE_FALLO) as (keyof typeof MOTIVOS_DE_FALLO)[]) {
    const tarea = nuevaTarea('Conducir');
    Object.assign(tarea, { estimacion: estimacion(), estimadaPara: tarea.texto, sinEstimacion: null });
    anotarFallo(tarea, tarea.texto, motivo);
    assert.equal(tarea.estimacion, null);
    assert.equal(tarea.estimadaPara, motivo === 'contenido' ? tarea.texto : null);
    assert.deepEqual(tarea.sinEstimacion, { para: tarea.texto, motivo });
  }
});

test('los dos grupos conservan orden y datos oficiales; las proyecciones no mutan sus fichas', () => {
  const principal = ficha();
  const secundario = ficha('7512');
  const copia = structuredClone([principal, secundario]);
  estado.grupos = { principal, secundario };
  assert.deepEqual(
    oficialesDeLosGrupos().map(({ id }) => id),
    ['8331-1', '7512-1'],
  );
  const proyectada = oficialesDe(principal)[0];
  assert.ok(proyectada);
  proyectada.texto_en = 'Cambio en la copia';
  assert.deepEqual([principal, secundario], copia);
  assert.deepEqual(oficialesDe(null), []);
  assert.throws(ocupacionElegida);
  estado.ocupacion = ocupacion();
  assert.equal(ocupacionElegida(), estado.ocupacion);
});

test('anular el emparejamiento no altera los demás datos de tareas anteriores', () => {
  reiniciarEstado();
  const tarea = Object.assign(nuevaTarea('Conducir', '8331-1'), {
    yaContada: '8331-1',
    tiempo: 'algo' as const,
    estimacion: estimacion(),
    estimadaPara: 'Conducir',
  });
  const previa = { ...tarea };
  anularEmparejamiento(tarea);
  assert.deepEqual(tarea, { ...previa, oficial: null, propuesta: null, emparejadaPara: null });
  assert.equal(quienCuenta('8331-1'), undefined);
  estado.tareas.push(tarea);
  assert.equal(hayAlgoQuePerder({ haHablado: false, escrito: '' }), true);
  reiniciarEstado();
  assert.equal(estado.tareas.length, 0);
});
