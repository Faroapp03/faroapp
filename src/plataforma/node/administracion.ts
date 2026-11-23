import { configuracionProgramadaDelEntorno } from '../../administracion/configuracion-programada.ts';
import { capturarConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
/** Montaje Node del panel y de la API administrada, con una sola autoridad y cierre compartidos. */

import { configuracionAdministrativaDelEntorno } from '../../administracion/configuracion.ts';
import { configuracionActivacionDiferida } from '../../administracion/configuracion-activacion.ts';
import { configuracionActualizacionDiferida } from '../../administracion/configuracion-actualizacion.ts';
import { crearApi, type ResponderApi } from '../../api/api.ts';
import type { OpcionesDeSocios } from '../../api/socios/servidor-socios.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { DatosGlobales } from '../../datos-globales/datos.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import { guardiaAdministrativaDelEntorno } from '../acceso-administrativo.ts';
import { prepararSociosNode } from '../acceso-publico/composicion-node.ts';
import { type AdministracionMontada, politicaInicialAdministrativa } from '../administracion.ts';
import { cerrojoDelEntorno } from '../cloudflare/cerrojo-access.ts';
import { opcionesDelEntorno } from '../configuracion.ts';
import type { PuertaConTrabajador, PuertaDelMotor } from '../motor-de-cursos.ts';
import { variablesDelServicio } from '../variables-del-servicio.ts';
import { crearLectorEstadoDatosNode } from './estado-datos.ts';
import { crearPuertaDeCursosNode, type OpcionesDeLaPuertaNode } from './puerta-de-cursos.ts';

export interface PerfilAdministradoNode {
  readonly variables: VariablesDelEntorno;
}
export interface OpcionesAdministracionNode {
  readonly perfil: PerfilAdministradoNode;
  readonly datos: Datos;
  /** Módulo y plazos del trabajador propio de Cursos; nunca sustituye la puerta por una en este hilo. */
  readonly cursos?: OpcionesDeLaPuertaNode;
  readonly datosGlobales?: DatosGlobales | null;
  readonly origenesPermitidos: readonly string[];
  readonly permitirHttpLocal?: boolean;
  readonly archivo?: string;
  readonly pedir?: typeof fetch;
}
export interface AdministracionNode {
  readonly api: ResponderApi;
  readonly administracion: AdministracionMontada;
  readonly cerrar: () => void;
}
/** El montaje retira ambos recursos aunque falle uno de los cierres. */
function cierreDelMontaje(motor: PuertaConTrabajador, cerrarPersistencia: () => void): () => void {
  return () => {
    try {
      motor.cerrar();
    } finally {
      cerrarPersistencia();
    }
  };
}
function politicaVigilante(variables: VariablesDelEntorno) {
  const { configuracion: configuracionVigilante, invalida } = capturarConfiguracionVigilante(variables);
  return {
    ...(invalida ? { errorConfiguracionVigilante: true as const } : {}),
    ...(configuracionVigilante ? { configuracionVigilante } : {}),
    ...(configuracionVigilante?.habilitado
      ? { configuracionProgramada: () => configuracionProgramadaDelEntorno(variables) }
      : {}),
  };
}
/** Ninguna configuración de identidad inválida llega a abrir ni adoptar SQLite. */
export async function montarAdministracionNode(opciones: OpcionesAdministracionNode): Promise<AdministracionNode> {
  const originales = opciones.perfil.variables;
  const configuracion = configuracionAdministrativaDelEntorno(originales, {
    permitirHttpLocal: opciones.permitirHttpLocal ?? false,
  });
  if (!configuracion) {
    throw new Error('La administración no está habilitada');
  }
  const guardiaAdministrativa = guardiaAdministrativaDelEntorno(originales, opciones.pedir);
  const activacionHabilitada = configuracionActivacionDiferida(originales);
  const { origen, permitirHttpLocal } = configuracion;
  const actualizacion = configuracionActualizacionDiferida(originales, origen, permitirHttpLocal);
  const cerrojoPublico = cerrojoDelEntorno(originales, opciones.pedir);
  const variables = variablesDelServicio(originales);
  const preparado = await prepararSociosNode({
    ...(opciones.archivo ? { archivo: opciones.archivo } : {}),
    administracion: {
      configuracion,
      guardiaAdministrativa,
      ...politicaVigilante(variables),
      ...(activacionHabilitada ? { activacionHabilitada } : {}),
      inicial: politicaInicialAdministrativa(variables),
      leerEstadoDatos: crearLectorEstadoDatosNode(),
      ...(actualizacion
        ? {
            actualizacion: {
              configuracion: actualizacion,
              ...(opciones.pedir ? { pedir: opciones.pedir } : {}),
            },
          }
        : {}),
    },
  });
  const motorDeCursos = crearPuertaDeCursosNode(opciones.cursos);
  const cerrar = cierreDelMontaje(motorDeCursos, preparado.cerrar);
  try {
    if (!preparado.administracion || !preparado.socios) {
      throw new Error('No se pudo preparar la administración');
    }
    const api = await crearApiAdministrada(opciones, preparado.administracion, preparado.socios, motorDeCursos);
    return {
      administracion: preparado.administracion,
      cerrar,
      api: protegerApi(api, cerrojoPublico),
    };
  } catch (error) {
    cerrar();
    throw error;
  }
}
/** El cerrojo del despliegue público conserva su ámbito, separado de la administración. */
function protegerApi(api: ResponderApi, cerrojo: ReturnType<typeof cerrojoDelEntorno>): ResponderApi {
  return async (peticion) => {
    if (cerrojo && !(await cerrojo(peticion))) {
      return Response.json(
        { error: 'acceso_denegado' },
        {
          status: ESTADO_HTTP.prohibido,
          headers: { 'cache-control': 'no-store' },
        },
      );
    }
    return api(peticion);
  };
}
async function crearApiAdministrada(
  opciones: OpcionesAdministracionNode,
  administracion: AdministracionMontada,
  socios: OpcionesDeSocios,
  motorDeCursos: PuertaDelMotor,
): Promise<ResponderApi> {
  const variables = variablesDelServicio(opciones.perfil.variables);
  const delEntorno = opcionesDelEntorno(variables);
  return crearApi({
    ...delEntorno,
    datos: opciones.datos,
    motorDeCursos,
    datosGlobales: opciones.datosGlobales ?? null,
    origenesPermitidos: opciones.origenesPermitidos,
    politicaReferencias: 'ampliada',
    administracion: {
      leerControles: administracion.leerControles,
      registrarAcceso: administracion.registrarAcceso,
      socios,
    },
  });
}
