/** Lectura del registro mediante montaje real Node/DO; sin nube, credenciales ni efectos de despliegue. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type {
  EstadoActivacionPrivado,
  EvidenciaActivacion,
  PasoActivacion,
} from '../../src/administracion/activacion.ts';
import { leerEstadoActivacion } from '../../src/administracion/estado-activacion.js';
import { crearRouterAdministrativo, MAX_CUERPO_PANEL_BYTES, PLAZO_PANEL_MS } from '../../src/administracion/http.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import { sha256Hex } from '../../src/comun/huella.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import { montarAdministracion } from '../../src/plataforma/administracion.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.prueba';
const EMISOR = 'https://access.prueba';
const ID = '11111111-1111-4111-8111-111111111111';
const VERSION = '33333333-3333-4333-8333-333333333333';
const DESPLIEGUE = '44444444-4444-4444-8444-444444444444';
const VERSION_CURSOS = '55555555-5555-4555-8555-555555555555';
const DESPLIEGUE_CURSOS = '66666666-6666-4666-8666-666666666666';
const TAM_HASH = 64;
const TAM_SHA = 40;
const SEGUNDO = 1000;
const VALIDEZ_IDENTIDAD_S = 600;
const HTTP_OK = 200;
const HTTP_INVALIDO = 400;
const HTTP_SESION = 403;
const HTTP_PROHIBIDO = 403;
const HTTP_METODO = 405;
const HTTP_CONFLICTO = 409;
const HTTP_TIPO = 415;
const HTTP_NO_DISPONIBLE = 503;
const HTTP_PLAZO = 504;
const RUTAS_LECTURA_DURABLE = ['/panel/estado', '/activacion/leer', '/panel/estado'];
const POLITICA = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
} as const;
const CONFIANZA = {
  audiencia: `${ORIGEN}/mantenimiento/resultado`,
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const EVIDENCIA: EvidenciaActivacion = {
  sha256Indice: 'a'.repeat(TAM_HASH),
  sha256ManifiestoWeb: 'b'.repeat(TAM_HASH),
  generacion: { revisionCodigo: CONFIANZA.sha, sha256Manifiesto: 'c'.repeat(TAM_HASH) },
  artefacto: {
    revisionCodigo: CONFIANZA.sha,
    huellaPaquete: 'dddddddddddddddd',
    sha256Artefacto: 'e'.repeat(TAM_HASH),
  },
  anterior: { principal: { versionId: ID, deploymentId: VERSION }, cursos: { versionId: VERSION, deploymentId: ID } },
};
function identidad(): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  const ahora = Math.floor(Date.now() / SEGUNDO);
  return {
    ...pins,
    runId: '123',
    runAttempt: '1',
    jti: 'identidad-sintetica',
    emitidoEn: ahora,
    caducaEn: ahora + VALIDEZ_IDENTIDAD_S,
  };
}
const guardia = async (p: Request) =>
  p.headers.get('x-identidad-prueba') === 'si' ? principalDePrueba(EMISOR, 'persona') : null;
function peticion(token = '', cuerpo = '{}', cambios: RequestInit = {}, ruta = 'datos/activacion') {
  const headers = new Headers({
    origin: ORIGEN,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'x-faro-panel': '1',
    'x-faro-sesion': token,
    'x-identidad-prueba': 'si',
  });
  new Headers(cambios.headers).forEach((valor, clave) => {
    headers.set(clave, valor);
  });
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, { method: 'POST', body: cuerpo, ...cambios, headers });
}
function transaccion<T>(db: DatabaseSync, accion: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = accion();
    db.exec('COMMIT');
    return r;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function fixtureNode(t: TestContext) {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'panel-activacion-'));
  const archivo = join(carpeta, 'autoridad.sqlite');
  const backend = crearAlmacenPublicoNode({ archivo, maxClientes: 2 });
  const db = new DatabaseSync(archivo);
  t.after(() => {
    db.close();
    backend.close();
    rmSync(carpeta, { recursive: true });
  });
  return {
    db,
    sesion: backend.sesion,
    trabajos: backend.trabajos,
    activacion: backend.activacion,
    controles: backend,
    rutasDurables: [] as string[],
  };
}
function fixtureDurable(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: (accion) => transaccion(db, accion),
    },
  };
  const servidor = new AccesoPublicoDurable(estado, {});
  const rutasDurables: string[] = [];
  const backend = new SesionUnicaDurable({
    idFromName: (n) => n,
    get: () => ({
      fetch: (p: Request) => {
        rutasDurables.push(new URL(p.url).pathname);
        return servidor.fetch(p);
      },
    }),
  });
  return { db, sesion: backend, trabajos: backend, activacion: backend, controles: backend, rutasDurables };
}
// La comprobación de sesión registra solo su reloj antirretroceso; nunca renueva actividad.
function instantaneaDb(db: DatabaseSync) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((f) => {
      assert.ok(typeof f.name === 'string');
      const nombre = f.name;
      const filas = db.prepare(`SELECT * FROM ${nombre}`).all();
      if (nombre === 'administracion_sesion') {
        for (const fila of filas) {
          delete fila.reloj;
        }
      }
      return [nombre, filas];
    });
}
async function preparar(t: TestContext, durable = false, prepararRegistro = true) {
  const f = durable ? fixtureDurable(t) : fixtureNode(t);
  const { sesion, trabajos, activacion, controles } = f;
  await sesion.prepararPanel(POLITICA);
  if (prepararRegistro) {
    await trabajos.prepararTrabajos();
    await activacion.prepararActivacion();
  }
  const opciones = {
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    guardiaAdministrativa: guardia,
    almacen: controles,
    sesion,
    inicial: POLITICA,

    almacenActivacion: activacion,
    // La consulta no debe resolver configuración ni pedir tokens de actualización/activación.
    activacionHabilitada: () => {
      throw new Error('no invocar configuración de efectos');
    },
    actualizacion: {
      configuracion: (): never => {
        throw new Error('no invocar configuración GitHub');
      },
    },
  };
  const panel = await montarAdministracion(opciones);
  const abrir = async () => {
    const r = await panel.responder(peticion('', '{"retomar":true}', {}, 'sesion/abrir'));
    assert.equal(r.status, HTTP_OK);
    const o = (await r.json()) as { token: string };
    return o.token;
  };
  return { ...f, opciones, panel, abrir, instantanea: () => instantaneaDb(f.db) };
}
async function construir(f: Awaited<ReturnType<typeof preparar>>, token: string) {
  const acceso = { huellaSesion: sha256Hex(token), huellaPrincipal: sha256Hex(JSON.stringify([EMISOR, 'persona'])) };
  await f.trabajos.reservarTrabajoDeSesion(
    acceso,
    { solicitudId: ID, revisionEsperada: 0, accion: 'actualizar-datos' },
    CONFIANZA,
  );
  const referencia = { solicitudId: ID, revisionReserva: 1, accion: 'actualizar-datos' } as const;
  await f.trabajos.confirmarInicio(referencia, identidad());
  await f.trabajos.registrarRecibo(
    {
      ...referencia,
      resultado: 'validado',
      veredicto: 'verde',
      terminadoEn: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      huellaPaquete: EVIDENCIA.artefacto.huellaPaquete,
      error: null,
    },
    'f'.repeat(TAM_HASH),
    identidad(),
  );
  assert.equal(
    (
      await f.activacion.reservarActivacion(
        { solicitudId: ID, revisionReserva: 1, runId: '123', revisionEsperada: 0 },
        identidad(),
      )
    ).estado,
    'aplicado',
  );
}
async function avanzar(f: Awaited<ReturnType<typeof preparar>>, paso: PasoActivacion) {
  const revisionEsperada = (await f.activacion.leerActivacionPrivada()).revision;
  assert.equal(
    (
      await f.activacion.registrarPasoActivacion(
        { solicitudId: ID, revisionReserva: 1, runId: '123', revisionEsperada, paso },
        identidad(),
      )
    ).estado,
    'aplicado',
  );
}
async function consultar(f: Awaited<ReturnType<typeof preparar>>, token: string) {
  const r = await f.panel.responder(peticion(token));
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const cuerpo = (await r.json()) as Record<string, unknown>;
  return { r, cuerpo };
}

/** Una fase en curso o confirmada: sin abandono ni detención. */
const SIN_CIERRE = {
  motivoAbandono: null,
  reintento: null,
  datosSinPublicarDesde: null,
  cierre: null,
  motivoDetenida: null,
  servidoDetenida: null,
} as const;
async function comprobarRegistro(f: Awaited<ReturnType<typeof preparar>>, token: string, fase: string | undefined) {
  const privado = await f.activacion.leerActivacionPrivada(),
    antes = f.instantanea();
  const { r, cuerpo } = await consultar(f, token);
  assert.equal(r.status, HTTP_OK);
  const estado = leerEstadoActivacion(cuerpo.activacion),
    ultima = privado.ultimaActivacion;
  assert.ok(ultima);
  assert.deepEqual(estado, {
    version: 1,
    revision: privado.revision,
    ultimaActivacion: {
      solicitudId: ID,
      revisionReserva: 1,
      fase,
      dosServicios: Object.hasOwn(ultima, 'versionIdCursos'),
      ...SIN_CIERRE,
      creadoEn: ultima.creadoEn,
      actualizadoEn: ultima.actualizadoEn,
      versionId: ultima.versionId,
      deploymentId: ultima.deploymentId,
      error: null,
    },
  });
  assert.deepEqual(Object.keys(cuerpo).sort(), ['activacion', 'estado', 'sesion']);
  assert.deepEqual(f.instantanea(), antes);
  const texto = JSON.stringify(cuerpo);
  for (const secreto of [
    'confianza',
    'huellaRecibo',
    'evidencia',
    'workflowRef',
    'sha256',
    'jti',
    'huellaPrincipal',
    'huellaSesion',
    'Cursos',
    VERSION_CURSOS,
    DESPLIEGUE_CURSOS,
    token,
  ]) {
    assert.equal(texto.includes(secreto), false, secreto);
  }
}

