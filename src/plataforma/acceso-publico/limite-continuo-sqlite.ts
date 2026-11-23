/**
 * Contadores de intentos de entrada. Cada fila se retira cuando vence su ventana, un cuarto de hora después del último
 * intento: la alarma del objeto durable la borra a su hora aunque no llegue ninguna petición más.
 */
import type { SqlAccesoPublico } from './sqlite.ts';

export interface IdentificadoresLimite {
  /** Huella del periodo actual: la única que se escribe. */
  readonly clave: string;
  /** Huellas de esta tabla que también cuentan: las de los periodos vecinos y la estable de la versión 2. */
  readonly recientes: readonly string[];
  /** Huellas de la versión 1, en su tabla antigua `administracion_recorrido_intentos`. */
  readonly anteriores: readonly string[];
  /**
   * Huellas del prefijo ancho de la red (/48 en IPv6, /24 en IPv4), la del periodo actual y las de los vecinos. Solo se
   * usan con la tabla llena; sin ellas, una red nueva se rechaza por saturación.
   */
  readonly prefijo?: { readonly clave: string; readonly recientes: readonly string[] };
}
/**
 * Lo que decide el límite: true si admite el intento; false si la red ha agotado sus intentos; «saturado» si la tabla
 * está llena y el prefijo de la red tampoco tiene cupo, que no es culpa de esa red.
 */
export type DecisionDelLimite = boolean | 'saturado';
/**
 * Versión del contrato entre el Worker y el objeto para los intentos. Viaja en el primer nivel del mensaje: el objeto
 * rechaza entero el mensaje de un Worker de otra versión, y un objeto anterior rechaza el de este por la clave de más.
 * En los dos casos el acceso responde 503 en vez de contar solo una parte de las huellas.
 */
export const VERSION_CONTRATO_LIMITE = 3;
/** Huellas de la misma tabla que se cuentan además de la actual. */
const MAX_RECIENTES = 4;
/** Ventana deslizante del límite: un intento cuenta durante un cuarto de hora desde que se hizo. */
export const VENTANA_MS = 900_000;
/** Intentos admitidos por clave dentro de la ventana. */
export const MAX_INTENTOS = 10;
/**
 * Claves distintas que caben en cada tabla. Con la tabla llena, las redes ya conocidas (con fila propia o de un periodo
 * vecino) se siguen contando, aunque su huella del periodo sea nueva; las que no tienen ninguna cuentan en la fila de
 * su prefijo (consumirEnElPrefijo). Cada red conocida ocupa como mucho una fila por cada periodo vivo de la ventana,
 * así que lo que pasa del tope queda acotado.
 */
const MAX_FILAS = 10_000;
/**
 * Con la tabla llena, una red nueva cuenta en la fila de su prefijo ancho, con un cupo propio: unas 10.000 redes /64 de
 * un mismo /48 llenan la tabla, pero no gastan el cupo de los demás prefijos. Cada prefijo admite MAX_INTENTOS_PREFIJO
 * intentos por ventana y la tabla de prefijos, MAX_PREFIJOS a la vez, con el mismo margen acotado que la de redes.
 */
const MAX_PREFIJOS = 1000;
const MAX_INTENTOS_PREFIJO = 30;
const RED = { tabla: 'portal_limite_continuo', maximo: MAX_INTENTOS } as const;
const PREFIJO = { tabla: 'portal_limite_prefijos', maximo: MAX_INTENTOS_PREFIJO } as const;
type TablaDeMarcas = typeof RED | typeof PREFIJO;
const HUELLA = /^[a-f0-9]{64}$/;
function intentosVigentes(sql: SqlAccesoPublico, clave: string, ahora: number, de: TablaDeMarcas = RED) {
  const fila = sql.filas(`SELECT marcas FROM ${de.tabla} WHERE clave=?`, clave)[0];
  let marcas: unknown = [];
  if (fila) {
    if (typeof fila.marcas !== 'string') {
      throw new Error('Límite no disponible');
    }
    marcas = JSON.parse(fila.marcas) as unknown;
  }
  if (
    !Array.isArray(marcas) ||
    marcas.length > de.maximo ||
    !marcas.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= ahora)
  ) {
    throw new Error('Límite no disponible');
  }
  return { existe: !!fila, vigentes: (marcas as number[]).filter((n) => n > ahora - VENTANA_MS) };
}
function intentosEnVentana(sql: SqlAccesoPublico, ids: IdentificadoresLimite, ahora: number) {
  const propios = intentosVigentes(sql, ids.clave, ahora);
  let total = propios.vigentes.length + intentosAnteriores(sql, ids.anteriores, ahora);
  let conocida = propios.existe;
  for (const id of ids.recientes) {
    const vecinos = intentosVigentes(sql, id, ahora);
    total += vecinos.vigentes.length;
    conocida ||= vecinos.existe;
  }
  total -= duplicados(sql, ids, ahora);
  return { vigentes: propios.vigentes, total, conocida };
}

