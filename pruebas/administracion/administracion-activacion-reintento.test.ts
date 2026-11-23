/** Reintento de una abandonada por `rechazo-previo` en la autoridad SQLite real, sin red ni Cloudflare. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type {
  EvidenciaActivacion,
  MotivoAbandono,
  PasoActivacion,
  SolicitudActivacion,
  SolicitudReintentoActivacion,
} from '../../src/administracion/activacion.ts';
import { activacionObservada } from '../../src/administracion/activacion-observada.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { evaluarVigilante } from '../../src/administracion/vigilante.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';
import { CONFIG_VIGILANTE, entradasVigilante, PROGRAMADA_VIGILANTE } from '../ayudas/vigilante.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const TERCERO = '77777777-7777-4777-8777-777777777777';
const VERSION = '33333333-3333-4333-8333-333333333333';
const DESPLIEGUE = '44444444-4444-4444-8444-444444444444';
const HASH = 64;
const SHA = 40;
const SEGUNDO = 1000;
const VALIDEZ_S = 600;
const TAM_PAQUETE = 16;
const ACCESO = { huellaSesion: 'a'.repeat(HASH), huellaPrincipal: 'b'.repeat(HASH) };
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(SHA),
  workflowSha: 'b'.repeat(SHA),
};
const ANTERIOR = { principal: { versionId: ID, deploymentId: OTRO }, cursos: { versionId: OTRO, deploymentId: ID } };
const EVIDENCIA: EvidenciaActivacion = {
  sha256Indice: 'a'.repeat(HASH),
  sha256ManifiestoWeb: 'b'.repeat(HASH),
  generacion: { revisionCodigo: CONFIANZA.sha, sha256Manifiesto: 'c'.repeat(HASH) },
  artefacto: {
    revisionCodigo: CONFIANZA.sha,
    huellaPaquete: 'd'.repeat(TAM_PAQUETE),
    sha256Artefacto: 'e'.repeat(HASH),
  },
  anterior: ANTERIOR,
};
const HUELLA_VALIDADO = 'f'.repeat(HASH);

/** Todos los pasos de una publicación de dos servicios, hasta confirmarla. */
const PUBLICAR_TODO = [
  { tipo: 'preparar', evidencia: EVIDENCIA },
  { tipo: 'subiendo-cursos' },
  { tipo: 'cursos-subida', versionIdCursos: VERSION },
  { tipo: 'promoviendo-cursos' },
  { tipo: 'cursos-confirmado', versionIdCursos: VERSION, deploymentIdCursos: DESPLIEGUE },
  { tipo: 'subiendo' },
  { tipo: 'subida', versionId: VERSION },
  { tipo: 'promoviendo' },
  {
    tipo: 'confirmada',
    versionId: VERSION,
    deploymentId: DESPLIEGUE,
    sha256ManifiestoWeb: EVIDENCIA.sha256ManifiestoWeb,
  },
] as const;

