import type { DocumentoRecorrido, ModoRecorrido, ResultadoRecorrido } from '../../administracion/recorrido.ts';
import type { AccesoSesionPanel } from '../../administracion/sesion.ts';
import {
  AlmacenLimiteContinuoSqlite,
  type DecisionDelLimite,
  type IdentificadoresLimite,
  VENTANA_MS,
} from './limite-continuo-sqlite.ts';
import type { CubrirVencimiento } from './mantenimiento-durable.ts';
import { cambiarModoSqlite, leerModoSqlite, prepararEsquemaRecorrido } from './recorrido-sqlite.ts';
import { leerSeccionesConAutoridad } from './secciones-autoridad-sqlite.ts';
import type { OpcionesSesionPanelSqlite } from './sesion-sqlite.ts';
import { AlmacenSesionVigilanteSqlite } from './sesion-vigilante-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

export interface OpcionesSesionRecorridoSqlite extends OpcionesSesionPanelSqlite {
  /** Cada contador se escribe con la alarma del objeto ya puesta a su vencimiento o antes. */
  readonly cubrir: CubrirVencimiento;
}
export class AlmacenSesionRecorridoSqlite extends AlmacenSesionVigilanteSqlite {
  private readonly limiteContinuo: AlmacenLimiteContinuoSqlite;
  private readonly cubrir: CubrirVencimiento;
  constructor(sql: SqlAccesoPublico, opciones: OpcionesSesionRecorridoSqlite) {
    super(sql, opciones);
    prepararEsquemaRecorrido(sql);
    this.limiteContinuo = new AlmacenLimiteContinuoSqlite(sql);
    this.cubrir = opciones.cubrir;
  }
  private consumir(clave: IdentificadoresLimite): Promise<DecisionDelLimite> {
    const ahora = Date.now();
    return this.cubrir(ahora + VENTANA_MS, () => this.limiteContinuo.consumir(clave, ahora));
  }
  async consumirIntentoRecorrido(clave: IdentificadoresLimite): Promise<DecisionDelLimite> {
    return this.consumir(clave);
  }
  async consumirIntentoRecorridoAntiguo(clave: string): Promise<boolean> {
    const ahora = Date.now();
    return this.cubrir(ahora + VENTANA_MS, () => this.limiteContinuo.consumirAntiguo(clave, ahora));
  }
  async consumirIntentoRecorridoConEspejo(clave: IdentificadoresLimite): Promise<DecisionDelLimite> {
    const ahora = Date.now();
    return this.cubrir(ahora + VENTANA_MS, () => this.limiteContinuo.consumirConEspejo(clave, ahora));
  }
  /**
   * La credencial correcta solo se coteja con la ventana: no escribe ni toca la alarma. La errónea gasta un intento; la
   * entrega privada responde igual, sin texto, a la red bloqueada y a la saturación.
   */
  async decidirIntentoPrivado(clave: IdentificadoresLimite, valido: boolean): Promise<boolean> {
    return valido ? this.limiteContinuo.admite(clave, Date.now()) : (await this.consumir(clave)) === true;
  }
  /** Vencimiento del contador de intentos más próximo, en milisegundos. */
  vencimientoLimites(): number | null {
    return this.limiteContinuo.vencimiento();
  }
  retirarLimitesVencidos(ahora: number): void {
    this.limiteContinuo.retirarVencidos(ahora);
  }
  async leerRecorrido(): Promise<DocumentoRecorrido> {
    return this.sql.transaccion(() => leerModoSqlite(this.sql));
  }
  async leerSeccionesConAutoridad(permitirInicial = false) {
    return leerSeccionesConAutoridad(this.sql, permitirInicial);
  }
  async leerRecorridoDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoRecorrido> {
    return this.conSesion(acceso, (sesion) => ({ estado: 'activa', sesion, recorrido: leerModoSqlite(this.sql) }));
  }
  async cambiarRecorridoDeSesion(
    acceso: AccesoSesionPanel,
    revision: number,
    modo: ModoRecorrido,
  ): Promise<ResultadoRecorrido> {
    return this.conSesion(acceso, (sesion) => ({ ...cambiarModoSqlite(this.sql, revision, modo), sesion }));
  }
}
