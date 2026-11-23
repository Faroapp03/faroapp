// API ensamblada con datos publicados, OAuth real y dobles locales; ninguna llamada de red está permitida.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as motor from '../../motores/cursos/src/index.ts';
import { LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { VERSION_A2A } from '../../src/api/a2a/tarjeta.ts';
import { crearApi, type OpcionesApi, type ResponderApi } from '../../src/api/api.ts';
import { HERRAMIENTAS, llamarHerramienta } from '../../src/api/mcp/herramientas.ts';
import { CODIGO } from '../../src/api/mcp/protocolo.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../src/api/problemas.ts';
import { huellaDelSecreto } from '../../src/api/socios/registro.ts';
import { aBase64Url, deBase64Url } from '../../src/comun/base64url.js';
import { leerDatosGlobales } from '../../src/datos-globales/datos.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { subclaveDe } from '../../src/seguridad/firma.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';
import { construirInformeConFormacion as construirInforme } from '../ayudas/informe-con-formacion.ts';
import { objeto } from '../ayudas/objeto-json.ts';
import { SociosDePrueba } from '../ayudas/socios-api.ts';

type CanalRetirado = 'mcp' | 'a2a' | 'api';

const ORIGEN = 'https://integracion.test';
const HOY = '2026-10-13';
const CLIENTE = 'inst-11111111-1111-4111-8111-111111111111';
const SECRETO = 'credencial-sintetica-local-de-mas-de-32-caracteres';
const CUOTA_DE_PRUEBA = 1000;
const CORRECTO = 200;
const SOLICITUD_INCORRECTA = 400;
const NO_ENCONTRADO = 404;
const METODO_NO_ADMITIDO = 405;
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const GLOBALES = leerDatosGlobales(
  JSON.parse(readFileSync(new URL('../../datos/globales/datos-globales.json', import.meta.url), 'utf8')),
);
/** El motor de cursos ya cargado, como lo deja la puerta de la API antes de una consulta de formación. */
const CON_MOTOR = { disponible: true, motor } as const;
const ENTRADA: Entrada = {
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
};
const CONSULTAS: Record<string, Record<string, unknown>> = {
  buscar_ocupacion: { texto: 'recepcionista' },
  explorar_grupos: { padre: '4' },
  ficha_grupo: { isco: '4224' },
  formacion_oficial: { isco: '4224' },
  acreditacion_competencias: { isco: '4224' },
  contexto_del_grupo: { isco: '4224' },
  catalogo_datos_globales: { seccion: 'indicadores', maximo: 2 },
  consultar_datos_globales: { seccion: 'calculados', id: 'exposicion-alta', territorio: 'CHL', anio: 2022 },
};
const ARGUMENTOS: Record<string, Record<string, unknown>> = {
  clasificar_trabajo: { texto: 'recepcionista' },
  entender_tareas: { relato: 'Dar citas a pacientes en la recepción' },
  enlazar_tareas: { isco08: '4226', tareas: ['Dar citas a pacientes'] },
  estimar_tarea: { isco08: '4226', tarea: 'Dar citas a pacientes' },
  construir_informe: { ...ENTRADA },
};

before(() => mock.method(globalThis, 'fetch', () => assert.fail('La prueba no permite ninguna llamada de red')));
after(() => mock.restoreAll());

/** Cada API conserva cuentas y cuotas independientes; el registro contiene solo una credencial sintética. */
function opciones(socios = new SociosDePrueba()): OpcionesApi {
  socios.socios.set(CLIENTE, { id: CLIENTE, huellas: [huellaDelSecreto(SECRETO)], consultasPorHora: CUOTA_DE_PRUEBA });
  return {
    datos: DATOS,
    datosGlobales: GLOBALES,
    origenesPermitidos: [],
    seguridad: { secretoFirma: SECRETO },
    agentes: {
      mcp: { hoy: () => HOY, limitador: () => true },
      a2a: { hoy: () => HOY, limitador: () => true },
    },
    administracion: {
      leerControles: async () => ({ version: 2, revision: 0, api: 'habilitada', mcp: true, a2a: true }),
      socios: { ...socios.opciones(), hoy: () => HOY },
      registrarAcceso: async (uso) => {
        socios.usos.push(uso);
      },
    },
  };
}
function crear() {
  return crearApi(opciones());
}
/** La API del motor del dispositivo, la única que atiende la clasificación y el informe. */
function crearLocal() {
  return crearApiLocal({ datos: DATOS, datosGlobales: GLOBALES, secretoFirma: SECRETO, motorDeCursos });
}

function post(api: ResponderApi, ruta: string, cuerpo: unknown, extras: Record<string, string> = {}) {
  return api(
    new Request(`${ORIGEN}${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API), ...extras },
      body: JSON.stringify(cuerpo),
    }),
  );
}

/** Pide un token con el secreto dado; por defecto, el de la credencial sintética. */
function pedirToken(api: ResponderApi, secreto = SECRETO): Promise<Response> {
  return api(
    new Request(`${ORIGEN}/api/socios/v1/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${CLIENTE}:${secreto}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    }),
  );
}

