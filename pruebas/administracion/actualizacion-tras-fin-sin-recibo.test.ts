/**
 * El botón de actualizar del panel ante un trabajo que sigue abierto en la autoridad: el servidor consulta él mismo
 * el run en GitHub, con la pieza de «Comprobar cómo terminó», y solo admite la reserva nueva si GitHub lo da por
 * completado. En curso o sin respuesta, «ocupado» como siempre y nada cambia. SQL real; GitHub es un doble sin red.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { crearSolicitadorActualizacion } from '../../src/administracion/actualizacion.ts';
import { crearConsultorEjecucionGitHub } from '../../src/administracion/consulta-ejecucion-github.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { ResultadoDespacho } from '../../src/administracion/ejecutor-github.ts';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import {
  crearReconciliadorSinSesion,
  PLAZO_RECONCILIACION_SIN_SESION_MS,
} from '../../src/administracion/reconciliacion.ts';
import type { ResultadoTransicionTrabajo, SolicitudTrabajo } from '../../src/administracion/trabajos.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = Date.parse('2026-11-24T08:00:00Z');
const TAM_HASH = 64;
const TAM_SHA = 40;
const RUN_ANTERIOR = '321';
const RUN_NUEVO = '654';
const RETRASO_EXTRA_MS = 300;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: 'https://mantenimiento.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
/** El repositorio al que se migró: otra identidad y otra ruta, con la que ya no se puede consultar el trabajo viejo. */
const CONFIANZA_MIGRADA: ConfianzaOidcGitHub = {
  ...CONFIANZA,
  repositorioId: '201',
  propietarioId: '202',
  workflowRef: 'entidad/nueva/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const senal = () => new AbortController().signal;

async function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = accion();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const reloj = { ahora: AHORA };
  new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => reloj.ahora });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  await abrirSesionDePrueba(backend, ACCESO);
  return { backend, reloj };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Doble del GET del run en GitHub: responde lo que diga la prueba y guarda cada petición. */
function githubDoble(confianza: ConfianzaOidcGitHub) {
  const consultas: Request[] = [];
  const estado: { responder: () => Response | Promise<Response> } = {
    responder: () => new Response(null, { status: 502 }),
  };
  const run = (status: string, conclusion: string | null) =>
    Response.json({
      id: Number(RUN_ANTERIOR),
      run_attempt: 1,
      event: 'workflow_dispatch',
      head_sha: confianza.sha,
      path: '.github/workflows/actualizar.yml',
      status,
      conclusion,
      repository: { id: Number(confianza.repositorioId), owner: { id: Number(confianza.propietarioId) } },
    });
  const consultar = crearConsultorEjecucionGitHub({
    obtenerToken: async () => 'secreto-sintetico',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      consultas.push(entrada);
      return estado.responder();
    },
  });
  return { consultar, consultas, estado, run };
}

/** Un trabajo del panel despachado a GitHub cuyo recibo no ha llegado: lo que dejó el fallo antes del supervisor. */
async function trabajoAbierto(f: Fixture, confianza: ConfianzaOidcGitHub) {
  const solicitud = { solicitudId: crypto.randomUUID(), accion: 'actualizar-datos', revisionEsperada: 0 } as const;
  const reserva = await f.backend.reservarTrabajoDeSesion(ACCESO, solicitud, confianza);
  assert.ok('trabajos' in reserva && reserva.estado === 'nueva');
  const trabajo = reserva.trabajos.ultimoTrabajo;
  assert.ok(trabajo);
  const referencia = { solicitudId: trabajo.solicitudId, revisionReserva: trabajo.revisionReserva };
  assert.equal(
    (await f.backend.anotarDespacho(referencia, { estado: 'despachada', runId: RUN_ANTERIOR })).estado,
    'aplicado',
  );
}

/**
 * El botón con su consulta a GitHub montada como en producción; `despachos` cuenta los envíos del ciclo nuevo y
 * `cierres` guarda lo que respondió la autoridad a cada cierre sin recibo.
 */
function boton(f: Fixture, consultar: ReturnType<typeof githubDoble>['consultar'], confianza = CONFIANZA) {
  const despachos: string[] = [];
  const cierres: ResultadoTransicionTrabajo[] = [];
  const almacen = {
    leerTrabajoPrivado: () => f.backend.leerTrabajoPrivado(),
    finalizarEjecucionSinRecibo: async (...argumentos: Parameters<typeof f.backend.finalizarEjecucionSinRecibo>) => {
      const cierre = await f.backend.finalizarEjecucionSinRecibo(...argumentos);
      cierres.push(cierre);
      return cierre;
    },
  };
  const solicitar = crearSolicitadorActualizacion({
    almacen: f.backend,
    confianza,
    despachar: async (solicitud): Promise<ResultadoDespacho> => {
      despachos.push(solicitud.solicitudId);
      return { estado: 'despachada', runId: RUN_NUEVO };
    },
    reconciliar: crearReconciliadorSinSesion({ almacen, consultar }),
  });
  /** Pulsa con la revisión que se ve; `repetir` vuelve a enviar tal cual una solicitud anterior, como un reintento. */
  const pulsar = async (repetir?: SolicitudTrabajo) => {
    const { revision } = await f.backend.leerTrabajoPrivado();
    const solicitud = repetir ?? {
      solicitudId: crypto.randomUUID(),
      accion: 'actualizar-datos',
      revisionEsperada: revision,
    };
    const resultado = await solicitar(ACCESO, solicitud, senal());
    assert.equal(resultado.estado, 'activa');
    return { decision: 'decision' in resultado ? resultado.decision : null, solicitud };
  };
  return { pulsar, despachos, cierres };
}

