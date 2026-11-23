// Lo que «Comprobación» (scripts/doctor/comprobaciones.js) hace con respuestas del servidor que no son las esperadas: un
// cuerpo que se corta a mitad de lectura, una salud sin versión o con un «desde» que no es texto; que las cadenas del
// contrato de /api/salud son las que escribe el servidor; y que la tabla de lo que se comprueba del navegador da las
// mismas claves que lee el semáforo. Se ejecutan con npm test (o, desde web/, node --test pruebas/*.test.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  comprobarNavegador,
  comprobarServidor,
  comprobarTodo,
  entornoDelNavegador,
} from '../../web/scripts/doctor/comprobaciones.js';

const BASE = 'https://faroapp.org/';
/** Las comprobaciones que enseña «Comprobación»: navegador, conexión, servidor, copia, espacio e idioma. */
const COMPROBACIONES = Object.freeze(['navegador', 'conexion', 'servidor', 'copia', 'espacio', 'idioma']);
/** Valores de un campo de texto que no son texto: un número y un objeto. */
const NO_SON_TEXTO = Object.freeze([Number.NaN, Object.freeze({ mayor: 1 })]);

/**
 * Un navegador de mentira cuyo service worker responde con un cuerpo que falla al leerlo, como cuando el plazo corta
 * la lectura a mitad.
 * @returns {import('../../web/scripts/doctor/comprobaciones.js').Entorno}
 */
function entornoConCuerpoCortado() {
  return {
    fetch: async (direccion) => {
      if (direccion === '/api/salud') {
        return new Response(JSON.stringify({ estado: 'ok', version: '1.0.0', cerebro: null }), { status: 200 });
      }
      const cortada = new Response('', { status: 200 });
      Object.defineProperty(cortada, 'text', { value: () => Promise.reject(new DOMException('corte', 'AbortError')) });
      return cortada;
    },
    caches: { keys: async () => [`faro:${BASE}:aaaa`] },
    location: { href: `${BASE}doctor.html` },
    enLinea: true,
    idiomaNavegador: 'es-ES',
    controlada: true,
    estimarEspacio: async () => null,
    funciones: Object.fromEntries(Object.keys(entornoDelNavegador().funciones).map((nombre) => [nombre, true])),
  };
}

test('un cuerpo del service worker que se corta al leerlo da «sin comparar», sin tumbar el diagnóstico', async () => {
  const hecho = await comprobarTodo(entornoConCuerpoCortado(), 'es');
  const copia = hecho.resultados.find(({ id }) => id === 'copia');
  assert.deepEqual(copia, { id: 'copia', semaforo: 'bien', caso: 'sin-comparar', valores: { instalada: 'aaaa' } });
  assert.deepEqual(
    hecho.resultados.map(({ id }) => id),
    COMPROBACIONES,
    'las seis comprobaciones',
  );
});

test('una salud sin versión, o con una versión que no es texto, escribe «?» y nunca «undefined»', () => {
  for (const version of [undefined, ...NO_SON_TEXTO]) {
    const [, servidor] = comprobarServidor(true, {
      cuerpo: { estado: 'ok', version, cerebro: null },
    });
    assert.ok(servidor);
    assert.deepEqual(servidor.valores, { version: '?' }, String(version));
  }
});

test('la tabla del navegador da todas las claves que lee el semáforo: con todas presentes, «completo»', () => {
  const { funciones } = entornoDelNavegador();
  const todas = Object.fromEntries(Object.keys(funciones).map((nombre) => [nombre, true]));
  assert.equal(comprobarNavegador(todas).caso, 'completo');
  for (const nombre of Object.keys(funciones)) {
    const sinUna = { ...todas, [nombre]: false };
    assert.notEqual(comprobarNavegador(sinUna).caso, 'completo', `sin ${nombre}`);
  }
});