for (const durable of [false, true]) {
  const motor = durable ? 'Worker/DO in-process' : 'Node SQLite';
  test(`${motor}: registro vacío y todas las fases se proyectan sin cambios ni privados`, async (t) => {
    const f = await preparar(t, durable),
      token = await f.abrir();
    const vacioAntes = f.instantanea();
    const vacio = await consultar(f, token);
    assert.equal(vacio.r.status, HTTP_OK);
    assert.deepEqual(vacio.cuerpo.activacion, { version: 1, revision: 0, ultimaActivacion: null });
    assert.deepEqual(f.instantanea(), vacioAntes);
    await construir(f, token);
    const pasos: (PasoActivacion | null)[] = [
      null,
      { tipo: 'preparar', evidencia: EVIDENCIA },
      { tipo: 'subiendo-cursos' },
      { tipo: 'cursos-subida', versionIdCursos: VERSION_CURSOS },
      { tipo: 'promoviendo-cursos' },
      { tipo: 'cursos-confirmado', versionIdCursos: VERSION_CURSOS, deploymentIdCursos: DESPLIEGUE_CURSOS },
      { tipo: 'subiendo' },
      { tipo: 'subida', versionId: VERSION },
      { tipo: 'promoviendo' },
      {
        tipo: 'confirmada',
        versionId: VERSION,
        deploymentId: DESPLIEGUE,
        sha256ManifiestoWeb: EVIDENCIA.sha256ManifiestoWeb,
      },
    ];
    // El panel ve cada fase de Cursos con los identificadores del principal todavía vacíos.
    const fases = [
      'reservada',
      'preparada',
      'subiendo-cursos',
      'cursos-subida',
      'promoviendo-cursos',
      'cursos-confirmado',
      'subiendo',
      'subida',
      'promoviendo',
      'confirmada',
    ];
    for (const [i, paso] of pasos.entries()) {
      if (paso) {
        await avanzar(f, paso);
      }
      await comprobarRegistro(f, token, fases[i]);
      if (durable) {
        assert.deepEqual(f.rutasDurables.slice(-RUTAS_LECTURA_DURABLE.length), RUTAS_LECTURA_DURABLE);
      }
    }
  });
  test(`${motor}: registro sin preparar o corrupto no se crea ni se fabrica vacío`, async (t) => {
    const f = await preparar(t, durable, false),
      token = await f.abrir(),
      antes = f.instantanea();
    assert.equal((await consultar(f, token)).r.status, HTTP_NO_DISPONIBLE);
    assert.deepEqual(f.instantanea(), antes);
    await f.trabajos.prepararTrabajos();
    await f.activacion.prepararActivacion();
    f.db.exec("UPDATE administracion_activacion SET documento='{}'");
    const corrupto = f.instantanea();
    const { r, cuerpo } = await consultar(f, token);
    assert.equal(r.status, HTTP_NO_DISPONIBLE);
    assert.deepEqual(cuerpo, { error: 'no_disponible' });
    assert.deepEqual(f.instantanea(), corrupto);
  });
  test(`${motor}: sustituir sesión durante lectura descarta datos observados`, async (t) => {
    const f = await preparar(t, durable),
      token = await f.abrir();
    const iniciado = Promise.withResolvers<void>(),
      salida = Promise.withResolvers<EstadoActivacionPrivado>();
    const router = crearRouterAdministrativo({
      origen: ORIGEN,
      almacen: f.sesion,
      guardiaAdministrativa: guardia,
      leerActivacion: async () => {
        const estado = await f.activacion.leerActivacionPrivada();
        iniciado.resolve();
        await salida.promise;
        return estado;
      },
    });
    const pendiente = router(peticion(token));
    await iniciado.promise;
    await f.abrir();
    salida.resolve({ version: 1, revision: 0, ultimaActivacion: null });
    const r = await pendiente;
    assert.equal(r.status, HTTP_CONFLICTO);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { error: 'sesion_sustituida' });
  });
}

