import { paginarCatalogoPrivado } from './catalogo-privado.js';
import type { CerrarPublicacion } from './cierre-publicacion.ts';
import { leerObservacionDatosTrabajo, type ObservacionDatosTrabajo } from './datos-trabajo.ts';
import { operarCierrePublicacion } from './http-cierre-publicacion.ts';
import { recuperarActualizacion } from './http-recuperacion.ts';
import { type CapacidadVigilantePanel, errorVigilanteHttp, operarVigilante } from './http-vigilante.ts';
// Enrutador portable del panel; la composición lo monta antes del servidor público cuando corresponda.
// Access identifica cada petición. El token exclusivo de cada página se transmite solo en X-Faro-Sesion:
// abrir es una toma explícita del panel, nunca un reintento automático, un sondeo ni una renovación de identidad.

import { leerTextoLimitado } from '../api/cuerpo.ts';
import { PeticionCancelada, PlazoAgotado, SolicitudInvalida } from '../api/errores.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import { aBase64Url, deBase64Url } from '../comun/base64url.js';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { sha256Hex } from '../comun/huella.ts';
import { esObjeto } from '../comun/json.ts';
import * as encuesta from '../encuesta/panel-http.ts';
import type { GuardiaAdministrativa, PrincipalAdministrativo } from '../plataforma/acceso-administrativo.ts';
import type { AlmacenAccesos } from './accesos.ts';
import { atenderAccesosPanel } from './accesos-http.ts';
import type { AlmacenActivacion } from './activacion.ts';
import { activacionObservada, type TrabajosObservados } from './activacion-observada.ts';
import { leerResultadoSolicitudActualizacion, type ResultadoSolicitudActualizacion } from './actualizacion.ts';
import type { AlmacenAdministradores } from './administradores.ts';
import * as administradores from './administradores-http.ts';
import { validarOrigenAdministrativo } from './configuracion.ts';
import { esRevisionControles, leerPoliticaControles, type PoliticaControles } from './controles.ts';
import type { AlmacenInstitucionesPanel } from './instituciones.ts';
import {
  atenderInstitucionesPanel,
  esOperacionInstituciones,
  type OperacionInstituciones,
} from './instituciones-http.ts';
import { type FuentesDatosPanel, lectorDatosPanel } from './lectura-datos-panel.ts';
import type { ResultadoReconciliacion } from './reconciliacion.ts';
import type { AlmacenRecorrido } from './recorrido.ts';
import { operarRecorrido } from './recorrido-http.ts';
import type { AlmacenSeccionesPanel } from './secciones-almacen.ts';
import { operarSecciones } from './secciones-http.ts';
import {
  type AccesoSesionPanel,
  type AlmacenSesionPanel,
  type EstadoSesionPanel,
  leerEstadoSesionPanel,
  leerResultadoCambioControlesSesion,
  leerResultadoLecturaControlesSesion,
} from './sesion.ts';
import type { AlmacenSesionUnica } from './sesion-unica.ts';
import {
  atenderSesionUnica,
  huellaDePrincipal,
  type OperacionSesionUnica,
  RUTAS_SESION_UNICA,
} from './sesion-unica-http.ts';
import {
  leerReferenciaTrabajo,
  leerResultadoLecturaTrabajo,
  leerRetiradaTrabajo,
  leerSolicitudTrabajo,
  type ReferenciaTrabajo,
  type ResultadoLecturaTrabajo,
  type ResultadoRetiradaTrabajo,
  type RetiradaTrabajo,
  type SolicitudTrabajo,
} from './trabajos.ts';

/** Cuatro KiB bastan para la política cerrada; el tope se aplica también al flujo sin content-length. */
export const MAX_CUERPO_PANEL_BYTES = 4096;
/** Incluye autorización, lectura del cuerpo y almacenamiento. No revierte una transacción ya iniciada. */
export const PLAZO_PANEL_MS = 5000;
const BYTES_TOKEN_PANEL = 32;
const TOKEN_PANEL = /^[A-Za-z0-9_-]{43}$/;
type Operacion =
  | OperacionInstituciones
  | encuesta.Operacion
  | OperacionSesionUnica
  | administradores.OperacionAdministradores
  | 'leerAccesos'
  | 'estado'
  | 'actividad'
  | 'cerrar'
  | 'leer'
  | 'cambiar'
  | 'leerSecciones'
  | 'cambiarSecciones'
  | 'leerRecorrido'
  | 'cambiarRecorrido'
  | 'catalogoPrivado'
  | 'datos'
  | 'activacion'
  | 'trabajo'
  | 'actualizar'
  | 'retirar'
  | 'reconciliar'
  | 'cerrarPublicacion'
  | 'comprobarVigilante'
  | 'historialVigilante'
  | 'prepararVigilante';
