/**
 * El almacén de la encuesta en el SQLite del objeto durable (y del servidor local), dentro de las mismas transacciones
 * síncronas que el resto del registro. Cinco tablas y ninguna fila por respuesta:
 * - encuesta_codigos: solo la huella de cada código sin usar, su lote y su tipo. Es WITHOUT ROWID con la huella como
 *   clave, así que tampoco hay un número de fila que delate el orden en que se crearon; no hay columna de hora.
 * - encuesta_lotes: cuántos códigos se emitieron y cuántos se han consumido en cada lote, su ronda y el nombre de su
 *   entidad.
 * - encuesta_rondas: cada uso de la encuesta con un grupo, con su nombre, sus días de apertura y cierre y si está
 *   abierta (rondas-sqlite.ts).
 * - encuesta_estado: la versión del esquema y el cuestionario de las celdas (esquema-sqlite.ts los prepara y los migra).
 * - encuesta_recuentos: una celda por ronda, tipo, pregunta y valor del cuestionario, creadas a cero al abrir la ronda.
 * Responder comprueba la huella, la borra y suma las celdas en una sola transacción: lo que queda es un contador más y
 * un código menos, nunca una relación entre los dos. pruebas/encuesta/anonimato.test.ts lo demuestra.
 */
import type { AccesoSesionPanel, SesionPanelActiva, SesionPanelInactiva } from '../administracion/sesion.ts';
import { AlmacenSesionRecorridoSqlite } from '../plataforma/acceso-publico/sesion-recorrido-sqlite.ts';
import { AlmacenSesionPanelSqlite } from '../plataforma/acceso-publico/sesion-sqlite.ts';
import type { SqlAccesoPublico } from '../plataforma/acceso-publico/sqlite.ts';
import {
  type AlmacenEncuesta,
  entero,
  type LoteEncuesta,
  type LoteNuevo,
  leerLoteNuevo,
  leerNombreLote,
  leerRespuestaRecibida,
  leerResultadosEncuesta,
  leerTipo,
  MAX_LOTES,
  type RecuentoPregunta,
  type RecuentosTipo,
  type RespuestaRecibida,
  type ResultadoAbrirRonda,
  type ResultadoCrearLote,
  type ResultadoEncuestaSesion,
  type ResultadosEncuesta,
  type RondaEncuesta,
} from './contrato.ts';
import {
  CUESTIONARIO,
  FILTRO,
  PREGUNTAS,
  resumenDe,
  SIN_VER,
  TIPOS_DE_CODIGO,
  type TipoDeCodigo,
} from './cuestionario.ts';
import { CuestionarioConRespuestas, exigir, prepararEncuestaSqlite } from './esquema-sqlite.ts';
import { abrirRondaSqlite, cerrarRondaSqlite, rondaAbierta, rondas } from './rondas-sqlite.ts';

