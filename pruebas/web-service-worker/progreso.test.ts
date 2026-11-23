import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { servicioPublicado } from '../ayudas/web-construida.ts';
import { prepararPaquete, servicio } from './ayudas.ts';

const CIFRAS_VERSION = 16;
const ARCHIVOS = 5;
const BIEN = 200;
const NO_ESTA = 404;
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const FUENTE = servicioPublicado();

type Mensaje = {
  type: string;
  version?: string;
  archivos?: number;
  guardados?: number;
  bytes?: number;
  bytesTotales?: number;
  exacto?: boolean;
  completo?: boolean;
};
/** Lo que pesa cada archivo de prueba, en bytes, como lo escribiría npm run web:preparar. */
const MIL = 1000;
const TAMANOS = Object.fromEntries(
  Array.from({ length: ARCHIVOS }, (_, indice) => [`parte-${indice}.json`, (indice + 1) * MIL]),
);
const TOTAL = Object.values(TAMANOS).reduce((suma, tamano) => suma + tamano, 0);

/** El service worker real con una página abierta que apunta lo que recibe (self.clients.matchAll). */
function conUnaPagina(paquete: string, sinVentanas = false, tamanos: Record<string, number> = {}) {
  const prefijo = sinVentanas
    ? ''
    : 'self.registration.recibidos = [];\n' +
      'self.clients.matchAll = async () => [{ postMessage: (m) => self.registration.recibidos.push(m) }];\n';
  const sw = servicio('https://ejemplo.invalid/', {
    paquete,
    tamanos: JSON.stringify(tamanos),
    fuente: prefijo + FUENTE,
  });
  const recibidos = (): Mensaje[] =>
    JSON.parse(JSON.stringify((sw.registro as { recibidos?: unknown }).recibidos ?? []));
  return { sw, recibidos };
}

function paqueteDePrueba() {
  const datos = Array.from({ length: ARCHIVOS }, (_, indice) => [`parte-${indice}.json`, `{"parte":${indice}}`]);
  const manifiesto = JSON.stringify(
    Object.fromEntries(datos.map(([archivo, texto]) => [archivo, { sha256: huella(texto ?? '') }])),
  );
  const version = huella(manifiesto).slice(0, CIFRAS_VERSION);
  const respuesta = (url: string) => {
    if (url.endsWith('/manifiesto.json')) {
      return new Response(manifiesto);
    }
    const encontrado = datos.find(([archivo]) => url.endsWith(`/${archivo}`));
    return new Response(encontrado?.[1] ?? '', { status: encontrado ? BIEN : NO_ESTA });
  };
  return { version, respuesta };
}

/** Lo que responde el service worker, fuera de su contexto (los objetos de otro contexto no se comparan igual). */
const estadoDe = async (sw: ReturnType<typeof servicio>) => JSON.parse(JSON.stringify(await prepararPaquete(sw)));

/** Deja que lleguen los avisos, que no se esperan (contarProgreso). */
const llegar = () => new Promise((listo) => setImmediate(listo));

test('la copia cuenta a las páginas cada archivo guardado, de 0 al total', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw, recibidos } = conUnaPagina(version);
  sw.conectar();
  sw.red.respuesta = respuesta;
  const estado = await estadoDe(sw);
  await llegar();
  const progreso = recibidos().filter((mensaje) => mensaje.type === 'PROGRESO_DEL_PAQUETE');
  assert.deepEqual(
    progreso.map((mensaje) => mensaje.guardados),
    Array.from({ length: ARCHIVOS + 1 }, (_, indice) => indice),
  );
  assert.ok(progreso.every((mensaje) => mensaje.archivos === ARCHIVOS && mensaje.version === version));
  assert.deepEqual(estado, { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
});

test('con la copia ya completa no se cuenta progreso; un fallo no suma su archivo', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw, recibidos } = conUnaPagina(version);
  sw.conectar();
  sw.red.respuesta = (url) => (url.endsWith('/parte-0.json') ? new Response('roto') : respuesta(url));
  assert.deepEqual(await estadoDe(sw), { type: 'ESTADO_DEL_PAQUETE', version, completo: false });
  await llegar();
  assert.equal(Math.max(...recibidos().map((mensaje) => mensaje.guardados ?? 0)), ARCHIVOS - 1);
  sw.red.respuesta = respuesta;
  await prepararPaquete(sw);
  await llegar();
  const antes = recibidos().length;
  await prepararPaquete(sw);
  await llegar();
  assert.equal(recibidos().length, antes, 'la copia completa no vuelve a contar');
});

