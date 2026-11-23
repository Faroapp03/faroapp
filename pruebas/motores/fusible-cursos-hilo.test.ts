import { administracionDeAgentes } from '../ayudas/socios-api.ts';
// La app con la puerta del trabajador de cursos no carga nunca el motor de cursos en su hilo: con un gancho de carga de
// módulos (module.registerHooks, que solo ve este hilo) apunta cada módulo que se resuelve y, después de arrancar la
// API y de pedir /api/cursos (también con un filtro mal puesto) y MCP, ninguno es
// de motores/cursos/. Los filtros de /api/cursos y OpenAPI salen del contrato (compartido/contratos/filtros-de-cursos.ts).
// Y la puerta con trabajador no tiene cargar() ni ejecutar(): no hay con qué cargarlo aquí.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const MOTOR_DE_CURSOS = new URL('../../motores/cursos/', import.meta.url).href;
const cargados: string[] = [];
registerHooks({
  resolve(especificador, contexto, siguiente) {
    const resuelto = siguiente(especificador, contexto);
    cargados.push(resuelto.url);
    return resuelto;
  },
});

// Después del gancho: así ve todo lo que cargan.
const { crearApi } = await import('../../src/api/api.ts');
const { CABECERA_CONTRATO, CONTRATO_API } = await import('../../src/api/metadatos-http.ts');
const { cargarDatos } = await import('../../src/plataforma/node/datos.ts');
const { crearPuertaDeCursosNode } = await import('../../src/plataforma/node/puerta-de-cursos.ts');

const CARPETA = fileURLToPath(new URL('../../datos/', import.meta.url));
const ORIGEN = 'http://faro.test';
const HOY = '2026-10-07';
const CORRECTO = 200;
const INCORRECTA = 400;

/** Los módulos del motor de cursos cargados en este hilo. */
function delMotor(): string[] {
  return cargados.filter((url) => url.startsWith(MOTOR_DE_CURSOS));
}

test('con la puerta del trabajador, la app no carga el motor de cursos en su hilo', async () => {
  const puerta = crearPuertaDeCursosNode();
  assert.equal(puerta.enSuTrabajador, true);
  assert.ok(!('cargar' in puerta) && !('ejecutar' in puerta), 'la puerta con trabajador no carga el motor aquí');
  const api = await crearApi({
    datos: cargarDatos(CARPETA),
    origenesPermitidos: [],
    administracion: administracionDeAgentes().opciones,
    agentes: { mcp: true },
    motorDeCursos: puerta,
  });
  const pedir = (ruta: string, cuerpo?: unknown) =>
    api(
      new Request(`${ORIGEN}${ruta}`, {
        method: cuerpo === undefined ? 'GET' : 'POST',
        headers: {
          [CABECERA_CONTRATO]: String(CONTRATO_API),
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      }),
    );
  assert.equal((await pedir(`/api/cursos?fecha=${HOY}&modalidad=presencial&fuente=soc`)).status, CORRECTO);
  assert.equal((await pedir(`/api/cursos?fecha=${HOY}&modalidad=en-la-luna`)).status, INCORRECTA);
  const mcp = await pedir('/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert.ok(mcp.status < INCORRECTA, `MCP responde (${mcp.status})`);
  assert.ok(cargados.length > 0, 'el gancho ve los módulos de este hilo');
  assert.deepEqual(delMotor(), [], 'ningún módulo de motores/cursos/ en el hilo de la app');
});

test('OpenAPI describe los filtros de /api/cursos sin cargar el motor de cursos', async () => {
  await import('../../herramientas/api/openapi.ts');
  assert.deepEqual(delMotor(), []);
});
