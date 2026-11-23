// Ensayo sin navegador del servidor del ensayo del presupuesto (presupuesto-servidor.mjs): una respuesta que el
// navegador corta a medias por HTTP/2 (RST_STREAM) mientras otras dos siguen se da por terminada y cortada, desde el
// corte no pide ningún turno del enlace ni escribe ningún trozo, y las otras dos se reparten la bajada sin pasar del
// límite global; cortada mientras espera su turno, no escribe el trozo de ese turno. Una respuesta leída entera se
// sirve completa. Un corte antes de las cabeceras, también si el servidor de arriba falla después o se cierra la
// sesión entera, termina la respuesta sin dejar ninguna promesa sin tratar. El servidor del Worker oficial anota cada
// petición (con un Worker de prueba: el cotejo del Worker real es presupuesto-worker-oficial.test.mjs).
// Todo en loopback, con servidores de arriba propios y un cliente HTTP/2 de Node.
//
//   node --test pruebas/navegadores/presupuesto-servidor-cortes.test.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as pedirHttp } from 'node:http';
import { connect, constants } from 'node:http2';
import { after, before, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import {
  ahora,
  crearServidorDelEnsayo,
  crearServidorOficial,
  ENTORNO_SINTETICO_DEL_OFICIAL,
  RUTAS_DEL_OFICIAL,
  TROZO,
} from './presupuesto-servidor.mjs';

/** Un cuerpo que no se comprime y no cabe en la ventana inicial de un stream (64 KiB). */
const BYTES_DEL_CUERPO = 2_000_000;
const CUERPO = randomBytes(BYTES_DEL_CUERPO);
/** El enlace limitado: tres cuerpos tardan unos 6 s. */
const BYTES_POR_SEGUNDO = 1_000_000;
const MS_POR_SEGUNDO = 1000;
/**
 * Lo que el ritmo medido puede pasar del límite: el enlace es un único turno tras otro, así que en cualquier intervalo
 * solo puede colarse el trozo cuyo turno empezó antes; se admiten dos (también el que el cliente aún no ha contado al
 * empezar) y 50 ms de retraso de los temporizadores.
 */
const RETRASO_DE_TEMPORIZADORES_MS = 50;
const HOLGURA_BYTES = 2 * TROZO + (BYTES_POR_SEGUNDO * RETRASO_DE_TEMPORIZADORES_MS) / MS_POR_SEGUNDO;
/** Lo que el ritmo de las que siguen no puede bajar del límite: la parte de la cortada pasa a ellas. */
const APROVECHAMIENTO_MINIMO = 0.8;
/** Lo que espera el cliente con la respuesta sin leer antes de cortarla. */
const ANTES_DEL_CORTE_MS = 500;
/** Lo que se da al servidor para anotar el corte o servir el cuerpo entero. */
const PLAZO_MS = 15_000;
const SILENCIO_MS = 100;
/** Un enlace de un trozo por segundo: la respuesta pasa su primer segundo esperando el turno de su primer trozo. */
const UN_TROZO_POR_SEGUNDO = TROZO;
const A_MITAD_DEL_TURNO_MS = 500;
/** Lo que tarda el servidor de arriba de los cortes antes de las cabeceras, y la latencia del ensayo delante de él. */
const ESPERA_DE_ARRIBA_MS = 200;
/** Lo que espera el cliente antes de cortar: antes de que lleguen las cabeceras. */
const ANTES_DE_LAS_CABECERAS_MS = 50;

let arriba;
let ensayo;

before(async () => {
  arriba = createServer((_req, res) => {
    res.writeHead(ESTADO_HTTP.correcto, { 'content-type': 'application/octet-stream' });
    res.end(CUERPO);
  });
  arriba.listen(0, '127.0.0.1');
  await once(arriba, 'listening');
  ensayo = await crearServidorDelEnsayo({
    origenDeArriba: `http://127.0.0.1:${arriba.address().port}`,
    condicion: { latenciaMs: 0 },
    identidad: IDENTIDAD_WEB,
    bytesPorSegundo: BYTES_POR_SEGUNDO,
  });
});

after(async () => {
  await ensayo.cerrar();
  arriba.close();
});

/** Una sesión HTTP/2 con el servidor del ensayo, que acepta su certificado sintético. */
async function sesion(servidor = ensayo) {
  const cliente = connect(servidor.origen, { rejectUnauthorized: false });
  await once(cliente, 'connect');
  return cliente;
}

/** Pide `ruta` y espera sus cabeceras. */
async function pedir(cliente, ruta) {
  const peticion = cliente.request({ ':path': ruta, 'user-agent': IDENTIDAD_WEB['User-Agent'] });
  const [cabeceras] = await once(peticion, 'response');
  assert.equal(cabeceras[':status'], ESTADO_HTTP.correcto);
  return peticion;
}

/** Lee una respuesta entera y anota cuándo llega cada trozo (ms de época, como el registro del servidor). */
function leer(peticion) {
  const llegadas = [];
  const fin = once(peticion, 'end');
  peticion.on('data', (trozo) => {
    llegadas.push({ t: ahora(), bytes: trozo.length });
  });
  return { llegadas, fin };
}

/** La entrada de `ruta` en el registro del servidor cuando tiene su fin, hasta PLAZO_MS. */
async function terminada(ruta, servidor = ensayo) {
  const limite = ahora() + PLAZO_MS;
  while (ahora() < limite) {
    const entrada = servidor.registro.find((e) => e.ruta === ruta);
    if (entrada?.fin) {
      return entrada;
    }
    await new Promise((ok) => setTimeout(ok, SILENCIO_MS));
  }
  return servidor.registro.find((e) => e.ruta === ruta);
}

test('una respuesta cortada por HTTP/2 deja de enviar y las demás siguen dentro del límite global', async (t) => {
  const cliente = await sesion();
  try {
    const cortada = await pedir(cliente, '/cortada');
    cortada.pause();
    const siguen = await Promise.all(['/sigue-1', '/sigue-2'].map((ruta) => pedir(cliente, ruta)));
    const lecturas = siguen.map(leer);
    await new Promise((ok) => setTimeout(ok, ANTES_DEL_CORTE_MS));
    const corte = ahora();
    cortada.close(constants.NGHTTP2_CANCEL);
    await Promise.all(lecturas.map((l) => l.fin));

    const entrada = await terminada('/cortada');
    assert.ok(entrada?.fin, 'La respuesta cortada termina en el servidor del ensayo');
    assert.equal(entrada.completa, false, 'La respuesta cortada se anota como no completa');
    assert.ok(entrada.envio.bytes < BYTES_DEL_CUERPO, 'La respuesta cortada no se envía entera');
    assert.equal(entrada.servidos, entrada.envio.bytes, 'Lo servido de la cortada es lo escrito, no su tamaño');
    assert.equal(entrada.tamano, BYTES_DEL_CUERPO, 'Su tamaño sigue siendo el de la respuesta entera');
    assert.equal(entrada.envio.turnosTrasElCierre, 0, 'Desde el corte no pide ningún turno del enlace');
    assert.equal(entrada.envio.bytesTrasElCierre, 0, 'Desde el corte no escribe ningún trozo');
    const enVuelo = entrada.envio.turnos - Math.ceil(entrada.envio.bytes / TROZO);
    assert.ok(enVuelo === 0 || enVuelo === 1, `Como mucho el turno en curso al cortar queda sin escribir: ${enVuelo}`);
    assert.equal(await ensayo.esperarCalma(SILENCIO_MS, PLAZO_MS), true, 'Sin respuestas en curso tras el corte');

    for (const [indice, lectura] of lecturas.entries()) {
      const recibidos = lectura.llegadas.reduce((suma, l) => suma + l.bytes, 0);
      assert.equal(recibidos, BYTES_DEL_CUERPO, `La respuesta ${indice + 1} que sigue llega entera`);
    }
    const tras = lecturas.flatMap((l) => l.llegadas).filter((l) => l.t > corte);
    const bytesTras = tras.reduce((suma, l) => suma + l.bytes, 0);
    const segundos = (Math.max(...tras.map((l) => l.t)) - corte) / MS_POR_SEGUNDO;
    const permitidos = BYTES_POR_SEGUNDO * segundos + HOLGURA_BYTES;
    assert.ok(bytesTras <= permitidos, `Tras el corte, ${bytesTras} B en ${segundos} s: no más de ${permitidos}`);
    t.diagnostic(`tras el corte: ${bytesTras} B en ${segundos} s (${Math.round(bytesTras / segundos)} B/s)`);
    t.diagnostic(`cortada: ${JSON.stringify(entrada.envio)}`);
    const minimos = APROVECHAMIENTO_MINIMO * BYTES_POR_SEGUNDO * segundos;
    assert.ok(bytesTras >= minimos, `Tras el corte, ${bytesTras} B en ${segundos} s: al menos ${minimos}`);
  } finally {
    cliente.close();
  }
});

test('una respuesta cortada mientras espera su turno del enlace no escribe el trozo de ese turno', async () => {
  const lento = await crearServidorDelEnsayo({
    origenDeArriba: `http://127.0.0.1:${arriba.address().port}`,
    condicion: { latenciaMs: 0 },
    identidad: IDENTIDAD_WEB,
    bytesPorSegundo: UN_TROZO_POR_SEGUNDO,
  });
  const cliente = await sesion(lento);
  try {
    const peticion = await pedir(cliente, '/en-su-turno');
    await new Promise((ok) => setTimeout(ok, A_MITAD_DEL_TURNO_MS));
    peticion.close(constants.NGHTTP2_CANCEL);
    const entrada = await terminada('/en-su-turno', lento);
    assert.equal(entrada?.completa, false, 'La respuesta cortada se anota como no completa');
    assert.deepEqual(
      entrada.envio,
      { turnos: 1, bytes: 0, turnosTrasElCierre: 0, bytesTrasElCierre: 0 },
      'Pidió el turno de su primer trozo antes del corte y no lo escribe después',
    );
    assert.equal(entrada.servidos, 0, 'Sin ningún trozo escrito, no se ha servido nada');
  } finally {
    cliente.close();
    await lento.cerrar();
  }
});

test('una respuesta que el navegador lee entera por HTTP/2 se sirve completa', async () => {
  const cliente = await sesion();
  try {
    const lectura = leer(await pedir(cliente, '/entera'));
    await lectura.fin;
    const entrada = await terminada('/entera');
    assert.equal(
      lectura.llegadas.reduce((suma, l) => suma + l.bytes, 0),
      BYTES_DEL_CUERPO,
      'Llega el cuerpo entero',
    );
    assert.equal(entrada?.completa, true, 'La respuesta entera se anota como completa');
    assert.equal(entrada.envio.bytes, BYTES_DEL_CUERPO, 'Se escriben todos sus bytes');
    assert.equal(entrada.servidos, BYTES_DEL_CUERPO, 'Lo servido es la respuesta entera');
    assert.equal(entrada.envio.turnos, Math.ceil(BYTES_DEL_CUERPO / TROZO), 'Un turno por trozo');
  } finally {
    cliente.close();
  }
});

/** Un servidor de arriba que tarda en responder; en las rutas `/falla…` corta la conexión en lugar de responder. */
async function arribaQueTarda() {
  const servidor = createServer((req, res) => {
    setTimeout(() => {
      if (req.url?.startsWith('/falla')) {
        res.socket?.destroy();
        return;
      }
      res.writeHead(ESTADO_HTTP.correcto, { 'content-type': 'text/plain' });
      res.end('hola');
    }, ESPERA_DE_ARRIBA_MS);
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  return servidor;
}

/** Pide `ruta` y la corta antes de sus cabeceras: el stream (RST_STREAM) o, con `sesionEntera`, la sesión entera. */
async function cortarAntesDeLasCabeceras(servidor, ruta, sesionEntera) {
  const cliente = await sesion(servidor);
  cliente.on('error', () => {});
  const peticion = cliente.request({ ':path': ruta, 'user-agent': IDENTIDAD_WEB['User-Agent'] });
  peticion.on('error', () => {});
  let cabeceras = false;
  peticion.on('response', () => {
    cabeceras = true;
  });
  await new Promise((ok) => setTimeout(ok, ANTES_DE_LAS_CABECERAS_MS));
  if (sesionEntera) {
    cliente.destroy();
  } else {
    peticion.close(constants.NGHTTP2_CANCEL);
    cliente.close();
  }
  return () => cabeceras;
}

/** Lo anotado de los tres cortes: la respuesta que esperaba y las dos con el fallo de arriba tras el corte. */
async function comprobarCortesAntesDeLasCabeceras(servidor) {
  const esperando = await terminada('/esperando', servidor);
  assert.ok(esperando?.fin, 'La respuesta cortada mientras esperaba termina');
  assert.equal(esperando.completa, false, 'Se anota como no completa');
  assert.deepEqual(
    { turnos: esperando.envio.turnos, bytes: esperando.envio.bytes },
    { turnos: 0, bytes: 0 },
    'No pide turnos del enlace ni escribe nada',
  );
  assert.equal(esperando.servidos, 0, 'No se ha servido nada');
  for (const ruta of ['/falla-tras-el-corte', '/falla-sin-sesion']) {
    const entrada = await terminada(ruta, servidor);
    assert.ok(entrada?.fin, `${ruta}: el fallo de arriba tras el corte termina la respuesta`);
    assert.equal(entrada.completa, undefined, `${ruta}: no llega a enviarse`);
    assert.equal(entrada.servidos, 0, `${ruta}: no se ha servido nada`);
  }
  assert.equal(servidor.errores.length, 2, 'Los dos fallos de arriba quedan anotados');
  assert.equal(await servidor.esperarCalma(SILENCIO_MS, PLAZO_MS), true, 'Sin respuestas en curso');
}

/** Tras los cortes, el servidor del ensayo sirve entera una respuesta nueva. */
async function comprobarQueSigueSirviendo(servidor) {
  const cliente = await sesion(servidor);
  try {
    const lectura = leer(await pedir(cliente, '/despues'));
    await lectura.fin;
    assert.equal((await terminada('/despues', servidor))?.completa, true, 'Después, el servidor sigue sirviendo');
  } finally {
    cliente.close();
  }
}

test('un corte antes de las cabeceras termina la respuesta sin dejar promesas sin tratar', async () => {
  const sinTratar = [];
  const anotar = (error) => sinTratar.push(String(error));
  process.on('unhandledRejection', anotar);
  process.on('uncaughtException', anotar);
  const arribaPropio = await arribaQueTarda();
  const servidor = await crearServidorDelEnsayo({
    origenDeArriba: `http://127.0.0.1:${arribaPropio.address().port}`,
    condicion: { latenciaMs: ESPERA_DE_ARRIBA_MS },
    identidad: IDENTIDAD_WEB,
    bytesPorSegundo: BYTES_POR_SEGUNDO,
  });
  try {
    const recibidas = [
      await cortarAntesDeLasCabeceras(servidor, '/esperando', false),
      await cortarAntesDeLasCabeceras(servidor, '/falla-tras-el-corte', false),
      await cortarAntesDeLasCabeceras(servidor, '/falla-sin-sesion', true),
    ];
    await comprobarCortesAntesDeLasCabeceras(servidor);
    assert.deepEqual(
      recibidas.map((recibida) => recibida()),
      [false, false, false],
      'Ningún corte recibe cabeceras',
    );
    await comprobarQueSigueSirviendo(servidor);
    await new Promise((ok) => setTimeout(ok, SILENCIO_MS));
    assert.deepEqual(sinTratar, [], 'Ninguna promesa rechazada ni excepción sin tratar');
  } finally {
    process.off('unhandledRejection', anotar);
    process.off('uncaughtException', anotar);
    await servidor.cerrar();
    arribaPropio.close();
  }
});

/** Una petición HTTP/1.1 al servidor oficial con su destino; devuelve el estado. */
function pedirAlOficial(origen, ruta, destino) {
  return new Promise((ok, fallo) => {
    const salida = pedirHttp(`${origen}${ruta}`, { headers: { 'sec-fetch-dest': destino } }, (respuesta) => {
      respuesta.resume();
      respuesta.once('end', () => ok(respuesta.statusCode));
    });
    salida.once('error', fallo);
    salida.end();
  });
}

/** Un Worker de prueba: 200 en la portada y el acceso si recibe las variables sintéticas y su ASSETS; 404 en lo demás. */
const ASSETS_DE_PRUEBA = { fetch: async () => new Response(null, { status: ESTADO_HTTP.noEncontrado }) };
const WORKER_DE_PRUEBA = {
  default: {
    fetch: async (peticion, entorno) => {
      const propias =
        entorno.ASSETS === ASSETS_DE_PRUEBA &&
        entorno.FARO_SESION_PORTAL === ENTORNO_SINTETICO_DEL_OFICIAL.FARO_SESION_PORTAL;
      const ruta = new URL(peticion.url).pathname;
      const estado = propias && RUTAS_DEL_OFICIAL.includes(ruta) ? ESTADO_HTTP.correcto : ESTADO_HTTP.noEncontrado;
      return new Response('<!doctype html>', { status: estado, headers: { 'content-type': 'text/html' } });
    },
  },
};

test('el servidor del Worker oficial anota cada petición con su ruta, su método, su destino y su estado', async () => {
  const oficial = await crearServidorOficial({ worker: WORKER_DE_PRUEBA, assets: ASSETS_DE_PRUEBA });
  try {
    assert.equal(await pedirAlOficial(oficial.origen, '/', 'document'), ESTADO_HTTP.correcto, 'La portada');
    assert.equal(await pedirAlOficial(oficial.origen, '/acceso-web', 'document'), ESTADO_HTTP.correcto, 'El acceso');
    assert.equal(await pedirAlOficial(oficial.origen, '/otra.js?v=1', 'script'), ESTADO_HTTP.noEncontrado, 'Otra ruta');
    assert.deepEqual(oficial.peticiones, [
      { ruta: '/', metodo: 'GET', destino: 'document', estado: ESTADO_HTTP.correcto },
      { ruta: '/acceso-web', metodo: 'GET', destino: 'document', estado: ESTADO_HTTP.correcto },
      { ruta: '/otra.js', metodo: 'GET', destino: 'script', estado: ESTADO_HTTP.noEncontrado },
    ]);
    assert.deepEqual(oficial.errores, []);
  } finally {
    await oficial.cerrar();
  }
});