test('sin clients.matchAll la copia acaba igual: el aviso no es imprescindible', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw } = conUnaPagina(version, true);
  sw.conectar();
  sw.red.respuesta = respuesta;
  assert.deepEqual(await estadoDe(sw), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
});

test('con los tamaños escritos, la copia cuenta bytes guardados frente a los totales', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw, recibidos } = conUnaPagina(version, false, TAMANOS);
  sw.conectar();
  sw.red.respuesta = respuesta;
  await prepararPaquete(sw);
  await llegar();
  const progreso = recibidos().filter((mensaje) => mensaje.type === 'PROGRESO_DEL_PAQUETE');
  assert.ok(progreso.every((mensaje) => mensaje.bytesTotales === TOTAL && mensaje.exacto === true));
  assert.equal(progreso[0]?.bytes, 0);
  assert.equal(progreso.at(-1)?.bytes, TOTAL);
  const pasos = progreso.slice(1).map((mensaje, indice) => (mensaje.bytes ?? 0) - (progreso[indice]?.bytes ?? 0));
  assert.deepEqual(
    pasos.sort((a, b) => a - b),
    Object.values(TAMANOS).sort((a, b) => a - b),
    'cada archivo suma lo que pesa',
  );
});

test('un archivo sin tamaño cuenta por su parte proporcional y la cuenta no es exacta', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { 'parte-0.json': _sinTamano, ...conTamano } = TAMANOS;
  const { sw, recibidos } = conUnaPagina(version, false, conTamano);
  sw.conectar();
  sw.red.respuesta = respuesta;
  await prepararPaquete(sw);
  await llegar();
  const ultimo = recibidos()
    .filter((mensaje) => mensaje.type === 'PROGRESO_DEL_PAQUETE')
    .at(-1);
  const conocidos = Object.values(conTamano);
  const media = conocidos.reduce((suma, tamano) => suma + tamano, 0) / conocidos.length;
  assert.equal(ultimo?.exacto, false);
  assert.equal(ultimo?.bytesTotales, Math.round(TOTAL - (TAMANOS['parte-0.json'] ?? 0) + media));
  assert.equal(ultimo?.bytes, ultimo?.bytesTotales);
});

test('una copia completa a la que le falta un archivo se vuelve a completar', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw } = conUnaPagina(version);
  sw.conectar();
  sw.red.respuesta = respuesta;
  await prepararPaquete(sw);
  const copia = sw.guardadas.get(`faro-paquete-${version}`);
  copia?.delete(sw.urlDe(`paquete/${version}/parte-2.json`));
  const antes = sw.peticiones.length;
  assert.deepEqual(await estadoDe(sw), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  assert.deepEqual(sw.peticiones.slice(antes), [
    sw.urlDe(`paquete/${version}/manifiesto.json`),
    sw.urlDe(`paquete/${version}/parte-2.json`),
  ]);
  assert.ok(copia?.has(sw.urlDe(`paquete/${version}/parte-2.json`)));
  assert.ok(copia?.has(sw.urlDe(`paquete/${version}/manifiesto.json`)));
});

/** Pide la copia con revisión de huellas, como la página después de un fallo del motor (paquete-sin-conexion.js). */
async function revisarPaquete(sw: ReturnType<typeof servicio>) {
  let trabajo = Promise.resolve<unknown>(undefined);
  let mensaje: unknown;
  sw.oyentes.get('message')?.({
    data: { type: 'PREPARAR_PAQUETE', revisar: true },
    source: {
      postMessage: (valor: unknown) => {
        mensaje = valor;
      },
    },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  await trabajo;
  return JSON.parse(JSON.stringify(mensaje));
}

test('la revisión vuelve a bajar el archivo cuya copia no cuadra con su huella; una visita normal no lo lee', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw } = conUnaPagina(version);
  sw.conectar();
  sw.red.respuesta = respuesta;
  await prepararPaquete(sw);
  const copia = sw.guardadas.get(`faro-paquete-${version}`);
  const direccion = sw.urlDe(`paquete/${version}/parte-3.json`);
  copia?.set(direccion, new Response('estropeado'));
  const antes = sw.peticiones.length;
  await prepararPaquete(sw);
  assert.equal(sw.peticiones.length, antes, 'una visita normal no lee ni vuelve a bajar nada');
  assert.deepEqual(await revisarPaquete(sw), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  assert.deepEqual(sw.peticiones.slice(antes), [sw.urlDe(`paquete/${version}/manifiesto.json`), direccion]);
  assert.equal(await copia?.get(direccion)?.clone().text(), '{"parte":3}');
});

test('la revisión pedida durante otro vuelo se acumula y repara antes de responder a todas las páginas', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw } = conUnaPagina(version);
  sw.conectar();
  sw.red.respuesta = respuesta;
  await prepararPaquete(sw);
  const copia = sw.guardadas.get(`faro-paquete-${version}`);
  const direccion = sw.urlDe(`paquete/${version}/parte-3.json`);
  copia?.set(direccion, new Response('estropeado'));
  const antes = sw.peticiones.length;
  sw.evaluar(`globalThis.pasadas = []; globalThis.liberar = undefined;
    const originalLlenar = llenarCopiaDelPaquete;
    llenarCopiaDelPaquete = async (revisar) => {
      globalThis.pasadas.push(revisar);
      if (globalThis.pasadas.length === 1) await new Promise((resolver) => { globalThis.liberar = resolver; });
      return originalLlenar(revisar);
    };`);
  const primera = prepararPaquete(sw);
  const revision = prepararPaquete(sw, true);
  const otraRevision = prepararPaquete(sw, true);
  // El cerrojo del paquete (navigator.locks) da el turno después: se espera a que empiece la primera pasada.
  await llegar();
  assert.deepEqual(JSON.parse(JSON.stringify(sw.evaluar('globalThis.pasadas'))), [false]);
  sw.evaluar('globalThis.liberar()');
  for (const estado of await Promise.all([primera, revision, otraRevision])) {
    assert.deepEqual(JSON.parse(JSON.stringify(estado)), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(sw.evaluar('globalThis.pasadas'))), [false, true]);
  assert.deepEqual(sw.peticiones.slice(antes), [sw.urlDe(`paquete/${version}/manifiesto.json`), direccion]);
  assert.equal(await copia?.get(direccion)?.clone().text(), '{"parte":3}');
});

