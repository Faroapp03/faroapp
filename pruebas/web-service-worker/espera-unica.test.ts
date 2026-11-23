// Una sola espera al service worker activo (H6): la de estadoDelPaquete, con su plazo. El resultado recibido de otro
// dispositivo no espera por su cuenta: pide al motor, y el motor espera dentro de estadoDelPaquete.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

const PLAZO_DEL_SERVICE_WORKER_MS = 120_000;
/** Las vueltas de microtareas que bastan para que estadoDelPaquete llegue a esperar a `ready`. */
const VUELTAS_DE_MICROTAREAS = 5;
/** Cuándo registra instalacion.js el service worker en la primera visita de la prueba. */
const REGISTRO_TARDIO_MS = 10_000;

test('estadoDelPaquete espera una sola vez al service worker activo y deja de esperar al vencer su plazo', async () => {
  let lecturasDeReady = 0;
  const contenedor = {
    getRegistration: async () => ({}),
    get ready() {
      lecturasDeReady += 1;
      return new Promise(() => {});
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: contenedor } });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { estadoDelPaquete, PaqueteSinRespuesta } = await import('../../web/scripts/paquete-sin-conexion.js');
    let resultado: unknown = 'pendiente';
    const espera = estadoDelPaquete().then(
      () => 'cumplida',
      (motivo: unknown) => motivo,
    );
    espera.then((valor) => {
      resultado = valor;
    });
    for (let vuelta = 0; vuelta < VUELTAS_DE_MICROTAREAS; vuelta += 1) {
      await Promise.resolve();
    }
    mock.timers.tick(PLAZO_DEL_SERVICE_WORKER_MS - 1);
    await Promise.resolve();
    assert.equal(resultado, 'pendiente', 'antes del plazo sigue esperando');
    mock.timers.tick(1);
    const motivo = await espera;
    assert.ok(motivo instanceof PaqueteSinRespuesta, `al vencer el plazo, PaqueteSinRespuesta, no ${String(motivo)}`);
    assert.equal(lecturasDeReady, 1, 'una sola espera');
  } finally {
    mock.timers.reset();
  }
});

/**
 * Un contenedor cuyo service worker queda activo `retraso` ms después (nunca, sin `retraso`). Sin `yaRegistrado`, no
 * hay registro hasta entonces (instalacion.js lo registra al cargar); con él, ya hay uno de una visita anterior, activo
 * con `retraso` 0 o que aún se activa.
 */
function registroPendiente(retraso: number | undefined, yaRegistrado = false) {
  let registrado = yaRegistrado;
  const mensajes: unknown[] = [];
  const registro = { active: { postMessage: (mensaje: unknown) => mensajes.push(mensaje) } };
  const listo = new Promise((resolver) => {
    if (retraso !== undefined) {
      setTimeout(() => {
        registrado = true;
        resolver(registro);
      }, retraso);
    }
  });
  const contenedor = {
    getRegistration: async () => (registrado ? registro : undefined),
    ready: listo,
    startMessages() {},
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: contenedor } });
  return mensajes;
}

/** Deja correr todas las microtareas pendientes: setImmediate no lo controla el reloj simulado. */
function vaciarMicrotareas() {
  return new Promise((resolver) => setImmediate(resolver));
}

test('en la primera visita, la espera cubre el registro que llega después y entonces pide la copia', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const mensajes = registroPendiente(REGISTRO_TARDIO_MS);
    const { estadoDelPaquete } = await import('../../web/scripts/paquete-sin-conexion.js');
    let resultado: unknown = 'pendiente';
    estadoDelPaquete().then(
      () => {
        resultado = 'cumplida';
      },
      (motivo: unknown) => {
        resultado = motivo;
      },
    );
    await vaciarMicrotareas();
    assert.equal(resultado, 'pendiente', 'sin registro todavía, espera en vez de fallar');
    mock.timers.tick(REGISTRO_TARDIO_MS);
    await vaciarMicrotareas();
    assert.equal(resultado, 'pendiente');
    assert.equal(mensajes.length, 1, 'con el registro activo, pide la copia');
  } finally {
    mock.timers.reset();
  }
});

