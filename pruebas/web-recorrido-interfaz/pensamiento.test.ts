/** Pensamiento real de la conversación: reloj falso y DOM de interacción, sin sustituir sus pasos. */
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { navegador } from '../web-controles/ayudas.js';
import { base, documento, entorno, Nodo } from './dom.ts';

/** Lo que tarda el motor doble rápido y el lento, y lo que puede tardar como mucho la respuesta tras el rápido. */
const MOTOR_RAPIDO_MS = 300;
const MOTOR_LENTO_MS = 8000;
const PASO_DOS_MS = 1075;
const PASO_CINCO_MS = 870;
const PLIEGUE_MS = 650;
const DOS_PASOS_TOTAL_MS = 2800;
const DIFERENCIA_PASO_MS = 275;
const RESTO_SEGUNDO_PASO_MS = 150;
/** La línea del paso en curso se llena una sola vez en este tiempo mientras se espera al motor. */
const RELLENO_MS = 4350;
const MAX_PASOS = 5;
const MEDIDA = 'faro:pagina:pensamiento';
let instancia = 0;
class NodoPensamiento extends Nodo {
  animaciones: unknown[] = [];
  medidas = 0;
  get lastElementChild() {
    return this.children.at(-1) ?? null;
  }
  get isConnected(): boolean {
    let actual: Nodo['parentElement'] = this;
    while (actual) {
      if (actual === documento.body) {
        return true;
      }
      actual = actual.parentElement;
    }
    return false;
  }
  getBoundingClientRect() {
    this.medidas += 1;
    return { top: 0 };
  }
  animate(fotogramas: unknown, opciones: unknown) {
    this.animaciones.push({ fotogramas, opciones });
  }
}
type Conversacion = typeof import('../../web/scripts/recorrido/conversacion.js');
async function preparar(t: TestContext, reducido = false) {
  entorno(t);
  base();
  t.mock.method(documento, 'createElement', (tag: string) => new NodoPensamiento(tag));
  navegador(t, { matchMedia: () => ({ matches: reducido }) });
  await cargarDiccionario('es');
  const url = new URL('../../web/scripts/recorrido/conversacion.js', import.meta.url);
  url.searchParams.set('pensamiento', String(++instancia));
  const c = (await import(url.href)) as Conversacion;
  const estados: boolean[] = [];
  const alPensar = () => estados.push(c.faroEstaPensando());
  documento.addEventListener(c.EVENTO_PENSANDO, alPensar);
  t.after(() => documento.removeEventListener(c.EVENTO_PENSANDO, alPensar));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // El reloj de las medidas (performance.now) avanza con el reloj falso.
  let ahora = 0;
  t.mock.method(performance, 'now', () => ahora);
  const medidas: { nombre: string; duracion: number; detalle: unknown }[] = [];
  t.mock.method(performance, 'measure', (nombre: string, o: { start: number; end: number; detail?: unknown }) => {
    medidas.push({ nombre, duracion: o.end - o.start, detalle: o.detail });
  });
  const avanzar = (ms: number) => {
    ahora += ms;
    t.mock.timers.tick(ms);
  };
  return { c, estados, medidas, avanzar, reloj: () => ahora };
}
/** El detalle de una medida llega de otro ámbito (el del guion): se compara por su contenido. */
function llano(valor: unknown) {
  return JSON.parse(JSON.stringify(valor));
}
function lista(bloque: HTMLElement) {
  return Array.from(bloque.querySelectorAll('li')) as HTMLElement[];
}
function estadosDe(bloque: HTMLElement) {
  return lista(bloque).map((paso) => paso.dataset.estado);
}
function progresos(bloque: HTMLElement) {
  return Array.from(bloque.querySelectorAll('.rc-pensamiento-progreso')) as unknown as NodoPensamiento[];
}
/** Como el recorrido: la espera de la petición, el pensamiento que empieza con ella y el motor que tarda `ms`. */
function pedirAlMotor(c: Conversacion, avanzar: (ms: number) => void, ms: number) {
  c.mostrarEspera('Estoy pensando');
  const empezado = c.empezarAPensar('Analizo');
  avanzar(ms);
  return empezado;
}
/** Como el recorrido al llegar la respuesta: enEspera quita la espera y Faro dice su pensamiento y la respuesta. */
function responder(
  c: Conversacion,
  textos: string[],
  opciones: Parameters<Conversacion['crearPensamientoEnCurso']>[1],
) {
  c.quitarEspera();
  const bloque = c.crearPensamientoEnCurso(textos, opciones);
  c.decirFaro([bloque, 'Respuesta']);
  return bloque;
}
test('dos pasos aparecen uno a uno y la respuesta espera al pliegue de la demo', async (t) => {
  const { c, estados, medidas, avanzar, reloj } = await preparar(t);
  const empezado = pedirAlMotor(c, avanzar, MOTOR_RAPIDO_MS);
  let respuestaEn = -1;
  const bloque = responder(c, ['Analizo', 'Comparo'], {
    empezado,
    alAparecer: () => {
      respuestaEn = reloj();
    },
  });
  assert.equal(bloque, empezado);
  assert.deepEqual(estadosDe(bloque), ['en-curso']);
  avanzar(PASO_DOS_MS - 1);
  assert.deepEqual(estadosDe(bloque), ['en-curso']);
  assert.equal(respuestaEn, -1);
  avanzar(1);
  assert.deepEqual(estadosDe(bloque), ['hecho', 'en-curso']);
  avanzar(PASO_DOS_MS);
  assert.deepEqual(estadosDe(bloque), ['hecho', 'hecho']);
  assert.equal(bloque.dataset.estado, 'recogiendo');
  assert.equal(bloque.hasAttribute('data-plegado'), true);
  assert.equal(respuestaEn, -1, 'la respuesta espera a que termine el pliegue');
  avanzar(PLIEGUE_MS - 1);
  assert.equal(respuestaEn, -1);
  avanzar(1);
  assert.equal(respuestaEn, MOTOR_RAPIDO_MS + DOS_PASOS_TOTAL_MS);
  assert.equal(bloque.dataset.estado, 'hecho');
  assert.deepEqual(estados, [true, false]);
  assert.deepEqual(llano(medidas), [
    { nombre: MEDIDA, duracion: MOTOR_RAPIDO_MS + DOS_PASOS_TOTAL_MS, detalle: { pasos: 2 } },
  ]);
  bloque.querySelector('button')?.dispatchEvent(new Event('click'));
  assert.equal(bloque.querySelector('button')?.getAttribute('aria-expanded'), 'true');
});

