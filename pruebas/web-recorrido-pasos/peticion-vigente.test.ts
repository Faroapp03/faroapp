// Una petición al motor que se ha soltado (la persona vuelve atrás o borra) o que ya tiene otra detrás no toca lo de la
// nueva: ni la lectura ni el pensamiento que cuentan sus preguntas y propuestas, ni su espera. El orden de las
// respuestas lo decide la prueba: la vieja responde, o falla, cuando la nueva ya ha empezado y aún no ha terminado.
import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { esCancelacion } from '../../web/scripts/recorrido/api/errores.js';
import { reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma, resolver, traducible } from '../../web/scripts/textos.js';
import { prepararDom } from './dom.ts';
import { observadas, reiniciarInterfaz } from './interfaz-doble.ts';
import { MotorNoListo, prepararPasos } from './motor-local-doble.ts';

const { soltarEspera } = await import('../../web/scripts/recorrido/pagina.js');
const { pedirPasoLocal, preguntaEnElChat } = await import('../../web/scripts/recorrido/ocupacion-local.js');
await cargarDiccionario('es');

const soltarPromesas = () => new Promise<void>((resolve) => setImmediate(resolve));
const CORREGIR = resolver(traducible('recorrido.pensamiento.paso.corregir'));
const OPCIONES = [
  { id: 'si', texto: 'Sí' },
  { id: 'no', texto: 'No' },
];
const PREGUNTA = { id: 'tarea:5131-1', tipo: 'tarea', texto: '¿Sirves comidas?', opciones: OPCIONES };
const respuesta = (lectura: Record<string, unknown>) => ({
  lectura,
  paso: { tipo: 'pregunta', pregunta: PREGUNTA, numero: 1, maximo: 14 },
});
const VIEJA = respuesta({ correcciones: [{ de: 'camarro', a: 'camarero' }] });
const NUEVA = respuesta({ conVectores: true });

/** Una respuesta del motor que la prueba entrega (o hace fallar) cuando quiere. */
function aMano() {
  let entregar: (valor: unknown) => void = () => {};
  let fallar: (error: unknown) => void = () => {};
  const promesa = new Promise((resolve, reject) => {
    entregar = resolve;
    fallar = reject;
  });
  return { promesa, entregar, fallar };
}

/** Los pasos y el pensamiento empezado que contaría ahora la pregunta del motor. */
function loQueCuentaLaPregunta() {
  const antes = observadas.pensamientos.length;
  preguntaEnElChat(PREGUNTA, 'es');
  const pasos = observadas.pensamientos.slice(antes)[0]?.map((paso) => resolver(paso)) ?? null;
  return { pasos, seguido: pasos ? observadas.pensamientosSeguidos.at(-1) : undefined };
}

beforeEach(() => {
  prepararDom();
  soltarEspera();
  reiniciarEstado();
  reiniciarInterfaz();
  fijarIdioma('es');
});

test('la petición vieja que responde tarde no cambia la lectura ni el pensamiento de la nueva', async () => {
  const vieja = aMano();
  const nueva = aMano();
  prepararPasos(vieja.promesa, nueva.promesa);
  const pedidaVieja = pedirPasoLocal({ texto: 'camarro' });
  soltarEspera();
  const pedidaNueva = pedirPasoLocal({ texto: 'camarero' });
  const [, empezadoNuevo] = observadas.nodosEmpezados;
  vieja.entregar(VIEJA);
  await pedidaVieja;
  await soltarPromesas();
  assert.deepEqual(loQueCuentaLaPregunta(), { pasos: null, seguido: undefined }, 'la nueva aún no ha respondido');
  nueva.entregar(NUEVA);
  await pedidaNueva;
  const { pasos, seguido } = loQueCuentaLaPregunta();
  assert.ok(pasos && !pasos.includes(CORREGIR), 'cuenta la lectura de la nueva, no la de la vieja');
  assert.equal(seguido, empezadoNuevo, 'sigue el pensamiento que empezó con la nueva');
});

test('la petición vieja que falla mientras se prepara el motor no avisa ni retira la espera de la nueva', async () => {
  // La vieja se queda en su pausa, que no termina sola, hasta que la conversación se cancela al final, como cuando la
  // persona sale del paso (cancelarPeticiones): entonces deja de reintentar y falla como una cancelación.
  const salida = new AbortController();
  const vieja = aMano();
  const nueva = aMano();
  prepararPasos(vieja.promesa, nueva.promesa);
  const avisos: string[] = [];
  const pedidaVieja = pedirPasoLocal(
    { texto: 'camarro' },
    {
      alPreparar: () => avisos.push('vieja'),
      esperar: (_ms, senal) =>
        new Promise<void>((listo) => senal.addEventListener('abort', () => listo(), { once: true })),
      senal: salida.signal,
    },
  );
  soltarEspera();
  const pedidaNueva = pedirPasoLocal({ texto: 'camarero' }, { alPreparar: () => avisos.push('nueva') });
  const [, empezadoNuevo] = observadas.nodosEmpezados;
  vieja.fallar(new MotorNoListo('preparando'));
  await soltarPromesas();
  assert.deepEqual(avisos, [], 'la vieja no dice la nota de la preparación, que retiraría la espera de la nueva');
  assert.deepEqual(loQueCuentaLaPregunta(), { pasos: null, seguido: undefined });
  nueva.entregar(NUEVA);
  await pedidaNueva;
  assert.equal(loQueCuentaLaPregunta().seguido, empezadoNuevo);
  salida.abort();
  await assert.rejects(pedidaVieja, (error: unknown) => esCancelacion(error));
  assert.deepEqual(avisos, [], 'ni siquiera al cancelarse');
});

test('una petición nueva olvida la lectura de la anterior: si falla, sus preguntas no cuentan un pensamiento viejo', async () => {
  prepararPasos(VIEJA, new Error('el motor falla'));
  await pedirPasoLocal({ texto: 'camarro' });
  await assert.rejects(pedirPasoLocal({ texto: 'camarero' }));
  assert.deepEqual(loQueCuentaLaPregunta(), { pasos: null, seguido: undefined });
});
