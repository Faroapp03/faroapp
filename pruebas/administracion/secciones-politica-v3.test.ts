import assert from 'node:assert/strict';
import { test } from 'node:test';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { consultarAutoridadSecciones, leerSeccionesPublicas } from '../../web/scripts/secciones-publicas.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const URL_POLITICA = 'https://ejemplo.invalid/secciones-v3.json';
const REVISION_ANTIGUA_ALTA = 99;
const REVISION_GUARDADA = 4;
const HTTP_CORRECTO = 200;
const HTTP_NO_DISPONIBLE = 503;
function entorno() {
  const mapa = new Map<string, Response>();
  let respuesta: Response | null = null;
  const copia = {
    match: async (k: string) => mapa.get(k)?.clone(),
    put: async (k: string, v: Response) => {
      mapa.set(k, v.clone());
    },
  };
  const opciones = {
    url: URL_POLITICA,
    memoria: { actual: null, porAutoridad: new Map(), soloMemoria: false },
    abrir: async () => copia,
    solicitar: async () => {
      if (!respuesta) {
        throw new TypeError('sin red');
      }
      return respuesta.clone();
    },
    bloquear: async <T>(f: () => Promise<T>): Promise<T> => f(),
  };
  const doc = (autoridad: string, revision: number, biblioteca = true) => ({
    version: VERSION_SECCIONES_PUBLICAS,
    autoridad,
    revision,
    secciones: { ...politicaSeccionesInicial(), biblioteca },
  });
  return {
    mapa,
    opciones,
    doc,
    servir: (d: unknown) => {
      respuesta = Response.json(d);
    },
    offline: () => {
      respuesta = null;
    },
  };
}
test('autoridades diferentes no comparan revisiones; la misma conserva revisión mayor y rechaza contradicción', async () => {
  const e = entorno();
  e.servir(e.doc(A, REVISION_ANTIGUA_ALTA, false));
  assert.equal((await consultarAutoridadSecciones(e.opciones)).documento?.revision, REVISION_ANTIGUA_ALTA);
  e.servir(e.doc(B, 0));
  assert.equal((await consultarAutoridadSecciones(e.opciones)).documento?.autoridad, B);
  e.servir(e.doc(B, 2, false));
  assert.equal((await consultarAutoridadSecciones(e.opciones)).documento?.revision, 2);
  e.servir(e.doc(B, 1, true));
  const antigua = await consultarAutoridadSecciones(e.opciones);
  assert.equal(antigua.documento?.revision, 2);
  assert.equal(antigua.documento?.secciones.biblioteca, false);
  e.servir(e.doc(B, 2, true));
  assert.equal((await consultarAutoridadSecciones(e.opciones)).fallo, true);
  e.offline();
  const guardada = await consultarAutoridadSecciones(e.opciones);
  assert.equal(guardada.documento?.autoridad, B);
  assert.equal(guardada.documento?.revision, 2);
});
test('sin respuesta válida ni marcador v3 no adopta legado', async () => {
  const e = entorno();
  e.mapa.set(
    'https://ejemplo.invalid/secciones.json?revision=99&estado=111111111',
    Response.json({ version: 2, revision: 99, secciones: politicaSeccionesInicial() }),
  );
  assert.equal((await consultarAutoridadSecciones(e.opciones)).documento, null);
  e.servir(e.doc(A, 0));
  assert.equal((await consultarAutoridadSecciones(e.opciones)).documento?.revision, 0);
  assert.ok(e.mapa.has('https://ejemplo.invalid/secciones.json?revision=99&estado=111111111'));
});
test('sin bloqueo común usa solo memoria y no escribe la copia compartida', async () => {
  const e = entorno();
  e.servir(e.doc(A, 0));
  const opciones = { ...e.opciones, bloquear: null };
  const resultado = await consultarAutoridadSecciones(opciones);
  assert.equal(resultado.documento?.revision, 0);
  assert.equal(e.mapa.size, 0);
  e.offline();
  assert.equal((await consultarAutoridadSecciones(opciones)).documento?.revision, 0);
});

test('el mismo lock serializa consulta, comparación y escritura entre contextos', async () => {
  const e = entorno();
  let cola: Promise<unknown> = Promise.resolve();
  const bloquear = <T>(accion: () => Promise<T>): Promise<T> => {
    const siguiente = cola.then(accion);
    cola = siguiente.catch(() => undefined);
    return siguiente;
  };
  const orden: string[] = [];
  let liberar = () => {};
  const primeraRed = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  const uno = {
    ...e.opciones,
    bloquear,
    memoria: { actual: null, porAutoridad: new Map(), soloMemoria: false },
    solicitar: async () => {
      orden.push('primera');
      await primeraRed;
      return Response.json(e.doc(A, 1, false));
    },
  };
  const dos = {
    ...e.opciones,
    bloquear,
    memoria: { actual: null, porAutoridad: new Map(), soloMemoria: false },
    solicitar: async () => {
      orden.push('segunda');
      return Response.json(e.doc(A, 0, true));
    },
  };
  const p1 = consultarAutoridadSecciones(uno);
  const p2 = consultarAutoridadSecciones(dos);
  await new Promise((resolver) => setImmediate(resolver));
  assert.deepEqual(orden, ['primera']);
  liberar();
  assert.equal((await p1).documento?.revision, 1);
  const segunda = await p2;
  assert.equal(segunda.documento?.revision, 1);
  assert.equal(segunda.documento?.secciones.biblioteca, false);
  assert.deepEqual(orden, ['primera', 'segunda']);
});

