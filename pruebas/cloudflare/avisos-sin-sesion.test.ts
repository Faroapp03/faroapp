import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';
import { responderAccesoPortal } from '../../src/plataforma/cloudflare/acceso-portal.ts';
import * as canales from '../../src/plataforma/cloudflare/canales-portal.ts';
import oficial from '../../src/plataforma/cloudflare/worker-oficial.ts';
import privado from '../../src/plataforma/cloudflare/worker-privado.ts';
import { MAX_CUERPO_BYTES } from '../../src/seguridad/limites.ts';

// Las dos entradas de Cloudflare admiten POST /avisos-del-navegador sin sesión ni credencial, como lo envía el
// navegador; el resto de esa ruta y las demás rutas conservan su protección. Cada línea escrita se lee de console.log.

const ORIGEN = 'https://ejemplo.invalid';
const RUTA = '/avisos-del-navegador';
const TIPO = 'application/reports+json';
const CORRECTO = 200;
const SIN_CONTENIDO = 204;
const VER_OTRA = 303;
const SOLICITUD_INVALIDA = 400;
const NO_AUTENTICADO = 401;
const PROHIBIDO = 403;
const TIPO_NO_ADMITIDO = 415;
const NO_DISPONIBLE = 503;
/** Un fallo del servidor que NEL cuenta y se conserva, y un rechazo que NEL cuenta y solo se recuenta. */
const FALLO_DEL_SERVIDOR = 503;
const RECHAZO = 403;
const MS_POR_SEGUNDO = 1000;
const SEGUNDOS_POR_MINUTO = 60;
/** Los bytes aleatorios de la cookie del portal (acceso-portal.ts). */
const BYTES_DEL_NONCE = 16;
/** Un texto que, repetido, pasa del tope de bytes del cuerpo. */
const RELLENO = 'secreta';
/** «["», dos bytes que no son UTF-8 y «"]». */
const NO_UTF8 = Buffer.from('5b22fffe225d', 'hex');
const CLAVE_PORTAL = 'clave-general-sintetica';
const FIRMA_PORTAL = 'firma-sintetica-independiente-de-mas-de-32-bytes';
const CLAVE_PRIVADA = 'clave-privada-sintetica-de-al-menos-32-bytes';
const SUCESO = 'avisos del navegador';
/** Textos de los informes que ninguna línea ni respuesta puede copiar: rutas, consultas y textos libres. */
const MARCAS = ['inicio.html', 'consulta', 'secret', 'ajeno', 'agente', '192.0.2.1', 'sobrante', `${ORIGEN}/`];

/**
 * Rutas que se parecen a la de los avisos y no lo son: barra final, mayúsculas, doble barra, parámetro de segmento y
 * caracteres escritos con %XX. Si el predicado descodificara la ruta, «%2D» pasaría la puerta.
 */
const RUTAS_PARECIDAS = [
  `${RUTA}/`,
  '/Avisos-del-navegador',
  `/${RUTA}`,
  `${RUTA};x`,
  '/avisos%2Ddel-navegador',
  `${RUTA}%2F`,
];

const PAGINA = `${ORIGEN}/inicio.html?consulta=secreta`;
const informeCsp = {
  type: 'csp-violation',
  age: 1000,
  url: PAGINA,
  user_agent: 'Mozilla/5.0 agente de prueba',
  body: {
    documentURL: PAGINA,
    blockedURL: 'https://ajeno.invalid/guion.js?consulta=secreta',
    effectiveDirective: 'script-src-elem',
    originalPolicy: "script-src 'self'",
    sample: 'texto libre secreto',
    disposition: 'enforce',
    sourceFile: `${ORIGEN}/scripts/ruta-secreta.js`,
    lineNumber: 3,
    columnNumber: 4,
    statusCode: 200,
    referrer: PAGINA,
  },
};
const nel = (estado: number) => ({
  type: 'network-error',
  age: 1000,
  url: `${ORIGEN}/manifest.webmanifest?consulta=secreta`,
  user_agent: 'Mozilla/5.0 agente de prueba',
  body: {
    elapsed_time: 12,
    method: 'POST',
    phase: 'application',
    protocol: 'h2',
    referrer: PAGINA,
    sampling_fraction: 1,
    server_ip: '192.0.2.1',
    status_code: estado,
    type: 'http.error',
  },
});

