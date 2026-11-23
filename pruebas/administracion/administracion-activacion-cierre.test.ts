/** Cierre de una publicación pedido desde el panel, en la autoridad SQLite real y con GitHub simulado, sin red. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type {
  AnteriorActivacion,
  EvidenciaActivacion,
  PasoActivacion,
  SolicitudActivacion,
} from '../../src/administracion/activacion.ts';
import { activacionObservada } from '../../src/administracion/activacion-observada.ts';
import { cumplirCierre } from '../../src/administracion/cierre-activacion-http.ts';
import { crearCerradorPublicacion } from '../../src/administracion/cierre-publicacion.ts';
import type { ResultadoConsultaIntentoActivacion } from '../../src/administracion/consulta-ejecucion-github.ts';
import type { IdentidadEjecucionGitHub } from '../../src/administracion/oidc-github.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const TERCERO = '77777777-7777-4777-8777-777777777777';
const VERSION = '33333333-3333-4333-8333-333333333333';
const HASH = 64;
const SHA = 40;
const SEGUNDO = 1000;
const VALIDEZ_S = 600;
const TAM_PAQUETE = 16;
const HORA = 3_600_000;
const MINUTO = 60_000;
const DIA = 86_400_000;
const TRES_UTC = 3;
/** Más que el plazo del workflow: una caducidad así no se admite. */
const DEMASIADO = 100;
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
const PRINCIPAL = { versionId: ID, deploymentId: OTRO };
const DOS: AnteriorActivacion = { principal: PRINCIPAL, cursos: { versionId: OTRO, deploymentId: ID } };
const FORMAS = {
  'dos servicios': { anterior: DOS, primero: 'subiendo-cursos' },
  'un servicio': { anterior: PRINCIPAL, primero: 'subiendo' },
} as const;
type Forma = keyof typeof FORMAS;
function evidencia(anterior: AnteriorActivacion): EvidenciaActivacion {
  return {
    sha256Indice: 'a'.repeat(HASH),
    sha256ManifiestoWeb: 'b'.repeat(HASH),
    generacion: { revisionCodigo: CONFIANZA.sha, sha256Manifiesto: 'c'.repeat(HASH) },
    artefacto: {
      revisionCodigo: CONFIANZA.sha,
      huellaPaquete: 'd'.repeat(TAM_PAQUETE),
      sha256Artefacto: 'e'.repeat(HASH),
    },
    anterior,
  };
}
/** La ejecución original ya terminó, según GitHub, en su primer intento. */
const TERMINADA = {
  estado: 'completada',
  evidencia: {
    estado: 'completed',
    evento: 'workflow_dispatch',
    runId: '123',
    runAttempt: '1',
    repositorioId: CONFIANZA.repositorioId,
    propietarioId: CONFIANZA.propietarioId,
    sha: CONFIANZA.sha,
    workflowPath: '.github/workflows/actualizar.yml',
    conclusion: 'failure',
  },
} as const satisfies ResultadoConsultaIntentoActivacion;
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
  new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  t.after(() => db.close());
  const reloj = { desfase: 0 };
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => Date.now() + reloj.desfase });
  return { db, backend, reloj };
}
type Backend = AlmacenSesionPanelSqlite | SesionUnicaDurable;
async function preparar(backend: Backend) {
  await backend.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  await abrirSesionDePrueba(backend, ACCESO);
}
/** Un trabajo terminado con su inicio confirmado: validado o sin pendientes. */
async function trabajo(backend: Backend, solicitudId: string, runId: string, validado: boolean) {
  const accion = validado ? 'actualizar-datos' : 'reintentar-pendientes';
  const revisionEsperada = (await backend.leerTrabajoPrivado()).revision;
  const reserva = await backend.reservarTrabajoDeSesion(ACCESO, { solicitudId, revisionEsperada, accion }, CONFIANZA);
  assert.ok('trabajos' in reserva && reserva.trabajos.ultimoTrabajo);
  const referencia = { solicitudId, revisionReserva: reserva.trabajos.ultimoTrabajo.revisionReserva };
  await backend.confirmarInicio({ ...referencia, accion }, identidad(runId));
  await backend.registrarRecibo(
    {
      ...referencia,
      accion,
      resultado: validado ? 'validado' : 'sin-pendientes',
      veredicto: validado ? 'verde' : null,
      terminadoEn: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      huellaPaquete: validado ? 'd'.repeat(TAM_PAQUETE) : null,
      error: null,
    },
    validado ? 'f'.repeat(HASH) : 'e'.repeat(HASH),
    identidad(runId),
  );
  return { ...referencia, runId };
}
async function paso(backend: Backend, p: PasoActivacion, referencia: Omit<SolicitudActivacion, 'revisionEsperada'>) {
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  return backend.registrarPasoActivacion({ ...referencia, revisionEsperada, paso: p }, identidad(referencia.runId));
}
/** Deja la activación de un servicio, como la guarda un servidor que solo publica el principal. */
function aUnServicio(db: DatabaseSync): void {
  const fila = db.prepare('SELECT documento FROM administracion_activacion WHERE id=1').get();
  assert.ok(typeof fila?.documento === 'string');
  const estado = JSON.parse(fila.documento);
  delete estado.ultimaActivacion.versionIdCursos;
  delete estado.ultimaActivacion.deploymentIdCursos;
  db.prepare('UPDATE administracion_activacion SET documento=? WHERE id=1').run(JSON.stringify(estado));
}
/** Una intención detenida en su primer efecto, en la forma indicada. */
async function detenida(f: { db: DatabaseSync; backend: Backend }, forma: Forma) {
  await preparar(f.backend);
  const original = await trabajo(f.backend, ID, '123', true);
  const revisionEsperada = (await f.backend.leerActivacionPrivada()).revision;
  await f.backend.reservarActivacion({ ...original, revisionEsperada }, identidad('123'));
  if (forma === 'un servicio') {
    aUnServicio(f.db);
  }
  const { anterior, primero } = FORMAS[forma];
  await paso(f.backend, { tipo: 'preparar', evidencia: evidencia(anterior) }, original);
  await paso(f.backend, { tipo: primero }, original);
  return original;
}
/** Anota el cierre para el trabajo siguiente, como hace el panel. */
async function solicitar(backend: Backend, caducaEn = Date.now() + HORA) {
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  const revisionReserva = (await backend.leerTrabajoPrivado()).revision + 1;
  const trabajoSiguiente = { solicitudId: OTRO, revisionReserva };
  return backend.solicitarCierreActivacion({ revisionEsperada, trabajo: trabajoSiguiente, caducaEn });
}
async function cumplir(backend: Backend, observado: AnteriorActivacion, quien = { runId: '124' }) {
  const t = (await backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(t);
  const revisionEsperada = (await backend.leerActivacionPrivada()).revision;
  const registro = {
    solicitudId: t.solicitudId,
    revisionReserva: t.revisionReserva,
    runId: '124',
    revisionEsperada,
    observado,
  };
  return backend.cerrarActivacionSolicitada(registro, identidad(quien.runId), TERMINADA.evidencia);
}

for (const forma of Object.keys(FORMAS) as Forma[]) {
  test(`${forma}: el cierre pedido se anota, lo cumple la ejecución despachada una sola vez y cierra sin publicar`, async (t) => {
    const f = fixture(t);
    await detenida(f, forma);
    const anotado = await solicitar(f.backend);
    assert.equal(anotado.estado, 'aplicado');
    assert.equal(anotado.activacion.ultimaActivacion?.cierre?.estado, 'solicitado');
    await trabajo(f.backend, OTRO, '124', false);
    const { anterior } = FORMAS[forma];
    const cerrada = await cumplir(f.backend, anterior);
    assert.equal(cerrada.estado, 'aplicado');
    const a = cerrada.activacion.ultimaActivacion;
    assert.deepEqual([a?.fase, a?.abandono], ['abandonada', { motivo: 'a-mano', observado: anterior }]);
    assert.equal(a?.cierre, undefined);
    // De un solo uso: ya no hay nada que cumplir.
    assert.equal((await cumplir(f.backend, anterior)).estado, 'conflicto');
  });

  test(`${forma}: si la web ya no sirve lo anterior no se cierra, y la solicitud queda usada`, async (t) => {
    const f = fixture(t);
    await detenida(f, forma);
    await solicitar(f.backend);
    await trabajo(f.backend, OTRO, '124', false);
    const cambiada: AnteriorActivacion =
      forma === 'dos servicios'
        ? { ...DOS, principal: { versionId: VERSION, deploymentId: VERSION } }
        : { versionId: VERSION, deploymentId: VERSION };
    const r = await cumplir(f.backend, cambiada);
    assert.equal(r.estado, 'aplicado');
    assert.equal(r.activacion.ultimaActivacion?.fase, FORMAS[forma].primero);
    assert.deepEqual(r.activacion.ultimaActivacion?.cierre?.estado, 'web-cambiada');
    assert.equal((await cumplir(f.backend, FORMAS[forma].anterior)).estado, 'conflicto');
  });
}

test('la solicitud caduca, deja de valer si la activación avanza y no la cumple una identidad ajena', async (t) => {
  const caduca = fixture(t);
  await detenida(caduca, 'dos servicios');
  await solicitar(caduca.backend);
  await trabajo(caduca.backend, OTRO, '124', false);
  caduca.reloj.desfase = HORA + HORA;
  assert.equal((await cumplir(caduca.backend, DOS)).estado, 'conflicto');
  const avanza = fixture(t);
  const original = await detenida(avanza, 'dos servicios');
  await solicitar(avanza.backend);
  await trabajo(avanza.backend, OTRO, '124', false);
  await paso(avanza.backend, { tipo: 'cursos-subida', versionIdCursos: VERSION }, original);
  assert.equal((await avanza.backend.leerActivacionPrivada()).ultimaActivacion?.cierre, undefined);
  assert.equal((await cumplir(avanza.backend, DOS)).estado, 'conflicto');
  const ajena = fixture(t);
  await detenida(ajena, 'dos servicios');
  await solicitar(ajena.backend);
  await trabajo(ajena.backend, OTRO, '124', false);
  assert.equal((await cumplir(ajena.backend, DOS, { runId: '999' })).estado, 'conflicto');
  // Ni con otra caducidad que la del plazo del workflow, ni para otra reserva que la siguiente.
  const lejos = fixture(t);
  await detenida(lejos, 'dos servicios');
  assert.equal((await solicitar(lejos.backend, Date.now() + DEMASIADO * HORA)).estado, 'conflicto');
});

test('el servidor pregunta a GitHub: si la ejecución sigue en marcha o GitHub no responde, no se cierra', async (t) => {
  const f = fixture(t);
  await detenida(f, 'dos servicios');
  await solicitar(f.backend);
  await trabajo(f.backend, OTRO, '124', false);
  const t2 = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.ok(t2);
  const revisionEsperada = (await f.backend.leerActivacionPrivada()).revision;
  const registro = {
    solicitudId: OTRO,
    revisionReserva: t2.revisionReserva,
    runId: '124',
    revisionEsperada,
    observado: DOS,
  };
  const contexto = (estado: 'en-curso' | 'no-disponible') => ({
    identidad: identidad('124'),
    consultarFin: async () => ({ estado }) as const,
    senal: new AbortController().signal,
  });
  await assert.rejects(cumplirCierre(f.backend, registro, contexto('en-curso')));
  await assert.rejects(cumplirCierre(f.backend, registro, contexto('no-disponible')));
  assert.equal((await f.backend.leerActivacionPrivada()).ultimaActivacion?.cierre?.estado, 'solicitado');
  const cumplido = await cumplirCierre(f.backend, registro, {
    identidad: identidad('124'),
    consultarFin: async () => TERMINADA,
    senal: new AbortController().signal,
  });
  assert.equal(cumplido.activacion.ultimaActivacion?.fase, 'abandonada');
});

test('desde el panel: comprueba GitHub, anota el cierre y despacha la ejecución que lo cumple', async (t) => {
  const f = fixture(t);
  await detenida(f, 'dos servicios');
  const despachos: string[] = [];
  const cerrador = (fin: ResultadoConsultaIntentoActivacion, despachar = true) =>
    crearCerradorPublicacion({
      almacen: f.backend,
      leerTrabajos: () => f.backend.leerTrabajoPrivado(),
      consultarFin: async () => fin,
      nuevoId: () => TERCERO,
      solicitar: async (acceso, solicitud) => {
        const reserva = await f.backend.reservarTrabajoDeSesion(acceso, solicitud, CONFIANZA);
        assert.ok('trabajos' in reserva && reserva.trabajos.ultimoTrabajo);
        const referencia = {
          solicitudId: solicitud.solicitudId,
          revisionReserva: reserva.trabajos.ultimoTrabajo.revisionReserva,
        };
        despachos.push(solicitud.accion);
        const despacho = despachar
          ? ({ estado: 'despachada', runId: '125' } as const)
          : ({ estado: 'rechazada' } as const);
        const anotado = await f.backend.anotarDespacho(referencia, despacho);
        return { estado: 'activa', sesion: reserva.sesion, trabajos: anotado.trabajos, decision: reserva.estado };
      },
    });
  const senal = new AbortController().signal;
  const revisionEsperada = (await f.backend.leerActivacionPrivada()).revision;
  assert.deepEqual(await cerrador({ estado: 'en-curso' })(ACCESO, { revisionEsperada }, senal), {
    estado: 'ejecucion-en-curso',
  });
  assert.deepEqual(await cerrador({ estado: 'no-disponible' })(ACCESO, { revisionEsperada }, senal), {
    estado: 'sin-confirmacion',
  });
  assert.equal(despachos.length, 0);
  const pedido = await cerrador(TERMINADA)(ACCESO, { revisionEsperada }, senal);
  assert.equal(pedido.estado, 'solicitado');
  assert.deepEqual(despachos, ['reintentar-pendientes']);
  const c = (await f.backend.leerActivacionPrivada()).ultimaActivacion?.cierre;
  assert.deepEqual([c?.estado, c?.trabajo.solicitudId], ['solicitado', TERCERO]);
  // Con la revisión de antes ya no vale: la anotación la avanzó.
  assert.deepEqual(await cerrador(TERMINADA)(ACCESO, { revisionEsperada }, senal), { estado: 'conflicto' });
});

test('una activación guardada sin cierre se sigue leyendo y el panel no ve ningún cierre', async (t) => {
  const f = fixture(t);
  await detenida(f, 'un servicio');
  assert.equal(activacionObservada(await f.backend.leerActivacionPrivada()).ultimaActivacion?.cierre, null);
});

/** El objeto durable real detrás de su enlace, con la misma autoridad SQLite. */
function durable(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: (accion) => {
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
    },
  };
  const servidor = new AccesoPublicoDurable(estado, {});
  const espacio = { idFromName: (nombre: string) => nombre, get: () => ({ fetch: (p: Request) => servidor.fetch(p) }) };
  t.after(() => db.close());
  return { db, backend: new SesionUnicaDurable(espacio) };
}
test('por el enlace del objeto durable: el cierre se anota y se cumple con las mismas guardas', async (t) => {
  const f = durable(t);
  await detenida(f, 'dos servicios');
  assert.equal((await solicitar(f.backend)).estado, 'aplicado');
  await trabajo(f.backend, OTRO, '124', false);
  assert.equal((await cumplir(f.backend, DOS, { runId: '999' })).estado, 'conflicto');
  const cerrada = await cumplir(f.backend, DOS);
  assert.deepEqual([cerrada.estado, cerrada.activacion.ultimaActivacion?.fase], ['aplicado', 'abandonada']);
});

