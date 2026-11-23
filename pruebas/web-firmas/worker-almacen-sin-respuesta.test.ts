// El Worker real del motor (web/scripts/motor-local/worker.js) cuando el almacenamiento no contesta, no deja abrir la
// base o falla al leer o guardar la clave de firma, con tiempo virtual. La sonda del service worker responde, las
// fuentes no llevan raíz de firmas y el motor compilado es un doble que apunta con qué clave se crea
// (motor-del-worker-doble.ts). Sin respuesta del almacenamiento en 15 s, la página recibe `sinClave` y no se crea
// ningún motor, tampoco con una clave temporal; cuando el almacenamiento contesta, el motor se crea con la clave
// guardada y lo que firma se verifica con ella.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { type TestContext, test } from 'node:test';
import { crearFirmador } from '../../src/seguridad/firma.ts';
import { AlmacenDePrueba, usarAlmacen } from './almacen-de-prueba.ts';
import { claves, DATOS_FIRMADOS } from './motor-del-worker-doble.ts';

type PeticionAlMotor = import('../../web/scripts/motor-local/worker.js').PeticionAlMotor;

const MOTOR = new URL('../../web/motor/src/plataforma/navegador/motor.js', import.meta.url).href;
const DOBLE = new URL('./motor-del-worker-doble.ts', import.meta.url).href;
/** El Worker real; con una consulta en la dirección, se carga otra instancia, como un Worker nuevo. */
const WORKER = new URL('../../web/scripts/motor-local/worker.js', import.meta.url).href;
const SONDA = new URL('../../web/motor/copia-comprobada.json', import.meta.url).href;
/** Lo que espera secreto-firma.js a que el almacenamiento conteste (ESPERA_DEL_ALMACEN_MS). */
const ESPERA_DEL_ALMACEN_MS = 15_000;
const CASI = 1;
const CORRECTO = 200;
const NO_ENCONTRADO = 404;
/** Los identificadores de las peticiones de la prueba de continuidad: antes, durante y después del bloqueo. */
const ANTES = 10;
const PRIMERA_BLOQUEADA = 11;
/** Las peticiones seguidas que esperan la clave sin respuesta. */
const REINTENTOS_SEGUIDOS = 3;
const RECUPERADA = PRIMERA_BLOQUEADA + REINTENTOS_SEGUIDOS;
const OTRO_WORKER = RECUPERADA + 1;
/** Las peticiones de la prueba del fallo tras abrir la base, y las de la base que no se abre. */
const FALLO_TRAS_ABRIR = 20;
const BASE_QUE_NO_SE_ABRE = 30;
/** Las vueltas que se dejan correr para que el Worker llegue a esperar la clave (sonda e import del motor). */
const VUELTAS = 20;

/** La consulta con que se carga otra instancia del Worker, como uno nuevo que crea la página. */
const REINICIO = '?reinicio=1';
registerHooks({
  resolve(spec, contexto, siguiente) {
    if (spec === MOTOR) {
      return { url: DOBLE, shortCircuit: true };
    }
    // El Worker nuevo carga también su propia instancia de secreto-firma.js, sin la operación en curso del anterior.
    if (spec === './secreto-firma.js' && contexto.parentURL?.endsWith(REINICIO)) {
      const resuelto = siguiente(spec, contexto);
      return { ...resuelto, url: `${resuelto.url}${REINICIO}` };
    }
    return siguiente(spec, contexto);
  },
});

let responder: ((evento: { data: PeticionAlMotor }) => Promise<void>) | undefined;
const enviados: unknown[] = [];

/** Pone los globales de un Worker (sus mensajes, fetch con la sonda) mientras dura la prueba. */
function comoUnWorker(t: TestContext) {
  const nombres = ['addEventListener', 'postMessage', 'fetch'];
  const anteriores = nombres.map((nombre) => Object.getOwnPropertyDescriptor(globalThis, nombre));
  const warn = console.warn;
  t.after(() => {
    console.warn = warn;
    for (const [indice, nombre] of nombres.entries()) {
      const descriptor = anteriores[indice];
      if (descriptor) {
        Object.defineProperty(globalThis, nombre, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, nombre);
      }
    }
  });
  Reflect.set(globalThis, 'addEventListener', (_tipo: string, oyente: NonNullable<typeof responder>) => {
    responder = oyente;
  });
  Reflect.set(globalThis, 'postMessage', (mensaje: unknown) => enviados.push(mensaje));
  Reflect.set(globalThis, 'fetch', async (direccion: unknown) =>
    String(direccion) === SONDA ? Response.json({ version: 'v1' }) : new Response(null, { status: NO_ENCONTRADO }),
  );
  console.warn = () => {};
}

