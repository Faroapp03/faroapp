/**
 * Contrato de la encuesta de Faro: rondas, lotes, respuestas y resultados agregados del cuestionario (cuestionario.ts).
 * Cada uso con un grupo es una ronda con sus lotes y sus recuentos; solo una está abierta a la vez.
 * Nada de este contrato identifica a una persona: no hay texto libre, ni hora, ni código, ni datos del informe. Los
 * lectores son estrictos y cerrados para que un mensaje defectuoso no pueda introducir campos en el almacén ni en una
 * respuesta del panel. docs/encuesta.md explica la garantía completa.
 */
import type { AccesoSesionPanel, SesionPanelActiva, SesionPanelInactiva } from '../administracion/sesion.ts';
import {
  CUESTIONARIO,
  type EscalaPregunta,
  esPuntoDeEscala,
  FILTRO,
  type MetaPregunta,
  PREGUNTAS,
  resumenDe,
  SIN_VER,
  TIPOS_DE_CODIGO,
  type TipoDeCodigo,
} from './cuestionario.ts';

/** Un lote tiene como mucho tantos códigos como caben sus huellas en un mensaje privado del objeto durable (16 KiB). */
export const MAX_CODIGOS_POR_LOTE = 200;
/** Un lote de uno o dos códigos dejaría ver, por su consumo, si esa persona concreta ha respondido. */
export const MIN_CODIGOS_POR_LOTE = 3;
/** Lotes de una ronda: acota la respuesta de resultados y el almacén. */
export const MAX_LOTES = 50;
/** Rondas de una encuesta: acota la lista que acompaña a cada resultado y el almacén. */
export const MAX_RONDAS = 20;
/** La primera ronda: la del piloto, la que había antes de que la encuesta tuviera rondas. */
export const NOMBRE_PRIMERA_RONDA = 'Piloto Citilab';
/** La versión de los resultados: la 3 es la primera con rondas. */
const VERSION_RESULTADOS = 3;
/** Un día del calendario en UTC, sin hora: la fecha en que se abre o se cierra una ronda. */
const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const ID_LOTE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const HUELLA = /^[0-9a-f]{64}$/;
/** El nombre de la entidad a la que va un lote: texto llano, sin saltos de línea ni caracteres invisibles. */
export const MAX_NOMBRE_LOTE = 60;
/**
 * Lo que no es texto llano a la vista: controles (saltos de línea incluidos), formato invisible, sustitutos sueltos, uso
 * privado, puntos sin asignar, separadores de línea o de párrafo y los rellenos que se ven en blanco aunque sean letras
 * o símbolos (los de hangul y el braille vacío).
 */
const NO_LLANO = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/u;
/** Al menos un carácter que se ve: una letra, una cifra, un signo de puntuación o un símbolo. */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** Una celda del agregado: una pregunta de un tipo y uno de sus valores. */
export interface Celda {
  readonly pregunta: string;
  readonly valor: string;
}
export interface SolicitudCrearLote {
  readonly tipo: TipoDeCodigo;
  readonly cantidad: number;
  /** La entidad a la que va el lote, para quien administra; null si no se dio. No es un dato personal. */
  readonly nombre: string | null;
}
/** Lo que recibe el almacén al crear un lote: su identificador, su tipo y solo las huellas, ordenadas por su valor. */
export interface LoteNuevo {
  readonly id: string;
  readonly tipo: TipoDeCodigo;
  readonly nombre: string | null;
  readonly huellas: readonly string[];
}
/** Lo que recibe el almacén de una respuesta: la huella del código, su tipo y las celdas que suma. */
export interface RespuestaRecibida {
  readonly huella: string;
  readonly tipo: TipoDeCodigo;
  readonly celdas: readonly Celda[];
}
export interface LoteEncuesta {
  readonly id: string;
  readonly numero: number;
  readonly tipo: TipoDeCodigo;
  readonly nombre: string | null;
  readonly emitidos: number;
  readonly consumidos: number;
  readonly sinUsar: number;
}
export interface TotalesTipo {
  readonly emitidos: number;
  readonly consumidos: number;
  readonly sinUsar: number;
}
/**
 * Los recuentos de una pregunta: denominador es cuántas personas la contestaron y valores, cuántas eligieron cada valor.
 * escala y meta salen de esos mismos recuentos (cuestionario.ts) para que el panel no tenga que deducir ninguna regla.
 */