function identidad(runId: string): IdentidadEjecucionGitHub {
  const { audiencia: _audiencia, ...pins } = CONFIANZA;
  const ahora = Math.floor(Date.now() / SEGUNDO);
  return { ...pins, runId, runAttempt: '1', jti: 'identidad-sintetica', emitidoEn: ahora, caducaEn: ahora + VALIDEZ_S };
}
function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (q, ...v) => db.prepare(q).all(...v),
    ejecutar: (q, ...v) => {
      db.prepare(q).run(...v);
    },
    transaccion: (accion) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const valor = accion();
        db.exec('COMMIT');
        return valor;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  // El almacén público crea la tabla de metadatos que comparten trabajos y activación.
  new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  t.after(() => db.close());
  return new AlmacenSesionPanelSqlite(sql);
}
type Backend = ReturnType<typeof fixture>;
async function preparar(backend: Backend) {
  await backend.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  await abrirSesionDePrueba(backend, ACCESO);
}
/** Un trabajo terminado con su inicio confirmado: validado con paquete nuevo, o sin pendientes. */
async function trabajo(backend: Backend, solicitudId: string, runId: string, validado: boolean) {
  const accion = validado ? 'actualizar-datos' : 'reintentar-pendientes';
  const revisionEsperada = (await backend.leerTrabajoPrivado()).revision;
  const reserva = await backend.reservarTrabajoDeSesion(ACCESO, { solicitudId, revisionEsperada, accion }, CONFIANZA);
  assert.ok('trabajos' in reserva && reserva.trabajos.ultimoTrabajo);
  const referencia = { solicitudId, revisionReserva: reserva.trabajos.ultimoTrabajo.revisionReserva };
  await backend.confirmarInicio({ ...referencia, accion }, identidad(runId));
  const recibo = await backend.registrarRecibo(
    {
      ...referencia,
      accion,
      resultado: validado ? 'validado' : 'sin-pendientes',
      veredicto: validado ? 'verde' : null,
      terminadoEn: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      huellaPaquete: validado ? EVIDENCIA.artefacto.huellaPaquete : null,
      error: null,
    },
    validado ? HUELLA_VALIDADO : 'e'.repeat(HASH),
    identidad(runId),
  );
  assert.equal(recibo.estado, 'aplicado');
  return { ...referencia, runId };
}
async function paso(backend: Backend, p: PasoActivacion, referencia: Omit<SolicitudActivacion, 'revisionEsperada'>) {
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  return backend.registrarPasoActivacion({ ...referencia, revisionEsperada, paso: p }, identidad(referencia.runId));
}
/** Reserva, prepara y cierra sin publicar la intención del trabajo validado, con el motivo indicado. */
async function abandonada(backend: Backend, motivo: MotivoAbandono) {
  const validado = await trabajo(backend, ID, '123', true);
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  assert.equal(
    (await backend.reservarActivacion({ ...validado, revisionEsperada }, identidad('123'))).estado,
    'aplicado',
  );
  await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA }, validado);
  await paso(backend, { tipo: 'subiendo-cursos' }, validado);
  assert.equal((await paso(backend, { tipo: 'abandonar', motivo, observado: ANTERIOR }, validado)).estado, 'aplicado');
  return validado;
}
async function reintentar(backend: Backend, quien: { solicitudId: string; revisionReserva: number; runId: string }) {
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  const solicitud: SolicitudReintentoActivacion = {
    ...quien,
    revisionEsperada,
    reintentoDe: { solicitudId: ID, revisionReserva: 1, runId: '123', huellaRecibo: HUELLA_VALIDADO },
  };
  return backend.reservarActivacion(solicitud, identidad(quien.runId));
}

/** Lo que ve el panel, con la revisión actual del almacén de trabajos. */
async function observar(backend: Backend) {
  return activacionObservada(await backend.leerActivacionPrivada(), await backend.leerTrabajoPrivado());
}
test('el reintento de una abandonada por rechazo-previo se admite una vez, publica el mismo trabajo y confirma', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  const original = await abandonada(backend, 'rechazo-previo');
  const abandonadaEn = (await backend.leerActivacionPrivada()).ultimaActivacion?.actualizadoEn;
  const visto = (await observar(backend)).ultimaActivacion;
  assert.deepEqual([visto?.reintento, visto?.datosSinPublicarDesde], ['previsto', abandonadaEn]);
  const siguiente = await trabajo(backend, OTRO, '124', false);
  const r = await reintentar(backend, siguiente);
  assert.equal(r.estado, 'aplicado');
  const a = r.activacion.ultimaActivacion;
  assert.equal(a?.fase, 'reservada');
  assert.deepEqual([a?.trabajo.solicitudId, a?.trabajo.runId, a?.reintento?.runId], [ID, '123', '124']);
  // Repetir la misma petición no crea otra intención; la ejecución original ya no manda en ella.
  assert.equal(
    (
      await backend.reservarActivacion(
        {
          ...siguiente,
          revisionEsperada: r.activacion.revision - 1,
          reintentoDe: { solicitudId: ID, revisionReserva: 1, runId: '123', huellaRecibo: HUELLA_VALIDADO },
        },
        identidad('124'),
      )
    ).estado,
    'repetido',
  );
  assert.equal((await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA }, original)).estado, 'conflicto');
  const enCurso = activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion;
  assert.deepEqual([enCurso?.reintento, enCurso?.datosSinPublicarDesde], ['es-reintento', abandonadaEn]);
  for (const p of PUBLICAR_TODO) {
    assert.equal((await paso(backend, p, siguiente)).estado, 'aplicado', p.tipo);
  }
  const final = activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion;
  assert.deepEqual([final?.fase, final?.datosSinPublicarDesde], ['confirmada', null]);
});

