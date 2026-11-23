/** Datos y motor de prueba: no lee entorno, archivos de configuración ni credenciales reales. */
import type { DatabaseSync } from 'node:sqlite';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

export const LONGITUD_HUELLA_PANEL = 64;
export const AHORA_PANEL = 100_000;
export const OPCIONES_PANEL = { maxClientes: 2, ahora: () => AHORA_PANEL };
export const POLITICA_PANEL: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
export function accesoPanel(letra: string): AccesoSesionPanel {
  return {
    huellaSesion: letra.repeat(LONGITUD_HUELLA_PANEL),
    huellaPrincipal: 'f'.repeat(LONGITUD_HUELLA_PANEL),
  };
}
export function motorPanel(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
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
