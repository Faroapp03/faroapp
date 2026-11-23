import type { CapacidadVigilantePanel } from '../administracion/http-vigilante.ts';
/** Composición administrativa común; las plataformas aportan almacenamiento y guardia ya validados. */

import type { AlmacenAccesos, UsoConectividad } from '../administracion/accesos.ts';
import type { AlmacenActivacion } from '../administracion/activacion.ts';
import { crearSolicitadorActualizacion } from '../administracion/actualizacion.ts';
import type { AlmacenAdministradores } from '../administracion/administradores.ts';
import { crearRouterConAvisos, type OpcionesAvisosPanel } from '../administracion/avisos-http.ts';
import { type ConfiguracionAdministrativa, validarOrigenAdministrativo } from '../administracion/configuracion.ts';
import type { ConfiguracionActualizacionGitHub } from '../administracion/configuracion-actualizacion.ts';
import type { ConfiguracionProgramada } from '../administracion/configuracion-programada.ts';
import { crearConsultorEjecucionGitHub } from '../administracion/consulta-ejecucion-github.ts';
import {
  type AlmacenControles,
  type DocumentoControles,
  leerDocumentoControles,
  type PoliticaControles,
} from '../administracion/controles.ts';
import { crearDespachadorGitHub } from '../administracion/ejecutor-github.ts';
import type { RegistroFallosProgramados } from '../administracion/fallo-programado.ts';
import type { CapacidadActualizacionPanel } from '../administracion/http.ts';
import { crearReceptorInicioActualizacion, type EnSegundoPlano } from '../administracion/inicio-actualizacion.ts';
import type { AlmacenInstituciones } from '../administracion/instituciones.ts';
import type { FuentesDatosPanel } from '../administracion/lectura-datos-panel.ts';
import type {
  AlmacenTrabajosProgramados,
  SolicitudTrabajoProgramado,
} from '../administracion/programacion-trabajos.ts';
import { crearReconciliadorActualizacion } from '../administracion/reconciliacion.ts';
import type { AlmacenRecorrido } from '../administracion/recorrido.ts';
import { crearReceptorResultadoActualizacion } from '../administracion/resultado-actualizacion.ts';
import type { AlmacenSeccionesPanel } from '../administracion/secciones-almacen.ts';
import { type DocumentoSecciones, leerDocumentoSecciones } from '../administracion/secciones-web.js';
import type { AlmacenPreparacionPanel } from '../administracion/sesion.ts';
import type { AlmacenSesionUnica } from '../administracion/sesion-unica.ts';
import type { AlmacenTrabajosActualizacion } from '../administracion/trabajos.ts';
import { capturarControles } from '../api/controles-administrativos.ts';
import { esDescubrimientoOAuth } from '../api/socios/descubrimiento-oauth.ts';
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import * as encuesta from '../encuesta/panel-http.ts';
import type { GuardiaAdministrativa } from './acceso-administrativo.ts';
import { activacionDiferida } from './activacion-diferida.ts';
import { crearServidorWebAdministrativo, type ResponderRecursoAdministrativo } from './administracion-web.ts';
import { respuestaDelCatalogo } from './catalogo-de-apis.ts';
import { cerradorDelMontaje } from './cierre-publicacion-montaje.ts';
import { agentesDelEntorno, unoDe } from './configuracion.ts';
import { programadaDiferida, registroDeFallos } from './programada-diferida.ts';
import { type DemandaDelMontaje, reservaDelMontaje } from './reserva-a-demanda-montaje.ts';

export type CapacidadesPanel = Readonly<{
  controles: boolean;
  actualizacion: boolean;
  vigilante: boolean;
  recorrido: boolean;
}>;

