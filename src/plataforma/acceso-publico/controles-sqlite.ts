/** Operaciones síncronas internas. El llamador mantiene la misma transacción que el almacén operativo. */
import {
  type DocumentoControles,
  esRevisionControles,
  leerDocumentoControles,
  leerPoliticaControles,
  type PoliticaControles,
  type ResultadoCambioControles,
} from '../../administracion/controles.ts';
import {
  type DocumentoSecciones,
  leerDocumentoSecciones,
  leerPoliticaSecciones,
  type PoliticaSecciones,
  politicaSeccionesInicial,
} from '../../administracion/secciones-web.js';
import type { SqlAccesoPublico } from './sqlite.ts';

const VERSION_CONTROLES_PERSISTIDOS = 5;
const VERSION_CON_SECCIONES_Y_CURSOS = 3;
/** Los controles con la política de secciones v2, sin la Encuesta: se leen con ella visible. */
const VERSION_SIN_ENCUESTA = 4;
/** La versión de la política de secciones que guardan los controles vigentes. */
const VERSION_SECCIONES = 3;

function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Estado de controles administrativos no válido');
  }
}
export function existeTablaControles(sql: SqlAccesoPublico): boolean {
  return (
    sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='administracion_controles'").length === 1
  );
}
interface DocumentoAdministrativo {
  readonly controles: DocumentoControles;
  readonly secciones: PoliticaSecciones | null;
}
/** Documentos 1–3 son formatos reales persistidos. Su lectura no los convierte ni modifica sus bytes. */
function controlesAnteriores(entrada: Record<string, unknown>): DocumentoAdministrativo {
  const { version, permisosIa, secciones, ...campos } = entrada;
  exigir(version === 1 || version === 2 || version === VERSION_CON_SECCIONES_Y_CURSOS);
  const claves = ['a2a', 'api', 'mcp', 'revision', 'version'];
  if (version !== 1) {
    claves.push('secciones');
  }
  if (Object.hasOwn(entrada, 'permisosIa')) {
    claves.push('permisosIa');
    exigir(permisosIa !== null && typeof permisosIa === 'object' && !Array.isArray(permisosIa));
    exigir(Object.keys(permisosIa).sort().join(',') === 'a2a,api,mcp,recorrido');
    exigir(Object.values(permisosIa).every((valor) => typeof valor === 'boolean'));
  }
  exigir(Object.keys(entrada).sort().join(',') === claves.sort().join(','));
  exigir(
    campos.api === 'deshabilitada' ||
      campos.api === 'habilitada-altas-cerradas' ||
      campos.api === 'habilitada-altas-abiertas',
  );
  const controles = leerDocumentoControles({
    ...campos,
    version: 2,
    api: campos.api === 'deshabilitada' ? 'deshabilitada' : 'habilitada',
  });
  return {
    controles,
    secciones:
      version === 1
        ? null
        : leerDocumentoSecciones({ version: version === 2 ? 1 : 2, revision: controles.revision, secciones }).secciones,
  };
}
function interpretarDocumento(entrada: unknown): DocumentoAdministrativo {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const objeto = entrada as Record<string, unknown>;
  if (objeto.version !== VERSION_CONTROLES_PERSISTIDOS && objeto.version !== VERSION_SIN_ENCUESTA) {
    return controlesAnteriores(objeto);
  }
  exigir(Object.keys(objeto).sort().join(',') === 'a2a,api,mcp,revision,secciones,version');
  const { secciones, ...campos } = objeto;
  const controles = leerDocumentoControles({ ...campos, version: 2 });
  return {
    controles,
    secciones: leerDocumentoSecciones({
      version: objeto.version === VERSION_SIN_ENCUESTA ? 2 : VERSION_SECCIONES,
      revision: controles.revision,
      secciones,
    }).secciones,
  };
}
/** No crea tablas ni repara datos. El marcador en metadata sobrevive a perder la tabla o su fila. */
function leerDocumentoAdministrativo(sql: SqlAccesoPublico): DocumentoAdministrativo | null {
  const estado = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(estado !== undefined && estado.version === 1 && (estado.abierto === 0 || estado.abierto === 1));
  const tabla = existeTablaControles(sql);
  if (!Object.hasOwn(estado, 'controles_version')) {
    exigir(!tabla);
    return null;
  }
  exigir(estado.controles_version === 1 && tabla);
  const filas = sql.filas('SELECT id,documento FROM administracion_controles');
  exigir(filas.length === 1 && filas[0]?.id === 1 && typeof filas[0].documento === 'string');
  return interpretarDocumento(JSON.parse(filas[0].documento) as unknown);
}
export function leerControlesSqlite(sql: SqlAccesoPublico): DocumentoControles | null {
  return leerDocumentoAdministrativo(sql)?.controles ?? null;
}
export function leerSeccionesSqlite(sql: SqlAccesoPublico): DocumentoSecciones | null {
  const documento = leerDocumentoAdministrativo(sql);
  return documento
    ? {
        version: 3,
        revision: documento.controles.revision,
        secciones: documento.secciones ?? { ...politicaSeccionesInicial(), cursos: false },
      }
    : null;
}
/** Migración v1 explícita: no modifica clientes, contadores, revocaciones ni los techos originales. */
export function activarControlesSqlite(sql: SqlAccesoPublico, inicial: PoliticaControles): DocumentoControles {
  const politica = leerPoliticaControles(inicial);
  exigir(leerControlesSqlite(sql) === null);
  const controles: DocumentoControles = { ...politica, revision: 0 };
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN controles_version INTEGER NOT NULL DEFAULT 0 CHECK(controles_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE administracion_controles (
    id INTEGER PRIMARY KEY CHECK(id=1), documento TEXT NOT NULL) STRICT`);
  sql.ejecutar(
    'INSERT INTO administracion_controles (id,documento) VALUES (1,?)',
    JSON.stringify({ ...controles, version: VERSION_CONTROLES_PERSISTIDOS, secciones: politicaSeccionesInicial() }),
  );
  sql.ejecutar('UPDATE publico_estado SET controles_version=1 WHERE id=1');
  return controles;
}
export function cambiarControlesSqlite(
  sql: SqlAccesoPublico,
  revisionEsperada: number,
  nueva: PoliticaControles,
): ResultadoCambioControles {
  exigir(esRevisionControles(revisionEsperada));
  const politica = leerPoliticaControles(nueva);
  const documento = leerDocumentoAdministrativo(sql);
  exigir(documento !== null);
  const anterior = documento.controles;
  if (anterior.revision !== revisionEsperada) {
    return { estado: 'conflicto', controles: anterior };
  }
  exigir(anterior.revision < Number.MAX_SAFE_INTEGER);
  const controles = { ...politica, revision: anterior.revision + 1 };
  const guardado = {
    ...controles,
    version: VERSION_CONTROLES_PERSISTIDOS,
    secciones: documento.secciones ?? { ...politicaSeccionesInicial(), cursos: false },
  };
  sql.ejecutar('UPDATE administracion_controles SET documento=? WHERE id=1', JSON.stringify(guardado));
  return { estado: 'cambiado', controles };
}
export function cambiarSeccionesSqlite(
  sql: SqlAccesoPublico,
  revisionEsperada: number,
  nueva: PoliticaSecciones,
): { readonly estado: 'cambiado' | 'conflicto'; readonly secciones: DocumentoSecciones } {
  exigir(esRevisionControles(revisionEsperada));
  const politica = leerPoliticaSecciones(nueva);
  const documento = leerDocumentoAdministrativo(sql);
  exigir(documento !== null);
  const anterior = documento.controles;
  if (anterior.revision !== revisionEsperada) {
    return {
      estado: 'conflicto',
      secciones: {
        version: 3,
        revision: anterior.revision,
        secciones: documento.secciones ?? { ...politicaSeccionesInicial(), cursos: false },
      },
    };
  }
  exigir(anterior.revision < Number.MAX_SAFE_INTEGER);
  const revision = anterior.revision + 1;
  sql.ejecutar(
    'UPDATE administracion_controles SET documento=? WHERE id=1',
    JSON.stringify({ ...anterior, version: VERSION_CONTROLES_PERSISTIDOS, revision, secciones: politica }),
  );
  return { estado: 'cambiado', secciones: { version: 3, revision, secciones: politica } };
}
