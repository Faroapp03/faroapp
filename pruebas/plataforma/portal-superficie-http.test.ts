import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { VALOR_HSTS } from '../../src/plataforma/cabeceras-web.ts';
import { protegerRespuestaPortal } from '../../src/plataforma/cloudflare/cabeceras-portal.ts';
import worker from '../../src/plataforma/cloudflare/worker-oficial.ts';

const ORIGEN = 'https://ejemplo.invalid';
const VER_OTRA = 303;
const PERMANENTE = 301;
const PERMANENTE_CON_METODO = 308;
const HSTS_DE_UN_ANO = 'max-age=31536000';
const ASSETS = { fetch: async () => assert.fail('La petición no debe alcanzar los archivos') };
const entorno = {
  ASSETS,
  FARO_CLAVE_GENERAL: 'clave-sintetica',
  FARO_SESION_PORTAL: 'firma-sintetica-de-al-menos-treinta-y-dos-bytes',
  FARO_LIMITE_PORTAL: 'limite-sintetico-de-al-menos-treinta-y-dos-bytes',
};

/** El limitador durable de prueba: responde que los intentos de esta dirección ya se agotaron. */
const agotado = {
  ...entorno,
  REGISTRO_SOCIOS: { idFromName: () => 'id', get: () => ({ fetch: async () => Response.json({ permitido: false }) }) },
};
/** Un envío del formulario desde la propia pantalla de acceso. */
function envio(): RequestInit {
  return {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'cf-connecting-ip': '192.0.2.1',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ usuario: 'Faro', clave: 'clave-sintetica' }),
  };
}
const NAVEGACION = { headers: { accept: 'text/html' } };

/**
 * Comprueba en una respuesta https la política de transporte y las cabeceras comunes de la puerta. La referencia es
 * no-referrer salvo en la única excepción, la página del acceso a un recorrido (se comprueba aparte).
 */
