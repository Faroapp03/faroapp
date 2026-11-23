import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../../src/api/api.ts';
import { definiciones } from '../../src/api/mcp/herramientas.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MAX_TAREAS_INFORME } from '../../src/comun/protocolo-web.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import {
  type ContextoDeModelo,
  type HerramientaWebMcp,
  ofrecerHerramientas,
  type Transporte,
} from '../../web/scripts/webmcp.js';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const ORIGEN = 'https://ensayo.invalid';
const SIN_CONTENIDO = 204;

const CASOS: readonly [string, string, unknown?][] = [
  ['GET', '/api/salud'],
  ['GET', '/api/grupos'],
  ['GET', '/api/grupos/7512'],
  ['GET', '/api/ocupaciones?texto=maestro'],
  ['GET', '/api/cursos?isco=7512'],
  ['GET', '/api/conectividad/estado'],
];

/** Las rutas que reciben lo que escribe la persona: solo el motor del dispositivo las atiende, con su estado. */
const CASOS_DEL_RELATO: readonly [string, string, number, unknown?][] = [
  ['POST', '/api/clasificar', ESTADO_HTTP.correcto, { texto: 'recepcionista' }],
  [
    'POST',
    '/api/informe?formato=html',
    ESTADO_HTTP.correcto,
    {
      isco08: '7512',
      fecha: FECHA_DEL_INFORME,
      sinIa: true,
      tareas: [
        {
          id: 'uno',
          texto: 'Tarea oficial 7512-1',
          tiempo: 'algo',
          referencia: { tareaOit: '7512-1', relacion: 'propia' },
        },
      ],
    },
  ],
  ...(['es', 'ca'] as const).map((idioma): [string, string, number, unknown] => [
    'POST',
    '/api/informe?formato=html',
    ESTADO_HTTP.correcto,
    {
      isco08: '7512',
      fecha: FECHA_DEL_INFORME,
      sinIa: true,
      idioma,
      tareas: Array.from({ length: MAX_TAREAS_INFORME }, (_, i) => ({
        id: `t${i}`,
        texto: `Tarea laboral ${i}`,
        tiempo: 'mucho',
      })),
    },
  ]),
  ['POST', '/api/informe', ESTADO_HTTP.solicitudIncorrecta, {}],
  ['GET', '/api/informe', ESTADO_HTTP.metodoNoAdmitido],
];

/** La petición de un caso, con el contrato vigente y, si lo lleva, su cuerpo JSON. */
function peticionDelCaso(method: string, ruta: string, cuerpo: unknown): Request {
  return new Request(ORIGEN + ruta, {
    method,
    headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
}

test('el adaptador conserva las respuestas de las operaciones factuales del dispositivo', async () => {
  const anterior = await crearApi({ datos: DATOS, origenesPermitidos: [], agentes: { mcp: true }, motorDeCursos });
  const nueva = await crearApiLocal({ datos: DATOS, motorDeCursos });
  for (const [method, ruta, cuerpo] of CASOS) {
    const vieja = await anterior(peticionDelCaso(method, ruta, cuerpo));
    const actual = await nueva(peticionDelCaso(method, ruta, cuerpo));
    assert.equal(actual.status, vieja.status, ruta);
    assert.equal(await actual.text(), await vieja.text(), ruta);
  }
});

test('la clasificación y el informe se atienden en el dispositivo; el servidor no tiene esas rutas', async () => {
  const servidor = await crearApi({ datos: DATOS, origenesPermitidos: [], agentes: { mcp: true }, motorDeCursos });
  const dispositivo = await crearApiLocal({ datos: DATOS, motorDeCursos });
  for (const [method, ruta, estado, cuerpo] of CASOS_DEL_RELATO) {
    assert.equal((await dispositivo(peticionDelCaso(method, ruta, cuerpo))).status, estado, `${method} ${ruta}`);
    const respuesta = await servidor(peticionDelCaso(method, ruta, cuerpo));
    assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, `${method} ${ruta}`);
    assert.equal(respuesta.headers.get('allow'), null, `${method} ${ruta}`);
  }
});

test('cancelación conserva el resultado de la API en el dispositivo', async () => {
  const anterior = await crearApi({ datos: DATOS, origenesPermitidos: [], agentes: { mcp: true }, motorDeCursos });
  const nueva = await crearApiLocal({ datos: DATOS, motorDeCursos });
  const corte = new AbortController();
  corte.abort();
  const solicitud = () =>
    new Request(`${ORIGEN}/api/grupos`, {
      signal: corte.signal,
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
    });
  const vieja = await anterior(solicitud());
  const actual = await nueva(solicitud());
  assert.equal(actual.status, vieja.status);
  assert.equal(await actual.text(), await vieja.text());
});

test('WebMCP local opera sin red; socios y A2A no están montados en el dispositivo', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No se permite red'));
  const api = await crearApiLocal({ datos: DATOS, motorDeCursos });
  const registradas = new Map<string, HerramientaWebMcp>();
  const modelo: ContextoDeModelo = {
    async registerTool(herramienta) {
      registradas.set(herramienta.name, herramienta);
    },
  };
  const transporte: Transporte = (ruta, opciones) => api(new Request(new URL(ruta, ORIGEN), opciones));
  assert.deepEqual(
    await ofrecerHerramientas(modelo, { transporte }),
    definiciones().map((d) => d.name),
  );
  const ficha = registradas.get('ficha_grupo');
  assert.ok(ficha);
  assert.ok(await ficha.execute({ isco: '7512' }, {}));
  await comprobarCanalesCerrados(api);
});

async function comprobarCanalesCerrados(api: Awaited<ReturnType<typeof crearApiLocal>>) {
  const rutasCerradas = [
    '/a2a',
    '/a2a/',
    '/.well-known/agent-card.json',
    '/.well-known/agent-card.json/',
    '/api/socios/v1',
    '/api/socios/v1/token',
    '/api/socios/v1/token/',
    '/api/socios/v1/invitacion/consultar',
    '/api/socios/v1/invitacion/activar',
    '/api/socios/v1/revocar',
    '/api/socios/v1/introspeccion',
    '/api/socios/v1/consultas/ficha_grupo',
    '/.well-known/oauth-authorization-server/api/socios/v1',
    '/.well-known/oauth-protected-resource/api/socios/v1',
  ];
  for (const ruta of rutasCerradas) {
    for (const metodo of ['GET', 'POST']) {
      const respuesta = await api(
        new Request(ORIGEN + ruta, {
          method: metodo,
          headers: {
            [CABECERA_CONTRATO]: String(CONTRATO_API),
            authorization: 'Bearer valor-sintetico',
            origin: 'https://tercero.invalid',
            ...(metodo === 'POST' ? { 'content-type': 'application/json' } : {}),
          },
          ...(metodo === 'POST' ? { body: '{}' } : {}),
        }),
      );
      assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, `${metodo} ${ruta}`);
      assert.equal(respuesta.headers.get('access-control-allow-origin'), null);
      assert.doesNotMatch(await respuesta.text(), /valor-sintetico/);
    }
    const opciones = await api(
      new Request(ORIGEN + ruta, {
        method: 'OPTIONS',
        headers: { origin: 'https://tercero.invalid', 'access-control-request-method': 'POST' },
      }),
    );
    assert.equal(opciones.status, SIN_CONTENIDO, `OPTIONS ${ruta}: preflight genérico`);
    assert.equal(opciones.headers.get('access-control-allow-origin'), null);
    assert.equal(await opciones.text(), '');
  }
}
