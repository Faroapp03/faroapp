// El primer paso de ocupación con el cliente del motor (motor-local/cliente.js), su envoltorio (recorrido/motor.js),
// los reintentos (recorrido/espera-del-motor.js) y el paso (recorrido/ocupacion-local.js) reales, frente a un service
// worker y un Worker de prueba, con tiempo virtual. Una descarga muy lenta que avisa de que sigue termina bien aunque
// pase del límite total, que no cuenta las esperas de la copia; una descarga parada acaba a los 30 s; un arranque
// bloqueado termina en el plazo de lo que lo bloquea, no a los 15 min, con la explicación aprobada; los reintentos no
// reinician el límite; y «Volver a intentarlo» recupera sin dejar más de un Worker vivo ni temporizadores pendientes.
import './aislar.ts';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, type TestContext, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import {
  ErrorFaro,
  esCancelacion,
  esMotorQueNoCoincide,
  motivoDelFallo,
  sePuedeReintentar,
} from '../../web/scripts/recorrido/api/errores.js';
import { esTraducible, fijarIdioma, resolver, traducible } from '../../web/scripts/textos.js';
import { pagina } from './dom.ts';

// aislar.ts cambia motor.js por un doble para las demás pruebas del paso; aquí el paso usa el real.
const MOTOR_REAL = new URL('../../web/scripts/recorrido/motor.js', import.meta.url).href;
registerHooks({
  resolve(spec, contexto, siguiente) {
    const padre = contexto.parentURL ?? '';
    if (spec === './motor.js' && /\/web\/scripts\/recorrido\/(?:ocupacion-local|espera-del-motor)\.js$/.test(padre)) {
      return { url: MOTOR_REAL, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});

const MS_POR_SEGUNDO = 1000;
const MS_POR_MINUTO = 60_000;
/** El plazo propio del cliente por petición, el de la clave en el Worker y el límite total del paso. */
const PLAZO_DEL_WORKER_MS = 120_000;
const ESPERA_DEL_ALMACEN_MS = 15_000;
const LIMITE_TOTAL_MS = 900_000;
/** Cada cuánto cuenta el service worker que la descarga sigue (src/service-worker/paquete.js, LATIDO_MS). */
const LATIDO_MS = 5000;
/** Sin avisos del service worker en este plazo, la espera de la copia acaba (paquete-sin-conexion.js). */
const PLAZO_SIN_AVANCE_MS = 30_000;
/** Lo que tarda la descarga muy lenta: los 25 MB de la primera visita a 200 kbps (25 kB/s), 1.000 s. */
const DESCARGA_A_200_KBPS_MS = 1_000_000;
/** Lo que tarda en fallar cada intento del motor lento, y desde cuándo deja de contestar (los últimos intentos). */
const FALLO_LENTO_MS = 110_000;
const DEJA_DE_CONTESTAR_MS = 780_000;
/** La suma de las esperas de la copia que admite una petición (espera-del-motor.js, LIMITE_DE_LA_COPIA_MS). */
const LIMITE_DE_LA_COPIA_MS = 1_800_000;
/** Lo que tarda cada descarga de un archivo que no cuadra con su huella, hasta que el service worker la da por mala. */
const DESCARGA_QUE_NO_CUADRA_MS = 110_000;
/** Cuándo pide la persona otra cosa, con la primera petición ya cancelada, y cuándo sale del paso. */
const SEGUNDA_PETICION_MS = 70_000;
const SALIDA_DEL_PASO_MS = 10_000;
/** El plazo de las peticiones del recorrido con red (api/transporte.js), que cancela antes que el Worker. */
const PLAZO_DEL_RECORRIDO_MS = 60_000;
/** Los fallos en el acto del motor tras la descarga lenta, cada uno con su reintento. */
const FALLOS_DEL_MOTOR = 2;
/** Las veces seguidas que la persona pulsa «Volver a intentarlo» con el arranque aún bloqueado. */
const REINTENTOS_SEGUIDOS = 3;
/** Hasta dónde se deja correr el reloj virtual: más que el límite total, mucho menos que los 123 min de antes. */
const HORIZONTE_MS = 3_000_000;
const PASO_MS = MS_POR_SEGUNDO;
/** La pausa entre reintentos (ocupacion-local.js, MS_ENTRE_INTENTOS). */
const MS_ENTRE_INTENTOS = 3000;
const CORRECTO = 200;

const PREGUNTA = {
  lectura: { sinComprension: false },
  paso: {
    tipo: 'pregunta',
    pregunta: { id: 'tarea:5131-1', tipo: 'tarea', texto: '¿Sirves comidas?', opciones: [{ id: 'si', texto: 'Sí' }] },
    numero: 1,
    maximo: 14,
  },
};

type ComoContesta = 'responde' | 'nada' | 'almacen-sin-respuesta' | 'lento';

/** Un Worker del motor que contesta como diga la prueba; cuenta las peticiones y si se ha terminado. */
class WorkerDePrueba {
  static creados: WorkerDePrueba[] = [];
  static contesta: ComoContesta = 'responde';
  /** Cuántas peticiones más fallan en el acto, como un motor que aún no ha podido cargar. */
  static fallosRapidos = 0;
  /** Cómo contesta este Worker, si no es como todos (`contesta`). */
  propio: ComoContesta | null = null;
  oyentes: ((evento: { data: unknown }) => void)[] = [];
  peticiones = 0;
  terminado = false;
  constructor() {
    WorkerDePrueba.creados.push(this);
  }
  addEventListener(tipo: string, oyente: (evento: { data: unknown }) => void) {
    if (tipo === 'message') {
      this.oyentes.push(oyente);
    }
  }
  postMessage({ id }: { id: number }) {
    this.peticiones += 1;
    const contestar = (data: unknown) => {
      for (const oyente of this.oyentes) {
        oyente({ data });
      }
    };
    const contesta = this.propio ?? WorkerDePrueba.contesta;
    if (WorkerDePrueba.fallosRapidos > 0) {
      WorkerDePrueba.fallosRapidos -= 1;
      queueMicrotask(() => contestar({ id, fallo: true }));
    } else if (contesta === 'lento') {
      setTimeout(() => contestar({ id, fallo: true }), FALLO_LENTO_MS);
    } else if (contesta === 'responde') {
      queueMicrotask(() =>
        contestar({
          id,
          status: CORRECTO,
          headers: [['content-type', 'application/json']],
          body: JSON.stringify(PREGUNTA),
        }),
      );
    } else if (contesta === 'almacen-sin-respuesta') {
      // Lo que contesta worker.js cuando la clave de firma no se ha podido leer ni guardar a tiempo.
      setTimeout(() => contestar({ id, fallo: true, sinClave: true }), ESPERA_DEL_ALMACEN_MS);
    }
  }
  terminate() {
    this.terminado = true;
  }
}

/** Las peticiones que han recibido todos los Workers, y cuántos siguen vivos. */
const peticiones = () => WorkerDePrueba.creados.reduce((suma, worker) => suma + worker.peticiones, 0);
const vivos = () => WorkerDePrueba.creados.filter((worker) => !worker.terminado).length;

/** El service worker: con `completa`, la copia está entera al preguntarle; si no, calla hasta que la prueba avise. */
const servicio: { completa: boolean; incompletaTras: number | null; bajando: boolean } = {
  completa: true,
  incompletaTras: null,
  bajando: false,
};
const contenedor = new EventTarget();
const avisar = (data: unknown) => contenedor.dispatchEvent(new MessageEvent('message', { data }));
const latido = () => avisar({ type: 'PROGRESO_DEL_PAQUETE', version: 'p1' });
const copiaCompleta = () => avisar({ type: 'ESTADO_DEL_PAQUETE', version: 'p1', completo: true });
const registro = {
  active: {
    postMessage: () =>
      queueMicrotask(() => {
        if (servicio.incompletaTras !== null) {
          // Un archivo que no cuadra con su huella: tras bajarlo otra vez, la copia acaba incompleta. Mientras lo baja,
          // pedirle la copia otra vez no empieza otra descarga.
          if (!servicio.bajando) {
            servicio.bajando = true;
            setTimeout(() => {
              servicio.bajando = false;
              avisar({ type: 'ESTADO_DEL_PAQUETE', version: 'p1', completo: false });
            }, servicio.incompletaTras);
          }
        } else if (servicio.completa) {
          copiaCompleta();
        }
      }),
  },
};
Object.assign(contenedor, {
  ready: Promise.resolve(registro),
  getRegistration: async () => registro,
  startMessages() {},
});
for (const [nombre, valor] of Object.entries({
  navigator: { serviceWorker: contenedor, onLine: true },
  Worker: WorkerDePrueba,
  location: { href: 'https://faro.example/recorrido.html' },
})) {
  Object.defineProperty(globalThis, nombre, { configurable: true, writable: true, value: valor });
}
Object.defineProperty(pagina, 'baseURI', { configurable: true, value: 'https://faro.example/recorrido.html' });
await cargarDiccionario('es');
const { pedirPasoLocal } = await import('../../web/scripts/recorrido/ocupacion-local.js');
const { MotorBloqueado, pedirAlMotorLocal } = await import('../../web/scripts/motor-local/cliente.js');

// El cliente sigue una sola copia para toda la página: cada prueba la deja completa para la siguiente.
afterEach(() => {
  servicio.completa = true;
  servicio.incompletaTras = null;
  servicio.bajando = false;
  WorkerDePrueba.fallosRapidos = 0;
  copiaCompleta();
});

/** Cómo ha acabado una promesa, sin esperarla, y en qué momento del reloj virtual. */
function seguir<T>(promesa: Promise<T>, reloj: { ms: number }) {
  const estado: { como: 'pendiente' | 'cumplida' | 'rechazada'; valor?: T; motivo?: unknown; alAcabarMs?: number } = {
    como: 'pendiente',
  };
  promesa.then(
    (valor) => Object.assign(estado, { como: 'cumplida', valor, alAcabarMs: reloj.ms }),
    (motivo: unknown) => Object.assign(estado, { como: 'rechazada', motivo, alAcabarMs: reloj.ms }),
  );
  return estado;
}

const vuelta = () => new Promise((listo) => setImmediate(listo));

/**
 * Mueve el reloj virtual de segundo en segundo hasta que el paso acaba o se llega a `hasta`; `cadaSegundo` hace lo que
 * haría el service worker en ese segundo.
 */
async function correr(
  t: TestContext,
  estado: { como: string },
  reloj: { ms: number },
  { hasta, cadaSegundo = () => {} }: { hasta: number; cadaSegundo?: () => void },
) {
  await vuelta();
  while (estado.como === 'pendiente' && reloj.ms < hasta) {
    reloj.ms += PASO_MS;
    t.mock.timers.tick(PASO_MS);
    cadaSegundo();
    await vuelta();
    await vuelta();
  }
}

/** La clave del texto con que ha fallado el paso. */
function claveDelFallo(motivo: unknown): string {
  assert.ok(motivo instanceof ErrorFaro, `falla con un ErrorFaro: ${String(motivo)}`);
  assert.ok(esTraducible(motivo.explicacion));
  return motivo.explicacion.clave;
}

/**
 * Tiempo virtual y el Worker como diga la prueba. Cuenta los temporizadores pendientes (`pendientes`): los que se
 * han puesto y aún no han vencido ni se han retirado.
 */
function empezar(t: TestContext, contesta: ComoContesta) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const poner = globalThis.setTimeout;
  const quitar = globalThis.clearTimeout;
  const activos = new Set<unknown>();
  const contado = (funcion: () => void, ms?: number) => {
    const id = poner(() => {
      activos.delete(id);
      funcion();
    }, ms);
    activos.add(id);
    return id;
  };
  Object.assign(globalThis, {
    setTimeout: contado,
    clearTimeout: (id: Parameters<typeof clearTimeout>[0]) => {
      activos.delete(id);
      quitar(id);
    },
  });
  t.after(() => Object.assign(globalThis, { setTimeout: poner, clearTimeout: quitar }));
  WorkerDePrueba.contesta = contesta;
  servicio.completa = true;
  return { ms: 0, pendientes: () => activos.size };
}

/** Una copia que no está completa: el primer intento falla en el acto y el siguiente vuelve a pedirla. */
function copiaAMedias() {
  WorkerDePrueba.fallosRapidos = 1;
  servicio.completa = false;
}

test('descarga muy lenta con progreso, a 200 kbps: termina bien tras 1.000 s, más que el límite total', async (t) => {
  const reloj = empezar(t, 'responde');
  copiaAMedias();
  const antes = peticiones();
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  await correr(t, paso, reloj, {
    hasta: DESCARGA_A_200_KBPS_MS,
    cadaSegundo: () => reloj.ms % LATIDO_MS === 0 && latido(),
  });
  assert.equal(paso.como, 'pendiente', 'mientras la descarga avisa de que sigue, se espera, aunque pase de 15 min');
  // La copia termina; el motor aún falla dos veces en el acto antes de responder. Si la copia ya estaba seguida, el
  // primer intento ha fallado antes, en el acto, y ha vuelto a pedirla.
  const fallidasAntes = 1 - WorkerDePrueba.fallosRapidos;
  servicio.completa = true;
  WorkerDePrueba.fallosRapidos = FALLOS_DEL_MOTOR;
  copiaCompleta();
  await correr(t, paso, reloj, { hasta: HORIZONTE_MS });
  // Se cumple porque la descarga a 200 kbps (DESCARGA_A_200_KBPS_MS) cabe en la cota de la copia (LIMITE_DE_LA_COPIA_MS).
  assert.equal(paso.como, 'cumplida');
  assert.equal(paso.alAcabarMs, DESCARGA_A_200_KBPS_MS + FALLOS_DEL_MOTOR * MS_ENTRE_INTENTOS);
  assert.ok((paso.alAcabarMs ?? 0) > LIMITE_TOTAL_MS, 'las esperas de la copia no cuentan para el límite');
  assert.equal(peticiones() - antes - fallidasAntes, FALLOS_DEL_MOTOR + 1, 'dos fallos del motor y la respuesta');
  assert.ok(vivos() <= 1);
  assert.equal(reloj.pendientes(), 0, 'no queda ningún temporizador pendiente');
});

test('descarga que se para: sin avisos, termina a los 30 s, no a los 15 min', async (t) => {
  const reloj = empezar(t, 'responde');
  copiaAMedias();
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  await correr(t, paso, reloj, { hasta: HORIZONTE_MS });
  assert.equal(paso.como, 'rechazada');
  assert.equal(paso.alAcabarMs, MS_ENTRE_INTENTOS + PLAZO_SIN_AVANCE_MS, 'tras el reintento, 30 s sin avisos');
  assert.equal(claveDelFallo(paso.motivo), 'recorrido.error.sin-datos');
});

test('los reintentos tardíos no dan otro límite; el límite cancela la petición en curso y el Worker mudo se termina', async (t) => {
  const reloj = empezar(t, 'lento');
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  // Cada intento falla a los 110 s; desde los 13 min el motor deja de contestar.
  await correr(t, paso, reloj, {
    hasta: HORIZONTE_MS,
    cadaSegundo: () => {
      if (reloj.ms === DEJA_DE_CONTESTAR_MS) {
        WorkerDePrueba.contesta = 'nada';
      }
    },
  });
  assert.equal(paso.como, 'rechazada');
  assert.equal(
    paso.alAcabarMs,
    LIMITE_TOTAL_MS,
    'el límite cuenta desde el primer intento: los reintentos no lo alargan',
  );
  assert.equal(claveDelFallo(paso.motivo), 'recorrido.error.sin-datos');
  const worker = WorkerDePrueba.creados.at(-1);
  assert.equal(worker?.terminado, false, 'al vencer el límite, el Worker aún está en su plazo');
  // La petición cancelada se mandó a los 791 s: a los 911 s vence su plazo propio y el Worker mudo se termina.
  await correr(t, { como: 'pendiente' }, reloj, { hasta: LIMITE_TOTAL_MS + PLAZO_DEL_WORKER_MS });
  assert.equal(worker?.terminado, true);
  assert.equal(vivos(), 0);
  assert.equal(reloj.pendientes(), 0, 'ningún temporizador pendiente');
});

test('clave que no se puede guardar a tiempo: cada intento acaba a los 15 s y el mismo Worker se recupera', async (t) => {
  const reloj = empezar(t, 'almacen-sin-respuesta');
  const antes = peticiones();
  for (let vez = 1; vez <= REINTENTOS_SEGUIDOS; vez += 1) {
    const inicio = reloj.ms;
    const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
    await correr(t, paso, reloj, { hasta: HORIZONTE_MS });
    assert.equal(paso.como, 'rechazada');
    assert.equal((paso.alAcabarMs ?? 0) - inicio, ESPERA_DEL_ALMACEN_MS);
    assert.equal(claveDelFallo(paso.motivo), 'recorrido.error.bloqueo');
    assert.equal(peticiones() - antes, vez, 'una sola petición por intento: no se repite en el acto');
    assert.equal(vivos(), 1, 'un solo Worker vivo');
    assert.equal(reloj.pendientes(), 0, 'ningún temporizador pendiente entre reintentos');
  }
  const worker = WorkerDePrueba.creados.at(-1);
  WorkerDePrueba.contesta = 'responde';
  const otra = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  await correr(t, otra, reloj, { hasta: reloj.ms + MS_POR_MINUTO });
  assert.equal(otra.como, 'cumplida');
  assert.equal(WorkerDePrueba.creados.at(-1), worker, 'se recupera con el mismo Worker');
  assert.equal(vivos(), 1);
  assert.equal(reloj.pendientes(), 0);
});

test('clave sin respuesta más allá del plazo del Worker: el siguiente «Volver a intentarlo» lo termina y arranca otro', async (t) => {
  const reloj = empezar(t, 'responde');
  // Un Worker vivo cuya operación con la clave no termina nunca; los nuevos responden.
  const previo = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  await correr(t, previo, reloj, { hasta: reloj.ms + MS_POR_MINUTO });
  const viejo = WorkerDePrueba.creados.at(-1);
  assert.ok(viejo);
  viejo.propio = 'almacen-sin-respuesta';
  const enviadasAntes = viejo.peticiones;
  const primero = reloj.ms;
  const intentos: string[] = [];
  for (let vez = 1; vez <= 2 * REINTENTOS_SEGUIDOS * REINTENTOS_SEGUIDOS; vez += 1) {
    const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
    await correr(t, paso, reloj, { hasta: HORIZONTE_MS });
    intentos.push(paso.como);
    assert.ok(vivos() <= 1, 'nunca más de un Worker vivo');
    if (paso.como === 'cumplida') {
      break;
    }
    assert.equal(claveDelFallo(paso.motivo), 'recorrido.error.bloqueo');
  }
  assert.equal(intentos.at(-1), 'cumplida', 'se recupera');
  assert.equal(viejo.terminado, true, 'el Worker bloqueado se termina');
  assert.notEqual(WorkerDePrueba.creados.at(-1), viejo, 'responde un Worker nuevo');
  assert.equal(viejo.peticiones - enviadasAntes, intentos.length - 1, 'cada intento fallido fue al Worker bloqueado');
  assert.ok(reloj.ms - primero >= PLAZO_DEL_WORKER_MS, 'no antes de su plazo de 120 s');
  assert.ok(reloj.ms - primero < PLAZO_DEL_WORKER_MS + 2 * ESPERA_DEL_ALMACEN_MS, 'y en el primer intento después');
  assert.equal(reloj.pendientes(), 0);
});

test('Worker que no responde con los datos listos: cada intento acaba a los 120 s, con un solo Worker vivo, y se recupera', async (t) => {
  const reloj = empezar(t, 'nada');
  const antes = peticiones();
  const atascados: (WorkerDePrueba | undefined)[] = [];
  for (let vez = 1; vez <= REINTENTOS_SEGUIDOS; vez += 1) {
    const inicio = reloj.ms;
    const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
    await correr(t, paso, reloj, { hasta: HORIZONTE_MS });
    assert.equal(paso.como, 'rechazada', `el intento ${vez} termina`);
    assert.equal((paso.alAcabarMs ?? 0) - inicio, PLAZO_DEL_WORKER_MS, 'sin reintentos ciegos tras el bloqueo');
    assert.equal(claveDelFallo(paso.motivo), 'recorrido.error.bloqueo');
    assert.equal(peticiones() - antes, vez, 'un solo intento cada vez');
    atascados.push(WorkerDePrueba.creados.at(-1));
    assert.equal(atascados.at(-1)?.terminado, true, 'el Worker atascado se termina');
    assert.equal(vivos(), 0, 'no queda ningún Worker vivo');
    assert.equal(reloj.pendientes(), 0, 'ningún temporizador pendiente entre reintentos');
  }
  assert.equal(new Set(atascados).size, REINTENTOS_SEGUIDOS, 'cada reintento usa un Worker nuevo');
  WorkerDePrueba.contesta = 'responde';
  const otra = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  await correr(t, otra, reloj, { hasta: reloj.ms + MS_POR_MINUTO });
  assert.equal(otra.como, 'cumplida');
  assert.equal(vivos(), 1);
  assert.equal(reloj.pendientes(), 0);
});

test('una petición cancelada a los 60 s, como las del transporte, no deja vivo un Worker que no contesta', async (t) => {
  const reloj = empezar(t, 'nada');
  const plazo = new AbortController();
  setTimeout(() => plazo.abort(new DOMException('Plazo del recorrido', 'TimeoutError')), PLAZO_DEL_RECORRIDO_MS);
  const peticion = seguir(pedirAlMotorLocal('/api/grupos', { signal: plazo.signal }), reloj);
  await correr(t, peticion, reloj, { hasta: HORIZONTE_MS });
  assert.equal(peticion.como, 'rechazada');
  assert.equal(peticion.alAcabarMs, PLAZO_DEL_RECORRIDO_MS, 'quien pide deja de esperar a su plazo');
  const worker = WorkerDePrueba.creados.at(-1);
  assert.equal(worker?.terminado, false);
  await correr(t, { como: 'pendiente' }, reloj, { hasta: PLAZO_DEL_WORKER_MS });
  assert.equal(worker?.terminado, true, 'el Worker que no ha contestado se termina a los 120 s');
  assert.equal(reloj.pendientes(), 0);
});

test('goteo de bytes: la descarga que no termina corta a los 30 min de espera de la copia, y se puede reintentar', async (t) => {
  const reloj = empezar(t, 'responde');
  copiaAMedias();
  const antes = peticiones();
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  // Llega algún byte cada pocos segundos: el service worker avisa de que sigue, pero la copia no termina nunca.
  await correr(t, paso, reloj, { hasta: HORIZONTE_MS, cadaSegundo: () => reloj.ms % LATIDO_MS === 0 && latido() });
  const fallidasAntes = 1 - WorkerDePrueba.fallosRapidos;
  assert.equal(paso.como, 'rechazada');
  assert.equal(paso.alAcabarMs, fallidasAntes * MS_ENTRE_INTENTOS + LIMITE_DE_LA_COPIA_MS, 'la cota de la copia');
  assert.equal(claveDelFallo(paso.motivo), 'recorrido.error.sin-datos');
  assert.equal(sePuedeReintentar(paso.motivo), true, 'con «Volver a intentarlo»');
  assert.equal(peticiones() - antes, fallidasAntes, 'sin la copia, no se llega a pedir nada al motor');
  // La copia sigue en el service worker, y su seguimiento (paquete-sin-conexion.js) sigue para la petición siguiente.
});

test('un archivo que no cuadra con su huella y se vuelve a bajar en cada intento: corta en la cota de la copia', async (t) => {
  const reloj = empezar(t, 'responde');
  copiaAMedias();
  servicio.incompletaTras = DESCARGA_QUE_NO_CUADRA_MS;
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  await correr(t, paso, reloj, { hasta: HORIZONTE_MS, cadaSegundo: () => reloj.ms % LATIDO_MS === 0 && latido() });
  const fallidasAntes = 1 - WorkerDePrueba.fallosRapidos;
  // Cada intento: 110 s bajando el archivo (cuentan en la copia) y 3 s de pausa (cuentan en el motor).
  const enteros = Math.floor(LIMITE_DE_LA_COPIA_MS / DESCARGA_QUE_NO_CUADRA_MS);
  const resto = LIMITE_DE_LA_COPIA_MS - enteros * DESCARGA_QUE_NO_CUADRA_MS;
  const esperado =
    fallidasAntes * MS_ENTRE_INTENTOS + enteros * (DESCARGA_QUE_NO_CUADRA_MS + MS_ENTRE_INTENTOS) + resto;
  assert.equal(paso.como, 'rechazada');
  assert.equal(paso.alAcabarMs, esperado, 'la suma de las descargas llega a la cota, no a 60 intentos');
  assert.equal(claveDelFallo(paso.motivo), 'recorrido.error.sin-datos');
  assert.equal(sePuedeReintentar(paso.motivo), true);
  // La descarga sigue en el service worker, y su seguimiento (paquete-sin-conexion.js) sigue para la petición siguiente.
});

test('dos peticiones al mismo Worker mudo, la primera cancelada a los 60 s: ninguna recibe el fallo que pide recargar', async (t) => {
  const reloj = empezar(t, 'nada');
  const plazo = new AbortController();
  setTimeout(() => plazo.abort(new DOMException('Plazo del recorrido', 'TimeoutError')), PLAZO_DEL_RECORRIDO_MS);
  const primera = seguir(pedirAlMotorLocal('/api/grupos', { signal: plazo.signal }), reloj);
  let segunda: ReturnType<typeof seguir> | null = null;
  await correr(t, { como: 'pendiente' }, reloj, {
    hasta: PLAZO_DEL_WORKER_MS + MS_POR_SEGUNDO,
    cadaSegundo: () => {
      if (reloj.ms === SEGUNDA_PETICION_MS) {
        segunda = seguir(pedirAlMotorLocal('/api/grupos', {}), reloj);
      }
    },
  });
  assert.equal(primera.como, 'rechazada');
  assert.equal(primera.alAcabarMs, PLAZO_DEL_RECORRIDO_MS);
  assert.ok(primera.motivo instanceof DOMException, 'la primera acaba con el plazo de quien pedía');
  const vista = segunda as ReturnType<typeof seguir> | null;
  assert.equal(vista?.como, 'rechazada');
  assert.equal(vista?.alAcabarMs, PLAZO_DEL_WORKER_MS, 'cae con el Worker, a los 120 s de la primera');
  assert.ok(
    vista?.motivo instanceof MotorBloqueado,
    `un arranque bloqueado, no un fallo general: ${String(vista?.motivo)}`,
  );
  assert.equal(vivos(), 0);
  assert.equal(reloj.pendientes(), 0);
});

test('al salir del paso, los reintentos se detienen en el acto, sin que Faro diga nada', async (t) => {
  const reloj = empezar(t, 'responde');
  WorkerDePrueba.fallosRapidos = Number.POSITIVE_INFINITY;
  const conversacion = new AbortController();
  const antes = peticiones();
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }, { senal: conversacion.signal }), reloj);
  await correr(t, paso, reloj, {
    hasta: HORIZONTE_MS,
    cadaSegundo: () => reloj.ms === SALIDA_DEL_PASO_MS && conversacion.abort(),
  });
  assert.equal(paso.como, 'rechazada');
  assert.equal(paso.alAcabarMs, SALIDA_DEL_PASO_MS, 'también si estaba en la pausa entre intentos');
  assert.equal(esCancelacion(paso.motivo), true, 'una cancelación: no se cuenta a la persona');
  const hechas = peticiones() - antes;
  await correr(t, { como: 'pendiente' }, reloj, { hasta: reloj.ms + MS_POR_MINUTO });
  assert.equal(peticiones() - antes, hechas, 'no hay más intentos después');
  assert.equal(reloj.pendientes(), 0);
});

