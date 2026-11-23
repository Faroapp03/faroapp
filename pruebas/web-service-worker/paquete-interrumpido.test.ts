// La copia del paquete interrumpida: el service worker se detiene a mitad (el navegador lo para y sus descargas se
// quedan sin terminar, o se cierra el navegador) y, al volver a ponerse en marcha con la misma copia, sigue donde se
// quedó (reanudación por archivos). Lo guardado y comprobado no se vuelve a bajar, lo que se quedó a medias no entra
// (se baja entero), y la copia de la versión anterior sigue entera y sirviendo hasta que la nueva está completa. Las
// peticiones que una página repite mientras espera se reúnen en el intento en curso, con una sola respuesta para ella.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { type TestContext, test } from 'node:test';
import { pedir, prepararPaquete, servicio } from './ayudas.ts';

const BASE = 'https://ejemplo.invalid/';
const CIFRAS_VERSION = 16;
const ARCHIVOS = 6;
const MANIFIESTO = 'manifiesto.json';
const BIEN = 200;
/** Lo que lleva cada archivo, además de su número, para que tenga una mitad que se pueda cortar. */
const RELLENO = 64;
/** Los archivos que cambian en la versión nueva del paquete: la segunda mitad (parte-3, parte-4 y parte-5). */
const CAMBIAN = Array.from({ length: ARCHIVOS / 2 }, (_, indice) => ARCHIVOS / 2 + indice);
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const vuelta = () => new Promise((listo) => setImmediate(listo));
const copiado = (valor: unknown) => JSON.parse(JSON.stringify(valor));

/** Cómo entrega la red de la prueba un archivo del paquete. */
type Entrega =
  /** Entero. */
  | 'entero'
  /** La mitad del cuerpo y después nada, sin terminar nunca: una descarga en curso cuando el navegador lo para. */
  | 'a-medias'
  /** La mitad del cuerpo y después un error: la conexión se corta. */
  | 'cortado'
  /** La mitad del cuerpo como si fuera todo: una respuesta truncada que acaba bien. */
  | 'corto'
  /** Ninguna respuesta, nunca. */
  | 'sin-respuesta';

/** Un paquete de ARCHIVOS archivos; los de `distintos` cambian de contenido con `sello`, como en otra versión. */
function paqueteDePrueba(sello = '', distintos: readonly number[] = []) {
  const datos = new Map(
    Array.from({ length: ARCHIVOS }, (_, indice) => [
      `parte-${indice}.json`,
      JSON.stringify({ parte: indice, sello: distintos.includes(indice) ? sello : '', relleno: 'x'.repeat(RELLENO) }),
    ]),
  );
  const manifiesto = JSON.stringify(
    Object.fromEntries([...datos].map(([archivo, texto]) => [archivo, { sha256: huella(texto) }])),
  );
  return { datos, manifiesto, version: huella(manifiesto).slice(0, CIFRAS_VERSION) };
}
type Paquete = ReturnType<typeof paqueteDePrueba>;

/** Un cuerpo con la primera mitad de `texto`; después, según `entrega`, nada, un error o el final. */
function mitad(texto: string, entrega: Entrega, opciones?: RequestInit) {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(control) {
      opciones?.signal?.addEventListener('abort', () => control.error(opciones.signal?.reason));
      control.enqueue(new TextEncoder().encode(texto.slice(0, texto.length / 2)));
      if (entrega === 'cortado') {
        control.error(new TypeError('Conexión cortada'));
      } else if (entrega === 'corto') {
        control.close();
      }
    },
  });
  return new Response(cuerpo, { status: BIEN });
}

/**
 * La red de un arranque del service worker: sirve `paquete` según `entrega` y cuenta cuántas veces se pide cada
 * archivo (por su nombre).
 */
function red(
  sw: ReturnType<typeof servicio>,
  paquete: Paquete,
  entrega: (archivo: string) => Entrega = () => 'entero',
) {
  const pedidos = new Map<string, number>();
  sw.conectar();
  sw.red.respuesta = (url, opciones) => {
    const archivo = url.split('/').at(-1) ?? '';
    pedidos.set(archivo, (pedidos.get(archivo) ?? 0) + 1);
    if (archivo === MANIFIESTO) {
      return new Response(paquete.manifiesto);
    }
    const texto = paquete.datos.get(archivo) ?? '';
    const como = entrega(archivo);
    if (como === 'sin-respuesta') {
      return new Promise((_, rechazar) => {
        opciones?.signal?.addEventListener('abort', () => rechazar(opciones.signal?.reason));
      });
    }
    return como === 'entero' ? new Response(texto, { status: BIEN }) : mitad(texto, como, opciones);
  };
  return pedidos;
}

/** Los nombres de los archivos guardados en la copia del paquete de `version`. */
function guardados(sw: ReturnType<typeof servicio>, version: string) {
  const copia = sw.guardadas.get(`faro-paquete-${version}`);
  return [...(copia?.keys() ?? [])].map((clave) => clave.split('/').at(-1) ?? '').sort();
}

