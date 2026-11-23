import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ARCHIVO_OPENAPI } from '../../herramientas/api/openapi.ts';
import { OPERACIONES_DE_SOCIOS, rutasDeSocios } from '../../herramientas/api/openapi-socios.ts';
import { crearApi } from '../../src/api/api.ts';
import { HERRAMIENTAS } from '../../src/api/mcp/herramientas.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { SociosDePrueba } from '../ayudas/socios-api.ts';

const origen = 'https://publico.test';
type Operacion = { metodo: string; ruta: string };
function comprobar(operaciones: readonly Operacion[], rutas: Record<string, Record<string, unknown>>) {
  const esperadas = Object.entries(rutas).flatMap(([ruta, metodos]) =>
    Object.keys(metodos).map((metodo) => `${metodo.toUpperCase()} ${ruta}`),
  );
  const declaradas = operaciones.map(({ metodo, ruta }) => `${metodo} ${ruta}`);
  assert.equal(new Set(declaradas).size, declaradas.length);
  assert.deepEqual([...declaradas].sort(), esperadas.sort());
}

test('OpenAPI y el inventario coinciden y cada operación llega al manejador con su método', async () => {
  comprobar(OPERACIONES_DE_SOCIOS, rutasDeSocios());
  const montadas = [
    ...['token', 'revocar', 'introspeccion', 'invitacion/consultar', 'invitacion/activar'].map(
      (ruta) => `POST /api/socios/v1/${ruta}`,
    ),
    ...HERRAMIENTAS.map(({ name }) => `GET /api/socios/v1/consultas/${name}`),
  ];
  assert.deepEqual(OPERACIONES_DE_SOCIOS.map(({ metodo, ruta }) => `${metodo} ${ruta}`).sort(), montadas.sort());
  const documento = JSON.parse(readFileSync(ARCHIVO_OPENAPI, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  for (const { ruta, metodo } of OPERACIONES_DE_SOCIOS) {
    assert.ok(documento.paths[ruta]?.[metodo.toLowerCase()], `${metodo} ${ruta} en documento servido`);
  }
  const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
  const socios = new SociosDePrueba();
  const api = await crearApi({
    datos,
    origenesPermitidos: [],
    seguridad: { secretoFirma: 'firma-sintetica-estable-de-mas-de-treinta-y-dos-caracteres' },
    administracion: {
      leerControles: async () => ({ version: 2, revision: 0, api: 'habilitada', mcp: false, a2a: false }),
      socios: socios.opciones(),
      registrarAcceso: async () => undefined,
    },
  });
  for (const { ruta, metodo } of OPERACIONES_DE_SOCIOS) {
    const pedir = (method: string) => api(new Request(`${origen}${ruta}`, { method, headers: { origin: origen } }));
    const correcto = await pedir(metodo);
    let esperado: number = ESTADO_HTTP.solicitudIncorrecta;
    if (metodo === 'GET') {
      esperado = ESTADO_HTTP.noAutenticado;
    } else if (ruta.includes('/invitacion/')) {
      esperado = ESTADO_HTTP.tipoNoAdmitido;
    }
    assert.equal(correcto.status, esperado, `${metodo} ${ruta}`);
    const otro = await pedir(metodo === 'GET' ? 'POST' : 'GET');
    assert.equal(otro.status, ESTADO_HTTP.metodoNoAdmitido, `${ruta} rechaza otro método`);
    assert.equal(otro.headers.get('allow'), metodo);
  }
  assert.equal(
    (await api(new Request(`${origen}/api/socios/v1/inexistente`, { method: 'POST' }))).status,
    ESTADO_HTTP.noEncontrado,
  );
});

test('el contraste rechaza omisión, cambio de método, ruta y duplicados', () => {
  const rutas = rutasDeSocios();
  const [primera, ...resto] = OPERACIONES_DE_SOCIOS;
  assert.ok(primera);
  assert.throws(() => comprobar(resto, rutas));
  assert.throws(() => comprobar([{ ...primera, metodo: 'GET' }, ...resto], rutas));
  assert.throws(() => comprobar([{ ...primera, ruta: `${primera.ruta}-otra` }, ...resto], rutas));
  assert.throws(() => comprobar([...OPERACIONES_DE_SOCIOS, primera], rutas));
});
