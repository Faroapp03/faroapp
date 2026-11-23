/** Identidades y estados sintéticos; nunca utilizan sesiones o datos operativos. */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import type { ConfiguracionVigilante } from '../../src/administracion/configuracion-vigilante.ts';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import type { EntradasVigilante } from '../../src/administracion/vigilante.ts';
import { AlmacenSesionVigilanteSqlite } from '../../src/plataforma/acceso-publico/sesion-vigilante-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { instantaneaSalud } from './salud-datos.ts';
import { abrirSesionDePrueba } from './sesion-de-prueba.ts';
export const HORA_VIGILANTE = 3_600_000;
export const DIA_VIGILANTE = 24 * HORA_VIGILANTE;
export const CORTE_VIGILANTE = Date.parse('2026-10-23T12:00:00Z');
export const PROGRAMADA_VIGILANTE = { version: 1, habilitada: true, cron: '0 3 * * *' } as const;
const PLAZO_CIERRE_HORAS = 6;
export const CONFIG_VIGILANTE: ConfiguracionVigilante = {
  version: 1,
  habilitado: true,
  activadoEn: CORTE_VIGILANTE - DIA_VIGILANTE,
  plazoEventoMs: HORA_VIGILANTE,
  plazoInicioMs: HORA_VIGILANTE,
  plazoCierreMs: PLAZO_CIERRE_HORAS * HORA_VIGILANTE,
  plazoObservacionMs: 2 * DIA_VIGILANTE,
};
const CIFRAS_SHA = 40;
export const CONFIANZA_VIGILANTE: ConfianzaOidcGitHub = {
  audiencia: 'https://mantenimiento.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(CIFRAS_SHA),
  workflowSha: 'b'.repeat(CIFRAS_SHA),
};
export function entradasVigilante(): { -readonly [K in keyof EntradasVigilante]: EntradasVigilante[K] } {
  return {
    programacion: {
      version: 1,
      ultimoEventoEn: Date.parse('2026-10-23T03:00:00Z'),
      registradoEn: CORTE_VIGILANTE,
      eventos: [],
    },
    trabajo: { version: 2, revision: 0, ultimoTrabajo: null },
    datos: instantaneaSalud(),
    activacion: { version: 1, revision: 0, ultimaActivacion: null },
  };
}
export async function baseVigilante(t: TestContext) {
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
        const r = accion();
        db.exec('COMMIT');
        return r;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const reloj = { ahora: CORTE_VIGILANTE };
  new AlmacenPublicoSqlite(sql, { maxClientes: 2, ahora: () => reloj.ahora });
  const almacen = new AlmacenSesionVigilanteSqlite(sql, { ahora: () => reloj.ahora });
  await almacen.prepararPanel({
    version: 2,
    api: 'deshabilitada',
    mcp: false,
    a2a: false,
  });
  await almacen.prepararTrabajos();
  await almacen.prepararActivacion();
  return { db, sql, almacen, reloj };
}

/** Recibo sintético real del protocolo; sin-pendientes no renueva las fechas incluidas en la instantánea. */
export async function reciboSinPendientesVigilante(
  almacen: AlmacenSesionVigilanteSqlite,
  ahora: number,
  datos: ReturnType<typeof instantaneaSalud>,
  solicitudId: string,
) {
  const CIFRAS_HASH = 64;
  const SEGUNDO = 1000;
  const VIDA_S = 600;
  const acceso = {
    huellaSesion: createHash('sha256').update(solicitudId).digest('hex'),
    huellaPrincipal: 'b'.repeat(CIFRAS_HASH),
  };
  await abrirSesionDePrueba(almacen, acceso);
  const revisionEsperada = (await almacen.leerTrabajoPrivado()).revision;
  const reserva = await almacen.reservarTrabajoDeSesion(
    acceso,
    { solicitudId, accion: 'reintentar-pendientes', revisionEsperada },
    CONFIANZA_VIGILANTE,
  );
  if (reserva.estado !== 'nueva') {
    throw new Error('Fixture sin reserva nueva');
  }
  const referencia = { solicitudId, revisionReserva: reserva.trabajos.revision };
  const { audiencia: _audiencia, ...pins } = CONFIANZA_VIGILANTE;
  const identidad = {
    ...pins,
    runId: '123',
    runAttempt: '1',
    jti: 'sintetico',
    emitidoEn: ahora / SEGUNDO,
    caducaEn: ahora / SEGUNDO + VIDA_S,
  };
  await almacen.confirmarInicio({ ...referencia, accion: 'reintentar-pendientes' }, identidad);
  await almacen.registrarRecibo(
    {
      ...referencia,
      accion: 'reintentar-pendientes',
      resultado: 'sin-pendientes',
      veredicto: null,
      terminadoEn: new Date(ahora).toISOString().replace('.000Z', 'Z'),
      huellaPaquete: null,
      error: null,
    },
    'c'.repeat(CIFRAS_HASH),
    identidad,
    datos,
  );
}
