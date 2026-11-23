// Peticiones estándar, JWT RS256 sintéticos y SQLite en memoria: sin red, cuentas ni secretos reales.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { crearRouterAdministrativo, MAX_CUERPO_PANEL_BYTES, PLAZO_PANEL_MS } from '../../src/administracion/http.ts';
import { INACTIVIDAD_SESION_PANEL_MS, leerEstadoSesionPanel } from '../../src/administracion/sesion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { guardiaAdministrativaDelEntorno } from '../../src/plataforma/acceso-administrativo.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://faro.prueba';
const EMISOR = 'https://equipo-prueba.cloudflareaccess.com';
const AHORA = Date.parse('2026-10-16T10:00:00Z');
const RSA_BITS = 2048;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const PRINCIPAL = principalDePrueba(EMISOR, 'cuenta-uno');
const TOKEN_BYTES = 32;
const HASH = (texto: string) => createHash('sha256').update(texto).digest('hex');
const politica = (): PoliticaControles => ({
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
});
async function identidades() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  const firmar = async (sub: string, conCorreo = true) => {
    const claims = {
      iss: EMISOR,
      aud: ['panel-sintetico'],
      type: 'app',
      sub,
      ...(conCorreo ? { email: `${sub}@faro.invalid` } : {}),
      iat: 1_900_000_000,
      exp: 2000000000,
    };
    const partes = `${Buffer.from('{"alg":"RS256","kid":"sintetica"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(partes));
    return `${partes}.${Buffer.from(firma).toString('base64url')}`;
  };
  const pedir: typeof fetch = async (_recurso, opciones) => {
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    return Response.json({ keys: [{ ...publica, kid: 'sintetica' }] });
  };
  return {
    pedir,
    uno: await firmar('cuenta-uno'),
    dos: await firmar('cuenta-dos'),
    sinCorreo: await firmar('cuenta-tres', false),
  };
}
const identidadesSinteticas = identidades();
async function prepararPanel(db: DatabaseSync) {
  const id = await identidadesSinteticas;
  let ahora = AHORA;
  const sql = motorPanel(db);
  await new AlmacenPublicoSqlite(sql, { maxClientes: 2 }).activarControles(politica());
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => ahora });
  await almacen.activarSesionPanel();
  const guardia = guardiaAdministrativaDelEntorno(
    {
      FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba',
      FARO_ADMIN_ACCESS_AUD: 'panel-sintetico',
    },
    id.pedir,
    () => AHORA,
  );
  const router = crearRouterAdministrativo({ guardiaAdministrativa: guardia, almacen, origen: ORIGEN });
  const peticion = (ruta: string, cuerpo: unknown = {}, token?: string) =>
    new Request(`${ORIGEN}/administracion/api/${ruta}`, {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'x-faro-panel': '1',
        'content-type': 'application/json',
        'cf-access-jwt-assertion': id.uno,
        ...(token ? { 'x-faro-sesion': token } : {}),
      },
    });
  return {
    db,
    almacen,
    router,
    peticion,
    guardia,
    jwtDos: id.dos,
    jwtSinCorreo: id.sinCorreo,
    avanzar: (ms: number) => {
      ahora += ms;
    },
  };
}
type Panel = Awaited<ReturnType<typeof prepararPanel>>;
async function conPanel(accion: (panel: Panel) => Promise<void>): Promise<void> {
  const db = new DatabaseSync(':memory:');
  try {
    await accion(await prepararPanel(db));
  } finally {
    db.close();
  }
}
async function abrir(panel: Panel, jwt?: string, decision: object = {}) {
  const peticion = panel.peticion('sesion/abrir', decision);
  if (jwt) {
    peticion.headers.set('cf-access-jwt-assertion', jwt);
  }
  const salida = await panel.router(peticion);
  assert.equal(salida.status, ESTADO_HTTP.correcto);
  const cuerpo: unknown = await salida.json();
  assert.ok(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
  assert.deepEqual(Object.keys(cuerpo).sort(), ['sesion', 'token']);
  const sesion = leerEstadoSesionPanel(cuerpo.sesion);
  assert.equal(sesion.estado, 'activa');
  return { token: cuerpo.token, sesion };
}

test('HTTP exige Access firmado en cada petición y no depende del proveedor IA', () =>
  conPanel(async (p) => {
    const abierta = await abrir(p);
    for (const ruta of [
      'sesion/abrir',
      'sesion/estado',
      'sesion/actividad',
      'sesion/cerrar',
      'controles/leer',
      'controles/cambiar',
    ]) {
      const req = p.peticion(ruta, {}, abierta.token);
      req.headers.delete('cf-access-jwt-assertion');
      req.headers.set('cf-access-authenticated-user-email', 'administrador@prueba.invalid');
      req.headers.set('authorization', 'Bearer token-lectura');
      assert.equal((await p.router(req)).status, ESTADO_HTTP.prohibido);
    }
    const manipulado = p.peticion('sesion/estado', {}, abierta.token);
    manipulado.headers.set('cf-access-jwt-assertion', 'token-estatico');
    assert.equal((await p.router(manipulado)).status, ESTADO_HTTP.prohibido);
    assert.equal((await p.router(p.peticion('sesion/estado', {}, abierta.token))).status, ESTADO_HTTP.correcto);
  }));

test('abrir genera token CSPRNG256 y guarda solo SHA256 de token e identidad, sin credenciales HTTP', () =>
  conPanel(async (p) => {
    const inicial = await abrir(p);
    assert.equal(Buffer.from(inicial.token, 'base64url').byteLength, TOKEN_BYTES);
    assert.match(inicial.token, /^[A-Za-z0-9_-]{43}$/);
    const fila = p.db.prepare('SELECT * FROM administracion_sesion').get();
    assert.equal(fila?.huella_sesion, HASH(inicial.token));
    assert.equal(fila?.huella_principal, HASH(JSON.stringify([PRINCIPAL.emisor, PRINCIPAL.sujeto])));
    assert.equal(JSON.stringify(fila).includes(inicial.token), false);
    assert.equal(JSON.stringify(fila).includes(PRINCIPAL.sujeto), false);
    const nueva = await abrir(p, undefined, { retomar: true });
    assert.notEqual(nueva.token, inicial.token);
  }));

test('otra cuenta queda bloqueada; la misma persona solo retoma si lo pide y la anterior ya no actúa', () =>
  conPanel(async (p) => {
    const primera = await abrir(p);
    const ajena = p.peticion('sesion/abrir', { retomar: true });
    ajena.headers.set('cf-access-jwt-assertion', p.jwtDos);
    const bloqueada = await p.router(ajena);
    assert.equal(bloqueada.status, ESTADO_HTTP.conflicto);
    const ocupada: unknown = await bloqueada.json();
    assert.ok(esObjeto(ocupada) && ocupada.error === 'panel_ocupado' && esObjeto(ocupada.ocupacion));
    assert.equal(ocupada.ocupacion.correo, 'cuenta-uno@faro.invalid');
    assert.equal(ocupada.ocupacion.idSesion, null);
    assert.equal((await p.router(p.peticion('sesion/estado', {}, primera.token))).status, ESTADO_HTTP.correcto);
    const sinDecidir = await p.router(p.peticion('sesion/abrir'));
    assert.equal(sinDecidir.status, ESTADO_HTTP.conflicto);
    const propia: unknown = await sinDecidir.json();
    assert.ok(esObjeto(propia) && esObjeto(propia.ocupacion) && propia.ocupacion.propia === true);
    const segunda = await abrir(p, undefined, { retomar: true });
    for (const ruta of ['sesion/estado', 'sesion/actividad', 'sesion/cerrar', 'controles/leer', 'controles/cambiar']) {
      const cuerpo = ruta === 'controles/cambiar' ? { revisionEsperada: 0, politica: politica() } : {};
      const salida = await p.router(p.peticion(ruta, cuerpo, primera.token));
      assert.equal(salida.status, ESTADO_HTTP.conflicto);
      assert.deepEqual(await salida.json(), { error: 'sesion_sustituida' });
    }
    assert.equal((await p.router(p.peticion('sesion/estado', {}, segunda.token))).status, ESTADO_HTTP.correcto);
  }));

test('estado y leer no renuevan inactividad; actividad sí; expiración y cierre deniegan', () =>
  conPanel(async (p) => {
    const inicial = await abrir(p);
    p.avanzar(INACTIVIDAD_SESION_PANEL_MS - 1);
    assert.equal((await p.router(p.peticion('sesion/estado', {}, inicial.token))).status, ESTADO_HTTP.correcto);
    assert.equal((await p.router(p.peticion('controles/leer', {}, inicial.token))).status, ESTADO_HTTP.correcto);
    p.avanzar(1);
    assert.equal((await p.router(p.peticion('sesion/actividad', {}, inicial.token))).status, ESTADO_HTTP.prohibido);
    const siguiente = await abrir(p);
    p.avanzar(INACTIVIDAD_SESION_PANEL_MS - 1);
    assert.equal((await p.router(p.peticion('sesion/actividad', {}, siguiente.token))).status, ESTADO_HTTP.correcto);
    p.avanzar(1);
    assert.equal((await p.router(p.peticion('sesion/estado', {}, siguiente.token))).status, ESTADO_HTTP.correcto);
    const cerrada = await p.router(p.peticion('sesion/cerrar', {}, siguiente.token));
    assert.equal(cerrada.status, ESTADO_HTTP.correcto);
    assert.deepEqual(await cerrada.json(), { estado: 'cerrada' });
    assert.equal((await p.router(p.peticion('controles/leer', {}, siguiente.token))).status, ESTADO_HTTP.prohibido);
  }));

test('cambiar delega sesión y CAS juntos sin precheck ni renovación; conflicto conserva controles', (t) =>
  conPanel(async (p) => {
    const { token } = await abrir(p);
    t.mock.method(p.almacen, 'comprobarSesion', async () => {
      throw new Error('No hacer precheck');
    });
    t.mock.method(p.almacen, 'mantenerSesion', async () => {
      throw new Error('No renovar al cambiar');
    });
    const cambio = { revisionEsperada: 0, politica: { ...politica(), mcp: true } };
    const correcto = await p.router(p.peticion('controles/cambiar', cambio, token));
    assert.equal(correcto.status, ESTADO_HTTP.correcto);
    const confirmado: unknown = await correcto.json();
    assert.ok(esObjeto(confirmado) && esObjeto(confirmado.controles));
    assert.equal(confirmado.controles.revision, 1);
    const conflicto = await p.router(
      p.peticion('controles/cambiar', { revisionEsperada: 0, politica: politica() }, token),
    );
    assert.equal(conflicto.status, ESTADO_HTTP.conflicto);
    const resultado: unknown = await conflicto.json();
    assert.ok(esObjeto(resultado));
    assert.equal(resultado.estado, 'conflicto');
    assert.deepEqual(resultado.controles, confirmado.controles);
  }));

test('CSRF exige Origin exacto, cabecera panel, JSON y Fetch Metadata same-origin', () =>
  conPanel(async (p) => {
    for (const [cabecera, valor, estado] of [
      ['origin', '', ESTADO_HTTP.prohibido],
      ['origin', 'https://otra.prueba', ESTADO_HTTP.prohibido],
      ['origin', `${ORIGEN}/`, ESTADO_HTTP.prohibido],
      ['x-faro-panel', '', ESTADO_HTTP.prohibido],
      ['x-faro-panel', '01', ESTADO_HTTP.prohibido],
      ['content-type', 'text/plain', ESTADO_HTTP.tipoNoAdmitido],
      ['content-type', 'application/json;otro=1', ESTADO_HTTP.tipoNoAdmitido],
      ['sec-fetch-site', 'cross-site', ESTADO_HTTP.prohibido],
      ['sec-fetch-site', 'same-site', ESTADO_HTTP.prohibido],
      ['sec-fetch-site', 'none', ESTADO_HTTP.prohibido],
    ] as const) {
      const req = p.peticion('sesion/abrir');
      if (valor) {
        req.headers.set(cabecera, valor);
      } else {
        req.headers.delete(cabecera);
      }
      assert.equal((await p.router(req)).status, estado);
    }
    const segura = p.peticion('sesion/abrir');
    segura.headers.set('sec-fetch-site', 'same-origin');
    segura.headers.set('content-type', 'application/json; charset=utf-8');
    assert.equal((await p.router(segura)).status, ESTADO_HTTP.correcto);
  }));

test('origen configurado es canónico y seguro; HTTP solo loopback explícito; destinos y métodos cerrados', () =>
  conPanel(async (p) => {
    for (const origen of [
      'http://faro.prueba',
      'http://localhost:8787',
      `${ORIGEN}/`,
      `${ORIGEN}?`,
      `${ORIGEN}#`,
      `${ORIGEN}/ruta`,
      'https://usuario:clave@faro.prueba',
    ]) {
      assert.throws(() => crearRouterAdministrativo({ almacen: p.almacen, guardiaAdministrativa: p.guardia, origen }));
    }
    assert.doesNotThrow(() =>
      crearRouterAdministrativo({
        almacen: p.almacen,
        guardiaAdministrativa: p.guardia,
        origen: 'http://localhost:8787',
        permitirHttpLocal: true,
      }),
    );
    for (const sufijo of ['?token=NO-REFLEJAR', '?', '#fragmento', '#', '/desconocida']) {
      const req = new Request(`${p.peticion('sesion/abrir').url}${sufijo}`, p.peticion('sesion/abrir'));
      assert.notEqual((await p.router(req)).status, ESTADO_HTTP.correcto);
    }
    const ajena = new Request('https://otra.prueba/administracion/api/sesion/abrir', p.peticion('sesion/abrir'));
    assert.equal((await p.router(ajena)).status, ESTADO_HTTP.solicitudIncorrecta);
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const base = p.peticion('sesion/abrir');
      assert.equal(
        (await p.router(new Request(base.url, { method, headers: base.headers }))).status,
        ESTADO_HTTP.metodoNoAdmitido,
      );
    }
  }));