/** Se registra antes de empezar la copia y se resuelve al guardar todos los archivos pedidos. */
async function hastaQueGuarde(sw: ReturnType<typeof servicio>, version: string, archivos: readonly string[]) {
  const pendientes = new Set(archivos.map((archivo) => sw.urlDe(`paquete/${version}/${archivo}`)));
  await new Promise<void>((listo) => {
    sw.copias.despuesDeGuardar = (nombre, clave) => {
      if (nombre === `faro-paquete-${version}` && pendientes.delete(clave) && pendientes.size === 0) {
        listo();
      }
    };
  });
  delete sw.copias.despuesDeGuardar;
  assert.deepEqual(
    guardados(sw, version).filter((a) => archivos.includes(a)),
    [...archivos].sort(),
  );
}

/** Que cada entrada de la copia de `paquete` sea exactamente la de su manifiesto, y que esté el manifiesto. */
async function copiaEntera(sw: ReturnType<typeof servicio>, paquete: Paquete) {
  const copia = sw.guardadas.get(`faro-paquete-${paquete.version}`);
  assert.ok(copia, 'la copia existe');
  for (const [archivo, texto] of paquete.datos) {
    const guardada = copia.get(sw.urlDe(`paquete/${paquete.version}/${archivo}`));
    assert.equal(await guardada?.clone().text(), texto, `${archivo} entra entero y con su huella`);
  }
  const manifiesto = copia.get(sw.urlDe(`paquete/${paquete.version}/${MANIFIESTO}`));
  assert.equal(await manifiesto?.clone().text(), paquete.manifiesto);
}

/**
 * El service worker real con el paquete de `version`; con `copias`, el mismo dispositivo que otro arranque. Los
 * plazos de las descargas no vencen solos (temporizadores falsos): un service worker detenido no vuelve a hacer nada.
 */
function arrancar(version: string, copias?: ReturnType<typeof servicio>['copias']) {
  return servicio(BASE, { paquete: version }, copias);
}

/** Los temporizadores falsos de la prueba (arrancar). */
const sinPlazos = (t: TestContext) => t.mock.timers.enable({ apis: ['setTimeout'] });

test('detenido a mitad del paquete, al volver a ponerse en marcha solo baja lo que falta', async (t) => {
  const paquete = paqueteDePrueba();
  sinPlazos(t);
  const primero = arrancar(paquete.version);
  // Dos archivos llegan enteros; el tercero se queda a medias y los demás no reciben respuesta: así está la copia
  // cuando el navegador detiene el service worker (sus descargas quedan sin terminar y su código no sigue).
  red(primero, paquete, (archivo) => {
    if (archivo === 'parte-0.json' || archivo === 'parte-1.json') {
      return 'entero';
    }
    return archivo === 'parte-2.json' ? 'a-medias' : 'sin-respuesta';
  });
  let respuestaDelPrimero: unknown = 'ninguna';
  const guardadosDelPrimero = hastaQueGuarde(primero, paquete.version, ['parte-0.json', 'parte-1.json']);
  void prepararPaquete(primero).then((mensaje) => {
    respuestaDelPrimero = mensaje;
  });
  await guardadosDelPrimero;
  assert.deepEqual(guardados(primero, paquete.version), ['parte-0.json', 'parte-1.json']);
  assert.equal(respuestaDelPrimero, 'ninguna', 'el intento detenido no llega a responder');

  // Otro arranque del mismo service worker, con la misma copia: lo pide la página (su latido o la visita siguiente).
  const segundo = arrancar(paquete.version, primero.copias);
  const pedidos = red(segundo, paquete);
  assert.deepEqual(copiado(await prepararPaquete(segundo)), {
    type: 'ESTADO_DEL_PAQUETE',
    version: paquete.version,
    completo: true,
  });
  assert.deepEqual(Object.fromEntries(pedidos), {
    [MANIFIESTO]: 1,
    'parte-2.json': 1,
    'parte-3.json': 1,
    'parte-4.json': 1,
    'parte-5.json': 1,
  });
  await copiaEntera(segundo, paquete);
});

test('un archivo a medias, cortado o truncado no entra en la copia, y el intento siguiente solo baja esos', async (t) => {
  const paquete = paqueteDePrueba();
  sinPlazos(t);
  const sw = arrancar(paquete.version);
  red(sw, paquete, (archivo) => {
    if (archivo === 'parte-1.json') {
      return 'cortado';
    }
    return archivo === 'parte-2.json' ? 'corto' : 'entero';
  });
  assert.deepEqual(copiado(await prepararPaquete(sw)), {
    type: 'ESTADO_DEL_PAQUETE',
    version: paquete.version,
    completo: false,
  });
  assert.deepEqual(guardados(sw, paquete.version), ['parte-0.json', 'parte-3.json', 'parte-4.json', 'parte-5.json']);
  const pedidos = red(sw, paquete);
  assert.equal(copiado(await prepararPaquete(sw)).completo, true);
  assert.deepEqual(Object.fromEntries(pedidos), { [MANIFIESTO]: 1, 'parte-1.json': 1, 'parte-2.json': 1 });
  await copiaEntera(sw, paquete);
});

