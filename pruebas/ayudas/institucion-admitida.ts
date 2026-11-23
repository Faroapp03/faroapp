/** Preparación sintética de una institución vigente para ensayos de montaje; no es una vía del producto. */
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { huellaDelSecreto } from '../../src/api/socios/registro.ts';
import {
  activarInvitacionSqlite,
  invitarInstitucionSqlite,
  prepararInstitucionesSqlite,
} from '../../src/plataforma/acceso-publico/instituciones-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel } from './persistencia-panel.ts';
export const ID_INSTITUCION_SINTETICA = 'inst-11111111-1111-4111-8111-111111111111';
export async function sembrarInstitucionAdmitida(db: DatabaseSync, secreto: string, restantes?: number): Promise<void> {
  const sql = motorPanel(db),
    ahora = Date.now();
  const invitacion = { id: crypto.randomUUID(), huella: huellaDelSecreto('invitación sintética') };
  sql.transaccion(() => {
    prepararInstitucionesSqlite(sql, ahora);
    assert.equal(
      invitarInstitucionSqlite(
        sql,
        { revisionEsperada: 0, nombre: 'Institución sintética', correo: null },
        { ...invitacion, institucionId: ID_INSTITUCION_SINTETICA },
        ahora,
      ).estado,
      'cambiado',
    );
    assert.equal(
      activarInvitacionSqlite(sql, invitacion, { id: crypto.randomUUID(), huella: huellaDelSecreto(secreto) }, ahora)
        .estado,
      'activada',
    );
  });
  if (restantes !== undefined) {
    const cuota = LIMITES_CONECTIVIDAD.consultasPorInstitucionHora;
    assert(Number.isSafeInteger(restantes) && restantes >= 0 && restantes <= cuota);
    const almacen = new AlmacenPublicoSqlite(sql, {
      maxClientes: LIMITES_CONECTIVIDAD.instituciones,
      ahora: () => ahora,
    });
    for (let n = restantes; n < cuota; n++) {
      assert.equal(
        await almacen.consumir([
          { clave: `consultas:cliente:${ID_INSTITUCION_SINTETICA}`, limite: cuota, ventanaMs: 3_600_000 },
        ]),
        true,
      );
    }
  }
}