test('si al vencer el plazo sigue sin registro, no hay service worker', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    registroPendiente(undefined);
    const { estadoDelPaquete, SinServiceWorker } = await import('../../web/scripts/paquete-sin-conexion.js');
    const espera = estadoDelPaquete().then(
      () => 'cumplida',
      (motivo: unknown) => motivo,
    );
    await vaciarMicrotareas();
    mock.timers.tick(PLAZO_DEL_SERVICE_WORKER_MS);
    const motivo = await espera;
    assert.ok(motivo instanceof SinServiceWorker, `SinServiceWorker, no ${String(motivo)}`);
  } finally {
    mock.timers.reset();
  }
});

/** La página: <html> con su dataset y la ventana como destino de eventos, como en el navegador. */
function pagina(dataset: Record<string, string> = {}) {
  const ventana = new EventTarget();
  Object.assign(globalThis, {
    addEventListener: ventana.addEventListener.bind(ventana),
    removeEventListener: ventana.removeEventListener.bind(ventana),
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset } } });
  return ventana;
}

/** Sigue una llamada a estadoDelPaquete sin esperarla: `resultado()` dice cómo va. */
function seguir(promesa: Promise<unknown>) {
  let resultado: unknown = 'pendiente';
  promesa.then(
    () => {
      resultado = 'cumplida';
    },
    (error: unknown) => {
      resultado = error;
    },
  );
  return () => resultado;
}

test('(a) con el registro fallido ya contado (la marca) y un registro activo, no hay SinServiceWorker', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const mensajes = registroPendiente(0, true);
    const { estadoDelPaquete, SinServiceWorker, MARCA_REGISTRO_FALLIDO } = await import(
      '../../web/scripts/paquete-sin-conexion.js'
    );
    pagina({ [MARCA_REGISTRO_FALLIDO]: '' });
    const resultado = seguir(estadoDelPaquete());
    mock.timers.tick(0);
    await vaciarMicrotareas();
    assert.ok(!(resultado() instanceof SinServiceWorker), `sin SinServiceWorker, no ${String(resultado())}`);
    assert.equal(mensajes.length, 1, 'con el registro activo, pide la copia');
  } finally {
    mock.timers.reset();
  }
});

test('(b) con el registro fallido contado durante la espera y un registro que se activa después, sigue', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const mensajes = registroPendiente(REGISTRO_TARDIO_MS, true);
    const { estadoDelPaquete, SinServiceWorker, EVENTO_REGISTRO_FALLIDO } = await import(
      '../../web/scripts/paquete-sin-conexion.js'
    );
    const ventana = pagina();
    const resultado = seguir(estadoDelPaquete());
    await vaciarMicrotareas();
    ventana.dispatchEvent(new Event(EVENTO_REGISTRO_FALLIDO));
    await vaciarMicrotareas();
    assert.equal(resultado(), 'pendiente', 'con un registro, sigue esperando');
    mock.timers.tick(REGISTRO_TARDIO_MS);
    await vaciarMicrotareas();
    assert.ok(!(resultado() instanceof SinServiceWorker), `sin SinServiceWorker, no ${String(resultado())}`);
    assert.equal(mensajes.length, 1, 'con el registro activo, pide la copia');
  } finally {
    mock.timers.reset();
  }
});

test('(b) el registro fallido no reinicia el plazo: vence a los 120 s de la llamada', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    registroPendiente(undefined, true);
    const { estadoDelPaquete, PaqueteSinRespuesta, EVENTO_REGISTRO_FALLIDO } = await import(
      '../../web/scripts/paquete-sin-conexion.js'
    );
    const ventana = pagina();
    const resultado = seguir(estadoDelPaquete());
    await vaciarMicrotareas();
    mock.timers.tick(REGISTRO_TARDIO_MS);
    ventana.dispatchEvent(new Event(EVENTO_REGISTRO_FALLIDO));
    await vaciarMicrotareas();
    mock.timers.tick(PLAZO_DEL_SERVICE_WORKER_MS - REGISTRO_TARDIO_MS);
    await vaciarMicrotareas();
    assert.ok(resultado() instanceof PaqueteSinRespuesta, `PaqueteSinRespuesta, no ${String(resultado())}`);
  } finally {
    mock.timers.reset();
  }
});