test('cinco pasos respetan el tope de cinco segundos y se animan una vez', async (t) => {
  const { c, avanzar } = await preparar(t);
  let respuestas = 0;
  const bloque = responder(c, ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'], {
    alAparecer: () => {
      respuestas += 1;
    },
  });
  for (let indice = 1; indice <= MAX_PASOS; indice += 1) {
    assert.equal(lista(bloque).length, indice);
    avanzar(PASO_CINCO_MS);
  }
  assert.equal(bloque.dataset.estado, 'recogiendo');
  assert.equal(respuestas, 0);
  avanzar(PLIEGUE_MS);
  assert.equal(respuestas, 1);
  assert.equal(bloque.textContent?.includes('Seis'), false);
  assert(progresos(bloque).every((nodo) => nodo.animaciones.length === 1));
});

test('movimiento reducido mantiene el orden sin animaciones ni espera de pliegue', async (t) => {
  const { c, avanzar } = await preparar(t, true);
  let respuestas = 0;
  const bloque = responder(c, ['Uno', 'Dos'], {
    alAparecer: () => {
      respuestas += 1;
    },
  });
  avanzar(PASO_DOS_MS);
  assert.deepEqual(estadosDe(bloque), ['hecho', 'en-curso']);
  avanzar(PASO_DOS_MS);
  avanzar(0);
  assert.equal(respuestas, 1);
  assert(progresos(bloque).every((nodo) => nodo.animaciones.length === 0));
});

test('dos pensamientos simultáneos mantienen el bloqueo hasta el último', async (t) => {
  const { c, avanzar } = await preparar(t);
  responder(c, ['Uno'], {});
  responder(c, ['Uno', 'Dos'], {});
  avanzar(PASO_DOS_MS);
  avanzar(DIFERENCIA_PASO_MS);
  avanzar(PLIEGUE_MS);
  assert.equal(c.faroEstaPensando(), true);
  avanzar(RESTO_SEGUNDO_PASO_MS);
  avanzar(PLIEGUE_MS);
  assert.equal(c.faroEstaPensando(), false);
});

test('borrar cancela los relojes y las respuestas anteriores', async (t) => {
  const { c, avanzar } = await preparar(t);
  let respuestas = 0;
  const bloque = responder(c, ['Uno', 'Dos'], {
    alAparecer: () => {
      respuestas += 1;
    },
  });
  avanzar(PASO_DOS_MS);
  c.vaciarConversacion();
  t.mock.timers.runAll();
  assert.equal(c.faroEstaPensando(), false);
  assert.equal(respuestas, 0);
  assert.deepEqual(estadosDe(bloque), ['hecho', 'en-curso']);
});

test('un fallo del trabajo retira el pensamiento sin registrar medida', async (t) => {
  const { c, estados, medidas, avanzar } = await preparar(t);
  const empezado = pedirAlMotor(c, avanzar, MOTOR_RAPIDO_MS);
  c.quitarEspera();
  c.decirFaro('No he podido', { tipo: 'error' });
  avanzar(RELLENO_MS + MOTOR_LENTO_MS);
  assert.equal(empezado.isConnected, false);
  assert.equal(c.faroEstaPensando(), false);
  assert.deepEqual(estados, []);
  assert.deepEqual(medidas, []);
});

test('con un motor lento no se repite el primer paso y al responder continúa la secuencia', async (t) => {
  const { c, avanzar, medidas } = await preparar(t);
  const empezado = pedirAlMotor(c, avanzar, 0);
  const [linea] = progresos(empezado);
  avanzar(MOTOR_LENTO_MS);
  assert.deepEqual(estadosDe(empezado), ['en-curso']);
  assert.equal(linea?.animaciones.length, 1);
  const bloque = responder(c, ['Analizo', 'Comparo'], { empezado });
  avanzar(PASO_DOS_MS);
  avanzar(PASO_DOS_MS);
  avanzar(PLIEGUE_MS);
  assert.equal(bloque.dataset.estado, 'hecho');
  assert.equal(medidas[0]?.duracion, MOTOR_LENTO_MS + DOS_PASOS_TOTAL_MS);
});

test('un pensamiento empezado no se comparte entre dos respuestas', async (t) => {
  const { c, avanzar } = await preparar(t);
  const empezado = pedirAlMotor(c, avanzar, MOTOR_RAPIDO_MS);
  const primero = responder(c, ['Analizo'], { empezado });
  const segundo = responder(c, ['Analizo'], { empezado });
  assert.notEqual(primero, segundo);
  c.vaciarConversacion();
});