test('un run que GitHub ya dio por completado sin recibo se cierra solo y el botón admite el ciclo nuevo', async (t) => {
  const f = await fixture(t);
  await trabajoAbierto(f, CONFIANZA);
  const github = githubDoble(CONFIANZA);
  github.estado.responder = () => github.run('completed', 'failure');
  const { pulsar, despachos, cierres } = boton(f, github.consultar);

  const { decision, solicitud } = await pulsar();
  const { solicitudId } = solicitud;

  assert.equal(decision, 'nueva');
  assert.equal(github.consultas.length, 1);
  assert.deepEqual(despachos, [solicitudId]);
  const historial = await f.backend.leerTrabajoPrivado();
  assert.equal(historial.ultimoTrabajo?.solicitudId, solicitudId);
  assert.equal(historial.ultimoTrabajo?.runId, RUN_NUEVO);
  // El ciclo anterior quedó cerrado como lo haría «Comprobar cómo terminó»: sin recibo y sin resultado.
  assert.equal(cierres.length, 1);
  const cerrado = cierres[0]?.trabajos.ultimoTrabajo;
  assert.equal(cierres[0]?.estado, 'aplicado');
  assert.equal(cerrado?.runId, RUN_ANTERIOR);
  assert.equal(cerrado?.estado, 'terminado');
  assert.equal(cerrado?.resultado?.resultado, 'ejecucion-sin-recibo');
  assert.deepEqual(cerrado?.resultado?.ultimoFallo, { causa: 'sin-resultado', paso: null });
});

test('un run que GitHub da por en curso sigue ocupando y no se despacha nada', async (t) => {
  const f = await fixture(t);
  await trabajoAbierto(f, CONFIANZA);
  const github = githubDoble(CONFIANZA);
  github.estado.responder = () => github.run('in_progress', null);
  const { pulsar, despachos } = boton(f, github.consultar);
  const antes = await f.backend.leerTrabajoPrivado();

  assert.equal((await pulsar()).decision, 'ocupado');

  assert.equal(github.consultas.length, 1);
  assert.deepEqual(despachos, []);
  assert.deepEqual(await f.backend.leerTrabajoPrivado(), antes);
});

test('si GitHub no responde, o tarda más que su parte del plazo, sigue «ocupado» sin cambiar nada', async (t) => {
  const f = await fixture(t);
  await trabajoAbierto(f, CONFIANZA);
  const github = githubDoble(CONFIANZA);
  const { pulsar, despachos } = boton(f, github.consultar);
  const antes = await f.backend.leerTrabajoPrivado();

  assert.equal((await pulsar()).decision, 'ocupado');
  github.estado.responder = async () => {
    await new Promise((resolver) => setTimeout(resolver, PLAZO_RECONCILIACION_SIN_SESION_MS + RETRASO_EXTRA_MS));
    return github.run('completed', 'failure');
  };
  assert.equal((await pulsar()).decision, 'ocupado');

  assert.equal(github.consultas.length, 2);
  assert.deepEqual(despachos, []);
  assert.deepEqual(await f.backend.leerTrabajoPrivado(), antes);
});

test('el trabajo de antes de una migración se consulta en su propio repositorio, no en el configurado ahora', async (t) => {
  const f = await fixture(t);
  await trabajoAbierto(f, CONFIANZA);
  const github = githubDoble(CONFIANZA);
  github.estado.responder = () => github.run('completed', 'failure');
  const { pulsar } = boton(f, github.consultar, CONFIANZA_MIGRADA);

  assert.equal((await pulsar()).decision, 'nueva');

  assert.deepEqual(
    github.consultas.map((p) => p.url),
    [`https://api.github.com/repos/equipo/fuente/actions/runs/${RUN_ANTERIOR}/attempts/1`],
  );
  const nuevo = (await f.backend.leerTrabajoPrivado()).ultimoTrabajo;
  assert.equal(nuevo?.confianza.repositorioId, CONFIANZA_MIGRADA.repositorioId);
});

test('repetir la solicitud admitida tras cerrar el trabajo anterior responde la misma reserva, sin despachar otra vez', async (t) => {
  const f = await fixture(t);
  await trabajoAbierto(f, CONFIANZA);
  const github = githubDoble(CONFIANZA);
  github.estado.responder = () => github.run('completed', 'failure');
  const { pulsar, despachos } = boton(f, github.consultar);
  const primera = await pulsar();
  assert.equal(primera.decision, 'nueva');
  const admitida = await f.backend.leerTrabajoPrivado();

  // El reintento llega con la revisión que vio la persona, una menos que la base de la reserva admitida.
  assert.equal((await pulsar(primera.solicitud)).decision, 'repetida');

  assert.deepEqual(despachos, [primera.solicitud.solicitudId]);
  assert.equal(github.consultas.length, 1);
  assert.deepEqual(await f.backend.leerTrabajoPrivado(), admitida);
});
