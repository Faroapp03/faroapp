import assert from 'node:assert/strict';
import { test } from 'node:test';
import { responderAccesoPrivado } from '../../src/plataforma/cloudflare/acceso-privado.ts';
import { variablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';
import { asegurarDesafioSi401 } from '../ayudas/desafio.ts';

const NO_AUTENTICADO = 401;
const PROHIBIDO = 403;
const NO_DISPONIBLE = 503;
const CORRECTO = 200;
const clave = 'clave-sintetica-de-prueba-con-al-menos-32-bytes';
const registro = (controles: unknown = null) => ({
  idFromName: () => 'id',
  get: () => ({
    fetch: async (peticion: Request) =>
      new URL(peticion.url).pathname === '/privado/intento'
        ? Response.json({ permitido: true })
        : Response.json({ controles }),
  }),
});
const basic = (usuario: string, secreto: string) => `Basic ${Buffer.from(`${usuario}:${secreto}`).toString('base64')}`;
const entorno = () => ({
  ASSETS: { fetch: async () => new Response('recurso') },
  FARO_PRUEBAS_CLAVE: clave,
  FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
  REGISTRO_SOCIOS: registro(),
  FARO_ADMINISTRACION: 'si',
  FARO_MCP: 'si',
  FARO_A2A: 'si',
  FARO_API_SOCIOS: 'si',
});

test('todas las rutas y métodos exigen credenciales válidas, incluso sin secreto configurado', async () => {
  for (const ruta of [
    '/',
    '/inicio.html',
    '/paquete/datos.json',
    '/api/salud',
    '/mcp',
    '/administracion/',
    '/.well-known/security.txt',
    '/mantenimiento/construccion',
  ]) {
    for (const metodo of ['GET', 'HEAD', 'OPTIONS']) {
      for (const autorizacion of [
        undefined,
        'Bearer ajeno',
        basic('Faro', 'incorrecta'),
        basic('otro', clave),
        'Basic !!!',
        'Basic Zg==',
      ]) {
        const headers = new Headers({
          'cf-connecting-ip': '127.0.0.1',
          ...(autorizacion ? { authorization: autorizacion } : {}),
        });
        let invocada = false;
        const respuesta = await responderAccesoPrivado(
          new Request(`https://ejemplo.test${ruta}`, { method: metodo, headers }),
          entorno(),
          async () => {
            invocada = true;
            return new Response('privado');
          },
        );
        assert.equal(asegurarDesafioSi401(respuesta, 'Basic').status, NO_AUTENTICADO);
        assert.equal(respuesta.headers.get('cache-control'), 'no-store');
        assert.equal(invocada, false);
        assert.doesNotMatch(await respuesta.text(), /clave-sintetica|incorrecta|privado/);
      }
    }
  }
});

test('sin secreto no delega', async () => {
  for (const secreto of [undefined, '']) {
    const respuesta = await responderAccesoPrivado(
      new Request('https://ejemplo.test/', {
        headers: { 'cf-connecting-ip': '127.0.0.1', authorization: basic('Faro', clave) },
      }),
      { ...entorno(), FARO_PRUEBAS_CLAVE: secreto },
      async () => assert.fail('no debe delegar'),
    );
    assert.equal(respuesta.status, NO_DISPONIBLE);
  }
});

test('rechaza HTTP sin delegar ni solicitar credenciales', async () => {
  const respuesta = await responderAccesoPrivado(
    new Request('http://ejemplo.test/', {
      headers: { 'cf-connecting-ip': '127.0.0.1', authorization: basic('Faro', clave) },
    }),
    entorno(),
    async () => assert.fail('no debe delegar'),
  );
  assert.equal(respuesta.status, PROHIBIDO);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.has('www-authenticate'), false);
});

test('delegación sin credencial ni secreto y con servicios externos y administración cerrados', async () => {
  const original = entorno();
  const peticion = new Request('https://ejemplo.test/api/salud?x=1', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '127.0.0.1', authorization: basic('Faro', clave), 'content-type': 'text/plain' },
    body: 'contenido',
  });
  const respuesta = await responderAccesoPrivado(peticion, original, async (recibida, env) => {
    assert.equal(recibida.headers.has('authorization'), false);
    assert.equal(await recibida.text(), 'contenido');
    assert.equal(recibida.url, peticion.url);
    assert.equal(env.ASSETS, original.ASSETS);
    assert.equal(Object.hasOwn(env, 'FARO_PRUEBAS_CLAVE'), false);
    assert.equal(Object.hasOwn(env, 'FARO_PRUEBAS_LIMITE'), false);
    for (const variable of ['FARO_ADMINISTRACION', 'FARO_MCP', 'FARO_A2A', 'FARO_API_SOCIOS']) {
      assert.equal(env[variable], 'no');
    }
    return new Response('resultado', {
      headers: { 'cache-control': 'public, max-age=3600', 'x-faro-portal': 'publico' },
    });
  });
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.get('x-faro-portal'), 'privado');
  assert.equal(await respuesta.text(), 'resultado');
  assert.equal(original.FARO_ADMINISTRACION, 'si');
});