test('ruta aplica origen, Access, token, cuerpo vacío y método antes de leer', async (t) => {
  const f = await preparar(t),
    token = await f.abrir();
  let lecturas = 0;
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen: f.sesion,
    guardiaAdministrativa: guardia,
    leerActivacion: async () => {
      lecturas++;
      return f.activacion.leerActivacionPrivada();
    },
  });
  const invalidas: [Request, number][] = [
    [peticion(token, '{}', { headers: { origin: 'https://ajeno.prueba' } }), HTTP_PROHIBIDO],
    [peticion(token, '{}', { headers: { 'x-faro-panel': '0' } }), HTTP_PROHIBIDO],
    [peticion(token, '{}', { headers: { 'sec-fetch-site': 'cross-site' } }), HTTP_PROHIBIDO],
    [peticion(token, '{}', { headers: { 'x-identidad-prueba': 'no' } }), HTTP_PROHIBIDO],
    [peticion(), HTTP_SESION],
    [peticion('token-invalido'), HTTP_SESION],
    [peticion(token, '{}', { headers: { 'content-type': 'text/plain' } }), HTTP_TIPO],
    [peticion(token, '{"activar":true}'), HTTP_INVALIDO],
    [peticion(token, 'null'), HTTP_INVALIDO],
    [peticion(token, '{'), HTTP_INVALIDO],
    [peticion(token, `${' '.repeat(MAX_CUERPO_PANEL_BYTES)}{}`), HTTP_INVALIDO],
    [peticion(token, '{}', {}, 'datos/activacion?x=1'), HTTP_INVALIDO],
    [peticion(token, '{}', { method: 'PUT' }), HTTP_METODO],
  ];
  for (const [p, esperado] of invalidas) {
    const r = await router(p);
    assert.equal(r.status, esperado);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(lecturas, 0);
  await f.abrir();
  assert.equal((await router(peticion(token))).status, HTTP_CONFLICTO);
  assert.equal(lecturas, 0);
});