/** Los lotes de una ronda, en el orden en que se crearon. */
function lotes(sql: SqlAccesoPublico, ronda: number): LoteEncuesta[] {
  const filas = sql.filas(
    'SELECT id,numero,tipo,nombre,emitidos,consumidos FROM encuesta_lotes WHERE ronda=? ORDER BY numero',
    ronda,
  );
  exigir(filas.length <= MAX_LOTES);
  return filas.map((fila) => {
    exigir(typeof fila.id === 'string' && entero(fila.numero) && entero(fila.emitidos) && entero(fila.consumidos));
    exigir(fila.consumidos <= fila.emitidos);
    return {
      id: fila.id,
      numero: fila.numero,
      tipo: leerTipo(fila.tipo),
      nombre: leerNombreLote(fila.nombre),
      emitidos: fila.emitidos,
      consumidos: fila.consumidos,
      sinUsar: fila.emitidos - fila.consumidos,
    };
  });
}
/** De qué ronda y de qué tipo son las celdas que se leen. */
interface Grupo {
  readonly ronda: number;
  readonly tipo: TipoDeCodigo;
}
/** Los recuentos de una pregunta en una ronda, con su escala y su meta calculadas sobre esas mismas celdas. */
function recuentoDe(
  sql: SqlAccesoPublico,
  { ronda, tipo }: Grupo,
  pregunta: string,
  admitidos: readonly string[],
): RecuentoPregunta {
  const valores: Record<string, number> = {};
  let denominador = 0;
  for (const valor of admitidos) {
    const filas = sql.filas(
      'SELECT recuento FROM encuesta_recuentos WHERE ronda=? AND tipo=? AND pregunta=? AND valor=?',
      ronda,
      tipo,
      pregunta,
      valor,
    );
    const recuento = filas[0]?.recuento;
    exigir(filas.length === 1 && entero(recuento));
    valores[valor] = recuento;
    denominador += recuento;
  }
  return { denominador, valores, ...resumenDe(tipo, pregunta, valores) };
}
function recuentosDe(sql: SqlAccesoPublico, ronda: number, tipo: TipoDeCodigo, respuestas: number): RecuentosTipo {
  const preguntas: Record<string, RecuentoPregunta> = {};
  for (const [pregunta, admitidos] of Object.entries(PREGUNTAS[tipo])) {
    preguntas[pregunta] = recuentoDe(sql, { ronda, tipo }, pregunta, admitidos);
  }
  // Cada respuesta consume un código en la misma transacción: los recuentos tienen que cuadrar con los consumidos.
  if (tipo === 'participante') {
    const filtro = preguntas[FILTRO];
    exigir(filtro !== undefined && filtro.denominador === respuestas);
    // La base de las metas: quienes vieron su informe y por eso contestaron todas las demás preguntas.
    const vistos = respuestas - (filtro.valores[SIN_VER] ?? 0);
    exigir(Object.entries(preguntas).every(([p, r]) => p === FILTRO || r.denominador === vistos));
  } else {
    exigir(Object.values(preguntas).every((r) => r.denominador === respuestas));
  }
  return { respuestas, preguntas };
}
/**
 * Los resultados de la ronda con ese número, o los de la última si es null, con la lista de todas las rondas. Una ronda
 * que no existe es una petición defectuosa, no una ronda vacía.
 */
export function leerResultadosSqlite(sql: SqlAccesoPublico, numero: number | null = null): ResultadosEncuesta {
  const todas = rondas(sql);
  const ronda: RondaEncuesta | undefined = numero === null ? todas.at(-1) : todas.find((r) => r.numero === numero);
  exigir(ronda !== undefined);
  const estaAbierta = ronda.abierta;
  const todos = lotes(sql, ronda.numero);
  const totales = Object.fromEntries(
    TIPOS_DE_CODIGO.map((tipo) => {
      const suyos = todos.filter((l) => l.tipo === tipo);
      const emitidos = suyos.reduce((s, l) => s + l.emitidos, 0);
      const consumidos = suyos.reduce((s, l) => s + l.consumidos, 0);
      return [tipo, { emitidos, consumidos, sinUsar: emitidos - consumidos }];
    }),
  ) as ResultadosEncuesta['totales'];
  const recuentos = estaAbierta
    ? null
    : {
        participante: recuentosDe(sql, ronda.numero, 'participante', totales.participante.consumidos),
        profesional: recuentosDe(sql, ronda.numero, 'profesional', totales.profesional.consumidos),
      };
  return leerResultadosEncuesta({
    version: 3,
    ronda,
    rondas: todas,
    cuestionario: CUESTIONARIO,
    abierta: estaAbierta,
    lotes: todos,
    totales,
    recuentos,
  });
}
export function crearLoteSqlite(
  sql: SqlAccesoPublico,
  lote: LoteNuevo,
): { estado: 'creado'; lote: LoteEncuesta } | { estado: 'encuesta_cerrada' | 'lleno' } {
  prepararEncuestaSqlite(sql);
  const ronda = rondaAbierta(sql);
  if (ronda === null) {
    return { estado: 'encuesta_cerrada' };
  }
  // El tope de lotes es de cada ronda; los números de lote siguen de una ronda a otra y nunca se repiten.
  const enLaRonda = sql.filas('SELECT count(*) AS n FROM encuesta_lotes WHERE ronda=?', ronda)[0]?.n;
  const ultimo = sql.filas('SELECT coalesce(max(numero),0) AS n FROM encuesta_lotes')[0]?.n;
  exigir(entero(enLaRonda) && entero(ultimo));
  if (enLaRonda >= MAX_LOTES) {
    return { estado: 'lleno' };
  }
  const numero = ultimo + 1;
  sql.ejecutar(
    'INSERT INTO encuesta_lotes (id,numero,ronda,tipo,emitidos,consumidos,nombre) VALUES(?,?,?,?,?,0,?)',
    lote.id,
    numero,
    ronda,
    lote.tipo,
    lote.huellas.length,
    lote.nombre,
  );
  for (const huella of lote.huellas) {
    sql.ejecutar('INSERT INTO encuesta_codigos VALUES(?,?,?)', huella, lote.id, lote.tipo);
  }
  const creado = lotes(sql, ronda).find((l) => l.id === lote.id);
  exigir(creado !== undefined);
  return { estado: 'creado', lote: creado };
}
/**
 * Comprueba la huella, la borra, cuenta el consumo del lote y suma 1 a cada celda de la respuesta. Un código que no
 * existe y uno ya usado son lo mismo para el almacén: su huella no está, porque al usarse se borró.
 */