test('la administración privada exige una habilitación explícita y configuración completa de Access', async () => {
  const request = () =>
    new Request('https://ejemplo.test/', {
      headers: { 'cf-connecting-ip': '127.0.0.1', authorization: basic('Faro', clave) },
    });
  const configuracion = {
    FARO_PRUEBAS_ADMINISTRACION: 'si',
    FARO_ADMIN_ACCESS_EQUIPO: 'equipo.cloudflareaccess.com',
    FARO_ADMIN_ACCESS_AUD: 'audiencia-administrativa',
    FARO_ADMIN_ORIGEN: 'https://ejemplo.test',
    FARO_SECRETO_FIRMA: 'secreto-sintetico-de-mas-de-32-caracteres',
    REGISTRO_SOCIOS: registro(),
  };
  for (const cambios of [
    { FARO_ADMIN_ACCESS_AUD: '' },
    { FARO_ADMIN_ORIGEN: 'http://ejemplo.test' },
    { REGISTRO_SOCIOS: undefined },
    { FARO_PRUEBAS_ADMINISTRACION: 'sí' },
  ]) {
    const respuesta = await responderAccesoPrivado(
      request(),
      { ...entorno(), ...configuracion, ...cambios },
      async () => assert.fail('configuración incompleta'),
    );
    assert.equal(respuesta.status, NO_DISPONIBLE);
  }
  for (const controles of [
    { version: 2, revision: 0, api: 'habilitada', mcp: false, a2a: false },
    { version: 2, revision: 0, api: 'deshabilitada', mcp: true, a2a: false },
    { version: 2, revision: 0, api: 'deshabilitada', mcp: false, a2a: true },
  ]) {
    const registroActivo = registro(controles);
    const cerrada = await responderAccesoPrivado(
      request(),
      { ...entorno(), ...configuracion, REGISTRO_SOCIOS: registroActivo },
      async () => assert.fail('controles activos'),
    );
    assert.equal(cerrada.status, NO_DISPONIBLE);
  }
  const respuesta = await responderAccesoPrivado(
    request(),
    { ...entorno(), ...configuracion },
    async (peticion, env) => {
      assert.equal(env.FARO_ADMINISTRACION, 'si');
      assert.equal(env.FARO_MCP, 'no');
      assert.equal(env.FARO_A2A, 'no');
      assert.equal(env.FARO_API_SOCIOS, 'no');
      assert.equal(Object.hasOwn(env, 'FARO_PRUEBAS_ADMINISTRACION'), false);
      assert.equal(peticion.headers.has('authorization'), false);
      return new Response('ok');
    },
  );
  assert.equal(respuesta.status, CORRECTO);
});

const requestPrivada = () =>
  new Request('https://ejemplo.test/', {
    headers: { 'cf-connecting-ip': '127.0.0.1', authorization: basic('Faro', clave) },
  });
const entornoConSecretos = () => ({
  ...entorno(),
  FARO_CLAVE_GENERAL: 'portal-sintetico',
  FARO_SESION_PORTAL: 'firma-sintetica',
  FARO_LIMITE_PORTAL: 'limite-sintetico',
  FARO_RECORRIDO_CLAVE: 'recorrido-sintetico',
  FARO_RECORRIDO_FIRMA: 'firma-recorrido-sintetica',
  FARO_RECORRIDO_LIMITE: 'limite-recorrido-sintetico',
});

test('filtra secretos de portal y preserva los de recorrido', async () => {
  const base = entornoConSecretos();
  let comprobado = false;
  const respuesta = await responderAccesoPrivado(requestPrivada(), base, async (_peticion, env) => {
    for (const nombre of ['FARO_CLAVE_GENERAL', 'FARO_SESION_PORTAL', 'FARO_LIMITE_PORTAL']) {
      assert.equal(Object.hasOwn(env, nombre), false, nombre);
    }
    for (const nombre of ['FARO_RECORRIDO_CLAVE', 'FARO_RECORRIDO_FIRMA', 'FARO_RECORRIDO_LIMITE'] as const) {
      assert.equal(env[nombre], base[nombre]);
    }
    // El adaptador de recorrido recibe sus valores y los retira antes del perfil de servicio.
    const {
      FARO_RECORRIDO_CLAVE: _clave,
      FARO_RECORRIDO_FIRMA: _firma,
      FARO_RECORRIDO_LIMITE: _limite,
      ...resto
    } = env;
    const textos = Object.fromEntries(
      Object.entries(resto).flatMap(([nombre, valor]) => (typeof valor === 'string' ? [[nombre, valor]] : [])),
    );
    assert.equal(variablesDelServicio(textos).FARO_ADMINISTRACION, 'no');
    assert.throws(() => variablesDelServicio({ ...textos, FARO_DESCONOCIDA: 'sintetica' }));
    comprobado = true;
    return new Response('ok');
  });
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(comprobado, true);
  assert.equal(base.FARO_CLAVE_GENERAL, 'portal-sintetico');
});

test('la frontera conserva opciones desconocidas que el perfil rechaza', async () => {
  const desconocida = await responderAccesoPrivado(
    requestPrivada(),
    { ...entornoConSecretos(), FARO_DESCONOCIDA: 'sintetica' },
    async (_peticion, env) => {
      assert.equal(env.FARO_DESCONOCIDA, 'sintetica');
      const {
        FARO_RECORRIDO_CLAVE: _clave,
        FARO_RECORRIDO_FIRMA: _firma,
        FARO_RECORRIDO_LIMITE: _limite,
        ...resto
      } = env;
      const textos = Object.fromEntries(
        Object.entries(resto).flatMap(([nombre, valor]) => (typeof valor === 'string' ? [[nombre, valor]] : [])),
      );
      assert.throws(() => variablesDelServicio(textos));
      return new Response('rechazado', { status: NO_DISPONIBLE });
    },
  );
  assert.equal(desconocida.status, NO_DISPONIBLE);
});