test('al salir del paso mientras se espera la copia, la espera se cancela en el acto y no se pide nada más al motor', async (t) => {
  const reloj = empezar(t, 'responde');
  copiaAMedias();
  const conversacion = new AbortController();
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }, { senal: conversacion.signal }), reloj);
  await correr(t, paso, reloj, {
    hasta: HORIZONTE_MS,
    cadaSegundo: () => {
      if (reloj.ms % LATIDO_MS === 0) {
        latido();
      }
      if (reloj.ms === SALIDA_DEL_PASO_MS) {
        conversacion.abort();
      }
    },
  });
  assert.equal(paso.como, 'rechazada');
  assert.equal(paso.alAcabarMs, SALIDA_DEL_PASO_MS, 'la espera de la copia no la retiene');
  assert.equal(esCancelacion(paso.motivo), true);
  const hechas = peticiones();
  await correr(t, { como: 'pendiente' }, reloj, {
    hasta: reloj.ms + MS_POR_MINUTO,
    cadaSegundo: () => reloj.ms % LATIDO_MS === 0 && latido(),
  });
  assert.equal(peticiones(), hechas, 'ningún intento más');
  // Solo siguen los dos relojes del seguimiento de la copia (paquete-sin-conexion.js: el latido de la página y el
  // plazo sin avisos), que el cliente comparte con toda la página y que no son de esta petición.
  assert.equal(reloj.pendientes(), 2, 'solo el seguimiento de la copia');
  copiaCompleta();
  await vuelta();
  assert.equal(reloj.pendientes(), 0, 'y acaba con la copia');
});

