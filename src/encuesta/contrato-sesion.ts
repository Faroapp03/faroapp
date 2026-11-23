/**
 * Los lectores de lo que responde el almacén a una operación del panel: siempre con el estado de la sesión, que se
 * comprueba en la misma transacción. Son tan cerrados como los del contrato (contrato.ts), del que leen los resultados.
 */
import { leerEstadoSesionPanel, type SesionPanelActiva, type SesionPanelInactiva } from '../administracion/sesion.ts';
import {
  exigirContrato as exigir,
  leerLote,
  leerResultadosEncuesta,
  objetoCerrado,
  type ResultadoAbrirRonda,
  type ResultadoCrearLote,
  type ResultadoEncuestaSesion,
} from './contrato.ts';

function conSesion(entrada: unknown): { o: Record<string, unknown>; sesion: SesionPanelActiva } | SesionPanelInactiva {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const estado = Object.getOwnPropertyDescriptor(entrada, 'estado');
  exigir(estado !== undefined && 'value' in estado);
  if (estado.value === 'sustituida' || estado.value === 'caducada' || estado.value === 'cerrada') {
    const inactiva = leerEstadoSesionPanel(entrada);
    exigir(inactiva.estado !== 'activa');
    return inactiva;
  }
  const claves = Object.keys(entrada);
  const o = objetoCerrado(entrada, claves);
  const sesion = leerEstadoSesionPanel(o.sesion);
  exigir(sesion.estado === 'activa');
  return { o, sesion };
}
export function leerResultadoEncuestaSesion(entrada: unknown): ResultadoEncuestaSesion {
  const leido = conSesion(entrada);
  if (!('o' in leido)) {
    return leido;
  }
  if (leido.o.estado === 'cuestionario_anterior') {
    objetoCerrado(leido.o, ['estado', 'sesion']);
    return { estado: 'cuestionario_anterior', sesion: leido.sesion };
  }
  const o = objetoCerrado(leido.o, ['estado', 'sesion', 'encuesta']);
  exigir(o.estado === 'activa');
  return { estado: 'activa', sesion: leido.sesion, encuesta: leerResultadosEncuesta(o.encuesta) };
}
export function leerResultadoAbrirRonda(entrada: unknown): ResultadoAbrirRonda {
  const leido = conSesion(entrada);
  if (!('o' in leido)) {
    return leido;
  }
  if (leido.o.estado === 'activa') {
    const o = objetoCerrado(leido.o, ['estado', 'sesion', 'encuesta']);
    const encuesta = leerResultadosEncuesta(o.encuesta);
    // La ronda recién abierta es la de los resultados: abierta y sin lotes.
    exigir(encuesta.abierta && encuesta.lotes.length === 0);
    return { estado: 'activa', sesion: leido.sesion, encuesta };
  }
  const o = objetoCerrado(leido.o, ['estado', 'sesion']);
  exigir(o.estado === 'ronda_abierta' || o.estado === 'lleno' || o.estado === 'cuestionario_anterior');
  return { estado: o.estado, sesion: leido.sesion };
}
export function leerResultadoCrearLote(entrada: unknown): ResultadoCrearLote {
  const leido = conSesion(entrada);
  if (!('o' in leido)) {
    return leido;
  }
  if (leido.o.estado === 'creado') {
    const o = objetoCerrado(leido.o, ['estado', 'sesion', 'lote']);
    return { estado: 'creado', sesion: leido.sesion, lote: leerLote(o.lote) };
  }
  const o = objetoCerrado(leido.o, ['estado', 'sesion']);
  exigir(o.estado === 'encuesta_cerrada' || o.estado === 'lleno' || o.estado === 'cuestionario_anterior');
  return { estado: o.estado, sesion: leido.sesion };
}
