/** Cerrar desde el panel solo existe con la activación habilitada y un almacén que admite el cierre. */
import type { AlmacenActivacion } from '../administracion/activacion.ts';
import { admiteCierreActivacion } from '../administracion/cierre-activacion.ts';
import { type CerrarPublicacion, crearCerradorPublicacion } from '../administracion/cierre-publicacion.ts';
import { crearConsultorFinEjecucionGitHub } from '../administracion/consulta-ejecucion-github.ts';
import type { CapacidadActualizacionPanel } from '../administracion/http.ts';
import type { EstadoTrabajosPrivado } from '../administracion/trabajos.ts';

export function cerradorDelMontaje(
  opciones: {
    readonly almacenActivacion?: AlmacenActivacion;
    readonly trabajos?: { leerTrabajoPrivado(): Promise<EstadoTrabajosPrivado> };
    readonly activacionHabilitada?: () => boolean;
  },
  solicitar: CapacidadActualizacionPanel['solicitar'],
  consulta: Parameters<typeof crearConsultorFinEjecucionGitHub>[0],
): CerrarPublicacion | undefined {
  const { almacenActivacion: almacen, trabajos } = opciones;
  if (!opciones.activacionHabilitada || !almacen || !trabajos || !admiteCierreActivacion(almacen)) {
    return undefined;
  }
  return crearCerradorPublicacion({
    almacen,
    leerTrabajos: () => trabajos.leerTrabajoPrivado(),
    solicitar,
    consultarFin: crearConsultorFinEjecucionGitHub(consulta),
  });
}
