import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock, test } from 'node:test';
import { esCanalDeMaquina } from '../../src/plataforma/cloudflare/canales-portal.ts';
import { PORTADA_PUBLICA } from '../../src/plataforma/cloudflare/portada-publica.ts';
import { TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';
import motor from '../../src/plataforma/cloudflare/worker.ts';
import worker from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { variablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';

const OK = 200;
const VER_OTRA = 303;
const PROHIBIDO = 403;
const NO_DISPONIBLE = 503;
const NO_ENCONTRADO = 404;
const ORIGEN = 'https://ejemplo.invalid';
const CLAVE = 'clave-general-sintetica';

function entorno() {
  const sesiones = new Set<string>();
  async function peticionDurable(peticion: Request) {
    const ruta = new URL(peticion.url).pathname;
    if (!ruta.startsWith('/portal/')) {
      return Response.json({ permitido: true });
    }
    if (ruta === '/portal/disponible') {
      return Response.json({ disponible: true });
    }
    const { huella } = (await peticion.json()) as { huella: string };
    if (ruta === '/portal/registrar') {
      sesiones.add(huella);
    }
    if (ruta === '/portal/revocar') {
      sesiones.delete(huella);
    }
    return Response.json(ruta === '/portal/activa' ? { activa: sesiones.has(huella) } : { correcto: true });
  }
  return {
    FARO_CLAVE_GENERAL: CLAVE,
    FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
    FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
    REGISTRO_SOCIOS: { idFromName: () => 'id', get: () => ({ fetch: peticionDurable }) },
    ASSETS: {
      fetch: async () =>
        new Response('aplicación real', {
          headers: { 'cache-control': 'public, max-age=3600', 'x-faro-portal': 'publico' },
        }),
    },
  };
}
test('solo la raíz HTTPS de lectura es pública y sirve la portada', async () => {
  const respuesta = await worker.fetch(new Request(`${ORIGEN}/`), entorno());
  assert.equal(respuesta.status, OK);
  assert.equal(await respuesta.text(), PORTADA_PUBLICA);
  assert.match(PORTADA_PUBLICA, /href="\/acceso-web"/);
  assert.match(respuesta.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const head = await worker.fetch(new Request(`${ORIGEN}/`, { method: 'HEAD' }), entorno());
  assert.equal(head.status, OK);
  assert.equal(await head.text(), '');
  for (const ruta of [
    '/inicio.html',
    '/recorrido.html',
    '/modo-recorrido.json',
    '/api/salud',
    '/administracion/',
    ...EXTENSIONES.map(({ entrada }) => `/${entrada}`),
  ]) {
    assert.equal((await worker.fetch(new Request(`${ORIGEN}${ruta}`), entorno())).status, PROHIBIDO, ruta);
  }
  assert.equal((await worker.fetch(new Request(`${ORIGEN}/`, { method: 'POST' }), entorno())).status, PROHIBIDO);
});
/** Sin sesión, la página pedida lleva a la pantalla de acceso, que se sirve con 200 y sin desafío. */
async function comprobarPantallaSinSesion(env: ReturnType<typeof entorno>): Promise<void> {
  const sinSesion = await worker.fetch(new Request(`${ORIGEN}/inicio.html`, { headers: { accept: 'text/html' } }), env);
  assert.equal(sinSesion.status, VER_OTRA);
  assert.equal(sinSesion.headers.has('www-authenticate'), false);
  const pantalla = sinSesion.headers.get('location') ?? '';
  assert.equal(pantalla, '/acceso-web?volver=%2Finicio.html');
  const acceso = await worker.fetch(new Request(`${ORIGEN}${pantalla}`, { headers: { accept: 'text/html' } }), env);
  assert.equal(acceso.status, OK);
  assert.ok((await acceso.text()).includes(`<h1 id="titulo">${TEXTOS_ACCESO.ca.titulo}</h1>`));
}
test('el portal autentica por formulario sin desafío Basic y conserva acceso al motor', async () => {
  const env = entorno();
  await comprobarPantallaSinSesion(env);
  const login = (clave: string) =>
    worker.fetch(
      new Request(`${ORIGEN}/acceso-web/entrar`, {
        method: 'POST',
        headers: {
          origin: ORIGEN,
          'sec-fetch-site': 'same-origin',
          'cf-connecting-ip': '192.0.2.10',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ usuario: 'Faro', clave }),
      }),
      env,
    );
  assert.equal((await login('incorrecta')).status, PROHIBIDO);
  const entrada = await login(CLAVE);
  assert.equal(entrada.status, OK);
  const cookie = entrada.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const respuesta = await worker.fetch(new Request(`${ORIGEN}/inicio.html`, { headers: { cookie } }), env);
  assert.equal(respuesta.status, OK);
  assert.equal(await respuesta.text(), 'aplicación real');
  const { REGISTRO_SOCIOS: _ausente, ...sinAutoridad } = env;
  assert.equal(
    (await worker.fetch(new Request(`${ORIGEN}/inicio.html`, { headers: { cookie } }), sinAutoridad)).status,
    NO_DISPONIBLE,
  );
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.get('x-faro-portal'), 'privado');
  assert.equal(
    (await worker.fetch(new Request(`${ORIGEN}/inicio.html`), { ...env, FARO_CLAVE_GENERAL: '' })).status,
    NO_DISPONIBLE,
  );
  assert.equal(typeof worker.scheduled, 'function');
});
test('las huellas CSP cubren el guion y estilo exactos de la portada', async () => {
  const respuesta = await worker.fetch(new Request(`${ORIGEN}/`), entorno());
  const csp = respuesta.headers.get('content-security-policy') ?? '';
  const estilo = /<style>([\s\S]*?)<\/style>/.exec(PORTADA_PUBLICA)?.[1];
  const guion = /<script>([\s\S]*?)<\/script>/.exec(PORTADA_PUBLICA)?.[1];
  assert.ok(estilo && guion);
  for (const contenido of [estilo, guion]) {
    assert.match(
      csp,
      new RegExp(
        createHash('sha256')
          .update(contenido)
          .digest('base64')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
  }
});

test('los canales de máquina llegan a sus controles y no a la puerta web', async () => {
  const env = entorno();
  for (const [ruta, metodo] of [
    ['/api/socios/v1/token', 'POST'],
    ['/api/socios/v1/consultas/explorar_grupos', 'GET'],
    ['/.well-known/oauth-authorization-server/api/socios/v1', 'GET'],
    ['/mcp', 'POST'],
    ['/a2a', 'POST'],
    ['/.well-known/agent-card.json', 'GET'],
    ['/mantenimiento/inicio', 'POST'],
    ['/mantenimiento/construccion', 'GET'],
  ] as const) {
    const respuesta = await worker.fetch(new Request(ORIGEN + ruta, { method: metodo }), env);
    assert.equal(respuesta.status, NO_ENCONTRADO, ruta);
  }
  for (const [ruta, metodo] of [
    ['/api/socios/v1/token', 'GET'],
    ['/api/socios/v1/consultas/otra', 'GET'],
    ['/mcp/otra', 'POST'],
    ['/mantenimiento/otra', 'POST'],
    ['/administracion/api/controles', 'GET'],
  ] as const) {
    assert.equal((await worker.fetch(new Request(ORIGEN + ruta, { method: metodo }), env)).status, PROHIBIDO, ruta);
  }
});

test('la lista de rutas y métodos de máquina no abre variantes ni administración', () => {
  const admitidas = [
    ['POST', '/api/socios/v1/invitacion/consultar'],
    ['POST', '/api/socios/v1/invitacion/activar'],
    ['POST', '/api/socios/v1/token'],
    ['POST', '/api/socios/v1/revocar'],
    ['POST', '/api/socios/v1/introspeccion'],
    ['GET', '/api/socios/v1/consultas/explorar_grupos'],
    ['GET', '/.well-known/oauth-authorization-server/api/socios/v1'],
    ['POST', '/mantenimiento/inicio'],
    ['POST', '/mantenimiento/resultado'],
    ['POST', '/mantenimiento/activacion'],
    ['GET', '/mantenimiento/construccion'],
    ['POST', '/mcp'],
    ['OPTIONS', '/mcp'],
    ['POST', '/a2a'],
    ['OPTIONS', '/a2a'],
    ['GET', '/.well-known/agent-card.json'],
    ['HEAD', '/.well-known/agent-card.json'],
  ];
  for (const [metodo, ruta] of admitidas) {
    assert.ok(metodo && ruta);
    assert.equal(esCanalDeMaquina(new Request(ORIGEN + ruta, { method: metodo })), true, `${metodo} ${ruta}`);
    assert.equal(esCanalDeMaquina(new Request(`${ORIGEN}${ruta}/extra`, { method: metodo })), false, ruta);
  }
  for (const ruta of ['/administracion/', '/administracion/api/controles', '/api/socios/v1/consultas/desconocida']) {
    assert.equal(esCanalDeMaquina(new Request(ORIGEN + ruta)), false, ruta);
  }
});

test('scheduled reenvía el evento y entorno operativo sin claves del portal ni residuos privados', async (t) => {
  const llamada = mock.method(motor, 'scheduled', async () => {});
  t.after(() => llamada.mock.restore());
  const evento = { scheduledTime: 123, cron: '0 0 * * *' };
  const env = {
    ...entorno(),
    FARO_PRUEBAS_CLAVE: 'residuo',
    FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
    FARO_PRUEBAS_ADMINISTRACION: 'si',
    FARO_OTRA: 'valor',
    FARO_RECORRIDO_CLAVE: 'clave-sintetica',
    FARO_RECORRIDO_FIRMA: 'firma-sintetica',
    FARO_RECORRIDO_LIMITE: 'limite-sintetico',
    FARO_ADMINISTRACION: 'si',
    FARO_ACTUALIZACION_PROGRAMADA: 'si',
  };
  await worker.scheduled(evento, env);
  assert.equal(llamada.mock.callCount(), 1);
  const argumentos = llamada.mock.calls[0]?.arguments;
  assert.ok(argumentos);
  assert.equal(argumentos[0], evento);
  const reenviado = argumentos[1];
  assert.ok(reenviado);
  assert.equal(reenviado.FARO_OTRA, 'valor');
  assert.equal(reenviado.FARO_ADMINISTRACION, 'si');
  assert.equal(reenviado.FARO_ACTUALIZACION_PROGRAMADA, 'si');
  assert.equal(reenviado.REGISTRO_SOCIOS, env.REGISTRO_SOCIOS);
  for (const clave of [
    'FARO_CLAVE_GENERAL',
    'FARO_SESION_PORTAL',
    'FARO_LIMITE_PORTAL',
    'FARO_PRUEBAS_CLAVE',
    'FARO_PRUEBAS_LIMITE',
    'FARO_PRUEBAS_ADMINISTRACION',
    'FARO_RECORRIDO_CLAVE',
    'FARO_RECORRIDO_FIRMA',
    'FARO_RECORRIDO_LIMITE',
  ]) {
    assert.equal(Object.hasOwn(reenviado, clave), false, clave);
  }
});

test('scheduled entrega al perfil operativo variables de recorrido ya retiradas', async (t) => {
  let validado = false;
  const llamada = mock.method(
    motor,
    'scheduled',
    async (_evento: Parameters<typeof motor.scheduled>[0], env: Parameters<typeof motor.scheduled>[1]) => {
      const textos = Object.fromEntries(
        Object.entries(env).flatMap(([nombre, valor]) => (typeof valor === 'string' ? [[nombre, valor]] : [])),
      );
      const perfil = variablesDelServicio(textos);
      assert.equal(perfil.FARO_ADMINISTRACION, 'si');
      assert.equal(perfil.FARO_ACTUALIZACION_PROGRAMADA, 'si');
      validado = true;
    },
  );
  t.after(() => llamada.mock.restore());
  await worker.scheduled(
    { scheduledTime: 123, cron: '0 0 * * *' },
    {
      ...entorno(),
      FARO_ADMINISTRACION: 'si',
      FARO_ACTUALIZACION_PROGRAMADA: 'si',
      FARO_RECORRIDO_CLAVE: 'clave-sintetica',
      FARO_RECORRIDO_FIRMA: 'firma-sintetica',
      FARO_RECORRIDO_LIMITE: 'limite-sintetico',
    },
  );
  assert.equal(validado, true);
});