export interface AdministracionMontada extends encuesta.ConAlmacenDeEncuesta {
  readonly capacidadesPanel?: CapacidadesPanel;
  readonly configuracion: ConfiguracionAdministrativa;
  readonly responderRecurso: ResponderRecursoAdministrativo;
  readonly responder: (peticion: Request) => Promise<Response>;
  readonly leerControles: (senal: AbortSignal) => Promise<DocumentoControles>;
  readonly leerSecciones: (senal: AbortSignal) => Promise<DocumentoSecciones>;
  readonly leerSeccionesConAutoridad?: (
    senal: AbortSignal,
  ) => Promise<Omit<DocumentoSecciones, 'version'> & { readonly version: 4; readonly autoridad: string }>;
  readonly catalogo: (peticion: Request) => Promise<Response>;
  readonly registrarAcceso: (uso: UsoConectividad) => Promise<void>;
  readonly recibirResultado?: (peticion: Request) => Promise<Response>;
  readonly recibirInicio?: (peticion: Request, enSegundoPlano?: EnSegundoPlano) => Promise<Response>;
  readonly recibirActivacion?: (peticion: Request) => Promise<Response>;
  readonly recibirReserva?: (peticion: Request) => Promise<Response>;
  /** Sin señal de retirada, el evento solo se corta por su propio plazo. */
  readonly ejecutarProgramada?: (evento: SolicitudTrabajoProgramado, retirada?: AbortSignal) => Promise<void>;
  readonly registrarFalloProgramado?: RegistroFallosProgramados['registrarFalloProgramado'];
}
export interface OpcionesMontajeAdministrativo extends FuentesDatosPanel {
  readonly vigilante?: CapacidadVigilantePanel;
  readonly configuracion: ConfiguracionAdministrativa;
  readonly guardiaAdministrativa: GuardiaAdministrativa;
  readonly almacen: AlmacenControles;
  readonly sesion: AlmacenPreparacionPanel & AlmacenSesionUnica & AlmacenAdministradores;
  readonly secciones?: AlmacenSeccionesPanel;
  readonly recorrido?: AlmacenRecorrido;
  readonly instituciones?: AlmacenInstituciones;
  readonly accesos?: AlmacenAccesos;
  readonly encuesta?: encuesta.AlmacenPanel;
  readonly avisos?: OpcionesAvisosPanel['avisos'];
  readonly inicial: PoliticaControles;
  readonly trabajos?: AlmacenTrabajosActualizacion;
  readonly almacenActivacion?: AlmacenActivacion;
  readonly activacionHabilitada?: () => boolean;
  readonly demanda?: DemandaDelMontaje;
  readonly programada?: {
    readonly configuracion: () => ConfiguracionProgramada | undefined;
    readonly almacen: AlmacenTrabajosProgramados;
  };
  readonly actualizacion?: {
    readonly configuracion: () => ConfiguracionActualizacionGitHub;
    readonly pedir?: typeof fetch;
    /** Aviso del vigilante en cuanto se registra un inicio rechazado; sin él, avisa el evento diario. */
    readonly avisarInicioRechazado?: () => Promise<void>;
  };
}

/** Semilla de los tres servicios independientes; una autoridad ya preparada conserva sus controles. */
export function politicaInicialAdministrativa(variables: VariablesDelEntorno): PoliticaControles {
  return {
    version: 2,
    api: unoDe(variables, 'FARO_API_SOCIOS', ['si', 'no'], 'no') === 'si' ? 'habilitada' : 'deshabilitada',
    ...agentesDelEntorno(variables),
  };
}

/** Reserva también alias que el servidor de archivos podría normalizar. No los convierte en rutas válidas. */
function caminoReservado(camino: string): string {
  let decodificado = camino;
  try {
    decodificado = decodeURIComponent(camino);
  } catch (error) {
    // Una secuencia «%» inválida (URIError) no se decodifica parcialmente: se reserva el texto tal cual, y el servidor
    // de archivos la rechazará también. Cualquier otro fallo no es una ruta mal escrita y no se oculta.
    if (!(error instanceof URIError)) {
      throw error;
    }
  }
  const segmentos: string[] = [];
  for (const segmento of decodificado.replace(/\\/g, '/').split('/')) {
    if (segmento === '..') {
      segmentos.pop();
    } else if (segmento && segmento !== '.') {
      segmentos.push(segmento);
    }
  }
  return `/${segmentos.join('/')}`.toLowerCase();
}
export function esRutaAdministrativa(camino: string): boolean {
  const ruta = caminoReservado(camino);
  return ruta === '/administracion' || ruta.startsWith('/administracion/');
}
/** Reserva también alias para impedir que un servidor de archivos sirva esta vía privada. */
export function esRutaMantenimiento(camino: string): boolean {
  const ruta = caminoReservado(camino);
  return ruta === '/mantenimiento' || ruta.startsWith('/mantenimiento/');
}
export function esRutaApiAdministrada(camino: string): boolean {
  const ruta = caminoReservado(camino);
  return (
    ruta === '/api' ||
    ruta.startsWith('/api/') ||
    ruta === '/mcp' ||
    ruta === '/a2a' ||
    ruta === '/.well-known/agent-card.json' ||
    esDescubrimientoOAuth(ruta)
  );
}

async function catalogoActual(
  leerControles: AdministracionMontada['leerControles'],
  peticion: Request,
): Promise<Response> {
  const controles = await capturarControles({ leerControles }, peticion.signal);
  const respuesta = controles
    ? respuestaDelCatalogo(peticion.method, new URL(peticion.url).origin, {
        mcp: controles.mcp,
        a2a: controles.a2a,
        socios: controles.api !== 'deshabilitada',
      })
    : new Response(peticion.method === 'HEAD' ? null : JSON.stringify({ error: 'controles_no_disponibles' }), {
        status: ESTADO_HTTP.noDisponible,
        headers: { 'content-type': 'application/json' },
      });
  respuesta.headers.set('cache-control', 'no-store');
  return respuesta;
}

