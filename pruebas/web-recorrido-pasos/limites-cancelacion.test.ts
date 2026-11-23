import '../web-recorrido-transporte/ayudas.ts';
import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { MAX_TAREAS_INFORME } from '../../web/scripts/protocolo-web.js';
import { errorDeCancelacion } from '../../web/scripts/recorrido/api/errores.js';
import { estado, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { tareasDeLoQueEscribe } from '../../web/scripts/recorrido/tareas-libres.js';
import { resolver } from '../../web/scripts/textos.js';
import { prepararDom } from './dom.ts';
import { enviar, observadas, reiniciarInterfaz } from './interfaz-doble.ts';
import { prepararPasos } from './motor-local-doble.ts';

const { soltarEspera } = await import('../../web/scripts/recorrido/pagina.js');
const { empezarConversacion, volverEnOcupacion } = await import('../../web/scripts/recorrido/paso-ocupacion.js');
await cargarDiccionario('es');

const pregunta = (texto: string) => ({
  lectura: { sinComprension: false },
  paso: {
    tipo: 'pregunta',
    pregunta: {
      id: texto,
      tipo: 'tarea',
      texto,
      opciones: [
        { id: 'si', texto: 'Sí' },
        { id: 'no', texto: 'No' },
      ],
    },
    numero: 1,
    maximo: 14,
  },
});
const anterior = pregunta('¿Conduces un autobús?');
const actual = pregunta('¿Atiendes la recepción?');
beforeEach(() => {
  prepararDom();
  soltarEspera();
  reiniciarEstado();
  reiniciarInterfaz();
});

function marcadas(cuantas: number) {
  const tareas = Array.from({ length: cuantas }, (_, i) => {
    const tarea = nuevaTarea(`Oficial ${i}`, `8331-${i}`);
    tarea.marcada = true;
    tarea.tiempo = 'algo';
    return tarea;
  });
  estado.tareas.push(...tareas);
  return tareas;
}

test('añadir un literal hasta el máximo conserva las marcadas con su identidad y tiempo', async () => {
  const anteriores = marcadas(MAX_TAREAS_INFORME - 1);
  const resultado = await tareasDeLoQueEscribe('Preparo pedidos', MAX_TAREAS_INFORME - estado.tareas.length);
  estado.tareas.push(...resultado.tareas);
  assert.equal(estado.tareas.length, MAX_TAREAS_INFORME);
  assert.deepEqual(estado.tareas.slice(0, -1), anteriores);
  assert.equal(estado.tareas.at(-1)?.texto, 'Preparo pedidos');
  assert.equal(estado.tareas.at(-1)?.oficial, null);
  assert.equal(estado.tareas.at(-1)?.estimacion, null);
});

test('respuesta local retirada que falla tarde no deshace la conversación nueva', async () => {
  const antigua = Promise.withResolvers<typeof anterior>();
  const nueva = Promise.withResolvers<typeof actual>();
  prepararPasos(antigua.promise, nueva.promise);
  empezarConversacion();
  const primera = enviar('chofer');
  soltarEspera();
  volverEnOcupacion();
  const segunda = enviar('recepcionista');
  antigua.reject(errorDeCancelacion());
  await primera;
  nueva.resolve(actual);
  await segunda;
  assert.ok(observadas.mensajes.map(resolver).includes(actual.paso.pregunta.texto));
});

test('el cupo cero conserva todas las marcadas sin consumir identidad ni admitir texto', async () => {
  const anteriores = marcadas(MAX_TAREAS_INFORME);
  const id = estado.siguienteId;
  const resultado = await tareasDeLoQueEscribe('DESCARTADA', MAX_TAREAS_INFORME - estado.tareas.length);
  assert.deepEqual(resultado, { tareas: [], avisos: [] });
  assert.deepEqual(estado.tareas, anteriores);
  assert.equal(estado.siguienteId, id);
  assert.equal(new Set(estado.tareas.map(({ id }) => id)).size, MAX_TAREAS_INFORME);
});

test('un hueco admite un literal completo sin descomponerlo ni atribuir una referencia', async () => {
  const anteriores = marcadas(MAX_TAREAS_INFORME - 1);
  const resultado = await tareasDeLoQueEscribe('Cobro y ordeno los pedidos', 1);
  assert.equal(resultado.tareas.length, 1);
  assert.equal(resultado.tareas[0]?.texto, 'Cobro y ordeno los pedidos');
  assert.equal(resultado.tareas[0]?.oficial, null);
  assert.equal(resultado.tareas[0]?.estimacion, null);
  assert.deepEqual(estado.tareas, anteriores);
});

test('éxito tardío de la conversación retirada no sustituye la pregunta local vigente', async () => {
  const antigua = Promise.withResolvers<typeof anterior>();
  const nueva = Promise.withResolvers<typeof actual>();
  prepararPasos(antigua.promise, nueva.promise);
  empezarConversacion();
  const primera = enviar('chofer');
  soltarEspera();
  empezarConversacion({ borrado: true });
  const segunda = enviar('recepcionista');
  antigua.resolve(anterior);
  await primera;
  nueva.resolve(actual);
  await segunda;
  const mensajes = observadas.mensajes.map(resolver);
  assert.ok(mensajes.includes(actual.paso.pregunta.texto));
  assert.ok(!mensajes.includes(anterior.paso.pregunta.texto));
});