type OperacionAutenticada = Exclude<Operacion, OperacionSesionUnica | administradores.OperacionAdministradores>;
/** Tabla única de rutas del panel: la prueba de CSRF la recorre entera, así ninguna ruta nueva queda sin cubrir. */
export const RUTAS: ReadonlyMap<string, Operacion> = new Map([
  ...RUTAS_SESION_UNICA,
  ...administradores.RUTAS_ADMINISTRADORES,
  ['/administracion/api/sesion/estado', 'estado'],
  ['/administracion/api/sesion/actividad', 'actividad'],
  ['/administracion/api/sesion/cerrar', 'cerrar'],
  ['/administracion/api/controles/leer', 'leer'],
  ['/administracion/api/controles/cambiar', 'cambiar'],
  ['/administracion/api/secciones/leer', 'leerSecciones'],
  ['/administracion/api/secciones/cambiar', 'cambiarSecciones'],
  ['/administracion/api/recorrido/leer', 'leerRecorrido'],
  ['/administracion/api/recorrido/cambiar', 'cambiarRecorrido'],
  ['/administracion/api/accesos/leer', 'leerAccesos'],
  ['/administracion/api/instituciones/leer', 'institucionesLeer'],
  ['/administracion/api/instituciones/invitar', 'institucionesInvitar'],
  ['/administracion/api/instituciones/renovar', 'institucionesRenovar'],
  ['/administracion/api/instituciones/retirar', 'institucionesRetirar'],
  ['/administracion/api/instituciones/retirar-clave', 'institucionesRetirarClave'],
  ['/administracion/api/datos/estado', 'datos'],
  ['/administracion/api/datos/comprobar-estado', 'comprobarVigilante'],
  ['/administracion/api/datos/vigilante/historial', 'historialVigilante'],
  ['/administracion/api/datos/vigilante/preparar', 'prepararVigilante'],
  ['/administracion/api/datos/ofertas-ocultas', 'catalogoPrivado'],
  ['/administracion/api/datos/activacion', 'activacion'],
  ['/administracion/api/datos/trabajo', 'trabajo'],
  ['/administracion/api/datos/actualizar', 'actualizar'],
  ['/administracion/api/datos/retirar', 'retirar'],
  ['/administracion/api/datos/reconciliar', 'reconciliar'],
  ['/administracion/api/datos/cerrar-publicacion', 'cerrarPublicacion'],
  ...encuesta.RUTAS,
] as const);

