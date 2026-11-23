/** Operaciones privadas del enlace del entorno: política del despliegue y autoridad SQLite del mismo objeto. */
import { leerEstadoAvisoVigilante } from '../../administracion/aviso-vigilante.ts';
import type { AlmacenAvisosDestino } from '../../administracion/avisos-destino.ts';
import { configuracionProgramadaDelEntorno } from '../../administracion/configuracion-programada.ts';
import {
  capturarConfiguracionVigilante,
  configuracionVigilanteDelEntorno,
} from '../../administracion/configuracion-vigilante.ts';
import { leerResultadoEnvioAviso } from '../../administracion/envio-aviso.ts';
import { leerEnviosPorCanal } from '../../administracion/envio-por-canal.ts';
import {
  ConfiguracionVigilanteInvalida,
  ConflictoVigilante,
  VigilanteNoDisponible,
} from '../../administracion/errores-vigilante.ts';
import { exigirTrabajo, objetoTrabajo } from '../../administracion/estado-trabajos.js';
import { leerAccesoSesionPanel, leerEstadoSesionPanel } from '../../administracion/sesion.ts';
import {
  LIMITE_PAGINA_VIGILANTE,
  leerHistorialVigilantePanel,
  leerVigilantePanel,
} from '../../administracion/vigilante-panel.js';
import { proyectarComprobacion, proyectarHistorial } from '../../administracion/vigilante-proyeccion.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { avisosPorCanal } from './estado-canales-aviso.ts';
import type { AlmacenSesionVigilanteSqlite } from './sesion-vigilante-sqlite.ts';

/** El vigilante y la dirección de los avisos viven en la misma autoridad: el estado de cada canal se lee de los dos. */
type AlmacenVigilanteConAvisos = AlmacenSesionVigilanteSqlite & Pick<AlmacenAvisosDestino, 'leerDestinoParaAvisar'>;

const RUTAS = new Set([
  '/vigilante/preparar',
  '/vigilante/comprobar',
  '/vigilante/historial',
  '/vigilante/aviso/preparar',
  '/vigilante/aviso/registrar',
]);
export const MAX_RESPUESTA_VIGILANTE = 131_072;
export function codigoErrorVigilante(ruta: string, error: unknown): string | undefined {
  if (!esRutaVigilanteDurable(ruta)) {
    return undefined;
  }
  if (error instanceof ConfiguracionVigilanteInvalida) {
    return 'vigilante_configuracion_invalida';
  }
  if (error instanceof ConflictoVigilante) {
    return 'vigilante_conflicto';
  }
  if (error instanceof VigilanteNoDisponible) {
    return 'vigilante_no_disponible';
  }
  return undefined;
}
export function esRutaVigilanteDurable(ruta: string) {
  return RUTAS.has(ruta);
}
export function leerPaginaVigilante(entrada: unknown) {
  exigirTrabajo(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const campos = Object.keys(entrada).sort().join(',');
  exigirTrabajo(
    ['limite', 'despuesDe,limite', 'despuesDe,limite,revisionEsperada', 'limite,revisionEsperada'].includes(campos),
  );
  const o = objetoTrabajo(entrada, campos);
  exigirTrabajo(
    typeof o.limite === 'number' &&
      Number.isSafeInteger(o.limite) &&
      o.limite >= 1 &&
      o.limite <= LIMITE_PAGINA_VIGILANTE,
  );
  for (const clave of ['despuesDe', 'revisionEsperada']) {
    const v = o[clave];
    exigirTrabajo(v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0));
  }
  return {
    limite: o.limite,
    ...(typeof o.despuesDe === 'number' ? { despuesDe: o.despuesDe } : {}),
    ...(typeof o.revisionEsperada === 'number' ? { revisionEsperada: o.revisionEsperada } : {}),
  };
}
export async function operarVigilanteDurable(
  almacen: AlmacenVigilanteConAvisos,
  entrada: { variables: VariablesDelEntorno; ruta: string; cuerpo: unknown },
) {
  const { variables, ruta, cuerpo } = entrada;
  const rutaDeAviso = ruta === '/vigilante/aviso/preparar' || ruta === '/vigilante/aviso/registrar';
  // El evento programado avisa también de una configuración no válida; el panel la sigue rechazando.
  if (rutaDeAviso && capturarConfiguracionVigilante(variables).invalida) {
    return operarAvisoDurable(almacen, { configuracionNoValida: true }, ruta, cuerpo);
  }
  const configuracion = configuracionVigilanteDelEntorno(variables);
  if (!configuracion?.habilitado) {
    throw new VigilanteNoDisponible('Configuración ausente o deshabilitada');
  }
  if (rutaDeAviso) {
    return operarAvisoDurable(
      almacen,
      { configuracion, programada: configuracionProgramadaDelEntorno(variables) },
      ruta,
      cuerpo,
    );
  }
  if (ruta === '/vigilante/preparar') {
    const o = objetoTrabajo(cuerpo, 'acceso');
    return almacen.prepararVigilanteDeSesion(leerAccesoSesionPanel(o.acceso), configuracion);
  }
  if (ruta === '/vigilante/comprobar') {
    const o = objetoTrabajo(cuerpo, 'acceso');
    const comprobacion = await almacen.comprobarVigilanteDeSesion(
      leerAccesoSesionPanel(o.acceso),
      configuracion,
      configuracionProgramadaDelEntorno(variables),
      { origen: 'recibo' },
    );
    const { registro, porCanal } = await almacen.leerAvisoPorCanal();
    const { verificacion } = await almacen.leerDestinoParaAvisar();
    return proyectarComprobacion(comprobacion, avisosPorCanal({ variables, verificacion, registro, porCanal }));
  }
  const o = objetoTrabajo(cuerpo, 'acceso,pagina');
  return proyectarHistorial(
    await almacen.historialVigilanteDeSesion(
      leerAccesoSesionPanel(o.acceso),
      configuracion,
      leerPaginaVigilante(o.pagina),
    ),
  );
}
/**
 * Rutas del evento programado, sin sesión humana: solo las llama el manejador `scheduled` del Worker, a través del
 * enlace del objeto durable, que no se publica en HTTP.
 */