test('contratos cerrados rechazan token en cuerpo, campos extra, política o revisiones defectuosas', () =>
  conPanel(async (p) => {
    const { token } = await abrir(p);
    for (const cuerpo of [null, [], true, '', { token }, { sesion: token }, { extra: true }]) {
      assert.equal(
        (await p.router(p.peticion('sesion/estado', cuerpo, token))).status,
        ESTADO_HTTP.solicitudIncorrecta,
      );
    }
    for (const cuerpo of [
      {},
      { revisionEsperada: -1, politica: politica() },
      { revisionEsperada: '0', politica: politica() },
      { revisionEsperada: Number.MAX_SAFE_INTEGER + 1, politica: politica() },
      { revisionEsperada: 0, politica: { ...politica(), proveedor: 'secreto' } },
      { revisionEsperada: 0, politica: { ...politica(), permisosIa: {} } },
      { revisionEsperada: 0, politica: politica(), token },
    ]) {
      assert.equal(
        (await p.router(p.peticion('controles/cambiar', cuerpo, token))).status,
        ESTADO_HTTP.solicitudIncorrecta,
      );
    }
    const base = p.peticion('sesion/estado', {}, token);
    assert.equal((await p.router(new Request(base, { body: '{' }))).status, ESTADO_HTTP.solicitudIncorrecta);
  }));