test('ausencia de capacidad devuelve indisponibilidad manteniendo sesión y controles', async (t) => {
  const f = await preparar(t),
    token = await f.abrir();
  const router = crearRouterAdministrativo({ origen: ORIGEN, almacen: f.sesion, guardiaAdministrativa: guardia });
  const r = await router(peticion(token));
  assert.equal(r.status, HTTP_NO_DISPONIBLE);
  assert.deepEqual(await r.json(), { error: 'no_disponible' });
  const sinCapacidad = { ...f.opciones };
  delete (sinCapacidad as Partial<typeof sinCapacidad>).almacenActivacion;
  const montado = await montarAdministracion(sinCapacidad);
  assert.equal((await montado.responder(peticion(token))).status, HTTP_NO_DISPONIBLE);
  assert.equal((await montado.responder(peticion(token, '{}', {}, 'controles/leer'))).status, HTTP_OK);
});

test('cancelación y plazo no esperan al almacén ni entregan un resultado tardío', async (t) => {
  for (const plazo of [false, true]) {
    const f = await preparar(t),
      token = await f.abrir();
    const iniciado = Promise.withResolvers<void>(),
      salida = Promise.withResolvers<EstadoActivacionPrivado>();
    const router = crearRouterAdministrativo({
      origen: ORIGEN,
      almacen: f.sesion,
      guardiaAdministrativa: guardia,
      leerActivacion: async () => {
        iniciado.resolve();
        return salida.promise;
      },
    });
    const control = new AbortController();
    if (plazo) {
      t.mock.timers.enable({ apis: ['setTimeout'] });
    }
    const pendiente = router(peticion(token, '{}', { signal: control.signal }));
    await iniciado.promise;
    if (plazo) {
      t.mock.timers.tick(PLAZO_PANEL_MS);
    } else {
      control.abort();
    }
    const r = await pendiente;
    assert.equal(r.status, plazo ? HTTP_PLAZO : HTTP_INVALIDO);
    assert.deepEqual(await r.json(), { error: plazo ? 'tiempo_agotado' : 'solicitud_invalida' });
    salida.resolve({ version: 1, revision: 0, ultimaActivacion: null });
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (plazo) {
      t.mock.timers.reset();
    }
  }
});