async function token(api: ResponderApi): Promise<string> {
  const respuesta = await pedirToken(api);
  assert.equal(respuesta.status, CORRECTO, await respuesta.clone().text());
  const credencial = objeto(await respuesta.json()).access_token;
  assert.equal(typeof credencial, 'string');
  return String(credencial);
}

function llamar(
  api: ResponderApi,
  canal: CanalRetirado,
  pedido: { nombre: string; argumentos: unknown; token?: string },
) {
  const { nombre, argumentos } = pedido;
  const cabeceras = pedido.token ? { authorization: `Bearer ${pedido.token}` } : {};
  if (canal === 'mcp') {
    return post(
      api,
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nombre, arguments: argumentos } },
      cabeceras,
    );
  }
  if (canal === 'a2a') {
    return post(
      api,
      '/a2a',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'SendMessage',
        params: {
          message: {
            role: 'ROLE_USER',
            messageId: 'local',
            contextId: 'contexto-local',
            parts: [{ data: { skill: nombre, arguments: argumentos } }],
          },
        },
      },
      { ...cabeceras, 'a2a-version': VERSION_A2A },
    );
  }
  return post(api, `/api/socios/v1/operaciones/${nombre}`, argumentos, cabeceras);
}

async function contenidoA2a(respuesta: Response): Promise<unknown> {
  const mensaje = objeto(objeto(objeto(await respuesta.json()).result).message);
  assert.equal(mensaje.contextId, 'contexto-local');
  assert.ok(Array.isArray(mensaje.parts));
  return objeto(mensaje.parts[0]).data;
}

for (const canal of ['mcp', 'a2a', 'api'] as const) {
  test(`${canal}: las ocho consultas conservan el resultado completo del ejecutor local`, async () => {
    const api = await crear();
    const credencial = await token(api);
    assert.deepEqual(
      HERRAMIENTAS.map(({ name }) => name),
      Object.keys(CONSULTAS),
    );
    for (const [nombre, argumentos] of Object.entries(CONSULTAS)) {
      const esperado = llamarHerramienta(
        { datos: DATOS, datosGlobales: GLOBALES, politica: 'ocupacion', hoy: HOY, motorDeCursos: CON_MOTOR },
        { name: nombre, arguments: argumentos },
      );
      assert.equal(esperado.isError, false, JSON.stringify(esperado));
      const respuesta =
        canal === 'api'
          ? await api(
              new Request(
                `${ORIGEN}/api/socios/v1/consultas/${nombre}?${new URLSearchParams(Object.entries(argumentos).map(([nombre, valor]) => [nombre, String(valor)]))}`,
                { headers: { authorization: `Bearer ${credencial}` } },
              ),
            )
          : await llamar(api, canal, { nombre, argumentos });
      assert.equal(respuesta.status, CORRECTO, await respuesta.clone().text());
      const datos = canal === 'a2a' ? await contenidoA2a(respuesta) : await respuesta.json();
      const obtenido = canal === 'mcp' ? objeto(datos).result : datos;
      assert.deepEqual(obtenido, canal === 'mcp' ? esperado : esperado.structuredContent, nombre);
    }
  });
}