test('un reintento que vuelve a cerrarse por rechazo-previo no se reintenta otra vez', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  const siguiente = await trabajo(backend, OTRO, '124', false);
  assert.equal((await reintentar(backend, siguiente)).estado, 'aplicado');
  await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA }, siguiente);
  await paso(backend, { tipo: 'subiendo-cursos' }, siguiente);
  await paso(backend, { tipo: 'abandonar', motivo: 'rechazo-previo', observado: ANTERIOR }, siguiente);
  const visto = activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion;
  assert.equal(visto?.reintento, 'es-reintento');
  const tercero = await trabajo(backend, TERCERO, '125', false);
  assert.equal((await reintentar(backend, tercero)).estado, 'conflicto');
});

for (const motivo of ['a-mano', 'rechazo-proveedor'] as const) {
  test(`una abandonada ${motivo} no se reintenta sola`, async (t) => {
    const backend = fixture(t);
    await preparar(backend);
    await abandonada(backend, motivo);
    const visto = activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion;
    assert.equal(visto?.reintento, null);
    const siguiente = await trabajo(backend, OTRO, '124', false);
    assert.equal((await reintentar(backend, siguiente)).estado, 'conflicto');
  });
}

test('con otro trabajo en medio, o si el que reintenta trae datos nuevos, gana el más reciente', async (t) => {
  const conValidado = fixture(t);
  await preparar(conValidado);
  await abandonada(conValidado, 'rechazo-previo');
  // Un trabajo validado más reciente que no llegó a reservar su activación.
  await trabajo(conValidado, OTRO, '124', true);
  const despues = await trabajo(conValidado, TERCERO, '125', false);
  assert.equal((await reintentar(conValidado, despues)).estado, 'conflicto');
  const validado = fixture(t);
  await preparar(validado);
  await abandonada(validado, 'rechazo-previo');
  const nuevo = await trabajo(validado, OTRO, '124', true);
  assert.equal((await reintentar(validado, nuevo)).estado, 'conflicto');
});

test('el reintento coteja el trabajo abandonado exacto y la identidad de la ejecución que reintenta', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  const siguiente = await trabajo(backend, OTRO, '124', false);
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  const de = { solicitudId: ID, revisionReserva: 1, runId: '123', huellaRecibo: HUELLA_VALIDADO };
  for (const reintentoDe of [
    { ...de, huellaRecibo: 'e'.repeat(HASH) },
    { ...de, runId: '999' },
    { ...de, revisionReserva: 2 },
  ]) {
    const r = await backend.reservarActivacion({ ...siguiente, revisionEsperada, reintentoDe }, identidad('124'));
    assert.equal(r.estado, 'conflicto');
  }
  const otraEjecucion = await backend.reservarActivacion(
    { ...siguiente, revisionEsperada, reintentoDe: de },
    identidad('999'),
  );
  assert.equal(otraEjecucion.estado, 'conflicto');
  assert.equal((await backend.leerActivacionPrivada()).ultimaActivacion?.fase, 'abandonada');
});

test('una abandonada guardada sin la revisión de trabajos se sigue leyendo y no se reintenta', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  const estado = await backend.leerActivacionPrivada();
  const { revisionTrabajos: _r, ...sinRevision } = estado.ultimaActivacion ?? {};
  const visto = activacionObservada({ ...estado, ultimaActivacion: sinRevision }).ultimaActivacion;
  assert.equal(visto?.reintento, null);
  assert.equal(visto?.motivoAbandono, 'rechazo-previo');
});