test('sondear activación no renueva sesión; la expiración retira el acceso', async (t) => {
  const f = await preparar(t),
    token = await f.abrir();
  const fila = f.db.prepare('SELECT actividad FROM administracion_sesion').get();
  assert.ok(fila);
  const { cuerpo } = await consultar(f, token);
  assert.equal((cuerpo.sesion as { ultimaActividadEn: number }).ultimaActividadEn, fila.actividad);
  const viejo = Date.now() - INACTIVIDAD_SESION_PANEL_MS;
  f.db.prepare('UPDATE administracion_sesion SET iniciada=?,actividad=?').run(viejo, viejo);
  const r = await f.panel.responder(peticion(token));
  assert.equal(r.status, HTTP_SESION);
  assert.deepEqual(await r.json(), { error: 'sesion_inactiva' });
});

test('validador público cierra forma, fases, fechas, ids y accesores sin comparar revisiones de registros distintos', () => {
  const a = {
    solicitudId: ID,
    revisionReserva: 20,
    fase: 'confirmada',
    dosServicios: false,
    motivoAbandono: null,
    reintento: null,
    datosSinPublicarDesde: null,
    cierre: null,
    motivoDetenida: null,
    servidoDetenida: null,
    creadoEn: 1,
    actualizadoEn: 2,
    versionId: VERSION,
    deploymentId: DESPLIEGUE,
    error: null,
  };
  const estado = { version: 1, revision: 6, ultimaActivacion: a };
  const copia = leerEstadoActivacion(estado);
  assert.ok(Object.isFrozen(copia) && Object.isFrozen(copia.ultimaActivacion));
  for (const entrada of [
    { ...estado, revision: 0 },
    { ...estado, revision: -1 },
    { ...estado, version: 2 },
    { ...estado, extra: true },
    { ...estado, ultimaActivacion: null },
    ...[
      { ...a, fase: 'libre' },
      { ...a, actualizadoEn: 0 },
      { ...a, versionId: null },
      { ...a, deploymentId: null },
      { ...a, error: 'despliegue_no_admitido' },
      { ...a, solicitudId: 'otro' },
      { ...a, revisionReserva: 0 },
      { ...a, evidencia: {} },
      { ...a, dosServicios: 'si' },
      { ...a, motivoAbandono: 'a-mano' },
      { ...a, motivoDetenida: 'rechazo-previo' },
      { ...a, servidoDetenida: 'cambiado' },
      { ...a, fase: 'subiendo', versionId: null, deploymentId: null, motivoDetenida: 'libre' },
      { ...a, fase: 'abandonada', versionId: null, deploymentId: null },
      { ...a, fase: 'abandonada', versionId: null, deploymentId: null, motivoAbandono: 'libre' },
      // Datos sin publicar solo tras cerrar sin publicar o durante un reintento; nunca en una confirmada.
      { ...a, datosSinPublicarDesde: 1 },
      { ...a, reintento: 'previsto' },
      { ...a, reintento: true },
      { ...a, reintento: undefined },
      { ...a, dosServicios: undefined },
    ].map((ultimaActivacion) => ({ ...estado, ultimaActivacion })),
  ]) {
    assert.throws(() => leerEstadoActivacion(entrada));
  }
  let accesos = 0;
  const accessor = Object.defineProperty({ ...estado }, 'ultimaActivacion', {
    enumerable: true,
    get: () => {
      accesos++;
      return a;
    },
  });
  assert.throws(() => leerEstadoActivacion(accessor));
  assert.equal(accesos, 0);
  assert.throws(() => leerEstadoActivacion(Object.assign(Object.create({}), estado)));
  assert.throws(() => leerEstadoActivacion({ ...estado, [Symbol('extra')]: true }));
});

