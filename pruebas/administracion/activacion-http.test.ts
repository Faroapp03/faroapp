/** Frontera real + SQLite y JWT/JWKS sintéticos: sin secretos, cuentas o transporte externo. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { leerResultadoTransicionActivacion } from '../../src/administracion/activacion.ts';
import { crearReceptorActivacion, MAX_ACTIVACION_BYTES } from '../../src/administracion/activacion-http.ts';
import { admiteCierreActivacion } from '../../src/administracion/cierre-activacion.ts';
import { configuracionActivacionDiferida } from '../../src/administracion/configuracion-activacion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { montarAdministracion } from '../../src/plataforma/administracion.ts';
import { conDesafio } from '../ayudas/desafio.ts';
import {
  AHORA_OIDC,
  afirmacionesOidc,
  CONFIANZA_MANTENIMIENTO,
  ORIGEN_MANTENIMIENTO,
  VIDA_TOKEN_OIDC_S,
} from '../ayudas/oidc-mantenimiento.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const TAM_SHA = 40;
const TAM_PAQUETE = 16;
const RSA_BITS = 2048;
const BYTE_UTF8_INVALIDO = 255;
const TOKEN_CADUCADO_MS = 301_000;
const AHORA = AHORA_OIDC;
const ORIGEN = ORIGEN_MANTENIMIENTO;
const URL_ACTIVACION = `${ORIGEN}/mantenimiento/activacion`;
const ID = '11111111-1111-4111-8111-111111111111';
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const REFERENCIA = { solicitudId: ID, revisionReserva: 1 };
const SOLICITUD = { ...REFERENCIA, runId: '789', revisionEsperada: 0 };
const RESERVAR = { operacion: 'reservar', solicitud: SOLICITUD };
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
async function prepararTrabajo(base: ReturnType<typeof crearAlmacenPublicoNode>) {
  await base.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA_MANTENIMIENTO,
  );
  const { audiencia: _audiencia, ...pins } = CONFIANZA_MANTENIMIENTO;
  const identidad = {
    ...pins,
    runId: '789',
    runAttempt: '1',
    jti: 'sintetico',
    emitidoEn: AHORA / MS_POR_SEGUNDO,
    caducaEn: AHORA / MS_POR_SEGUNDO + VIDA_TOKEN_OIDC_S,
  };
  await base.trabajos.confirmarInicio({ ...REFERENCIA, accion: 'actualizar-datos' }, identidad);
  await base.trabajos.registrarRecibo(
    {
      ...REFERENCIA,
      accion: 'actualizar-datos',
      resultado: 'validado',
      veredicto: 'verde',
      terminadoEn: '2026-10-16T12:00:00Z',
      huellaPaquete: 'c'.repeat(TAM_PAQUETE),
      error: null,
    },
    'd'.repeat(TAM_HUELLA),
    identidad,
  );
}
async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'activacion-http-'));
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
  const inicial = {
    version: 2 as const,
    api: 'deshabilitada' as const,
    mcp: false,
    a2a: false,
  };
  await base.sesion.prepararPanel(inicial);
  await abrirSesionDePrueba(base.sesion, ACCESO);
  await base.trabajos.prepararTrabajos();
  await base.activacion.prepararActivacion();
  await prepararTrabajo(base);
  const cripto = await CRIPTO;
  const contador = { jwks: 0 };
  const pedir: typeof fetch = async (url, opciones) => {
    contador.jwks++;
    assert.equal(String(url), 'https://token.actions.githubusercontent.com/.well-known/jwks');
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    return Response.json({ keys: [cripto.jwk] });
  };
  const crear = (transporte = pedir) =>
    conDesafio(
      crearReceptorActivacion({
        origen: ORIGEN,
        almacen: base.activacion,
        confianza: CONFIANZA_MANTENIMIENTO,
        pedir: transporte,
        ahora: () => reloj.ahora,
      }),
      'Bearer',
    );
  return { base, reloj, contador, crear, pedir, firmar: cripto.firmar, inicial };
}
function peticion(token: string, cuerpo: unknown = RESERVAR, cambios: RequestInit = {}) {
  return new Request(URL_ACTIVACION, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    ...cambios,
  });
}

test('HTTP y SQLite fijan candidato exacto; repetición y CAS ajeno nunca dan otro permiso', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  const antes = await f.base.trabajos.leerTrabajoPrivado();
  const leido = await recibir(peticion(token, { operacion: 'leer' }));
  assert.equal(leido.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await leido.json(), {
    estado: 'leido',
    activacion: { version: 1, revision: 0, ultimaActivacion: null },
  });
  const reserva = leerResultadoTransicionActivacion(await (await recibir(peticion(token))).json());
  assert.equal(reserva.estado, 'aplicado');
  assert.deepEqual(reserva.activacion.ultimaActivacion?.trabajo, antes.ultimoTrabajo);
  assert.equal(leerResultadoTransicionActivacion(await (await recibir(peticion(token))).json()).estado, 'repetido');
  assert.equal(
    leerResultadoTransicionActivacion(
      await (await recibir(peticion(token, { ...RESERVAR, solicitud: { ...SOLICITUD, revisionEsperada: 2 } }))).json(),
    ).estado,
    'conflicto',
  );
  const paso = {
    operacion: 'paso',
    solicitud: { ...SOLICITUD, revisionEsperada: 1, paso: { tipo: 'rechazar', error: 'candidato_no_verificable' } },
  };
  assert.equal(
    leerResultadoTransicionActivacion(await (await recibir(peticion(token, paso))).json()).estado,
    'aplicado',
  );
  assert.equal(
    leerResultadoTransicionActivacion(await (await recibir(peticion(token, paso))).json()).estado,
    'repetido',
  );
  assert.deepEqual(await f.base.trabajos.leerTrabajoPrivado(), antes);
});

test('frontera exacta y cuerpo cerrado rechazan aliases, órdenes y entradas excesivas sin consultar JWKS', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  const token = await f.firmar();
  for (const [req, estado] of [
    [new Request(`${URL_ACTIVACION}?x=1`, { method: 'POST' }), ESTADO_HTTP.noEncontrado],
    [new Request(URL_ACTIVACION), ESTADO_HTTP.metodoNoAdmitido],
    [peticion(''), ESTADO_HTTP.noAutenticado],
    [
      peticion(token, RESERVAR, { headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' } }),
      ESTADO_HTTP.tipoNoAdmitido,
    ],
    [peticion(token, '{'), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { operacion: 'leer', extra: true }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { operacion: 'ejecutar-shell', solicitud: SOLICITUD }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, { ...RESERVAR, solicitud: { ...SOLICITUD, runId: '' } }), ESTADO_HTTP.solicitudIncorrecta],
    [peticion(token, 'x'.repeat(MAX_ACTIVACION_BYTES + 1)), ESTADO_HTTP.demasiadoGrande],
    [peticion(token, RESERVAR, { body: Uint8Array.of(BYTE_UTF8_INVALIDO) }), ESTADO_HTTP.solicitudIncorrecta],
  ] as const) {
    assert.equal((await recibir(req)).status, estado);
  }
  assert.equal(f.contador.jwks, 0);
  assert.equal((await f.base.activacion.leerActivacionPrivada()).revision, 0);
});

test('Access, pins distintos, otro run, intento dos y caducidad no autorizan una activación', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  for (const delta of [
    { iss: 'https://equipo.cloudflareaccess.com' },
    { aud: URL_ACTIVACION },
    { sha: 'e'.repeat(TAM_SHA) },
    { workflow_sha: 'e'.repeat(TAM_SHA) },
    { run_id: '790' },
    { run_attempt: '2' },
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
  assert.equal((await f.base.activacion.leerActivacionPrivada()).revision, 1);
});

test('cancelación durante JWKS no escribe tarde ni cancela el verificador compartido', async (t) => {
  const f = await fixture(t);
  const esperando = Promise.withResolvers<void>();
  const continuar = Promise.withResolvers<void>();
  const recibir = f.crear(async (url, init) => {
    esperando.resolve();
    await continuar.promise;
    return f.pedir(url, init);
  });
  const token = await f.firmar();
  const control = new AbortController();
  const pendiente = recibir(peticion(token, RESERVAR, { signal: control.signal }));
  await esperando.promise;
  control.abort();
  await assert.rejects(pendiente);
  continuar.resolve();
  await new Promise<void>((resolver) => setImmediate(resolver));
  assert.equal((await f.base.activacion.leerActivacionPrivada()).revision, 0);
  assert.equal(leerResultadoTransicionActivacion(await (await recibir(peticion(token))).json()).estado, 'aplicado');
});

test('un reintento firmado observa la activación existente solo por el modo explícito de recuperación', async (t) => {
  const f = await fixture(t);
  const recibir = f.crear();
  await recibir(peticion(await f.firmar()));
  const antes = await f.base.activacion.leerActivacionPrivada();
  const token = await f.firmar({ ...afirmacionesOidc(CONFIANZA_MANTENIMIENTO), run_attempt: '2' });
  const respuesta = await recibir(peticion(token, { operacion: 'leer-recuperacion' }));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await respuesta.json(), { estado: 'leido', activacion: antes });
  assert.deepEqual(await f.base.activacion.leerActivacionPrivada(), antes);
  assert.equal((await recibir(peticion(token, { operacion: 'leer' }))).status, ESTADO_HTTP.noAutenticado);
});

test('flag optativo y errores de activación no bloquean el panel ni las consultas', async (t) => {
  assert.equal(configuracionActivacionDiferida({}), undefined);
  assert.equal(configuracionActivacionDiferida({ FARO_ACTIVACION_AUTOMATICA: 'no' }), undefined);
  assert.equal(configuracionActivacionDiferida({ FARO_ACTIVACION_AUTOMATICA: 'si' })?.(), true);
  const invalida = configuracionActivacionDiferida({ FARO_ACTIVACION_AUTOMATICA: 'sí' });
  assert.ok(invalida);
  assert.throws(invalida);
  const f = await fixture(t);
  const opciones = {
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    guardiaAdministrativa: async () => null,
    almacen: f.base,
    sesion: f.base.sesion,
    trabajos: f.base.trabajos,
    almacenActivacion: f.base.activacion,
    inicial: f.inicial,
  };
  const base = await montarAdministracion(opciones);
  assert.equal(base.recibirActivacion, undefined);
  const panel = await montarAdministracion({ ...opciones, activacionHabilitada: invalida });
  const antes = await panel.leerControles(new AbortController().signal);
  await assert.rejects(panel.recibirActivacion?.(peticion(await f.firmar())) ?? Promise.resolve());
  assert.deepEqual(await panel.leerControles(new AbortController().signal), antes);
});

function receptorRecuperacion(f: Awaited<ReturnType<typeof fixture>>) {
  const consultas: string[] = [];
  const prueba = { completada: false };
  const receptor = crearReceptorActivacion({
    origen: ORIGEN,
    almacen: f.base.activacion,
    confianza: CONFIANZA_MANTENIMIENTO,
    pedir: f.pedir,
    ahora: () => f.reloj.ahora,
    consultarIntento: async (trabajo, intento) => {
      consultas.push(intento);
      assert.equal(trabajo.runAttempt, '1');
      return prueba.completada
        ? {
            estado: 'completada',
            evidencia: {
              estado: 'completed',
              evento: 'workflow_dispatch',
              runId: '789',
              runAttempt: intento,
              repositorioId: CONFIANZA_MANTENIMIENTO.repositorioId,
              propietarioId: CONFIANZA_MANTENIMIENTO.propietarioId,
              sha: CONFIANZA_MANTENIMIENTO.sha,
              workflowPath: '.github/workflows/actualizar.yml',
              conclusion: 'failure',
            },
          }
        : { estado: 'en-curso' };
    },
  });
  return { recibir: conDesafio(receptor, 'Bearer'), consultas, prueba };
}

test('recuperación HTTP requiere evidencia del intento anterior y solo entonces cerca la escritura original', async (t) => {
  const f = await fixture(t);
  const original = await f.firmar();
  const token2 = await f.firmar({ ...afirmacionesOidc(CONFIANZA_MANTENIMIENTO), run_attempt: '2' });
  await f.crear()(peticion(original));
  const { recibir, consultas, prueba } = receptorRecuperacion(f);
  const solicitud = { ...SOLICITUD, revisionEsperada: 1 };
  const antes = await f.base.activacion.leerActivacionPrivada();
  assert.equal(
    (await recibir(peticion(token2, { operacion: 'recuperar', solicitud }))).status,
    ESTADO_HTTP.noDisponible,
  );
  assert.deepEqual(await f.base.activacion.leerActivacionPrivada(), antes);
  prueba.completada = true;
  const concedida = leerResultadoTransicionActivacion(
    await (await recibir(peticion(token2, { operacion: 'recuperar', solicitud }))).json(),
  );
  assert.equal(concedida.estado, 'aplicado');
  assert.deepEqual(consultas, ['1', '1']);
  assert.deepEqual(concedida.activacion.ultimaActivacion?.trabajo, antes.ultimaActivacion?.trabajo);
  assert.equal(
    (await recibir(peticion(original, { operacion: 'recuperar', solicitud }))).status,
    ESTADO_HTTP.noAutenticado,
  );
  assert.equal(
    (await recibir(peticion(token2, { operacion: 'reservar', solicitud }))).status,
    ESTADO_HTTP.noAutenticado,
  );
  const registro = { ...SOLICITUD, revisionEsperada: 2, paso: { tipo: 'rechazar', error: 'candidato_no_verificable' } };
  const cercada = leerResultadoTransicionActivacion(
    await (await recibir(peticion(original, { operacion: 'paso', solicitud: registro }))).json(),
  );
  assert.equal(cercada.estado, 'conflicto');
  const cierre = leerResultadoTransicionActivacion(
    await (await recibir(peticion(token2, { operacion: 'paso-recuperacion', solicitud: registro }))).json(),
  );
  assert.equal(cierre.estado, 'aplicado');
});

const OTRO_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ANTERIOR = '33333333-3333-4333-8333-333333333333';
const ANTERIOR_DOS = {
  principal: { versionId: VERSION_ANTERIOR, deploymentId: VERSION_ANTERIOR },
  cursos: { versionId: ID, deploymentId: ID },
};
const HORA_MS = 3_600_000;
/** Detiene la intención del run 789, anota el cierre y deja confirmado el inicio del trabajo despachado (run 790). */
async function cierrePedido(f: Awaited<ReturnType<typeof fixture>>, recibir: (p: Request) => Promise<Response>) {
  const original = await f.firmar();
  await recibir(peticion(original));
  const evidencia = {
    sha256Indice: 'a'.repeat(TAM_HUELLA),
    sha256ManifiestoWeb: 'b'.repeat(TAM_HUELLA),
    generacion: { revisionCodigo: CONFIANZA_MANTENIMIENTO.sha, sha256Manifiesto: 'c'.repeat(TAM_HUELLA) },
    artefacto: {
      revisionCodigo: CONFIANZA_MANTENIMIENTO.sha,
      huellaPaquete: 'c'.repeat(TAM_PAQUETE),
      sha256Artefacto: 'e'.repeat(TAM_HUELLA),
    },
    anterior: ANTERIOR_DOS,
  };
  for (const [revisionEsperada, p] of [
    [1, { tipo: 'preparar', evidencia }],
    [2, { tipo: 'subiendo-cursos' }],
  ] as const) {
    await recibir(peticion(original, { operacion: 'paso', solicitud: { ...SOLICITUD, revisionEsperada, paso: p } }));
  }
  const revisionTrabajos = (await f.base.trabajos.leerTrabajoPrivado()).revision;
  const trabajo = { solicitudId: OTRO_ID, revisionReserva: revisionTrabajos + 1 };
  const almacen = f.base.activacion;
  assert.ok(admiteCierreActivacion(almacen));
  const anotado = await almacen.solicitarCierreActivacion({
    revisionEsperada: 3,
    trabajo,
    caducaEn: AHORA + HORA_MS,
  });
  assert.equal(anotado.estado, 'aplicado');
  await f.base.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO_ID, accion: 'reintentar-pendientes', revisionEsperada: revisionTrabajos },
    CONFIANZA_MANTENIMIENTO,
  );
  await f.base.trabajos.anotarDespacho(trabajo, { estado: 'despachada', runId: '790' });
  const { audiencia: _audiencia, ...pins } = CONFIANZA_MANTENIMIENTO;
  const identidad = {
    ...pins,
    runId: '790',
    runAttempt: '1',
    jti: 'sintetico',
    emitidoEn: AHORA / MS_POR_SEGUNDO,
    caducaEn: AHORA / MS_POR_SEGUNDO + VIDA_TOKEN_OIDC_S,
  };
  await f.base.trabajos.confirmarInicio({ ...trabajo, accion: 'reintentar-pendientes' }, identidad);
  return { original, trabajo };
}

