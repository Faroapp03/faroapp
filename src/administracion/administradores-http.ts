/**
 * Rutas HTTP de la lista de administradores y la autorización de cada petición del panel. Llegan solo tras superar
 * Access; quién pide sale del principal verificado, nunca del cuerpo. Añadir va primero a Cloudflare Access y solo con
 * su confirmación entra en Faro; retirar sale primero de Faro, que deja de autorizar al momento, y después de Access.
 */
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import {
  type GuardiaAdministrativa,
  type PrincipalAdministrativo,
  SegundoFactorRequerido,
} from '../plataforma/acceso-administrativo.ts';
import {
  type AlmacenAdministradores,
  type CambioAdministradores,
  correoDeAdministrador,
  leerDecisionAutorizacion,
  leerListaAdministradores,
  leerResultadoCambioAdministradores,
  MAX_ADMINISTRADORES,
  type MotivoRechazoCambio,
  rechazoDeAlta,
  rechazoDeRetirada,
  vigentes,
} from './administradores.ts';
import { ADMINISTRADORES_SIN_CONFIGURAR, type ConfiguracionAdministradores } from './configuracion-administradores.ts';
import type { ResultadoAccess } from './grupo-access.ts';
import {
  type AccesoSesionPanel,
  type AlmacenSesionPanel,
  type EstadoSesionPanel,
  leerEstadoSesionPanel,
} from './sesion.ts';

export type OperacionAdministradores =
  | 'administradoresLeer'
  | 'administradoresAnadir'
  | 'administradoresRetirar'
  | 'administradoresReintentar';
export const RUTAS_ADMINISTRADORES = [
  ['/administracion/api/administradores/leer', 'administradoresLeer'],
  ['/administracion/api/administradores/anadir', 'administradoresAnadir'],
  ['/administracion/api/administradores/retirar', 'administradoresRetirar'],
  ['/administracion/api/administradores/reintentar', 'administradoresReintentar'],
] as const;
/** Leer la lista no exige la sesión única: basta con estar autorizado. */
export const RUTAS_LECTURA = RUTAS_ADMINISTRADORES.filter(([, operacion]) => operacion === 'administradoresLeer');
const OPERACIONES: ReadonlySet<string> = new Set(RUTAS_ADMINISTRADORES.map(([, operacion]) => operacion));
export function esOperacionAdministradores(operacion: string): operacion is OperacionAdministradores {
  return OPERACIONES.has(operacion);
}
const ESTADO_DEL_RECHAZO: Readonly<Record<MotivoRechazoCambio, number>> = {
  correo_no_valido: ESTADO_HTTP.solicitudIncorrecta,
  administrador_duplicado: ESTADO_HTTP.conflicto,
  lista_llena: ESTADO_HTTP.conflicto,
  alta_propia_primero: ESTADO_HTTP.conflicto,
  administrador_no_encontrado: ESTADO_HTTP.noEncontrado,
  ultimo_activo: ESTADO_HTTP.conflicto,
};
interface Frontera {
  readonly respuesta: (datos: object, estado?: number) => Response;
  readonly respuestaSesion: (sesion: EstadoSesionPanel) => Response;
  readonly rechazar: (estado: number, codigo: string) => never;
}
export interface CapacidadAdministradores {
  readonly almacen: AlmacenSesionPanel & AlmacenAdministradores;
  readonly administradores?: ConfiguracionAdministradores | undefined;
}
interface Peticion {
  readonly operacion: OperacionAdministradores;
  readonly cuerpo: Record<string, unknown>;
  readonly acceso: AccesoSesionPanel;
  readonly senal: AbortSignal;
}

/**
 * Toda ruta del panel pasa por aquí tras la guardia de Access. Con la lista vacía basta Access; si no, el correo tiene
 * que figurar en ella. Si el almacén no responde o responde mal, el error sube y la petición se deniega.
 */