export function responderSqlite(sql: SqlAccesoPublico, respuesta: RespuestaRecibida): boolean {
  prepararEncuestaSqlite(sql);
  const ronda = rondaAbierta(sql);
  if (ronda === null) {
    return false;
  }
  const filas = sql.filas('SELECT lote,tipo FROM encuesta_codigos WHERE huella=?', respuesta.huella);
  const fila = filas[0];
  if (fila === undefined || fila.tipo !== respuesta.tipo) {
    return false;
  }
  exigir(typeof fila.lote === 'string');
  sql.ejecutar('DELETE FROM encuesta_codigos WHERE huella=?', respuesta.huella);
  const lote = sql.filas('SELECT ronda,consumidos,emitidos FROM encuesta_lotes WHERE id=?', fila.lote)[0];
  exigir(lote !== undefined && entero(lote.consumidos) && entero(lote.emitidos) && lote.consumidos < lote.emitidos);
  // Al cerrar una ronda se borran sus huellas: una huella que queda es siempre de la ronda abierta.
  exigir(lote.ronda === ronda);
  sql.ejecutar('UPDATE encuesta_lotes SET consumidos=consumidos+1 WHERE id=?', fila.lote);
  for (const celda of respuesta.celdas) {
    const existe = sql.filas(
      'SELECT 1 FROM encuesta_recuentos WHERE ronda=? AND tipo=? AND pregunta=? AND valor=?',
      ronda,
      respuesta.tipo,
      celda.pregunta,
      celda.valor,
    );
    exigir(existe.length === 1);
    sql.ejecutar(
      'UPDATE encuesta_recuentos SET recuento=recuento+1 WHERE ronda=? AND tipo=? AND pregunta=? AND valor=?',
      ronda,
      respuesta.tipo,
      celda.pregunta,
      celda.valor,
    );
  }
  return true;
}
/**
 * Cierra la ronda abierta y devuelve sus resultados: ningún código sin usar vuelve a servir. Cerrar dos veces no cambia
 * nada y devuelve los de la última ronda.
 */
export function cerrarEncuestaSqlite(sql: SqlAccesoPublico, dia: string): ResultadosEncuesta {
  prepararEncuestaSqlite(sql);
  return leerResultadosSqlite(sql, cerrarRondaSqlite(sql, dia));
}
/** Abre una ronda nueva y devuelve sus resultados, vacíos, o por qué no se abre. */
export function abrirRondaEncuestaSqlite(
  sql: SqlAccesoPublico,
  nombre: string,
  dia: string,
): { estado: 'activa'; encuesta: ResultadosEncuesta } | { estado: 'ronda_abierta' | 'lleno' } {
  prepararEncuestaSqlite(sql);
  const abierta = abrirRondaSqlite(sql, nombre, dia);
  return abierta.estado === 'abierta'
    ? { estado: 'activa', encuesta: leerResultadosSqlite(sql, abierta.numero) }
    : { estado: abierta.estado };
}

/** Ejecuta una acción con la sesión del panel comprobada en la misma transacción (AlmacenSesionPanelSqlite.conSesion). */
type EnSesion = <T>(acceso: AccesoSesionPanel, accion: (sesion: SesionPanelActiva) => T) => T | SesionPanelInactiva;

/**
 * Una operación del panel sobre la encuesta, o «cuestionario_anterior» si la encuesta guardada tiene respuestas de otro
 * cuestionario. La preparación lo comprueba antes de escribir nada, así que esa respuesta no deja ningún cambio.
 */
