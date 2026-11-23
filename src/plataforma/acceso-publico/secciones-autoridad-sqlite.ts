/** Identidad de autoridad: migración atómica y sin modificar la política ni su revisión. */

import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../administracion/secciones-web.js';
import { leerSeccionesSqlite } from './controles-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function leerSeccionesConAutoridad(sql: SqlAccesoPublico, permitirInicial = false) {
  return sql.transaccion(() => {
    const secciones =
      leerSeccionesSqlite(sql) ?? (permitirInicial ? { revision: 0, secciones: politicaSeccionesInicial() } : null);
    if (!secciones) {
      throw new Error('La política de secciones no está preparada');
    }
    const autoridad = leerIdentidad(sql);
    return {
      version: VERSION_SECCIONES_PUBLICAS,
      autoridad,
      revision: secciones.revision,
      secciones: secciones.secciones,
    };
  });
}

function leerIdentidad(sql: SqlAccesoPublico): string {
  const estado = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  if (!estado) {
    throw new Error('Falta la autoridad');
  }
  const existe =
    sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='secciones_autoridad'").length === 1;
  if (!Object.hasOwn(estado, 'secciones_autoridad_version')) {
    if (existe) {
      throw new Error('Identidad de autoridad incoherente');
    }
    sql.ejecutar(
      'ALTER TABLE publico_estado ADD COLUMN secciones_autoridad_version INTEGER NOT NULL DEFAULT 0 CHECK(secciones_autoridad_version IN (0,1))',
    );
    sql.ejecutar(
      'CREATE TABLE secciones_autoridad (id INTEGER PRIMARY KEY CHECK(id=1), autoridad TEXT NOT NULL) STRICT',
    );
    sql.ejecutar('INSERT INTO secciones_autoridad (id,autoridad) VALUES (1,?)', crypto.randomUUID());
    sql.ejecutar('UPDATE publico_estado SET secciones_autoridad_version=1 WHERE id=1');
  } else if (estado.secciones_autoridad_version !== 1 || !existe) {
    throw new Error('Identidad de autoridad no disponible');
  }
  const filas = sql.filas('SELECT id,autoridad FROM secciones_autoridad');
  const autoridad = filas[0]?.autoridad;
  if (filas.length !== 1 || filas[0]?.id !== 1 || typeof autoridad !== 'string' || !UUID.test(autoridad)) {
    throw new Error('Identidad de autoridad no válida');
  }
  return autoridad;
}