export async function autorizarAdministrador(
  capacidad: CapacidadAdministradores,
  principal: PrincipalAdministrativo,
  rechazar: Frontera['rechazar'],
): Promise<void> {
  const { siembra } = capacidad.administradores ?? ADMINISTRADORES_SIN_CONFIGURAR;
  const entrada = { correo: principal.correo, segundoFactor: principal.segundoFactor };
  const decision = leerDecisionAutorizacion(await capacidad.almacen.autorizarAdministrador(entrada, siembra));
  if (decision === 'denegado') {
    rechazar(ESTADO_HTTP.prohibido, 'no_es_administrador');
  }
}
/** Access identifica y Faro autoriza: sin JWT válido, sin el segundo factor exigido o fuera de la lista, se deniega. */
export async function principalAutorizado(
  capacidad: CapacidadAdministradores & { readonly guardiaAdministrativa: GuardiaAdministrativa },
  peticion: Request,
  rechazar: Frontera['rechazar'],
): Promise<PrincipalAdministrativo> {
  let principal: PrincipalAdministrativo | null;
  try {
    principal = await capacidad.guardiaAdministrativa(peticion);
  } catch (error) {
    if (error instanceof SegundoFactorRequerido) {
      rechazar(ESTADO_HTTP.prohibido, 'segundo_factor_requerido');
    }
    throw error;
  }
  if (!principal) {
    rechazar(ESTADO_HTTP.prohibido, 'acceso_denegado');
  }
  await autorizarAdministrador(capacidad, principal, rechazar);
  return principal;
}
/** El cuerpo de un cambio es exactamente `{ correo }`; la forma del correo la decide la regla, con su propio error. */
function correoDelCuerpo(cuerpo: Record<string, unknown>, rechazar: Frontera['rechazar']): string {
  if (Object.keys(cuerpo).join(',') !== 'correo' || typeof cuerpo.correo !== 'string') {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  return cuerpo.correo;
}
async function lista(capacidad: CapacidadAdministradores, frontera: Frontera, extra: object = {}): Promise<Response> {
  const configuracion = capacidad.administradores ?? ADMINISTRADORES_SIN_CONFIGURAR;
  return frontera.respuesta({
    administradores: leerListaAdministradores(await capacidad.almacen.leerAdministradores()),
    maximo: MAX_ADMINISTRADORES,
    sincronizacion: configuracion.sincronizacion,
    ...extra,
  });
}
async function cambiar(
  capacidad: CapacidadAdministradores,
  acceso: AccesoSesionPanel,
  cambio: CambioAdministradores,
  frontera: Frontera,
): Promise<Response | null> {
  const resultado = leerResultadoCambioAdministradores(await capacidad.almacen.cambiarAdministradores(acceso, cambio));
  if (resultado.estado === 'rechazado') {
    return frontera.respuesta({ error: resultado.motivo }, ESTADO_DEL_RECHAZO[resultado.motivo]);
  }
  return resultado.estado === 'activa' ? null : frontera.respuestaSesion(resultado);
}
function rechazo(motivo: MotivoRechazoCambio, frontera: Frontera): Response {
  return frontera.respuesta({ error: motivo }, ESTADO_DEL_RECHAZO[motivo]);
}
async function anadir(capacidad: CapacidadAdministradores, autor: string, peticion: Peticion, frontera: Frontera) {
  const entrada = correoDelCuerpo(peticion.cuerpo, frontera.rechazar);
  const actual = leerListaAdministradores(await capacidad.almacen.leerAdministradores());
  const motivo = rechazoDeAlta(actual, autor, entrada);
  if (motivo !== null) {
    return rechazo(motivo, frontera);
  }
  const correo = correoDeAdministrador(entrada) as string;
  const grupo = capacidad.administradores?.grupo;
  if (grupo) {
    const correos = [...vigentes(actual).map((fila) => fila.correo), correo];
    if ((await grupo.sincronizar(correos, peticion.senal)) === 'fallida') {
      const fallo = await cambiar(
        capacidad,
        peticion.acceso,
        { operacion: 'anotar-fallo-alta', autor, correo },
        frontera,
      );
      return fallo ?? frontera.respuesta({ error: 'cloudflare_no_disponible' }, ESTADO_HTTP.pasarelaIncorrecta);
    }
  }
  const access = grupo ? 'correcta' : 'sin-configurar';
  const salida = await cambiar(capacidad, peticion.acceso, { operacion: 'anadir', autor, correo, access }, frontera);
  return salida ?? lista(capacidad, frontera);
}
/** Quitar del grupo y cerrar sus sesiones de Access; Faro ya no le deja entrar desde el paso anterior. */
async function completarRetirada(
  capacidad: CapacidadAdministradores,
  { autor, correo }: { readonly autor: string; readonly correo: string },
  peticion: Peticion,
  frontera: Frontera,
): Promise<Response> {
  const grupo = capacidad.administradores?.grupo;
  if (!grupo) {
    return frontera.respuesta({ error: 'cloudflare_sin_configurar' }, ESTADO_HTTP.conflicto);
  }
  const restantes = vigentes(leerListaAdministradores(await capacidad.almacen.leerAdministradores()));
  let access: ResultadoAccess = await grupo.sincronizar(
    restantes.map((fila) => fila.correo),
    peticion.senal,
  );
  if (access === 'correcta') {
    access = await grupo.revocar(correo, peticion.senal);
  }
  const salida = await cambiar(
    capacidad,
    peticion.acceso,
    { operacion: 'confirmar-retirada', autor, correo, access },
    frontera,
  );
  return salida ?? lista(capacidad, frontera, { cloudflare: access });
}
async function retirar(capacidad: CapacidadAdministradores, autor: string, peticion: Peticion, frontera: Frontera) {
  const entrada = correoDelCuerpo(peticion.cuerpo, frontera.rechazar);
  const motivo = rechazoDeRetirada(leerListaAdministradores(await capacidad.almacen.leerAdministradores()), entrada);
  if (motivo !== null) {
    return rechazo(motivo, frontera);
  }
  const correo = correoDeAdministrador(entrada) as string;
  const esperarAccess = capacidad.administradores?.grupo !== undefined;
  const cambio = { operacion: 'retirar', autor, correo, esperarAccess } as const;
  const salida = await cambiar(capacidad, peticion.acceso, cambio, frontera);
  if (salida !== null || !esperarAccess) {
    return salida ?? lista(capacidad, frontera);
  }
  return completarRetirada(capacidad, { autor, correo }, peticion, frontera);
}
/** Leer basta con estar autorizado; cambiar exige además que la sesión única abierta sea de quien pide. */
export async function atenderAdministradores(
  capacidad: CapacidadAdministradores,
  principal: PrincipalAdministrativo,
  peticion: Peticion,
  frontera: Frontera,
): Promise<Response> {
  if (peticion.operacion === 'administradoresLeer') {
    if (Object.keys(peticion.cuerpo).length !== 0) {
      frontera.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    return lista(capacidad, frontera);
  }
  const autor = principal.correo;
  if (autor === null) {
    frontera.rechazar(ESTADO_HTTP.prohibido, 'correo_no_verificado');
  }
  const sesion = leerEstadoSesionPanel(await capacidad.almacen.comprobarSesion(peticion.acceso));
  if (sesion.estado !== 'activa') {
    return frontera.respuestaSesion(sesion);
  }
  peticion.senal.throwIfAborted();
  if (peticion.operacion === 'administradoresAnadir') {
    return anadir(capacidad, autor, peticion, frontera);
  }
  if (peticion.operacion === 'administradoresRetirar') {
    return retirar(capacidad, autor, peticion, frontera);
  }
  const correo = correoDeAdministrador(correoDelCuerpo(peticion.cuerpo, frontera.rechazar));
  const actual = leerListaAdministradores(await capacidad.almacen.leerAdministradores());
  // Solo se reintenta lo que espera a Cloudflare: así nadie llama a Access por un correo que ya no está pendiente.
  if (!actual.some((fila) => fila.correo === correo && fila.estado === 'retirada-pendiente') || correo === null) {
    return rechazo('administrador_no_encontrado', frontera);
  }
  return completarRetirada(capacidad, { autor, correo }, peticion, frontera);
}
