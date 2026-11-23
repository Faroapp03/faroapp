/**
 * Cliente de la lista de administradores a través del objeto durable. Cada respuesta se valida con el contrato
 * estricto; un contrato roto llega como almacén no disponible, y eso deniega la entrada al panel.
 */
import {
  type AlmacenAdministradores,
  type CambioAdministradores,
  type DecisionAutorizacion,
  type EntradaAdministrador,
  leerCambioAdministradores,
  leerDecisionAutorizacion,
  leerEntradaAdministrador,
  leerListaAdministradores,
  leerResultadoCambioAdministradores,
  leerSiembraAdministradores,
  RUTAS_ADMINISTRADORES_DURABLE as RUTAS,
} from '../../administracion/administradores.ts';
import { type AccesoSesionPanel, leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import { AlmacenPublicoDurable } from './durable.ts';

export class AdministradoresDurable extends AlmacenPublicoDurable implements AlmacenAdministradores {
  async autorizarAdministrador(
    entrada: EntradaAdministrador,
    siembra: readonly string[],
  ): Promise<DecisionAutorizacion> {
    const cuerpo = { entrada: leerEntradaAdministrador(entrada), siembra: leerSiembraAdministradores(siembra) };
    return this.enviar(RUTAS.autorizar, cuerpo, leerDecisionAutorizacion);
  }
  async leerAdministradores() {
    return this.enviar(RUTAS.leer, {}, leerListaAdministradores);
  }
  async cambiarAdministradores(acceso: AccesoSesionPanel, cambio: CambioAdministradores) {
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso), cambio: leerCambioAdministradores(cambio) };
    return this.enviar(RUTAS.cambiar, cuerpo, leerResultadoCambioAdministradores);
  }
}