test('el vigilante avisa de los datos validados sin publicar con su fecha y deja de avisar al confirmar', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  const sinAbandono = evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, entradasVigilante(), Date.now());
  assert.equal(
    sinAbandono.decisiones.find((d) => d.clave === 'activacion'),
    undefined,
  );
  await abandonada(backend, 'rechazo-previo');
  const activacion = await backend.leerActivacionPrivada();
  const desde = activacion.ultimaActivacion?.actualizadoEn ?? 0;
  const vista = evaluarVigilante(
    CONFIG_VIGILANTE,
    PROGRAMADA_VIGILANTE,
    { ...entradasVigilante(), activacion },
    Date.now(),
  );
  const aviso = vista.decisiones.find((d) => d.clave === 'activacion');
  assert.deepEqual(
    [aviso?.estado, aviso?.motivo, aviso?.referencia],
    ['incidencia', 'datos_validados_sin_publicar', new Date(desde).toISOString()],
  );
  const siguiente = await trabajo(backend, OTRO, '124', false);
  await reintentar(backend, siguiente);
  for (const p of PUBLICAR_TODO) {
    await paso(backend, p, siguiente);
  }
  const confirmada = await backend.leerActivacionPrivada();
  const despues = evaluarVigilante(
    CONFIG_VIGILANTE,
    PROGRAMADA_VIGILANTE,
    { ...entradasVigilante(), activacion: confirmada },
    Date.now(),
  ).decisiones.find((d) => d.clave === 'activacion');
  assert.deepEqual([despues?.estado, despues?.motivo], ['conforme', 'sin_datos_validados_por_publicar']);
});

test('el relevo de un reintento es de la ejecución que reintenta, nunca de la original', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  const original = await abandonada(backend, 'rechazo-previo');
  const siguiente = await trabajo(backend, OTRO, '124', false);
  await reintentar(backend, siguiente);
  await paso(backend, { tipo: 'preparar', evidencia: EVIDENCIA }, siguiente);
  await paso(backend, { tipo: 'subiendo-cursos' }, siguiente);
  const evidencia = (runId: string) =>
    ({
      estado: 'completed',
      evento: 'workflow_dispatch',
      runId,
      runAttempt: '1',
      repositorioId: CONFIANZA.repositorioId,
      propietarioId: CONFIANZA.propietarioId,
      sha: CONFIANZA.sha,
      workflowPath: '.github/workflows/actualizar.yml',
      conclusion: 'failure',
    }) as const;
  const segundo = (runId: string) => ({ ...identidad(runId), runAttempt: '2' });
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  const ajeno = await backend.recuperarActivacion({ ...original, revisionEsperada }, segundo('123'), evidencia('123'));
  assert.equal(ajeno.estado, 'conflicto');
  const relevo = await backend.recuperarActivacion(
    { ...siguiente, revisionEsperada },
    segundo('124'),
    evidencia('124'),
  );
  assert.equal(relevo.estado, 'aplicado');
  const seguir = await backend.registrarPasoRecuperacionActivacion(
    {
      ...siguiente,
      revisionEsperada: relevo.activacion.revision,
      paso: { tipo: 'cursos-subida', versionIdCursos: VERSION },
    },
    segundo('124'),
  );
  assert.equal(seguir.estado, 'aplicado');
});

test('un reintento solo prepara si la web sirve lo mismo que al abandonar; si no, se rechaza sin efectos', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  const siguiente = await trabajo(backend, OTRO, '124', false);
  await reintentar(backend, siguiente);
  // Alguien publicó a mano el principal entre el abandono y el reintento.
  const publicado = { ...ANTERIOR, principal: { versionId: TERCERO, deploymentId: TERCERO } };
  const cambiada = await paso(
    backend,
    { tipo: 'preparar', evidencia: { ...EVIDENCIA, anterior: publicado } },
    siguiente,
  );
  assert.equal(cambiada.estado, 'conflicto');
  const rechazo = await paso(backend, { tipo: 'rechazar', error: 'servido_distinto' }, siguiente);
  assert.deepEqual([rechazo.estado, rechazo.activacion.ultimaActivacion?.fase], ['aplicado', 'rechazada']);
  const visto = (await observar(backend)).ultimaActivacion;
  assert.equal(visto?.error, 'servido_distinto');
  assert.notEqual(visto?.datosSinPublicarDesde, null);
});