test('validación privada previa rechaza trabajo/evidencia corruptos sin proyectar sus fragmentos', async (t) => {
  const f = await preparar(t),
    token = await f.abrir();
  await construir(f, token);
  await avanzar(f, { tipo: 'preparar', evidencia: EVIDENCIA });
  const estado = await f.activacion.leerActivacionPrivada(),
    a = estado.ultimaActivacion;
  assert.ok(a);
  const invalidos = [
    { ...estado, revision: 0 },
    {
      ...estado,
      ultimaActivacion: {
        ...a,
        trabajo: { ...a.trabajo, confianza: { ...a.trabajo.confianza, sha: 'f'.repeat(TAM_SHA) } },
      },
    },
    {
      ...estado,
      ultimaActivacion: {
        ...a,
        evidencia: { ...EVIDENCIA, artefacto: { ...EVIDENCIA.artefacto, huellaPaquete: 'aaaaaaaaaaaaaaaa' } },
      },
    },
    { ...estado, ultimaActivacion: { ...a, trabajo: { ...a.trabajo, resultado: null } } },
    { ...estado, ultimaActivacion: { ...a, deploymentId: DESPLIEGUE } },
  ];
  for (const invalido of invalidos) {
    const router = crearRouterAdministrativo({
      origen: ORIGEN,
      almacen: f.sesion,
      guardiaAdministrativa: guardia,
      leerActivacion: async () => invalido as EstadoActivacionPrivado,
    });
    const r = await router(peticion(token));
    assert.equal(r.status, HTTP_NO_DISPONIBLE);
    assert.deepEqual(await r.json(), { error: 'no_disponible' });
  }
});

test('rechazo es un registro con error cerrado, sin identificadores de despliegue', async (t) => {
  const f = await preparar(t),
    token = await f.abrir();
  await construir(f, token);
  await avanzar(f, { tipo: 'rechazar', error: 'candidato_no_verificable' });
  const { r, cuerpo } = await consultar(f, token);
  assert.equal(r.status, HTTP_OK);
  const a = leerEstadoActivacion(cuerpo.activacion).ultimaActivacion;
  assert.equal(a?.fase, 'rechazada');
  assert.equal(a?.error, 'candidato_no_verificable');
  assert.equal(a?.versionId, null);
  assert.equal(a?.deploymentId, null);
});

test('validador público: las fases de Cursos llegan al panel sin identificadores del principal', () => {
  const base = {
    solicitudId: ID,
    revisionReserva: 20,
    dosServicios: true,
    motivoAbandono: null,
    reintento: null,
    datosSinPublicarDesde: null,
    cierre: null,
    motivoDetenida: null,
    servidoDetenida: null,
    creadoEn: 1,
    actualizadoEn: 2,
    error: null,
  };
  for (const fase of ['subiendo-cursos', 'cursos-subida', 'promoviendo-cursos', 'cursos-confirmado']) {
    const sin = { ...base, fase, versionId: null, deploymentId: null };
    assert.equal(leerEstadoActivacion({ version: 1, revision: 3, ultimaActivacion: sin }).ultimaActivacion?.fase, fase);
    for (const roto of [
      { ...sin, versionId: VERSION },
      { ...sin, deploymentId: DESPLIEGUE },
      // Las fases de Cursos solo existen en una activación de dos servicios.
      { ...sin, dosServicios: false },
    ]) {
      assert.throws(() => leerEstadoActivacion({ version: 1, revision: 3, ultimaActivacion: roto }));
    }
  }
});

test('validador público: una abandonada lleva su motivo y ningún identificador de versión', () => {
  const abandonada = {
    solicitudId: ID,
    revisionReserva: 20,
    fase: 'abandonada',
    dosServicios: true,
    motivoAbandono: 'rechazo-proveedor',
    reintento: null,
    datosSinPublicarDesde: 2,
    cierre: null,
    motivoDetenida: null,
    servidoDetenida: null,
    creadoEn: 1,
    actualizadoEn: 2,
    versionId: null,
    deploymentId: null,
    error: null,
  };
  const leido = leerEstadoActivacion({ version: 1, revision: 3, ultimaActivacion: abandonada });
  assert.equal(leido.ultimaActivacion?.motivoAbandono, 'rechazo-proveedor');
  assert.throws(() =>
    leerEstadoActivacion({ version: 1, revision: 3, ultimaActivacion: { ...abandonada, versionId: VERSION } }),
  );
});
