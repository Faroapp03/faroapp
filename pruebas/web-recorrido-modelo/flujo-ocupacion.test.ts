import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avanzar,
  type EstadoOcupacion,
  type Evento,
  estadoInicial,
  FASES,
  MAX_PREGUNTAS,
  MOTIVOS_DE_FASE,
} from '../../web/scripts/recorrido/flujo-ocupacion.js';
import { clasificacion, congelar, pregunta } from './datos.ts';

function tras(estado: EstadoOcupacion, ...eventos: Evento[]) {
  return eventos.reduce((actual, evento) => avanzar(congelar(actual), congelar(evento)), estado);
}

function clasificarCon(respuesta = clasificacion(), estado = estadoInicial()) {
  return tras(estado, { tipo: 'responder', texto: 'chofer' }, { tipo: 'clasificado', clasificacion: respuesta });
}

test('confirmar y elegir conserva palabra, grupo y origen; doble clic no crea una segunda elección', () => {
  const confirmando = clasificarCon();
  assert.equal(confirmando.fase, FASES.CONFIRMANDO);
  assert.equal(confirmando.palabra, 'chofer');
  const elegida = tras(confirmando, { tipo: 'elegirOcupacion', esco: '8331.1' });
  assert.deepEqual(elegida.eleccion, { isco08: '8331', esco: '8331.1', isco08Secundario: null, origen: 'ia' });
  assert.equal(tras(elegida, { tipo: 'elegirOcupacion', esco: '8331.1' }), elegida);
});

test('pregunta abierta suma respuesta, conserva la primera palabra y fallo devuelve el estado previo entero', () => {
  const preguntado = clasificarCon(pregunta());
  const enviado = tras(preguntado, { tipo: 'responder', texto: 'nóminas' });
  assert.equal(enviado.texto, 'chofer\nnóminas');
  assert.equal(enviado.palabra, 'chofer');
  assert.deepEqual(tras(enviado, { tipo: 'fallo' }), preguntado);
  const vuelta = tras(enviado, { tipo: 'volver' });
  assert.equal(vuelta.fase, preguntado.fase);
  assert.equal(vuelta.texto, preguntado.texto);
  assert.equal(vuelta.motivo, MOTIVOS_DE_FASE.VOLVER);
});

test('el límite global de preguntas persiste al volver y fuerza exploración oficial', () => {
  let estado = estadoInicial();
  for (let hechas = 0; hechas < MAX_PREGUNTAS; hechas += 1) {
    estado = clasificarCon(pregunta(), estado);
    estado = tras(estado, { tipo: 'volver' });
  }
  assert.equal(estado.preguntasHechas, MAX_PREGUNTAS);
  const limite = clasificarCon(pregunta(), estado);
  assert.equal(limite.fase, FASES.EXPLORANDO);
  assert.equal(limite.motivo, MOTIVOS_DE_FASE.LIMITE);
  assert.equal(limite.padre, '');
});

test('exploración permite saltos oficiales de nivel, rechaza ramas ajenas y vuelve al padre anterior', () => {
  const inicio = clasificarCon(clasificacion('explorar'));
  const nivel = tras(inicio, { tipo: 'abrirGrupo', codigo: '83', titulo: 'Conductores' });
  assert.equal(nivel.padre, '83');
  assert.equal(tras(nivel, { tipo: 'abrirGrupo', codigo: '71', titulo: 'Otra rama' }), nivel);
  const confirmando = tras(nivel, { tipo: 'abrirGrupo', codigo: '8331', titulo: 'Autobuses' });
  assert.equal(confirmando.grupo?.ocupaciones, null);
  assert.equal(tras(confirmando, { tipo: 'volver' }).padre, '83');
  assert.equal(tras(confirmando, { tipo: 'soloGrupo' }).eleccion?.origen, 'jerarquia');
});

test('explorar y contar con palabras conserva el historial', () => {
  const confirmando = clasificarCon();
  const explorando = tras(confirmando, { tipo: 'explorar' });
  const relatando = tras(explorando, { tipo: 'contarConPalabras' });
  assert.equal(relatando.fase, FASES.RELATANDO);
  assert.equal(tras(relatando, { tipo: 'volver' }).fase, FASES.EXPLORANDO);
  assert.equal(tras(explorando, { tipo: 'volver' }).fase, FASES.CONFIRMANDO);
});
