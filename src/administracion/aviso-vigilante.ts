/**
 * Cuándo avisa el vigilante y qué envía. Un aviso se abre cuando aparece una incidencia nueva o cambia el motivo de
 * una abierta; mientras siga igual, se recuerda como mucho una vez al día; cuando no queda ninguna, se envía un
 * último aviso de «resuelto». El cuerpo lleva solo claves y motivos del vigilante, fechas y la dirección del panel.
 */
import { MS_POR_DIA, MS_POR_MINUTO } from '../comun/tiempo.ts';
import { esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from './estado-trabajos.js';

export interface IncidenciaAvisada {
  readonly clave: string;
  readonly motivo: string;
  /** Primera evaluación de este episodio en que la clave apareció con este motivo. */
  readonly desde: number;
}
/** Lo último que se avisó con éxito; solo se sustituye cuando un envío se confirma. */
export interface EstadoAvisoVigilante {
  readonly estado: 'abierto' | 'resuelto';
  readonly desde: number;
  readonly enviadoEn: number;
  readonly incidencias: readonly IncidenciaAvisada[];
}
export type TipoAviso = 'nuevo' | 'recordatorio' | 'resuelto';
export interface CuerpoAvisoVigilante {
  readonly version: 1;
  readonly origen: 'faro-vigilante';
  readonly tipo: TipoAviso;
  readonly evaluadoEn: string;
  readonly desde: string;
  readonly panel: string;
  readonly decisiones: readonly Readonly<{ clave: string; motivo: string; desde: string }>[];
}
export interface AvisoPreparado {
  readonly cuerpo: CuerpoAvisoVigilante;
  /** El estado que quedará guardado si el envío se confirma. */
  readonly siguiente: EstadoAvisoVigilante;
}
const MAX_INCIDENCIAS = 256;
const MAX_TEXTO = 200;
/**
 * El cron diario no llega siempre a la misma hora exacta: sin este margen, un evento unos milisegundos más temprano
 * que el anterior retrasaría el recordatorio a las 48 horas.
 */
const MINUTOS_DE_MARGEN = 60;
const MARGEN_RECORDATORIO_MS = MINUTOS_DE_MARGEN * MS_POR_MINUTO;

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0 && valor.length <= MAX_TEXTO;
}
function leerIncidencia(entrada: unknown): IncidenciaAvisada {
  const o = objetoTrabajo(entrada, 'clave,desde,motivo');
  exigirTrabajo(esTexto(o.clave) && esTexto(o.motivo) && esEnteroTrabajo(o.desde));
  return Object.freeze({ clave: o.clave, motivo: o.motivo, desde: o.desde });
}
export function leerEstadoAvisoVigilante(entrada: unknown): EstadoAvisoVigilante {
  const o = objetoTrabajo(entrada, 'desde,enviadoEn,estado,incidencias');
  exigirTrabajo(o.estado === 'abierto' || o.estado === 'resuelto');
  exigirTrabajo(esEnteroTrabajo(o.desde) && esEnteroTrabajo(o.enviadoEn) && o.desde <= o.enviadoEn);
  exigirTrabajo(Array.isArray(o.incidencias) && o.incidencias.length <= MAX_INCIDENCIAS);
  const incidencias = Object.freeze(o.incidencias.map(leerIncidencia));
  exigirTrabajo((o.estado === 'abierto') === incidencias.length > 0);
  return Object.freeze({ estado: o.estado, desde: o.desde, enviadoEn: o.enviadoEn, incidencias });
}
function leerDecisionDelCuerpo(entrada: unknown) {
  const o = objetoTrabajo(entrada, 'clave,desde,motivo');
  exigirTrabajo(esTexto(o.clave) && esTexto(o.motivo) && esTexto(o.desde));
  return Object.freeze({ clave: o.clave, motivo: o.motivo, desde: o.desde });
}
/** Valida el aviso al cruzar la frontera del objeto durable: el cuerpo se envía tal cual. */
export function leerAvisoPreparado(entrada: unknown): AvisoPreparado {
  const o = objetoTrabajo(entrada, 'cuerpo,siguiente');
  const c = objetoTrabajo(o.cuerpo, 'decisiones,desde,evaluadoEn,origen,panel,tipo,version');
  exigirTrabajo(c.version === 1 && c.origen === 'faro-vigilante');
  exigirTrabajo(c.tipo === 'nuevo' || c.tipo === 'recordatorio' || c.tipo === 'resuelto');
  exigirTrabajo(
    esTexto(c.evaluadoEn) && esTexto(c.desde) && typeof c.panel === 'string' && c.panel.startsWith('https://'),
  );
  exigirTrabajo(Array.isArray(c.decisiones) && c.decisiones.length <= MAX_INCIDENCIAS);
  const cuerpo: CuerpoAvisoVigilante = Object.freeze({
    version: 1,
    origen: 'faro-vigilante',
    tipo: c.tipo,
    evaluadoEn: c.evaluadoEn,
    desde: c.desde,
    panel: c.panel,
    decisiones: Object.freeze(c.decisiones.map(leerDecisionDelCuerpo)),
  });
  return Object.freeze({ cuerpo, siguiente: leerEstadoAvisoVigilante(o.siguiente) });
}
const identidad = (i: Pick<IncidenciaAvisada, 'clave' | 'motivo'>) => `${i.clave}\u0000${i.motivo}`;

