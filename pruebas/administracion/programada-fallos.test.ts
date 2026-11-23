/** Cada fase del manejador programado que falla queda guardada con su fase y su motivo, sin mover la marca. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { FalloProgramadoAnotado } from '../../src/administracion/fallo-programado.ts';
import { PLAZO_PANEL_MS } from '../../src/administracion/http.ts';
import { leerProgramacionSqlite } from '../../src/plataforma/acceso-publico/programacion-sqlite.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import type { OpcionesMontajeAdministrativo } from '../../src/plataforma/administracion.ts';
import { programadaDiferida } from '../../src/plataforma/programada-diferida.ts';

const AHORA = Date.parse('2026-10-17T03:00:00Z');
const CRON = '0 3 * * *';
const TAM_SHA = 40;
const RUN_ID = 123;
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const DESTINO = { propietario: 'equipo', repositorio: 'fuente', workflow: 'actualizar.yml', ref: 'refs/heads/main' };
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
const EVENTO = { eventoEn: AHORA, cron: CRON };

type Trabajos = NonNullable<OpcionesMontajeAdministrativo['trabajos']>;
type Programados = NonNullable<OpcionesMontajeAdministrativo['programada']>['almacen'];
interface Dobles {
  readonly configuracion?: () => never;
  readonly trabajos?: Partial<Trabajos>;
  readonly programados?: Partial<Programados>;
  readonly prepararActivacion?: () => Promise<void>;
}
function sqlDe(db: DatabaseSync): SqlAccesoPublico {
  return {
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
}
async function fixture(t: TestContext, dobles: Dobles = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = sqlDe(db);
  new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => AHORA });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => AHORA });
  await backend.prepararPanel(POLITICA);
  const trabajos: Trabajos = Object.assign(Object.create(backend), dobles.trabajos);
  const programados: Programados = Object.assign(Object.create(backend), dobles.programados);
  const activacion = Object.assign(Object.create(backend), {
    ...(dobles.prepararActivacion ? { prepararActivacion: dobles.prepararActivacion } : {}),
  });
  const envios: Request[] = [];
  const opciones = {
    trabajos,
    almacenActivacion: activacion,
    programada: {
      configuracion: dobles.configuracion ?? (() => ({ version: 1 as const, habilitada: true as const, cron: CRON })),
      almacen: programados,
    },
    actualizacion: {
      configuracion: () => ({ destino: DESTINO, confianza: CONFIANZA, obtenerToken: async () => 'secreto' }),
      pedir: async (entrada: Parameters<typeof fetch>[0]) => {
        assert.ok(entrada instanceof Request);
        envios.push(entrada);
        return Response.json({
          workflow_run_id: RUN_ID,
          run_url: `https://api.github.com/repos/equipo/fuente/actions/runs/${RUN_ID}`,
          html_url: `https://github.com/equipo/fuente/actions/runs/${RUN_ID}`,
        });
      },
    },
  } as unknown as OpcionesMontajeAdministrativo;
  const ejecutar = programadaDiferida(opciones);
  assert.ok(ejecutar);
  const programacion = () => leerProgramacionSqlite(sql, AHORA);
  return { backend, ejecutar, programacion, envios };
}
const fallar = () => Promise.reject(new Error('fallo sintético con token-secreto'));

for (const [fase, dobles, entrada] of [
  [
    'configuracion',
    {
      configuracion: () => {
        throw new Error('configuración rota');
      },
    },
    EVENTO,
  ],
  ['validacion', {}, { ...EVENTO, cron: '5 3 * * *' }],
  ['preparacion', { prepararActivacion: fallar }, EVENTO],
  ['reserva', { programados: { reservarTrabajoProgramado: fallar } }, EVENTO],
] as const) {
  test(`un fallo en la fase «${fase}» queda guardado como fallida, sin texto del error y sin mover la marca`, async (t) => {
    const f = await fixture(t, dobles);
    await assert.rejects(f.ejecutar(entrada), (error) => {
      assert.ok(error instanceof FalloProgramadoAnotado);
      assert.equal(error.fase, fase);
      assert.equal(error.registrado, true);
      return true;
    });
    const programacion = f.programacion();
    assert.equal(programacion.ultimoEventoEn, null);
    assert.deepEqual(programacion.eventos, [
      {
        eventoEn: AHORA,
        registradoEn: AHORA,
        resultado: 'fallida',
        motivo: 'evento-sin-consumir',
        fase,
        motivoFallo: 'error',
      },
    ]);
    assert.ok(!JSON.stringify(programacion).includes('secreto'));
    assert.equal(f.envios.length, 0);
  });
}

test('un fallo de la consulta a GitHub queda guardado en la fase «reconciliacion»', async (t) => {
  const pendiente = async () => ({
    estado: 'pendiente-reconciliacion' as const,
    trabajos: { version: 1 as const, revision: 0, ultimoTrabajo: null },
  });
  const f = await fixture(t, {
    trabajos: { leerTrabajoPrivado: fallar },
    programados: { reservarTrabajoProgramado: pendiente },
  });
  await assert.rejects(f.ejecutar(EVENTO), { fase: 'reconciliacion', registrado: true });
  assert.deepEqual(
    f.programacion().eventos.map((e) => [e.resultado, e.fase, e.motivoFallo]),
    [['fallida', 'reconciliacion', 'error']],
  );
});

test('un fallo al anotar el despacho marca la reserva nueva con la fase «despacho»; la marca ya avanzó', async (t) => {
  const f = await fixture(t, { trabajos: { anotarDespacho: fallar } });
  await assert.rejects(f.ejecutar(EVENTO), { fase: 'despacho', registrado: true });
  const programacion = f.programacion();
  assert.equal(programacion.ultimoEventoEn, AHORA);
  assert.deepEqual(
    programacion.eventos.map((e) => [e.resultado, e.motivo, e.fase, e.motivoFallo]),
    [['nueva', 'sin-trabajo-pendiente', 'despacho', 'error']],
  );
  assert.equal(f.envios.length, 1);
});

test('un plazo agotado en la reserva queda como «plazo-agotado» y la reserva posterior sustituye la fila', async (t) => {
  const espera = Promise.withResolvers<never>();
  let colgar = true;
  const f = await fixture(t, {
    programados: {
      reservarTrabajoProgramado(this: Programados, solicitud, confianza) {
        return colgar
          ? espera.promise
          : AlmacenSesionPanelSqlite.prototype.reservarTrabajoProgramado.call(this, solicitud, confianza);
      },
    },
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rechazo = assert.rejects(f.ejecutar(EVENTO), { fase: 'reserva', registrado: true });
  await new Promise<void>((resolver) => setImmediate(resolver));
  t.mock.timers.tick(PLAZO_PANEL_MS + 1);
  await rechazo;
  assert.deepEqual(
    f.programacion().eventos.map((e) => [e.resultado, e.fase, e.motivoFallo]),
    [['fallida', 'reserva', 'plazo-agotado']],
  );
  assert.equal(f.programacion().ultimoEventoEn, null);
  colgar = false;
  await f.ejecutar(EVENTO);
  assert.deepEqual(
    f.programacion().eventos.map((e) => [e.resultado, e.motivo, e.fase]),
    [['nueva', 'sin-trabajo-pendiente', null]],
  );
});

test('si el registro del fallo también falla, la causa se relanza como no registrada', async (t) => {
  const f = await fixture(t, {
    programados: { reservarTrabajoProgramado: fallar, registrarFalloProgramado: fallar },
  });
  await assert.rejects(f.ejecutar(EVENTO), { fase: 'reserva', registrado: false });
  assert.equal(f.programacion().eventos.length, 0);
});

test('un fallo de un evento ya consumido conserva su registro', async (t) => {
  const f = await fixture(t);
  await f.ejecutar(EVENTO);
  const antes = f.programacion();
  assert.deepEqual(await f.backend.registrarFalloProgramado({ eventoEn: AHORA, fase: 'reserva', motivo: 'error' }), {
    estado: 'repetida',
  });
  assert.deepEqual(f.programacion(), antes);
  await assert.rejects(
    f.backend.registrarFalloProgramado({ eventoEn: AHORA, fase: 'reserva', motivo: 'otro' } as never),
  );
  await assert.rejects(f.backend.registrarFalloProgramado({ eventoEn: AHORA + 1, fase: 'despacho', motivo: 'error' }));
});