test('sesión solo en cabecera canónica; cookie, bearer, cuerpo o token inválido no autorizan', () =>
  conPanel(async (p) => {
    const { token } = await abrir(p);
    for (const cabeceras of [
      { cookie: `faro_sesion=${token}` },
      { authorization: `Bearer ${token}` },
      { 'x-faro-sesion': 'x'.repeat(TOKEN_BYTES) },
    ]) {
      const req = p.peticion('sesion/estado');
      for (const [nombre, valor] of Object.entries(cabeceras)) {
        req.headers.set(nombre, valor);
      }
      assert.equal((await p.router(req)).status, ESTADO_HTTP.prohibido);
    }
    assert.equal((await p.router(p.peticion('sesion/estado', { token }))).status, ESTADO_HTTP.prohibido);
    const req = p.peticion('sesion/estado', {}, token);
    req.headers.append('x-faro-sesion', token);
    assert.equal((await p.router(req)).status, ESTADO_HTTP.prohibido);
  }));

test('todas las respuestas son no-store, sin CORS, cookies, identidad ni tokens nuevos salvo abrir', () =>
  conPanel(async (p) => {
    const { token } = await abrir(p);
    for (const req of [
      p.peticion('sesion/estado', {}, token),
      p.peticion('controles/leer', {}, token),
      p.peticion('sesion/estado'),
    ]) {
      const salida = await p.router(req);
      assert.equal(salida.headers.get('cache-control'), 'no-store');
      assert.equal(salida.headers.get('set-cookie'), null);
      assert.equal(salida.headers.get('access-control-allow-origin'), null);
      assert.equal(salida.headers.get('x-faro-sesion'), null);
      const texto = await salida.text();
      for (const secreto of [token, PRINCIPAL.sujeto, PRINCIPAL.emisor, '"token"']) {
        assert.equal(texto.includes(secreto), false);
      }
    }
  }));