export interface RecuentoPregunta {
  readonly denominador: number;
  readonly valores: Readonly<Record<string, number>>;
  readonly escala: EscalaPregunta | null;
  readonly meta: MetaPregunta | null;
}
export interface RecuentosTipo {
  readonly respuestas: number;
  readonly preguntas: Readonly<Record<string, RecuentoPregunta>>;
}
/**
 * Una ronda tal como la ve el panel. inicio y cierre son días (AAAA-MM-DD) o null si no se conocen: la primera ronda
 * nace de la encuesta que había antes de las rondas, que no guardaba fechas. invitaciones y respuestas son los códigos
 * emitidos y usados en todos sus lotes, las mismas cifras que los totales.
 */
export interface RondaEncuesta {
  readonly numero: number;
  readonly nombre: string;
  readonly inicio: string | null;
  readonly cierre: string | null;
  readonly abierta: boolean;
  readonly invitaciones: number;
  readonly respuestas: number;
}
/** Los resultados de una ronda, con la lista de todas: abierta, lotes, totales y recuentos son los de `ronda`. */
export interface ResultadosEncuesta {
  readonly version: 3;
  readonly ronda: RondaEncuesta;
  readonly rondas: readonly RondaEncuesta[];
  /** El cuestionario al que pertenecen todos los recuentos. */
  readonly cuestionario: typeof CUESTIONARIO;
  readonly abierta: boolean;
  readonly lotes: readonly LoteEncuesta[];
  readonly totales: Readonly<Record<TipoDeCodigo, TotalesTipo>>;
  /** Solo con la encuesta cerrada: mientras está abierta, ver cambiar un recuento delataría una respuesta concreta. */
  readonly recuentos: Readonly<Record<TipoDeCodigo, RecuentosTipo>> | null;
}
/**
 * La encuesta guardada tiene respuestas de un cuestionario anterior y no se abre para no mezclarlas
 * (esquema-sqlite.ts): el panel lo dice con este estado y no recibe nada de esas respuestas.
 */
export type CuestionarioAnterior = { readonly estado: 'cuestionario_anterior'; readonly sesion: SesionPanelActiva };
export type ResultadoEncuestaSesion =
  | { readonly estado: 'activa'; readonly sesion: SesionPanelActiva; readonly encuesta: ResultadosEncuesta }
  | CuestionarioAnterior
  | SesionPanelInactiva;
export type ResultadoAbrirRonda =
  | { readonly estado: 'activa'; readonly sesion: SesionPanelActiva; readonly encuesta: ResultadosEncuesta }
  | { readonly estado: 'ronda_abierta' | 'lleno'; readonly sesion: SesionPanelActiva }
  | CuestionarioAnterior
  | SesionPanelInactiva;
export type ResultadoCrearLote =
  | { readonly estado: 'creado'; readonly sesion: SesionPanelActiva; readonly lote: LoteEncuesta }
  | { readonly estado: 'encuesta_cerrada' | 'lleno'; readonly sesion: SesionPanelActiva }
  | CuestionarioAnterior
  | SesionPanelInactiva;

