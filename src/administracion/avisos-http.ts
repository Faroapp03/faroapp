/**
 * Las rutas del panel para el destino de los avisos: leer la dirección, cambiarla, quitarla y enviar un aviso de
 * prueba. Van en un enrutador propio que se pone delante del general: atiende solo sus rutas y deja pasar todas las
 * demás sin tocarlas.
 * La dirección es un dato personal: solo «leer» la devuelve, dentro de la sesión; «cambiar» y «quitar» responden con
 * el resumen (revisión, fecha y estado), y ningún rechazo la repite.
 */
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import {
  type AlmacenAvisosDestinoPanel,
  esRevisionDestino,
  leerResultadoCambioDestino,
  leerResultadoLecturaDestino,
  type ResultadoCambioDestino,
} from './avisos-destino.ts';
import { validarOrigenAdministrativo } from './configuracion.ts';
import { DestinoCorreoInvalido, leerDestinoCorreo } from './destino-correo.ts';
import {
  accesoDelPanel,
  comprobarPeticionPanel,
  cuerpoDelPanel,
  rechazar,
  respuestaDeErrorPanel,
  respuestaPanel,
  respuestaSesionPanel,
} from './frontera-panel.ts';
import { crearRouterAdministrativo, type OpcionesRouterAdministrativo, PLAZO_PANEL_MS } from './http.ts';
import { type PruebaAvisos, tienePrueba } from './prueba-aviso-correo.ts';
import { type AccesoSesionPanel, leerEstadoSesionPanel } from './sesion.ts';

type OperacionAvisos = 'leer' | 'cambiar' | 'quitar' | 'probar';
export const RUTAS_AVISOS: ReadonlyMap<string, OperacionAvisos> = new Map([
  ['/administracion/api/avisos/leer', 'leer'],
  ['/administracion/api/avisos/cambiar', 'cambiar'],
  ['/administracion/api/avisos/quitar', 'quitar'],
  ['/administracion/api/avisos/probar', 'probar'],
]);
/** La frontera es la del enrutador general: el mismo origen canónico, la misma guardia de Access y la misma sesión. */
export interface OpcionesAvisosPanel
  extends Pick<OpcionesRouterAdministrativo, 'guardiaAdministrativa' | 'almacen' | 'origen' | 'permitirHttpLocal'> {
  /** Sin almacén, las rutas responden 503 a una sesión activa, como el resto de capacidades no montadas. */
  readonly avisos?: AlmacenAvisosDestinoPanel;
}
type Responder = (peticion: Request) => Promise<Response>;