test('la API del servidor sirve salud y no atiende el relato: clasificar, informe y entender no existen', async () => {
  const api = await crear();
  assert.equal(
    (await api(new Request(`${ORIGEN}/api/salud`, { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } }))).status,
    CORRECTO,
  );
  for (const [ruta, cuerpo] of [
    ['/api/clasificar', { texto: 'recepcionista' }],
    ['/api/informe?formato=html', ENTRADA],
    ['/api/entender', ARGUMENTOS.entender_tareas],
  ] as const) {
    const respuesta = await post(api, ruta, cuerpo);
    assert.equal(respuesta.status, NO_ENCONTRADO, ruta);
    assert.equal(objeto(await respuesta.json()).type, `${RAIZ_DE_LOS_PROBLEMAS}ruta_desconocida`, ruta);
  }
});

test('el motor del dispositivo clasifica sin atribuir autoría generativa', async () => {
  const api = await crearLocal();
  const clasificada = await post(api, '/api/clasificar', { texto: 'recepcionista' });
  assert.equal(clasificada.status, CORRECTO);
  const cuerpo = objeto(await clasificada.json());
  assert.equal(cuerpo.decision, 'explorar');
  assert.ok(Array.isArray(cuerpo.candidatas) && cuerpo.candidatas.length > 0);
  const marca = objeto(cuerpo.marcaIa);
  assert.deepEqual([marca.modo, marca.modelo, marca.conIa], ['sin-ia', null, []]);
  assert.equal((await post(api, '/api/entender', ARGUMENTOS.entender_tareas)).status, NO_ENCONTRADO);
});

test('el tope global de credenciales solo lo gasta una credencial vigente', async () => {
  const socios = new SociosDePrueba();
  const api = await crearApi(opciones(socios));
  const NO_AUTENTICADO = 401;
  const DEMASIADAS = 429;
  const INTENTOS_FALLIDOS = 3;
  for (let intento = 0; intento < INTENTOS_FALLIDOS; intento++) {
    assert.equal((await pedirToken(api, `${SECRETO}-falso`)).status, NO_AUTENTICADO);
  }
  assert.equal(socios.cuentas.get('credenciales:global'), undefined);
  await token(api);
  assert.equal(socios.cuentas.get('credenciales:global'), 1);
  socios.cuentas.set('credenciales:global', LIMITES_CONECTIVIDAD.credencialesGlobalesHora);
  assert.equal((await pedirToken(api, `${SECRETO}-falso`)).status, NO_AUTENTICADO);
  assert.equal((await pedirToken(api)).status, DEMASIADAS);
});