async function operarAvisoDurable(
  almacen: AlmacenSesionVigilanteSqlite,
  entrada: Parameters<AlmacenSesionVigilanteSqlite['prepararAvisoVigilante']>[0],
  ruta: string,
  cuerpo: unknown,
) {
  if (ruta === '/vigilante/aviso/preparar') {
    const o = objetoTrabajo(cuerpo, 'panel');
    exigirTrabajo(typeof o.panel === 'string' && o.panel.startsWith('https://'));
    return { aviso: await almacen.prepararAvisoVigilante(entrada, o.panel) };
  }
  // Con `canales`, cada canal deja su propio intento; sin él, solo el conjunto, como antes de los intentos por canal.
  const conCanales = cuerpo !== null && typeof cuerpo === 'object' && Object.hasOwn(cuerpo, 'canales');
  const o = objetoTrabajo(cuerpo, conCanales ? 'canales,envio,siguiente' : 'envio,siguiente');
  return almacen.registrarEnvioAviso({
    envio: leerResultadoEnvioAviso(o.envio),
    siguiente: leerEstadoAvisoVigilante(o.siguiente),
    ...(conCanales ? { canales: leerEnviosPorCanal(o.canales) } : {}),
  });
}
/** La sesión y el DTO del enlace del entorno se validan al volver a cruzar la frontera. */
export function leerRespuestaVigilante(entrada: unknown, tipo: 'comprobar' | 'historial') {
  if (entrada && typeof entrada === 'object' && Object.keys(entrada).join(',') === 'estado') {
    const sesion = leerEstadoSesionPanel(entrada);
    exigirTrabajo(sesion.estado !== 'activa');
    return sesion;
  }
  const o = objetoTrabajo(entrada, tipo === 'comprobar' ? 'estado,sesion,vigilante' : 'estado,historial,sesion');
  exigirTrabajo(o.estado === 'activa');
  const sesion = leerEstadoSesionPanel(o.sesion);
  exigirTrabajo(sesion.estado === 'activa');
  return tipo === 'comprobar'
    ? { estado: 'activa' as const, sesion, vigilante: leerVigilantePanel(o.vigilante) }
    : { estado: 'activa' as const, sesion, historial: leerHistorialVigilantePanel(o.historial) };
}
