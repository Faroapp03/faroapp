// La página que espera la copia del paquete mantiene vivo al service worker (scripts/paquete-sin-conexion.js): le
// repite su petición mientras espera, porque el navegador lo detiene tras un rato sin eventos aunque siga bajando, y
// al detenerlo corta la descarga. Con temporizadores falsos y un service worker de prueba que vive como en Firefox: se
// detiene IDLE_MS + EXTENDIDO_MS después de su último evento (dom.serviceWorkers.idle_timeout e
// idle_extended_timeout), pierde lo que llevaba del archivo en curso y vuelve a ponerse en marcha con un mensaje.
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import {
  estadoDelPaquete,
  PaqueteSinRespuesta,
  prepararPaqueteSinConexion,
} from '../../web/scripts/paquete-sin-conexion.js';

const IDLE_MS = 30_000;
const EXTENDIDO_MS = 30_000;
/** Lo que tarda en bajar vectores-movil.json con 3G (unos 10,3 MB a 50 kB/s): mucho más que la vida sin eventos. */
const DESCARGA_MS = 206_000;
/** Los plazos de paquete-sin-conexion.js y el latido del service worker mientras recibe datos (LATIDO_MS). */
const PLAZO_SIN_AVANCE_MS = 30_000;
const LATIDO_DE_LA_PAGINA_MS = 20_000;
const AVISO_DEL_SERVICIO_MS = 5000;
const SEGUNDO = 1000;
const VERSION = 'b1a5ce9ca7a9077c';
/** Cuándo se detiene a la fuerza en la prueba de la visita, y cuántos plazos se miran sin respuesta. */
const DETENIDO_A_MS = 100_000;
const PLAZOS_QUE_SE_MIRAN = 3;
const vuelta = () => new Promise((listo) => setImmediate(listo));

/** `contenedor` como navigator.serviceWorker durante la prueba. */
function conNavegador(t: TestContext, contenedor: EventTarget) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    if (anterior) {
      Object.defineProperty(globalThis, 'navigator', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: contenedor } });
}

/**
 * Un service worker de prueba con la vida que le da Firefox. Cada mensaje de la página es un evento: lo pone en marcha
 * si estaba detenido y cuenta como su último evento. En marcha, baja la copia (DESCARGA_MS) y avisa cada
 * AVISO_DEL_SERVICIO_MS; IDLE_MS + EXTENDIDO_MS después de su último evento el navegador lo detiene y lo que llevaba
 * del archivo se pierde. `averiado` deja de ponerse en marcha. El reloj lo mueve la prueba, segundo a segundo (pasar).
 */
function servicioComoEnFirefox(t: TestContext) {
  const contenedor = Object.assign(new EventTarget(), { startMessages() {} });
  const estado = estadoInicial();
  const avisar = (data: unknown) => contenedor.dispatchEvent(new MessageEvent('message', { data }));
  const registro = { active: { postMessage: () => alRecibirUnMensaje(estado, avisar) } };
  Object.assign(contenedor, { ready: Promise.resolve(registro), getRegistration: async () => registro });
  conNavegador(t, contenedor);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** Un segundo más de reloj: primero lo que la página tenía programado, después lo que hace el service worker. */
  const pasar = async () => {
    estado.ahora += SEGUNDO;
    t.mock.timers.tick(SEGUNDO);
    if (estado.enMarcha && !estado.completa) {
      seguirBajando(estado, avisar);
    }
    await vuelta();
  };
  /** Detiene el service worker ya (la pestaña pasa a segundo plano, por ejemplo). */
  const detener = () => {
    estado.enMarcha = false;
    estado.bajado = 0;
    estado.detenciones += 1;
  };
  return { estado, pasar, detener };
}

/** Cómo está el service worker de prueba: su reloj, su vida, su descarga y cuándo se le ha pedido la copia. */
function estadoInicial() {
  return {
    ahora: 0,
    ultimoEvento: 0,
    enMarcha: false,
    bajado: 0,
    completa: false,
    detenciones: 0,
    averiado: false,
    pedidas: [] as number[],
  };
}
type EstadoDelServicio = ReturnType<typeof estadoInicial>;

/** Un mensaje de la página: es un evento, que lo pone en marcha; con la copia ya completa, contesta enseguida. */
function alRecibirUnMensaje(estado: EstadoDelServicio, avisar: (data: unknown) => void) {
  estado.pedidas.push(estado.ahora);
  if (estado.averiado) {
    return;
  }
  estado.ultimoEvento = estado.ahora;
  estado.enMarcha = true;
  if (estado.completa) {
    avisar({ type: 'ESTADO_DEL_PAQUETE', version: VERSION, completo: true });
  }
}

/**
 * Un segundo de la descarga del service worker en marcha: el navegador lo detiene si su último evento queda más lejos
 * que IDLE_MS + EXTENDIDO_MS; si no, baja, avisa cada AVISO_DEL_SERVICIO_MS y dice cómo ha quedado al terminar.
 */