/** Descuenta una relación solo si ambas marcas siguen disponibles. */
function contarEspejo(
  espejo: Record<string, unknown>,
  disponibles: Map<string, Map<number, number>>,
  ahora: number,
): number {
  if (
    typeof espejo.nueva !== 'string' ||
    !HUELLA.test(espejo.nueva) ||
    typeof espejo.marca !== 'number' ||
    !Number.isSafeInteger(espejo.marca) ||
    espejo.marca < 0 ||
    espejo.marca > ahora
  ) {
    throw new Error('Espejo no disponible');
  }
  if (espejo.marca <= ahora - VENTANA_MS) {
    return 0;
  }
  const marcas = disponibles.get(espejo.nueva);
  if (!marcas) {
    return 0;
  }
  const cantidad = marcas.get(espejo.marca) ?? 0;
  if (!cantidad) {
    throw new Error('Espejo no disponible');
  }
  marcas.set(espejo.marca, cantidad - 1);
  return 1;
}
function contarEspejosAntiguos(
  sql: SqlAccesoPublico,
  antigua: string,
  disponibles: Map<string, Map<number, number>>,
  ahora: number,
): number {
  const fila = sql.filas('SELECT usados,caduca FROM administracion_recorrido_intentos WHERE clave=?', antigua)[0];
  if (!fila || typeof fila.caduca !== 'number' || fila.caduca <= ahora) {
    return 0;
  }
  const espejos = sql.filas('SELECT nueva,marca FROM portal_limite_espejos WHERE antigua=?', antigua);
  if (typeof fila.usados !== 'number' || espejos.length > fila.usados) {
    throw new Error('Espejo no disponible');
  }
  return espejos.reduce((total, espejo) => total + contarEspejo(espejo, disponibles, ahora), 0);
}
/** Una marca espejo cuenta una vez mientras ambas representaciones siguen vigentes. */
function duplicados(sql: SqlAccesoPublico, ids: IdentificadoresLimite, ahora: number): number {
  const disponibles = new Map<string, Map<number, number>>();
  for (const clave of [ids.clave, ...ids.recientes]) {
    const marcas = new Map<number, number>();
    for (const marca of intentosVigentes(sql, clave, ahora).vigentes) {
      marcas.set(marca, (marcas.get(marca) ?? 0) + 1);
    }
    disponibles.set(clave, marcas);
  }
  return ids.anteriores.reduce((total, antigua) => total + contarEspejosAntiguos(sql, antigua, disponibles, ahora), 0);
}
function intentosAnteriores(sql: SqlAccesoPublico, ids: readonly string[], ahora: number): number {
  let total = 0;
  for (const id of ids) {
    const fila = sql.filas('SELECT usados,caduca FROM administracion_recorrido_intentos WHERE clave=?', id)[0];
    if (!fila) {
      continue;
    }
    if (
      typeof fila.usados !== 'number' ||
      !Number.isSafeInteger(fila.usados) ||
      fila.usados < 0 ||
      fila.usados > MAX_INTENTOS ||
      typeof fila.caduca !== 'number' ||
      !Number.isSafeInteger(fila.caduca)
    ) {
      throw new Error('Límite antiguo no disponible');
    }
    if (fila.caduca > ahora) {
      total += fila.usados;
    }
  }
  return total;
}

function retirarVencidos(sql: SqlAccesoPublico, ahora: number): void {
  sql.ejecutar(
    'DELETE FROM portal_limite_espejos WHERE marca<=? OR antigua IN (SELECT clave FROM administracion_recorrido_intentos WHERE caduca<=?)',
    ahora - VENTANA_MS,
    ahora,
  );
  sql.ejecutar('DELETE FROM portal_limite_continuo WHERE caduca<=?', ahora);
  sql.ejecutar('DELETE FROM portal_limite_prefijos WHERE caduca<=?', ahora);
  sql.ejecutar('DELETE FROM administracion_recorrido_intentos WHERE caduca<=?', ahora);
}