test('fallo backend y respuestas corruptas dan 503 neutro sin logs ni credenciales', (t) =>
  conPanel(async (p) => {
    const { token } = await abrir(p);
    const avisos = t.mock.method(console, 'warn', () => {});
    const errores = t.mock.method(console, 'error', () => {});
    const registro = t.mock.method(console, 'log', () => {});
    t.mock.method(p.almacen, 'leerControlesDeSesion', async () => {
      throw new Error(`NO-REFLEJAR ${token}`);
    });
    const salida = await p.router(p.peticion('controles/leer', {}, token));
    assert.equal(salida.status, ESTADO_HTTP.noDisponible);
    assert.deepEqual(await salida.json(), { error: 'no_disponible' });
    t.mock.method(p.almacen, 'comprobarSesion', async () => ({ estado: 'activa', token }) as never);
    const corrupta = await p.router(p.peticion('sesion/estado', {}, token));
    assert.equal(corrupta.status, ESTADO_HTTP.noDisponible);
    assert.deepEqual(await corrupta.json(), { error: 'no_disponible' });
    assert.equal(avisos.mock.callCount() + errores.mock.callCount() + registro.mock.callCount(), 0);
  }));

test('cota 4 KiB se aplica leyendo flujo sin content-length; JSON justo en límite sigue admitido', () =>
  conPanel(async (p) => {
    const base = p.peticion('sesion/abrir');
    const justa = new Request(base, { body: `{}${' '.repeat(MAX_CUERPO_PANEL_BYTES - 2)}` });
    assert.equal((await p.router(justa)).status, ESTADO_HTTP.correcto);
    let cancelado = false;
    const flujo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(MAX_CUERPO_PANEL_BYTES + 1));
      },
      cancel() {
        cancelado = true;
      },
    });
    const inicio: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: p.peticion('sesion/abrir').headers,
      body: flujo,
      duplex: 'half',
    };
    const excesiva = await p.router(new Request(`${ORIGEN}/administracion/api/sesion/abrir`, inicio));
    assert.equal(excesiva.status, ESTADO_HTTP.solicitudIncorrecta);
    await turno();
    assert.equal(cancelado, true);
    const declarada = p.peticion('sesion/abrir');
    declarada.headers.set('content-length', String(MAX_CUERPO_PANEL_BYTES + 1));
    assert.equal((await p.router(declarada)).status, ESTADO_HTTP.solicitudIncorrecta);
  }));