/** Conserva la fecha de una incidencia que sigue con el mismo motivo; una nueva o cambiada empieza ahora. */
function incidenciasActuales(
  previo: EstadoAvisoVigilante | null,
  actuales: readonly Pick<IncidenciaAvisada, 'clave' | 'motivo'>[],
  ahora: number,
): IncidenciaAvisada[] {
  const conocidas = new Map((previo?.estado === 'abierto' ? previo.incidencias : []).map((i) => [identidad(i), i]));
  return actuales
    .map((i) => ({ clave: i.clave, motivo: i.motivo, desde: conocidas.get(identidad(i))?.desde ?? ahora }))
    .sort((a, b) => (a.clave < b.clave ? -1 : Number(a.clave > b.clave)));
}
function tipoDeAviso(
  previo: EstadoAvisoVigilante | null,
  incidencias: readonly IncidenciaAvisada[],
  ahora: number,
): TipoAviso | null {
  const abierto = previo?.estado === 'abierto';
  if (incidencias.length === 0) {
    return abierto ? 'resuelto' : null;
  }
  const conocidas = new Set((abierto ? previo.incidencias : []).map(identidad));
  if (incidencias.some((i) => !conocidas.has(identidad(i)))) {
    return 'nuevo';
  }
  return previo && ahora - previo.enviadoEn >= MS_POR_DIA - MARGEN_RECORDATORIO_MS ? 'recordatorio' : null;
}
const iso = (instante: number) => new Date(instante).toISOString();
/**
 * Sin aviso que enviar, la incidencia que se ha cerrado sale de lo avisado sin cambiar cuándo se envió: si vuelve,
 * es una decisión nueva y se avisa. Devuelve `null` si no cambia nada o si ya no queda ninguna (eso es «resuelto»).
 */
export function retirarIncidenciasCerradas(
  previo: EstadoAvisoVigilante | null,
  actuales: readonly Pick<IncidenciaAvisada, 'clave' | 'motivo'>[],
): EstadoAvisoVigilante | null {
  if (previo?.estado !== 'abierto') {
    return null;
  }
  const vigentes = new Set(actuales.map(identidad));
  const quedan = previo.incidencias.filter((i) => vigentes.has(identidad(i)));
  return quedan.length === previo.incidencias.length || quedan.length === 0
    ? null
    : leerEstadoAvisoVigilante({ ...previo, incidencias: quedan });
}

/**
 * Decide si hay que avisar con las incidencias de la evaluación recién guardada. Devuelve `null` si no toca: sin
 * incidencias ni episodio abierto, o con las mismas incidencias avisadas hace menos de un día.
 */
export function prepararAvisoVigilante(
  previo: EstadoAvisoVigilante | null,
  actuales: readonly Pick<IncidenciaAvisada, 'clave' | 'motivo'>[],
  contexto: Readonly<{ ahora: number; panel: string }>,
): AvisoPreparado | null {
  const { ahora, panel } = contexto;
  const incidencias = incidenciasActuales(previo, actuales, ahora);
  const tipo = tipoDeAviso(previo, incidencias, ahora);
  if (tipo === null) {
    return null;
  }
  const desde = previo?.estado === 'abierto' ? previo.desde : ahora;
  const siguiente: EstadoAvisoVigilante =
    tipo === 'resuelto'
      ? { estado: 'resuelto', desde, enviadoEn: ahora, incidencias: [] }
      : { estado: 'abierto', desde, enviadoEn: ahora, incidencias };
  const avisadas = tipo === 'resuelto' ? [] : incidencias;
  return Object.freeze({
    cuerpo: Object.freeze({
      version: 1,
      origen: 'faro-vigilante',
      tipo,
      evaluadoEn: iso(ahora),
      desde: iso(desde),
      panel,
      decisiones: Object.freeze(
        avisadas.map((i) => Object.freeze({ clave: i.clave, motivo: i.motivo, desde: iso(i.desde) })),
      ),
    }),
    siguiente: leerEstadoAvisoVigilante(siguiente),
  });
}
