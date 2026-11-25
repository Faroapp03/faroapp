/** Frontera real + SQLite y JWT/JWKS sintéticos: sin secretos, cuentas o transporte externo. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { crearReceptorInicioActualizacion } from '../../src/administracion/inicio-actualizacion.ts';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { PLAZO_RESULTADO_MS } from '../../src/administracion/plazos-mantenimiento.ts';
import {
  crearReceptorResultadoActualizacion,
  MAX_RESULTADO_ACTUALIZACION_BYTES,
} from '../../src/administracion/resultado-actualizacion.ts';
import type { AlmacenTrabajosActualizacion } from '../../src/administracion/trabajos.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { PLAZO_CLIENTE_MS } from '../../src/plataforma/acceso-publico/durable-limites.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { ESPERA_CLAVES_MS } from '../../src/seguridad/jwt-rs256.ts';
import { catalogoPrivado } from '../ayudas/catalogo-privado.ts';
import { conDesafio } from '../ayudas/desafio.ts';
import { AHORA_OIDC, afirmacionesOidc } from '../ayudas/oidc-mantenimiento.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const VERSION_CATALOGO_PRIVADO = 3;
const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_VERSION = 16;
const PLAZO_FUENTE_DIAS = 30;
const RSA_BITS = 2048;
const TOKEN_CADUCADO_MS = 301_000;
const AHORA = AHORA_OIDC;
const ORIGEN = 'https://mantenimiento.example';
const URL_RECIBO = `${ORIGEN}/mantenimiento/resultado`;
const ID = '11111111-1111-4111-8111-111111111111';
const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: URL_RECIBO,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: 'a'.repeat(TAM_SHA),
  sha: 'b'.repeat(TAM_SHA),
};
const ESTADO = {
  version: 1,
  observadoEn: '2026-10-16T12:00:00Z',
  formacionAbiertaCaduca: null,
  fuentes: [{ id: 'fuente', politica: 'mensual', fecha: '2026-10-16', plazoDias: PLAZO_FUENTE_DIAS }],
  modulos: ['fuente', 'paquete'].map((id) => ({
    id,
    ultimoIntento: '2026-10-16T12:00:00Z',
    veredicto: 'verde',
    ultimaVersionBuena: { fecha: '2026-10-16T12:00:00Z', huella: 'c'.repeat(TAM_HUELLA) },
    fallos: 0,
    proximoReintento: null,
  })),
};
const RECIBO = {
  version: 1,
  solicitudId: ID,
  revisionReserva: 1,
  accion: 'actualizar-datos',
  resultado: 'validado',
  veredicto: 'verde',
  terminadoEn: '2026-10-16T12:00:00Z',
  estado: ESTADO,
  huellaPaquete: 'd'.repeat(TAM_VERSION),
  error: null,
};
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
    async firmar(contenido: Record<string, unknown> = afirmacionesOidc(CONFIANZA)) {
      const texto = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(contenido)).toString('base64url')}`;
      const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(texto));
      return `${texto}.${Buffer.from(firma).toString('base64url')}`;
    },
  };
}
const CRIPTO = claves();
async function confirmarInicio(
  almacen: AlmacenTrabajosActualizacion,
  inicio = { solicitudId: ID, revisionReserva: 1, accion: 'actualizar-datos' },
  confianza = CONFIANZA,
): Promise<void> {
  const cripto = await CRIPTO;
  const recibir = crearReceptorInicioActualizacion({
    origen: ORIGEN,
    almacen,
    pedir: async () => Response.json({ keys: [cripto.jwk] }),
    ahora: () => AHORA,
  });
  const respuesta = await recibir(
    new Request(`${ORIGEN}/mantenimiento/inicio`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await cripto.firmar(afirmacionesOidc(confianza))}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(inicio),
    }),
  );
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
}
function contarAlmacen(
  base: AlmacenTrabajosActualizacion,
  contador: { registros: number; lecturas: number },
): AlmacenTrabajosActualizacion {
  return new Proxy(base, {
    get(objeto, clave) {
      if (clave === 'registrarRecibo') {
        return (...args: Parameters<AlmacenTrabajosActualizacion['registrarRecibo']>) => {
          contador.registros++;
          return objeto.registrarRecibo(...args);
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
async function fixture(t: TestContext, accion = 'actualizar-datos', reservar = true, iniciar = true) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'resultado-actualizacion-'));
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
    await base.trabajos.reservarTrabajoDeSesion(ACCESO, { solicitudId: ID, accion, revisionEsperada: 0 }, CONFIANZA);
    if (iniciar) {
      await confirmarInicio(base.trabajos, { solicitudId: ID, revisionReserva: 1, accion });
    }
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
      crearReceptorResultadoActualizacion({ origen: ORIGEN, almacen, pedir: transporte, ahora: () => reloj.ahora }),
      'Bearer',
    );
  return { base, reloj, contador, pedir, crear, firmar: cripto.firmar };
}
function peticion(token: string, cuerpo: unknown = RECIBO, cambios: RequestInit = {}) {
  return new Request(URL_RECIBO, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    ...cambios,
  });
}

test('recibo privado firmado conserva datos en SQLite y entrega solo confirmación, sin instantánea ni pins', async (t) => {
  const f = await fixture(t);
  await f.base.sesion.cerrarSesion(ACCESO);
  const texto = JSON.stringify(RECIBO);
  const res = await f.crear()(peticion(await f.firmar(), texto));
  assert.equal(res.status, ESTADO_HTTP.correcto);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { estado: 'aplicado' });
  const trabajo = (await f.base.trabajos.leerTrabajoPrivado()).ultimoTrabajo;
  assert.equal(trabajo?.estado, 'terminado');
  assert.equal(trabajo?.runId, '789');
  assert.equal(trabajo?.huellaRecibo, createHash('sha256').update(texto).digest('hex'));
  assert.ok(!JSON.stringify(trabajo).includes('observadoEn'));
  const observacion = await f.base.trabajos.leerDatosDelUltimoTrabajo();
  assert.deepEqual(observacion?.datos, ESTADO);
  assert.equal(observacion?.huellaRecibo, trabajo?.huellaRecibo);
  assert.equal(observacion?.recibo.solicitudId, ID);
  assert.equal((await f.base.leerControles())?.revision, 0);
});

test('el cierre sin recibo llega por la misma ruta OIDC, guarda su porqué y rechaza lo que no es de su lista', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  const ultimoFallo = { causa: 'motor-terminado-por-senal', paso: 'motor' };
  const cierre = { solicitudId: ID, revisionReserva: 1, accion: 'actualizar-datos', ultimoFallo };
  const antes = await f.base.trabajos.leerTrabajoPrivado();
  for (const malo of [
    { ...cierre, mensaje: 'Killed' },
    { ...cierre, ultimoFallo: { causa: 'sin-resultado', paso: null } },
    { ...cierre, ultimoFallo: { ...ultimoFallo, paso: '/home/runner/work' } },
  ]) {
    assert.equal((await recibir(peticion(token, malo))).status, ESTADO_HTTP.solicitudIncorrecta);
  }
  assert.equal((await recibir(peticion(token, { ...cierre, solicitudId: OTRO_ID }))).status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
  assert.deepEqual(await (await recibir(peticion(token, cierre))).json(), { estado: 'aplicado' });
  const trabajo = (await f.base.trabajos.leerTrabajoPrivado()).ultimoTrabajo;
  assert.equal(trabajo?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.deepEqual(trabajo?.resultado?.ultimoFallo, ultimoFallo);
  assert.equal(trabajo?.huellaRecibo, null);
  assert.equal(f.contador.registros, 0);
  assert.deepEqual(await (await recibir(peticion(token, cierre))).json(), { estado: 'repetido' });
});

test('el mismo recibo válido exige confirmar inicio antes de admitir el resultado', async (t) => {
  const f = await fixture(t, 'actualizar-datos', true, false);
  const recibir = f.crear();
  const token = await f.firmar();
  const antes = await f.base.trabajos.leerTrabajoPrivado();
  assert.equal((await recibir(peticion(token))).status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
  await confirmarInicio(f.base.trabajos);
  assert.deepEqual(await (await recibir(peticion(token))).json(), { estado: 'aplicado' });
});

test('retry con mismo cuerpo es idempotente; cambiar texto o instantánea no reutiliza el resultado', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  assert.equal((await recibir(peticion(token))).status, ESTADO_HTTP.correcto);
  const antes = await f.base.trabajos.leerTrabajoPrivado();
  const datosAntes = await f.base.trabajos.leerDatosDelUltimoTrabajo();
  assert.deepEqual(datosAntes?.datos, ESTADO);
  assert.deepEqual(await (await recibir(peticion(token))).json(), { estado: 'repetido' });
  assert.deepEqual(await f.base.trabajos.leerDatosDelUltimoTrabajo(), datosAntes);
  assert.equal((await recibir(peticion(token, `${JSON.stringify(RECIBO)}\n`))).status, ESTADO_HTTP.conflicto);
  const otroEstado = { ...ESTADO, fuentes: [{ ...ESTADO.fuentes[0], fecha: '2026-10-15' }] };
  assert.equal((await recibir(peticion(token, { ...RECIBO, estado: otroEstado }))).status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
  assert.deepEqual(await f.base.trabajos.leerDatosDelUltimoTrabajo(), datosAntes);
  assert.equal(f.contador.jwks, 1);
});

test('el plazo del receptor cubre sus propias esperas: el almacén y las claves lentos no agotan un envío válido', async (t) => {
  // Lo que puede esperar en serie: una lectura y un registro en el almacén y la descarga de las claves.
  assert.ok(PLAZO_RESULTADO_MS > 2 * PLAZO_CLIENTE_MS + ESPERA_CLAVES_MS);
  const f = await fixture(t);
  // Ninguna espera llega a su tope, pero juntas pasan de los 5 s que tenía el receptor (ciclo 45636333502).
  const ESPERA_MS = 2600;
  const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, ESPERA_MS));
  const almacen = new Proxy(f.base.trabajos, {
    get(objeto, clave) {
      const valor = Reflect.get(objeto, clave);
      if (clave === 'leerTrabajoPrivado') {
        return async () => {
          await esperar();
          return objeto.leerTrabajoPrivado();
        };
      }
      return typeof valor === 'function' ? valor.bind(objeto) : valor;
    },
  });
  const pedirLento: typeof fetch = async (url, opciones) => {
    await esperar();
    return f.pedir(url, opciones);
  };
  const recibir = crearReceptorResultadoActualizacion({
    origen: ORIGEN,
    almacen,
    pedir: pedirLento,
    ahora: () => AHORA,
  });
  const rechazado = { ...RECIBO, resultado: 'rechazado', veredicto: 'rojo', huellaPaquete: null };
  const texto = JSON.stringify({ ...rechazado, error: 'actualizacion_no_admitida' });
  const respuesta = await recibir(peticion(await f.firmar(), texto));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await respuesta.json(), { estado: 'aplicado' });
  // Si esa respuesta no llega al job, reenviar los mismos bytes se reconoce, no se rechaza.
  assert.deepEqual(await (await f.crear()(peticion(await f.firmar(), texto))).json(), { estado: 'repetido' });
});

test('recibo OIDC rechazado con datos conserva la observación y admite reenvío tras el cierre explicativo', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  const rechazado = {
    ...RECIBO,
    resultado: 'rechazado',
    veredicto: 'rojo',
    huellaPaquete: null,
    error: 'actualizacion_no_admitida',
  };
  const texto = JSON.stringify(rechazado);
  assert.deepEqual(await (await recibir(peticion(token, texto))).json(), { estado: 'aplicado' });
  const observacion = await f.base.trabajos.leerDatosDelUltimoTrabajo();
  assert.deepEqual(observacion?.datos, ESTADO);
  const cierre = {
    solicitudId: ID,
    revisionReserva: RECIBO.revisionReserva,
    accion: RECIBO.accion,
    ultimoFallo: { causa: 'plazo-insuficiente', paso: 'paquete' },
  };
  assert.deepEqual(await (await recibir(peticion(token, cierre))).json(), { estado: 'aplicado' });
  const lectura = await f.base.trabajos.leerTrabajoDeSesion(ACCESO);
  assert.equal(lectura.estado, 'activa');
  assert.deepEqual(lectura.trabajos.ultimoTrabajo?.resultado?.ultimoFallo, cierre.ultimoFallo);
  assert.deepEqual(await f.base.sesion.leerDatosDelPanel(), { observacion, deLaActualizacionAnterior: false });
  assert.deepEqual(await (await recibir(peticion(token, texto))).json(), { estado: 'repetido' });
  assert.equal((await recibir(peticion(token, { ...rechazado, veredicto: 'ámbar' }))).status, ESTADO_HTTP.conflicto);
  assert.equal((await recibir(peticion(token, ` ${texto}`))).status, ESTADO_HTTP.conflicto);
});

test('formas de candidato sin-pendientes y rechazado conservan su semántica exacta', async (t) => {
  for (const cuerpo of [
    { ...RECIBO, accion: 'reintentar-pendientes', resultado: 'sin-pendientes', veredicto: null, huellaPaquete: null },
    {
      ...RECIBO,
      resultado: 'rechazado',
      veredicto: null,
      estado: null,
      huellaPaquete: null,
      error: 'actualizacion_no_completada',
    },
    {
      ...RECIBO,
      resultado: 'rechazado',
      veredicto: null,
      estado: null,
      huellaPaquete: null,
      error: 'candidato_no_verificable',
    },
    { ...RECIBO, resultado: 'rechazado', veredicto: 'rojo', huellaPaquete: null, error: 'actualizacion_no_admitida' },
  ]) {
    const f = await fixture(t, cuerpo.accion);
    assert.equal((await f.crear()(peticion(await f.firmar(), cuerpo))).status, ESTADO_HTTP.correcto);
    assert.equal((await f.base.trabajos.leerTrabajoPrivado()).ultimoTrabajo?.resultado?.resultado, cuerpo.resultado);
    const observacion = await f.base.trabajos.leerDatosDelUltimoTrabajo();
    assert.deepEqual(observacion?.datos ?? null, cuerpo.estado);
    if (observacion) {
      assert.equal(observacion.recibo.resultado, cuerpo.resultado);
      assert.equal(observacion.recibo.error, cuerpo.error);
    }
  }
});

test('configuración, ruta, método, tipos y cuerpo inválidos no piden JWKS ni registran', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  for (const origen of [
    'https://mantenimiento.example/',
    'https://u:p@mantenimiento.example',
    'http://mantenimiento.example',
  ]) {
    assert.throws(() => crearReceptorResultadoActualizacion({ origen, almacen: f.base.trabajos, pedir: f.pedir }));
  }
  for (const [req, estado] of [
    [new Request(`${URL_RECIBO}?x=1`, { method: 'POST' }), ESTADO_HTTP.noEncontrado],
    [new Request(URL_RECIBO), ESTADO_HTTP.metodoNoAdmitido],
    [peticion('', RECIBO), ESTADO_HTTP.noAutenticado],
    [
      peticion(token, RECIBO, { headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' } }),
      ESTADO_HTTP.tipoNoAdmitido,
    ],
    [peticion(token, '{'), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { ...RECIBO, extra: 'nunca-reflejar' }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, 'x'.repeat(MAX_RESULTADO_ACTUALIZACION_BYTES + 1)), ESTADO_HTTP.demasiadoGrande],
    [
      peticion(token, RECIBO, {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': String(MAX_RESULTADO_ACTUALIZACION_BYTES + 1),
        },
      }),
      ESTADO_HTTP.demasiadoGrande,
    ],
  ] as const) {
    const respuesta = await recibir(req);
    assert.equal(respuesta.status, estado);
    assert.ok(!(await respuesta.text()).includes('nunca-reflejar'));
  }
  assert.equal(f.contador.jwks, 0);
  assert.equal(f.contador.registros, 0);
});

test('esquemas incoherentes y tuplas ajenas fallan antes de verificar JWT', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  for (const delta of [
    { estado: null },
    { estado: { ...ESTADO, observadoEn: '2026-10-16T12:00:01Z' } },
    { estado: { ...ESTADO, modulos: ESTADO.modulos.slice(0, 1) } },
    { terminadoEn: '2026-02-30T12:00:00Z' },
    { error: 'detalle-libre' },
    { resultado: 'sin-pendientes', veredicto: null, huellaPaquete: null },
    { resultado: 'rechazado', error: 'actualizacion_no_completada', huellaPaquete: null },
  ]) {
    assert.equal((await recibir(peticion(token, { ...RECIBO, ...delta }))).status, ESTADO_HTTP.solicitudIncorrecta);
  }
  for (const delta of [
    { solicitudId: OTRO_ID },
    { revisionReserva: 2 },
    { accion: 'reintentar-pendientes' },
    { terminadoEn: '2026-10-16T12:00:31Z' },
  ]) {
    assert.equal((await recibir(peticion(token, { ...RECIBO, ...delta }))).status, ESTADO_HTTP.conflicto);
  }
  assert.equal(f.contador.jwks, 0);
  assert.equal(f.contador.registros, 0);
  const vacio = await fixture(t, 'actualizar-datos', false);
  assert.equal((await vacio.crear()(peticion(token))).status, ESTADO_HTTP.conflicto);
  assert.equal(vacio.contador.jwks, 0);
});

test('OIDC comprueba firma, pins, run, intento y vigencia en cada solicitud aunque JWKS esté cacheado', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  await f.base.trabajos.anotarDespacho({ solicitudId: ID, revisionReserva: 1 }, { estado: 'despachada', runId: '789' });
  for (const delta of [
    { iss: 'https://equipo.cloudflareaccess.com' },
    { aud: 'publica' },
    { sha: 'e'.repeat(TAM_SHA) },
    { run_id: '790' },
    { run_attempt: '2' },
    { exp: AHORA / MS_POR_SEGUNDO },
  ]) {
    assert.equal(
      (await recibir(peticion(await f.firmar({ ...afirmacionesOidc(CONFIANZA), ...delta })))).status,
      ESTADO_HTTP.noAutenticado,
    );
  }
  const token = await f.firmar();
  assert.equal((await recibir(peticion(token))).status, ESTADO_HTTP.correcto);
  f.reloj.ahora += TOKEN_CADUCADO_MS;
  assert.equal((await recibir(peticion(token))).status, ESTADO_HTTP.noAutenticado);
  assert.equal(f.contador.jwks, 1);
});

test('la correlación SQL rechaza un cambio de trabajo durante la espera de JWKS', async (t) => {
  const f = await fixture(t, 'actualizar-datos', true, false);
  const listo = Promise.withResolvers<void>();
  const continuar = Promise.withResolvers<void>();
  const recibir = f.crear(async (url, init) => {
    listo.resolve();
    await continuar.promise;
    return f.pedir(url, init);
  });
  const respuesta = recibir(peticion(await f.firmar()));
  await listo.promise;
  await f.base.trabajos.anotarDespacho({ solicitudId: ID, revisionReserva: 1 }, { estado: 'rechazada' });
  const revision = (await f.base.trabajos.leerTrabajoPrivado()).revision;
  await f.base.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionEsperada: revision },
    CONFIANZA,
  );
  const antes = await f.base.trabajos.leerTrabajoPrivado();
  continuar.resolve();
  assert.equal((await respuesta).status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
});

test('retirada de un receptor no autoriza una escritura tardía ni cancela el vuelo compartido de otro', async (t) => {
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
  const primera = recibir(peticion(token, RECIBO, { signal: control.signal }));
  await listo.promise;
  const segunda = recibir(peticion(token));
  await new Promise<void>((resolve) => setImmediate(resolve));
  control.abort(new Error('retirada sintética'));
  await assert.rejects(primera, /retirada sintética/);
  assert.equal(f.contador.registros, 0);
  continuar.resolve();
  assert.equal((await segunda).status, ESTADO_HTTP.correcto);
  assert.equal(f.contador.jwks, 1);
  assert.equal(f.contador.registros, 1);
});

test('cuerpo bloqueado se cancela por retirada o plazo total, sin consultas ni despacho', async (t) => {
  const f = await fixture(t);
  const token = await f.firmar();
  for (const retirar of [true, false]) {
    let cancelado = false;
    const control = new AbortController();
    const stream = new ReadableStream({
      cancel() {
        cancelado = true;
      },
    });
    const req = new Request(URL_RECIBO, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
      signal: control.signal,
    });
    const esperando = f.crear()(req);
    if (retirar) {
      control.abort();
      await assert.rejects(esperando);
    } else {
      assert.equal((await esperando).status, ESTADO_HTTP.tiempoAgotado);
    }
    assert.equal(cancelado, true);
  }
  assert.equal(f.contador.lecturas, 0);
  assert.equal(f.contador.jwks, 0);
  assert.equal(f.contador.registros, 0);
});

test('cambiar los pins del siguiente trabajo reemplaza el verificador sin reutilizar una autorización anterior', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const tokenViejo = await f.firmar();
  assert.equal((await recibir(peticion(tokenViejo))).status, ESTADO_HTTP.correcto);
  const revision = (await f.base.trabajos.leerTrabajoPrivado()).revision;
  const confianza = { ...CONFIANZA, sha: 'e'.repeat(TAM_SHA) };
  await f.base.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'actualizar-datos', revisionEsperada: revision },
    confianza,
  );
  const cuerpo = { ...RECIBO, solicitudId: OTRO_ID, revisionReserva: revision + 1 };
  await confirmarInicio(
    f.base.trabajos,
    { solicitudId: OTRO_ID, revisionReserva: revision + 1, accion: 'actualizar-datos' },
    confianza,
  );
  assert.equal((await recibir(peticion(tokenViejo, cuerpo))).status, ESTADO_HTTP.noAutenticado);
  const tokenNuevo = await f.firmar(afirmacionesOidc(confianza));
  assert.equal((await recibir(peticion(tokenNuevo, cuerpo))).status, ESTADO_HTTP.correcto);
  assert.equal(f.contador.jwks, 2);
});

test('UTF8 inválido se descarta antes de leer trabajo y un fallo de almacén no refleja errores privados', async (t) => {
  const f = await fixture(t);
  const token = await f.firmar();
  const BYTE_UTF8_INVALIDO = 255;
  const req = peticion(token, RECIBO, { body: Uint8Array.of(BYTE_UTF8_INVALIDO) });
  assert.equal((await f.crear()(req)).status, ESTADO_HTTP.solicitudIncorrecta);
  assert.equal(f.contador.lecturas, 0);
  const almacen = new Proxy(f.base.trabajos, {
    get(objeto, clave) {
      if (clave === 'leerTrabajoPrivado') {
        return async () => {
          throw new Error('detalle-privado-nunca-reflejar');
        };
      }
      const valor = Reflect.get(objeto, clave);
      return typeof valor === 'function' ? valor.bind(objeto) : valor;
    },
  });
  const recibir = crearReceptorResultadoActualizacion({ origen: ORIGEN, almacen, pedir: f.pedir });
  const respuesta = await recibir(peticion(token));
  assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await respuesta.json(), { error: 'no_disponible' });
  assert.equal(f.contador.jwks, 0);
});

test('recibo v3 autentica y conserva proyección privada; el replay no reescribe ni publica', async (t) => {
  const f = await fixture(t);
  const cuerpo = { ...RECIBO, version: VERSION_CATALOGO_PRIVADO, catalogo: catalogoPrivado() };
  const texto = JSON.stringify(cuerpo);
  const token = await f.firmar();
  const receptor = f.crear();
  assert.equal((await receptor(peticion(token, texto))).status, ESTADO_HTTP.correcto);
  const observacion = await f.base.trabajos.leerDatosDelUltimoTrabajo();
  assert.equal(observacion?.version, 2);
  assert.deepEqual(observacion?.catalogo, cuerpo.catalogo);
  assert.equal(observacion?.huellaRecibo, createHash('sha256').update(texto).digest('hex'));
  assert.deepEqual(await (await receptor(peticion(await f.firmar(), texto))).json(), { estado: 'repetido' });
  assert.deepEqual(await f.base.trabajos.leerDatosDelUltimoTrabajo(), observacion);
});
