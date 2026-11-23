// Lo que nombra BAJO_DEMANDA (las fotografías a tamaño completo) no se descarga al instalar: se guarda la primera vez
// que se pide. Lo comprobado se descarga siempre al instalar, aunque un catálogo lo nombre también en BAJO_DEMANDA, y
// se sirve solo de la copia: si la copia guardada ha cambiado o le falta, el service worker lo dice con un 500 (no es de
// paso) y la sonda lo cuenta; lo que no está en ninguna lista, que el motor no está listo (503), sin pedirlo a la red.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

const OK = 200;
const NO_DISPONIBLE = 503;
/** La copia guardada en el dispositivo ha cambiado (service-worker.js, noEsDeEstaVersion). */
const DE_LA_COPIA_NO_COINCIDE = 500;
const NO_ES_DE_ESTA_VERSION = 'El archivo del motor del dispositivo no es el de esta versión.';
const LE_FALTA_A_LA_COPIA = 'El archivo del motor del dispositivo falta en la copia guardada.';
const SONDA = 'motor/copia-comprobada.json';
const RECURSO = { mode: 'cors', method: 'GET' };
const FOTO = 'imagenes/portada.webp';
const FOTO_REDUCIDA = 'imagenes/portada-800.webp';
const MOTOR = 'motor/src/plataforma/navegador/motor.js';
const WORKER = 'scripts/motor-local/worker.js';
/** El tipo de cada respuesta del servidor de prueba por su extensión; lo demás es JavaScript. */
const TIPOS: readonly (readonly [string, string])[] = [
  ['.html', 'text/html'],
  ['.webp', 'image/webp'],
];
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
/** Lo que cuenta la sonda del motor: si el service worker ha rechazado algo comprobado por no ser de esta versión. */
async function noCoincide(sw: ReturnType<typeof servicio>) {
  const sonda = await pedir(sw, SONDA, RECURSO);
  return (JSON.parse(sonda.cuerpo ?? '{}') as { noCoincide?: unknown }).noCoincide;
}

/** Una web con una fotografía bajo demanda y el motor nombrado también en BAJO_DEMANDA (catálogo de otra política). */
function conFotografia(base: string) {
  const cuerpos: Record<string, string> = { [MOTOR]: 'MOTOR', [WORKER]: 'WORKER' };
  const sw = servicio(base, {
    archivos: ['inicio.html', 'sin-conexion.html', FOTO_REDUCIDA],
    bajoDemanda: [FOTO, MOTOR],
    comprobados: [
      [MOTOR, sha256('MOTOR')],
      [WORKER, sha256('WORKER')],
    ],
    cuerpoDe: (ruta) => cuerpos[ruta] ?? ruta,
  });
  sw.red.respuesta = (url) => {
    const ruta = new URL(url).pathname.slice(new URL(base).pathname.length);
    const tipo = TIPOS.find(([extension]) => ruta.endsWith(extension))?.[1] ?? 'text/javascript';
    return new Response(cuerpos[ruta] ?? ruta, { headers: { 'content-type': tipo } });
  };
  sw.conectar();
  return sw;
}

for (const base of BASES) {
  test(`al instalar no se precarga lo de BAJO_DEMANDA, salvo lo comprobado: ${base}`, async () => {
    const sw = conFotografia(base);
    await sw.instalar();
    assert.deepEqual(
      [...(sw.guardadas.get(sw.nombreCopia)?.keys() ?? [])].sort(),
      ['inicio.html', 'sin-conexion.html', FOTO_REDUCIDA, MOTOR, WORKER].map(sw.urlDe).sort(),
    );
  });

  test(`la fotografía bajo demanda se guarda la primera vez que se pide y se sirve sin conexión: ${base}`, async () => {
    const sw = conFotografia(base);
    await sw.instalar();
    assert.equal((await pedir(sw, FOTO, RECURSO)).cuerpo, FOTO);
    assert.ok(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe(FOTO)));
    sw.red.offline = true;
    assert.equal((await pedir(sw, FOTO, RECURSO)).cuerpo, FOTO);
  });

  test(`la copia guardada de lo comprobado que ha cambiado responde que no es de esta versión: ${base}`, async () => {
    const sw = conFotografia(base);
    await sw.instalar();
    assert.equal((await pedir(sw, MOTOR, RECURSO)).estado, OK);
    assert.equal(await noCoincide(sw), false);
    sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(MOTOR), new Response('MOTOR CAMBIADO'));
    const respuesta = await pedir(sw, MOTOR, RECURSO);
    assert.equal(respuesta.estado, DE_LA_COPIA_NO_COINCIDE, 'no es un 503: no se arregla esperando');
    assert.equal(respuesta.cuerpo, NO_ES_DE_ESTA_VERSION);
    assert.equal(await noCoincide(sw), true, 'la sonda lo cuenta al Worker del motor');
    // Con la copia de esta versión otra vez, se sirve y la sonda lo olvida.
    sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(MOTOR), new Response('MOTOR'));
    assert.equal((await pedir(sw, MOTOR, RECURSO)).estado, OK);
    assert.equal(await noCoincide(sw), false);
  });

  test(`lo comprobado que falta en la copia la da por estropeada y no se pide a la red: ${base}`, async () => {
    const sw = conFotografia(base);
    await sw.instalar();
    sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe(MOTOR));
    const antes = sw.peticiones.length;
    const respuesta = await pedir(sw, MOTOR, RECURSO);
    assert.equal(respuesta.estado, DE_LA_COPIA_NO_COINCIDE, 'no es de paso: la copia completa lo tenía');
    assert.equal(respuesta.cuerpo, LE_FALTA_A_LA_COPIA);
    assert.equal(sw.peticiones.length, antes, 'lo comprobado nunca sale de la red');
    assert.equal(await noCoincide(sw), true, 'la sonda lo cuenta: la página ofrece reparar');
  });

  test(`lo que no es de ninguna lista en una carpeta comprobada es de paso y no se pide a la red: ${base}`, async () => {
    const sw = conFotografia(base);
    await sw.instalar();
    const antes = sw.peticiones.length;
    const respuesta = await pedir(sw, 'motor/no-esta-en-la-lista.js', RECURSO);
    assert.equal(respuesta.estado, NO_DISPONIBLE);
    assert.equal(sw.peticiones.length, antes);
    assert.equal(await noCoincide(sw), false);
  });
}
