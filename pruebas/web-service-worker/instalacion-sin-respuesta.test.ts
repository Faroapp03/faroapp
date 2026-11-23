// La copia sin conexión con una petición que deja de avanzar, con temporizadores falsos: cada archivo se corta tras
// 20 s sin recibir nada (ni la respuesta ni un trozo de su cuerpo), como las descargas del paquete. La instalación
// falla limpia (sin la copia provisional ni la de la versión), sin activar la versión (ni `skipWaiting` ni
// `clients.claim`), y un segundo intento con red la instala entera; una copia anterior de la misma versión no se toca;
// un adorno colgado no la retiene; una reparación colgada termina con su fallo. Un cuerpo lento que sigue recibiendo
// trozos no se corta.
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { huellaDe, servicio } from './ayudas.ts';

/** El plazo de service-worker.js sin recibir datos. */
const DESCARGA_PARADA_MS = 20_000;
const CASI = 1;
/** Un cuerpo lento: un trozo cada 15 s durante 4 minutos, por debajo del plazo. */
const CADA_TROZO_MS = 15_000;
const TROZOS = 16;
const BASE = 'https://ejemplo.invalid/';
const LENTO = 'estilos/base.css';
const COLGADO = 'sin-conexion.html';
const ADORNO = 'imagenes/foto.webp';
const ARCHIVOS = ['inicio.html', COLGADO, LENTO];
/** Lo que entrega la red de la prueba por cada archivo: su ruta, salvo el cuerpo lento, que son TROZOS letras «x». */
const cuerpoDe = (ruta: string) => (ruta === LENTO ? 'x'.repeat(TROZOS) : ruta);
const vuelta = () => new Promise((listo) => setImmediate(listo));

type Opciones = RequestInit | undefined;
type Sw = ReturnType<typeof servicio>;

const tipoDe = (ruta: string) => (ruta.endsWith('.html') ? 'text/html' : 'application/octet-stream');
const rutaDe = (url: string) => new URL(url).pathname.slice(new URL(BASE).pathname.length);

/** La respuesta normal de la red de la prueba a `ruta`, de una vez. */
const normal = (ruta: string) => new Response(cuerpoDe(ruta), { headers: { 'content-type': tipoDe(ruta) } });

/** Una respuesta que no llega nunca, salvo que se corte la petición. */
function sinRespuesta(_ruta: string, opciones: Opciones): Promise<Response> {
  return new Promise((_, rechazar) => {
    opciones?.signal?.addEventListener('abort', () => rechazar(opciones.signal?.reason));
  });
}

/** Las cabeceras llegan, el cuerpo manda un trozo y se para; solo se corta si se aborta la petición. */
function cuerpoParado(ruta: string, opciones: Opciones): Response {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(control) {
      opciones?.signal?.addEventListener('abort', () => control.error(opciones.signal?.reason));
      control.enqueue(new TextEncoder().encode(cuerpoDe(ruta).slice(0, 1)));
    },
  });
  return new Response(cuerpo, { headers: { 'content-type': tipoDe(ruta) } });
}

/** Un cuerpo que manda una letra cada `cadaMs` con los temporizadores de la prueba, y se corta si se aborta. */
function cuerpoLento(ruta: string, cadaMs: number, opciones: Opciones): Response {
  const texto = cuerpoDe(ruta);
  const cuerpo = new ReadableStream<Uint8Array>({
    start(control) {
      opciones?.signal?.addEventListener('abort', () => control.error(opciones.signal?.reason));
      let enviados = 0;
      const siguiente = () => {
        control.enqueue(new TextEncoder().encode(texto.charAt(enviados)));
        enviados += 1;
        if (enviados === texto.length) {
          control.close();
        } else {
          setTimeout(siguiente, cadaMs);
        }
      };
      setTimeout(siguiente, cadaMs);
    },
  });
  return new Response(cuerpo, { headers: { 'content-type': tipoDe(ruta) } });
}

/**
 * El service worker real con la red de la prueba: `colgar` dice qué hacer con una ruta (undefined: contestar normal).
 * Los temporizadores son los de la prueba.
 */
