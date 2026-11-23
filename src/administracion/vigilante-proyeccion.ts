/** Proyección deliberadamente pequeña: nunca salen soportes, referencias ni huellas. */

import { leerHistorialVigilantePanel, leerVigilantePanel } from './vigilante-panel.js';
import type { ComprobacionVigilanteSesion, HistorialVigilanteSesion } from './vigilante-resultados.ts';

const MAX_DTO_BYTES = 126_976;
function acotar<T>(valor: T): T {
  if (new TextEncoder().encode(JSON.stringify(valor)).byteLength > MAX_DTO_BYTES) {
    throw new Error('Proyección del vigilante fuera de cota');
  }
  return valor;
}
function proyectarFila(fila: {
  id: number;
  clave: string;
  estado: string;
  motivo: string;
  observadoEn: number;
  evaluadoEn: number;
  origen: string;
}) {
  return {
    id: fila.id,
    clave: fila.clave,
    estado: fila.estado,
    motivo: fila.motivo,
    observadoEn: fila.observadoEn,
    evaluadoEn: fila.evaluadoEn,
    origen: fila.origen,
  };
}
/**
 * Estado de cada canal de avisos que acompaña la comprobación, sin la dirección. Solo viajan los canales que dicen
 * algo: configurados o con algún intento. Una instalación sin evento programado no avisa.
 */
export type CanalAvisoVigilante = import('./vigilante-panel.js').CanalAvisoPanel;
export interface AvisosVigilante {
  readonly canales: readonly CanalAvisoVigilante[];
}
export const AVISOS_NO_CONFIGURADOS: AvisosVigilante = Object.freeze({ canales: Object.freeze([]) });
const CANAL_SIN_NADA = { correo: 'no-configurado', url: 'no-configurados' } as const;
function canalesQueDicenAlgo(avisos: AvisosVigilante) {
  return avisos.canales.filter((c) => c.estado !== CANAL_SIN_NADA[c.canal] || c.ultimoIntento !== null);
}
/** Hasta qué día dura la pausa declarada de la programación, si el programador la ha dado por vigente. */
function pausaVigente(decisiones: readonly { clave: string; motivo: string; referencia: string }[]): string | null {
  const pausa = decisiones.find((d) => d.clave === 'programador' && d.motivo === 'programacion_en_pausa');
  return pausa ? pausa.referencia.replace(/^apagada:/, '') : null;
}
export function proyectarComprobacion(
  resultado: ComprobacionVigilanteSesion,
  avisos: AvisosVigilante = AVISOS_NO_CONFIGURADOS,
) {
  if (resultado.estado !== 'activa') {
    return resultado;
  }
  const { evaluacion, incidencias, origenDatos, revision } = resultado.vigilante;
  const pausaProgramadaHasta = pausaVigente(evaluacion.decisiones);
  const trabajo = evaluacion.trabajoObservado?.ultimoTrabajo;
  const ultimoTrabajo = trabajo
    ? {
        estado: trabajo.estado,
        accion: trabajo.accion,
        creadoEn: trabajo.creadoEn,
        actualizadoEn: trabajo.actualizadoEn,
        resultado: trabajo.resultado?.resultado ?? null,
      }
    : null;
  return {
    estado: 'activa' as const,
    sesion: resultado.sesion,
    vigilante: acotar(
      leerVigilantePanel({
        version: 1,
        origenDatos,
        evaluadoEn: evaluacion.evaluadoEn,
        pulsoContinuo: evaluacion.pulsoContinuo,
        entregaActiva: evaluacion.entregaActiva,
        revision,
        incidencias: incidencias.map(proyectarFila),
        areas: evaluacion.decisiones.map(({ clave, estado, motivo, observadoEn }) => ({
          clave,
          estado,
          motivo,
          observadoEn,
        })),
        fechaDatos: evaluacion.fechaDatos,
        ultimoTrabajo,
        // Los campos nuevos solo viajan con valor, para que un panel anterior siga leyendo la respuesta.
        eventosProgramados: evaluacion.eventosProgramados.map(({ eventoEn, resultado, motivo, fase, motivoFallo }) => ({
          eventoEn,
          resultado,
          motivo,
          ...(fase === null ? {} : { fase, motivoFallo }),
        })),
        ...(canalesQueDicenAlgo(avisos).length === 0 ? {} : { avisos: { canales: canalesQueDicenAlgo(avisos) } }),
        ...(pausaProgramadaHasta ? { pausaProgramadaHasta } : {}),
      }),
    ),
  };
}
export function proyectarHistorial(resultado: HistorialVigilanteSesion) {
  if (resultado.estado !== 'activa') {
    return resultado;
  }
  const { revision, decisiones, siguiente } = resultado.historial;
  return {
    estado: 'activa' as const,
    sesion: resultado.sesion,
    historial: acotar(
      leerHistorialVigilantePanel({
        version: 1,
        revision,
        decisiones: decisiones.map(proyectarFila),
        siguiente,
      }),
    ),
  };
}