/** Si la tabla admite otra clave; un recuento ilegible deja el límite fuera de servicio. */
function cabeOtraClave(
  sql: SqlAccesoPublico,
  tabla: 'portal_limite_continuo' | 'administracion_recorrido_intentos' | 'portal_limite_prefijos',
) {
  const fila = sql.filas(`SELECT count(*) AS total FROM ${tabla}`)[0];
  if (!fila || typeof fila.total !== 'number') {
    throw new Error('Límite no disponible');
  }
  return fila.total < (tabla === 'portal_limite_prefijos' ? MAX_PREFIJOS : MAX_FILAS);
}

/** Escribe las marcas vigentes de una clave, con la nueva, y alarga su caducidad hasta el final de la ventana. */
function anotar(
  sql: SqlAccesoPublico,
  de: TablaDeMarcas,
  { clave, vigentes }: { clave: string; vigentes: number[] },
  ahora: number,
): void {
  vigentes.push(ahora);
  sql.ejecutar(
    `INSERT INTO ${de.tabla} (clave,marcas,caduca) VALUES (?,?,?) ON CONFLICT(clave) DO UPDATE SET marcas=excluded.marcas,caduca=excluded.caduca`,
    clave,
    JSON.stringify(vigentes),
    ahora + VENTANA_MS,
  );
}

/**
 * Con la tabla de redes llena y la red sin fila, el intento cuenta en la fila de su prefijo ancho. Sin huellas de
 * prefijo, con su cupo gastado o sin sitio para un prefijo nuevo, el intento se rechaza por saturación.
 */
function consumirEnElPrefijo(sql: SqlAccesoPublico, ids: IdentificadoresLimite, ahora: number): DecisionDelLimite {
  if (!ids.prefijo) {
    return 'saturado';
  }
  const propios = intentosVigentes(sql, ids.prefijo.clave, ahora, PREFIJO);
  let total = propios.vigentes.length;
  let conocido = propios.existe;
  for (const id of ids.prefijo.recientes) {
    const vecinos = intentosVigentes(sql, id, ahora, PREFIJO);
    total += vecinos.vigentes.length;
    conocido ||= vecinos.existe;
  }
  if (total >= MAX_INTENTOS_PREFIJO || (!conocido && !cabeOtraClave(sql, 'portal_limite_prefijos'))) {
    return 'saturado';
  }
  anotar(sql, PREFIJO, { clave: ids.prefijo.clave, vigentes: propios.vigentes }, ahora);
  return true;
}

function huellas(valor: unknown, maximo: number): valor is readonly string[] {
  return (
    Array.isArray(valor) &&
    valor.length <= maximo &&
    valor.every((v) => typeof v === 'string' && HUELLA.test(v)) &&
    new Set(valor).size === valor.length
  );
}
/** Sin prefijo vale; con él, su huella y sus vecinas tienen la forma de las de la red. */
function prefijoValido({ prefijo }: IdentificadoresLimite): boolean {
  return (
    prefijo === undefined ||
    (typeof prefijo === 'object' &&
      prefijo !== null &&
      HUELLA.test(prefijo.clave) &&
      huellas(prefijo.recientes, MAX_RECIENTES) &&
      !prefijo.recientes.includes(prefijo.clave))
  );
}
function exigirIdentificadores(ids: IdentificadoresLimite, ahora: number): void {
  if (
    !ids ||
    !HUELLA.test(ids.clave) ||
    !huellas(ids.recientes, MAX_RECIENTES) ||
    ids.recientes.includes(ids.clave) ||
    !huellas(ids.anteriores, 2) ||
    !prefijoValido(ids) ||
    !Number.isSafeInteger(ahora) ||
    ahora < 0 ||
    ahora > Number.MAX_SAFE_INTEGER - VENTANA_MS
  ) {
    throw new Error('Límite no válido');
  }
}