/** No sustituye el almacén si su preparación falla; la autoridad sigue siendo la del panel. */
async function montarActualizacion(
  opciones: OpcionesMontajeAdministrativo,
  actualizacion: NonNullable<OpcionesMontajeAdministrativo['actualizacion']>,
) {
  const { trabajos, configuracion } = opciones;
  if (!trabajos) {
    throw new Error('La actualización requiere un almacén durable de trabajos');
  }
  const ejecutor = actualizacion.configuracion();
  const transporte = actualizacion.pedir ? { pedir: actualizacion.pedir } : {};
  const capacidad = {
    leer: (acceso) => trabajos.leerTrabajoDeSesion(acceso),
    solicitar: crearSolicitadorActualizacion({
      almacen: trabajos,
      confianza: ejecutor.confianza,
      despachar: crearDespachadorGitHub({ ...ejecutor, ...transporte }),
    }),
    recuperacion: {
      retirar: (acceso, retirada, senal) => {
        senal.throwIfAborted();
        return trabajos.retirarTrabajoDeSesion(acceso, retirada);
      },
      reconciliar: crearReconciliadorActualizacion({
        almacen: trabajos,
        consultar: crearConsultorEjecucionGitHub({ obtenerToken: ejecutor.obtenerToken, ...transporte }),
      }),
    },
  } satisfies CapacidadActualizacionPanel;
  const cerrarPublicacion = cerradorDelMontaje(opciones, capacidad.solicitar, {
    obtenerToken: ejecutor.obtenerToken,
    ...transporte,
  });
  const recibirResultado = crearReceptorResultadoActualizacion({ ...configuracion, almacen: trabajos, ...transporte });
  const { avisarInicioRechazado } = actualizacion;
  const recibirInicio = crearReceptorInicioActualizacion({
    ...configuracion,
    almacen: trabajos,
    ...transporte,
    ...(avisarInicioRechazado ? { avisarRechazo: avisarInicioRechazado } : {}),
  });
  await trabajos.prepararTrabajos();
  return {
    capacidad: { ...capacidad, ...(cerrarPublicacion ? { cerrarPublicacion } : {}) },
    recibirResultado,
    recibirInicio,
  };
}

/** Solo las operaciones de actualización dependen de su configuración y de su tabla de trabajos. */
function actualizacionDiferida(opciones: OpcionesMontajeAdministrativo) {
  const { actualizacion } = opciones;
  if (!actualizacion) {
    return undefined;
  }
  let actual: ReturnType<typeof montarActualizacion> | undefined;
  const obtener = () => {
    if (!actual) {
      const candidata = montarActualizacion(opciones, actualizacion);
      actual = candidata;
      void candidata.catch(() => {
        if (actual === candidata) {
          actual = undefined;
        }
      });
    }
    return actual;
  };
  const capacidad: CapacidadActualizacionPanel = {
    leer: async (acceso) => (await obtener()).capacidad.leer(acceso),
    solicitar: async (acceso, solicitud, senal) => {
      const montaje = await obtener();
      senal.throwIfAborted();
      return montaje.capacidad.solicitar(acceso, solicitud, senal);
    },
    cerrarPublicacion: async (acceso, solicitud, senal) => {
      const cerrar = (await obtener()).capacidad.cerrarPublicacion;
      senal.throwIfAborted();
      if (!cerrar) {
        throw new Error('El cierre desde el panel requiere la activación habilitada');
      }
      return cerrar(acceso, solicitud, senal);
    },
    recuperacion: {
      retirar: async (acceso, retirada, senal) => {
        const montaje = await obtener();
        senal.throwIfAborted();
        return montaje.capacidad.recuperacion.retirar(acceso, retirada, senal);
      },
      reconciliar: async (acceso, referencia, senal) => {
        const montaje = await obtener();
        senal.throwIfAborted();
        return montaje.capacidad.recuperacion.reconciliar(acceso, referencia, senal);
      },
    },
  };
  return {
    capacidad,
    recibirResultado: async (peticion: Request) => (await obtener()).recibirResultado(peticion),
    recibirInicio: async (peticion: Request, enSegundoPlano?: EnSegundoPlano) =>
      (await obtener()).recibirInicio(peticion, enSegundoPlano),
  };
}