test('(c) con el registro fallido ya contado (la marca) y ningún registro, SinServiceWorker en el acto', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    registroPendiente(undefined);
    const { estadoDelPaquete, SinServiceWorker, MARCA_REGISTRO_FALLIDO } = await import(
      '../../web/scripts/paquete-sin-conexion.js'
    );
    pagina({ [MARCA_REGISTRO_FALLIDO]: '' });
    const resultado = seguir(estadoDelPaquete());
    await vaciarMicrotareas();
    assert.ok(
      resultado() instanceof SinServiceWorker,
      `SinServiceWorker sin esperar al plazo, no ${String(resultado())}`,
    );
  } finally {
    mock.timers.reset();
  }
});

test('(c) con el registro fallido contado al esperar y ningún registro, SinServiceWorker en el acto', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    registroPendiente(undefined);
    const { estadoDelPaquete, SinServiceWorker, EVENTO_REGISTRO_FALLIDO } = await import(
      '../../web/scripts/paquete-sin-conexion.js'
    );
    const ventana = pagina();
    const resultado = seguir(estadoDelPaquete());
    await vaciarMicrotareas();
    assert.equal(resultado(), 'pendiente');
    ventana.dispatchEvent(new Event(EVENTO_REGISTRO_FALLIDO));
    await vaciarMicrotareas();
    assert.ok(
      resultado() instanceof SinServiceWorker,
      `SinServiceWorker sin esperar al plazo, no ${String(resultado())}`,
    );
  } finally {
    mock.timers.reset();
  }
});

test('(d) con la página y sin registro fallido, el registro tardío sigue sirviendo', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const mensajes = registroPendiente(REGISTRO_TARDIO_MS);
    pagina();
    const { estadoDelPaquete } = await import('../../web/scripts/paquete-sin-conexion.js');
    estadoDelPaquete().catch(() => undefined);
    mock.timers.tick(REGISTRO_TARDIO_MS);
    await vaciarMicrotareas();
    assert.equal(mensajes.length, 1, 'con el registro activo, pide la copia');
  } finally {
    mock.timers.reset();
  }
});

test('instalacion.js cuenta el registro fallido en los dos casos en que no lo consigue', () => {
  const fuente = readFileSync(new URL('../../web/scripts/instalacion.js', import.meta.url), 'utf8');
  const desde = fuente.indexOf('async function pedirRegistro()');
  const cuerpo = fuente.slice(desde, fuente.indexOf('// ---------- Instalación que no coincide', desde));
  assert.equal(cuerpo.match(/contarElRegistroFallido\(\);\n\s*return null;/g)?.length, 2);
});

test('el resultado recibido de otro dispositivo no tiene una espera propia al service worker', () => {
  const fuente = readFileSync(new URL('../../web/scripts/otro-dispositivo/recibir.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /serviceWorker|ESPERA_DEL_SERVICE_WORKER|setTimeout/);
  // Cada extensión instalada (la demostración) responde con resultados grabados (su scripts/motor-local/cliente.js),
  // sin paquete ni service worker: tampoco espera a nadie.
  for (const { id, entrada } of EXTENSIONES) {
    const carpeta = new URL(`../../web/${entrada.split('/')[0] ?? ''}/scripts/`, import.meta.url);
    const recibir = readFileSync(new URL('otro-dispositivo/recibir.js', carpeta), 'utf8');
    assert.doesNotMatch(recibir, /serviceWorker|ESPERA_DEL_SERVICE_WORKER|setTimeout/, id);
    const adaptador = readFileSync(new URL('motor-local/cliente.js', carpeta), 'utf8');
    assert.doesNotMatch(adaptador, /serviceWorker|estadoDelPaquete/, `${id}: no usa el service worker`);
  }
  const motor = readFileSync(new URL('../../web/scripts/motor-local/cliente.js', import.meta.url), 'utf8');
  assert.doesNotMatch(motor, /serviceWorker\??\.ready/, 'el motor tampoco espera por su cuenta');
});