/** Lo que ve el panel del cierre, con el almacén de trabajos. */
async function cierreVisto(backend: Backend) {
  const activacion = await backend.leerActivacionPrivada();
  return activacionObservada(activacion, await backend.leerTrabajoPrivado()).ultimaActivacion?.cierre?.estado;
}
/** Reserva y despacha el trabajo que cumple el cierre, sin terminarlo. */
async function despachar(
  backend: Backend,
  despacho: { estado: 'despachada'; runId: string } | { estado: 'rechazada' },
) {
  const revisionEsperada = (await backend.leerTrabajoPrivado()).revision;
  const reserva = await backend.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: OTRO, revisionEsperada, accion: 'reintentar-pendientes' },
    CONFIANZA,
  );
  assert.ok('trabajos' in reserva && reserva.trabajos.ultimoTrabajo);
  const referencia = { solicitudId: OTRO, revisionReserva: reserva.trabajos.ultimoTrabajo.revisionReserva };
  return backend.anotarDespacho(referencia, despacho);
}
test('el panel solo ve el cierre en curso mientras su ejecución puede cumplirlo', async (t) => {
  // Despachado y sin terminar: en curso.
  const enCurso = fixture(t);
  await detenida(enCurso, 'dos servicios');
  await solicitar(enCurso.backend);
  await despachar(enCurso.backend, { estado: 'despachada', runId: '124' });
  assert.equal(await cierreVisto(enCurso.backend), 'en-curso');
  // Un «Re-run jobs» de la original hace su relevo: la activación avanza y el cierre ya no se cumplirá.
  const revisionEsperada = (await enCurso.backend.leerActivacionPrivada()).revision;
  const relevo = await enCurso.backend.recuperarActivacion(
    { solicitudId: ID, revisionReserva: 1, runId: '123', revisionEsperada },
    { ...identidad('123'), runAttempt: '2' },
    TERMINADA.evidencia,
  );
  assert.equal(relevo.estado, 'aplicado');
  assert.equal(await cierreVisto(enCurso.backend), 'no-cumplido');
  // El despacho falló: el trabajo quedó terminado sin ejecución.
  const fallido = fixture(t);
  await detenida(fallido, 'dos servicios');
  await solicitar(fallido.backend);
  await despachar(fallido.backend, { estado: 'rechazada' });
  assert.equal(await cierreVisto(fallido.backend), 'no-cumplido');
  // La ejecución despachada registró su recibo y terminó: su paso de activación pudo cumplirlo; aún no consta.
  const terminada = fixture(t);
  await detenida(terminada, 'dos servicios');
  await solicitar(terminada.backend);
  await trabajo(terminada.backend, OTRO, '124', false);
  assert.equal(await cierreVisto(terminada.backend), 'sin-constancia');
  // Si después llega otro trabajo, el despachado ya no es el último: no se cumplió.
  await trabajo(terminada.backend, TERCERO, '125', false);
  assert.equal(await cierreVisto(terminada.backend), 'no-cumplido');
});