function comprobarCabecerasComunes(respuesta: Response, caso: string): void {
  assert.equal(respuesta.headers.get('strict-transport-security'), HSTS_DE_UN_ANO, caso);
  assert.equal(respuesta.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive', caso);
  assert.equal(respuesta.headers.get('cross-origin-opener-policy'), 'same-origin', caso);
  assert.equal(respuesta.headers.get('cross-origin-resource-policy'), 'same-origin', caso);
  assert.match(respuesta.headers.get('permissions-policy') ?? '', /camera=\(\)/, caso);
  assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff', caso);
  assert.equal(respuesta.headers.get('x-frame-options'), 'DENY', caso);
  assert.equal(respuesta.headers.get('referrer-policy'), 'no-referrer', caso);
}

test('toda respuesta https lleva HSTS y las cabeceras comunes: páginas, rechazos, redirecciones y errores', async () => {
  for (const [caso, ruta, opciones, env, estado] of [
    ['portada', '/', {}, entorno, ESTADO_HTTP.correcto],
    ['robots.txt', '/robots.txt', {}, entorno, ESTADO_HTTP.correcto],
    ['pantalla de acceso', '/acceso-web', NAVEGACION, entorno, ESTADO_HTTP.correcto],
    ['navegación sin sesión', '/inicio.html', NAVEGACION, entorno, VER_OTRA],
    ['recurso sin sesión', '/inicio.html', {}, entorno, ESTADO_HTTP.prohibido],
    ['acceso pedido como recurso', '/acceso-web', {}, entorno, ESTADO_HTTP.prohibido],
    ['ruta inexistente', '/no-existe/en-faro', {}, entorno, ESTADO_HTTP.prohibido],
    ['ruta inexistente navegada', '/no-existe/en-faro', NAVEGACION, entorno, VER_OTRA],
    ['método no admitido', '/acceso-web/entrar', {}, entorno, ESTADO_HTTP.metodoNoAdmitido],
    ['salir sin origen', '/acceso-web/salir', { method: 'POST' }, entorno, ESTADO_HTTP.prohibido],
    ['demasiados intentos', '/acceso-web/entrar', envio(), agotado, ESTADO_HTTP.demasiadasPeticiones],
    ['sin autoridad durable', '/inicio.html', {}, { ASSETS }, ESTADO_HTTP.noDisponible],
    ['www', '/', {}, entorno, PERMANENTE],
  ] as const) {
    const host = caso === 'www' ? 'https://www.ejemplo.invalid' : ORIGEN;
    const respuesta = await worker.fetch(new Request(host + ruta, opciones), env);
    assert.equal(respuesta.status, estado, caso);
    comprobarCabecerasComunes(respuesta, caso);
  }
});

test('la referencia same-origin solo se conserva en una ruta de recorrido; lo demás recibe no-referrer', () => {
  const delegada = (politica: string) => new Response('página', { headers: { 'referrer-policy': politica } });
  for (const [ruta, politica, esperada] of [
    ['/recorrido.html', 'same-origin', 'same-origin'],
    ['/recorrido', 'same-origin', 'same-origin'],
    ['/recorrido.html', 'unsafe-url', 'no-referrer'],
    ['/recorrido.html', 'origin', 'no-referrer'],
    ['/inicio.html', 'same-origin', 'no-referrer'],
    ['/acceso-web', 'same-origin', 'no-referrer'],
    ['/%E0%A4%A', 'same-origin', 'no-referrer'],
  ] as const) {
    const protegida = protegerRespuestaPortal(new Request(`${ORIGEN}${ruta}`), delegada(politica));
    assert.equal(protegida.headers.get('referrer-policy'), esperada, `${ruta} con ${politica}`);
    assert.equal(protegida.headers.get('x-frame-options'), 'DENY', ruta);
  }
});

test('por http no se envía HSTS: el navegador la ignoraría y la redirección a https ya la trae', async () => {
  const respuesta = await worker.fetch(new Request('http://ejemplo.invalid/acceso-web?x=1'), entorno);
  assert.equal(respuesta.status, PERMANENTE_CON_METODO);
  assert.equal(respuesta.headers.get('location'), `${ORIGEN}/acceso-web?x=1`);
  assert.equal(respuesta.headers.has('strict-transport-security'), false);
});

/**
 * Usos del nombre de la cabecera HSTS que no le asignan VALOR_HSTS: en headers.set, en un objeto literal o en un par
 * [nombre, valor], el valor tiene que ser esa constante. Leerla, comprobarla o borrarla (el nombre seguido de «)») no
 * asigna nada. Cualquier otro uso, como guardar el nombre en una constante propia, también se señala: esconde la
 * asignación a esta guardia.
 */
function usosAjenosDeHsts(fuente: string): string[] {
  const usos = fuente.matchAll(/(['"`])strict-transport-security\1\s*([,:)]?)\s*([^,)\]}\n;]*)/gi);
  return [...usos]
    .filter(([, , separador, valor]) => separador !== ')' && !(separador && valor?.trim() === 'VALOR_HSTS'))
    .map(([uso]) => uso.trim());
}

/** Módulo que declara la única constante de HSTS. */
const FUENTE_DE_HSTS = 'plataforma/cabeceras-web.ts';

/**
 * Problemas de HSTS en un conjunto de módulos: asignaciones de la cabecera que no usan VALOR_HSTS y declaraciones de
 * VALOR_HSTS fuera de su único módulo. Una constante local con ese nombre burlaría la primera comprobación.
 */
function problemasDeHsts(modulos: ReadonlyMap<string, string>): string[] {
  const problemas: string[] = [];
  const declarantes: string[] = [];
  for (const [archivo, fuente] of modulos) {
    problemas.push(...usosAjenosDeHsts(fuente).map((uso) => `${archivo}: ${uso}`));
    if (/\b(?:const|let|var|function|class)\s+VALOR_HSTS\b/.test(fuente)) {
      declarantes.push(archivo);
    }
  }
  if (declarantes.join() !== FUENTE_DE_HSTS) {
    problemas.push(`VALOR_HSTS se declara en: ${declarantes.join(', ') || 'ningún módulo'}`);
  }
  return problemas;
}

/** Módulos de código de src, también .mjs, .cjs, .mts y .cts, con su ruta relativa. */
function modulosDeSrc(): ReadonlyMap<string, string> {
  const raiz = new URL('../../src/', import.meta.url);
  return new Map(
    readdirSync(raiz, { recursive: true, encoding: 'utf8' })
      .filter((archivo) => /\.[cm]?[jt]s$/.test(archivo))
      .sort()
      .map((archivo) => [archivo.split(sep).join('/'), readFileSync(new URL(archivo, raiz), 'utf8')]),
  );
}

test('el valor de HSTS tiene una sola fuente: una declaración, y toda asignación de la cabecera la usa', () => {
  assert.equal(VALOR_HSTS, HSTS_DE_UN_ANO);
  assert.deepEqual(problemasDeHsts(modulosDeSrc()), []);
});

test('la guardia de HSTS señala una redefinición local de VALOR_HSTS', () => {
  const modulos = new Map([
    [FUENTE_DE_HSTS, "export const VALOR_HSTS = 'max-age=' + VIGENCIA;"],
    [
      'plataforma/otra.mjs',
      "const VALOR_HSTS = 'max-age=1';\nrespuesta.headers.set('strict-transport-security', VALOR_HSTS);",
    ],
  ]);
  assert.deepEqual(problemasDeHsts(modulos), [`VALOR_HSTS se declara en: ${FUENTE_DE_HSTS}, plataforma/otra.mjs`]);
  assert.deepEqual(problemasDeHsts(new Map([...modulos].slice(0, 1))), []);
});

test('la guardia de HSTS señala constantes propias en set, objetos, pares y nombres guardados aparte', () => {
  const muestra = [
    "const PROPIA = 'max-age=1';",
    "respuesta.headers.set('strict-transport-security', PROPIA);",
    "new Headers({ 'strict-transport-security': PROPIA_TAMBIEN });",
    "new Headers([['Strict-Transport-Security', 'max-age=' + DIAS]]);",
    "const NOMBRE = 'strict-transport-security';",
    "respuesta.headers.set('strict-transport-security', VALOR_HSTS);",
    "new Headers({ 'strict-transport-security': VALOR_HSTS });",
    "assert.equal(respuesta.headers.get('strict-transport-security'), null);",
  ].join('\n');
  assert.deepEqual(usosAjenosDeHsts(muestra), [
    "'strict-transport-security', PROPIA",
    "'strict-transport-security': PROPIA_TAMBIEN",
    "'Strict-Transport-Security', 'max-age=' + DIAS",
    "'strict-transport-security'",
  ]);
});

test('www redirige al dominio principal antes de servir portada, robots o formulario, con ruta y consulta', async () => {
  for (const [pedida, destino] of [
    ['https://www.ejemplo.invalid/', `${ORIGEN}/`],
    ['https://www.ejemplo.invalid/acceso-web?x=1', `${ORIGEN}/acceso-web?x=1`],
    ['https://www.ejemplo.invalid/robots.txt', `${ORIGEN}/robots.txt`],
    ['http://www.ejemplo.invalid/acceso-web?x=1&y=2', `${ORIGEN}/acceso-web?x=1&y=2`],
    [
      'https://www.ejemplo.invalid/acceso-web?host=otro.invalid&volver=https://otro.invalid/',
      `${ORIGEN}/acceso-web?host=otro.invalid&volver=https://otro.invalid/`,
    ],
  ] as const) {
    const respuesta = await worker.fetch(new Request(pedida, NAVEGACION), entorno);
    assert.equal(respuesta.status, PERMANENTE, pedida);
    assert.equal(respuesta.headers.get('location'), destino, pedida);
    assert.equal(await respuesta.text(), '', pedida);
  }
  const envioPorWww = await worker.fetch(
    new Request('https://www.ejemplo.invalid/acceso-web/entrar', envio()),
    entorno,
  );
  assert.equal(envioPorWww.status, PERMANENTE);
  assert.equal(envioPorWww.headers.has('set-cookie'), false);
  for (const ruta of ['/', '/acceso-web?x=1', '/robots.txt']) {
    const principal = await worker.fetch(new Request(ORIGEN + ruta, NAVEGACION), entorno);
    assert.equal(principal.status, ESTADO_HTTP.correcto, ruta);
    assert.equal(principal.headers.has('location'), false, ruta);
  }
});

test('solo la navegación de documento va a la pantalla de acceso; archivos y API reciben un 403 vacío', async () => {
  for (const ruta of ['/favicon.ico', '/inexistente.js', '/api/salud']) {
    const respuesta = await worker.fetch(new Request(ORIGEN + ruta), entorno);
    assert.equal(respuesta.status, ESTADO_HTTP.prohibido);
    assert.equal(await respuesta.text(), '', ruta);
  }
  for (const headers of [{ accept: 'text/html,application/xhtml+xml' }, { 'sec-fetch-dest': 'document' }]) {
    const respuesta = await worker.fetch(new Request(`${ORIGEN}/inicio.html`, { headers }), entorno);
    assert.equal(respuesta.status, VER_OTRA);
    assert.equal(respuesta.headers.get('location'), '/acceso-web?volver=%2Finicio.html');
    assert.equal(await respuesta.text(), '');
  }
  const script = await worker.fetch(
    new Request(`${ORIGEN}/x.js`, {
      headers: { 'sec-fetch-dest': 'script', accept: 'text/html' },
    }),
    entorno,
  );
  assert.equal(await script.text(), '');
});

test('robots público rechaza indexación en fase privada y HEAD no entrega cuerpo', async () => {
  const respuesta = await worker.fetch(new Request(`${ORIGEN}/robots.txt`), entorno);
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(await respuesta.text(), 'User-agent: *\nDisallow: /\n');
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const head = await worker.fetch(new Request(`${ORIGEN}/robots.txt`, { method: 'HEAD' }), entorno);
  assert.equal(head.status, ESTADO_HTTP.correcto);
  assert.equal(await head.text(), '');
});

test('las cabeceras no cambian CSP, redirección ni cookie de una respuesta delegada', () => {
  const original = new Response(null, {
    status: 302,
    headers: {
      location: '/destino',
      'content-security-policy': "default-src 'none'",
      'set-cookie': '__Host-faro=valor; Secure; HttpOnly; SameSite=Strict; Path=/',
    },
  });
  const salida = protegerRespuestaPortal(new Request(`${ORIGEN}/administracion/`), original);
  assert.equal(salida.status, original.status);
  for (const nombre of ['location', 'content-security-policy', 'set-cookie']) {
    assert.equal(salida.headers.get(nombre), original.headers.get(nombre));
  }
  assert.equal(salida.headers.get('strict-transport-security'), HSTS_DE_UN_ANO);
});
