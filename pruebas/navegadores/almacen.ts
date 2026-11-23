/** Un SQLite en memoria compartido por panel Node y binding compilado; no sustituye sus reglas de dominio. */

import { DatabaseSync } from 'node:sqlite';
import { LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import type { EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';

export function crearAlmacen() {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
    },
    transaccion: (accion) => {
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
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (sentencia, ...valores) => ({ toArray: () => sql.filas(sentencia, ...valores) }) },
      transactionSync: sql.transaccion,
    },
  };
  return {
    publico: new AlmacenPublicoSqlite(sql, { maxClientes: LIMITES_CONECTIVIDAD.instituciones }),
    sesion: new AlmacenSesionPanelSqlite(sql),
    estado,
    cerrar: () => db.close(),
  };
}