function prepararEsquemaEspejos(sql: SqlAccesoPublico, estado: Record<string, unknown>): void {
  const espejos = sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='portal_limite_espejos'");
  if (Object.hasOwn(estado, 'limite_espejos_version')) {
    if (estado.limite_espejos_version !== 1 || espejos.length !== 1) {
      throw new Error('Esquema de espejos incompleto');
    }
  } else {
    if (espejos.length) {
      throw new Error('Esquema de espejos incompleto');
    }
    sql.ejecutar(
      'ALTER TABLE publico_estado ADD COLUMN limite_espejos_version INTEGER NOT NULL DEFAULT 0 CHECK(limite_espejos_version IN (0,1))',
    );
    sql.ejecutar(
      'CREATE TABLE portal_limite_espejos (antigua TEXT NOT NULL, nueva TEXT NOT NULL, marca INTEGER NOT NULL) STRICT',
    );
    sql.ejecutar('CREATE INDEX portal_limite_espejos_antigua ON portal_limite_espejos(antigua)');
    sql.ejecutar('CREATE INDEX portal_limite_espejos_marca ON portal_limite_espejos(marca)');
    sql.ejecutar('UPDATE publico_estado SET limite_espejos_version=1 WHERE id=1');
  }
}

function prepararEsquemaPrefijos(sql: SqlAccesoPublico, estado: Record<string, unknown>): void {
  const prefijos = sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='portal_limite_prefijos'");
  if (Object.hasOwn(estado, 'limite_prefijos_version')) {
    if (estado.limite_prefijos_version !== 1 || prefijos.length !== 1) {
      throw new Error('Esquema de prefijos incompleto');
    }
    return;
  }
  if (prefijos.length) {
    throw new Error('Esquema de prefijos incompleto');
  }
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN limite_prefijos_version INTEGER NOT NULL DEFAULT 0 CHECK(limite_prefijos_version IN (0,1))',
  );
  sql.ejecutar(
    'CREATE TABLE portal_limite_prefijos (clave TEXT PRIMARY KEY, marcas TEXT NOT NULL, caduca INTEGER NOT NULL) STRICT',
  );
  sql.ejecutar('UPDATE publico_estado SET limite_prefijos_version=1 WHERE id=1');
}

function sumarIntentoAntiguo(sql: SqlAccesoPublico, clave: string, ahora: number): boolean {
  const fila = sql.filas('SELECT usados FROM administracion_recorrido_intentos WHERE clave=?', clave)[0];
  if (fila) {
    if (typeof fila.usados !== 'number' || !Number.isSafeInteger(fila.usados) || fila.usados < 0) {
      throw new Error('Límite no disponible');
    }
    if (fila.usados >= MAX_INTENTOS) {
      return false;
    }
    sql.ejecutar('UPDATE administracion_recorrido_intentos SET usados=usados+1 WHERE clave=?', clave);
  } else {
    if (!cabeOtraClave(sql, 'administracion_recorrido_intentos')) {
      return false;
    }
    sql.ejecutar('INSERT INTO administracion_recorrido_intentos VALUES (?,?,1)', clave, ahora + VENTANA_MS);
  }
  return true;
}