test('con la activación sin resolver: el despacho del cierre se admite y la comprobación diaria sigue omitida', async (t) => {
  const f = fixture(t);
  await detenida(f, 'dos servicios');
  await solicitar(f.backend);
  // El trabajo que despacha el cierre sí se reserva y queda despachado: su ejecución es la que lo cumple.
  const despacho = await despachar(f.backend, { estado: 'despachada', runId: '124' });
  assert.equal(despacho.estado, 'aplicado');
  assert.equal(despacho.trabajos.ultimoTrabajo?.solicitudId, OTRO);
  assert.equal(await cierreVisto(f.backend), 'en-curso');
  // La comprobación diaria no reserva nada mientras la activación no se resuelva, aunque haya un cierre pedido.
  const diaria = fixture(t);
  await detenida(diaria, 'dos servicios');
  await solicitar(diaria.backend);
  const manana = new Date(Date.now() + DIA);
  const eventoEn = Date.UTC(manana.getUTCFullYear(), manana.getUTCMonth(), manana.getUTCDate(), TRES_UTC);
  diaria.reloj.desfase = eventoEn + MINUTO - Date.now();
  const evento = await diaria.backend.reservarTrabajoProgramado({ eventoEn, cron: '0 3 * * *' }, CONFIANZA);
  assert.equal(evento.estado, 'omitida-candidato');
});

test('sin el almacén de trabajos el panel no dice nada del cierre pedido', async (t) => {
  const f = fixture(t);
  await detenida(f, 'dos servicios');
  await solicitar(f.backend);
  const sinTrabajos = activacionObservada(await f.backend.leerActivacionPrivada()).ultimaActivacion;
  assert.equal(sinTrabajos?.cierre, null);
  assert.notEqual(await cierreVisto(f.backend), undefined);
});
