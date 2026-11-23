/**
 * Las operaciones de la encuesta en el panel: abrir una ronda, crear un lote, cerrar la ronda y leer los resultados de
 * cualquier ronda. Access, origen y
 * token ya los ha comprobado el enrutador (administracion/http.ts); la sesión se comprueba en la transacción del
 * almacén. Los códigos en claro solo existen en la respuesta de «crear lote», una sola vez y barajados: el almacén
 * recibe sus huellas ordenadas por valor, sin el orden en que se generaron.
 */

import type { AccesoSesionPanel, AlmacenSesionPanel, EstadoSesionPanel } from '../administracion/sesion.ts';
import { leerEstadoSesionPanel } from '../administracion/sesion.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { barajar, codigoNuevo, huellaDelCodigo } from './codigos.ts';
import {
  type AlmacenEncuesta,
  type AlmacenEncuestaPanel,
  EncuestaInvalida,
  LoteDemasiadoPequeno,
  leerNombreRonda,
  leerNumeroRonda,
  leerSolicitudCrearLote,
  MIN_CODIGOS_POR_LOTE,
  objetoCerrado,
  type ResultadoEncuestaSesion,
  type SolicitudCrearLote,
} from './contrato.ts';
import { leerResultadoAbrirRonda, leerResultadoCrearLote, leerResultadoEncuestaSesion } from './contrato-sesion.ts';
import type { TipoDeCodigo } from './cuestionario.ts';

/** El almacén que necesitan estas operaciones, con el nombre con que lo usa el enrutador del panel. */
export type AlmacenPanel = AlmacenEncuestaPanel;
/** La administración montada lleva también el almacén del punto público, que atiende el servidor local (entrada-node.ts). */
export interface ConAlmacenDeEncuesta {
  readonly encuesta?: Pick<AlmacenEncuesta, 'responder'>;
}
export type Operacion = 'encuestaAbrirRonda' | 'encuestaCrearLote' | 'encuestaCerrar' | 'encuestaResultados';
export const RUTAS: ReadonlyArray<readonly [string, Operacion]> = [
  ['/administracion/api/encuesta/abrir-ronda', 'encuestaAbrirRonda'],
  ['/administracion/api/encuesta/crear-lote', 'encuestaCrearLote'],
  ['/administracion/api/encuesta/cerrar', 'encuestaCerrar'],
  ['/administracion/api/encuesta/resultados', 'encuestaResultados'],
];
const OPERACIONES = new Set<string>(RUTAS.map(([, operacion]) => operacion));
export function esOperacion(operacion: string): operacion is Operacion {
  return OPERACIONES.has(operacion);
}
/** La opción del enrutador solo cuando el montaje tiene almacén de encuesta: sin él, las operaciones responden 503. */
export function conEncuesta(opciones: { readonly encuesta?: AlmacenEncuestaPanel }): {
  readonly encuesta?: AlmacenEncuestaPanel;
} {
  return opciones.encuesta ? { encuesta: opciones.encuesta } : {};
}
/**
 * La dirección que lleva cada código, siempre en el fragmento, que el navegador no envía al servidor ni a la
 * procedencia. Quien participa entra por el inicio con su invitación y responde al terminar el recorrido
 * (web/scripts/invitacion.js); las profesionales van directas a la encuesta.
 */
export function enlaceDelCodigo(codigo: string, tipo: TipoDeCodigo): string {
  return tipo === 'participante' ? `/inicio.html#invitacion=${codigo}` : `/encuesta.html#codigo=${codigo}`;
}

/**
 * El código cerrado con que el panel sabe que la encuesta guardada tiene respuestas de un cuestionario anterior: no
 * lleva ningún dato de esas respuestas, solo el motivo para explicar qué hacer.
 */
const CUESTIONARIO_ANTERIOR = 'cuestionario_anterior';
/** El error que recibe el panel cuando no se crea un lote. */
const ERROR_DE_LOTE = {
  lleno: 'limite_lotes',
  encuesta_cerrada: 'encuesta_cerrada',
  cuestionario_anterior: CUESTIONARIO_ANTERIOR,
} as const;
/** El error que recibe el panel cuando no se abre una ronda. */
const ERROR_DE_RONDA = {
  ronda_abierta: 'ronda_abierta',
  lleno: 'limite_rondas',
  cuestionario_anterior: CUESTIONARIO_ANTERIOR,
} as const;
/** El día de hoy en UTC: las rondas guardan el día en que se abren y se cierran, nunca la hora. */
function hoy(): string {
  return new Date().toISOString().slice(0, 'AAAA-MM-DD'.length);
}
interface Ayudas {
  readonly senal: AbortSignal;
  respuesta(datos: object, estado?: number): Response;
  respuestaSesion(sesion: EstadoSesionPanel): Response;
  rechazar(estado: number, codigo: string): never;
}
interface OpcionesEncuestaPanel {
  readonly almacen: AlmacenSesionPanel;
  readonly encuesta?: AlmacenEncuestaPanel;
}