/** Las líneas de avisos escritas mientras se ejecuta `accion`. */
async function lineasDurante(accion: () => Promise<void>): Promise<string[]> {
  const lineas: string[] = [];
  const espia = mock.method(console, 'log', (linea: unknown) => {
    if (typeof linea === 'string' && linea.includes(SUCESO)) {
      lineas.push(linea);
    }
  });
  try {
    await accion();
  } finally {
    espia.mock.restore();
  }
  return lineas;
}

/** Comprueba que una línea solo lleva el suceso, los avisos mínimos y los descartes, sin rutas ni textos libres. */
function comprobarLineaReducida(linea: string): Record<string, unknown> {
  for (const marca of MARCAS) {
    assert.equal(linea.includes(marca), false, `${marca} en ${linea}`);
  }
  const datos = JSON.parse(linea) as { suceso: string; avisos: Record<string, unknown>[]; descartados: object };
  assert.deepEqual(Object.keys(datos).sort(), ['avisos', 'descartados', 'suceso']);
  assert.equal(datos.suceso, SUCESO);
  for (const aviso of datos.avisos) {
    assert.ok(Object.keys(aviso).every((campo) => ['tipo', 'codigo', 'estado', 'origen', 'hora'].includes(campo)));
    assert.equal(aviso.origen, ORIGEN);
    assert.match(String(aviso.hora), /^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/);
  }
  return datos;
}

/** Lo que responde la autoridad durable fuera de las sesiones del portal: intentos admitidos y controles vacíos. */
const RESPUESTAS_FIJAS: Readonly<Record<string, object>> = {
  '/portal/disponible': { disponible: true },
  '/privado/intento': { permitido: true },
  '/recorrido/intento': { permitido: true },
};

