// El plazo de cada descarga del paquete, con temporizadores falsos: una descarga que deja de recibir datos se corta (y
// se repite una vez), una que sigue recibiendo trozos no se corta aunque tarde minutos, como vectores-movil.json (unos
// 15 MB) en una red lenta, y mientras llegan datos el service worker cuenta a las páginas que sigue (el latido).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { type TestContext, test } from 'node:test';
import { servicioPublicado } from '../ayudas/web-construida.ts';
import { prepararPaquete, servicio } from './ayudas.ts';

const CIFRAS_VERSION = 16;
/** Los plazos de service-worker.js. */
const DESCARGA_PARADA_MS = 20_000;
const LATIDO_MS = 5000;
const CASI = 1;
/** Una descarga lenta: un trozo cada 15 s durante 4 minutos, por debajo del plazo de descarga parada. */
const CADA_TROZO_MS = 15_000;
const TROZOS = 16;
const FUENTE = servicioPublicado();
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** Un paquete de un archivo cuyo contenido son `trozos` letras «x». */
function paquete(trozos: number) {
  const contenido = 'x'.repeat(trozos);
  const manifiesto = JSON.stringify({ 'grande.json': { sha256: huella(contenido) } });
  return { contenido, manifiesto, version: huella(manifiesto).slice(0, CIFRAS_VERSION) };
}

/** El service worker real, con una página que apunta los avisos y el reloj de la prueba para el latido. */
function conUnaPagina(t: TestContext, version: string) {
  const prefijo =
    'self.registration.recibidos = [];\n' +
    'self.clients.matchAll = async () => [{ postMessage: (m) => self.registration.recibidos.push(m) }];\n';
  const fuente = prefijo + FUENTE.replaceAll('Date.now()', 'self.registration.reloj.now()');
  const sw = servicio('https://ejemplo.invalid/', { paquete: version, fuente });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  Object.assign(sw.registro, { reloj: Date });
  sw.conectar();
  const recibidos = () =>
    JSON.parse(JSON.stringify((sw.registro as { recibidos?: unknown }).recibidos ?? [])) as Record<string, unknown>[];
  return { sw, recibidos };
}

/** Una respuesta que no llega nunca, salvo que se corte la descarga. */
function sinRespuesta(senal: AbortSignal): Promise<Response> {
  return new Promise((_, rechazar) => {
    senal.addEventListener('abort', () => rechazar(senal.reason), { once: true });
  });
}

/** Cada lectura solicitada por el worker pone en marcha la entrega retardada de su trozo. */
function cuerpoLento(lecturas: PromiseWithResolvers<void>[], senal: AbortSignal): Response {
  let enviados = 0;
  const cuerpo = new ReadableStream<Uint8Array>(
    {
      start(control) {
        senal.addEventListener('abort', () => control.error(senal.reason), { once: true });
      },
      pull(control) {
        const lectura = lecturas[enviados];
        assert.ok(lectura, 'el worker ha pedido un trozo fuera del cuerpo');
        return new Promise<void>((listo) => {
          setTimeout(() => {
            control.enqueue(new TextEncoder().encode('x'));
            enviados += 1;
            if (enviados === lecturas.length) {
              control.close();
            }
            listo();
          }, CADA_TROZO_MS);
          lectura.resolve();
        });
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(cuerpo);
}

test('una descarga que no recibe nada se corta a los 20 s, se repite una vez y la copia queda incompleta', async (t) => {
  const { manifiesto, version } = paquete(1);
  const { sw } = conUnaPagina(t, version);
  let pedidas = 0;
  const intentos = [Promise.withResolvers<AbortSignal>(), Promise.withResolvers<AbortSignal>()];
  sw.red.respuesta = (url, opciones) => {
    if (url.endsWith('/manifiesto.json')) {
      return new Response(manifiesto);
    }
    const senal = opciones?.signal;
    assert.ok(senal);
    const intento = intentos[pedidas++];
    assert.ok(intento, 'la descarga solo se repite una vez');
    const detenida = sinRespuesta(senal);
    intento.resolve(senal);
    return detenida;
  };
  let pendiente = true;
  const fin = prepararPaquete(sw).finally(() => {
    pendiente = false;
  });
  for (const [indice, intento] of intentos.entries()) {
    const senal = await intento.promise;
    assert.equal(pedidas, indice + 1);
    t.mock.timers.tick(DESCARGA_PARADA_MS - CASI);
    assert.equal(pendiente, true);
    assert.equal(senal.aborted, false, 'sigue pendiente un milisegundo antes del plazo');
    t.mock.timers.tick(CASI);
    assert.equal(senal.aborted, true, 'la petición se corta al alcanzar los 20 segundos');
  }
  const estado = JSON.parse(JSON.stringify(await fin));
  assert.deepEqual(estado, { type: 'ESTADO_DEL_PAQUETE', version, completo: false });
  assert.equal(pedidas, 2);
});

test('una descarga lenta que sigue recibiendo trozos no se corta, y la página recibe el latido', async (t) => {
  const { contenido, manifiesto, version } = paquete(TROZOS);
  const { sw, recibidos } = conUnaPagina(t, version);
  const lecturas = Array.from({ length: TROZOS }, () => Promise.withResolvers<void>());
  let pedidas = 0;
  sw.red.respuesta = (url, opciones) => {
    if (url.endsWith('/manifiesto.json')) {
      return new Response(manifiesto);
    }
    const senal = opciones?.signal;
    assert.ok(senal);
    pedidas += 1;
    return cuerpoLento(lecturas, senal);
  };
  const fin = prepararPaquete(sw);
  for (const lectura of lecturas) {
    await lectura.promise;
    t.mock.timers.tick(CADA_TROZO_MS);
  }
  const estado = JSON.parse(JSON.stringify(await fin));
  assert.deepEqual(estado, { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  assert.equal(pedidas, 1, 'los dieciséis trozos llegaron en una sola descarga');
  assert.equal(contenido.length, TROZOS);
  const latidos = recibidos().filter((m) => m.type === 'PROGRESO_DEL_PAQUETE' && m.archivos === undefined);
  // Un latido por trozo, como mucho uno cada LATIDO_MS: los trozos llegan cada 15 s.
  assert.ok(CADA_TROZO_MS >= LATIDO_MS);
  assert.ok(latidos.length >= TROZOS - 1, `latidos: ${latidos.length}`);
  assert.deepEqual(latidos[0], { type: 'PROGRESO_DEL_PAQUETE', version });
});
