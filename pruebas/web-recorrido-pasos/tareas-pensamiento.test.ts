// El pensamiento de las tareas empieza a la vez que la carga de los grupos de la ocupación elegida, dentro de su espera,
// y las tareas salen en cuanto llegan, con el mismo pensamiento: sin reloj que las retrase, sin reinicio ni bucle si la
// carga tarda, y con los mismos mensajes en el mismo orden. La conducta del pensamiento real (su línea, su pliegue y la
// medida faro:pagina:pensamiento) está en pruebas/web-recorrido-interfaz/pensamiento.test.ts.
import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, type TestContext, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { estado, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma, type Parte, resolver, traducible } from '../../web/scripts/textos.js';
import { ficha, ocupacion } from '../web-recorrido-modelo/datos.ts';
import { configurarApi } from './api-doble.ts';
import { prepararDom } from './dom.ts';
import { enviar, observadas, reiniciarInterfaz } from './interfaz-doble.ts';
import { prepararPasos } from './motor-local-doble.ts';

const { soltarEspera } = await import('../../web/scripts/recorrido/pagina.js');
const { empezarConversacion } = await import('../../web/scripts/recorrido/paso-ocupacion.js');
const { empezarConLasTareas, mostrarPasoTareas } = await import('../../web/scripts/recorrido/paso-tareas.js');
await cargarDiccionario('es');

/** Lo que tarda la carga doble rápida y la lenta, y lo que puede tardar como mucho la respuesta tras la rápida. */
const MOTOR_RAPIDO_MS = 300;
const MOTOR_LENTO_MS = 8000;
const RESPUESTA_MAXIMA_MS = 1500;
/** El reloj falso avanza de 10 en 10 ms; cada paso deja correr las promesas pendientes. */
const PASO_MS = 10;
const VUELTAS_DE_PROMESAS = 5;
/** Tope de la prueba: la ficha de la ocupación y la carga de los grupos (dos esperas de `ms`) y un margen amplio. */
const ESPERAS_COMO_MUCHO = 3;
const MARGEN_MS = 2000;
const UN_SEGUNDO_MS = 1000;
const BUSCAR_LAS_TAREAS = resolver(traducible('recorrido.pensamiento.paso.tareas-buscar'));
const LECTURA = { sinComprension: false };
const DECIDIDA = { lectura: LECTURA, paso: { tipo: 'decidida', grupo: '5131', esco: '5131.1', soloGrupo: false } };
const SIN_RETIRADAS = { retiradas: { cuantas: 0, de: '' } };

const soltarPromesas = () => new Promise<void>((resolve) => setImmediate(resolve));
const esDeLasTareas = (pasos: Parte[]) => resolver(pasos[0]) === BUSCAR_LAS_TAREAS;
const empezadosDeLasTareas = () =>
  observadas.pensamientosEmpezados.filter((paso) => resolver(paso) === BUSCAR_LAS_TAREAS).length;
const indiceDeLasTareas = () => observadas.pensamientos.findIndex(esDeLasTareas);

beforeEach(() => {
  prepararDom();
  soltarEspera();
  reiniciarEstado();
  reiniciarInterfaz();
  fijarIdioma('es');
});

/**
 * Como el recorrido: el motor decide la ocupación y cada ficha de grupo tarda `ms`. Devuelve cuándo empieza la última
 * petición de ficha (la carga de los grupos), cuándo empieza el pensamiento de las tareas y cuándo salen las tareas.
 * `cadaSegundo` mira el pensamiento mientras se espera.
 */
async function elegirConCarga(t: TestContext, ms: number, cadaSegundo: (ahora: number) => void = () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ahora = 0;
  const peticiones: number[] = [];
  configurarApi({
    fichaDeGrupo: (isco08) =>
      new Promise((resolve) => {
        peticiones.push(ahora);
        setTimeout(() => resolve(ficha(isco08)), ms);
      }),
  });
  prepararPasos(DECIDIDA);
  empezarConversacion();
  void enviar('camarero');
  let empiezaEn = -1;
  let respuestaEn = -1;
  for (let vueltas = 0; respuestaEn < 0 && vueltas < (ESPERAS_COMO_MUCHO * ms + MARGEN_MS) / PASO_MS; vueltas += 1) {
    for (let i = 0; i < VUELTAS_DE_PROMESAS; i += 1) {
      await soltarPromesas();
    }
    if (empiezaEn < 0 && empezadosDeLasTareas() > 0) {
      empiezaEn = ahora;
    }
    if (indiceDeLasTareas() >= 0) {
      respuestaEn = ahora;
      break;
    }
    if (empiezaEn >= 0 && ahora > empiezaEn && (ahora - empiezaEn) % UN_SEGUNDO_MS === 0) {
      cadaSegundo(ahora);
    }
    ahora += PASO_MS;
    t.mock.timers.tick(PASO_MS);
  }
  return { peticiones, empiezaEn, respuestaEn };
}

