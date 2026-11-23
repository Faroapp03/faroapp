// La copia de estado del service worker (service-worker.js, «Instalación que no coincide») no es una versión de la web:
// «Comprobación» (scripts/doctor/comprobaciones.js) lee como versiones instaladas las copias `faro:<base>:<VERSION>`, y
// la constancia de una instalación fallida no puede aparecer entre ellas ni hacer creer que la copia es de otra
// versión.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarTodo } from '../../web/scripts/doctor/comprobaciones.js';
import { servicioPublicado } from '../ayudas/web-construida.ts';

const BASE = 'https://faroapp.org/';
const PUBLICADA = 'aaaaaaaaaaaaaaaa';
const FUENTE = servicioPublicado();

/** El nombre de la copia de estado para `base`, tal como lo escribe el service worker. */
function copiaDelEstado(base: string): string {
  const plantilla = /^var COPIA_DEL_ESTADO = `([^`]+)`;$/mu.exec(FUENTE)?.[1];
  assert.ok(plantilla, 'El service worker declara COPIA_DEL_ESTADO');
  return plantilla.replace(/\$\{BASE\.href\}/u, base);
}

/** Un navegador de mentira con la copia de esta versión y las copias que se indiquen. */
function entorno(copias: string[]) {
  return {
    fetch: async (direccion: string) =>
      direccion === '/api/salud'
        ? new Response(JSON.stringify({ estado: 'ok', version: '1.0.0', interruptores: {}, soporte: 'a@b.example' }))
        : new Response(`var VERSION = "${PUBLICADA}";\n`),
    caches: { keys: async () => [`faro:${BASE}:${PUBLICADA}`, ...copias] },
    location: { href: `${BASE}doctor.html` },
    enLinea: true,
    idiomaNavegador: 'es',
    controlada: true,
    estimarEspacio: async () => null,
    funciones: Object.fromEntries(
      ['fetch', 'AbortController', 'TextEncoder', 'URL', 'Intl', 'serviceWorker', 'caches', 'localStorage'].map(
        (nombre) => [nombre, true],
      ),
    ),
  };
}

test('la copia de estado no es una versión instalada para «Comprobación»', async () => {
  const sin = (await comprobarTodo(entorno([]), 'es')).resultados.find(({ id }) => id === 'copia');
  const con = (await comprobarTodo(entorno([copiaDelEstado(BASE)]), 'es')).resultados.find(({ id }) => id === 'copia');
  assert.equal(sin?.caso, 'al-dia');
  assert.deepEqual(con, sin, 'con la constancia, la copia sigue al día y con los mismos datos');
});
