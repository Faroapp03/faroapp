/** Activación por secreto de invitación: público y de un uso; nunca crea una institución anónima. */
import { leerSecretoInvitacion, SolicitudInstitucionInvalida } from '../../administracion/instituciones.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { type ContextoApi, redDe } from '../contexto-api.ts';
import { leerTextoLimitado } from '../cuerpo.ts';
import { SolicitudInvalida } from '../errores.ts';
import { comprobarContrato } from '../http.ts';
import { AccesoPublicoNoDisponible, operacionPublica } from './acceso-publico.ts';
import { RUTA_ACTIVAR_INVITACION, RUTA_TOKEN } from './metadatos.ts';
import { huellaDelSecreto, secretoNuevo } from './registro.ts';
import { consumirCredencialGlobal, respuestaJson, type ServidorDeSocios, transporteSeguro } from './servidor-socios.ts';

const MAX_CUERPO_INVITACION = 4096;
const INVITACION_NO_DISPONIBLE_HTTP = 410;
function error(estado: number, codigo: string): Response {
  return respuestaJson(estado, { error: codigo });
}
function cuerpoAcotado(peticion: Request): Request {
  const declarada = peticion.headers.get('content-length');
  if (declarada !== null && (!/^(0|[1-9]\d*)$/.test(declarada) || Number(declarada) > MAX_CUERPO_INVITACION)) {
    throw new SolicitudInvalida('Cuerpo de invitación no válido');
  }
  if (!peticion.body) {
    return peticion;
  }
  let leidos = 0;
  const limite = new TransformStream<Uint8Array, Uint8Array>({
    transform(trozo, controlador) {
      leidos += trozo.byteLength;
      if (leidos > MAX_CUERPO_INVITACION) {
        throw new SolicitudInvalida('Cuerpo de invitación no válido');
      }
      controlador.enqueue(trozo);
    },
  });
  const opciones: RequestInit & { duplex: 'half' } = { body: peticion.body.pipeThrough(limite), duplex: 'half' };
  return new Request(peticion, opciones);
}
function frontera(peticion: Request): Response | null {
  const url = new URL(peticion.url);
  const sitio = peticion.headers.get('sec-fetch-site');
  if (
    !transporteSeguro(peticion) ||
    url.href !== `${url.origin}${url.pathname}` ||
    peticion.headers.get('origin') !== url.origin ||
    (sitio !== null && sitio !== 'same-origin')
  ) {
    return error(ESTADO_HTTP.prohibido, 'origen_no_permitido');
  }
  if (peticion.method !== 'POST') {
    return respuestaJson(ESTADO_HTTP.metodoNoAdmitido, { error: 'metodo_no_admitido' }, { allow: 'POST' });
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(peticion.headers.get('content-type') ?? '')) {
    return error(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido');
  }
  comprobarContrato(peticion);
  return null;
}
async function recibida(peticion: Request) {
  const texto = await leerTextoLimitado(cuerpoAcotado(peticion));
  const leida = leerSecretoInvitacion(JSON.parse(texto) as unknown);
  peticion.signal.throwIfAborted();
  return { id: leida.id, huella: huellaDelSecreto(leida.secreto) };
}
type InvitacionRecibida = Awaited<ReturnType<typeof recibida>>;
/**
 * Si la invitación es vigente y el tope global aún la admite. Solo una invitación vigente, que es una credencial,
 * gasta el tope: quien no tiene ninguna no puede agotarlo. Una que no lo es sigue su camino y recibe su respuesta.
 */
async function topeAgotadoPorLaInvitacion(servidor: ServidorDeSocios, invitacion: InvitacionRecibida) {
  const consulta = await operacionPublica(() => servidor.instituciones.consultarInvitacion(invitacion));
  const vigente = consulta !== null && consulta !== 'apagada';
  return { consulta, agotado: vigente && !(await consumirCredencialGlobal(servidor)) };
}
async function consultar(servidor: ServidorDeSocios, invitacion: InvitacionRecibida): Promise<Response> {
  const { consulta, agotado } = await topeAgotadoPorLaInvitacion(servidor, invitacion);
  if (agotado) {
    return error(ESTADO_HTTP.demasiadasPeticiones, 'demasiadas_peticiones');
  }
  if (consulta === 'apagada') {
    return error(ESTADO_HTTP.noEncontrado, 'ruta_desconocida');
  }
  return consulta === null
    ? error(INVITACION_NO_DISPONIBLE_HTTP, 'invitacion_no_disponible')
    : respuestaJson(ESTADO_HTTP.correcto, consulta);
}
async function activar(servidor: ServidorDeSocios, invitacion: InvitacionRecibida): Promise<Response> {
  if ((await topeAgotadoPorLaInvitacion(servidor, invitacion)).agotado) {
    return error(ESTADO_HTTP.demasiadasPeticiones, 'demasiadas_peticiones');
  }
  const almacen = servidor.instituciones;
  const secreto = secretoNuevo();
  const activada = await operacionPublica(() =>
    almacen.activarInvitacion(invitacion, { id: crypto.randomUUID(), huella: huellaDelSecreto(secreto) }),
  );
  if (activada.estado === 'apagada') {
    return error(ESTADO_HTTP.noEncontrado, 'ruta_desconocida');
  }
  if (activada.estado !== 'activada') {
    return error(INVITACION_NO_DISPONIBLE_HTTP, 'invitacion_no_disponible');
  }
  return respuestaJson(ESTADO_HTTP.correcto, {
    version: 1,
    client_id: activada.institucionId,
    client_secret: secreto,
    token_endpoint: RUTA_TOKEN,
    token_type: 'Bearer',
  });
}
function falloConocido(fallo: unknown): Response | null {
  if (
    fallo instanceof SyntaxError ||
    fallo instanceof SolicitudInvalida ||
    fallo instanceof SolicitudInstitucionInvalida
  ) {
    return error(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  return fallo instanceof AccesoPublicoNoDisponible ? error(ESTADO_HTTP.noDisponible, 'no_disponible') : null;
}
export async function atenderInvitacion(
  contexto: ContextoApi,
  servidor: ServidorDeSocios,
  peticion: Request,
  camino: string,
): Promise<Response> {
  const rechazo = frontera(peticion);
  if (rechazo) {
    return rechazo;
  }
  const almacen = servidor.instituciones;
  if (!almacen) {
    return error(ESTADO_HTTP.noDisponible, 'no_disponible');
  }
  try {
    if (!(await servidor.limites.credencialesPorRed(redDe(contexto, peticion)))) {
      return error(ESTADO_HTTP.demasiadasPeticiones, 'demasiadas_peticiones');
    }
    const invitacion = await recibida(peticion);
    return await (camino === RUTA_ACTIVAR_INVITACION ? activar(servidor, invitacion) : consultar(servidor, invitacion));
  } catch (fallo) {
    const conocida = falloConocido(fallo);
    if (conocida) {
      return conocida;
    }
    throw fallo;
  }
}