export interface AlmacenEncuestaPanel {
  crearLoteDeSesion(acceso: AccesoSesionPanel, lote: LoteNuevo): Promise<ResultadoCrearLote>;
  /** Abre una ronda nueva el día dado, si no hay ninguna abierta. */
  abrirRondaDeSesion(acceso: AccesoSesionPanel, nombre: string, dia: string): Promise<ResultadoAbrirRonda>;
  /** Cierra la ronda abierta el día dado; sin ninguna abierta, no cambia nada. */
  cerrarEncuestaDeSesion(acceso: AccesoSesionPanel, dia: string): Promise<ResultadoEncuestaSesion>;
  /** Los resultados de la ronda con ese número, o los de la última si es null. */
  leerResultadosDeSesion(acceso: AccesoSesionPanel, ronda: number | null): Promise<ResultadoEncuestaSesion>;
}
export interface AlmacenEncuesta extends AlmacenEncuestaPanel {
  /** Comprueba la huella, la borra y suma las celdas en una sola transacción; false si el código no sirve. */
  responder(respuesta: RespuestaRecibida): Promise<boolean>;
}

/** Error de entrada sin valores de la petición: no copia códigos ni respuestas. */
export class EncuestaInvalida extends Error {
  override readonly name = 'EncuestaInvalida';
  constructor() {
    super('Mensaje de encuesta no válido');
  }
}
/** Una petición de lote correcta salvo porque pide menos códigos que el mínimo: quien opera recibe un error que lo dice. */
export class LoteDemasiadoPequeno extends Error {
  override readonly name = 'LoteDemasiadoPequeno';
  constructor() {
    super('El lote pide menos códigos que el mínimo');
  }
}
/** Exige una condición del contrato: si no se cumple, EncuestaInvalida sin valores de la petición. */
export function exigirContrato(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new EncuestaInvalida();
  }
}
/** Un objeto plano con exactamente estas claves propias, enumerables y de datos; devuelve una copia. */
export function objetoCerrado(entrada: unknown, claves: readonly string[]): Record<string, unknown> {
  exigirContrato(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const prototipo: unknown = Object.getPrototypeOf(entrada);
  exigirContrato(
    (prototipo === Object.prototype || prototipo === null) && Object.getOwnPropertySymbols(entrada).length === 0,
  );
  const propias = Object.getOwnPropertyNames(entrada);
  exigirContrato(propias.length === claves.length && claves.every((clave) => propias.includes(clave)));
  const copia: Record<string, unknown> = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigirContrato(descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true);
    copia[clave] = descriptor.value;
  }
  return copia;
}
export function entero(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}
export function leerTipo(valor: unknown): TipoDeCodigo {
  exigirContrato(valor === 'participante' || valor === 'profesional');
  return valor;
}
/** El nombre de un lote: null, o texto llano de 1 a 60 caracteres, sin espacios al principio ni al final. */
export function leerNombreLote(valor: unknown): string | null {
  if (valor === null) {
    return null;
  }
  exigirContrato(typeof valor === 'string' && valor.isWellFormed() && valor === valor.trim());
  exigirContrato(!NO_LLANO.test(valor) && VISIBLE.test(valor));
  const caracteres = [...valor].length;
  exigirContrato(caracteres >= 1 && caracteres <= MAX_NOMBRE_LOTE);
  return valor;
}
/** El nombre de una ronda: texto llano de 1 a 60 caracteres, como el de un lote, pero obligatorio. */
export function leerNombreRonda(valor: unknown): string {
  const nombre = leerNombreLote(valor);
  exigirContrato(nombre !== null);
  return nombre;
}
/**
 * Un día AAAA-MM-DD que existe en el calendario. Date.UTC es aritmética del calendario y no lee el reloj: el contrato y
 * el almacén de la encuesta no conocen la hora (pruebas/encuesta/anonimato.test.ts). El día 0 de un mes es el último
 * del anterior.
 */