test('al salir del paso con una petición dentro del Worker, solo queda su plazo de 120 s, y la petición nueva se recupera', async (t) => {
  const reloj = empezar(t, 'nada');
  const conversacion = new AbortController();
  const paso = seguir(pedirPasoLocal({ texto: 'camarero' }, { senal: conversacion.signal }), reloj);
  await correr(t, paso, reloj, {
    hasta: HORIZONTE_MS,
    cadaSegundo: () => reloj.ms === SALIDA_DEL_PASO_MS && conversacion.abort(),
  });
  assert.equal(paso.como, 'rechazada');
  assert.equal(paso.alAcabarMs, SALIDA_DEL_PASO_MS);
  assert.equal(esCancelacion(paso.motivo), true);
  assert.equal(reloj.pendientes(), 1, 'solo el plazo propio de la petición ya enviada');
  const worker = WorkerDePrueba.creados.at(-1);
  await correr(t, { como: 'pendiente' }, reloj, { hasta: PLAZO_DEL_WORKER_MS });
  assert.equal(worker?.terminado, true, 'el Worker que no contesta se termina a sus 120 s');
  assert.equal(reloj.pendientes(), 0);
  WorkerDePrueba.contesta = 'responde';
  const otra = seguir(pedirPasoLocal({ texto: 'camarero' }), reloj);
  await correr(t, otra, reloj, { hasta: reloj.ms + MS_POR_MINUTO });
  assert.equal(otra.como, 'cumplida', 'la petición nueva responde con otro Worker');
  assert.equal(vivos(), 1);
  assert.equal(reloj.pendientes(), 0);
});

