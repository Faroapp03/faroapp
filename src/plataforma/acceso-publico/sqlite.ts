/** Núcleo común Node/DO. Todas las decisiones y escrituras de una operación son síncronas y transaccionales. */
import type {
  AlmacenControles,
  DocumentoControles,
  PoliticaControles,
  ResultadoCambioControles,
} from '../../administracion/controles.ts';
import type { AlmacenAccesoPublico, CuentaDeAcceso } from '../../api/socios/almacen-publico.ts';
import { MAX_REVOCADOS, RevocacionesLlenas } from '../../api/socios/revocaciones.ts';
import {
  activarControlesSqlite,
  cambiarControlesSqlite,
  existeTablaControles,
  leerControlesSqlite,
} from './controles-sqlite.ts';

export type ValorSql = string | number | null;
export type FilaSql = Record<string, unknown>;
export interface SqlAccesoPublico {
  filas(sql: string, ...valores: ValorSql[]): FilaSql[];
  ejecutar(sql: string, ...valores: ValorSql[]): void;
  transaccion<T>(accion: () => T): T;
}
export interface OpcionesAlmacenPublico {
  readonly maxClientes: number;
  readonly maxContadores?: number;
  readonly maxRevocaciones?: number;
  readonly ahora?: () => number;
}

const CUENTA = /^(?:(?:credenciales|consultas):global|(?:tokens|consultas):cliente:[a-z0-9][a-z0-9-]{2,62})$/;
const JTI = /^[A-Za-z0-9_-]{22}$/;
const DIA_MS = 86_400_000;
const MAX_CUOTA = 1_000_000;
const MAX_CLIENTES = 100_000;
const MIN_CONTADORES = 4096;
const CONTADORES_POR_CLIENTE = 8;
const TOKENS_POR_CLIENTE = 20;
const MAX_CONTADORES = 1_000_000;
const MAX_REVOCACIONES = 2_000_000;
const MAX_CUENTAS_POR_OPERACION = 16;
const MS_POR_SEGUNDO = 1000;
const LOTE_PURGA = 256;
const TABLAS_PROPIAS = 3;

function entero(valor: unknown, maximo = Number.MAX_SAFE_INTEGER): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0 && valor <= maximo;
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Datos de acceso público no válidos');
  }
}
/** Formato compartido por el enlace del entorno (binding) privado y el almacén; no acepta identificadores libres. */
export function esJtiPublico(jti: unknown): jti is string {
  return typeof jti === 'string' && JTI.test(jti);
}
function validarContador(fila: FilaSql): asserts fila is FilaSql & { usados: number } {
  exigir(
    typeof fila.usados === 'number' &&
      Number.isSafeInteger(fila.usados) &&
      fila.usados >= 0 &&
      entero(fila.limite, MAX_CUOTA) &&
      entero(fila.ventana, DIA_MS) &&
      entero(fila.caduca),
  );
}

function contadorAdmite(fila: FilaSql & { usados: number }, cuenta: CuentaDeAcceso): boolean {
  return fila.limite === cuenta.limite && fila.ventana === cuenta.ventanaMs && fila.usados < cuenta.limite;
}
function validarCuentas(cuentas: readonly CuentaDeAcceso[]): void {
  exigir(Array.isArray(cuentas) && cuentas.length > 0 && cuentas.length <= MAX_CUENTAS_POR_OPERACION);
  const claves = new Set<string>();
  for (const cuenta of cuentas) {
    exigir(
      cuenta !== null &&
        typeof cuenta === 'object' &&
        Object.keys(cuenta).sort().join(',') === 'clave,limite,ventanaMs' &&
        typeof cuenta.clave === 'string' &&
        CUENTA.test(cuenta.clave) &&
        entero(cuenta.limite, MAX_CUOTA) &&
        entero(cuenta.ventanaMs, DIA_MS) &&
        !claves.has(cuenta.clave),
    );
    claves.add(cuenta.clave);
  }
}

/**
 * Los máximos de cardinalidad son operativos, no cuotas de uso: nunca expulsan contadores vivos. Al llenarse,
 * consumir falla cerrado y avisa; revocar lanza RevocacionesLlenas. Solo la caducidad libera espacio.
 * La configuración se fija al crear la BD y se coteja al reabrir: dos instancias no pueden aplicar techos distintos.
 */
