// La instalación que falla porque un archivo comprobado no es el de esta versión (service-worker.js, «Instalación que
// no coincide»): con la copia completa, el motor se guarda al instalar, y si no cuadra con su huella no queda ningún
// service worker activo al que la página pueda preguntar. Antes de fallar, el service worker deja constancia en su
// copia de estado y lo cuenta a las páginas abiertas, también a las que aún no controla. Un fallo de paso (sin red) no
// deja constancia, y la siguiente instalación o la activación de una versión la borran.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { servicioPublicado } from '../ayudas/web-construida.ts';
import { BASES, servicio } from './ayudas.ts';

const MOTOR = 'motor/src/plataforma/navegador/motor.js';
const WORKER = 'scripts/motor-local/worker.js';
const ESTADO = 'service-worker/instalacion.json';
const MENSAJE = 'INSTALACION_QUE_NO_COINCIDE';
const FUENTE = servicioPublicado();
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** El service worker real con una página abierta que apunta lo que recibe y cómo se buscó (self.clients.matchAll). */
function conUnaPagina(base: string) {
  const prefijo =
    'self.registration.recibidos = [];\n' +
    'self.clients.matchAll = async (opciones) => {\n' +
    '  self.registration.busqueda = opciones;\n' +
    '  return [{ postMessage: (m) => self.registration.recibidos.push(m) }];\n' +
    '};\n';
  const cuerpos: Record<string, string> = { [MOTOR]: 'MOTOR', [WORKER]: 'WORKER' };
  const sw = servicio(base, {
    archivos: ['inicio.html', 'sin-conexion.html'],
    comprobados: [
      [MOTOR, sha256('MOTOR')],
      [WORKER, sha256('WORKER')],
    ],
    fuente: prefijo + FUENTE,
    cuerpoDe: (ruta) => cuerpos[ruta] ?? ruta,
  });
  sw.red.respuesta = (url) => {
    const ruta = new URL(url).pathname.slice(new URL(base).pathname.length);
    return new Response(cuerpos[ruta] ?? ruta, {
      headers: { 'content-type': ruta.endsWith('.html') ? 'text/html' : 'text/javascript' },
    });
  };
  const delServicio = sw.registro as unknown as { recibidos: unknown[]; busqueda?: unknown };
  // Lo que recibe la página, copiado fuera del ámbito del service worker (otro reino: otros prototipos).
  const registro = {
    get recibidos(): unknown[] {
      return JSON.parse(JSON.stringify(delServicio.recibidos));
    },
    get busqueda(): unknown {
      return delServicio.busqueda === undefined ? undefined : JSON.parse(JSON.stringify(delServicio.busqueda));
    },
  };
  const estado = async () => {
    const guardada = await sw.copias.match(sw.urlDe(ESTADO), { cacheName: `faro-estado:${base}` });
    return guardada ? ((await guardada.json()) as Record<string, unknown>) : null;
  };
  return { sw, cuerpos, registro, estado };
}

for (const base of BASES) {
  test(`un motor que no coincide al instalar deja constancia y lo cuenta a las páginas: ${base}`, async () => {
    const { sw, cuerpos, registro, estado } = conUnaPagina(base);
    cuerpos[MOTOR] = 'MOTOR ALTERADO';
    sw.conectar();
    const antes = Date.now();
    await assert.rejects(sw.instalar(), { name: 'HuellaQueNoCoincide' });
    const { cuando, ...constancia } = (await estado()) ?? {};
    assert.deepEqual(constancia, { motivo: 'no-coincide', archivo: MOTOR, version: sw.evaluar('VERSION') });
    assert.ok(typeof cuando === 'number' && cuando >= antes, 'con la hora del intento, para atarla a él');
    assert.deepEqual(registro.recibidos, [{ type: MENSAJE, archivo: MOTOR, base }], 'con la base de esta web');
    assert.deepEqual(registro.busqueda, { type: 'window', includeUncontrolled: true }, 'también a las no controladas');
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.size ?? 0, 0, 'no se guarda nada en la copia de la web');
  });

  test(`una instalación que falla sin red no deja constancia ni avisa: ${base}`, async () => {
    const { sw, registro, estado } = conUnaPagina(base);
    await assert.rejects(sw.instalar(), TypeError);
    assert.equal(await estado(), null);
    assert.deepEqual(registro.recibidos, []);
  });

  test(`la instalación siguiente y la activación borran la constancia: ${base}`, async () => {
    const { sw, cuerpos, estado } = conUnaPagina(base);
    cuerpos[MOTOR] = 'MOTOR ALTERADO';
    sw.conectar();
    await assert.rejects(sw.instalar());
    assert.notEqual(await estado(), null);
    // El servidor vuelve a entregar el motor de esta versión: la instalación termina y ya no queda constancia.
    cuerpos[MOTOR] = 'MOTOR';
    await sw.instalar();
    assert.equal(await estado(), null);
    cuerpos[MOTOR] = 'MOTOR ALTERADO';
    await assert.rejects(sw.instalar());
    assert.notEqual(await estado(), null);
    await sw.activar();
    assert.equal(await estado(), null, 'una versión que se activa no arrastra el fallo de otra');
  });
}
