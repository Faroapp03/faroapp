import {
  type AvisoPreparado,
  type EstadoAvisoVigilante,
  leerAvisoPreparado,
  leerEstadoAvisoVigilante,
} from '../../administracion/aviso-vigilante.ts';
import { leerResultadoEnvioAviso, type ResultadoEnvioAviso } from '../../administracion/envio-aviso.ts';
import { type EnvioPorCanal, leerEnviosPorCanal } from '../../administracion/envio-por-canal.ts';
import {
  ConfiguracionVigilanteInvalida,
  ConflictoVigilante,
  VigilanteNoDisponible,
} from '../../administracion/errores-vigilante.ts';
import { objetoTrabajo } from '../../administracion/estado-trabajos.js';
import type { AccesoSesionPanel } from '../../administracion/sesion.ts';
import { leerAccesoSesionPanel, leerEstadoSesionPanel } from '../../administracion/sesion.ts';
import { AlmacenRecorridoDurable } from './recorrido-cliente-durable.ts';
import { leerPaginaVigilante, leerRespuestaVigilante } from './vigilante-durable.ts';

function rechazarError(valor: unknown): void {
  if (valor && typeof valor === 'object' && 'error' in valor && valor.error === 'vigilante_configuracion_invalida') {
    throw new ConfiguracionVigilanteInvalida();
  }
  if (valor && typeof valor === 'object' && 'error' in valor && valor.error === 'vigilante_conflicto') {
    throw new ConflictoVigilante();
  }
  if (valor && typeof valor === 'object' && 'error' in valor && valor.error === 'vigilante_no_disponible') {
    throw new VigilanteNoDisponible();
  }
}
function paginaConsistente(
  historial: import('../../administracion/vigilante-panel.js').HistorialVigilantePanel,
  pagina: { despuesDe?: number; limite?: number; revisionEsperada?: number },
): boolean {
  return (
    (pagina.revisionEsperada === undefined || historial.revision === pagina.revisionEsperada) &&
    historial.decisiones.every((d) => d.id > (pagina.despuesDe ?? 0)) &&
    historial.decisiones.length <= (pagina.limite ?? 0)
  );
}
/**
 * La preparación llega por la ruta administrativa común `/administracion/api/datos/vigilante/preparar`, protegida
 * por Access y por la sesión administrativa. El Worker privado la bloquea y el panel no la llama.
 */
export class AlmacenVigilanteDurable extends AlmacenRecorridoDurable {
  async prepararVigilanteDeSesion(acceso: AccesoSesionPanel) {
    return this.enviar('/vigilante/preparar', { acceso: leerAccesoSesionPanel(acceso) }, (valor) => {
      rechazarError(valor);
      if (valor && typeof valor === 'object' && Object.keys(valor).join(',') === 'estado') {
        const estado = leerEstadoSesionPanel(valor);
        return estado.estado !== 'activa' ? estado : undefined;
      }
      const o = objetoTrabajo(valor, 'estado,preparado,sesion');
      const sesion = leerEstadoSesionPanel(o.sesion);
      return o.estado === 'activa' && o.preparado === true && sesion.estado === 'activa'
        ? { estado: 'activa' as const, sesion, preparado: true as const }
        : undefined;
    });
  }
  async comprobarVigilanteDeSesion(acceso: AccesoSesionPanel) {
    return this.enviar('/vigilante/comprobar', { acceso: leerAccesoSesionPanel(acceso) }, (valor) => {
      rechazarError(valor);
      const salida = leerRespuestaVigilante(valor, 'comprobar');
      return salida.estado !== 'activa' || salida.vigilante !== undefined
        ? (salida as ReturnType<typeof import('../../administracion/vigilante-proyeccion.ts').proyectarComprobacion>)
        : undefined;
    });
  }
  /** Evaluación del evento programado, sin sesión: devuelve el aviso que toca enviar, si lo hay. */
  async prepararAvisoVigilante(panel: string): Promise<AvisoPreparado | null> {
    return this.enviar('/vigilante/aviso/preparar', { panel }, (valor) => {
      rechazarError(valor);
      const o = objetoTrabajo(valor, 'aviso');
      return { aviso: o.aviso === null ? null : leerAvisoPreparado(o.aviso) };
    }).then((r) => r.aviso);
  }
  async registrarEnvioAviso(
    entrada: Readonly<{
      envio: ResultadoEnvioAviso;
      siguiente: EstadoAvisoVigilante;
      canales?: readonly EnvioPorCanal[];
    }>,
  ) {
    const cuerpo = {
      envio: leerResultadoEnvioAviso(entrada.envio),
      siguiente: leerEstadoAvisoVigilante(entrada.siguiente),
      ...(entrada.canales ? { canales: leerEnviosPorCanal(entrada.canales) } : {}),
    };
    return this.enviar('/vigilante/aviso/registrar', cuerpo, (valor) => {
      rechazarError(valor);
      return objetoTrabajo(valor, 'avisado,ultimoIntento');
    });
  }
  async historialVigilanteDeSesion(
    acceso: AccesoSesionPanel,
    pagina: { despuesDe?: number; limite?: number; revisionEsperada?: number },
  ) {
    return this.enviar(
      '/vigilante/historial',
      { acceso: leerAccesoSesionPanel(acceso), pagina: leerPaginaVigilante(pagina) },
      (valor) => {
        rechazarError(valor);
        const salida = leerRespuestaVigilante(valor, 'historial');
        if (salida.estado === 'activa' && salida.historial && !paginaConsistente(salida.historial, pagina)) {
          return undefined;
        }
        return salida.estado !== 'activa' || salida.historial !== undefined
          ? (salida as ReturnType<typeof import('../../administracion/vigilante-proyeccion.ts').proyectarHistorial>)
          : undefined;
      },
    );
  }
}