test('guardia tardía y retirada previa no inician operaciones después del plazo', (t) =>
  conPanel(async (p) => {
    const guardiaPendiente = Promise.withResolvers<typeof PRINCIPAL>();
    const router = crearRouterAdministrativo({
      almacen: p.almacen,
      origen: ORIGEN,
      guardiaAdministrativa: () => guardiaPendiente.promise,
    });
    const abrirEspia = t.mock.method(p.almacen, 'abrirSesionUnica');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pendiente = router(p.peticion('sesion/abrir'));
    await Promise.resolve();
    t.mock.timers.tick(PLAZO_PANEL_MS);
    assert.equal((await pendiente).status, ESTADO_HTTP.tiempoAgotado);
    guardiaPendiente.resolve(PRINCIPAL);
    await turno();
    assert.equal(abrirEspia.mock.callCount(), 0);
    const cancelacion = new AbortController();
    cancelacion.abort();
    const retirada = new Request(p.peticion('sesion/abrir'), { signal: cancelacion.signal });
    assert.equal((await p.router(retirada)).status, ESTADO_HTTP.solicitudIncorrecta);
  }));

test('cuerpo bloqueado se cancela al vencer plazo o retirarse cliente, sin abrir sesión', (t) =>
  conPanel(async (p) => {
    const router = crearRouterAdministrativo({
      almacen: p.almacen,
      origen: ORIGEN,
      guardiaAdministrativa: async () => PRINCIPAL,
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const vencer of [true, false]) {
      let cancelado = false;
      const cuerpo = new ReadableStream<Uint8Array>({
        cancel() {
          cancelado = true;
        },
      });
      const retirada = new AbortController();
      const inicio: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers: p.peticion('sesion/abrir').headers,
        body: cuerpo,
        duplex: 'half',
        signal: retirada.signal,
      };
      const pendiente = router(new Request(`${ORIGEN}/administracion/api/sesion/abrir`, inicio));
      await turno();
      if (vencer) {
        t.mock.timers.tick(PLAZO_PANEL_MS);
      } else {
        retirada.abort();
      }
      assert.equal((await pendiente).status, vencer ? ESTADO_HTTP.tiempoAgotado : ESTADO_HTTP.solicitudIncorrecta);
      await turno();
      assert.equal(cancelado, true);
      assert.equal(p.db.prepare('SELECT huella_sesion FROM administracion_sesion').get()?.huella_sesion, null);
    }
  }));