/** El cuerpo exacto de cada operación; la dirección se valida aquí para responder con su propio motivo. */
function solicitudDe(operacion: OperacionAvisos, cuerpo: Record<string, unknown>) {
  const claves = Object.keys(cuerpo).sort().join(',');
  const esperadas = { leer: '', cambiar: 'correo,revisionEsperada', quitar: 'revisionEsperada', probar: '' }[operacion];
  const sinRevision = operacion === 'leer' || operacion === 'probar';
  if (claves !== esperadas || (!sinRevision && !esRevisionDestino(cuerpo.revisionEsperada))) {
    return rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  if (operacion !== 'cambiar') {
    return { revisionEsperada: cuerpo.revisionEsperada as number, correo: null };
  }
  try {
    return { revisionEsperada: cuerpo.revisionEsperada as number, correo: leerDestinoCorreo(cuerpo.correo) };
  } catch (error) {
    if (error instanceof DestinoCorreoInvalido) {
      rechazar(ESTADO_HTTP.solicitudIncorrecta, 'correo_invalido');
    }
    throw error;
  }
}
function respuestaDelCambio(resultado: ResultadoCambioDestino): Response {
  if (!('sesion' in resultado)) {
    return respuestaSesionPanel(resultado);
  }
  return respuestaPanel(resultado, resultado.estado === 'conflicto' ? ESTADO_HTTP.conflicto : ESTADO_HTTP.correcto);
}
async function probarAviso(avisos: PruebaAvisos, acceso: AccesoSesionPanel, senal: AbortSignal): Promise<Response> {
  const resultado = await avisos.enviarAvisoDePruebaDeSesion(acceso);
  senal.throwIfAborted();
  return 'sesion' in resultado ? respuestaPanel(resultado) : respuestaSesionPanel(resultado);
}
async function operar(
  opciones: OpcionesAvisosPanel,
  acceso: AccesoSesionPanel,
  { operacion, cuerpo }: { operacion: OperacionAvisos; cuerpo: Record<string, unknown> },
  senal: AbortSignal,
): Promise<Response> {
  const solicitud = solicitudDe(operacion, cuerpo);
  const { avisos } = opciones;
  // Sin almacén, o sin canal de correo para la prueba, la capacidad no está montada: la sesión decide la respuesta.
  if (!avisos || (operacion === 'probar' && !tienePrueba(avisos))) {
    const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
    senal.throwIfAborted();
    return sesion.estado === 'activa'
      ? respuestaPanel({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible)
      : respuestaSesionPanel(sesion);
  }
  if (operacion === 'probar' && tienePrueba(avisos)) {
    return probarAviso(avisos, acceso, senal);
  }
  if (operacion === 'leer') {
    const resultado = leerResultadoLecturaDestino(await avisos.leerDestinoAvisosDeSesion(acceso));
    senal.throwIfAborted();
    return 'sesion' in resultado ? respuestaPanel(resultado) : respuestaSesionPanel(resultado);
  }
  const resultado = leerResultadoCambioDestino(
    solicitud.correo === null
      ? await avisos.quitarDestinoAvisosDeSesion(acceso, solicitud.revisionEsperada)
      : await avisos.cambiarDestinoAvisosDeSesion(acceso, solicitud.revisionEsperada, solicitud.correo),
  );
  senal.throwIfAborted();
  return respuestaDelCambio(resultado);
}
async function atender(opciones: OpcionesAvisosPanel, peticion: Request, operacion: OperacionAvisos) {
  const acceso = await accesoDelPanel(peticion, opciones.guardiaAdministrativa);
  const cuerpo = await cuerpoDelPanel(peticion);
  peticion.signal.throwIfAborted();
  return operar(opciones, acceso, { operacion, cuerpo }, peticion.signal);
}

/**
 * Pone las rutas de los avisos delante del enrutador general. La ruta se reconoce por su camino exacto; todo lo demás,
 * incluidas las variantes de esas rutas que el general rechaza, sigue a `siguiente` tal como llegó.
 */
export function conRutasDeAvisos(opciones: OpcionesAvisosPanel, siguiente: Responder): Responder {
  const canonico = validarOrigenAdministrativo(opciones.origen, opciones.permitirHttpLocal);
  return async (peticion) => {
    const operacion = RUTAS_AVISOS.get(new URL(peticion.url).pathname);
    if (!operacion) {
      return siguiente(peticion);
    }
    try {
      comprobarPeticionPanel(peticion, canonico);
      return await dentroDelPlazo(
        (signal) => atender(opciones, new Request(peticion, { signal }), operacion),
        PLAZO_PANEL_MS,
        peticion.signal,
      );
    } catch (error) {
      // Ni la dirección, ni el cuerpo, ni la identidad llegan a un registro o a la respuesta de un error.
      return respuestaDeErrorPanel(error);
    }
  };
}
/** El enrutador general con las rutas de los avisos delante, montados sobre la misma frontera. */
export function crearRouterConAvisos(
  avisos: AlmacenAvisosDestinoPanel | undefined,
  opciones: OpcionesRouterAdministrativo,
): Responder {
  return conRutasDeAvisos({ ...opciones, ...(avisos ? { avisos } : {}) }, crearRouterAdministrativo(opciones));
}