/** Operaciones cerradas; la composición conserva el almacén y el solicitador durable entre peticiones. */
export interface CapacidadActualizacionPanel {
  readonly leer: (acceso: AccesoSesionPanel) => Promise<ResultadoLecturaTrabajo>;
  readonly solicitar: (
    acceso: AccesoSesionPanel,
    solicitud: SolicitudTrabajo,
    senal: AbortSignal,
  ) => Promise<ResultadoSolicitudActualizacion>;
  readonly recuperacion?: {
    readonly retirar: (
      acceso: AccesoSesionPanel,
      retirada: RetiradaTrabajo,
      senal: AbortSignal,
    ) => Promise<ResultadoRetiradaTrabajo>;
    readonly reconciliar: (
      acceso: AccesoSesionPanel,
      referencia: ReferenciaTrabajo,
      senal: AbortSignal,
    ) => Promise<ResultadoReconciliacion>;
  };
  /** Cerrar sin publicar una publicación detenida o incierta; solo con la activación habilitada. */
  readonly cerrarPublicacion?: CerrarPublicacion;
}
export interface OpcionesRouterAdministrativo extends FuentesDatosPanel {
  readonly vigilante?: CapacidadVigilantePanel;
  readonly guardiaAdministrativa: GuardiaAdministrativa;
  readonly almacen: AlmacenSesionPanel & AlmacenSesionUnica & AlmacenAdministradores;
  readonly administradores?: administradores.CapacidadAdministradores['administradores'];
  /** Origen canónico fijado por la composición; nunca Host, Origin o X-Forwarded-Host de la petición. */
  readonly origen: string;
  /** Excepción explícita para http://localhost, 127.0.0.1 o [::1], con su puerto. */
  readonly permitirHttpLocal?: boolean;
  readonly leerCatalogoPrivado?: () => Promise<ObservacionDatosTrabajo | null>;
  /** Lectura del registro existente; nunca prepara tablas ni habilita efectos de activación. */
  readonly leerActivacion?: AlmacenActivacion['leerActivacionPrivada'];
  /** El almacén de trabajos que acompaña a la activación, para saber si un reintento sigue posible. */
  readonly leerTrabajosDeActivacion?: () => Promise<TrabajosObservados>;
  readonly actualizacion?: CapacidadActualizacionPanel;
  readonly secciones?: AlmacenSeccionesPanel;
  readonly recorrido?: AlmacenRecorrido;
  readonly instituciones?: AlmacenInstitucionesPanel;
  readonly accesos?: AlmacenAccesos;
  readonly encuesta?: encuesta.AlmacenPanel;
}

