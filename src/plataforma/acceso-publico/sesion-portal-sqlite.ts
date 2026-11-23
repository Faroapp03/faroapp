/**
 * Sesiones del portal: solo se persisten huellas, no cookies ni datos de navegación. Cada huella se retira al caducar,
 * como mucho una hora después de entrar: la alarma del objeto durable la borra a su hora aunque nadie vuelva a entrar.
 */
import type { SqlAccesoPublico } from './sqlite.ts';

const MAX_SESIONES = 10_000;
const VIDA_MAXIMA_S = 3600;
const MILISEGUNDOS = 1000;
function validar(id: string, ahora: number): void {
  if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(ahora) || ahora <= 0) {
    throw new Error('Sesión de portal no válida');
  }
}
/** Comprueba una sesión nueva antes de programar su retirada, para no adelantar la alarma por una que no se guardará. */
export function validarRegistroPortal(id: string, caduca: number, ahora: number): void {
  validar(id, ahora);
  if (!Number.isSafeInteger(caduca) || caduca <= ahora || caduca > ahora + VIDA_MAXIMA_S) {
    throw new Error('Caducidad no válida');
  }
}
export class AlmacenSesionPortalSqlite {
  private readonly sql: SqlAccesoPublico;
  constructor(sql: SqlAccesoPublico) {
    this.sql = sql;
    sql.transaccion(() => {
      const estado = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
      const tablas = sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='portal_sesiones'");
      if (
        !estado ||
        (Object.hasOwn(estado, 'portal_sesiones_version') &&
          (estado.portal_sesiones_version !== 1 || tablas.length !== 1))
      ) {
        throw new Error('Autoridad de sesiones no disponible');
      }
      if (!Object.hasOwn(estado, 'portal_sesiones_version')) {
        if (tablas.length) {
          throw new Error('Esquema de sesiones incompleto');
        }
        sql.ejecutar(
          'ALTER TABLE publico_estado ADD COLUMN portal_sesiones_version INTEGER NOT NULL DEFAULT 0 CHECK(portal_sesiones_version IN (0,1))',
        );
        sql.ejecutar('CREATE TABLE portal_sesiones (huella TEXT PRIMARY KEY, caduca INTEGER NOT NULL) STRICT');
        sql.ejecutar('UPDATE publico_estado SET portal_sesiones_version=1 WHERE id=1');
      }
    });
  }
  registrar(id: string, caduca: number, ahora: number): void {
    validarRegistroPortal(id, caduca, ahora);
    this.sql.transaccion(() => {
      if (!this.cabeUnaMas(ahora)) {
        throw new Error('Autoridad de sesiones llena');
      }
      this.sql.ejecutar('INSERT INTO portal_sesiones (huella,caduca) VALUES (?,?)', id, caduca);
    });
  }
  /**
   * Si registrar podría guardar ahora una sesión más, sin guardarla. La puerta lo pregunta antes de mirar las
   * credenciales, para que una autoridad caída o llena responda igual a una contraseña correcta que a una incorrecta. Es
   * una lectura pura, sin transacción: no cuenta las caducadas, pero tampoco las borra; eso lo hacen registrar, activa
   * y la alarma.
   */
  disponible(ahora: number): boolean {
    if (!Number.isSafeInteger(ahora) || ahora <= 0) {
      throw new Error('Sesión de portal no válida');
    }
    return this.vigentes(ahora) < MAX_SESIONES;
  }
  /** Retira las caducadas y dice si queda sitio; dentro de la transacción de registrar. */
  private cabeUnaMas(ahora: number): boolean {
    this.sql.ejecutar('DELETE FROM portal_sesiones WHERE caduca<=?', ahora);
    return this.vigentes(ahora) < MAX_SESIONES;
  }
  /** Sesiones que siguen vigentes en este momento. */
  private vigentes(ahora: number): number {
    const cuenta = this.sql.filas('SELECT count(*) AS total FROM portal_sesiones WHERE caduca>?', ahora)[0];
    if (!cuenta || typeof cuenta.total !== 'number') {
      throw new Error('Autoridad de sesiones no disponible');
    }
    return cuenta.total;
  }
  /** Una huella caducada no vale y se retira en la misma lectura, sin esperar a la alarma. */
  activa(id: string, ahora: number): boolean {
    validar(id, ahora);
    return this.sql.transaccion(() => {
      this.sql.ejecutar('DELETE FROM portal_sesiones WHERE huella=? AND caduca<=?', id, ahora);
      const fila = this.sql.filas('SELECT caduca FROM portal_sesiones WHERE huella=?', id)[0];
      if (!fila) {
        return false;
      }
      if (typeof fila.caduca !== 'number' || !Number.isSafeInteger(fila.caduca)) {
        throw new Error('Sesión no válida');
      }
      return true;
    });
  }
  /** Instante, en milisegundos, en que caduca la huella más próxima; null si no queda ninguna. */
  vencimiento(): number | null {
    const fila = this.sql.filas('SELECT min(caduca) AS caduca FROM portal_sesiones')[0];
    if (!fila || (fila.caduca !== null && (typeof fila.caduca !== 'number' || !Number.isSafeInteger(fila.caduca)))) {
      throw new Error('Autoridad de sesiones no disponible');
    }
    return fila.caduca === null ? null : fila.caduca * MILISEGUNDOS;
  }
  /** Retira las huellas caducadas a esta hora, en segundos; la llama la alarma del objeto durable. */
  retirarCaducadas(ahora: number): void {
    if (!Number.isSafeInteger(ahora) || ahora <= 0) {
      throw new Error('Sesión de portal no válida');
    }
    this.sql.transaccion(() => this.sql.ejecutar('DELETE FROM portal_sesiones WHERE caduca<=?', ahora));
  }
  revocar(id: string): void {
    if (!/^[a-f0-9]{64}$/.test(id)) {
      throw new Error('Sesión no válida');
    }
    this.sql.transaccion(() => this.sql.ejecutar('DELETE FROM portal_sesiones WHERE huella=?', id));
  }
}