/** El nodo del pensamiento de las tareas que Faro ha dicho, y el que recibió como empezado. */
function pensamientoDicho() {
  const indice = indiceDeLasTareas();
  const seguido = observadas.pensamientosSeguidos[indice];
  const dicho = observadas.nodos.filter((nodo) => nodo.className === 'rc-pensamiento').at(-1);
  return { seguido, dicho };
}

test('con una carga de 0,3 s, el pensamiento empieza con ella y las tareas salen en menos de 1,5 s', async (t) => {
  const { peticiones, empiezaEn, respuestaEn } = await elegirConCarga(t, MOTOR_RAPIDO_MS);
  assert.ok(empiezaEn >= 0, 'el pensamiento de las tareas empieza');
  assert.equal(empiezaEn, peticiones.at(-1), 'empieza en el mismo turno que la carga de los grupos');
  assert.equal(empezadosDeLasTareas(), 1);
  assert.ok(respuestaEn - empiezaEn >= MOTOR_RAPIDO_MS, 'las tareas esperan a su carga');
  assert.ok(respuestaEn - empiezaEn < RESPUESTA_MAXIMA_MS, `las tareas salen a los ${respuestaEn - empiezaEn} ms`);
  const { seguido, dicho } = pensamientoDicho();
  assert.ok(seguido, 'el pensamiento de las tareas sigue el que empezó con la carga');
  assert.equal(dicho, seguido, 'Faro dice el mismo pensamiento');
  assert.equal(estado.ocupacion?.isco08, '5131');
});

test('con una carga de 8 s, el pensamiento se queda pensando, sin reinicio ni bucle, hasta que llegan las tareas', async (t) => {
  const vistos: number[] = [];
  const { empiezaEn, respuestaEn } = await elegirConCarga(t, MOTOR_LENTO_MS, (ahora) => {
    vistos.push(ahora);
    assert.equal(empezadosDeLasTareas(), 1, `a los ${ahora} ms sigue un solo pensamiento empezado`);
    assert.equal(indiceDeLasTareas(), -1, `a los ${ahora} ms aún no han salido las tareas`);
  });
  const segundos = Array.from(
    { length: MOTOR_LENTO_MS / UN_SEGUNDO_MS - 1 },
    (_, i) => empiezaEn + (i + 1) * UN_SEGUNDO_MS,
  );
  assert.deepEqual(vistos, segundos, 'se ha mirado cada segundo de la espera');
  assert.equal(respuestaEn - empiezaEn, MOTOR_LENTO_MS, 'las tareas salen en cuanto llegan');
  const { seguido, dicho } = pensamientoDicho();
  assert.ok(seguido, 'el pensamiento de las tareas sigue el que empezó con la carga');
  assert.equal(dicho, seguido, 'Faro dice el mismo pensamiento');
  assert.equal(empezadosDeLasTareas(), 1);
});

test('con el pensamiento empezado, las tareas dicen los mismos mensajes, en el mismo orden, que sin él', () => {
  estado.ocupacion = ocupacion();
  estado.grupos.principal = ficha();
  mostrarPasoTareas(SIN_RETIRADAS);
  const sinEmpezar = {
    mensajes: observadas.mensajes.map((parte) => resolver(parte)),
    pensamientos: observadas.pensamientos.map((pasos) => pasos.map((paso) => resolver(paso))),
    nodos: observadas.nodos.map((nodo) => nodo.className),
  };
  reiniciarInterfaz();
  prepararDom();
  const empezado = empezarConLasTareas();
  mostrarPasoTareas(SIN_RETIRADAS, { empezado });
  assert.deepEqual(
    {
      mensajes: observadas.mensajes.map((parte) => resolver(parte)),
      pensamientos: observadas.pensamientos.map((pasos) => pasos.map((paso) => resolver(paso))),
      nodos: observadas.nodos.map((nodo) => nodo.className),
    },
    sinEmpezar,
  );
  assert.equal(sinEmpezar.pensamientos[0]?.[0], BUSCAR_LAS_TAREAS);
  assert.deepEqual(observadas.pensamientosSeguidos, [empezado]);
  assert.equal(observadas.nodos[0], empezado, 'el pensamiento dicho es el empezado');
});