function seguirBajando(estado: EstadoDelServicio, avisar: (data: unknown) => void) {
  if (estado.ahora - estado.ultimoEvento > IDLE_MS + EXTENDIDO_MS) {
    estado.enMarcha = false;
    estado.bajado = 0;
    estado.detenciones += 1;
    return;
  }
  estado.bajado += SEGUNDO;
  if (estado.bajado >= DESCARGA_MS) {
    estado.completa = true;
    avisar({ type: 'ESTADO_DEL_PAQUETE', version: VERSION, completo: true });
  } else if (estado.bajado % AVISO_DEL_SERVICIO_MS === 0) {
    avisar({ type: 'PROGRESO_DEL_PAQUETE', version: VERSION });
  }
}

/** Cómo ha acabado una promesa, sin esperarla. */
function seguir(promesa: Promise<unknown>) {
  const como: { estado: string; valor?: unknown; motivo?: unknown } = { estado: 'pendiente' };
  promesa.then(
    (valor) => Object.assign(como, { estado: 'cumplida', valor }),
    (motivo) => Object.assign(como, { estado: 'rechazada', motivo }),
  );
  return como;
}

test('el motor espera una descarga de 206 s: la página mantiene vivo al service worker hasta el final', async (t) => {
  const sw = servicioComoEnFirefox(t);
  const espera = seguir(estadoDelPaquete());
  await vuelta();
  while (espera.estado === 'pendiente' && sw.estado.ahora < 2 * DESCARGA_MS) {
    await sw.pasar();
  }
  assert.deepEqual(espera, { estado: 'cumplida', valor: { version: VERSION, completo: true } });
  assert.equal(sw.estado.detenciones, 0, 'el navegador no lo detiene');
  const entre = sw.estado.pedidas.slice(1).map((cuando, indice) => cuando - (sw.estado.pedidas[indice] ?? 0));
  assert.ok(entre.length >= DESCARGA_MS / LATIDO_DE_LA_PAGINA_MS - 1, `peticiones: ${sw.estado.pedidas}`);
  assert.ok(
    entre.every((intervalo) => intervalo < IDLE_MS),
    `cada petición, antes de que el navegador lo detenga: ${entre}`,
  );
  assert.ok(entre.slice(1).every((intervalo) => intervalo === LATIDO_DE_LA_PAGINA_MS));
  const hechas = sw.estado.pedidas.length;
  for (let segundo = 0; segundo < PLAZO_SIN_AVANCE_MS / SEGUNDO; segundo += 1) {
    await sw.pasar();
  }
  assert.equal(sw.estado.pedidas.length, hechas, 'con el estado, deja de pedir');
});

test('la visita sigue la copia mientras la página está abierta, también si el navegador lo detiene', async (t) => {
  const sw = servicioComoEnFirefox(t);
  await prepararPaqueteSinConexion();
  while (!sw.estado.completa && sw.estado.ahora < 2 * DESCARGA_MS) {
    await sw.pasar();
    if (sw.estado.ahora === DETENIDO_A_MS) {
      sw.detener();
    }
  }
  assert.equal(sw.estado.completa, true, 'la copia se completa');
  assert.equal(
    sw.estado.detenciones,
    1,
    'solo la detención forzada; la siguiente petición lo vuelve a poner en marcha',
  );
  const hechas = sw.estado.pedidas.length;
  for (let segundo = 0; segundo < PLAZO_SIN_AVANCE_MS / SEGUNDO; segundo += 1) {
    await sw.pasar();
  }
  assert.equal(sw.estado.pedidas.length, hechas, 'con el estado, deja de pedir');
});

test('la visita no pone plazos ni repite nada a un service worker que no ha contestado nunca', async (t) => {
  const sw = servicioComoEnFirefox(t);
  sw.estado.averiado = true;
  await prepararPaqueteSinConexion();
  for (let segundo = 0; segundo < (PLAZOS_QUE_SE_MIRAN * PLAZO_SIN_AVANCE_MS) / SEGUNDO; segundo += 1) {
    await sw.pasar();
  }
  assert.deepEqual(sw.estado.pedidas, [0]);
});

test('antes de dejar de esperar a un service worker que ya contestó, la página se la vuelve a pedir', async (t) => {
  const sw = servicioComoEnFirefox(t);
  const espera = seguir(estadoDelPaquete());
  await vuelta();
  // Contesta durante 40 s y después ya no responde a nada.
  const contestaHasta = 40_000;
  while (sw.estado.ahora < contestaHasta) {
    await sw.pasar();
  }
  sw.detener();
  sw.estado.averiado = true;
  const ultimoAviso = contestaHasta - (contestaHasta % AVISO_DEL_SERVICIO_MS);
  while (espera.estado === 'pendiente' && sw.estado.ahora < contestaHasta + PLAZOS_QUE_SE_MIRAN * PLAZO_SIN_AVANCE_MS) {
    await sw.pasar();
  }
  assert.equal(espera.estado, 'rechazada');
  assert.ok(espera.motivo instanceof PaqueteSinRespuesta);
  assert.equal(sw.estado.ahora, ultimoAviso + 2 * PLAZO_SIN_AVANCE_MS, 'un plazo, otra petición y otro plazo');
  assert.ok(
    sw.estado.pedidas.includes(ultimoAviso + PLAZO_SIN_AVANCE_MS),
    `al vencer el primer plazo se vuelve a pedir: ${sw.estado.pedidas}`,
  );
});