test('si el paquete ya no se conserva, la abandonada lo anota y el panel deja de prometer el reintento', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  const siguiente = await trabajo(backend, OTRO, '124', false);
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  const reintentoDe = { solicitudId: ID, revisionReserva: 1, runId: '123', huellaRecibo: HUELLA_VALIDADO };
  const solicitud = { ...siguiente, revisionEsperada, reintentoDe, descartado: 'sin-artefacto' } as const;
  const descarte = await backend.reservarActivacion(solicitud, identidad('124'));
  assert.equal(descarte.estado, 'aplicado');
  assert.equal(descarte.activacion.ultimaActivacion?.fase, 'abandonada');
  assert.equal((await observar(backend)).ultimaActivacion?.reintento, 'sin-artefacto');
  assert.equal((await reintentar(backend, siguiente)).estado, 'conflicto');
});

test('la promesa del reintento solo dura mientras la oportunidad sigue abierta', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  assert.equal((await observar(backend)).ultimaActivacion?.reintento, 'previsto');
  // Sin el almacén de trabajos no se promete nada.
  assert.equal(activacionObservada(await backend.leerActivacionPrivada()).ultimaActivacion?.reintento, null);
  // El trabajo siguiente terminó sin pendientes: su paso de activación aún puede reintentarla.
  await trabajo(backend, OTRO, '124', false);
  assert.equal((await observar(backend)).ultimaActivacion?.reintento, 'previsto');
  // Otro trabajo después: la oportunidad ya pasó.
  await trabajo(backend, TERCERO, '125', false);
  assert.equal((await observar(backend)).ultimaActivacion?.reintento, null);
});

test('un intento posterior de la ejecución siguiente puede pedir el reintento que el primero no pidió', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  const siguiente = await trabajo(backend, OTRO, '124', false);
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  const reintentoDe = { solicitudId: ID, revisionReserva: 1, runId: '123', huellaRecibo: HUELLA_VALIDADO };
  const segundo = { ...identidad('124'), runAttempt: '2' };
  const r = await backend.reservarActivacion({ ...siguiente, revisionEsperada, reintentoDe }, segundo);
  assert.equal(r.estado, 'aplicado');
});

test('tras terminar un trabajo, ni despachos ni recibos repetidos suben la revisión de trabajos', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  const original = await abandonada(backend, 'rechazo-previo');
  const antes = (await backend.leerTrabajoPrivado()).revision;
  assert.equal((await backend.leerActivacionPrivada()).ultimaActivacion?.revisionTrabajos, antes);
  const referencia = { solicitudId: original.solicitudId, revisionReserva: original.revisionReserva };
  // Repetidos o en conflicto: ninguno escribe, porque el trabajo ya terminó.
  const despachos = [
    await backend.anotarDespacho(referencia, { estado: 'despachada', runId: '123' }),
    await backend.anotarDespacho(referencia, { estado: 'rechazada' }),
  ];
  assert.ok(despachos.every((d) => d.estado !== 'aplicado'));
  await backend.confirmarInicio({ ...referencia, accion: 'actualizar-datos' }, identidad('123'));
  assert.equal((await backend.leerTrabajoPrivado()).revision, antes);
  const siguiente = await trabajo(backend, OTRO, '124', false);
  assert.equal((await reintentar(backend, siguiente)).estado, 'aplicado');
});

test('si el paso de activación de una ejecución sin pendientes falla, el vigilante no lo cuenta como fallo del ejecutor', async (t) => {
  const backend = fixture(t);
  await preparar(backend);
  await abandonada(backend, 'rechazo-previo');
  // El recibo sin pendientes ya está registrado; la lectura de la activación falló y no se pidió nada.
  await trabajo(backend, OTRO, '124', false);
  const entradas = {
    ...entradasVigilante(),
    trabajo: await backend.leerTrabajoPrivado(),
    activacion: await backend.leerActivacionPrivada(),
  };
  const ejecutor = evaluarVigilante(CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, entradas, Date.now()).decisiones.find(
    (d) => d.clave === 'ejecutor',
  );
  assert.equal(ejecutor?.estado, 'conforme');
  // La oportunidad sigue abierta: «Re-run jobs» de esa ejecución puede pedir el reintento.
  assert.equal((await observar(backend)).ultimaActivacion?.reintento, 'previsto');
});
