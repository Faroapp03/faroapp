/** Episodios de aviso en la autoridad administrativa existente; no copia instantáneas ni decide disponibilidad. */
import { sha256 } from '../../../web/terceros/noble/hashes/sha2.js';
import { bytesToHex } from '../../../web/terceros/noble/hashes/utils.js';
import type { ConfiguracionProgramada } from '../../administracion/configuracion-programada.ts';
import { leerConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { ConflictoVigilante, VigilanteNoDisponible } from '../../administracion/errores-vigilante.ts';
import { leerEstadoDatosPanel } from '../../administracion/estado-datos.js';
import { esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from '../../administracion/estado-trabajos.js';
import { estadoPlazoComprobacion } from '../../administracion/salud-datos.js';
import {
  claveInstanteVigilante,
  type DecisionVigilante,
  type EvaluacionVigilante,
  evaluarVigilante,
  type OrigenDatosVigilante,
  type SoporteVigilante,
  validarRelojVigilante,
} from '../../administracion/vigilante.ts';
import { leerActivacionSqlite, leerActivacionVigilanteSqlite } from './activacion-sqlite.ts';
import { leerProgramacionSqlite } from './programacion-sqlite.ts';
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';
import { leerDatosDelUltimoTrabajoSqlite, leerTrabajosSqlite } from './trabajos-sqlite.ts';
import { crearTablasVigilante, migrarOrigenDecisiones, migrarPrecisionMarcas } from './vigilante-esquema-sqlite.ts';

const TABLAS = ['', '_configuraciones', '_decisiones', '_marcas'].map((sufijo) => `administracion_vigilante${sufijo}`);
const MAX_TEXTO = 4096;
const MAX_PAGINA = 200;
function huella(valor: unknown): string {
  const texto = JSON.stringify(valor);
  if (texto === undefined) {
    throw new TypeError('El valor no tiene una representación JSON');
  }
  return bytesToHex(sha256(new TextEncoder().encode(texto)));
}
function tablas(sql: SqlAccesoPublico): number {
  return TABLAS.filter((t) => sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t).length === 1)
    .length;
}
function formatosMetadata(entrada: FilaSql | undefined, permitirLegado: boolean) {
  const conPrecision = Object.hasOwn(entrada ?? {}, 'formato_marcas');
  const conOrigen = Object.hasOwn(entrada ?? {}, 'formato_decisiones');
  exigirTrabajo((conPrecision && conOrigen) || permitirLegado);
  const campos = ['configuracion_sha', 'huella_evaluacion', 'id', 'reloj', 'revision', 'version'];
  if (conPrecision) {
    campos.push('formato_marcas');
  }
  if (conOrigen) {
    campos.push('formato_decisiones');
  }
  const fila = objetoTrabajo(entrada, campos.sort().join(','));
  exigirTrabajo(!conPrecision || fila.formato_marcas === 2);
  exigirTrabajo(!conOrigen || fila.formato_decisiones === 2);
  return { fila, formatoMarcas: conPrecision ? 2 : 1, formatoDecisiones: conOrigen ? 2 : 1 };
}
function metadata(sql: SqlAccesoPublico, ahora: number, permitirLegado = false) {
  const publico = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(publico?.version === 1 && publico.vigilante_version === 1 && tablas(sql) === TABLAS.length);
  const filas = sql.filas('SELECT * FROM administracion_vigilante');
  exigirTrabajo(filas.length === 1);
  const { fila, formatoMarcas, formatoDecisiones } = formatosMetadata(filas[0], permitirLegado);
  exigirTrabajo(
    fila.id === 1 &&
      fila.version === 1 &&
      esEnteroTrabajo(fila.reloj) &&
      fila.reloj <= ahora &&
      esEnteroTrabajo(fila.revision) &&
      typeof fila.configuracion_sha === 'string' &&
      (fila.huella_evaluacion === null ||
        (typeof fila.huella_evaluacion === 'string' && /^[0-9a-f]{64}$/.test(fila.huella_evaluacion))),
  );
  const configuraciones = sql.filas(
    'SELECT documento FROM administracion_vigilante_configuraciones WHERE sha=?',
    fila.configuracion_sha,
  );
  exigirTrabajo(configuraciones.length === 1 && typeof configuraciones[0]?.documento === 'string');
  const documento = configuraciones[0].documento;
  exigirTrabajo(documento.length <= MAX_TEXTO);
  const config = leerConfiguracionVigilante(JSON.parse(documento));
  exigirTrabajo(huella(config) === fila.configuracion_sha);
  return {
    formatoMarcas,
    formatoDecisiones,
    reloj: fila.reloj,
    revision: fila.revision,
    configuracionSha: fila.configuracion_sha,
    huellaEvaluacion: fila.huella_evaluacion,
    config,
  };
}
export function prepararVigilanteSqlite(sql: SqlAccesoPublico, entrada: unknown, ahora: number): void {
  sql.transaccion(() => prepararVigilanteEnTransaccion(sql, entrada, ahora));
}
/** Solo para una preparación explícita cuyo coordinador ya mantiene la transacción SQLite. */
export function prepararVigilanteEnTransaccion(sql: SqlAccesoPublico, entrada: unknown, ahora: number): void {
  const config = leerConfiguracionVigilante(entrada);
  exigirTrabajo(config.habilitado && esEnteroTrabajo(ahora) && config.activadoEn <= ahora);
  {
    // Exige almacén ya preparado; nunca crea trabajos, programación, sesiones ni activaciones.
    leerTrabajosSqlite(sql, ahora);
    leerProgramacionSqlite(sql, ahora);
    leerActivacionSqlite(sql, ahora);
    const publico = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
    exigirTrabajo(publico?.version === 1);
    const sha = huella(config);
    if (Object.hasOwn(publico, 'vigilante_version')) {
      const previo = metadata(sql, ahora, true);
      if (previo.formatoMarcas === 1) {
        migrarPrecisionMarcas(sql);
      }
      if (previo.formatoDecisiones === 1) {
        migrarOrigenDecisiones(sql, leerDecision);
      }
      metadata(sql, ahora);
      if (previo.configuracionSha === sha) {
        return;
      }
      sql.ejecutar(
        'INSERT OR IGNORE INTO administracion_vigilante_configuraciones VALUES (?,?)',
        sha,
        JSON.stringify(config),
      );
      sql.ejecutar(
        'UPDATE administracion_vigilante SET configuracion_sha=?,reloj=?,revision=revision+1,huella_evaluacion=NULL WHERE id=1',
        sha,
        ahora,
      );
      metadata(sql, ahora);
      return;
    }
    exigirTrabajo(tablas(sql) === 0);
    crearTablasVigilante(sql);
    sql.ejecutar('INSERT INTO administracion_vigilante_configuraciones VALUES (?,?)', sha, JSON.stringify(config));
    sql.ejecutar('INSERT INTO administracion_vigilante VALUES (1,1,?,0,?,NULL,2,2)', ahora, sha);
    sql.ejecutar('UPDATE publico_estado SET vigilante_version=1 WHERE id=1');
  }
}
function contenido(fila: FilaSql) {
  const valores = [
    fila.clave,
    fila.estado,
    fila.motivo,
    fila.observado_en,
    fila.evaluado_en,
    fila.referencia,
    fila.configuracion_sha,
    fila.avisar,
  ];
  return fila.origen == null ? valores : [...valores, fila.origen];
}
function leerDecision(fila: FilaSql) {
  objetoTrabajo(fila, 'avisar,clave,configuracion_sha,estado,evaluado_en,id,motivo,observado_en,origen,referencia,sha');
  exigirTrabajo(fila.origen === null || fila.origen === 'recibo' || fila.origen === 'lectura-local');
  exigirTrabajo(
    esEnteroTrabajo(fila.id) &&
      fila.id > 0 &&
      typeof fila.clave === 'string' &&
      /^[a-z][a-z0-9:_-]{0,127}$/.test(fila.clave),
  );
  exigirTrabajo(
    (fila.estado === 'incidencia' || fila.estado === 'conforme') &&
      typeof fila.motivo === 'string' &&
      /^[a-z][a-z0-9_-]{0,127}$/.test(fila.motivo),
  );
  exigirTrabajo(
    esEnteroTrabajo(fila.observado_en) && esEnteroTrabajo(fila.evaluado_en) && fila.observado_en <= fila.evaluado_en,
  );
  exigirTrabajo(
    typeof fila.referencia === 'string' &&
      fila.referencia.length <= MAX_TEXTO &&
      typeof fila.configuracion_sha === 'string' &&
      /^[0-9a-f]{64}$/.test(fila.configuracion_sha) &&
      (fila.avisar === 0 || fila.avisar === 1) &&
      fila.sha === huella(contenido(fila)),
  );
  return Object.freeze({
    id: fila.id,
    clave: fila.clave,
    estado: fila.estado,
    motivo: fila.motivo,
    observadoEn: fila.observado_en,
    evaluadoEn: fila.evaluado_en,
    referencia: fila.referencia,
    configuracionSha: fila.configuracion_sha,
    requiereAviso: fila.avisar === 1,
    origen: fila.origen ?? 'no-registrado',
  });
}
function actuales(sql: SqlAccesoPublico) {
  return sql
    .filas(`SELECT * FROM administracion_vigilante_decisiones
    WHERE id IN (SELECT max(id) FROM administracion_vigilante_decisiones GROUP BY clave) ORDER BY clave`)
    .map(leerDecision);
}
/** Marcas compactas por canal; no almacenan instantáneas ni mezclan relojes de fuentes distintas. */
function leerSoporte(entrada: unknown) {
  if (entrada === null) {
    return null;
  }
  exigirTrabajo(typeof entrada === 'string' && entrada.length <= MAX_TEXTO);
  const soporte = objetoTrabajo(JSON.parse(entrada), 'identidadSha,instanteUtc,version');
  exigirTrabajo(
    soporte.version === 2 && typeof soporte.identidadSha === 'string' && /^[0-9a-f]{64}$/.test(soporte.identidadSha),
  );
  exigirTrabajo(soporte.instanteUtc === null || typeof soporte.instanteUtc === 'string');
  if (soporte.instanteUtc !== null) {
    claveInstanteVigilante(soporte.instanteUtc);
  }
  return { instanteUtc: soporte.instanteUtc, identidadSha: soporte.identidadSha };
}
function leerMarca(sql: SqlAccesoPublico, clave: string) {
  const filas = sql.filas('SELECT * FROM administracion_vigilante_marcas WHERE clave=?', clave);
  exigirTrabajo(filas.length <= 1);
  if (filas[0] === undefined) {
    return null;
  }
  const marca = objetoTrabajo(filas[0], 'clave,observado_en,sha,soporte');
  exigirTrabajo(marca.clave === clave && esEnteroTrabajo(marca.observado_en));
  const soporte = leerSoporte(marca.soporte);
  const contenido = soporte === null ? [clave, marca.observado_en] : [clave, marca.observado_en, marca.soporte];
  exigirTrabajo(marca.sha === huella(contenido));
  exigirTrabajo(soporte?.instanteUtc == null || Date.parse(soporte.instanteUtc) === marca.observado_en);
  return { observadoEn: marca.observado_en, soporte };
}
function guardarMarca(sql: SqlAccesoPublico, clave: string, observadoEn: number, soporte?: SoporteVigilante) {
  const documento =
    soporte === undefined
      ? null
      : JSON.stringify({
          version: 2,
          instanteUtc: soporte.instanteUtc,
          identidadSha: huella(soporte.identidad),
        });
  sql.ejecutar(
    `INSERT INTO administracion_vigilante_marcas (clave,observado_en,sha,soporte) VALUES (?,?,?,?)
    ON CONFLICT(clave) DO UPDATE SET observado_en=excluded.observado_en,sha=excluded.sha,soporte=excluded.soporte`,
    clave,
    observadoEn,
    huella(documento === null ? [clave, observadoEn] : [clave, observadoEn, documento]),
    documento,
  );
}
/** Igual fecha no demuestra igual evidencia; el reloj por sí solo solo vence el mismo soporte. */
function soporteAdmisible(
  anterior: NonNullable<ReturnType<typeof leerMarca>>,
  instante: number,
  soporte?: SoporteVigilante,
) {
  if (instante !== anterior.observadoEn) {
    return instante > anterior.observadoEn;
  }
  if (soporte === undefined) {
    return anterior.soporte === null;
  }
  const previo = anterior.soporte;
  if (previo === null) {
    return instante === 0 && soporte.instanteUtc === null;
  }
  if (soporte.instanteUtc !== null && previo.instanteUtc !== null) {
    const actual = claveInstanteVigilante(soporte.instanteUtc);
    const previa = claveInstanteVigilante(previo.instanteUtc);
    if (actual !== previa) {
      return actual > previa;
    }
  } else if (soporte.instanteUtc !== previo.instanteUtc) {
    return false;
  }
  return huella(soporte.identidad) === previo.identidadSha;
}
function admitirCanal(
  sql: SqlAccesoPublico,
  clave: string,
  canal: Pick<NonNullable<DecisionVigilante['canales']>[number], 'observadoEn' | 'soporte'>,
  legado: ReturnType<typeof leerMarca>,
) {
  const anterior = leerMarca(sql, clave) ?? legado;
  if (anterior !== null && !soporteAdmisible(anterior, canal.observadoEn, canal.soporte)) {
    return false;
  }
  guardarMarca(sql, clave, canal.observadoEn, canal.soporte);
  return true;
}
function admitirCanales(
  sql: SqlAccesoPublico,
  claveDecision: string,
  canales: NonNullable<DecisionVigilante['canales']>,
): boolean {
  const prefijo = `${claveDecision}:canal:`;
  const anteriores = sql.filas(
    'SELECT clave FROM administracion_vigilante_marcas WHERE substr(clave,1,?)=?',
    prefijo.length,
    prefijo,
  );
  const actuales = new Map(canales.map((c) => [`${prefijo}${c.canal}`, c]));
  exigirTrabajo(actuales.size === canales.length);
  const clavesPrevias = anteriores.map((anterior) => {
    exigirTrabajo(typeof anterior.clave === 'string');
    leerMarca(sql, anterior.clave);
    return anterior.clave;
  });
  // Un canal ausente no confirma que desapareciera su fallo.
  let admisible = clavesPrevias.every((clave) => actuales.has(clave));
  const legado = anteriores.length ? null : leerMarca(sql, claveDecision);
  for (const [clave, canal] of actuales) {
    admisible = admitirCanal(sql, clave, canal, legado) && admisible;
  }
  return admisible;
}
function admitirCorte(
  sql: SqlAccesoPublico,
  decision: DecisionVigilante,
  previa: ReturnType<typeof leerDecision> | null,
): boolean {
  if (decision.canales !== undefined) {
    return admitirCanales(sql, decision.clave, decision.canales);
  }
  const marca = leerMarca(sql, decision.clave);
  exigirTrabajo(previa === null || (marca !== null && marca.observadoEn >= previa.observadoEn));
  if (marca !== null && !soporteAdmisible(marca, decision.observadoEn, decision.soporte)) {
    return false;
  }
  guardarMarca(sql, decision.clave, decision.observadoEn, decision.soporte);
  return true;
}
/** Reevalúa exclusivamente el plazo ya admitido, usando la autoridad pura de salud. */
function revaluarConjunto(previa: ReturnType<typeof leerDecision>, ahora: number): DecisionVigilante {
  const soporte = objetoTrabajo(
    JSON.parse(previa.referencia),
    'identidad,proximaComprobacion,ultimaComprobacion,version',
  );
  exigirTrabajo(soporte.version === 2 && typeof soporte.identidad === 'string');
  for (const fecha of [soporte.ultimaComprobacion, soporte.proximaComprobacion]) {
    exigirTrabajo(fecha === null || (typeof fecha === 'string' && Number.isFinite(Date.parse(fecha))));
  }
  const ultima = soporte.ultimaComprobacion;
  const proxima = soporte.proximaComprobacion;
  exigirTrabajo(typeof ultima === 'string' || ultima === null);
  exigirTrabajo(typeof proxima === 'string' || proxima === null);
  exigirTrabajo((ultima === null ? 0 : Date.parse(ultima)) === previa.observadoEn);
  const estado = estadoPlazoComprobacion(proxima, new Date(ahora).toISOString());
  return {
    clave: previa.clave,
    estado: estado === 'comprobada' ? 'conforme' : 'incidencia',
    motivo: `comprobacion_${estado}`,
    observadoEn: previa.observadoEn,
    referencia: previa.referencia,
    soporte: { instanteUtc: ultima, identidad: soporte.identidad },
  };
}

function mismaDecision(
  previa: ReturnType<typeof leerDecision> | null,
  decision: DecisionVigilante,
  origen: OrigenDatosVigilante,
) {
  return (
    previa !== null &&
    previa.estado === decision.estado &&
    previa.motivo === decision.motivo &&
    previa.referencia === decision.referencia &&
    previa.origen === origen
  );
}
function guardarDecision(
  sql: SqlAccesoPublico,
  decision: DecisionVigilante,
  contexto: { evaluacion: EvaluacionVigilante; sha: string; origen: OrigenDatosVigilante },
) {
  const { evaluacion, sha, origen } = contexto;
  const filas = sql.filas(
    'SELECT * FROM administracion_vigilante_decisiones WHERE clave=? ORDER BY id DESC LIMIT 1',
    decision.clave,
  );
  const previa = filas[0] === undefined ? null : leerDecision(filas[0]);
  if (!admitirCorte(sql, decision, previa)) {
    return decision.clave;
  }
  if (mismaDecision(previa, decision, origen)) {
    return null;
  }
  const avisar = decision.estado === 'incidencia' && previa?.estado !== 'incidencia' ? 1 : 0;
  const fila = {
    clave: decision.clave,
    estado: decision.estado,
    motivo: decision.motivo,
    observado_en: decision.observadoEn,
    evaluado_en: evaluacion.evaluadoEn,
    referencia: decision.referencia,
    configuracion_sha: sha,
    avisar,
    origen,
  };
  sql.ejecutar(
    `INSERT INTO administracion_vigilante_decisiones
    (clave,estado,motivo,observado_en,evaluado_en,referencia,configuracion_sha,avisar,sha,origen) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    decision.clave,
    decision.estado,
    decision.motivo,
    decision.observadoEn,
    evaluacion.evaluadoEn,
    decision.referencia,
    sha,
    avisar,
    huella(contenido(fila)),
    origen,
  );
  return ultimaDecision(sql, decision.clave);
}
function ultimaDecision(sql: SqlAccesoPublico, clave: string) {
  const fila = sql.filas(
    'SELECT * FROM administracion_vigilante_decisiones WHERE clave=? ORDER BY id DESC LIMIT 1',
    clave,
  )[0];
  exigirTrabajo(fila !== undefined);
  return leerDecision(fila);
}

function guardarCambios(
  sql: SqlAccesoPublico,
  evaluacion: EvaluacionVigilante,
  sha: string,
  origen: OrigenDatosVigilante,
) {
  const cambios = evaluacion.decisiones.map((d) => guardarDecision(sql, d, { evaluacion, sha, origen }));
  // Rechazar soporte regresivo no congela el reloj del último plazo admitido.
  for (const cambio of [...cambios]) {
    if (typeof cambio === 'string' && cambio.startsWith('conjunto:')) {
      const previa = ultimaDecision(sql, cambio);
      cambios.push(guardarDecision(sql, revaluarConjunto(previa, evaluacion.evaluadoEn), { evaluacion, sha, origen }));
    }
  }
  return cambios;
}

export type ObservacionVigilante =
  | Readonly<{ origen: 'recibo' }>
  | Readonly<{ origen: 'lectura-local'; datos: unknown }>
  | Readonly<{ origen: 'lectura-local'; fallo: true }>;
interface ContextoComprobacion {
  readonly programada: ConfiguracionProgramada | undefined;
  readonly observacion: ObservacionVigilante;
}
/** Precondición sin cambios para una lectura que puede esperar a un proceso externo. */
export function exigirVigilantePreparadoSqlite(sql: SqlAccesoPublico, entrada: unknown, ahora: number): void {
  const config = leerConfiguracionVigilante(entrada);
  validarRelojVigilante(config, ahora);
  sql.transaccion(() => exigirVigilantePreparadoEnTransaccion(sql, config, ahora));
}
/** Solo para un coordinador que ya mantiene una transacción SQLite. */
export function exigirVigilantePreparadoEnTransaccion(sql: SqlAccesoPublico, entrada: unknown, ahora: number): void {
  const config = leerConfiguracionVigilante(entrada);
  validarRelojVigilante(config, ahora);
  const publico = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  if (publico?.version === 1 && !Object.hasOwn(publico, 'vigilante_version') && tablas(sql) === 0) {
    throw new VigilanteNoDisponible('Vigilante sin preparar');
  }
  if (!config.habilitado || metadata(sql, ahora).configuracionSha !== huella(config)) {
    throw new VigilanteNoDisponible('Configuración no preparada');
  }
}
/** El modo existente sigue leyendo exclusivamente el recibo correlacionado. */
export function comprobarVigilanteSqlite(
  sql: SqlAccesoPublico,
  entrada: unknown,
  programada: ConfiguracionProgramada | undefined,
  ahora: number,
) {
  return comprobarObservacion(sql, entrada, { programada, observacion: { origen: 'recibo' } }, ahora);
}
/** La lectura local es explícita: no crea ni reemplaza un recibo, una reserva o una identidad. */
export function comprobarVigilanteConLecturaLocalSqlite(
  sql: SqlAccesoPublico,
  entrada: Readonly<{ configuracion: unknown; datos: unknown; programada?: ConfiguracionProgramada }>,
  ahora: number,
) {
  return comprobarObservacion(
    sql,
    entrada.configuracion,
    {
      programada: entrada.programada,
      observacion: { origen: 'lectura-local', datos: entrada.datos },
    },
    ahora,
  );
}
/** Solo un intento local realmente fallido puede registrar esta observación técnica. */
export function registrarFalloLecturaLocalVigilanteSqlite(
  sql: SqlAccesoPublico,
  configuracion: unknown,
  programada: ConfiguracionProgramada | undefined,
  ahora: number,
) {
  return comprobarObservacion(
    sql,
    configuracion,
    { programada, observacion: { origen: 'lectura-local', fallo: true } },
    ahora,
  );
}
function guardarEvaluacion(
  sql: SqlAccesoPublico,
  evaluacion: EvaluacionVigilante,
  m: ReturnType<typeof metadata>,
  contexto: { firma: string; origen: OrigenDatosVigilante },
) {
  const { firma, origen } = contexto;
  const ahora = evaluacion.evaluadoEn;
  if (m.reloj === ahora && m.huellaEvaluacion !== null && m.huellaEvaluacion !== firma) {
    throw new ConflictoVigilante('Corte incompatible');
  }
  const cambios = guardarCambios(sql, evaluacion, m.configuracionSha, origen);
  const nuevas = cambios.filter((c) => c !== null && typeof c !== 'string');
  const omitidasPorAntiguedad = cambios.filter((c) => typeof c === 'string');
  const revision = m.revision + (nuevas.length ? 1 : 0);
  exigirTrabajo(Number.isSafeInteger(revision));
  if (m.reloj !== ahora || m.huellaEvaluacion !== firma) {
    sql.ejecutar(
      'UPDATE administracion_vigilante SET reloj=?,revision=?,huella_evaluacion=? WHERE id=1',
      ahora,
      revision,
      firma,
    );
  }
  return {
    evaluacion,
    nuevas: Object.freeze(nuevas),
    omitidasPorAntiguedad: Object.freeze(omitidasPorAntiguedad),
    incidencias: Object.freeze(actuales(sql).filter((d) => d.estado === 'incidencia')),
    revision,
  };
}
/** Solo para un coordinador que ya mantiene una transacción SQLite. */
export function comprobarObservacionVigilanteEnTransaccion(
  sql: SqlAccesoPublico,
  entrada: unknown,
  contexto: ContextoComprobacion,
  ahora: number,
) {
  const config = leerConfiguracionVigilante(entrada);
  const { programada, observacion } = contexto;
  const origenDatos = observacion.origen;
  if (!config.habilitado) {
    return {
      origenDatos,
      evaluacion: evaluarVigilante(config, programada, null, ahora),
      nuevas: [],
      omitidasPorAntiguedad: [],
      incidencias: [],
      revision: null,
    };
  }
  const datosLocales =
    observacion.origen === 'lectura-local' && 'datos' in observacion ? leerEstadoDatosPanel(observacion.datos) : null;
  {
    exigirVigilantePreparadoEnTransaccion(sql, config, ahora);
    const m = metadata(sql, ahora);
    const datos =
      origenDatos === 'recibo' ? (leerDatosDelUltimoTrabajoSqlite(sql, ahora)?.datos ?? null) : datosLocales;
    const entradas = {
      ...(origenDatos === 'lectura-local' ? { origenDatos } : {}),
      programacion: leerProgramacionSqlite(sql, ahora),
      trabajo: leerTrabajosSqlite(sql, ahora),
      datos,
      ...leerActivacionVigilanteSqlite(sql, ahora),
    };
    const evaluacion = evaluarVigilante(config, programada, entradas, ahora);
    // Conserva la firma de evaluaciones por recibo anteriores; el canal local queda discriminado.
    const contenidoFirma = { config, programada: programada ?? null, entradas, ahora };
    const firma = huella(origenDatos === 'recibo' ? contenidoFirma : { ...contenidoFirma, origenDatos });
    return { origenDatos, ...guardarEvaluacion(sql, evaluacion, m, { firma, origen: origenDatos }) };
  }
}
function comprobarObservacion(sql: SqlAccesoPublico, entrada: unknown, contexto: ContextoComprobacion, ahora: number) {
  return sql.transaccion(() => comprobarObservacionVigilanteEnTransaccion(sql, entrada, contexto, ahora));
}
export function leerHistorialVigilanteSqlite(
  sql: SqlAccesoPublico,
  ahora: number,
  opciones: { despuesDe?: number; limite?: number; revisionEsperada?: number } = {},
) {
  return sql.transaccion(() => leerHistorialVigilanteEnTransaccion(sql, ahora, opciones));
}
/** Solo para un coordinador que ya mantiene una transacción SQLite. */
export function leerHistorialVigilanteEnTransaccion(
  sql: SqlAccesoPublico,
  ahora: number,
  opciones: { despuesDe?: number; limite?: number; revisionEsperada?: number } = {},
) {
  const m = metadata(sql, ahora);
  const despues = opciones.despuesDe ?? 0;
  const limite = opciones.limite ?? MAX_PAGINA;
  exigirTrabajo(esEnteroTrabajo(despues) && Number.isSafeInteger(limite) && limite > 0 && limite <= MAX_PAGINA);
  exigirTrabajo(despues === 0 || opciones.revisionEsperada !== undefined);
  if (opciones.revisionEsperada !== undefined && opciones.revisionEsperada !== m.revision) {
    throw new ConflictoVigilante('Revisión incompatible');
  }
  const decisiones = sql
    .filas('SELECT * FROM administracion_vigilante_decisiones WHERE id>? ORDER BY id LIMIT ?', despues, limite)
    .map(leerDecision);
  return Object.freeze({
    version: 1,
    revision: m.revision,
    decisiones: Object.freeze(decisiones),
    siguiente: decisiones.length === limite ? (decisiones.at(-1)?.id ?? null) : null,
  });
}
