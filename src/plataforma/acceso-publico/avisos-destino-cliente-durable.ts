/**
 * El lado del Worker del destino de los avisos: valida cada respuesta del objeto durable antes de usarla y comprueba
 * que un cambio confirmado es el que se pidió. Va en su propio archivo porque extiende el cliente general, que a su
 * vez importa el protocolo del objeto durable.
 */
import {
  type AlmacenAvisosDestino,
  type DestinoAvisos,
  esRevisionDestino,
  leerDestinoAvisos,
  leerResultadoCambioDestino,
  leerResultadoLecturaDestino,
  type ResultadoCambioDestino,
  type ResultadoLecturaDestino,
} from '../../administracion/avisos-destino.ts';
import { leerDestinoCorreo } from '../../administracion/destino-correo.ts';
import { type AccesoSesionPanel, leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import { RUTAS_AVISOS_DURABLE } from './avisos-destino-durable.ts';
import { AlmacenPublicoDurable } from './durable.ts';

/** Un cambio aceptado sube la revisión vista en uno y deja el estado que corresponde a lo pedido. */
function cambioConfirmado(
  resultado: ResultadoCambioDestino,
  revisionEsperada: number,
  conCorreo: boolean,
): ResultadoCambioDestino | undefined {
  if (resultado.estado !== 'cambiado') {
    return resultado;
  }
  const { revision, verificacion } = resultado.destino;
  const esperado = conCorreo ? 'pendiente' : 'sin_destino';
  return revision === revisionEsperada + 1 && verificacion === esperado ? resultado : undefined;
}

export class AlmacenAvisosDestinoDurable extends AlmacenPublicoDurable implements AlmacenAvisosDestino {
  async leerDestinoParaAvisar(): Promise<DestinoAvisos> {
    return this.enviar(RUTAS_AVISOS_DURABLE.destino, {}, (valor) => {
      if (valor === null || typeof valor !== 'object' || Object.keys(valor).join(',') !== 'destino') {
        return undefined;
      }
      return leerDestinoAvisos((valor as { destino: unknown }).destino);
    });
  }
  async leerDestinoAvisosDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaDestino> {
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso) };
    return this.enviar(RUTAS_AVISOS_DURABLE.leer, cuerpo, leerResultadoLecturaDestino);
  }
  async cambiarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    entrada: string,
  ): Promise<ResultadoCambioDestino> {
    if (!esRevisionDestino(revisionEsperada)) {
      throw new Error('Revisión del destino de avisos no válida');
    }
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso), revisionEsperada, correo: leerDestinoCorreo(entrada) };
    return this.enviar(RUTAS_AVISOS_DURABLE.cambiar, cuerpo, (valor) =>
      cambioConfirmado(leerResultadoCambioDestino(valor), revisionEsperada, true),
    );
  }
  async quitarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
  ): Promise<ResultadoCambioDestino> {
    if (!esRevisionDestino(revisionEsperada)) {
      throw new Error('Revisión del destino de avisos no válida');
    }
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso), revisionEsperada };
    return this.enviar(RUTAS_AVISOS_DURABLE.quitar, cuerpo, (valor) =>
      cambioConfirmado(leerResultadoCambioDestino(valor), revisionEsperada, false),
    );
  }
  /** Una verificación aceptada conserva la revisión y deja la dirección verificada; otra confirmación es falsa. */
  async verificarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    entrada: string,
  ): Promise<ResultadoCambioDestino> {
    if (!esRevisionDestino(revisionEsperada)) {
      throw new Error('Revisión del destino de avisos no válida');
    }
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso), revisionEsperada, correo: leerDestinoCorreo(entrada) };
    return this.enviar(RUTAS_AVISOS_DURABLE.verificar, cuerpo, (valor) => {
      const resultado = leerResultadoCambioDestino(valor);
      const { destino } = 'destino' in resultado ? resultado : { destino: undefined };
      const confirmada = destino?.revision === revisionEsperada && destino.verificacion === 'verificado';
      return resultado.estado !== 'cambiado' || confirmada ? resultado : undefined;
    });
  }
}
