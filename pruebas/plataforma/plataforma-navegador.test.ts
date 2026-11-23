// Mismo contrato REST factual vigente con paquete real publicado y fetch sustituido por disco, sin red.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi, type ResponderApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { crearMotorLocal, type MotorLocal } from '../../src/plataforma/navegador/motor.ts';
import { MAX_CUERPO_BYTES } from '../../src/seguridad/limites.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const datos = fileURLToPath(new URL('../../datos/', import.meta.url));
const BASE = 'https://sintetico.invalid/';
const CIFRAS_SHA256 = 64;
const COTEJOS_POST = 28;

const CASOS_POST = [
  {
    ruta: '/api/clasificar',
    body: JSON.stringify({ texto: 'Soy conductor de autobús urbano', idioma: 'es' }),
    status: ESTADO_HTTP.correcto,
  },
  {
    ruta: '/api/clasificar',
    body: JSON.stringify({ texto: 'Soc conductor d’autobús urbà', idioma: 'ca' }),
    status: ESTADO_HTTP.correcto,
  },
  {
    ruta: '/api/informe?formato=html',
    status: ESTADO_HTTP.correcto,
    body: JSON.stringify({
      isco08: '4226',
      fecha: FECHA_DEL_INFORME,
      sinIa: true,
      idioma: 'es',
      tareas: [{ id: 'uno', texto: 'Atender cada consulta', tiempo: 'mucho' }],
    }),
  },
  { ruta: '/api/clasificar', body: '', status: ESTADO_HTTP.solicitudIncorrecta },
  { ruta: '/api/clasificar', body: 'no es JSON', status: ESTADO_HTTP.solicitudIncorrecta },
  { ruta: '/api/clasificar', body: 'x'.repeat(MAX_CUERPO_BYTES + 1), status: ESTADO_HTTP.solicitudIncorrecta },
  { ruta: '/api/clasificar', body: 'ñ'.repeat(MAX_CUERPO_BYTES / 2 + 1), status: ESTADO_HTTP.solicitudIncorrecta },
];

test('el navegador conserva respuestas, cabeceras y métodos admitidos del motor del dispositivo', async (t) => {
  t.mock.method(globalThis, 'fetch', async (entrada: string | URL | Request) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    assert.equal(url.origin, new URL(BASE).origin);
    const archivo = url.pathname.split('/').at(-1);
    assert.ok(archivo && /^[a-z0-9-]+\.json$/u.test(archivo));
    return new Response(readFileSync(join(datos, archivo)));
  });
  const motor = await crearMotorLocal(new URL(`${BASE}paquete/`));
  const api = await crearApi({
    datos: motor.datos,
    origenesPermitidos: [],
    agentes: { mcp: true },
  });
  for (const [ruta, estado] of [
    ['/api/salud', ESTADO_HTTP.correcto],
    ['/api/ocupaciones?q=docencia', ESTADO_HTTP.correcto],
    ['/api/grupos', ESTADO_HTTP.correcto],
    ['/api/entender', ESTADO_HTTP.noEncontrado],
  ] as const) {
    const peticion = new Request(`${BASE.slice(0, -1)}${ruta}`, {
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
    });
    const local = await motor.responder({
      url: peticion.url,
      method: peticion.method,
      headers: [...peticion.headers],
      body: null,
    });
    const directo = await api(peticion);
    assert.equal(directo.status, estado, ruta);
    assert.equal(local.status, directo.status, ruta);
    assert.deepEqual(Object.fromEntries(local.headers), Object.fromEntries(directo.headers), ruta);
    assert.equal(await local.text(), await directo.text(), ruta);
  }
  assert.equal(motor.version.length, CIFRAS_SHA256);
  await cotejarPost(await crearApiLocal({ datos: motor.datos, motorDeCursos }), motor);
});

/**
 * La clasificación y el informe solo los atiende el motor del dispositivo: su respuesta por el mensaje del Worker,
 * con el cuerpo como flujo o sin él, es la misma que la de su API llamada directamente.
 */
async function cotejarPost(api: ResponderApi, motor: MotorLocal): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'body');
  assert.ok(descriptor);
  const headers: [string, string][] = [
    ['content-type', 'application/json'],
    [CABECERA_CONTRATO, String(CONTRATO_API)],
  ];

  let comparaciones = 0;
  for (const { ruta, body, status } of CASOS_POST) {
    for (const cabeceras of [headers, [...headers, ['content-length', '1']]] satisfies [string, string][][]) {
      const entrada = { url: `${BASE.slice(0, -1)}${ruta}`, method: 'POST', headers: cabeceras, body };
      const nativa = await api(new Request(entrada.url, { method: entrada.method, headers: cabeceras, body }));
      assert.equal(nativa.status, status, ruta);
      const normal = await motor.responder(entrada);
      let portable: Response;
      try {
        Object.defineProperty(Request.prototype, 'body', { ...descriptor, get: () => undefined });
        portable = await motor.responder(entrada);
      } finally {
        Object.defineProperty(Request.prototype, 'body', descriptor);
      }
      const textoNativo = await nativa.text();
      for (const respuesta of [normal, portable]) {
        assert.equal(respuesta.status, nativa.status, ruta);
        assert.deepEqual(Object.fromEntries(respuesta.headers), Object.fromEntries(nativa.headers), ruta);
        assert.equal(await respuesta.text(), textoNativo, ruta);
        comparaciones++;
      }
    }
  }
  assert.equal(comparaciones, COTEJOS_POST);
}
