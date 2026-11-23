import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { estado, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma, resolver } from '../../web/scripts/textos.js';
import { clasificacion, ficha, ocupacion } from '../web-recorrido-modelo/datos.ts';
import { buscar, Nodo, pagina, prepararDom } from './dom.ts';

const { tareasListas } = await import('../../web/scripts/recorrido/revision.js');
const { pintarTareas } = await import('../../web/scripts/recorrido/paso-tareas.js');
const { mensajeDeFase } = await import('../../web/scripts/recorrido/mensajes-ocupacion.js');
const { avanzar, estadoInicial } = await import('../../web/scripts/recorrido/flujo-ocupacion.js');
await cargarDiccionario('es');
await cargarDiccionario('ca');

beforeEach(() => {
  prepararDom();
  const mensaje = new Nodo('textarea');
  mensaje.id = 'mensaje';
  pagina.body.append(mensaje);
  reiniciarEstado();
  estado.ocupacion = ocupacion();
  estado.grupos.principal = ficha();
  fijarIdioma('es');
});

test('revisión para en la primera tarea corta y marca el campo con error, conservando el texto literal', () => {
  const tarea = nuevaTarea('x');
  tarea.tiempo = 'mucho';
  estado.tareas.push(tarea);
  pintarTareas();
  assert.equal(tareasListas(), false);
  assert.equal(buscar('tarea-1').getAttribute('aria-invalid'), 'true');
  assert.equal(tarea.texto, 'x');
});

test('revisión invalida el enlace editado incluso sin change y repinta el selector antes de pedir informe', () => {
  const tarea = nuevaTarea('Conducir', '8331-1');
  tarea.texto = 'Cobrar billetes';
  tarea.tiempo = 'algo';
  estado.tareas.push(tarea);
  pintarTareas();
  assert.equal(tareasListas(), false);
  assert.equal(tarea.oficial, null);
  assert.equal(buscar('oficial-1').getAttribute('aria-invalid'), 'true');
});

test('revisión requiere tiempo de todas las tareas y conserva su orden cuando ya están listas', () => {
  assert.equal(tareasListas(), false);
  const tarea = nuevaTarea('Conducir');
  estado.tareas.push(tarea);
  pintarTareas();
  assert.equal(tareasListas(), false);
  assert.equal(pagina.activeElement?.type, 'radio');
  tarea.tiempo = 'poco';
  const antes = structuredClone(estado.tareas);
  assert.equal(tareasListas(), true);
  assert.deepEqual(estado.tareas, antes);
});

test('los mensajes conservan la pregunta en su idioma; los títulos oficiales cambian solo al resolver', () => {
  const respuesta = {
    ...clasificacion(),
    decision: 'preguntar',
    pregunta: { texto: 'Què fas?', idioma: 'ca' as const, opciones: null },
  };
  const enviado = avanzar(estadoInicial(), { tipo: 'responder', texto: 'chofer' });
  const preguntado = avanzar(enviado, { tipo: 'clasificado', clasificacion: respuesta });
  const mensaje = mensajeDeFase(preguntado);
  assert.deepEqual(mensaje, [{ literal: 'Què fas?', idioma: 'ca' }]);
  fijarIdioma('ca');
  assert.deepEqual(mensajeDeFase(preguntado), mensaje);
  assert.equal(mensaje.map(resolver).join(''), 'Què fas?');
});