/** GitHub simulado: la ejecución de la activación (run 789) sigue en marcha hasta que la prueba la da por terminada. */
function finConsultado(fin: { completada: boolean }) {
  return async (trabajo: { runId: string | null }) => {
    assert.equal(trabajo.runId, '789');
    return fin.completada
      ? ({
          estado: 'completada',
          evidencia: {
            estado: 'completed',
            evento: 'workflow_dispatch',
            runId: '789',
            runAttempt: '1',
            repositorioId: CONFIANZA_MANTENIMIENTO.repositorioId,
            propietarioId: CONFIANZA_MANTENIMIENTO.propietarioId,
            sha: CONFIANZA_MANTENIMIENTO.sha,
            workflowPath: '.github/workflows/actualizar.yml',
            conclusion: 'failure',
          },
        } as const)
      : ({ estado: 'en-curso' } as const);
  };
}
test('cerrar-solicitado por HTTP: OIDC de la ejecución despachada y GitHub consultado por el servidor', async (t) => {
  const f = await fixture(t);
  const fin = { completada: false };
  const receptor = conDesafio(
    crearReceptorActivacion({
      origen: ORIGEN,
      almacen: f.base.activacion,
      confianza: CONFIANZA_MANTENIMIENTO,
      pedir: f.pedir,
      ahora: () => f.reloj.ahora,
      consultarFin: finConsultado(fin),
    }),
    'Bearer',
  );
  const { original, trabajo } = await cierrePedido(f, receptor);
  const despachada = await f.firmar({ ...afirmacionesOidc(CONFIANZA_MANTENIMIENTO), run_id: '790' });
  const solicitud = { ...trabajo, runId: '790', revisionEsperada: 4, observado: ANTERIOR_DOS };
  const cerrar = (token: string, cuerpo: unknown = { operacion: 'cerrar-solicitado', solicitud }) =>
    receptor(peticion(token, cuerpo));
  // La ejecución original no puede cumplir un cierre que no es suyo.
  assert.equal((await cerrar(original)).status, ESTADO_HTTP.noAutenticado);
  // Campos de más: la operación no se lee.
  const extra = { operacion: 'cerrar-solicitado', solicitud: { ...solicitud, paso: { tipo: 'abandonar' } } };
  assert.equal((await cerrar(despachada, extra)).status, ESTADO_HTTP.solicitudIncorrecta);
  // Con la ejecución de la activación todavía en marcha según GitHub, no se escribe nada.
  const antes = await f.base.activacion.leerActivacionPrivada();
  assert.equal((await cerrar(despachada)).status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await f.base.activacion.leerActivacionPrivada(), antes);
  fin.completada = true;
  const cerrada = leerResultadoTransicionActivacion(await (await cerrar(despachada)).json());
  assert.deepEqual([cerrada.estado, cerrada.activacion.ultimaActivacion?.fase], ['aplicado', 'abandonada']);
});