/** Una autoridad durable que cuenta sus llamadas y guarda las sesiones del portal. */
function autoridad() {
  const sesiones = new Set<string>();
  const llamadas: string[] = [];
  async function peticionDurable(peticion: Request) {
    const ruta = new URL(peticion.url).pathname;
    llamadas.push(ruta);
    if (!ruta.startsWith('/portal/') || ruta in RESPUESTAS_FIJAS) {
      return Response.json(RESPUESTAS_FIJAS[ruta] ?? { controles: null });
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
  return { llamadas, registro: { idFromName: () => 'id', get: () => ({ fetch: peticionDurable }) } };
}

const assets = { fetch: async () => new Response('recurso protegido') };

function entornoOficial() {
  const { llamadas, registro } = autoridad();
  return {
    llamadas,
    env: {
      FARO_CLAVE_GENERAL: CLAVE_PORTAL,
      FARO_SESION_PORTAL: FIRMA_PORTAL,
      FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
      REGISTRO_SOCIOS: registro,
      ASSETS: assets,
    },
  };
}

function entornoPrivado() {
  const { llamadas, registro } = autoridad();
  return {
    llamadas,
    env: {
      FARO_PRUEBAS_CLAVE: CLAVE_PRIVADA,
      FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
      FARO_PRUEBAS_ADMINISTRACION: 'si',
      REGISTRO_SOCIOS: registro,
      ASSETS: assets,
    },
  };
}

function envio(cuerpo: string | Uint8Array<ArrayBuffer>, cabeceras: Record<string, string> = {}, ruta = RUTA): Request {
  return new Request(ORIGEN + ruta, { method: 'POST', headers: { 'content-type': TIPO, ...cabeceras }, body: cuerpo });
}

const basic = (usuario: string, secreto: string) => `Basic ${Buffer.from(`${usuario}:${secreto}`).toString('base64')}`;

/** Una cookie del portal con la forma y la firma correctas que caducó hace un minuto. */
function cookieCaducada(): string {
  const caduca = String(Math.floor(Date.now() / MS_POR_SEGUNDO) - SEGUNDOS_POR_MINUTO);
  const nonce = randomBytes(BYTES_DEL_NONCE).toString('base64url');
  const mac = createHmac('sha256', FIRMA_PORTAL).update(`faro/sesion-portal/v2.${caduca}.${nonce}`).digest('base64url');
  return `__Host-faro-portal=${caduca}.${nonce}.${mac}`;
}

async function entrarAlPortal(env: ReturnType<typeof entornoOficial>['env']): Promise<string> {
  const entrada = await oficial.fetch(
    new Request(`${ORIGEN}/acceso-web/entrar`, {
      method: 'POST',
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'cf-connecting-ip': '192.0.2.10',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ usuario: 'Faro', clave: CLAVE_PORTAL }),
    }),
    env,
  );
  const cookie = entrada.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

type Variante = (peticion: Request) => Promise<Response>;

/**
 * Un envío válido con un informe de la CSP, uno de NEL de un 503 y uno de NEL de un 403 (el rechazo que antes se
 * repetía): 204 y una línea reducida con los dos primeros y el recuento del tercero. Cada envío cuenta en el tope de la
 * instancia, que este archivo comparte entero: sus pruebas hacen menos de MAX_ENVIOS_POR_MINUTO envíos.
 */
async function comprobarEnviosValidos(responder: Variante, cabeceras: Record<string, string> = {}): Promise<void> {
  let respuesta: Response | undefined;
  const lineas = await lineasDurante(async () => {
    respuesta = await responder(envio(JSON.stringify([informeCsp, nel(FALLO_DEL_SERVIDOR), nel(RECHAZO)]), cabeceras));
  });
  assert.ok(respuesta);
  assert.equal(respuesta.status, SIN_CONTENIDO);
  assert.equal(await respuesta.text(), '');
  assert.equal(lineas.length, 1);
  const linea = comprobarLineaReducida(lineas[0] ?? '') as { avisos: object[]; descartados: object };
  assert.deepEqual(
    linea.avisos.map((aviso) => ({ ...aviso, hora: 'h' })),
    [
      { tipo: 'csp-violation', codigo: 'script-src-elem', origen: ORIGEN, hora: 'h' },
      { tipo: 'network-error', codigo: 'http.error', estado: FALLO_DEL_SERVIDOR, origen: ORIGEN, hora: 'h' },
    ],
  );
  assert.deepEqual(linea.descartados, { no_es_fallo: 1 });
}

/** Cuerpos que no son una lista de informes: rechazo sin línea y sin copiar nada de lo enviado. */
async function comprobarCuerposInvalidos(responder: Variante, cabeceras: Record<string, string> = {}): Promise<void> {
  const casos: [string, Request][] = [
    ['tipo JSON', envio(JSON.stringify([informeCsp]), { ...cabeceras, 'content-type': 'application/json' })],
    ['sin tipo declarado', new Request(ORIGEN + RUTA, { method: 'POST', headers: cabeceras, body: '[]' })],
    ['JSON roto', envio('[{"type":"csp-violation","url":"inicio.html?consulta=secreta"', cabeceras)],
    ['demasiado grande', envio(`["${RELLENO.repeat(Math.ceil(MAX_CUERPO_BYTES / RELLENO.length) + 1)}"]`, cabeceras)],
    ['objeto suelto', envio(JSON.stringify(informeCsp), cabeceras)],
    ['texto', envio(JSON.stringify('texto libre secreto'), cabeceras)],
    ['nulo', envio('null', cabeceras)],
    ['UTF-8 inválido', envio(NO_UTF8, cabeceras)],
  ];
  for (const [nombre, peticion] of casos) {
    let respuesta: Response | undefined;
    const lineas = await lineasDurante(async () => {
      respuesta = await responder(peticion);
    });
    assert.ok(respuesta);
    const esperado = nombre === 'tipo JSON' || nombre === 'sin tipo declarado' ? TIPO_NO_ADMITIDO : SOLICITUD_INVALIDA;
    assert.equal(respuesta.status, esperado, nombre);
    const texto = await respuesta.text();
    for (const marca of MARCAS) {
      assert.equal(texto.includes(marca), false, `${nombre}: ${marca}`);
    }
    assert.deepEqual(lineas, [], nombre);
  }
}

/** Informes con tipos inesperados o campos de más: 204, y la línea solo cuenta descartes o lleva los campos mínimos. */
async function comprobarInformesExtranos(responder: Variante, cabeceras: Record<string, string> = {}): Promise<void> {
  const extranos = [
    { type: 7, age: 'ayer', url: ['secreta'], body: 'texto libre secreto' },
    { type: 'csp-violation', age: 1000, url: PAGINA, body: { effectiveDirective: 'secreta consulta' } },
    { type: 'deprecation', age: 1000, url: PAGINA, body: { message: 'texto libre secreto' } },
    { type: 'csp-violation', age: 1000, url: 'https://ajeno.invalid/secreta', body: informeCsp.body },
    'texto libre secreto',
  ];
  const sobrante = {
    ...informeCsp,
    sobrante: 'texto sobrante secreto',
    body: { ...informeCsp.body, sobrante: { anidado: 'secreta' } },
  };
  const respuestas: Response[] = [];
  const lineas = await lineasDurante(async () => {
    respuestas.push(await responder(envio(JSON.stringify(extranos), cabeceras)));
    respuestas.push(await responder(envio(JSON.stringify([sobrante]), cabeceras)));
  });
  assert.deepEqual(
    respuestas.map((r) => r.status),
    [SIN_CONTENIDO, SIN_CONTENIDO],
  );
  assert.equal(lineas.length, 2);
  const [descartes, reducida] = lineas.map(comprobarLineaReducida);
  assert.deepEqual(descartes, { suceso: SUCESO, avisos: [], descartados: { forma: 3, tipo: 1, origen: 1 } });
  assert.equal((reducida as { avisos: unknown[] }).avisos.length, 1);
}

test('el predicado solo reconoce POST a la ruta exacta de los avisos', () => {
  // Por el espacio de nombres: sin el predicado, falla esta prueba y no la carga del archivo entero.
  const { esEnvioDeAvisos } = canales as Partial<typeof canales>;
  assert.equal(typeof esEnvioDeAvisos, 'function');
  assert.ok(esEnvioDeAvisos);
  assert.equal(esEnvioDeAvisos(new Request(ORIGEN + RUTA, { method: 'POST' })), true);
  assert.equal(esEnvioDeAvisos(new Request(`${ORIGEN}${RUTA}?origen=x`, { method: 'POST' })), true);
  for (const metodo of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    assert.equal(esEnvioDeAvisos(new Request(ORIGEN + RUTA, { method: metodo })), false, metodo);
  }
  for (const ruta of [...RUTAS_PARECIDAS, `${RUTA}/otra`, '/avisos-del-navegador.json', '/api/salud']) {
    assert.equal(esEnvioDeAvisos(new Request(ORIGEN + ruta, { method: 'POST' })), false, ruta);
  }
});

test('oficial: los avisos llegan sin sesión, con sesión caducada, alterada, revocada o activa', async () => {
  const { env, llamadas } = entornoOficial();
  const responder: Variante = (peticion) => oficial.fetch(peticion, env);
  await comprobarEnviosValidos(responder);
  // Sin sesión, la autoridad durable no se consulta: el aviso no mira la cookie.
  assert.deepEqual(llamadas, []);
  const activa = await entrarAlPortal(env);
  await comprobarEnviosValidos(responder, { cookie: activa });
  const [caduca = '', nonce = '', mac = ''] = activa.slice(activa.indexOf('=') + 1).split('.');
  const alterada = `__Host-faro-portal=${caduca}.${nonce}.${mac.startsWith('A') ? 'B' : 'A'}${mac.slice(1)}`;
  const caducada = cookieCaducada();
  const salida = await oficial.fetch(
    new Request(`${ORIGEN}/acceso-web/salir`, {
      method: 'POST',
      headers: { origin: ORIGEN, 'sec-fetch-site': 'same-origin', cookie: activa },
    }),
    env,
  );
  assert.equal(salida.status, CORRECTO);
  for (const cookie of [caducada, alterada, activa]) {
    const lineas = await lineasDurante(async () => {
      assert.equal((await responder(envio(JSON.stringify([informeCsp]), { cookie }))).status, SIN_CONTENIDO);
    });
    assert.equal(lineas.length, 1);
    comprobarLineaReducida(lineas[0] ?? '');
    // La misma cookie no abre ninguna otra ruta.
    assert.equal((await responder(new Request(`${ORIGEN}/api/salud`, { headers: { cookie } }))).status, PROHIBIDO);
  }
});

test('oficial: la cookie del portal de un aviso no llega a la aplicación; las demás cookies, sí', async () => {
  const recibidas: (string | null)[] = [];
  const opciones = {
    clave: CLAVE_PORTAL,
    firma: FIRMA_PORTAL,
    claveLimite: 'limite-sintetico-independiente-de-mas-de-32-bytes',
    paginaAcceso: () => new Response('pantalla'),
    registrarSesion: async () => {},
    sesionActiva: async () => true,
    revocarSesion: async () => {},
    sesionesDisponibles: async () => true,
    consumirIntento: async () => true,
    delegar: async (peticion: Request) => {
      recibidas.push(peticion.headers.get('cookie'));
      return new Response(null, { status: SIN_CONTENIDO });
    },
  };
  for (const cookie of [cookieCaducada(), `otra=valor; ${cookieCaducada()}; tema=oscuro`]) {
    const respuesta = await responderAccesoPortal(envio(JSON.stringify([informeCsp]), { cookie }), opciones);
    assert.equal(respuesta.status, SIN_CONTENIDO);
  }
  assert.deepEqual(recibidas, [null, 'otra=valor; tema=oscuro']);
});

test('oficial: cuerpos inválidos y informes extraños no dejan datos sin reducir', async () => {
  const { env } = entornoOficial();
  const responder: Variante = (peticion) => oficial.fetch(peticion, env);
  await comprobarCuerposInvalidos(responder);
  await comprobarInformesExtranos(responder);
});

test('oficial: los demás métodos de la ruta y las demás rutas conservan su protección', async () => {
  const { env } = entornoOficial();
  const responder: Variante = (peticion) => oficial.fetch(peticion, env);
  const lineas = await lineasDurante(async () => {
    for (const metodo of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const cuerpo = metodo === 'GET' || metodo === 'HEAD' ? null : '[]';
      const peticion = new Request(ORIGEN + RUTA, { method: metodo, headers: { 'content-type': TIPO }, body: cuerpo });
      const respuesta = await responder(peticion);
      assert.equal(respuesta.status, PROHIBIDO, metodo);
      assert.equal(respuesta.headers.get('x-faro-portal'), 'privado', metodo);
    }
    const navegacion = await responder(new Request(ORIGEN + RUTA, { headers: { 'sec-fetch-mode': 'navigate' } }));
    assert.equal(navegacion.status, VER_OTRA);
    for (const ruta of [...RUTAS_PARECIDAS, '/api/salud', '/acceso-web', '/inicio.html']) {
      assert.equal((await responder(envio(JSON.stringify([informeCsp]), {}, ruta))).status, PROHIBIDO, ruta);
    }
    for (const ruta of [
      '/inicio.html',
      '/api/salud',
      '/manifest.webmanifest',
      '/manifest-ca.webmanifest',
      '/scripts/idioma.js',
    ]) {
      const respuesta = await responder(new Request(ORIGEN + ruta));
      assert.equal(respuesta.status, PROHIBIDO, ruta);
      assert.equal(await respuesta.text(), '', ruta);
    }
    const pagina = await responder(new Request(`${ORIGEN}/inicio.html`, { headers: { 'sec-fetch-mode': 'navigate' } }));
    assert.equal(pagina.status, VER_OTRA);
    // Por http, como cualquier otro envío.
    const inseguro = new Request(`http://ejemplo.invalid${RUTA}`, {
      method: 'POST',
      headers: { 'content-type': TIPO },
      body: JSON.stringify([informeCsp]),
    });
    assert.equal((await responder(inseguro)).status, PROHIBIDO);
  });
  assert.deepEqual(lineas, []);
  // Sin las claves del portal, el aviso tampoco se atiende.
  const sinClaves = await oficial.fetch(envio(JSON.stringify([informeCsp])), { ...env, FARO_CLAVE_GENERAL: '' });
  assert.equal(sinClaves.status, NO_DISPONIBLE);
});

test('privada: los avisos llegan sin credencial, con una incorrecta o con la correcta, sin gastar intentos', async () => {
  const { env, llamadas } = entornoPrivado();
  const responder: Variante = (peticion) => privado.fetch(peticion, env);
  await comprobarEnviosValidos(responder);
  for (const autorizacion of [basic('Faro', 'incorrecta'), 'Basic !!!', basic('Faro', CLAVE_PRIVADA)]) {
    const lineas = await lineasDurante(async () => {
      const respuesta = await responder(envio(JSON.stringify([informeCsp]), { authorization: autorizacion }));
      assert.equal(respuesta.status, SIN_CONTENIDO);
      assert.equal(respuesta.headers.get('x-faro-portal'), 'privado');
    });
    assert.equal(lineas.length, 1);
    comprobarLineaReducida(lineas[0] ?? '');
  }
  // Ni el límite de intentos ni la administración consultan la autoridad durable por un aviso.
  assert.deepEqual(llamadas, []);
});

test('privada: cuerpos inválidos y informes extraños no dejan datos sin reducir', async () => {
  const { env } = entornoPrivado();
  const responder: Variante = (peticion) => privado.fetch(peticion, env);
  await comprobarCuerposInvalidos(responder);
  await comprobarInformesExtranos(responder);
});

test('privada: los demás métodos de la ruta y las demás rutas siguen pidiendo la credencial', async () => {
  const { env, llamadas } = entornoPrivado();
  const responder: Variante = (peticion) => privado.fetch(peticion, env);
  const lineas = await lineasDurante(async () => {
    for (const metodo of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const cuerpo = metodo === 'GET' || metodo === 'HEAD' ? null : '[]';
      const peticion = new Request(ORIGEN + RUTA, { method: metodo, headers: { 'content-type': TIPO }, body: cuerpo });
      const respuesta = await responder(peticion);
      assert.equal(respuesta.status, NO_AUTENTICADO, metodo);
      assert.match(respuesta.headers.get('www-authenticate') ?? '', /^Basic /, metodo);
    }
    for (const ruta of [...RUTAS_PARECIDAS, '/api/salud', '/inicio.html']) {
      assert.equal((await responder(envio(JSON.stringify([informeCsp]), {}, ruta))).status, NO_AUTENTICADO, ruta);
    }
    for (const ruta of [
      '/inicio.html',
      '/api/salud',
      '/manifest.webmanifest',
      '/manifest-ca.webmanifest',
      '/scripts/idioma.js',
    ]) {
      const respuesta = await responder(new Request(ORIGEN + ruta, { headers: { 'sec-fetch-mode': 'navigate' } }));
      assert.equal(respuesta.status, NO_AUTENTICADO, ruta);
      assert.equal(await respuesta.text(), '', ruta);
    }
    const inseguro = new Request(`http://ejemplo.invalid${RUTA}`, {
      method: 'POST',
      headers: { 'content-type': TIPO },
      body: JSON.stringify([informeCsp]),
    });
    assert.equal((await responder(inseguro)).status, PROHIBIDO);
  });
  assert.deepEqual(lineas, []);
  assert.deepEqual(llamadas, []);
  // Sin la clave configurada, el aviso tampoco se atiende.
  for (const secreto of [undefined, '', 'corta']) {
    const respuesta = await privado.fetch(envio(JSON.stringify([informeCsp])), { ...env, FARO_PRUEBAS_CLAVE: secreto });
    assert.equal(respuesta.status, NO_DISPONIBLE);
  }
});
