/** Frontera real + SQLite y JWT/JWKS sintéticos: sin secretos, cuentas o transporte externo. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  crearReceptorInicioActualizacion,
  MAX_INICIO_ACTUALIZACION_BYTES,
} from '../../src/administracion/inicio-actualizacion.ts';
import type { AlmacenTrabajosActualizacion } from '../../src/administracion/trabajos.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { conDesafio } from '../ayudas/desafio.ts';
import {
  AHORA_OIDC,
  afirmacionesOidc,
  CONFIANZA_MANTENIMIENTO,
  ORIGEN_MANTENIMIENTO,
} from '../ayudas/oidc-mantenimiento.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const TAM_SHA = 40;
const RSA_BITS = 2048;
const BYTE_UTF8_INVALIDO = 255;
const TOKEN_PREVIO_RESERVA_S = 31;
const TOKEN_CADUCADO_MS = 301_000;
const AHORA = AHORA_OIDC;
const ORIGEN = ORIGEN_MANTENIMIENTO;
const URL_INICIO = `${ORIGEN}/mantenimiento/inicio`;
const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const REFERENCIA = { solicitudId: ID, revisionReserva: 1 };
const INICIO = { ...REFERENCIA, accion: 'actualizar-datos' };
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
async function claves() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  return {
    jwk,
    async firmar(contenido: Record<string, unknown> = afirmacionesOidc(CONFIANZA_MANTENIMIENTO)) {
      const texto = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(contenido)).toString('base64url')}`;
      const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(texto));
      return `${texto}.${Buffer.from(firma).toString('base64url')}`;
    },
  };
}
const CRIPTO = claves();
function contarAlmacen(
  base: AlmacenTrabajosActualizacion,
  contador: { registros: number; lecturas: number },
): AlmacenTrabajosActualizacion {
  return new Proxy(base, {
    get(objeto, clave) {
      if (clave === 'confirmarInicio') {
        return (...args: Parameters<AlmacenTrabajosActualizacion['confirmarInicio']>) => {
          contador.registros++;
          return objeto.confirmarInicio(...args);
        };
      }
      if (clave === 'leerTrabajoPrivado') {
        return () => {
          contador.lecturas++;
          return objeto.leerTrabajoPrivado();
        };
      }
      const valor = Reflect.get(objeto, clave);
      return typeof valor === 'function' ? valor.bind(objeto) : valor;
    },
  });
}
async function fixture(t: TestContext, accion = 'actualizar-datos', reservar = true) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'inicio-actualizacion-'));
  const reloj = { ahora: AHORA };
  const base = crearAlmacenPublicoNode({
    archivo: join(dir, 'panel.sqlite'),
    maxClientes: 1,

    ahora: () => reloj.ahora,
  });
  t.after(() => {
    base.close();
    rmSync(dir, { recursive: true });
  });
  await base.sesion.prepararPanel({
    version: 2,
    api: 'deshabilitada',
    mcp: false,
    a2a: false,
  });
  await abrirSesionDePrueba(base.sesion, ACCESO);
  await base.trabajos.prepararTrabajos();
  if (reservar) {
    assert.ok(accion === 'actualizar-datos' || accion === 'reintentar-pendientes');
    await base.trabajos.reservarTrabajoDeSesion(
      ACCESO,
      { solicitudId: ID, accion, revisionEsperada: 0 },
      CONFIANZA_MANTENIMIENTO,
    );
  }
  const contador = { jwks: 0, registros: 0, lecturas: 0 };
  const almacen = contarAlmacen(base.trabajos, contador);
  const cripto = await CRIPTO;
  const pedir: typeof fetch = async (url, opciones) => {
    contador.jwks++;
    assert.equal(String(url), 'https://token.actions.githubusercontent.com/.well-known/jwks');
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    assert.equal(opciones?.redirect, 'manual');
    return Response.json({ keys: [cripto.jwk] });
  };
  const crear = (transporte = pedir) =>
    conDesafio(
      crearReceptorInicioActualizacion({ origen: ORIGEN, almacen, pedir: transporte, ahora: () => reloj.ahora }),
      'Bearer',
    );
  return { base, reloj, contador, pedir, crear, firmar: cripto.firmar };
}
function peticion(token: string, cuerpo: unknown = INICIO, cambios: RequestInit = {}) {
  return new Request(URL_INICIO, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    ...cambios,
  });
}

test('inicio firmado confirma antes de ejecutar, sobrevive a cerrar sesión y solo el mismo run repite', async (t) => {
  const f = await fixture(t);
  await f.base.sesion.cerrarSesion(ACCESO);
  const recibir = f.crear();
  const token = await f.firmar();
  const cuerpoLimite = JSON.stringify(INICIO).padEnd(MAX_INICIO_ACTUALIZACION_BYTES);
  const respuesta = await recibir(peticion(token, cuerpoLimite));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await respuesta.json(), { estado: 'aplicado' });
  const antes = await f.base.trabajos.leerTrabajoPrivado();
  assert.equal(antes.ultimoTrabajo?.runId, '789');
  assert.equal(antes.ultimoTrabajo?.inicioConfirmado, true);
  assert.deepEqual(await (await recibir(peticion(token))).json(), { estado: 'repetido' });
  assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
  assert.equal(
    (await recibir(peticion(await f.firmar({ ...afirmacionesOidc(CONFIANZA_MANTENIMIENTO), run_id: '790' })))).status,
    ESTADO_HTTP.noAutenticado,
  );
  assert.equal(f.contador.jwks, 1);
});

test('frontera canónica, cuerpo cerrado y cota rechazan antes de SQL o JWKS', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  for (const origen of [
    'https://mantenimiento.example/',
    'https://u:p@mantenimiento.example',
    'http://mantenimiento.example',
  ]) {
    assert.throws(() => crearReceptorInicioActualizacion({ origen, almacen: f.base.trabajos, pedir: f.pedir }));
  }
  for (const [req, estado] of [
    [new Request(`${URL_INICIO}?x=1`, { method: 'POST' }), ESTADO_HTTP.noEncontrado],
    [new Request(URL_INICIO), ESTADO_HTTP.metodoNoAdmitido],
    [peticion(''), ESTADO_HTTP.noAutenticado],
    [
      peticion(token, INICIO, { headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' } }),
      ESTADO_HTTP.tipoNoAdmitido,
    ],
    [peticion(token, '{'), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { ...INICIO, extra: 'detalle-privado' }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { ...INICIO, revisionReserva: 0 }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { ...INICIO, solicitudId: 'no-uuid' }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { ...INICIO, accion: 'ejecutar-shell' }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, 'x'.repeat(MAX_INICIO_ACTUALIZACION_BYTES + 1)), ESTADO_HTTP.demasiadoGrande],
    [
      peticion(token, INICIO, {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': String(MAX_INICIO_ACTUALIZACION_BYTES + 1),
        },
      }),
      ESTADO_HTTP.demasiadoGrande,
    ],
    [peticion(token, INICIO, { body: Uint8Array.of(BYTE_UTF8_INVALIDO) }), ESTADO_HTTP.solicitudIncorrecta],
  ] as const) {
    const respuesta = await recibir(req);
    assert.equal(respuesta.status, estado);
    assert.ok(!(await respuesta.text()).includes('detalle-privado'));
  }
  assert.deepEqual(f.contador, { jwks: 0, registros: 0, lecturas: 0 });
});

test('tupla, acción o reserva inexistente no resuelven JWT; una reserva terminal no puede iniciar', async (t) => {
  const f = await fixture(t);
  const token = await f.firmar();
  for (const delta of [{ solicitudId: OTRO_ID }, { revisionReserva: 2 }, { accion: 'reintentar-pendientes' }]) {
    assert.equal((await f.crear()(peticion(token, { ...INICIO, ...delta }))).status, ESTADO_HTTP.conflicto);
  }
  const vacio = await fixture(t, 'actualizar-datos', false);
  assert.equal((await vacio.crear()(peticion(token))).status, ESTADO_HTTP.conflicto);
  await f.base.trabajos.anotarDespacho(REFERENCIA, { estado: 'rechazada' });
  assert.equal((await f.crear()(peticion(token))).status, ESTADO_HTTP.conflicto);
  assert.equal(f.contador.jwks, 0);
  assert.equal(vacio.contador.jwks, 0);
});

test('OIDC rechaza Access, audiencia de inicio, pins ajenos, run, intento y token antiguo respecto a reserva', async (t) => {
  const f = await fixture(t);
  await f.base.trabajos.anotarDespacho(REFERENCIA, { estado: 'despachada', runId: '789' });
  const recibir = f.crear();
  for (const delta of [
    { iss: 'https://equipo.cloudflareaccess.com' },
    { aud: URL_INICIO },
    { sha: 'e'.repeat(TAM_SHA) },
    { workflow_sha: 'e'.repeat(TAM_SHA) },
    { run_id: '790' },
    { run_attempt: '2' },
    { iat: AHORA / MS_POR_SEGUNDO - TOKEN_PREVIO_RESERVA_S },
    { exp: AHORA / MS_POR_SEGUNDO },
  ]) {
    assert.equal(
      (await recibir(peticion(await f.firmar({ ...afirmacionesOidc(CONFIANZA_MANTENIMIENTO), ...delta })))).status,
      ESTADO_HTTP.noAutenticado,
    );
  }
  const token = await f.firmar();
  assert.equal((await recibir(peticion(token))).status, ESTADO_HTTP.correcto);
  f.reloj.ahora += TOKEN_CADUCADO_MS;
  assert.equal((await recibir(peticion(token))).status, ESTADO_HTTP.noAutenticado);
  assert.equal(f.contador.jwks, 1);
  assert.equal(f.contador.registros, 1);
});

test('SQL revalida la reserva si cambia durante JWKS, sin autorizar el trabajo nuevo', async (t) => {
  const f = await fixture(t);
  const listo = Promise.withResolvers<void>();
  const continuar = Promise.withResolvers<void>();
  const recibir = f.crear(async (url, init) => {
    listo.resolve();
    await continuar.promise;
    return f.pedir(url, init);
  });
  const pendiente = recibir(peticion(await f.firmar()));
  await listo.promise;
  await f.base.trabajos.anotarDespacho(REFERENCIA, { estado: 'rechazada' });
  const revision = (await f.base.trabajos.leerTrabajoPrivado()).revision;
  await f.base.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionEsperada: revision },
    CONFIANZA_MANTENIMIENTO,
  );
  const antes = await f.base.trabajos.leerTrabajoPrivado();
  continuar.resolve();
  assert.equal((await pendiente).status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
});

test('retirar la reserva antes o durante JWKS impide que un workflow tardío inicie la copia', async (t) => {
  for (const durante of [false, true]) {
    const f = await fixture(t);
    const listo = Promise.withResolvers<void>();
    const continuar = Promise.withResolvers<void>();
    const recibir = f.crear(async (url, init) => {
      listo.resolve();
      await continuar.promise;
      return f.pedir(url, init);
    });
    const token = await f.firmar();
    const pendiente = durante ? recibir(peticion(token)) : null;
    if (durante) {
      await listo.promise;
    }
    const revision = (await f.base.trabajos.leerTrabajoPrivado()).revision;
    const retirada = await f.base.trabajos.retirarTrabajoDeSesion(ACCESO, {
      solicitudId: ID,
      revisionReserva: INICIO.revisionReserva,
      revisionEsperada: revision,
    });
    assert.equal(retirada.estado, 'retirado');
    const antes = await f.base.trabajos.leerTrabajoPrivado();
    continuar.resolve();
    assert.equal((await (pendiente ?? recibir(peticion(token)))).status, ESTADO_HTTP.conflicto);
    assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
    assert.equal(antes.ultimoTrabajo?.inicioConfirmado, false);
    assert.equal(f.contador.jwks, durante ? 1 : 0);
  }
});

test('retirada no confirma tarde ni cancela el vuelo JWKS compartido de otra petición', async (t) => {
  const f = await fixture(t);
  const listo = Promise.withResolvers<void>();
  const continuar = Promise.withResolvers<void>();
  const recibir = f.crear(async (url, init) => {
    listo.resolve();
    await continuar.promise;
    return f.pedir(url, init);
  });
  const token = await f.firmar();
  const control = new AbortController();
  const primera = recibir(peticion(token, INICIO, { signal: control.signal }));
  await listo.promise;
  const segunda = recibir(peticion(token));
  await new Promise<void>((resolver) => setImmediate(resolver));
  control.abort(new Error('retirada sintética'));
  await assert.rejects(primera, /retirada sintética/);
  assert.equal(f.contador.registros, 0);
  continuar.resolve();
  assert.equal((await segunda).status, ESTADO_HTTP.correcto);
  assert.equal(f.contador.registros, 1);
  assert.equal(f.contador.jwks, 1);
});

test('cuerpo bloqueado se cancela por retirada o plazo total sin consultar autoridad', async (t) => {
  const f = await fixture(t);
  const token = await f.firmar();
  for (const retirar of [true, false]) {
    let cancelado = false;
    const control = new AbortController();
    const cuerpo = new ReadableStream({
      cancel() {
        cancelado = true;
      },
    });
    const req = peticion(token, INICIO, { body: cuerpo, duplex: 'half', signal: control.signal });
    const pendiente = f.crear()(req);
    if (retirar) {
      control.abort();
      await assert.rejects(pendiente);
    } else {
      assert.equal((await pendiente).status, ESTADO_HTTP.tiempoAgotado);
    }
    assert.equal(cancelado, true);
  }
  assert.deepEqual(f.contador, { jwks: 0, registros: 0, lecturas: 0 });
});

test('fallo privado solo produce indisponible y ningún detalle ni inicio', async (t) => {
  const f = await fixture(t);
  const almacen = new Proxy(f.base.trabajos, {
    get(objeto, clave) {
      if (clave === 'leerTrabajoPrivado') {
        return async () => {
          throw new Error('secreto-no-reflejar');
        };
      }
      const valor = Reflect.get(objeto, clave);
      return typeof valor === 'function' ? valor.bind(objeto) : valor;
    },
  });
  const recibir = crearReceptorInicioActualizacion({ origen: ORIGEN, almacen, pedir: f.pedir });
  const respuesta = await recibir(peticion(await f.firmar()));
  assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await respuesta.json(), { error: 'no_disponible' });
  assert.equal(f.contador.jwks, 0);
});