test('la copia anterior sigue entera y sirviendo mientras la nueva se queda a medias', async (t) => {
  const anterior = paqueteDePrueba('a');
  const nuevo = paqueteDePrueba('b', CAMBIAN);
  sinPlazos(t);
  const deLaAnterior = arrancar(anterior.version);
  red(deLaAnterior, anterior);
  assert.equal(copiado(await prepararPaquete(deLaAnterior)).completo, true);

  // La versión nueva: los archivos que no cambian salen de la copia anterior; de los nuevos, uno llega entero y el
  // siguiente se queda a medias cuando el service worker se detiene.
  const primero = arrancar(nuevo.version, deLaAnterior.copias);
  const pedidosDelPrimero = red(primero, nuevo, (archivo) => {
    if (archivo === 'parte-3.json') {
      return 'entero';
    }
    return archivo === 'parte-4.json' ? 'a-medias' : 'sin-respuesta';
  });
  const guardadosDelPrimero = hastaQueGuarde(primero, nuevo.version, [
    'parte-0.json',
    'parte-1.json',
    'parte-2.json',
    'parte-3.json',
  ]);
  void prepararPaquete(primero);
  await guardadosDelPrimero;
  assert.deepEqual(
    [...pedidosDelPrimero.keys()].filter((archivo) => /parte-[012]/.test(archivo)),
    [],
    'lo que no cambia no viaja',
  );
  assert.ok(!guardados(primero, nuevo.version).includes(MANIFIESTO), 'la copia nueva no está completa');
  await copiaEntera(primero, anterior);
  const servido = await pedir(primero, `paquete/${anterior.version}/parte-4.json`, { method: 'GET', mode: 'cors' });
  assert.deepEqual([servido.estado, servido.cuerpo], [BIEN, anterior.datos.get('parte-4.json')]);

  const segundo = arrancar(nuevo.version, primero.copias);
  const pedidos = red(segundo, nuevo);
  assert.equal(copiado(await prepararPaquete(segundo)).completo, true);
  assert.deepEqual(Object.fromEntries(pedidos), { [MANIFIESTO]: 1, 'parte-4.json': 1, 'parte-5.json': 1 });
  await copiaEntera(segundo, nuevo);
  assert.equal(segundo.guardadas.has(`faro-paquete-${anterior.version}`), false, 'con la nueva completa, se borra');
});

/** Una petición de la copia desde la página `id`: lo que recibe y la promesa que alarga su evento (waitUntil). */
function pedirDesde(sw: ReturnType<typeof servicio>, id: string, recibidos: Map<string, unknown[]>) {
  let trabajo: Promise<unknown> = Promise.resolve();
  sw.oyentes.get('message')?.({
    data: { type: 'PREPARAR_PAQUETE' },
    source: {
      id,
      postMessage: (valor: unknown) => recibidos.set(id, [...(recibidos.get(id) ?? []), copiado(valor)]),
    },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  return trabajo;
}

test('las peticiones repetidas de una página se reúnen en el intento en curso, con una sola respuesta', async (t) => {
  const paquete = paqueteDePrueba();
  sinPlazos(t);
  const sw = arrancar(paquete.version);
  const pedidos = red(sw, paquete);
  let soltarLaRed = () => {};
  const soltar = new Promise<void>((resolver) => {
    soltarLaRed = resolver;
  });
  const entrega = sw.red.respuesta;
  sw.red.respuesta = async (url, opciones) => {
    await soltar;
    return (entrega as NonNullable<typeof entrega>)(url, opciones);
  };
  const recibidos = new Map<string, unknown[]>();
  const terminados: string[] = [];
  const eventos = ['p1', 'p1', 'p2', 'p1'].map((id, orden) =>
    pedirDesde(sw, id, recibidos).then(() => terminados.push(`${id}#${orden}`)),
  );
  await vuelta();
  assert.deepEqual(terminados, [], 'cada evento dura lo que el intento');
  soltarLaRed();
  await Promise.all(eventos);
  const estado = { type: 'ESTADO_DEL_PAQUETE', version: paquete.version, completo: true };
  // Este paquete no trae nada del primer análisis: lo tiene en cuanto empieza, y cada petición lo sabe, también las
  // repetidas. El estado de la copia completa, en cambio, se contesta una vez por página.
  const primero = { type: 'PRIMER_ANALISIS_DEL_PAQUETE', version: paquete.version };
  assert.deepEqual(Object.fromEntries(recibidos), { p1: [primero, primero, primero, estado], p2: [primero, estado] });
  assert.ok(
    [...pedidos.values()].every((veces) => veces === 1),
    `cada archivo, una vez: ${JSON.stringify([...pedidos])}`,
  );
  await pedirDesde(sw, 'p1', recibidos);
  assert.deepEqual(
    recibidos.get('p1'),
    [primero, primero, primero, estado, primero, estado],
    'un intento nuevo vuelve a contestar',
  );
});