function preguntar(id: number, paquete = 'https://faro.example/paquete/p1/') {
  assert.ok(responder);
  return responder({
    data: {
      id,
      paquete,
      completo: true,
      url: 'https://faro.example/api/salud',
      method: 'GET',
      headers: [],
      body: null,
    },
  });
}

/** Lo que el Worker ha contestado a la petición `id`. */
const respuestasA = (id: number) =>
  enviados.filter((mensaje) => typeof mensaje === 'object' && mensaje !== null && 'id' in mensaje && mensaje.id === id);

const vuelta = () => new Promise((listo) => setImmediate(listo));

/** Tiempo virtual con la cuenta de los temporizadores pendientes: puestos y aún sin vencer ni retirar. */
function relojQueCuenta(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const poner = globalThis.setTimeout;
  const quitar = globalThis.clearTimeout;
  const activos = new Set<unknown>();
  Object.assign(globalThis, {
    setTimeout: (funcion: () => void, ms?: number) => {
      const id = poner(() => {
        activos.delete(id);
        funcion();
      }, ms);
      activos.add(id);
      return id;
    },
    clearTimeout: (id: Parameters<typeof clearTimeout>[0]) => {
      activos.delete(id);
      quitar(id);
    },
  });
  t.after(() => Object.assign(globalThis, { setTimeout: poner, clearTimeout: quitar }));
  return () => activos.size;
}

/** Una petición que espera la clave sin respuesta del almacenamiento: deja correr el plazo y la espera. */
async function preguntarSinRespuesta(t: TestContext, id: number, paquete?: string) {
  const pregunta = preguntar(id, paquete);
  for (let i = 0; i < VUELTAS; i += 1) {
    await vuelta();
  }
  t.mock.timers.tick(ESPERA_DEL_ALMACEN_MS - CASI);
  await vuelta();
  assert.deepEqual(respuestasA(id), [], 'antes del plazo no contesta');
  t.mock.timers.tick(CASI);
  await pregunta;
  assert.deepEqual(respuestasA(id), [{ id, fallo: true, sinClave: true }]);
}

/** La firma que ha devuelto el motor a la petición `id`. */
function firmaDe(id: number): string {
  const [respuesta] = respuestasA(id) as { status: number; body: string }[];
  assert.equal(respuesta?.status, CORRECTO);
  return (JSON.parse(respuesta.body) as { firma: string }).firma;
}

/** Si `firma` se verifica con la clave con que se creó el último motor. */
async function laVerificaElUltimoMotor(firma: string) {
  const clave = claves.at(-1);
  assert.ok(clave instanceof CryptoKey, 'el motor se crea con la clave guardada');
  return (await crearFirmador(clave)).comprobar(DATOS_FIRMADOS, firma);
}

test('almacenamiento sin respuesta: a los 15 s el Worker lo dice y no crea ningún motor; al contestar, firma con la clave guardada', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  comoUnWorker(t);
  const almacen = new AlmacenDePrueba();
  almacen.modo = 'no-contesta';
  usarAlmacen(t, almacen);
  await import('../../web/scripts/motor-local/worker.js');

  await preguntarSinRespuesta(t, 1);
  assert.deepEqual(claves, [], 'no se crea ningún motor: tampoco con una clave temporal');
  assert.equal(almacen.escrituras, 1);

  // El almacenamiento contesta: la escritura pendiente guarda su clave y la siguiente petición la usa.
  almacen.modo = 'contesta';
  almacen.soltar();
  await vuelta();
  await preguntar(2);
  const firma = firmaDe(2);
  const guardada = almacen.valores.get('secreto-firma');
  assert.ok(guardada instanceof CryptoKey);
  assert.deepEqual(claves, [guardada], 'un solo motor, creado con la clave guardada');
  assert.equal(almacen.escrituras, 1, 'no se ha generado ni guardado otra clave');
  assert.equal(await laVerificaElUltimoMotor(firma), true);
});

