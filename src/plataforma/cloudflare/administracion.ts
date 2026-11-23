import { capturarConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { vigilanteConConfiguracionInvalida } from '../../administracion/http-vigilante.ts';
import { AlmacenDemandaDurable } from '../acceso-publico/demanda-cliente-durable.ts';
import type { AlmacenVigilanteDurable } from '../acceso-publico/vigilante-cliente-durable.ts';
/** Montaje privado independiente de la IA. Configuración e identidad se validan antes del primer acceso SQL. */

import { configuracionAdministrativaDelEntorno } from '../../administracion/configuracion.ts';
import { configuracionActivacionDiferida } from '../../administracion/configuracion-activacion.ts';
import { configuracionActualizacionDiferida } from '../../administracion/configuracion-actualizacion.ts';
import { configuracionProgramadaDiferida } from '../../administracion/configuracion-programada.ts';
import { destinoAvisoDelEntorno } from '../../administracion/envio-aviso.ts';
import { type CanalCorreo, canalCorreoDelEntorno, type EnlaceCorreo } from '../../administracion/envio-aviso-correo.ts';
import type { LectorDatosPanel } from '../../administracion/lectura-datos-panel.ts';
import { conPruebaDeCorreo } from '../../administracion/prueba-aviso-correo.ts';
import type { OpcionesDeSocios } from '../../api/socios/servidor-socios.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { AlmacenEncuestaDurable } from '../../encuesta/cliente-durable.ts';
import { guardiaAdministrativaDelEntorno } from '../acceso-administrativo.ts';
import { AlmacenAvisosDestinoDurable } from '../acceso-publico/avisos-destino-cliente-durable.ts';
import type { AlmacenPublicoDurable, EspacioAccesoPublicoDurable } from '../acceso-publico/durable.ts';
import {
  type AdministracionMontada,
  montarAdministracion,
  type OpcionesMontajeAdministrativo,
  politicaInicialAdministrativa,
} from '../administracion.ts';
import { crearServidorWebAdministrativo, type ResponderRecursoAdministrativo } from '../administracion-web.ts';
import { crearAvisoProgramado, type ResultadoAvisoProgramado } from '../aviso-programado.ts';
import { opcionesDelEntorno } from '../configuracion.ts';
import { variablesDelServicio } from '../variables-del-servicio.ts';
import { crearAvisoInicioRechazado } from './aviso-inicio-rechazado.ts';

export interface AdministracionCloudflare {
  readonly responderRecurso: ResponderRecursoAdministrativo;
  readonly obtenerPanel: () => Promise<AdministracionMontada>;
  readonly socios: OpcionesDeSocios;
  /** Solo con el vigilante habilitado: lo evalúa tras la programación diaria y envía el aviso que toque. */
  readonly avisarVigilante?: () => Promise<ResultadoAvisoProgramado>;
}
/** Un fallo SQL no invalida la composición de datos; se reintenta sin cambiar la instancia pública. */
function panelDiferido(opciones: OpcionesMontajeAdministrativo): () => Promise<AdministracionMontada> {
  let actual: Promise<AdministracionMontada> | undefined;
  return () => {
    if (!actual) {
      const candidata = montarAdministracion(opciones);
      actual = candidata;
      void candidata.catch(() => {
        if (actual === candidata) {
          actual = undefined;
        }
      });
    }
    return actual;
  };
}
/**
 * El enrutador exige sesión antes y después; esta lectura no adopta trabajos ni renueva sus fechas. Mientras corre
 * una actualización llegan los datos de la anterior, marcados; solo falla si todavía no se ha admitido ninguno.
 */
function lectorDatosRecibidos(almacen: AlmacenPublicoDurable): LectorDatosPanel {
  return async (senal) => {
    senal.throwIfAborted();
    const lectura = await almacen.leerDatosDelPanel();
    senal.throwIfAborted();
    if (lectura === null) {
      throw new Error('Ninguna actualización ha dejado todavía un estado de datos admitido');
    }
    return { datos: lectura.observacion.datos, deLaActualizacionAnterior: lectura.deLaActualizacionAnterior };
  };
}
function vigilanteCloudflare(almacen: AlmacenVigilanteDurable) {
  return {
    preparar: (acceso: import('../../administracion/sesion.ts').AccesoSesionPanel) =>
      almacen.prepararVigilanteDeSesion(acceso),
    comprobar: (acceso: import('../../administracion/sesion.ts').AccesoSesionPanel, senal: AbortSignal) => {
      senal.throwIfAborted();
      return almacen.comprobarVigilanteDeSesion(acceso);
    },
    historial: (
      acceso: import('../../administracion/sesion.ts').AccesoSesionPanel,
      pagina: import('../../administracion/http-vigilante.ts').PaginaVigilante,
    ) => almacen.historialVigilanteDeSesion(acceso, pagina),
  };
}
function capacidadVigilanteCloudflare(
  almacen: AlmacenVigilanteDurable,
  estado: ReturnType<typeof capturarConfiguracionVigilante>,
) {
  if (estado.invalida) {
    return { vigilante: vigilanteConConfiguracionInvalida() };
  }
  if (estado.configuracion?.habilitado) {
    return { vigilante: vigilanteCloudflare(almacen) };
  }
  return {};
}
/**
 * El evento diario y el inicio rechazado avisan por los mismos canales y con el mismo registro de lo avisado. Con
 * `FARO_VIGILANTE` no válida también se avisa: es una incidencia de la que nadie se enteraría.
 */
function avisosCloudflare(
  variables: VariablesDelEntorno,
  almacenes: Readonly<{ vigilante: AlmacenVigilanteDurable; destino: AlmacenAvisosDestinoDurable }>,
  estado: ReturnType<typeof capturarConfiguracionVigilante>,
  canal: Readonly<{ panel: string; correo: CanalCorreo | undefined }>,
) {
  if (!(estado.configuracion?.habilitado || estado.invalida)) {
    return {};
  }
  const destino = () => destinoAvisoDelEntorno(variables);
  const correo = canal.correo && { canal: canal.correo, destino: () => almacenes.destino.leerDestinoParaAvisar() };
  const avisarVigilante = crearAvisoProgramado({
    autoridad: almacenes.vigilante,
    destino,
    panel: canal.panel,
    ...(correo ? { correo } : {}),
  });
  const avisarInicioRechazado = crearAvisoInicioRechazado(avisarVigilante, destino, correo !== undefined);
  return { avisarVigilante, avisarInicioRechazado };
}
/** Sin aviso propio, el inicio rechazado lo avisa el evento diario. */
function actualizacionCloudflare(
  configuracion: ReturnType<typeof configuracionActualizacionDiferida>,
  avisarInicioRechazado?: () => Promise<void>,
) {
  if (!configuracion) {
    return {};
  }
  return { actualizacion: { configuracion, ...(avisarInicioRechazado ? { avisarInicioRechazado } : {}) } };
}
function canalCorreoCloudflare(variables: VariablesDelEntorno, origen: string, enlace?: EnlaceCorreo) {
  return {
    panel: new URL('/administracion/', origen).href,
    correo: canalCorreoDelEntorno(variables, origen, enlace),
  };
}
/** `enlaceCorreo`: el enlace `send_email` del entorno (`AVISOS_CORREO`); sin él no hay canal de correo. */
export async function prepararAdministracionCloudflare(
  variables: VariablesDelEntorno,
  espacio: EspacioAccesoPublicoDurable | undefined,
  enlaceCorreo?: EnlaceCorreo,
): Promise<AdministracionCloudflare> {
  const configuracion = configuracionAdministrativaDelEntorno(variables);
  if (!configuracion) {
    throw new Error('La administración no está habilitada');
  }
  const guardiaAdministrativa = guardiaAdministrativaDelEntorno(variables);
  const activacionHabilitada = configuracionActivacionDiferida(variables);
  const actualizacion = configuracionActualizacionDiferida(variables, configuracion.origen);
  const programada = configuracionProgramadaDiferida(variables);
  opcionesDelEntorno(variablesDelServicio(variables));
  if (!espacio) {
    throw new Error('La administración requiere REGISTRO_SOCIOS');
  }
  const almacen = new AlmacenDemandaDurable(espacio);
  const estadoVigilante = capturarConfiguracionVigilante(variables);
  const correo = canalCorreoCloudflare(variables, configuracion.origen, enlaceCorreo);
  const destinoAvisos = new AlmacenAvisosDestinoDurable(espacio);
  const avisos = avisosCloudflare(variables, { vigilante: almacen, destino: destinoAvisos }, estadoVigilante, correo);
  const obtenerPanel = panelDiferido({
    configuracion,
    guardiaAdministrativa,
    ...capacidadVigilanteCloudflare(almacen, estadoVigilante),
    almacen,
    sesion: almacen,
    secciones: almacen,
    recorrido: almacen,
    instituciones: almacen,
    accesos: almacen,
    encuesta: new AlmacenEncuestaDurable(espacio),
    avisos: conPruebaDeCorreo(destinoAvisos, { canal: correo.correo, panel: correo.panel }),
    trabajos: almacen,
    leerDatosConProcedencia: lectorDatosRecibidos(almacen),
    almacenActivacion: almacen,
    ...(activacionHabilitada ? { activacionHabilitada } : {}),
    demanda: { almacen, configuracion: variables.FARO_ACTUALIZACION_DEMANDA },
    ...actualizacionCloudflare(actualizacion, avisos.avisarInicioRechazado),
    ...(programada ? { programada: { configuracion: programada, almacen } } : {}),
    inicial: politicaInicialAdministrativa(variables),
  });
  return {
    obtenerPanel,
    ...(avisos.avisarVigilante ? { avisarVigilante: avisos.avisarVigilante } : {}),
    socios: { almacen, instituciones: almacen, accesos: almacen },
    responderRecurso: crearServidorWebAdministrativo({ configuracion, guardiaAdministrativa }),
  };
}