class RechazoPanel extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string) {
    super(codigo);
    this.estado = estado;
    this.codigo = codigo;
  }
}
function rechazar(estado: number, codigo: string): never {
  throw new RechazoPanel(estado, codigo);
}
function respuesta(datos: object, estado: number = ESTADO_HTTP.correcto): Response {
  return Response.json(datos, {
    status: estado,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
function operacionDe(peticion: Request, origen: string): Operacion {
  const url = new URL(peticion.url);
  if (url.origin !== origen || url.href !== `${origen}${url.pathname}`) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  const operacion = RUTAS.get(url.pathname);
  if (!operacion) {
    rechazar(ESTADO_HTTP.noEncontrado, 'ruta_no_encontrada');
  }
  if (peticion.method !== 'POST') {
    rechazar(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido');
  }
  return operacion;
}
function comprobarFrontera(peticion: Request, origen: string): void {
  const sitio = peticion.headers.get('sec-fetch-site');
  if (
    peticion.headers.get('origin') !== origen ||
    peticion.headers.get('x-faro-panel') !== '1' ||
    sitio !== 'same-origin'
  ) {
    rechazar(ESTADO_HTTP.prohibido, 'origen_no_permitido');
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(peticion.headers.get('content-type') ?? '')) {
    rechazar(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido');
  }
}
/** El lector común conserva cancelación y consumo único; este flujo aplica la cota más pequeña del panel. */
function conCuerpoLimitado(peticion: Request): Request {
  if (!peticion.body) {
    return peticion;
  }
  let leidos = 0;
  const limite = new TransformStream<Uint8Array, Uint8Array>({
    transform(trozo, controlador) {
      leidos += trozo.byteLength;
      if (leidos > MAX_CUERPO_PANEL_BYTES) {
        throw new SolicitudInvalida('Cuerpo administrativo demasiado grande');
      }
      controlador.enqueue(trozo);
    },
  });
  const inicio: RequestInit & { duplex: 'half' } = { body: peticion.body.pipeThrough(limite), duplex: 'half' };
  return new Request(peticion, inicio);
}
async function cuerpoDe(peticion: Request): Promise<Record<string, unknown>> {
  const maximo = MAX_CUERPO_PANEL_BYTES;
  const declarado = peticion.headers.get('content-length');
  if (declarado !== null && (!/^(0|[1-9]\d*)$/.test(declarado) || Number(declarado) > maximo)) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  let cuerpo: unknown;
  try {
    const texto = await leerTextoLimitado(conCuerpoLimitado(peticion));
    cuerpo = JSON.parse(texto);
  } catch (error) {
    if (error instanceof SyntaxError) {
      rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    throw error;
  }
  if (!esObjeto(cuerpo)) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  return cuerpo;
}
function cambioDe(cuerpo: Record<string, unknown>): { revision: number; politica: PoliticaControles } {
  if (
    Object.keys(cuerpo).sort().join(',') !== 'politica,revisionEsperada' ||
    !esRevisionControles(cuerpo.revisionEsperada)
  ) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  try {
    return { revision: cuerpo.revisionEsperada, politica: leerPoliticaControles(cuerpo.politica) };
  } catch {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
}
function solicitudDe(cuerpo: Record<string, unknown>): SolicitudTrabajo {
  try {
    return leerSolicitudTrabajo(cuerpo);
  } catch {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
}
function recuperacionDe(cuerpo: Record<string, unknown>, operacion: 'retirar' | 'reconciliar') {
  try {
    return operacion === 'retirar'
      ? ({ operacion, entrada: leerRetiradaTrabajo(cuerpo) } as const)
      : ({ operacion, entrada: leerReferenciaTrabajo(cuerpo) } as const);
  } catch {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
}
function accesoDe(token: string, principal: PrincipalAdministrativo): AccesoSesionPanel {
  return { huellaSesion: sha256Hex(token), huellaPrincipal: huellaDePrincipal(principal) };
}
/** Token exclusivo de la página que abre la sesión: solo viaja en la respuesta de apertura. */
function nuevoAccesoDe(principal: PrincipalAdministrativo) {
  const token = aBase64Url(crypto.getRandomValues(new Uint8Array(BYTES_TOKEN_PANEL)));
  return { token, acceso: accesoDe(token, principal) };
}
const RUTAS_SIN_TOKEN = [...RUTAS_SESION_UNICA, ...administradores.RUTAS_LECTURA];
const SIN_TOKEN: ReadonlySet<Operacion> = new Set(RUTAS_SIN_TOKEN.map(([, operacion]) => operacion));
function tokenDe(peticion: Request): string {
  const token = peticion.headers.get('x-faro-sesion') ?? '';
  const bytes = TOKEN_PANEL.test(token) ? deBase64Url(token) : null;
  if (!bytes || bytes.byteLength !== BYTES_TOKEN_PANEL || aBase64Url(bytes) !== token) {
    rechazar(ESTADO_HTTP.prohibido, 'sesion_inactiva');
  }
  return token;
}
/**
 * La sesión del panel viaja en una cabecera propia, sin esquema HTTP: un 401 exigiría un desafío (RFC 9110, 15.5.2).
 * La sesión inactiva es un 403 y el panel la reconoce por su cuerpo.
 */
function respuestaSesion(sesion: EstadoSesionPanel): Response {
  if (sesion.estado === 'activa') {
    return respuesta({ sesion });
  }
  if (sesion.estado === 'sustituida') {
    return respuesta({ error: 'sesion_sustituida' }, ESTADO_HTTP.conflicto);
  }
  return respuesta({ error: 'sesion_inactiva' }, ESTADO_HTTP.prohibido);
}
async function operarControles(
  almacen: AlmacenSesionPanel,
  acceso: AccesoSesionPanel,
  cambio: { revision: number; politica: PoliticaControles } | null,
): Promise<Response> {
  if (cambio) {
    // La sesión y la revisión se comprueban dentro de esta misma operación transaccional del almacén.
    const resultado = leerResultadoCambioControlesSesion(
      await almacen.cambiarControlesDeSesion(acceso, cambio.revision, cambio.politica),
    );
    if (!('sesion' in resultado)) {
      return respuestaSesion(resultado);
    }
    return respuesta(resultado, resultado.estado === 'conflicto' ? ESTADO_HTTP.conflicto : ESTADO_HTTP.correcto);
  }
  const resultado = leerResultadoLecturaControlesSesion(await almacen.leerControlesDeSesion(acceso));
  return resultado.estado === 'activa' ? respuesta(resultado) : respuestaSesion(resultado);
}
async function operarSesion(
  almacen: AlmacenSesionPanel,
  operacion: 'estado' | 'actividad' | 'cerrar',
  acceso: AccesoSesionPanel,
): Promise<Response> {
  const metodos = { estado: 'comprobarSesion', actividad: 'mantenerSesion', cerrar: 'cerrarSesion' } as const;
  const sesion = leerEstadoSesionPanel(await almacen[metodos[operacion]](acceso));
  return operacion === 'cerrar' && sesion.estado === 'cerrada' ? respuesta(sesion) : respuestaSesion(sesion);
}
/** La lectura externa no mantiene abierta una transacción; la sesión se comprueba de nuevo antes de responder. */
async function consultarDatos(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  senal: AbortSignal,
): Promise<Response> {
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  if (inicial.estado !== 'activa') {
    return respuestaSesion(inicial);
  }
  const leer = lectorDatosPanel(opciones);
  if (!leer) {
    return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  senal.throwIfAborted();
  const lectura = await leer(senal);
  senal.throwIfAborted();
  const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  return sesion.estado === 'activa' ? respuesta({ estado: 'activa', sesion, ...lectura }) : respuestaSesion(sesion);
}
/** Misma observación transaccional en Node y Worker; Access y sesión se comprueban antes y después. */
async function consultarCatalogoPrivado(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  cuerpo: Record<string, unknown>,
  senal: AbortSignal,
): Promise<Response> {
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  if (inicial.estado !== 'activa') {
    return respuestaSesion(inicial);
  }
  senal.throwIfAborted();
  if (!opciones.leerCatalogoPrivado) {
    return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  try {
    paginarCatalogoPrivado(null, cuerpo);
  } catch {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  const entrada = await opciones.leerCatalogoPrivado();
  senal.throwIfAborted();
  const observacion = entrada === null ? null : leerObservacionDatosTrabajo(entrada);
  const catalogo = observacion?.catalogo ?? null;
  if (cuerpo.revision !== null && cuerpo.revision !== catalogo?.revision) {
    return respuesta({ error: 'conflicto' }, ESTADO_HTTP.conflicto);
  }
  const pagina = paginarCatalogoPrivado(catalogo, cuerpo);
  const ids = new Set(pagina.catalogo?.unidades.map((u) => u.fuenteId));
  const intentosFuentes =
    observacion?.datos.modulos
      .filter((m) => ids.has(m.id))
      .map((m) => ({ id: m.id, ultimoIntento: m.ultimoIntento, veredicto: m.veredicto })) ?? [];
  const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  return sesion.estado === 'activa'
    ? respuesta({
        estado: 'activa',
        sesion,
        ofertasOcultas: pagina,
        reciboTerminadoEn: observacion?.recibo.terminadoEn ?? null,
        intentosFuentes,
      })
    : respuestaSesion(sesion);
}
/** Valida la instantánea privada completa antes de proyectar; ni trabajo, confianza ni evidencia cruzan la frontera. */
async function consultarActivacion(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  senal: AbortSignal,
): Promise<Response> {
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (inicial.estado !== 'activa') {
    return respuestaSesion(inicial);
  }
  if (!opciones.leerActivacion) {
    return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  // Con el almacén de trabajos, el panel sabe si la oportunidad de reintentar una abandonada sigue abierta.
  const trabajos = opciones.leerTrabajosDeActivacion ? await opciones.leerTrabajosDeActivacion() : undefined;
  const activacion = activacionObservada(await opciones.leerActivacion(), trabajos);
  senal.throwIfAborted();
  const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  return sesion.estado === 'activa' ? respuesta({ estado: 'activa', sesion, activacion }) : respuestaSesion(sesion);
}
/** El sondeo no renueva actividad. La reserva y el CAS pertenecen al solicitador, no al enrutador. */
async function operarActualizacion(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  solicitud: SolicitudTrabajo | null,
  senal: AbortSignal,
): Promise<Response> {
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  if (inicial.estado !== 'activa') {
    return respuestaSesion(inicial);
  }
  if (!opciones.actualizacion) {
    return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  senal.throwIfAborted();
  const resultado = solicitud
    ? leerResultadoSolicitudActualizacion(await opciones.actualizacion.solicitar(acceso, solicitud, senal))
    : leerResultadoLecturaTrabajo(await opciones.actualizacion.leer(acceso));
  senal.throwIfAborted();
  if (resultado.estado !== 'activa') {
    return respuestaSesion(resultado);
  }
  const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (sesion.estado !== 'activa') {
    return respuestaSesion(sesion);
  }
  let estado: number = ESTADO_HTTP.correcto;
  if ('decision' in resultado) {
    if (resultado.decision === 'conflicto' || resultado.decision === 'ocupado') {
      estado = ESTADO_HTTP.conflicto;
    } else if (resultado.decision === 'nueva' && resultado.trabajos.ultimoTrabajo?.estado !== 'terminado') {
      estado = ESTADO_HTTP.aceptada;
    }
  }
  return respuesta({ ...resultado, sesion }, estado);
}
async function atender(
  opciones: OpcionesRouterAdministrativo,
  peticion: Request,
  operacion: Operacion,
): Promise<Response> {
  const principal = await administradores.principalAutorizado(opciones, peticion, rechazar);
  const token = SIN_TOKEN.has(operacion) ? null : tokenDe(peticion);
  const cuerpo = await cuerpoDe(peticion);
  if (
    !esOperacionInstituciones(operacion) &&
    !encuesta.esOperacion(operacion) &&
    !administradores.esOperacionAdministradores(operacion) &&
    ![
      'cambiar',
      'cambiarSecciones',
      'cambiarRecorrido',
      'actualizar',
      'retirar',
      'reconciliar',
      'cerrarPublicacion',
      'leerAccesos',
      'catalogoPrivado',
      'historialVigilante',
      'abrir',
    ].includes(operacion) &&
    Object.keys(cuerpo).length !== 0
  ) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  peticion.signal.throwIfAborted();
  if (operacion === 'bienvenida' || operacion === 'abrir' || operacion === 'registro') {
    const frontera = { respuesta, rechazar, nuevoAcceso: () => nuevoAccesoDe(principal) };
    return atenderSesionUnica(opciones.almacen, principal, { operacion, cuerpo }, frontera);
  }
  const acceso = accesoDe(token ?? '', principal);
  if (administradores.esOperacionAdministradores(operacion)) {
    const pedida = { operacion, cuerpo, acceso, senal: peticion.signal };
    return administradores.atenderAdministradores(opciones, principal, pedida, {
      respuesta,
      respuestaSesion,
      rechazar,
    });
  }
  return operarPanelAutenticado(opciones, acceso, { operacion, cuerpo }, peticion.signal);
}
function operarPanelAutenticado(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  { operacion, cuerpo }: { operacion: OperacionAutenticada; cuerpo: Record<string, unknown> },
  senal: AbortSignal,
): Promise<Response> {
  if (esOperacionInstituciones(operacion)) {
    return operarInstituciones(opciones, acceso, { operacion, cuerpo }, senal);
  }
  if (encuesta.esOperacion(operacion)) {
    return encuesta.operar(opciones, acceso, { operacion, cuerpo }, { senal, respuesta, respuestaSesion, rechazar });
  }
  switch (operacion) {
    case 'comprobarVigilante':
    case 'historialVigilante':
    case 'prepararVigilante':
      return operarVigilante(opciones, acceso, { operacion, cuerpo, senal }, { respuesta, respuestaSesion, rechazar });
    case 'leerAccesos':
      return operarAccesos(opciones, acceso, cuerpo, senal);
    case 'leerSecciones':
    case 'cambiarSecciones':
      return operarSecciones(opciones, acceso, operacion === 'cambiarSecciones' ? cuerpo : null, {
        senal,
        respuesta,
        respuestaSesion,
        rechazar,
      });
    case 'leerRecorrido':
    case 'cambiarRecorrido':
      return operarRecorrido(opciones, acceso, operacion === 'cambiarRecorrido' ? cuerpo : null, {
        senal,
        respuesta,
        respuestaSesion,
        rechazar,
      });
    case 'leer':
    case 'cambiar':
      return operarControles(opciones.almacen, acceso, operacion === 'cambiar' ? cambioDe(cuerpo) : null);
    case 'estado':
    case 'actividad':
    case 'cerrar':
      return operarSesion(opciones.almacen, operacion, acceso);
    default:
      return operarDatos(opciones, acceso, { operacion, cuerpo }, senal);
  }
}
async function operarAccesos(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  cuerpo: Record<string, unknown>,
  senal: AbortSignal,
): Promise<Response> {
  if (!opciones.accesos) {
    const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
    senal.throwIfAborted();
    return sesion.estado === 'activa'
      ? respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible)
      : respuestaSesion(sesion);
  }
  const salida = await atenderAccesosPanel(opciones.accesos, acceso, cuerpo);
  senal.throwIfAborted();
  return respuesta(salida.datos, salida.estadoHttp);
}
/** Access, origen y token ya verificados; la sesión y el CAS siguen en la operación transaccional. */
async function operarInstituciones(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  { operacion, cuerpo }: { operacion: OperacionInstituciones; cuerpo: Record<string, unknown> },
  senal: AbortSignal,
): Promise<Response> {
  if (!opciones.instituciones) {
    const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
    senal.throwIfAborted();
    return sesion.estado === 'activa'
      ? respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible)
      : respuestaSesion(sesion);
  }
  const salida = await atenderInstitucionesPanel(opciones.instituciones, acceso, operacion, cuerpo);
  senal.throwIfAborted();
  return respuesta(salida.datos, salida.estadoHttp);
}
function operarDatos(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  {
    operacion,
    cuerpo,
  }: {
    operacion: Extract<
      Operacion,
      | 'catalogoPrivado'
      | 'datos'
      | 'activacion'
      | 'trabajo'
      | 'actualizar'
      | 'retirar'
      | 'reconciliar'
      | 'cerrarPublicacion'
    >;
    cuerpo: Record<string, unknown>;
  },
  senal: AbortSignal,
): Promise<Response> {
  if (operacion === 'retirar' || operacion === 'reconciliar') {
    return recuperarActualizacion(
      opciones,
      acceso,
      { solicitud: recuperacionDe(cuerpo, operacion), senal },
      {
        respuesta,
        respuestaSesion,
      },
    );
  }
  if (operacion === 'cerrarPublicacion') {
    const cerrarPublicacion = opciones.actualizacion?.cerrarPublicacion;
    const ayudas = { respuesta, respuestaSesion, rechazar };
    const capacidad = { almacen: opciones.almacen, ...(cerrarPublicacion ? { cerrarPublicacion } : {}) };
    return operarCierrePublicacion(capacidad, acceso, { cuerpo, senal }, ayudas);
  }
  if (operacion === 'catalogoPrivado') {
    return consultarCatalogoPrivado(opciones, acceso, cuerpo, senal);
  }
  if (operacion === 'datos') {
    return consultarDatos(opciones, acceso, senal);
  }
  if (operacion === 'activacion') {
    return consultarActivacion(opciones, acceso, senal);
  }
  return operarActualizacion(opciones, acceso, operacion === 'actualizar' ? solicitudDe(cuerpo) : null, senal);
}
function respuestaDeError(error: unknown): Response {
  const vigilante = errorVigilanteHttp(error);
  if (vigilante) {
    return respuesta({ error: vigilante.codigo }, vigilante.estado);
  }
  if (error instanceof RechazoPanel) {
    return respuesta({ error: error.codigo }, error.estado);
  }
  if (error instanceof PlazoAgotado) {
    return respuesta({ error: 'tiempo_agotado' }, ESTADO_HTTP.tiempoAgotado);
  }
  if (error instanceof PeticionCancelada || error instanceof SolicitudInvalida) {
    return respuesta({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
  }
  return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
}
/** No activa almacenamiento ni publica rutas. La composición conserva esta instancia y su origen confiable. */
export function crearRouterAdministrativo(
  opciones: OpcionesRouterAdministrativo,
): (peticion: Request) => Promise<Response> {
  const configuracion = {
    ...opciones,
    origen: validarOrigenAdministrativo(opciones.origen, opciones.permitirHttpLocal),
  };
  return async (peticion) => {
    try {
      const operacion = operacionDe(peticion, configuracion.origen);
      comprobarFrontera(peticion, configuracion.origen);
      return await dentroDelPlazo(
        (signal) => atender(configuracion, new Request(peticion, { signal }), operacion),
        PLAZO_PANEL_MS,
        peticion.signal,
      );
    } catch (error) {
      // Mensajes, pilas, identidad, cuerpo y tokens ajenos no se registran ni se reflejan en errores.
      return respuestaDeError(error);
    }
  };
}
