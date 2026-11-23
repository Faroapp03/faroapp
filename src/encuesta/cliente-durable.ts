/** El lado del Worker del protocolo privado de la encuesta: valida cada respuesta del objeto durable antes de usarla. */
import { type AccesoSesionPanel, leerAccesoSesionPanel } from '../administracion/sesion.ts';
import { AlmacenPublicoDurable } from '../plataforma/acceso-publico/durable.ts';
import {
  type AlmacenEncuesta,
  type LoteNuevo,
  leerDia,
  leerLoteNuevo,
  leerNombreRonda,
  leerNumeroRonda,
  leerRespuestaRecibida,
  type RespuestaRecibida,
  type ResultadoAbrirRonda,
  type ResultadoCrearLote,
  type ResultadoEncuestaSesion,
} from './contrato.ts';
import { leerResultadoAbrirRonda, leerResultadoCrearLote, leerResultadoEncuestaSesion } from './contrato-sesion.ts';

export class AlmacenEncuestaDurable extends AlmacenPublicoDurable implements AlmacenEncuesta {
  async crearLoteDeSesion(acceso: AccesoSesionPanel, entrada: LoteNuevo): Promise<ResultadoCrearLote> {
    const lote = leerLoteNuevo(entrada);
    return this.enviar('/encuesta/crear-lote', { acceso: leerAccesoSesionPanel(acceso), lote }, (valor) => {
      const resultado = leerResultadoCrearLote(valor);
      // El lote confirmado tiene que ser este mismo, con todos sus códigos y ninguno usado.
      if (
        resultado.estado === 'creado' &&
        (resultado.lote.id !== lote.id ||
          resultado.lote.tipo !== lote.tipo ||
          resultado.lote.nombre !== lote.nombre ||
          resultado.lote.emitidos !== lote.huellas.length ||
          resultado.lote.consumidos !== 0)
      ) {
        return undefined;
      }
      return resultado;
    });
  }
  async abrirRondaDeSesion(acceso: AccesoSesionPanel, nombre: string, dia: string): Promise<ResultadoAbrirRonda> {
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso), nombre: leerNombreRonda(nombre), dia: leerDia(dia) };
    return this.enviar('/encuesta/abrir-ronda', cuerpo, (valor) => {
      const resultado = leerResultadoAbrirRonda(valor);
      // La ronda confirmada tiene que ser la pedida, abierta ese mismo día.
      return resultado.estado === 'activa' &&
        (resultado.encuesta.ronda.nombre !== nombre || resultado.encuesta.ronda.inicio !== dia)
        ? undefined
        : resultado;
    });
  }
  async cerrarEncuestaDeSesion(acceso: AccesoSesionPanel, dia: string): Promise<ResultadoEncuestaSesion> {
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso), dia: leerDia(dia) };
    return this.enviar('/encuesta/cerrar', cuerpo, (valor) => {
      const resultado = leerResultadoEncuestaSesion(valor);
      return resultado.estado === 'activa' && resultado.encuesta.abierta ? undefined : resultado;
    });
  }
  async leerResultadosDeSesion(acceso: AccesoSesionPanel, ronda: number | null): Promise<ResultadoEncuestaSesion> {
    const cuerpo = { acceso: leerAccesoSesionPanel(acceso), ronda: leerNumeroRonda(ronda) };
    return this.enviar('/encuesta/resultados', cuerpo, (valor) => {
      const resultado = leerResultadoEncuestaSesion(valor);
      // Los resultados recibidos son los de la ronda pedida.
      return resultado.estado === 'activa' && ronda !== null && resultado.encuesta.ronda.numero !== ronda
        ? undefined
        : resultado;
    });
  }
  async responder(entrada: RespuestaRecibida): Promise<boolean> {
    const respuesta = leerRespuestaRecibida(entrada);
    return this.enviar('/encuesta/responder', { respuesta }, (valor) => {
      if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
        return undefined;
      }
      const o = valor as Record<string, unknown>;
      return Object.keys(o).join(',') === 'aceptada' && typeof o.aceptada === 'boolean' ? o.aceptada : undefined;
    });
  }
}
