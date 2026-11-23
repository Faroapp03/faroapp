/**
 * Cliente de la sesión única a través del objeto durable: cada respuesta se valida con el contrato estricto y un
 * contrato roto llega como almacén no disponible, nunca como un estado de sesión inventado.
 */
import { type AccesoSesionPanel, leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import {
  type AlmacenSesionUnica,
  type BienvenidaPanel,
  type FilaRegistroPanel,
  type IdentidadPanel,
  leerBienvenidaPanel,
  leerIdentidadPanel,
  leerRegistroPanel,
  leerResultadoAperturaUnica,
  type ResultadoAperturaUnica,
  RUTA_REGISTRO_PANEL_DURABLE,
} from '../../administracion/sesion-unica.ts';
import { AdministradoresDurable } from './administradores-cliente-durable.ts';

export class SesionUnicaDurable extends AdministradoresDurable implements AlmacenSesionUnica {
  async recibirEnPanel(entrada: IdentidadPanel): Promise<BienvenidaPanel> {
    const identidad = leerIdentidadPanel(entrada);
    return this.enviar('/panel/bienvenida', { identidad }, leerBienvenidaPanel);
  }
  async abrirSesionUnica(
    entrada: AccesoSesionPanel,
    persona: IdentidadPanel,
    retomar: boolean,
  ): Promise<ResultadoAperturaUnica> {
    const acceso = leerAccesoSesionPanel(entrada);
    const identidad = leerIdentidadPanel(persona);
    return this.enviar('/panel/abrir-unica', { acceso, identidad, retomar }, leerResultadoAperturaUnica);
  }
  async leerRegistroPanel(): Promise<readonly FilaRegistroPanel[]> {
    return this.enviar(RUTA_REGISTRO_PANEL_DURABLE, {}, leerRegistroPanel);
  }
}