test('continuidad: lo firmado antes de un bloqueo se verifica tras varios reintentos, la recuperación y otro Worker', async (t) => {
  const pendientes = relojQueCuenta(t);
  comoUnWorker(t);
  const almacen = new AlmacenDePrueba();
  usarAlmacen(t, almacen);
  await import('../../web/scripts/motor-local/worker.js');
  // Antes del bloqueo: el motor firma una estimación con la clave guardada.
  await preguntar(ANTES, 'https://faro.example/paquete/p2/');
  const antes = firmaDe(ANTES);
  const motores = claves.length;
  // Una versión nueva del paquete vuelve a cargar el motor, y el almacenamiento no contesta ni al abrir la base.
  almacen.modo = 'nada-contesta';
  const aperturas = almacen.aperturas;
  for (let id = PRIMERA_BLOQUEADA; id < PRIMERA_BLOQUEADA + REINTENTOS_SEGUIDOS; id += 1) {
    await preguntarSinRespuesta(t, id, 'https://faro.example/paquete/p3/');
  }
  assert.equal(claves.length, motores, 'ningún motor nuevo mientras no hay clave');
  assert.equal(almacen.aperturas - aperturas, 1, 'tres reintentos esperan la misma operación: una sola apertura');
  assert.equal(pendientes(), 0, 'cada espera vencida ha retirado su temporizador');
  // Contesta: el motor vuelve con la misma clave y verifica lo firmado antes.
  almacen.modo = 'contesta';
  almacen.soltar();
  await vuelta();
  await preguntar(RECUPERADA, 'https://faro.example/paquete/p3/');
  firmaDe(RECUPERADA);
  assert.equal(await laVerificaElUltimoMotor(antes), true, 'tras recuperarse');
  assert.equal(almacen.escrituras, 1, 'nunca se ha guardado otra clave');
  // Otro Worker (la página lo crea de nuevo): lee la clave guardada y verifica lo de antes.
  await import(`${WORKER}${REINICIO}`);
  await preguntar(OTRO_WORKER, 'https://faro.example/paquete/p3/');
  firmaDe(OTRO_WORKER);
  assert.equal(await laVerificaElUltimoMotor(antes), true, 'tras reiniciar el Worker');
  assert.equal(almacen.escrituras, 1);
  assert.equal(almacen.abiertas, 0, 'ninguna conexión abierta de más');
  assert.equal(pendientes(), 0, 'ningún temporizador pendiente');
});

test('fallo tras abrir la base: el Worker dice que no tiene la clave y no crea ningún motor', async (t) => {
  relojQueCuenta(t);
  comoUnWorker(t);
  const almacen = new AlmacenDePrueba();
  usarAlmacen(t, almacen);
  await import('../../web/scripts/motor-local/worker.js');
  await preguntar(FALLO_TRAS_ABRIR, 'https://faro.example/paquete/p4/');
  const motores = claves.length;
  almacen.modo = 'lectura-falla';
  await preguntar(FALLO_TRAS_ABRIR + 1, 'https://faro.example/paquete/p5/');
  assert.deepEqual(respuestasA(FALLO_TRAS_ABRIR + 1), [{ id: FALLO_TRAS_ABRIR + 1, fallo: true, sinClave: true }]);
  assert.equal(claves.length, motores, 'ningún motor con una clave temporal');
});

test('base que no se abre: el Worker dice que no tiene la clave y, al volver, el motor firma con la misma', async (t) => {
  relojQueCuenta(t);
  comoUnWorker(t);
  const almacen = new AlmacenDePrueba();
  usarAlmacen(t, almacen);
  await import('../../web/scripts/motor-local/worker.js');
  await preguntar(BASE_QUE_NO_SE_ABRE, 'https://faro.example/paquete/p6/');
  const antes = firmaDe(BASE_QUE_NO_SE_ABRE);
  const motores = claves.length;
  almacen.modo = 'no-abre';
  await preguntar(BASE_QUE_NO_SE_ABRE + 1, 'https://faro.example/paquete/p7/');
  assert.deepEqual(respuestasA(BASE_QUE_NO_SE_ABRE + 1), [
    { id: BASE_QUE_NO_SE_ABRE + 1, fallo: true, sinClave: true },
  ]);
  assert.equal(claves.length, motores, 'ningún motor con una clave temporal');
  // El acceso vuelve: la petición siguiente vuelve a cargar el motor y a abrir la base, y lee la clave guardada.
  almacen.modo = 'contesta';
  await preguntar(BASE_QUE_NO_SE_ABRE + 2, 'https://faro.example/paquete/p7/');
  firmaDe(BASE_QUE_NO_SE_ABRE + 2);
  assert.equal(claves.at(-1), almacen.valores.get('secreto-firma'), 'el motor se crea con la clave guardada');
  assert.equal(await laVerificaElUltimoMotor(antes), true, 'lo firmado antes del fallo verifica');
  assert.equal(almacen.escrituras, 1, 'nunca se ha guardado otra clave');
  assert.equal(almacen.abiertas, 0);
});
