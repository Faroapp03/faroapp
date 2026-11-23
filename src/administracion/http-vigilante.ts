/** Frontera del vigilante: sesión, paginación acotada y respuesta posterior a la escritura. */
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import {
  ConfiguracionVigilanteInvalida,
  ConflictoVigilante,
  FalloLecturaVigilante,
  VigilanteNoDisponible,
} from './errores-vigilante.ts';
import type { SesionPanelActiva, SesionPanelInactiva } from './sesion.ts';
import { type AccesoSesionPanel, type AlmacenSesionPanel, leerEstadoSesionPanel } from './sesion.ts';
import { LIMITE_PAGINA_VIGILANTE } from './vigilante-panel.js';
import type { proyectarComprobacion, proyectarHistorial } from './vigilante-proyeccion.ts';

export type PaginaVigilante = { despuesDe?: number; limite?: number; revisionEsperada?: number };
export interface CapacidadVigilantePanel {
  readonly preparar?: (
    acceso: AccesoSesionPanel,
  ) => Promise<SesionPanelInactiva | { estado: 'activa'; sesion: SesionPanelActiva; preparado: true }>;
  readonly comprobar: (
    acceso: AccesoSesionPanel,
    senal: AbortSignal,
  ) => Promise<ReturnType<typeof proyectarComprobacion>>;
  readonly historial: (
    acceso: AccesoSesionPanel,
    opciones: PaginaVigilante,
  ) => Promise<ReturnType<typeof proyectarHistorial>>;
}
/** Mantiene la administración disponible y hace visible el fallo de esta política, sin utilizar sus valores. */
export function vigilanteConConfiguracionInvalida(): CapacidadVigilantePanel {
  const fallar = async (): Promise<never> => {
    throw new ConfiguracionVigilanteInvalida('Política no válida');
  };
  return { preparar: fallar, comprobar: fallar, historial: fallar };
}
export function errorVigilanteHttp(error: unknown): { codigo: string; estado: number } | undefined {
  if (error instanceof ConfiguracionVigilanteInvalida) {
    return { codigo: 'vigilante_configuracion_invalida', estado: ESTADO_HTTP.noDisponible };
  }
  if (error instanceof VigilanteNoDisponible) {
    return { codigo: 'vigilante_no_disponible', estado: ESTADO_HTTP.noDisponible };
  }
  if (error instanceof ConflictoVigilante) {
    return { codigo: 'vigilante_conflicto', estado: ESTADO_HTTP.conflicto };
  }
  if (error instanceof FalloLecturaVigilante) {
    return { codigo: 'vigilante_error', estado: ESTADO_HTTP.noDisponible };
  }
  return undefined;
}
type Ayudas = {
  respuesta: (datos: object, estado?: number) => Response;
  respuestaSesion: (estado: ReturnType<typeof leerEstadoSesionPanel>) => Response;
  rechazar: (estado: number, codigo: string) => never;
};
function paginaDe(cuerpo: Record<string, unknown>, rechazar: Ayudas['rechazar']): PaginaVigilante {
  const pagina: PaginaVigilante = { limite: LIMITE_PAGINA_VIGILANTE };
  for (const [clave, valor] of Object.entries(cuerpo)) {
    if (
      !['despuesDe', 'limite', 'revisionEsperada'].includes(clave) ||
      typeof valor !== 'number' ||
      !Number.isSafeInteger(valor) ||
      valor < 0
    ) {
      rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    Object.assign(pagina, { [clave]: valor });
  }
  if (
    (pagina.limite !== undefined && (pagina.limite < 1 || pagina.limite > LIMITE_PAGINA_VIGILANTE)) ||
    (pagina.despuesDe !== undefined && pagina.despuesDe > 0 && pagina.revisionEsperada === undefined)
  ) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  return pagina;
}
async function ejecutar(
  capacidad: CapacidadVigilantePanel,
  acceso: AccesoSesionPanel,
  pedido: {
    operacion: 'comprobarVigilante' | 'historialVigilante' | 'prepararVigilante';
    pagina: PaginaVigilante;
    senal: AbortSignal;
  },
) {
  try {
    if (pedido.operacion === 'prepararVigilante') {
      if (!capacidad.preparar) {
        throw new VigilanteNoDisponible();
      }
      return await capacidad.preparar(acceso);
    }
    return pedido.operacion === 'comprobarVigilante'
      ? await capacidad.comprobar(acceso, pedido.senal)
      : await capacidad.historial(acceso, pedido.pagina);
  } catch (error) {
    if (
      error instanceof ConfiguracionVigilanteInvalida ||
      error instanceof VigilanteNoDisponible ||
      error instanceof ConflictoVigilante ||
      error instanceof FalloLecturaVigilante
    ) {
      throw error;
    }
    throw new FalloLecturaVigilante('No se pudo consultar el vigilante', { cause: error });
  }
}
export async function operarVigilante(
  opciones: { almacen: AlmacenSesionPanel; vigilante?: CapacidadVigilantePanel },
  acceso: AccesoSesionPanel,
  pedido: {
    operacion: 'comprobarVigilante' | 'historialVigilante' | 'prepararVigilante';
    cuerpo: Record<string, unknown>;
    senal: AbortSignal;
  },
  ayudas: Ayudas,
): Promise<Response> {
  const { senal, operacion, cuerpo } = pedido;
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (inicial.estado !== 'activa') {
    return ayudas.respuestaSesion(inicial);
  }
  if (!opciones.vigilante) {
    return ayudas.respuesta({ error: 'vigilante_no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  const pagina = operacion === 'historialVigilante' ? paginaDe(cuerpo, ayudas.rechazar) : {};
  const resultado = await ejecutar(opciones.vigilante, acceso, { operacion, pagina, senal });
  senal.throwIfAborted();
  if (resultado.estado !== 'activa') {
    return ayudas.respuestaSesion(resultado);
  }
  const final = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  return final.estado === 'activa' ? ayudas.respuesta({ ...resultado, sesion: final }) : ayudas.respuestaSesion(final);
}