test('unas credenciales Basic ilegibles son un 401; otro fallo al leerlas no se oculta tras un 401', async (t) => {
  const api = await crear();
  const NO_AUTENTICADO = 401;
  const ERROR_INTERNO = 500;
  const conCabecera = (authorization: string) =>
    api(
      new Request(`${ORIGEN}/api/socios/v1/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      }),
    );
  assert.equal((await conCabecera('Basic A')).status, NO_AUTENTICADO);
  assert.equal((await conCabecera(`Basic ${btoa('%zz:%zz')}`)).status, NO_AUTENTICADO);
  t.mock.method(console, 'error', () => {});
  const credenciales = `Basic ${btoa(`${CLIENTE}:${SECRETO}`)}`;
  const ajeno = () => {
    throw new RangeError('fallo ajeno a las credenciales');
  };
  const descodificar = t.mock.method(globalThis, 'decodeURIComponent', ajeno);
  assert.equal((await conCabecera(credenciales)).status, ERROR_INTERNO);
  descodificar.mock.restore();
  t.mock.method(globalThis, 'atob', ajeno);
  assert.equal((await conCabecera(credenciales)).status, ERROR_INTERNO);
});

test('la comprobación previa de CORS de la API REST solo ofrece GET', async () => {
  const otro = 'https://socio.test';
  const api = await crearApi({ ...opciones(), origenesPermitidos: [otro] });
  const respuesta = await api(
    new Request(`${ORIGEN}/api/salud`, {
      method: 'OPTIONS',
      headers: { origin: otro, 'access-control-request-method': 'GET' },
    }),
  );
  assert.equal(respuesta.headers.get('access-control-allow-origin'), otro);
  assert.equal(respuesta.headers.get('access-control-allow-methods'), 'GET');
});

for (const canal of ['mcp', 'a2a', 'api'] as const) {
  test(`${canal}: las cinco operaciones retiradas no producen resultados con una credencial de lectura`, async () => {
    const api = await crear();
    const credencial = await token(api);
    for (const nombre of Object.keys(ARGUMENTOS)) {
      const respuesta = await llamar(api, canal, { nombre, argumentos: ARGUMENTOS[nombre], token: credencial });
      if (canal === 'api') {
        assert.equal(respuesta.status, NO_ENCONTRADO);
      } else {
        const cuerpo = objeto(await respuesta.json());
        assert.equal(objeto(cuerpo.error).code, CODIGO.parametros);
      }
    }
  });
  test(`${canal}: el alcance retirado no permite emitir un token generativo`, async () => {
    const api = await crear();
    const respuesta = await api(
      new Request(`${ORIGEN}/api/socios/v1/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${btoa(`${CLIENTE}:${SECRETO}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: `faro.ia.${canal}`,
          resource: `${ORIGEN}${canal === 'api' ? '/api/socios/v1/operaciones' : `/${canal}`}`,
        }),
      }),
    );
    assert.equal(respuesta.status, SOLICITUD_INCORRECTA);
  });
}

for (const idioma of ['es', 'ca'] as const) {
  test(`informe HTML ${idioma} del dispositivo: JSON completo intacto y HTML laboral coinciden con el dominio y renderizador`, async () => {
    const api = await crearLocal();
    const respuesta = await post(api, '/api/informe?formato=html', { ...ENTRADA, idioma });
    assert.equal(respuesta.status, CORRECTO, await respuesta.clone().text());
    const cuerpo = objeto(await respuesta.json());
    const esperado = construirInforme(ENTRADA, DATOS, { idioma });
    assert.deepEqual(cuerpo.informe, JSON.parse(JSON.stringify(esperado)));
    assert.equal(
      cuerpo.html,
      renderizarInformeBreve(construirInformeBreve(esperado, DATOS), esperado, { incrustado: true, conMarca: true }),
    );
    assert.deepEqual(cuerpo.avisos, []);
  });
}

test('la composición actual conserva datos e informes ES/CA y rechaza las operaciones retiradas', async () => {
  const api = await crear();
  const local = await crearLocal();
  const datos = await llamar(api, 'mcp', { nombre: 'explorar_grupos', argumentos: { padre: '4' } });
  assert.equal(datos.status, CORRECTO);
  assert.deepEqual(
    objeto(await datos.json()).result,
    llamarHerramienta(
      { datos: DATOS, politica: 'ocupacion', hoy: HOY },
      { name: 'explorar_grupos', arguments: { padre: '4' } },
    ),
  );
  for (const idioma of ['es', 'ca'] as const) {
    const respuesta = await post(local, '/api/informe?formato=html', { ...ENTRADA, idioma });
    assert.equal(respuesta.status, CORRECTO, await respuesta.clone().text());
    const esperado = construirInforme(ENTRADA, DATOS, { idioma });
    const cuerpo = objeto(await respuesta.json());
    assert.deepEqual(cuerpo.informe, JSON.parse(JSON.stringify(esperado)));
    assert.equal(
      cuerpo.html,
      renderizarInformeBreve(construirInformeBreve(esperado, DATOS), esperado, { incrustado: true, conMarca: true }),
    );
  }
  assert.equal((await post(api, '/api/entender', ARGUMENTOS.entender_tareas)).status, NO_ENCONTRADO);
});

/** Firma sintética real: reproduce tokens del circuito retirado sin invocar su emisor eliminado. */
async function tokenHistorico(lectura: string, canal: CanalRetirado) {
  const cuerpo = deBase64Url(lectura.split('.')[1] ?? '');
  assert.ok(cuerpo);
  const claims = objeto(JSON.parse(new TextDecoder().decode(cuerpo)));
  const { kid, clave } = await subclaveDe(SECRETO, 'tokens-de-socios');
  const parte = (valor: unknown) => aBase64Url(new TextEncoder().encode(JSON.stringify(valor)));
  const mensaje = `${parte({ alg: 'HS256', typ: 'at+jwt', kid })}.${parte({
    ...claims,
    scope: `faro.ia.${canal}`,
    aud: `${ORIGEN}${canal === 'api' ? '/api/socios/v1/operaciones' : `/${canal}`}`,
  })}`;
  return `${mensaje}.${aBase64Url(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(mensaje)))}`;
}

function oauth(api: ResponderApi, ruta: string, credencial: string) {
  return api(
    new Request(ruta, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${CLIENTE}:${SECRETO}`)}`,
      },
      body: new URLSearchParams({ token: credencial }),
    }),
  );
}

test('descubrimiento anuncia solo lectura y endpoints reales; introspección y revocación conservan su ciclo', async () => {
  const api = await crear();
  const descubrimiento = await api(new Request(`${ORIGEN}/.well-known/oauth-authorization-server/api/socios/v1`));
  assert.equal(descubrimiento.status, CORRECTO);
  const metadatos = objeto(await descubrimiento.json());
  assert.deepEqual(metadatos.scopes_supported, ['faro.lectura']);
  assert.deepEqual(metadatos.grant_types_supported, ['client_credentials']);
  for (const [campo, sufijo] of [
    ['token_endpoint', 'token'],
    ['revocation_endpoint', 'revocar'],
    ['introspection_endpoint', 'introspeccion'],
  ] as const) {
    assert.equal(metadatos[campo], `${ORIGEN}/api/socios/v1/${sufijo}`);
    const respuesta = await api(new Request(String(metadatos[campo])));
    assert.equal(respuesta.status, METODO_NO_ADMITIDO);
    assert.equal(respuesta.headers.get('allow'), 'POST');
  }
  const credencial = await token(api);
  const introspeccion = String(metadatos.introspection_endpoint);
  const revocacion = String(metadatos.revocation_endpoint);
  assert.equal(objeto(await (await oauth(api, introspeccion, credencial)).json()).active, true);
  assert.equal(
    (
      await api(
        new Request(`${ORIGEN}/api/socios/v1/consultas/explorar_grupos?padre=4`, {
          headers: { authorization: `Bearer ${credencial}` },
        }),
      )
    ).status,
    CORRECTO,
  );
  for (const canal of ['mcp', 'a2a', 'api'] as const) {
    const retirado = await tokenHistorico(credencial, canal);
    assert.deepEqual(await (await oauth(api, introspeccion, retirado)).json(), { active: false });
    assert.equal((await oauth(api, revocacion, retirado)).status, CORRECTO);
  }
  assert.equal((await oauth(api, revocacion, credencial)).status, CORRECTO);
  assert.deepEqual(await (await oauth(api, introspeccion, credencial)).json(), { active: false });
  assert.equal((await post(api, '/api/socios/v1/operaciones', {})).status, NO_ENCONTRADO);
});

test('MCP y tarjeta A2A anuncian exactamente las ocho herramientas que el despacho ejecuta', async () => {
  const api = await crear();
  const listado = await post(api, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(listado.status, CORRECTO);
  const herramientas = objeto(objeto(await listado.json()).result).tools;
  assert.ok(Array.isArray(herramientas));
  const tarjeta = await api(new Request(`${ORIGEN}/.well-known/agent-card.json`));
  assert.equal(tarjeta.status, CORRECTO);
  const habilidades = objeto(await tarjeta.json()).skills;
  assert.ok(Array.isArray(habilidades));
  const esperadas = Object.keys(CONSULTAS);
  assert.deepEqual(
    herramientas.map((una) => objeto(una).name),
    esperadas,
  );
  assert.deepEqual(
    habilidades.map((una) => objeto(una).id),
    esperadas,
  );
});

test('las opciones generativas retiradas se rechazan al componer, sin ejecutar callbacks', async () => {
  let llamadas = 0;
  const opcionesViejas = {
    ia: { errorConfiguracion: true },
    cerebro: {
      generarJson: () => {
        llamadas++;
      },
    },
  };
  for (const campo of ['ia', 'cerebro'] as const) {
    await assert.rejects(crearApi({ ...opciones(), [campo]: opcionesViejas[campo] }), {
      name: 'TypeError',
      message: 'Opciones de API no válidas',
    });
  }
  const base = opciones();
  assert.ok(base.administracion);
  await assert.rejects(
    crearApi({
      ...base,
      administracion: {
        ...base.administracion,
        ...{
          resolverCapacidadIa: () => {
            llamadas++;
          },
        },
      },
    }),
    { name: 'TypeError', message: 'Opciones de API no válidas' },
  );
  assert.equal(llamadas, 0);
});
