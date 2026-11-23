import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import type { IdentificadoresLimite } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import { responderAccesoPortal } from '../../src/plataforma/cloudflare/acceso-portal.ts';
import { PAGINA_ACCESO_WEB } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { CABECERA_LIMITE, LIMITE_SATURADO, TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';

const VIDA_MS = 3_600_000;
const MS_POR_SEGUNDO = 1000;
const ORIGEN = 'https://ejemplo.invalid';
const CLAVE = 'clave-sintetica-de-acceso';
const FIRMA = 'firma-sintetica-independiente-de-32-caracteres';
const LIMITE = 'limite-sintetico-independiente-de-32-caracteres';
const sesiones = new Set<string>();
const BASE = {
  clave: CLAVE,
  firma: FIRMA,
  claveLimite: LIMITE,
  registrarSesion: async (huella: string) => {
    sesiones.add(huella);
  },
  sesionActiva: async (huella: string) => sesiones.has(huella),
  revocarSesion: async (huella: string) => {
    sesiones.delete(huella);
  },
  sesionesDisponibles: async () => true,
  consumirIntento: async (_huella: IdentificadoresLimite) => true,
  paginaAcceso: () => new Response('Formulario de prueba'),
  delegar: async (_p: Request) => new Response('Privado'),
};
function peticion(ruta: string, opciones: RequestInit = {}) {
  return new Request(`${ORIGEN}${ruta}`, opciones);
}
function entrar(usuario: string, clave: string, cabeceras: Record<string, string> = {}) {
  return peticion('/acceso-web/entrar', {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'cf-connecting-ip': '192.0.2.1',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
      ...cabeceras,
    },
    body: new URLSearchParams({ usuario, clave }),
  });
}
test('la puerta protege HTML y recursos y falla cerrada sin configuración', async () => {
  for (const ruta of ['/inicio.html', '/estilos/base.css', '/api/salud', '/administracion/']) {
    const r = await responderAccesoPortal(peticion(ruta), BASE);
    assert.equal(r.status, ESTADO_HTTP.prohibido);
    assert.equal(r.headers.has('www-authenticate'), false);
    assert.doesNotMatch(await r.text(), /Privado|clave-sintetica/);
  }
  assert.equal(
    (await responderAccesoPortal(peticion('/inicio.html'), { ...BASE, firma: '' })).status,
    ESTADO_HTTP.noDisponible,
  );
});
test('usuario y contraseña correctos crean una sesión limitada y separada', async () => {
  const r = await responderAccesoPortal(entrar('Faro', CLAVE), BASE);
  assert.equal(r.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await r.json(), { ok: true });
  const cookie = r.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /clave-sintetica|firma-sintetica/);
  const sesion = cookie.split(';')[0] ?? '';
  const ver = await responderAccesoPortal(
    peticion('/inicio.html', { headers: { cookie: sesion, authorization: 'Bearer sintético' } }),
    {
      ...BASE,
      delegar: async (req) => {
        assert.equal(req.headers.get('authorization'), 'Bearer sintético');
        assert.equal(req.headers.has('cookie'), false);
        return new Response('Privado');
      },
    },
  );
  assert.equal(await ver.text(), 'Privado');
  const alterada = `${sesion.slice(0, -1)}${sesion.endsWith('A') ? 'B' : 'A'}`;
  assert.equal(
    (await responderAccesoPortal(peticion('/inicio.html', { headers: { cookie: alterada } }), BASE)).status,
    ESTADO_HTTP.prohibido,
  );
});
test('deniega errores, CSRF y agotamiento, y permite cerrar sesión mediante POST', async () => {
  assert.equal((await responderAccesoPortal(entrar('otro', CLAVE), BASE)).status, ESTADO_HTTP.prohibido);
  assert.equal((await responderAccesoPortal(entrar('Faro', 'incorrecta'), BASE)).status, ESTADO_HTTP.prohibido);
  assert.equal(
    (await responderAccesoPortal(entrar('Faro', CLAVE, { origin: 'https://otro.invalid' }), BASE)).status,
    ESTADO_HTTP.prohibido,
  );
  assert.equal(
    (await responderAccesoPortal(entrar('Faro', CLAVE), { ...BASE, consumirIntento: async () => false })).status,
    ESTADO_HTTP.demasiadasPeticiones,
  );
  assert.equal(
    (
      await responderAccesoPortal(entrar('Faro', CLAVE), {
        ...BASE,
        consumirIntento: async () => {
          throw new Error('no disponible');
        },
      })
    ).status,
    ESTADO_HTTP.noDisponible,
  );
  const salida = await responderAccesoPortal(
    peticion('/acceso-web/salir', { method: 'POST', headers: { origin: ORIGEN, 'sec-fetch-site': 'same-origin' } }),
    BASE,
  );
  assert.equal(salida.status, ESTADO_HTTP.correcto);
  assert.match(salida.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('la sesión caduca y no acepta duplicados ni firma ajena', async () => {
  const instante = 1_800_000_000_000;
  const autenticacion = await responderAccesoPortal(entrar('Faro', CLAVE), { ...BASE, ahora: () => instante });
  const cookie = (autenticacion.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const sinSesion = (cabecera: string, ahora: number, firma = FIRMA) =>
    responderAccesoPortal(peticion('/inicio.html', { headers: { cookie: cabecera } }), {
      ...BASE,
      firma,
      ahora: () => ahora,
    });
  assert.equal((await sinSesion(cookie, instante + VIDA_MS)).status, ESTADO_HTTP.prohibido);
  assert.equal((await sinSesion(`${cookie}; ${cookie}`, instante)).status, ESTADO_HTTP.prohibido);
  assert.equal(
    (await sinSesion(cookie, instante, 'otra-firma-sintetica-de-al-menos-32-bytes')).status,
    ESTADO_HTTP.prohibido,
  );
});

test('el limitador usa huella por propósito, oculta IP y se niega si falta', async () => {
  const vistas: IdentificadoresLimite[] = [];
  const prueba = {
    ...BASE,
    consumirIntento: async (huella: IdentificadoresLimite) => {
      vistas.push(huella);
      return true;
    },
  };
  await responderAccesoPortal(entrar('Faro', 'incorrecta'), prueba);
  assert.equal(vistas.length, 1);
  assert.match(vistas[0]?.clave ?? '', /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(vistas), /192\.0\.2\.1/);
  const faltante = await responderAccesoPortal(entrar('Faro', CLAVE, { 'cf-connecting-ip': '' }), prueba);
  assert.equal(faltante.status, ESTADO_HTTP.noDisponible);
  assert.equal(vistas.length, 1);
});

test('cierra ante secretos repetidos, cabeceras de sitio ajeno y formulario duplicado', async () => {
  assert.equal(
    (await responderAccesoPortal(entrar('Faro', CLAVE), { ...BASE, claveLimite: FIRMA })).status,
    ESTADO_HTTP.noDisponible,
  );
  assert.equal(
    (await responderAccesoPortal(entrar('Faro', CLAVE, { 'sec-fetch-site': 'cross-site' }), BASE)).status,
    ESTADO_HTTP.prohibido,
  );
  const duplicada = peticion('/acceso-web/entrar', {
    method: 'POST',
    headers: { origin: ORIGEN, 'cf-connecting-ip': '192.0.2.1', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([
      ['usuario', 'Faro'],
      ['usuario', 'otro'],
      ['clave', CLAVE],
    ]),
  });
  assert.equal((await responderAccesoPortal(duplicada, BASE)).status, ESTADO_HTTP.prohibido);
});

test('HEAD no entrega cuerpo y salir rechaza origen ajeno', async () => {
  const cabeza = await responderAccesoPortal(peticion('/inicio.html', { method: 'HEAD' }), BASE);
  assert.equal(cabeza.status, ESTADO_HTTP.prohibido);
  assert.equal(await cabeza.text(), '');
  const salida = await responderAccesoPortal(
    peticion('/acceso-web/salir', { method: 'POST', headers: { origin: 'https://otro.invalid' } }),
    BASE,
  );
  assert.equal(salida.status, ESTADO_HTTP.prohibido);
  assert.equal(salida.headers.has('set-cookie'), false);
});

test('cerrar sesión revoca una copia de la cookie y falla cerrado si la autoridad no responde', async () => {
  const revocadas = new Set<string>();
  const opciones = {
    ...BASE,
    registrarSesion: async (identificador: string) => {
      revocadas.add(identificador);
    },
    sesionActiva: async (identificador: string) => revocadas.has(identificador),
    revocarSesion: async (identificador: string) => {
      revocadas.delete(identificador);
    },
  };
  const login = await responderAccesoPortal(entrar('Faro', CLAVE), opciones);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(cookie);
  const acceso = () => peticion('/inicio.html', { headers: { cookie } });
  assert.equal((await responderAccesoPortal(acceso(), opciones)).status, ESTADO_HTTP.correcto);
  const salida = peticion('/acceso-web/salir', {
    method: 'POST',
    headers: { cookie, origin: ORIGEN, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal((await responderAccesoPortal(salida, opciones)).status, ESTADO_HTTP.correcto);
  assert.equal((await responderAccesoPortal(acceso(), opciones)).status, ESTADO_HTTP.prohibido);
  const sinAutoridad = {
    ...opciones,
    sesionActiva: async () => {
      throw new Error('no disponible');
    },
  };
  assert.equal((await responderAccesoPortal(acceso(), sinAutoridad)).status, ESTADO_HTTP.noDisponible);
});

test('el estado solo confirma una sesión activa y los fallos de escritura cierran el acceso', async () => {
  const loginFallido = await responderAccesoPortal(entrar('Faro', CLAVE), {
    ...BASE,
    registrarSesion: async () => {
      throw new Error('almacén caído');
    },
  });
  assert.equal(loginFallido.status, ESTADO_HTTP.noDisponible);
  assert.equal(loginFallido.headers.has('set-cookie'), false);
  const login = await responderAccesoPortal(entrar('Faro', CLAVE), BASE);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(cookie);
  const estado = await responderAccesoPortal(peticion('/acceso-web/estado', { headers: { cookie } }), BASE);
  assert.deepEqual(await estado.json(), { portal: true });
  assert.equal(estado.headers.get('cache-control'), 'no-store');
  const salida = await responderAccesoPortal(
    peticion('/acceso-web/salir', {
      method: 'POST',
      headers: { cookie, origin: ORIGEN },
    }),
    {
      ...BASE,
      revocarSesion: async () => {
        throw new Error('almacén caído');
      },
    },
  );
  assert.equal(salida.status, ESTADO_HTTP.noDisponible);
  assert.equal(salida.headers.has('set-cookie'), false);
});

test('con sesión, el estado admite HEAD como GET y sin cuerpo; sin sesión, HEAD recibe lo mismo que GET', async () => {
  const login = await responderAccesoPortal(entrar('Faro', CLAVE), BASE);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(cookie);
  const pedir = (method: string, cabeceras: Record<string, string> = { cookie }) =>
    responderAccesoPortal(peticion('/acceso-web/estado', { method, headers: cabeceras }), BASE);
  const [lectura, cabecera] = [await pedir('GET'), await pedir('HEAD')];
  assert.equal(cabecera.status, ESTADO_HTTP.correcto);
  assert.equal(await cabecera.text(), '');
  for (const nombre of ['cache-control', 'content-type']) {
    assert.equal(cabecera.headers.get(nombre), lectura.headers.get(nombre), nombre);
  }
  const otro = await pedir('PUT');
  assert.equal(otro.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(otro.headers.get('allow'), 'GET, HEAD');
  assert.equal(otro.headers.get('cache-control'), 'no-store');
  const [anonimaGet, anonimaHead] = [await pedir('GET', {}), await pedir('HEAD', {})];
  assert.equal(anonimaHead.status, anonimaGet.status);
  assert.equal(anonimaHead.headers.get('location'), anonimaGet.headers.get('location'));
  assert.equal(await anonimaHead.text(), '');
});

test('la cookie nueva no es aceptable por una versión anterior sin revocación', async () => {
  const entrada = await responderAccesoPortal(entrar('Faro', CLAVE), BASE);
  const cookie = entrada.headers.get('set-cookie')?.split(';')[0]?.split('=')[1];
  assert.ok(cookie);
  const [caduca, nonce, mac] = cookie.split('.');
  assert.ok(caduca && nonce && mac);
  const anterior = createHmac('sha256', FIRMA).update(`faro/sesion-portal/v1.${caduca}.${nonce}`).digest('base64url');
  assert.notEqual(mac, anterior);
  const actual = createHmac('sha256', FIRMA).update(`faro/sesion-portal/v2.${caduca}.${nonce}`).digest('base64url');
  assert.equal(mac, actual);
  const cookieAnterior = `__Host-faro-portal=${caduca}.${nonce}.${anterior}`;
  const respuesta = await responderAccesoPortal(
    peticion('/inicio.html', { headers: { cookie: cookieAnterior } }),
    BASE,
  );
  assert.equal(respuesta.status, ESTADO_HTTP.prohibido);
});

test('con el límite saturado, el 429 lo marca y la pantalla dice que llegan demasiadas peticiones, no demasiados intentos', async () => {
  const saturado = await responderAccesoPortal(entrar('Faro', CLAVE), {
    ...BASE,
    consumirIntento: async () => 'saturado',
  });
  assert.equal(saturado.status, ESTADO_HTTP.demasiadasPeticiones);
  assert.equal(saturado.headers.get(CABECERA_LIMITE), LIMITE_SATURADO);
  assert.ok(saturado.headers.get('retry-after'));
  const propio = await responderAccesoPortal(entrar('Faro', CLAVE), { ...BASE, consumirIntento: async () => false });
  assert.equal(propio.headers.get(CABECERA_LIMITE), null);
  assert.ok(
    PAGINA_ACCESO_WEB.includes(
      `respuesta.status===429?(respuesta.headers.get('${CABECERA_LIMITE}')==='${LIMITE_SATURADO}'?'error-saturacion':'error-intentos')`,
    ),
  );
  assert.equal(
    TEXTOS_ACCESO.es['error-saturacion'],
    'Ahora mismo llegan demasiadas peticiones a la vez. Espera unos minutos y vuelve a intentarlo.',
  );
  assert.equal(
    TEXTOS_ACCESO.ca['error-saturacion'],
    'Ara mateix arriben massa peticions alhora. Espera uns minuts i torna-ho a provar.',
  );
});

test('el 429 dice en Retry-After la ventana del limitador, sin cuerpo ni pista sobre la cuenta', async () => {
  const { VENTANA_MS } = await import('../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts');
  const agotado = { ...BASE, consumirIntento: async () => false };
  for (const [usuario, clave] of [
    ['Faro', CLAVE],
    ['otro', 'incorrecta'],
  ] as const) {
    const respuesta = await responderAccesoPortal(entrar(usuario, clave), agotado);
    assert.equal(respuesta.status, ESTADO_HTTP.demasiadasPeticiones);
    assert.equal(respuesta.headers.get('retry-after'), String(VENTANA_MS / MS_POR_SEGUNDO));
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    assert.equal(await respuesta.text(), '');
  }
  for (const [usuario, clave] of [
    ['otro', CLAVE],
    ['Faro', 'incorrecta'],
  ] as const) {
    assert.equal((await responderAccesoPortal(entrar(usuario, clave), BASE)).headers.has('retry-after'), false);
  }
});

test('con el almacén de sesiones caído o lleno, credenciales correctas e incorrectas reciben el mismo 503', async () => {
  const caido = async () => {
    throw new Error('almacén de sesiones caído');
  };
  for (const [caso, almacen] of [
    ['caído', { sesionesDisponibles: caido, registrarSesion: caido }],
    ['lleno', { sesionesDisponibles: async () => false, registrarSesion: caido }],
  ] as const) {
    let intentos = 0;
    const opciones = {
      ...BASE,
      ...almacen,
      consumirIntento: async () => {
        intentos++;
        return true;
      },
    };
    const respuestas = [];
    for (const [usuario, clave] of [
      ['Faro', CLAVE],
      ['Faro', 'incorrecta'],
      ['otro', CLAVE],
    ] as const) {
      const respuesta = await responderAccesoPortal(entrar(usuario, clave), opciones);
      respuestas.push({
        estado: respuesta.status,
        cookie: respuesta.headers.has('set-cookie'),
        cuerpo: await respuesta.text(),
      });
    }
    const unica = { estado: ESTADO_HTTP.noDisponible, cookie: false, cuerpo: '' };
    assert.deepEqual(respuestas, [unica, unica, unica], caso);
    assert.equal(intentos, respuestas.length, `${caso}: cada intento sigue contando en el limitador`);
  }
});

test('el almacén de sesiones se consulta después del limitador y antes de leer las credenciales', async () => {
  const orden: string[] = [];
  const opciones = {
    ...BASE,
    consumirIntento: async () => {
      orden.push('limitador');
      return true;
    },
    sesionesDisponibles: async () => {
      orden.push('sesiones disponibles');
      return true;
    },
    registrarSesion: async () => {
      orden.push('registrar');
    },
  };
  assert.equal((await responderAccesoPortal(entrar('Faro', 'incorrecta'), opciones)).status, ESTADO_HTTP.prohibido);
  assert.equal((await responderAccesoPortal(entrar('Faro', CLAVE), opciones)).status, ESTADO_HTTP.correcto);
  assert.deepEqual(orden, ['limitador', 'sesiones disponibles', 'limitador', 'sesiones disponibles', 'registrar']);
  const agotado = { ...opciones, consumirIntento: async () => false };
  orden.length = 0;
  assert.equal((await responderAccesoPortal(entrar('Faro', CLAVE), agotado)).status, ESTADO_HTTP.demasiadasPeticiones);
  assert.deepEqual(orden, []);
});