function conRed(t: TestContext, archivos = ARCHIVOS) {
  const sw = servicio(BASE, { archivos, cuerpoDe });
  const red: { colgar?: (ruta: string, opciones: Opciones) => Response | Promise<Response> | undefined } = {};
  function alPedir(objetivo: string, simular: (ruta: string, opciones: Opciones) => Response | Promise<Response>) {
    const pedida = Promise.withResolvers<void>();
    red.colgar = (ruta, opciones) => {
      if (ruta === objetivo) {
        const respuesta = simular(ruta, opciones);
        pedida.resolve();
        return respuesta;
      }
      return undefined;
    };
    return pedida.promise;
  }
  sw.red.respuesta = (url, opciones) => {
    const ruta = rutaDe(url);
    return red.colgar?.(ruta, opciones) ?? normal(ruta);
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  sw.conectar();
  return { sw, red, alPedir };
}

/** Cómo acaba una promesa, sin esperarla: «pendiente» mientras no acaba. */
function seguir(promesa: Promise<unknown>) {
  const estado: { como: 'pendiente' | 'cumplida' | 'rechazada'; error?: unknown } = {
    como: 'pendiente',
  };
  const fin = promesa.then(
    () => Object.assign(estado, { como: 'cumplida' }),
    (error: unknown) => Object.assign(estado, { como: 'rechazada', error }),
  );
  return { estado, fin };
}

/** Lo que tiene una copia: cada dirección con su texto. */
async function contenido(sw: Sw, nombre: string) {
  const copia = sw.guardadas.get(nombre) ?? new Map<string, Response>();
  return Object.fromEntries(
    await Promise.all([...copia.entries()].map(async ([clave, r]) => [clave, await r.clone().text()] as const)),
  );
}

/** La copia entera de esta versión: cada archivo con lo que entrega la red, que es lo que da su huella. */
const copiaEntera = (sw: Sw, archivos = ARCHIVOS) =>
  Object.fromEntries(archivos.map((ruta) => [sw.urlDe(ruta), cuerpoDe(ruta)]));

const provisional = (sw: Sw) => `${sw.nombreCopia}:provisional`;
const esPorElPlazo = (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError';

/** Pasa el plazo con la instalación en curso: un instante antes sigue pendiente; al cumplirse, rechaza por el plazo. */
async function pasarElPlazo(t: TestContext, { estado, fin }: ReturnType<typeof seguir>) {
  await vuelta();
  t.mock.timers.tick(DESCARGA_PARADA_MS - CASI);
  await vuelta();
  assert.equal(estado.como, 'pendiente', 'no se corta antes del plazo');
  t.mock.timers.tick(CASI);
  await fin;
  assert.equal(estado.como, 'rechazada', 'la instalación no acaba tras el plazo');
  assert.ok(esPorElPlazo(estado.error), `rechaza por el plazo: ${String(estado.error)}`);
}

/** Sin la copia provisional ni la de esta versión. */
function sinCopias(sw: Sw) {
  assert.equal(sw.guardadas.has(provisional(sw)), false, 'sin copia provisional');
  assert.equal(sw.guardadas.has(sw.nombreCopia), false, 'sin copia de la versión');
}

test('una página que no responde nunca: a los 20 s la instalación falla sin provisional ni copia', async (t) => {
  const { sw, alPedir } = conRed(t);
  const peticion = alPedir(COLGADO, sinRespuesta);
  const estado = seguir(sw.instalar());
  await peticion;
  assert.ok(sw.peticiones.includes(sw.urlDe(COLGADO)));
  await pasarElPlazo(t, estado);
  sinCopias(sw);
  assert.deepEqual([sw.saltos, sw.reclamaciones], [0, 0]);
});

test('las cabeceras llegan y el cuerpo se para: a los 20 s del último trozo la instalación falla limpia', async (t) => {
  const { sw, alPedir } = conRed(t);
  const peticion = alPedir(COLGADO, cuerpoParado);
  const estado = seguir(sw.instalar());
  await peticion;
  await pasarElPlazo(t, estado);
  sinCopias(sw);
});

test('un cuerpo lento que recibe un trozo cada 15 s durante minutos no se corta y la copia se instala entera', async (t) => {
  const { sw, alPedir } = conRed(t);
  const peticion = alPedir(LENTO, (ruta, opciones) => cuerpoLento(ruta, CADA_TROZO_MS, opciones));
  const { estado, fin } = seguir(sw.instalar());
  await peticion;
  for (let trozo = 0; trozo < TROZOS; trozo += 1) {
    await vuelta();
    assert.equal(estado.como, 'pendiente', `sigue recibiendo: trozo ${trozo}`);
    t.mock.timers.tick(CADA_TROZO_MS);
  }
  await fin;
  assert.equal(estado.como, 'cumplida', String(estado.error));
  assert.ok(CADA_TROZO_MS * TROZOS > DESCARGA_PARADA_MS * 2, 'dura más que varios plazos seguidos');
  assert.deepEqual(await contenido(sw, sw.nombreCopia), copiaEntera(sw));
  assert.equal(sw.guardadas.has(provisional(sw)), false);
});

test('tras el fallo por el plazo, la instalación siguiente con red normal guarda la copia entera con sus huellas', async (t) => {
  const { sw, red, alPedir } = conRed(t);
  const peticion = alPedir(COLGADO, sinRespuesta);
  const estado = seguir(sw.instalar());
  await peticion;
  await pasarElPlazo(t, estado);
  sinCopias(sw);
  delete red.colgar;
  await sw.instalar();
  const guardada = await contenido(sw, sw.nombreCopia);
  assert.deepEqual(guardada, copiaEntera(sw));
  const huellas = new Map(sw.evaluar('[...HUELLAS_DE_LA_COPIA]') as [string, string][]);
  for (const [clave, texto] of Object.entries(guardada)) {
    assert.equal(huellaDe(texto), huellas.get(clave), clave);
  }
  assert.equal(sw.guardadas.has(provisional(sw)), false);
});

test('con una copia anterior de la misma versión, el fallo por el plazo no la borra ni la cambia', async (t) => {
  const { sw, alPedir } = conRed(t);
  await sw.instalar();
  const anterior = sw.guardadas.get(sw.nombreCopia);
  const antes = await contenido(sw, sw.nombreCopia);
  assert.deepEqual(antes, copiaEntera(sw));
  const peticion = alPedir(COLGADO, sinRespuesta);
  const estado = seguir(sw.instalar());
  await peticion;
  await pasarElPlazo(t, estado);
  assert.equal(sw.guardadas.get(sw.nombreCopia), anterior);
  assert.deepEqual(await contenido(sw, sw.nombreCopia), antes);
  assert.equal(sw.guardadas.has(provisional(sw)), false);
  assert.equal(sw.borradas.includes(sw.nombreCopia), false);
});

test('un adorno que no responde no retiene la instalación: a los 20 s se queda fuera y la copia se instala', async (t) => {
  const archivos = [...ARCHIVOS, ADORNO];
  const { sw, alPedir } = conRed(t, archivos);
  const peticion = alPedir(ADORNO, sinRespuesta);
  const instalacion = sw.instalar();
  await peticion;
  assert.ok(sw.peticiones.includes(sw.urlDe(ADORNO)));
  t.mock.timers.tick(DESCARGA_PARADA_MS);
  await instalacion;
  assert.deepEqual(await contenido(sw, sw.nombreCopia), copiaEntera(sw));
});

/** Pide la reparación como una página y sigue su respuesta (sin los avisos de progreso). */
function reparar(sw: Sw, id = 1) {
  const recibidos: unknown[] = [];
  let trabajo = Promise.resolve<unknown>(undefined);
  sw.oyentes.get('message')?.({
    data: { type: 'REPARAR_COPIA', id },
    source: {
      id: 'pestana',
      postMessage: (mensaje: { type?: unknown }) => {
        if (mensaje.type !== 'PROGRESO_DE_LA_REPARACION') {
          recibidos.push(JSON.parse(JSON.stringify(mensaje)));
        }
      },
    },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  return { recibidos, trabajo };
}

test('una reparación con una petición colgada termina con su fallo, sin tocar la copia y con lo ya bajado', async (t) => {
  const { sw, alPedir } = conRed(t);
  await sw.instalar();
  const antes = await contenido(sw, sw.nombreCopia);
  const peticion = alPedir(COLGADO, sinRespuesta);
  const { recibidos, trabajo } = reparar(sw);
  await peticion;
  t.mock.timers.tick(DESCARGA_PARADA_MS - CASI);
  await vuelta();
  assert.deepEqual(recibidos, [], 'no contesta antes del plazo');
  t.mock.timers.tick(CASI);
  await trabajo;
  assert.deepEqual(recibidos, [{ type: 'COPIA_REPARADA', id: 1, ok: false, motivo: 'sin-completar' }]);
  assert.deepEqual(await contenido(sw, sw.nombreCopia), antes);
  // La provisional de la reparación se conserva con lo que llegó entero, para reanudar sin volver a bajarlo.
  const enCurso = await contenido(sw, `${sw.nombreCopia}:reparacion`);
  assert.deepEqual(
    enCurso,
    copiaEntera(
      sw,
      ARCHIVOS.filter((ruta) => ruta !== COLGADO),
    ),
  );
});