export class AlmacenPublicoSqlite implements AlmacenAccesoPublico, AlmacenControles {
  private readonly sql: SqlAccesoPublico;
  private readonly ahora: () => number;
  private readonly maxClientes: number;
  private readonly maxContadores: number;
  private readonly maxRevocaciones: number;

  constructor(sql: SqlAccesoPublico, opciones: OpcionesAlmacenPublico) {
    exigir(entero(opciones.maxClientes, MAX_CLIENTES));
    this.sql = sql;
    this.ahora = opciones.ahora ?? Date.now;
    this.maxClientes = opciones.maxClientes;
    // Ocho canales por cliente más suelo para redes; revocaciones: veinte tokens por cliente y suelo existente.
    this.maxContadores =
      opciones.maxContadores ?? Math.max(MIN_CONTADORES, opciones.maxClientes * CONTADORES_POR_CLIENTE);
    this.maxRevocaciones =
      opciones.maxRevocaciones ?? Math.max(MAX_REVOCADOS, opciones.maxClientes * TOKENS_POR_CLIENTE);
    exigir(entero(this.maxContadores, MAX_CONTADORES) && entero(this.maxRevocaciones, MAX_REVOCACIONES));
    this.inicializar();
  }
  private inicializar(): void {
    this.sql.transaccion(() => {
      const existentes = this.sql.filas(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('publico_estado','publico_socios','publico_contadores','publico_revocados')",
      );
      const operativas = existentes.filter((fila) => fila.name !== 'publico_socios');
      exigir((existentes.length === 0 && operativas.length === 0) || operativas.length === TABLAS_PROPIAS);
      exigir(existentes.length > 0 || !existeTablaControles(this.sql));
      if (existentes.length > 0) {
        this.estado();
      }
      this.sql.ejecutar(`CREATE TABLE IF NOT EXISTS publico_estado (
        id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1),
        abierto INTEGER NOT NULL CHECK(abierto IN (0,1)), clientes INTEGER NOT NULL,
        contadores INTEGER NOT NULL, revocaciones INTEGER NOT NULL) STRICT`);
      this.sql.ejecutar(`CREATE TABLE IF NOT EXISTS publico_contadores (
        clave TEXT PRIMARY KEY, usados INTEGER NOT NULL CHECK(usados>=0),
        limite INTEGER NOT NULL, ventana INTEGER NOT NULL, caduca INTEGER NOT NULL) STRICT`);
      this.sql.ejecutar('CREATE INDEX IF NOT EXISTS publico_contadores_caduca ON publico_contadores(caduca)');
      this.sql.ejecutar(
        'CREATE TABLE IF NOT EXISTS publico_revocados (jti TEXT PRIMARY KEY, caduca INTEGER NOT NULL) STRICT',
      );
      this.sql.ejecutar('CREATE INDEX IF NOT EXISTS publico_revocados_caduca ON publico_revocados(caduca)');
      this.sql.ejecutar(
        'INSERT OR IGNORE INTO publico_estado (id,version,abierto,clientes,contadores,revocaciones) VALUES (1,1,?,?,?,?)',
        0,
        this.maxClientes,
        this.maxContadores,
        this.maxRevocaciones,
      );
      const estado = this.estado();
      leerControlesSqlite(this.sql);
      exigir(
        estado.version === 1 &&
          estado.clientes === this.maxClientes &&
          estado.contadores === this.maxContadores &&
          estado.revocaciones === this.maxRevocaciones,
      );
    });
  }
  private estado(): FilaSql {
    const estado = this.sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
    exigir(
      estado !== undefined &&
        estado.version === 1 &&
        (estado.abierto === 0 || estado.abierto === 1) &&
        estado.clientes === this.maxClientes &&
        estado.contadores === this.maxContadores &&
        estado.revocaciones === this.maxRevocaciones,
    );
    return estado;
  }
  private instante(): number {
    const instante = this.ahora();
    exigir(Number.isSafeInteger(instante) && instante >= 0 && instante <= Number.MAX_SAFE_INTEGER - DIA_MS);
    return instante;
  }
  private numero(tabla: 'publico_contadores' | 'publico_revocados'): number {
    const numero = this.sql.filas(`SELECT count(*) AS numero FROM ${tabla}`)[0]?.numero;
    exigir(typeof numero === 'number' && Number.isSafeInteger(numero) && numero >= 0);
    return numero;
  }
  async activarControles(inicial: PoliticaControles): Promise<DocumentoControles> {
    return this.sql.transaccion(() => activarControlesSqlite(this.sql, inicial));
  }
  async leerControles(): Promise<DocumentoControles | null> {
    return this.sql.transaccion(() => leerControlesSqlite(this.sql));
  }
  async cambiarControles(revisionEsperada: number, politica: PoliticaControles): Promise<ResultadoCambioControles> {
    return this.sql.transaccion(() => cambiarControlesSqlite(this.sql, revisionEsperada, politica));
  }
  /** Una operación sobre contadores existentes no necesita consultar la cardinalidad de la tabla. */
  private cabenContadores(nuevos: number): boolean {
    return nuevos === 0 || this.numero('publico_contadores') + nuevos <= this.maxContadores;
  }
  async consumir(cuentas: readonly CuentaDeAcceso[]): Promise<boolean> {
    validarCuentas(cuentas);
    const ahora = this.instante();
    return this.sql.transaccion(() => {
      this.estado();
      this.sql.ejecutar(
        'DELETE FROM publico_contadores WHERE clave IN (SELECT clave FROM publico_contadores WHERE caduca<=? ORDER BY caduca LIMIT ?)',
        ahora,
        LOTE_PURGA,
      );
      let nuevos = 0;
      for (const cuenta of cuentas) {
        this.sql.ejecutar('DELETE FROM publico_contadores WHERE clave=? AND caduca<=?', cuenta.clave, ahora);
        const fila = this.sql.filas(
          'SELECT usados,limite,ventana,caduca FROM publico_contadores WHERE clave=?',
          cuenta.clave,
        )[0];
        if (!fila) {
          nuevos++;
          continue;
        }
        validarContador(fila);
        // Un cambio de política no borra lo gastado; se deniega hasta acabar su ventana.
        if (!contadorAdmite(fila, cuenta)) {
          return false;
        }
      }
      if (!this.cabenContadores(nuevos)) {
        console.warn('Almacén público sin capacidad de contadores: acceso denegado hasta que caduquen');
        return false;
      }
      for (const cuenta of cuentas) {
        const caduca = (Math.floor(ahora / cuenta.ventanaMs) + 1) * cuenta.ventanaMs;
        this.sql.ejecutar(
          `INSERT INTO publico_contadores (clave,usados,limite,ventana,caduca) VALUES (?,1,?,?,?)
          ON CONFLICT(clave) DO UPDATE SET usados=usados+1`,
          cuenta.clave,
          cuenta.limite,
          cuenta.ventanaMs,
          caduca,
        );
      }
      return true;
    });
  }
  async revocar(jti: string, caducaS: number): Promise<void> {
    exigir(esJtiPublico(jti) && entero(caducaS) && caducaS <= Number.MAX_SAFE_INTEGER / MS_POR_SEGUNDO);
    const ahoraS = Math.floor(this.instante() / MS_POR_SEGUNDO);
    this.sql.transaccion(() => {
      this.estado();
      this.sql.ejecutar(
        'DELETE FROM publico_revocados WHERE jti IN (SELECT jti FROM publico_revocados WHERE caduca<=? ORDER BY caduca LIMIT ?)',
        ahoraS,
        LOTE_PURGA,
      );
      if (caducaS <= ahoraS) {
        return;
      }
      const anterior = this.sql.filas('SELECT caduca FROM publico_revocados WHERE jti=?', jti)[0];
      if (!anterior && this.numero('publico_revocados') >= this.maxRevocaciones) {
        throw new RevocacionesLlenas('No caben más revocaciones');
      }
      this.sql.ejecutar(
        `INSERT INTO publico_revocados (jti,caduca) VALUES (?,?)
        ON CONFLICT(jti) DO UPDATE SET caduca=max(caduca,excluded.caduca)`,
        jti,
        caducaS,
      );
    });
  }
  async revocado(jti: string): Promise<boolean> {
    exigir(esJtiPublico(jti));
    return this.sql.transaccion(() => {
      this.estado();
      const fila = this.sql.filas('SELECT caduca FROM publico_revocados WHERE jti=?', jti)[0];
      if (!fila) {
        return false;
      }
      exigir(entero(fila.caduca));
      return fila.caduca > this.instante() / MS_POR_SEGUNDO;
    });
  }
}