test('si falla la segunda escritura solo se usa la memoria propia y otro contexto no adopta parcial', async () => {
  const e = entorno();
  e.servir(e.doc(A, 1, false));
  const opciones = {
    ...e.opciones,
    abrir: async () => ({
      match: async (clave: string) => e.mapa.get(clave)?.clone(),
      put: async (clave: string, respuesta: Response) => {
        if (clave.endsWith('?actual=1')) {
          throw new Error('cuota');
        }
        e.mapa.set(clave, respuesta.clone());
      },
    }),
  };
  assert.equal((await consultarAutoridadSecciones(opciones)).documento?.secciones.biblioteca, false);
  e.offline();
  assert.equal((await consultarAutoridadSecciones(opciones)).documento?.secciones.biblioteca, false);
  const otraMemoria = { actual: null, porAutoridad: new Map(), soloMemoria: false };
  assert.equal((await consultarAutoridadSecciones({ ...opciones, memoria: otraMemoria })).documento, null);
});

test('si falla la lectura de Cache Storage sigue online con política propia en memoria', async () => {
  const e = entorno();
  e.servir(e.doc(A, 1, false));
  const opciones = {
    ...e.opciones,
    abrir: async () => ({
      match: async () => {
        throw new Error('denegado');
      },
      put: async () => {},
    }),
  };
  const activa = await consultarAutoridadSecciones(opciones);
  assert.equal(activa.documento?.secciones.biblioteca, false);
  e.offline();
  assert.equal((await consultarAutoridadSecciones(opciones)).documento?.secciones.biblioteca, false);
});

test('una respuesta que no se usa se lee y se cierra: la petición termina en lugar de quedar abortada', async () => {
  for (const [estado, tipo] of [
    [HTTP_NO_DISPONIBLE, 'application/json'],
    [HTTP_CORRECTO, 'text/html'],
  ] as const) {
    const e = entorno();
    let leida = false;
    // Sin cola previa: el flujo solo entrega datos cuando alguien lee la respuesta.
    const cuerpo = new ReadableStream(
      {
        pull(control) {
          control.enqueue(new TextEncoder().encode('{"error":"no disponible"}'));
          control.close();
          leida = true;
        },
      },
      { highWaterMark: 0 },
    );
    const resultado = await consultarAutoridadSecciones({
      ...e.opciones,
      solicitar: async () => new Response(cuerpo, { status: estado, headers: { 'content-type': tipo } }),
    });
    assert.equal(resultado.fallo, true);
    assert.ok(leida, `El cuerpo de la respuesta ${estado} ${tipo} quedó sin leer`);
  }
});
test('la copia v3 que ya guardaba el navegador se sigue leyendo sin conexión, con la Encuesta visible', async () => {
  const e = entorno();
  const { encuesta: _encuesta, ...sinEncuesta } = politicaSeccionesInicial();
  const guardadaV3 = { version: 3, autoridad: A, revision: REVISION_GUARDADA, secciones: sinEncuesta };
  e.mapa.set(`${URL_POLITICA}?actual=1`, Response.json(guardadaV3));
  e.mapa.set(`${URL_POLITICA}?autoridad=${A}`, Response.json(guardadaV3));
  e.offline();
  const guardada = await consultarAutoridadSecciones(e.opciones);
  assert.equal(guardada.documento?.revision, REVISION_GUARDADA);
  assert.equal(guardada.documento?.secciones.encuesta, true);
});
test('cada versión pública exige las claves de su contrato: la v4 lleva el interruptor de la Encuesta', () => {
  const { encuesta: _encuesta, ...sinEncuesta } = politicaSeccionesInicial();
  const oculta = { ...politicaSeccionesInicial(), encuesta: false };
  assert.equal(
    leerSeccionesPublicas({ version: VERSION_SECCIONES_PUBLICAS, autoridad: A, revision: 1, secciones: oculta })
      .secciones.encuesta,
    false,
  );
  assert.throws(() =>
    leerSeccionesPublicas({ version: VERSION_SECCIONES_PUBLICAS, autoridad: A, revision: 1, secciones: sinEncuesta }),
  );
  assert.throws(() => leerSeccionesPublicas({ version: 3, autoridad: A, revision: 1, secciones: oculta }));
});