/** Una autoridad ausente o dañada no equivale a una política que abra todas las secciones. */
async function leerSeccionesAdministradas(
  almacen: AlmacenSeccionesPanel | undefined,
  senal: AbortSignal,
): Promise<DocumentoSecciones> {
  senal.throwIfAborted();
  if (!almacen) {
    throw new Error('La disponibilidad de secciones no está preparada');
  }
  const documento = await almacen.leerSecciones();
  senal.throwIfAborted();
  return leerDocumentoSecciones(documento);
}
function lectorControles(almacen: AlmacenControles) {
  return async (senal: AbortSignal): Promise<DocumentoControles> => {
    senal.throwIfAborted();
    const controles = leerDocumentoControles(await almacen.leerControles());
    senal.throwIfAborted();
    return controles;
  };
}
/** El reloj diario y el registro de los fallos que el manejador detecta antes de entrar en el panel. */
function programadaDelMontaje(opciones: OpcionesMontajeAdministrativo) {
  const ejecutarProgramada = programadaDiferida(opciones);
  return ejecutarProgramada
    ? { ejecutarProgramada, registrarFalloProgramado: registroDeFallos(opciones).registrarFalloProgramado }
    : {};
}
/** Las lecturas del estado de los datos que da la composición, sin añadir ninguna. */
function fuentesDatosDelMontaje({ leerEstadoDatos, leerDatosConProcedencia }: FuentesDatosPanel): FuentesDatosPanel {
  return {
    ...(leerEstadoDatos ? { leerEstadoDatos } : {}),
    ...(leerDatosConProcedencia ? { leerDatosConProcedencia } : {}),
  };
}
function capacidadesDelMontaje(opciones: OpcionesMontajeAdministrativo): CapacidadesPanel {
  return {
    controles: true,
    actualizacion: !!opciones.actualizacion,
    vigilante: !!opciones.vigilante,
    recorrido: !!opciones.recorrido,
  };
}
/** Prepara una vez por instancia; no reinicia una instalación válida ni crea sesiones al arrancar. */
export async function montarAdministracion(opciones: OpcionesMontajeAdministrativo): Promise<AdministracionMontada> {
  const { configuracion, guardiaAdministrativa, almacen, sesion, inicial } = opciones;
  validarOrigenAdministrativo(configuracion.origen, configuracion.permitirHttpLocal);
  await sesion.prepararPanel(inicial);
  const actualizacion = actualizacionDiferida(opciones);
  const almacenActivacion = opciones.almacenActivacion;
  const recibirActivacion = activacionDiferida(opciones);
  const leerControles = lectorControles(almacen);
  const trabajosCatalogo = opciones.trabajos;
  return {
    capacidadesPanel: capacidadesDelMontaje(opciones),
    configuracion: Object.freeze({ ...configuracion }),
    responderRecurso: crearServidorWebAdministrativo({ configuracion, guardiaAdministrativa }),
    responder: crearRouterConAvisos(opciones.avisos, {
      ...configuracion,
      guardiaAdministrativa,
      almacen: sesion,
      ...(opciones.vigilante ? { vigilante: opciones.vigilante } : {}),
      ...(opciones.secciones ? { secciones: opciones.secciones } : {}),
      ...(opciones.recorrido ? { recorrido: opciones.recorrido } : {}),
      ...(opciones.instituciones ? { instituciones: opciones.instituciones } : {}),
      ...(opciones.accesos ? { accesos: opciones.accesos } : {}),
      ...encuesta.conEncuesta(opciones),
      ...fuentesDatosDelMontaje(opciones),
      ...(trabajosCatalogo ? { leerCatalogoPrivado: () => trabajosCatalogo.leerDatosDelUltimoTrabajo() } : {}),
      ...(almacenActivacion ? { leerActivacion: () => almacenActivacion.leerActivacionPrivada() } : {}),
      ...(trabajosCatalogo ? { leerTrabajosDeActivacion: () => trabajosCatalogo.leerTrabajoPrivado() } : {}),
      ...(actualizacion ? { actualizacion: actualizacion.capacidad } : {}),
    }),
    ...(actualizacion
      ? { recibirResultado: actualizacion.recibirResultado, recibirInicio: actualizacion.recibirInicio }
      : {}),
    ...(recibirActivacion ? { recibirActivacion } : {}),
    ...reservaDelMontaje(opciones),
    ...programadaDelMontaje(opciones),
    leerControles,
    registrarAcceso: (uso) => {
      if (!opciones.accesos) {
        throw new Error('El registro operativo no está preparado');
      }
      return opciones.accesos.registrarAcceso(uso);
    },
    leerSecciones: (senal) => leerSeccionesAdministradas(opciones.secciones, senal),
    catalogo: (peticion) => catalogoActual(leerControles, peticion),
  };
}