test('un fallo del primer vuelo no pierde la revisión pendiente ni reintenta sin solicitud', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw } = conUnaPagina(version);
  sw.conectar();
  sw.red.respuesta = respuesta;
  sw.evaluar(`globalThis.pasadas = []; globalThis.liberar = undefined;
    const originalLlenar = llenarCopiaDelPaquete;
    llenarCopiaDelPaquete = async (revisar) => {
      globalThis.pasadas.push(revisar);
      if (globalThis.pasadas.length === 1) {
        await new Promise((resolver) => { globalThis.liberar = resolver; });
        throw new Error('fallo sintético');
      }
      return originalLlenar(revisar);
    };`);
  const primera = prepararPaquete(sw);
  const revision = prepararPaquete(sw, true);
  // El cerrojo del paquete (navigator.locks) da el turno después: se espera a que empiece la primera pasada.
  await llegar();
  sw.evaluar('globalThis.liberar()');
  for (const estado of await Promise.all([primera, revision])) {
    assert.deepEqual(JSON.parse(JSON.stringify(estado)), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(sw.evaluar('globalThis.pasadas'))), [false, true]);
});

test('una ráfaga durante la revisión activa no provoca una tercera pasada', async () => {
  const { version, respuesta } = paqueteDePrueba();
  const { sw } = conUnaPagina(version);
  sw.conectar();
  sw.red.respuesta = respuesta;
  sw.evaluar(`globalThis.pasadas = []; globalThis.liberar = [];
    globalThis.segundaIniciada = new Promise((resolver) => { globalThis.avisarSegunda = resolver; });
    const originalLlenar = llenarCopiaDelPaquete;
    llenarCopiaDelPaquete = async (revisar) => {
      globalThis.pasadas.push(revisar);
      if (globalThis.pasadas.length === 2) globalThis.avisarSegunda();
      await new Promise((resolver) => { globalThis.liberar.push(resolver); });
      return originalLlenar(revisar);
    };`);
  const primera = prepararPaquete(sw);
  const revision = prepararPaquete(sw, true);
  // El cerrojo del paquete (navigator.locks) da el turno después: se espera a que empiece la primera pasada.
  await llegar();
  sw.evaluar('globalThis.liberar[0]()');
  const segunda = sw.evaluar('globalThis.segundaIniciada') as Promise<void>;
  let plazo: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      segunda,
      new Promise<never>((_, rechazar) => {
        plazo = setTimeout(() => rechazar(new Error('No empezó la revisión pendiente')), MIL);
      }),
    ]);
  } finally {
    clearTimeout(plazo);
  }
  assert.equal(sw.evaluar('globalThis.pasadas.length'), 2);
  const rafaga = [prepararPaquete(sw, true), prepararPaquete(sw, true)];
  sw.evaluar('globalThis.liberar[1]()');
  for (const estado of await Promise.all([primera, revision, ...rafaga])) {
    assert.deepEqual(JSON.parse(JSON.stringify(estado)), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(sw.evaluar('globalThis.pasadas'))), [false, true]);
});