/** La petición de lote leída, o su rechazo: un lote por debajo del mínimo dice a quien opera cuál es ese mínimo. */
function solicitudDe(cuerpo: Record<string, unknown>, ayudas: Ayudas): SolicitudCrearLote | Response {
  try {
    return leerSolicitudCrearLote(cuerpo);
  } catch (error) {
    if (error instanceof LoteDemasiadoPequeno) {
      const rechazo = { error: 'lote_demasiado_pequeno', minimo: MIN_CODIGOS_POR_LOTE };
      return ayudas.respuesta(rechazo, ESTADO_HTTP.solicitudIncorrecta);
    }
    if (error instanceof EncuestaInvalida) {
      ayudas.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    throw error;
  }
}
/** Códigos distintos del tipo pedido. Con 140 bits al azar una repetición no se espera nunca; si ocurre, se descarta. */
function codigosNuevos({ tipo, cantidad }: SolicitudCrearLote): string[] {
  const codigos = new Set<string>();
  while (codigos.size < cantidad) {
    codigos.add(codigoNuevo(tipo));
  }
  return [...codigos];
}
async function crearLote(
  encuesta: AlmacenEncuestaPanel,
  acceso: AccesoSesionPanel,
  cuerpo: Record<string, unknown>,
  ayudas: Ayudas,
): Promise<Response> {
  const solicitud = solicitudDe(cuerpo, ayudas);
  if (solicitud instanceof Response) {
    return solicitud;
  }
  const codigos = codigosNuevos(solicitud);
  const huellas = codigos.map(huellaDelCodigo).sort();
  const lote = { id: crypto.randomUUID(), tipo: solicitud.tipo, nombre: solicitud.nombre, huellas };
  const resultado = leerResultadoCrearLote(await encuesta.crearLoteDeSesion(acceso, lote));
  ayudas.senal.throwIfAborted();
  if (!('sesion' in resultado)) {
    return ayudas.respuestaSesion(resultado);
  }
  if (resultado.estado !== 'creado') {
    return ayudas.respuesta({ error: ERROR_DE_LOTE[resultado.estado] }, ESTADO_HTTP.conflicto);
  }
  return ayudas.respuesta({
    estado: 'activa',
    sesion: resultado.sesion,
    lote: resultado.lote,
    codigos: barajar(codigos).map((codigo) => ({ codigo, enlaceRelativo: enlaceDelCodigo(codigo, solicitud.tipo) })),
  });
}
/** El cuerpo de una petición del panel con exactamente estas claves, o su rechazo como solicitud defectuosa. */
function cuerpoCon(
  cuerpo: Record<string, unknown>,
  claves: readonly string[],
  ayudas: Ayudas,
): Record<string, unknown> {
  try {
    return objetoCerrado(cuerpo, claves);
  } catch (error) {
    if (error instanceof EncuestaInvalida) {
      ayudas.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    throw error;
  }
}
async function abrirRonda(
  encuesta: AlmacenEncuestaPanel,
  acceso: AccesoSesionPanel,
  cuerpo: Record<string, unknown>,
  ayudas: Ayudas,
): Promise<Response> {
  const { nombre } = cuerpoCon(cuerpo, ['nombre'], ayudas);
  let leido: string;
  try {
    leido = leerNombreRonda(nombre);
  } catch (error) {
    if (error instanceof EncuestaInvalida) {
      ayudas.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'nombre_invalido');
    }
    throw error;
  }
  const resultado = leerResultadoAbrirRonda(await encuesta.abrirRondaDeSesion(acceso, leido, hoy()));
  ayudas.senal.throwIfAborted();
  if (!('sesion' in resultado)) {
    return ayudas.respuestaSesion(resultado);
  }
  if (resultado.estado !== 'activa') {
    return ayudas.respuesta({ error: ERROR_DE_RONDA[resultado.estado] }, ESTADO_HTTP.conflicto);
  }
  return ayudas.respuesta(resultado);
}
/** La ronda cuyos resultados se piden: ninguna en el cuerpo es la última. */
function rondaPedida(cuerpo: Record<string, unknown>, ayudas: Ayudas): number | null {
  if (Object.keys(cuerpo).length === 0) {
    return null;
  }
  const { ronda } = cuerpoCon(cuerpo, ['ronda'], ayudas);
  try {
    const numero = leerNumeroRonda(ronda);
    if (numero !== null) {
      return numero;
    }
  } catch (error) {
    if (!(error instanceof EncuestaInvalida)) {
      throw error;
    }
  }
  return ayudas.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
}
function respuestaDeResultados(resultado: ResultadoEncuestaSesion, ayudas: Ayudas): Response {
  if (!('sesion' in resultado)) {
    return ayudas.respuestaSesion(resultado);
  }
  if (resultado.estado === 'cuestionario_anterior') {
    return ayudas.respuesta({ error: CUESTIONARIO_ANTERIOR }, ESTADO_HTTP.conflicto);
  }
  return ayudas.respuesta(resultado);
}
export async function operar(
  opciones: OpcionesEncuestaPanel,
  acceso: AccesoSesionPanel,
  { operacion, cuerpo }: { operacion: Operacion; cuerpo: Record<string, unknown> },
  ayudas: Ayudas,
): Promise<Response> {
  if (!opciones.encuesta) {
    const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
    ayudas.senal.throwIfAborted();
    return sesion.estado === 'activa'
      ? ayudas.respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible)
      : ayudas.respuestaSesion(sesion);
  }
  if (operacion === 'encuestaCrearLote') {
    return crearLote(opciones.encuesta, acceso, cuerpo, ayudas);
  }
  if (operacion === 'encuestaAbrirRonda') {
    return abrirRonda(opciones.encuesta, acceso, cuerpo, ayudas);
  }
  if (operacion === 'encuestaCerrar') {
    cuerpoCon(cuerpo, [], ayudas);
  }
  const resultado = leerResultadoEncuestaSesion(
    operacion === 'encuestaCerrar'
      ? await opciones.encuesta.cerrarEncuestaDeSesion(acceso, hoy())
      : await opciones.encuesta.leerResultadosDeSesion(acceso, rondaPedida(cuerpo, ayudas)),
  );
  ayudas.senal.throwIfAborted();
  return respuestaDeResultados(resultado, ayudas);
}
