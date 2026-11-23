// Consumidores reales con OAuth y datos publicados; ninguna petición de red.
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DocumentoControles } from '../../src/administracion/controles.ts';
import { crearApi, type OpcionesApi, type ResponderApi } from '../../src/api/api.ts';
import { type AdministracionApi, capturarControles } from '../../src/api/controles-administrativos.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { huellaDelSecreto } from '../../src/api/socios/registro.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { objeto } from '../ayudas/objeto-json.ts';
import { SociosDePrueba } from '../ayudas/socios-api.ts';

const CABECERA_SESION = 'x-faro-sesion';
const ORIGEN = 'https://publico.test';
const SECRETO = 'credencial sintetica de prueba con mas de treinta y dos caracteres';
const CLIENTE = 'inst-11111111-1111-4111-8111-111111111111';
const EXITO = 200,
  AUSENTE = 404,
  CUOTA = 429,
  NO_DISPONIBLE = 503;
const LECTURAS_TRANSICIONES = 7,
  LECTURAS_FALLO = 6,
  TOPE_ESPERA_MS = 2000;
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const RELATO = { relato: 'Dar citas a pacientes en la recepción' };
const ERROR_OPCIONES = { name: 'TypeError', message: 'Opciones de API no válidas' };
const politica = (cambios: Partial<DocumentoControles> = {}): DocumentoControles => ({
  version: 2,
  revision: 0,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
  ...cambios,
});
function registrada(leerControles: AdministracionApi['leerControles'], socios?: SociosDePrueba): AdministracionApi {
  const registro = socios ?? new SociosDePrueba();
  return {
    leerControles,
    registrarAcceso: async (uso) => {
      registro.usos.push(uso);
    },
    ...(socios ? { socios: socios.opciones() } : {}),
  };
}
function sociosDePrueba() {
  const almacen = new SociosDePrueba();
  almacen.socios.set(CLIENTE, { id: CLIENTE, huellas: [huellaDelSecreto(SECRETO)], consultasPorHora: 2 });
  return almacen;
}
function opciones(administracion?: AdministracionApi, cambios: Partial<OpcionesApi> = {}): OpcionesApi {
  return {
    datos: DATOS,
    origenesPermitidos: [],
    seguridad: { secretoFirma: SECRETO },
    ...(administracion ? { administracion } : {}),
    ...cambios,
  };
}
function crear(administracion?: AdministracionApi, cambios: Partial<OpcionesApi> = {}) {
  return crearApi(opciones(administracion, cambios));
}
function get(api: ResponderApi, ruta: string, token?: string) {
  return api(
    new Request(ORIGEN + ruta, {
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }),
  );
}
function post(api: ResponderApi, ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) {
  return api(
    new Request(ORIGEN + ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API), ...headers },
      body: JSON.stringify(cuerpo),
    }),
  );
}
function pedirToken(api: ResponderApi) {
  return api(
    new Request(`${ORIGEN}/api/socios/v1/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${CLIENTE}:${SECRETO}`)}`,
      },
    }),
  );
}
async function token(api: ResponderApi) {
  const respuesta = await pedirToken(api);
  assert.equal(respuesta.status, EXITO);
  return String(objeto(await respuesta.json()).access_token);
}
function mcp(api: ResponderApi, nombre = 'explorar_grupos', credencial?: string) {
  return post(
    api,
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: nombre, arguments: nombre === 'entender_tareas' ? RELATO : { padre: '4' } },
    },
    credencial ? { authorization: `Bearer ${credencial}` } : {},
  );
}
before(() => mock.method(globalThis, 'fetch', () => assert.fail('La prueba no permite red')));
after(() => mock.restoreAll());

test('ausencia administrativa con capacidades apagadas es OFF conocido y no prepara rutas activas', async () => {
  const api = await crear();
  assert.equal((await mcp(api)).status, AUSENTE);
  const salud = objeto(await (await get(api, '/api/salud')).json());
  assert.equal(Object.hasOwn(salud, 'ia'), false);
  const estado = objeto(await (await get(api, '/api/conectividad/estado')).json());
  assert.deepEqual(estado.servicios, { api: false, mcp: false, a2a: false });
});

test('cada petición lee una vez; cambios habilitan capacidades inicialmente apagadas y cierran tarjeta/discovery', async () => {
  let actual = politica(),
    lecturas = 0;
  const api = await crear(
    registrada(async () => {
      lecturas++;
      return actual;
    }),
  );
  assert.equal((await mcp(api)).status, AUSENTE);
  assert.equal(lecturas, 1);
  actual = politica({ revision: 1, mcp: true, a2a: true });
  assert.equal((await mcp(api)).status, EXITO);
  const tarjeta = await get(api, '/.well-known/agent-card.json');
  assert.equal(tarjeta.status, EXITO);
  assert.equal(tarjeta.headers.get('cache-control'), 'no-store');
  actual = politica({ revision: 2 });
  for (const ruta of ['/mcp', '/a2a', '/.well-known/agent-card.json', '/.well-known/oauth-protected-resource/mcp']) {
    assert.equal((await get(api, ruta)).status, AUSENTE);
  }
  assert.equal(lecturas, LECTURAS_TRANSICIONES);
});

test('apagar y encender la API conserva la clave, el token previo y la cuota consumida', async () => {
  let actual = politica({ api: 'habilitada' });
  const almacen = sociosDePrueba();
  const api = await crear(registrada(async () => actual, almacen));
  const credencial = await token(api),
    ruta = '/api/socios/v1/consultas/explorar_grupos?padre=4';
  assert.equal((await get(api, ruta, credencial)).status, EXITO);
  const cuentas = [...almacen.cuentas];
  actual = politica({ revision: 1, api: 'deshabilitada' });
  assert.equal((await get(api, ruta, credencial)).status, AUSENTE);
  assert.equal((await pedirToken(api)).status, AUSENTE);
  assert.deepEqual([...almacen.cuentas], cuentas);
  assert.equal(almacen.socios.size, 1);
  actual = politica({ revision: 2, api: 'habilitada' });
  assert.equal((await get(api, ruta, credencial)).status, EXITO);
  assert.equal((await get(api, ruta, credencial)).status, CUOTA);
  assert.deepEqual(
    almacen.usos.filter((u) => u.canal === 'api').map((u) => u.estadoHttp),
    [EXITO, EXITO, CUOTA],
  );
});

test('API institucional apagada cierra OAuth y conserva MCP factual abierto sin descubrimiento generativo', async () => {
  const actual = politica({ mcp: true });
  const api = await crear(registrada(async () => actual, sociosDePrueba()));
  assert.equal((await pedirToken(api)).status, AUSENTE);
  assert.equal((await mcp(api)).status, EXITO);
  assert.equal((await mcp(api, 'explorar_grupos', 'token-ajeno')).status, EXITO);
  assert.equal((await get(api, '/.well-known/oauth-protected-resource/mcp')).status, AUSENTE);
  assert.equal((await get(api, '/.well-known/oauth-protected-resource/api/socios/v1/operaciones')).status, AUSENTE);
});

test('las opciones históricas se rechazan en la composición sin resolver proveedores', async () => {
  let resoluciones = 0;
  const administracion = {
    ...registrada(async () => politica({ mcp: true })),
    resolverCapacidadIa: async () => {
      resoluciones++;
      throw new Error('perfil no permitido');
    },
  };
  await assert.rejects(crear(administracion), ERROR_OPCIONES);
  await assert.rejects(crearApi({ ...opciones(), ...{ ia: { iaOff: true } } }), ERROR_OPCIONES);
  assert.equal(resoluciones, 0);
});

test('los callbacks retirados tampoco se aceptan por herencia ni se leen como accesores', async () => {
  let lecturas = 0;
  const heredada = Object.setPrototypeOf(
    registrada(async () => politica()),
    {
      resolverCapacidadIa: () => {
        lecturas++;
      },
    },
  );
  await assert.rejects(crear(heredada), ERROR_OPCIONES);
  const accesora = registrada(async () => politica());
  Object.defineProperty(accesora, 'resolverCapacidadIa', {
    enumerable: true,
    get() {
      lecturas++;
      throw new Error('detalle privado');
    },
  });
  await assert.rejects(crear(accesora), ERROR_OPCIONES);
  assert.equal(lecturas, 0);
});

test('documento ausente no recupera semillas: datos siguen, servicios y estado 503 sin inventar apagado', async () => {
  let lecturas = 0;
  const api = await crear(
    registrada(async () => {
      lecturas++;
      return null as unknown as DocumentoControles;
    }, sociosDePrueba()),
    { agentes: { mcp: true, a2a: true } },
  );
  for (const ruta of [
    '/mcp',
    '/a2a',
    '/.well-known/agent-card.json',
    '/api/socios/v1/token',
    '/api/conectividad/estado',
  ]) {
    assert.equal((await get(api, ruta)).status, NO_DISPONIBLE);
  }
  const respuesta = await get(api, '/api/salud');
  assert.equal(respuesta.status, EXITO);
  assert.equal(Object.hasOwn(objeto(await respuesta.json()), 'ia'), false);
  assert.equal(lecturas, LECTURAS_FALLO);
});

test('lectura bloqueada tiene plazo propio y deja responder datos sin fallback', async () => {
  const api = await crear(
    registrada(() => new Promise(() => {})),
    { plazoMs: TOPE_ESPERA_MS },
  );
  assert.equal((await get(api, '/api/grupos')).status, EXITO);
});

test('captura copia y congela; peticiones concurrentes no comparten revisión mutable', async () => {
  const entrada = politica({ mcp: true });
  const captura = await capturarControles(
    registrada(async () => entrada),
    new AbortController().signal,
  );
  assert.ok(captura);
  assert.notEqual(captura, entrada);
  assert.ok(Object.isFrozen(captura));
  const pendientes: ((controles: DocumentoControles) => void)[] = [];
  const api = await crear(registrada(() => new Promise((resolver) => pendientes.push(resolver))));
  const uno = mcp(api),
    dos = mcp(api);
  await new Promise<void>((resolver) => setImmediate(resolver));
  assert.equal(pendientes.length, 2);
  pendientes[0]?.(politica({ mcp: true }));
  pendientes[1]?.(politica({ revision: 1 }));
  assert.deepEqual(
    (await Promise.all([uno, dos])).map((respuesta) => respuesta.status),
    [EXITO, AUSENTE],
  );
});

test('excepción y documento defectuoso cierran servicios sin reflejar detalles ni usar política inicial', async () => {
  const lectores: AdministracionApi['leerControles'][] = [
    async () => {
      throw new Error('detalle privado del almacén');
    },
    async () => ({ ...politica(), secreto: 'detalle privado' }) as DocumentoControles,
  ];
  for (const leerControles of lectores) {
    const api = await crear(registrada(leerControles), { agentes: { mcp: true } });
    const respuesta = await mcp(api);
    assert.equal(respuesta.status, NO_DISPONIBLE);
    assert.doesNotMatch(await respuesta.text(), /detalle privado/);
    assert.equal((await get(api, '/api/grupos')).status, EXITO);
  }
});

test('un accesor de proveedor retirado se rechaza sin leer ni revelar detalles privados', async () => {
  let lecturas = 0;
  const entrada = opciones();
  Object.defineProperty(entrada, 'cerebro', {
    enumerable: true,
    get() {
      lecturas++;
      throw new Error('detalle privado del perfil');
    },
  });
  await assert.rejects(crearApi(entrada), ERROR_OPCIONES);
  assert.equal(lecturas, 0);
});

test('la ruta de alta retirada no consume cuota ni crea instituciones aunque la API esté habilitada', async () => {
  const almacen = sociosDePrueba();
  const api = await crear(registrada(async () => politica({ api: 'habilitada' }), almacen));
  assert.equal((await get(api, '/api/socios/v1/registro')).status, AUSENTE);
  assert.equal((await post(api, '/api/socios/v1/registro', {}, { origin: ORIGEN })).status, AUSENTE);
  assert.equal(almacen.socios.size, 1);
  assert.equal(almacen.cuentas.size, 0);
});

test('los interruptores no sustituyen la política factual ni las referencias del informe', async () => {
  const ruta = '/api/grupos/1439';
  const ampliada = await crear(undefined, { politicaReferencias: 'ampliada' });
  const oit = await crear(undefined, { politicaReferencias: 'oit' });
  const esperadoAmpliado = await (await get(ampliada, ruta)).text(),
    esperadoOit = await (await get(oit, ruta)).text();
  assert.notEqual(esperadoOit, esperadoAmpliado);
  let actual = politica();
  const api = await crear(
    registrada(async () => actual),
    { politicaReferencias: 'ampliada' },
  );
  assert.equal(await (await get(api, ruta)).text(), esperadoAmpliado);
  actual = politica({ revision: 1, mcp: true });
  assert.equal(await (await get(api, ruta)).text(), esperadoAmpliado);
  actual = politica({ revision: 2, a2a: true });
  assert.equal(await (await get(api, ruta)).text(), esperadoAmpliado);
  const respuesta = await post(api, '/api/entender', RELATO);
  assert.equal(respuesta.status, AUSENTE);
  assert.equal(respuesta.headers.get(CABECERA_SESION), null);
});