/** Los textos fijados del producto, literales. */
const TEXTOS_APROBADOS = {
  es: {
    'recorrido.error.sin-datos': 'Faro aún no ha terminado de prepararse. Vuelve a intentarlo dentro de un momento.',
    'recorrido.error.bloqueo': 'Faro no ha podido prepararse. Vuelve a intentarlo.',
  },
  ca: {
    'recorrido.error.sin-datos': 'Faro encara no ha acabat de preparar-se. Torna-ho a provar d’aquí a un moment.',
    'recorrido.error.bloqueo': 'Faro no ha pogut preparar-se. Torna-ho a provar.',
  },
} as const;

test('Faro dice exactamente los textos aprobados de la preparación, en castellano y en catalán', async () => {
  for (const idioma of ['es', 'ca'] as const) {
    await cargarDiccionario(idioma);
    fijarIdioma(idioma);
    for (const [clave, texto] of Object.entries(TEXTOS_APROBADOS[idioma])) {
      assert.equal(resolver(traducible(clave)), texto, `${idioma}: ${clave}`);
      assert.equal(new ErrorFaro(traducible(clave), 0, {}).message, texto, `${idioma}: lo que se muestra`);
    }
  }
  fijarIdioma('es');
});

test('el arranque bloqueado y los datos sin preparar se clasifican como fallo del motor, no de la conexión', () => {
  for (const clave of ['recorrido.error.sin-datos', 'recorrido.error.bloqueo']) {
    const fallo = new ErrorFaro(traducible(clave), 0, {});
    assert.equal(motivoDelFallo(fallo), 'otro', clave);
    assert.equal(sePuedeReintentar(fallo), true, `${clave}: se ofrece volver a intentarlo`);
    assert.equal(esMotorQueNoCoincide(fallo), false, `${clave}: se ofrece también la clasificación oficial`);
  }
});
