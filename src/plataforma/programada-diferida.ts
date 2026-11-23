/**
 * Evento programado dentro del panel: preparación, consulta a GitHub, reserva y despacho comparten un plazo. Cada
 * fase que falla queda registrada en la autoridad antes de relanzar, sin el texto del error.
 */

import { crearConsultorEjecucionGitHub } from '../administracion/consulta-ejecucion-github.ts';
import { crearDespachadorGitHub } from '../administracion/ejecutor-github.ts';
import {
  anotarFalloProgramado,
  FalloProgramadoAnotado,
  type FaseProgramada,
  motivoDeLaCausa,
  type RegistroFallosProgramados,
} from '../administracion/fallo-programado.ts';
import { PLAZO_PANEL_MS } from '../administracion/http.ts';
import type { SolicitudTrabajoProgramado } from '../administracion/programacion-trabajos.ts';
import { comprobarEventoProgramado, crearComprobadorProgramado } from '../administracion/programada.ts';
import { crearReconciliadorProgramado } from '../administracion/reconciliacion.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import type { OpcionesMontajeAdministrativo } from './administracion.ts';

type Programada = NonNullable<OpcionesMontajeAdministrativo['programada']>;
/** La fase en curso: cada pieza la marca al empezar, para que el fallo y el plazo se atribuyan a la suya. */
interface Seguimiento {
  fase: FaseProgramada;
}
function enFase<A extends unknown[], R>(seguimiento: Seguimiento, fase: FaseProgramada, f: (...a: A) => Promise<R>) {
  return (...argumentos: A): Promise<R> => {
    seguimiento.fase = fase;
    return f(...argumentos);
  };
}
type Autoridades = Required<Pick<OpcionesMontajeAdministrativo, 'actualizacion' | 'trabajos'>> &
  Pick<OpcionesMontajeAdministrativo, 'activacionHabilitada'>;
function comprobadorConFases(
  { actualizacion, trabajos, activacionHabilitada }: Autoridades,
  programada: Programada,
  s: Seguimiento,
) {
  const ejecutor = actualizacion.configuracion();
  const transporte = actualizacion.pedir ? { pedir: actualizacion.pedir } : {};
  const despachar = crearDespachadorGitHub({ ...ejecutor, ...transporte });
  const reconciliar = crearReconciliadorProgramado({
    almacen: trabajos,
    consultar: crearConsultorEjecucionGitHub({ obtenerToken: ejecutor.obtenerToken, ...transporte }),
  });
  return crearComprobadorProgramado({
    almacen: {
      reservarTrabajoProgramado: enFase(s, 'reserva', (solicitud: SolicitudTrabajoProgramado, confianza) =>
        programada.almacen.reservarTrabajoProgramado(solicitud, confianza),
      ),
      anotarDespacho: enFase(s, 'despacho', (referencia, resultado) => trabajos.anotarDespacho(referencia, resultado)),
    },
    confianza: ejecutor.confianza,
    ...(activacionHabilitada ? { activacionHabilitada } : {}),
    despachar: enFase(s, 'despacho', despachar),
    reconciliar: enFase(s, 'reconciliacion', reconciliar),
  });
}
async function ejecutarFases(
  opciones: OpcionesMontajeAdministrativo,
  programada: Programada,
  entrada: SolicitudTrabajoProgramado,
  contexto: { readonly seguimiento: Seguimiento; readonly senal: AbortSignal },
): Promise<void> {
  const { seguimiento, senal } = contexto;
  const configuracion = programada.configuracion();
  if (!configuracion?.habilitada) {
    return;
  }
  seguimiento.fase = 'validacion';
  const evento = comprobarEventoProgramado(entrada, configuracion);
  seguimiento.fase = 'preparacion';
  const { actualizacion, trabajos, almacenActivacion } = opciones;
  if (!actualizacion || !trabajos || !almacenActivacion) {
    throw new Error('La programación requiere configuración y autoridad durables');
  }
  const comprobar = comprobadorConFases(
    {
      actualizacion,
      trabajos,
      ...(opciones.activacionHabilitada ? { activacionHabilitada: opciones.activacionHabilitada } : {}),
    },
    programada,
    seguimiento,
  );
  await trabajos.prepararTrabajos();
  senal.throwIfAborted();
  await almacenActivacion.prepararActivacion();
  senal.throwIfAborted();
  // Entre fases, un corte del plazo se atribuye a la última que empezó.
  await comprobar(evento, senal);
}
/**
 * Un fallo de configuración o de validación llega antes de preparar las tablas: el registro las prepara primero,
 * igual que la reserva, para que una instalación nueva también lo guarde.
 */
export function registroDeFallos(opciones: OpcionesMontajeAdministrativo): RegistroFallosProgramados {
  return {
    registrarFalloProgramado: async (fallo) => {
      const { programada, trabajos } = opciones;
      if (!programada || !trabajos) {
        throw new Error('La programación requiere configuración y autoridad durables');
      }
      await trabajos.prepararTrabajos();
      return programada.almacen.registrarFalloProgramado(fallo);
    },
  };
}
/** Preparación y reserva comparten el plazo; un montaje tardío no conserva permiso para despachar. */
export function programadaDiferida(opciones: OpcionesMontajeAdministrativo) {
  const { programada } = opciones;
  if (!programada) {
    return undefined;
  }
  return async (entrada: SolicitudTrabajoProgramado, retirada?: AbortSignal): Promise<void> => {
    const seguimiento: Seguimiento = { fase: 'configuracion' };
    try {
      await dentroDelPlazo(
        (senal) => ejecutarFases(opciones, programada, entrada, { seguimiento, senal }),
        PLAZO_PANEL_MS,
        retirada,
      );
    } catch (causa) {
      const { fase } = seguimiento;
      const fallo = { eventoEn: entrada.eventoEn, fase, motivo: motivoDeLaCausa(causa, retirada) };
      throw new FalloProgramadoAnotado(fase, await anotarFalloProgramado(registroDeFallos(opciones), fallo), causa);
    }
  };
}