function conCuestionarioVigente<T>(
  sesion: SesionPanelActiva,
  operacion: () => T,
): T | { estado: 'cuestionario_anterior'; sesion: SesionPanelActiva } {
  try {
    return operacion();
  } catch (error) {
    if (error instanceof CuestionarioConRespuestas) {
      return { estado: 'cuestionario_anterior', sesion };
    }
    throw error;
  }
}
/** Las operaciones de la encuesta sobre un SQLite y su comprobación de sesión: las mismas en el objeto durable y en Node. */
function operacionesDeEncuesta(sql: SqlAccesoPublico, enSesion: EnSesion): AlmacenEncuesta {
  return {
    crearLoteDeSesion: async (acceso, entrada) => {
      const lote = leerLoteNuevo(entrada);
      return enSesion(acceso, (sesion) =>
        conCuestionarioVigente(sesion, () => ({ ...crearLoteSqlite(sql, lote), sesion })),
      );
    },
    abrirRondaDeSesion: async (acceso, nombre, dia) =>
      enSesion(acceso, (sesion) =>
        conCuestionarioVigente(sesion, () => ({ ...abrirRondaEncuestaSqlite(sql, nombre, dia), sesion })),
      ),
    cerrarEncuestaDeSesion: async (acceso, dia) =>
      enSesion(acceso, (sesion) =>
        conCuestionarioVigente(sesion, () => ({
          estado: 'activa' as const,
          sesion,
          encuesta: cerrarEncuestaSqlite(sql, dia),
        })),
      ),
    leerResultadosDeSesion: async (acceso, ronda) =>
      enSesion(acceso, (sesion) =>
        conCuestionarioVigente(sesion, () => {
          prepararEncuestaSqlite(sql);
          return { estado: 'activa' as const, sesion, encuesta: leerResultadosSqlite(sql, ronda) };
        }),
      ),
    responder: async (entrada) => {
      const respuesta = leerRespuestaRecibida(entrada);
      return sql.transaccion(() => responderSqlite(sql, respuesta));
    },
  };
}

/** El almacén de sesión del objeto durable, con la encuesta: el panel comprueba la sesión en su misma transacción. */
export class AlmacenSesionEncuestaSqlite extends AlmacenSesionRecorridoSqlite implements AlmacenEncuesta {
  private readonly encuesta = operacionesDeEncuesta(this.sql, (acceso, accion) => this.conSesion(acceso, accion));
  crearLoteDeSesion(acceso: AccesoSesionPanel, lote: LoteNuevo): Promise<ResultadoCrearLote> {
    return this.encuesta.crearLoteDeSesion(acceso, lote);
  }
  abrirRondaDeSesion(acceso: AccesoSesionPanel, nombre: string, dia: string): Promise<ResultadoAbrirRonda> {
    return this.encuesta.abrirRondaDeSesion(acceso, nombre, dia);
  }
  cerrarEncuestaDeSesion(acceso: AccesoSesionPanel, dia: string): Promise<ResultadoEncuestaSesion> {
    return this.encuesta.cerrarEncuestaDeSesion(acceso, dia);
  }
  leerResultadosDeSesion(acceso: AccesoSesionPanel, ronda: number | null): Promise<ResultadoEncuestaSesion> {
    return this.encuesta.leerResultadosDeSesion(acceso, ronda);
  }
  responder(respuesta: RespuestaRecibida): Promise<boolean> {
    return this.encuesta.responder(respuesta);
  }
}

/**
 * El mismo almacén para el servidor local de Node, sobre el almacén de sesión del panel de Node (que no lleva el
 * recorrido administrado del Worker). La sesión vive en la base: se comprueba igual, en la transacción de cada operación.
 */
export class AlmacenSesionEncuestaPanelSqlite extends AlmacenSesionPanelSqlite implements AlmacenEncuesta {
  private readonly encuesta = operacionesDeEncuesta(this.sql, (acceso, accion) => this.conSesion(acceso, accion));
  crearLoteDeSesion(acceso: AccesoSesionPanel, lote: LoteNuevo): Promise<ResultadoCrearLote> {
    return this.encuesta.crearLoteDeSesion(acceso, lote);
  }
  abrirRondaDeSesion(acceso: AccesoSesionPanel, nombre: string, dia: string): Promise<ResultadoAbrirRonda> {
    return this.encuesta.abrirRondaDeSesion(acceso, nombre, dia);
  }
  cerrarEncuestaDeSesion(acceso: AccesoSesionPanel, dia: string): Promise<ResultadoEncuestaSesion> {
    return this.encuesta.cerrarEncuestaDeSesion(acceso, dia);
  }
  leerResultadosDeSesion(acceso: AccesoSesionPanel, ronda: number | null): Promise<ResultadoEncuestaSesion> {
    return this.encuesta.leerResultadosDeSesion(acceso, ronda);
  }
  responder(respuesta: RespuestaRecibida): Promise<boolean> {
    return this.encuesta.responder(respuesta);
  }
}