export class AlmacenLimiteContinuoSqlite {
  private readonly sql: SqlAccesoPublico;
  constructor(sql: SqlAccesoPublico) {
    this.sql = sql;
    sql.transaccion(() => {
      const estado = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
      const tablas = sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='portal_limite_continuo'");
      if (!estado) {
        throw new Error('Autoridad del límite no disponible');
      }
      if (Object.hasOwn(estado, 'limite_continuo_version')) {
        if (estado.limite_continuo_version !== 1 || tablas.length !== 1) {
          throw new Error('Esquema del límite incompleto');
        }
      } else {
        if (tablas.length) {
          throw new Error('Esquema del límite incompleto');
        }
        sql.ejecutar(
          'ALTER TABLE publico_estado ADD COLUMN limite_continuo_version INTEGER NOT NULL DEFAULT 0 CHECK(limite_continuo_version IN (0,1))',
        );
        sql.ejecutar(
          'CREATE TABLE portal_limite_continuo (clave TEXT PRIMARY KEY, marcas TEXT NOT NULL, caduca INTEGER NOT NULL) STRICT',
        );
        sql.ejecutar('UPDATE publico_estado SET limite_continuo_version=1 WHERE id=1');
      }
      prepararEsquemaEspejos(sql, estado);
      prepararEsquemaPrefijos(sql, estado);
    });
  }
  /** Gasta un intento de la huella actual si la ventana, sumadas todas sus huellas, aún lo admite. */
  consumir(ids: IdentificadoresLimite, ahora: number): DecisionDelLimite {
    exigirIdentificadores(ids, ahora);
    return this.sql.transaccion(() => {
      retirarVencidos(this.sql, ahora);
      const { vigentes, total, conocida } = intentosEnVentana(this.sql, ids, ahora);
      if (total >= MAX_INTENTOS) {
        return false;
      }
      if (!conocida && !cabeOtraClave(this.sql, 'portal_limite_continuo')) {
        return consumirEnElPrefijo(this.sql, ids, ahora);
      }
      anotar(this.sql, RED, { clave: ids.clave, vigentes }, ahora);
      return true;
    });
  }
  /** Conserva la lectura de 12g; ambas representaciones y su relación se escriben juntas. */
  consumirConEspejo(ids: IdentificadoresLimite, ahora: number): DecisionDelLimite {
    exigirIdentificadores(ids, ahora);
    const antigua = ids.anteriores[0];
    if (!antigua) {
      throw new Error('Límite antiguo no disponible');
    }
    return this.sql.transaccion(() => {
      retirarVencidos(this.sql, ahora);
      const { vigentes, total, conocida } = intentosEnVentana(this.sql, ids, ahora);
      const fila = this.sql.filas('SELECT usados FROM administracion_recorrido_intentos WHERE clave=?', antigua)[0];
      if (total >= MAX_INTENTOS) {
        return false;
      }
      // Sin sitio en alguna de las dos tablas, la red nueva cuenta solo en su prefijo: no deja fila ni espejo.
      if (
        !conocida &&
        ((!fila && !cabeOtraClave(this.sql, 'administracion_recorrido_intentos')) ||
          !cabeOtraClave(this.sql, 'portal_limite_continuo'))
      ) {
        return consumirEnElPrefijo(this.sql, ids, ahora);
      }
      if (!fila) {
        this.sql.ejecutar('INSERT INTO administracion_recorrido_intentos VALUES (?,?,1)', antigua, ahora + VENTANA_MS);
      } else {
        this.sql.ejecutar('UPDATE administracion_recorrido_intentos SET usados=usados+1 WHERE clave=?', antigua);
      }
      anotar(this.sql, RED, { clave: ids.clave, vigentes }, ahora);
      this.sql.ejecutar(
        'INSERT INTO portal_limite_espejos (antigua,nueva,marca) VALUES (?,?,?)',
        antigua,
        ids.clave,
        ahora,
      );
      return true;
    });
  }
  /**
   * Contrato de 12g: la huella llega sin información que permita deducir la red ni su prefijo, así que con la tabla
   * llena una huella nueva se rechaza como antes, sin cupo de prefijo.
   */
  consumirAntiguo(clave: string, ahora: number): boolean {
    if (
      typeof clave !== 'string' ||
      !HUELLA.test(clave) ||
      !Number.isSafeInteger(ahora) ||
      ahora < 0 ||
      ahora > Number.MAX_SAFE_INTEGER - VENTANA_MS
    ) {
      throw new Error('Límite no válido');
    }
    return this.sql.transaccion(() => {
      retirarVencidos(this.sql, ahora);
      return sumarIntentoAntiguo(this.sql, clave, ahora);
    });
  }
  /**
   * Dice, sin escribir ni gastar intento, si la ventana de estas huellas está por debajo del máximo: una credencial
   * correcta desde una red bloqueada se sigue rechazando.
   */
  admite(ids: IdentificadoresLimite, ahora: number): boolean {
    exigirIdentificadores(ids, ahora);
    return this.sql.transaccion(() => intentosEnVentana(this.sql, ids, ahora).total < MAX_INTENTOS);
  }
  /** Instante en que vence el contador más próximo de las tres tablas; null si no queda ninguno. */
  vencimiento(): number | null {
    const fila = this.sql.filas(
      'SELECT min(caduca) AS caduca FROM (SELECT caduca FROM portal_limite_continuo UNION ALL SELECT caduca FROM administracion_recorrido_intentos UNION ALL SELECT caduca FROM portal_limite_prefijos)',
    )[0];
    if (!fila || (fila.caduca !== null && (typeof fila.caduca !== 'number' || !Number.isSafeInteger(fila.caduca)))) {
      throw new Error('Límite no disponible');
    }
    return fila.caduca;
  }
  /** Retira los contadores vencidos a esta hora; la llama la alarma del objeto durable. */
  retirarVencidos(ahora: number): void {
    if (!Number.isSafeInteger(ahora) || ahora < 0) {
      throw new Error('Límite no válido');
    }
    this.sql.transaccion(() => retirarVencidos(this.sql, ahora));
  }
}
