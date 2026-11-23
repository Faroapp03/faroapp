/** Lo que el vigilante observa de la activación: su última intención y si deja datos validados sin publicar. */
import { type EstadoActivacionPrivado, leerEstadoActivacionPrivado } from './activacion.ts';
import { activacionObservada } from './activacion-observada.ts';
import { exigirTrabajo } from './estado-trabajos.js';
import { trabajoEnPlazo } from './programacion-trabajos.ts';
import type { DecisionVigilante, EntradasVigilante } from './vigilante.ts';

/** La última intención de activación, sin fechas posteriores al reloj de la evaluación. */
export function observarActivacion(entrada: EstadoActivacionPrivado, ahora: number) {
  const ultima = leerEstadoActivacionPrivado(entrada).ultimaActivacion;
  exigirTrabajo(ultima === null || ultima.actualizadoEn <= ahora);
  return ultima === null
    ? null
    : Object.freeze({
        fase: ultima.fase,
        actualizadoEn: ultima.actualizadoEn,
        versionId: ultima.versionId,
        deploymentId: ultima.deploymentId,
      });
}
/** Sin ninguna activación, `null`; si no, su intención y desde cuándo hay datos validados sin publicar. */
export function datosSinPublicar(
  entrada: EstadoActivacionPrivado,
): Readonly<{ desde: number | null; solicitudId: string }> | null {
  const ultima = activacionObservada(entrada).ultimaActivacion;
  return ultima === null ? null : { desde: ultima.datosSinPublicarDesde, solicitudId: ultima.solicitudId };
}

/** La reserva sigue en curso durante su plazo. Una lectura local incompleta solo puede confirmar la marca durable. */
export function avisoSinPublicar(
  entrada: EntradasVigilante,
  ahora: number,
  lecturaIncompleta = false,
): DecisionVigilante[] {
  const marca = entrada.candidatoPendiente;
  const pendiente = marca && !trabajoEnPlazo(marca, ahora) ? marca : datosSinPublicar(entrada.activacion);
  // Una confirmación del despliegue anterior no resuelve lo que está ahora en construcción o en promoción.
  if (!pendiente || (marca && pendiente.desde === null) || (lecturaIncompleta && pendiente !== marca)) {
    return [];
  }
  const { desde, solicitudId } = pendiente;
  return [
    {
      clave: 'activacion',
      estado: desde === null ? 'conforme' : 'incidencia',
      motivo: desde === null ? 'sin_datos_validados_por_publicar' : 'datos_validados_sin_publicar',
      observadoEn: ahora,
      referencia: desde === null ? solicitudId : new Date(desde).toISOString(),
    },
  ];
}
