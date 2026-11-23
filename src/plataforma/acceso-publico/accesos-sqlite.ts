/** Registro acotado Node/DO. El llamador mantiene la transacción SQL y, para leer, la sesión del panel. */
import {
  type AccesoA2a,
  type AccesoApi,
  type AccesoMcp,
  esConsultaOperativa,
  leerPaginaAccesos,
  leerUsoConectividad,
  type PaginaAccesos,
  SolicitudAccesoInvalida,
  type UsoConectividad,
} from '../../administracion/accesos.ts';
import {
  DIA_CONECTIVIDAD_MS,
  ID_INSTITUCION,
  LIMITES_CONECTIVIDAD,
  nombreInstitucion,
} from '../../administracion/instituciones.ts';
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';

const MAX_INSTANTE_DATE = 8_640_000_000_000_000;
const RETENCION_MS = LIMITES_CONECTIVIDAD.retencionDias * DIA_CONECTIVIDAD_MS;
const TABLAS = ['conectividad_uso_estado', 'conectividad_uso'] as const;
const MIN_HTTP = 100,
  MAX_HTTP = 599;
export class RegistroAccesosNoValido extends Error {
  override readonly name = 'RegistroAccesosNoValido';
  constructor() {
    super('Registro operativo no válido');
  }
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new RegistroAccesosNoValido();
  }
}
function entero(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}
function instante(valor: unknown): valor is number {
  return entero(valor) && valor <= MAX_INSTANTE_DATE - RETENCION_MS;
}
function tablas(sql: SqlAccesoPublico): number {
  return sql.filas(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conectividad_uso_estado','conectividad_uso')",
  ).length;
}
function estado(sql: SqlAccesoPublico): number {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(
    metadata !== undefined && metadata.version === 1 && metadata.accesos_version === 1 && tablas(sql) === TABLAS.length,
  );
  const filas = sql.filas('SELECT * FROM conectividad_uso_estado'),
    fila = filas[0];
  exigir(filas.length === 1 && fila !== undefined && fila.id === 1 && fila.version === 1 && instante(fila.reloj));
  exigir(
    sql.filas('SELECT id FROM conectividad_uso WHERE fecha<0 OR fecha>? LIMIT 1', MAX_INSTANTE_DATE - RETENCION_MS)
      .length === 0,
  );
  return fila.reloj;
}
function reloj(sql: SqlAccesoPublico, ahora: number): void {
  exigir(instante(ahora) && ahora >= estado(sql));
  exigir(sql.filas('SELECT id FROM conectividad_uso WHERE fecha>? LIMIT 1', ahora).length === 0);
  sql.ejecutar('UPDATE conectividad_uso_estado SET reloj=? WHERE id=1', ahora);
}
function cantidad(sql: SqlAccesoPublico): number {
  const n = sql.filas('SELECT count(*) AS n FROM conectividad_uso')[0]?.n;
  exigir(entero(n));
  return n;
}
export function prepararAccesosSqlite(sql: SqlAccesoPublico, ahora: number): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(metadata !== undefined && metadata.version === 1);
  if (Object.hasOwn(metadata, 'accesos_version')) {
    estado(sql);
    depurarAccesosSqlite(sql, ahora);
    return;
  }
  exigir(tablas(sql) === 0 && instante(ahora));
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN accesos_version INTEGER NOT NULL DEFAULT 0 CHECK(accesos_version IN (0,1))',
  );
  sql.ejecutar(
    'CREATE TABLE conectividad_uso_estado (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1), reloj INTEGER NOT NULL) STRICT',
  );
  sql.ejecutar(`CREATE TABLE conectividad_uso (
    id INTEGER PRIMARY KEY AUTOINCREMENT, canal TEXT NOT NULL CHECK(canal IN ('api','mcp','a2a')),
    fecha INTEGER NOT NULL, dia TEXT NOT NULL, institucion TEXT, consulta TEXT NOT NULL,
    estado_http INTEGER, cliente TEXT NOT NULL, categoria_cliente TEXT NOT NULL,
    consultas INTEGER NOT NULL CHECK(consultas>0)) STRICT`);
  sql.ejecutar(
    "CREATE UNIQUE INDEX conectividad_uso_diario ON conectividad_uso(canal,dia,consulta,cliente,categoria_cliente) WHERE canal!='api'",
  );
  sql.ejecutar('CREATE INDEX conectividad_uso_fecha ON conectividad_uso(fecha,id)');
  sql.ejecutar('INSERT INTO conectividad_uso_estado VALUES(1,1,?)', ahora);
  sql.ejecutar('UPDATE publico_estado SET accesos_version=1 WHERE id=1');
}
/** Límite global de filas: los agregados también cuentan. Nunca crece sin cota por variar el cliente declarado. */
export function depurarAccesosSqlite(sql: SqlAccesoPublico, ahora: number): void {
  reloj(sql, ahora);
  sql.ejecutar('DELETE FROM conectividad_uso WHERE fecha<=?', ahora - RETENCION_MS);
  const exceso = cantidad(sql) - LIMITES_CONECTIVIDAD.registrosOperativos;
  if (exceso > 0) {
    sql.ejecutar(
      'DELETE FROM conectividad_uso WHERE id IN (SELECT id FROM conectividad_uso ORDER BY fecha,id LIMIT ?)',
      exceso,
    );
  }
}
function clienteMcp(sql: SqlAccesoPublico, uso: Extract<UsoConectividad, { canal: 'mcp' }>, dia: string) {
  if (uso.categoriaCliente !== 'declarado') {
    return { cliente: '', categoria: uso.categoriaCliente };
  }
  const nombres = sql.filas(
    "SELECT DISTINCT cliente FROM conectividad_uso WHERE canal='mcp' AND dia=? AND categoria_cliente='declarado'",
    dia,
  );
  if (
    nombres.some((f) => f.cliente === uso.clienteDeclarado) ||
    nombres.length < LIMITES_CONECTIVIDAD.clientesDeclaradosPorDia
  ) {
    return { cliente: uso.clienteDeclarado ?? '', categoria: 'declarado' };
  }
  return { cliente: '', categoria: 'otros' };
}
function registrarApi(
  sql: SqlAccesoPublico,
  uso: Extract<UsoConectividad, { canal: 'api' }>,
  ahora: number,
  dia: string,
): void {
  const i = sql.filas('SELECT consultas FROM instituciones WHERE id=?', uso.institucionId)[0];
  exigir(i !== undefined && entero(i.consultas) && i.consultas < Number.MAX_SAFE_INTEGER);
  sql.ejecutar('UPDATE instituciones SET consultas=consultas+1,ultima_conexion=? WHERE id=?', ahora, uso.institucionId);
  // La credencial se usa solo para señalar la clave exacta; nunca entra en las filas del registro de uso.
  sql.ejecutar(
    'UPDATE instituciones_claves SET ultima_conexion=? WHERE institucion=? AND huella=?',
    ahora,
    uso.institucionId,
    uso.credencial,
  );
  sql.ejecutar(
    "INSERT INTO conectividad_uso(canal,fecha,dia,institucion,consulta,estado_http,cliente,categoria_cliente,consultas) VALUES('api',?,?,?,?,?,'','',1)",
    ahora,
    dia,
    uso.institucionId,
    uso.consulta,
    uso.estadoHttp,
  );
}
function registrarAgente(
  sql: SqlAccesoPublico,
  uso: Exclude<UsoConectividad, { canal: 'api' }>,
  ahora: number,
  dia: string,
): void {
  const cliente = uso.canal === 'mcp' ? clienteMcp(sql, uso, dia) : { cliente: '', categoria: '' };
  const consulta = uso.canal === 'mcp' ? uso.consulta : uso.habilidad;
  const previa = sql.filas(
    'SELECT id,consultas FROM conectividad_uso WHERE canal=? AND dia=? AND consulta=? AND cliente=? AND categoria_cliente=?',
    uso.canal,
    dia,
    consulta,
    cliente.cliente,
    cliente.categoria,
  )[0];
  if (previa) {
    exigir(
      entero(previa.id) &&
        entero(previa.consultas) &&
        previa.consultas > 0 &&
        previa.consultas < Number.MAX_SAFE_INTEGER,
    );
    sql.ejecutar('UPDATE conectividad_uso SET consultas=consultas+1 WHERE id=?', previa.id);
  } else {
    const fecha = Math.floor(ahora / DIA_CONECTIVIDAD_MS) * DIA_CONECTIVIDAD_MS;
    sql.ejecutar(
      'INSERT INTO conectividad_uso(canal,fecha,dia,institucion,consulta,estado_http,cliente,categoria_cliente,consultas) VALUES(?,?,?,NULL,?,NULL,?,?,1)',
      uso.canal,
      fecha,
      dia,
      consulta,
      cliente.cliente,
      cliente.categoria,
    );
  }
}
export function registrarAccesoSqlite(sql: SqlAccesoPublico, entrada: UsoConectividad, ahora: number): void {
  const uso = leerUsoConectividad(entrada);
  depurarAccesosSqlite(sql, ahora);
  const dia = new Date(ahora).toISOString().split('T')[0];
  exigir(typeof dia === 'string');
  if (uso.canal === 'api') {
    registrarApi(sql, uso, ahora, dia);
  } else {
    registrarAgente(sql, uso, ahora, dia);
  }
  depurarAccesosSqlite(sql, ahora);
}
type FilaUso = FilaSql & {
  readonly id: number;
  readonly fecha: number;
  readonly dia: string;
  readonly consultas: number;
  readonly consulta: string;
};
function validarFila(f: FilaSql, ahora: number): asserts f is FilaUso {
  exigir(
    entero(f.id) &&
      f.id > 0 &&
      instante(f.fecha) &&
      f.fecha <= ahora &&
      entero(f.consultas) &&
      f.consultas > 0 &&
      esConsultaOperativa(f.consulta),
  );
  exigir(typeof f.dia === 'string' && new Date(f.fecha).toISOString().split('T')[0] === f.dia);
}
function api(f: FilaUso): AccesoApi {
  exigir(typeof f.institucion === 'string' && ID_INSTITUCION.test(f.institucion) && f.consultas === 1);
  exigir(
    typeof f.estado_http === 'number' &&
      Number.isInteger(f.estado_http) &&
      f.estado_http >= MIN_HTTP &&
      f.estado_http <= MAX_HTTP,
  );
  exigir(f.cliente === '' && f.categoria_cliente === '');
  let nombre: string;
  try {
    nombre = nombreInstitucion(f.nombre);
  } catch {
    throw new RegistroAccesosNoValido();
  }
  return {
    fecha: new Date(f.fecha).toISOString(),
    institucionId: f.institucion,
    institucion: nombre,
    consulta: f.consulta,
    estadoHttp: f.estado_http,
  };
}
function mcp(f: FilaUso): AccesoMcp {
  exigir(f.institucion === null && f.estado_http === null && typeof f.cliente === 'string');
  let uso: UsoConectividad;
  try {
    uso = leerUsoConectividad({
      canal: 'mcp',
      consulta: f.consulta,
      clienteDeclarado: f.categoria_cliente === 'declarado' ? f.cliente : null,
      categoriaCliente: f.categoria_cliente,
    });
  } catch (error) {
    if (error instanceof SolicitudAccesoInvalida) {
      throw new RegistroAccesosNoValido();
    }
    throw error;
  }
  exigir(uso.canal === 'mcp' && (uso.categoriaCliente === 'declarado' || f.cliente === ''));
  return {
    dia: f.dia,
    herramienta: uso.consulta,
    clienteDeclarado: uso.clienteDeclarado,
    categoriaCliente: uso.categoriaCliente,
    consultas: f.consultas,
  };
}
/** Solo devuelve las 50 filas de esta página; la búsqueda total no copia contenido de consultas. */
export function leerAccesosSqlite(sql: SqlAccesoPublico, pagina: number, ahora: number): PaginaAccesos {
  leerPaginaAccesos({ pagina });
  depurarAccesosSqlite(sql, ahora);
  const total = cantidad(sql),
    porPagina = LIMITES_CONECTIVIDAD.porPagina;
  const filas = sql.filas(
    'SELECT u.*,i.nombre FROM conectividad_uso u LEFT JOIN instituciones i ON i.id=u.institucion ORDER BY u.fecha DESC,u.id DESC LIMIT ? OFFSET ?',
    porPagina,
    (pagina - 1) * porPagina,
  );
  const apis: AccesoApi[] = [],
    mcps: AccesoMcp[] = [],
    a2as: AccesoA2a[] = [];
  for (const f of filas) {
    validarFila(f, ahora);
    if (f.canal === 'api') {
      apis.push(api(f));
    } else if (f.canal === 'mcp') {
      mcps.push(mcp(f));
    } else {
      exigir(
        f.canal === 'a2a' &&
          f.institucion === null &&
          f.estado_http === null &&
          f.cliente === '' &&
          f.categoria_cliente === '',
      );
      a2as.push({ dia: f.dia, habilidad: f.consulta, consultas: f.consultas });
    }
  }
  return { version: 1, pagina, total, porPagina, api: apis, mcp: mcps, a2a: a2as };
}
/** Próximo vencimiento físico; null permite detener alarma/temporizador cuando no hay filas conservadas. */
export function siguienteVencimientoAccesosSqlite(sql: SqlAccesoPublico): number | null {
  estado(sql);
  const primera = sql.filas('SELECT min(fecha) AS fecha FROM conectividad_uso')[0];
  exigir(primera !== undefined);
  if (primera.fecha === null) {
    return null;
  }
  exigir(instante(primera.fecha));
  return primera.fecha + RETENCION_MS;
}