export function leerDia(valor: unknown): string {
  exigirContrato(typeof valor === 'string' && DIA.test(valor));
  const [anio, mes, dia] = valor.split('-').map(Number) as [number, number, number];
  exigirContrato(Date.UTC(anio, mes - 1, dia) <= Date.UTC(anio, mes, 0));
  return valor;
}
/** El número de una ronda que se pide: null para la última. */
export function leerNumeroRonda(valor: unknown): number | null {
  exigirContrato(valor === null || (entero(valor) && valor >= 1));
  return valor;
}
export function leerSolicitudCrearLote(entrada: unknown): SolicitudCrearLote {
  const conNombre = entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, 'nombre');
  const o = objetoCerrado(entrada, conNombre ? ['tipo', 'cantidad', 'nombre'] : ['tipo', 'cantidad']);
  // Sin nombre, o con null, el lote no lleva ninguno.
  const nombre = conNombre ? leerNombreLote(o.nombre) : null;
  exigirContrato(entero(o.cantidad) && o.cantidad <= MAX_CODIGOS_POR_LOTE);
  const tipo = leerTipo(o.tipo);
  if (o.cantidad < MIN_CODIGOS_POR_LOTE) {
    throw new LoteDemasiadoPequeno();
  }
  return { tipo, cantidad: o.cantidad, nombre };
}
export function leerLoteNuevo(entrada: unknown): LoteNuevo {
  const o = objetoCerrado(entrada, ['id', 'tipo', 'nombre', 'huellas']);
  exigirContrato(typeof o.id === 'string' && ID_LOTE.test(o.id));
  const nombre = leerNombreLote(o.nombre);
  exigirContrato(
    Array.isArray(o.huellas) && o.huellas.length >= MIN_CODIGOS_POR_LOTE && o.huellas.length <= MAX_CODIGOS_POR_LOTE,
  );
  const huellas = o.huellas.map((h: unknown) => {
    exigirContrato(typeof h === 'string' && HUELLA.test(h));
    return h;
  });
  // Ordenadas por su valor y sin repetir: el orden del mensaje no puede llevar el orden en que se generaron.
  exigirContrato(huellas.every((h, i) => i === 0 || (huellas[i - 1] as string) < h));
  return { id: o.id, tipo: leerTipo(o.tipo), nombre, huellas };
}

/**
 * Un punto de la escala llega como número entero y se guarda como su texto; cualquier otro valor llega como texto. Así
 * «4» como texto o 4 en una pregunta sin escala no pasan por una respuesta válida.
 */
function valorDe(valores: readonly string[], recibido: unknown): string {
  const comoNumero = typeof recibido === 'number' && Number.isSafeInteger(recibido);
  const texto = comoNumero ? String(recibido) : recibido;
  exigirContrato(typeof texto === 'string' && valores.includes(texto) && esPuntoDeEscala(texto) === comoNumero);
  return texto;
}
/**
 * Las celdas que suma una respuesta, validadas contra las preguntas de su tipo. Quien no pudo ver su informe solo
 * contesta el filtro; el resto contesta todas las preguntas de su tipo, sin campos de más ni de menos.
 */
