import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../../src/api/api.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { comprobarTodo, type Entorno } from '../../web/scripts/doctor/comprobaciones.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';

const FUNCIONES = Object.fromEntries(
  ['fetch', 'AbortController', 'TextEncoder', 'URL', 'Intl', 'serviceWorker', 'caches', 'localStorage'].map(
    (nombre) => [nombre, true],
  ),
);

test('Comprobación consulta la API actual con contrato vigente y no marca como averiado un servidor sano', async () => {
  const api = await crearApi({
    datos: cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url))),
    origenesPermitidos: [],
  });
  const consultas: { ruta: string; cabecera: string | null }[] = [];
  const entorno: Entorno = {
    fetch: async (direccion, opciones) => {
      const peticion = new Request(new URL(direccion, 'https://faro.example/'), opciones);
      consultas.push({ ruta: direccion, cabecera: peticion.headers.get(CABECERA_CONTRATO) });
      return direccion === '/api/salud' ? api(peticion) : new Response("const VERSION = 'aaaa';");
    },
    caches: undefined,
    location: { href: 'https://faro.example/doctor.html' },
    enLinea: true,
    idiomaNavegador: 'es',
    controlada: false,
    estimarEspacio: async () => null,
    funciones: FUNCIONES,
  };
  const hecho = await comprobarTodo(entorno, 'es');
  assert.deepEqual(
    hecho.resultados.find(({ id }) => id === 'servidor'),
    {
      id: 'servidor',
      semaforo: 'bien',
      caso: 'responde',
      valores: { version: '1.0.0' },
    },
  );
  assert.equal(
    hecho.resultados.some(({ id }) => id === 'ia'),
    false,
  );
  assert.deepEqual(consultas, [
    { ruta: '/api/salud', cabecera: String(CONTRATO_API) },
    { ruta: 'service-worker.js', cabecera: null },
  ]);
});
