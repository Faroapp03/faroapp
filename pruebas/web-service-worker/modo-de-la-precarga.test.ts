// Con qué modo de caché HTTP pide el service worker cada archivo de la copia (service-worker.js, modoDeLaCopia). Lo que
// lleva la huella en el nombre (en js/ y motor/trozos/) se pide con «default»: si el navegador ya lo tiene, porque la
// página acaba de pedirlo, no se vuelve a descargar. Un comprobado con huella en el nombre que no cuadra se pide una
// vez más saltando la caché HTTP («reload») y solo falla si tampoco cuadra. Lo demás salta la caché HTTP, también lo
// comprobado sin huella en el nombre (la huella garantiza los bytes, no las cabeceras que guarda la copia).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
const ENTRADA = 'js/pagina-inicio-0123456789abcdef.js';
const TROZO = 'js/chunk-AB2CD3EF.js';
const COMPARTIDA = `js/paginas-scripts-sitio-${'0123456789abcdef'}.js`;
const TROZO_DEL_MOTOR = 'motor/trozos/chunk-QW3ER4TY.js';
/** La barrera de versión lleva en el nombre las 64 cifras de su SHA-256. */
const BARRERA = `scripts/barrera-${sha256('BARRERA')}.js`;
/** Los guiones clásicos de la cabecera también: se publican como <fuente>-<sha256>.js (guiones-con-huella.ts). */
const CLASICO = `scripts/tema-inicial-${sha256('TEMA')}.js`;
const DICCIONARIO = 'idiomas/es.js';
const MOTOR = 'motor/src/plataforma/navegador/motor.js';
const WORKER = 'scripts/motor-local/worker.js';
const RECURSO = { mode: 'cors', method: 'GET' };

/** El service worker real con una red que apunta el modo de caché de cada petición y responde `cuerpos`. */
function conModos(base: string) {
  const sw = servicio(base, {
    archivos: ['inicio.html', 'sin-conexion.html', ENTRADA, TROZO, COMPARTIDA, BARRERA, CLASICO, DICCIONARIO],
    comprobados: [
      [MOTOR, sha256('MOTOR')],
      [TROZO_DEL_MOTOR, sha256('TROZO')],
      [WORKER, sha256('WORKER')],
    ],
    cuerpoDe: (ruta) => ruta,
  });
  const cuerpos: Record<string, string[]> = { [MOTOR]: ['MOTOR'], [TROZO_DEL_MOTOR]: ['TROZO'], [WORKER]: ['WORKER'] };
  const modos: Record<string, string[]> = {};
  const rutaDe = (url: string) => new URL(url).pathname.slice(new URL(base).pathname.length);
  const pedirAlServidor = sw.red.fetch.bind(sw.red);
  sw.red.fetch = (pedido: Request | string, opciones?: RequestInit) => {
    const url = typeof pedido === 'string' ? pedido : pedido.url;
    const modo = opciones?.cache ?? (typeof pedido === 'string' ? 'default' : pedido.cache);
    modos[rutaDe(url)] = [...(modos[rutaDe(url)] ?? []), modo];
    return pedirAlServidor(pedido, opciones);
  };
  sw.red.respuesta = (url) => {
    const ruta = rutaDe(url);
    // Cada petición de un comprobado recibe el siguiente cuerpo de su lista; el último se repite.
    const lista = cuerpos[ruta] ?? [ruta];
    const cuerpo = (lista.length > 1 ? lista.shift() : lista[0]) ?? ruta;
    return new Response(cuerpo, {
      headers: { 'content-type': ruta.endsWith('.html') ? 'text/html' : 'text/javascript' },
    });
  };
  sw.conectar();
  return { sw, cuerpos, modos };
}

for (const base of BASES) {
  test(`al instalar, lo que lleva huella se pide con la caché HTTP y lo demás sin ella: ${base}`, async () => {
    const { sw, modos } = conModos(base);
    await sw.instalar();
    assert.deepEqual(modos, {
      'inicio.html': ['reload'],
      'sin-conexion.html': ['reload'],
      [ENTRADA]: ['default'],
      [TROZO]: ['default'],
      [COMPARTIDA]: ['default'],
      [BARRERA]: ['reload'],
      [CLASICO]: ['reload'],
      [DICCIONARIO]: ['reload'],
      [MOTOR]: ['reload'],
      [TROZO_DEL_MOTOR]: ['default'],
      [WORKER]: ['reload'],
    });
  });

  test(`un comprobado con huella en el nombre que no cuadra se repite sin la caché HTTP: ${base}`, async () => {
    const { sw, cuerpos, modos } = conModos(base);
    cuerpos[TROZO_DEL_MOTOR] = ['TROZO DE OTRA VERSIÓN', 'TROZO'];
    await sw.instalar();
    assert.deepEqual(modos[TROZO_DEL_MOTOR], ['default', 'reload']);
    const guardado = await sw.copias.match(sw.urlDe(TROZO_DEL_MOTOR), { cacheName: sw.nombreCopia });
    assert.equal(await guardado?.text(), 'TROZO');
  });

  test(`un comprobado que tampoco cuadra sin la caché HTTP hace fallar la instalación: ${base}`, async () => {
    const { sw, cuerpos, modos } = conModos(base);
    cuerpos[TROZO_DEL_MOTOR] = ['TROZO ALTERADO'];
    await assert.rejects(sw.instalar(), { name: 'HuellaQueNoCoincide' });
    assert.deepEqual(modos[TROZO_DEL_MOTOR], ['default', 'reload'], 'un solo reintento');
  });

  test(`un comprobado sin huella en el nombre que no cuadra no se repite: ya iba sin caché: ${base}`, async () => {
    const { sw, cuerpos, modos } = conModos(base);
    cuerpos[MOTOR] = ['MOTOR ALTERADO', 'MOTOR'];
    await assert.rejects(sw.instalar(), { name: 'HuellaQueNoCoincide' });
    assert.deepEqual(modos[MOTOR], ['reload']);
  });

  test(`lo que lleva huella y falta en la copia se pide a la red con la caché HTTP: ${base}`, async () => {
    const { sw, modos } = conModos(base);
    await sw.instalar();
    sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe(TROZO));
    sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe(CLASICO));
    assert.equal((await pedir(sw, TROZO, RECURSO)).cuerpo, TROZO);
    assert.equal((await pedir(sw, CLASICO, RECURSO)).cuerpo, CLASICO);
    assert.deepEqual(modos[TROZO], ['default', 'default']);
    assert.deepEqual(modos[CLASICO], ['reload', 'reload']);
  });
}