export function leerRespuestas(tipo: TipoDeCodigo, entrada: unknown): readonly Celda[] {
  const preguntas: Readonly<Record<string, readonly string[]>> = PREGUNTAS[tipo];
  if (tipo === 'participante') {
    exigirContrato(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
    const filtro = Object.getOwnPropertyDescriptor(entrada, FILTRO);
    if (filtro !== undefined && 'value' in filtro && filtro.value === SIN_VER) {
      objetoCerrado(entrada, [FILTRO]);
      return [{ pregunta: FILTRO, valor: SIN_VER }];
    }
  }
  const nombres = Object.keys(preguntas);
  const o = objetoCerrado(entrada, nombres);
  return nombres.map((pregunta) => ({ pregunta, valor: valorDe(preguntas[pregunta] ?? [], o[pregunta]) }));
}
/** Las celdas ya leídas, otra vez comprobadas al cruzar el enlace privado del objeto durable. */
export function leerRespuestaRecibida(entrada: unknown): RespuestaRecibida {
  const o = objetoCerrado(entrada, ['huella', 'tipo', 'celdas']);
  exigirContrato(typeof o.huella === 'string' && HUELLA.test(o.huella) && Array.isArray(o.celdas));
  const tipo = leerTipo(o.tipo);
  const celdas = o.celdas.map((c: unknown) => objetoCerrado(c, ['pregunta', 'valor']));
  // Sin prototipo: una pregunta llamada «__proto__» o «toString» no puede tocar el objeto ni pasar por heredada.
  const respuestas: Record<string, unknown> = Object.create(null);
  const definidas: Readonly<Record<string, readonly string[]>> = PREGUNTAS[tipo];
  for (const celda of celdas) {
    exigirContrato(typeof celda.pregunta === 'string' && typeof celda.valor === 'string');
    exigirContrato(Object.hasOwn(definidas, celda.pregunta) && !Object.hasOwn(respuestas, celda.pregunta));
    respuestas[celda.pregunta] = esPuntoDeEscala(celda.valor) ? Number(celda.valor) : celda.valor;
  }
  return { huella: o.huella, tipo, celdas: leerRespuestas(tipo, respuestas) };
}

export function leerLote(entrada: unknown): LoteEncuesta {
  const o = objetoCerrado(entrada, ['id', 'numero', 'tipo', 'nombre', 'emitidos', 'consumidos', 'sinUsar']);
  exigirContrato(typeof o.id === 'string' && ID_LOTE.test(o.id) && entero(o.numero) && o.numero >= 1);
  exigirContrato(entero(o.emitidos) && entero(o.consumidos) && entero(o.sinUsar));
  exigirContrato(o.consumidos + o.sinUsar === o.emitidos);
  return {
    id: o.id,
    numero: o.numero,
    tipo: leerTipo(o.tipo),
    nombre: leerNombreLote(o.nombre),
    emitidos: o.emitidos,
    consumidos: o.consumidos,
    sinUsar: o.sinUsar,
  };
}
function leerTotales(entrada: unknown): TotalesTipo {
  const o = objetoCerrado(entrada, ['emitidos', 'consumidos', 'sinUsar']);
  exigirContrato(
    entero(o.emitidos) && entero(o.consumidos) && entero(o.sinUsar) && o.consumidos + o.sinUsar === o.emitidos,
  );
  return { emitidos: o.emitidos, consumidos: o.consumidos, sinUsar: o.sinUsar };
}
/** Un resumen recibido tiene que ser exactamente el que sale de los recuentos: null, o las mismas claves y cifras. */
function exigirIgual(recibido: unknown, esperado: EscalaPregunta | MetaPregunta | null): void {
  if (esperado === null) {
    exigirContrato(recibido === null);
    return;
  }
  const campos = Object.entries(esperado);
  const o = objetoCerrado(
    recibido,
    campos.map(([clave]) => clave),
  );
  exigirContrato(campos.every(([clave, valor]) => o[clave] === valor));
}
function leerRecuentoPregunta(tipo: TipoDeCodigo, pregunta: string, entrada: unknown): RecuentoPregunta {
  const admitidos: readonly string[] = (PREGUNTAS[tipo] as Readonly<Record<string, readonly string[]>>)[pregunta] ?? [];
  const r = objetoCerrado(entrada, ['denominador', 'valores', 'escala', 'meta']);
  const v = objetoCerrado(r.valores, admitidos);
  exigirContrato(entero(r.denominador));
  const valores: Record<string, number> = {};
  let suma = 0;
  for (const valor of admitidos) {
    const n = v[valor];
    exigirContrato(entero(n));
    valores[valor] = n;
    suma += n;
  }
  exigirContrato(suma === r.denominador);
  const resumen = resumenDe(tipo, pregunta, valores);
  exigirIgual(r.escala, resumen.escala);
  exigirIgual(r.meta, resumen.meta);
  return { denominador: r.denominador, valores, ...resumen };
}
function leerRecuentosTipo(tipo: TipoDeCodigo, entrada: unknown): RecuentosTipo {
  const o = objetoCerrado(entrada, ['respuestas', 'preguntas']);
  exigirContrato(entero(o.respuestas));
  const nombres = Object.keys(PREGUNTAS[tipo]);
  const p = objetoCerrado(o.preguntas, nombres);
  const preguntas: Record<string, RecuentoPregunta> = {};
  for (const pregunta of nombres) {
    preguntas[pregunta] = leerRecuentoPregunta(tipo, pregunta, p[pregunta]);
  }
  return { respuestas: o.respuestas, preguntas };
}
function leerRonda(entrada: unknown): RondaEncuesta {
  const o = objetoCerrado(entrada, ['numero', 'nombre', 'inicio', 'cierre', 'abierta', 'invitaciones', 'respuestas']);
  exigirContrato(entero(o.numero) && o.numero >= 1 && typeof o.abierta === 'boolean');
  exigirContrato(entero(o.invitaciones) && entero(o.respuestas) && o.respuestas <= o.invitaciones);
  const inicio = o.inicio === null ? null : leerDia(o.inicio);
  const cierre = o.cierre === null ? null : leerDia(o.cierre);
  // Una ronda abierta no tiene cierre, y ninguna se cierra antes de abrirse.
  exigirContrato(!o.abierta || cierre === null);
  exigirContrato(inicio === null || cierre === null || inicio <= cierre);
  const nombre = leerNombreRonda(o.nombre);
  return {
    numero: o.numero,
    nombre,
    inicio,
    cierre,
    abierta: o.abierta,
    invitaciones: o.invitaciones,
    respuestas: o.respuestas,
  };
}
/** Las rondas en orden, todas distintas, como mucho una abierta y, si la hay, la última. */
function leerRondas(entrada: unknown): RondaEncuesta[] {
  exigirContrato(Array.isArray(entrada) && entrada.length >= 1 && entrada.length <= MAX_RONDAS);
  const rondas = entrada.map(leerRonda);
  exigirContrato(rondas.every((r, i) => i === 0 || (rondas[i - 1] as RondaEncuesta).numero < r.numero));
  exigirContrato(rondas.every((r, i) => !r.abierta || i === rondas.length - 1));
  return rondas;
}
export function leerResultadosEncuesta(entrada: unknown): ResultadosEncuesta {
  const o = objetoCerrado(entrada, [
    'version',
    'ronda',
    'rondas',
    'cuestionario',
    'abierta',
    'lotes',
    'totales',
    'recuentos',
  ]);
  exigirContrato(o.version === VERSION_RESULTADOS && o.cuestionario === CUESTIONARIO && typeof o.abierta === 'boolean');
  const ronda = leerRonda(o.ronda);
  const rondas = leerRondas(o.rondas);
  // La ronda de los resultados es una de la lista, con sus mismas cifras.
  exigirContrato(rondas.some((r) => JSON.stringify(r) === JSON.stringify(ronda)) && ronda.abierta === o.abierta);
  exigirContrato(Array.isArray(o.lotes) && o.lotes.length <= MAX_LOTES);
  const lotes = o.lotes.map(leerLote);
  exigirContrato(new Set(lotes.map((l) => l.id)).size === lotes.length);
  const t = objetoCerrado(o.totales, TIPOS_DE_CODIGO);
  const totales = { participante: leerTotales(t.participante), profesional: leerTotales(t.profesional) };
  let recuentos: ResultadosEncuesta['recuentos'] = null;
  if (o.recuentos !== null) {
    exigirContrato(!o.abierta);
    const r = objetoCerrado(o.recuentos, TIPOS_DE_CODIGO);
    recuentos = {
      participante: leerRecuentosTipo('participante', r.participante),
      profesional: leerRecuentosTipo('profesional', r.profesional),
    };
  } else {
    exigirContrato(o.abierta);
  }
  const total = (campo: 'emitidos' | 'consumidos') => totales.participante[campo] + totales.profesional[campo];
  exigirContrato(total('emitidos') === ronda.invitaciones && total('consumidos') === ronda.respuestas);
  return {
    version: VERSION_RESULTADOS,
    ronda,
    rondas,
    cuestionario: CUESTIONARIO,
    abierta: o.abierta,
    lotes,
    totales,
    recuentos,
  };
}
