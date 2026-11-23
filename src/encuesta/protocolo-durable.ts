/**
 * El protocolo privado de la encuesta entre el Worker y el objeto durable. Solo cruzan huellas, celdas y recuentos:
 * ni códigos en claro ni nada de la petición pública. La sesión del panel se comprueba en el almacén, en la misma
 * transacción que la operación.
 */
import { leerAccesoSesionPanel } from '../administracion/sesion.ts';
import { responderOperacionPrivada } from '../plataforma/acceso-publico/respuesta-durable.ts';
import {
  type AlmacenEncuesta,
  leerDia,
  leerLoteNuevo,
  leerNombreRonda,
  leerNumeroRonda,
  leerRespuestaRecibida,
  objetoCerrado,
} from './contrato.ts';

const RUTAS = new Set([
  '/encuesta/crear-lote',
  '/encuesta/abrir-ronda',
  '/encuesta/cerrar',
  '/encuesta/resultados',
  '/encuesta/responder',
]);
/**
 * La respuesta más grande es la de «resultados» o «cerrar» con 50 lotes y 20 rondas cuyos nombres tienen 60 caracteres
 * de cuatro bytes: unos 26 KiB con los recuentos (pruebas/encuesta/topes.test.ts la mide). 32 KiB deja margen.
 */
export const MAX_RESPUESTA_ENCUESTA = 32_768;

export function esRutaEncuestaDurable(ruta: string): boolean {
  return RUTAS.has(ruta);
}
/** Devuelve la acción ya validada; un mensaje que no cumple el contrato no llega al almacén. */
function accionDe(almacen: AlmacenEncuesta, ruta: string, entrada: unknown): (() => Promise<unknown>) | undefined {
  switch (ruta) {
    case '/encuesta/crear-lote': {
      const o = objetoCerrado(entrada, ['acceso', 'lote']),
        acceso = leerAccesoSesionPanel(o.acceso),
        lote = leerLoteNuevo(o.lote);
      return () => almacen.crearLoteDeSesion(acceso, lote);
    }
    case '/encuesta/abrir-ronda': {
      const o = objetoCerrado(entrada, ['acceso', 'nombre', 'dia']),
        acceso = leerAccesoSesionPanel(o.acceso),
        nombre = leerNombreRonda(o.nombre),
        dia = leerDia(o.dia);
      return () => almacen.abrirRondaDeSesion(acceso, nombre, dia);
    }
    case '/encuesta/cerrar': {
      const o = objetoCerrado(entrada, ['acceso', 'dia']),
        acceso = leerAccesoSesionPanel(o.acceso),
        dia = leerDia(o.dia);
      return () => almacen.cerrarEncuestaDeSesion(acceso, dia);
    }
    case '/encuesta/resultados': {
      const o = objetoCerrado(entrada, ['acceso', 'ronda']),
        acceso = leerAccesoSesionPanel(o.acceso),
        ronda = leerNumeroRonda(o.ronda);
      return () => almacen.leerResultadosDeSesion(acceso, ronda);
    }
    case '/encuesta/responder': {
      const respuesta = leerRespuestaRecibida(objetoCerrado(entrada, ['respuesta']).respuesta);
      return async () => ({ aceptada: await almacen.responder(respuesta) });
    }
    default:
      return undefined;
  }
}
export async function operarEncuestaDurable(almacen: AlmacenEncuesta, ruta: string, cuerpo: unknown): Promise<unknown> {
  let accion: (() => Promise<unknown>) | undefined;
  try {
    accion = accionDe(almacen, ruta, cuerpo);
  } catch {
    return undefined;
  }
  return accion ? accion() : undefined;
}
/**
 * La respuesta del objeto durable a una ruta de la encuesta, o null si la ruta no es suya y la atiende otro protocolo.
 * Un mensaje fuera de contrato es un 400 sin detalles, como en el resto del enlace privado.
 */
export async function responderEncuestaDurable(
  almacen: AlmacenEncuesta,
  ruta: string,
  cuerpo: unknown,
): Promise<Response | null> {
  if (!esRutaEncuestaDurable(ruta)) {
    return null;
  }
  return responderOperacionPrivada(await operarEncuestaDurable(almacen, ruta, cuerpo), MAX_RESPUESTA_ENCUESTA);
}