test('bienvenida: correo y entrada; con la sesión propia abierta devuelve sus ids y sus horas', () =>
  conPanel(async (p) => {
    const vacia = await p.router(p.peticion('sesion/bienvenida'));
    assert.equal(vacia.status, ESTADO_HTTP.correcto);
    const libre: unknown = await vacia.json();
    assert.ok(esObjeto(libre) && libre.correo === 'cuenta-uno@faro.invalid' && libre.ocupacion === null);
    assert.match(String(libre.idEntrada), /^E-[0-9A-HJKMNP-TV-Z]{8}$/);
    const abierta = await abrir(p);
    const salida: unknown = await (await p.router(p.peticion('sesion/bienvenida'))).json();
    assert.ok(esObjeto(salida) && esObjeto(salida.ocupacion));
    assert.equal(salida.idEntrada, libre.idEntrada);
    assert.equal(salida.ocupacion.propia, true);
    assert.equal(salida.ocupacion.idEntrada, libre.idEntrada);
    assert.match(String(salida.ocupacion.idSesion), /^S-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(salida.ocupacion.desde, abierta.sesion.estado === 'activa' ? abierta.sesion.iniciadaEn : null);
    assert.equal(
      (await p.router(p.peticion('sesion/bienvenida', { extra: true }))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
    assert.equal(
      (await p.router(p.peticion('sesion/abrir', { retomar: 'si' }))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
  }));

test('sin correo verificado no hay bienvenida, apertura ni registro: nunca se abre con un correo vacío', () =>
  conPanel(async (p) => {
    for (const ruta of ['sesion/bienvenida', 'sesion/abrir', 'sesion/registro']) {
      const peticion = p.peticion(ruta);
      peticion.headers.set('cf-access-jwt-assertion', p.jwtSinCorreo);
      const salida = await p.router(peticion);
      assert.equal(salida.status, ESTADO_HTTP.prohibido);
      assert.deepEqual(await salida.json(), { error: 'correo_no_verificado' });
    }
    assert.equal(p.db.prepare('SELECT huella_sesion FROM administracion_sesion').get()?.huella_sesion, null);
  }));

test('registro: solo con Access verificado, con las filas de entrada, apertura y rechazo', () =>
  conPanel(async (p) => {
    await abrir(p);
    const ajena = p.peticion('sesion/abrir');
    ajena.headers.set('cf-access-jwt-assertion', p.jwtDos);
    assert.equal((await p.router(ajena)).status, ESTADO_HTTP.conflicto);
    const sinAccess = p.peticion('sesion/registro');
    sinAccess.headers.delete('cf-access-jwt-assertion');
    sinAccess.headers.set('cf-access-authenticated-user-email', 'falso@prueba.invalid');
    const rechazo = await p.router(sinAccess);
    assert.equal(rechazo.status, ESTADO_HTTP.prohibido);
    assert.deepEqual(await rechazo.json(), { error: 'acceso_denegado' });
    const salida = await p.router(p.peticion('sesion/registro'));
    assert.equal(salida.status, ESTADO_HTTP.correcto);
    const cuerpo: unknown = await salida.json();
    assert.ok(esObjeto(cuerpo) && Array.isArray(cuerpo.registro));
    assert.deepEqual(
      cuerpo.registro.map((fila: { tipo: string; correo: string }) => [fila.tipo, fila.correo]),
      [
        ['apertura-rechazada', 'cuenta-dos@faro.invalid'],
        ['entrada', 'cuenta-dos@faro.invalid'],
        ['sesion-abierta', 'cuenta-uno@faro.invalid'],
        ['entrada', 'cuenta-uno@faro.invalid'],
      ],
    );
    assert.equal(JSON.stringify(cuerpo).includes('huella'), false);
  }));
